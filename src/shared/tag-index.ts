/** Which cache keys depend on which collection. Lives in the Directus process (one process per cache store). */
export class TagIndex {
	private byTag = new Map<string, Set<string>>();
	private byKey = new Map<string, { tags: string[]; expires: number }>();

	get size(): number {
		return this.byKey.size;
	}

	add(key: string, tags: Iterable<string>, expires: number) {
		this.remove(key);
		const list = [...new Set(tags)];
		this.byKey.set(key, { tags: list, expires });
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
}
