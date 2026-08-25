# Folio Affiliate Program — Spec

**Status:** Approved for Phase 1 build (Aug 2026)
**Motivating case:** Ken (Ireland-based, Chinese translator of an early Embers draft) marketing paid folios to his network — starting with Ireland/UK reach, expanding into his Chinese contacts when he's ready. He gets 20-30% commission per sale, Folio takes 0%, author keeps the rest.
**Scope:** Available to all Folios from launch (no gating flag).
**Slugs:** All plans get an auto-generated slug by default (so links always work). Paid plans (Indie / Imprint) can additionally customise their slug for prettier affiliate URLs like `onfolio.press/f/embers`.
**Deferred:** China reachability. Ken markets to Ireland/UK first; if/when he starts distributing to mainland China contacts, we'll revisit — Ken has connections who can host a proxy there if we need one.
**Payout model:** Manual settlement. Folio tracks the ledger, owner pays the affiliate directly via Ko-fi / PayPal. No routed money, no money-transmission licensing, no 1099s issued by Folio.
**Revenue scope:** Paid releases only (Phase 1). Tips and Boosts are out of scope for now.

---

## Concept in one paragraph

Every Folio owner can invite affiliates by email and set a commission rate per affiliate. The affiliate accepts and gets a short unique link — `onfolio.press/read/embers?a=xY3kQ2Ab` — plus a QR code for messaging apps. When someone clicks the link, a 30-day first-touch attribution cookie is set. If that reader buys the paid release within the window, the paywall worker tags the purchase with the affiliate's ID and calculates the commission. Both owner and affiliate see the running ledger; when the owner is ready to settle, they hit a one-click "Pay via Ko-fi" that opens Ko-fi pre-filled with the amount and affiliate's handle. The owner sends the money, marks the settlement, and the ledger moves the amount from Pending to Settled.

---

## User stories

**Owner (Jacob)**
- I want to invite Ken to sell Embers into China, at 25% commission.
- I want to see how much Ken has earned this month and how much I owe him.
- I want to send Ken his commission with one click and have Folio mark it as paid.
- I want to invite two more affiliates for Embers at different rates — 20% for a book blogger, 15% for a friend with a small mailing list. Different deals for different relationships.
- I want to pause or remove an affiliate without deleting their history.

**Affiliate (Ken)**
- I want to accept Jacob's invitation with one click.
- I want a page that lists every folio I'm affiliated with, my link and QR code for each, and my earnings (pending + settled).
- I want to see which of my links have generated clicks and sales so I can double down on what's working.
- I want to know when Jacob has paid me.

**Reader**
- I want the affiliate link to feel invisible. I click, I read, I buy — I shouldn't have to think about affiliates.

---

## Data model (Firestore)

```
affiliations/{affiliationId}
  folioId: string
  ownerId: string           (denorm for owner queries)
  ownerEmail: string        (denorm for display)
  affiliateUserId: string?  (null until accepted)
  affiliateEmail: string    (invited email; canonical until accepted)
  affiliateHandle: string?  (denorm from user profile after accept)
  rate: number              (0.20 = 20%; must be 0 < rate <= 0.75)
  code: string              (8-char base62, unique across all affiliations)
  status: 'invited' | 'active' | 'paused' | 'removed'
  invitedAt: timestamp
  acceptedAt: timestamp?
  pausedAt: timestamp?
  removedAt: timestamp?
  note: string?             (owner's private note about the relationship)

  # ledger totals — updated by settlement/purchase writes
  lifetimeGross: number     (sum of all attributed sale gross amounts)
  lifetimeCommission: number (sum of all attributed commission)
  pendingCommission: number  (unsettled commission)
  settledCommission: number  (paid out)

affiliateClicks/{clickId}       (analytics — sampled or rolled up)
  affiliationId: string
  folioId: string
  ts: timestamp
  country: string?          (from CF-IPCountry header)
  referrer: string?         (Document.referrer, truncated)

affiliateAttributions/{userId}_{folioId}   (composite key)
  affiliationId: string
  folioId: string
  firstTouchAt: timestamp
  lastTouchAt: timestamp
  expiresAt: timestamp      (firstTouchAt + 30 days)

purchases/{purchaseId}       (EXTEND existing schema)
  # existing fields...
  affiliationId: string?
  affiliateRate: number?    (rate at time of sale — frozen so ledger doesn't shift)
  affiliateCommission: number?  (grossAmount * affiliateRate, calculated at write time)
  affiliateSettlementId: string?  (null until settled)

settlements/{settlementId}
  affiliationId: string
  folioId: string
  ownerId: string
  affiliateUserId: string
  amount: number
  purchaseIds: string[]     (what this settlement covers)
  method: 'kofi' | 'paypal' | 'other'
  externalTxnRef: string?   (Ko-fi txn ID if we can capture it)
  settledAt: timestamp
  note: string?
```

### Firestore rules (sketch)

