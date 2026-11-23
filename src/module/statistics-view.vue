<template>
	<private-view title="Statistics" icon="query_stats">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon small secondary :loading="loading" @click="load">
				<v-icon name="refresh" small />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About" :close="false">
				<p class="sidebar-text">Every change that cleared the cache on this Directus server, and what it removed. The page refreshes every 15 seconds.</p>
				<p class="sidebar-text">
					Directus doesn't count cache hits. This page shows how often the cache is cleared, how big it is, and how many
					changes kept the rest of the cache.
				</p>
				<p class="sidebar-text">
					Directus keeps an expired response until someone requests it again. Cache Manager deletes expired responses every
					minute. Redis does this itself.
				</p>
				<p class="sidebar-text">The numbers reset when Directus restarts. With several servers, each server counts its own.</p>
				<p class="sidebar-text">
					For a longer period, see <router-link to="/cache-manager/analysis">Analysis</router-link>. It reads the activity log.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<div v-if="!data && loading" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="data">
				<v-notice v-if="shownProblems.length" type="warning" class="notice">
					{{ shownProblems.join('. ') }}.
				</v-notice>
				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="history" /></template>
					Cache Clears
				</v-divider>
				<p class="explain intro">What cleared the cache since Directus started ({{ new Date(data.status.since).toLocaleString() }}).</p>
				<v-notice v-if="sizeVsClears" type="warning" class="notice">
					<span>
						{{ sizeVsClears }}
						<router-link to="/cache-manager/analysis">Open Analysis</router-link>
					</span>
				</v-notice>

				<section class="summary-bar" aria-label="Clear counts">
					<div class="stat">
						<span class="stat-value">{{ times(data.status.counts.full) }}</span>
						<span class="stat-label">
							Global Cache
							<v-icon
								v-tooltip.top="'Changes that cleared the whole cache. In Granular mode, only changes to users, roles, permissions, settings or the data model do this, plus switching to Granular and manual clears.'"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
					<div class="stat">
						<span class="stat-value">{{ times(data.status.counts.targeted) }}</span>
						<span class="stat-label">
							Granular
							<v-icon
								v-tooltip.top="`${formatNumber(data.status.counts.removed)} ${data.status.counts.removed === 1 ? 'cached response' : 'cached responses'} removed in total.`"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
					<div class="stat">
						<span class="stat-value">{{ formatNumber(data.status.counts.skipped) }}</span>
						<span class="stat-label">
							Kept by Rule
							<v-icon
								v-tooltip.top="'Changes that cleared nothing because of a rule.'"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
					<div v-if="emptiedEvery" class="stat">
						<span class="stat-value">{{ emptiedEvery }}</span>
						<span class="stat-label">
							Emptied
							<v-icon
								v-tooltip.top="'Average time between global cache clears. Several clears in one minute count once. If this is much shorter than the Cache Lifetime, cached responses rarely reach their lifetime.'"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
				</section>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="memory" /></template>
					Cache Size
				</v-divider>
				<template v-if="data.status.size">
					<p class="explain intro">Memory the cache uses on this server right now.</p>
					<section class="summary-bar" aria-label="Cache size">
						<div class="stat">
							<span class="stat-value">{{ formatBytes(data.status.size.bytes) }}</span>
							<span class="stat-label">
								Size
								<v-icon
									v-tooltip.top="`${formatNumber(data.status.size.entries)} ${data.status.size.entries === 1 ? 'entry' : 'entries'}. Node.js needs a little more memory on top. A small cache after many global cache clears means it is rebuilt all the time.`"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div v-if="data.status.targetedActive && data.status.indexed >= 0" class="stat">
							<span class="stat-value">{{ formatNumber(data.status.indexed) }}</span>
							<span class="stat-label">
								Cached Responses
								<v-icon
									v-tooltip.top="'API responses in the cache right now.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div v-if="peakBytes !== null" class="stat">
							<span class="stat-value">{{ formatBytes(peakBytes) }}</span>
							<span class="stat-label">
								Peak Size
								<v-icon
									v-tooltip.top="'Largest size in the last 24 hours. If it stays close to the current size while the cache is cleared often, the cache never gets to grow.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ formatBytes(data.status.swept.bytes) }}</span>
							<span class="stat-label">
								Expired
								<v-icon
									v-tooltip.top="`Size of the expired entries deleted since Directus started (${formatNumber(data.status.swept.entries)} ${data.status.swept.entries === 1 ? 'entry' : 'entries'}). Directus only deletes an expired entry when it is requested again. Cache Manager deletes them every minute.`"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
					</section>
					<p v-if="!largest.length && !data.status.targetedActive" class="meta">Size per collection is shown in Granular mode only.</p>
				</template>
				<p v-else class="explain intro">
					<template v-if="data.status.store === 'memory'">No size while the cache is off.</template>
					<template v-else>
						The size is shown only for a cache in memory (CACHE_STORE=memory). This Directus uses {{ data.status.store }},
						shared by all Directus servers.
					</template>
				</p>
				<div v-if="largest.length" class="largest">
					<span class="label">What a Change Clears</span>
					<p class="explain">
						The cached responses that use each collection. A change to the collection clears them. A response that uses
						several collections is in each of their rows, so the rows add up to more than the total.
					</p>
					<div v-for="row in largest" :key="row.name" class="largest-row">
						<span class="largest-name">{{ row.name }}</span>
						<span class="largest-bar" :class="{ 'largest-bar--kept': row.kept }"><span :style="{ inlineSize: `${row.share * 100}%` }" /></span>
						<span class="largest-count">
							{{ formatNumber(row.count) }}<template v-if="row.total"> of {{ formatNumber(row.total) }}</template>
							{{ (row.total || row.count) === 1 ? 'response' : 'responses' }}
						</span>
						<span class="largest-value">{{ row.bytes === null ? '' : formatBytes(row.bytes) }}</span>
						<span
							v-if="row.kept"
							v-tooltip="'Its changes never clear the cache (a never-clear rule or CACHE_AUTO_PURGE_IGNORE_LIST). The size is what a change would clear without it.'"
							class="largest-share largest-share--kept"
						>
							Kept
						</span>
						<span v-else class="largest-share">{{ Math.round(row.share * 100) }} %</span>
					</div>
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="bar_chart" /></template>
					Last 24 Hours
				</v-divider>
				<p class="explain intro">Per hour. Hover a bar for the numbers.</p>
				<div class="charts">
					<hour-bars title="Changes" :columns="clearColumns" :legend="clearLegend" :format="(v) => formatNumber(v)" empty-text="No changes yet." />
					<hour-bars v-if="data.status.size" title="Cache Size" :columns="sizeColumns" :legend="sizeLegend" :format="formatBytes" empty-text="The cache is empty." />
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="list" /></template>
					Recent Events
				</v-divider>
				<p class="explain intro">Newest first. Repeats in the same second are shown once, with a count.</p>

				<div v-if="events.length" class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Time</th>
								<th>What Happened</th>
								<th>Result</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(event, i) in events" :key="i">
								<td class="time">{{ new Date(event.at).toLocaleTimeString() }}</td>
								<td class="what">
									{{ event.reason }}
									<span v-if="event.count > 1" v-tooltip="`${event.count} times in the same second`" class="count">×{{ event.count }}</span>
								</td>
								<td class="result-col">
									<span class="result" :class="`result--${event.kind}`">{{ resultText(event) }}</span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p v-else class="empty subdued">No changes yet.</p>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import HourBars, { type BarColumn } from './hour-bars.vue';
