# Folio stability plan — from "moving target" to "locked canon"

*Written 2026-07-17, mid-launch. Author: Jacob + Claude.*

## The honest diagnosis

**Folio is not currently modular in a meaningful sense.** Each surface
(`app.html`, `shelf.html`, `imprint/index.html`, every `admin/*` page)
is a single large HTML file with inline `<script>` blocks. When we
touch one file we can't touch another. When we duplicate a helper into
two files (Firebase config, ADMIN_UIDS, author lookup, sign-in gate),
a fix in one place doesn't propagate.

That's why features keep breaking: we're not really building on top
of stable modules — we're re-writing the ground floor every time.

**However**, this is not fatal. Folio doesn't need a full frontend
framework rewrite to reach launch stability. It needs:

1. **A written canon** — what works, what it should do, how to test it
2. **A smoke-test checklist** — run before every deploy
3. **Targeted extraction** — pull the *shared* code (only) into small
   plain-JS files any page can `<script src>` in. No bundler, no
   framework, no build step.

This document defines the first two. The third is already in progress:
`/admin/_shared.js` was just extracted from admin/press and wired into
admin/boost. That pattern is the template.

---

## FEATURE CANON — locked features + how to test them

Each entry is a **contract**. If a deploy breaks any of these, the
deploy should be reverted, not "fixed forward." Signed-off features go
here; new features stay off the list until they've survived one
launch-cohort week without regression.

### CANON A — Publishing + Reading

**A1. Free folio publish + read**
- Author creates folio, sets no price, ticks Publish, gets a shelf listing after moderation.
- Anyone hits `/app.html?read=<id>` and sees the full text.
- **Test:** publish a test folio, open the URL in incognito, verify content shows.

**A2. Paid folio buy + read**
- Author sets price + PayPal product, publishes.
- Reader hits URL → paywall gate → PayPal → returns → content unlocks.
- License token stored client-side survives page reload.
- **Test:** buy a test folio with a sandbox PayPal, refresh, verify still unlocked.

**A3. Free preview (N chapters visible before paywall)**
- Author sets `previewSections: N`, first N chapters visible free.
- Chapter N+1 shows the paywall CTA.
- **Test:** set preview=2 on a 5-chapter folio, verify ch 3 is gated.

**A4. Public teaser chapters (release.teasers)**
- Author ticks specific chapters as public teasers.
- Those chapters visible free even past the preview cutoff.
- **Test:** tick ch 3 + ch 4 as teasers on a 5-chapter paid folio with preview=2. All 4 should be readable free.

**A5. Signed teaser links (`?tt=<token>`)** — *fixed 2026-07-17*
- Author clicks "Copy link" on a NON-teaser chapter. Doesn't modify release.teasers.
- Anyone with the URL can read THAT chapter only. No signup, no payment.
- Revoke: delete the doc in `folio_projects/{id}/signed_teasers/{tt}`.
- Revoke-all: sweep the subcollection.
- **Test:** copy a signed link for ch 3 of a paid folio. Open in incognito. Ch 3 shows text; ch 4 still gated.

### CANON B — Serial releases

**B1. Serial cadence + auto-unlock**
- Author sets serial=true, firstReleaseAt, cadence (weekly / biweekly / monthly).
- Chapters unlock in sequence at the scheduled times.
- Owner sees a "Release next chapter now" button to unlock ahead of schedule.
- **Test:** publish serial with firstReleaseAt=today + weekly. Ch 1 open, ch 2+ locked. Manually release ch 2 with the button — should unlock.

**B2. Serial chapter list scrolls past chapter 5** — *fixed 2026-07-17*
- Sidebar chapter list shows every chapter, scrollbar visible when >5-6 chapters.
- **Test:** load a 10-chapter serial, scroll to ch 10 in the sidebar.

### CANON C — Author identity + imprint

**C1. Imprint page renders (any published author)**
- `/imprint/?uid=<uid>` lists all published folios for that uid.
- Free-tier: default styling.
- Indie+: custom accent, font, wallpaper, hero.
- **Test:** open the imprint URL for a known author, verify folios list.

**C2. Author profile block (bio / photo / links)** — *added 2026-07-17*
- If `folio_imprint_themes/{uid}` has `bio`, `photoUrl`, `bioFull`, `tagline`, or `links`, render them.
- "Read more" opens a modal with the full bio.
- All fields optional; block hides if nothing is set.
- **Test:** seed the fields for a test author, verify block appears on imprint page.

**C3. Founding contributor chip** — *fixed 2026-07-16*
- If theme doc has `foundingContributor: true`, show ✨ chip on imprint.
- Admin grants via `/admin/press/` toggle.
- **Test:** grant founding to a test uid, open their imprint, verify chip shows.

### CANON D — Sign-in + saving

**D1. Google sign-in works AND is visible**
- Persistent auth pill top-right of `/app.html`.
- Signed out: prominent "Sign in with Google" button.
- Signed in: avatar + first name + green ✓ + toast on transition.
- **Test:** sign out, verify amber pill. Sign in, verify green pill + toast.

