import { AsyncLocalStorage } from 'node:async_hooks';
import { ANY, collectionOfItemTag, collectionOfPath, filterDependencies, itemsOfPath, itemTag, queryDependencies, type SchemaLike } from '../shared/dependencies';
import { parseDuration } from '../shared/duration';
import { DEFAULT_RULE, DEFAULT_RULES, isTargetable, neverClears, ruleClears, ruleFor, ttlFor, type RulesConfig, type WriteAction } from '../shared/rules';
import { TagIndex } from '../shared/tag-index';
import { ExpiryQueue } from '../shared/expiry-queue';
import { redisOf, SharedIndex } from './shared-index';
import { LOG_PREFIX } from '../shared/constants';
import { graphqlScope, tracksAllReads, type GraphqlScope } from '../shared/graphql';
import { ENTRY_OVERHEAD, measureStoreChunked, memoryStoreOf, storedSizeOf, storeKeyOf, sweepKeys, type StoreSize, type SweepResult } from './store-size';

/**
 * Granular Cache: rules per collection and targeted clearing, hooked into Directus at runtime (no core patch):
 *
 * - The response cache is one Keyv instance shared by all ItemsServices. Its `clear()` is wrapped: when a write
 *   asks to clear, the rules decide whether it clears at all, and in targeted mode only the answers that use the
 *   written collections are deleted. Clears outside an item write (schema, permissions, settings, manual) still
 *   clear everything.
 * - ItemsService write methods are wrapped to know which collection, action and fields a write has, including the
 *   nested writes it makes (those are often told not to clear because the parent clears everything).
 * - A request middleware (after Directus' cache check) records which collections the answer depends on, so the
 *   wrapped `set()` can index the cache key, and sets a per-collection lifetime through res.locals.cacheTTL.
 *
 * Everything lives on globalThis so the patches are applied once per process, also when the extension reloads.
 */

