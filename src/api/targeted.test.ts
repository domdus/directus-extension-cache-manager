import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectionOfPath, queryDependencies, type SchemaLike } from '../shared/dependencies';
import { parseRules, ruleClears, ttlFor, validateRules, DEFAULT_RULE, type RulesConfig } from '../shared/rules';
import { TagIndex } from '../shared/tag-index';
import { measureStore, measureStoreChunked, memoryStoreOf, storedSizeOf, sweepKeys } from './store-size';
import { ExpiryQueue } from '../shared/expiry-queue';
import { applyRules, currentBucket, describeRequest, foldItemTags, keysOf, measure, tick, patchCache, patchItemsService, requestMiddleware, resetRuntimeForTests, runtime, runtimeStatus } from './targeted';
import { parse } from 'graphql';

/* ---------- schema used by the dependency tests ---------- */

const schema: SchemaLike = {
	collections: {
		pages: { fields: { id: {}, title: {}, service: {}, blocks: {}, author: {} } },
		pages_blocks: { fields: { id: {}, pages_id: {}, item: {}, collection: {} } },
		block_hero: { fields: { id: {}, headline: {}, image: {} } },
		block_text: { fields: { id: {}, text: {} } },
		services: { fields: { id: {}, name: {}, brand: {} } },
		brands: { fields: { id: {}, name: {} } },
		visits: { fields: { id: {}, page: {} } },
		directus_users: { fields: { id: {}, email: {} } },
		directus_files: { fields: { id: {} } },
	},
	relations: [
		{ collection: 'pages', field: 'service', related_collection: 'services', meta: { one_field: null } },
		{ collection: 'services', field: 'brand', related_collection: 'brands', meta: { one_field: null } },
		{ collection: 'pages', field: 'author', related_collection: 'directus_users', meta: { one_field: null } },
		{ collection: 'pages_blocks', field: 'pages_id', related_collection: 'pages', meta: { one_field: 'blocks' } },
		{ collection: 'pages_blocks', field: 'item', related_collection: null, meta: { one_field: null, one_allowed_collections: ['block_hero', 'block_text'] } },
		{ collection: 'block_hero', field: 'image', related_collection: 'directus_files', meta: { one_field: null } },
		{ collection: 'visits', field: 'page', related_collection: 'pages', meta: { one_field: null } },
	],
};

const deps = (collection: string, query: any) => [...queryDependencies(schema, collection, query)].sort();

test('dependencies: plain fields and foreign keys stay in the collection', () => {
	assert.deepEqual(deps('services', { fields: ['id', 'name', 'brand'] }), ['services']);
	assert.deepEqual(deps('visits', { fields: ['*'] }), ['visits']);
});

test('dependencies: bare * includes o2m children (their ids)', () => {
	assert.deepEqual(deps('pages', { fields: ['*'] }), ['pages', 'pages_blocks']);
	assert.deepEqual(deps('pages', null), ['pages', 'pages_blocks']);
});

test('dependencies: relational paths, wildcards and many-to-any', () => {
	assert.deepEqual(deps('pages', { fields: ['title', 'service.brand.name'] }), ['brands', 'pages', 'services']);
	assert.deepEqual(deps('pages', { fields: ['*.*'] }), ['directus_users', 'pages', 'pages_blocks', 'services']);
	assert.deepEqual(deps('pages', { fields: ['blocks.item.*'] }), ['block_hero', 'block_text', 'pages', 'pages_blocks']);
	assert.deepEqual(deps('pages', { fields: ['blocks.item:block_hero.image.id'] }), ['block_hero', 'directus_files', 'pages', 'pages_blocks']);
	assert.deepEqual(deps('pages', { fields: ['count(blocks)'] }), ['pages', 'pages_blocks']);
});

test('dependencies: filter, deep, sort and alias', () => {
	assert.deepEqual(deps('visits', { fields: ['id'], filter: { page: { service: { name: { _eq: 'A1' } } } } }), ['pages', 'services', 'visits']);
	assert.deepEqual(deps('pages', { fields: ['id'], filter: { _or: [{ blocks: { _some: { item: { _nnull: true } } } }] } }), [
		'block_hero',
		'block_text',
		'pages',
		'pages_blocks',
	]);
	assert.deepEqual(deps('pages', { fields: ['id'], deep: { service: { _filter: { brand: { name: { _eq: 'x' } } } } } }), ['brands', 'pages', 'services']);
	assert.deepEqual(deps('visits', { fields: ['id'], sort: ['-page.title'] }), ['pages', 'visits']);
	assert.deepEqual(deps('visits', { fields: ['p.title'], alias: { p: 'page' } }), ['pages', 'visits']);
	assert.deepEqual(deps('pages', { fields: ['id'], filter: { '$FOLLOW(visits, page)': { _nnull: true } } }), ['pages', 'visits']);
});

test('collectionOfPath maps item and system routes, rejects the rest', () => {
	const known = (name: string) => !!schema.collections[name];
	assert.equal(collectionOfPath('/items/pages', known), 'pages');
	assert.equal(collectionOfPath('/items/pages/12', known), 'pages');
	assert.equal(collectionOfPath('/items/unknown', known), null);
	assert.equal(collectionOfPath('/users/me', known), 'directus_users');
	assert.equal(collectionOfPath('/files', known), 'directus_files');
	assert.equal(collectionOfPath('/graphql', known), null);
	assert.equal(collectionOfPath('/flows/trigger/abc', known), null);
	assert.equal(collectionOfPath('/server/info', known), null);
});

