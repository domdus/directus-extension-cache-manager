<template>
	<private-view title="Analysis" icon="insights">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon small secondary :loading="loadingAnalysis" :disabled="saving" @click="refresh">
				<v-icon name="refresh" small />
			</v-button>
			<v-button v-tooltip.bottom="'Discard Changes'" rounded icon small secondary :disabled="!rulesDirty || saving" @click="discard">
				<v-icon name="undo" small />
			</v-button>
			<v-button v-tooltip.bottom="saveText" rounded icon small :loading="saving" :disabled="!canSave" @click="save">
				<v-icon name="check" small />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="Counting" :close="false">
				<p class="sidebar-text">
					This page counts the minutes in which a change cleared the whole cache. Several changes in one minute count once.
					Collections with a rule that never clears, or on the ignore list, don't count.
				</p>
				<p class="sidebar-text">The numbers come from the activity log. These changes aren't logged, but still clear the cache:</p>
				<ul class="sidebar-list">
					<li>collections with "Activity &amp; Revision Tracking" turned off, listed as "Not measured" at the end of the table;</li>
					<li>Flows that run without activity tracking.</li>
				</ul>
				<p class="sidebar-text">
					If Directus deletes old activity (retention), long periods show less than really happened. The page warns you then.
				</p>
				<p class="sidebar-text">
					Rules that keep only some changes (an action off, Skip Fields) count as clearing, because the activity log doesn't
					show which fields changed.
				</p>
			</sidebar-detail>
			<sidebar-detail v-if="!granular" id="strategy" icon="lightbulb" title="What Never to Clear">
				<p class="sidebar-text">
					Good candidates change very often and don't need to be up to date to the second: counters, logs, statistics.
				</p>
				<p class="sidebar-text">
					Keep clearing collections that decide what users may see or buy, like subscriptions, purchases or access rights,
					unless the apps that read them send <code>Cache-Control: no-store</code>.
				</p>
			</sidebar-detail>
			<sidebar-detail id="recommendations" icon="recommend" title="Suggestions">
				<template v-if="granular">
					<p class="sidebar-text">
						A collection gets a suggested rule with Skip Fields (the Potential column) when it changes at least {{ Math.round(RECOMMEND_MIN_SHARE * 60) }}
						times per hour and most of its changes only touch the same 1 to 3 fields, like a view counter.
					</p>
					<p class="sidebar-text">
						This is read from its revisions, so it needs "Activity &amp; Revision Tracking" set to track revisions. Fields
						Directus fills in itself, like Date Updated, don't count.
					</p>
				</template>
				<p v-if="!granular" class="sidebar-text">A collection is suggested when it</p>
				<ul v-if="!granular" class="sidebar-list">
					<li>changes at least {{ Math.round(RECOMMEND_MIN_SHARE * 60) }} times per hour,</li>
					<li>is not a Directus system collection,</li>
					<li>is not mostly changed by editors in the Data Studio.</li>
				</ul>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="rulesError" type="danger" class="notice">{{ rulesError }}</v-notice>
			<v-notice v-if="rulesMessage" type="success" class="notice">{{ rulesMessage }}</v-notice>

			<!-- Without Auto Purge no change clears the cache, so there is nothing to keep. -->
			<v-info v-if="autoPurgeOff && !showAnyway" icon="delete_sweep" title="Auto Purge Is Off" center class="blank">
				Changes don't clear the cache, so there is nothing to analyze. Cached responses only update when they expire
				({{ ttlText }}). Turn on Auto Purge on the Status page to use this page.
				<template #append>
					<div class="blank-actions">
						<v-button to="/cache-manager">Open Status</v-button>
						<v-button secondary @click="showAnyway = true">Show Anyway</v-button>
					</div>
				</template>
			</v-info>

			<template v-else>
			<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
				<template #icon><v-icon name="list_alt" /></template>
				{{ granular ? 'Overview' : 'Clear Rate' }}
			</v-divider>
			<p v-if="granular" class="explain intro">
				Granular mode is on: a change clears only the cached responses of its own collection. For a busy collection, add a
				rule with Skip Fields or a lifetime. Potential: the share of a collection's changes that keep the cache with the
				suggested rule.
			</p>
			<p v-else class="explain intro">
				How often changes cleared the whole cache in the chosen period. Collections with a rule that never clears, or on
				the ignore list, don't count. Cached responses expire {{ ttlText }} if nothing clears them sooner.
			</p>

			<div v-if="!analysis && loadingAnalysis" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="analysis">
				<v-notice v-if="retentionNotice" type="warning" class="notice">{{ retentionNotice }}</v-notice>
				<v-notice v-if="ttlVsPurge" :type="granular ? 'info' : 'warning'" class="notice">{{ ttlVsPurge }}</v-notice>
				<v-notice v-if="skipCacheNotice" type="info" class="notice">
					<span>
						{{ skipCacheNotice }}
						<router-link to="/cache-manager">Open Status</router-link>
					</span>
				</v-notice>

				<div class="summary-row">
					<section v-if="!granular" class="summary-bar" aria-label="Cache clear rates">
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
						<div class="stat" :class="{ changed: keptDirty }">
							<span class="stat-value">{{ keptDirty ? `${formatTimesPerHour(whatIf, analysis.windowMinutes)}/h` : '—' }}</span>
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
				<v-notice v-if="liveGapText" type="warning" class="notice">{{ liveGapText }}</v-notice>

				<template v-if="!granular && analysis.recommendedList.length">
					<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
						<template #icon><v-icon name="recommend" /></template>
						Suggestions
					</v-divider>
					<p class="explain intro">
						These collections change often and clear the cache a lot. Apply adds a rule that never clears. Refine it on
						<router-link to="/cache-manager/cache">Granular Cache</router-link>, for example with Skip Fields.
					</p>
				</template>
				<div v-if="!granular && analysis.recommendedList.length" class="suggest-row">
					<div class="suggest-copy">
						<div class="suggest-head">
							<strong>
								{{ analysis.recommendedList.length === 1 ? 'Never clear for this collection' : 'Never clear for these collections' }}
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
							Check first: apps may need this data up to date (access, payments, purchases).
						</span>
					</div>
					<v-button
						small
						:secondary="!addableRecommendations.length"
						:disabled="!addableRecommendations.length"
						@click="neverClear(addableRecommendations)"
					>
						{{ addableRecommendations.length ? 'Apply Suggested' : 'Added to Your Changes' }}
					</v-button>
				</div>

				<div v-if="!granular" class="toolbar">
					<div class="selection-actions">
						<v-button small secondary :disabled="!changes.toKeep.length" @click="neverClearSelected">
							Never Clear Selected ({{ changes.toKeep.length }})
						</v-button>
						<v-button small secondary :disabled="!changes.toClear.length" @click="clearAgainSelected">
							Clear Again ({{ changes.toClear.length }})
						</v-button>
					</div>
					<div class="add-other">
						<v-select
							:model-value="null"
							:items="otherCollectionChoices"
							:disabled="!otherCollectionChoices.length"
							placeholder="Never clear another collection…"
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
							<th v-if="!granular" class="check-col">
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
							<th v-if="!granular" class="num">If Never Cleared</th>
							<th>Status</th>
							<th v-if="granular" class="num">Potential</th>
							<th>{{ granular ? 'Rule' : 'Suggestion' }}</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="row in rows" :key="row.collection">
							<td v-if="!granular" class="check-col">
								<v-checkbox
									:model-value="selected.includes(row.collection)"
									:aria-label="`Select ${row.collection}`"
									@update:model-value="(checked) => toggleRow(row.collection, checked)"
								/>
							</td>
							<td class="name">{{ row.collection }}</td>
							<td class="num" data-label="Changes">{{ row.measured ? formatNumber(row.writes) : '–' }}</td>
							<td class="num" data-label="Changed in">
								<template v-if="row.measured">
									<span class="minutes">{{ changedIn(row)[0] }}</span>
									<span class="rate">{{ changedIn(row)[1] }}</span>
								</template>
								<template v-else>–</template>
							</td>
							<td v-if="!granular" class="num" data-label="If Never Cleared">{{ row.ignored || !row.measured ? '–' : formatSavedPerHour(row.savedMinutes, analysis.windowMinutes) }}</td>
							<td data-label="Status">
								<span
									v-tooltip="stateTooltip(row)"
									class="state"
									:class="stateClass(row)"
								>
									{{ ruleOf(row) ? 'Cache rule' : ROW_STATE_LABELS[stateOf(row)] }}
								</span>
							</td>
							<td v-if="granular" class="num" data-label="Potential">
								<span v-if="skipFor(row.collection)" v-tooltip="skipTooltip(skipFor(row.collection)!)" class="potential">
									{{ Math.round(skipFor(row.collection)!.coveredShare * 100) }} %
								</span>
								<span v-else class="subdued">–</span>
							</td>
							<td class="action-col" :data-label="granular ? 'Rule' : 'Suggestion'">
								<v-button
									v-if="!row.measured && !row.ignored"
									v-tooltip="`Settings → Data Model → ${row.collection} → Activity & Revision Tracking`"
									x-small
									secondary
									:to="`/settings/data-model/${row.collection}`"
								>
									Turn On Tracking
								</v-button>
								<span v-else-if="granular" class="rule-cell">
									<v-button
										v-if="!configuredSet.has(row.collection) && isTargetable(row.collection)"
										v-tooltip="skipFor(row.collection) && !rulesDraft.collections[row.collection] ? skipTooltip(skipFor(row.collection)!) : ''"
										x-small
										:secondary="!skipFor(row.collection) || !!rulesDraft.collections[row.collection]"
										:kind="skipFor(row.collection)?.fields.some(looksSensitiveField) && !rulesDraft.collections[row.collection] ? 'warning' : 'normal'"
										@click="openRule(row.collection)"
									>
										{{ rulesDraft.collections[row.collection] ? 'Edit Rule' : skipFor(row.collection) ? 'Add Suggested Rule' : 'Add Rule' }}
									</v-button>
								</span>
								<span
									v-else-if="row.recommended"
									v-tooltip="suggestionTooltip(row.collection, state?.effective.ttl ?? '')"
									class="badge"
									:class="{ 'badge--warning': looksSensitive(row.collection) }"
								>
									{{ looksSensitive(row.collection) ? 'Check impact' : 'Suggested' }}
								</span>
								<span v-else-if="!row.ignored" class="subdued">{{ row.reason }}</span>
							</td>
						</tr>
					</tbody>
				</table>
				</div>

				<p class="meta">
					{{ new Date(analysis.from).toLocaleString() }} to {{ new Date(analysis.to).toLocaleString() }}.
					"Changed in": minutes with at least one change, and the rate per hour.
					<template v-if="!granular">
						"If Never Cleared": how many fewer clears per hour a never-clear rule for that collection gives. Bigger is better.
					</template>
					<template v-if="!analysis.editorHeuristic">
						PUBLIC_URL is not a full URL, so changes by editors can't be told apart from changes by apps.
					</template>
				</p>
			</template>

			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { purgeMinutes } from '../shared/analysis';
