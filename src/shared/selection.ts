/** What the Status column shows: the state in use now, or what Save & Apply will change. */
export type RowState = 'ignored' | 'clears' | 'unmeasured' | 'will-ignore' | 'will-clear';

export function rowState(collection: string, measured: boolean, draftIgnored: Set<string>, effectiveIgnored: Set<string>): RowState {
	const now = effectiveIgnored.has(collection);
	const next = draftIgnored.has(collection);
	if (next && !now) return 'will-ignore';
	if (!next && now) return 'will-clear';
	if (now) return 'ignored';
	return measured ? 'clears' : 'unmeasured';
}

export const ROW_STATE_LABELS: Record<RowState, string> = {
	ignored: 'Keeps cache',
	clears: 'Clears cache',
	unmeasured: 'Not measured',
	'will-ignore': 'Will keep cache',
	'will-clear': 'Will clear cache',
};

/** Which selected collections "Ignore selected" and "Stop ignoring selected" would change in the draft. */
export function selectionChanges(selected: string[], draftIgnored: string[]): { toIgnore: string[]; toStop: string[] } {
	const draft = new Set(draftIgnored);
	const unique = [...new Set(selected)];
	return { toIgnore: unique.filter((name) => !draft.has(name)), toStop: unique.filter((name) => draft.has(name)) };
}

/**
 * Names that usually mean apps decide on the data (access, payments, purchases). A guess from the name only:
 * the extension can't see how apps read a collection, so these suggestions get a warning instead of a plain badge.
 */
const SENSITIVE_NAME = /subscri|payment|purchase|checkout|order|transaction|invoice|entitle|licen[cs]e|access|permission|wallet|balance|credit|billing/i;

export function looksSensitive(collection: string): boolean {
	return SENSITIVE_NAME.test(collection);
}

/** Tooltip for a suggested collection. */
export function suggestionTooltip(collection: string, ttl: string): string {
	const age = ttl ? `up to ${ttl}` : 'until the cache expires';
	return looksSensitive(collection)
		? `${collection} changes often, but its name suggests apps decide on it (access, payments, purchases). Only ignore it after every app that needs it up to date reads it with Cache-Control: no-store. Otherwise they get answers ${age} old.`
		: `${collection} changes often. Ignored collections can be ${age} old for apps that don't ask for fresh data (Cache-Control: no-store).`;
}
