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
					An <strong>override</strong> saved here wins until you reset it. It takes effect at once, without a restart,
					and is applied again after every restart.
				</p>
				<p class="sidebar-text">
					The change applies to the Directus process that handles the save. With several instances, restart the others
					after saving so they apply the override too.
				</p>
			</sidebar-detail>
			<sidebar-detail id="auto-purge" icon="delete_sweep" title="CACHE_AUTO_PURGE">
				<p class="sidebar-text">
					<strong>On:</strong> every write to a collection that is not ignored clears the <em>whole</em> response cache.
				</p>
				<p class="sidebar-text">
					<strong>Off:</strong> nothing is cleared on writes. Data is only refreshed after CACHE_TTL, so editors' changes
					take up to CACHE_TTL to appear.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on.</p>
			</sidebar-detail>
			<sidebar-detail id="skip-allowed" icon="bolt" title="CACHE_SKIP_ALLOWED">
				<p class="sidebar-text">
					<strong>On:</strong> a client can bypass the cache for one request with the header
					<code>Cache-Control: no-store</code>. Apps need this to read ignored collections fresh.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on, for a Directus that is not open to the public.</p>
			</sidebar-detail>
			<stale-reads-detail />
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
							<td><code>CACHE_AUTO_PURGE</code></td>
							<td>{{ onOff(state.baseline.autoPurge) }}</td>
							<td>{{ state.stored?.autoPurge == null ? '–' : onOff(state.stored.autoPurge) }}</td>
							<td><strong>{{ onOff(state.effective.autoPurge) }}</strong></td>
						</tr>
						<tr>
							<td><code>CACHE_SKIP_ALLOWED</code></td>
							<td>{{ onOff(state.baseline.skipAllowed) }}</td>
							<td>{{ state.stored?.skipAllowed == null ? '–' : onOff(state.stored.skipAllowed) }}</td>
							<td><strong>{{ onOff(state.effective.skipAllowed) }}</strong></td>
						</tr>
						<tr>
							<td><code>CACHE_AUTO_PURGE_IGNORE_LIST</code></td>
							<td>{{ listText(state.baseline.ignoreList) }}</td>
							<td>{{ state.stored?.ignoreList == null ? '–' : listText(state.stored.ignoreList) }}</td>
							<td><strong>{{ listText(state.effective.ignoreList) }}</strong></td>
						</tr>
						<tr class="readonly">
							<td><code>CACHE_TTL</code></td>
							<td colspan="3">{{ state.env.CACHE_TTL ?? '–' }} <span class="subdued">(read only)</span></td>
						</tr>
						<tr class="readonly">
							<td><code>CACHE_STORE</code></td>
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
					Purge behaviour
				</v-divider>

				<div class="toggles">
					<v-checkbox v-model="draft.autoPurge" block label="Clear the cache on writes (CACHE_AUTO_PURGE)" />
					<v-checkbox v-model="draft.skipAllowed" block label="Let clients bypass the cache (CACHE_SKIP_ALLOWED)" />
				</div>
				<p class="meta">
					Ignore list: {{ listText(draft.ignoreList) }}.
					<router-link to="/cache-manager/analysis">Choose collections in Analysis</router-link>
				</p>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import StaleReadsDetail from './stale-reads-detail.vue';
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
code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}
</style>
