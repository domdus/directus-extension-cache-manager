<template>
	<private-view title="Granular Cache" icon="grain">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon small secondary :loading="loading" :disabled="saving" @click="load">
				<v-icon name="refresh" small />
			</v-button>
			<v-button v-tooltip.bottom="'Discard Changes'" rounded icon small secondary :disabled="!dirty || saving" @click="discard">
				<v-icon name="undo" small />
			</v-button>
			<v-button v-tooltip.bottom="saveText" rounded icon small :loading="saving" :disabled="!canSave || loading" @click="save">
				<v-icon name="check" small />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="How It Works" :close="false">
				<p class="sidebar-text">
					With Auto Purge on, Directus clears the <strong>whole</strong> cache on every change, even for a counted visit.
					Everything then has to be loaded from the database again.
				</p>
				<p class="sidebar-text">
					<strong>Granular</strong> remembers which collections each cached response uses, including through relations. A
					change clears only the responses that use the changed collection.
				</p>
				<p class="sidebar-text">
					Changes to users, roles, permissions, policies, settings or the data model still clear everything, because they
					can affect any response.
				</p>
			</sidebar-detail>
			<sidebar-detail id="rules" icon="rule" title="Rules">
				<p class="sidebar-text">
					<strong>Create, Update, Delete</strong>: which changes clear the cache. Turn off Update where only new or deleted
					items matter.
				</p>
				<p class="sidebar-text">
					<strong>Skip Fields</strong>: a change to only these fields keeps the cache, for example a view counter. Changes
					to other fields still clear.
				</p>
				<p class="sidebar-text">
					<strong>Lifetime</strong>: how long responses that use this collection stay cached. Write 5m, 1h or 1d; a number
					without a unit is milliseconds. A response that uses several collections gets the shortest lifetime. Collections
					without a lifetime use the global one
					({{ data?.globalTtl ? formatDurationLabel(data.globalTtl) : 'CACHE_TTL' }}).
				</p>
				<p class="sidebar-text">Apps that need fresh data can always send <code>Cache-Control: no-store</code>.</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>

			<div v-if="!data && loading" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="data">
				<v-notice v-if="shownProblems.length" type="warning" class="notice">
					{{ shownProblems.join('. ') }}.
					<!-- The restart text says itself what still works; other problems mean Granular can't run at all. -->
					<template v-if="otherProblems.length">Directus clears the whole cache as usual.</template>
				</v-notice>
				<v-notice v-else-if="restartForLifetimes" type="warning" class="notice">
					Restart Directus once so lifetimes per collection apply.
				</v-notice>
				<v-notice v-else-if="!data.status.autoPurge" type="info" class="notice">
					Auto Purge is off on <router-link to="/cache-manager">Status</router-link>, so changes clear nothing. Only
					lifetimes apply.
				</v-notice>
				<v-notice v-if="data.status.store !== 'memory' && !data.status.shared && draft.targeted" type="warning" class="notice">
					The cache is kept in {{ data.status.store }}, which Cache Manager can't share between servers. Granular works here
					with a single Directus server only. With several, use Global.
				</v-notice>

				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="my_location" /></template>
					Mode
				</v-divider>
				<p class="explain">Choose what a change clears.</p>

				<div class="choice">
					<button type="button" class="option" :class="{ active: !draft.targeted }" @click="draft.targeted = false">
						<v-icon :name="!draft.targeted ? 'radio_button_checked' : 'radio_button_unchecked'" />
						<span class="option-text">
							<strong>Global</strong>
							<span class="subdued">The Directus default. Every change clears the whole cache.</span>
						</span>
					</button>
					<button type="button" class="option" :class="{ active: draft.targeted }" @click="draft.targeted = true">
						<v-icon :name="draft.targeted ? 'radio_button_checked' : 'radio_button_unchecked'" />
						<span class="option-text">
							<strong>Granular</strong>
							<span class="subdued">
								A change clears only the cached responses that use the changed collection. Everything else stays cached.
							</span>
						</span>
					</button>
				</div>

				<div v-if="draft.targeted" class="advanced">
					<v-checkbox v-model="draft.items" label="Clear single items (advanced)" />
					<p class="explain">
						A change to an item keeps the cached responses of all other items of that collection, such as
						<code>/items/pages/5</code> or GraphQL <code>pages_by_id</code>. Lists of the collection still clear. Helps when
						a collection is read item by item and its items change often, such as stock or prices.
					</p>
				</div>

				<p class="explain after-choice">
					See what each change cleared in <router-link to="/cache-manager/statistics">Statistics</router-link>.
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="rule" /></template>
					Rules
				</v-divider>
				<p class="explain">
					<template v-if="draft.targeted">
						Optional. Granular mode already keeps everything a change doesn't use. A rule fine-tunes one collection: which of its
						changes clear and how long its responses stay cached.
					</template>
					<template v-else>
						Optional. A rule keeps the cache when a busy collection changes, or sets how long its responses stay cached.
					</template>
				</p>

				<div class="toolbar">
					<v-notice type="info" class="toolbar-notice">
						Collections without a rule clear on every change and use the global lifetime ({{ formatDurationLabel(data.globalTtl) }}).
						<template v-if="ignoredWithoutRule.length">
							Except {{ ignoredWithoutRule.join(', ') }}: on the ignore list in the Directus configuration, so they never clear.
						</template>
					</v-notice>
					<div class="add-rule">
						<v-select :model-value="null" :items="addChoices" :disabled="!addChoices.length" placeholder="Add a rule for…" @update:model-value="onAdd" />
					</div>
				</div>

				<div v-if="ruleNames.length > FILTER_FROM" class="filter">
					<v-input v-model="filter" placeholder="Filter rules by collection or field…" small>
						<template #prepend><v-icon name="search" small /></template>
					</v-input>
					<span class="subdued">{{ shownNames.length }} of {{ ruleNames.length }} rules</span>
				</div>

				<div v-if="ruleNames.length" class="table-wrap">
					<table>
						<thead>
							<tr>
								<th class="name-col">Collection</th>
								<th class="center">Create</th>
								<th class="center">Update</th>
								<th class="center">Delete</th>
								<th class="fields-col" v-tooltip="'A change to only these fields keeps the cache'">Skip Fields</th>
								<th class="ttl-col" v-tooltip="'How long responses that use this collection stay cached. Write 5m, 1h or 1d; a number without a unit is milliseconds.'">Lifetime</th>
								<th class="action-col" />
							</tr>
						</thead>
						<tbody>
							<tr v-if="!shownNames.length">
								<td colspan="7" class="subdued">No rule matches "{{ filter }}".</td>
							</tr>
							<tr v-for="name in shownNames" :key="name">
								<td class="name-col">
									<span class="name">{{ name }}</span>
									<span class="row-hint">{{ describeRule(draft.collections[name]!) }}</span>
								</td>
								<template v-if="ignored.has(name)">
									<td colspan="4" class="subdued">
										<v-icon name="playlist_remove" small />
										On the ignore list in the Directus configuration (CACHE_AUTO_PURGE_IGNORE_LIST): changes never
										clear the cache. The lifetime still applies.
									</td>
								</template>
								<template v-else>
									<td v-for="action in actions" :key="action" class="center">
										<v-checkbox
											:model-value="draft.collections[name]![action]"
											:aria-label="`Clear on ${action} in ${name}`"
											@update:model-value="(value) => updateRule(name, { [action]: value })"
										/>
									</td>
									<td class="fields-col">
										<v-select
											:model-value="draft.collections[name]!.skipFields"
											:items="fieldChoices(name)"
											:disabled="!draft.collections[name]!.update"
											multiple
											placeholder="Any change clears"
											@update:model-value="(value) => updateRule(name, { skipFields: value ?? [] })"
										/>
									</td>
								</template>
								<td class="ttl-col">
									<v-input
										:model-value="draft.collections[name]!.ttl ?? ''"
										:placeholder="`${formatDurationShort(data.globalTtl)} (global)`"
										:class="{ invalid: invalidTtl.includes(name) }"
										@update:model-value="(value) => updateRule(name, { ttl: value || null })"
									/>
									<span v-if="invalidTtl.includes(name)" class="field-error">{{ TTL_ERROR }}</span>
									<span v-else-if="bareMillisecondsHint(draft.collections[name]!.ttl)" class="field-hint">
										{{ bareMillisecondsHint(draft.collections[name]!.ttl) }}
									</span>
								</td>
								<td class="action-col">
									<v-button v-tooltip="'Remove rule'" icon x-small secondary @click="removeRule(name)">
										<v-icon name="close" small />
									</v-button>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p v-else class="empty subdued">No rules yet.</p>

			</template>

		</div>
	</private-view>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';
