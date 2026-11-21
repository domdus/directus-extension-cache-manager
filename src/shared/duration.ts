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

/** True when Directus would read this as raw milliseconds ("2", "300000"), not "2h" / "5m". */
export function isBareMilliseconds(value: unknown): boolean {
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'string') return false;
	const match = PATTERN.exec(value.trim());
	return Boolean(match && !match[2]);
}

function pair(n: number, one: string, many: string): string {
	return `${n} ${n === 1 || n === -1 ? one : many}`;
}

function fromUnit(amount: number, unitWord: string): string {
	const size = unitOf(unitWord);
	if (size === UNITS.h) return pair(amount, 'hour', 'hours');
	if (size === UNITS.m) return pair(amount, 'minute', 'minutes');
	if (size === UNITS.d) return pair(amount, 'day', 'days');
	if (size === UNITS.w) return pair(amount, 'week', 'weeks');
	if (size === UNITS.s) return pair(amount, 'second', 'seconds');
	if (size === UNITS.y) return pair(amount, 'year', 'years');
	return pair(amount, 'millisecond', 'milliseconds');
}

function fromMs(ms: number): { short: string; long: string } {
	const abs = Math.abs(ms);
	if (abs >= UNITS.d! && abs % UNITS.d! === 0) {
		const n = ms / UNITS.d!;
		return { short: `${n}d`, long: pair(n, 'day', 'days') };
	}
	if (abs >= UNITS.h! && abs % UNITS.h! === 0) {
		const n = ms / UNITS.h!;
		return { short: `${n}h`, long: pair(n, 'hour', 'hours') };
	}
	if (abs >= UNITS.m! && abs % UNITS.m! === 0) {
		const n = ms / UNITS.m!;
		return { short: `${n}m`, long: pair(n, 'minute', 'minutes') };
	}
	if (abs >= UNITS.s! && abs % UNITS.s! === 0) {
		const n = ms / UNITS.s!;
		return { short: `${n}s`, long: pair(n, 'second', 'seconds') };
	}
	return { short: `${ms}ms`, long: pair(ms, 'millisecond', 'milliseconds') };
}

/** Compact label that always has a unit: "2h", "5m", "2ms". */
export function formatDurationShort(value: unknown): string {
	const ms = parseDuration(value);
	if (ms === null) return durationText(value) || '–';
	const text = durationText(value);
	const match = PATTERN.exec(text);
	if (match?.[2]) {
		const amount = match[1]!;
		const size = unitOf(match[2]);
		if (size === UNITS.h) return `${amount}h`;
		if (size === UNITS.m) return `${amount}m`;
		if (size === UNITS.d) return `${amount}d`;
		if (size === UNITS.s) return `${amount}s`;
		if (size === UNITS.w) return `${amount}w`;
		if (size === UNITS.ms) return `${amount}ms`;
	}
	return fromMs(ms).short;
}

/** Spoken label for sentences: "2 hours", "5 minutes", "2 milliseconds". */
export function formatDurationLabel(value: unknown): string {
	const ms = parseDuration(value);
	if (ms === null) return durationText(value) || '–';
	const text = durationText(value);
	const match = PATTERN.exec(text);
	if (match?.[2]) return fromUnit(Number.parseFloat(match[1]!), match[2]);
	return fromMs(ms).long;
}

/** Hint when a field is a bare number (Directus reads that as milliseconds). */
export function bareMillisecondsHint(value: unknown): string | null {
	if (!isBareMilliseconds(value)) return null;
	const ms = parseDuration(value);
	if (ms === null) return null;
	const label = formatDurationLabel(value);
	if (ms > 0 && ms < 1000) return `${label}. Write ${durationText(value)}h for hours.`;
	return `${label} (a number with no unit is milliseconds).`;
}

/** Same lifetime, written differently ("1h" and "60m")? Falls back to text comparison when unreadable. */
export function sameDuration(a: unknown, b: unknown): boolean {
	const left = parseDuration(a);
	const right = parseDuration(b);
	return left !== null && right !== null ? left === right : durationText(a) === durationText(b);
}
