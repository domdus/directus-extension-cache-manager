import { yieldToEventLoop } from '../shared/expiry-queue';
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

/**
 * Characters Keyv adds around a stored value: the JSON wrapper {"value":"…","expires":1234567890123}. With the key and
 * the namespace prefix this gives about the size an entry takes in the memory store.
 */
export const ENTRY_OVERHEAD = 40;

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

/** Entries per chunk of the chunked pass: about 0.5 ms of work, then Directus can answer requests again. */
export const CHUNK = 2000;

/**
 * Like measureStore, in chunks: Directus answers other requests between them, so a large store causes no noticeable
 * pause. `onLive` gets every entry that stays (key and expiry), so the caller can queue the ones it did not know yet.
 */
export async function measureStoreChunked(
	store: MapLike,
	now: number,
	sweep: boolean,
	onLive?: (key: string, expires: number | null) => void,
	chunk = CHUNK,
): Promise<{ size: StoreSize; swept: SweepResult }> {
	const size: StoreSize = { entries: 0, bytes: 0, expired: 0, expiredBytes: 0 };
	const swept: SweepResult = { entries: 0, bytes: 0 };
	let inChunk = 0;
	// A Map iterator stays valid while entries are added or deleted between chunks.
	for (const [key, stored] of store) {
		const bytes = key.length + sizeOf(stored);
		const expires = expiresOf(stored);
		if (expires !== null && expires <= now) {
			if (sweep) {
				store.delete(key);
				swept.entries++;
				swept.bytes += bytes;
			} else {
				size.expired++;
				size.expiredBytes += bytes;
				size.entries++;
				size.bytes += bytes;
			}
		} else {
			size.entries++;
			size.bytes += bytes;
			onLive?.(key, expires);
		}
		if (++inChunk >= chunk) {
			inChunk = 0;
			await yieldToEventLoop();
		}
	}
	return { size, swept };
}

/**
 * Deletes the given keys from the store when they are expired. Keys that were stored again since get their new expiry
 * through `requeue`. In chunks, like measureStoreChunked.
 */
export async function sweepKeys(
	store: MapLike,
	keys: string[],
	now: number,
	requeue: (key: string, expires: number) => void,
	chunk = CHUNK,
): Promise<SweepResult> {
	const swept: SweepResult = { entries: 0, bytes: 0 };
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!;
		const stored = store.get(key);
		if (stored !== undefined) {
			const expires = expiresOf(stored);
			if (expires !== null && expires <= now) {
				swept.entries++;
				swept.bytes += key.length + sizeOf(stored);
				store.delete(key);
			} else if (expires !== null) {
				requeue(key, expires);
			}
		}
		if ((i + 1) % chunk === 0) await yieldToEventLoop();
	}
	return swept;
}