/* ---------- rules ---------- */

test('ruleClears: actions and skipped fields', () => {
	const views = { ...DEFAULT_RULE, skipFields: ['views_count', 'date_updated'] };
	assert.equal(ruleClears(views, 'update', ['views_count']), false);
	assert.equal(ruleClears(views, 'update', ['views_count', 'date_updated']), false);
	assert.equal(ruleClears(views, 'update', ['views_count', 'title']), true);
	assert.equal(ruleClears(views, 'update', []), true);
	assert.equal(ruleClears(views, 'create', ['views_count']), true);
	const createOnly = { ...DEFAULT_RULE, update: false, delete: false };
	assert.equal(ruleClears(createOnly, 'update', ['title']), false);
	assert.equal(ruleClears(createOnly, 'delete', []), false);
	assert.equal(ruleClears(createOnly, 'upsert', ['title']), true);
});

test('ttlFor: shortest lifetime of the answer’s collections, global for the rest', () => {
	const config: RulesConfig = { targeted: true, collections: { com_videos: { ...DEFAULT_RULE, ttl: '5m' }, pages: { ...DEFAULT_RULE, ttl: '1d' } } };
	const hour = 3_600_000;
	assert.equal(ttlFor(config, ['com_videos'], 12 * hour), 300_000);
	assert.equal(ttlFor(config, ['pages'], 12 * hour), 24 * hour);
	assert.equal(ttlFor(config, ['pages', 'services'], 12 * hour), 12 * hour);
	assert.equal(ttlFor(config, ['pages', 'com_videos'], 12 * hour), 300_000);
	assert.equal(ttlFor(config, ['*'], 12 * hour), 12 * hour);
});

test('validateRules checks collections, fields and durations; drops default rules', () => {
	const fields = { com_videos: ['id', 'title', 'views_count'], pages: ['id'] };
	const ok = validateRules(
		{ targeted: true, collections: { com_videos: { update: true, skipFields: ['views_count'], ttl: '10m' }, pages: { create: true } } },
		fields,
	);
	assert.equal(ok.ok, true);
	if (ok.ok) {
		assert.deepEqual(Object.keys(ok.value.collections), ['com_videos']);
		assert.deepEqual(ok.value.collections.com_videos, { create: true, update: true, delete: true, skipFields: ['views_count'], ttl: '10m' });
	}
	const bad = validateRules({ collections: { nope: {}, com_videos: { skipFields: ['x'], ttl: '99d', update: 'yes' } }, extra: 1 }, fields);
	assert.equal(bad.ok, false);
	if (!bad.ok) {
		assert.equal(bad.errors.length, 5);
	}
	assert.deepEqual(parseRules({ targeted: 'yes', collections: { a: { update: false, ttl: 'garbage' } } }), {
		targeted: false,
		collections: { a: { create: true, update: false, delete: true, skipFields: [], ttl: null } },
	});
});

test('TagIndex take, prune and counts', () => {
	const index = new TagIndex();
	index.add('k1', ['pages', 'services'], 60_000);
	index.add('k2', ['visits'], 60_000);
	index.add('k3', ['*'], 30_000);
	assert.deepEqual(index.counts(), { pages: 1, services: 1, visits: 1, '*': 1 });
	assert.deepEqual(index.take(['services', '*']).sort(), ['k1', 'k3']);
	assert.equal(index.size, 1);
	// Found at the next minute boundary after the expiry.
	assert.equal(index.prune(59_000), 0);
	assert.equal(index.prune(120_000), 1);
	assert.equal(index.size, 0);
});

/* ---------- runtime with a fake Directus ---------- */

class FakeKeyv {
	store = new Map<string, unknown>();
	clears = 0;
	async clear() {
		this.clears++;
		this.store.clear();
	}
	async set(key: string, value: unknown) {
		this.store.set(key, value);
		return true;
	}
	async delete(key: string | string[]) {
		for (const entry of Array.isArray(key) ? key : [key]) this.store.delete(entry);
		return true;
	}
}

const env: Record<string, unknown> = { CACHE_TTL: '12h', CACHE_AUTO_PURGE: true, CACHE_AUTO_PURGE_IGNORE_LIST: ['directus_activity'], CACHE_ENABLED: true };
let cache: FakeKeyv;

