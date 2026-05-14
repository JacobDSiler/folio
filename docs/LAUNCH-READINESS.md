# Folio — Launch-Readiness Audit

**Date:** 15 May 2026
**Target:** Public launch (anyone can find and use Folio — highest bar)
**Method:** Thorough re-read of the risky code paths — Firestore/Storage
access, reader isolation, paywall enforcement, cloud-save integrity.

---

## Verdict

**Not ready for a public launch yet — but close, and the gaps are
well-defined.** The core experience is solid: the editor, the reader,
serial releases, the paid-folio paywall *flow*, audiobook sync, and the
new email cron all work. What's blocking is a cluster of five items —
mostly security hardening and one real data-loss bug — that a private
or friends-and-family launch could tolerate but a *public* launch
cannot. None of them is large. A focused day of work clears the
blockers; the paywall is a business decision rather than a bug.

---

## What's solid (verified this audit)

These were re-read against the actual code and hold up:

- **Reader isolation.** The `← Editor` escalation is genuinely closed —
  two independent gates, both keyed on the real Firebase auth uid, not
  on anything in the URL. A non-owner cannot reach the editor or another
  folio's source through it.
- **URL `?role=` is harmless.** The `reader|beta|editor` qualifier is
  trusted from the URL, but it confers no real privilege — no editing,
  and any write is gated server-side by ownership. It only changes a
  label and which annotation scopes render. (It *does* become the
  exploit path for the annotation leak below — but fixing that fixes
  this too.)
- **Save round-trip for text content.** The `_state`/pronunciations/
  characters/writing-goal bug is genuinely fixed — those fields now
  serialise and rehydrate correctly.
- **Local backup is conservatively correct.** The recovery banner/pill
  errs toward *showing* a restore — it will never silently hide one
  when you actually have unsaved work.
- **Cloud write order.** Parent-doc-first, body-second — correct for the
  Firestore rule dependency.
- **The email cron.** Smoke-tested live: authenticates to Firestore,
  reads all folios, finds serials, baselines correctly, `errors: []`.
- **`chapterCount`** is a top-level parent-doc field, so the cron's
  dependency on it is satisfied.

---

## Launch blockers (must fix before public launch)

Ordered by priority.

### B1 — Firestore + Storage security rules

**The single most important item.** There is no `firestore.rules` or
`storage.rules` file in the repo, and no complete documented ruleset.
Whatever rules are live exist only in the Firebase console and cannot be
verified from here.

For a public launch the rules must guarantee: a non-owner can read a
*published* folio (reader mode needs this) but **cannot** read an
unpublished manuscript, and cannot write to or delete any folio they
don't own. Right now that guarantee is unproven — and the reader-mode
code explicitly assumes rules were *loosened* to allow public reads, so
the risk is that they were loosened too far.

Draft rules have been written to `docs/firestore.rules` and
`docs/storage.rules` as a starting point. They need review and live
testing (load a published reader link logged out; confirm a guessed
unpublished id is denied) before they're trustworthy.

### B2 — Cover image and chapter images are not saved

`_serialise` does not include `S.images` or `S.coverImg`. Any author who
adds a cover or chapter art **loses all of it on the next cloud
save→reload.** This is guaranteed, silent data loss — and cover art is
something most authors will use immediately. Code fix in `app.html`:
add both to `_serialise`, rehydrate in `_deserialise`. (Watch the 1 MiB
body cap — images may push some folios near it; may need to confirm
images belong in the body blob vs. Storage.)

### B3 — Autosave failures are silent

`_doAutoSave`'s failure path only does a `console.warn`. An author can
edit for an hour with every autosave failing and see nothing but a
subtle "● Unsaved" pill. They will believe their work is saved when it
isn't. (Permission errors *are* surfaced loudly — but network, quota,
and transient errors fall through to the silent path.) Code fix in
`app.html`: make a failed autosave visible — a toast and/or a persistent
banner, and keep the cloud badge red.

### B4 — Private annotations leak to every reader

`_annSubscribe` subscribes to the *entire* annotations subcollection
with no filter. Every annotation — personal notes, editorial comments,
collaborator notes — is downloaded into every reader's browser, and the
scope filtering happens only in client-side JS. A reader who opens
DevTools (or sets `?role=editor`) can read the author's private notes.

Rules alone can't fix this — Firestore rules can gate the collection but
not per-scope visibility. The real fix is structural: split annotation
scopes into separate subcollections so rules *can* gate them (e.g.
`annotations_public` readable by all, `annotations_private` owner-only).
Needs a small design decision before it's coded.

### B5 — Subscriber unsubscribe vs. locked-down rules

