/** Fixed locale so numbers read the same for every admin and in tests. */
const numberFormat = new Intl.NumberFormat('en-US');
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export function formatNumber(value: number): string {
	return numberFormat.format(Math.round(value || 0));
}

/** Exact percentage with at most one decimal: 0.2187 → "21.9 %". */
export function formatPercent(share: number): string {
	const value = Math.round((Number.isFinite(share) ? share : 0) * 1000) / 10;
	return `${oneDecimal.format(value)} %`;
}

/** Share of time for headlines: whole percent from 10 % up, one decimal below ("21 %", "1.5 %"). */
export function formatShare(share: number): string {
	const value = (Number.isFinite(share) ? share : 0) * 100;
	if (value > 0 && value < 0.05) return '< 0.1 %';
	return value >= 10 ? `${Math.round(value)} %` : `${oneDecimal.format(Math.round(value * 10) / 10)} %`;
}

/** Reduction of the time the cache is emptied: "−20 %". */
export function formatSaved(share: number): string {
	return share > 0 ? `−${formatShare(share)}` : '0 %';
}

/** Time window in plain words: 1 hour, 6 hours, 24 hours, 3 days, 7 days. */
export function formatWindow(hours: number): string {
	if (hours === 1) return '1 hour';
	if (hours > 24 && hours % 24 === 0) return `${hours / 24} days`;
	return `${formatNumber(hours)} hours`;
}

/** The time window as a phrase: "the last hour", "the last 24 hours", "the last 3 days". */
export function formatPeriod(hours: number): string {
	return hours === 1 ? 'the last hour' : `the last ${formatWindow(hours)}`;
}

/** "296 minutes of the last 24 hours". */
export function formatMinutes(minutes: number, windowMinutes: number): string {
	const count = Math.round(minutes || 0);
	return `${formatNumber(count)} ${count === 1 ? 'minute' : 'minutes'} of ${formatPeriod(windowMinutes / 60)}`;
}

/** "296 minutes". */
export function formatMinuteCount(minutes: number): string {
	const count = Math.round(minutes || 0);
	return `${formatNumber(count)} ${count === 1 ? 'minute' : 'minutes'}`;
}

/** Minutes per hour of the window, rounded to whole numbers; null below 1 (but above 0). */
export function perHour(minutes: number, windowMinutes: number): number | null {
	const hours = windowMinutes / 60;
	if (!hours || !(minutes > 0)) return 0;
	const rate = minutes / hours;
	return rate < 1 ? null : Math.round(rate);
}

function rateNumber(minutes: number, windowMinutes: number): string {
	const rate = perHour(minutes, windowMinutes);
	return rate === null ? 'less than 1' : formatNumber(rate);
}

/** "about 12 minutes per hour", "about 1 minute per hour", "less than 1 minute per hour". */
export function formatRate(minutes: number, windowMinutes: number): string {
	const rate = perHour(minutes, windowMinutes);
	if (rate === null) return 'less than 1 minute per hour';
	if (rate === 0) return '0 minutes per hour';
	return `about ${formatNumber(rate)} ${rate === 1 ? 'minute' : 'minutes'} per hour`;
}

/** "about 1 minute per hour instead of 12". */
export function formatRateCompare(minutes: number, nowMinutes: number, windowMinutes: number): string {
	return `${formatRate(minutes, windowMinutes)} instead of ${rateNumber(nowMinutes, windowMinutes)}`;
}

/** Short form for tables: "288 min · ~12/h", "3 min · <1/h". */
export function formatMinutesShort(minutes: number, windowMinutes: number): string {
	const rate = perHour(minutes, windowMinutes);
	const per = rate === null ? '<1/h' : `~${formatNumber(rate)}/h`;
	return `${formatNumber(minutes)} min · ${per}`;
}
