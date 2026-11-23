import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveGaps } from './coverage';
import { writtenItems } from '../api/targeted';

test('live gaps: writes missing from the activity log are named, busiest gap first', () => {
	const gaps = liveGaps({ pages: 100, visits: 40, flows_out: 12, directus_activity: 900 }, { pages: 100, visits: 10 });
	assert.deepEqual(gaps, [
		{ collection: 'visits', live: 40, logged: 10 },
		{ collection: 'flows_out', live: 12, logged: 0 },
	]);
});

test('live gaps: small or relative differences are not named', () => {
	assert.deepEqual(liveGaps({ pages: 2 }, {}), [], 'fewer than 3 items');
	assert.deepEqual(liveGaps({ pages: 100 }, { pages: 90 }), [], 'less than 20 % missing');
	assert.deepEqual(liveGaps({ pages: 10 }, { pages: 40 }), [], 'more logged than seen (other servers)');
});

test('live writes count each item once, at the inner methods', () => {
	assert.equal(writtenItems('createOne', []), 1);
	assert.equal(writtenItems('createMany', []), 0, 'createMany calls createOne per item');
	assert.equal(writtenItems('updateBatch', ['1', '2']), 0, 'updateBatch calls updateMany per item');
	assert.equal(writtenItems('updateMany', ['1', '2', '3']), 3);
	assert.equal(writtenItems('deleteMany', null), 1);
});
