# Cache Manager

Stop Directus from throwing away its whole cache on every change. Cache Manager shows what clears the cache and can make a change clear **only the cached responses that use the changed collection**. Everything is set in the Data Studio. No config files.

<img alt="Cache Manager — Granular Cache" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/granular-cache.png" width="800" />

Open **Cache Manager** from the module bar (admins only):

- **Status**: the cache settings in use, with switches and the cache lifetime.
- **Granular Cache**: choose what a change clears, and add rules for single collections.
- **Analysis**: which collections clear the cache how often, with suggestions.
- **Statistics**: what each change actually cleared, and how big the cache is.
- **Settings**: updates, export and import, and removing the extension's data.

## Quick Start

After installing (see below):

1. **Status**: turn on **Auto Purge** and click **Save & Apply** (✓) at the top.
2. **Granular Cache**: choose **Granular** and click **Save & Apply** (✓).

That's all. Without a single rule, every change already clears only the cached responses that use the changed collection, including responses that reach it through relations. All other cached responses stay.

Later, if you like: after a day, open **Analysis** to see if a few busy collections still clear a lot, and **Statistics** to see what was cleared.

## Why

Directus can keep a copy of its responses, the cache, so it does not have to ask the database every time. With **Auto Purge** on, any change to any collection clears the **whole** cache, so everyone sees changes right away. After clearing, Directus has to load everything from the database again, which is slower.

One busy collection, such as a view counter or a statistics log, can then clear the cache almost every minute, and the cache hardly helps. Directus' only built-in way out is an ignore list in its configuration: an ignored collection never clears anything, so its own cached responses stay old until they expire.

**Granular Cache** solves the actual problem: a counted visit only clears the cached responses that contain visits. Pages, videos and everything else stay cached.

## Installation

Supports **Directus 9.26 through 12.x**. Tested with 9.26, 10.13, 11.7, 11.17 and 12.5. Admins only.

### Marketplace

Search for **Cache Manager** in **Settings → Marketplace**. This extension includes an API part, so some Directus setups only allow app extensions from the Marketplace. If the install is blocked, use npm or the manual steps below.

### npm

```bash
npm install directus-extension-cache-manager
```

Put the package in your Directus `extensions` folder (or install it in a project that loads extensions from `node_modules`), then restart Directus.

### Manual installation

```bash
cd directus-extension-cache-manager
npm install
npm run build
```

Copy the built package into your Directus `extensions` folder (`package.json` and the `dist` folder) and restart Directus.

### Then

1. Open **Settings → Project Settings → Modules** and enable **Cache Manager**.
2. Open **Cache Manager** from the left bar and follow the **Quick Start** above.

**Restart Directus after every install or update of the extension.** Granular Cache only starts with Directus; until the restart, the page shows a notice.

## Granular Cache

A **cached response** is one API response Directus keeps, for example the list of pages with their service names.

Choose what a change clears:

- **Whole Cache**: how Directus does it. Every change clears every cached response.
- **Granular**: a change clears only the cached responses that use the changed collection. Examples:
  - A new visit clears cached responses that show visits. Cached pages and videos stay.
  - A renamed service also clears the page list that shows service names.
  - Saving a page together with a new service clears the cached responses of both.

Changes to users, roles, permissions, settings, flows or the data model still clear everything, because they can change any cached response. Turning **Granular** on clears the cache once.

### Rules per collection

Most projects need no rules. Add one for a collection that changes very often:

| Setting | What it does | Example |
|---|---|---|
| **Create, Update, Delete** | Which changes clear the cache. All off: changes never clear | Turn off Update where only new or deleted items matter |
| **Skip Fields** | A change that only touches these fields keeps the cache | `views_count` on videos: counting a view keeps the cache, a new title clears it |
| **Lifetime** | How long responses that use this collection stay cached | `5m` for a collection that never clears; `1d` for pages that change rarely |