import { buildRows, retentionWarning, unmeasuredLine, type TableRow } from '../shared/coverage';
import { ROW_STATE_LABELS, looksSensitive, rowState, selectionChanges, suggestionTooltip, type RowState } from '../shared/selection';
import { RECOMMEND_MIN_SHARE } from '../shared/constants';
import { formatDurationLabel } from '../shared/duration';
import { ttlVsPurgeText } from '../shared/health';
import { isTargetable, neverClearCollections, type CollectionRule } from '../shared/rules';
import { looksSensitiveField, ruleCovers, type SkipSuggestion } from '../shared/skip-fields';
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
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, analysis, hours, loadingAnalysis, error, loadState, loadAnalysis } = useCacheManager();
/* The draft is the one of Granular Cache: a rule added here shows up there before saving, and the other way round. */
const {
	data: rulesData,
	draft: rulesDraft,
	saving,
	dirty: rulesDirty,
	canSave,
	error: rulesError,
	message: rulesMessage,
	load: loadRules,
	save: saveRules,
	discard,
	addRule,
	removeRule,
	updateRule,
} = useRules();

const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };
const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${formatWindow(value)}`, value }));

/** On the ignore list in the Directus configuration: keeps the cache, can't be changed here. */
const configured = computed(() => state.value?.effective.ignoreList ?? []);
const configuredSet = computed(() => new Set(configured.value));
/** Collections that keep the cache with the saved rules, and with the rules being edited. */
const savedKept = computed(() => new Set([...configured.value, ...(rulesData.value ? neverClearCollections(rulesData.value.config) : [])]));
const draftKept = computed(() => new Set([...configured.value, ...neverClearCollections(rulesDraft)]));
const keptDirty = computed(() => savedKept.value.size !== draftKept.value.size || [...draftKept.value].some((name) => !savedKept.value.has(name)));
const whatIf = computed(() =>
	analysis.value ? purgeMinutes(analysis.value.minuteSets, [...draftKept.value], state.value?.effective.autoPurge ?? true) : 0,
);

/** Collections with changes plus every collection that keeps the cache, so none of them is hidden. */
const rows = computed<TableRow[]>(() =>
	buildRows(analysis.value?.collections ?? [], [...draftKept.value, ...savedKept.value], analysis.value?.unmeasured ?? [], [...savedKept.value]),
);
const notMeasuredLine = computed(() => unmeasuredLine(analysis.value?.unmeasured ?? [], [...savedKept.value]));
const retentionNotice = computed(() =>
	analysis.value ? retentionWarning(analysis.value.activityRetentionHours ?? null, analysis.value.hours) : null,
);
/* Row selection is local to this page and only feeds the two action buttons. */
const selected = ref<string[]>([]);
const allSelected = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length);
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value);
const changes = computed(() => selectionChanges(selected.value, draftKept.value, configuredSet.value));
const sensitiveRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter(looksSensitive));

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

/** A rule with every action off. An existing rule keeps its skip fields and lifetime. */
function neverClear(names: string[]) {
	for (const name of names) {
		if (configuredSet.value.has(name)) continue;
		addRule(name);
		updateRule(name, { create: false, update: false, delete: false });
	}
}

/** Every action on again; a rule with nothing else left is removed. */
function clearAgain(names: string[]) {
	for (const name of names) {
		const rule = rulesDraft.collections[name];
		if (!rule) continue;
		if (rule.ttl || rule.skipFields.length) updateRule(name, { create: true, update: true, delete: true });
		else removeRule(name);
	}
}

function neverClearSelected() {
	neverClear(changes.value.toKeep);
	selected.value = [];
}

function clearAgainSelected() {
	clearAgain(changes.value.toClear);
	selected.value = [];
}

/** "Changed in" as two lines: minutes, then the rate per hour. */
function changedIn(row: TableRow): [string, string] {
	const [minutes = '', rate = ''] = formatMinutesShort(row.minutes, analysis.value?.windowMinutes ?? 0).split(' · ');
	return [minutes, rate];
}

function stateOf(row: TableRow): RowState {
	return rowState(row.collection, row.measured, draftKept.value, savedKept.value);
}

/** Granular mode: the saved rule of a collection whose changes still clear (Skip Fields, actions off or a lifetime). */
function ruleOf(row: TableRow): CollectionRule | undefined {
	if (!granular.value || stateOf(row) !== 'clears') return undefined;
	return rulesData.value?.config.collections[row.collection];
}

function ruleTooltip(rule: CollectionRule): string {
	const parts: string[] = [];
	const off = (['create', 'update', 'delete'] as const).filter((action) => !rule[action]);
	if (off.length) parts.push(`doesn't clear on ${off.join(', ')}`);
	if (rule.update && rule.skipFields.length) parts.push(`changes to only ${rule.skipFields.join(', ')} keep the cache`);
	if (rule.ttl) parts.push(`cached for ${formatDurationLabel(rule.ttl)}`);
	const what = parts.length ? `Its rule: ${parts.join('; ')}.` : 'It has a rule.';
	return `${what} The activity log doesn't show which changes the rule kept, so all changes count here. Edit the rule on Granular Cache.`;
}