/** Mirrors Directus 11.17: every write method ends with `if (shouldClearCache(...)) await this.cache.clear()`. */
function makeItemsService() {
	return class ItemsService {
		cache = cache;
		schema = { collections: { pages: { primary: 'id' }, transactions: { primary: 'id' }, subscriptions: { primary: 'id' } } };
		constructor(public collection: string) {}
		shouldClear(opts?: { autoPurgeCache?: boolean; nested?: unknown; revision?: boolean }) {
			const ignore = env.CACHE_AUTO_PURGE_IGNORE_LIST as string[];
			return env.CACHE_AUTO_PURGE === true && !ignore.includes(this.collection) && opts?.autoPurgeCache !== false;
		}
		/** Like Directus: readOne, readMany and readSingleton all end in readByQuery. */
		async readByQuery(_query: unknown, _opts?: unknown): Promise<unknown[]> {
			return [];
		}
		async readOne(key: unknown, query: Record<string, unknown> = {}) {
			return (await this.readByQuery({ ...query, filter: { _and: [{ id: { _eq: key } }, query.filter ?? {}] } }))[0] ?? null;
		}
		async createOne(data: Record<string, unknown>, opts: { autoPurgeCache?: boolean; nested?: Array<[string, Record<string, unknown>]> } = {}) {
			for (const [collection, child] of opts.nested ?? []) await new ItemsService(collection).createOne(child, { autoPurgeCache: opts.autoPurgeCache });
			if (this.shouldClear(opts)) await this.cache.clear();
			return 1;
		}
		async createMany(data: Array<Record<string, unknown>>, opts: { nested?: Array<[string, Record<string, unknown>]> } = {}) {
			for (const entry of data) await this.createOne(entry, { ...opts, autoPurgeCache: false });
			if (this.shouldClear(opts)) await this.cache.clear();
			return [1];
		}
		async updateMany(_keys: unknown[], data: Record<string, unknown>, opts: { autoPurgeCache?: boolean; revision?: boolean } = {}) {
			// Directus writes the revision inside the update, told not to clear.
			if (opts.revision) await new ItemsService('directus_revisions').createOne({ delta: data }, { autoPurgeCache: false });
			if (this.shouldClear(opts)) await this.cache.clear();
			return [1];
		}
		async updateBatch(_data: unknown[], opts: { autoPurgeCache?: boolean } = {}) {
			if (this.shouldClear(opts)) await this.cache.clear();
			return [1];
		}
		async upsertMany(_data: unknown[], opts: { autoPurgeCache?: boolean } = {}) {
			if (this.shouldClear(opts)) await this.cache.clear();
			return [1];
		}
		async deleteMany(_keys: unknown[], opts: { autoPurgeCache?: boolean } = {}) {
			if (this.shouldClear(opts)) await this.cache.clear();
			return [1];
		}
	};
}

let Items: ReturnType<typeof makeItemsService>;

async function setup(config: RulesConfig) {
	resetRuntimeForTests();
	cache = new FakeKeyv();
	Items = makeItemsService();
	const rt = runtime();
	rt.env = env;
	rt.handlers = null;
	const { handleClear, handleSet, tick, trackRead } = await import('./targeted');
	rt.handlers = {
		clear: (c) => handleClear(rt, c),
		set: (c, k, v, t) => handleSet(rt, c, k, v, t),
		tick: () => tick(rt),
		read: (service, query) => trackRead(rt, service, query),
	};
	assert.deepEqual(patchItemsService(Items, rt), []);
	patchCache(cache as any, rt);
	rt.middlewareRegistered = true;
	await applyRules(config, 'save');
	return rt;
}

/** Stores an answer like Directus' respond middleware, inside a request with these dependencies. */
async function cacheAnswer(key: string, deps: string[]) {
	const rt = runtime();
	await rt.requestContext.run({ deps: new Set(deps), start: rt.seq }, async () => {
		await (cache as any).set(key, 'value', 1000);
		await (cache as any).set(`${key}__expires_at`, 'exp', 1000);
	});
}

beforeEach(() => resetRuntimeForTests());

test('targeted: a write clears only the answers that use its collection', async () => {
	await setup({ targeted: true, collections: {} });
	await cacheAnswer('pages-list', ['pages', 'services']);
	await cacheAnswer('visit-stats', ['visits']);
	await cacheAnswer('graphql', ['*']);
	await new Items('visits').createOne({ page: 1 });
	assert.deepEqual([...cache.store.keys()].sort(), ['pages-list', 'pages-list__expires_at']);
	assert.equal(cache.clears, 1, 'only the clear when targeted clearing was turned on');
	const status = runtimeStatus();
	assert.equal(status.counts.targeted, 1);
	assert.equal(status.recent[0]!.removed, 2);
});

test('targeted: nested writes told not to clear are covered by the parent', async () => {
	await setup({ targeted: true, collections: {} });
	await cacheAnswer('subs', ['subscriptions']);
	await cacheAnswer('tx', ['transactions']);
	await cacheAnswer('pages', ['pages']);
	await new Items('subscriptions').createMany([{ id: 1 }], { nested: [['transactions', { action: 'P' }]] });
	assert.deepEqual([...cache.store.keys()].sort(), ['pages', 'pages__expires_at']);
	assert.match(runtimeStatus().recent[0]!.reason, /subscriptions \(and transactions\)/);
});

test('rules: updates that only touch skipped fields keep the cache', async () => {
	await setup({ targeted: true, collections: { pages: { ...DEFAULT_RULE, skipFields: ['views_count'] } } });
	await cacheAnswer('pages', ['pages']);
	await new Items('pages').updateMany([1], { views_count: 5 });
	assert.ok(cache.store.has('pages'));
	assert.equal(runtimeStatus().recent[0]!.kind, 'skipped');
	await new Items('pages').updateMany([1], { title: 'New' });
	assert.ok(!cache.store.has('pages'));
});

