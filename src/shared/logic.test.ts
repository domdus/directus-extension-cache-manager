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

test('analysis: a view counter dominates, ignoring it cuts purges', () => {
	const rows = [
		...writes('view_counter', range(0, 1031)),
		...writes('analytics_events', range(1000, 1203)),
		...writes('checkout_attempts', range(1100, 1270)),
		...writes('pages', range(0, 20), 20),
		...writes('directus_users', range(0, 300)),
	];
	const analysis = buildAnalysis(rows, options({ candidate: ['view_counter'] }));

	assert.equal(analysis.purgeMinutes, 1270);
	assert.deepEqual(analysis.collections.map((entry) => entry.collection).slice(0, 2), ['view_counter', 'directus_users']);

	const byName = Object.fromEntries(analysis.collections.map((entry) => [entry.collection, entry]));
	assert.equal(byName.view_counter.recommended, true);
	assert.equal(byName.view_counter.minutes, 1031);
	assert.equal(byName.view_counter.writes, 2062);
	// Minutes only view_counter writes in: 300..999 (directus_users covers 0..299, analytics_events starts at 1000).
	assert.equal(byName.view_counter.savedMinutes, 700);
	assert.equal(byName.directus_users.recommended, false);
	assert.equal(byName.directus_users.reason, 'Directus system collection');
	assert.equal(byName.pages.recommended, false); // 20 / 1440 < 5 %
	assert.deepEqual(analysis.recommendedList, ['view_counter', 'analytics_events', 'checkout_attempts']);

	// What-if without view_counter: directus_users 0..299 + analytics_events/checkout 1000..1269.
	assert.deepEqual(analysis.whatIf, { list: ['view_counter'], purgeMinutes: 300 + 270 });
	assert.equal(analysis.recommendedPurgeMinutes, 300);
	assert.deepEqual(analysis.minuteSets.pages, range(0, 20));
});

test('ignored collections are not recommended and save nothing more', () => {
	const analysis = buildAnalysis([...writes('view_counter', range(0, 500)), ...writes('logs', range(400, 600))], options({ ignoreList: ['view_counter'] }));
	const counter = analysis.collections.find((entry) => entry.collection === 'view_counter')!;
	assert.equal(counter.ignored, true);
	assert.equal(counter.recommended, false);
	assert.equal(counter.reason, 'Already selected');
	assert.equal(counter.savedMinutes, 0);
	assert.equal(analysis.purgeMinutes, 200);
	assert.equal(analysis.whatIf, null);
});

test('recommendation rules: threshold, system collections, editor collections', () => {
	const base = { writes: 100, minutes: 100, editorWrites: 0, ignored: false };
	assert.equal(recommendation({ ...base, collection: 'counter' }, WINDOW).recommended, true);
	assert.equal(recommendation({ ...base, collection: 'counter', minutes: 71 }, WINDOW).recommended, false); // 4.9 %
	assert.equal(recommendation({ ...base, collection: 'counter', minutes: 72 }, WINDOW).recommended, true); // 5 %
	assert.equal(recommendation({ ...base, collection: 'articles', editorWrites: 60 }, WINDOW).reason, 'Mostly changed by editors in the Data Studio');
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

const collections = new Set(['view_counter', 'analytics_events', 'directus_activity']);

test('validateInput accepts booleans, null and existing collections', () => {
	assert.deepEqual(validateInput({ autoPurge: true, skipAllowed: null, ignoreList: [' view_counter ', 'view_counter', 'analytics_events'] }, collections), {
		ok: true,
		value: { autoPurge: true, skipAllowed: null, ignoreList: ['view_counter', 'analytics_events'], ttl: null },
	});
	assert.deepEqual(validateInput({}, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: null } });
	assert.deepEqual(validateInput({ ignoreList: [] }, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: [], ttl: null } });
});

test('validateInput rejects bad types, unknown collections and unknown keys', () => {
	const fail = (body: unknown) => {
		const result = validateInput(body, collections);
		assert.equal(result.ok, false);
		return result.ok ? [] : result.errors;
	};
	assert.match(fail({ autoPurge: 'true' }).join(), /autoPurge must be/);
	assert.match(fail({ skipAllowed: 1 }).join(), /skipAllowed must be/);
	assert.match(fail({ ignoreList: 'view_counter' }).join(), /must be an array/);
	assert.match(fail({ ignoreList: ['nope', 'view_counter', 'gone'] }).join(), /Unknown collections: nope, gone/);
	assert.match(fail({ ignoreList: [42] }).join(), /non-empty strings/);
	assert.match(fail({ cacheStore: 'redis' }).join(), /Unknown setting "cacheStore"/);
	assert.match(fail(null).join(), /JSON object/);
	assert.match(fail([1]).join(), /JSON object/);
});