function stateTooltip(row: TableRow): string | undefined {
	const rule = ruleOf(row);
	if (rule) return ruleTooltip(rule);
	if (configuredSet.value.has(row.collection)) return 'On the ignore list in the Directus configuration (CACHE_AUTO_PURGE_IGNORE_LIST). Change it there.';
	if (stateOf(row) === 'unmeasured') return notMeasuredTooltip;
	if (draftKept.value.has(row.collection)) return 'Its rule never clears. Edit it on Granular Cache.';
	return undefined;
}

function stateClass(row: TableRow): Record<string, boolean> {
	const value = stateOf(row);
	return {
		'state--rule': !!ruleOf(row),
		'state--ignored': value === 'ignored',
		'state--clears': value === 'clears' && !ruleOf(row) && row.savedMinutes * 60 >= (analysis.value?.windowMinutes ?? Infinity),
		'state--pending': value === 'will-ignore' || value === 'will-clear',
		'state--pending-ignore': value === 'will-ignore',
		'state--pending-clear': value === 'will-clear',
	};
}

// A new analysis (period change, refresh, save) starts with nothing selected.
watch(analysis, () => {
	selected.value = [];
});

const notMeasuredTooltip = "Activity tracking is off, so its changes can't be counted. They still clear the cache.";

const addableRecommendations = computed(() => (analysis.value?.recommendedList ?? []).filter((name) => !draftKept.value.has(name)));