type Logger = { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
type KeyvLike = {
	clear: () => Promise<void>;
	set: (key: string, value: unknown, ttl?: number) => Promise<unknown>;
	delete: (key: string | string[]) => Promise<unknown>;
};

/** `keys`: the items a write changes; [] for new items only; null when unknown (then all of the collection's items). */
type Touch = { collection: string; action: WriteAction; fields: string[]; keys: string[] | null };
type WriteContext = Touch & { parent: WriteContext | null; touched: Touch[]; done: boolean };
/**
 * `start`: the clear counter when the request began (see Runtime.seq).
 * `ttl`: the answer's own lifetime, when it differs from CACHE_TTL. Directus 11.10+ also reads it from
 * res.locals.cacheTTL; older versions only pass CACHE_TTL to set(), so set() applies it itself.
 */
type RequestContext = { deps: Set<string>; start: number; ttl?: number | null; graphql?: GraphqlRequest };
/**
 * A GraphQL request: its dependencies are collected from the ItemsService reads it makes (`deps` starts empty).
 * `settled`: the root fields were checked when the response was stored (see settleGraphql).
 */
type GraphqlRequest = { res: any; schema: SchemaLike; admin: boolean; scope: GraphqlScope; settled: boolean };

export type ClearEvent = {
	at: string;
	kind: 'full' | 'targeted' | 'skipped';
	collection: string | null;
	action: WriteAction | null;
	/** Cached answers deleted (targeted only). */
	removed: number;
	reason: string;
};

/** One hour of history. `entries`/`bytes`: the largest store size measured in that hour (memory store only). */
export type HistoryBucket = {
	hour: string;
	full: number;
	targeted: number;
	skipped: number;
	entries: number | null;
	bytes: number | null;
};

export type RuntimeStatus = {
	installed: boolean;
	problems: string[];
	store: string;
	cacheEnabled: boolean;
	autoPurge: boolean;
	targetedActive: boolean;
	/** true: the index is in Redis and shared by all Directus servers. */
	shared: boolean;
	/** Cached responses this process indexed; -1 with the shared index (counted per collection only). */
	indexed: number;
	indexedByCollection: Record<string, number>;
	since: string;
	/** fullMinutes: minutes with at least one whole-cache clear (counted like Analysis; one save can clear several times). */
	counts: { full: number; targeted: number; skipped: number; removed: number; fullMinutes: number };
	recent: ClearEvent[];
	/** null: the store can't be measured (Redis) or the cache is off. */
	size: StoreSize | null;
	/** Expired entries the extension deleted from the memory store since Directus started. */
	swept: SweepResult;
	bytesByCollection: Record<string, number>;
	/** The last 24 hours, oldest first. */
	history: HistoryBucket[];
	/** Items written per collection since this process started, counted live (with or without activity tracking). */
	liveWrites: Record<string, number>;
};

type Runtime = {
	config: RulesConfig;
	cache: KeyvLike | null;
	originals: { clear: KeyvLike['clear']; set: KeyvLike['set'] } | null;
	patchedMethods: boolean;
	/** The request middleware is only added at Directus start (init 'middlewares.after'), not on an extension reload. */
	middlewareRegistered: boolean;
	index: TagIndex;
	writeContext: AsyncLocalStorage<WriteContext>;
	requestContext: AsyncLocalStorage<RequestContext>;
	permissionDeps: Promise<Map<string, Set<string>>> | null;
	problems: string[];
	since: string;
	counts: RuntimeStatus['counts'];
	lastFullMinute: number;
	recent: ClearEvent[];
	swept: SweepResult;
	history: HistoryBucket[];
	liveWrites: Map<string, number>;
	/**
	 * With a Redis cache: the index and the clear counters live in Redis, so every Directus server sees what the others
	 * stored (horizontal scaling). null with the memory store, where each process has its own cache anyway.
	 */
	shared: SharedIndex | null;
	/** Cached responses per collection from the shared index, refreshed for Statistics. */
	sharedCounts: Record<string, number>;
	/** Store keys (with namespace) by the minute they expire: the sweep only looks at the due ones. */
	expiry: ExpiryQueue;
	/** Last chunked measurement of the memory store, and when it ran. Statistics shows it instead of scanning. */
	lastSize: StoreSize | null;
	measuredAt: number;
	measuring: Promise<void> | null;
	pruneTimer: ReturnType<typeof setInterval> | null;
	/**
	 * Clear counter. An answer read before a write but stored after it would be stale until it expires (Directus core
	 * has the same race). Each clear bumps the counter and notes it per collection; set() drops an answer when one of
	 * its collections (or the whole cache) was cleared after its request began.
	 */
	seq: number;
	fullClearedAt: number;
	anyClearedAt: number;
	clearedAt: Map<string, number>;
	/**
	 * Clear counter per item tag (`pages#5`), oldest first, at most MAX_ITEM_MARKS. Older marks are dropped; a request
	 * that began before the newest dropped mark counts as stale (it can't tell any more).
	 */
	itemClearedAt: Map<string, number>;
	itemMarksDroppedAt: number;
	/** Services whose next read is a readOne (GraphQL `_by_id`): that read depends on its item only. */
	singleReads: WeakMap<object, string[]>;
	/** Set on install; patched functions call through these so a reloaded extension uses its newest code. */
	handlers: {
		clear: (cache: KeyvLike) => Promise<void>;
		set: (cache: KeyvLike, key: string, value: unknown, ttl?: number) => Promise<unknown>;
		tick: () => Promise<void>;
		/** Optional: handlers of an older version (extension reload) lack it until the next install. */
		read?: (service: any, query: unknown) => Promise<void>;
	} | null;
	env: Record<string, unknown>;
	database: any;
	logger: Logger | null;
};

const KEY = Symbol.for('directus-extension-cache-manager.targeted');
/**
 * Records Directus writes inside every item write (activity, revisions). They are cleared along with a real clear,
 * but never cause one: otherwise every write, even one a rule keeps, would clear.
 */
const BOOKKEEPING = new Set(['directus_activity', 'directus_revisions']);
/** Kept events; Statistics groups identical ones in the same second and shows up to 50 rows. */
const MAX_RECENT = 200;
const HISTORY_HOURS = 24;
const HOUR = 3_600_000;
const DELETE_CHUNK = 500;
const MAX_ITEM_MARKS = 20_000;

export const WRITE_METHODS: Record<string, WriteAction> = {
	createOne: 'create',
	createMany: 'create',
	updateBatch: 'update',
	updateMany: 'update',
	upsertMany: 'upsert',
	deleteMany: 'delete',
};

export function runtime(): Runtime {
	const holder = globalThis as unknown as Record<symbol, Runtime | undefined>;
	const fresh = freshRuntime();
	const rt = (holder[KEY] ??= fresh);
	// An extension reload keeps the runtime of the older version (it lives on globalThis): add the fields it lacks.
	if (rt !== fresh) {
		for (const [field, value] of Object.entries(fresh)) if ((rt as any)[field] === undefined) (rt as any)[field] = value;
		// Objects made by the older code: copy the index into this version's class; the queue refills at the next measurement.
		if (!(rt.index instanceof TagIndex)) rt.index = TagIndex.from(rt.index);
		if (!(rt.expiry instanceof ExpiryQueue)) rt.expiry = new ExpiryQueue();
	}
	return rt;
}

function freshRuntime(): Runtime {
	return {
		config: { ...DEFAULT_RULES, collections: {} },
		cache: null,
		originals: null,
		patchedMethods: false,
		middlewareRegistered: false,
		index: new TagIndex(),
		writeContext: new AsyncLocalStorage<WriteContext>(),
		requestContext: new AsyncLocalStorage<RequestContext>(),
		permissionDeps: null,
		problems: [],
		since: new Date().toISOString(),
		counts: { full: 0, targeted: 0, skipped: 0, removed: 0, fullMinutes: 0 },
		lastFullMinute: -1,
		recent: [],
		swept: { entries: 0, bytes: 0 },
		history: [],
		liveWrites: new Map(),
		expiry: new ExpiryQueue(),
		shared: null,
		sharedCounts: {},
		lastSize: null,
		measuredAt: 0,
		measuring: null,
		pruneTimer: null,
		seq: 0,
		fullClearedAt: 0,
		anyClearedAt: 0,
		clearedAt: new Map(),
		itemClearedAt: new Map(),
		itemMarksDroppedAt: 0,
		singleReads: new WeakMap(),
		handlers: null,
		env: {},
		database: null,
		logger: null,
	};
}

function globalTtlMs(env: Record<string, unknown>): number {
	return parseDuration(env['CACHE_TTL']) ?? 5 * 60_000;
}

/** The history bucket of the current hour (created on demand, older than 24 hours dropped). */
export function currentBucket(rt: Runtime, now = Date.now()): HistoryBucket {
	const hour = new Date(Math.floor(now / HOUR) * HOUR).toISOString();
	let bucket = rt.history[rt.history.length - 1];
	if (bucket?.hour !== hour) {
		bucket = { hour, full: 0, targeted: 0, skipped: 0, entries: null, bytes: null };
		rt.history.push(bucket);
		if (rt.history.length > HISTORY_HOURS) rt.history.splice(0, rt.history.length - HISTORY_HOURS);
	}
	return bucket;
}

function record(rt: Runtime, event: Omit<ClearEvent, 'at'>) {
	try {
		currentBucket(rt)[event.kind]++;
	} catch {
		// Statistics must never break a clear (and with it the write that caused it).
	}
	rt.counts[event.kind]++;
	rt.counts.removed += event.removed;
	if (event.kind === 'full') {
		const minute = Math.floor(Date.now() / 60_000);
		if (minute !== rt.lastFullMinute) {
			rt.lastFullMinute = minute;
			// ?? 0: counts kept from an older version (reload) lack the field.
			rt.counts.fullMinutes = (rt.counts.fullMinutes ?? 0) + 1;
		}
	}
	rt.recent.unshift({ at: new Date().toISOString(), ...event });
	if (rt.recent.length > MAX_RECENT) rt.recent.length = MAX_RECENT;
}

/** Fields a write sends, from the method's arguments. */
export function fieldsOf(method: string, args: unknown[], primaryKey: string | undefined): string[] {
	const keysOf = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []);
	let fields: string[] = [];
	if (method === 'createOne') fields = keysOf(args[0]);
	else if (method === 'updateMany') fields = keysOf(args[1]);
	else if (method === 'createMany' || method === 'updateBatch' || method === 'upsertMany') {
		fields = Array.isArray(args[0]) ? [...new Set((args[0] as unknown[]).flatMap(keysOf))] : [];
		// The primary key in a batch only says which item to change.
		if (method !== 'createMany' && primaryKey) fields = fields.filter((field) => field !== primaryKey);
	}
	return fields;
}

