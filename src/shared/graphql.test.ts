import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'graphql';
import { collectionOfRootField, graphqlScope, rootFields, tracksAllReads } from './graphql';

const collections = new Set(['pages', 'visits', 'pages_by_id_log', 'directus_users', 'directus_files', 'directus_collections', 'directus_settings']);
const known = (name: string) => collections.has(name);

test('graphqlScope: items and system endpoints only', () => {
	assert.equal(graphqlScope('/graphql'), 'items');
	assert.equal(graphqlScope('/graphql/'), 'items');
	assert.equal(graphqlScope('/graphql/system'), 'system');
	assert.equal(graphqlScope('/graphqlx'), null);
	assert.equal(graphqlScope('/items/pages'), null);
});

test('rootFields: aliases, fragments, inline fragments and the named operation', () => {
	assert.deepEqual(rootFields(parse('{ a: pages { id } visits { id } }')), ['pages', 'visits']);
	assert.deepEqual(rootFields(parse('query { ...F ... on Query { visits { id } } } fragment F on Query { pages { id } }')), ['pages', 'visits']);
	assert.deepEqual(rootFields(parse('query A { pages { id } } query B { visits { id } }'), 'B'), ['visits']);
	assert.equal(rootFields(parse('query A { pages { id } } query B { visits { id } }')), null, 'two operations, none named');
	assert.equal(rootFields(parse('query A { pages { id } }'), 'C'), null);
	assert.equal(rootFields(parse('mutation { create_pages_item(data: {}) { id } }')), null, 'mutations are never cached');
	assert.equal(rootFields(parse('{ ...Missing }')), null);
	assert.deepEqual(rootFields(parse('{ ...F } fragment F on Query { ...F pages { id } }')), ['pages'], 'a fragment that spreads itself');
	assert.equal(rootFields(null), null);
});

test('collectionOfRootField: collections, suffixes and system names', () => {
	assert.equal(collectionOfRootField('pages', 'items', known), 'pages');
	assert.equal(collectionOfRootField('pages_by_id', 'items', known), 'pages');
	assert.equal(collectionOfRootField('pages_aggregated', 'items', known), 'pages');
	assert.equal(collectionOfRootField('pages_by_version', 'items', known), 'pages');
	assert.equal(collectionOfRootField('pages_by_id_log', 'items', known), 'pages_by_id_log', 'a collection whose name ends like a suffix');
	assert.equal(collectionOfRootField('unknown', 'items', known), null);
	assert.equal(collectionOfRootField('users', 'system', known), 'directus_users');
	assert.equal(collectionOfRootField('files_by_id', 'system', known), 'directus_files');
	assert.equal(collectionOfRootField('settings', 'system', known), 'directus_settings');
	assert.equal(collectionOfRootField('collections', 'system', known), null, 'answered by CollectionsService, not by item reads');
	assert.equal(collectionOfRootField('users_me', 'system', known), null);
	assert.equal(collectionOfRootField('server_info', 'system', known), null);
	assert.equal(collectionOfRootField('users', 'items', known), null, 'system collections are not in /graphql');
});

test('tracksAllReads: every root field must be a collection read; introspection is fine', () => {
	const ok = (query: string, scope: 'items' | 'system' = 'items') => tracksAllReads(parse(query), null, scope, known);
	assert.equal(ok('{ pages { id } visits_aggregated { count { id } } }'), true);
	assert.equal(ok('{ __typename pages { id } }'), true);
	assert.equal(ok('{ __schema { types { name } } }'), true);
	assert.equal(ok('{ users { id } files { id } }', 'system'), true);
	assert.equal(ok('{ users { id } server_info { project { project_name } } }', 'system'), false);
	assert.equal(ok('{ fields { field } }', 'system'), false);
	assert.equal(ok('{ pages { id } unknown { id } }'), false);
});