The public subscribe form needs anyone to be able to *create* a
subscriber doc — fine. But the current in-app unsubscribe page *queries*
the subscribers subcollection by token as an anonymous user, and
`_subList` reads the whole subcollection. Safe rules must restrict
subscriber reads to the owner (otherwise anyone can harvest every
subscriber's email) — and that **breaks the current unsubscribe flow.**

The clean fix: move unsubscribe server-side into the email worker, which
already has Firestore access via its service account (added for the
cron). Then the locked-down `subscribers` rule and the worker endpoint
ship together. Until both are ready, the subscribers rule has to stay
open — a known email-harvest risk.

---

## Risks & decisions (your call, not blockers)

### D1 — The paywall is not DRM

This is a positioning decision, not a bug. As built, the paywall is
honest-person protection only:

- The client never verifies the license JWT's signature — it only
  base64-decodes the payload and checks the expiry. It *can't* verify
  the signature; it has no secret. A technical user can hand-craft a
  token in localStorage and unlock everything without buying.
- More fundamentally, the **entire manuscript ships to every reader's
  browser** in one Firestore read. Paid chapters are merely hidden with
  a CSS class. The text is right there in DevTools regardless of any
  token check.

Three honest options:

1. **Accept it.** Fine for low-price or goodwill ("supporter access")
   sales. Most readers will never crack DevTools. Just don't market it
   as protection.
2. **Document it.** Tell authors plainly: paid content is *gated*, not
   *encrypted*. Set expectations.
3. **Harden it.** The only real fix is to withhold paid chapter bodies
   server-side — store locked chapters behind the worker (or in a
   separate Firestore path) that requires a `/check`-verified token to
   fetch. That's a genuine architecture loop, not a quick patch.

Recommendation: **(1) + (2) for launch** — accept it, document it for
authors — and put (3) on the post-launch roadmap if paid folios become a
real revenue stream.

### D2 — Non-atomic cloud write

The parent doc is written before the body subdoc, and there's no
transaction and no rollback. A crash *between* the two writes leaves the
cloud folio internally inconsistent (parent says `chapterCount: 12`,
body is stale). The user's data isn't lost — the local backup is written
first — but the cloud doc is left wrong, and the body write currently
gets *zero* retries. Worth a small hardening pass (retry the body write;
consider a consistency flag) but it's a lower-tier risk than B1–B5.

---

## Polish (acceptable for v1, fix when convenient)

- **Recovery pill nags after a successful save.** `_loadedFolioUpdatedAt`
  is never refreshed post-save, so the "restore backup" pill can keep
  appearing for a backup that's already safely in the cloud. Cosmetic.
- **Manual-save failure is quiet.** A failed manual save shows only in
  the passive status bar — no toast — while success gets a green toast.
  Asymmetric; upgrade the failure to a toast.
- **`folio-lulu/` Storage path** has no per-user prefix, so it can only
  be scoped to "any signed-in user." Re-path to `folio-lulu/{uid}/...`
  to allow owner-scoping.

---

## Tomorrow's roadmap — a sequenced day to clear the blockers

A realistic order. Items within a block can be batched into one
edit/push loop.

**1. Morning — Firestore & Storage rules (B1).**
Review and finalise `docs/firestore.rules` + `docs/storage.rules`. You
apply them in the Firebase console and test: published reader link works
logged-out; a guessed unpublished id is denied; a non-owner can't write.
Keep the `subscribers` rule open for now (B5 lands with the worker this
afternoon). This is foundational — it unblocks everything else.

**2. Midday — app.html save-integrity loop (B2 + B3 + D2 + polish).**
One code loop, batched:
- Add `images` / `coverImg` to `_serialise` + `_deserialise` (B2).
- Make autosave failure visible — toast + persistent banner (B3).
- Refresh `_loadedFolioUpdatedAt` after a successful save (kills the
  nag) and upgrade manual-save-failure to a toast (polish).
- Add a retry to the body write in `_writeFolioCloud` (D2).

**3. Afternoon — email worker `/unsubscribe` endpoint (B5).**
Add a server-side unsubscribe handler to `folio-email-worker.js` (it
already has Firestore access via the service account). Point the in-app
unsubscribe page at it. Then tighten the `subscribers` rule to
owner-only read and re-apply.

**4. Decision point — paywall posture (D1) + annotation scopes (B4).**
Two calls to make:
- Paywall: accept + document, or schedule the hardening loop?
- Annotations: decide whether the private-annotation leak matters for
  your launch. If yes, it's a structural change (split scopes into
  subcollections) — scope it as its own loop.

**5. Final pass — smoke test.**
Logged-out reader link (free, serial, paid). Add a cover image, save,
reload, confirm it survives. Subscribe + unsubscribe end to end. Trigger
the cron once more. Then ship.

---

## Appendix — findings → code locations

| ID | Finding | Location |
|----|---------|----------|
| B1 | No rules in repo; live rules unverified | `docs/firestore.rules`, `docs/storage.rules` (drafts) |
| B2 | `images`/`coverImg` not serialised | `app.html` `_serialise` (~4051), `_deserialise` (~4104) |
| B3 | Silent autosave failure | `app.html` `_doAutoSave` (~3259, catch ~3304) |
| B4 | Unfiltered annotation subscription | `app.html` `_annSubscribe` (~15263); scope filter `_scopeIsVisible` (~15049) |
| B5 | Unsubscribe needs subcollection read | `app.html` `_subList` (~12274), `_subUnsubscribeByToken` (~12289) |
| D1 | Client never verifies JWT signature | `app.html` `_pwIsValid`/`_pwDecode` (~13683); worker `/check` is unused |
| D1 | Full manuscript ships to browser | `app.html` `loadFolioById` → `_readDocState` (~4016); `_pwShowPreview` hides with CSS (~13956) |
| D2 | Non-atomic write, no body retry | `app.html` `_writeFolioCloud` (~3975, parent ~3984, body ~4004) |
| Polish | `_loadedFolioUpdatedAt` not refreshed post-save | `app.html` (set only in `loadFolioById` ~4672) |

*Line numbers are approximate — the audit was run against app.html as of
this date; they drift as the file changes.*
