import { formatNumber } from './format';
import { intervalText, minutesBetweenClears, MIN_CLEARS_FOR_RHYTHM } from './health';

/** good: green, bad: red, neutral: grey. */
export type TrendTone = 'good' | 'bad' | 'neutral';
export type Trend = { up: boolean; tone: TrendTone; text: string; tooltip: string };

/** The counters 1 hour ago (see Snapshot in the API). */
export type TrendSnapshot = { at: string; full: number; targeted: number; skipped: number; fullMinutes: number; hits: number; misses: number; timings?: TimingCounts };

/** Response times (see Timings in the API). */
export type TimingCounts = { hits: number; hitMs: number; misses: number; missMs: number };

/** Below this many timed requests an average jumps too much to show. */
export const MIN_TIMED_REQUESTS = 10;

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

/** Average milliseconds; null below MIN_TIMED_REQUESTS. */
export function averageMs(count: number, totalMs: number): number | null {
	return count >= MIN_TIMED_REQUESTS ? totalMs / count : null;
}

/** "3 ms", "0.4 ms", "1.2 s". */
export function msText(ms: number): string {
	if (ms < 1) return `${(Math.round(ms * 10) / 10).toLocaleString()} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(Math.round(ms / 100) / 10).toLocaleString()} s`;
}

/** Time hits saved: each hit took the average miss time minus the average hit time less. null without enough of both. */
export function timeSavedMs(t: TimingCounts | undefined): number | null {
	if (!t) return null;
	const hit = averageMs(t.hits, t.hitMs);
	const miss = averageMs(t.misses, t.missMs);
	return hit === null || miss === null ? null : t.hits * Math.max(0, miss - hit);
}

/** "12 s", "4 min", "2.1 h", "3 days". */
export function savedText(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${Math.round(seconds)} s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${Math.round(minutes)} min`;
	const hours = minutes / 60;
	if (hours < 48) return `${(Math.round(hours * 10) / 10).toLocaleString()} h`;
	return `${Math.round(hours / 24)} days`;
}

/** An average response time now and 1 hour ago: lower is better. Nothing below a 5 % change. */
export function avgTimeTrend(count: number, totalMs: number, beforeCount: number | undefined, beforeMs: number | undefined): Trend | null {
	const current = averageMs(count, totalMs);
	const before = beforeCount === undefined || beforeMs === undefined ? null : averageMs(beforeCount, beforeMs);
	if (current === null || before === null || before === 0) return null;
	const delta = current - before;
	if (Math.abs(delta) / before < 0.05) return null;
	const up = delta > 0;
	return { up, tone: up ? 'bad' : 'good', text: `${up ? '+' : '−'}${msText(Math.abs(delta))}`, tooltip: `1 hour ago: ${msText(before)}` };
}

/** Time saved in the last hour. */
export function savedTrend(now: TimingCounts | undefined, before: TimingCounts | undefined): Trend | null {
	const current = timeSavedMs(now);
	const earlier = before ? timeSavedMs(before) ?? 0 : null;
	if (current === null || earlier === null || current - earlier < 1000) return null;
	const delta = current - earlier;
	return { up: true, tone: 'good', text: `+${savedText(delta)}`, tooltip: `${savedText(delta)} saved in the last hour` };
}
