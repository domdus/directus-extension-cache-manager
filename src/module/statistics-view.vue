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
					This page shows how often the cache is cleared, how often apps get a response from it, how big it is, and how
					many changes kept the rest of the cache. Directus doesn't count cache hits itself; Cache Manager does.
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
						<stat-trend :trend="trends.full" />
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
						<stat-trend :trend="trends.targeted" />
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
						<stat-trend :trend="trends.skipped" />
						<span class="stat-label">
							Ignored by Rule
							<v-icon
								v-tooltip.top="'Changes a rule ignored: they cleared nothing.'"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
					<div v-if="emptiedEvery" class="stat">
						<span class="stat-value">{{ emptiedEvery }}</span>
						<stat-trend :trend="trends.emptied" />
						<span class="stat-label">
							{{ data.status.shared ? 'Emptied by This Server' : 'Emptied' }}
							<v-icon
								v-tooltip.top="`Average time between global cache clears. Several clears in one minute count once. If this is much shorter than the Cache Lifetime, cached responses rarely reach their lifetime.${data.status.shared ? ' With Redis, each server counts only its own clears; a clear on another server also empties the shared cache, so it is emptied more often.' : ''}`"
								name="help_outline"
								small
								class="stat-info"
							/>
						</span>
					</div>
				</section>

				<template v-if="reads">
					<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
						<template #icon><v-icon name="bolt" /></template>
						Cache Hits
					</v-divider>
					<p class="explain intro">How often apps got a response from the cache since Directus started.</p>
					<section class="summary-bar" aria-label="Cache hits">
						<div class="stat">
							<span class="stat-value">{{ hitRateValue === null ? '–' : `${Math.round(hitRateValue * 100)} %` }}</span>
							<stat-trend :trend="trends.hitRate" />
							<span class="stat-label">
								Hit Rate
								<v-icon
									v-tooltip.top="hitRateValue === null ? `Shown from ${MIN_REQUESTS_FOR_RATE} requests on.` : 'Share of requests answered from the cache: hits ÷ (hits + misses). Fresh requests don\'t count.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ formatNumber(reads.hits) }}</span>
							<stat-trend :trend="trends.hits" />
							<span class="stat-label">
								Hits
								<v-icon v-tooltip.top="'Requests answered from the cache.'" name="help_outline" small class="stat-info" />
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ formatNumber(reads.misses) }}</span>
							<stat-trend :trend="trends.misses" />
							<span class="stat-label">
								Misses
								<v-icon
									v-tooltip.top="'Responses that weren\'t in the cache: Directus built them and stored them.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div v-if="reads.fresh > 0" class="stat">
							<span class="stat-value">{{ formatNumber(reads.fresh) }}</span>
							<span class="stat-label">
								Fresh Requests
								<v-icon
									v-tooltip.top="'Requests with the header Cache-Control: no-store. Directus skips the cache for them (CACHE_SKIP_ALLOWED). Apps should send it only where they need the latest data, such as payments.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
					</section>
					<section v-if="speed" class="summary-bar" aria-label="Response times">
						<div class="stat">
							<span class="stat-value">{{ speed.hit === null ? '–' : msText(speed.hit) }}</span>
							<stat-trend :trend="trends.hitTime" />
							<span class="stat-label">
								Avg Hit Time
								<v-icon
									v-tooltip.top="speed.hit === null ? `Shown from ${MIN_TIMED_REQUESTS} hits on.` : 'Average time Directus took to answer from the cache. Network time to the app is not included.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ speed.miss === null ? '–' : msText(speed.miss) }}</span>
							<stat-trend :trend="trends.missTime" />
							<span class="stat-label">
								Avg Miss Time
								<v-icon
									v-tooltip.top="speed.miss === null ? `Shown from ${MIN_TIMED_REQUESTS} misses on.` : 'Average time Directus took to build a response that wasn\'t in the cache. Network time to the app is not included.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ speed.saved === null ? '–' : savedText(speed.saved) }}</span>
							<stat-trend :trend="trends.saved" />
							<span class="stat-label">
								Time Saved
								<v-icon
									v-tooltip.top="'Time the cache saved since Directus started: hits × (avg miss time − avg hit time).'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
					</section>
					<div v-if="hitRows.length" class="largest">
						<span class="label">Hit Rate by Collection</span>
						<p class="explain">
							How many requests that use the collection got their response from the cache. Higher is better. A response that uses several collections counts in each of their rows. Times: average hit / miss time.
						</p>
						<div v-for="row in hitRows" :key="row.name" class="largest-row hits-row">
							<span class="largest-name">{{ row.name }}</span>
							<span class="largest-bar largest-bar--hits"><span :style="{ inlineSize: `${(row.rate ?? 0) * 100}%` }" /></span>
							<span class="largest-count">{{ formatNumber(row.hits) }} {{ row.hits === 1 ? 'hit' : 'hits' }}</span>
							<span class="largest-count">{{ formatNumber(row.misses) }} {{ row.misses === 1 ? 'miss' : 'misses' }}</span>
							<span
								v-if="row.fresh"
								v-tooltip="'Requests to this collection that skipped the cache with Cache-Control: no-store.'"
								class="largest-count largest-count--info"
							>
								{{ formatNumber(row.fresh) }} fresh
							</span>
							<span v-else class="largest-count" />
							<span
								v-if="row.time"
								v-tooltip="`Average response time: ${row.time.hit === null ? '–' : msText(row.time.hit)} from the cache, ${row.time.miss === null ? '–' : msText(row.time.miss)} without.`"
								class="largest-count largest-time"
							>
								{{ row.time.hit === null ? '–' : msText(row.time.hit) }} / {{ row.time.miss === null ? '–' : msText(row.time.miss) }}
							</span>
							<span v-else class="largest-count largest-time" />
							<span class="largest-share">{{ row.rate === null ? '' : `${Math.round(row.rate * 100)} %` }}</span>
						</div>
					</div>
					<p v-else-if="reads.hits + reads.misses > 0 && !data.status.readsByCollection" class="meta">
						{{ data.status.shared ? 'With Redis, hits are counted in total only.' : 'Hit rate per collection is shown in Granular mode only.' }}
					</p>
				</template>

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
				</template>
				<p v-else class="explain intro">
					<template v-if="data.status.store === 'memory'">No size while the cache is off.</template>
					<template v-else>
						The size is shown only for a cache in memory (CACHE_STORE=memory). This Directus uses {{ data.status.store }},
						shared by all Directus servers.
					</template>
				</p>
				<div v-if="clearedRows.length" class="largest">
					<span class="label">Cleared by Changes</span>
					<p class="explain">
						Cached responses that changes to each collection removed since Directus started, the most first. Orange: changes
						that cleared the whole cache.
					</p>
					<div v-for="row in clearedRows" :key="row.name" class="largest-row cleared-row">
						<span class="largest-name">{{ row.name }}</span>
						<span class="largest-bar" :class="{ 'largest-bar--full': row.full > 0 }"><span :style="{ inlineSize: `${row.bar * 100}%` }" /></span>
						<span class="largest-count">{{ formatNumber(row.changes) }} {{ row.changes === 1 ? 'change' : 'changes' }}</span>
						<span class="largest-count">{{ formatNumber(row.removedTotal) }} {{ row.removedTotal === 1 ? 'response' : 'responses' }}</span>
						<span
							v-if="row.full"
							v-tooltip="`${formatNumber(row.full)} of its changes cleared the whole cache (${formatNumber(row.fullRemoved)} cached responses).`"
							class="largest-count cleared-full"
						>
							whole cache {{ formatNumber(row.full) }}×
						</span>
						<span
							v-else-if="row.ignored"
							v-tooltip="`${formatNumber(row.ignored)} of its changes were ignored by its rule and cleared nothing.`"
							class="largest-count cleared-ignored"
						>
							{{ formatNumber(row.ignored) }} ignored
						</span>
						<span v-else class="largest-count" />
					</div>
					<p v-if="data.status.shared" class="explain largest-note">
						With Redis, the number of responses a whole-cache clear removed isn't known.
					</p>
				</div>
				<p v-else-if="data.status.targetedActive" class="meta">No change has cleared anything yet.</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="bar_chart" /></template>
					Last 24 Hours
				</v-divider>
				<p class="explain intro">Per hour. Hover a bar for the numbers.</p>
				<div class="charts">
					<hour-bars title="Changes" :columns="clearColumns" :legend="clearLegend" :format="(v) => formatNumber(v)" empty-text="No changes yet." />
					<hour-bars v-if="reads" title="Hits and Misses" :columns="hitColumns" :legend="hitLegend" :format="(v) => formatNumber(v)" empty-text="No cached requests yet." />
					<hour-bars v-if="speed" title="Avg Response Time" :columns="timeColumns" :legend="timeLegend" :format="msText" grouped empty-text="No timed requests yet." />
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
import { formatBytes, formatNumber } from '../shared/format';
import { averageMs, avgTimeTrend, countTrend, emptiedTrend, hitRate, hitRateTrend, MIN_REQUESTS_FOR_RATE, MIN_TIMED_REQUESTS, msText, savedText, savedTrend, timeSavedMs } from '../shared/trend';
import StatTrend from './stat-trend.vue';

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
const reads = computed(() => data.value?.status.reads ?? null);
const hitRateValue = computed(() => (reads.value ? hitRate(reads.value.hits, reads.value.misses) : null));

