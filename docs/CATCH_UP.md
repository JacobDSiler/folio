# Catch-up — 2026-07-22 session

Everything shipped in this session, grouped so you can knock through them
in order without missing anything. Deploy-once items are marked
**[DEPLOY]**, manual steps outside the deploy script are **[MANUAL]**,
verification steps are **[VERIFY]**.

---

## 1. Ship the current code

**[DEPLOY]** `scripts/deploy-2026-07-07.ps1` — the file was rebroken by a
UTF-8-vs-CP-1252 encoding mismatch (em-dashes were parsing as fancy
quotes and blowing up the parser). Now fixed with a UTF-8 BOM plus
ASCII-only commit message. Should run cleanly.

**[DEPLOY]** Cloudflare workers — both changed and need `wrangler deploy`:
- `folio-paywall-worker.js` — new `POST /event` endpoint.
- `folio-email-worker.js` — new `runMetricsRollup()` + `GET
  /metrics-rollup` endpoint added to the daily cron.

Run whatever wrangler commands you normally use for each worker. If
you're using two separate `wrangler.toml` files, both need a deploy.

---

## 2. Verify each fix in the browser

Once the deploy lands, walk through these:

### Editor & reader

- **[VERIFY]** Front / back matter paginates. Open Thomas's Psalms
  folio (or any folio with a multi-page Introduction) and confirm
  the Introduction now flows across as many pages as it needs
  instead of being crammed into one with the fade / ellipsis.
- **[VERIFY]** Find & Replace. Ctrl+H, type any word that appears
  many times, click Next repeatedly. Every hit should:
    (a) center in the viewport
    (b) flash a tight yellow highlight on the exact matched substring
    (c) wait for the scroll to finish before flashing (feels smooth
        even on cross-book jumps)
    (d) correctly land on multi-occurrence-per-paragraph hits (e.g.
        "Corlan smiled at Corlan" — first Next hits #1, second Next
        hits #2)
    (e) correctly land on hits inside paragraphs that split across
        pages (the "Tarin" -> "quarter-inch." bug).
- **[VERIFY]** Auto-version snapshots collapsed. Open the Folio tab
  and check the "Auto-saved snapshots (N)" disclosure sits closed by
  default under any manual "Save version" entries, with a ▶ that
  rotates when you expand it.
- **[VERIFY]** Blank paragraph spacing. Insert 2-3 blank lines
  between paragraphs in an existing folio; save; reload. Blank lines
  should survive (up to 3 consecutive) instead of vanishing on
  reopen.
- **[VERIFY]** Enter in a preview paragraph inserts a new blank
  paragraph after (instead of just blurring). Backspace on an empty
  spacer deletes it and lands the caret on the previous line.
- **[VERIFY]** Mobile view. Load `/app.html` on your phone. The
  toolbar should wrap to multiple rows instead of overflowing off-
  screen; the hamburger should sit in a dedicated gutter; the book
  page should auto-fit the viewport width; and text should not clip
  off either side.
- **[VERIFY]** Reader clipping. Load a long chapter as reader. Text
  should not cut off at page bottoms (2.5-line pagination slack +
  post-render overflow watchdog now shipping).

### Admin console

- **[VERIFY]** `/admin/press/` — auth flows cleanly, "Loading known
  authors..." resolves within a couple of seconds, dropdown shows
  authors with plan chips (Free / Comp / Paid / Expired / Cancelled)
  next to each name.
- **[VERIFY]** `/admin/admins/` — the previously blank page now
  shows the Roles management UI, includes the new author-search
  widget that auto-fills UID + display name when picked.
- **[VERIFY]** `/admin/boost/` — author lookup widget now visible
  (was hidden because `_shared.js` was 404-ing).
- **[VERIFY]** `/admin/metrics/` — new page. Should populate with
  content counts, revenue by tier bucket, health section, and the
  8-most-recently-published folios table.

### Metrics pipeline (NEW)

- **[VERIFY]** Author Metrics tab. Open any folio in the editor,
  click the new "📊 Metrics" tab. Verify the panel shows real
  counts (views · subscribers · reviews · annotations) plus the
  publish-state pill. Free tier authors should see upsell tiles;
  Indie sees the reader-engagement section; Imprint sees geo +
  referrers too.
- **[MANUAL]** Manually trigger a rollup once events are flowing:
  ```
  https://folio-email.jacobsiler.workers.dev/metrics-rollup?key=YOUR_ADMIN_DEBUG_TOKEN&day=YYYYMMDD
  ```
  Backfill any day you like. Doc lands at
  `folio_projects/{folioId}/metrics/daily_YYYYMMDD`.

---

## 3. Pricing page update

- **[VERIFY]** `/press/` copy. Indie card now says "Reader analytics
  — 30-day view sparkline, per-chapter drop-off" and lists
  "Marketing analytics (geo · referrers)" as an Imprint-only unlock.
  Imprint card has "Marketing analytics — top countries, top
  referrers, campaign attribution".

---

## 4. Firestore rules

- **[VERIFY DEPLOYED]** Rules were pushed automatically by the last
  deploy. New / changed:
    - `reviews`: `allow read` now includes `|| isAdmin()` so
      moderation queue reliably lists pending.
    - `folio_events`: `allow read, write: if false;` (worker only).
    - `folio_projects/{id}/metrics/{doc}`: `allow read: if
      isUser(parentUid(id)) || isAdmin(); allow write: if false;`

The linter warnings at lines 68-70 are harmless — `request` /
`exists` / `get` ARE in scope inside `service cloud.firestore`
functions, the linter just doesn't always recognize it.

---

## 5. Optional follow-ups (not urgent)

- Add `POST /subscription-counts` on the paywall worker so the
  admin/metrics Revenue section can count Press subscribers who
  haven't published yet (currently only counts published authors —
  see the note inline on that page).
- Wire `_folioTrack('purchase', ..., { meta: { amount } })` into
  the Gumroad + PayPal purchase success handlers so the daily
  rollup counts revenue by folio.
- Wire `_folioTrack('tip', ..., { meta: { amount } })` into the
  tip-success handler.
- Wire `_folioTrack('boost_click', ..., { meta: { tier } })` into
  the boost checkout start.
- Wire `_folioTrack('paywall_hit', ..., { chapterId })` into the
  paywall lock modal render for accurate conversion funnel.
- Convert the deploy script to a GitHub Action so pushing a tag
  auto-deploys (see our earlier conversation about `wieldy`).
- Move `.nojekyll` staging into the deploy script's `must` inventory
  so it can't get forgotten.

---

## 6. Nothing needed for these — they're already live

- Text clipping fixed (2.5-line slack + fonts.ready gate + post-
  render overflow watchdog).
- Blank paragraph persistence + Enter/Backspace handling.
- `_paragraphsOf` canonical splitter (dropped the 33 `.split('\\n')
  .filter(p => p.trim())` idioms).
- `.nojekyll` at repo root so GitHub Pages serves `/admin/_shared.js`.
- Deploy script's "nothing to commit" no longer fatal.
- All find-and-replace improvements.
- All the admin-page fixes (`\'` escape, duplicate try{}, etc.).