/**
 * Items one write call adds to the live count, like the activity log counts them (one entry per item). Only the inner
 * methods count: createMany, updateBatch and upsertMany call createOne and updateMany per item.
 */
export function writtenItems(method: string, keys: string[] | null): number {
	if (method === 'createOne') return 1;
	if (method === 'updateMany' || method === 'deleteMany') return keys?.length || 1;
	return 0;
}

/** Items a write changes, from the method's arguments: [] when it only creates, null when it can't tell. */
export function keysOf(method: string, args: unknown[], primaryKey: string | undefined): string[] | null {
	const list = (value: unknown) => (Array.isArray(value) ? value : [value]).filter((key) => key !== undefined && key !== null).map(String);
	if (method === 'createOne' || method === 'createMany') return [];
	if (method === 'updateMany' || method === 'deleteMany') return Array.isArray(args[0]) ? list(args[0]) : null;
	if ((method === 'updateBatch' || method === 'upsertMany') && Array.isArray(args[0]) && primaryKey) {
		const keys = (args[0] as unknown[]).map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[primaryKey] : undefined));
		// upsert: an entry without a key is a new item; update: one without a key can't be told.
		if (method === 'updateBatch' && keys.some((key) => key === undefined || key === null)) return null;
		return list(keys);
	}
	return null;
}

/** Wraps the ItemsService write methods once per process. */
export function patchItemsService(ItemsService: any, rt = runtime()): string[] {
	const missing: string[] = [];
	const proto = ItemsService?.prototype;
	if (!proto) return ['ItemsService not found'];
	for (const [method, action] of Object.entries(WRITE_METHODS)) {
		const original = proto[method];
		if (typeof original !== 'function') {
			missing.push(`ItemsService.${method} not found`);
			continue;
		}
		if (original.__cacheManager) continue;
		const wrapped = function (this: any, ...args: unknown[]) {
			const primaryKey = this?.schema?.collections?.[this.collection]?.primary;
			const parent = rt.writeContext.getStore() ?? null;
			const ctx: WriteContext = {
				collection: this.collection,
				action,
				fields: fieldsOf(method, args, primaryKey),
				keys: keysOf(method, args, primaryKey),
				parent: parent && !parent.done ? parent : null,
				touched: [],
				done: false,
			};
			// Tell every open parent write about this nested write: the parent's clear has to cover it.
			for (let up = ctx.parent; up; up = up.parent) up.touched.push({ collection: ctx.collection, action: ctx.action, fields: ctx.fields, keys: ctx.keys });
			return rt.writeContext.run(ctx, async () => {
				try {
					const result = await original.apply(this, args);
					const items = writtenItems(method, ctx.keys);
					if (items) rt.liveWrites.set(ctx.collection, (rt.liveWrites.get(ctx.collection) ?? 0) + items);
					return result;
				} finally {
					ctx.done = true;
				}
			});
		};
		(wrapped as any).__cacheManager = true;
		(wrapped as any).__original = original;
		proto[method] = wrapped;
	}
	rt.patchedMethods = missing.length === 0;
	patchReads(proto, rt);
	return missing;
}

/**
 * Wraps ItemsService.readByQuery (readOne, readMany and readSingleton use it too) so a GraphQL request learns which
 * collections its response reads. Outside a GraphQL request it only passes through. Without it GraphQL responses
 * count as "uses everything", as before, so a missing method is not a problem.
 */
