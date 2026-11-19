import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, buildAnalysis, isRecommendable, parseHours, purgeMinutes, recommendation, toBuckets, type ActivityBucket } from './analysis';
import { applyToEnv, mergeValues, parseStored, readValues, toOverride, validateInput, type CacheValues } from './settings';

const WINDOW = 1440;

/** Writes in the given minute indexes. */
const writes = (collection: string, minutes: number[], editorWrites = 0): ActivityBucket[] =>
	minutes.map((minute, index) => ({ collection, minute, writes: 2, editorWrites: index < editorWrites ? 2 : 0 }));

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);

const options = (extra: Partial<Parameters<typeof buildAnalysis>[1]> = {}) => ({
	hours: 24,
	windowMinutes: WINDOW,
	from: new Date('2026-11-18T12:00:00Z'),
	to: new Date('2026-11-19T12:00:00Z'),
	ignoreList: [] as string[],
	autoPurge: true,
	editorHeuristic: true,
	...extra,
});

test('aggregate counts writes and distinct minutes, drops rows outside the window', () => {
	const rows = [
		{ collection: 'a', minute: 0, writes: 3, editorWrites: 1 },
		{ collection: 'a', minute: 0, writes: 1, editorWrites: 0 },
		{ collection: 'a', minute: 5, writes: 1, editorWrites: 0 },
		{ collection: 'a', minute: WINDOW, writes: 9, editorWrites: 0 },
		{ collection: 'a', minute: -1, writes: 9, editorWrites: 0 },
		{ collection: 'b', minute: 5, writes: 2, editorWrites: 2 },
	];
	const result = aggregate(rows, WINDOW);
	assert.equal(result.get('a')!.writes, 5);
	assert.equal(result.get('a')!.editorWrites, 1);
	assert.equal(result.get('a')!.minutes.size, 2);
	assert.equal(result.get('b')!.minutes.size, 1);
});

test('toBuckets converts epoch minutes and string counts from pg', () => {
	const buckets = toBuckets([{ collection: 'x', minute: '29000010', writes: '4', editor_writes: '1' }], 29000000);
	assert.deepEqual(buckets, [{ collection: 'x', minute: 10, writes: 4, editorWrites: 1 }]);
});

test('purge minutes: union of non-ignored collections, zero with auto purge off', () => {
	const sets = { a: [1, 2, 3], b: [3, 4], c: [10] };
	assert.equal(purgeMinutes(sets, []), 5);
	assert.equal(purgeMinutes(sets, ['a']), 3);
	assert.equal(purgeMinutes(sets, ['a', 'b', 'c']), 0);
	assert.equal(purgeMinutes(sets, [], false), 0);
	assert.equal(purgeMinutes(new Map([['a', new Set([1, 2])]]), ['x']), 2);
});

test('analysis mirrors the LIVE shape: a view counter dominates, ignoring it cuts purges', () => {
	const rows = [
		...writes('com_videos', range(0, 1031)),
		...writes('subscriptions', range(1000, 1203)),
		...writes('checkout_sessions', range(1100, 1270)),
		...writes('pages', range(0, 20), 20),
		...writes('directus_users', range(0, 300)),
	];
	const analysis = buildAnalysis(rows, options({ candidate: ['com_videos'] }));

	assert.equal(analysis.purgeMinutes, 1270);
	assert.deepEqual(analysis.collections.map((entry) => entry.collection).slice(0, 2), ['com_videos', 'directus_users']);

	const byName = Object.fromEntries(analysis.collections.map((entry) => [entry.collection, entry]));
	assert.equal(byName.com_videos.recommended, true);
	assert.equal(byName.com_videos.minutes, 1031);
	assert.equal(byName.com_videos.writes, 2062);
	// Minutes only com_videos writes in: 300..999 (directus_users covers 0..299, subscriptions starts at 1000).
	assert.equal(byName.com_videos.savedMinutes, 700);
	assert.equal(byName.directus_users.recommended, false);
	assert.equal(byName.directus_users.reason, 'System collection');
	assert.equal(byName.pages.recommended, false); // 20 / 1440 < 5 %
	assert.deepEqual(analysis.recommendedList, ['com_videos', 'subscriptions', 'checkout_sessions']);

	// What-if without com_videos: directus_users 0..299 + subscriptions/checkout 1000..1269.
	assert.deepEqual(analysis.whatIf, { list: ['com_videos'], purgeMinutes: 300 + 270 });
	assert.equal(analysis.recommendedPurgeMinutes, 300);
	assert.deepEqual(analysis.minuteSets.pages, range(0, 20));
});

test('ignored collections are not recommended and save nothing more', () => {
	const analysis = buildAnalysis([...writes('com_videos', range(0, 500)), ...writes('logs', range(400, 600))], options({ ignoreList: ['com_videos'] }));
	const videos = analysis.collections.find((entry) => entry.collection === 'com_videos')!;
	assert.equal(videos.ignored, true);
	assert.equal(videos.recommended, false);
	assert.equal(videos.reason, 'Already ignored');
	assert.equal(videos.savedMinutes, 0);
	assert.equal(analysis.purgeMinutes, 200);
	assert.equal(analysis.whatIf, null);
});

