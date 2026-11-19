<template>
	<private-view title="Settings" icon="settings">
		<template #headline>
			<v-breadcrumb :items="[{ name: 'Cache Manager', to: '/cache-manager' }]" />
		</template>

		<template #navigation>
			<module-navigation />
		</template>

		<template #sidebar>
			<sidebar-detail id="about" icon="info" title="About">
				<p class="sidebar-text">
					Check for a new version, back up or restore what you saved in Cache Manager, or remove its settings field
					before uninstalling.
				</p>
			</sidebar-detail>
		</template>

		<div :class="pageClass">
			<v-divider
				class="section-divider"
				large
				:inline-title="false"
				:style="{ '--v-divider-color': 'var(--theme--border-color-subdued)' }"
			>
				<template #icon><v-icon name="system_update" /></template>
				Extension Updates
			</v-divider>
			<p class="explain">
				Check npm for the latest published version and compare it with the installed extension version.
			</p>
			<div class="actions">
				<v-button secondary :loading="checkingUpdates" @click="checkUpdates">Check now</v-button>
				<v-button v-if="updateInfo?.has_update && marketplaceUrl" secondary :to="marketplaceUrl">Marketplace</v-button>
				<v-button v-if="updateInfo" secondary :href="EXTENSION_GITHUB_URL">GitHub</v-button>
			</div>
			<div v-if="updateInfo" class="result">
				<v-notice :type="updateNoticeType">
					Current: <strong>{{ updateInfo.current_version }}</strong>
					<template v-if="updateInfo.latest_version">
						· Latest: <strong>{{ updateInfo.latest_version }}</strong>
					</template>
					<template v-if="updateInfo.not_published"> · Not published on npm yet</template>
					<template v-else-if="updateInfo.error"> · {{ updateInfo.error }}</template>
					<template v-else-if="updateInfo.has_update"> · Update available</template>
					<template v-else> · Up to date</template>
				</v-notice>
			</div>

			<v-divider
				class="section-divider add-margin-top"
				large
				:inline-title="false"
				:style="{ '--v-divider-color': 'var(--theme--border-color-subdued)' }"
			>
				<template #icon><v-icon name="import_export" /></template>
				Export / Import
			</v-divider>
			<p class="explain">
				Back up what you saved in Cache Manager as a JSON file, or restore it, for example in another project. An import
				is checked like Save &amp; apply and is used right away. Unsaved changes on the other pages are replaced.
			</p>

			<div class="actions">
				<v-button secondary :disabled="!state || busy" @click="exportSettings">Export JSON</v-button>
				<v-button secondary :disabled="!state || busy" :loading="importing" @click="triggerImport">Import JSON</v-button>
				<input ref="fileInput" type="file" accept="application/json,.json" class="file-input" @change="onImportFile" />
			</div>

			<div v-if="importMessage" class="result">
				<v-notice :type="importMessage.type">{{ importMessage.text }}</v-notice>
			</div>

			<v-divider
				class="section-divider add-margin-top"
				large
				:inline-title="false"
				:style="{ '--v-divider-color': 'var(--theme--border-color-subdued)' }"
			>
				<template #icon><v-icon name="delete" /></template>
				Remove extension data
			</v-divider>

			<p class="explain">
				What you save in Cache Manager lives in <code>directus_settings.{{ SETTINGS_FIELD }}</code>. Cleanup uses the
				configured values again right away and removes only that field. If the extension stays installed, the next
				Directus restart recreates an empty field.
			</p>

			<v-notice type="warning" class="notice">
				Deleting extension data cannot be undone. Export first if you might need the settings again.
			</v-notice>

			<div v-if="result" class="result">
				<v-notice :type="result.type">{{ result.text }}</v-notice>
			</div>

			<v-button kind="danger" :loading="cleaning" :disabled="!state || busy" @click="runCleanup">Remove extension data</v-button>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { computed, onMounted, ref } from 'vue';
import ModuleNavigation from './navigation.vue';
import { useCacheManager } from './composables/use-cache-manager';
import { usePageClass } from './composables/use-page-class';
import { SETTINGS_FIELD } from '../shared/constants';
import { EXTENSION_GITHUB_URL, EXTENSION_MARKETPLACE_UID, EXTENSION_NPM_URL, EXTENSION_PACKAGE_NAME } from '../shared/extension-meta';
import { buildExport, parseImport } from '../shared/transfer';

const api = useApi();
const pageClass = usePageClass();
const { state, busy, loadState, importSettings, cleanup } = useCacheManager();

const marketplaceUrl = computed(() =>
	EXTENSION_MARKETPLACE_UID ? `/admin/settings/marketplace/extension/${EXTENSION_MARKETPLACE_UID}` : null,
);
const fileInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const cleaning = ref(false);
const importMessage = ref<{ type: 'success' | 'danger'; text: string } | null>(null);
const result = ref<{ type: 'success' | 'danger'; text: string } | null>(null);
const checkingUpdates = ref(false);
const updateInfo = ref<{
	current_version: string;
	latest_version: string | null;
	has_update: boolean;
	not_published: boolean;
	checked_at: string;
	error?: string;
	links: { npm: string; github: string; marketplace: string | null };
} | null>(null);
const updateNoticeType = computed(() => {
	if (!updateInfo.value) return 'info';
	if (updateInfo.value.not_published) return 'info';
	if (updateInfo.value.error) return 'warning';
	return updateInfo.value.has_update ? 'warning' : 'success';
});