const suggestionRate = computed(() => {
	const current = analysis.value;
	if (!current || !current.recommendedList.length) return '—';
	return `${formatTimesPerHour(current.recommendedPurgeMinutes, current.windowMinutes)}/h`;
});

const clearsTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	return `${formatTimes(current.purgeMinutes, current.windowMinutes)}. Lower is better: after a clear, everything is loaded from the database again.`;
});

const changesTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	if (!keptDirty.value) return 'Select collections in the table and click Never Clear Selected to see the effect here.';
	return `With your changes: ${formatTimes(whatIf.value, current.windowMinutes)}. Lower is better.`;
});

const suggestionRateTooltip = computed(() => {
	const current = analysis.value;
	if (!current) return '';
	if (!current.recommendedList.length) return 'No collection changes often enough.';
	const ttl = state.value?.effective.ttl ? formatDurationLabel(state.value.effective.ttl) : 'the cache lifetime';
	return `With the suggestions: ${formatTimes(current.recommendedPurgeMinutes, current.windowMinutes)}. Collections that never clear can be up to ${ttl} old.`;
});

const saveText = computed(() => (rulesDirty.value ? 'Save & Apply' : 'No unsaved changes'));

const otherCollections = computed(() => {
	const shown = new Set(rows.value.map((row) => row.collection));
	return (state.value?.collections ?? []).filter((name) => !shown.has(name));
});

