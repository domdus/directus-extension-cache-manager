export const EXTENSION_ID = 'cache-manager';
export const LOG_PREFIX = '[cache-manager]';

/** JSON field on directus_settings that stores the override. */
export const SETTINGS_FIELD = 'cache_manager';

/** Analysis window in hours. */
export const DEFAULT_HOURS = 24;
export const MAX_HOURS = 168;

/** Recommend ignoring a collection when it is written in at least this share of the window's minutes. */
export const RECOMMEND_MIN_SHARE = 0.05;

/**
 * Do not recommend a collection when more than this share of its writes came from logged-in users in the
 * admin app (activity origin = PUBLIC_URL). Those are editor collections: editors expect to see their changes.
 */
export const EDITOR_SHARE_MAX = 0.5;

/** System collections that may be recommended. Every other directus_* collection never is. */
export const RECOMMENDABLE_SYSTEM_COLLECTIONS = ['directus_activity', 'directus_presets', 'directus_notifications', 'directus_revisions'];

/** Activity actions that are writes (and purge the cache). */
export const WRITE_ACTIONS = ['create', 'update', 'delete'];

/** Upper bound for the ignore list, to reject garbage input. */
export const MAX_LIST_LENGTH = 500;