onMounted(() => {
	void loadState();
});

function normalizeVersion(raw: string): string {
	return String(raw || '').trim().replace(/^v/, '');
}

function versionFromExtensionEntry(entry: any): string | null {
	const version = entry?.version || entry?.schema?.version || entry?.meta?.version;
	return version ? String(version) : null;
}

function findInstalledVersion(entries: any[]): string {
	const stack = [...entries];
	while (stack.length) {
		const entry = stack.pop();
		if (!entry || typeof entry !== 'object') continue;
		const name = entry.name || entry.schema?.name || entry.id;
		if (name === EXTENSION_PACKAGE_NAME) {
			return versionFromExtensionEntry(entry) || 'unknown';
		}
		if (Array.isArray(entry.entries)) stack.push(...entry.entries);
		if (Array.isArray(entry.children)) stack.push(...entry.children);
	}
	return 'unknown';
}

async function readInstalledVersion(): Promise<string> {
	try {
		const res = await api.get('/extensions');
		const list = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
		return findInstalledVersion(list);
	} catch {
		return 'unknown';
	}
}

function compareSemver(a: string, b: string): number {
	const toNums = (v: string) => normalizeVersion(v).split('.').map((x) => parseInt(x, 10) || 0);
	const av = toNums(a);
	const bv = toNums(b);
	const len = Math.max(av.length, bv.length, 3);
	for (let i = 0; i < len; i++) {
		const l = av[i] ?? 0;
		const r = bv[i] ?? 0;
		if (l > r) return 1;
		if (l < r) return -1;
	}
	return 0;
}

async function checkUpdates() {
	checkingUpdates.value = true;
	const marketplace = marketplaceUrl.value;
	const links = { npm: EXTENSION_NPM_URL, github: EXTENSION_GITHUB_URL, marketplace };
	const current = normalizeVersion(await readInstalledVersion());
	try {
		const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(EXTENSION_PACKAGE_NAME)}`, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		});
		if (res.status === 404) {
			updateInfo.value = {
				current_version: current,
				latest_version: null,
				has_update: false,
				not_published: true,
				checked_at: new Date().toISOString(),
				links,
			};
			return;
		}
		if (!res.ok) throw new Error(`npm registry request failed (${res.status})`);
		const json = (await res.json()) as { 'dist-tags'?: Record<string, string> };
		const latest = normalizeVersion(json?.['dist-tags']?.latest || '');
		if (!latest) throw new Error('No latest version found');
		updateInfo.value = {
			current_version: current,
			latest_version: latest,
			has_update: compareSemver(latest, current) > 0,
			not_published: false,
			checked_at: new Date().toISOString(),
			links,
		};
	} catch (error: any) {
		updateInfo.value = {
			current_version: current,
			latest_version: null,
			has_update: false,
			not_published: false,
			checked_at: new Date().toISOString(),
			error: error?.message || 'Update check failed',
			links,
		};
	} finally {
		checkingUpdates.value = false;
	}
}

function exportSettings() {
	const file = buildExport(state.value?.stored ?? null);
	const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = 'cache-manager-settings.json';
	anchor.click();
	URL.revokeObjectURL(url);
}

function triggerImport() {
	importMessage.value = null;
	fileInput.value?.click();
}

async function onImportFile(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = '';
	if (!file) return;

	importing.value = true;
	try {
		const body = parseImport(await file.text());
		await importSettings(body);
		importMessage.value = {
			type: 'success',
			text: Object.keys(body).length
				? 'Imported. The settings from the file are in use now.'
				: 'Imported. The file contains no saved values, so the configured values are in use now.',
		};
	} catch (error: any) {
		importMessage.value = { type: 'danger', text: `Import failed: ${error?.message || 'unknown error'}` };
	} finally {
		importing.value = false;
	}
}

async function runCleanup() {
	result.value = null;
	if (!window.confirm('Remove the Cache Manager settings field and use the configured values again?')) return;
	cleaning.value = true;
	try {
		const outcome = await cleanup();
		result.value = {
			type: 'success',
			text: `Done. The configured values are in use again. ${outcome.deletedField ? 'The settings field was deleted.' : 'There was no settings field to delete.'}`,
		};
	} catch (error: any) {
		result.value = { type: 'danger', text: error?.message || 'Cleanup failed' };
	} finally {
		cleaning.value = false;
	}
}
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

.explain {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground);
}

.explain code {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 0.9em;
}

.section-divider {
	margin-bottom: 12px;
}

.section-divider.add-margin-top {
	margin-top: 40px;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 12px;
}

.file-input {
	display: none;
}

.notice,
.result {
	margin: 12px 0;
}

.sidebar-text {
	margin: 0 0 16px;
	line-height: 1.55;
	color: var(--theme--foreground);
}
</style>
