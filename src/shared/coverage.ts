import type { CollectionStats } from './analysis';
import { formatWindow } from './format';

/**
 * Collections with "Activity & Revision Tracking" set to "Do not track anything" (accountability null). Their changes
 * never reach directus_activity, but still clear the cache. Only real tables (the schema has no folders) and no
 * directus_* system collections.
 */
export function unmeasuredCollections(collections: Record<string, { accountability?: unknown } | undefined>): string[] {
	return Object.entries(collections)
		.filter(([name, info]) => !name.startsWith('directus_') && info && info.accountability === null)
		.map(([name]) => name)
		.sort();
}

/** "a", "a, b", "a, b, c", "a, b, c and 2 more". */
export function nameList(names: string[], max = 3): string {
	if (names.length <= max) return names.join(', ');
	return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** Line for tile 1 when collections that still clear the cache can't be measured; null when there are none. */
export function unmeasuredLine(unmeasured: string[], ignoreList: string[]): string | null {
	const ignored = new Set(ignoreList);
	const open = unmeasured.filter((name) => !ignored.has(name));
	if (!open.length) return null;
	const count = open.length === 1 ? '1 collection' : `${open.length} collections`;
	return `Not measured: ${count} (${nameList(open)}). The real number can be higher.`;
}

export type TableRow = CollectionStats & { measured: boolean };

/**
 * Table rows: measured collections first (in analysis order), then ignored collections without changes, then the
 * collections that can't be measured.
 */
export function buildRows(stats: CollectionStats[], listed: string[], unmeasured: string[], effectiveIgnored: string[]): TableRow[] {
	const notMeasured = new Set(unmeasured);
	const ignored = new Set(effectiveIgnored);
	const measured = stats.filter((row) => !notMeasured.has(row.collection)).map((row) => ({ ...row, measured: true }));
	const shown = new Set(measured.map((row) => row.collection));
	const blank = (collection: string, isMeasured: boolean, reason: string): TableRow => ({
		collection,
		writes: 0,
		minutes: 0,
		share: 0,
		editorWrites: 0,
		ignored: ignored.has(collection),
		recommended: false,
		reason,
		savedMinutes: 0,
		measured: isMeasured,
	});
	const empty = [...new Set(listed)]
		.filter((name) => !shown.has(name) && !notMeasured.has(name))
		.sort()
		.map((name) => blank(name, true, 'No changes in this time'));
	const unknown = [...notMeasured].sort().map((name) => blank(name, false, ''));
	return [...measured, ...empty, ...unknown];
}

/** Hours of activity Directus keeps, or null when retention is off or not set. */
export function activityRetentionHours(enabled: unknown, retentionMs: number | null): number | null {
	const on = enabled === true || (typeof enabled === 'string' && ['true', '1'].includes(enabled.trim().toLowerCase()));
	if (!on || retentionMs === null || !(retentionMs > 0)) return null;
	return retentionMs / 3_600_000;
}

function retentionText(hours: number): string {
	if (hours < 1) {
		const minutes = Math.max(1, Math.round(hours * 60));
		return minutes === 1 ? '1 minute' : `${minutes} minutes`;
	}
	if (Number.isInteger(hours)) return formatWindow(hours);
	return `${Math.round(hours * 10) / 10} hours`;
}

/** Warning when the activity log keeps less than the chosen period; null otherwise. */
export function retentionWarning(retentionHours: number | null, windowHours: number): string | null {
	if (retentionHours === null || retentionHours >= windowHours) return null;
	return `Directus only keeps ${retentionText(retentionHours)} of activity. "Last ${formatWindow(windowHours)}" shows less than actually happened.`;
}