function patchReads(proto: any, rt: Runtime) {
	const readOne = proto.readOne;
	if (typeof readOne === 'function' && !readOne.__cacheManager) {
		const wrappedOne = function (this: any, key: unknown, ...rest: unknown[]) {
			if (rt.requestContext.getStore()?.graphql && rt.config.items && rt.config.targeted && this) rt.singleReads.set(this, [String(key)]);
			return readOne.call(this, key, ...rest);
		};
		(wrappedOne as any).__cacheManager = true;
		(wrappedOne as any).__original = readOne;
		proto.readOne = wrappedOne;
	}
	const original = proto.readByQuery;
	if (typeof original !== 'function' || original.__cacheManager) return;
	const wrapped = async function (this: any, ...args: unknown[]) {
		const request = rt.requestContext.getStore();
		if (request?.graphql && rt.handlers?.read) {
			try {
				await rt.handlers.read(this, args[0]);
			} catch (error) {
				request.deps.add(ANY);
				rt.logger?.warn(error, `${LOG_PREFIX} could not work out what a GraphQL read depends on; the response is cleared on every change`);
			}
		}
		return original.apply(this, args);
	};
	(wrapped as any).__cacheManager = true;
	(wrapped as any).__original = original;
	proto.readByQuery = wrapped;
}

/** Adds what one ItemsService read inside a GraphQL request depends on, and keeps the response's lifetime up to date. */
export async function trackRead(rt: Runtime, service: any, query: unknown) {
	const request = rt.requestContext.getStore();
	const graphql = request?.graphql;
	if (!request || !graphql) return;
	const schema: SchemaLike = service?.schema ?? graphql.schema;
	const collection = service?.collection;
	if (typeof collection !== 'string' || !schema?.collections?.[collection]) {
		request.deps.add(ANY);
		return;
	}
	const keys = service ? rt.singleReads.get(service) : undefined;
	if (keys) {
		rt.singleReads.delete(service);
		const items = await itemDependencies(rt, schema, collection, { sanitizedQuery: query, accountability: { admin: graphql.admin } }, keys);
		if (items) {
			for (const dep of items) request.deps.add(dep);
			applyRequestTtl(rt, request, graphql.res);
			return;
		}
	}
	const deps = queryDependencies(schema, collection, query as any);
	if (!graphql.admin) await addPermissionDeps(rt, schema, deps);
	for (const dep of deps) request.deps.add(dep);
	applyRequestTtl(rt, request, graphql.res);
}

/** The lifetime of a response from its dependencies; res.locals.cacheTTL also sets the Cache-Control header. */
function applyRequestTtl(rt: Runtime, request: RequestContext, res: any) {
	const global = globalTtlMs(rt.env);
	const collections = new Set([...request.deps].map((dep) => collectionOfItemTag(dep) ?? dep));
	const ttl = ttlFor(rt.config, collections, global);
	request.ttl = ttl === global ? null : ttl;
	if (request.ttl !== null && res?.locals) res.locals.cacheTTL = request.ttl;
}

/**
 * Before a GraphQL response is stored: only when every root field is a plain collection read did the read tracking see
 * everything. Otherwise (server_info, users_me, collections …) the response counts as "uses everything".
 */
export function settleGraphql(request: RequestContext) {
	const graphql = request.graphql;
	if (!graphql || graphql.settled) return;
	graphql.settled = true;
	const params = graphql.res?.locals?.graphqlParams;
	const known = (collection: string) => !!graphql.schema?.collections?.[collection];
	if (!params || !tracksAllReads(params.document, params.operationName, graphql.scope, known)) request.deps.add(ANY);
}

/** Wraps clear() and set() of Directus' response cache once per process. */
export function patchCache(cache: KeyvLike, rt = runtime()) {
	if ((cache as any).__cacheManager) return;
	const clear = cache.clear;
	const set = cache.set;
	rt.originals = { clear, set };
	cache.clear = function (this: KeyvLike) {
		return rt.handlers ? rt.handlers.clear(this) : clear.call(this);
	};
	cache.set = function (this: KeyvLike, key: string, value: unknown, ttl?: number) {
		return rt.handlers ? rt.handlers.set(this, key, value, ttl) : set.call(this, key, value, ttl);
	};
	(cache as any).__cacheManager = true;
	rt.cache = cache;
}

async function fullClear(rt: Runtime, cache: KeyvLike, event: Omit<ClearEvent, 'at' | 'kind' | 'removed'>) {
	await rt.originals!.clear.call(cache);
	rt.seq++;
	rt.fullClearedAt = rt.anyClearedAt = rt.seq;
	rt.clearedAt.clear();
	rt.itemClearedAt.clear();
	rt.itemMarksDroppedAt = 0;
	rt.index.clear();
	rt.expiry.clear();
	rt.permissionDeps = null;
	if (rt.shared) {
		await sharedStep(rt, 'mark the full clear', async () => {
			await rt.shared!.markCleared('full');
			await rt.shared!.clearAll();
		});
	}
	record(rt, { kind: 'full', removed: 0, ...event });
}

async function deleteKeys(cache: KeyvLike, keys: string[]) {
	for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
		const chunk = keys.slice(i, i + DELETE_CHUNK);
		await cache.delete([...chunk, ...chunk.map((key) => `${key}__expires_at`)]);
	}
}

function ignoreList(env: Record<string, unknown>): string[] {
	const value = env['CACHE_AUTO_PURGE_IGNORE_LIST'];
	return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',').map((entry) => entry.trim()) : [];
}

