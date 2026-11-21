<template>
	<private-view title="Ignore List" icon="playlist_remove">
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
			<save-actions />
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="Counting" :close="false">
				<p class="sidebar-text">
					Directus keeps a copy of its answers, the cache, so it does not have to ask the database every time.
				</p>
				<p class="sidebar-text">
					A change to a collection that is not ignored clears the whole cache. This page counts in how many minutes that
					happened at least once. Several changes in the same minute count as one. Changes to ignored collections never
					clear the cache.
				</p>
				<p class="sidebar-text">
					The numbers come from the activity log. Changes that are not logged there can't be counted, but they still clear
					the cache:
				</p>
				<ul class="sidebar-list">
					<li>
						collections with "Activity &amp; Revision Tracking" turned off. They are listed as "Not measured" at the end of
						the table;
					</li>
					<li>changes made by Flows that run without activity tracking. These can't be detected.</li>
				</ul>
				<p class="sidebar-text">
					If Directus deletes old activity (retention), a long time period shows less than actually happened. The page
					warns you when that is the case.
				</p>
			</sidebar-detail>
			<sidebar-detail id="strategy" icon="lightbulb" title="What to Ignore">
				<p class="sidebar-text">
					Good choices change very often, and nobody needs them up to date to the second: counters, logs, statistics.
				</p>
				<p class="sidebar-text">
					Don't ignore collections that decide what users may see or buy, like subscriptions, purchases or access rights.
					Only ignore them if the apps that read them ask for fresh data.
				</p>
			</sidebar-detail>
			<sidebar-detail id="recommendations" icon="recommend" title="Suggestions">
				<p class="sidebar-text">A collection is suggested for ignoring when it</p>
				<ul class="sidebar-list">
					<li>changes at least {{ Math.round(RECOMMEND_MIN_SHARE * 60) }} times per hour,</li>
					<li>is not a Directus system collection,</li>
					<li>is not mostly changed by editors in the Data Studio.</li>
				</ul>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>

			<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
				<template #icon><v-icon name="list_alt" /></template>
				Overview
			</v-divider>
			<p class="explain intro">
				How often changes cleared the whole cache in the chosen period, and what ignoring collections would change.
				Changes to ignored collections never clear the cache.
			</p>

			<div v-if="!analysis && loadingAnalysis" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="analysis">
				<v-notice v-if="retentionNotice" type="warning" class="notice">{{ retentionNotice }}</v-notice>
				<v-notice v-if="granular" type="info" class="notice">
					<span>
						Granular mode is on: a change only clears the answers that use its collection, so you rarely need to ignore
						collections now. For collections that change often, a rule on
						<router-link to="/cache-manager/cache">Granular Cache</router-link> is usually the better choice. The numbers
						below show how often the whole cache would be cleared without it.
					</span>
				</v-notice>

				<div class="summary-row">
					<section class="summary-bar" aria-label="Cache clear rates">
						<div class="stat">
							<span class="stat-value">{{ formatTimesPerHour(analysis.purgeMinutes, analysis.windowMinutes) }}/h</span>
							<span class="stat-label">
								Cache Clears
								<v-icon
									v-tooltip.top="clearsTooltip"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat" :class="{ changed: dirty }">
							<span class="stat-value">{{ dirty ? `${formatTimesPerHour(whatIf, analysis.windowMinutes)}/h` : '—' }}</span>
							<span class="stat-label">
								Your Changes
								<v-icon
									v-tooltip.top="changesTooltip"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ suggestionRate }}</span>
							<span class="stat-label">
								Suggested
								<v-icon
									v-tooltip.top="suggestionRateTooltip"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
					</section>
					<v-select v-model="hours" class="period" :items="hourItems" inline />
				</div>
				<p v-if="notMeasuredLine" class="caption">{{ notMeasuredLine }}</p>

				<div v-if="granular && analysis.recommendedList.length" class="suggest-row">
					<div class="suggest-copy">
						<div class="suggest-head">
							<strong>These collections change often</strong>
							<div class="suggest-chips">
								<v-chip v-for="name in analysis.recommendedList" :key="name" small>{{ name }}</v-chip>
							</div>
						</div>
						<span>Consider a rule for them on Granular Cache.</span>
					</div>
					<v-button small secondary to="/cache-manager/cache">Open Granular Cache</v-button>
				</div>
				<div v-else-if="!granular && analysis.recommendedList.length" class="suggest-row">
					<div class="suggest-copy">
						<div class="suggest-head">
							<strong>
								{{ analysis.recommendedList.length === 1 ? 'Ignore this collection' : 'Ignore these collections' }}
							</strong>
							<div class="suggest-chips">
								<v-chip
									v-for="name in analysis.recommendedList"
									:key="name"
									small
									:class="{ 'chip-warning': looksSensitive(name) }"
								>
									{{ name }}
								</v-chip>
							</div>
						</div>
						<span>
							{{ formatTimesPerHour(analysis.recommendedPurgeMinutes, analysis.windowMinutes) }}/h instead of
							{{ formatTimesPerHour(analysis.purgeMinutes, analysis.windowMinutes) }}/h
						</span>
						<span v-if="sensitiveRecommendations.length" class="warning-text">
							Check apps first: the name suggests they decide on it (access, payments, purchases).
						</span>
					</div>
					<v-button
						small
						:secondary="!addableRecommendations.length"
						:disabled="!addableRecommendations.length"
						@click="add(addableRecommendations)"
					>
						{{ addableRecommendations.length ? 'Apply suggested' : 'Added to your changes' }}
					</v-button>
				</div>

				<div class="toolbar">
					<div class="selection-actions">
						<v-button small secondary :disabled="!changes.toIgnore.length" @click="ignoreSelected">
							Ignore selected ({{ changes.toIgnore.length }})
						</v-button>
						<v-button small secondary :disabled="!changes.toStop.length" @click="stopIgnoringSelected">
							Stop ignoring selected ({{ changes.toStop.length }})
						</v-button>
					</div>
					<div class="add-other">
						<v-select
							:model-value="null"
							:items="otherCollectionChoices"
							:disabled="!otherCollectionChoices.length"
							placeholder="Ignore another collection…"
							@update:model-value="addOther"
						/>
					</div>
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="schedule" /></template>
					Changes
				</v-divider>
				<p class="explain intro">Changes per collection in {{ formatPeriod(analysis.hours) }}, the busiest first.</p>

				<div class="table-wrap">
				<table class="analysis">
					<thead>
						<tr>
							<th class="check-col">
								<v-checkbox
									:model-value="allSelected"
									:indeterminate="someSelected"
									aria-label="Select all"
									@update:model-value="toggleSelectAll"
								/>
							</th>
							<th>Collection</th>
							<th class="num">Changes</th>
							<th class="num">Changed in</th>
							<th class="num">Effect if ignored</th>
							<th>Status</th>
							<th>Suggestion</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in rows" :key="row.collection">
							<td class="check-col">
								<v-checkbox
									:model-value="selected.includes(row.collection)"
									:aria-label="`Select ${row.collection}`"
									@update:model-value="(checked) => toggleRow(row.collection, checked)"
								/>
							</td>
							<td class="name">{{ row.collection }}</td>
							<td class="num">{{ row.measured ? formatNumber(row.writes) : '–' }}</td>
							<td class="num">{{ row.measured ? formatMinutesShort(row.minutes, analysis.windowMinutes) : '–' }}</td>
							<td class="num">{{ row.ignored || !row.measured ? '–' : formatSavedPerHour(row.savedMinutes, analysis.windowMinutes) }}</td>
							<td>
								<span
									v-tooltip="stateOf(row) === 'unmeasured' ? notMeasuredTooltip : undefined"
									class="state"
									:class="stateClass(row)"
								>
									{{ ROW_STATE_LABELS[stateOf(row)] }}
								</span>
							</td>
							<td>
								<v-button
									v-if="!row.measured && !row.ignored"
									v-tooltip="`Settings → Data Model → ${row.collection} → Activity & Revision Tracking`"
									x-small
									secondary
									:to="`/settings/data-model/${row.collection}`"
								>
									Turn on tracking
								</v-button>
								<router-link
									v-else-if="row.recommended && granular"
									v-tooltip="'Changes often. Add a rule on Granular Cache, for example skip fields like counters or set a lifetime.'"
									class="badge badge--link"
									to="/cache-manager/cache"
								>
									Try a rule
								</router-link>
								<span
									v-else-if="row.recommended"
									v-tooltip="suggestionTooltip(row.collection, state?.effective.ttl ?? '')"
									class="badge"
									:class="{ 'badge--warning': looksSensitive(row.collection) }"
								>
									{{ looksSensitive(row.collection) ? 'Check apps first' : 'Suggested' }}
								</span>
								<span v-else-if="!row.ignored" class="subdued">{{ row.reason }}</span>
							</td>
						</tr>
					</tbody>
				</table>
				</div>

				<p class="meta">
					{{ new Date(analysis.from).toLocaleString() }} to {{ new Date(analysis.to).toLocaleString() }}.
					"Changed in" counts the minutes with at least one change, and how many that is per hour. "Effect if ignored" shows how many times per hour
					less the cache would be cleared if you also ignore that collection. A bigger drop is better.
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
import { buildRows, retentionWarning, unmeasuredLine, type TableRow } from '../shared/coverage';
import { ROW_STATE_LABELS, looksSensitive, rowState, selectionChanges, suggestionTooltip, type RowState } from '../shared/selection';
import { RECOMMEND_MIN_SHARE } from '../shared/constants';
import { formatDurationLabel } from '../shared/duration';
import { useRules } from './composables/use-rules';
import {
	formatTimes,
	formatMinutesShort,
	formatNumber,
	formatPeriod,
	formatSavedPerHour,
	formatTimesPerHour,
	formatWindow,
} from '../shared/format';
import ModuleNavigation from './navigation.vue';
import SaveActions from './save-actions.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, analysis, draft, draftSet, hours, busy, dirty, saving, loadingAnalysis, whatIf, error, message, loadState, loadAnalysis, toggle, add } =
	useCacheManager();

