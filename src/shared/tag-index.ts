/** Which cache keys depend on which collection. Lives in the Directus process (one process per cache store). */
export class TagIndex {
	private byTag = new Map<string, Set<string>>();
	private byKey = new Map<string, { tags: string[]; expires: number; bytes: number }>();

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
		}
	}

	remove(key: string) {
		const entry = this.byKey.get(key);
		if (!entry) return;
		this.byKey.delete(key);
		for (const tag of entry.tags) {
			const keys = this.byTag.get(tag);
			keys?.delete(key);
			if (keys && !keys.size) this.byTag.delete(tag);
		}
	}

	/** Removes and returns every key tagged with one of these tags. */
	take(tags: Iterable<string>): string[] {
		const keys = new Set<string>();
		for (const tag of tags) for (const key of this.byTag.get(tag) ?? []) keys.add(key);
		for (const key of keys) this.remove(key);
		return [...keys];
	}

	/** Drops expired entries (the store removed or will ignore them). */
	prune(now: number): number {
		let removed = 0;
		for (const [key, entry] of this.byKey) {
			if (entry.expires <= now) {
				this.remove(key);
				removed++;
			}
		}
		return removed;
	}

	clear() {
		this.byTag.clear();
		this.byKey.clear();
	}

	/** Number of cached answers per collection (for the UI). */
	counts(): Record<string, number> {
		return Object.fromEntries([...this.byTag].map(([tag, keys]) => [tag, keys.size]));
	}

	/**
	 * About how much the answers of each collection take in the store. `measure`: the real size of a key in the store
	 * (null: not there, use the size noted in set()). An answer using two collections counts for both.
	 */
	bytes(measure?: (key: string) => number | null): Record<string, number> {
		const result: Record<string, number> = {};
		for (const [key, { tags, bytes }] of this.byKey) {
			// bytes is missing on entries added by an older version of the extension (before a reload).
			const size = measure?.(key) ?? bytes ?? 0;
			for (const tag of tags) result[tag] = (result[tag] ?? 0) + size;
		}
		return result;
	}
}
