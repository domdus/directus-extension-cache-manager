<template>
	<private-view title="Analysis" icon="insights">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loadingAnalysis" :disabled="saving" @click="loadAnalysis">
				<v-icon name="refresh" />
			</v-button>
			<v-button v-tooltip.bottom="'Save & apply'" rounded icon :loading="saving" :disabled="!dirty || busy" @click="save">
				<v-icon name="check" />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="How it counts" :close="false">
				<p class="sidebar-text">
					The numbers come from <code>directus_activity</code>: creates, updates and deletes per collection, grouped by
					minute.
				</p>
				<p class="sidebar-text">
					A minute counts as a <strong>full purge</strong> when at least one collection that is not ignored was written in
					it. Each such write clears the entire response cache. Lower is better.
				</p>
				<p class="sidebar-text">
					Writes made without a user context (for example some Flows) are not logged in the activity, so the numbers can
					be too low. Batch writes count every item, but clear the cache once.
				</p>
			</sidebar-detail>
			<sidebar-detail id="strategy" icon="lightbulb" title="Choosing the ignore list">
				<p class="sidebar-text">
					Ignore write-heavy collections (counters, logs, sessions, analytics) that apps either do not read through the
					cache or read with <code>Cache-Control: no-store</code>.
				</p>
				<p class="sidebar-text">
					Do not ignore collections that apps read for access decisions (subscriptions, purchases, entitlements), unless
					those reads send <code>no-store</code>. Otherwise a user can get or lose access up to CACHE_TTL late.
				</p>
			</sidebar-detail>
			<sidebar-detail id="recommendations" icon="recommend" title="Recommendations">
				<p class="sidebar-text">A collection is recommended when it</p>
				<ul class="sidebar-list">
					<li>is not ignored yet,</li>
					<li>was written in at least {{ formatPercent(RECOMMEND_MIN_SHARE) }} of the minutes,</li>
					<li>
						is not a system collection (<code>directus_*</code>, except activity, presets, notifications and revisions),
					</li>
					<li>
						is not mostly edited in the Data Studio: at most {{ formatPercent(EDITOR_SHARE_MAX) }} of its writes came from
						logged-in users on PUBLIC_URL.
					</li>
				</ul>
				<p class="sidebar-text"><strong>Purge minutes saved</strong>: minutes without a full purge if you also ignore this collection.</p>
			</sidebar-detail>
			<stale-reads-detail />
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>
			<pending-changes />

			<div class="toolbar">
				<v-select v-model="hours" :items="hourItems" inline />
			</div>

			<div v-if="!analysis && loadingAnalysis" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="analysis">
				<div class="tiles">
					<div class="tile">
						<span class="label">Minutes in which the whole cache was cleared</span>
						<span class="value">{{ formatMinutes(analysis.purgeMinutes, analysis.windowMinutes) }}</span>
						<span class="explain">
							In {{ formatNumber(analysis.purgeMinutes) }} of the last {{ formatNumber(analysis.windowMinutes) }} minutes at
							least one write to a collection that is not ignored cleared the entire response cache. Lower is better: the
							cache can only serve responses between purges.
						</span>
					</div>

					<div v-if="dirty" class="tile changed">
						<span class="label">After saving your selection</span>
						<span class="value">{{ formatMinutes(whatIf, analysis.windowMinutes) }}</span>
						<span class="explain">{{ compare(whatIf) }}</span>
					</div>
					<div v-else class="tile empty">
						<span class="label">After saving your selection</span>
						<span class="explain">No changes selected. Tick collections below to see the effect.</span>
					</div>

					<div class="tile">
						<span class="label">If you ignore the recommended collections</span>
						<template v-if="analysis.recommendedList.length">
							<span class="value">{{ formatMinutes(analysis.recommendedPurgeMinutes, analysis.windowMinutes) }}</span>
							<span class="explain">{{ compare(analysis.recommendedPurgeMinutes) }} Lower is better.</span>
						</template>
						<span v-else class="explain">Nothing to recommend for this window.</span>
					</div>
				</div>

				<div class="toolbar">
					<v-button small secondary :disabled="!addableRecommendations.length" @click="add(addableRecommendations)">
						Select {{ addableRecommendations.length }} recommended
					</v-button>
					<div class="add-other">
						<select v-model="otherCollection" class="native-select" aria-label="Another collection">
							<option value="">Select another collection…</option>
							<option v-for="name in otherCollections" :key="name" :value="name">{{ name }}</option>
						</select>
						<v-button small secondary :disabled="!otherCollection" @click="addOther">Select</v-button>
					</div>
				</div>

				<table class="analysis">
					<thead>
						<tr>
							<th>Ignore</th>
							<th>Collection</th>
							<th class="num">Writes</th>
							<th class="num">Minutes with writes</th>
							<th class="num">% of minutes</th>
							<th class="num">Purge minutes saved</th>
							<th>Ignored now</th>
							<th>Recommendation</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in rows" :key="row.collection">
							<td><v-checkbox :model-value="draftSet.has(row.collection)" @update:model-value="toggle(row.collection, $event)" /></td>
							<td><code>{{ row.collection }}</code></td>
							<td class="num">{{ formatNumber(row.writes) }}</td>
							<td class="num">{{ formatNumber(row.minutes) }}</td>
							<td class="num">{{ formatPercent(row.share) }}</td>
							<td class="num">{{ row.ignored ? '–' : formatNumber(row.savedMinutes) }}</td>
							<td>{{ row.ignored ? 'yes' : 'no' }}</td>
							<td>
								<span v-if="row.recommended" class="badge">Ignore</span>
								<span class="subdued">{{ row.reason }}</span>
							</td>
						</tr>
					</tbody>
				</table>

				<p class="meta">
					Last {{ formatHours(analysis.hours) }}, {{ new Date(analysis.from).toLocaleString() }} to
					{{ new Date(analysis.to).toLocaleString() }}.
					<template v-if="!analysis.editorHeuristic">
						PUBLIC_URL is not an absolute URL, so Data Studio edits cannot be told apart from other writes.
					</template>
				</p>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CollectionStats } from '../shared/analysis';
