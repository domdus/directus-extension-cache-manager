import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, buildAnalysis, isRecommendable, parseHours, purgeMinutes, recommendation, toBuckets, type ActivityBucket } from './analysis';
import { applyToEnv, completeBaseline, mergeValues, parseStored, readValues, toOverride, validateInput, type CacheValues } from './settings';
import { durationText, isValidTtl, sameDuration } from './duration';

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
	assert.equal(counter.reason, 'Already ignored');
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

test('validateInput accepts booleans and null; the ignore list is not saved anymore', () => {
	assert.deepEqual(validateInput({ autoPurge: true, skipAllowed: null }, collections), {
		ok: true,
		value: { autoPurge: true, skipAllowed: null, ignoreList: null, ttl: null },
	});
	assert.deepEqual(validateInput({}, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: null } });
	assert.deepEqual(validateInput({ ignoreList: null }, collections), { ok: true, value: { autoPurge: null, skipAllowed: null, ignoreList: null, ttl: null } });
});

test('validateInput rejects bad types, unknown collections and unknown keys', () => {
	const fail = (body: unknown) => {
		const result = validateInput(body, collections);
		assert.equal(result.ok, false);
		return result.ok ? [] : result.errors;
	};
	assert.match(fail({ autoPurge: 'true' }).join(), /autoPurge must be/);
	assert.match(fail({ skipAllowed: 1 }).join(), /skipAllowed must be/);
	assert.match(fail({ ignoreList: ['view_counter'] }).join(), /rule that never clears/);
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
		ignoreList: null,
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
	const { formatTimes, formatMinuteCount, formatPeriod, formatPercent, formatShare, formatWindow, formatSaved } = await import('./format');
	assert.equal(formatTimes(296, 1440), '296 times in the last 24 hours');
	assert.equal(formatTimes(1, 4320), '1 time in the last 3 days');
	assert.equal(formatMinuteCount(1288), '1,288 minutes');
	assert.equal(formatPeriod(1), 'the last hour');
	assert.equal(formatPeriod(168), 'the last 7 days');
	assert.equal(formatTimes(0, 60), '0 times in the last hour');
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

test('duration labels always include a unit; a bare number is milliseconds', async () => {
	const { formatDurationLabel, formatDurationShort, isBareMilliseconds, bareMillisecondsHint } = await import('./duration');
	assert.equal(formatDurationLabel('2h'), '2 hours');
	assert.equal(formatDurationLabel('1h'), '1 hour');
	assert.equal(formatDurationLabel('5m'), '5 minutes');
	assert.equal(formatDurationLabel('2'), '2 milliseconds');
	assert.equal(formatDurationLabel('300000'), '5 minutes');
	assert.equal(formatDurationLabel('12 hours'), '12 hours');
	assert.equal(formatDurationShort('2h'), '2h');
	assert.equal(formatDurationShort('2'), '2ms');
	assert.equal(formatDurationShort('300000'), '5m');
	assert.equal(isBareMilliseconds('2'), true);
	assert.equal(isBareMilliseconds('2h'), false);
	assert.equal(isBareMilliseconds(300000), true);
	assert.match(bareMillisecondsHint('2') ?? '', /2 milliseconds.*2h for hours/);
	assert.equal(bareMillisecondsHint('2h'), null);
});

test('describeRule names the lifetime with a unit', async () => {
	const { describeRule, DEFAULT_RULE } = await import('./rules');
	assert.equal(describeRule({ ...DEFAULT_RULE, ttl: '2' }), 'cached for 2 milliseconds');
	assert.equal(describeRule({ ...DEFAULT_RULE, ttl: '2h' }), 'cached for 2 hours');
	assert.equal(describeRule({ ...DEFAULT_RULE, ttl: '5m' }), 'cached for 5 minutes');
	assert.equal(
		describeRule({ create: true, update: false, delete: true, skipFields: [], ttl: '1h' }),
		'Clears on create and delete · cached for 1 hour',
	);
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

test('sameDuration and durationText accept a cleared input (null/undefined)', () => {
	assert.equal(durationText(null), '');
	assert.equal(durationText(undefined), '');
	assert.equal(durationText(' 1h '), '1h');
	assert.equal(sameDuration(null, '1h'), false);
	assert.equal(sameDuration(undefined, undefined), true);
	assert.equal(sameDuration('1h', '60m'), true);
	assert.equal(isValidTtl(null), false);
});

test('completeBaseline fills settings an older extension version did not keep', () => {
	const fromEnv = { autoPurge: true, skipAllowed: true, ignoreList: ['a'], ttl: '3h' };
	const kept = { autoPurge: false, skipAllowed: true, ignoreList: ['b'] };
	assert.deepEqual(completeBaseline(kept, fromEnv), { autoPurge: false, skipAllowed: true, ignoreList: ['b'], ttl: '3h' });
	assert.deepEqual(completeBaseline({ ...kept, ttl: '1h' }, fromEnv).ttl, '1h');
});

test('formatTimesPerHour: whole numbers, "<1" below one per hour', async () => {
	const { formatTimesPerHour } = await import('./format');
	assert.equal(formatTimesPerHour(296, 1440), '12');
	assert.equal(formatTimesPerHour(9, 1440), '<1');
	assert.equal(formatTimesPerHour(0, 1440), '0');
});

test('formatSavedPerHour for the table', async () => {
	const { formatSavedPerHour } = await import('./format');
	assert.equal(formatSavedPerHour(284, 1440), '−12/h');
	assert.equal(formatSavedPerHour(3, 1440), '−<1/h');
	assert.equal(formatSavedPerHour(0, 1440), '0');
});

test('buildExport writes only the saved values', async () => {
	const { buildExport } = await import('./transfer');
	const file = buildExport(
		{ autoPurge: null, skipAllowed: true, ignoreList: ['view_counter'], ttl: '1h', updatedAt: '2026-11-19T10:00:00.000Z', updatedBy: 'user-1' },
		new Date('2026-11-20T08:00:00Z'),
	);
	assert.deepEqual(file, {
		extension: 'directus-extension-cache-manager',
		format: 1,
		exportedAt: '2026-11-20T08:00:00.000Z',
		settings: { autoPurge: null, skipAllowed: true, ignoreList: null, ttl: '1h' },
		updatedAt: '2026-11-19T10:00:00.000Z',
	});
	assert.equal(buildExport(null).settings, null);
});

test('parseImport reads exported files and bare settings, with plain errors', async () => {
	const { buildExport, parseImport, parseImportIgnoreList, ImportError } = await import('./transfer');
	const exported = JSON.stringify(buildExport({ autoPurge: false, skipAllowed: null, ignoreList: ['a'], ttl: null, updatedAt: null, updatedBy: 'u' }));
	// The ignore list is not exported anymore.
	assert.deepEqual(parseImport(exported), { autoPurge: false, skipAllowed: null, ttl: null });
	assert.deepEqual(parseImportIgnoreList(exported), []);
	assert.deepEqual(parseImport(JSON.stringify(buildExport(null))), {});
	// Files from older versions: the ignore list is split off and becomes rules.
	assert.deepEqual(parseImport('{"ignoreList":["a"],"ttl":"2h","updatedBy":"x"}'), { ttl: '2h' });
	assert.deepEqual(parseImportIgnoreList('{"ignoreList":[" a ","a","b"],"ttl":"2h"}'), ['a', 'b']);
	assert.deepEqual(parseImportIgnoreList('{"extension":"directus-extension-cache-manager","settings":{"ignoreList":["c"]}}'), ['c']);
	assert.deepEqual(parseImport('{"ignoreList":["a"]}'), {});
	// Unknown keys next to known ones reach /apply, which names them.
	assert.deepEqual(parseImport('{"ttl":"2h","store":"redis"}'), { ttl: '2h', store: 'redis' });

	const fails = (text: string, pattern: RegExp) => assert.throws(() => parseImport(text), (error: unknown) => error instanceof ImportError && pattern.test((error as Error).message));
	fails('not json', /not valid JSON/);
	fails('[1,2]', /does not contain Cache Manager settings/);
	fails('{"rules":[]}', /does not contain Cache Manager settings/);
	fails('{"extension":"directus-extension-other","settings":{}}', /another extension/);
	fails('{"extension":"directus-extension-cache-manager","format":2,"settings":{}}', /newer version/);
	fails('{"extension":"directus-extension-cache-manager","settings":"x"}', /does not contain/);

	// The imported body goes through the same validation as Save & apply.
	const result = validateInput(parseImport('{"ttl":"soon"}'), new Set(['a']));
	assert.equal(result.ok, false);
});

test('anyWriteMinutes counts minutes with any change, ignored or not', () => {
	const rows = [...writes('view_counter', range(0, 600)), ...writes('pages', range(590, 610)), ...writes('logs', range(1000, 1010))];
	const analysis = buildAnalysis(rows, options({ ignoreList: ['view_counter', 'logs'] }));
	assert.equal(analysis.purgeMinutes, 20);
	assert.equal(analysis.anyWriteMinutes, 620);
	// With auto purge off nothing is cleared, but the "without ignoring" value still shows what changed.
	assert.equal(buildAnalysis(rows, options({ autoPurge: false })).anyWriteMinutes, 620);
	assert.equal(buildAnalysis([], options()).anyWriteMinutes, 0);
});

test('unmeasuredCollections lists user tables with tracking off', async () => {
	const { unmeasuredCollections } = await import('./coverage');
	assert.deepEqual(
		unmeasuredCollections({
			transactions: { accountability: null },
			articles: { accountability: 'all' },
			logins: { accountability: 'activity' },
			directus_sessions: { accountability: null },
			audit: { accountability: null },
			legacy: {},
		}),
		['audit', 'transactions'],
	);
});

test('unmeasuredLine names collections that still clear the cache', async () => {
	const { unmeasuredLine, nameList } = await import('./coverage');
	assert.equal(unmeasuredLine(['transactions'], []), 'Not measured: 1 collection (transactions). The real number can be higher.');
	assert.equal(unmeasuredLine(['a', 'b'], []), 'Not measured: 2 collections (a, b). The real number can be higher.');
	assert.equal(unmeasuredLine(['a', 'b', 'c', 'd', 'e'], ['b']), 'Not measured: 4 collections (a, c, d and 1 more). The real number can be higher.');
	assert.equal(unmeasuredLine(['a'], ['a']), null);
	assert.equal(unmeasuredLine([], []), null);
	assert.equal(nameList(['a', 'b', 'c']), 'a, b, c');
	assert.equal(nameList(['a', 'b', 'c', 'd', 'e', 'f']), 'a, b, c and 3 more');
});

test('buildRows puts not measured collections last and keeps them out of measured rows', async () => {
	const { buildRows } = await import('./coverage');
	const analysis = buildAnalysis(
		[...writes('view_counter', range(0, 500)), ...writes('transactions', range(0, 50)), ...writes('pages', range(0, 10))],
		options({ ignoreList: ['view_counter'], unmeasured: ['audit', 'transactions'] }),
	);
	// Old activity of a not measured collection is left out of every number.
	assert.equal(analysis.purgeMinutes, 10);
	assert.equal(analysis.minuteSets.transactions, undefined);
	assert.ok(!analysis.recommendedList.includes('transactions'));
	assert.deepEqual(analysis.unmeasured, ['audit', 'transactions']);

	const rows = buildRows(analysis.collections, ['view_counter', 'logs', 'audit'], analysis.unmeasured, ['view_counter', 'audit']);
	assert.deepEqual(
		rows.map((row) => [row.collection, row.measured, row.ignored]),
		[
			['view_counter', true, true],
			['pages', true, false],
			['logs', true, false],
			['audit', false, true],
			['transactions', false, false],
		],
	);
	assert.equal(rows.find((row) => row.collection === 'logs')!.reason, 'No changes in this time');
});

test('retention: limited only when enabled, warning when shorter than the period', async () => {
	const { activityRetentionHours, retentionWarning } = await import('./coverage');
	const { parseDuration } = await import('./duration');
	assert.equal(activityRetentionHours(true, parseDuration('3d')), 72);
	assert.equal(activityRetentionHours('true', parseDuration('90d')), 2160);
	assert.equal(activityRetentionHours(false, parseDuration('3d')), null);
	assert.equal(activityRetentionHours(true, null), null);
	assert.equal(activityRetentionHours(true, 0), null);
	assert.equal(retentionWarning(72, 168), 'Directus only keeps 3 days of activity. "Last 7 days" shows less than actually happened.');
	assert.equal(retentionWarning(12, 24), 'Directus only keeps 12 hours of activity. "Last 24 hours" shows less than actually happened.');
	assert.equal(retentionWarning(0.5, 1), 'Directus only keeps 30 minutes of activity. "Last 1 hour" shows less than actually happened.');
	assert.equal(retentionWarning(72, 72), null);
	assert.equal(retentionWarning(2160, 168), null);
	assert.equal(retentionWarning(null, 168), null);
});

test('rowState shows the state in use and what Save & apply will change', async () => {
	const { rowState, ROW_STATE_LABELS } = await import('./selection');
	const draft = new Set(['a', 'new']);
	const effective = new Set(['a', 'old']);
	assert.equal(rowState('a', true, draft, effective), 'ignored');
	assert.equal(rowState('new', true, draft, effective), 'will-ignore');
	assert.equal(rowState('old', true, draft, effective), 'will-clear');
	assert.equal(rowState('pages', true, draft, effective), 'clears');
	assert.equal(rowState('audit', false, draft, effective), 'unmeasured');
	assert.equal(rowState('old', false, draft, effective), 'will-clear');
	assert.equal(ROW_STATE_LABELS['will-ignore'], 'Will keep cache');
	assert.equal(ROW_STATE_LABELS['will-clear'], 'Will clear cache');
});

test('selectionChanges splits the selection into what each action changes', async () => {
	const { selectionChanges } = await import('./selection');
	assert.deepEqual(selectionChanges(['a', 'b', 'c', 'a'], new Set(['b'])), { toKeep: ['a', 'c'], toClear: ['b'] });
	assert.deepEqual(selectionChanges([], new Set(['b'])), { toKeep: [], toClear: [] });
	assert.deepEqual(selectionChanges(['b'], new Set(['b'])), { toKeep: [], toClear: ['b'] });
	// Configured collections can't be changed on the page.
	assert.deepEqual(selectionChanges(['a', 'cfg'], new Set(['cfg']), new Set(['cfg'])), { toKeep: ['a'], toClear: [] });
});

test('pendingChanges lists each unsaved change; saveBarText counts them', async () => {
	const { pendingChanges, saveBarText } = await import('./pending');
	const effective: CacheValues = { autoPurge: true, skipAllowed: false, ignoreList: ['a', 'b'], ttl: '5m' };
	assert.deepEqual(pendingChanges({ ...effective, ignoreList: ['b', 'a'], ttl: '300000' }, effective), []);
	assert.deepEqual(pendingChanges({ autoPurge: false, skipAllowed: true, ignoreList: ['a', 'c'], ttl: '1h' }, effective).length, 3);
	// The ignore list is not edited here anymore.
	assert.deepEqual(pendingChanges({ ...effective, ignoreList: ['a', 'c', 'd'] }, effective), []);
	assert.deepEqual(pendingChanges(effective, null), []);
	assert.deepEqual(saveBarText(0, true), { text: 'No unsaved changes', danger: false });
	assert.deepEqual(saveBarText(1, true), { text: '1 unsaved change', danger: false });
	assert.deepEqual(saveBarText(3, true), { text: '3 unsaved changes', danger: false });
	assert.deepEqual(saveBarText(3, false), { text: 'Fix the cache lifetime to save', danger: true });
});

test('sensitive collection names get a warning on suggestions', async () => {
	const { looksSensitive, suggestionTooltip } = await import('./selection');
	for (const name of ['subscriptions', 'checkout_sessions', 'payments', 'order_history', 'transactions', 'user_licenses', 'memberships', 'vip_status', 'carts', 'tickets', 'premium_plans']) {
		assert.equal(looksSensitive(name), true, name);
	}
	for (const name of ['visits', 'com_videos', 'com_views', 'searches', 'errors', 'cartoons', 'authors', 'pages']) {
		assert.equal(looksSensitive(name), false, name);
	}
	assert.match(suggestionTooltip('subscriptions', '12h'), /Cache-Control: no-store.*up to 12 hours old/);
	assert.match(suggestionTooltip('visits', ''), /until the cache expires/);
});

test('export and import carry the clearing rules', async () => {
	const { buildExport, parseImport, parseImportRules } = await import('./transfer');
	const rules = { targeted: true, collections: { com_videos: { create: true, update: true, delete: true, skipFields: ['views_count'], ttl: '5m' } } };
	const text = JSON.stringify(buildExport(null, new Date(), rules));
	assert.deepEqual(parseImportRules(text), rules);
	assert.deepEqual(parseImport(text), {});
	assert.equal(parseImportRules(JSON.stringify(buildExport(null, new Date(), { targeted: false, collections: {} }))), undefined);
	assert.equal(parseImportRules('{"ignoreList":["a"]}'), undefined);
});

test('ttl vs purge: warn only when the cache is emptied much sooner than the lifetime', async () => {
	const { ttlVsPurgeText, sizeVsClearsText, emptiedEveryLabel, intervalText } = await import('./health');
	const day = 24 * 60;
	assert.match(ttlVsPurgeText('12h', 288, day) ?? '', /12 hours/);
	assert.match(ttlVsPurgeText('12h', 288, day) ?? '', /12 times per hour/);
	assert.doesNotMatch(ttlVsPurgeText('12h', 288, day) ?? '', /—/);
	assert.equal(ttlVsPurgeText('12h', 1, day), null);
	assert.equal(ttlVsPurgeText('12h', 0, day), null);
	assert.match(ttlVsPurgeText('12h', 288, day, { granular: true }) ?? '', /Granular mode/);
	assert.match(ttlVsPurgeText('5m', 30, 60) ?? '', /5 minutes/);
	assert.equal(ttlVsPurgeText('5m', 1, 60), null);

	const now = Date.UTC(2026, 10, 21, 13, 0, 0);
	const since = new Date(now - 16 * 3_600_000).toISOString();
	// 7,932 clears in 16 hours: about every 7 seconds.
	assert.equal(emptiedEveryLabel(7932, since, now), 'about every 7 seconds');
	assert.equal(emptiedEveryLabel(3, new Date(now - 6 * 3_600_000).toISOString(), now), 'about every 2 hours');
	assert.equal(emptiedEveryLabel(1, new Date(now - 60_000).toISOString(), now), null, 'one clear is no rhythm');
	assert.equal(emptiedEveryLabel(0, since, now), null);
	assert.equal(intervalText(1), 'about every 1 minute');
	assert.equal(intervalText(3 * 24 * 60), 'about every 3 days');

	// Size hint only when clears are frequent (every 5 minutes or more often), and worded as "likely".
	assert.match(sizeVsClearsText(4.3 * 1024 * 1024, 900, since, now) ?? '', /about 56 times per hour, so it likely never gets the chance to grow: 4.3 MB now/);
	assert.equal(sizeVsClearsText(50 * 1024 * 1024, 7932, since, now), null);
	assert.equal(sizeVsClearsText(4_000_000, 50, since, now), null, '50 clears in 16 hours is not constant');
	assert.equal(sizeVsClearsText(4_000_000, 10, since, now), null);

});

test('rules that never clear replace the saved ignore list', async () => {
	const { neverClears, neverClearCollections, withNeverClear, DEFAULT_RULES } = await import('./rules');
	const config = withNeverClear(
		{ ...DEFAULT_RULES, collections: { views: { create: true, update: true, delete: true, skipFields: ['count'], ttl: '1h' } } },
		['views', 'logs'],
	);
	assert.deepEqual(config.collections['views'], { create: false, update: false, delete: false, skipFields: ['count'], ttl: '1h' });
	assert.equal(neverClears(config.collections['logs']), true);
	assert.equal(neverClears({ create: false, update: true, delete: false, skipFields: [], ttl: null }), false);
	assert.deepEqual(neverClearCollections(config), ['logs', 'views']);
});

test('recent events: identical clears in the same second become one row with a count', async () => {
	const { groupEvents } = await import('./events');
	const e = (at: string, reason: string, kind: 'full' | 'targeted' | 'skipped' = 'full', removed = 0) => ({ at, kind, reason, removed, collection: null, action: null });
	const rows = groupEvents([
		e('2026-11-21T15:00:05.900Z', 'Created in disk_free'),
		e('2026-11-21T15:00:05.100Z', 'Created in disk_free'),
		e('2026-11-21T15:00:05.000Z', 'Created in disk_free'),
		e('2026-11-21T14:45:33.000Z', 'Saved in deliveries_item'),
		e('2026-11-21T14:45:33.000Z', 'Changed in pages', 'targeted', 3),
		e('2026-11-21T14:45:33.000Z', 'Changed in pages', 'targeted', 2),
		e('2026-11-21T14:00:06.000Z', 'Created in disk_free'),
	]);
	assert.deepEqual(rows.map((row) => [row.reason, row.count, row.removed]), [
		['Created in disk_free', 3, 0],
		['Saved in deliveries_item', 1, 0],
		['Changed in pages', 2, 5],
		['Created in disk_free', 1, 0],
	]);
	assert.equal(groupEvents(rows, 2).length, 2);
});