import { useRules } from './composables/use-rules';
import { usePageClass } from './composables/use-page-class';
import { emptiedEveryLabel, sizeVsClearsText } from '../shared/health';
import { groupEvents, type GroupedEvent } from '../shared/events';
import { neverClearCollections } from '../shared/rules';
import { formatBytes, formatNumber } from '../shared/format';

const pageClass = usePageClass();
const { data, loading, error, load } = useRules();
// The restart notice (first problem without a restart) is about Granular mode: only when it is saved as the mode.
const shownProblems = computed(() => {
	const status = data.value?.status;
	if (!status) return [];
	return !status.installed && !data.value!.config.targeted ? status.problems.slice(1) : status.problems;
});
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };

const sizeVsClears = computed(() => {
	const status = data.value?.status;
	if (!status?.size) return null;
	return sizeVsClearsText(status.size.bytes, status.counts.fullMinutes ?? 0, status.since);
});
const emptiedEvery = computed(() => {
	const status = data.value?.status;
	if (!status) return null;
	return emptiedEveryLabel(status.counts.fullMinutes ?? 0, status.since);
});
const peakBytes = computed(() => {
	const values = (data.value?.status.history ?? []).map((h) => h.bytes).filter((bytes): bytes is number => bytes != null);
	return values.length ? Math.max(...values) : null;
});