**D2. Cloud save persists across devices**
- ☁ Save button writes to Firestore.
- Reload the page → work restored.
- Sign in on a different device → same folios listed.
- **Test:** save a folio in one browser, sign in on another device, open "My folios," verify.

**D3. + New folio is non-destructive** — *fixed 2026-07-16*
- If unsaved changes exist, prompt offers to SAVE first.
- **Test:** start unsaved edits, click "+ New folio", verify save-first prompt.

### CANON E — Shelf + moderation

**E1. Air-gap holds — pending folios hidden from non-owners**
- Any folio with `shelfPendingModeration: true` is invisible to non-owners.
- Owner sees their own pending folios (with a ⏳ chip).
- **Test:** unapprove a folio. Owner sees it (with chip). Incognito viewer does NOT.

**E2. Language chip shows on non-English folios**
- Publish sets `release.language` from #bookLang.
- Shelf card shows a 2-letter chip (EN muted, others amber).
- **Test:** publish a folio with language=fr, verify FR chip on shelf.

### CANON F — Admin tools

**F1. Admin console + auth persists across pages**
- `/admin/` lists tiles for each admin surface.
- Signing in once persists across all `/admin/*` pages.
- **Test:** sign in on `/admin/`, navigate to `/admin/press/`, verify still signed in.

**F2. Author lookup by name (Press comp + Boost)** — *fixed 2026-07-17*
- Both Press comp and Boost admin surfaces have a "Look up author by name" widget.
- Typing filters live; clicking auto-fills the UID.
- Widget is shared code (`/admin/_shared.js`) — bugs fixed once, apply everywhere.
- **Test:** on both surfaces, type an author name, verify suggestions + select fills the target.

**F3. Comp length + Founding toggle work correctly**
- Single "Comp length" dropdown (1, 3, 6, 12, 24, 60, 1200 months).
- Founding checkbox writes to both press subscription + imprint theme.
- **Test:** grant a 12-month founding comp, verify durationMonths=12 AND foundingContributor=true on the theme.

---

## PRE-DEPLOY SMOKE-TEST CHECKLIST

Run before EVERY deploy. Time budget: ~5 minutes.

**Part 1 — build integrity (30 seconds):**
- [ ] `.\scripts\deploy-2026-07-07.ps1` up to file-inventory step — no MISS
- [ ] Pre-commit hook passes (worker + app.html + shelf.html tail check)
- [ ] `git status` — every modified file expected

**Part 2 — smoke-test canon (in incognito):**
- [ ] **A1** — open a known-free published folio, content shows
- [ ] **A3** — open a known-paid folio, paywall CTA shows after preview
- [ ] **A5** — open a signed teaser link (keep one saved for tests), content shows
- [ ] **B2** — sidebar chapter list scrollable past ch 5
- [ ] **C1** — imprint page for a test author lists folios
- [ ] **D1** — auth pill top-right visible, sign in works
- [ ] **E1** — pending folio invisible in incognito
- [ ] **F1** — sign into `/admin/`, navigate to `/admin/press/`, still signed in
- [ ] **F2** — author lookup on Press comp AND Boost — both work

**Part 3 — post-deploy verification:**
- [ ] Hard-refresh production `/app.html`, no console errors
- [ ] `/shelf` loads, cards render
- [ ] Sign out + sign back in works

**If any check fails: revert the commit before continuing.**
`git reset --hard HEAD~1 && git push --force-with-lease origin main`

---

## EXTRACTION PATTERN — how new modularization gets added

When you notice the SAME code duplicated across 2+ files, extract it:

1. Create `docs/EXTRACT_<name>.md` (a 1-paragraph "why this extraction")
2. Write `<surface>/_shared.js` (e.g., `admin/_shared.js`, `press/_shared.js`)
   - No dependencies. Plain IIFE. Exports a global namespace.
   - Every function commented with the "what" and the "why"
3. Update the first file to use the shared code (delete the duplicate)
4. Update every other file that had the same code
5. Add a canon entry to this doc naming the shared module

**Do NOT modularize:**
- Anything used in exactly one file (there's no payoff yet)
- Rendering logic tightly coupled to a specific page's DOM
- Anything you don't fully understand — the goal is stability, not
  cleverness

---

## SESSION-BY-SESSION EXTRACTION BACKLOG

Ordered by potential regression pain, not by size.

1. **`/js/firebase-init.js`** — Firebase config + boot pattern (used
   in 8+ files). Highest duplication, highest risk.
2. **`/js/auth-pill.js`** — the persistent auth pill from app.html.
   Reader (`/app.html?read=`), imprint, shelf could all use it.
3. **`/admin/_shared.js` — DONE (2026-07-17)** — author lookup widget.
4. **`/js/moderation-guard.js`** — the shelf pending filter. Could be
   used on imprint page + a future search page.

---

## The bigger truth

The codebase will get worse before it gets better. That's fine.
Launch first, extract second. **This document is what makes that
survivable** — a written record of what MUST work, tested before
every deploy, protects the launch cohort from regressions while
extraction happens in the background.

The Cedarfort author, Thomas, and your family don't care whether
Folio is architecturally beautiful. They care whether the "Sign in
with Google" button works when they click it. This document makes
the answer to that question always be yes.