/** What a clear() call does. Exported for tests. */
export async function handleClear(rt: Runtime, cache: KeyvLike) {
	const ctx = rt.writeContext.getStore();
	if (!ctx || ctx.done) {
		return fullClear(rt, cache, { collection: null, action: null, reason: 'Directus cleared the whole cache (data model, permissions, settings or a manual clear)' });
	}

	// The write itself plus the nested writes it made. Ignored nested collections don't count (like the root).
	const ignored = new Set(ignoreList(rt.env));
	const writes = [ctx as Touch, ...ctx.touched.filter((touch) => !ignored.has(touch.collection))];
	const bookkeeping = writes.filter((touch) => BOOKKEEPING.has(touch.collection) && touch !== ctx);
	const clearing = writes.filter((touch) => !bookkeeping.includes(touch) && ruleClears(ruleFor(rt.config, touch.collection), touch.action, touch.fields));
	if (!clearing.length) {
		record(rt, { kind: 'skipped', collection: ctx.collection, action: ctx.action, removed: 0, reason: skipReason(ctx, ruleFor(rt.config, ctx.collection)) });
		return;
	}

	if (!rt.config.targeted || !rt.middlewareRegistered) {
		return fullClear(rt, cache, { collection: ctx.collection, action: ctx.action, reason: `${verb(ctx.action)} in ${ctx.collection}` });
	}
	const wide = clearing.find((touch) => !isTargetable(touch.collection));
	if (wide) {
		return fullClear(rt, cache, { collection: ctx.collection, action: ctx.action, reason: `Change in ${wide.collection}, which can affect any response` });
	}
	const collections = [...new Set(clearing.map((touch) => touch.collection))];
	const items = rt.config.items ? itemTagsOf(clearing) : [];
	const purged = [...collections, ...bookkeeping.map((touch) => touch.collection), ...items];
	rt.seq++;
	rt.anyClearedAt = rt.seq;
	for (const collection of collections) rt.clearedAt.set(collection, rt.seq);
	for (const touch of bookkeeping) rt.clearedAt.set(touch.collection, rt.seq);
	for (const tag of items) markItem(rt, tag);
	let keys: string[];
	if (rt.shared) {
		// Every server's responses: the sets in Redis. Without them it can't know what others stored, so clear everything.
		const taken = await sharedStep(rt, 'find the cached responses to clear', async () => {
			await rt.shared!.markCleared(purged);
			return rt.shared!.take([...purged, ANY]);
		});
		if (!taken) return fullClear(rt, cache, { collection: ctx.collection, action: ctx.action, reason: `${verb(ctx.action)} in ${ctx.collection} (Redis not reachable)` });
		keys = taken;
	} else {
		keys = rt.index.take([...purged, ANY]);
	}
	await deleteKeys(cache, keys);
	const nested = collections.filter((name) => name !== ctx.collection);
	record(rt, {
		kind: 'targeted',
		collection: ctx.collection,
		action: ctx.action,
		removed: keys.length,
		reason: `${verb(ctx.action)} in ${ctx.collection}${nested.length ? ` (and ${nested.join(', ')})` : ''}`,
	});
}

/** Item tags a write clears: the changed items, or all of the collection's items when the keys are unknown. */
function itemTagsOf(writes: Touch[]): string[] {
	const tags = new Set<string>();
	for (const touch of writes) {
		if (touch.keys === null) tags.add(itemTag(touch.collection));
		else for (const key of touch.keys) tags.add(itemTag(touch.collection, key));
	}
	return [...tags];
}

function markItem(rt: Runtime, tag: string) {
	rt.itemClearedAt.delete(tag);
	rt.itemClearedAt.set(tag, rt.seq);
	if (rt.itemClearedAt.size <= MAX_ITEM_MARKS) return;
	for (const [old, seq] of rt.itemClearedAt) {
		if (rt.itemClearedAt.size <= MAX_ITEM_MARKS / 2) break;
		rt.itemClearedAt.delete(old);
		rt.itemMarksDroppedAt = Math.max(rt.itemMarksDroppedAt, seq);
	}
}

function verb(action: WriteAction): string {
	return { create: 'Created', update: 'Changed', delete: 'Deleted', upsert: 'Saved' }[action];
}

function skipReason(ctx: Touch, rule = DEFAULT_RULE): string {
	if (neverClears(rule)) return `${verb(ctx.action)} in ${ctx.collection} (rule: never clear)`;
	if (ctx.action === 'update' && ctx.fields.length) return `Only ${ctx.fields.join(', ')} changed in ${ctx.collection}`;
	return `${verb(ctx.action)} in ${ctx.collection} (rule: don't clear on ${ctx.action})`;
}

/** Was one of the answer's collections cleared after its request began? Then the answer may be older than the change. */
export function isStale(rt: Runtime, request: RequestContext): boolean {
	if (rt.fullClearedAt > request.start) return true;
	if (request.deps.has(ANY)) return rt.anyClearedAt > request.start;
	for (const dep of request.deps) {
		if (collectionOfItemTag(dep) !== null) {
			if ((rt.itemClearedAt.get(dep) ?? 0) > request.start || rt.itemMarksDroppedAt > request.start) return true;
		} else if ((rt.clearedAt.get(dep) ?? 0) > request.start) return true;
	}
	return false;
}

/** What a set() call does. Exported for tests. */
export async function handleSet(rt: Runtime, cache: KeyvLike, key: string, value: unknown, ttl?: number) {
	const request = rt.requestContext.getStore();
	if (request) settleGraphql(request);
	if (request?.ttl) ttl = request.ttl;
	const result = await rt.originals!.set.call(cache, key, value, ttl);
	if (typeof key !== 'string') return result;
	const expires = Date.now() + (ttl ?? globalTtlMs(rt.env));
	// In every mode: the sweep deletes the entry when it expires (Keyv only does that when the key is read again).
	if (memoryStoreOf(cache)) rt.expiry.add(storeKeyOf(cache, key), expires);
	if (!rt.config.targeted) return result;
	const stale = request ? (rt.shared ? await sharedStep(rt, 'check the clear counters', () => rt.shared!.isStale(request.deps, request.start)) ?? true : isStale(rt, request)) : false;
	if (stale) {
		// Read before a change, stored after it: don't keep it.
		await cache.delete(key);
		return result;
	}
	if (rt.shared) {
		if (!key.endsWith('__expires_at')) {
			const added = await sharedStep(rt, 'note the cached response', () => rt.shared!.add(key, request?.deps ?? new Set([ANY]), maxLifetimeMs(rt)).then(() => true));
			// Not noted, so a change could not find it: don't keep it.
			if (!added) await cache.delete(key);
		}
		return result;
	}
	const bytes = storeKeyOf(cache, key).length + storedSizeOf(value) + ENTRY_OVERHEAD;
	if (key.endsWith('__expires_at')) rt.index.addBytes(key.slice(0, -'__expires_at'.length), bytes);
	else rt.index.add(key, request?.deps ?? new Set([ANY]), expires, bytes);
	return result;
}

