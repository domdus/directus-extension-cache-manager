<template>
	<private-view title="Granular Cache" icon="grain">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loading" :disabled="saving" @click="load">
				<v-icon name="refresh" />
			</v-button>
			<v-button v-tooltip.bottom="'Discard Changes'" rounded icon secondary :disabled="!dirty || saving" @click="discard">
				<v-icon name="undo" />
			</v-button>
			<v-button v-tooltip.bottom="saveText" rounded icon :loading="saving" :disabled="!canSave || loading" @click="save">
				<v-icon name="check" />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="How It Works" :close="false">
				<p class="sidebar-text">
					With Auto Purge on, Directus clears its <strong>whole</strong> cache on every change, even when a visit is counted.
					Pages and videos that did not change have to be loaded from the database again.
				</p>
				<p class="sidebar-text">
					<strong>Granular</strong> remembers which collections each cached answer uses. A change then
					clears only the answers that use the changed collection, including answers that reach it through relations.
				</p>
				<p class="sidebar-text">
					Changes to users, roles, permissions, policies, settings or the data model still clear everything, because they
					can change any answer.
				</p>
			</sidebar-detail>
			<sidebar-detail id="rules" icon="rule" title="Rules">
				<p class="sidebar-text">
					<strong>Create, Update, Delete</strong>: which changes clear the cache. Turn off "Update" for collections where only new or
					deleted items matter.
				</p>
				<p class="sidebar-text">
					<strong>Skip Fields</strong>: changes that only touch these fields keep the cache, for example a view
					counter. A change to any other field still clears.
				</p>
				<p class="sidebar-text">
					<strong>Lifetime</strong>: how long answers that use this collection stay in the cache. An answer that
					uses several collections gets the shortest of their times; collections without their own time count with the
					global one ({{ data?.globalTtl ?? 'CACHE_TTL' }}).
				</p>
				<p class="sidebar-text">
					Apps that need data up to date right away can always ask for it with <code>Cache-Control: no-store</code>.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>

			<div v-if="!data && loading" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="data">
				<v-notice v-if="data.status.problems.length" type="warning" class="notice">
					{{ data.status.problems.join('. ') }}. Directus clears the whole cache as usual.
				</v-notice>
				<v-notice v-else-if="!data.status.autoPurge" type="info" class="notice">
					Auto Purge is off on the <router-link to="/cache-manager">Status</router-link> page, so changes don't clear
					anything. Only the lifetimes apply.
				</v-notice>
				<v-notice v-if="data.status.store !== 'memory' && draft.targeted" type="warning" class="notice">
					The cache is kept in {{ data.status.store }}. Granular mode works with one Directus process. With several, use
					Whole Cache.
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
							<strong>Whole Cache</strong>
							<span class="subdued">How Directus does it. Every change clears every cached answer.</span>
						</span>
					</button>
					<button type="button" class="option" :class="{ active: draft.targeted }" @click="draft.targeted = true">
						<v-icon :name="draft.targeted ? 'radio_button_checked' : 'radio_button_unchecked'" />
						<span class="option-text">
							<strong>Granular</strong>
							<span class="subdued">
								A change clears only the answers that use the changed collection. Everything else stays cached.
							</span>
						</span>
					</button>
				</div>

				<div class="summary">
					<div class="summary-head">
						<span>Since Start <span class="since">{{ new Date(data.status.since).toLocaleString() }}</span></span>
						<router-link to="/cache-manager/statistics">Details in Statistics</router-link>
					</div>
					<section class="summary-bar" aria-label="Clear counts since start">
						<div class="stat">
							<span class="stat-value">{{ formatNumber(data.status.counts.full) }}</span>
							<span class="stat-label">
								Whole Cache
								<v-icon
									v-tooltip.top="'Changes that cleared every cached answer.'"
									name="help_outline"
									small
									class="stat-info"
								/>
							</span>
						</div>
						<div class="stat">
							<span class="stat-value">{{ formatNumber(data.status.counts.targeted) }}</span>
							<span class="stat-label">
								Granular
								<v-icon
									v-tooltip.top="'Changes that cleared only the answers that use the changed collection.'"
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
					</section>
					<span class="summary-note">{{ summaryNote }}</span>
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="rule" /></template>
					Rules
				</v-divider>
				<p class="explain">Change what a collection's changes clear, and how long its answers stay cached.</p>

				<div class="toolbar">
					<v-notice type="info" class="toolbar-notice">
						Collections without a rule clear on every change and use the global TTL ({{ data.globalTtl }}).
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
								<th>Collection</th>
								<th class="center">Create</th>
								<th class="center">Update</th>
								<th class="center">Delete</th>
								<th v-tooltip="'Changes that only touch these fields keep the cache'">Skip Fields</th>
								<th v-tooltip="'How long answers that use this collection stay cached'">Lifetime</th>
								<th class="action-col" />
							</tr>
						</thead>
						<tbody>
							<tr v-if="!shownNames.length">
								<td colspan="7" class="subdued">No rule matches "{{ filter }}".</td>
							</tr>
							<tr v-for="name in shownNames" :key="name">
								<td>
									<span class="name">{{ name }}</span>
									<span class="row-hint">{{ describeRule(draft.collections[name]!) }}</span>
								</td>
								<template v-if="ignored.has(name)">
									<td colspan="4" class="subdued">On the Ignore List: changes never clear the cache.</td>
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
										:placeholder="`${data.globalTtl} (global)`"
										:class="{ invalid: invalidTtl.includes(name) }"
										@update:model-value="(value) => updateRule(name, { ttl: value || null })"
									/>
									<span v-if="invalidTtl.includes(name)" class="field-error">{{ TTL_ERROR }}</span>
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
import { computed, onMounted, ref } from 'vue';
import ModuleNavigation from './navigation.vue';
import { useRules } from './composables/use-rules';
import { usePageClass } from './composables/use-page-class';
import { describeRule } from '../shared/rules';
import { TTL_ERROR } from '../shared/duration';
import { formatNumber } from '../shared/format';

