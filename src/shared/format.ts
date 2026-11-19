/** Fixed locale so numbers read the same for every admin and in tests. */
const numberFormat = new Intl.NumberFormat('en-US');

export function formatNumber(value: number): string {
	return numberFormat.format(Math.round(value || 0));
}

/** Share as a percentage with at most one decimal: 0.2187 → "21.9 %". */
export function formatPercent(share: number): string {
	const value = Math.round((Number.isFinite(share) ? share : 0) * 1000) / 10;
	return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)} %`;
}

/** "315 of 1,440 minutes (21.9 %)". */
export function formatMinutes(minutes: number, total: number): string {
	return `${formatNumber(minutes)} of ${formatNumber(total)} minutes (${formatPercent(total ? minutes / total : 0)})`;
}

export function formatHours(hours: number): string {
	return hours === 1 ? 'hour' : `${formatNumber(hours)} hours`;
}
