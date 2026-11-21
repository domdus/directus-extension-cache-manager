import { ANY } from '../shared/dependencies';

/** The part of an ioredis client this index uses (Directus' Keyv Redis store has one at `store.redis`). */
export type RedisLike = {
	multi(): RedisMulti;
	get(key: string): Promise<string | null>;
	mget(...keys: string[]): Promise<Array<string | null>>;
	smembers(key: string): Promise<string[]>;
};
type RedisMulti = {
	sadd(key: string, ...members: string[]): RedisMulti;
	pexpire(key: string, ms: number): RedisMulti;
	sunion(...keys: string[]): RedisMulti;
	del(...keys: string[]): RedisMulti;
	incr(key: string): RedisMulti;
	set(key: string, value: string): RedisMulti;
	mset(...pairs: string[]): RedisMulti;
	scard(key: string): RedisMulti;
	exec(): Promise<Array<[Error | null, unknown]> | null>;
};

/** The Redis client behind a Keyv instance that uses Directus' Redis store; null for the memory store. */
export function redisOf(cache: unknown): RedisLike | null {
	const keyv = cache as { store?: any; opts?: { store?: any } } | null;
	const store = keyv?.opts?.store ?? keyv?.store;
	const client = store?.redis ?? store?.client;
	return client && typeof client.multi === 'function' && typeof client.smembers === 'function' ? (client as RedisLike) : null;
}

function results(replies: Array<[Error | null, unknown]> | null): unknown[] {
	if (!replies) throw new Error('Redis transaction was aborted');
	return replies.map(([error, value]) => {
		if (error) throw error;
		return value;
	});
}

/**
 * Which cached responses use which collection, kept in Redis so that every Directus server sees what every other server
 * stored (horizontal scaling with a shared Redis cache). Same job as TagIndex, plus the clear counters that protect
 * against storing a response that was read before a change (Runtime.seq in memory).
 *
 * Keys, all under `cache-manager:<cache namespace>:`:
 * - `tag:<collection>`: set of cache keys whose response uses the collection (`tag:*`: responses that use everything)
 * - `tags`: set of collection names that have a `tag:` set (so a full clear needs no KEYS scan)
 * - `seq`: clear counter; `cleared:full`, `cleared:any` and `cleared:t:<collection>`: counter value of the last clear
 */
export class SharedIndex {
	constructor(
		private redis: RedisLike,
		private prefix: string,
	) {}

	private tagKey(tag: string) {
		return `${this.prefix}:tag:${tag}`;
	}

	/** The clear counter when a request begins. */
	async start(): Promise<number> {
		return Number(await this.redis.get(`${this.prefix}:seq`)) || 0;
	}

	/**
	 * Notes that the response stored under `key` uses these collections. `ttlMs` keeps the sets from outliving the
	 * longest lifetime a response can have.
	 */
	async add(key: string, tags: Iterable<string>, ttlMs: number) {
		const list = [...new Set(tags)];
		if (!list.length) return;
		const multi = this.redis.multi();
		for (const tag of list) multi.sadd(this.tagKey(tag), key).pexpire(this.tagKey(tag), Math.max(60_000, Math.ceil(ttlMs)));
		multi.sadd(`${this.prefix}:tags`, ...list);
		results(await multi.exec());
	}

	/** Removes and returns the cache keys of these collections (atomically, so no server adds to a set in between). */
	async take(tags: Iterable<string>): Promise<string[]> {
		const keys = [...new Set(tags)].map((tag) => this.tagKey(tag));
		if (!keys.length) return [];
		const [members] = results(await this.redis.multi().sunion(...keys).del(...keys).exec());
		return (members as string[]) ?? [];
	}

	/** Bumps the clear counter for these collections (and for responses that use everything), or for everything. */
	async markCleared(collections: string[] | 'full') {
		const [seq] = results(await this.redis.multi().incr(`${this.prefix}:seq`).exec());
		const value = String(seq);
		const pairs =
			collections === 'full'
				? [`${this.prefix}:cleared:full`, value, `${this.prefix}:cleared:any`, value]
				: [`${this.prefix}:cleared:any`, value, ...collections.flatMap((name) => [`${this.prefix}:cleared:t:${name}`, value])];
		results(await this.redis.multi().mset(...pairs).exec());
	}

	/** Was the whole cache, or one of these collections, cleared after the request began? Then don't keep its response. */
	async isStale(deps: Set<string>, start: number): Promise<boolean> {
		const names = [...deps].filter((dep) => dep !== ANY);
		const keys = [
			`${this.prefix}:cleared:full`,
			...(deps.has(ANY) ? [`${this.prefix}:cleared:any`] : []),
			...names.map((name) => `${this.prefix}:cleared:t:${name}`),
		];
		const values = await this.redis.mget(...keys);
		return values.some((value) => (Number(value) || 0) > start);
	}

	/** Forgets every set (the whole cache was cleared). */
	async clearAll() {
		const tags = await this.redis.smembers(`${this.prefix}:tags`);
		const multi = this.redis.multi();
		if (tags.length) multi.del(...tags.map((tag) => this.tagKey(tag)));
		multi.del(`${this.prefix}:tags`);
		results(await multi.exec());
	}

	/** Cached responses per collection, as far as the sets know (expired entries count until their set is cleared). */
	async counts(): Promise<Record<string, number>> {
		const tags = await this.redis.smembers(`${this.prefix}:tags`);
		if (!tags.length) return {};
		const multi = this.redis.multi();
		for (const tag of tags) multi.scard(this.tagKey(tag));
		const sizes = results(await multi.exec()) as number[];
		return Object.fromEntries(tags.map((tag, i) => [tag, sizes[i] ?? 0]).filter(([, size]) => (size as number) > 0));
	}
}