/** Average hit and miss time and the time saved; null before the first timed request (or with an older API). */
const speed = computed(() => {
	const t = data.value?.status.timings;
	if (!t || t.hits + t.misses === 0) return null;
	return { hit: averageMs(t.hits, t.hitMs), miss: averageMs(t.misses, t.missMs), saved: timeSavedMs(t) };
});

/** Each number compared with 1 hour ago (stock style): green is better, red worse, grey neither. */
const trends = computed(() => {
	const status = data.value?.status;
	const before = status?.hourAgo ?? null;
	if (!status) return {};
	const r = status.reads;
	const t = status.timings;
	return {
		full: countTrend(status.counts.full, before?.full, 'bad'),
		targeted: countTrend(status.counts.targeted, before?.targeted, 'neutral'),
		skipped: countTrend(status.counts.skipped, before?.skipped, 'good'),
		emptied: emptiedTrend(status.counts.fullMinutes ?? 0, status.since, before),
		hitRate: r ? hitRateTrend(r.hits, r.misses, before) : null,
		hits: r ? countTrend(r.hits, before?.hits, 'neutral') : null,
		misses: r ? countTrend(r.misses, before?.misses, 'neutral') : null,
		hitTime: t ? avgTimeTrend(t.hits, t.hitMs, before?.timings?.hits, before?.timings?.hitMs) : null,
		missTime: t ? avgTimeTrend(t.misses, t.missMs, before?.timings?.misses, before?.timings?.missMs) : null,
		saved: savedTrend(t, before?.timings),
	};
});

