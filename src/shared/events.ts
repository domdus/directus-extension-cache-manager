/** A clear event as the status endpoint sends it (see ClearEvent in api/targeted.ts). */
export type EventLike = {
	at: string;
	kind: 'full' | 'targeted' | 'skipped';
	collection: string | null;
	action: string | null;
	removed: number;
	reason: string;
};

export type GroupedEvent = EventLike & { count: number };

/**
 * Merges events that follow each other with the same result and reason in the same second (a Flow creating 12 items,
 * one save that clears several times) into one row with a count. Keeps the order (newest first) and returns at most
 * `max` rows.
 */
export function groupEvents(events: EventLike[], max = 50): GroupedEvent[] {
	const rows: GroupedEvent[] = [];
	for (const event of events) {
		const last = rows[rows.length - 1];
		if (last && last.kind === event.kind && last.reason === event.reason && last.at.slice(0, 19) === event.at.slice(0, 19)) {
			last.count++;
			last.removed += event.removed;
			continue;
		}
		if (rows.length >= max) break;
		rows.push({ ...event, count: 1 });
	}
	return rows;
}
