# Folio Perpetual — lifetime tier design spec

**Status:** log-the-intent, no build yet.
**Priority:** medium — behind Stage 3.5 (Author Profile) and Stage 3.6
(BISAC), roughly Stage 3.7 in the runbook.
**Origin:** Jacob, 2026-08-11.

---

## What this is

A one-time-payment tier that grants the author **Imprint-level access
forever** on the current account. The buyer is done paying — no monthly
or annual renewal, no expiry, no "you lost your features" moment.

Analogous to the **Founding Contributor** chip already displayed on
imprint pages: it's a lifetime status, but Perpetual is *purchasable*
rather than *comped for early support*.

---

## Hard constraint (do not violate)

**Perpetual must NEVER unlock features that have per-use marginal cost
to Folio.** These are subscription-priced because their consumption is
subscription-shaped; a one-time payment can't fund an indefinite
per-use tail.

Explicitly **excluded** from Perpetual, always:
- **Featured Boosts** (24h / 72h / 7d). Each boost has real slot cost
  on the Shelf and burns author-attention from other listings.
  Perpetual buyers pay for boosts at the same $3 / $9 / $19 rate
  everyone else does.
- **Any future consumable credit-based feature** — TTS narration
  minutes, stock photo pack downloads beyond a small monthly allowance,
  KDP-to-Folio import beyond N books/month, moderator-priority queue,
  etc. If it's a bucket that empties, Perpetual doesn't refill it
  automatically.
- **Third-party pass-throughs** — anything Folio pays a per-unit fee
  for on behalf of the author (payment processor fees on tips, Lulu
  print-on-demand costs, etc.). Author still pays those.

The pattern is: **Perpetual buys the software; consumables are their
own line item.**

---

## Included in Perpetual (baseline)

Everything Imprint gets today, forever, subject to the exclusion list
above:

- All Imprint-tier metrics + analytics
- Custom imprint page theme (accent, hero image, header font, custom domain path)
- Full chapter preview strip config
- Long-blurb + 5 YouTube videos on info modal (whatever Imprint has at
  purchase-time and going forward — see "feature drift" below)
- No public "listing limit" (an Imprint privilege)
- Priority moderator queue for shelf listings (if implemented)
- Everything Indie tier includes (Perpetual is Imprint-or-better by
  definition — no fork where Perpetual is missing an Indie feature)

**Feature drift over time:** if a future Imprint feature has zero
marginal cost per author-month (e.g. a new UI theme, a template pack),
Perpetual gets it automatically. If it has marginal cost (see
exclusion list), Perpetual pays like everyone else. Decision goes
through the operator (Jacob) at the time each feature ships — record
the decision in this doc's Log section so the rule is explicit and
consistent.

---

## Ongoing value in ALL Imprint tiers (added 2026-08-11)

The value ladder has to justify $449 for Perpetual. Doing that by
stacking Perpetual-only extras is one lever; another is to make the
Imprint TIER ITSELF meatier so 3 years of Imprint at $12/mo genuinely
gives $432 of value. These are now advertised on `/press/`:

- **1 free 24h Featured Boost every month** — auto-credited on
  subscription anniversary, use it or bank it. $9/mo standard price =
  $108/yr baseline value.
- **Priority moderator queue** — shelf submissions moved to the
  front of the review queue. Low cost to Folio (just an ordering
  tweak), high perceived value for authors who've been waiting.

Both apply monthly/yearly/perpetual — they're baseline Imprint benefits.

## One-time-value bonuses (Perpetual ONLY)

Perpetual is a large one-time payment, so it also gets extras that
DON'T apply to monthly/yearly Imprint:

- **🏛 Founding Perpetual forum** — private Discord/mailing list channel
  where Jacob shares early roadmaps + takes direct input. Buyers get
  to shape the product they own forever.
- **✨ Name on `/press/#supporters` wall** — default opt-in, opt-out
  available. Public thank-you for the trust.
- **🎁 Locked-in tier for life** — every future Imprint feature,
  forever, no recurring bill (this is what "Perpetual" MEANS but
  worth restating in the bullet).
- **Reserved short URL** on `/imprint/<slug>` — first-come-first-served
  during the launch window, then subject to Folio's "no impersonation"
  moderation rule.

Rendered on `/press/` inside a `.press-perpetual-extras` block that
only shows when the billing toggle is set to "Perpetual" (see
`press/index.html` setBilling() function).

## Founding Contributor comps at launch (BIL note)

Jacob spoke to his brother-in-law about Perpetual quoting "$120" from
memory, before the price locked at $449. To honour that conversation
without pricing-shifting for the public:

- **BIL gets comped as Founding Contributor when Perpetual ships.**
  Uses the existing Founding Contributor mechanism (already built
  into folio_user_settings + the chip on the imprint page). Grants
  lifetime Imprint access as a "you were in early" gesture. Costs
  Folio $0, resolves the interpersonal awkwardness by turning "$120"
  into "actually, you get it entirely free — you're on the founders
  list."

