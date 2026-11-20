import { AsyncLocalStorage } from 'node:async_hooks';
import { ANY, collectionOfPath, filterDependencies, queryDependencies, type SchemaLike } from '../shared/dependencies';
import { parseDuration } from '../shared/duration';
import { DEFAULT_RULES, isTargetable, ruleClears, ruleFor, ttlFor, type RulesConfig, type WriteAction } from '../shared/rules';
import { TagIndex } from '../shared/tag-index';
import { LOG_PREFIX } from '../shared/constants';

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

type Touch = { collection: string; action: WriteAction; fields: string[] };
type WriteContext = Touch & { parent: WriteContext | null; touched: Touch[]; done: boolean };
/**
 * `start`: the clear counter when the request began (see Runtime.seq).
 * `ttl`: the answer's own lifetime, when it differs from CACHE_TTL. Directus 11.10+ also reads it from
 * res.locals.cacheTTL; older versions only pass CACHE_TTL to set(), so set() applies it itself.
 */
type RequestContext = { deps: Set<string>; start: number; ttl?: number | null };

export type ClearEvent = {
	at: string;
	kind: 'full' | 'targeted' | 'skipped';
	collection: string | null;
	action: WriteAction | null;
	/** Cached answers deleted (targeted only). */
	removed: number;
	reason: string;
};

