# Folio — Seasonal discount schedule

**Status:** design + calendar logged. Manual promo activation via
Firestore config (Phase 1); automated date-triggered activation is
Phase 2.
**Priority:** medium — needs revenue to compound. Ship the first
promo in whatever's the closest upcoming event.
**Origin:** Jacob 2026-08-11 — "We need to stimulate some trade
with this. Some intake at least."

---

## The play

Indie-author-facing SaaS lives and dies by seasonal moments. Every
month has at least one hook the marketing can attach to. Rather than
running random flash sales (which train buyers to wait for the next
one), tie discounts to CULTURALLY MEANINGFUL author events. The
promo becomes part of the moment, not a Folio-anniversary trick.

Two categories of discount:

1. **Attention-window promos** — short, high-intensity, tied to
   external attention peaks (NaNoWriMo, Black Friday). Discount 25%.
2. **Community-alignment promos** — softer, longer-window, tied to
   values-aligned days (World Book Day, Read a Book Day). Discount
   15%.

Never discount Perpetual below its baseline price. Perpetual buyers
who paid full immediately after a lower promo window would rightfully
feel burned. **The seasonal % discount ONLY applies to monthly and
yearly Imprint/Indie subscriptions.** Perpetual stays flat all year.

---

## Year-round calendar

| Month | Event | Dates | Discount | Codes | Tier |
|---|---|---|---|---|---|
| Jan | **New Year, New Book** | Jan 1 – Jan 15 | 25% off | `NEWBOOK25` | Indie / Imprint monthly + yearly |
| Feb | **Valentine's — for the romance shelf** | Feb 10 – Feb 16 | 15% off | `HEARTS15` | All non-Perpetual |
| Apr | **World Book Day** | Apr 23 (window Apr 20 – Apr 27) | 20% off | `WBD2026` | All non-Perpetual |
| May | **Author Day / Spring Push** | May 1 – May 8 | 15% off | `AUTHORMAY` | All non-Perpetual |
| Jul | **Mid-Year Draft Push** | Jul 1 – Jul 15 | 15% off | `HALFTIME15` | All non-Perpetual |
| Sep | **Read a Book Day + Back to School** | Sep 1 – Sep 12 | 20% off | `READMORE` | All non-Perpetual |
| Nov | **NaNoWriMo** | Nov 1 – Dec 5 (30-day novel + review buffer) | 30% off | `NANO2026` | Yearly only (align with the "long-term commitment" NaNo signal) |
| Nov | **Black Friday / Cyber Monday** | Nov 27 – Dec 2 | 30% off | `BLACKFRIDAY` | All non-Perpetual |
| Dec | **Winter Draft Camp** | Dec 15 – Jan 5 | 20% off | `WINTERCAMP` | Yearly only |

**Never-discount windows:** Perpetual is always full-price. Also
avoid stacking codes (only one active promo at a time, whichever
gives the buyer the best deal — client-side check picks the max).

---

## The single big Perpetual moment: launch window

Perpetual gets exactly ONE discount opportunity per lifetime: the
launch window when the tier first opens up.

- **Duration:** 30 days from Perpetual public launch.
- **Discount:** ~15% off — Imprint $449 → $379, Indie $199 → $169.
- **Framing:** "Launch pricing. Every price after this is $449 / $199,
  forever." Explicit scarcity, non-repeating.
- **Cohort tag:** Everyone who buys during this window gets a
  "Launch Perpetual" chip on their imprint page, distinct from later
  Perpetual buyers. Tiny visual thing, meaningful to early supporters.

After the launch window closes, Perpetual is full-price permanently.
No exceptions except Founding Contributor comps (see
`PERPETUAL_TIER_PLAN.md`).

---

## Per-event copy templates

### New Year, New Book (Jan 1 – 15)

**Subject line:** "The year you actually finish it. 25% off Folio."

**Body:**
> Every January the "this year I'll finally write my book" resolution
> starts strong and folds by February. Folio's here to keep you going
> longer. From Jan 1 to Jan 15, get 25% off Imprint or Indie —
> monthly or yearly.
>
> Code `NEWBOOK25`. Autofills at checkout on onfolio.press/press.

### World Book Day (Apr 20 – 27)

**Subject line:** "20% off — because you should be one of the writers."

**Body:**
> April 23 is World Book Day. Books get celebrated. This week,
> writers do too — 20% off Folio Indie and Imprint. Publish something
> to the Shelf during the window and we'll spotlight it on the
> welcome page.
>
> Code `WBD2026` at onfolio.press/press.

### NaNoWriMo (Nov 1 – Dec 5)

**Subject line:** "You wrote 50,000 words. Now what?"

**Body:**
> NaNoWriMo taught you to draft fast. Folio picks up where the
> writing stops: format it, cover it, publish it, list it on the
> Shelf. 30% off yearly Indie or Imprint through December 5th — the
> extra week is your review buffer.
>
> Code `NANO2026`. Bring the manuscript, we do the rest.

### Black Friday / Cyber Monday (Nov 27 – Dec 2)

**Subject line:** "Folio Black Friday: 30% off, no gimmicks."

**Body:**
> One button, one discount, no email-a-day funnel: 30% off Indie and
> Imprint (monthly or yearly) through Cyber Monday. Perpetual stays
> at full price — it's already the best deal we sell.
>
> Code `BLACKFRIDAY` at onfolio.press/press.

