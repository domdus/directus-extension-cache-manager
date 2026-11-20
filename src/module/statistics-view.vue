<template>
	<private-view title="Statistics" icon="query_stats">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loading" @click="load">
				<v-icon name="refresh" />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About" :close="false">
				<p class="sidebar-text">
					What actually happened in this Directus process: every time a change asked Directus to clear the cache, and
					what was cleared. The page refreshes every 15 seconds.
				</p>
				<p class="sidebar-text">
					The numbers live in memory. They start at zero when Directus restarts and are counted per process.
				</p>
				<p class="sidebar-text">
					The <router-link to="/cache-manager/ignore-list">Ignore List</router-link> page looks back further: it counts changes in
					the activity log.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<div v-if="!data && loading" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="data">
				<v-notice v-if="data.status.problems.length" type="warning" class="notice">
					{{ data.status.problems.join('. ') }}.
				</v-notice>
				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="history" /></template>
					Overview
				</v-divider>
				<p class="explain intro">What changes did since Directus started ({{ new Date(data.status.since).toLocaleString() }}).</p>

				<div class="tiles">
					<div class="tile">
						<span class="label">Whole Cache</span>
						<span class="value">{{ times(data.status.counts.full) }}</span>
						<span class="explain">Changes that cleared every cached answer.</span>
					</div>
					<div class="tile">
						<span class="label">Granular</span>
						<span class="value">{{ times(data.status.counts.targeted) }}</span>
						<span class="explain">Changes that cleared only the answers using their collection: {{ formatNumber(data.status.counts.removed) }} {{ data.status.counts.removed === 1 ? 'answer' : 'answers' }} in total.</span>
					</div>
					<div class="tile">
						<span class="label">Kept by Rule</span>
						<span class="value">{{ formatNumber(data.status.counts.skipped) }} {{ data.status.counts.skipped === 1 ? 'change' : 'changes' }}</span>
						<span class="explain">Changes that did not clear anything because of a rule.</span>
					</div>
				</div>
				<p v-if="data.status.targetedActive" class="meta">
					{{ formatNumber(data.status.indexed) }} answers in the cache right now.
					<template v-if="topCollections.length">Most used: {{ topCollections.join(', ') }}.</template>
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="list" /></template>
					Recent Events
				</v-divider>
				<p class="explain intro">The last 50 changes that asked Directus to clear the cache, newest first.</p>

				<div v-if="data.status.recent.length" class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Time</th>
								<th>What happened</th>
								<th>Result</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(event, i) in data.status.recent" :key="i">
								<td class="time">{{ new Date(event.at).toLocaleTimeString() }}</td>
								<td>{{ event.reason }}</td>
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
import { useRules, type RulesStatus } from './composables/use-rules';
import { usePageClass } from './composables/use-page-class';
import { formatNumber } from '../shared/format';

const pageClass = usePageClass();
const { data, loading, error, load } = useRules();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };

const topCollections = computed(() =>
	Object.entries(data.value?.status.indexedByCollection ?? {})
		.filter(([name]) => name !== '*')
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => `${name} (${formatNumber(count)})`),
);

function times(count: number): string {
	return `${formatNumber(count)} ${count === 1 ? 'time' : 'times'}`;
}

function resultText(event: RulesStatus['recent'][number]): string {
	if (event.kind === 'full') return 'Whole cache cleared';
	if (event.kind === 'skipped') return 'Kept (rule)';
	return `${formatNumber(event.removed)} ${event.removed === 1 ? 'answer' : 'answers'} cleared`;
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
.tiles {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16px;
}
@media (max-width: 1100px) {
	.tiles {
		grid-template-columns: 1fr;
	}
}
.tile {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	padding: 16px 18px;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	background: var(--theme--background, var(--background-page));
}
.tile .label {
	font-size: 15px;
	font-weight: 600;
}
.tile .value {
	font-size: 18px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
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
	font-weight: 700;
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
</style>
