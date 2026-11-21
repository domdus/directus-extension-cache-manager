import { durationText, formatDurationLabel, isValidTtl, parseDuration, TTL_ERROR } from './duration';

/** Kind of write that asks Directus to clear the cache. `upsert` creates or updates. */
export type WriteAction = 'create' | 'update' | 'delete' | 'upsert';

/** What happens in one collection. Only collections that differ from the default are stored. */
export type CollectionRule = {
	/** Clear when an item is created / changed / deleted. */
	create: boolean;
	update: boolean;
	delete: boolean;
	/** Changes that only touch these fields don't clear (e.g. a view counter). */
	skipFields: string[];
	/** How long answers that use this collection stay in the cache. null = the global CACHE_TTL. */
	ttl: string | null;
};

export type RulesConfig = {
	/** Clear only the answers that use the changed collection instead of the whole cache. */
	targeted: boolean;
	collections: Record<string, CollectionRule>;
};

export const DEFAULT_RULE: CollectionRule = { create: true, update: true, delete: true, skipFields: [], ttl: null };
export const DEFAULT_RULES: RulesConfig = { targeted: false, collections: {} };
export const MAX_RULES = 500;

/**
 * System collections whose writes only clear answers that use them. Writes to every other directus_* collection
 * (permissions, policies, roles, users, settings, schema) can change any answer, so they always clear everything.
 */
export const TARGETABLE_SYSTEM_COLLECTIONS = [
	'directus_activity',
	'directus_revisions',
	'directus_presets',
	'directus_notifications',
	'directus_comments',
	'directus_files',
	'directus_folders',
	'directus_shares',
	'directus_versions',
	'directus_dashboards',
	'directus_panels',
	'directus_translations',
];

export function isTargetable(collection: string): boolean {
	return !collection.startsWith('directus_') || TARGETABLE_SYSTEM_COLLECTIONS.includes(collection);
}

export function isDefaultRule(rule: CollectionRule): boolean {
	return rule.create && rule.update && rule.delete && rule.skipFields.length === 0 && rule.ttl === null;
}

/** A rule with every action off: changes to the collection never clear the cache. */
export function neverClears(rule: CollectionRule | undefined): boolean {
	return !!rule && !rule.create && !rule.update && !rule.delete;
}

/** Collections whose rule never clears. */
export function neverClearCollections(config: RulesConfig): string[] {
	return Object.entries(config.collections)
		.filter(([, rule]) => neverClears(rule))
		.map(([name]) => name)
		.sort();
}

/**
 * Turns these collections into "never clears" rules (entries of the former Ignore List, also from older export
 * files). An existing rule keeps its skip fields and lifetime.
 */
export function withNeverClear(config: RulesConfig, names: string[]): RulesConfig {
	const collections = { ...config.collections };
	for (const name of names) {
		const current = collections[name] ?? DEFAULT_RULE;
		collections[name] = { ...current, skipFields: [...current.skipFields], create: false, update: false, delete: false };
	}
	return { ...config, collections };
}

export function ruleFor(config: RulesConfig, collection: string): CollectionRule {
	return config.collections[collection] ?? DEFAULT_RULE;
}

/**
 * Whether a write clears the cache under this rule. `fields` are the fields the write sends (empty when unknown).
 * An update clears unless every sent field is in skipFields. An upsert clears when either a create or an update would.
 */
export function ruleClears(rule: CollectionRule, action: WriteAction, fields: string[]): boolean {
	const updateClears = () => rule.update && !(fields.length > 0 && fields.every((field) => rule.skipFields.includes(field)));
	switch (action) {
		case 'create':
			return rule.create;
		case 'delete':
			return rule.delete;
		case 'update':
			return updateClears();
		case 'upsert':
			return rule.create || updateClears();
	}
}

/**
 * Lifetime in ms for an answer that uses these collections: the shortest lifetime among them, where a collection
 * without its own lifetime counts with the global one. So a longer own lifetime only applies to answers that use
 * nothing else. `*` (dependencies unknown) → global.
 */
export function ttlFor(config: RulesConfig, collections: Iterable<string>, globalTtlMs: number): number {
	let ttl = Infinity;
	for (const collection of collections) {
		if (collection === '*') return globalTtlMs;
		const own = config.collections[collection]?.ttl;
		const ms = own ? parseDuration(own) : null;
		ttl = Math.min(ttl, ms !== null && ms > 0 ? ms : globalTtlMs);
	}
	return Number.isFinite(ttl) ? ttl : globalTtlMs;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))];
}

