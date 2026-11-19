# Cache Manager

Choose which changes clear the Directus cache, right in the Data Studio. No config files, no restart. The Analysis page shows how often the cache is cleared, which collections cause it, and suggests what to change.

Open **Cache Manager** from the module bar (admins only). **Status** shows the settings in use and two switches. **Analysis** shows which collections clear the cache and lets you choose the ones that shouldn't.

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

1. Open **Cache Manager → Analysis** and pick a time period (last hour to last 7 days).
2. Read the first tile, **How often the cache is cleared**. Example: "21 % of all minutes. The cache was cleared in 296 minutes of the last 24 hours (about 12 minutes per hour)." Lower is better.
3. Tick the collections whose changes should not clear the cache, or click **Select suggestion** in the **Suggestion** tile. The tile **With your selection** shows the new value, for example "about 1 minute per hour instead of 12".
4. Optionally change the switches on **Status**. Both pages share one selection. A notice lists what is not saved yet.
5. Click **Save & apply** (top right, on either page). It is used right away.

**Reset** on the Status page removes what you saved here and uses the configured values again.

## The settings

| In the module | Setting name | On | Off | Recommended |
|---|---|---|---|---|
| Clear the cache when content changes | `CACHE_AUTO_PURGE` | A change to a collection that is not selected clears the whole cache. Everyone sees changes right away | Changes never clear the cache. They show up when the cached copy expires, so editors may wait that long | On |
| Allow apps to skip the cache | `CACHE_SKIP_ALLOWED` | An app can ask for fresh data with the header `Cache-Control: no-store` | The header has no effect | On, if your Directus is not open to the public |
| Collections whose changes don't clear the cache | `CACHE_AUTO_PURGE_IGNORE_LIST` | | | Collections that change very often, and that nobody needs up to date to the second: counters, logs, statistics |

**How long answers stay in the cache** (`CACHE_TTL`) and **Where the cache is kept** (`CACHE_STORE`) are shown on the Status page, but can't be changed here.

Selected collections can be served from the cache for up to that time after a change. Apps can ask for fresh data with the header `Cache-Control: no-store` when **Allow apps to skip the cache** is on. The Data Studio always loads selected collections fresh, so editors see their changes.

Don't select collections that decide what users may see or buy, like subscriptions, purchases or access rights. Only select them if the apps that read them ask for fresh data. Otherwise a user could get or lose access late.

## How the analysis counts

- A minute counts as "cleared" when at least one collection that is not selected changed in it. Several changes in the same minute count as one.
- **How often the cache is cleared** is the share of all minutes in the chosen period. Lower is better.
- **Changed in** shows, per collection, the minutes with at least one change, and how many that is per hour (for example "288 min · ~12/h").
- **Effect if selected** shows how much less often the cache would be cleared if you also select that collection. A bigger drop is better.
- The numbers come from the activity log. Some automatic changes, for example from some Flows, are not in the activity log. The real numbers can be higher.

## Suggestions

A collection is suggested when all of these are true (limits in `src/shared/constants.ts`):

- it is not selected yet,
- it changed in at least **5 %** of all minutes in the chosen period,
- it is not a Directus system collection. `directus_*` collections are never suggested, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly changed by editors in the Data Studio: at most **50 %** of its changes came from logged-in users on the public address of Directus (`PUBLIC_URL`). This check needs a full address there.

## What to know

- **Several servers.** Saving changes the settings on the server that handles the save. If Directus runs on several servers, restart the others after saving. They use the saved settings when they start. The Status page warns when the settings in use don't match.
- **Saving clears the cache once**, because it writes to the project settings.
- **Databases.** The analysis works with PostgreSQL and MySQL. On other databases the analysis shows an error. The settings still work.
- **Schema snapshots** include the extra field `cache_manager` on `directus_settings`.

## For developers

### How it works

- Directus reads the three settings on every change and every request. Extensions get the same settings object, so the extension changes the values there and they apply at once.
- **Configured** values are the ones Directus started with: from an `.env` file, a config file or environment variables. If Directus was started with `CONFIG_PATH`, the Status page shows that file.
- **Saved here** is stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ignoreList, updatedAt, updatedBy }`. `null` means "use the configured value". A value equal to the configured one is stored as `null`, so later configuration changes come through.
- These changes are lost when Directus restarts, so a hook applies the saved values again at startup (`app.before`).
- Saving goes through the settings service, so it appears in the activity log and revisions under the admin who saved.
- The analysis is one grouped query on `directus_activity` (creates, updates and deletes in the chosen period, per collection and minute).

### API

All routes need an admin.

| Route | Meaning |
|---|---|
| `GET /cache-manager/state` | Configured values, values in use, saved values, `CACHE_TTL`, `CACHE_STORE`, collections |
| `GET /cache-manager/analysis?hours=24&candidate=a,b` | Analysis; `candidate` adds a what-if value for that list |
| `POST /cache-manager/apply` | Body `{ "autoPurge": true, "skipAllowed": null, "ignoreList": ["view_counter"] }`. `null` or missing = configured value. List entries must be existing collections |
| `POST /cache-manager/reset` | Remove the saved values and use the configured values |

### Development

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