/** Collections without changes in the period, for the picker above the table. */
const otherCollectionChoices = computed(() => otherCollections.value.map((name) => ({ text: name, value: name })));

/** Picking a collection adds its rule right away (no separate button). */
function addOther(name: string | null) {
	if (name) neverClear([name]);
}

const router = useRouter();

/** Changes Cache Manager saw live that are missing from the activity log (Flows or scripts without tracking). */
const liveGapText = computed(() => {
	const gaps = analysis.value?.liveGaps ?? [];
	if (!gaps.length || !analysis.value?.liveSince) return null;
	const list = gaps
		.slice(0, 5)
		.map((gap) => `${gap.collection} (${formatNumber(gap.live - gap.logged)} not logged)`)
		.join(', ');
	const more = gaps.length > 5 ? ` and ${gaps.length - 5} more` : '';
	return `Since Directus started (${new Date(analysis.value.liveSince).toLocaleString()}), some changes are missing from the activity log: ${list}${more}. This page can't count them, but they still clear the cache. Usually a Flow or script writes without activity tracking.`;
});

/** Skip Fields suggestions that the saved rules don't cover yet (Granular mode). */
const skipList = computed<SkipSuggestion[]>(() =>
	(analysis.value?.skipSuggestions ?? []).filter(
		(item) => !configuredSet.value.has(item.collection) && !ruleCovers(rulesData.value?.config.collections[item.collection], item.fields),
	),
);

function skipFor(collection: string): SkipSuggestion | undefined {
	return skipList.value.find((item) => item.collection === collection);
}

function skipTooltip(item: SkipSuggestion): string {
	const ttl = state.value?.effective.ttl ? formatDurationLabel(state.value.effective.ttl) : 'the cache lifetime';
	const fields = item.fields.join(', ');
	const sensitive = item.fields.filter(looksSensitiveField);
	const check = sensitive.length ? ` Check first: apps may need ${sensitive.join(', ')} up to date.` : '';
	return `Suggested rule: Skip Fields ${fields}. With it, ${Math.round(item.coveredShare * 100)} % of the changes to this collection keep the cache. Now they all clear it. In cached responses, ${fields} can then be up to ${ttl} old.${check}`;
}

