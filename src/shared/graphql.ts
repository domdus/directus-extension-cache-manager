/**
 * GraphQL requests: Directus answers every collection query through ItemsService.readByQuery, so Cache Manager learns
 * what a GraphQL response uses by watching those reads (see targeted.ts). That only covers root fields that are plain
 * collection reads. This module checks the parsed document (res.locals.graphqlParams.document, the graphql-js AST) for
 * that: any other root field (server_info, users_me, collections, fields …) reads data some other way, so the response
 * has to count as "uses everything".
 */

type NodeLike = { kind: string; [key: string]: any };

/** System collections that /graphql/system reads like items, by their GraphQL name (Directus strips `directus_`). */
const SYSTEM_READS = new Set([
	'activity',
	'revisions',
	'presets',
	'notifications',
	'comments',
	'files',
	'folders',
	'shares',
	'versions',
	'dashboards',
	'panels',
	'translations',
	'users',
	'roles',
	'policies',
	'permissions',
	'access',
	'settings',
	'operations',
	'flows',
	'webhooks',
]);

const SUFFIXES = ['_by_id', '_aggregated', '_by_version'];

export type GraphqlScope = 'items' | 'system';

/** `/graphql` → items, `/graphql/system` → system, anything else → null. */
export function graphqlScope(pathname: string): GraphqlScope | null {
	const path = pathname.replace(/\/+$/, '');
	if (path === '/graphql') return 'items';
	if (path === '/graphql/system') return 'system';
	return null;
}

/** The names of the operation's root fields (fragments resolved), or null when the operation can't be found. */
export function rootFields(document: unknown, operationName?: string | null): string[] | null {
	const definitions: NodeLike[] = (document as { definitions?: NodeLike[] } | null)?.definitions ?? [];
	if (!Array.isArray(definitions)) return null;
	const operations = definitions.filter((node) => node?.kind === 'OperationDefinition');
	const operation = operationName ? operations.find((node) => node.name?.value === operationName) : operations.length === 1 ? operations[0] : undefined;
	if (!operation || operation.operation !== 'query') return null;
	const fragments = new Map<string, NodeLike>();
	for (const node of definitions) if (node?.kind === 'FragmentDefinition' && node.name?.value) fragments.set(node.name.value, node);

	const names: string[] = [];
	const seen = new Set<string>();
	const walk = (selectionSet: NodeLike | undefined): boolean => {
		for (const selection of (selectionSet?.selections ?? []) as NodeLike[]) {
			if (selection.kind === 'Field') names.push(String(selection.name?.value ?? ''));
			else if (selection.kind === 'InlineFragment') {
				if (!walk(selection.selectionSet)) return false;
			} else if (selection.kind === 'FragmentSpread') {
				const name = selection.name?.value;
				const fragment = fragments.get(name);
				if (!fragment) return false;
				if (seen.has(name)) continue;
				seen.add(name);
				if (!walk(fragment.selectionSet)) return false;
			} else return false;
		}
		return true;
	};
	return walk(operation.selectionSet) ? names : null;
}

/** The collection a root field reads like items, or null when Directus answers it some other way. */
export function collectionOfRootField(name: string, scope: GraphqlScope, known: (collection: string) => boolean): string | null {
	const base = (value: string) => {
		if (scope === 'items') return known(value) ? value : null;
		return SYSTEM_READS.has(value) && known(`directus_${value}`) ? `directus_${value}` : null;
	};
	const direct = base(name);
	if (direct) return direct;
	for (const suffix of SUFFIXES) if (name.endsWith(suffix)) return base(name.slice(0, -suffix.length));
	return null;
}

/**
 * Does every root field of this GraphQL query read collections the way the read tracking sees? Introspection
 * (`__schema`, `__type`, `__typename`) only changes with the data model or permissions, which clear everything anyway.
 */
export function tracksAllReads(document: unknown, operationName: string | null | undefined, scope: GraphqlScope, known: (collection: string) => boolean): boolean {
	const names = rootFields(document, operationName);
	if (!names) return false;
	return names.every((name) => name.startsWith('__') || collectionOfRootField(name, scope, known) !== null);
}
