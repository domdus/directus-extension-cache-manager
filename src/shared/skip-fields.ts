/**
 * Skip Fields suggestions: when most changes to a busy collection only touch the same few fields (a view counter,
 * a "last seen" date), a rule with those Skip Fields keeps the cache for them and still clears on real edits.
 * Based on a sample of recent update revisions.
 */

/** At most this many fields in one suggestion; more is no longer "a counter". */
export const SKIP_MAX_FIELDS = 3;
/** Suggest only when the fields cover at least this share of all changes (create, update, delete). */
export const SKIP_MIN_COVERED_SHARE = 0.5;
/** An update shape (the set of fields it changes) must make up this share of updates to be added: rare shapes are edits. */
const MIN_SIGNATURE_SHARE = 0.25;
/** Stop adding shapes once this share of updates is covered. */
const ENOUGH_COVERED = 0.8;
/** Update revisions read per collection. */
export const SKIP_SAMPLE_SIZE = 500;

/** Fields Directus fills in itself on a write; clients don't send them, so they can't be Skip Fields. */
export const AUTO_SPECIALS = ['date-updated', 'user-updated', 'date-created', 'user-created'];

export type SkipSuggestion = {
	collection: string;
	fields: string[];
	/** Share of all changes in the period that only touch these fields (estimated from the sample). */
	coveredShare: number;
	/** Sampled update revisions the estimate is based on. */
	sample: number;
};

/** Field names whose values apps may need up to date; a suggestion with them gets a warning. */
const SENSITIVE_FIELD = /stock|price|amount|quantity|qty|available|status|balance|credit|access|expire|valid|paid|total/i;

export function looksSensitiveField(field: string): boolean {
	return SENSITIVE_FIELD.test(field);
}

/** Changed fields of one revision delta, without the primary key and fields Directus fills in. */
export function changedFields(delta: unknown, exclude: ReadonlySet<string>): string[] {
	let value = delta;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.keys(value).filter((field) => !exclude.has(field));
}

/**
 * The smallest common field set (up to SKIP_MAX_FIELDS) that covers the most updates, or null when it covers too
 * little of the collection's changes.
 * @param updates changed fields per sampled update revision
 * @param updateShare share of updates among all changes of the collection in the period (0 … 1)
 */
export function suggestSkipFields(collection: string, updates: string[][], updateShare: number): SkipSuggestion | null {
	const shaped = updates.filter((fields) => fields.length > 0);
	if (!shaped.length || !(updateShare > 0)) return null;

	const signatures = new Map<string, { fields: string[]; count: number }>();
	for (const fields of shaped) {
		const sorted = [...new Set(fields)].sort();
		if (sorted.length > SKIP_MAX_FIELDS) continue;
		const key = sorted.join('\u0000');
		const entry = signatures.get(key);
		if (entry) entry.count++;
		else signatures.set(key, { fields: sorted, count: 1 });
	}

	// Greedy: add the most frequent update shapes while the union stays small, until most updates are covered.
	const chosen = new Set<string>();
	const coveredBy = (set: Set<string>) => shaped.filter((fields) => fields.every((field) => set.has(field))).length;
	for (const { fields, count } of [...signatures.values()].sort((a, b) => b.count - a.count)) {
		if (count / shaped.length < MIN_SIGNATURE_SHARE || coveredBy(chosen) / shaped.length >= ENOUGH_COVERED) break;
		const union = new Set([...chosen, ...fields]);
		if (union.size <= SKIP_MAX_FIELDS) for (const field of fields) chosen.add(field);
	}
	if (!chosen.size) return null;

	const covered = coveredBy(chosen);
	const coveredShare = (covered / shaped.length) * Math.min(1, updateShare);
	if (coveredShare < SKIP_MIN_COVERED_SHARE) return null;
	return { collection, fields: [...chosen].sort(), coveredShare, sample: shaped.length };
}

/** A rule already keeps these changes: it never clears on update, or skips all suggested fields. */
export function ruleCovers(rule: { update: boolean; skipFields: string[] } | undefined, fields: string[]): boolean {
	if (!rule) return false;
	return !rule.update || fields.every((field) => rule.skipFields.includes(field));
}

/** How much of a collection's changes its rule ignores, from the activity log (updates estimated from a sample). */
export type RuleShare = {
	/** Share of all changes in the period the rule ignores, 0 to 1. */
	share: number;
	/** Changes in the period (create, update, delete). */
	total: number;
	/** Update revisions the estimate for Ignored Fields is based on (0 when not needed). */
	sample: number;
	/** The action whose changes still clear most often, for the tooltip. */
	mostCleared: 'create' | 'update' | 'delete' | null;
};

/**
 * `counts`: changes per action in the period. `updates`: changed fields of sampled update revisions. An update is
 * ignored when the rule ignores updates, or when it changes only Ignored Fields.
 */
export function ruleShare(
	rule: { create: boolean; update: boolean; delete: boolean; skipFields: string[] },
	counts: { create: number; update: number; delete: number },
	updates: string[][],
): RuleShare | null {
	const total = counts.create + counts.update + counts.delete;
	if (!total) return null;
	const ignored = { create: rule.create ? 0 : counts.create, update: 0, delete: rule.delete ? 0 : counts.delete };
	let sample = 0;
	if (!rule.update) ignored.update = counts.update;
	else if (rule.skipFields.length && counts.update) {
		const shaped = updates.filter((fields) => fields.length > 0);
		sample = shaped.length;
		const covered = shaped.filter((fields) => fields.every((field) => rule.skipFields.includes(field))).length;
		ignored.update = sample ? Math.round((covered / sample) * counts.update) : 0;
	}
	const cleared = (['create', 'update', 'delete'] as const).map((action) => [action, counts[action] - ignored[action]] as const);
	const top = cleared.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
	return {
		share: (ignored.create + ignored.update + ignored.delete) / total,
		total,
		sample,
		mostCleared: top[1] > 0 ? top[0] : null,
	};
}