/** Collections that read permissions of a collection reach through relations (all policies, so it errs wide). */
async function permissionDependencies(rt: Runtime, schema: SchemaLike): Promise<Map<string, Set<string>>> {
	rt.permissionDeps ??= (async () => {
		const map = new Map<string, Set<string>>();
		const rows: Array<{ collection: string; permissions: unknown }> = await rt.database('directus_permissions').select('collection', 'permissions').where('action', 'read');
		for (const row of rows) {
			let filter = row.permissions;
			if (typeof filter === 'string') {
				try {
					filter = JSON.parse(filter);
				} catch {
					filter = null;
				}
			}
			const deps = filterDependencies(schema, row.collection, filter);
			if (!deps.size) continue;
			const set = map.get(row.collection) ?? new Set<string>();
			for (const dep of deps) set.add(dep);
			map.set(row.collection, set);
		}
		return map;
	})().catch((error) => {
		rt.permissionDeps = null;
		throw error;
	});
	return rt.permissionDeps;
}

/** Adds the collections that permission filters of these collections reach (an app's response depends on them too). */
async function addPermissionDeps(rt: Runtime, schema: SchemaLike, deps: Set<string>) {
	const permissions = await permissionDependencies(rt, schema);
	const queue = [...deps];
	while (queue.length) {
		for (const dep of permissions.get(queue.pop()!) ?? []) {
			if (!deps.has(dep)) {
				deps.add(dep);
				queue.push(dep);
			}
		}
	}
}

/** Dependencies and lifetime of the answer to this request. Exported for tests. */
export async function describeRequest(rt: Runtime, req: any): Promise<{ deps: Set<string>; ttl: number | null }> {
	const global = globalTtlMs(rt.env);
	const schema: SchemaLike | undefined = req.schema;
	const url = String(req.originalUrl ?? req.url ?? '');
	const pathname = url.split('?')[0] ?? '';
	const collection = schema && !pathname.startsWith('/graphql') ? collectionOfPath(pathname, (name) => !!schema.collections?.[name]) : null;
	if (!collection || !schema) return { deps: new Set([ANY]), ttl: null };

	const deps = queryDependencies(schema, collection, req.sanitizedQuery);
	if (req.accountability?.admin !== true) await addPermissionDeps(rt, schema, deps);
	const ttl = ttlFor(rt.config, deps, global);
	const single = rt.config.items && rt.config.targeted ? itemsOfPath(pathname) : null;
	if (single && single.collection === collection) {
		const items = await itemDependencies(rt, schema, collection, req, single.keys);
		if (items) return { deps: items, ttl: ttl === global ? null : ttl };
	}
	return { deps, ttl: ttl === global ? null : ttl };
}

/**
 * A single-item read: the item tags instead of the collection, so a change to other items of the collection keeps it.
 * null (use the collection) when the answer reaches its own collection through relations too, e.g. a parent page.
 */
async function itemDependencies(rt: Runtime, schema: SchemaLike, collection: string, req: any, keys: string[]): Promise<Set<string> | null> {
	const related = queryDependencies(schema, collection, req.sanitizedQuery, false);
	if (related.has(collection)) return null;
	if (req.accountability?.admin !== true) {
		const permissions = await permissionDependencies(rt, schema);
		const seeded = new Set([...related, collection]);
		await addPermissionDeps(rt, schema, seeded);
		for (const dep of seeded) if (permissions.get(dep)?.has(collection)) return null;
		seeded.delete(collection);
		for (const dep of seeded) related.add(dep);
	}
	for (const key of keys) related.add(itemTag(collection, key));
	related.add(itemTag(collection));
	return related;
}

function hasTtlRules(config: RulesConfig): boolean {
	return Object.values(config.collections).some((rule) => rule.ttl);
}

/**
 * Statistics per collection: a single-item response has the tag `pages#` (plus one per item), so `pages#` counts it
 * under pages and the per-item tags are left out.
 */
export function foldItemTags(counts: Record<string, number>): Record<string, number> {
	const folded: Record<string, number> = {};
	for (const [tag, value] of Object.entries(counts)) {
		const collection = collectionOfItemTag(tag);
		if (collection !== null && tag !== itemTag(collection)) continue;
		const name = collection ?? tag;
		folded[name] = (folded[name] ?? 0) + value;
	}
	return folded;
}