test('revision records never cause a clear on their own, but are cleared along', async () => {
	await setup({ targeted: false, collections: { pages: { ...DEFAULT_RULE, skipFields: ['views_count'] } } });
	const before = cache.clears;
	await new Items('pages').updateMany([1], { views_count: 5 }, { revision: true });
	assert.equal(cache.clears, before, 'kept by the rule although a revision was written');
	assert.equal(runtimeStatus().recent[0]!.kind, 'skipped');

	await setup({ targeted: true, collections: {} });
	await cacheAnswer('revisions', ['directus_revisions']);
	await cacheAnswer('other', ['visits']);
	await new Items('pages').updateMany([1], { title: 'x' }, { revision: true });
	assert.ok(!cache.store.has('revisions'), 'revision answers are cleared along with the page change');
	assert.ok(cache.store.has('other'));
});

test('rules also work without targeted clearing: skip or clear everything', async () => {
	await setup({ targeted: false, collections: { pages: { ...DEFAULT_RULE, update: false } } });
	await cacheAnswer('a', ['pages']);
	await new Items('pages').updateMany([1], { title: 'x' });
	assert.equal(cache.clears, 0);
	await new Items('pages').deleteMany([1]);
	assert.equal(cache.clears, 1);
	assert.equal(cache.store.size, 0);
});

test('writes to permission-like system collections and clears outside a write clear everything', async () => {
	await setup({ targeted: true, collections: {} });
	const before = cache.clears;
	await cacheAnswer('a', ['pages']);
	await new Items('directus_users').updateMany([1], { role: 'x' });
	assert.equal(cache.clears, before + 1);
	await cacheAnswer('b', ['pages']);
	await (cache as any).clear();
	assert.equal(cache.clears, before + 2);
	assert.equal(runtimeStatus().indexed, 0);
});

test('ignored nested collections do not make the parent clear them', async () => {
	await setup({ targeted: true, collections: { subscriptions: { ...DEFAULT_RULE, create: false } } });
	env.CACHE_AUTO_PURGE_IGNORE_LIST = ['directus_activity', 'transactions'];
	try {
		await cacheAnswer('tx', ['transactions']);
		await new Items('subscriptions').createMany([{ id: 1 }], { nested: [['transactions', { action: 'P' }]] });
		assert.ok(cache.store.has('tx'));
		assert.equal(runtimeStatus().recent[0]!.kind, 'skipped');
	} finally {
		env.CACHE_AUTO_PURGE_IGNORE_LIST = ['directus_activity'];
	}
});

test('describeRequest: dependencies, permission filters and per-collection lifetime', async () => {
	const rt = await setup({ targeted: true, collections: { visits: { ...DEFAULT_RULE, ttl: '5m' } } });
	const rows = [{ collection: 'visits', permissions: JSON.stringify({ page: { service: { name: { _eq: 'A1' } } } }) }];
	rt.database = () => ({ select: () => ({ where: async () => rows }) });
	const req = (accountability: any) => ({ originalUrl: '/items/visits?fields=id', schema, sanitizedQuery: { fields: ['id'] }, accountability });

	const admin = await describeRequest(rt, req({ admin: true }));
	assert.deepEqual([...admin.deps], ['visits']);
	assert.equal(admin.ttl, 300_000);

	const app = await describeRequest(rt, req({ admin: false, role: 'r' }));
	assert.deepEqual([...app.deps].sort(), ['pages', 'services', 'visits']);
	assert.equal(app.ttl, 300_000);

	const graphql = await describeRequest(rt, { originalUrl: '/graphql', schema, accountability: { admin: true } });
	assert.deepEqual([...graphql.deps], ['*']);
	assert.equal(graphql.ttl, null);
});

test('race: an answer read before a change and stored after it is dropped', async () => {
	await setup({ targeted: true, collections: {} });
	const rt = runtime();
	// The request starts (and reads) here …
	const request = { deps: new Set(['pages']), start: rt.seq };
	// … a change to pages finishes before the answer is stored …
	await new Items('pages').updateMany([1], { title: 'new' });
	await rt.requestContext.run(request, async () => {
		await (cache as any).set('pages-old', 'stale', 1000);
		await (cache as any).set('pages-old__expires_at', 'exp', 1000);
	});
	assert.ok(!cache.store.has('pages-old'), 'stale answer not kept');
	assert.ok(!cache.store.has('pages-old__expires_at'));
	// A change to another collection does not drop it.
	const other = { deps: new Set(['pages']), start: rt.seq };
	await new Items('visits').createOne({ page: 1 });
	await rt.requestContext.run(other, async () => {
		await (cache as any).set('pages-ok', 'fresh', 1000);
	});
	assert.ok(cache.store.has('pages-ok'));
});

test('lifetime per collection is applied in set() too (Directus before 11.10 ignores res.locals.cacheTTL)', async () => {
	await setup({ targeted: true, collections: {} });
	const rt = runtime();
	const seen: Array<number | undefined> = [];
	const original = rt.originals!.set;
	rt.originals!.set = async function (this: any, key: string, value: unknown, ttl?: number) {
		seen.push(ttl);
		return original.call(this, key, value, ttl);
	};
	await rt.requestContext.run({ deps: new Set(['visits']), start: rt.seq, ttl: 3000 }, async () => {
		await (cache as any).set('visits', 'v', 43_200_000);
	});
	await rt.requestContext.run({ deps: new Set(['pages']), start: rt.seq, ttl: null }, async () => {
		await (cache as any).set('pages', 'p', 43_200_000);
	});
	assert.deepEqual(seen, [3000, 43_200_000]);
});

