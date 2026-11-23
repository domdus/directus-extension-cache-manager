import { formatDurationLabel } from './duration';

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

/**
 * Which selected collections "Never Clear Selected" and "Clear Again" would change in the draft. Collections on the
 * configured ignore list can't be changed here.
 */
export function selectionChanges(
	selected: string[],
	draftKept: Set<string>,
	configured: Set<string> = new Set(),
): { toKeep: string[]; toClear: string[] } {
	const unique = [...new Set(selected)].filter((name) => !configured.has(name));
	return { toKeep: unique.filter((name) => !draftKept.has(name)), toClear: unique.filter((name) => draftKept.has(name)) };
}

/**
 * Names that usually mean apps decide on the data (access, payments, purchases). A guess from the name only:
 * the extension can't see how apps read a collection, so these suggestions get a warning instead of a plain badge.
 */
const SENSITIVE_NAME = new RegExp(
	[
		// payments and purchases
		'subscri', 'payment', 'purchase', 'checkout', 'order', 'transaction', 'invoice', 'billing', 'refund', 'voucher',
		'coupon', 'price', 'pricing', 'cart(?:s|_|$)', 'wallet', 'balance', 'credit',
		// access and membership
		'entitle', 'licen[cs]e', 'access', 'permission', 'member', 'premium', 'vip', 'tier', 'quota', 'token', 'session',
		'consent',
		// availability
		'booking', 'reservation', 'ticket', 'stock', 'inventory',
	].join('|'),
	'i',
);

export function looksSensitive(collection: string): boolean {
	return SENSITIVE_NAME.test(collection);
}

/** Tooltip for a suggested collection. */
export function suggestionTooltip(collection: string, ttl: string): string {
	const age = ttl ? `up to ${formatDurationLabel(ttl)}` : 'until the cache expires';
	return looksSensitive(collection)
		? `${collection} changes often, but apps may need it up to date (access, payments, purchases). Only stop clearing it if those apps send Cache-Control: no-store. Otherwise they get data ${age} old.`
		: `${collection} changes often. If it never clears, apps get its data ${age} old, unless they send Cache-Control: no-store.`;
}
