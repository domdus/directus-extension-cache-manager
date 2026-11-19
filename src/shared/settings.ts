import { MAX_LIST_LENGTH } from './constants';
import { durationText, isValidTtl, sameDuration, TTL_ERROR } from './duration';

/** The env values this extension manages. */
export type CacheValues = {
	autoPurge: boolean;
	skipAllowed: boolean;
	ignoreList: string[];
	/** CACHE_TTL as Directus reads it: a duration like "5m" or plain milliseconds as text. */
	ttl: string;
};

/** What is stored in directus_settings.cache_manager. `null` = use the config value. */
export type StoredOverride = {
	autoPurge: boolean | null;
	skipAllowed: boolean | null;
	ignoreList: string[] | null;
	ttl: string | null;
	updatedAt: string | null;
	updatedBy: string | null;
};

export type OverrideInput = Pick<StoredOverride, 'autoPurge' | 'skipAllowed' | 'ignoreList' | 'ttl'>;

export const ENV_KEYS = {
	autoPurge: 'CACHE_AUTO_PURGE',
	skipAllowed: 'CACHE_SKIP_ALLOWED',
	ignoreList: 'CACHE_AUTO_PURGE_IGNORE_LIST',
	ttl: 'CACHE_TTL',
} as const;

/** Directus' default when CACHE_TTL is not configured. */
export const DEFAULT_TTL = '5m';

function toTtl(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'string' && value.trim()) return value.trim();
	return null;
}

type Env = Record<string, unknown>;

function toBool(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
	if (typeof value === 'number') return value !== 0;
	return false;
}

function toList(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
	return unique(raw.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean));
}

function unique(list: string[]): string[] {
	return [...new Set(list)];
}

/** Reads the current values from env (booleans and an array of strings in Directus 11). */
export function readValues(env: Env): CacheValues {
	return {
		autoPurge: toBool(env[ENV_KEYS.autoPurge]),
		skipAllowed: toBool(env[ENV_KEYS.skipAllowed]),
		ignoreList: toList(env[ENV_KEYS.ignoreList]),
		ttl: toTtl(env[ENV_KEYS.ttl]) ?? DEFAULT_TTL,
	};
}

/** Fills settings missing in a baseline kept from an older extension version (see captureBaseline). */
export function completeBaseline(kept: Partial<CacheValues>, fromEnv: CacheValues): CacheValues {
	return {
		autoPurge: typeof kept.autoPurge === 'boolean' ? kept.autoPurge : fromEnv.autoPurge,
		skipAllowed: typeof kept.skipAllowed === 'boolean' ? kept.skipAllowed : fromEnv.skipAllowed,
		ignoreList: Array.isArray(kept.ignoreList) ? [...kept.ignoreList] : [...fromEnv.ignoreList],
		ttl: typeof kept.ttl === 'string' && kept.ttl.trim() ? kept.ttl : fromEnv.ttl,
	};
}

/** Writes values into env. Directus reads these keys live on every write / request. */
export function applyToEnv(env: Env, values: CacheValues) {
	env[ENV_KEYS.autoPurge] = values.autoPurge;
	env[ENV_KEYS.skipAllowed] = values.skipAllowed;
	env[ENV_KEYS.ignoreList] = [...values.ignoreList];
	// Directus reads CACHE_TTL with getMilliseconds(), which accepts "1h" as well as "300000".
	env[ENV_KEYS.ttl] = values.ttl;
}

/** Parses the stored field (object from Postgres, string from MySQL/SQLite). Invalid content → null. */
export function parseStored(raw: unknown): StoredOverride | null {
	let value = raw;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const obj = value as Record<string, unknown>;
	const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
	const stored: StoredOverride = {
		autoPurge: bool(obj.autoPurge),
		skipAllowed: bool(obj.skipAllowed),
		ignoreList: Array.isArray(obj.ignoreList) ? toList(obj.ignoreList) : null,
		ttl: isValidTtl(toTtl(obj.ttl)) ? toTtl(obj.ttl) : null,
		updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : null,
		updatedBy: typeof obj.updatedBy === 'string' ? obj.updatedBy : null,
	};
	return isEmptyOverride(stored) ? null : stored;
}