test('status: restart needed without the request middleware; targeted then clears everything', async () => {
	const rt = await setup({ targeted: true, collections: {} });
	rt.middlewareRegistered = false;
	const status = runtimeStatus({ CACHE_ENABLED: 'true', CACHE_AUTO_PURGE: true, CACHE_STORE: 'memory' });
	assert.equal(status.installed, false);
	assert.equal(status.targetedActive, false);
	assert.match(status.problems[0]!, /restart Directus once/i);
	assert.equal(status.cacheEnabled, true, 'string "true" counts as on');
	assert.equal(status.autoPurge, true);
	const before = cache.clears;
	await cacheAnswer('a', ['pages']);
	await new Items('visits').createOne({ page: 1 });
	assert.equal(cache.clears, before + 1, 'whole cache cleared, never a partial clear without dependency info');
	rt.middlewareRegistered = true;
	assert.deepEqual(runtimeStatus({ CACHE_ENABLED: true, CACHE_AUTO_PURGE: true }).problems, []);
});

/* ---------- store size, sweep and history ---------- */

test('store size: counts entries and finds expired ones without parsing the value', () => {
	const now = 1_000_000;
	const store = new Map<string, unknown>([
		['system:a', JSON.stringify({ value: ':base64:aGVsbG8=', expires: now + 60_000 })],
		['system:b', JSON.stringify({ value: ':base64:"expires":1', expires: now - 1 })],
		['system:c', JSON.stringify({ value: ':base64:eA==' })],
	]);
	const { size, swept } = measureStore(store, now, false);
	assert.equal(size.entries, 3);
	assert.equal(size.expired, 1);
	assert.equal(swept.entries, 0);
	assert.ok(size.bytes > size.expiredBytes);

	const after = measureStore(store, now, true);
	assert.equal(after.swept.entries, 1);
	assert.equal(after.size.entries, 2);
	assert.equal(after.size.expired, 0);
	assert.deepEqual([...store.keys()], ['system:a', 'system:c']);
});

test('store size: finds the Map of Keyv 4 and 5, not of Redis', () => {
	const map = new Map();
	assert.equal(memoryStoreOf({ store: map }), map);
	assert.equal(memoryStoreOf({ opts: { store: map } }), map);
	assert.equal(memoryStoreOf({ store: { get() {} } }), null);
	assert.equal(storedSizeOf(Buffer.alloc(3)), 4);
});

test('expiry queue: only the keys whose minute is over come out, once', () => {
	const queue = new ExpiryQueue();
	const t = Date.parse('2026-01-01T10:00:00Z');
	queue.add('a', t + 30_000);
	queue.add('b', t + 90_000);
	queue.add('c', t + 30_000);
	queue.add('c', t + 600_000); // stored again: moves
	assert.equal(queue.size, 3);
	assert.deepEqual(queue.takeDue(t + 59_000), []);
	assert.deepEqual(queue.takeDue(t + 60_000), ['a']);
	assert.deepEqual(queue.takeDue(t + 120_000), ['b']);
	queue.remove('c');
	assert.deepEqual(queue.takeDue(t + 3_600_000), []);
	assert.equal(queue.size, 0);
});

test('sweep: deletes due keys that are expired, requeues the ones stored again, in chunks', async () => {
	const now = Date.now();
	const store = new Map<string, unknown>([
		['old', JSON.stringify({ value: 'x', expires: now - 1 })],
		['again', JSON.stringify({ value: 'y', expires: now + 60_000 })],
	]);
	const requeued: string[] = [];
	const swept = await sweepKeys(store, ['old', 'again', 'gone'], now, (key) => requeued.push(key), 1);
	assert.equal(swept.entries, 1);
	assert.deepEqual([...store.keys()], ['again']);
	assert.deepEqual(requeued, ['again']);

	// The chunked measurement gives the same numbers as the one-pass version.
	const many = new Map<string, unknown>();
	for (let i = 0; i < 25; i++) many.set(`k${i}`, JSON.stringify({ value: 'v'.repeat(i), expires: now + (i % 5 === 0 ? -1 : 60_000) }));
	const copy = new Map(many);
	const chunked = await measureStoreChunked(many, now, true, undefined, 4);
	const once = measureStore(copy, now, true);
	assert.deepEqual(chunked, once);
});

test('tick: sweeps only queued keys whose minute is over; Statistics shows the last measurement', async () => {
	const rt = await setup({ targeted: true, collections: {} });
	const store = new Map<string, unknown>();
	(cache as any).store = store;
	const now = Date.now();
	store.set('k:old', JSON.stringify({ value: 'x'.repeat(100), expires: now - 1 }));
	store.set('k:new', JSON.stringify({ value: 'y', expires: now + 120_000 }));
	rt.expiry.add('k:old', now - 1);
	rt.expiry.add('k:new', now + 120_000);

	await tick(rt, now);
	assert.deepEqual([...store.keys()], ['k:new']);
	const status = runtimeStatus(env);
	assert.equal(status.swept.entries, 1);
	assert.equal(status.size?.entries, 1, 'measured after the sweep');
	assert.equal(status.history.length, 24);
	assert.equal(status.history[23].entries, 1);
	assert.ok(status.history[23].full >= 1, 'the switch to Granular counts as a whole-cache clear');

	// An entry the queue did not know (stored before the extension ran) is caught by the measurement.
	store.set('k:unknown', JSON.stringify({ value: 'z', expires: now - 1 }));
	await measure(rt, now + 1);
	assert.equal(store.has('k:unknown'), false);
	assert.equal(runtimeStatus(env).swept.entries, 2);
});

