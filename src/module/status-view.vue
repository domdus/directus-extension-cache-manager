<template>
	<private-view title="Status" icon="cached">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Reset to configured values'" rounded icon secondary :disabled="!state?.stored || busy" @click="reset">
				<v-icon name="settings_backup_restore" />
			</v-button>
			<v-button v-tooltip.bottom="'Save & apply'" rounded icon :loading="saving" :disabled="!dirty || busy" @click="save">
				<v-icon name="check" />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About" :close="false">
				<p class="sidebar-text">
					<strong>Configured</strong> are the values Directus started with, from its configuration (.env, config file
					or environment variables).
				</p>
				<p class="sidebar-text">
					What you save here replaces them right away, without a restart, and stays after a restart until you reset it.
				</p>
				<p class="sidebar-text">If Directus runs more than once (several servers), restart the others after saving.</p>
			</sidebar-detail>
			<sidebar-detail id="auto-purge" icon="delete_sweep" title="Empty the cache when content changes">
				<p class="sidebar-text">
					<strong>On:</strong> any change to a collection that is not selected empties the whole cache, so everyone sees
					the change right away.
				</p>
				<p class="sidebar-text">
					<strong>Off:</strong> changes only show up when cached answers expire (CACHE_TTL). Editors may wait that long
					to see their changes.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on.</p>
			</sidebar-detail>
			<sidebar-detail id="skip-allowed" icon="bolt" title="Allow apps to skip the cache">
				<p class="sidebar-text">
					<strong>On:</strong> an app can ask for fresh data by sending the header <code>Cache-Control: no-store</code>.
					Apps need this to read selected collections up to date.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on, for a Directus that is not open to the public.</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>

			<div v-if="!state && loadingState" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="state">
				<v-notice v-if="!state.env.CACHE_ENABLED" type="warning" class="notice">
					CACHE_ENABLED is off. These settings only matter when the response cache is enabled.
				</v-notice>
				<v-notice v-if="!state.inSync" type="warning" class="notice">
					The running values differ from the configured values plus the saved override. Save again or restart Directus.
				</v-notice>
				<pending-changes />

				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="tune" /></template>
					Current values
				</v-divider>

				<table class="values">
					<thead>
						<tr>
							<th>Setting</th>
							<th>Configured</th>
							<th>Override</th>
							<th>In effect</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>Empty the cache when content changes <span class="env-name">CACHE_AUTO_PURGE</span></td>
							<td>{{ onOff(state.baseline.autoPurge) }}</td>
							<td>{{ state.stored?.autoPurge == null ? '–' : onOff(state.stored.autoPurge) }}</td>
							<td><strong>{{ onOff(state.effective.autoPurge) }}</strong></td>
						</tr>
						<tr>
							<td>Allow apps to skip the cache <span class="env-name">CACHE_SKIP_ALLOWED</span></td>
							<td>{{ onOff(state.baseline.skipAllowed) }}</td>
							<td>{{ state.stored?.skipAllowed == null ? '–' : onOff(state.stored.skipAllowed) }}</td>
							<td><strong>{{ onOff(state.effective.skipAllowed) }}</strong></td>
						</tr>
						<tr>
							<td>Collections whose changes don't empty the cache <span class="env-name">CACHE_AUTO_PURGE_IGNORE_LIST</span></td>
							<td>{{ listText(state.baseline.ignoreList) }}</td>
							<td>{{ state.stored?.ignoreList == null ? '–' : listText(state.stored.ignoreList) }}</td>
							<td><strong>{{ listText(state.effective.ignoreList) }}</strong></td>
						</tr>
						<tr class="readonly">
							<td>How long answers stay in the cache <span class="env-name">CACHE_TTL</span></td>
							<td colspan="3">{{ state.env.CACHE_TTL ?? '–' }} <span class="subdued">(read only)</span></td>
						</tr>
						<tr class="readonly">
							<td>Where the cache is kept <span class="env-name">CACHE_STORE</span></td>
							<td colspan="3">{{ state.env.CACHE_STORE ?? '–' }} <span class="subdued">(read only)</span></td>
						</tr>
					</tbody>
				</table>
				<p class="meta">
					<template v-if="state.configPath">Config file: <code>{{ state.configPath }}</code>. </template>
					<template v-if="state.stored?.updatedAt">Override saved {{ new Date(state.stored.updatedAt).toLocaleString() }}.</template>
					<template v-else>No override saved.</template>
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="cached" /></template>
					When the cache is emptied
				</v-divider>

				<div class="toggles">
					<div>
						<v-checkbox v-model="draft.autoPurge" block label="Empty the cache when content changes" />
						<span class="env-name">CACHE_AUTO_PURGE</span>
					</div>
					<div>
						<v-checkbox v-model="draft.skipAllowed" block label="Allow apps to skip the cache" />
						<span class="env-name">CACHE_SKIP_ALLOWED</span>
					</div>
				</div>
				<p class="ttl-note">
					<v-icon name="schedule" small />
					<span>
						Selected collections can be served from the cache for up to <strong>{{ state.env.CACHE_TTL ?? '–' }}</strong>
						after a change (CACHE_TTL, read from the running configuration). Apps can ask for fresh data with the header
						<code>Cache-Control: no-store</code> when "Allow apps to skip the cache" is on.
					</span>
				</p>
				<p class="meta">
					Collections whose changes don't empty the cache: {{ listText(draft.ignoreList) }}.
					<router-link to="/cache-manager/analysis">Choose them in Analysis</router-link>
				</p>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, draft, busy, dirty, saving, loadingState, error, message, loadState, save, reset } = useCacheManager();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued)' };

function onOff(value: boolean) {
	return value ? 'on' : 'off';
}
function listText(list: string[]) {
	return list.length ? list.join(', ') : '(empty)';
}

onMounted(() => loadState(true));
</script>

<style scoped>
.page-container {
	padding: var(--content-padding);
	padding-block-end: var(--content-padding-bottom);
	max-inline-size: 67.5rem;
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
	color: var(--theme--foreground);
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
}
th {
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}
.subdued,
.meta {
	color: var(--theme--foreground-subdued);
}
.meta {
	margin-top: 12px;
	line-height: 1.55;
}
.meta a {
	color: var(--theme--primary);
}
.toggles {
	display: grid;
	gap: 12px;
	max-inline-size: 36rem;
}
td .env-name {
	display: block;
}
.env-name {
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}
.toggles .env-name {
	margin: 4px 0 0 2px;
	display: block;
}
.ttl-note {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	margin-top: 16px;
	max-inline-size: 42rem;
	line-height: 1.55;
	color: var(--theme--foreground-subdued);
}
code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}
</style>