- `affiliations`: readable by ownerId + affiliateUserId. Writable by owner only (except `status` which the affiliate can flip from 'invited' to 'active').
- `affiliateAttributions`: server-write only (via paywall/subdomain worker), readable by nobody in client (used only server-side).
- `purchases`: existing rules; affiliate can read a stripped view (their attributed purchases only) via a Cloud Function or server endpoint — do NOT expose raw purchases to affiliates.
- `settlements`: readable by ownerId + affiliateUserId. Writable by ownerId only.

---

## Attribution flow

1. **Link click.** Reader hits `onfolio.press/read/embers?a=xY3kQ2Ab`.
2. **Reader worker** (`folio-reader` or wherever the reader route lives) checks the `a=` param:
   - Look up `affiliations` where `code == 'xY3kQ2Ab'` and `status == 'active'`.
   - If found, set an HttpOnly cookie: `folio_aff_embers=xY3kQ2Ab; Max-Age=2592000; SameSite=Lax; Secure`. One cookie per folio (scoped by folioId in the cookie name) so affiliates for different folios don't clobber each other.
   - Increment `affiliateClicks` (sampled — 1-in-10 for hot links, 1-in-1 while volume is low).
   - Strip `?a=` from the URL client-side (`history.replaceState`) so the reader doesn't see it and doesn't share it unintentionally.
3. **Attribution model:** **first-touch, 30-day window.** If the reader arrives via Ken's link on day 1 and later via a blogger's link on day 5, Ken still gets credit on day 20's purchase. First-touch rewards discovery over closing, which fits an early-stage book ecosystem better than last-touch.
   - Cookie contains the FIRST-touch affiliateId; later touches don't overwrite it (worker checks cookie presence before setting).
4. **Signed-in user attribution.** When the reader signs in, write `affiliateAttributions/{userId}_{folioId}` server-side using the cookie value if the cookie exists and there's no existing attribution for that user+folio. This survives cookie clearing and cross-device.
5. **Purchase.** Paywall worker (`folio-paywall`) receives the purchase webhook (Ko-fi / Gumroad). Before writing the purchase document:
   - Look up `affiliateAttributions/{userId}_{folioId}`.
   - If found and not expired, resolve to `affiliation`, snapshot `rate`, calculate `commission = gross * rate`, write onto the purchase doc.
   - Bump `affiliations.lifetimeGross`, `lifetimeCommission`, `pendingCommission` via a transaction.
6. **Refund.** If a purchase refunds, the affiliation ledger reverses: `pendingCommission -= commission`, `lifetimeCommission -= commission`. If already settled, mark the settlement as having a clawback; owner sees "Ken was overpaid by $X — deduct from next settlement" on their dashboard. Don't try to auto-recover funds.

---

## UI — Owner side

### New sub-tab: **Ship › Affiliates**

Sits alongside `Ship › Folio` and `Ship › Metrics`. Layout:

**Top card: Invite a new affiliate**
- Email input
- Commission rate slider/input (default 20%, range 5-50%, warning banner at >30%)
- Optional private note ("Ken — China distribution")
- Invite button → sends email via `folio-email` worker with accept link

**Ledger table**
| Affiliate | Rate | Clicks | Sales | Gross | Commission | Pending | Actions |
|---|---|---|---|---|---|---|---|
| Ken (wei@...) | 25% | 1,247 | 89 | $712 | $178 | **$124** | [Pay] [Pause] [Edit rate] |
| Sarah Blog | 20% | 43 | 2 | $16 | $3.20 | $3.20 | [Pay] [Pause] [Edit rate] |
| Marcus (invited) | 15% | — | — | — | — | — | [Resend] [Cancel] |

**Pay flow:**
1. Click **Pay** → modal shows the affiliate's Ko-fi and PayPal handles (pulled from their profile) + the amount.
2. Modal has two buttons: **Pay $124 via Ko-fi** (opens Ko-fi in new tab with amount + note pre-filled: `Embers affiliate — Aug 2026 — 12 sales`) and **Pay via PayPal** (same, PayPal.me/handle URL).
3. After the owner clicks either, modal switches to: "Did the payment go through?" with **Yes, mark as settled** / **Not yet — remind me later**.
4. On confirm, write `settlements` doc, move amount from Pending to Settled, notify affiliate by email.

**Edge cases in UI:**
- If affiliate hasn't accepted yet, ledger shows `—` for everything, action is "Resend invite" or "Cancel invite".
- If affiliate has no Ko-fi/PayPal handle on file, Pay button shows "Ask Ken to add a payout handle" with a copyable message.
- Warn if rate is edited: "Ken's rate changes from 25% to 20% for future sales. Sales already recorded keep their original rate."

---

## UI — Affiliate side

### New page: **/app/affiliate** (or `/affiliate` as a top-level route)

Sits outside the editor since affiliates aren't necessarily authors.

