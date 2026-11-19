# Cache Manager

Change how Directus clears its response cache while it runs, without editing config files or restarting. Admins set `CACHE_AUTO_PURGE_IGNORE_LIST`, `CACHE_AUTO_PURGE` and `CACHE_SKIP_ALLOWED` in a module. The module also shows which collections cause cache purges and recommends which ones to ignore.

With `CACHE_AUTO_PURGE` on, every write to a collection that is not in the ignore list clears the **whole** response cache. One busy collection, such as a view counter, can then clear the cache almost every minute, so the cache rarely helps.

## What it does

- **Shows the values**: config value (from `config_app.json` / env at startup), stored override, and the value in effect now, plus `CACHE_TTL` and `CACHE_STORE`.
- **Analyses directus_activity** for the last 1 to 168 hours: for each collection, the writes, the minutes with at least one write, and their share of all minutes. It also shows how many minutes had a full cache purge, and how many there would be with your selection or with all recommendations. The numbers update as you tick collections.
- **Recommends collections to ignore** (see below), each with a warning about stale reads.
- **Applies changes at once.** Save & apply stores the override and changes the running values. The next write or request uses them.
- **Survives restarts.** At startup the stored override is applied again. **Reset to config** removes it.

## Setup

1. Install the bundle and restart Directus once. At startup it creates a hidden JSON field `cache_manager` on `directus_settings`.
2. Enable the module: in **Settings**, under **Module Bar**, turn on **Cache manager**. Only admins see it, and the endpoint answers only admins.
3. Open **Cache manager**, look at the analysis, tick the collections to ignore, and click **Save & apply**.

## The settings

| Setting | On | Off | Recommended |
|---|---|---|---|
| `CACHE_AUTO_PURGE` | Every write to a collection that is not ignored clears the whole response cache | Nothing is cleared on writes. Data refreshes only after `CACHE_TTL`, so editors' changes take up to `CACHE_TTL` to appear | On |
| `CACHE_SKIP_ALLOWED` | Clients can bypass the cache per request with `Cache-Control: no-store`. Apps need this to read ignored collections fresh | The header is ignored | On, for an internal Directus |
| `CACHE_AUTO_PURGE_IGNORE_LIST` | Writes to these collections do not clear the cache | | Write-heavy collections that apps do not read through the cache, or read with `no-store` |

Use the ignore list for write-heavy collections (counters, logs, sessions, analytics) that apps either do not read through the cache or read with `Cache-Control: no-store`. Never add collections the portals read for access decisions (subscriptions, purchases, entitlements), unless those reads send `no-store`. Otherwise a user can get or lose access up to `CACHE_TTL` late.

Reads of an ignored collection can be up to `CACHE_TTL` old for apps, unless they send `Cache-Control: no-store`, which only works with `CACHE_SKIP_ALLOWED` on. The admin app always bypasses the cache for ignored collections, so editors always see current data.

## Recommendations

A collection is recommended when all of these are true (constants in `src/shared/constants.ts`):

- it is not ignored yet,
- it was written in at least **5 %** of the minutes in the window,
- it is not a system collection. `directus_*` collections are never recommended, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly edited in the admin app: no more than **50 %** of its writes came from logged-in users whose request origin was `PUBLIC_URL`. This check needs an absolute `PUBLIC_URL`.

The table also shows **purge minutes saved**: how many minutes would no longer have a full purge if this collection were ignored too.

## Where the values come from

- **Config (baseline)**: the values in env when Directus starts, normally from `config_app.json` (managed by Ansible). The extension never edits that file.
- **Override**: stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ignoreList, updatedAt, updatedBy }`. `null` means "use the config value". Settings equal to the config value are stored as `null`, so later config changes come through for them.
- **Effective**: the override wins per setting until you reset it. After a restart the override is applied again.

Directus reads these three env keys on every write and every request. The extension context's `env` is the same object Directus uses, so the extension changes the keys in place. The change is lost on restart, so a hook applies the stored override again at startup (`app.before`).

Custom fields on system collections such as `directus_settings` are supported by Directus 11: the schema is read from the database columns and `FieldsService` accepts the collection. Saving goes through `SettingsService`, so it appears in the activity log and revisions under the admin who saved.

## What to know

- **One process.** The change applies to the Directus process that handles the save. With several instances (pm2 cluster, several hosts), the others pick up the override on their next restart. The module warns when the running values differ from config + override.
- **The analysis undercounts.** Writes made without a user context (some Flows run with no accountability) are not logged in `directus_activity`. Batch writes count each item, but clear the cache once.
- **Databases.** The analysis runs one aggregate query on `directus_activity` with a timestamp filter. It supports Postgres (the target) and MySQL. Other databases get a 501 for the analysis; the settings still work.
- **Schema snapshots** include the `cache_manager` field on `directus_settings`. That is harmless; the field is created at startup where it is missing.
- **Saving clears the cache once**, because saving writes to `directus_settings`.

## API

All routes need an admin token.

| Route | Meaning |
|---|---|
| `GET /cache-manager/state` | Baseline, effective values, stored override, `CACHE_TTL`, `CACHE_STORE`, collections |
| `GET /cache-manager/analysis?hours=24&candidate=a,b` | Analysis; `candidate` adds a what-if value for that list |
| `POST /cache-manager/apply` | Body `{ "autoPurge": true, "skipAllowed": null, "ignoreList": ["com_videos"] }`. `null` or missing = config value. List entries must be existing collections |
| `POST /cache-manager/reset` | Remove the override and use the config values |

## Compatibility

Directus 11 and newer, up to 12.x. Written against Directus 11.17.4 (`@directus/api` 35.2.0) with Postgres.

## Development

```bash
npm install
npm test           # unit tests
npm run typecheck
npm run build
```

## License

MIT
