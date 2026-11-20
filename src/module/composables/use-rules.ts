import { useApi } from '@directus/extensions-sdk';
import { computed, reactive, ref } from 'vue';
import { EXTENSION_ID } from '../../shared/constants';
import { isValidTtl } from '../../shared/duration';
import { DEFAULT_RULE, sameRules, type CollectionRule, type RulesConfig } from '../../shared/rules';

export type RulesStatus = {
	installed: boolean;
	problems: string[];
	store: string;
	cacheEnabled: boolean;
	autoPurge: boolean;
	targetedActive: boolean;
	indexed: number;
	indexedByCollection: Record<string, number>;
	since: string;
	counts: { full: number; targeted: number; skipped: number; removed: number };
	recent: Array<{ at: string; kind: 'full' | 'targeted' | 'skipped'; collection: string | null; action: string | null; removed: number; reason: string }>;
	/** null: not measurable (Redis) or the cache is off. */
	size: { entries: number; bytes: number; expired: number; expiredBytes: number } | null;
	swept: { entries: number; bytes: number };
	bytesByCollection: Record<string, number>;
	history: Array<{ hour: string; full: number; targeted: number; skipped: number; entries: number | null; bytes: number | null }>;
};

export type RulesState = {
	config: RulesConfig;
	status: RulesStatus;
	globalTtl: string;
	ignoreList: string[];
	collections: Array<{ name: string; fields: string[]; system: boolean; targetable: boolean }>;
};

const base = `/${EXTENSION_ID}`;

const data = ref<RulesState | null>(null);
const draft = reactive<RulesConfig>({ targeted: false, collections: {} });
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const message = ref<string | null>(null);

function errorText(err: any): string {
	return err?.response?.data?.errors?.[0]?.message ?? err?.message ?? 'Request failed';
}

function copy(config: RulesConfig): RulesConfig {
	return {
		targeted: config.targeted,
		collections: Object.fromEntries(Object.entries(config.collections).map(([name, rule]) => [name, { ...rule, skipFields: [...rule.skipFields] }])),
	};
}

function resetDraft() {
	if (!data.value) return;
	const next = copy(data.value.config);
	draft.targeted = next.targeted;
	draft.collections = next.collections;
}

export function useRules() {
	const api = useApi();

	const dirty = computed(() => !!data.value && !sameRules(draft, data.value.config));
	const invalidTtl = computed(() => Object.entries(draft.collections).filter(([, rule]) => rule.ttl && !isValidTtl(rule.ttl)).map(([name]) => name));
	const canSave = computed(() => dirty.value && !invalidTtl.value.length);

	async function load() {
		loading.value = true;
		error.value = null;
		try {
			const response = await api.get(`${base}/rules`);
			const first = !data.value;
			data.value = response.data;
			if (first || !dirty.value) resetDraft();
		} catch (err) {
			error.value = errorText(err);
		} finally {
			loading.value = false;
		}
	}

	async function save() {
		if (!canSave.value) return;
		saving.value = true;
		error.value = null;
		message.value = null;
		try {
			const body = copy(draft);
			for (const rule of Object.values(body.collections)) rule.ttl = rule.ttl?.trim() || null;
			const response = await api.post(`${base}/rules`, body);
			data.value = response.data;
			resetDraft();
			message.value = 'Saved. The rules are in use now.';
		} catch (err) {
			error.value = errorText(err);
		} finally {
			saving.value = false;
		}
	}

	function addRule(collection: string) {
		if (!draft.collections[collection]) draft.collections = { ...draft.collections, [collection]: { ...DEFAULT_RULE, skipFields: [] } };
	}

	function removeRule(collection: string) {
		const { [collection]: _removed, ...rest } = draft.collections;
		draft.collections = rest;
	}

	function updateRule(collection: string, patch: Partial<CollectionRule>) {
		const current = draft.collections[collection];
		if (current) draft.collections[collection] = { ...current, ...patch };
	}

	return { data, draft, loading, saving, error, message, dirty, canSave, invalidTtl, load, save, discard: resetDraft, addRule, removeRule, updateRule };
}