**Header:** "Your affiliate folios"

**Per-folio card** (one per active affiliation):
- Folio cover + title + author
- Your rate: **25%**
- Your unique link: `onfolio.press/read/embers?a=xY3kQ2Ab` + **Copy** button + **QR code** button
- QR button opens a modal with a 512×512 PNG QR ready to right-click-save or drag into WeChat
- Stats strip: clicks • sales • earned • pending • settled
- Small "Payment history" link → drawer with settlement records

**Invitations tab:**
- Pending invites with **Accept** / **Decline** buttons

**Payout handles section:**
- Ko-fi handle input
- PayPal.me handle input
- "Owners can only pay you via handles listed here"

---

## URL & code format

- Code: 8 characters, base62 (0-9a-zA-Z), generated at invite time, unique across all affiliations.
- Reader URL with attribution: `https://onfolio.press/read/{slug}?a={code}`
- QR code: same URL, encoded at Q error correction, 512×512, PNG.
- Copy button copies the URL exactly (no UTM, no tracking params visible).

---

## Emails

Three transactional emails, sent via `folio-email` worker:

1. **Invite** — "Jacob invited you to sell Embers as an affiliate. You'll earn 25% on every sale. [Accept]"
2. **First sale** — sent to affiliate the first time they earn. "Your first Embers sale! You earned $2 (25% of $8). Full details in your affiliate dashboard."
3. **Payment received** — sent to affiliate when owner marks a settlement paid. "Jacob just marked $124 as paid to your Ko-fi. Check your account."

All three respect the affiliate's notification preferences.

---

## Fraud & abuse guards

- **Self-affiliation blocked.** `affiliateUserId != ownerId` enforced at write time.
- **Rate cap.** Max 75% (server-enforced). UI warns >30%.
- **Refund clawback.** Ledger reverses on refund, surfaces on next settlement.
- **Duplicate purchase dedupe.** Existing paywall dedupes purchases by `(userId, folioId)`; affiliate commission inherits that.
- **Cookie stuffing.** Attribution only writes on genuine navigation (Referer or user-agent sanity check) and only if there's no existing attribution for that user+folio. Sampled click logging so hostile actors can't spam the analytics.
- **Removed affiliate.** Setting status to 'removed' stops new attribution but preserves ledger history. Pending commission still owed and settleable.

---

## Legal

- **Owner and affiliate both accept a short agreement at invite/accept time.** One paragraph each side. Draft copy in `docs/AFFILIATE_TERMS.md` (to write).
- **Folio's role is disclosed as ledger-only.** "Folio tracks the amounts owed but does not process affiliate payments. Payment is a direct arrangement between owner and affiliate."
- **Tax:** because Folio never holds the affiliate's money, no 1099 obligation on our side. Owners with US affiliates earning >$600/year should issue their own 1099-NEC. Add a note in the Ship › Affiliates footer.
- **China specifics (deferred):** Ken starts in Ireland/UK where reachability is fine. When he expands to mainland China contacts, we revisit — Ken can source a proxy host there. Cloudflare's China Network (paid, requires ICP license, months of setup) stays parked unless volume justifies it.

---

## Phase 1 build order (MVP, ~1 week)

1. **Data model + Firestore rules** — half day
2. **Invite flow** — owner-side invite form + email + accept page — 1 day
3. **Affiliate dashboard** (`/app/affiliate`) — links, QR, earnings — 1 day
4. **Attribution** — reader worker cookie logic + attribution write on sign-in — 1 day
5. **Purchase hook** — extend paywall worker to record `affiliationId` + commission — half day
6. **Owner ledger + settlement flow** — Ship › Affiliates sub-tab — 1 day
7. **Emails** — invite, first-sale, payment-received — half day
8. **Legal copy** — affiliate agreement, footnote about tax — half day
9. **End-to-end test** with Ken as the pilot affiliate for Embers — half day

**Total: 6-7 working days.** Ship to all Folios from day one (no flag). Ken pilots on Embers in the first two weeks — his feedback shapes any Phase-2 sharpening.

---

## Phase 2 (post-MVP, not committed)

- Tips revenue included in commission (opt-in per affiliation).
- Multi-touch attribution (option to split commission between first-touch and last-touch).
- CSV export for tax season.
- Auto-remind at end of month if pending > $X.
- Affiliate leaderboard on the folio's public page ("Top supporters") — optional per owner.
- Owner-side "affiliate signup link" — a public URL anyone can hit to request affiliate status, owner approves.

---

## Open questions to revisit before build

- Cookie name scheme when folioId contains characters that break cookie names. Sanitise or hash.
- Where does the affiliate dashboard live in the top-nav? Suggest an "Affiliate" chip that appears only if the user has at least one active affiliation.
- Should the reader see any indication they arrived via an affiliate? My default: no. Cleaner conversion.
- What happens when a folio is unpublished? Existing affiliations pause automatically; ledger stays visible.