const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };
const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${formatWindow(value)}`, value }));


/** Collections with changes plus every ignored or configured collection, so nothing ignored is hidden. */
const rows = computed<TableRow[]>(() =>
	buildRows(
		analysis.value?.collections ?? [],
		[...draft.ignoreList, ...(state.value?.effective.ignoreList ?? []), ...(state.value?.baseline.ignoreList ?? [])],
		analysis.value?.unmeasured ?? [],
		state.value?.effective.ignoreList ?? [],
	),
);
const notMeasuredLine = computed(() => unmeasuredLine(analysis.value?.unmeasured ?? [], state.value?.effective.ignoreList ?? []));
const retentionNotice = computed(() =>
	analysis.value ? retentionWarning(analysis.value.activityRetentionHours ?? null, analysis.value.hours) : null,
);
/* Row selection is local to this page and only feeds the two action buttons. */
const selected = ref<string[]>([]);
const allSelected = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length);
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value);
const changes = computed(() => selectionChanges(selected.value, draft.ignoreList));
const sensitiveRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter(looksSensitive));
const effectiveSet = computed(() => new Set(state.value?.effective.ignoreList ?? []));

function toggleSelectAll(checked: boolean) {
	selected.value = checked ? rows.value.map((row) => row.collection) : [];
}

function toggleRow(collection: string, checked: boolean) {
	if (checked) {
		if (!selected.value.includes(collection)) selected.value = [...selected.value, collection];
	} else {
		selected.value = selected.value.filter((name) => name !== collection);
	}
}

function ignoreSelected() {
	add(changes.value.toIgnore);
	selected.value = [];
}

function stopIgnoringSelected() {
	for (const name of changes.value.toStop) toggle(name, false);
	selected.value = [];
}

function stateOf(row: TableRow): RowState {
	return rowState(row.collection, row.measured, draftSet.value, effectiveSet.value);
}

function stateClass(row: TableRow): Record<string, boolean> {
	const value = stateOf(row);
	return {
		'state--ignored': value === 'ignored',
		'state--clears': value === 'clears' && row.savedMinutes * 60 >= (analysis.value?.windowMinutes ?? Infinity),
		'state--pending': value === 'will-ignore' || value === 'will-clear',
		'state--pending-ignore': value === 'will-ignore',
		'state--pending-clear': value === 'will-clear',
	};
}

// A new analysis (period change, refresh, save) starts with nothing selected.
watch(analysis, () => {
	selected.value = [];
});

const notMeasuredTooltip = "Activity tracking is off for this collection, so its changes can't be counted. They can still clear the cache.";

const addableRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter((name) => !draftSet.value.has(name)));

const suggestionRate = computed(() => {
	const current = analysis.value;
	if (!current || granular.value || !current.recommendedList.length) return '—';
	return `${formatTimesPerHour(current.recommendedPurgeMinutes, current.windowMinutes)}/h`;
});

const clearsTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	return `${formatTimes(current.purgeMinutes, current.windowMinutes)}. Lower is better: after clearing, Directus has to load everything from the database again.`;
});

const changesTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	if (!dirty.value) return 'Select collections in the table and click Ignore selected to see the effect here.';
	return `With your selection the cache would have been cleared ${formatTimes(whatIf.value, current.windowMinutes)}. Lower is better.`;
});

const suggestionRateTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	if (granular.value) return 'Ignore suggestions assume that every change clears the whole cache.';
	if (!current.recommendedList.length) return 'No collection changes often enough to matter.';
	const ttl = state.value?.effective.ttl
		? formatDurationLabel(state.value.effective.ttl)
		: 'the cache lifetime';
	return `Would have been cleared ${formatTimes(current.recommendedPurgeMinutes, current.windowMinutes)}. Ignored collections can be up to ${ttl} old.`;
});
const otherCollections = computed(() => {
	const shown = new Set(rows.value.map((row) => row.collection));
	return (state.value?.collections ?? []).filter((name) => !shown.has(name));
});

/** Collections without changes in the period, for the picker above the table. */
const otherCollectionChoices = computed(() => otherCollections.value.map((name) => ({ text: name, value: name })));

/** Picking a collection ignores it right away (no separate button). */
function addOther(name: string | null) {
	if (name) toggle(name, true);
}

watch(hours, loadAnalysis);

const { data: rulesData, load: loadRules } = useRules();
/** Granular mode: a change only clears its own answers, so ignore suggestions don't apply. */
const granular = computed(() => !!rulesData.value?.status.targetedActive);

onMounted(async () => {
	loadRules();
	await loadState();
	await loadAnalysis();
});
</script>

<style scoped>
.section-divider {
	margin-bottom: 12px;
}
.section-divider.add-margin-top {
	margin-top: 24px;
}
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
	color: var(--theme--foreground, var(--foreground-normal));
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
	flex: 1 1 14rem;
	max-width: 320px;
	min-width: 12rem;
}
.summary-row {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 12px;
}
.summary-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	flex: 1 1 20rem;
	min-width: 0;
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
.stat.changed {
	border-color: var(--theme--primary, var(--primary));
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
.period {
	width: 12.5rem;
	flex: none;
}
.caption {
	margin: 0 0 16px;
	font-size: 12px;
	line-height: 1.5;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.suggest-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	flex-wrap: wrap;
	margin-bottom: 16px;
	padding: 12px 16px;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color, var(--border-normal));
	background: var(--theme--background, var(--background-page));
}
.suggest-copy {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
	flex: 1;
}
.suggest-head {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.suggest-copy strong {
	font-size: 13px;
}
.suggest-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.suggest-chips .chip-warning {
	--v-chip-color: var(--theme--warning, var(--warning));
	--v-chip-background-color: var(--theme--warning-background, var(--warning-alt));
	--v-chip-color-hover: var(--theme--warning, var(--warning));
	--v-chip-background-color-hover: var(--theme--warning-subdued, var(--warning-alt));
}
.suggest-copy span {
	font-size: 12px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.subdued,
.meta {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	line-height: 1.5;
}
.meta {
	margin-top: 12px;
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
	position: sticky;
	top: 0;
	z-index: 1;
}
.name {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
}
.check-col {
	width: 36px;
	padding-left: 8px;
	padding-right: 4px;
	vertical-align: middle;
	white-space: nowrap;
}
.check-col :deep(.v-checkbox) {
	margin: 0;
}
.num {
	text-align: right;
	font-variant-numeric: tabular-nums;
}
.state {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	white-space: nowrap;
}
.state::before {
	content: '';
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: currentColor;
}
/* Keeps cache (ignored): changes never clear the cache. */
.state--ignored {
	color: var(--theme--success, var(--success));
}
/* Clears the cache at least once per hour on average. */
.state--clears {
	color: var(--theme--warning, var(--warning));
}
/* Not saved yet: what Save & Apply will change. */
.state--pending {
	font-style: italic;
}
.state--pending::before {
	background: transparent;
	border: 2px solid currentColor;
	box-sizing: border-box;
}
.state--pending-ignore {
	color: var(--theme--success, var(--success));
}
.state--pending-clear {
	color: var(--theme--warning, var(--warning));
}
.selection-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.warning-text {
	color: var(--theme--warning, var(--warning));
}
.badge {
	display: inline-block;
	padding: 2px 8px;
	margin-right: 6px;
	border-radius: 12px;
	background: var(--theme--primary, var(--primary));
	color: var(--theme--foreground-inverted, var(--foreground-inverted, #fff));
	font-size: 12px;
	cursor: pointer;
}
.badge--link {
	text-decoration: none;
}
.intro {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.notice a {
	color: inherit;
	text-decoration: underline;
}
.badge--warning {
	background: var(--theme--warning, var(--warning));
}
code {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
	font-size: 0.9em;
}
</style>
