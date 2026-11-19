<template>
	<private-view title="Analysis" icon="insights">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon small secondary :loading="loadingAnalysis" :disabled="saving" @click="loadAnalysis">
				<v-icon name="refresh" small />
			</v-button>
			<v-button v-tooltip.bottom="'Save & apply'" rounded icon small :loading="saving" :disabled="!dirty || busy" @click="save">
				<v-icon name="check" small />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="How it counts" :close="false">
				<p class="sidebar-text">
					Directus keeps a copy of its answers, the cache, so it does not have to ask the database every time.
				</p>
				<p class="sidebar-text">
					A change to a collection that is not selected clears the whole cache. This page counts in how many minutes that
					happened at least once. Several changes in the same minute count as one.
				</p>
				<p class="sidebar-text">
					The numbers come from the activity log. Some automatic changes, for example from some Flows, are not in the
					activity log. The real numbers can be higher.
				</p>
			</sidebar-detail>
			<sidebar-detail id="strategy" icon="lightbulb" title="What to select">
				<p class="sidebar-text">
					Good choices change very often, and nobody needs them up to date to the second: counters, logs, statistics.
				</p>
				<p class="sidebar-text">
					Don't select collections that decide what users may see or buy, like subscriptions, purchases or access rights.
					Only select them if the apps that read them ask for fresh data.
				</p>
			</sidebar-detail>
			<sidebar-detail id="recommendations" icon="recommend" title="How suggestions are made">
				<p class="sidebar-text">A collection is suggested when it</p>
				<ul class="sidebar-list">
					<li>changes in at least {{ formatPercent(RECOMMEND_MIN_SHARE) }} of all minutes,</li>
					<li>is not a Directus system collection,</li>
					<li>is not mostly changed by editors in the Data Studio.</li>
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
						<span class="label">How often the cache is cleared</span>
						<div class="figure">
							<span class="value">{{ formatShare(nowShare) }}</span>
							<span class="unit">of all minutes</span>
						</div>
						<span class="explain">
							The cache was cleared in {{ formatMinutes(analysis.purgeMinutes, analysis.windowMinutes) }}
							({{ formatRate(analysis.purgeMinutes, analysis.windowMinutes) }}). Lower is better:
							after clearing, Directus has to load everything from the database again.
						</span>
					</div>

					<div class="tile" :class="{ changed: dirty }">
						<span class="label">With your selection</span>
						<template v-if="dirty">
							<div class="figure">
								<span class="value">{{ formatShare(share(whatIf)) }}</span>
								<span class="unit">instead of {{ formatShare(nowShare) }}</span>
							</div>
							<span class="explain">
								The cache would have been cleared in {{ formatMinutes(whatIf, analysis.windowMinutes) }}
								({{ formatRateCompare(whatIf, analysis.purgeMinutes, analysis.windowMinutes) }}). Lower is better.
							</span>
						</template>
						<span v-else class="explain">No changes selected yet. Tick collections in the table below to see the effect here.</span>
					</div>

					<div class="tile">
						<span class="label">Suggestion</span>
						<template v-if="analysis.recommendedList.length">
							<div class="figure">
								<span class="value">{{ formatShare(share(analysis.recommendedPurgeMinutes)) }}</span>
								<span class="unit">instead of {{ formatShare(nowShare) }}</span>
							</div>
							<span class="text">
								Don't clear the cache when {{ analysis.recommendedList.length === 1 ? 'this collection changes' : 'these collections change' }}:
								{{ analysis.recommendedList.join(', ') }}.
							</span>
							<span class="explain">
								The cache would have been cleared in
								{{ formatMinutes(analysis.recommendedPurgeMinutes, analysis.windowMinutes) }}
								({{ formatRateCompare(analysis.recommendedPurgeMinutes, analysis.purgeMinutes, analysis.windowMinutes) }}).
								Lower is better.
							</span>
							<div>
								<v-button small :secondary="!addableRecommendations.length" :disabled="!addableRecommendations.length" @click="add(addableRecommendations)">
									{{ addableRecommendations.length ? 'Select suggestion' : 'Suggestion selected' }}
								</v-button>
							</div>
							<span class="explain">Only do this if no app needs these entries to be up to date right away.</span>
						</template>
						<span v-else class="explain">No suggestion. No collection changes often enough to matter.</span>
					</div>
				</div>

				<div class="toolbar">
					<span class="subdued">All numbers: {{ formatPeriod(analysis.hours) }}.</span>
					<div class="add-other">
						<v-select
							:model-value="null"
							:items="otherCollectionChoices"
							:disabled="!otherCollectionChoices.length"
							placeholder="Select another collection…"
							@update:model-value="addOther"
						/>
					</div>
				</div>

				<table class="analysis">
					<thead>
						<tr>
							<th>Don't clear the cache on changes</th>
							<th>Collection</th>
							<th class="num">Changes</th>
							<th class="num">Changed in</th>
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
							<td class="num">{{ formatMinutesShort(row.minutes, analysis.windowMinutes) }}</td>
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
					{{ new Date(analysis.from).toLocaleString() }} to {{ new Date(analysis.to).toLocaleString() }}.
					"Changed in" counts the minutes with at least one change, and how many that is per hour. "Effect if selected" shows how much less often the
					cache would be cleared if you also select that collection. A bigger drop is better.
					<template v-if="!analysis.editorHeuristic">
						The public address of Directus is not a full URL, so changes by editors can't be told apart from changes by
						apps.
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
import {
	formatMinutes,
	formatMinutesShort,
	formatNumber,
	formatPercent,
	formatPeriod,
	formatRate,
	formatRateCompare,
	formatSaved,
	formatShare,
	formatWindow,
} from '../shared/format';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, analysis, draft, draftSet, hours, busy, dirty, saving, loadingAnalysis, whatIf, error, message, loadState, loadAnalysis, save, toggle, add } =
	useCacheManager();

const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${formatWindow(value)}`, value }));

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
			reason: 'No changes in this time',
			savedMinutes: 0,
		}));
	return [...list, ...empty];
});

const addableRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter((name) => !draftSet.value.has(name)));
const otherCollections = computed(() => {
	const shown = new Set(rows.value.map((row) => row.collection));
	return (state.value?.collections ?? []).filter((name) => !shown.has(name));
});

/** Collections without changes in the period, for the picker above the table. */
const otherCollectionChoices = computed(() => otherCollections.value.map((name) => ({ text: name, value: name })));

/** Picking a collection selects it right away (no separate button). */
function addOther(name: string | null) {
	if (name) toggle(name, true);
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
	width: 100%;
	max-width: 320px;
}
.tiles {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16px;
	margin-bottom: 24px;
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
	border-radius: var(--theme--border-radius);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	background: var(--theme--background);
}
.tile.changed {
	border-color: var(--theme--primary);
}
.tile.empty .explain {
	font-style: italic;
}
.tile .label {
	font-size: 15px;
	font-weight: 600;
	letter-spacing: 0.01em;
}
.tile .figure {
	display: flex;
	align-items: baseline;
	gap: 8px;
	flex-wrap: wrap;
}
.tile .unit {
	color: var(--theme--foreground-subdued);
}
.tile .value {
	font-size: 18px;
	font-weight: 600;
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
