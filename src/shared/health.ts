import { formatDurationLabel, parseDuration } from './duration';
import { formatBytes, formatTimesPerHour } from './format';

/**
 * Analysis page: when Auto Purge empties the cache much sooner than CACHE_TTL, the lifetime setting does not describe
 * how old answers actually get. Based on the activity log (minutes with a whole-cache clear in the period).
 * null = not enough data, or the lifetime is at least half-reached.
 */
export function ttlVsPurgeText(
	ttl: string | null | undefined,
	purgeMinutes: number,
	windowMinutes: number,
	options?: { granular?: boolean },
): string | null {
	const ttlMs = parseDuration(ttl);
	if (!ttlMs || ttlMs <= 0 || !(windowMinutes > 0) || !(purgeMinutes > 0)) return null;
	const intervalMs = (windowMinutes / purgeMinutes) * 60_000;
	if (intervalMs >= ttlMs / 2) return null;
	const rate = formatTimesPerHour(purgeMinutes, windowMinutes);
	const lifetime = formatDurationLabel(ttl);
	if (options?.granular) {
		return `Lifetime is ${lifetime}. In Granular mode, answers a change does not touch can live that long. Without it, changes would empty the whole cache about ${rate} times per hour.`;
	}
	return `Lifetime is ${lifetime}, but changes empty the cache about ${rate} times per hour. Answers almost never live that long.`;
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
	const minutes = minutesBetweenClears(fullClears, sinceIso, now);
	return minutes === null ? null : intervalText(minutes);
}

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
	return `The whole cache is cleared ${intervalText(minutes)}, so it likely never gets the chance to grow: ${formatBytes(bytes)} now.`;
}

/**
 * Status: the same lifetime check as ttlVsPurgeText, from the numbers this process counted since it started (no
 * database query). Only in Whole Cache mode: Granular already keeps answers a change does not touch.
 */
export function ttlVsClearsText(
	ttl: string | null | undefined,
	fullClears: number,
	sinceIso: string,
	now = Date.now(),
): string | null {
	const ttlMs = parseDuration(ttl);
	if (!ttlMs || ttlMs <= 0 || !(fullClears >= 3)) return null;
	const started = new Date(sinceIso).getTime();
	// At least 30 minutes of data, so a restart or a single burst does not trigger it.
	if (!Number.isFinite(started) || now - started < 30 * 60_000) return null;
	const minutes = minutesBetweenClears(fullClears, sinceIso, now);
	if (minutes === null || minutes * 60_000 >= ttlMs / 2) return null;
	return `Lifetime is ${formatDurationLabel(ttl)}, but since Directus started the whole cache was cleared ${intervalText(minutes)}. Answers almost never live that long.`;
}
