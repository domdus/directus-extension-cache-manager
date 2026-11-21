# Cache Manager

Stop Directus from throwing away its whole cache on every change (`CACHE_AUTO_PURGE`). Cache Manager shows what clears the cache, lets you keep busy collections from clearing it, and can make a change clear **only the cached answers that use the changed collection**. Everything is set in the Data Studio. No config files, no restart.

<img alt="Cache Manager — Granular Cache" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/granular-cache.png" width="800" />

Open **Cache Manager** from the module bar (admins only). **Status** shows the settings in use, two switches and how long answers stay in the cache. **Granular Cache** makes a change clear only the cached answers that use the changed collection, and sets rules and cache lifetimes per collection. **Analysis** counts in the activity log which collections clear the cache how often, and suggests rules that never clear for the busiest ones. **Statistics** shows what each change actually cleared since Directus started. **Settings** checks for updates, exports and imports what you saved, and removes the extension's data before you uninstall.

## Why

Directus can keep a copy of its answers, the cache (`CACHE_ENABLED`), so it does not have to ask the database every time. With **Auto Purge** on (`CACHE_AUTO_PURGE`), any change to any collection clears the **whole** cache, so everyone sees changes right away. After clearing, Directus has to load everything from the database again, which is slower.

Both are off in a fresh Directus. Without `CACHE_AUTO_PURGE`, changes only show up when cached answers expire (`CACHE_TTL`, 5 minutes by default). Projects that need changes to show up right away turn it on.

One busy collection, such as a view counter or a statistics log, can clear the cache almost every minute. Then the cache hardly helps. Finding that collection usually means searching the activity log by hand, changing the configuration and restarting Directus. This extension does the counting for you and applies your choice at once.

Directus' only built-in way out is the ignore list (`CACHE_AUTO_PURGE_IGNORE_LIST`). It is all or nothing: an ignored collection never clears anything, so its own answers stay old until they expire, and every app that needs it up to date has to send `Cache-Control: no-store`. The list also keeps growing, and someone has to find out first which collections belong on it. **Granular Cache** solves the actual problem instead: a counted visit only clears the cached answers that contain visits. Pages, videos and everything else stay cached.

## Installation

Supports **Directus 9.26 through 12.x**. Tested with 9.26, 10.13, 11.7, 11.17 and 12.5.

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
2. Read the first tile, **Cache Clears**: how many times per hour the whole cache was cleared. Lower is better.
3. Select collections in the table and click **Never clear selected** (or **Clear again**), pick one with **Never clear another collection…**, or click **Apply suggested**. Each adds a rule with Create, Update and Delete off on **Granular Cache**. The **Status** column shows what Save & Apply will change ("Will keep cache", "Will clear cache"), and the tile **Your Changes** shows the effect.
4. Refine the rules on **Granular Cache**, for example Skip Fields instead of never clearing. Analysis and Granular Cache share your unsaved rules.
5. Click **Save & Apply** (✓) in the page header. It is used right away. **Discard Changes** (↶) next to it drops what you have not saved yet.

**Reset to Configured Values** on the Status page removes what you saved here and uses the configured values again.

### Settings page

- **Extension Updates**: checks npm for a newer version.
- **Export / Import**: downloads what you saved (settings and rules) as a JSON file, or loads such a file. An import is checked like Save & Apply and is used right away. An ignore list in a file from an older version becomes rules that never clear.
- **Remove extension data**: uses the configured values again and deletes the `cache_manager` field. Use it before uninstalling.

## The settings

| In the module | Setting name | On | Off | Recommended |
|---|---|---|---|---|
| Auto Purge | `CACHE_AUTO_PURGE` | A change clears the whole cache, unless its collection is ignored or its rule never clears. Everyone sees changes right away | Changes never clear the cache. They show up when the cached copy expires, so editors may wait that long | On |
| Skip Cache | `CACHE_SKIP_ALLOWED` | An app can ask for fresh data with the header `Cache-Control: no-store` | The header has no effect | On, if your Directus is not open to the public |
| Ignored collections | `CACHE_AUTO_PURGE_IGNORE_LIST` | Shown on Status, set only in the Directus configuration | | Keep it short. Use rules that never clear for anything else: they show up in Statistics and can have their own lifetime |
| Cache Lifetime | `CACHE_TTL` | A duration like `5m`, `1h` or `1d`, at most 30 days | | Between 5 minutes and a few hours. Shorter means fresher data, but more work for the database. Longer means less work for the database, but data that is not cleared can be older |

