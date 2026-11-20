import { EXTENSION_PACKAGE_NAME } from './extension-meta';
import type { OverrideInput, StoredOverride } from './settings';
import type { RulesConfig } from './rules';

export const EXPORT_FORMAT = 1;

export type ExportFile = {
	extension: string;
	format: number;
	exportedAt: string;
	/** The saved values; null = nothing saved, the configured values are in use. */
	settings: OverrideInput | null;
	updatedAt: string | null;
	/** Rules of the Granular Cache page. Missing in files from older versions. */
	rules?: RulesConfig;
};

/** The file "Export JSON" downloads. Only the saved values, never the configured ones. */
export function buildExport(stored: StoredOverride | null, now = new Date(), rules?: RulesConfig | null): ExportFile {
	const withRules = rules && (rules.targeted || Object.keys(rules.collections).length) ? { rules } : {};
	return {
		...withRules,
		extension: EXTENSION_PACKAGE_NAME,
		format: EXPORT_FORMAT,
		exportedAt: now.toISOString(),
		settings: stored ? { autoPurge: stored.autoPurge, skipAllowed: stored.skipAllowed, ignoreList: stored.ignoreList, ttl: stored.ttl } : null,
		updatedAt: stored?.updatedAt ?? null,
	};
}

export class ImportError extends Error {}

/**
 * Reads an exported file. Returns the body for POST /apply, which checks the values (types, collections, duration).
 * Also accepts the bare settings object `{ autoPurge, skipAllowed, ignoreList, ttl }`.
 */
export function parseImport(text: string): Record<string, unknown> {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new ImportError('This file is not valid JSON.');
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ImportError('This file does not contain Cache Manager settings.');
	const obj = data as Record<string, unknown>;

	if ('extension' in obj || 'settings' in obj) {
		if (obj.extension !== undefined && obj.extension !== EXTENSION_PACKAGE_NAME) {
			throw new ImportError('This file was exported by another extension.');
		}
		if (typeof obj.format === 'number' && obj.format > EXPORT_FORMAT) {
			throw new ImportError('This file was exported by a newer version of Cache Manager. Update the extension first.');
		}
		const settings = obj.settings;
		if (settings === null || (settings === undefined && 'rules' in obj)) return {};
		if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new ImportError('This file does not contain Cache Manager settings.');
		return pick(settings as Record<string, unknown>);
	}
	return pick(obj);
}

/** The clearing rules of an exported file, for POST /rules (which checks them). undefined = the file has none. */
export function parseImportRules(text: string): unknown {
	try {
		const data = JSON.parse(text);
		return data && typeof data === 'object' && !Array.isArray(data) && 'rules' in data ? data.rules : undefined;
	} catch {
		return undefined;
	}
}

const KEYS = ['autoPurge', 'skipAllowed', 'ignoreList', 'ttl'];

function pick(obj: Record<string, unknown>): Record<string, unknown> {
	const keys = Object.keys(obj).filter((key) => !['updatedAt', 'updatedBy'].includes(key));
	if (keys.length && !keys.some((key) => KEYS.includes(key))) throw new ImportError('This file does not contain Cache Manager settings.');
	// Unknown keys are passed on, so /apply names them in its error.
	return Object.fromEntries(keys.map((key) => [key, obj[key]]));
}
