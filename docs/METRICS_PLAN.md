# Metrics — plan for 2026-07-22

**Goal.** Give authors a clear view of how their folios are performing, and
give Jacob a clear view of how the platform is performing. Ship an MVP
tomorrow that's useful on day one, and lay foundations for real analytics
later without rework.

---

## What we already have (free wins)

We're already writing more data than we're reading. First step tomorrow is
just surfacing what's there.

| Existing collection / field | Metric it feeds |
|---|---|
| `folio_projects/{id}.viewCount` (incremented by paywall worker `/view-record`) | Total views per folio |
| `folio_projects/{id}/subscribers/*` | Newsletter subscribers per folio |
| `folio_projects/{id}/annotations/*` | Highlights + comments per folio |
| `folio_projects/{id}/presence/*` | Live/recent readers per folio |
| `reviews/{id}` (filterable by `folioId`) | Review count + avg rating |
| `folio_projects/{id}.release.featuredUntil` | Currently boosted? (yes/no) |
| `folio_user_settings/{uid}.pressSubscription` | Author's own plan + comp status |
| `folio_photo_purchases/{captureId}` | Photo template sales |
| `folio_projects/{id}/versions/*` | Author's own edit velocity |

None of this needs new infra to show — just new UI + a couple of aggregate
reads.

---

## Tier gating (baked in from day one)

The pricing page at `/press/` already commits us to specific analytics
per tier. The gate is binary — the "Metrics" tab renders differently
based on `pressSubscription.status === 'ACTIVE' && tier in {indie, imprint}`:

| Tier | Metrics they see |
|---|---|
| **Free** | View count line item per folio + upsell chip pointing to
Indie / Imprint. Not a dashboard — one number and an unlock CTA. |
| **Indie** | Total views + subscribers + reviews + annotations, **30-day
sparkline**, **per-chapter drop-off chart**. The "am I keeping readers?"
fundamentals. |
| **Imprint** | Everything Indie has PLUS **top referrers** and **top
countries**. The "where should I invest marketing?" advanced signals.
Also gets any new metric we ship first (Imprint early-access flag). |

Splitting geo + referrers into Imprint is a deliberate commitment upsell
— Free proves the count exists, Indie proves the engagement pattern,
Imprint proves where to invest. Pricing page copy at `/press/` needs to
move "geo, referrers" out of the Indie bullet and into the Imprint
bullet (currently lumped into Indie).

The gate reuses the `pressSub()` helper already used elsewhere in
`app.html`. No new subscription plumbing.

Free users hitting a locked chart get the same "Unlock with Press →"
CTA the imprint customize drawer uses, so the upsell UX is consistent.

Data is captured for EVERY folio regardless of author tier — we're
gating the *display* not the *collection*. That way if a Free author
upgrades later, their prior 30 days of history is already there.

---

## Author metrics (the "how's my folio doing" tab)

**Where it lives.** New Manuscript/Book/Audio/Folio sibling tab named
**Metrics** in the editor sidebar. One tab per opened folio, plus a
top-level "All my folios" summary in the author's imprint page owner view.

**Per-folio panel (v1, ship tomorrow):**
- Total views (from `viewCount`)
- Subscribers count (subcollection size)
- Reviews count + avg rating (query `reviews where folioId == <this>`)
- Annotations count (subcollection size)
- Currently featured? (Yes / boost expires in Xh, or No)
- Currently listed on shelf? (Yes / Pending / No)
- Word count + last-saved timestamp (already in state)

**Per-folio panel (v2, later this week):**
- Views last 7 / 30 days (needs the new `folio_events` collection below)
- Read completion — % of readers who reached the last chapter
- Chapter drop-off chart — bar per chapter showing % who reached it
- Teaser conversion — of readers who hit the paywall, what % bought
- Revenue: tips received + paid-release sales attributable to this folio

**"All folios" summary tile on the imprint page (owner view, v1):**
- N published folios · Total views · Total subscribers · Total revenue
- Sparkline of views last 30 days (v2, once we have events)

---

## Platform metrics (Jacob's admin dashboard)

**Where it lives.** `/admin/metrics/` — the tile already exists in the
admin console as "coming soon".

**Section 1: Content & users (v1, ship tomorrow)**
- Total signed-in users (count `folio_user_settings` docs — single query)
- Users with a folio (query `folio_projects` grouped by uid — dedupe in
  memory; already the pattern in the author-lookup widget)
- Total folios · Published · Pending moderation · Adult content
- Total words across all folios (sum from a rollup doc, see below)
- Reviews submitted last 7 days
- Founding contributors count (query `folio_user_settings where
  pressSubscription.foundingContributor == true`)

**Section 2: Revenue (v1, ship tomorrow)**
- Active Press subscriptions by tier (Indie / Imprint) — count from
  `folio_user_settings where pressSubscription.status == 'ACTIVE' and
  paypalSubscriptionId not starts-with 'COMP-'`
