/**
 * Size of Directus' response cache when it is kept in memory (CACHE_STORE=memory).
 *
 * Keyv keeps each entry in a plain Map as a JSON string: {"value":":base64:…","expires":1234}. It deletes an
 * expired entry only when that key is read again, so answers nobody asks for again stay in memory. The whole-cache
 * clear used to remove them; with Granular mode or the ignore list there are far fewer of those. `measureStore`
 * with `sweep` deletes them, like Keyv would on the next read.
 */

export type StoreSize = {
	/** Entries in the store (each answer has a second, small `__expires_at` entry on some versions). */
	entries: number;
	/** Characters of the stored strings, about the bytes they take (plus the overhead of the JavaScript engine). */
	bytes: number;
	/** Expired entries still in the store (0 right after a sweep). */
	expired: number;
	expiredBytes: number;
};

export type SweepResult = { entries: number; bytes: number };

type MapLike = Map<string, unknown>;

/** The Map behind a Keyv instance, if it uses the in-memory store. Keyv 5: `store`, Keyv 4: `opts.store`. */
export function memoryStoreOf(cache: unknown): MapLike | null {
	const keyv = cache as { store?: unknown; opts?: { store?: unknown } } | null;
	const store = keyv?.store ?? keyv?.opts?.store;
	return store instanceof Map ? (store as MapLike) : null;
}

/** Key of an entry in the store: Keyv prefixes it with its namespace ("namespace:key"). */
export function storeKeyOf(cache: unknown, key: string): string {
	const namespace = (cache as { opts?: { namespace?: unknown } } | null)?.opts?.namespace;
	return typeof namespace === 'string' && namespace ? `${namespace}:${key}` : key;
}

/** What an answer takes in the store: its entry plus the small `__expires_at` entry next to it. Null: not there. */
export function answerSizeIn(store: MapLike, cache: unknown, key: string): number | null {
	const main = storeKeyOf(cache, key);
	const stored = store.get(main);
	if (stored === undefined) return null;
	const expiresKey = `${main}__expires_at`;
	const expires = store.get(expiresKey);
	return main.length + sizeOf(stored) + (expires === undefined ? 0 : expiresKey.length + sizeOf(expires));
}

const EXPIRES = '"expires":';

/** Expiry time of a stored entry, read from the end of its JSON string without parsing the whole value. */
export function expiresOf(stored: unknown): number | null {
	if (typeof stored === 'string') {
		const at = stored.lastIndexOf(EXPIRES);
		if (at < 0) return null;
		const value = Number.parseInt(stored.slice(at + EXPIRES.length), 10);
		return Number.isFinite(value) ? value : null;
	}
	const expires = (stored as { expires?: unknown } | null)?.expires;
	return typeof expires === 'number' ? expires : null;
}

export function sizeOf(stored: unknown): number {
	if (typeof stored === 'string') return stored.length;
	if (stored && typeof stored === 'object') {
		const value = (stored as { value?: unknown }).value;
		if (Buffer.isBuffer(value)) return value.length;
		if (typeof value === 'string') return value.length;
	}
	try {
		return JSON.stringify(stored)?.length ?? 0;
	} catch {
		return 0;
	}
}

/** Size of a value Directus hands to set(), as it will be stored (Keyv saves buffers as base64). */
export function storedSizeOf(value: unknown): number {
	if (Buffer.isBuffer(value)) return Math.ceil(value.length / 3) * 4;
	if (typeof value === 'string') return value.length;
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

/** Counts the store. With `sweep`, expired entries are deleted and returned as `swept`. */
export function measureStore(store: MapLike, now: number, sweep: boolean): { size: StoreSize; swept: SweepResult } {
	const size: StoreSize = { entries: 0, bytes: 0, expired: 0, expiredBytes: 0 };
	const swept: SweepResult = { entries: 0, bytes: 0 };
	for (const [key, stored] of store) {
		const bytes = key.length + sizeOf(stored);
		const expires = expiresOf(stored);
		if (expires !== null && expires <= now) {
			if (sweep) {
				store.delete(key);
				swept.entries++;
				swept.bytes += bytes;
				continue;
			}
			size.expired++;
			size.expiredBytes += bytes;
		}
		size.entries++;
		size.bytes += bytes;
	}
	return { size, swept };
}