A new value for **Cache Lifetime** applies to new entries right away. Entries already in the cache keep their old lifetime until they expire or the cache is cleared.

**Cache Store** (`CACHE_STORE`) is shown on the Status page, but can't be changed here.

Collections that don't clear the cache can be served from it for up to that time after a change. Apps can ask for fresh data with the header `Cache-Control: no-store` when **Skip Cache** is on. The Data Studio always loads selected collections fresh, so editors see their changes.

Keep clearing for collections that decide what users may see or buy, like subscriptions, purchases or access rights. Only stop it if the apps that read them ask for fresh data. Otherwise a user could get or lose access late.

## Granular Cache

### What it does

A cached **answer** is one API response that Directus keeps, for example `GET /items/pages?fields=title,service.name`. With `CACHE_AUTO_PURGE` on, any change clears all of them.

On **Cache Manager → Granular Cache**, choose what a change clears:

- **Whole Cache**: how Directus clears when `CACHE_AUTO_PURGE` is on.
- **Granular**: a change clears only the answers that use the changed collection. Examples:
  - A new item in `visits` clears answers that read `visits`. Cached pages and videos stay.
  - A renamed item in `services` also clears `GET /items/pages?fields=title,service.name`, because that answer shows the service name through a relation.
  - A save that creates related items along the way (a page with a new service inside it) clears the answers of all collections it wrote.

Changes to users, roles, policies, permissions, access, settings, flows or the data model still clear everything, because they can change any answer. So do schema changes and **Clear cache** in Directus. Turning **Granular** on clears the cache once.

### Rules per collection

Add a rule for a collection to change what its changes do. Rules also work with **Whole Cache**.

| Setting | What it does | Example |
|---|---|---|
| **Create, Update, Delete** | Which changes clear the cache | Turn off Update for a collection where only new or deleted items matter |
| **Skip Fields** | A change that only touches these fields keeps the cache. Any other field still clears | `views_count` on videos: counting a view keeps the cache, a new title clears it |
| **Lifetime** | How long answers that use this collection stay cached, instead of `CACHE_TTL` | `5m` for a collection that never clears, so its answers are never older than 5 minutes; `1d` for pages that change rarely |

An answer that uses several collections stays as long as the shortest time among them. Collections without their own time count with the global one.

A rule that never clears does what the ignore list does, but often a smaller rule fits better. Never clearing `videos` because of a view counter also hides new and deleted videos until the cache expires. A rule that skips only `views_count` keeps the cache for counting views and still shows a new video right away.

With more than five rules, a filter above the table finds rules by collection or field name.

### Statistics

**Cache Manager → Statistics** shows what actually happened in this Directus process: how often the whole cache was cleared, how often only affected answers were cleared, and which changes a rule kept. The last 50 events are listed with their reason, for example "Changed in services · 3 answers cleared" or "Only views_count changed in videos · Kept (rule)". Use it to check your rules before you rely on them. The page refreshes every 15 seconds; the numbers start at zero when Directus restarts. Granular Cache links to it below the mode choice.

**Cache Size** shows how much the cache holds in memory: entries, size, expired entries still waiting, and how much the extension freed. In Granular mode it also lists the largest collections. **Last 24 Hours** shows two bar charts per hour: the changes (whole cache, granular, kept by rule) and the largest cache size in that hour. The size is measured only with `CACHE_STORE=memory`; with Redis the page says so.

### How it works

Directus has no setting or hook for this, so the extension steps in at three places at runtime. It does not patch Directus files.

1. **When Directus stores an answer**, the extension notes which collections the answer uses: the requested collection, every collection its `fields`, `filter`, `deep` and `sort` reach through relations, and the collections that the reader's read permissions filter on. Answers it can't work out (GraphQL, flow webhooks, custom endpoints, `/server`) are noted as "uses everything" and are cleared on every change, as before.
2. **When a change is saved**, the extension notes the collection, the kind of change, the fields sent, and every related item written along the way.
3. **When Directus then clears the cache**, the extension checks the rules and deletes only the answers that use the written collections. Clears that don't come from saving items (schema, permissions, settings, a manual clear) still clear everything.

