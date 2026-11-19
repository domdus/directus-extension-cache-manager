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
	ignored: 'Ignored',
	clears: 'Clears cache',
	unmeasured: 'Not measured',
	'will-ignore': 'Will be ignored',
	'will-clear': 'Will clear cache',
};

/** Which selected collections "Ignore selected" and "Stop ignoring selected" would change in the draft. */
export function selectionChanges(selected: string[], draftIgnored: string[]): { toIgnore: string[]; toStop: string[] } {
	const draft = new Set(draftIgnored);
	const unique = [...new Set(selected)];
	return { toIgnore: unique.filter((name) => !draft.has(name)), toStop: unique.filter((name) => draft.has(name)) };
}
