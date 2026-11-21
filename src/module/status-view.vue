<template>
	<private-view title="Status" icon="cached">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #actions>
			<save-actions />
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
			<sidebar-detail id="auto-purge" icon="delete_sweep" title="Auto Purge">
				<p class="sidebar-text">
					<strong>On:</strong> a change to a collection that is not ignored clears the whole cache. Everyone sees the
					change right away.
				</p>
				<p class="sidebar-text">
					<strong>Off:</strong> changes only show up when the cached copy expires (see Cache Lifetime). Editors may wait that long to see their changes.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on.</p>
			</sidebar-detail>
			<sidebar-detail id="skip-allowed" icon="bolt" title="Skip Cache">
				<p class="sidebar-text">
					<strong>On:</strong> an app can ask for fresh data. It sends the header <code>Cache-Control: no-store</code>.
				</p>
				<p class="sidebar-text">Apps need this to read ignored collections up to date.</p>
				<p class="sidebar-text"><strong>Recommended:</strong> on, if your Directus is not open to the public.</p>
			</sidebar-detail>
			<sidebar-detail id="ttl" icon="schedule" title="Cache Lifetime">
				<p class="sidebar-text">
					Write a duration like 5m (minutes), 1h (hours) or 1d (days). At most 30 days. A number with no unit is
					milliseconds (2 means 2 ms, not 2 hours).
				</p>
				<p class="sidebar-text">
					Shorter means fresher data, but Directus asks the database more often. Longer means less work for the
					database, but data that is not cleared can be older.
				</p>
				<p class="sidebar-text">
					A new value applies to new entries right away. Entries already in the cache keep their old lifetime until they
					expire or the cache is cleared.
				</p>
				<p class="sidebar-text"><strong>Recommended:</strong> between 5 minutes and a few hours.</p>
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

				<v-divider class="section-divider" large :inline-title="false" :style="dividerStyle">
					<template #icon><v-icon name="tune" /></template>
					Current Settings
				</v-divider>
				<p class="explain">
					The cache settings Directus uses right now. What you save here applies at once, without a restart.
				</p>

				<div class="cards">
					<setting-card
						title="Auto Purge"
						description="Clear the cache when content changes."
						hint="Off: changes only show up when cached answers expire. Granular Cache decides how much a change clears."
						env="CACHE_AUTO_PURGE"
						:effective="onOff(state.effective.autoPurge)"
						:configured="onOff(state.baseline.autoPurge)"
						:override="state.stored?.autoPurge == null ? null : onOff(state.stored.autoPurge)"
					>
						<template #control>
							<v-checkbox v-model="draft.autoPurge" aria-label="Enable Auto Purge" />
						</template>
					</setting-card>
					<setting-card
						title="Skip Cache"
						description="Let apps request fresh data with no-store."
						env="CACHE_SKIP_ALLOWED"
						:effective="onOff(state.effective.skipAllowed)"
						:configured="onOff(state.baseline.skipAllowed)"
						:override="state.stored?.skipAllowed == null ? null : onOff(state.stored.skipAllowed)"
					>
						<template #control>
							<v-checkbox v-model="draft.skipAllowed" aria-label="Enable Skip Cache" />
						</template>
					</setting-card>
					<setting-card
						title="Cache Lifetime"
						description="How long answers stay in the cache."
						hint="Applies to new entries right away. Entries already in the cache keep their old lifetime until they expire or the cache is cleared."
						env="CACHE_TTL"
						:effective="formatDurationShort(state.effective.ttl)"
						:configured="formatDurationShort(state.baseline.ttl)"
						:override="state.stored?.ttl == null ? null : formatDurationShort(state.stored.ttl)"
					>
						<template #control>
							<v-input
								class="ttl-input"
								:model-value="draft.ttl"
								placeholder="e.g. 1h"
								:class="{ invalid: !ttlValid }"
								@update:model-value="draft.ttl = $event ?? ''"
							/>
						</template>
						<template v-if="!ttlValid || bareMillisecondsHint(draft.ttl)" #edit>
							<span v-if="!ttlValid" class="field-error">{{ TTL_ERROR }}</span>
							<span v-else class="field-hint">{{ bareMillisecondsHint(draft.ttl) }}</span>
						</template>
					</setting-card>
					<setting-card
						title="Cache Store"
						description="Where the cache is kept."
						env="CACHE_STORE"
						:effective="String(state.env.CACHE_STORE ?? '–')"
						readonly
					/>
					<div class="wide">
						<setting-card
							title="Ignored Collections"
							description="Changes to these collections don't clear the cache."
							env="CACHE_AUTO_PURGE_IGNORE_LIST"
							:effective="state.effective.ignoreList"
							:configured="state.baseline.ignoreList"
							:override="state.stored?.ignoreList ?? null"
						>
							<v-button small secondary to="/cache-manager/ignore-list">Edit Ignore List</v-button>
						</setting-card>
					</div>
				</div>
				<p class="meta">
					<template v-if="state.configPath">Config file: <code>{{ state.configPath }}</code>. </template>
					<template v-if="state.stored?.updatedAt">Saved here on {{ new Date(state.stored.updatedAt).toLocaleString() }}.</template>
					<template v-else>Nothing saved here. The configured values are in use.</template>
				</p>
				<div v-if="state.stored" class="reset-row">
					<v-button secondary :disabled="busy" @click="reset">Reset to Configured Values</v-button>
				</div>
			</template>

		</div>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ModuleNavigation from './navigation.vue';
import SaveActions from './save-actions.vue';
import SettingCard from './setting-card.vue';
import { TTL_ERROR, bareMillisecondsHint, formatDurationShort } from '../shared/duration';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';

const pageClass = usePageClass();
const { state, draft, busy, ttlValid, loadingState, error, message, loadState, reset } = useCacheManager();
const dividerStyle = { '--v-divider-color': 'var(--theme--border-color-subdued, var(--border-subdued))' };

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
.explain {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
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
.meta {
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.reset-row {
	margin-top: 12px;
}
.meta {
	margin-top: 12px;
	line-height: 1.55;
}
.meta a {
	color: var(--theme--primary, var(--primary));
}
.cards {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
}
.wide {
	grid-column: 1 / -1;
	min-width: 0;
}
@media (max-width: 900px) {
	.cards {
		grid-template-columns: 1fr;
	}
}
.ttl-input {
	width: 7.5rem;
}
.field-error {
	font-size: 12px;
	color: var(--theme--danger, var(--danger));
}
.field-hint {
	font-size: 12px;
	line-height: 1.45;
	color: var(--theme--foreground-subdued, var(--foreground-subdued));
}
.invalid {
	--theme--form--field--input--border-color: var(--theme--danger, var(--danger));
}
code {
	font-family: var(--theme--fonts--monospace--font-family, var(--family-monospace, monospace));
	font-size: 0.9em;
}
</style>
