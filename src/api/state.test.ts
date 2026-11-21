import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBaseline, migrateIgnoreList } from './state';

/** Fake context: one settings row with the JSON field, SettingsService writes into it. */
function fakeContext(stored: Record<string, unknown> | null, configured: string[]) {
	const row: Record<string, unknown> = { cache_manager: stored };
	const logs: string[] = [];
	const database: any = Object.assign(() => undefined, {
		schema: { hasColumn: async () => true },
		select: () => ({ from: () => ({ first: async () => row }) }),
	});
	const env = { CACHE_AUTO_PURGE_IGNORE_LIST: configured, CACHE_AUTO_PURGE: true };
	captureBaseline(env);
	const ctx: any = {
		env,
		database,
		services: {
			SettingsService: class {
				async upsertSingleton(value: Record<string, unknown>) {
					Object.assign(row, value);
				}
			},
		},
		getSchema: async () => ({ collections: { views: {}, logs: {}, pages: {}, directus_activity: {} } }),
		logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(`warn: ${m}`), error: () => undefined },
	};
	return { ctx, row, logs };
}

test('migration: entries the Ignore List added become rules that never clear; the saved list is removed', async () => {
	const { ctx, row, logs } = fakeContext(
		{
			autoPurge: true,
			ignoreList: ['directus_activity', 'views', 'logs', 'gone'],
			rules: { targeted: true, collections: { views: { create: true, update: true, delete: true, skipFields: [], ttl: '1h' } } },
		},
		['directus_activity'],
	);
	assert.deepEqual(await migrateIgnoreList(ctx), ['views', 'logs']);
	const saved = row.cache_manager as any;
	assert.equal('ignoreList' in saved, false);
	assert.equal(saved.autoPurge, true);
	assert.equal(saved.rules.targeted, true);
	assert.deepEqual(saved.rules.collections.views, { create: false, update: false, delete: false, skipFields: [], ttl: '1h' });
	assert.deepEqual(saved.rules.collections.logs, { create: false, update: false, delete: false, skipFields: [], ttl: null });
	assert.match(logs.join(), /moved to rules that never clear: views, logs/);

	// Runs once: nothing left to convert.
	assert.equal(await migrateIgnoreList(ctx), null);
});
