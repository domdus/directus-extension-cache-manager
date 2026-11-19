import { LOG_PREFIX, SETTINGS_FIELD } from '../shared/constants';
import { applyToEnv, mergeValues, parseStored, readValues, type CacheValues, type StoredOverride } from '../shared/settings';

type Env = Record<string, unknown>;
type Knex = any;

export type ApiContext = {
	env: Env;
	database: Knex;
	services: any;
	getSchema: (options?: any) => Promise<any>;
	logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
};

/**
 * Process-wide state on globalThis, so the baseline survives an extension reload
 * (EXTENSIONS_AUTO_RELOAD re-runs the hook after env was already changed by us).
 */
type ProcessState = { baseline: CacheValues | null; startupApplied: boolean };
const KEY = Symbol.for('directus-extension-cache-manager.state');

function processState(): ProcessState {
	const holder = globalThis as unknown as Record<symbol, ProcessState | undefined>;
	return (holder[KEY] ??= { baseline: null, startupApplied: false });
}

/** Captures the config values once per process, before any override is applied. */
export function captureBaseline(env: Env): CacheValues {
	const state = processState();
	if (!state.baseline) state.baseline = readValues(env);
	return state.baseline;
}

export function getBaseline(env: Env): CacheValues {
	return processState().baseline ?? captureBaseline(env);
}

export function markStartupApplied() {
	processState().startupApplied = true;
}

export function startupApplied(): boolean {
	return processState().startupApplied;
}

export async function hasSettingsField(database: Knex): Promise<boolean> {
	return database.schema.hasColumn('directus_settings', SETTINGS_FIELD);
}

/** Creates the hidden JSON field on directus_settings when it is missing. */
export async function ensureSettingsField(ctx: ApiContext): Promise<boolean> {
	if (await hasSettingsField(ctx.database)) return false;
	const { FieldsService } = ctx.services;
	const fields = new FieldsService({ knex: ctx.database, schema: await ctx.getSchema(), accountability: null });
	await fields.createField('directus_settings', {
		field: SETTINGS_FIELD,
		type: 'json',
		schema: { is_nullable: true },
		meta: {
			interface: 'input-code',
			options: { language: 'json' },
			special: ['cast-json'],
			hidden: true,
			readonly: true,
			width: 'full',
			note: 'Managed by the Cache manager module. Do not edit here.',
		},
	});
	ctx.logger.info(`${LOG_PREFIX} created hidden field directus_settings.${SETTINGS_FIELD}`);
	return true;
}

export async function readStored(database: Knex): Promise<StoredOverride | null> {
	if (!(await hasSettingsField(database))) return null;
	const row = await database.select(SETTINGS_FIELD).from('directus_settings').first();
	return parseStored(row?.[SETTINGS_FIELD]);
}

/** Persists the override through SettingsService (activity and revision are logged for the admin). */
export async function writeStored(ctx: ApiContext, accountability: unknown, value: StoredOverride | null) {
	const { SettingsService } = ctx.services;
	const settings = new SettingsService({ knex: ctx.database, schema: await ctx.getSchema(), accountability });
	await settings.upsertSingleton({ [SETTINGS_FIELD]: value });
}

/** Merges baseline and override and writes the result into env. Returns the effective values. */
export function applyEffective(env: Env, stored: StoredOverride | null): CacheValues {
	const effective = mergeValues(getBaseline(env), stored);
	applyToEnv(env, effective);
	return effective;
}

export function describe(values: CacheValues): string {
	return `CACHE_AUTO_PURGE=${values.autoPurge} CACHE_SKIP_ALLOWED=${values.skipAllowed} CACHE_AUTO_PURGE_IGNORE_LIST=[${values.ignoreList.join(', ')}] CACHE_TTL=${values.ttl}`;
}