- Comps in effect — same filter but WITH the COMP- prefix
- Photo template purchases last 30 days
- Boost purchases last 30 days (needs new `folio_boost_purchases` doc
  written by `/boost-webhook` — currently the boost extends
  `featuredUntil` but doesn't log the transaction)

**Section 3: Health & moderation (v1, ship tomorrow)**
- Shelf moderation queue size (pending count) with quick-jump to
  `/admin/shelf/`
- Reviews awaiting approval (pending count)
- Last successful admin digest send timestamp (from
  `folio_admin_digest_state/latch`)

**Section 4: Trends (v2, once events land)**
- DAU / WAU / MAU line chart
- Signup → publish → sell funnel
- Retention cohort table (users who signed up week N, still active week N+k)

---

## The one piece of new infrastructure: `folio_events`

Everything above except the trend charts uses existing data. The trend
charts need an events collection.

**Proposal:**

```
folio_events/{eventId}
  ts:        Timestamp
  kind:      'view' | 'read_complete' | 'chapter_open' |
             'paywall_hit' | 'purchase' | 'tip' | 'boost_click'
  folioId:   string
  chapterId: string?   // only for chapter_open / read_complete
  uid:       string?   // only if signed in
  meta:      map?      // amount for purchase/tip, tier for boost, etc.
```

**Ingestion.** Every event flows through a Cloudflare Worker endpoint,
never client-direct-writes to Firestore. This keeps the client rules
simple (nobody can write `folio_events` directly — the worker uses the
service account we already have in the paywall worker).

Add one new endpoint: `POST /event` on the paywall worker.
Body: `{ kind, folioId, chapterId?, meta? }`. Worker validates kind,
stamps `ts`, extracts `uid` from the paywall JWT if present, writes.

**Client changes.** A tiny helper on `window`:
```js
window._folioTrack = (kind, folioId, extra = {}) => {
  navigator.sendBeacon(WORKER_URL + '/event', JSON.stringify({
    kind, folioId, ...extra,
    tokenHint: localStorage.getItem('folioPaywallToken_' + folioId) || null,
  }));
};
```
Called from:
- Reader boot → `view`
- Chapter open in reader → `chapter_open`
- Reader reaches last chapter → `read_complete`
- Paywall lock rendered → `paywall_hit`
- Purchase success → `purchase` with amount
- Tip success → `tip` with amount
- Boost purchase success → `boost_click` with tier

**Aggregation.** Cron in the email worker (already runs daily) walks
yesterday's events and writes rollup docs:
```
folio_projects/{id}/metrics/daily_{YYYYMMDD}
  views, unique_readers, chapter_opens, read_completes,
  paywall_hits, purchases_count, purchases_revenue,
  tips_count, tips_amount
```
Reads for the author dashboard become a range query on these daily docs,
not a scan of raw events. Events auto-delete after 90 days (TTL policy
in Firestore) so storage stays bounded.

---

## Firestore rules changes

- `folio_events`: `allow read, write: if false;` (worker only, via
  service account bypass)
- `folio_projects/{id}/metrics/{doc}`: `allow read: if
  isUser(parentUid(id)) || isAdmin(); allow write: if false;` (worker
  only)
- `folio_boost_purchases/{id}`: same pattern as `folio_photo_purchases`

---

## Ship order for tomorrow

Half-day scope. Do the parts that use existing data first — that's the
big visible win — then land the events pipeline foundation.

1. **`/admin/metrics/index.html`** — new page. Three sections above
   (Content & Users, Revenue, Health & Moderation). All queries use
   patterns already proven safe by the author-lookup rewrite: published
   filter + isUser/isAdmin single-doc reads + world-readable themes.
   Add plan chips (reuse the classifier from `/admin/press`).
2. **Author Metrics tab (v1)** — sidebar tab next to Manuscript / Book /
   Audio / Folio. Uses existing `viewCount`, subcollection counts, and
   `reviews where folioId == this`. Shows the panel described above.
3. **Owner tile on imprint page** — the "All folios summary" — under
   the customize drawer.
4. **`folio_events` collection + `/event` endpoint on the paywall
   worker** — infrastructure only, no UI yet. Verify writes work by
   opening a folio and checking Firestore.
5. **Daily rollup cron** — extend the email worker's daily tick to
   compute yesterday's `metrics/daily_*` docs. Backfill runs on demand
   via `?force=YYYYMMDD` param.

Everything after step 3 is scaffolding tomorrow's afternoon or a
follow-up day — v1 dashboards (steps 1-3) alone give you a real product
surface authors and Jacob can look at.

---

## Privacy + policy

- No reader identity is written to `folio_events` beyond the uid IF
  they're signed in AND holding a valid paywall JWT. Anonymous readers
  are counted as views/reads/completes but never linked to a person.
- Author dashboards never expose per-reader data — only aggregates.
- No third-party analytics (no Google Analytics, no Plausible, no
  Fathom). All data stays in the Folio Firestore project. That's a
  differentiator we can lead with on the pricing page.

---

## Open questions to decide tomorrow morning

1. Do we want v2 charts (Chart.js in the editor) or stay text-only for
   MVP? Chart.js is already loaded in artifacts land but not in the
   editor bundle.
2. Should author metrics live per-folio only, or also aggregated across
   an author's whole catalog? (Both is right; do folio-level v1,
   aggregated in v2.)
3. What triggers the paywall_hit event exactly — the moment the reader
   scrolls to a locked chapter, or the moment the lock modal renders?
   Latter is easier + more accurate.
4. Do we backfill viewCount → folio_events synthetic history, or start
   the timeline at "today"? Recommend starting at today; the total
   `viewCount` stays visible as an all-time-since-launch number.
