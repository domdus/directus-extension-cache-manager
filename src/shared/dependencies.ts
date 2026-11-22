/**
 * Which collections a cached answer depends on: the requested collection plus every collection its fields, filter,
 * deep and sort reach through relations. When unsure, it errs on the side of listing more collections; an answer
 * that lists more is cleared more often, never kept too long. `*` means "unknown: clear on every write".
 */

export type RelationLike = {
	collection: string;
	field: string;
	related_collection: string | null;
	meta?: { one_field?: string | null; one_allowed_collections?: string[] | null } | null;
};

export type SchemaLike = {
	collections: Record<string, { fields?: Record<string, unknown> } | undefined>;
	relations: RelationLike[];
};

export type QueryLike = {
	fields?: string[] | null;
	filter?: unknown;
	deep?: unknown;
	sort?: string[] | null;
	alias?: Record<string, string> | null;
};

export const ANY = '*';
const MAX_DEPTH = 12;

type Link = { field: string; related: string[]; kind: 'm2o' | 'a2o' | 'o2m' };

/** Relational fields of a collection, both directions. */
export function linksOf(schema: SchemaLike, collection: string): Link[] {
	const links: Link[] = [];
	for (const relation of schema.relations) {
		if (relation.collection === collection) {
			if (relation.related_collection) links.push({ field: relation.field, related: [relation.related_collection], kind: 'm2o' });
			else links.push({ field: relation.field, related: [...(relation.meta?.one_allowed_collections ?? [])], kind: 'a2o' });
		}
		if (relation.related_collection === collection && relation.meta?.one_field) {
			links.push({ field: relation.meta.one_field, related: [relation.collection], kind: 'o2m' });
		}
	}
	return links;
}

/** "count(comments)" → "comments", "item:block_hero" → field "item" with scope "block_hero". */
function parseSegment(segment: string): { field: string; scope: string | null } {
	const fn = /^\w+\((.+)\)$/.exec(segment);
	const name = fn ? fn[1]! : segment;
	const colon = name.indexOf(':');
	return colon === -1 ? { field: name, scope: null } : { field: name.slice(0, colon), scope: name.slice(colon + 1) };
}

function linkFor(schema: SchemaLike, collection: string, segment: string): { link: Link; related: string[] } | null {
	const { field, scope } = parseSegment(segment);
	const link = linksOf(schema, collection).find((entry) => entry.field === field);
	if (!link) return null;
	return { link, related: scope ? link.related.filter((name) => name === scope) : link.related };
}

class Walker {
	readonly deps = new Set<string>();
	constructor(private schema: SchemaLike) {}

	add(collection: string) {
		this.deps.add(collection);
	}

	/** One field path, already split: ["author", "avatar", "*"]. */
	path(collection: string, segments: string[], depth = 0) {
		if (!segments.length || depth > MAX_DEPTH) return;
		const [segment, ...rest] = segments as [string, ...string[]];
		if (segment === '*') {
			for (const link of linksOf(this.schema, collection)) {
				// A bare "*" returns the own columns plus the ids of o2m children: those depend on the child collection.
				if (!rest.length && link.kind !== 'o2m') continue;
				for (const related of link.related) {
					this.add(related);
					this.path(related, rest, depth + 1);
				}
			}
			return;
		}
		const found = linkFor(this.schema, collection, segment);
		if (!found) return;
		// A bare m2o / a2o field returns the foreign key, which is a column of this collection.
		if (!rest.length && found.link.kind !== 'o2m') return;
		for (const related of found.related) {
			this.add(related);
			this.path(related, rest, depth + 1);
		}
	}

