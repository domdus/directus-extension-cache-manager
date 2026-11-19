<template>
	<private-view title="Cache manager">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="cached" />
			</v-button>
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Reset to config'" rounded icon secondary :disabled="!state?.stored || busy" @click="reset">
				<v-icon name="settings_backup_restore" />
			</v-button>
			<v-button v-tooltip.bottom="'Save & apply'" rounded icon :loading="saving" :disabled="!dirty || busy" @click="save">
				<v-icon name="check" />
			</v-button>
		</template>

		<div class="cache-manager">
			<v-notice v-if="error" type="danger">{{ error }}</v-notice>
			<v-notice v-if="message" type="success">{{ message }}</v-notice>

			<template v-if="state">
				<v-notice v-if="!state.env.CACHE_ENABLED" type="warning">
					CACHE_ENABLED is off. These settings only matter when the response cache is enabled.
				</v-notice>
				<v-notice v-if="!state.inSync" type="warning">
					The running values differ from config + stored override. The startup hook may not have run, or another
					Directus process saved different values. Save again or restart.
				</v-notice>

				<section>
					<h2>Current values</h2>
					<table class="values">
						<thead>
							<tr>
								<th>Setting</th>
								<th>Config (config_app.json)</th>
								<th>Override</th>
								<th>Effective now</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td><code>CACHE_AUTO_PURGE</code></td>
								<td>{{ onOff(state.baseline.autoPurge) }}</td>
								<td>{{ state.stored?.autoPurge == null ? '–' : onOff(state.stored.autoPurge) }}</td>
								<td>
									<strong>{{ onOff(state.effective.autoPurge) }}</strong>
								</td>
							</tr>
							<tr>
								<td><code>CACHE_SKIP_ALLOWED</code></td>
								<td>{{ onOff(state.baseline.skipAllowed) }}</td>
								<td>{{ state.stored?.skipAllowed == null ? '–' : onOff(state.stored.skipAllowed) }}</td>
								<td>
									<strong>{{ onOff(state.effective.skipAllowed) }}</strong>
								</td>
							</tr>
							<tr>
								<td><code>CACHE_AUTO_PURGE_IGNORE_LIST</code></td>
								<td>{{ listText(state.baseline.ignoreList) }}</td>
								<td>{{ state.stored?.ignoreList == null ? '–' : listText(state.stored.ignoreList) }}</td>
								<td>
									<strong>{{ listText(state.effective.ignoreList) }}</strong>
								</td>
							</tr>
							<tr>
								<td><code>CACHE_TTL</code></td>
								<td colspan="3">{{ state.env.CACHE_TTL ?? '–' }} (not managed here)</td>
							</tr>
							<tr>
								<td><code>CACHE_STORE</code></td>
								<td colspan="3">{{ state.env.CACHE_STORE ?? '–' }} (not managed here)</td>
							</tr>
						</tbody>
					</table>
					<p class="hint">
						config_app.json (Ansible) is the baseline. The override saved here wins until you reset it, and is applied
						again after every restart.
						<template v-if="state.stored?.updatedAt">
							Last saved {{ new Date(state.stored.updatedAt).toLocaleString() }}.
						</template>
					</p>
				</section>

				<section>
					<h2>Purge behaviour</h2>
					<div class="toggle">
						<v-checkbox v-model="draft.autoPurge" block label="CACHE_AUTO_PURGE: clear the cache on writes" />
						<p class="hint">
							<strong>On:</strong> every write to a collection that is not ignored clears the <em>whole</em> response cache.
							<strong>Off:</strong> nothing is cleared on writes. Data is only refreshed after CACHE_TTL
							({{ state.env.CACHE_TTL ?? '–' }}), so editors' changes take up to that long to appear.
							<strong>Recommended: keep on.</strong>
						</p>
					</div>
					<div class="toggle">
						<v-checkbox v-model="draft.skipAllowed" block label="CACHE_SKIP_ALLOWED: let clients bypass the cache" />
						<p class="hint">
							<strong>On:</strong> a client can bypass the cache per request with the header
							<code>Cache-Control: no-store</code>. Apps need this to read ignored collections fresh.
							<strong>Recommended: on</strong> for an internal Directus.
						</p>
					</div>
				</section>

				<section>
					<div class="row">
						<h2>Which collections cause purges</h2>
						<div class="controls">
							<v-select v-model="hours" :items="hourItems" inline />
							<v-button small secondary :loading="loading" @click="loadAnalysis">Refresh</v-button>
						</div>
					</div>

					<template v-if="analysis">
						<div class="stats">
							<div class="stat">
								<span class="label">Minutes with a full purge now</span>
								<span class="value">{{ analysis.purgeMinutes }} / {{ analysis.windowMinutes }}</span>
								<span class="sub">{{ percent(analysis.purgeMinutes / analysis.windowMinutes) }}</span>
							</div>
							<div class="stat" :class="{ changed: dirty }">
								<span class="label">With your selection</span>
								<span class="value">{{ whatIf }} / {{ analysis.windowMinutes }}</span>
								<span class="sub">{{ percent(whatIf / analysis.windowMinutes) }}</span>
							</div>
							<div class="stat">
								<span class="label">With all recommendations</span>
								<span class="value">{{ analysis.recommendedPurgeMinutes }} / {{ analysis.windowMinutes }}</span>
								<span class="sub">{{ percent(analysis.recommendedPurgeMinutes / analysis.windowMinutes) }}</span>
							</div>
						</div>

						<p class="hint">
							Last {{ analysis.hours }} h, from directus_activity. Writes made without a user context (some Flows run with
							no accountability) are not logged there, so these numbers can be too low.
							<template v-if="!analysis.editorHeuristic">
								PUBLIC_URL is not absolute, so admin-app edits cannot be told apart from app writes.
							</template>
						</p>

						<div class="row">
							<v-button small secondary :disabled="!addableRecommendations.length" @click="addRecommended">
								Add {{ addableRecommendations.length }} recommended
							</v-button>
							<div class="add-other">
								<select v-model="otherCollection" class="native-select">
									<option value="">Add another collection…</option>
									<option v-for="name in otherCollections" :key="name" :value="name">{{ name }}</option>
								</select>
								<v-button small secondary :disabled="!otherCollection" @click="addOther">Add</v-button>
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
								<tr v-for="row in rows" :key="row.collection" :class="{ recommended: row.recommended }">
									<td><v-checkbox :model-value="draftSet.has(row.collection)" @update:model-value="toggle(row.collection, $event)" /></td>
									<td>
										<code>{{ row.collection }}</code>
									</td>
									<td class="num">{{ row.writes.toLocaleString() }}</td>
									<td class="num">{{ row.minutes.toLocaleString() }}</td>
									<td class="num">{{ percent(row.share) }}</td>
									<td class="num">{{ row.ignored ? '–' : row.savedMinutes.toLocaleString() }}</td>
									<td>{{ row.ignored ? 'yes' : 'no' }}</td>
									<td>
										<span v-if="row.recommended" class="badge">Ignore</span>
										<span class="reason">{{ row.reason }}</span>
									</td>
								</tr>
							</tbody>
						</table>

						<v-notice v-if="addableRecommendations.length || analysis.recommendedList.length" type="warning" class="spaced">
							Reads of an ignored collection can be up to CACHE_TTL ({{ state.env.CACHE_TTL ?? '–' }}) old for apps,
							unless they send <code>Cache-Control: no-store</code>, which only works with CACHE_SKIP_ALLOWED on. The
							admin app always bypasses the cache for ignored collections.
						</v-notice>
					</template>
					<v-progress-circular v-else-if="loading" indeterminate />
				</section>

				<section>
					<h2>How to choose the ignore list</h2>
					<ul class="guide">
						<li>
							Put write-heavy collections here (counters, logs, sessions, analytics) that apps either do not read through
							the cache or read with <code>Cache-Control: no-store</code>.
						</li>
						<li>
							Never put collections the portals read for access decisions (subscriptions, purchases, entitlements) here,
							unless those reads send <code>no-store</code>. Otherwise a user can get or lose access up to CACHE_TTL late.
						</li>
						<li>
							Writes to an ignored collection no longer clear the cache. Its cached responses stay until CACHE_TTL expires or
							another write clears the cache.
						</li>
						<li>
							Recommended: not ignored, written in at least {{ percent(RECOMMEND_MIN_SHARE) }} of minutes, not a system
							collection, and not mostly edited in the admin app (more than {{ percent(EDITOR_SHARE_MAX) }} of writes by
							logged-in users from PUBLIC_URL).
						</li>
						<li>The values apply to this Directus process only. With several instances, restart the others after saving.</li>
					</ul>
				</section>

				<div class="footer-actions">
					<v-button secondary :disabled="!state.stored || busy" @click="reset">Reset to config</v-button>
					<v-button :loading="saving" :disabled="!dirty || busy" @click="save">Save &amp; apply</v-button>
				</div>
			</template>
			<v-progress-circular v-else-if="!error" indeterminate />
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { purgeMinutes, type Analysis, type CollectionStats } from '../shared/analysis';
import { DEFAULT_HOURS, EDITOR_SHARE_MAX, EXTENSION_ID, RECOMMEND_MIN_SHARE } from '../shared/constants';
import { sameValues, toOverride, type CacheValues, type StoredOverride } from '../shared/settings';