/** Lenient read of the stored rules (invalid parts fall back to the defaults). */
export function parseRules(raw: unknown): RulesConfig {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_RULES, collections: {} };
	const obj = raw as Record<string, unknown>;
	const collections: Record<string, CollectionRule> = {};
	const source = obj.collections && typeof obj.collections === 'object' && !Array.isArray(obj.collections) ? (obj.collections as Record<string, unknown>) : {};
	for (const [name, value] of Object.entries(source)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const entry = value as Record<string, unknown>;
		const ttl = typeof entry.ttl === 'string' && entry.ttl.trim() && isValidTtl(entry.ttl.trim()) ? durationText(entry.ttl.trim()) : null;
		const rule: CollectionRule = {
			create: bool(entry.create, true),
			update: bool(entry.update, true),
			delete: bool(entry.delete, true),
			skipFields: strings(entry.skipFields),
			ttl,
		};
		if (!isDefaultRule(rule)) collections[name] = rule;
	}
	return { targeted: obj.targeted === true, collections };
}

export type RulesValidation = { ok: true; value: RulesConfig } | { ok: false; errors: string[] };

/** Strict check of POST /rules. `schemaFields` maps each existing collection to its field names. */
export function validateRules(body: unknown, schemaFields: Record<string, string[]>): RulesValidation {
	const errors: string[] = [];
	if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['Send a JSON object'] };
	const input = body as Record<string, unknown>;
	for (const key of Object.keys(input)) if (!['targeted', 'collections'].includes(key)) errors.push(`Unknown setting "${key}"`);
	if (input.targeted !== undefined && typeof input.targeted !== 'boolean') errors.push('targeted must be true or false');

	const collections: Record<string, CollectionRule> = {};
	const source = input.collections ?? {};
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		errors.push('collections must be an object');
	} else {
		const entries = Object.entries(source as Record<string, unknown>);
		if (entries.length > MAX_RULES) errors.push(`More than ${MAX_RULES} collection rules`);
		for (const [name, value] of entries) {
			const fields = schemaFields[name];
			if (!fields) {
				errors.push(`This collection does not exist in this project: ${name}`);
				continue;
			}
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				errors.push(`${name}: send an object`);
				continue;
			}
			const entry = value as Record<string, unknown>;
			for (const key of Object.keys(entry)) if (!['create', 'update', 'delete', 'skipFields', 'ttl'].includes(key)) errors.push(`${name}: unknown setting "${key}"`);
			for (const key of ['create', 'update', 'delete'] as const) {
				if (entry[key] !== undefined && typeof entry[key] !== 'boolean') errors.push(`${name}: ${key} must be true or false`);
			}
			if (entry.skipFields !== undefined && !Array.isArray(entry.skipFields)) errors.push(`${name}: skipFields must be a list of field names`);
			const skipFields = strings(entry.skipFields);
			const unknown = skipFields.filter((field) => !fields.includes(field));
			if (unknown.length) errors.push(`${name}: unknown fields ${unknown.join(', ')}`);
			let ttl: string | null = null;
			if (entry.ttl !== undefined && entry.ttl !== null && entry.ttl !== '') {
				if (typeof entry.ttl !== 'string' || !isValidTtl(entry.ttl.trim())) errors.push(`${name}: ${TTL_ERROR}`);
				else ttl = durationText(entry.ttl.trim());
			}
			const rule: CollectionRule = {
				create: bool(entry.create, true),
				update: bool(entry.update, true),
				delete: bool(entry.delete, true),
				skipFields,
				ttl,
			};
			if (!isDefaultRule(rule)) collections[name] = rule;
		}
	}
	return errors.length ? { ok: false, errors } : { ok: true, value: { targeted: input.targeted === true, collections } };
}

export function sameRules(a: RulesConfig, b: RulesConfig): boolean {
	return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(config: RulesConfig) {
	return {
		targeted: config.targeted,
		collections: Object.keys(config.collections)
			.sort()
			.filter((name) => !isDefaultRule(config.collections[name]!))
			.map((name) => {
				const rule = config.collections[name]!;
				return [name, rule.create, rule.update, rule.delete, [...rule.skipFields].sort(), rule.ttl];
			}),
	};
}

/** Short text for a rule, e.g. "Clears on create and delete · keeps the cache when only views_count changes · answers stay 5 minutes". */
export function describeRule(rule: CollectionRule): string {
	const on = (['create', 'update', 'delete'] as const).filter((action) => rule[action]);
	const parts: string[] = [];
	if (!on.length) parts.push('Never clears');
	else if (on.length < 3) parts.push(`Clears on ${on.join(' and ')}`);
	if (rule.update && rule.skipFields.length) parts.push(`keeps the cache when only ${rule.skipFields.join(', ')} ${rule.skipFields.length === 1 ? 'changes' : 'change'}`);
	if (rule.ttl) parts.push(`cached for ${formatDurationLabel(rule.ttl)}`);
	return parts.join(' · ') || 'Default';
}

/** One line for the log. */
export function describeRules(config: RulesConfig): string {
	const names = Object.keys(config.collections);
	return `targeted=${config.targeted}${names.length ? `, ${names.map((name) => `${name}: ${describeRule(config.collections[name]!)}`).join('; ')}` : ''}`;
}