- **Same treatment for other pre-launch conversations.** Any friend /
  family / early tester Jacob has quoted informal pricing to before
  launch gets the Founding Contributor comp rather than the price
  shifting to honour the quote. Keep the public price clean.

- **Track this list.** Add a section to this doc (below) when new
  people qualify, so nothing gets lost.

### Founding Contributor comp queue (grant on Perpetual launch)

_Add entries as they arise. Include name, relationship, and the
approximate date of the pre-launch conversation._

- **[BIL name]** — Jacob's brother-in-law. Quoted "~$120" pre-launch,
  ~2026-08. Comp as Founding Contributor lifetime Imprint.

---

## Pricing modelling

Anchor the price to **months of Imprint subscription** to give buyers
a legible ROI calculation.

**Imprint monthly base rate (locked 2026-08-11): $12/month.**

**Imprint Perpetual pricing:**

| Multiple | Price | Buyer ROI (months to break even) |
|---|---|---|
| 24× monthly | $288 | 24 months (2 years) |
| **~37.4× monthly** | **$449** | **~37.4 months (~3.1 years) — LOCKED** |
| 48× monthly | $576 | 48 months (4 years) |
| 60× monthly | $720 | 60 months (5 years) |

**Imprint launch price: $449** (charm-priced just below $450;
equivalent to ~37 months of Imprint at $12/month. Launch-window
discount option: **$369** ≈ 30-month breakeven, if early-cohort
feedback signals resistance).

**Indie Perpetual pricing (added 2026-08-11 to match live /press/):**

Indie tier is priced at $5/month, so the Perpetual multiplier grid is:

| Multiple | Price | Buyer ROI (months to break even) |
|---|---|---|
| 24× monthly | $120 | 24 months (2 years) |
| 36× monthly | $180 | 36 months (3 years) |
| **~39.8× monthly** | **$199** | **~39.8 months (~3.3 years) — LOCKED** |
| 48× monthly | $240 | 48 months (4 years) |

**Indie launch price: $199** (charm-priced just below $200;
equivalent to ~40 months of Indie at $5/month — slightly steeper
multiplier than Imprint's 37.4× to keep the Indie/Imprint ratio
sensible: $199 vs $449 is a legible "roughly 2.25× spread" that
tracks the monthly ratio $5 vs $12 = 2.4×). Launch-window discount
option: **$149** ≈ 30-month breakeven.

**Tier ratio sanity check:** $199 Indie / $449 Imprint ≈ 0.44.
Monthly ratio $5/$12 ≈ 0.42. Perpetual ratio is a hair more generous
to Indie buyers than the monthly ratio implies — intentional. Indie
Perpetual is the "gateway drug" tier; if it's proportionally cheaper
than the monthly ratio, it seeds more long-tail brand ambassadors
for the same revenue exposure.

**Anchor decision (Jacob, 2026-08-11):** **36× monthly** — the
midpoint between "faster adoption" (24×) and "better economics" (48×).
Reasoning:
- 3 years is a legible commitment horizon for most authors.
- Comfortably above the typical SaaS churn curve (most subs churn by
  month 18–24), so we're pricing Perpetual to buyers who would have
  stayed anyway rather than to average-lifetime buyers.
- Leaves headroom to run a launch-window discount (say 30× ≈ 2.5 years
  breakeven) that still nets us more than average sub lifecycle.
- Splits the risk: if adoption is soft we can drop toward 24× on the
  next round without cannibalising a "premium" price point; if it's
  strong we can drift toward 48× on subsequent tiers.