type State = {
	baseline: CacheValues;
	effective: CacheValues;
	stored: StoredOverride | null;
	inSync: boolean;
	startupApplied: boolean;
	env: { CACHE_ENABLED: boolean; CACHE_TTL: unknown; CACHE_STORE: unknown };
	collections: string[];
};

const api = useApi();
const base = `/${EXTENSION_ID}`;

const state = ref<State | null>(null);
const analysis = ref<Analysis | null>(null);
const draft = reactive<CacheValues>({ autoPurge: true, skipAllowed: false, ignoreList: [] });
const hours = ref(DEFAULT_HOURS);
const hourItems = [1, 6, 24, 72, 168].map((value) => ({ text: `Last ${value} h`, value }));
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);
const otherCollection = ref('');

const busy = computed(() => saving.value || loading.value);
const draftSet = computed(() => new Set(draft.ignoreList));
const dirty = computed(() => !!state.value && !sameValues(draft, state.value.effective));

const whatIf = computed(() => (analysis.value ? purgeMinutes(analysis.value.minuteSets, draft.ignoreList, draft.autoPurge) : 0));

/** Collections with writes plus every collection in a list, so nothing in the list is hidden. */
const rows = computed<CollectionStats[]>(() => {
	const list = analysis.value?.collections ?? [];
	const known = new Set(list.map((row) => row.collection));
	const extra = new Set([...draft.ignoreList, ...(state.value?.effective.ignoreList ?? []), ...(state.value?.baseline.ignoreList ?? [])]);
	const effective = new Set(state.value?.effective.ignoreList ?? []);
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

function onOff(value: boolean) {
	return value ? 'on' : 'off';
}
function listText(list: string[]) {
	return list.length ? list.join(', ') : '(empty)';
}
function percent(share: number) {
	return `${(Math.round((share || 0) * 1000) / 10).toLocaleString()} %`;
}

function errorText(err: any): string {
	return err?.response?.data?.errors?.[0]?.message ?? err?.message ?? 'Request failed';
}

function resetDraft() {
	if (!state.value) return;
	draft.autoPurge = state.value.effective.autoPurge;
	draft.skipAllowed = state.value.effective.skipAllowed;
	draft.ignoreList = [...state.value.effective.ignoreList];
}

function toggle(collection: string, on: boolean) {
	draft.ignoreList = on ? [...new Set([...draft.ignoreList, collection])] : draft.ignoreList.filter((name) => name !== collection);
}

function addRecommended() {
	draft.ignoreList = [...new Set([...draft.ignoreList, ...addableRecommendations.value])];
}

function addOther() {
	if (otherCollection.value) toggle(otherCollection.value, true);
	otherCollection.value = '';
}

async function loadState() {
	const { data } = await api.get(`${base}/state`);
	state.value = data;
	resetDraft();
}

async function loadAnalysis() {
	loading.value = true;
	error.value = null;
	try {
		const { data } = await api.get(`${base}/analysis`, { params: { hours: hours.value } });
		analysis.value = data;
	} catch (err) {
		error.value = errorText(err);
	} finally {
		loading.value = false;
	}
}

async function save() {
	if (!state.value) return;
	saving.value = true;
	error.value = null;
	message.value = null;
	try {
		const body = toOverride(state.value.baseline, draft);
		const { data } = await api.post(`${base}/apply`, body);
		state.value = data;
		resetDraft();
		message.value = 'Saved and applied. Takes effect for the next writes and requests.';
		await loadAnalysis();
	} catch (err) {
		error.value = errorText(err);
	} finally {
		saving.value = false;
	}
}

async function reset() {
	if (!state.value) return;
	if (!window.confirm('Remove the override and use the values from config_app.json again?')) return;
	saving.value = true;
	error.value = null;
	message.value = null;
	try {
		const { data } = await api.post(`${base}/reset`);
		state.value = data;
		resetDraft();
		message.value = 'Reset to config values.';
		await loadAnalysis();
	} catch (err) {
		error.value = errorText(err);
	} finally {
		saving.value = false;
	}
}

watch(hours, loadAnalysis);

onMounted(async () => {
	try {
		await loadState();
	} catch (err) {
		error.value = errorText(err);
		return;
	}
	await loadAnalysis();
});
</script>

<style scoped>
.cache-manager {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 1200px;
}
section {
	margin-bottom: 40px;
}
h2 {
	font-size: 18px;
	font-weight: 600;
	margin-bottom: 12px;
}
.hint {
	color: var(--theme--foreground-subdued);
	margin-top: 8px;
	line-height: 1.5;
}
.toggle {
	margin-bottom: 20px;
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
tr.recommended td {
	background: var(--theme--primary-background, transparent);
}
.badge {
	display: inline-block;
	padding: 2px 8px;
	margin-right: 6px;
	border-radius: 12px;
	background: var(--theme--primary);
	color: var(--foreground-inverted, #fff);
	font-size: 12px;
}
.reason {
	color: var(--theme--foreground-subdued);
}
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 12px;
}
.controls,
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
.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 12px;
	margin-bottom: 12px;
}
.stat {
	display: flex;
	flex-direction: column;
	padding: 12px 16px;
	border: var(--theme--border-width, 1px) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
}
.stat.changed {
	border-color: var(--theme--primary);
}
.stat .label {
	color: var(--theme--foreground-subdued);
}
.stat .value {
	font-size: 22px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.stat .sub {
	color: var(--theme--foreground-subdued);
}
.guide li {
	margin: 0 0 8px 20px;
	list-style: disc;
	line-height: 1.5;
}
.spaced {
	margin-top: 16px;
}
.footer-actions {
	display: flex;
	gap: 12px;
	justify-content: flex-end;
}
</style>
