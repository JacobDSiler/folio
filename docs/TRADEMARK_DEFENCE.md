# Folio — Trademark defence

**Status:** logged, low risk, no immediate action required.
**Priority:** medium — do before mobile launch, defer behind Stages 3.5 / 3.6.
**Origin:** Jacob, 2026-08-11 after noticing an existing Google Play app.

---

## The landscape

There is an existing Google Play listing:

- **Name:** "Folio: Ebook & Comic Reader"
- **Package:** `com.mathcrave.folio`
- **Installs:** 100+ (small).
- **Category:** consumer ebook / comic reader (i.e. reading experience only).
- **Overlap with us:** **low.** They read; we publish. Different market
  (readers vs authors), different distribution (Play Store native app
  vs onfolio.press web), different revenue model.

**Decision:** do NOT rename. The word "folio" is generic in publishing
(a folio is a sheet folded once — the traditional book format), and no
one has an exclusive mark on it. Coexistence is normal and legally
supported by the different-market principle.

But: the absence of a formal filing on our side is a real gap. If the
Play Store app files a trademark first, we'd be forced onto reactive
footing. So three defensive actions below.

---

## Action 1 — File trademarks in IE / UK / EU

Three jurisdictions, staggered by cost + priority:

### 1a. Ireland (IPOI) — primary, do first
- Registrar: [Intellectual Property Office of Ireland](https://www.ipoi.gov.ie/en/)
- Classes to file:
  - **Class 42** — "Software as a service (SaaS)" — covers the web
    editor and the paywall.
  - **Class 41** — "Publication services; electronic publishing;
    provision of online non-downloadable publications" — covers the
    Shelf as a distribution surface.
- Estimated cost: **~€70 base fee** + ~€70 per additional class.
  Budget €200 including both classes and any formality follow-up.
- Turnaround: ~4–6 months to registration if unopposed.
- Filing name: **"Folio"** as a word mark. (Logo mark is a separate
  filing and can wait.)

### 1b. United Kingdom (UKIPO) — second, after IE lands
- Registrar: [UK Intellectual Property Office](https://www.gov.uk/government/organisations/intellectual-property-office)
- Same classes (42 + 41). Costs are similar (~£170 for one class + £50
  per extra).
- Post-Brexit, an EU mark no longer auto-covers the UK, so a UK filing
  is genuinely needed if we want UK-side protection.

### 1c. European Union (EUIPO) — third, after UK
- Registrar: [EU Intellectual Property Office](https://euipo.europa.eu/)
- Single filing covers all 27 EU member states.
- Cost: **€850 for one class**, +€50 for a second, +€150 for each further.
  So €900 for the 42 + 41 pair.
- This is the biggest ticket. Only file once IE + UK marks are stable
  and we've confirmed no third-party opposition.

**Total budget:** €200 (IE) + £200 (UK) + €900 (EU) ≈ **€1,300** spread
over 6–12 months. Solo indie founder budget line, not investor-scale.

**Solicitor vs DIY:** the IE and UK filings are DIY-able through the
online portals with the classification pre-picked as above. The EU one
is where hiring a trademark attorney (~€300–500 flat fee) pays off,
because oppositions from EU incumbents are more common and drafting
the specification to survive them is a specialist job.

---

## Action 2 — Confirm domain registration is under a real legal entity

`onfolio.press` should be registered in a name that can hold a trademark
and be a party to legal correspondence, not "Jacob Siler" as a private
individual (which is legally fine but gives us no separation between
personal and business exposure).

**What to verify:**
- Run `whois onfolio.press` and check the registrant field.
- If it currently shows Jacob individually, decide between:
  - **Option A** — leave as-is. Fine for pre-revenue solo operation.
    Do change it later once there's a Ltd / LLC.
  - **Option B** — set up a lightweight legal entity now (e.g. Irish
    Limited company, ~€200 to incorporate, ~€60/year to maintain) and
    transfer the domain into that entity's name.

Option B is the right long-term move but there's no urgency until Folio
starts earning revenue at a scale where the accounting hassle of
running it as a sole-trader exceeds the €260/year cost of the Ltd.

---

## Action 3 — Mobile app naming for Play Store / App Store

The web brand stays **"Folio"** on onfolio.press. The mobile app title
should differentiate to avoid store-side confusion / rejection.

**Recommended app titles (any of these work, pick one):**
- **"Folio Publishing"** — clearest positioning.
- **"Folio Press"** — matches the /press marketing surface.
- **"Folio for Authors"** — most explicit market signal.

This is exactly the pattern Amazon uses: web brand is "Amazon", but the
publishing tool is "**Kindle Direct Publishing**" — same brand family,
disambiguated in the store listing.

The store listing description can then lead with "Folio — publish
beautiful books from your phone" so the shortname is still prominent
in search results, without triggering a naming collision with the
existing comic reader app.

**Icon:** use the existing Folio icon (`/icon.svg` in the repo, also
the source for the PWA maskable icon). Same visual mark across web,
PWA, and native app builds. Distinguishable app TITLE, unified visual
IDENTITY.

---

## What "low risk" specifically means

- The other app is a **reader**, not a publishing tool. Trademark law
  weighs "likelihood of consumer confusion" — a reader looking for
  ebooks and an author looking to publish are not the same consumer.
- No known trademark filing by them. `com.mathcrave.folio` reads like
  a hobbyist / small-team release; no legal counsel signalled.
- Our positioning (author-facing, paywall + shelf, web-first) is
  clearly distinguished by product surface.
- We would be filing FIRST in our own jurisdictions if we act soon —
  which puts us in the strong position for any future dispute.

The risk we're defending against isn't them suing us today; it's them
(or someone else adjacent) filing a mark that later hems in our
freedom to trademark in our own preferred classes.

---

## Sequencing note

This whole track sits **behind Stages 3.5 (Author Profile) and 3.6
(BISAC)** in the runbook. Nothing here is a launch blocker. But when
the mobile app work starts, revisit this doc — the Play Store title
choice depends on what we filed in Action 1 and what's registered.

---

## Log

- 2026-08-11 — Jacob observed Play Store app during a search. Filed
  this doc. No further action.
