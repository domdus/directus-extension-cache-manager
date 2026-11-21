const MINUTE = 60_000;

/**
 * Keys by the minute they expire in, so expired keys can be found without looking at the others. Adding, moving and
 * removing a key is O(1); taking the due keys only touches the minutes that are over (plus one pass over the minute
 * buckets, at most one per minute of the longest lifetime).
 */
export class ExpiryQueue {
	private byMinute = new Map<number, Set<string>>();
	private minuteOf = new Map<string, number>();

	get size(): number {
		return this.minuteOf.size;
	}

	has(key: string): boolean {
		return this.minuteOf.has(key);
	}

	/** Puts the key into the bucket of its expiry minute (moves it when it was queued for another minute). */
	add(key: string, expires: number) {
		// Rounded up: everything in bucket m expires at or before m * MINUTE.
		const minute = Math.ceil(expires / MINUTE);
		const old = this.minuteOf.get(key);
		if (old === minute) return;
		if (old !== undefined) this.unlink(key, old);
		this.minuteOf.set(key, minute);
		let keys = this.byMinute.get(minute);
		if (!keys) this.byMinute.set(minute, (keys = new Set()));
		keys.add(key);
	}

	remove(key: string) {
		const minute = this.minuteOf.get(key);
		if (minute === undefined) return;
		this.minuteOf.delete(key);
		this.unlink(key, minute);
	}

	/** Removes and returns the keys whose minute is over. The caller checks each one (it may have been stored again). */
	takeDue(now: number): string[] {
		const current = Math.floor(now / MINUTE);
		const due: string[] = [];
		for (const [minute, keys] of this.byMinute) {
			if (minute > current) continue;
			for (const key of keys) {
				due.push(key);
				this.minuteOf.delete(key);
			}
			this.byMinute.delete(minute);
		}
		return due;
	}

	clear() {
		this.byMinute.clear();
		this.minuteOf.clear();
	}

	private unlink(key: string, minute: number) {
		const keys = this.byMinute.get(minute);
		keys?.delete(key);
		if (keys && !keys.size) this.byMinute.delete(minute);
	}
}

/** Lets Directus answer other requests between two chunks of work. */
export function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
