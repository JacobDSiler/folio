# Tomorrow's runbook

A staged plan you can work through in order. Each stage builds on the previous.
Time estimates are your working time, not wall-clock (deploys + tests happen inline).

---

## STAGE 0 — Morning warm-up (10 min)

Before touching anything, know where things stand.

```bash
cd C:\dev\folio
git log --oneline -3
git status --short
```

Confirm the last commit shipped everything from today's session (should mention imprint theme, wallpaper, admin console, product photos, KDP import, Papermint, comp duration, founding chip, press compatibility). If it does — deploys are current. If not — the pending changes need to ship first (Stage 1).

Open DevTools console on `https://www.onfolio.press` and click through:
- `/shelf` — pending listings should NOT be visible unless you're signed in as owner
- `/admin/` — six tiles, all clickable
- `/admin/shelf/` — pending queue populated
- `/press/photos/` — templates picker shows both canvas + Adobe Stock rows
- `/press/import/` — KDP import page loads, asks for sign-in

Note what's broken. Everything broken becomes Stage 2 work.

---

## STAGE 1 — Ship the pending batch (15 min)

If Stage 0 showed the last commit is older than today, deploy first.

```bash
cd C:\dev\folio
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-2026-07-07.ps1
```

Then the worker (has today's KDP import endpoint + press-status stash for photo Imprint gating):

```bash
wrangler deploy
```

If wrangler complains about being in the wrong directory or about the vars diff, see the notes in earlier sessions — cd to `C:\dev\folio`, and check that `PAYWALL_JWT_SECRET` and `PHOTO_PRICE_USD` are stored as secrets not vars.

**Firebase Storage checks** — separately, in the browser:
1. Verify the two PSDTs uploaded to `photo_templates/` (Firebase Console → Storage)
2. Verify the storage bucket has CORS set for onfolio.press (from earlier gsutil work)

---

## STAGE 2 — Fix the shelf air-gap (30–45 min)

**What you reported:** unapproved content is showing on the public shelf before you approve it in `/admin/shelf/`.

**Diagnosis to run in DevTools console on `/shelf`:**

```js
// See what folios were fetched
console.log('viewer uid:', window._shelfViewerUid);
console.log('total folios:', window._allFolios.length);
window._allFolios.forEach(f => {
  console.log(f.title, '· pending:', f.shelfPendingModeration, '· owner:', f.uid.slice(0,8));
});
```

Expected reality: any row where `pending: true` AND `owner ≠ viewer uid` should have been filtered out before render. If those rows ARE visible on the public shelf, the filter isn't working.

**Two likely root causes:**

1. **Existing folios don't have `shelfPendingModeration` at all** — they were published before I added the flag. `undefined !== true` so the filter passes them through as if approved. That's actually intentional (backwards compat), but if you want ALL current listings to route through moderation once, we need a one-time backfill migration.

2. **Filter check is dropped or the shelf.html deploy is stale** — verify the shelf.html on the live site contains the string `shelfPendingModeration === true`. If it doesn't, the truncation bug ate it; restore from HEAD and redeploy.

**Fix plan by root cause:**

- **If (1) — existing folios don't have the flag** — decide: leave existing folios as-approved (least friction, easy), OR run a one-time backfill in Firebase Console setting `shelfPendingModeration: true` on every folio_projects doc where the field is missing. The backfill puts everything through moderation but takes 15 min of clicking. I'd suggest leaving existing as approved and only new/republished ones going through the queue.

- **If (2) — filter is missing from live site** — I'll restore + redeploy. Ping me the DevTools log and I'll act.

**Also verify /admin/shelf/ shows the pending items** — if it shows nothing but the public shelf shows them, that's the OPPOSITE of what we want and pin-points that the pending flag ISN'T being written on publish.

---

## STAGE 3 — Comp yourself + family + first test (45 min)

Now the platform is stable, test the founding-contributor flow end-to-end.

1. `/admin/press/` → grant yourself Imprint for 12 months + tick the Founding contributor box
2. Refresh `/imprint/?uid=<your-uid>` → confirm the ✨ Founding contributor chip appears below your name
3. Refresh `/press/photos/` → confirm the Download button says "Download PNG" (not "Buy PNG ($3)")
4. Send the family invites (message drafts from earlier in this chat):
   - Sister + Phillip
   - Brother + wife
   - Mom
5. Grant each of them the same 12-month Imprint + Founding comp when they say yes

**Rate yourself here.** If any of that felt clunky, note it — those are the papercuts David and mailing list readers will hit. Fix before Stage 4.

---

## STAGE 3.5 — Author profile surface on imprint page (90 min)

**Why here, not later** — family members will want to fill in bio/photo before
the mailing list wave brings strangers. Slotting this between the family cohort
test (Stage 3) and the mailing list send (Stage 4) means the launch email brings
readers to complete author pages, not identity-less bookshelves.

Concrete work:

1. Extend `folio_imprint_themes/{uid}` schema with `tagline`, `bio`, `bioFull`, `photoUrl`, `links` (see notes in chat for max lengths). No backfill — existing users get empty fields until they fill them in.
2. Add author profile section to `/imprint/index.html` — compact avatar + tagline + 1-2 sentence bio + link icons row, sits between the action buttons and the folios grid. "About the author →" opens a modal with the fuller bio + larger photo + all links.
3. Add editing UI. Option A: extend the existing customize modal in app.html (Indie+ tier already gets custom styling; author profile is arguably even more foundational — probably wants to be Free-tier). Option B: dedicated `/admin/authors/` page for authors to edit their own profile, or a "Profile" tab in the editor sidebar.
4. Firestore rule: `folio_imprint_themes` already has public read + owner write, so no rule change needed.

**Ordering within this stage:**
1. Ship schema + imprint page render (visible for empty state — validates the flow before committing to an editor UI)
2. Ship editor UI so authors can actually fill their profiles
3. Fill in yours (Jacob) first — sets a visual reference for what "good" looks like
4. Prompt family cohort to fill theirs before sending Stage 4 mailing list

## STAGE 3.6 — Classification + power-tags (SHIPPED 2026-08-03)

See `docs/BISAC_CLASSIFICATION_PLAN.md` v2 for the design (open-taxonomy
+ power-tag pivot away from paid BISAC).

**What shipped in this batch:**

- `docs/folio-taxonomy.json` — 37-entry Folio-owned classification with
  legacy `shelfGenre` mapping tables both directions.
- Release modal: new Genre + Tags picker (primary + up to 4
  secondaries + free-text tags with autocomplete suggestions per
  primary genre). Suggest-on-open banner offers to convert legacy
  `shelfGenre` on next edit.
- Save/hydrate: `release.genreCodes[]` + `release.tags[]` fields.
  Legacy `shelfGenre` auto-derived from `genreCodes[0]` via
  reverse-map so the old shelf Genre dropdown keeps working.
- Shelf card: primary genre label from `genreCodes[0]` (falls back
  to legacy shelfGenre); top-3 tag pill row below the foot; each
  tag pill links to `/shelf?tag=<tag>`.
- Shelf filter row: new **With any of** / **Hide any** tag inputs
  with ANY-OF include semantics and NONE-OF exclude semantics.
  `?tag=X` and `?nottag=X` URL params supported for link-in flows.

**The Kept Hour test to run once deployed** (from the plan doc,
step 9): filter shelf with Include tag `spicy` — The Kept Hour
should NOT appear (because it's tagged `no-explicit-content`, not
`spicy`). If it DOES appear, authorial intent isn't being respected
and we've regressed.

**Deferred to a follow-up session:**

- Multi-select Genre popover with INCLUDE (ANY/ALL) + EXCLUDE
  operators (right now the Genre dropdown stays single-select via
  legacy `shelfGenre`). The tag filter carries the power-user
  story for MVP; genre multi-select is polish.
- Tag autocomplete against existing tags across the shelf (right
  now suggestions are a curated per-primary-genre starter list).
  Needs a small aggregation pass over `_allFolios` once shelves
  are populated enough to be interesting.
- Public folio-page (`/app.html?read=...`) render of primary +
  secondaries + tags row.
- Admin surfaces (`/admin/shelf/` moderation card gets a small
  "+2 codes · 5 tags" summary).

---

## STAGE 3.7 — Perpetual (lifetime) tier — DESIGN LOGGED (2026-08-11)

Log-the-intent pass only; no build yet. See `docs/PERPETUAL_TIER_PLAN.md`
for the full spec covering pricing (36× monthly Imprint locked as the
anchor, 2026-08-11), the hard exclusion of consumables (boosts, any
per-use allowance), one-time-value bonuses (Perpetual chip, credits,
feedback channel), admin comp workflow, existing-comp auto-upgrade
rule (Founding Contributors yes, later comps get a discount email),
and grandfathering rules for future price changes.

**Validation path (updated 2026-08-11):** launch to a small early
cohort at 36× and gather structured feedback via a 5-question form
(see spec doc). Iterate before opening to general audience. Skips the
"wait 6 months for aggregate data" gate.

**Pricing (locked 2026-08-11):** Imprint $12/month, Perpetual
launches at **$449** (charm-priced from the $432 baseline; ~37 months
of Imprint). Launch-window discount option: **$369**.

**Do not start build until:** Stage 3.5 (Author Profile) is done.

## STAGE 3.8 — Trademark defence — LOGGED (2026-08-11)

Log-the-intent pass; three defensive actions captured in
`docs/TRADEMARK_DEFENCE.md`.

Existing Play Store app "Folio: Ebook & Comic Reader"
(`com.mathcrave.folio`, 100+ installs, consumer reader — different
market) is low-risk but a formal filing on our side closes a real gap.

**Three actions, sequenced:**

1. File trademark in **Ireland** (IPOI, class 42 SaaS + class 41
   publication services, ~€200). Solo DIY through the online portal.
2. File in **UK** (UKIPO, same classes, ~£200) once IE lands.
3. File in **EU** (EUIPO, ~€900) — worth hiring a trademark attorney
   for this one.
4. Confirm `onfolio.press` WHOIS registrant is a real legal entity
   (consider setting up an Irish Ltd company at revenue milestone).
5. When mobile app ships, use **"Folio Publishing"** or **"Folio
   Press"** or **"Folio for Authors"** as the Play/App Store title;
   web brand stays "Folio" (Amazon → Kindle Direct Publishing pattern).

**Do this before mobile launch, not before web launch.**

---

## STAGE 4 — Mailing list send (60 min)

Content is in `docs/EMAIL_FOLIO_LAUNCH.md`. Read it end-to-end, tweak for anything that feels not-quite-you.

Then in MailerLite:

1. Create a new campaign
2. Duplicate the last-sent campaign's template (cream bg + dark accent button, same footer)
3. Paste the body from EMAIL_FOLIO_LAUNCH.md, use subject #1 ("The reason I went quiet")
4. Set the pull-quote header if you want it
5. Preview send to yourself; check on phone + desktop
6. Segment (writers only, if you have that tag)
7. Schedule for Tuesday or Wednesday at 10am your recipient's local time
8. Send

**Prep for replies:** create a simple email template you can copy-paste for the reply flow:

> Hey {name},
>
> You're in. I've granted your Founding contributor comp — 12 months Imprint tier, free. Head to https://www.onfolio.press, sign in with Google, and your subscription's already active. Your Founding chip goes live once you publish your first folio.
>
> Ping me if anything's confusing. Enjoy.
>
> — Jacob

Save that as an email template in Gmail. When "in" replies land, comp them via `/admin/press/` (30 sec each) then send the template reply.

Track: aim for 20-50 replies. If it lands lower, iterate on subject line for Stage 5.

---

## STAGE 5 — Resonance Kickstarter follow-up (send when pre-launch is live)

**Not tomorrow.** Send this after the Kickstarter pre-launch link exists. Rough sequence to have ready:

1. Kickstarter pre-launch draft is at "Follow to be notified" stage
2. Copy the pre-launch URL
3. Compose a new email — "The book I've been quiet about is on Kickstarter" — reference your previous "there's a new book coming" tease and the current Folio launch email
4. Add the founding-contributor perk: early access to the pledge form 24hr before public launch
5. Send to your mailing list; forward personally to family + friends who Founding-comped

I can draft this email once the Kickstarter takes shape.

---

## STAGE 6 — David Andrew Trotter outreach (Week 2+)

Wait until:
- 10+ folios on the Shelf (family + mailing list wave populated it)
- Some real reviews visible on the welcome page
- Your Resonance Kickstarter is running (gives you an "actively launching things" moment)

Then send the personal message drafted earlier. Include: *"I built a KDP metadata import — I can pull your Amazon backlist into Folio in about 2 minutes with cover art and everything. No copy-paste tedium on your end."*

Test the KDP import against David's Amazon author page BEFORE mentioning it to him — if it returns garbage or nothing, I'll re-tune the parser first.

---

## RISK CHECKLIST (things I want you to know are fragile)

- **VS Code truncation** — biggest bug in this repo. Any edit to app.html or press/photos/index.html is at risk. Close them in VS Code before I edit, or use "Revert File" if you see them shorter than expected. Pre-commit hook catches app.html; I can widen it to check all key files if you want.
- **KDP import parser** — Amazon changes HTML. If a fetch returns weird data next month, ping me + paste the URL. Fixable in ~15 min per parser bug.
- **Firebase Storage PSDTs** — public read, no auth. If someone finds the URL they can download. That's OK for stock templates you licensed, but don't put anything author-private there.
- **The shelf air-gap** — see Stage 2. Address before wide outreach so no half-baked folios embarrass the shelf.
- **Firebase daily-read quota** — free tier is 50k Firestore reads/day. Every shelf load, imprint view, admin dashboard hits Firestore. When you're getting real traffic, watch the Firebase console. Cheap upgrade if you hit it.

---

## DEFERRED (later this week or next week, not tomorrow)

- Localization Phase 1 (data model + editor tab) — see `docs/LOCALIZATION_DESIGN.md`
- Shelf moderation Part 3 — owner nudge chip on publish success, rejection recovery banner
- Getting Started guide for new authors — one-pager walking through create + publish + share
- Papermint Imprint-tier perks (AI covers, bulk export)
- Stock photo mockup expansion — buy 2-3 more Adobe Stock templates after the free ones prove out

---

## IF I HIT TROUBLE

Everything in this batch is in `docs/EMAIL_FOLIO_LAUNCH.md`, `docs/LOCALIZATION_DESIGN.md`, `docs/SHELF_MODERATION_DESIGN.md`, `docs/STOCK_PHOTO_TEMPLATES.md`, `docs/TOMORROW_PLAN.md`. Open the relevant one, follow the steps, ping me with the error message if it doesn't work.

Start with Stage 0. Don't skip to Stage 3 — you'll skip fixes that later stages depend on.
