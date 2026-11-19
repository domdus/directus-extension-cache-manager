/**
 * Minimal copy of the `ms` parser (v2) that Directus uses for CACHE_TTL (getMilliseconds in @directus/api).
 * Accepts "5m", "1h", "12 hours", "1d", "500ms" and plain milliseconds ("300000" or 300000).
 */
const UNITS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
	y: 31_557_600_000,
};

const PATTERN =
	/^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

function unitOf(word: string): number {
	const unit = word.toLowerCase();
	if (/^(milliseconds?|msecs?|ms)$/.test(unit)) return UNITS.ms!;
	if (/^(seconds?|secs?|s)$/.test(unit)) return UNITS.s!;
	if (/^(minutes?|mins?|m)$/.test(unit)) return UNITS.m!;
	if (/^(hours?|hrs?|h)$/.test(unit)) return UNITS.h!;
	if (/^(days?|d)$/.test(unit)) return UNITS.d!;
	if (/^(weeks?|w)$/.test(unit)) return UNITS.w!;
	return UNITS.y!;
}

/** Milliseconds, or null when Directus could not read the value either. */
export function parseDuration(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text || text.length > 100) return null;
	const match = PATTERN.exec(text);
	if (!match) return null;
	const amount = Number.parseFloat(match[1]!);
	return match[2] ? amount * unitOf(match[2]) : amount;
}

export const MAX_TTL_MS = 30 * UNITS.d!;
export const TTL_ERROR = 'Use a duration like 5m, 1h or 12h (more than 0, at most 30 days)';

/** A usable cache lifetime: readable, above 0 and at most 30 days. */
export function isValidTtl(value: unknown): boolean {
	const msValue = parseDuration(value);
	return msValue !== null && msValue > 0 && msValue <= MAX_TTL_MS;
}

/** Duration as trimmed text; null/undefined (e.g. a cleared input) become "". */
export function durationText(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value).trim();
}

/** Same lifetime, written differently ("1h" and "60m")? Falls back to text comparison when unreadable. */
export function sameDuration(a: unknown, b: unknown): boolean {
	const left = parseDuration(a);
	const right = parseDuration(b);
	return left !== null && right !== null ? left === right : durationText(a) === durationText(b);
}