const baseline: CacheValues = { autoPurge: true, skipAllowed: false, ignoreList: ['directus_activity'], ttl: '5m' };

test('mergeValues: override wins per setting, null keeps the config value', () => {
	assert.deepEqual(mergeValues(baseline, null), baseline);
	assert.deepEqual(mergeValues(baseline, { autoPurge: null, skipAllowed: true, ignoreList: null, ttl: null }), { ...baseline, skipAllowed: true });
	assert.deepEqual(mergeValues(baseline, { autoPurge: false, skipAllowed: null, ignoreList: [], ttl: '1h' }), { autoPurge: false, skipAllowed: false, ignoreList: [], ttl: '1h' });
	// The result never shares the baseline array.
	const merged = mergeValues(baseline, null);
	merged.ignoreList.push('x');
	assert.deepEqual(baseline.ignoreList, ['directus_activity']);
});

test('toOverride stores only what differs from config', () => {
	assert.deepEqual(toOverride(baseline, { ...baseline, ignoreList: ['directus_activity'], ttl: '300000' }), { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: null });
	assert.deepEqual(toOverride(baseline, { autoPurge: true, skipAllowed: true, ignoreList: ['view_counter', 'directus_activity'], ttl: ' 1h ' }), {
		autoPurge: null,
		skipAllowed: true,
		ignoreList: ['view_counter', 'directus_activity'],
		ttl: '1h',
	});
});

test('parseStored reads objects and JSON strings, rejects garbage and empty overrides', () => {
	const stored = { autoPurge: false, skipAllowed: null, ignoreList: ['a', 'a', 'b'], ttl: '1h', updatedAt: '2026-11-19T10:00:00Z', updatedBy: 'u1' };
	assert.deepEqual(parseStored(stored), { ...stored, ignoreList: ['a', 'b'] });
	assert.deepEqual(parseStored(JSON.stringify(stored)), { ...stored, ignoreList: ['a', 'b'] });
	assert.equal(parseStored(null), null);
	assert.equal(parseStored('{broken'), null);
	assert.equal(parseStored([1, 2]), null);
	assert.equal(parseStored({ autoPurge: 'yes', ignoreList: 'a' }), null);
	assert.equal(parseStored({ ttl: 'forever' }), null);
	assert.deepEqual(parseStored({ ttl: 600000 })?.ttl, '600000');
});

test('readValues / applyToEnv round trip on an env object', () => {
	const env: Record<string, unknown> = { CACHE_AUTO_PURGE: true, CACHE_SKIP_ALLOWED: 'false', CACHE_AUTO_PURGE_IGNORE_LIST: 'a, b,,a', CACHE_TTL: '30m' };
	assert.deepEqual(readValues(env), { autoPurge: true, skipAllowed: false, ignoreList: ['a', 'b'], ttl: '30m' });
	applyToEnv(env, { autoPurge: false, skipAllowed: true, ignoreList: ['c'], ttl: '1h' });
	assert.equal(env.CACHE_TTL, '1h');
	assert.equal(env.CACHE_AUTO_PURGE, false);
	assert.equal(env.CACHE_SKIP_ALLOWED, true);
	assert.deepEqual(env.CACHE_AUTO_PURGE_IGNORE_LIST, ['c']);
	assert.deepEqual(readValues({}), { autoPurge: false, skipAllowed: false, ignoreList: [], ttl: '5m' });
	assert.equal(readValues({ CACHE_TTL: 300000 }).ttl, '300000');
});