An answer that was read just before a change but is stored just after it would be out of date. Directus core has this problem too. The extension drops such an answer instead of keeping it.

### Requirements

- **Restart Directus after installing or updating the extension.** Directus reloads an updated extension without a restart, but Granular Cache can only hook into the request handling at startup. The page shows a notice until the restart. Until then, a change clears the whole cache, not just its collection. Lifetimes per collection don't apply yet. Rules that keep the cache (unticked actions, Skip Fields) already work.
- **One Directus process.** The list of which answer uses which collection lives in memory. With several processes (which need Redis anyway), use **Whole Cache**. The page warns when the cache is kept in Redis.
- **Tested with Directus 9.26, 10.13, 11.7, 11.17 and 12.5** (Postgres, memory cache). Because it relies on how Directus works inside, a future version may change that. If the extension can't attach, the page says so and Directus clears the whole cache as usual.
- **Apps still need `Cache-Control: no-store`** for reads that must be up to date right away, for example access checks after a purchase.

### Performance

Measured on Directus 11.17 with Postgres and the memory cache, 24 parallel readers on 60 different list queries, while another collection was written 5 times per second (3–4 runs each, averaged):

| | Without Cache Manager | Whole Cache | Granular |
|---|---|---|---|
| Reads answered from the cache | 16 % | 13 % | **100 %** |
| Reads per second | 318 | 296 | **406** (+28 %) |
| Median read time | 75 ms | 80 ms | **57 ms** (−24 %) |

The extension's own work is within the run-to-run noise: cache hits and writes are as fast as without it, and an uncached read in Granular mode takes about 3 ms longer (working out which collections the answer uses). The gain grows with slower queries and a database on another server; this test used small tables on the same machine.

## How Analysis counts

- A minute counts as "cleared" when at least one collection changed in it that is not on the configured ignore list and whose rule doesn't never clear. Rules that keep only some changes (one action off, Skip Fields) count as clearing, because the activity log doesn't show which fields changed. Several changes in the same minute count as one.
- **How often the cache is cleared** shows how many times per hour the cache was cleared in the chosen period (several clears in the same minute count once). Lower is better.
- **Changed in** shows, per collection, the minutes with at least one change, and how many that is per hour (for example "288 min · ~12/h").
- **Status** shows "Keeps cache" for collections that never clear now (rule or configured ignore list), "Clears cache" for the others and "Not measured" for collections without activity tracking. Unsaved changes show as "Will keep cache" or "Will clear cache".
- **If never cleared** shows how much less often the cache would be cleared if that collection's rule never cleared. A bigger drop is better.
- The numbers come from the activity log. Changes that are not logged there can't be counted, but they still clear the cache:
  - Collections with **Activity & Revision Tracking** set to "Do not track anything". They are listed at the end of the table as **Not measured**, with a **Turn on tracking** button that opens the collection in the Data Model. They are left out of all numbers and suggestions, and tile 1 names them ("Not measured: 1 collection (…). The real number can be higher.").
  - Changes made by Flows that run without activity tracking. These can't be detected.
- If Directus deletes old activity (`RETENTION_ENABLED` with `ACTIVITY_RETENTION`), a time period longer than that shows less than actually happened. The page shows a warning then.

## Suggestions

A collection is suggested for a rule that never clears when all of these are true (limits in `src/shared/constants.ts`):

- it doesn't keep the cache yet,
- it changed at least **3 times per hour** in the chosen period,
- it is not a Directus system collection. `directus_*` collections are never suggested, except `directus_activity`, `directus_presets`, `directus_notifications` and `directus_revisions`,
- it is not mostly changed by editors in the Data Studio: at most **50 %** of its changes came from logged-in users on the public address of Directus (`PUBLIC_URL`). This check needs a full address there.

**In Granular mode** the numbers still assume that every change clears the whole cache, and the page says so. Skip Fields or a lifetime may then be enough for a busy collection.

**The Ignore List page of earlier versions** saved its own list. At the first start of this version, each collection it added becomes a rule that never clears, and the saved list is removed. Collections in `CACHE_AUTO_PURGE_IGNORE_LIST` stay as they are.

## What to know

