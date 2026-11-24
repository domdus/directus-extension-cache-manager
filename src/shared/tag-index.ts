import { ExpiryQueue } from './expiry-queue';

type Entry = { tags: string[]; expires: number; bytes: number };

/**
 * Which cache keys depend on which collection. Lives in the Directus process (one process per cache store).
 * Expired keys are found through an expiry queue and the bytes per collection are kept as running totals, so neither
 * the cleanup nor the statistics have to go through every key.
 */
export class TagIndex {
	private byTag = new Map<string, Set<string>>();
	private byKey = new Map<string, Entry>();
	private bytesByTag = new Map<string, number>();
	private expiry = new ExpiryQueue();

	/** Copies an index made by an older version of the extension (kept on globalThis across a reload). */
	static from(old: unknown): TagIndex {
		const index = new TagIndex();
		const entries = (old as { byKey?: Map<string, Partial<Entry>> } | null)?.byKey;
		if (entries instanceof Map) {
			for (const [key, entry] of entries) {
				if (Array.isArray(entry?.tags)) index.add(key, entry.tags, Number(entry.expires) || 0, Number(entry.bytes) || 0);
			}
		}
		return index;
	}

	get size(): number {
		return this.byKey.size;
	}

	/** `bytes`: about how much the answer takes in the store (for the UI). */
	add(key: string, tags: Iterable<string>, expires: number, bytes = 0) {
		this.remove(key);
		const list = [...new Set(tags)];
		this.byKey.set(key, { tags: list, expires, bytes });
		for (const tag of list) {
			let keys = this.byTag.get(tag);
			if (!keys) this.byTag.set(tag, (keys = new Set()));
			keys.add(key);
			this.bytesByTag.set(tag, (this.bytesByTag.get(tag) ?? 0) + bytes);
		}
		this.expiry.add(key, expires);
	}

	/** The tags of a cached answer; null when it isn't indexed. */
	tagsOf(key: string): string[] | null {
		return this.byKey.get(key)?.tags ?? null;
	}

	/** Adds to the size of an answer (its small `__expires_at` entry, stored separately). */
	addBytes(key: string, bytes: number) {
		const entry = this.byKey.get(key);
		if (!entry || !bytes) return;
		entry.bytes += bytes;
		for (const tag of entry.tags) this.bytesByTag.set(tag, (this.bytesByTag.get(tag) ?? 0) + bytes);
	}

	remove(key: string) {
		const entry = this.byKey.get(key);
		if (!entry) return;
		this.byKey.delete(key);
		this.expiry.remove(key);
		for (const tag of entry.tags) {
			const keys = this.byTag.get(tag);
			keys?.delete(key);
			if (keys && !keys.size) {
				this.byTag.delete(tag);
				this.bytesByTag.delete(tag);
			} else {
				this.bytesByTag.set(tag, (this.bytesByTag.get(tag) ?? 0) - entry.bytes);
			}
		}
	}

	/** Removes and returns every key tagged with one of these tags. */
	take(tags: Iterable<string>): string[] {
		const keys = new Set<string>();
		for (const tag of tags) for (const key of this.byTag.get(tag) ?? []) keys.add(key);
		for (const key of keys) this.remove(key);
		return [...keys];
	}

	/** Drops expired entries (the store removed or will ignore them). Only looks at keys whose minute is over. */
	prune(now: number): number {
		let removed = 0;
		for (const key of this.expiry.takeDue(now)) {
			const entry = this.byKey.get(key);
			if (!entry) continue;
			if (entry.expires <= now) {
				this.remove(key);
				removed++;
			} else {
				this.expiry.add(key, entry.expires);
			}
		}
		return removed;
	}

	clear() {
		this.byTag.clear();
		this.byKey.clear();
		this.bytesByTag.clear();
		this.expiry.clear();
	}

	/** Number of cached answers per collection (for the UI). */
	counts(): Record<string, number> {
		return Object.fromEntries([...this.byTag].map(([tag, keys]) => [tag, keys.size]));
	}

	/** About how much the answers of each collection take in the store. An answer using two collections counts for both. */
	bytes(): Record<string, number> {
		return Object.fromEntries(this.bytesByTag);
	}
}
