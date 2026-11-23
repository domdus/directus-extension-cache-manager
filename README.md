# Cache Manager

With **Auto Purge** on, Directus throws away its whole cache on every change. One busy collection, such as a visit log or a view counter, can keep the cache nearly empty. Cache Manager makes a change clear **only the cached responses that use the changed collection**, and shows what clears the cache and how often. Everything is set in the Data Studio.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/benchmark-dark.png" />
  <img alt="Directus vs. Directus + Cache Manager: twice the reads per second, half the read time, 98 % fewer database queries" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/benchmark-light.png" width="720" />
</picture>

Measured on a website-like setup, see [Performance](#performance).

## Features

- **Granular Cache**: a change clears only the cached responses that use the changed collection, including through relations. Works for REST and GraphQL.
- **Clear single items** (advanced): a change to one item keeps the cached single-item responses of all other items.
- **Rules per collection**: choose which changes clear, ignore fields like a view counter, and set a lifetime per collection.
- **Analysis**: which collections cleared the whole cache how often, with suggestions.
- **Statistics**: what each change cleared, the cache size and the last 24 hours.
- **Cache settings in the Data Studio**: Auto Purge, Skip Cache and the cache lifetime, applied without a restart.
- **Several Directus servers**: with a Redis cache, all servers share what to clear and pick up saved settings.
- **Export and import** of all settings.

## Quick Start

After [installing](#installation), open **Cache Manager** from the module bar (admins only):

1. **Status**: turn on **Auto Purge** and click **Save & Apply** (✓).
2. **Granular Cache**: choose **Granular** and click **Save & Apply** (✓).

That's all. Every change now clears only the cached responses that use the changed collection. After a day, **Analysis** shows whether a busy collection still clears a lot.

## Installation

Directus 9.26 to 12.x (tested with 9.26, 10.13, 11.7, 11.17 and 12.5).

**Marketplace:** search for **Cache Manager** in **Settings → Marketplace**. The extension has API parts, which some Directus setups don't allow from the Marketplace. Then install it manually.

**Manual:** run `npm install directus-extension-cache-manager`, copy `package.json` and the `dist` folder into `extensions/directus-extension-cache-manager` of your Directus, and restart Directus.

Then enable **Cache Manager** in **Settings → Project Settings → Modules**.

**Restart Directus after every install or update.** Granular Cache only starts with Directus; until then, the page shows a notice.

## Granular Cache

<img alt="Cache Manager — Granular Cache" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/granular-cache.png" width="800" />

- **Global**: how Directus does it. Every change clears every cached response.
- **Granular**: a change clears only the cached responses that use the changed collection. For example:
  - A new visit clears cached responses that show visits. Pages and videos stay cached.
  - A renamed service also clears the page list that shows service names.

Changes to users, roles, permissions, settings, flows or the data model still clear everything, because they can change any response. Switching to Granular clears the cache once.

### Clear single items (advanced)

With this on, a change to page 5 only clears the single-item responses of page 5, such as `/items/pages/5` or GraphQL `pages_by_id` (GraphQL works this way on newer Directus versions, tested on 11.17 and 12.5; on older ones it clears with the collection). Single-item responses of other pages stay; lists of pages still clear. It helps when a collection is read item by item and its items change often, such as stock or prices. See [Performance](#clear-single-items).

### Rules per collection

Most projects need no rules. Add one for a collection that changes very often:

| Setting | What it does | Example |
|---|---|---|
| **Create, Update, Delete** | Which changes clear. All off: changes never clear | Turn off Update where only new or deleted items matter |
| **Skip Fields** | A change that only touches these fields keeps the cache | `views_count`: counting a view keeps the cache, a new title clears it |
| **Lifetime** | How long responses that use this collection stay cached | `5m` for a collection that never clears, `1d` for pages that rarely change |

Prefer a small rule over "never clear". Never clearing `videos` because of a view counter also hides new videos until the cache expires. Skip Fields `views_count` still shows them right away.

## Analysis

<img alt="Cache Manager — Analysis" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/analysis.png" width="800" />

Reads the Directus activity log and shows, for the last hour up to the last 7 days, how often changes cleared the whole cache and which collections caused it.

- **Suggested**: collections that change at least 3 times per hour, mostly not by editors. **Apply Suggested** adds a rule that never clears for them.
- **Check impact** marks names like subscriptions, payments or access, which apps may need up to date.
- Select collections and click **Never Clear Selected**, or **Clear Again** to undo.

Collections with activity tracking turned off (**Not measured**) and some Flows can't be counted. Works with PostgreSQL and MySQL.

## Statistics

<img alt="Cache Manager — Statistics" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/statistics.png" width="800" />

What happened since Directus started: global cache clears, granular clears, changes a rule kept, and the latest events with their reason. With the cache in memory, also the cache size, the largest collections and charts for the last 24 hours. The numbers reset when Directus restarts.

## Settings on Status

| Setting | What it does | Recommended |
|---|---|---|
| **Auto Purge** | On: changes clear the cache, so everyone sees them right away. Off: changes only show once cached responses expire | On |
| **Skip Cache** | Lets an app ask for a fresh response with the header `Cache-Control: no-store` | On, unless your Directus is open to the public |
| **Cache Lifetime** | How long cached responses stay if nothing clears them, e.g. `5m`, `1h` or `1d` | 5 minutes to a few hours |
| **Ignored Collections** | Collections from the Directus configuration that never clear the cache. Shown only; use rules instead | Keep it short |

Saved settings apply right away and survive a restart. **Reset to Configured Values** goes back to your Directus configuration.

## Good to Know

- **Apps that need fresh data** right away, e.g. an access check after a purchase, can send `Cache-Control: no-store` (with **Skip Cache** on).
- **Several Directus servers** need the cache in Redis. Cache Manager then keeps its notes there too: a change on any server clears what any server cached, and saved settings reach all servers within about 10 seconds. Statistics count per server.
- **Saving clears the cache once**, because it writes to the project settings.
- **Expired responses in memory**: Directus only deletes an expired response when it is requested again. Cache Manager deletes them about once a minute, so the cache doesn't fill up with them. Not needed with Redis.
- **If a future Directus version doesn't fit**, the page says so and Directus clears the whole cache as usual.
- **Responses Cache Manager can't trace**, such as GraphQL `server_info` or custom endpoints, are cleared on every change, as in Directus.
- **Earlier versions** had an Ignore List page. Its entries become rules that never clear on the first start.

## Performance

Directus 11.17 with Postgres and the cache in memory, on a website-like setup: 2,000 pages, each with a category, an author and 3 tags. 24 readers request category lists and page details (62 different requests) for 30 seconds, while 5 to 10 visits per second are saved in their own collection. Both with Auto Purge on; Cache Manager in Granular mode without rules. Average of two runs.

| | Directus | Directus + Cache Manager | Difference |
|---|---|---|---|
| Reads from the cache | under 1 % | **100 %** | |
| Reads per second | 215 | **429** | **+100 %** |
| Median read time | 112 ms | **54 ms** | **−52 %** |
| Database queries | 31,422 | **762** | **−98 %** |
| Database CPU time | 8.7 s | **0.6 s** | **−93 %** |

If visits are counted in a field on the pages (`views_count`), add the rule Skip Fields `views_count`. The results are then the same.

### Two Directus servers with Redis

The same setup on two Directus servers sharing one Redis cache, with visits saved on the second one.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/benchmark-redis-dark.png" />
  <img alt="Two Directus servers with Redis: 82 % more reads per second, 98 % fewer database queries" src="https://raw.githubusercontent.com/domdus/directus-extension-cache-manager/main/docs/benchmark-redis-light.png" width="720" />
</picture>

| | Directus | Directus + Cache Manager | Difference |
|---|---|---|---|
| Reads per second | 359 | **654** | **+82 %** |
| Median read time | 55 ms | **35 ms** | **−36 %** |
| Database queries | 50,248 | **877** | **−98 %** |
| Database CPU time | 12.4 s | **0.7 s** | **−94 %** |

### Clear single items

The same setup, but instead of visits, random pages get a new title. Every change hits the pages collection, so Granular alone can't keep more than Directus does. With **Clear single items**, a change only clears that page's single-item response and the page lists.

| 10 title changes per second | Directus | Granular | Granular + single items |
|---|---|---|---|
| Reads from the cache | 1 % | 4 % | **68 %** |
| Reads per second | 210 | 206 | **304 (+45 %)** |
| Database queries | 30,985 | 30,253 | **15,272 (−51 %)** |
| Database CPU time | 8.7 s | 8.3 s | **5.0 s (−43 %)** |

| 1 title change per second | Directus | Granular | Granular + single items |
|---|---|---|---|
| Reads from the cache | 84 % | 84 % | **95 %** |
| Reads per second | 377 | 380 | **402 (+7 %)** |
| Database queries | 9,324 | 9,283 | **3,459 (−63 %)** |
| Database CPU time | 2.8 s | 2.8 s | **1.4 s (−50 %)** |

At 10 changes per second, each change took a little longer (more cached responses to sort through), and the slowest 5 % of reads were about 10 % slower.

### Overhead

Reads from the cache and saves are as fast as without Cache Manager. A read that isn't cached takes about 3 ms longer in Granular mode, a little more with Redis. The gain grows with slower queries and a database on another server; these tests ran on one machine.

## Uninstall

1. **Cache Manager → Settings → Remove Extension Data**. This restores the configured values and deletes the extension's field. Export first if you may need your settings again.
2. Remove the extension and restart Directus.

If you skip step 1, delete the field `cache_manager` in **Settings → Data Model → System Collections → Settings**.

## License

MIT