export function isEmptyOverride(stored: OverrideInput | null): boolean {
	return !stored || (stored.autoPurge === null && stored.skipAllowed === null && stored.ignoreList === null && (stored.ttl ?? null) === null);
}

/** Effective values: the override wins per setting, null falls back to the config baseline. */
export function mergeValues(baseline: CacheValues, stored: OverrideInput | null): CacheValues {
	return {
		autoPurge: stored?.autoPurge ?? baseline.autoPurge,
		skipAllowed: stored?.skipAllowed ?? baseline.skipAllowed,
		ignoreList: stored?.ignoreList ? [...stored.ignoreList] : [...baseline.ignoreList],
		ttl: stored?.ttl ?? baseline.ttl,
	};
}

export function sameList(a: string[], b: string[]): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((entry) => right.has(entry));
}

export function sameValues(a: CacheValues, b: CacheValues): boolean {
	return a.autoPurge === b.autoPurge && a.skipAllowed === b.skipAllowed && sameList(a.ignoreList, b.ignoreList) && sameDuration(a.ttl, b.ttl);
}

/**
 * Builds the override to store from the values the admin wants. Settings equal to the config value are stored
 * as null, so a later change in the configuration comes through for them.
 */
export function toOverride(baseline: CacheValues, desired: CacheValues): OverrideInput {
	return {
		autoPurge: desired.autoPurge === baseline.autoPurge ? null : desired.autoPurge,
		skipAllowed: desired.skipAllowed === baseline.skipAllowed ? null : desired.skipAllowed,
		ignoreList: sameList(desired.ignoreList, baseline.ignoreList) ? null : unique(desired.ignoreList),
		ttl: sameDuration(desired.ttl, baseline.ttl) ? null : durationText(desired.ttl),
	};
}

export type ValidationResult = { ok: true; value: OverrideInput } | { ok: false; errors: string[] };

/**
 * Validates the POST /apply body: `{ autoPurge, skipAllowed, ignoreList, ttl }`, each optional or null (= config value).
 * List entries must be existing collections.
 */
export function validateInput(body: unknown, collections: Set<string>): ValidationResult {
	const errors: string[] = [];
	if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['Send a JSON object'] };
	const input = body as Record<string, unknown>;

	const known = ['autoPurge', 'skipAllowed', 'ignoreList', 'ttl'];
	for (const key of Object.keys(input)) if (!known.includes(key)) errors.push(`Unknown setting "${key}"`);

	const bool = (key: 'autoPurge' | 'skipAllowed'): boolean | null => {
		const value = input[key];
		if (value === undefined || value === null) return null;
		if (typeof value !== 'boolean') {
			errors.push(`${key} must be true, false or null`);
			return null;
		}
		return value;
	};
	const autoPurge = bool('autoPurge');
	const skipAllowed = bool('skipAllowed');

	let ignoreList: string[] | null = null;
	const list = input.ignoreList;
	if (list !== undefined && list !== null) {
		if (!Array.isArray(list)) errors.push('ignoreList must be an array of collection names or null');
		else if (list.length > MAX_LIST_LENGTH) errors.push(`ignoreList has more than ${MAX_LIST_LENGTH} entries`);
		else {
			const names: string[] = [];
			for (const entry of list) {
				if (typeof entry !== 'string' || !entry.trim()) {
					errors.push('ignoreList entries must be non-empty strings');
					continue;
				}
				names.push(entry.trim());
			}
			const unknown = unique(names.filter((name) => !collections.has(name)));
			if (unknown.length) errors.push(`Unknown collection${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
			ignoreList = unique(names);
		}
	}

	let ttl: string | null = null;
	if (input.ttl !== undefined && input.ttl !== null) {
		const value = toTtl(input.ttl);
		if (value === null || !isValidTtl(value)) errors.push(TTL_ERROR);
		else ttl = value;
	}

	return errors.length ? { ok: false, errors } : { ok: true, value: { autoPurge, skipAllowed, ignoreList, ttl } };
}
