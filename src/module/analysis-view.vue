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
					Directus keeps answers in a cache so it does not have to read the database every time. A change to a collection
					that is not selected here empties the whole cache.
				</p>
				<p class="sidebar-text">
					This page counts, minute by minute, in how many minutes that happened. The numbers come from the activity log.
				</p>
				<p class="sidebar-text">
					Some changes are not in the activity log (for example from some Flows), so the real numbers can be higher.
				</p>
			</sidebar-detail>
			<sidebar-detail id="strategy" icon="lightbulb" title="What to select">
				<p class="sidebar-text">
					Good candidates change very often and nobody needs them up to date to the second: counters, logs, statistics.
				</p>
				<p class="sidebar-text">
					Do not select collections that decide what users may see or buy (subscriptions, purchases, access rights),
					unless the apps reading them ask for fresh data.
				</p>
			</sidebar-detail>
			<sidebar-detail id="recommendations" icon="recommend" title="How suggestions are made">
				<p class="sidebar-text">A collection is suggested when it</p>
				<ul class="sidebar-list">
					<li>changes at least {{ formatPercent(RECOMMEND_MIN_SHARE) }} of the time,</li>
					<li>is not a Directus system collection,</li>
					<li>is not mostly edited by people in the Data Studio.</li>
				</ul>
			</sidebar-detail>
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
						<span class="label">Cache emptied</span>
						<span class="value">{{ formatShare(nowShare) }} of the time</span>
						<span class="explain">in {{ formatMinutes(analysis.purgeMinutes, analysis.windowMinutes) }}</span>
						<span class="explain">
							While the cache is empty, Directus has to build every answer from the database again, which is slower.
						</span>
					</div>

					<div class="tile" :class="{ changed: dirty }">
						<span class="label">With your selection</span>
						<span v-if="dirty" class="text">
							The cache would be emptied <strong>{{ formatShare(share(whatIf)) }}</strong> of the time instead of
							{{ formatShare(nowShare) }}.
						</span>
						<span v-else class="explain">No changes selected. Tick collections below to see the effect.</span>
					</div>

					<div class="tile">
						<span class="label">Suggestion</span>
						<template v-if="analysis.recommendedList.length">
							<span class="text">
								Stop emptying the cache on changes to {{ analysis.recommendedList.length }}
								{{ analysis.recommendedList.length === 1 ? 'collection' : 'collections' }}
								({{ analysis.recommendedList.join(', ') }}).
							</span>
							<span class="text">
								Then the cache would be emptied only <strong>{{ formatShare(share(analysis.recommendedPurgeMinutes)) }}</strong>
								of the time instead of {{ formatShare(nowShare) }}.
							</span>
							<div>
								<v-button small :secondary="!addableRecommendations.length" :disabled="!addableRecommendations.length" @click="add(addableRecommendations)">
									{{ addableRecommendations.length ? 'Select suggestion' : 'Suggestion selected' }}
								</v-button>
							</div>
							<span class="explain">Only do this if no app needs these entries to be up to date immediately.</span>
						</template>
						<span v-else class="explain">No suggestion – nothing changes often enough to matter.</span>
					</div>
				</div>

				<div class="toolbar">
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
							<th>Don't empty cache on changes</th>
							<th>Collection</th>
							<th class="num">Changes</th>
							<th class="num">Changed during</th>
							<th class="num">Effect if selected</th>
							<th>Status</th>
							<th>Suggestion</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in rows" :key="row.collection">
							<td><v-checkbox :model-value="draftSet.has(row.collection)" @update:model-value="toggle(row.collection, $event)" /></td>
							<td><code>{{ row.collection }}</code></td>
							<td class="num">{{ formatNumber(row.writes) }}</td>
							<td class="num">{{ formatShare(row.share) }} of the time</td>
							<td class="num">{{ row.ignored ? '–' : formatSaved(share(row.savedMinutes)) }}</td>
							<td>{{ row.ignored ? 'Already selected' : '–' }}</td>
							<td>
								<span v-if="row.recommended" class="badge">Suggested</span>
								<span v-else-if="!row.ignored" class="subdued">{{ row.reason }}</span>
							</td>
						</tr>
					</tbody>
				</table>

				<p class="meta">
					Last {{ formatWindow(analysis.hours) }}, {{ new Date(analysis.from).toLocaleString() }} to
					{{ new Date(analysis.to).toLocaleString() }}. "Effect if selected" is how much less often the cache would be
					emptied if you also select that collection.
					<template v-if="!analysis.editorHeuristic">
						PUBLIC_URL is not a full URL, so edits in the Data Studio cannot be told apart from other changes.
					</template>
				</p>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CollectionStats } from '../shared/analysis';
import { RECOMMEND_MIN_SHARE } from '../shared/constants';
import { formatMinutes, formatNumber, formatPercent, formatSaved, formatShare, formatWindow } from '../shared/format';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, analysis, draft, draftSet, hours, busy, dirty, saving, loadingAnalysis, whatIf, error, message, loadState, loadAnalysis, save, toggle, add } =
	useCacheManager();

const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${formatWindow(value)}`, value }));
const otherCollection = ref('');

function share(minutes: number): number {
	const total = analysis.value?.windowMinutes ?? 0;
	return total ? minutes / total : 0;
}
const nowShare = computed(() => share(analysis.value?.purgeMinutes ?? 0));

/** Collections with changes plus every selected or configured collection, so nothing selected is hidden. */
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
			reason: 'No changes in this time window',
			savedMinutes: 0,
		}));
	return [...list, ...empty];
});

const addableRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter((name) => !draftSet.value.has(name)));
const otherCollections = computed(() => {
	const shown = new Set(rows.value.map((row) => row.collection));
	return (state.value?.collections ?? []).filter((name) => !shown.has(name));
});

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
.tile .text {
	line-height: 1.5;
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