/** Collections with the most requests, with their hit rate. */
const hitRows = computed(() => {
	const by = data.value?.status.readsByCollection;
	if (!by) return [];
	const times = data.value?.status.timingsByCollection ?? {};
	return Object.entries(by)
		.filter(([name, counts]) => name !== '*' && counts.hits + counts.misses + counts.fresh > 0)
		.map(([name, counts]) => {
			const t = times[name];
			const time = t ? { hit: averageMs(t.hits, t.hitMs), miss: averageMs(t.misses, t.missMs) } : null;
			return { name, ...counts, rate: counts.hits + counts.misses > 0 ? counts.hits / (counts.hits + counts.misses) : null, time: time && (time.hit !== null || time.miss !== null) ? time : null };
		})
		.sort((a, b) => b.hits + b.misses + b.fresh - (a.hits + a.misses + a.fresh))
		.slice(0, 10);
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
	miss: 'var(--theme--foreground-subdued, var(--foreground-subdued))',
};
const clearLegend = [
	{ label: 'Global Cache', color: COLORS.full },
	{ label: 'Granular', color: COLORS.targeted },
	{ label: 'Ignored by Rule', color: COLORS.skipped },
];
const hitLegend = [
	{ label: 'Hits', color: COLORS.targeted },
	{ label: 'Misses', color: COLORS.miss },
];
const timeLegend = [
	{ label: 'Hit', color: COLORS.targeted },
	{ label: 'Miss', color: COLORS.miss },
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
		tooltip: `${hourRange(h.hour)}: global cache ${formatNumber(h.full)}, granular ${formatNumber(h.targeted)}, ignored by rule ${formatNumber(h.skipped)}`,
		segments: [
			{ value: h.full, color: COLORS.full },
			{ value: h.targeted, color: COLORS.targeted },
			{ value: h.skipped, color: COLORS.skipped },
		],
	})),
);

