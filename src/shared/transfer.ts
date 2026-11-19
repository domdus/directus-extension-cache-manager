import { EXTENSION_PACKAGE_NAME } from './extension-meta';
import type { OverrideInput, StoredOverride } from './settings';

export const EXPORT_FORMAT = 1;

export type ExportFile = {
	extension: string;
	format: number;
	exportedAt: string;
	/** The saved values; null = nothing saved, the configured values are in use. */
	settings: OverrideInput | null;
	updatedAt: string | null;
};

/** The file "Export JSON" downloads. Only the saved values, never the configured ones. */
export function buildExport(stored: StoredOverride | null, now = new Date()): ExportFile {
	return {
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
		if (settings === null) return {};
		if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new ImportError('This file does not contain Cache Manager settings.');
		return pick(settings as Record<string, unknown>);
	}
	return pick(obj);
}

const KEYS = ['autoPurge', 'skipAllowed', 'ignoreList', 'ttl'];

function pick(obj: Record<string, unknown>): Record<string, unknown> {
	const keys = Object.keys(obj).filter((key) => !['updatedAt', 'updatedBy'].includes(key));
	if (keys.length && !keys.some((key) => KEYS.includes(key))) throw new ImportError('This file does not contain Cache Manager settings.');
	// Unknown keys are passed on, so /apply names them in its error.
	return Object.fromEntries(keys.map((key) => [key, obj[key]]));
}