const COLORS = {
	full: 'var(--theme--warning, var(--warning))',
	targeted: 'var(--theme--success, var(--success))',
	skipped: 'var(--blue, #3399ff)',
	size: 'var(--theme--primary, var(--primary))',
};
const clearLegend = [
	{ label: 'Global Cache', color: COLORS.full },
	{ label: 'Granular', color: COLORS.targeted },
	{ label: 'Kept by Rule', color: COLORS.skipped },
];
const sizeLegend = [{ label: 'Largest Size per Hour', color: COLORS.size }];

function hourLabel(iso: string): string {
	return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function hourRange(iso: string): string {
	const start = new Date(iso);
	const end = new Date(start.getTime() + 3_600_000);
	const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return `${time(start)}–${time(end)}`;
}

const clearColumns = computed<BarColumn[]>(() =>
	(data.value?.status.history ?? []).map((h) => ({
		label: hourLabel(h.hour),
		tooltip: `${hourRange(h.hour)}: global cache ${formatNumber(h.full)}, granular ${formatNumber(h.targeted)}, kept by rule ${formatNumber(h.skipped)}`,
		segments: [
			{ value: h.full, color: COLORS.full },
			{ value: h.targeted, color: COLORS.targeted },
			{ value: h.skipped, color: COLORS.skipped },
		],
	})),
);

const sizeColumns = computed<BarColumn[]>(() =>
	(data.value?.status.history ?? []).map((h) => ({
		label: hourLabel(h.hour),
		tooltip:
			h.bytes === null
				? `${hourRange(h.hour)}: not measured`
				: `${hourRange(h.hour)}: up to ${formatBytes(h.bytes)} (${formatNumber(h.entries ?? 0)} entries)`,
		segments: [{ value: h.bytes ?? 0, color: COLORS.size }],
	})),
);

/**
 * What a change to each collection clears: the cached responses that use it, as a share of the whole cache (by size
 * in memory, by number of responses with Redis). Rows overlap, so they add up to more than the total.
 */
const largest = computed(() => {
	const status = data.value?.status;
	const counts = status?.indexedByCollection ?? {};
	const bytes = status?.bytesByCollection ?? {};
	const bySize = Object.keys(bytes).length > 0 && !!status?.size?.bytes;
	const total = status && status.indexed > 0 ? status.indexed : 0;
	const totalOf = bySize ? status!.size!.bytes : total;
	const rows = Object.keys(bySize ? bytes : counts)
		.filter((name) => name !== '*')
		.map((name) => ({ name, count: counts[name] ?? 0, total, bytes: bySize ? (bytes[name] ?? 0) : null }))
		.sort((a, b) => (bySize ? b.bytes! - a.bytes! : b.count - a.count))
		.slice(0, 8);
	const kept = new Set([...(data.value?.ignoreList ?? []), ...(data.value ? neverClearCollections(data.value.config) : [])]);
	return rows.map((row) => ({ ...row, kept: kept.has(row.name), share: totalOf > 0 ? Math.min(1, (bySize ? row.bytes! : row.count) / totalOf) : 0 }));
});

function times(count: number): string {
	return `${formatNumber(count)} ${count === 1 ? 'time' : 'times'}`;
}

const events = computed(() => groupEvents(data.value?.status.recent ?? []));

function resultText(event: GroupedEvent): string {
	if (event.kind === 'full') return 'Global cache cleared';
	if (event.kind === 'skipped') return 'Kept by rule';
	return `${formatNumber(event.removed)} ${event.removed === 1 ? 'cached response' : 'cached responses'} cleared`;
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
	load();
	timer = setInterval(() => {
		if (!loading.value) load();
	}, 15_000);
});
onUnmounted(() => {
	if (timer) clearInterval(timer);
});
</script>

