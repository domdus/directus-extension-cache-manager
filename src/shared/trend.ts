import { formatNumber } from './format';
import { intervalText, minutesBetweenClears, MIN_CLEARS_FOR_RHYTHM } from './health';

/** good: green, bad: red, neutral: grey. */
export type TrendTone = 'good' | 'bad' | 'neutral';
export type Trend = { up: boolean; tone: TrendTone; text: string; tooltip: string };

/** The counters 1 hour ago (see Snapshot in the API). */
export type TrendSnapshot = { at: string; full: number; targeted: number; skipped: number; fullMinutes: number; hits: number; misses: number };

/** Below this many requests the hit rate jumps too much to show a trend. */
export const MIN_REQUESTS_FOR_RATE = 20;

/** A counter: how much it grew in the last hour. Nothing when it didn't grow. */
export function countTrend(now: number, before: number | undefined, tone: TrendTone): Trend | null {
	if (before === undefined || !(now > before)) return null;
	const delta = now - before;
	return { up: true, tone, text: `+${formatNumber(delta)}`, tooltip: `${formatNumber(delta)} in the last hour` };
}

/** Time between global cache clears now and 1 hour ago: longer is better. */
export function emptiedTrend(fullMinutes: number, since: string, hourAgo: TrendSnapshot | null, now = Date.now()): Trend | null {
	if (!hourAgo || fullMinutes < MIN_CLEARS_FOR_RHYTHM || (hourAgo.fullMinutes ?? 0) < MIN_CLEARS_FOR_RHYTHM) return null;
	const current = minutesBetweenClears(fullMinutes, since, now);
	const before = minutesBetweenClears(hourAgo.fullMinutes, since, new Date(hourAgo.at).getTime());
	if (current === null || before === null) return null;
	const delta = current - before;
	// Less than a minute or 2 %: no real change.
	if (Math.abs(delta) < 1 || Math.abs(delta) / before < 0.02) return null;
	const up = delta > 0;
	return { up, tone: up ? 'good' : 'bad', text: `${up ? '+' : '−'}${durationText(Math.abs(delta))}`, tooltip: `1 hour ago: ${intervalText(before)}` };
}

/** Hits ÷ (hits + misses); null without enough requests. */
export function hitRate(hits: number, misses: number): number | null {
	const total = hits + misses;
	return total >= MIN_REQUESTS_FOR_RATE ? hits / total : null;
}

/** Hit rate now and 1 hour ago: higher is better. */
export function hitRateTrend(hits: number, misses: number, hourAgo: TrendSnapshot | null): Trend | null {
	const current = hitRate(hits, misses);
	const before = hourAgo ? hitRate(hourAgo.hits ?? 0, hourAgo.misses ?? 0) : null;
	if (current === null || before === null) return null;
	const delta = Math.round(current * 100) - Math.round(before * 100);
	if (delta === 0) return null;
	const up = delta > 0;
	return { up, tone: up ? 'good' : 'bad', text: `${up ? '+' : '−'}${Math.abs(delta)} %`, tooltip: `1 hour ago: ${Math.round(before * 100)} %` };
}

function durationText(minutes: number): string {
	if (minutes < 60) return `${Math.round(minutes)} min`;
	const hours = minutes / 60;
	return hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`;
}