test('stored answers are queued in every mode; a whole-cache clear empties the queue', async () => {
	const rt = await setup({ targeted: false, collections: {} });
	await (cache as any).set('answer', 'value', 1000);
	assert.equal(rt.expiry.has('answer'), true);
	await (cache as any).clear();
	assert.equal(rt.expiry.size, 0);
});

test('index: bytes per collection are running totals, prune only looks at due keys', () => {
	const index = new TagIndex();
	const t = Date.parse('2026-01-01T10:00:00Z');
	index.add('a', ['pages', 'services'], t + 30_000, 100);
	index.add('b', ['pages'], t + 600_000, 50);
	index.addBytes('a', 10);
	assert.deepEqual(index.bytes(), { pages: 160, services: 110 });
	assert.equal(index.prune(t + 60_000), 1);
	assert.deepEqual(index.bytes(), { pages: 50 });
	index.remove('b');
	assert.deepEqual(index.bytes(), {});
});

test('history: one bucket per hour, at most 24', async () => {
	const rt = await setup({ targeted: false, collections: {} });
	const start = Date.parse('2026-01-01T00:30:00Z');
	for (let h = 0; h < 30; h++) currentBucket(rt, start + h * 3_600_000).skipped++;
	assert.equal(rt.history.length, 24);
	assert.equal(rt.history[0].hour, '2026-01-01T06:00:00.000Z');
});

test('status: no size for a store that is not in memory', async () => {
	await setup({ targeted: false, collections: {} });
	(cache as any).store = { get() {} };
	assert.equal(runtimeStatus(env).size, null);
});

test('reload: a runtime from an older version gets the fields it lacks', async () => {
	resetRuntimeForTests();
	const old = runtime() as any;
	delete old.history;
	delete old.swept;
	// An index made by an older class: same data, no bytes() method, entries without a size.
	class OldIndex {
		byTag = new Map([['pages', new Set(['k'])]]);
		byKey = new Map([['k', { tags: ['pages'], expires: Date.now() + 60_000 }]]);
	}
	old.index = new OldIndex();
	const rt = runtime();
	assert.deepEqual(rt.index.bytes(), { pages: 0 });
	assert.equal(rt.index.size, 1);
	assert.equal(rt, old);
	assert.deepEqual(rt.history, []);
	assert.deepEqual(rt.swept, { entries: 0, bytes: 0 });
	assert.equal(runtimeStatus(env).history.length, 24);
});

test('statistics: several whole-cache clears in the same minute count as one minute', async () => {
	const rt = await setup({ targeted: false, collections: {} });
	const before = rt.counts.fullMinutes;
	await (cache as any).clear();
	await (cache as any).clear();
	await (cache as any).clear();
	assert.equal(rt.counts.full >= 3, true);
	assert.ok(rt.counts.fullMinutes - before <= 1, 'one minute, not three');
});

/* ---------- GraphQL: dependencies from the reads a query makes ---------- */

/** Runs one GraphQL request through the middleware: `body` reads like Directus' resolvers, then the response is stored. */
async function graphqlRequest(
	query: string,
	body: (reader: (collection: string) => any) => Promise<void>,
	options: { path?: string; admin?: boolean; key?: string } = {},
) {
	const rt = runtime();
	const res: any = { locals: {} };
	const req = { method: 'POST', originalUrl: options.path ?? '/graphql', schema, accountability: { admin: options.admin ?? true } };
	// The readers see the full test schema (with relations), like Directus' services get req.schema.
	const Reader = class extends Items {
		schema = schema as any;
	};
	await new Promise<void>((resolve, reject) => {
		requestMiddleware(rt)(req, res, (error?: unknown) => {
			if (error) return reject(error);
			// Directus' parseGraphQL middleware, then the resolvers, then respond (which stores the response).
			res.locals.graphqlParams = { document: parse(query), query, operationName: null };
			body((collection) => new Reader(collection))
				.then(async () => {
					const key = options.key ?? 'gql';
					await (cache as any).set(key, 'value', res.locals.cacheTTL ?? 43_200_000);
					await (cache as any).set(`${key}__expires_at`, 'exp', res.locals.cacheTTL ?? 43_200_000);
				})
				.then(resolve, reject);
		});
	});
	return res;
}

test('graphql: a query depends on the collections its reads reach, not on everything', async () => {
	await setup({ targeted: true, collections: {} });
	await graphqlRequest('{ pages { title service { name } } }', (read) => read('pages').readByQuery({ fields: ['title', 'service.name'] }));
	assert.deepEqual(runtime().index.counts(), { pages: 1, services: 1 });

	await new Items('visits').createOne({ page: 1 });
	assert.ok(cache.store.has('gql'), 'a visit does not clear a query that does not read visits');
	await new Items('services').updateMany([1], { name: 'B2' });
	assert.ok(!cache.store.has('gql'), 'a renamed service clears the query that shows service names');
});

