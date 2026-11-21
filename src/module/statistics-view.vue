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
				<p class="sidebar-text">
					What actually happened in this Directus process: every time a change asked Directus to clear the cache, and
					what was cleared. The page refreshes every 15 seconds.
				</p>
				<p class="sidebar-text">
					<strong>Cache Size</strong> counts the memory store directly. Directus keeps an expired cached response until someone
					asks for it again, so cached responses nobody asks for again would stay in memory. The extension deletes them every
					minute. With Redis, Redis removes them itself.
				</p>
				<p class="sidebar-text">
					The numbers live in memory. They start at zero when Directus restarts and are counted per process.
				</p>
				<p class="sidebar-text">
					Directus does not report cache hits and misses. What this page can show is how often the cache is emptied, how
					much stays in memory, and what share of changes left other cached responses in place (Granular Cache and never-clear
					rules).
				</p>
				<p class="sidebar-text">
					The <router-link to="/cache-manager/analysis">Analysis</router-link> page looks back further: it counts changes in
					the activity log.
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
				<p class="explain intro">What changes did since Directus started ({{ new Date(data.status.since).toLocaleString() }}).</p>
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
							Whole Cache
							<v-icon
								v-tooltip.top="'Changes that cleared every cached response. In Granular mode only changes that can affect every cached response do this (users, roles, permissions, settings, data model), plus a manual clear and switching to Granular.'"
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
								v-tooltip.top="`${formatNumber(data.status.counts.removed)} ${data.status.counts.removed === 1 ? 'cached response' : 'cached responses'} cleared in total.`"
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
								v-tooltip.top="'Changes that did not clear anything because of a rule.'"
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
								v-tooltip.top="'Average time between whole-cache clears since Directus started, counted in minutes like Analysis: several clears in the same minute count once. If it is much shorter than the Cache Lifetime, cached responses almost never live as long as the lifetime allows.'"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
				</section>
				<p v-if="data.status.targetedActive" class="meta">
					{{ formatNumber(data.status.indexed) }} cached responses right now.
					<template v-if="topCollections.length">Most used: {{ topCollections.join(', ') }}.</template>
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="memory" /></template>
					Cache Size
				</v-divider>
				<template v-if="data.status.size">
					<p class="explain intro">How much the cache holds in the memory of this Directus process right now.</p>
					<section class="summary-bar" aria-label="Cache size">
						<div class="stat">
							<span class="stat-value">{{ formatBytes(data.status.size.bytes) }}</span>
							<span class="stat-label">
								Size
								<v-icon
									v-tooltip.top="`${formatNumber(data.status.size.entries)} ${data.status.size.entries === 1 ? 'entry' : 'entries'}. About the size of the stored data; Node.js needs some more memory around it. A few megabytes after many whole-cache clears usually means the cache is rebuilt constantly.`"
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
									v-tooltip.top="'Largest size measured in the last 24 hours (since Directus started, if that is shorter). If it stays close to the current size while the cache is emptied often, the cache never gets the chance to grow.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ formatBytes(data.status.swept.bytes) }}</span>
							<span class="stat-label">
								Freed
								<v-icon
									v-tooltip.top="`${formatNumber(data.status.swept.entries)} expired ${data.status.swept.entries === 1 ? 'entry' : 'entries'} deleted since Directus started. Directus itself only deletes an expired entry when someone asks for it again. Cache Manager deletes them within about a minute.`"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
					</section>
					<div v-if="largest.length" class="largest">
						<span class="label">Largest Collections</span>
						<p class="explain">Cached responses that use several collections count for each of them.</p>
						<div v-for="row in largest" :key="row.name" class="largest-row">
							<span class="largest-name">{{ row.name }}</span>
							<span class="largest-bar"><span :style="{ inlineSize: `${row.share * 100}%` }" /></span>
							<span class="largest-value">{{ formatBytes(row.bytes) }}</span>
						</div>
					</div>
					<p v-else-if="!data.status.targetedActive" class="meta">The size per collection is measured in Granular mode.</p>
				</template>
				<p v-else class="explain intro">
					The size can only be measured when the cache is on and kept in memory (CACHE_STORE=memory). This Directus uses
					{{ data.status.store }}.
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="bar_chart" /></template>
					Last 24 Hours
				</v-divider>
				<p class="explain intro">Per hour, since Directus started. Hover a bar for the numbers.</p>
				<div class="charts">
					<hour-bars title="Changes" :columns="clearColumns" :legend="clearLegend" :format="(v) => formatNumber(v)" empty-text="No changes yet." />
					<hour-bars v-if="data.status.size" title="Cache Size" :columns="sizeColumns" :legend="sizeLegend" :format="formatBytes" empty-text="The cache is empty." />
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="list" /></template>
					Recent Events
				</v-divider>
				<p class="explain intro">The latest changes that asked Directus to clear the cache, newest first. Identical ones in the same second are shown once, with a count.</p>

				<div v-if="events.length" class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Time</th>
								<th>What happened</th>
								<th>Result</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(event, i) in events" :key="i">
								<td class="time">{{ new Date(event.at).toLocaleTimeString() }}</td>
								<td>
									{{ event.reason }}
									<span v-if="event.count > 1" v-tooltip="`${event.count} times in the same second`" class="count">×{{ event.count }}</span>
								</td>
								<td>
									<span class="result" :class="`result--${event.kind}`">{{ resultText(event) }}</span>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p v-else class="empty subdued">Nothing yet. Started {{ new Date(data.status.since).toLocaleString() }}.</p>
				<p class="meta">Counted in memory since {{ new Date(data.status.since).toLocaleString() }}.</p>
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