/** Adds the suggested Skip Fields to the collection's rule (a new rule if there is none). Saved with Save & Apply. */
function applySkip(item: SkipSuggestion) {
	addRule(item.collection);
	const rule = rulesDraft.collections[item.collection]!;
	updateRule(item.collection, { skipFields: [...new Set([...rule.skipFields, ...item.fields])] });
}

/** Opens the collection's rule on Granular Cache. A new rule starts with the suggested Skip Fields, if any. */
function openRule(collection: string) {
	const suggestion = skipFor(collection);
	if (suggestion && !rulesDraft.collections[collection]) applySkip(suggestion);
	else addRule(collection);
	router.push({ path: '/cache-manager/cache', query: { rule: collection } });
}

async function save() {
	await saveRules();
	if (!rulesError.value) await loadAnalysis();
}

async function refresh() {
	await Promise.all([loadRules(), loadState(true)]);
	await loadAnalysis();
}

watch(hours, loadAnalysis);

/** Granular mode: a change only clears its own answers; the numbers here assume the whole cache. */
const granular = computed(() => !!rulesData.value?.status.targetedActive);
/** Auto Purge off (in use now): changes clear nothing, so there is nothing to analyze. */
const autoPurgeOff = computed(() => !!state.value && !state.value.effective.autoPurge);
const showAnyway = ref(false);
const ttlText = computed(() => (state.value?.effective.ttl ? `after ${formatDurationLabel(state.value.effective.ttl)}` : 'after the cache lifetime'));
const ttlVsPurge = computed(() => {
	if (!analysis.value || autoPurgeOff.value) return null;
	return ttlVsPurgeText(state.value?.effective.ttl, analysis.value.purgeMinutes, analysis.value.windowMinutes, {
		granular: granular.value,
	});
});
const skipCacheNotice = computed(() => {
	if (!state.value || state.value.effective.skipAllowed) return null;
	const neverClear = rulesData.value ? neverClearCollections(rulesData.value.config) : [];
	if (!(analysis.value?.recommendedList.length) && !neverClear.length) return null;
	return 'Skip Cache is off. Apps get data from collections that never clear only when their cached responses expire.';
});

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
	container: changes / inline-size;
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
	overflow-wrap: anywhere;
}
.minutes,
.rate {
	display: block;
	white-space: nowrap;
}
.rate {
	font-size: 12px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.action-col :deep(.v-button) {
	max-inline-size: 100%;
}
/* Narrow: each row becomes a small card, each value with its column name. */
@container changes (max-width: 640px) {
	thead {
		display: none;
	}
	table,
	tbody {
		display: block;
	}
	tbody tr {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		padding: 10px 12px;
		border-bottom: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	}
	tbody tr:last-child {
		border-bottom: none;
	}
	tbody td,
	tbody td.num {
		display: block;
		padding: 0;
		border: none;
		text-align: left;
	}
	tbody td.check-col {
		flex: 0 0 auto;
		inline-size: auto;
		padding: 0;
	}
	tbody td.name {
		flex: 1 1 calc(100% - 48px);
		font-weight: 600;
	}
	tbody td[data-label] {
		flex: 1 1 6rem;
	}
	tbody td[data-label]::before {
		content: attr(data-label);
		display: block;
		margin-bottom: 2px;
		font-size: 11px;
		font-weight: 600;
		color: var(--theme--foreground-subdued, var(--foreground-subdued));
	}
	/* No suggestion or button: leave the field out instead of showing an empty label. */
	tbody td.action-col:not(:has(.v-button, .badge, .subdued)),
	tbody td[data-label='Potential']:not(:has(.potential)) {
		display: none;
	}
	.minutes,
	.rate {
		display: inline;
	}
	.rate::before {
		content: ' · ';
	}
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
	cursor: pointer;
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
/* Has a rule in Granular mode: Directus blue. */
.state--rule {
	color: var(--blue, #3399ff);
}
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
.potential {
	font-weight: 600;
	cursor: pointer;
}

.rule-cell {
	display: inline-flex;
	align-items: center;
	gap: 8px;
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
.blank {
	margin-block: 48px;
}
.blank-actions {
	display: flex;
	gap: 12px;
	justify-content: center;
}
.explain a {
	color: var(--theme--primary, var(--primary));
}
</style>