test('graphql: several root fields, _by_id and aggregates add up', async () => {
	await setup({ targeted: true, collections: {} });
	await graphqlRequest('query Home { pages_by_id(id: 1) { title } visits_aggregated { count { id } } }', async (read) => {
		await read('pages').readOne(1, { fields: ['title'] });
		await read('visits').readByQuery({ aggregate: { count: ['id'] } });
	});
	const counts = runtime().index.counts();
	assert.equal(counts['*'], undefined, 'not "uses everything"');
	assert.ok(counts.pages && counts.visits);
	await new Items('brands').createOne({ name: 'x' });
	assert.ok(cache.store.has('gql'));
	await new Items('visits').createOne({ page: 1 });
	assert.ok(!cache.store.has('gql'));
});

test('graphql: root fields that are not collection reads make it "uses everything"', async () => {
	await setup({ targeted: true, collections: {} });
	await graphqlRequest('{ server_info { project { project_name } } users { id } }', (read) => read('directus_users').readByQuery({ fields: ['id'] }), {
		path: '/graphql/system',
	});
	assert.equal(runtime().index.counts()['*'], 1);
	await new Items('visits').createOne({ page: 1 });
	assert.ok(!cache.store.has('gql'), 'any change clears it, like before');

	await setup({ targeted: true, collections: {} });
	await graphqlRequest('{ users_me { id } }', (read) => read('directus_users').readOne(1, { fields: ['id'] }), { path: '/graphql/system' });
	assert.equal(runtime().index.counts()['*'], 1, 'users_me reads the current user, not a fixed query');
});

test('graphql: a read of an unknown collection or a broken document makes it "uses everything"', async () => {
	await setup({ targeted: true, collections: {} });
	await graphqlRequest('{ pages { title } }', (read) => read('not_in_schema').readByQuery({}));
	assert.equal(runtime().index.counts()['*'], 1);

	await setup({ targeted: true, collections: {} });
	await graphqlRequest('query A { pages { id } } query B { visits { id } }', (read) => read('pages').readByQuery({ fields: ['id'] }));
	assert.equal(runtime().index.counts()['*'], 1, 'two operations and no operationName: can\'t tell which one ran');
});

test('graphql: only __typename reads nothing, so only a whole-cache clear removes it', async () => {
	await setup({ targeted: true, collections: {} });
	await graphqlRequest('{ __typename }', async () => {});
	await new Items('pages').updateMany([1], { title: 'x' });
	assert.ok(cache.store.has('gql'));
	await (cache as any).clear();
	assert.ok(!cache.store.has('gql'));
});

test('graphql: permission filters of an app add their collections; lifetimes per collection apply', async () => {
	const rt = await setup({ targeted: true, collections: { visits: { ...DEFAULT_RULE, ttl: '5m' } } });
	const rows = [{ collection: 'visits', permissions: JSON.stringify({ page: { service: { name: { _eq: 'A1' } } } }) }];
	rt.database = () => ({ select: () => ({ where: async () => rows }) });
	const seen: Array<number | undefined> = [];
	const original = rt.originals!.set;
	rt.originals!.set = async function (this: any, key: string, value: unknown, ttl?: number) {
		seen.push(ttl);
		return original.call(this, key, value, ttl);
	};
	const res = await graphqlRequest('{ visits { id } }', (read) => read('visits').readByQuery({ fields: ['id'] }), { admin: false });
	assert.equal(res.locals.cacheTTL, 300_000, 'Cache-Control and __expires_at follow the rule');
	assert.deepEqual(seen, [300_000, 300_000]);
	await new Items('services').updateMany([1], { name: 'B2' });
	assert.ok(!cache.store.has('gql'), 'a service change can change which visits the app may see');
});

test('graphql: reads outside a GraphQL request change nothing', async () => {
	await setup({ targeted: true, collections: {} });
	const Reader = class extends Items {
		schema = schema as any;
	};
	await new Reader('pages').readByQuery({ fields: ['title'] });
	await cacheAnswer('rest', ['visits']);
	assert.deepEqual(runtime().index.counts(), { visits: 1 });
});

/* ---------- item-level clearing (advanced) ---------- */

test('keysOf: the items a write changes', () => {
	assert.deepEqual(keysOf('updateMany', [[1, 2], {}], 'id'), ['1', '2']);
	assert.deepEqual(keysOf('deleteMany', [['a']], 'id'), ['a']);
	assert.deepEqual(keysOf('createOne', [{}], 'id'), []);
	assert.deepEqual(keysOf('createMany', [[{}]], 'id'), []);
	assert.deepEqual(keysOf('updateBatch', [[{ id: 3, title: 'x' }]], 'id'), ['3']);
	assert.equal(keysOf('updateBatch', [[{ title: 'x' }]], 'id'), null, 'without a key it cannot tell');
	assert.deepEqual(keysOf('upsertMany', [[{ id: 4 }, { title: 'new' }]], 'id'), ['4'], 'an entry without a key is new');
	assert.equal(keysOf('updateMany', ['not-a-list', {}], 'id'), null);
});

