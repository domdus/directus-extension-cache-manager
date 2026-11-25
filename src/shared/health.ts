import { formatDurationLabel, parseDuration } from './duration';
import { formatBytes, formatTimesPerHour } from './format';

/**
 * Analysis page: when Auto Purge empties the cache much sooner than CACHE_TTL, the lifetime setting does not describe
 * how old answers actually get. Based on the activity log (minutes with a whole-cache clear in the period).
 * null = not enough data, or the lifetime is at least half-reached.
 */
/** "once per hour", "2 times per hour", "less than once per hour". */
function perHour(rate: string): string {
	if (rate === '1') return 'once per hour';
	if (rate === '<1') return 'less than once per hour';
	return `${rate} times per hour`;
}

/** "about 16 times per hour", but "less than once per hour" without "about". */
function aboutPerHour(rate: string): string {
	return rate === '<1' ? perHour(rate) : `about ${perHour(rate)}`;
}

export function ttlVsPurgeText(
	ttl: string | null | undefined,
	purgeMinutes: number,
	windowMinutes: number,
	options?: { granular?: boolean; wideMinutes?: number },
): string | null {
	const ttlMs = parseDuration(ttl);
	if (options?.granular && options.wideMinutes !== undefined && options.wideMinutes > 0 && ttlMs && windowMinutes > 0) {
		const wideInterval = (windowMinutes / options.wideMinutes) * 60_000;
		if (wideInterval < ttlMs / 2) {
			const wideRate = formatTimesPerHour(options.wideMinutes, windowMinutes);
			return `Changes to users, roles, permissions, settings or the data model still clear the whole cache, ${aboutPerHour(wideRate)}, so cached responses rarely last the full ${formatDurationLabel(ttl)}.`;
		}
	}
	if (!ttlMs || ttlMs <= 0 || !(windowMinutes > 0) || !(purgeMinutes > 0)) return null;
	const intervalMs = (windowMinutes / purgeMinutes) * 60_000;
	if (intervalMs >= ttlMs / 2) return null;
	const rate = formatTimesPerHour(purgeMinutes, windowMinutes);
	const lifetime = formatDurationLabel(ttl);
	if (options?.granular) {
		return `Cached responses can last the full ${lifetime}. Without Granular mode, changes clear the whole cache ${aboutPerHour(rate)}.`;
	}
	return `Cache Lifetime is ${lifetime}, but changes clear the whole cache ${aboutPerHour(rate)}. Most responses are gone long before that.`;
}

/** Average minutes between whole-cache clears since this process started; null without enough data. */
export function minutesBetweenClears(fullClears: number, sinceIso: string, now = Date.now()): number | null {
	if (!(fullClears > 0)) return null;
	const started = new Date(sinceIso).getTime();
	if (!Number.isFinite(started) || !(now > started)) return null;
	const minutes = (now - started) / 60_000;
	if (!(minutes >= 1)) return null;
	return minutes / fullClears;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** "about every 7 seconds", "about every 5 minutes", "about every 2 hours", "about every 3 days". */
export function intervalText(minutes: number): string {
	if (minutes < 1) return `about every ${plural(Math.max(1, Math.round(minutes * 60)), 'second', 'seconds')}`;
	if (minutes < 60) return `about every ${plural(Math.round(minutes), 'minute', 'minutes')}`;
	const hours = minutes / 60;
	if (hours < 24) return `about every ${plural(Math.round(hours), 'hour', 'hours')}`;
	return `about every ${plural(Math.round(hours / 24), 'day', 'days')}`;
}

/** How often the whole cache was cleared since this process started: "about every 7 seconds". */
export function emptiedEveryLabel(fullClears: number, sinceIso: string, now = Date.now()): string | null {
	// One or two clears (e.g. the one when Granular starts) are no rhythm: "about every minute" would mislead.
	if (fullClears < MIN_CLEARS_FOR_RHYTHM) return null;
	const minutes = minutesBetweenClears(fullClears, sinceIso, now);
	return minutes === null ? null : intervalText(minutes);
}

/** Fewer whole-cache clears than this show no "Emptied about every …". */
export const MIN_CLEARS_FOR_RHYTHM = 3;

/** Whole-cache clears this often or more count as "constantly" (for the size hint). */
export const CONSTANT_CLEAR_MINUTES = 5;

/**
 * Statistics: a small memory cache while the whole cache is cleared every few minutes is likely the cache never getting
 * the chance to fill, not a small site. Only when clears are frequent and there were enough of them.
 */
export function sizeVsClearsText(bytes: number, fullClears: number, sinceIso: string, now = Date.now()): string | null {
	if (!(fullClears >= 20) || !(bytes >= 0) || bytes > 20 * 1024 * 1024) return null;
	const minutes = minutesBetweenClears(fullClears, sinceIso, now);
	if (minutes === null || minutes > CONSTANT_CLEAR_MINUTES) return null;
	// Times per hour, like Analysis (minutes with a whole-cache clear).
	const rate = formatTimesPerHour(60, minutes * 60);
	return `Changes clear the whole cache ${aboutPerHour(rate)}, so it can't grow: ${formatBytes(bytes)} now.`;
}