import { computed, onMounted, ref } from 'vue';
import ModuleNavigation from './navigation.vue';
import { useRules } from './composables/use-rules';
import { usePageClass } from './composables/use-page-class';
import { describeRule } from '../shared/rules';
import { TTL_ERROR, bareMillisecondsHint, formatDurationLabel, formatDurationShort } from '../shared/duration';

const pageClass = usePageClass();
const { data, draft, loading, saving, error, message, dirty, canSave, invalidTtl, load, save, discard, addRule, removeRule, updateRule } = useRules();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };
const actions = ['create', 'update', 'delete'] as const;

const ruleNames = computed(() => Object.keys(draft.collections).sort());

/**
 * Without a restart, the first problem is the restart notice (status.installed is false). It is about Granular mode,
 * so it only shows while Granular is selected; in Global mode only lifetimes per collection need the restart.
 */
const restartNeeded = computed(() => !!data.value && !data.value.status.installed);
const otherProblems = computed(() => (data.value?.status.problems ?? []).slice(restartNeeded.value ? 1 : 0));
const shownProblems = computed(() => (restartNeeded.value && draft.targeted ? data.value!.status.problems : otherProblems.value));
const restartForLifetimes = computed(
	() => restartNeeded.value && !draft.targeted && Object.values(draft.collections).some((rule) => rule.ttl),
);
/** The filter shows up once the list gets long. */
const FILTER_FROM = 5;
/** Opened from Analysis with ?rule=<collection>: show that rule. */
const ruleQuery = useRoute().query['rule'];
const filter = ref(typeof ruleQuery === 'string' ? ruleQuery : '');
const shownNames = computed(() => {
	const term = filter.value.trim().toLowerCase();
	if (!term || ruleNames.value.length <= FILTER_FROM) return ruleNames.value;
	return ruleNames.value.filter(
		(name) => name.toLowerCase().includes(term) || draft.collections[name]!.skipFields.some((field) => field.toLowerCase().includes(term)),
	);
});
const ignored = computed(() => new Set(data.value?.ignoreList ?? []));
/** Ignore-list collections (Directus configuration) without a rule: they never clear but have no row here. */
const ignoredWithoutRule = computed(() => [...ignored.value].filter((name) => !draft.collections[name]).sort());
const addChoices = computed(() =>
	(data.value?.collections ?? [])
		.filter((entry) => entry.targetable && !draft.collections[entry.name])
		.map((entry) => ({ text: entry.name, value: entry.name })),
);
const saveText = computed(() => {
	if (invalidTtl.value.length) return `Save & Apply · Fix the lifetime of ${invalidTtl.value.join(', ')}`;
	return dirty.value ? 'Save & Apply · Unsaved changes' : 'Save & Apply';
});

