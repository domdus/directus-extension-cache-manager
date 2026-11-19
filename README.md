# Cache Manager

Choose which changes clear the Directus cache, right in the Data Studio. No config files, no restart. The Cache Clearing page shows how often the cache is cleared, which collections cause it, and suggests what to change.

Open **Cache Manager** from the module bar (admins only). **Status** shows the settings in use, two switches and how long answers stay in the cache. **Cache Clearing** shows what clears the cache and lets you choose which collections to ignore. Changes to an ignored collection don't clear the cache. **Settings** checks for updates, exports and imports what you saved, and removes the extension's data before you uninstall.

## Why

Directus keeps a copy of its answers, the cache, so it does not have to ask the database every time. By default, any change to any collection clears the **whole** cache. After clearing, Directus has to load everything from the database again, which is slower.

One busy collection, such as a view counter or a statistics log, can clear the cache almost every minute. Then the cache hardly helps. Finding that collection usually means searching the activity log by hand, changing the configuration and restarting Directus. This extension does the counting for you and applies your choice at once.

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

1. Open **Cache Manager → Cache Clearing** and pick a time period (last hour to last 7 days).
2. Read the first tile, **How often the cache is cleared**. Example: "12 times per hour. The cache was cleared in 296 minutes of the last 24 hours." Lower is better. If collections are already ignored, the tile also shows how often it would be cleared without them, for example "Without the ignored collections: 49 times per hour".
3. Tick collections in the **Ignore** column, or click **Ignore suggestion** in the **Suggestion** tile. The tile **Your changes** shows the effect, for example "Ignoring your choice: 3 times per hour instead of 12".
4. Optionally change the switches or how long answers stay in the cache on **Status**. Both pages share your unsaved changes. A notice lists what is not saved yet.
5. Click **Save & apply** (top right, on either page). It is used right away.

**Reset** on the Status page removes what you saved here and uses the configured values again.

### Settings page

- **Extension Updates**: checks npm for a newer version.
- **Export / Import**: downloads what you saved as a JSON file, or loads such a file. An import is checked like Save & apply (for example, every collection must exist in this project) and is used right away.
- **Remove extension data**: uses the configured values again and deletes the `cache_manager` field. Use it before uninstalling.

## The settings

| In the module | Setting name | On | Off | Recommended |
|---|---|---|---|---|
| Clear the cache when content changes | `CACHE_AUTO_PURGE` | A change to a collection that is not ignored clears the whole cache. Everyone sees changes right away | Changes never clear the cache. They show up when the cached copy expires, so editors may wait that long | On |
| Allow apps to skip the cache | `CACHE_SKIP_ALLOWED` | An app can ask for fresh data with the header `Cache-Control: no-store` | The header has no effect | On, if your Directus is not open to the public |
| Ignored collections | `CACHE_AUTO_PURGE_IGNORE_LIST` | | | Collections that change very often, and that nobody needs up to date to the second: counters, logs, statistics |
| How long answers stay in the cache | `CACHE_TTL` | A duration like `5m`, `1h` or `1d`, at most 30 days | | Between 5 minutes and a few hours. Shorter means fresher data, but more work for the database. Longer means less work for the database, but data that is not cleared can be older |

A new value for **How long answers stay in the cache** applies to new entries right away. Entries already in the cache keep their old lifetime until they expire or the cache is cleared.

**Where the cache is kept** (`CACHE_STORE`) is shown on the Status page, but can't be changed here.

Ignored collections can be served from the cache for up to that time after a change. Apps can ask for fresh data with the header `Cache-Control: no-store` when **Allow apps to skip the cache** is on. The Data Studio always loads selected collections fresh, so editors see their changes.

Don't ignore collections that decide what users may see or buy, like subscriptions, purchases or access rights. Only ignore them if the apps that read them ask for fresh data. Otherwise a user could get or lose access late.

## How the Cache Clearing page counts

- A minute counts as "cleared" when at least one collection that is not ignored changed in it. Several changes in the same minute count as one.
- **How often the cache is cleared** shows how many times per hour the cache was cleared in the chosen period (several clears in the same minute count once). Lower is better.
- **Changed in** shows, per collection, the minutes with at least one change, and how many that is per hour (for example "288 min · ~12/h").
- **Status** shows "Ignored" for collections ignored now and "Clears cache" for the others.
- **Effect if ignored** shows how much less often the cache would be cleared if you also ignored that collection. A bigger drop is better.
- The numbers come from the activity log. Some automatic changes, for example from some Flows, are not in the activity log. The real numbers can be higher.

## Suggestions

A collection is suggested for ignoring when all of these are true (limits in `src/shared/constants.ts`):

- it is not ignored yet,
- it changed at least **3 times per hour** in the chosen period,
- it is not a Directus system collection. `directus_*` collections are never suggested, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly changed by editors in the Data Studio: at most **50 %** of its changes came from logged-in users on the public address of Directus (`PUBLIC_URL`). This check needs a full address there.

## What to know

- **Several servers.** Saving changes the settings on the server that handles the save. If Directus runs on several servers, restart the others after saving. They use the saved settings when they start. The Status page warns when the settings in use don't match.
- **Saving clears the cache once**, because it writes to the project settings.
- **Databases.** The Cache Clearing page works with PostgreSQL and MySQL. On other databases it shows an error. The settings still work.
- **Browsers and proxies.** When **Clear the cache when content changes** is off, Directus also tells browsers and proxies how long they may keep an answer. It uses the value of **How long answers stay in the cache** for that, so a new value also applies there for new answers.
- **Schema snapshots** include the extra field `cache_manager` on `directus_settings`.

## For developers

### How it works

- Directus reads these settings on every change and every request (`CACHE_TTL` each time it stores a new cache entry). Extensions get the same settings object, so the extension changes the values there and they apply at once.
- **Configured** values are the ones Directus started with: from an `.env` file, a config file or environment variables. If Directus was started with `CONFIG_PATH`, the Status page shows that file.
- **Saved here** is stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ignoreList, ttl, updatedAt, updatedBy }`. `null` means "use the configured value". A value equal to the configured one is stored as `null`, so later configuration changes come through.
- These changes are lost when Directus restarts, so a hook applies the saved values again at startup (`app.before`).
- Saving goes through the settings service, so it appears in the activity log and revisions under the admin who saved.
- The Cache Clearing page uses one grouped query on `directus_activity` (creates, updates and deletes in the chosen period, per collection and minute).

### API

All routes need an admin.

| Route | Meaning |
|---|---|
| `GET /cache-manager/state` | Configured values, values in use, saved values, `CACHE_TTL`, `CACHE_STORE`, collections |
| `GET /cache-manager/analysis?hours=24&candidate=a,b` | Numbers for the Cache Clearing page; `candidate` adds a what-if value for that list |
| `POST /cache-manager/apply` | Body `{ "autoPurge": true, "skipAllowed": null, "ignoreList": ["view_counter"], "ttl": "1h" }`. `null` or missing = configured value. List entries must be existing collections |
| `POST /cache-manager/reset` | Remove the saved values and use the configured values |
| `POST /cache-manager/cleanup` | Use the configured values and delete the `cache_manager` field |

### Development

```bash
npm install
npm test           # unit tests
npm run typecheck
npm run build
```

## Uninstall

1. Open **Cache Manager → Settings → Remove extension data** first. This uses the configured values again and deletes the `cache_manager` field from `directus_settings`. Export before, if you might need the settings again.
2. Remove the extension and restart Directus.

If you skip step 1, delete the `cache_manager` field yourself in **Settings → Data Model → System Collections → Settings**. While the extension stays installed, every restart recreates an empty field.

## License

MIT