Prefer a small rule over "never clear": never clearing `videos` because of a view counter also hides new videos until the cache expires, while Skip Fields `views_count` still shows them right away.

## Analysis

**Analysis** reads the activity log of Directus and shows, for a time period (last hour to last 7 days), how often changes cleared the whole cache and which collections caused it, the busiest first.

- **Cache Clears**: how many times per hour the whole cache was cleared. Lower is better.
- **Suggested**: collections that change at least 3 times per hour and are not mostly changed by editors. **Apply suggested** adds a rule that never clears for them.
- **Check impact** marks names like subscriptions, payments or access: apps may rely on them being up to date.
- Select collections and click **Never clear selected**, or **Clear again** to undo. Then **Save & Apply** (✓).

Changes that are not in the activity log can't be counted: collections with activity tracking turned off (shown as **Not measured**) and some Flows. The page says when this affects the numbers. Analysis works with PostgreSQL and MySQL.

## Statistics

**Statistics** shows what happened since Directus started: how often the whole cache was cleared, how often only some cached responses were cleared, which changes a rule kept, and the last 50 events with their reason. With the cache kept in memory it also shows the cache size, the largest collections, and two charts for the last 24 hours. The numbers start at zero when Directus restarts.

## The Settings on Status

| Setting | What it does | Recommended |
|---|---|---|
| **Auto Purge** | On: changes clear the cache, so everyone sees them right away. Off: changes only show up when cached responses expire | On |
| **Skip Cache** | Lets an app ask for a fresh response with the header `Cache-Control: no-store` | On, unless your Directus is open to the public |
| **Cache Lifetime** | How long cached responses stay if nothing clears them first, for example `5m`, `1h` or `1d` | Between 5 minutes and a few hours |
| **Ignored Collections** | Collections from the Directus configuration whose changes never clear the cache. Shown only; use rules instead | Keep it short |

What you save applies right away and stays after a restart. **Reset to Configured Values** goes back to the values from your Directus configuration.

## Good to Know

- **Apps that need fresh data** right away, for example an access check after a purchase, should send `Cache-Control: no-store` for that request. **Skip Cache** must be on.
- **One Directus server.** Granular Cache keeps its notes in memory. If Directus runs on several servers (with Redis), use **Whole Cache**, and restart the other servers after saving.
- **Saving clears the cache once**, because it writes to the project settings.
- **Expired responses in memory.** With the cache kept in memory, Directus only deletes an expired cached response when someone asks for exactly that response again; responses nobody asks for again would stay until the whole cache is cleared or Directus restarts. Granular mode makes whole-cache clears rare, so Cache Manager deletes expired responses itself, about once a minute, without slowing Directus down. With Redis this is not needed.
- **If Directus changes.** Granular Cache relies on how Directus works inside. If a future version doesn't fit, the page says so and Directus clears the whole cache as usual.
- **Earlier versions** had an Ignore List page with its own saved list. Its entries are turned into rules that never clear at the first start of this version.

## Performance

Measured on Directus 11.17 with Postgres and the cache in memory: 24 parallel readers on 60 different lists, while another collection was changed 5 times per second (3–4 runs each, averaged):

| | Without Cache Manager | Whole Cache | Granular |
|---|---|---|---|
| Reads answered from the cache | 16 % | 13 % | **100 %** |
| Reads per second | 318 | 296 | **406** (+28 %) |
| Median read time | 75 ms | 80 ms | **57 ms** (−24 %) |

Cache Manager's own work is within the run-to-run noise: cached reads and saves are as fast as without it, and a read that is not cached takes about 3 ms longer in Granular mode. The gain grows with slower queries and a database on another server; this test used small tables on the same machine.

## Uninstall

1. Open **Cache Manager → Settings → Remove Extension Data** first. This goes back to the configured values and deletes the extension's field. Export first if you might need your settings again.
2. Remove the extension and restart Directus.

If you skip step 1, delete the field `cache_manager` yourself in **Settings → Data Model → System Collections → Settings**.

## License

MIT
