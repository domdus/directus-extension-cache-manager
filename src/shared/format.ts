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

/** "306 of the last 1,440 minutes (24 hours)". */
export function formatMinutes(minutes: number, total: number): string {
	return `${formatNumber(minutes)} of the last ${formatNumber(total)} minutes (${formatWindow(total / 60)})`;
}
