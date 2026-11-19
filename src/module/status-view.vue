<template>
	<private-view title="Status" icon="cached">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<v-button v-tooltip.bottom="'Reset to configured values'" rounded icon small secondary :disabled="!state?.stored || busy" @click="reset">
				<v-icon name="settings_backup_restore" small />
			</v-button>
			<v-button v-tooltip.bottom="'Save & apply'" rounded icon small :loading="saving" :disabled="!dirty || busy" @click="save">
				<v-icon name="check" small />
			</v-button>
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About" :close="false">
				<p class="sidebar-text">
					Directus keeps a copy of its answers, the cache, so it does not have to ask the database every time.
				</p>
				<p class="sidebar-text">
					<strong>Configured</strong> shows the values Directus started with. They come from its configuration: an .env
					file, a config file or environment variables.
				</p>
				<p class="sidebar-text">
					What you save here is used right away, without a restart. It stays after a restart until you reset it.
				</p>
				<p class="sidebar-text">If Directus runs on several servers, restart the other servers after saving.</p>
			</sidebar-detail>
			<sidebar-detail id="auto-purge" icon="delete_sweep" title="Clear the cache when content changes">
				<p class="sidebar-text">
					<strong>On:</strong> a change to a collection that is not selected clears the whole cache. Everyone sees the
					change right away.
				</p>
				<p class="sidebar-text">
					<strong>Off:</strong> changes only show up when the cached copy expires (see "How long answers stay in the
					cache"). Editors may wait that long to see their changes.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on.</p>
			</sidebar-detail>
			<sidebar-detail id="skip-allowed" icon="bolt" title="Allow apps to skip the cache">
				<p class="sidebar-text">
					<strong>On:</strong> an app can ask for fresh data. It sends the header <code>Cache-Control: no-store</code>.
				</p>
				<p class="sidebar-text">Apps need this to read selected collections up to date.</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on, if your Directus is not open to the public.</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>
			<v-notice v-if="message" type="success" class="notice">{{ message }}</v-notice>

			<div v-if="!state && loadingState" class="loading"><v-progress-circular indeterminate /></div>

			<template v-if="state">
				<v-notice v-if="!state.env.CACHE_ENABLED" type="warning" class="notice">
					The cache is turned off in the configuration, so these settings have no effect right now.
				</v-notice>
				<v-notice v-if="!state.inSync" type="warning" class="notice">
					The settings in use differ from what is configured and saved here. Save again or restart Directus.
				</v-notice>
				<pending-changes />

				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="tune" /></template>
					Current settings
				</v-divider>

				<div class="cards">
					<setting-card
						title="Clear the cache when content changes"
						env="CACHE_AUTO_PURGE"
						:effective="onOff(state.effective.autoPurge)"
						:configured="onOff(state.baseline.autoPurge)"
						:override="state.stored?.autoPurge == null ? null : onOff(state.stored.autoPurge)"
					/>
					<setting-card
						title="Allow apps to skip the cache"
						env="CACHE_SKIP_ALLOWED"
						:effective="onOff(state.effective.skipAllowed)"
						:configured="onOff(state.baseline.skipAllowed)"
						:override="state.stored?.skipAllowed == null ? null : onOff(state.stored.skipAllowed)"
					/>
					<setting-card
						title="Collections whose changes don't clear the cache"
						env="CACHE_AUTO_PURGE_IGNORE_LIST"
						:effective="state.effective.ignoreList"
						:configured="state.baseline.ignoreList"
						:override="state.stored?.ignoreList ?? null"
					>
						<v-button small secondary to="/cache-manager/analysis">Choose in Analysis</v-button>
					</setting-card>
					<setting-card title="How long answers stay in the cache" env="CACHE_TTL" :effective="String(state.env.CACHE_TTL ?? '–')" readonly />
					<setting-card title="Where the cache is kept" env="CACHE_STORE" :effective="String(state.env.CACHE_STORE ?? '–')" readonly />
				</div>
				<p class="meta">
					<template v-if="state.configPath">Config file: <code>{{ state.configPath }}</code>. </template>
					<template v-if="state.stored?.updatedAt">Saved here on {{ new Date(state.stored.updatedAt).toLocaleString() }}.</template>
					<template v-else>Nothing saved here. The configured values are in use.</template>
				</p>

				<v-divider class="section-divider add-margin-top" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="cached" /></template>
					When the cache is cleared
				</v-divider>

				<div class="toggles">
					<v-checkbox v-model="draft.autoPurge" block>
						<span class="check-label">Clear the cache when content changes <span class="env-name">CACHE_AUTO_PURGE</span></span>
					</v-checkbox>
					<v-checkbox v-model="draft.skipAllowed" block>
						<span class="check-label">Allow apps to skip the cache <span class="env-name">CACHE_SKIP_ALLOWED</span></span>
					</v-checkbox>
				</div>
				<v-notice type="info" class="ttl-notice">
					<div>
						Selected collections can be served from the cache for up to <strong>{{ state.env.CACHE_TTL ?? '–' }}</strong>
						after a change. Apps can ask for fresh data with the header <code>Cache-Control: no-store</code> when "Allow
						apps to skip the cache" is on.
						<span class="env-name block">CACHE_TTL, from the configuration Directus is running with</span>
					</div>
				</v-notice>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import PendingChanges from './pending-changes.vue';
import SettingCard from './setting-card.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, draft, busy, dirty, saving, loadingState, error, message, loadState, save, reset } = useCacheManager();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued)' };

function onOff(value: boolean) {
	return value ? 'On' : 'Off';
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
.env-name {
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}
.ttl-notice {
	margin-top: 16px;
	max-inline-size: 42rem;
}
.cards {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}
@media (max-width: 900px) {
	.cards {
		grid-template-columns: 1fr;
	}
}
.env-name.block {
	display: block;
	margin-top: 4px;
}
.check-label .env-name {
	margin-left: 8px;
}
code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}
</style>