test('recommendation rules: threshold, system collections, editor collections', () => {
	const base = { writes: 100, minutes: 100, editorWrites: 0, ignored: false };
	assert.equal(recommendation({ ...base, collection: 'counter' }, WINDOW).recommended, true);
	assert.equal(recommendation({ ...base, collection: 'counter', minutes: 71 }, WINDOW).recommended, false); // 4.9 %
	assert.equal(recommendation({ ...base, collection: 'counter', minutes: 72 }, WINDOW).recommended, true); // 5 %
	assert.equal(recommendation({ ...base, collection: 'articles', editorWrites: 60 }, WINDOW).reason, 'Mostly edited in the admin app');
	assert.equal(recommendation({ ...base, collection: 'articles', editorWrites: 50 }, WINDOW).recommended, true);
	assert.equal(recommendation({ ...base, collection: 'directus_settings' }, WINDOW).recommended, false);
	assert.equal(recommendation({ ...base, collection: 'directus_presets' }, WINDOW).recommended, true);
	assert.equal(isRecommendable('directus_notifications'), true);
	assert.equal(isRecommendable('directus_files'), false);
	assert.equal(isRecommendable('my_directus_copy'), true);
});

test('parseHours clamps and falls back', () => {
	assert.equal(parseHours(undefined, 24, 168), 24);
	assert.equal(parseHours('abc', 24, 168), 24);
	assert.equal(parseHours('0', 24, 168), 24);
	assert.equal(parseHours('6', 24, 168), 6);
	assert.equal(parseHours('1000', 24, 168), 168);
	assert.equal(parseHours('2.7', 24, 168), 2);
});

const collections = new Set(['com_videos', 'subscriptions', 'directus_activity']);

test('validateInput accepts booleans, null and existing collections', () => {
	assert.deepEqual(validateInput({ autoPurge: true, skipAllowed: null, ignoreList: [' com_videos ', 'com_videos', 'subscriptions'] }, collections), {
		ok: true,
		value: { autoPurge: true, skipAllowed: null, ignoreList: ['com_videos', 'subscriptions'] },
	});
	assert.deepEqual(validateInput({}, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null } });
	assert.deepEqual(validateInput({ ignoreList: [] }, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: [] } });
});

test('validateInput rejects bad types, unknown collections and unknown keys', () => {
	const fail = (body: unknown) => {
		const result = validateInput(body, collections);
		assert.equal(result.ok, false);
		return result.ok ? [] : result.errors;
	};
	assert.match(fail({ autoPurge: 'true' }).join(), /autoPurge must be/);
	assert.match(fail({ skipAllowed: 1 }).join(), /skipAllowed must be/);
	assert.match(fail({ ignoreList: 'com_videos' }).join(), /must be an array/);
	assert.match(fail({ ignoreList: ['nope', 'com_videos', 'gone'] }).join(), /Unknown collections: nope, gone/);
	assert.match(fail({ ignoreList: [42] }).join(), /non-empty strings/);
	assert.match(fail({ ttl: 5 }).join(), /Unknown setting "ttl"/);
	assert.match(fail(null).join(), /JSON object/);
	assert.match(fail([1]).join(), /JSON object/);
});

const baseline: CacheValues = { autoPurge: true, skipAllowed: false, ignoreList: ['directus_activity'] };

test('mergeValues: override wins per setting, null keeps the config value', () => {
	assert.deepEqual(mergeValues(baseline, null), baseline);
	assert.deepEqual(mergeValues(baseline, { autoPurge: null, skipAllowed: true, ignoreList: null }), { ...baseline, skipAllowed: true });
	assert.deepEqual(mergeValues(baseline, { autoPurge: false, skipAllowed: null, ignoreList: [] }), { autoPurge: false, skipAllowed: false, ignoreList: [] });
	// The result never shares the baseline array.
	const merged = mergeValues(baseline, null);
	merged.ignoreList.push('x');
	assert.deepEqual(baseline.ignoreList, ['directus_activity']);
});

test('toOverride stores only what differs from config', () => {
	assert.deepEqual(toOverride(baseline, { ...baseline, ignoreList: ['directus_activity'] }), { autoPurge: null, skipAllowed: null, ignoreList: null });
	assert.deepEqual(toOverride(baseline, { autoPurge: true, skipAllowed: true, ignoreList: ['com_videos', 'directus_activity'] }), {
		autoPurge: null,
		skipAllowed: true,
		ignoreList: ['com_videos', 'directus_activity'],
	});
});

test('parseStored reads objects and JSON strings, rejects garbage and empty overrides', () => {
	const stored = { autoPurge: false, skipAllowed: null, ignoreList: ['a', 'a', 'b'], updatedAt: '2026-11-19T10:00:00Z', updatedBy: 'u1' };
	assert.deepEqual(parseStored(stored), { ...stored, ignoreList: ['a', 'b'] });
	assert.deepEqual(parseStored(JSON.stringify(stored)), { ...stored, ignoreList: ['a', 'b'] });
	assert.equal(parseStored(null), null);
	assert.equal(parseStored('{broken'), null);
	assert.equal(parseStored([1, 2]), null);
	assert.equal(parseStored({ autoPurge: 'yes', ignoreList: 'a' }), null);
});

test('readValues / applyToEnv round trip on an env object', () => {
	const env: Record<string, unknown> = { CACHE_AUTO_PURGE: true, CACHE_SKIP_ALLOWED: 'false', CACHE_AUTO_PURGE_IGNORE_LIST: 'a, b,,a' };
	assert.deepEqual(readValues(env), { autoPurge: true, skipAllowed: false, ignoreList: ['a', 'b'] });
	applyToEnv(env, { autoPurge: false, skipAllowed: true, ignoreList: ['c'] });
	assert.equal(env.CACHE_AUTO_PURGE, false);
	assert.equal(env.CACHE_SKIP_ALLOWED, true);
	assert.deepEqual(env.CACHE_AUTO_PURGE_IGNORE_LIST, ['c']);
	assert.deepEqual(readValues({}), { autoPurge: false, skipAllowed: false, ignoreList: [] });
});