export type RuntimeStatus = {
	installed: boolean;
	problems: string[];
	store: string;
	cacheEnabled: boolean;
	autoPurge: boolean;
	targetedActive: boolean;
	indexed: number;
	indexedByCollection: Record<string, number>;
	since: string;
	counts: { full: number; targeted: number; skipped: number; removed: number };
	recent: ClearEvent[];
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
	recent: ClearEvent[];
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
	/** Set on install; patched functions call through these so a reloaded extension uses its newest code. */
	handlers: {
		clear: (cache: KeyvLike) => Promise<void>;
		set: (cache: KeyvLike, key: string, value: unknown, ttl?: number) => Promise<unknown>;
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
const MAX_RECENT = 50;
const DELETE_CHUNK = 500;

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
	return (holder[KEY] ??= {
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
		counts: { full: 0, targeted: 0, skipped: 0, removed: 0 },
		recent: [],
		pruneTimer: null,
		seq: 0,
		fullClearedAt: 0,
		anyClearedAt: 0,
		clearedAt: new Map(),
		handlers: null,
		env: {},
		database: null,
		logger: null,
	});
}

function globalTtlMs(env: Record<string, unknown>): number {
	return parseDuration(env['CACHE_TTL']) ?? 5 * 60_000;
}

function record(rt: Runtime, event: Omit<ClearEvent, 'at'>) {
	rt.counts[event.kind]++;
	rt.counts.removed += event.removed;
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
				parent: parent && !parent.done ? parent : null,
				touched: [],
				done: false,
			};
			// Tell every open parent write about this nested write: the parent's clear has to cover it.
			for (let up = ctx.parent; up; up = up.parent) up.touched.push({ collection: ctx.collection, action: ctx.action, fields: ctx.fields });
			return rt.writeContext.run(ctx, async () => {
				try {
					return await original.apply(this, args);
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
	return missing;
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
	rt.index.clear();
	rt.permissionDeps = null;
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
		return fullClear(rt, cache, { collection: null, action: null, reason: 'Directus cleared the whole cache (schema, permissions, settings or a manual clear)' });
	}

	// The write itself plus the nested writes it made. Ignored nested collections don't count (like the root).
	const ignored = new Set(ignoreList(rt.env));
	const writes = [ctx as Touch, ...ctx.touched.filter((touch) => !ignored.has(touch.collection))];
	const bookkeeping = writes.filter((touch) => BOOKKEEPING.has(touch.collection) && touch !== ctx);
	const clearing = writes.filter((touch) => !bookkeeping.includes(touch) && ruleClears(ruleFor(rt.config, touch.collection), touch.action, touch.fields));
	if (!clearing.length) {
		record(rt, { kind: 'skipped', collection: ctx.collection, action: ctx.action, removed: 0, reason: skipReason(ctx) });
		return;
	}

	if (!rt.config.targeted || !rt.middlewareRegistered) {
		return fullClear(rt, cache, { collection: ctx.collection, action: ctx.action, reason: `${verb(ctx.action)} in ${ctx.collection}` });
	}
	const wide = clearing.find((touch) => !isTargetable(touch.collection));
	if (wide) {
		return fullClear(rt, cache, { collection: ctx.collection, action: ctx.action, reason: `${wide.collection} can change any answer` });
	}
	const collections = [...new Set(clearing.map((touch) => touch.collection))];
	const purged = [...collections, ...bookkeeping.map((touch) => touch.collection)];
	rt.seq++;
	rt.anyClearedAt = rt.seq;
	for (const collection of purged) rt.clearedAt.set(collection, rt.seq);
	const keys = rt.index.take([...purged, ANY]);
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

function verb(action: WriteAction): string {
	return { create: 'Created', update: 'Changed', delete: 'Deleted', upsert: 'Saved' }[action];
}

function skipReason(ctx: Touch): string {
	if (ctx.action === 'update' && ctx.fields.length) return `Only ${ctx.fields.join(', ')} changed in ${ctx.collection}`;
	return `${verb(ctx.action)} in ${ctx.collection}, rule says don't clear`;
}

/** Was one of the answer's collections cleared after its request began? Then the answer may be older than the change. */
export function isStale(rt: Runtime, request: RequestContext): boolean {
	if (rt.fullClearedAt > request.start) return true;
	if (request.deps.has(ANY)) return rt.anyClearedAt > request.start;
	for (const dep of request.deps) if ((rt.clearedAt.get(dep) ?? 0) > request.start) return true;
	return false;
}

/** What a set() call does. Exported for tests. */
export async function handleSet(rt: Runtime, cache: KeyvLike, key: string, value: unknown, ttl?: number) {
	const request = rt.requestContext.getStore();
	if (request?.ttl) ttl = request.ttl;
	const result = await rt.originals!.set.call(cache, key, value, ttl);
	if (!rt.config.targeted || typeof key !== 'string') return result;
	if (request && isStale(rt, request)) {
		// Read before a change, stored after it: don't keep it.
		await cache.delete(key);
		return result;
	}
	if (!key.endsWith('__expires_at')) rt.index.add(key, request?.deps ?? new Set([ANY]), Date.now() + (ttl ?? globalTtlMs(rt.env)));
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

/** Dependencies and lifetime of the answer to this request. Exported for tests. */
export async function describeRequest(rt: Runtime, req: any): Promise<{ deps: Set<string>; ttl: number | null }> {
	const global = globalTtlMs(rt.env);
	const schema: SchemaLike | undefined = req.schema;
	const url = String(req.originalUrl ?? req.url ?? '');
	const pathname = url.split('?')[0] ?? '';
	const collection = schema && !pathname.startsWith('/graphql') ? collectionOfPath(pathname, (name) => !!schema.collections?.[name]) : null;
	if (!collection || !schema) return { deps: new Set([ANY]), ttl: null };

	const deps = queryDependencies(schema, collection, req.sanitizedQuery);
	if (req.accountability?.admin !== true) {
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
	const ttl = ttlFor(rt.config, deps, global);
	return { deps, ttl: ttl === global ? null : ttl };
}

function hasTtlRules(config: RulesConfig): boolean {
	return Object.values(config.collections).some((rule) => rule.ttl);
}

/** Express middleware for init('middlewares.after'): runs after Directus' cache check, before the routes. */
export function requestMiddleware(rt = runtime()) {
	rt.middlewareRegistered = true;
	return (req: any, res: any, next: (error?: unknown) => void) => {
		const isGraphql = String(req.originalUrl ?? '').startsWith('/graphql');
		if (!rt.cache || (!rt.config.targeted && !hasTtlRules(rt.config)) || (req.method !== 'GET' && !isGraphql)) return next();
		const start = rt.seq;
		describeRequest(rt, req).then(
			({ deps, ttl }) => {
				if (ttl !== null) res.locals.cacheTTL = ttl;
				rt.requestContext.run({ deps, start, ttl }, () => next());
			},
			(error) => {
				rt.logger?.warn(error, `${LOG_PREFIX} could not work out what this answer depends on; it is cleared on every change`);
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
	if (!rt.cache) problems.push(ctx.env['CACHE_ENABLED'] === true ? 'The Directus cache could not be reached' : 'The cache is off (CACHE_ENABLED)');
	rt.problems = problems;

	rt.pruneTimer ??= setInterval(() => rt.index.prune(Date.now()), 60_000);
	(rt.pruneTimer as any).unref?.();

	await applyRules(config, 'startup');
	if (problems.length) ctx.logger.warn(`${LOG_PREFIX} granular cache is limited: ${problems.join('; ')}`);
}

/** Uses new rules. Turning targeted clearing on clears the cache once: older answers are not indexed. */
export async function applyRules(config: RulesConfig, origin: 'startup' | 'save') {
	const rt = runtime();
	const wasTargeted = rt.config.targeted;
	rt.config = targetedPossible(rt) ? config : { ...config, targeted: false };
	if (rt.config.targeted && (!wasTargeted || origin === 'startup') && rt.cache && rt.originals) {
		await fullClear(rt, rt.cache, { collection: null, action: null, reason: 'Targeted clearing turned on: start with an empty cache' });
	}
	if (!rt.config.targeted) rt.index.clear();
}

function targetedPossible(rt: Runtime): boolean {
	return !!rt.cache && rt.patchedMethods;
}

function toBool(value: unknown): boolean {
	return value === true || (typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()));
}

export const RESTART_PROBLEM = 'Granular Cache starts with Directus. Restart Directus once after installing or updating the extension';

/** `env`: the settings object of the caller (the endpoint), so the values match the Status page. */
export function runtimeStatus(env: Record<string, unknown> = runtime().env): RuntimeStatus {
	const rt = runtime();
	const problems = [...rt.problems];
	if (!rt.handlers || !rt.middlewareRegistered) problems.unshift(RESTART_PROBLEM);
	return {
		installed: !!rt.handlers && rt.middlewareRegistered,
		problems,
		store: String(env['CACHE_STORE'] ?? 'memory'),
		cacheEnabled: toBool(env['CACHE_ENABLED']),
		autoPurge: toBool(env['CACHE_AUTO_PURGE']),
		targetedActive: rt.config.targeted && rt.middlewareRegistered,
		indexed: rt.index.size,
		indexedByCollection: rt.index.counts(),
		since: rt.since,
		counts: { ...rt.counts },
		recent: [...rt.recent],
	};
}

/** For tests: a fresh runtime. */
export function resetRuntimeForTests() {
	const holder = globalThis as unknown as Record<symbol, Runtime | undefined>;
	if (holder[KEY]?.pruneTimer) clearInterval(holder[KEY]!.pruneTimer!);
	delete holder[KEY];
}
