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
				<v-icon name="refresh" />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="How clearing works" :close="false">
				<p class="sidebar-text">
					By default, Directus clears its <strong>whole</strong> cache on every change, even when a visit is counted.
					Pages and videos that did not change have to be loaded from the database again.
				</p>
				<p class="sidebar-text">
					<strong>Clear only what changed</strong> remembers which collections each cached answer uses. A change then
					clears only the answers that use the changed collection, including answers that reach it through relations.
				</p>
				<p class="sidebar-text">
					Changes to users, roles, permissions, policies, settings or the data model still clear everything, because they
					can change any answer.
				</p>
			</sidebar-detail>
			<sidebar-detail id="rules" icon="rule" title="Rules per collection">
				<p class="sidebar-text">
					<strong>Clear on</strong>: which changes clear the cache. Turn off "Update" for collections where only new or
					deleted items matter.
				</p>
				<p class="sidebar-text">
					<strong>Unless only these fields changed</strong>: changes that only touch these fields keep the cache, for
					example a view counter. A change to any other field still clears.
				</p>
				<p class="sidebar-text">
					<strong>Keep answers for</strong>: how long answers that use this collection stay in the cache. An answer that
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
					"Clear the cache when content changes" is off on the Status page, so changes don't clear anything. Only the
					times in "Keep answers for" apply.
				</v-notice>
				<v-notice v-if="data.status.store !== 'memory' && draft.targeted" type="warning" class="notice">
					The cache is kept in {{ data.status.store }}. Clearing only what changed works with one Directus process. With
					several, turn it off.
				</v-notice>

				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="my_location" /></template>
					What a change clears
				</v-divider>

				<div class="choice">
					<button type="button" class="option" :class="{ active: !draft.targeted }" @click="draft.targeted = false">
						<v-icon :name="!draft.targeted ? 'radio_button_checked' : 'radio_button_unchecked'" />
						<span class="option-text">
							<strong>The whole cache</strong>
							<span class="subdued">Directus default. Every change clears every cached answer.</span>
						</span>
					</button>
					<button type="button" class="option" :class="{ active: draft.targeted }" @click="draft.targeted = true">
						<v-icon :name="draft.targeted ? 'radio_button_checked' : 'radio_button_unchecked'" />
						<span class="option-text">
							<strong>Only what changed</strong>
							<span class="subdued">
								A change clears only the answers that use the changed collection. Everything else stays cached.
							</span>
						</span>
					</button>
				</div>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="rule" /></template>
					Rules per collection
				</v-divider>

				<div class="toolbar">
					<span class="subdued">Collections without a rule clear on every change and use the global time ({{ data.globalTtl }}).</span>
					<div class="add-rule">
						<v-select :model-value="null" :items="addChoices" :disabled="!addChoices.length" placeholder="Add a rule for…" @update:model-value="onAdd" />
					</div>
				</div>

				<div v-if="ruleNames.length" class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Collection</th>
								<th class="center">Create</th>
								<th class="center">Update</th>
								<th class="center">Delete</th>
								<th>Unless only these fields changed</th>
								<th>Keep answers for</th>
								<th class="action-col" />
							</tr>
						</thead>
						<tbody>
							<tr v-for="name in ruleNames" :key="name">
								<td>
									<span class="name">{{ name }}</span>
									<span class="row-hint">{{ describeRule(draft.collections[name]!) }}</span>
								</td>
								<template v-if="ignored.has(name)">
									<td colspan="4" class="subdued">Ignored on the Optimize page: changes never clear the cache.</td>
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

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="history" /></template>
					What happened since Directus started
				</v-divider>

				<div class="tiles">
					<div class="tile">
						<span class="label">Whole cache cleared</span>
						<span class="value">{{ times(data.status.counts.full) }}</span>
					</div>
					<div class="tile">
						<span class="label">Only what changed cleared</span>
						<span class="value">{{ times(data.status.counts.targeted) }}</span>
						<span class="explain">{{ formatNumber(data.status.counts.removed) }} {{ data.status.counts.removed === 1 ? 'cached answer' : 'cached answers' }} removed in total.</span>
					</div>
					<div class="tile">
						<span class="label">Kept by a rule</span>
						<span class="value">{{ formatNumber(data.status.counts.skipped) }} {{ data.status.counts.skipped === 1 ? 'change' : 'changes' }}</span>
						<span class="explain">Changes that did not clear anything because of a rule.</span>
					</div>
				</div>
				<p v-if="data.status.targetedActive" class="meta">
					{{ formatNumber(data.status.indexed) }} answers in the cache right now.
					<template v-if="topCollections.length">Most used: {{ topCollections.join(', ') }}.</template>
				</p>

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
				<p class="meta">Shows the last 50 events. Counted in memory since {{ new Date(data.status.since).toLocaleString() }}.</p>
			</template>

			<div v-if="data" class="save-bar">
				<span class="muted" :class="{ danger: invalidTtl.length }">{{ saveText }}</span>
				<div class="actions-right">
					<v-button secondary :disabled="!dirty || saving" @click="discard">Discard Changes</v-button>
					<v-button :loading="saving" :disabled="!canSave || loading" @click="save">Save &amp; Apply</v-button>
				</div>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import { useRules, type RulesStatus } from './composables/use-rules';
import { usePageClass } from './composables/use-page-class';
import { describeRule } from '../shared/rules';
import { TTL_ERROR } from '../shared/duration';
import { formatNumber } from '../shared/format';

const pageClass = usePageClass();
const { data, draft, loading, saving, error, message, dirty, canSave, invalidTtl, load, save, discard, addRule, removeRule, updateRule } = useRules();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };
const actions = ['create', 'update', 'delete'] as const;

const ruleNames = computed(() => Object.keys(draft.collections).sort());
const ignored = computed(() => new Set(data.value?.ignoreList ?? []));
const addChoices = computed(() =>
	(data.value?.collections ?? [])
		.filter((entry) => entry.targetable && !draft.collections[entry.name])
		.map((entry) => ({ text: entry.name, value: entry.name })),
);
const topCollections = computed(() =>
	Object.entries(data.value?.status.indexedByCollection ?? {})
		.filter(([name]) => name !== '*')
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([name, count]) => `${name} (${formatNumber(count)})`),
);
const saveText = computed(() => {
	if (invalidTtl.value.length) return `Check the time for ${invalidTtl.value.join(', ')}`;
	return dirty.value ? 'Unsaved changes' : 'No unsaved changes';
});

function fieldChoices(collection: string) {
	const fields = data.value?.collections.find((entry) => entry.name === collection)?.fields ?? [];
	return fields.map((field) => ({ text: field, value: field }));
}

function times(count: number): string {
	return `${formatNumber(count)} ${count === 1 ? 'time' : 'times'}`;
}

function onAdd(name: string | null) {
	if (name) addRule(name);
}

function resultText(event: RulesStatus['recent'][number]): string {
	if (event.kind === 'full') return 'Whole cache cleared';
	if (event.kind === 'skipped') return 'Kept (rule)';
	return `${formatNumber(event.removed)} ${event.removed === 1 ? 'answer' : 'answers'} cleared`;
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
	font-weight: 700;
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
.save-bar {
	position: sticky;
	bottom: 0;
	z-index: 5;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 12px;
	margin-top: 20px;
	padding: 12px 0;
	border-top: var(--theme--border-width, var(--border-width, 1px)) solid var(--theme--border-color-subdued, var(--border-subdued));
	background: var(--theme--background, var(--background-page));
}
.muted {
	margin-right: auto;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.muted.danger {
	color: var(--theme--danger, var(--danger));
}
.actions-right {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}
</style>
