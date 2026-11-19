# Cache Manager

Control when Directus empties its cache, while it runs and without a restart. An analysis shows which collections empty the cache, how much of the time the cache is empty, and suggests which collections should stop emptying it.

It manages three Directus settings: `CACHE_AUTO_PURGE`, `CACHE_SKIP_ALLOWED` and `CACHE_AUTO_PURGE_IGNORE_LIST`.

Open **Cache Manager** from the module bar (admins only). **Status** shows the values in effect and the on/off switches. **Analysis** shows which collections empty the cache and lets you choose the ones that should not.

## Why

Directus keeps answers in a cache so it does not have to read the database every time. By default, any change to any collection empties the **whole** cache. While the cache is empty, Directus has to build every answer from the database again, which is slower.

One busy collection, such as a view counter or a statistics log, can empty the cache almost every minute, so the cache hardly helps. Finding that collection usually means querying the activity log by hand, editing the configuration and restarting Directus. This extension does the counting for you and applies the change at once.

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

1. Open **Cache Manager → Analysis** and pick a time window (1 hour to 7 days). The first tile shows how much of that time the cache was empty.
2. Tick the collections whose changes should not empty the cache, or click **Select suggestion** in the Suggestion tile. The tile **With your selection** shows how much of the time the cache would be empty then.
3. Optionally change the switches on **Status**. Both pages edit the same selection, and a notice lists what is not saved yet.
4. Click **Save & apply** (top right, on either page). It takes effect at once.

**Reset** on the Status page removes the override and uses the configured values again.

## The settings

| In the module | Setting | On | Off | Recommended |
|---|---|---|---|---|
| Empty the cache when content changes | `CACHE_AUTO_PURGE` | Any change to a collection that is not selected empties the whole cache, so everyone sees changes right away | Nothing empties the cache. Changes appear only when cached answers expire after `CACHE_TTL`, so editors may wait that long | On |
| Allow apps to skip the cache | `CACHE_SKIP_ALLOWED` | An app can ask for fresh data with the header `Cache-Control: no-store` | The header has no effect | On, for a Directus that is not open to the public |
| Collections whose changes don't empty the cache | `CACHE_AUTO_PURGE_IGNORE_LIST` | | | Collections that change very often and that nobody needs up to date to the second: counters, logs, statistics |

Selected collections can be served from the cache for up to `CACHE_TTL` after a change. Apps can ask for fresh data with `Cache-Control: no-store` when **Allow apps to skip the cache** is on. The Data Studio always reads selected collections fresh. The Status page shows the real `CACHE_TTL` and `CACHE_STORE`, but does not change them.

Do not select collections that decide what users may see or buy (subscriptions, purchases, access rights), unless the apps reading them ask for fresh data. Otherwise a user can get or lose access up to `CACHE_TTL` late.

## Suggestions

A collection is suggested when all of these are true (constants in `src/shared/constants.ts`):

- it is not selected yet,
- it changed in at least **5 %** of the minutes in the time window,
- it is not a Directus system collection. `directus_*` collections are never suggested, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly edited by people in the Data Studio: at most **50 %** of its changes came from logged-in users whose request origin was `PUBLIC_URL`. This check needs a full `PUBLIC_URL`.

The analysis counts in minutes: a minute counts as "cache emptied" when at least one change to a collection that is not selected happened in it. Several changes in the same minute count once. **Effect if selected** in the table is how much less of the time the cache would be emptied if you also selected that collection.

## How it works

Directus reads these three values from its env object on every write and every request. Extensions receive that same object, so the extension changes the values in place and they take effect at once.

- **Configured**: the values Directus started with, from its configuration (`.env`, config file or environment variables). When Directus was started with `CONFIG_PATH`, the Status page shows that file.
- **Override**: stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ignoreList, updatedAt, updatedBy }`. `null` means "use the configured value". A setting equal to the configured value is stored as `null`, so later configuration changes come through for it.
- **In effect**: the override wins per setting until you reset it. Changes to env are lost on restart, so a hook applies the saved override again at startup (`app.before`).

Saving goes through Directus' settings service, so each save appears in the activity log and revisions under the admin who saved.

The analysis is one aggregate query on `directus_activity` (creates, updates and deletes since the start of the window, grouped by collection and minute).

## What to know

- **One process.** A save changes the Directus process that handles it. With several instances, restart the others after saving; they apply the override at startup. The Status page warns when the running values differ from the configured values plus the override.
- **The analysis can undercount.** Changes made without a user context (some Flows run with no accountability) are not in the activity log (`directus_activity`), so the real numbers can be higher.
- **Databases.** The analysis supports Postgres and MySQL. On other databases it returns an error; the settings still work.
- **Saving empties the cache once**, because it writes to `directus_settings`.
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