test('format helpers produce plain tile texts', async () => {
	const { formatMinutes, formatMinuteCount, formatPeriod, formatPercent, formatShare, formatWindow, formatSaved } = await import('./format');
	assert.equal(formatMinutes(296, 1440), '296 minutes of the last 24 hours');
	assert.equal(formatMinutes(1, 4320), '1 minute of the last 3 days');
	assert.equal(formatMinuteCount(1288), '1,288 minutes');
	assert.equal(formatPeriod(1), 'the last hour');
	assert.equal(formatPeriod(168), 'the last 7 days');
	assert.equal(formatMinutes(0, 60), '0 minutes of the last hour');
	assert.equal(formatPercent(0.05), '5 %');
	assert.equal(formatShare(306 / 1440), '21 %');
	assert.equal(formatShare(22 / 1440), '1.5 %');
	assert.equal(formatShare(0), '0 %');
	assert.equal(formatShare(0.0004), '< 0.1 %');
	assert.equal(formatSaved(288 / 1440), '−20 %');
	assert.equal(formatSaved(0), '0 %');
	assert.equal(formatWindow(1), '1 hour');
	assert.equal(formatWindow(6), '6 hours');
	assert.equal(formatWindow(24), '24 hours');
	assert.equal(formatWindow(72), '3 days');
	assert.equal(formatWindow(168), '7 days');
	assert.equal(formatWindow(36), '36 hours');
});

test('per-hour rate rounds to whole minutes and says "less than 1" below one', async () => {
	const { perHour, formatRate, formatRateCompare, formatMinutesShort } = await import('./format');
	assert.equal(perHour(296, 1440), 12); // 12.33
	assert.equal(perHour(300, 1440), 13); // 12.5 rounds up
	assert.equal(perHour(23, 1440), null); // 0.96
	assert.equal(perHour(24, 1440), 1);
	assert.equal(perHour(0, 1440), 0);
	assert.equal(perHour(17, 60), 17);
	assert.equal(formatRate(296, 1440), 'about 12 minutes per hour');
	assert.equal(formatRate(30, 1440), 'about 1 minute per hour');
	assert.equal(formatRate(5, 1440), 'less than 1 minute per hour');
	assert.equal(formatRate(0, 1440), '0 minutes per hour');
	assert.equal(formatRateCompare(22, 296, 1440), 'less than 1 minute per hour instead of 12');
	assert.equal(formatRateCompare(30, 296, 1440), 'about 1 minute per hour instead of 12');
	assert.equal(formatMinutesShort(288, 1440), '288 min · ~12/h');
	assert.equal(formatMinutesShort(3, 1440), '3 min · <1/h');
	assert.equal(formatMinutesShort(1288, 10080), '1,288 min · ~8/h');
});

test('parseDuration follows the ms rules Directus uses for CACHE_TTL', async () => {
	const { parseDuration, isValidTtl, sameDuration, MAX_TTL_MS } = await import('./duration');
	assert.equal(parseDuration('5m'), 300_000);
	assert.equal(parseDuration('1h'), 3_600_000);
	assert.equal(parseDuration('12 hours'), 43_200_000);
	assert.equal(parseDuration('1.5h'), 5_400_000);
	assert.equal(parseDuration('1d'), 86_400_000);
	assert.equal(parseDuration('300000'), 300_000);
	assert.equal(parseDuration(300000), 300_000);
	assert.equal(parseDuration('90s'), 90_000);
	assert.equal(parseDuration('2H'), 7_200_000);
	assert.equal(parseDuration(''), null);
	assert.equal(parseDuration('1 hour 5 minutes'), null);
	assert.equal(parseDuration('forever'), null);
	assert.equal(parseDuration(null), null);
	assert.equal(isValidTtl('1h'), true);
	assert.equal(isValidTtl('30d'), true);
	assert.equal(isValidTtl(MAX_TTL_MS + 1), false);
	assert.equal(isValidTtl('31d'), false);
	assert.equal(isValidTtl('0'), false);
	assert.equal(isValidTtl('-5m'), false);
	assert.equal(sameDuration('1h', '60m'), true);
	assert.equal(sameDuration('1h', '3600000'), true);
	assert.equal(sameDuration('1h', '2h'), false);
});

test('validateInput checks ttl', () => {
	const ok = validateInput({ ttl: ' 12h ' }, new Set());
	assert.deepEqual(ok, { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: '12h' } });
	assert.deepEqual(validateInput({ ttl: 600000 }, new Set()), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: '600000' } });
	assert.deepEqual(validateInput({ ttl: null }, new Set()), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: null } });
	for (const ttl of ['soon', '0', '-1h', '40d', '', true, [1]]) {
		const result = validateInput({ ttl }, new Set());
		assert.equal(result.ok, false, String(ttl));
		assert.match(result.ok ? '' : result.errors.join(), /Use a duration like 5m, 1h or 12h/);
	}
});
