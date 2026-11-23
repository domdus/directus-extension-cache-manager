import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, looksSensitiveField, ruleCovers, suggestSkipFields } from './skip-fields';

const repeat = (fields: string[], times: number) => Array.from({ length: times }, () => fields);

test('skip fields: a view counter that most updates touch is suggested', () => {
	const updates = [...repeat(['views_count'], 95), ...repeat(['title', 'body'], 5)];
	const result = suggestSkipFields('pages', updates, 1);
	assert.deepEqual(result?.fields, ['views_count']);
	assert.equal(result?.sample, 100);
	assert.ok(Math.abs((result?.coveredShare ?? 0) - 0.95) < 1e-9);
});

test('skip fields: two counter shapes are combined, real edits are not', () => {
	const updates = [...repeat(['views_count'], 50), ...repeat(['views_count', 'last_viewed'], 40), ...repeat(['title'], 10)];
	assert.deepEqual(suggestSkipFields('pages', updates, 1)?.fields, ['last_viewed', 'views_count']);
});

test('skip fields: a frequent counter with some editor edits keeps the edits out', () => {
	const updates = [...repeat(['views_count'], 60), ...repeat(['title'], 20), ...repeat(['body'], 20)];
	assert.deepEqual(suggestSkipFields('pages', updates, 1)?.fields, ['views_count']);
});

test('skip fields: no suggestion when updates change many different fields', () => {
	const fields = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
	const updates = fields.flatMap((field) => repeat([field], 10));
	assert.equal(suggestSkipFields('pages', updates, 1), null);
});

test('skip fields: creates and deletes lower the covered share', () => {
	const updates = repeat(['views_count'], 100);
	assert.equal(suggestSkipFields('pages', updates, 0.4), null, 'only 40 % of the changes are updates');
	assert.ok((suggestSkipFields('pages', updates, 0.8)?.coveredShare ?? 0) >= 0.8 - 1e-9);
});

test('skip fields: updates touching more than 3 fields never form a suggestion', () => {
	assert.equal(suggestSkipFields('pages', repeat(['a', 'b', 'c', 'd'], 50), 1), null);
	assert.equal(suggestSkipFields('pages', [], 1), null);
});

test('skip fields: changed fields drop excluded ones and parse JSON strings', () => {
	const exclude = new Set(['id', 'date_updated']);
	assert.deepEqual(changedFields({ id: 1, views_count: 3, date_updated: 'x' }, exclude), ['views_count']);
	assert.deepEqual(changedFields('{"views_count":3,"date_updated":"x"}', exclude), ['views_count']);
	assert.deepEqual(changedFields('not json', exclude), []);
	assert.deepEqual(changedFields(null, exclude), []);
});

test('skip fields: an existing rule that already keeps these changes covers the suggestion', () => {
	assert.equal(ruleCovers(undefined, ['views_count']), false);
	assert.equal(ruleCovers({ update: true, skipFields: ['views_count'] }, ['views_count']), true);
	assert.equal(ruleCovers({ update: true, skipFields: [] }, ['views_count']), false);
	assert.equal(ruleCovers({ update: false, skipFields: [] }, ['views_count']), true);
});

test('skip fields: stock and prices are flagged', () => {
	assert.equal(looksSensitiveField('stock'), true);
	assert.equal(looksSensitiveField('price_eur'), true);
	assert.equal(looksSensitiveField('views_count'), false);
});