<style scoped>
.page-container {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
	max-inline-size: 75rem;
}
.page-container--flush-top {
	padding-block-start: 0;
}
.section-divider {
	margin-bottom: 12px;
}
.notice {
	margin-bottom: 16px;
}
.notice a {
	margin-left: 0.35em;
	color: inherit;
	text-decoration: underline;
}
.loading {
	display: flex;
	justify-content: center;
	padding: 40px 0;
}
.sidebar-text {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground, var(--foreground-normal));
}
.sidebar-text a {
	color: var(--theme--primary, var(--primary));
}
.subdued,
.meta,
.explain {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	line-height: 1.5;
}
.meta {
	margin: 12px 0;
}
.intro {
	margin: 0 0 16px;
}
.section-divider.add-margin-top {
	margin-top: 40px;
}
.empty {
	margin: 8px 0 0;
}
.summary-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin: 0 0 1.25rem;
	inline-size: 100%;
}
.stat {
	display: inline-flex;
	flex: 1 1 auto;
	align-items: baseline;
	gap: 0.4rem;
	min-inline-size: max-content;
	padding: 0.4rem 0.7rem;
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	border-radius: var(--theme--border-radius, var(--border-radius));
	background: var(--theme--background-subdued, var(--background-subdued));
	white-space: nowrap;
}
.stat-value {
	font-size: 0.9rem;
	font-weight: 700;
	line-height: 1.3;
	color: var(--theme--foreground, var(--foreground-normal));
	font-variant-numeric: tabular-nums;
}
.stat-label {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.stat-info {
	--v-icon-color: var(--theme--foreground-subdued, var(--foreground-subdued));
	cursor: pointer;
	flex-shrink: 0;
}
.table-wrap {
	container: events / inline-size;
	overflow: auto;
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	border-radius: var(--theme--border-radius, var(--border-radius));
}
table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}
th,
td {
	padding: 8px 10px;
	text-align: left;
	vertical-align: middle;
	border-bottom: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
}
tbody tr:last-child td {
	border-bottom: none;
}
th {
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.02em;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	background: var(--theme--background-subdued, var(--background-subdued));
}
.time {
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}
.result {
	white-space: nowrap;
}
.what {
	overflow-wrap: anywhere;
}
/* Narrow: time and result on one line, what happened below. */
@container events (max-width: 560px) {
	thead {
		display: none;
	}
	table,
	tbody {
		display: block;
	}
	tbody tr {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		padding: 8px 12px;
		border-bottom: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	}
	tbody tr:last-child {
		border-bottom: none;
	}
	tbody td {
		padding: 0;
		border: none;
	}
	tbody td.time {
		grid-row: 1;
		grid-column: 1;
		color: var(--theme--foreground-subdued, var(--foreground-subdued));
	}
	tbody td.result-col {
		grid-row: 1;
		grid-column: 2;
		text-align: right;
	}
	tbody td.what {
		grid-row: 2;
		grid-column: 1 / -1;
	}
}
.result--full {
	color: var(--theme--warning, var(--warning));
}
.result--targeted {
	color: var(--theme--success, var(--success));
}
.result--skipped {
	color: var(--blue, #3399ff);
}
.charts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}
@media (max-width: 1100px) {
	.charts {
		grid-template-columns: 1fr;
	}
}
.largest {
	container: largest / inline-size;
	margin-top: 16px;
	padding: 16px 18px;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
}
.largest .label {
	font-size: 15px;
	font-weight: 600;
}
.largest .explain {
	margin: 4px 0 12px;
}
.largest-row {
	display: grid;
	grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) 10rem 5rem 3rem;
	align-items: center;
	gap: 12px;
	padding: 4px 0;
}
/* Narrow: name and share on the first line, bar and numbers on the second. */
@container largest (max-width: 560px) {
	.largest-row {
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 4px 12px;
	}
	.largest-name {
		grid-row: 1;
		grid-column: 1 / 3;
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.largest-share {
		grid-row: 1;
		grid-column: 3;
	}
	.largest-bar {
		grid-row: 2;
		grid-column: 1;
	}
	.largest-count {
		grid-row: 2;
		grid-column: 2;
	}
	.largest-value {
		grid-row: 2;
		grid-column: 3;
	}
}
.largest-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.largest-bar {
	block-size: 8px;
}
.largest-bar span {
	display: block;
	block-size: 100%;
	min-inline-size: 2px;
	border-radius: 0 4px 4px 0;
	background: var(--theme--primary, var(--primary));
}
.largest-count {
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.largest-value,
.largest-share {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.largest-share {
	font-weight: 600;
}
.largest-share--kept {
	cursor: pointer;
	color: var(--theme--success, var(--success));
}
.largest-bar--kept span {
	background: var(--theme--foreground-subdued, var(--foreground-subdued));
	opacity: 0.5;
}
.count {
	cursor: pointer;
	margin-left: 6px;
	padding: 0 6px;
	border-radius: 10px;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	background: var(--theme--background-subdued, var(--background-subdued));
}
</style>
