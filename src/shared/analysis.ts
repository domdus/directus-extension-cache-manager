import { EDITOR_SHARE_MAX, RECOMMEND_MIN_SHARE, RECOMMENDABLE_SYSTEM_COLLECTIONS } from './constants';

/** One row of the SQL aggregate: writes to a collection within one minute of the window. */
export type ActivityBucket = {
	collection: string;
	/** Minute index from the start of the window (0 … windowMinutes - 1). */
	minute: number;
	writes: number;
	/** Writes by logged-in users from the admin app (origin = PUBLIC_URL). */
	editorWrites: number;
};

export type CollectionStats = {
	collection: string;
	writes: number;
	/** Distinct minutes with at least one write. */
	minutes: number;
	/** minutes / windowMinutes. */
	share: number;
	editorWrites: number;
	ignored: boolean;
	recommended: boolean;
	/** Short reason why it is (not) recommended. */
	reason: string;
	/** How many purge minutes would disappear if this collection were ignored too (with the current list). */
	savedMinutes: number;
};

export type Analysis = {
	hours: number;
	windowMinutes: number;
	from: string;
	to: string;
	/** Whether the admin-app heuristic was available (needs an absolute PUBLIC_URL). */
	editorHeuristic: boolean;
	collections: CollectionStats[];
	/** Minute indexes per collection, so the app can compute what-if values locally. */
	minuteSets: Record<string, number[]>;
	/** Minutes in which at least one write would clear the whole cache, with the effective settings. */
	purgeMinutes: number;
	recommendedList: string[];
	/** Purge minutes with the effective list plus all recommendations. */
	recommendedPurgeMinutes: number;
	/** Purge minutes for the `candidate` list, when one was given. */
	whatIf: { list: string[]; purgeMinutes: number } | null;
};

export type MinuteSets = Map<string, Set<number>>;

type Aggregate = { writes: number; editorWrites: number; minutes: Set<number> };

/** Groups SQL buckets per collection; drops rows outside the window. */
export function aggregate(rows: ActivityBucket[], windowMinutes: number): Map<string, Aggregate> {
	const result = new Map<string, Aggregate>();
	for (const row of rows) {
		if (!row.collection || !Number.isFinite(row.minute) || row.minute < 0 || row.minute >= windowMinutes) continue;
		let entry = result.get(row.collection);
		if (!entry) result.set(row.collection, (entry = { writes: 0, editorWrites: 0, minutes: new Set() }));
		entry.writes += Number(row.writes) || 0;
		entry.editorWrites += Number(row.editorWrites) || 0;
		entry.minutes.add(row.minute);
	}
	return result;
}

/**
 * Minutes in which at least one non-ignored collection was written, i.e. minutes with a full cache purge.
 * With CACHE_AUTO_PURGE off nothing is purged on writes.
 */
export function purgeMinutes(sets: MinuteSets | Record<string, Iterable<number>>, ignoreList: Iterable<string>, autoPurge = true): number {
	if (!autoPurge) return 0;
	const ignored = new Set(ignoreList);
	const minutes = new Set<number>();
	const entries = sets instanceof Map ? [...sets] : Object.entries(sets);
	for (const [collection, set] of entries) {
		if (ignored.has(collection)) continue;
		for (const minute of set) minutes.add(minute);
	}
	return minutes.size;
}

/** System and config collections are never recommended, apart from a few log-like ones. */
export function isRecommendable(collection: string): boolean {
	return !collection.startsWith('directus_') || RECOMMENDABLE_SYSTEM_COLLECTIONS.includes(collection);
}

export function recommendation(
	stats: Pick<CollectionStats, 'collection' | 'writes' | 'minutes' | 'editorWrites' | 'ignored'>,
	windowMinutes: number,
): { recommended: boolean; reason: string } {
	const share = windowMinutes ? stats.minutes / windowMinutes : 0;
	if (stats.ignored) return { recommended: false, reason: 'Already selected' };
	if (!isRecommendable(stats.collection)) return { recommended: false, reason: 'Directus system collection' };
	if (share < RECOMMEND_MIN_SHARE) return { recommended: false, reason: `Changes less than ${perHourText(RECOMMEND_MIN_SHARE)} times per hour` };
	if (stats.writes && stats.editorWrites / stats.writes > EDITOR_SHARE_MAX) return { recommended: false, reason: 'Mostly changed by editors in the Data Studio' };
	return { recommended: true, reason: `Changes about ${perHourText(share)} times per hour` };
}

/** Share of minutes as changes per hour (5 % of minutes = 3 per hour). */
function perHourText(share: number): string {
	const rate = share * 60;
	return rate < 1 ? 'less than 1' : String(Math.round(rate));
}

export type AnalysisOptions = {
	hours: number;
	windowMinutes: number;
	from: Date;
	to: Date;
	ignoreList: string[];
	autoPurge: boolean;
	editorHeuristic: boolean;
	candidate?: string[] | null;
};

export function buildAnalysis(rows: ActivityBucket[], options: AnalysisOptions): Analysis {
	const { windowMinutes, ignoreList, autoPurge } = options;
	const grouped = aggregate(rows, windowMinutes);
	const sets: MinuteSets = new Map([...grouped].map(([collection, entry]) => [collection, entry.minutes]));
	const ignored = new Set(ignoreList);
	const current = purgeMinutes(sets, ignoreList, autoPurge);

	const collections: CollectionStats[] = [...grouped].map(([collection, entry]) => {
		const base = { collection, writes: entry.writes, minutes: entry.minutes.size, editorWrites: entry.editorWrites, ignored: ignored.has(collection) };
		const { recommended, reason } = recommendation(base, windowMinutes);
		const savedMinutes = base.ignored ? 0 : current - purgeMinutes(sets, [...ignoreList, collection], autoPurge);
		return { ...base, share: windowMinutes ? base.minutes / windowMinutes : 0, recommended, reason, savedMinutes };
	});
	collections.sort((a, b) => b.minutes - a.minutes || b.writes - a.writes || a.collection.localeCompare(b.collection));

	const recommendedList = collections.filter((entry) => entry.recommended).map((entry) => entry.collection);
	const candidate = options.candidate ?? null;

	return {
		hours: options.hours,
		windowMinutes,
		from: options.from.toISOString(),
		to: options.to.toISOString(),
		editorHeuristic: options.editorHeuristic,
		collections,
		minuteSets: Object.fromEntries([...sets].map(([collection, set]) => [collection, [...set].sort((a, b) => a - b)])),
		purgeMinutes: current,
		recommendedList,
		recommendedPurgeMinutes: purgeMinutes(sets, [...ignoreList, ...recommendedList], autoPurge),
		whatIf: candidate ? { list: candidate, purgeMinutes: purgeMinutes(sets, candidate, autoPurge) } : null,
	};
}

/** Parses `?hours=` into 1 … max, default on garbage. */
export function parseHours(value: unknown, fallback: number, max: number): number {
	const hours = Math.floor(Number(value));
	if (!Number.isFinite(hours) || hours < 1) return fallback;
	return Math.min(hours, max);
}

/** Converts raw SQL rows (minute as epoch minutes, counts as strings from pg) into window-relative buckets. */
export function toBuckets(
	rows: { collection: unknown; minute: unknown; writes: unknown; editor_writes?: unknown }[],
	startEpochMinute: number,
): ActivityBucket[] {
	return rows.map((row) => ({
		collection: String(row.collection ?? ''),
		minute: Number(row.minute) - startEpochMinute,
		writes: Number(row.writes) || 0,
		editorWrites: Number(row.editor_writes) || 0,
	}));
}