test('items: a single-item read depends on its item, related collections stay whole', async () => {
	const rt = await setup({ targeted: true, items: true, collections: {} });
	rt.database = () => ({ select: () => ({ where: async () => [] }) });
	const req = (url: string, fields: string[], admin = true) => ({ originalUrl: url, schema, sanitizedQuery: { fields }, accountability: { admin } });
	const detail = await describeRequest(rt, req('/items/pages/5?fields=title,service.name', ['title', 'service.name']));
	assert.deepEqual([...detail.deps].sort(), ['pages#', 'pages#5', 'services']);
	const two = await describeRequest(rt, req('/items/pages/5,6', ['title']));
	assert.deepEqual([...two.deps].sort(), ['pages#', 'pages#5', 'pages#6']);
	const list = await describeRequest(rt, req('/items/pages', ['title']));
	assert.deepEqual([...list.deps], ['pages']);
	const self = await describeRequest(rt, req('/items/pages/5', ['blocks.pages_id.title']));
	assert.ok(self.deps.has('pages'), 'reaches pages again through relations: the whole collection');

	const off = await setup({ targeted: true, collections: {} });
	assert.deepEqual([...(await describeRequest(off, req('/items/pages/5', ['title']))).deps], ['pages'], 'off by default');
});

test('items: permission filters that reach the collection again keep it whole', async () => {
	const rt = await setup({ targeted: true, items: true, collections: {} });
	const rows = [{ collection: 'pages_blocks', permissions: JSON.stringify({ pages_id: { title: { _nnull: true } } }) }];
	rt.database = () => ({ select: () => ({ where: async () => rows }) });
	const req = { originalUrl: '/items/pages/5', schema, sanitizedQuery: { fields: ['title', 'blocks.id'] }, accountability: { admin: false } };
	assert.ok((await describeRequest(rt, req)).deps.has('pages'));
	const plain = { ...req, sanitizedQuery: { fields: ['title'] } };
	assert.deepEqual([...(await describeRequest(rt, plain)).deps].sort(), ['pages#', 'pages#5']);
});

test('items: a change to some items clears their single-item responses and the lists', async () => {
	await setup({ targeted: true, items: true, collections: {} });
	const fill = async () => {
		await cacheAnswer('page5', ['services', 'pages#5', 'pages#']);
		await cacheAnswer('page6', ['services', 'pages#6', 'pages#']);
		await cacheAnswer('list', ['pages']);
	};
	const kept = () => ['page5', 'page6', 'list'].filter((key) => cache.store.has(key));
	await fill();
	await new Items('pages').updateMany([5], { title: 'x' });
	assert.deepEqual(kept(), ['page6']);
	await fill();
	await new Items('pages').createOne({ title: 'new' });
	assert.deepEqual(kept(), ['page5', 'page6'], 'a new item only changes lists');
	await fill();
	await new Items('pages').updateBatch([{ title: 'x' }]);
	assert.deepEqual(kept(), [], 'unknown items: every single-item response of pages');
	await fill();
	await new Items('services').updateMany([1], { name: 'x' });
	assert.deepEqual(kept(), ['list'], 'related collections clear as a whole');
	assert.deepEqual(foldItemTags(runtime().index.counts()), { pages: 1 });
});

test('items: an answer read before its item changed is dropped, other items are kept', async () => {
	await setup({ targeted: true, items: true, collections: {} });
	const rt = runtime();
	const start = rt.seq;
	await new Items('pages').updateMany([5], { title: 'x' });
	await rt.requestContext.run({ deps: new Set(['pages#5', 'pages#']), start }, () => (cache as any).set('page5', 'old', 1000));
	await rt.requestContext.run({ deps: new Set(['pages#6', 'pages#']), start }, () => (cache as any).set('page6', 'ok', 1000));
	assert.ok(!cache.store.has('page5'));
	assert.ok(cache.store.has('page6'));
});

test('foldItemTags: single-item responses count under their collection', () => {
	assert.deepEqual(foldItemTags({ pages: 2, 'pages#': 3, 'pages#5': 1, services: 1 }), { pages: 5, services: 1 });
});

test('items: GraphQL _by_id depends on its item; lifetimes of the collection still apply', async () => {
	await setup({ targeted: true, items: true, collections: { pages: { ...DEFAULT_RULE, ttl: '5m' } } });
	const res = await graphqlRequest('{ pages_by_id(id: 5) { title service { name } } pages { id } }', async (read) => {
		await read('pages').readOne(5, { fields: ['title', 'service.name'] });
		await read('pages').readByQuery({ fields: ['id'] });
	});
	assert.equal(res.locals.cacheTTL, 300_000);
	await setup({ targeted: true, items: true, collections: {} });
	await graphqlRequest('{ pages_by_id(id: 5) { title service { name } } }', (read) => read('pages').readOne(5, { fields: ['title', 'service.name'] }));
	assert.deepEqual(runtime().index.counts(), { 'pages#5': 1, 'pages#': 1, services: 1 });
	await new Items('pages').updateMany([6], { title: 'x' });
	assert.ok(cache.store.has('gql'), 'another page changed');
	await new Items('pages').updateMany([5], { title: 'x' });
	assert.ok(!cache.store.has('gql'));
});

test('skip reason: "Only … changed" only when Skip Fields kept the change', async () => {
	const { skipReason } = await import('./targeted');
	const touch = { collection: 'pages', action: 'update' as const, fields: ['title', 'body'], keys: [] };
	assert.equal(skipReason(touch as any, { ...DEFAULT_RULE, update: false }), "Changed in pages (rule: don't clear on update)");
	assert.equal(skipReason({ ...touch, fields: ['views_count'] } as any, { ...DEFAULT_RULE, skipFields: ['views_count'] }), 'Only views_count changed in pages');
});