	filter(collection: string, filter: unknown, depth = 0) {
		if (!filter || typeof filter !== 'object' || depth > MAX_DEPTH) return;
		if (Array.isArray(filter)) {
			for (const entry of filter) this.filter(collection, entry, depth + 1);
			return;
		}
		for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
			if (key === '_and' || key === '_or') {
				this.filter(collection, value, depth + 1);
				continue;
			}
			if (key === '_some' || key === '_none') {
				this.filter(collection, value, depth + 1);
				continue;
			}
			if (key.startsWith('_')) continue;
			const follow = /^\$FOLLOW\(\s*([\w-]+)\s*,\s*([\w-]+)\s*\)$/.exec(key);
			if (follow) {
				this.add(follow[1]!);
				this.filter(follow[1]!, value, depth + 1);
				continue;
			}
			const found = linkFor(this.schema, collection, key);
			if (!found) continue;
			for (const related of found.related) {
				this.add(related);
				this.filter(related, value, depth + 1);
			}
		}
	}

	deep(collection: string, deep: unknown, depth = 0) {
		if (!deep || typeof deep !== 'object' || Array.isArray(deep) || depth > MAX_DEPTH) return;
		for (const [key, value] of Object.entries(deep as Record<string, unknown>)) {
			if (key.startsWith('_')) continue;
			const found = linkFor(this.schema, collection, key);
			if (!found) continue;
			for (const related of found.related) {
				this.add(related);
				if (value && typeof value === 'object') {
					const nested = value as Record<string, unknown>;
					this.filter(related, nested['_filter'], depth + 1);
					for (const sort of toArray(nested['_sort'])) this.path(related, sortPath(sort), depth + 1);
					this.deep(related, nested, depth + 1);
				}
			}
		}
	}
}

function toArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
	if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
	return [];
}

function sortPath(sort: string): string[] {
	return sort.replace(/^-/, '').split('.');
}

/** Tag of one item, for clearing single-item responses: `pages#5`. `pages#` stands for all of them. */
export function itemTag(collection: string, key: unknown = ''): string {
	return `${collection}#${String(key)}`;
}

/** Is this tag an item tag (`pages#5`, `pages#`)? Then its collection, else null. */
export function collectionOfItemTag(tag: string): string | null {
	const at = tag.indexOf('#');
	return at > 0 ? tag.slice(0, at) : null;
}

/**
 * `/items/<collection>/<key>` (or several keys, `1,2`): the items a single-item read returns. null for anything
 * else (lists, singletons, system routes).
 */
export function itemsOfPath(pathname: string): { collection: string; keys: string[] } | null {
	const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
	if (parts.length !== 3 || parts[0] !== 'items') return null;
	const keys = parts[2]!.split(',').map((key) => key.trim()).filter(Boolean);
	return keys.length ? { collection: parts[1]!, keys } : null;
}

/** Collections the answer of `collection` with this (sanitized) query depends on. */
export function queryDependencies(schema: SchemaLike, collection: string, query: QueryLike | null | undefined, includeRoot = true): Set<string> {
	const walker = new Walker(schema);
	if (includeRoot) walker.add(collection);
	const alias = query?.alias ?? {};
	const fields = query?.fields?.length ? query.fields : ['*'];
	for (const field of fields) {
		const segments = field.split('.');
		// An alias names another field of the same level: `alias[thumb]=image` + `fields=thumb.id`.
		if (alias[segments[0]!]) segments[0] = alias[segments[0]!]!;
		walker.path(collection, segments);
	}
	walker.filter(collection, query?.filter);
	walker.deep(collection, query?.deep);
	for (const sort of query?.sort ?? []) walker.path(collection, sortPath(sort));
	return walker.deps;
}

/** Collections a permission rule's filter reaches through relations (not including the collection itself). */
export function filterDependencies(schema: SchemaLike, collection: string, filter: unknown): Set<string> {
	const walker = new Walker(schema);
	walker.filter(collection, filter);
	return walker.deps;
}

/** REST paths of system collections that answer like /items. */
const SYSTEM_ROUTES: Record<string, string> = {
	activity: 'directus_activity',
	revisions: 'directus_revisions',
	presets: 'directus_presets',
	notifications: 'directus_notifications',
	comments: 'directus_comments',
	files: 'directus_files',
	folders: 'directus_folders',
	shares: 'directus_shares',
	versions: 'directus_versions',
	dashboards: 'directus_dashboards',
	panels: 'directus_panels',
	translations: 'directus_translations',
	users: 'directus_users',
	roles: 'directus_roles',
	policies: 'directus_policies',
	permissions: 'directus_permissions',
	access: 'directus_access',
	settings: 'directus_settings',
	operations: 'directus_operations',
};

/**
 * The collection a GET path reads, or null when the path is not a plain collection read
 * (GraphQL, flow webhooks, /server, custom endpoints …).
 */
export function collectionOfPath(pathname: string, known: (collection: string) => boolean): string | null {
	const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
	if (!parts.length) return null;
	if (parts[0] === 'items') return parts[1] && known(parts[1]) ? parts[1] : null;
	const system = SYSTEM_ROUTES[parts[0]!];
	if (!system || !known(system)) return null;
	// /users/me, /files/<id>, /permissions/me … all read that collection; anything deeper is unknown.
	return parts.length <= 2 ? system : null;
}