/** Express middleware for init('middlewares.after'): runs after Directus' cache check, before the routes. */
export function requestMiddleware(rt = runtime()) {
	rt.middlewareRegistered = true;
	return (req: any, res: any, next: (error?: unknown) => void) => {
		const isGraphql = String(req.originalUrl ?? '').startsWith('/graphql');
		if (!rt.cache || (!rt.config.targeted && !hasTtlRules(rt.config)) || (req.method !== 'GET' && !isGraphql)) return next();
		const startOf = rt.shared ? sharedStep(rt, 'read the clear counter', () => rt.shared!.start()).then((value) => value ?? Number.MAX_SAFE_INTEGER) : Promise.resolve(rt.seq);
		let start = rt.seq;
		const scope = isGraphql ? graphqlScope(String(req.originalUrl ?? '').split('?')[0] ?? '') : null;
		if (scope && req.schema) {
			// GraphQL: the reads it makes tell what the response uses (see trackRead); settleGraphql checks the rest.
			startOf.then(
				(value) => {
					const graphql: GraphqlRequest = { res, schema: req.schema, admin: req.accountability?.admin === true, scope, settled: false };
					rt.requestContext.run({ deps: new Set(), start: value, graphql }, () => next());
				},
				(error) => next(error),
			);
			return;
		}
		Promise.all([describeRequest(rt, req), startOf.then((value) => (start = value))]).then(
			([{ deps, ttl }]) => {
				if (ttl !== null) res.locals.cacheTTL = ttl;
				rt.requestContext.run({ deps, start, ttl }, () => next());
			},
			(error) => {
				rt.logger?.warn(error, `${LOG_PREFIX} could not work out what this response depends on; it is cleared on every change`);
				rt.requestContext.run({ deps: new Set([ANY]), start }, () => next());
			},
		);
	};
}

export type InstallContext = {
	services: any;
	database: any;
	env: Record<string, unknown>;
	getSchema: () => Promise<any>;
	logger: Logger;
};

/** Applies the patches (once per process) and the given rules. */
export async function installTargeted(ctx: InstallContext, config: RulesConfig) {
	const rt = runtime();
	rt.env = ctx.env;
	rt.database = ctx.database;
	rt.logger = ctx.logger;
	rt.handlers = {
		clear: (cache) => handleClear(rt, cache),
		set: (cache, key, value, ttl) => handleSet(rt, cache, key, value, ttl),
		tick: () => tick(rt),
		read: (service, query) => trackRead(rt, service, query),
	};
	const problems: string[] = [];
	problems.push(...patchItemsService(ctx.services?.ItemsService, rt));

	if (!rt.cache) {
		try {
			const schema = await ctx.getSchema();
			const probe = new ctx.services.ItemsService(Object.keys(schema.collections)[0], { schema, knex: ctx.database });
			if (probe.cache) patchCache(probe.cache, rt);
		} catch (error) {
			ctx.logger.warn(error, `${LOG_PREFIX} could not reach the Directus cache`);
		}
	}
	// With a Redis cache, the index lives in Redis so that all Directus servers share it.
	const redis = rt.cache ? redisOf(rt.cache) : null;
	const namespace = (rt.cache as { opts?: { namespace?: unknown } } | null)?.opts?.namespace;
	rt.shared = redis ? new SharedIndex(redis, `cache-manager:${typeof namespace === 'string' && namespace ? namespace : 'system-cache'}`) : null;
	// First measurement; it also queues entries stored before the extension was running (reload without restart).
	if (rt.cache) void measure(rt).catch((error) => ctx.logger.warn(error, `${LOG_PREFIX} could not measure the cache`));
	if (!rt.cache) problems.push(ctx.env['CACHE_ENABLED'] === true ? 'The Directus cache could not be reached' : 'The cache is off (CACHE_ENABLED)');
	rt.problems = problems;

	// Replaced on every install: a timer of an older version (before a reload) would run its old code.
	if (rt.pruneTimer) clearInterval(rt.pruneTimer);
	rt.pruneTimer = setInterval(() => {
		runtime()
			.handlers?.tick()
			.catch((error) => runtime().logger?.warn(error, `${LOG_PREFIX} cache cleanup failed`));
	}, 60_000);
	(rt.pruneTimer as any).unref?.();

	await applyRules(config, 'startup');
	if (problems.length) ctx.logger.warn(`${LOG_PREFIX} granular cache is limited: ${problems.join('; ')}`);
}

/** How often the chunked measurement runs on its own; Statistics can ask for one 10 seconds after the last. */
const MEASURE_EVERY = 5 * 60_000;
const MEASURE_ON_DEMAND = 10_000;

/**
 * Every minute: forget expired answers in the index, delete expired entries from the memory store (Keyv only does
 * that when the key is read again) and, every few minutes, measure the store for the statistics. Only the keys whose
 * expiry minute is over are looked at; the measurement runs in chunks. Exported for tests.
 */
export async function tick(rt: Runtime, now = Date.now()) {
	rt.index.prune(now);
	currentBucket(rt, now);
	const store = rt.cache ? memoryStoreOf(rt.cache) : null;
	if (!store) return;
	const swept = await sweepKeys(store, rt.expiry.takeDue(now), now, (key, expires) => rt.expiry.add(key, expires));
	rt.swept.entries += swept.entries;
	rt.swept.bytes += swept.bytes;
	if (now - rt.measuredAt >= MEASURE_EVERY) await measure(rt, now);
}

/**
 * Measures the memory store in chunks. Also a safety net: deletes expired entries the queue did not know (stored before
 * the extension was running) and queues the others. One measurement at a time.
 */
export function measure(rt: Runtime, now = Date.now()): Promise<void> {
	const store = rt.cache ? memoryStoreOf(rt.cache) : null;
	if (!store) return Promise.resolve();
	rt.measuring ??= (async () => {
		try {
			const { size, swept } = await measureStoreChunked(store, now, true, (key, expires) => {
				if (expires !== null && !rt.expiry.has(key)) rt.expiry.add(key, expires);
			});
			rt.swept.entries += swept.entries;
			rt.swept.bytes += swept.bytes;
			rt.lastSize = size;
			rt.measuredAt = now;
			const bucket = currentBucket(rt, now);
			bucket.entries = Math.max(bucket.entries ?? 0, size.entries);
			bucket.bytes = Math.max(bucket.bytes ?? 0, size.bytes);
		} finally {
			rt.measuring = null;
		}
	})();
	return rt.measuring;
}