**Validation path — user feedback, not aggregate data.** Original plan
was to wait 6+ months for real subscription-lifetime data before
locking the price. Jacob's call: skip the wait, launch at 36× to a
small early cohort (Founding Contributors + first-wave paying users),
and gather structured feedback ("would you buy at this price? at 24×?
at 48×?"). Iterate the price based on what they say, then open it to
the general audience. This is a design-partner-style validation, not
statistical.

**What "structured feedback" looks like:** a small in-app or emailed
form to the early cohort, ~5 questions:
1. If Perpetual existed at **$449** (~37 months of Imprint at
   $12/month), would you buy? (yes / maybe / no)
2. At what price WOULD you buy? (open field)
3. At what price does it stop feeling worth it? (open field)
4. Which of the one-time-value bonuses (chip / credits / feedback
   channel / short URL / annual free boost) actually pull you toward
   buying? (multi-select)
5. Anything the tier is missing that would make it a "yes"? (open field)

Feed answers back into this doc's Log so the pricing history is
traceable.

---

## Admin comp workflow

Follows the existing comp pattern in `/admin/press/`, plus one addition:

**In the admin console, add a "Comp Perpetual" button** next to the
existing "Comp Indie / Comp Imprint" buttons. Behavior:

1. Confirmation modal reminds the operator: "This grants LIFETIME
   Imprint access. Cannot be revoked without user consent."
2. On confirm: writes `folio_user_settings/<uid>` with:
   ```json
   {
     "perpetual": {
       "active": true,
       "grantedAt": <serverTimestamp>,
       "grantedBy": <adminUid>,
       "reason": "<free text — founding, contest winner, refund, etc.>"
     }
   }
   ```
3. `pressSub()` needs to be updated so it consults `perpetual.active`
   FIRST — if true, return `{ active: true, tier: 'imprint',
   source: 'perpetual', renewsAt: null }`. Every gate that reads
   `sub.active && sub.tier === 'imprint'` continues to work unchanged.
4. Chip on the imprint page reads state from this same doc.

**Revocation:** intentionally NOT built as an admin one-click. Removing
someone's lifetime access is a legal event — it goes through a support
ticket + written confirmation, not a button.

---

## Auto-upgrade of existing comps?

**Decision needed at launch time:** if we've comped someone with
Indie / Imprint for a fixed duration (say, 12 months to a family
member or beta tester), do they auto-upgrade to Perpetual when
Perpetual launches?

Two options:

- **Auto-upgrade** — every existing active comp gets Perpetual as a
  thank-you. Generous, warm-fuzzy, may be the right call given how
  small our early user base is.
- **No auto-upgrade; offer discount** — existing comps keep their
  duration + get a one-time email offering Perpetual at the launch
  discount price. Cleaner separation between "comp" and "purchase."

**Recommendation:** hybrid. **Founding Contributors** (Thomas + close
family + specific early testers whose names are on the founder list)
get auto-upgrade. Everyone else with an active comp gets the discount
email. This preserves the specialness of Founding Contributor and
gives late-comp folks a positive-but-transactional path.

The exact list of "Founding Contributor uids that auto-upgrade" gets
written to this doc's Log at launch time.

---

## Grandfathering rules

If Perpetual is later re-priced, discontinued, or restructured
(e.g. split into "Perpetual Indie" and "Perpetual Imprint" tiers):

- **Existing Perpetual holders keep the tier they bought.** No downgrade.
- **Existing Perpetual holders inherit any strictly-better bundle.**
  If a future "Perpetual Imprint Plus" adds features to existing
  Perpetual, current holders get them automatically.
- **Any feature dropped from the platform entirely** is dropped for
  everyone including Perpetual. Perpetual doesn't guarantee a specific
  feature will exist forever; it guarantees the tier of access to
  whatever features exist.

---

## What still needs to be figured out before build

- Whether Founding Contributors auto-upgrade (see above).
- Payment processor for one-time high-ticket purchases — PayPal
  Payments Standard (existing wiring) works fine but consider whether
  to also accept a bank transfer flow for buyers who don't want to hit
  PayPal card limits on a ~$400 purchase.
- Legal review of "lifetime = the platform's lifetime" language.
  Standard practice is to write "for the operational life of the
  platform", not literally forever, but this needs a lawyer to phrase.
- Whether Perpetual is EU-VATable. Almost certainly yes; needs a real
  invoice flow, not just PayPal's receipt.

---

## Log

- 2026-08-11 — Jacob logged the intent. No build yet. Priority is
  Stage 3.7-ish (behind Stages 3.5 Author Profile and 3.6 BISAC in
  `docs/TOMORROW_PLAN.md`).
- 2026-08-11 — **Anchor price locked at 36× monthly Imprint.** Midpoint
  of "faster adoption" (24×) vs "better economics" (48×). Validation
  path switched from "6 months of aggregate data" to "structured
  feedback from early cohort" (see Pricing modelling section for the
  5-question form). Jacob will drive that feedback loop directly.
- 2026-08-11 — **Imprint monthly base rate locked at $12/month.**
  Baseline math yielded $432 (36×). Jacob charm-priced to **$449**
  (~37.4× — just under the $450 psychological threshold). Launch-window
  discount option is **$369** (~30.75× breakeven) if the early-cohort
  feedback shows resistance at $449.
- 2026-08-11 — **Indie Perpetual added to spec at $199** (~39.8× the
  $5/month Indie rate). Was already live on /press/ but wasn't in
  this doc; reconciled. Launch-window discount option: $149. Ratio
  to Imprint Perpetual ($199 / $449 = 0.44) is intentionally a hair
  more generous to Indie buyers than the monthly ratio ($5 / $12 =
  0.42) to seed more long-tail ambassadors at the entry tier.
- 2026-08-11 — /press/ updated: Imprint Perpetual $499 → $449.
  Files touched: press/index.html (data-perpetual attribute × 2,
  priceMap × 1). Indie Perpetual $199 unchanged on the live page.
- 2026-08-11 — Imprint tier bulleted value bumped to justify $449:
  added "1 free 24h Featured Boost/mo" + "priority moderator queue"
  as recurring Imprint benefits (all billing modes), plus a
  perpetual-only extras block (Founding forum, supporters wall,
  tier-for-life) that shows only when the billing toggle is set to
  Perpetual. Reflects Jacob's A+B choice: keep $449, add value.
- 2026-08-11 — Founding Contributor comp queue introduced (above)
  so pre-launch price conversations don't force public price shifts.
  BIL added as first entry.