const pageClass = usePageClass();
const { data, draft, loading, saving, error, message, dirty, canSave, invalidTtl, load, save, discard, addRule, removeRule, updateRule } = useRules();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };
const actions = ['create', 'update', 'delete'] as const;

const ruleNames = computed(() => Object.keys(draft.collections).sort());
/** The filter shows up once the list gets long. */
const FILTER_FROM = 5;
const filter = ref('');
const shownNames = computed(() => {
	const term = filter.value.trim().toLowerCase();
	if (!term || ruleNames.value.length <= FILTER_FROM) return ruleNames.value;
	return ruleNames.value.filter(
		(name) => name.toLowerCase().includes(term) || draft.collections[name]!.skipFields.some((field) => field.toLowerCase().includes(term)),
	);
});
const ignored = computed(() => new Set(data.value?.ignoreList ?? []));
const addChoices = computed(() =>
	(data.value?.collections ?? [])
		.filter((entry) => entry.targetable && !draft.collections[entry.name])
		.map((entry) => ({ text: entry.name, value: entry.name })),
);
const saveText = computed(() => {
	if (invalidTtl.value.length) return `Save & Apply · Check the time for ${invalidTtl.value.join(', ')}`;
	return dirty.value ? 'Save & Apply · Unsaved changes' : 'Save & Apply';
});

function fieldChoices(collection: string) {
	const fields = data.value?.collections.find((entry) => entry.name === collection)?.fields ?? [];
	return fields.map((field) => ({ text: field, value: field }));
}

/** What the numbers mean in the current mode. */
const summaryNote = computed(() => {
	const status = data.value?.status;
	if (!status) return '';
	if (!status.targetedActive) {
		return 'Whole Cache mode: every change that clears clears the whole cache.';
	}
	if (status.counts.full > 0) {
		return 'Whole-cache clears now only come from changes that can affect every answer (users, roles, permissions, settings, data model), from a manual clear, or from switching to Granular.';
	}
	return 'No change had to clear the whole cache.';
});

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
.since {
	margin-left: 8px;
	font-weight: 400;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
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
.summary {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin: 16px 0 0;
}
.summary-head {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	font-weight: 600;
}
.summary-head a {
	font-weight: 400;
	color: var(--theme--primary, var(--primary));
}
.summary-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
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
.summary-note {
	font-size: 13px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
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
th.center,
td.center {
	text-align: center;
	width: 70px;
}
td.center :deep(.v-checkbox) {
	display: inline-flex;
	margin: 0;
}
.name {
	display: block;
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
}
.row-hint {
	display: block;
	margin-top: 2px;
	font-size: 12px;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.fields-col {
	min-width: 220px;
}
.ttl-col {
	width: 170px;
}
.action-col {
	width: 44px;
	text-align: right;
}
.field-error {
	display: block;
	font-size: 12px;
	color: var(--theme--danger, var(--danger));
}
.invalid {
	--theme--form--field--input--border-color: var(--theme--danger, var(--danger));
}
code {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
	font-size: 0.9em;
}
</style>
