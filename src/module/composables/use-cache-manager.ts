import { useApi } from '@directus/extensions-sdk';
import { computed, reactive, ref } from 'vue';
import { purgeMinutes, type Analysis } from '../../shared/analysis';
import { DEFAULT_HOURS, EXTENSION_ID } from '../../shared/constants';
import { sameList, sameValues, toOverride, type CacheValues, type StoredOverride } from '../../shared/settings';

export type CacheState = {
	baseline: CacheValues;
	effective: CacheValues;
	stored: StoredOverride | null;
	inSync: boolean;
	startupApplied: boolean;
	env: { CACHE_ENABLED: boolean; CACHE_TTL: unknown; CACHE_STORE: unknown };
	configPath: string | null;
	collections: string[];
};

const base = `/${EXTENSION_ID}`;

/*
 * Module-level state: Status and Analysis share one draft. A selection made on Analysis is still there on
 * Status (and the other way round), and Save & apply on either page saves all of it.
 */
const state = ref<CacheState | null>(null);
const analysis = ref<Analysis | null>(null);
const draft = reactive<CacheValues>({ autoPurge: true, skipAllowed: false, ignoreList: [] });
const hours = ref(DEFAULT_HOURS);
const loadingState = ref(false);
const loadingAnalysis = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);

function errorText(err: any): string {
	return err?.response?.data?.errors?.[0]?.message ?? err?.message ?? 'Request failed';
}

function resetDraft() {
	if (!state.value) return;
	draft.autoPurge = state.value.effective.autoPurge;
	draft.skipAllowed = state.value.effective.skipAllowed;
	draft.ignoreList = [...state.value.effective.ignoreList];
}

export function useCacheManager() {
	const api = useApi();

	const busy = computed(() => saving.value || loadingState.value || loadingAnalysis.value);
	const dirty = computed(() => !!state.value && !sameValues(draft, state.value.effective));
	const listDirty = computed(() => !!state.value && !sameList(draft.ignoreList, state.value.effective.ignoreList));
	const draftSet = computed(() => new Set(draft.ignoreList));
	const whatIf = computed(() => (analysis.value ? purgeMinutes(analysis.value.minuteSets, draft.ignoreList, draft.autoPurge) : 0));

	async function loadState(force = false) {
		if (state.value && !force) return;
		loadingState.value = true;
		try {
			const { data } = await api.get(`${base}/state`);
			const first = !state.value;
			state.value = data;
			if (first || !dirty.value) resetDraft();
		} catch (err) {
			error.value = errorText(err);
		} finally {
			loadingState.value = false;
		}
	}

	async function loadAnalysis() {
		loadingAnalysis.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`${base}/analysis`, { params: { hours: hours.value } });
			analysis.value = data;
		} catch (err) {
			error.value = errorText(err);
		} finally {
			loadingAnalysis.value = false;
		}
	}

	async function afterWrite(data: CacheState, text: string) {
		state.value = data;
		resetDraft();
		message.value = text;
		if (analysis.value) await loadAnalysis();
	}

	async function save() {
		if (!state.value) return;
		saving.value = true;
		error.value = null;
		message.value = null;
		try {
			const { data } = await api.post(`${base}/apply`, toOverride(state.value.baseline, draft));
			await afterWrite(data, 'Saved and applied. The next writes and requests use the new values.');
		} catch (err) {
			error.value = errorText(err);
		} finally {
			saving.value = false;
		}
	}

	async function reset() {
		if (!state.value) return;
		if (!window.confirm('Remove the saved override and use the configured values again?')) return;
		saving.value = true;
		error.value = null;
		message.value = null;
		try {
			const { data } = await api.post(`${base}/reset`);
			await afterWrite(data, 'Reset. The configured values are in effect again.');
		} catch (err) {
			error.value = errorText(err);
		} finally {
			saving.value = false;
		}
	}

	function toggle(collection: string, on: boolean) {
		draft.ignoreList = on ? [...new Set([...draft.ignoreList, collection])] : draft.ignoreList.filter((name) => name !== collection);
	}

	function add(collections: string[]) {
		draft.ignoreList = [...new Set([...draft.ignoreList, ...collections])];
	}

	return {
		state,
		analysis,
		draft,
		draftSet,
		hours,
		loadingState,
		loadingAnalysis,
		saving,
		busy,
		dirty,
		listDirty,
		whatIf,
		error,
		message,
		loadState,
		loadAnalysis,
		save,
		reset,
		discard: resetDraft,
		toggle,
		add,
	};
}