- **Not everything can be counted.** Collections without activity tracking and some Flow changes are not in the activity log, and Directus may delete old activity. The Analysis page says when this affects the numbers.
- **Several servers.** Saving changes the settings on the server that handles the save. If Directus runs on several servers, restart the others after saving. They use the saved settings when they start. The Status page warns when the settings in use don't match.
- **Expired answers in memory.** With `CACHE_STORE=memory`, Directus (Keyv) deletes an expired answer only when someone asks for exactly that answer again; answers nobody asks for again stay in memory until the whole cache is cleared or Directus restarts. Frequent whole-cache clears used to hide this. With Granular mode, rules that never clear or Auto Purge off they are rare, so Cache Manager deletes expired entries itself, in every mode: it notes when each stored answer expires and, once a minute, only looks at the answers that are due (under 1 ms with 300,000 cached answers). The size for Statistics is measured in small chunks every few minutes, so Directus keeps answering requests in between. Redis removes expired entries itself.
- **Saving clears the cache once**, because it writes to the project settings.
- **Databases.** The Analysis page works with PostgreSQL and MySQL. On other databases it shows an error. The settings still work.
- **Browsers and proxies.** When **Auto Purge** is off, Directus also tells browsers and proxies how long they may keep an answer. It uses the value of **Cache Lifetime** for that, so a new value also applies there for new answers.
- **Schema snapshots** include the extra field `cache_manager` on `directus_settings`.

## For developers

### How it works

- Directus reads these settings on every change and every request (`CACHE_TTL` each time it stores a new cache entry). Extensions get the same settings object, so the extension changes the values there and they apply at once.
- **Configured** values are the ones Directus started with: from an `.env` file, a config file or environment variables. If Directus was started with `CONFIG_PATH`, the Status page shows that file.
- **Saved here** is stored in `directus_settings.cache_manager` as `{ autoPurge, skipAllowed, ttl, updatedAt, updatedBy, rules }`. `null` means "use the configured value". A value equal to the configured one is stored as `null`, so later configuration changes come through.
- These changes are lost when Directus restarts, so a hook applies the saved values again at startup (`app.before`).
- Saving goes through the settings service, so it appears in the activity log and revisions under the admin who saved.
- The Analysis page uses one grouped query on `directus_activity` (creates, updates and deletes in the chosen period, per collection and minute).
- Granular Cache (`src/api/targeted.ts`):
  - The hook wraps the write methods of `ItemsService` (`createOne`, `createMany`, `updateBatch`, `updateMany`, `upsertMany`, `deleteMany`) and keeps the collection, action and fields of each write and its nested writes in an `AsyncLocalStorage` context. Nested writes are recorded on the parent because Directus tells many of them not to clear (`autoPurgeCache: false`) and relies on the parent clearing everything.
  - It wraps `clear()` and `set()` of the shared response cache (Keyv). `clear()` inside a write applies the rules and deletes only the indexed keys of the written collections; outside a write it clears everything. Activity and revision records written during a save never cause a clear on their own.
  - A middleware after Directus' cache check (`init('middlewares.after')`) works out what the answer depends on (`src/shared/dependencies.ts`) and its lifetime, which `set()` applies (also on Directus versions that ignore `res.locals.cacheTTL`).
  - A clear counter per collection protects against storing an answer that was read before a change.

### API

All routes need an admin.

| Route | Meaning |
|---|---|
| `GET /cache-manager/state` | Configured values, values in use, saved values, `CACHE_TTL`, `CACHE_STORE`, collections |
| `GET /cache-manager/analysis?hours=24&candidate=a,b` | Numbers for the Analysis page (rules that never clear count as ignored); `candidate` adds a what-if value for that list |
| `POST /cache-manager/apply` | Body `{ "autoPurge": true, "skipAllowed": null, "ttl": "1h" }`. `null` or missing = configured value. `ignoreList` is refused: add a rule that never clears |
| `POST /cache-manager/reset` | Remove the saved values and use the configured values |
| `POST /cache-manager/cleanup` | Use the configured values, the default Granular Cache rules, and delete the `cache_manager` field |
| `GET /cache-manager/rules` | Granular Cache rules, what happened since start, collections and fields |
| `POST /cache-manager/rules` | Body `{ "targeted": true, "collections": { "com_videos": { "update": true, "skipFields": ["views_count"], "ttl": "10m" } } }`. Missing values = default (clear on create, update and delete; global lifetime) |

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