### Read a Book Day (Sep 1 – 12)

**Subject line:** "Read a book. Then publish one."

**Body:**
> September 6th is Read a Book Day, so we're pointing at both sides
> of the equation: read a book from the Folio Shelf (there are 40+
> live now) and if you're the one writing, get 20% off any Folio
> subscription for two weeks.
>
> Code `READMORE`.

---

## Infrastructure (Phase 1: manual)

For Phase 1, discount codes are checked client-side in `/press/`:

1. Add a hidden text input near the tier CTAs: "Have a promo code?"
2. On submit, check a hardcoded `PROMOS = { NEWBOOK25: { pct: 25,
   validFrom: ms, validTo: ms, tiers: ['indie','imprint'],
   billingModes: ['monthly','yearly'] }, ... }` object.
3. Valid + in-window → adjust displayed price + append code to the
   PayPal subscription create call.
4. Worker validates the code again server-side before creating the
   subscription (defense in depth against tampering).

Jacob activates a promo by editing the PROMOS object + shipping a
push. No dashboard needed for Phase 1.

## Infrastructure (Phase 2: config-driven) — SHIPPED 2026-08-11

Moved from hardcoded PROMOS into Firestore `folio_promos/{code}`
collection (doc id = the promo code itself so lookup at checkout is
a single get() — no query needed). Jacob (and moderators — write is
`isModerator()` which includes admins) manage them via
`/admin/promos/`.

**What shipped:**
- Firestore rules: `folio_promos` collection, public read, admin +
  moderator write.
- `/admin/promos/` — CRUD table with state chips (Active / Teasing /
  Upcoming / Expired), edit + delete, form with per-field validation.
- CSV bulk import — paste or upload a whole year at once, preview
  each row with valid / invalid indicators before commit. Existing
  codes upsert (re-import to update). "Load year-round example"
  button auto-populates the calendar from this doc.
- `/shelf.html` + `/press/index.html` + `/app.html` — banner slot
  populated by `/lib/promos.js`. Teasing → "starts in N days",
  Active → "N% off through <date>, code XXX."
- Last-editor breadcrumb (uid short-hash + hover for full) on every
  promo row for accountability in the collaborative surface.
- `/press/` promo-code input — verifies via
  `FolioPromos.verifyCode()`, shows adjusted price with strike-
  through on the tier card, passes the code to the paywall Worker
  on subscribe().

**What's still Phase 2 TODO (paywall-worker side, not shipped yet):**
- Server-side re-validation of the code in `/press-subscribe`.
  Client-side pct display is UX only — the Worker MUST re-verify
  the code, re-fetch the promo doc, confirm it's in-window +
  matches the tier + billing mode, and calculate the real price
  before creating the PayPal plan. Otherwise a hostile client
  could tamper with the pct in the request. Needs a matching
  Worker code change.

## Infrastructure (Phase 3: deeper collaboration) — LOG

Jacob's phrasing on collaboration ("build collaboration and
connection into the mechanic as possible", "something I work with
daily or regularly for the rest of my life") hints at richer collab
features than admin-write:

- **Draft state** — promos can be created as `draft: true`, banner
  doesn't render, only shows in admin. A second admin/moderator
  reviews + toggles `draft: false` to publish. Two-person sanity check.
- **Change history** — `folio_promos/{code}/history/{ts}` subcollection
  writing every save so you can see who changed what over time.
- **Comments** — small notes attached to a promo (`{author, text, at}`)
  so collaborators can leave "what if we changed the copy to X?"
  without editing the doc itself.
- **Assignee / owner** — one admin owns each promo, receives
  notifications when the teaser window is about to open (via the
  existing email worker).

Not urgent. Come back when the moderator team is ≥2 people actively
using this daily and the friction becomes real.

## Announcement flow

For each promo window:

1. **T-7 days:** email the mailing list (via MailerLite) with the
   copy template above.
2. **T-0 (window opens):** banner appears on `/press/`
   automatically (Phase 2) or via a manual push (Phase 1). Copy:
   "🎁 [PROMO NAME] — [PCT]% off Indie + Imprint through [end date]."
3. **T-1 day before window closes:** "Last day for [PROMO NAME]"
   sidebar toast in `app.html` for signed-out visitors.
4. **T+1 day after close:** banner disappears. No trailing "extended
   by 24 hours" — trains buyers to trust the deadline.

---

## Metrics to watch

- **Redemption rate per promo** — % of unique visitors during the
  window who redeemed the code. Baseline expectation: 2–5% for
  cold-list emails, 8–15% for warm segments.
- **Upgrade lift** — % of Free-tier users who upgraded during the
  window vs. baseline weekly rate.
- **Post-promo churn** — do the discount buyers churn faster than
  full-price buyers at month 3 / 6 / 12? (Signal: promo attracted the
  wrong cohort. Fix: tighter discount targeting.)
- **Perpetual "adjacency effect"** — do Perpetual sales dip during
  discount windows because buyers wait, or rise (attention halo)?
  Test empirically before adjusting Perpetual pricing.

---

## Log

- 2026-08-11 — Calendar + templates drafted. Manual PROMOS object
  path chosen for Phase 1. Perpetual carved out from all seasonal
  discounts; gets one launch-window discount and then is full-price
  forever. First live promo: whatever's next on the calendar when
  the infrastructure ships.