function fieldChoices(collection: string) {
	const fields = data.value?.collections.find((entry) => entry.name === collection)?.fields ?? [];
	return fields.map((field) => ({ text: field, value: field }));
}

function onAdd(name: string | null) {
	if (!name) return;
	addRule(name);
	// Keep a new rule visible while filtering.
	if (filter.value && !name.toLowerCase().includes(filter.value.trim().toLowerCase())) filter.value = '';
}

onMounted(load);
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
.section-divider.add-margin-top {
	margin-top: 40px;
}
.notice {
	margin-bottom: 16px;
}
.notice a {
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
.subdued,
.meta,
.explain {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
	line-height: 1.5;
}
.meta {
	margin: 12px 0;
}
p.explain {
	margin: 0 0 16px;
}
.filter {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 12px;
}
.filter .v-input {
	max-width: 360px;
}
.empty {
	margin: 8px 0 0;
}
.choice {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}
@media (max-width: 900px) {
	.choice {
		grid-template-columns: 1fr;
	}
}
.option {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 16px 18px;
	text-align: left;
	color: inherit;
	border-radius: var(--theme--border-radius, var(--border-radius));
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	background: var(--theme--background, var(--background-page));
	cursor: pointer;
}
.option.active {
	border-color: var(--theme--primary, var(--primary));
}
.option.active > .v-icon {
	color: var(--theme--primary, var(--primary));
}
.option-text {
	display: flex;
	flex-direction: column;
	gap: 4px;
	line-height: 1.5;
}
.toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 16px;
}
.toolbar-notice {
	flex: 1 1 360px;
	margin: 0;
}
.add-rule {
	width: 100%;
	max-width: 320px;
}
.table-wrap {
	overflow: auto;
	border: var(--theme--border-width, var(--border-width)) solid var(--theme--border-color-subdued, var(--border-subdued));
	border-radius: var(--theme--border-radius, var(--border-radius));
}
table {
	width: 100%;
	table-layout: fixed;
	border-collapse: collapse;
	font-size: 13px;
}
th,
td {
	padding: 8px 10px;
	text-align: left;
	vertical-align: middle;
	overflow: hidden;
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
.name-col {
	width: 22%;
	min-width: 0;
}
th.center,
td.center {
	width: 4.5rem;
	text-align: center;
}
td.center :deep(.v-checkbox) {
	display: inline-flex;
	margin: 0;
}
.name {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
}
.row-hint {
	display: block;
	margin-top: 2px;
	font-size: 12px;
	line-height: 1.4;
	overflow-wrap: anywhere;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
th.fields-col,
th.ttl-col {
	cursor: pointer;
}

.fields-col {
	width: auto;
	min-width: 0;
}
.ttl-col {
	width: 10.5rem;
}
.action-col {
	width: 2.75rem;
	text-align: right;
}
.field-error {
	display: block;
	font-size: 12px;
	color: var(--theme--danger, var(--danger));
}
.field-hint {
	display: block;
	margin-top: 4px;
	font-size: 12px;
	line-height: 1.4;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.invalid {
	--theme--form--field--input--border-color: var(--theme--danger, var(--danger));
}
code {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
	font-size: 0.9em;
}
/* More specific than Directus' own paragraph styles, so the gap below the mode choice always applies. */
p.explain.after-choice {
	margin: 24px 0 0;
	padding-top: 0;
}
.after-choice a {
	color: var(--theme--primary, var(--primary));
}
.advanced {
	margin-top: 24px;
}
.advanced p.explain {
	margin: 8px 0 0 32px;
	max-width: 760px;
}
</style>