const topCollections = computed(() =>
	Object.entries(data.value?.status.indexedByCollection ?? {})
		.filter(([name]) => name !== '*')
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => `${name} (${formatNumber(count)})`),
);

const COLORS = {
	full: 'var(--theme--warning, var(--warning))',
	targeted: 'var(--theme--success, var(--success))',
	skipped: 'var(--theme--foreground-subdued, var(--foreground-subdued))',
	size: 'var(--theme--primary, var(--primary))',
};
const clearLegend = [
	{ label: 'Whole cache', color: COLORS.full },
	{ label: 'Granular', color: COLORS.targeted },
	{ label: 'Kept by rule', color: COLORS.skipped },
];
const sizeLegend = [{ label: 'Largest size in the hour', color: COLORS.size }];

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
		tooltip: `${hourRange(h.hour)}: whole cache ${formatNumber(h.full)}, granular ${formatNumber(h.targeted)}, kept by rule ${formatNumber(h.skipped)}`,
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

const largest = computed(() => {
	const rows = Object.entries(data.value?.status.bytesByCollection ?? {})
		.filter(([name]) => name !== '*')
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8);
	const top = rows[0]?.[1] || 1;
	return rows.map(([name, bytes]) => ({ name, bytes, share: bytes / top }));
});

function times(count: number): string {
	return `${formatNumber(count)} ${count === 1 ? 'time' : 'times'}`;
}

const events = computed(() => groupEvents(data.value?.status.recent ?? []));

function resultText(event: GroupedEvent): string {
	if (event.kind === 'full') return 'Whole cache cleared';
	if (event.kind === 'skipped') return 'Kept (rule)';
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
.result--full {
	color: var(--theme--warning, var(--warning));
}
.result--targeted {
	color: var(--theme--success, var(--success));
}
.result--skipped {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
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
	grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) 6rem;
	align-items: center;
	gap: 12px;
	padding: 4px 0;
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
.largest-value {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.count {
	margin-left: 6px;
	padding: 0 6px;
	border-radius: 10px;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	background: var(--theme--background-subdued, var(--background-subdued));
}
</style>
