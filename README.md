# Cache Manager

Control how Directus clears its response cache while it runs: set `CACHE_AUTO_PURGE_IGNORE_LIST`, `CACHE_AUTO_PURGE` and `CACHE_SKIP_ALLOWED` from a module, without editing configuration or restarting. An analysis shows which collections clear the cache, and how often, and recommends which ones to ignore.

Open **Cache Manager** from the module bar (admins only). **Status** shows the values in effect and the purge toggles. **Analysis** shows the collections that clear the cache and lets you pick the ignore list.

## Why

With `CACHE_AUTO_PURGE` on, every write to a collection that is not in the ignore list clears the **whole** response cache. One busy collection, such as a view counter or an analytics log, can clear it almost every minute, so the cache rarely gets to serve a response.

Finding that collection usually means querying the activity log by hand, editing the configuration and restarting Directus, then checking again. This extension does the counting for you and applies a new ignore list at once.

## Installation

Supports **Directus 11 through 12.x**.

### npm

```bash
npm install directus-extension-cache-manager
```

Place the package in your Directus `extensions` folder (or install into a project that loads extensions from `node_modules`), then restart Directus.

### Manual installation

1. Install and build:

```bash
cd directus-extension-cache-manager
npm install
npm run build
```

2. Copy the built package into your Directus `extensions` folder (include `package.json` and the `dist` folder).

3. Restart Directus. At startup the extension adds a hidden JSON field `cache_manager` to `directus_settings`.

4. In the Data Studio:

   1. Open **Settings → Project Settings → Modules**
   2. Enable **Cache Manager**
   3. Open **Cache Manager** from the left bar

## Configure

1. Open **Cache Manager → Analysis** and pick a time window (1 hour to 7 days).
2. Tick the collections to ignore, or click **Select recommended**. The tile **After saving your selection** shows how many minutes with a full purge would remain.
3. Optionally change the toggles on **Status**. Both pages edit the same selection, and a notice lists what is not saved yet.
4. Click **Save & apply** (top right, on either page). The next writes and requests use the new values.

**Reset** on the Status page removes the override and uses the configured values again.

## The settings

| Setting | On | Off | Recommended |
|---|---|---|---|
| `CACHE_AUTO_PURGE` | Every write to a collection that is not ignored clears the whole response cache | Nothing is cleared on writes. Data refreshes only after `CACHE_TTL`, so editors' changes take up to `CACHE_TTL` to appear | On |
| `CACHE_SKIP_ALLOWED` | Clients can bypass the cache for one request with `Cache-Control: no-store`. Apps need this to read ignored collections fresh | The header is ignored | On, for a Directus that is not open to the public |
| `CACHE_AUTO_PURGE_IGNORE_LIST` | Writes to these collections do not clear the cache | | Write-heavy collections that apps do not read through the cache, or read with `no-store` |

Do not ignore collections that apps read for access decisions (subscriptions, purchases, entitlements), unless those reads send `Cache-Control: no-store`. Otherwise a user can get or lose access up to `CACHE_TTL` late.

Reads of an ignored collection can be up to `CACHE_TTL` old for apps, unless they send `Cache-Control: no-store`, which only works with `CACHE_SKIP_ALLOWED` on. The Data Studio always bypasses the cache for ignored collections. `CACHE_TTL` and `CACHE_STORE` are shown, but not changed.

## Recommendations

A collection is recommended when all of these are true (constants in `src/shared/constants.ts`):

- it is not ignored yet,
- it was written in at least **5 %** of the minutes in the window,
- it is not a system collection. `directus_*` collections are never recommended, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly edited in the Data Studio: at most **50 %** of its writes came from logged-in users whose request origin was `PUBLIC_URL`. This check needs an absolute `PUBLIC_URL`.

**Purge minutes saved** in the table is the number of minutes that would no longer have a full purge if you also ignored that collection.

## How it works

Directus reads these three values from its env object on every write and every request. Extensions receive that same object, so the extension changes the values in place and they take effect at once.

- **Configured**: the values Directus started with, from its configuration (`.env`, config file or environment variables). When Directus was started with `CONFIG_PATH`, the Status page shows that file.
- **Override**: stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ignoreList, updatedAt, updatedBy }`. `null` means "use the configured value". A setting equal to the configured value is stored as `null`, so later configuration changes come through for it.
- **In effect**: the override wins per setting until you reset it. Changes to env are lost on restart, so a hook applies the saved override again at startup (`app.before`).

Saving goes through Directus' settings service, so each save appears in the activity log and revisions under the admin who saved.

The analysis is one aggregate query on `directus_activity` (creates, updates and deletes since the start of the window, grouped by collection and minute).

## What to know

- **One process.** A save changes the Directus process that handles it. With several instances, restart the others after saving; they apply the override at startup. The Status page warns when the running values differ from the configured values plus the override.
- **The analysis can undercount.** Writes made without a user context (some Flows run with no accountability) are not logged in `directus_activity`. Batch writes count every item, but clear the cache once.
- **Databases.** The analysis supports Postgres and MySQL. On other databases it returns an error; the settings still work.
- **Saving clears the cache once**, because it writes to `directus_settings`.
- **Schema snapshots** include the `cache_manager` field on `directus_settings`.

## API

All routes need an admin.

| Route | Meaning |
|---|---|
| `GET /cache-manager/state` | Configured values, values in effect, saved override, `CACHE_TTL`, `CACHE_STORE`, collections |
| `GET /cache-manager/analysis?hours=24&candidate=a,b` | Analysis; `candidate` adds a what-if value for that list |
| `POST /cache-manager/apply` | Body `{ "autoPurge": true, "skipAllowed": null, "ignoreList": ["view_counter"] }`. `null` or missing = configured value. List entries must be existing collections |
| `POST /cache-manager/reset` | Remove the override and use the configured values |

## Development

```bash
npm install
npm test           # unit tests
npm run typecheck
npm run build
```

## Uninstall

Click **Reset** on the Status page, remove the extension, then delete the `cache_manager` field from `directus_settings` (**Settings → Data Model → System Collections → Settings**).

## License

MIT