import { EDITOR_SHARE_MAX, RECOMMEND_MIN_SHARE } from '../shared/constants';
import { formatHours, formatMinutes, formatNumber, formatPercent } from '../shared/format';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import StaleReadsDetail from './stale-reads-detail.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, analysis, draft, draftSet, hours, busy, dirty, saving, loadingAnalysis, whatIf, error, message, loadState, loadAnalysis, save, toggle, add } =
	useCacheManager();

const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${formatHours(value)}`, value }));
const otherCollection = ref('');

/** Collections with writes plus every collection in a list, so nothing in a list is hidden. */
const rows = computed<CollectionStats[]>(() => {
	const list = analysis.value?.collections ?? [];
	const known = new Set(list.map((row) => row.collection));
	const effective = new Set(state.value?.effective.ignoreList ?? []);
	const extra = new Set([...draft.ignoreList, ...effective, ...(state.value?.baseline.ignoreList ?? [])]);
	const empty = [...extra]
		.filter((name) => !known.has(name))
		.sort()
		.map((collection) => ({
			collection,
			writes: 0,
			minutes: 0,
			share: 0,
			editorWrites: 0,
			ignored: effective.has(collection),
			recommended: false,
			reason: 'No writes in this window',
			savedMinutes: 0,
		}));
	return [...list, ...empty];
});

const addableRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter((name) => !draftSet.value.has(name)));
const otherCollections = computed(() => {
	const shown = new Set(rows.value.map((row) => row.collection));
	return (state.value?.collections ?? []).filter((name) => !shown.has(name));
});

function compare(minutes: number): string {
	const now = analysis.value?.purgeMinutes ?? 0;
	const diff = now - minutes;
	if (diff > 0) return `${formatNumber(diff)} fewer minutes with a full purge than now.`;
	if (diff < 0) return `${formatNumber(-diff)} more minutes with a full purge than now.`;
	return 'Same as now.';
}

function addOther() {
	if (otherCollection.value) toggle(otherCollection.value, true);
	otherCollection.value = '';
}

watch(hours, loadAnalysis);

onMounted(async () => {
	await loadState();
	await loadAnalysis();
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
	color: var(--theme--foreground);
}
.sidebar-list {
	margin: 0 0 16px 20px;
	line-height: 1.55;
	list-style: disc;
}
.toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 16px;
}
.add-other {
	display: flex;
	align-items: center;
	gap: 12px;
}
.native-select {
	padding: 6px 8px;
	border: var(--theme--border-width, 1px) solid var(--theme--form--field--input--border-color, var(--theme--border-color));
	border-radius: var(--theme--border-radius);
	background: var(--theme--form--field--input--background, var(--theme--background));
	color: var(--theme--foreground);
}
.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 12px;
	margin-bottom: 24px;
}
.tile {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 14px 16px;
	border: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}
.tile.changed {
	border-color: var(--theme--primary);
}
.tile.empty .explain {
	font-style: italic;
}
.tile .label {
	font-weight: 600;
}
.tile .value {
	font-size: 20px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.tile .explain,
.subdued,
.meta {
	color: var(--theme--foreground-subdued);
	line-height: 1.5;
}
.meta {
	margin-top: 12px;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	text-align: left;
	padding: 8px 10px;
	border-bottom: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	vertical-align: middle;
}
th {
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}
.num {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.badge {
	display: inline-block;
	padding: 2px 8px;
	margin-right: 6px;
	border-radius: 12px;
	background: var(--theme--primary);
	color: var(--theme--foreground-inverted, #fff);
	font-size: 12px;
}
code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}
</style>