/** Uses new rules. Turning targeted clearing on clears the cache once: older answers are not indexed. */
export async function applyRules(config: RulesConfig, origin: 'startup' | 'save') {
	const rt = runtime();
	const wasTargeted = rt.config.targeted;
	rt.config = targetedPossible(rt) ? config : { ...config, targeted: false };
	if (rt.config.targeted && (!wasTargeted || origin === 'startup') && rt.cache && rt.originals) {
		await fullClear(rt, rt.cache, { collection: null, action: null, reason: origin === 'startup' ? 'Directus started in Granular mode' : 'Switched to Granular mode' });
	}
	if (!rt.config.targeted) {
		rt.index.clear();
		if (rt.shared) await sharedStep(rt, 'forget the shared index', () => rt.shared!.clearAll());
	}
}

/** The longest lifetime a cached response can have: global or a rule's. The shared sets live that long. */
function maxLifetimeMs(rt: Runtime): number {
	let max = globalTtlMs(rt.env);
	for (const rule of Object.values(rt.config.collections)) {
		const ms = rule.ttl ? parseDuration(rule.ttl) : null;
		if (ms && ms > max) max = ms;
	}
	return max;
}

/** Runs a Redis step of the shared index; a failure is logged and gives undefined, so callers can fall back safely. */
async function sharedStep<T>(rt: Runtime, what: string, step: () => Promise<T>): Promise<T | undefined> {
	try {
		return await step();
	} catch (error) {
		rt.logger?.warn(error, `${LOG_PREFIX} could not ${what} in Redis`);
		return undefined;
	}
}

function targetedPossible(rt: Runtime): boolean {
	return !!rt.cache && rt.patchedMethods;
}

function toBool(value: unknown): boolean {
	return value === true || (typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()));
}

/** Shown on the pages (joined with other problems, so no final period). */
export const RESTART_PROBLEM =
	"Restart Directus once to activate Granular Cache. Until then, every change clears the whole cache and lifetimes per collection don't apply. Rules that keep the cache already work";

/** `env`: the settings object of the caller (the endpoint), so the values match the Status page. */
export function runtimeStatus(env: Record<string, unknown> = runtime().env): RuntimeStatus {
	const rt = runtime();
	const problems = [...rt.problems];
	if (!rt.handlers || !rt.middlewareRegistered) problems.unshift(RESTART_PROBLEM);
	const store = rt.cache ? memoryStoreOf(rt.cache) : null;
	// The last chunked measurement (never a scan here; see statusWithFreshSize).
	const size: StoreSize | null = store ? (rt.lastSize ?? { entries: 0, bytes: 0, expired: 0, expiredBytes: 0 }) : null;
	return {
		installed: !!rt.handlers && rt.middlewareRegistered,
		problems,
		store: String(env['CACHE_STORE'] ?? 'memory'),
		cacheEnabled: toBool(env['CACHE_ENABLED']),
		autoPurge: toBool(env['CACHE_AUTO_PURGE']),
		targetedActive: rt.config.targeted && rt.middlewareRegistered,
		shared: !!rt.shared,
		indexed: rt.shared ? -1 : rt.index.size,
		indexedByCollection: foldItemTags(rt.shared ? rt.sharedCounts : rt.index.counts()),
		since: rt.since,
		counts: { ...rt.counts, fullMinutes: rt.counts.fullMinutes ?? 0 },
		recent: [...rt.recent],
		size,
		swept: { ...rt.swept },
		bytesByCollection: foldItemTags(rt.index.bytes()),
		history: lastDay(rt),
		liveWrites: Object.fromEntries(rt.liveWrites),
	};
}

/** 24 hourly buckets ending with the current hour; hours without events are empty. */
function lastDay(rt: Runtime, now = Date.now()): HistoryBucket[] {
	currentBucket(rt, now);
	const byHour = new Map(rt.history.map((bucket) => [bucket.hour, bucket]));
	const first = Math.floor(now / HOUR) * HOUR - (HISTORY_HOURS - 1) * HOUR;
	return Array.from({ length: HISTORY_HOURS }, (_, i) => {
		const hour = new Date(first + i * HOUR).toISOString();
		return { ...(byHour.get(hour) ?? { hour, full: 0, targeted: 0, skipped: 0, entries: null, bytes: null }) };
	});
}

/**
 * runtimeStatus with a size at most 10 seconds old. The measurement runs in chunks, so waiting for it does not hold up
 * other requests.
 */
export async function statusWithFreshSize(env?: Record<string, unknown>): Promise<RuntimeStatus> {
	const rt = runtime();
	if (Date.now() - rt.measuredAt >= MEASURE_ON_DEMAND) await measure(rt).catch(() => undefined);
	if (rt.shared) rt.sharedCounts = (await sharedStep(rt, 'count the shared index', () => rt.shared!.counts())) ?? rt.sharedCounts;
	return runtimeStatus(env);
}

/** For tests: a fresh runtime. */
export function resetRuntimeForTests() {
	const holder = globalThis as unknown as Record<symbol, Runtime | undefined>;
	if (holder[KEY]?.pruneTimer) clearInterval(holder[KEY]!.pruneTimer!);
	delete holder[KEY];
}