const hitColumns = computed<BarColumn[]>(() =>
	(data.value?.status.history ?? []).map((h) => {
		const hits = h.hits ?? 0;
		const misses = h.misses ?? 0;
		const rate = hits + misses > 0 ? ` (${Math.round((hits / (hits + misses)) * 100)} % hits)` : '';
		return {
			label: hourLabel(h.hour),
			tooltip: `${hourRange(h.hour)}: hits ${formatNumber(hits)}, misses ${formatNumber(misses)}${rate}`,
			segments: [
				{ value: hits, color: COLORS.targeted },
				{ value: misses, color: COLORS.miss },
			],
		};
	}),
);

const timeColumns = computed<BarColumn[]>(() =>
	(data.value?.status.history ?? []).map((h) => {
		// Per hour every timed request counts (no minimum): the tooltip shows how many there were.
		const hits = h.timedHits ?? 0;
		const misses = h.timedMisses ?? 0;
		const hit = hits ? (h.hitMs ?? 0) / hits : 0;
		const miss = misses ? (h.missMs ?? 0) / misses : 0;
		return {
			label: hourLabel(h.hour),
			tooltip: `${hourRange(h.hour)}: hit ${hits ? msText(hit) : '–'} (${formatNumber(hits)}), miss ${misses ? msText(miss) : '–'} (${formatNumber(misses)})`,
			segments: [
				{ value: hit, color: COLORS.targeted },
				{ value: miss, color: COLORS.miss },
			],
		};
	}),
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

/** Collections whose changes removed the most cached responses (granular and whole-cache clears together). */
const clearedRows = computed(() => {
	const by = data.value?.status.clearedBy ?? {};
	const rows = Object.entries(by)
		.map(([name, entry]) => ({ name, ...entry, removedTotal: entry.removed + entry.fullRemoved }))
		.filter((row) => row.removedTotal > 0 || row.full > 0)
		.sort((a, b) => b.removedTotal - a.removedTotal || b.full - a.full || b.changes - a.changes)
		.slice(0, 10);
	const top = Math.max(1, ...rows.map((row) => row.removedTotal));
	return rows.map((row) => ({ ...row, bar: row.removedTotal / top }));
});

function times(count: number): string {
	return `${formatNumber(count)} ${count === 1 ? 'time' : 'times'}`;
}

const events = computed(() => groupEvents(data.value?.status.recent ?? []));

function resultText(event: GroupedEvent): string {
	if (event.kind === 'full') return 'Global cache cleared';
	if (event.kind === 'skipped') return 'Ignored by rule';
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
	grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) 8rem 9rem 5rem 3rem;
	align-items: center;
	gap: 12px;
	padding: 4px 0;
}
/* Narrow: name and the last number on the first line, bar and counts on the second. */
@container largest (max-width: 560px) {
	.largest-row {
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 4px 12px;
	}
	.largest-name {
		grid-row: 1;
		grid-column: 1;
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
	white-space: nowrap;
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.largest-share {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.largest-share {
	font-weight: 600;
}
.largest-note {
	margin: 12px 0 0;
}
.hits-row {
	grid-template-columns: minmax(0, 12rem) minmax(0, 1fr) 5.5rem 6rem 5rem 8rem 3rem;
}
@container largest (max-width: 560px) {
	.hits-row {
		grid-template-columns: minmax(0, 1fr) auto auto;
	}
	.hits-row > :nth-child(3) {
		grid-row: 2;
		grid-column: 2;
	}
	.hits-row > :nth-child(4) {
		grid-row: 2;
		grid-column: 3;
	}
	.hits-row > :nth-child(5) {
		grid-row: 1;
		grid-column: 2;
	}
	.hits-row > .largest-time {
		grid-row: 3;
		grid-column: 1 / -1;
		text-align: left;
	}
}
.cleared-row {
	grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) 7rem 9rem 8rem;
}
@container largest (max-width: 560px) {
	.cleared-row {
		grid-template-columns: minmax(0, 1fr) auto auto;
	}
	.cleared-row > :nth-child(3) {
		grid-row: 1;
		grid-column: 2;
	}
	.cleared-row > :nth-child(4) {
		grid-row: 2;
		grid-column: 2;
	}
	.cleared-row > :nth-child(5) {
		grid-row: 2;
		grid-column: 3;
	}
}
.largest-bar--full span {
	background: var(--theme--warning, var(--warning));
}
.cleared-full {
	cursor: pointer;
	color: var(--theme--warning, var(--warning));
}
.cleared-ignored {
	cursor: pointer;
	color: var(--blue, #3399ff);
}
.largest-bar--hits span {
	background: var(--theme--success, var(--success));
}
.largest-count--info {
	cursor: pointer;
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
