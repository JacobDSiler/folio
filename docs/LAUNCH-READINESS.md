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

### B1 — Firestore + Storage security rules · RULES NOW FINALISED

**The single most important item.** There was no `firestore.rules` or
`storage.rules` in the repo, and no complete documented ruleset — the
live rules existed only in the Firebase console, unverifiable.

For a public launch the rules must guarantee: a non-owner can read a
*published* folio (reader mode needs this) but **cannot** read an
unpublished manuscript, and cannot write to or delete any folio they
don't own.

**Status: done, pending apply + test.** Every Firestore and Storage call
site in `app.html` was read and mapped, and a complete, verified ruleset
is now in `docs/firestore.rules` and `docs/storage.rules`. The
verification caught two real bugs in the first draft — a `lulu_jobs` rule
that referenced the wrong `resource` object (would have broken reading
job history) and an over-strict `uid`-unchanged check (would have blocked
release-publishing, since the `{release: …}` merge-write omits `uid`).
One rule — `subscribers` read/delete — is deliberately left open as a
same-day interim; see B5. The remaining step is applying the rules in the
console and testing — see "Applying these rules" below.

### B2 — Cover / chapter images may not be saved · NEEDS VERIFICATION

**Flagged from prior context — not yet confirmed against current code.**
The concern: `_serialise` may not include `S.images` / `S.coverImg`, which
would mean an author who adds a cover or chapter art loses it on the next
cloud save→reload. If real, that's guaranteed silent data loss. **The
first step of the midday loop is to verify this against the actual
`_serialise` / `_deserialise` code** — then fix if confirmed (add both
fields, rehydrate on load; watch the 1 MiB body cap — images may belong
in Storage rather than the body blob).

### B3 — Autosave failures may be silent · NEEDS VERIFICATION

**Flagged from prior context — not yet confirmed against current code.**
The concern: `_doAutoSave`'s failure path may only `console.warn`, so an
author could edit for an hour with every autosave failing and see nothing
but a subtle "● Unsaved" pill. Permission errors are known to be surfaced
loudly (`_surfaceCloudError`) — the open question is whether network /
quota / transient failures fall through silently. **Verify against the
actual `_doAutoSave` catch path in the midday loop**, then — if confirmed
— make a failed autosave visible (toast + persistent banner, keep the
cloud badge red).

### B4 — Private annotations leak to every reader · DONE

**Status: shipped.** The fix turned out to be a single-subcollection
per-doc rule rather than the structural split I'd flagged. The
Firestore `annotations` rule is now:

    allow read: if isUser(parentUid(id))
              || resource.data.scope == 'public'
              || (request.auth != null
                  && resource.data.uid == request.auth.uid);

The folio owner sees everything (the `parentUid` branch is
collection-level, so unfiltered lists are allowed for owners). For
non-owners, every LIST query must be constrained so each result
satisfies one of the per-doc branches. `_annSubscribe` and
`_annInitFromCloud` were rewritten to run two restricted queries for
non-owners — `where('scope','==','public')` and
`where('uid','==', auth.uid)` — and merge the results into a shared
id-keyed Map so a docChange from one query doesn't clobber the
other's contribution. Editor / collaborator / others' personal
annotations are never read into the browser, so the DevTools leak is
closed. Re-apply `docs/firestore.rules` in the console to pick up
the new rule.

### B5 — Subscriber unsubscribe vs. locked-down rules · DONE

**Status: shipped.** The folio-email worker now exposes
`GET /unsubscribe?token=…&folio=…`, which uses the service account to
find + delete the matching subscriber doc and returns a styled
confirmation page (rate-limited, 20/hr per IP). New chapter emails
point straight at the worker; legacy `?unsubscribe=` app links forward
to the worker too. With unsubscribe off the browser SDK, the
`subscribers` Firestore rule is now `allow read, delete: if isUser(...)`
— the email-harvest / arbitrary-delete risk is closed. Re-apply the
updated `docs/firestore.rules` in the console to pick up the change.

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

### D2 — Non-atomic cloud write · VERIFIED

Confirmed by reading `_writeFolioCloud`. The parent doc is written first
(with one retry on transient errors), then the body subdoc — but the body
write is a single `setDoc` with **no retry at all** (`app.html` ~line
4004), no transaction, and no rollback. A crash or a body-write failure
after the parent succeeds leaves the cloud folio internally inconsistent:
the parent's metadata (e.g. `chapterCount`) runs ahead of the body's
content. The user's own data isn't lost — the local backup is written
first — but the cloud doc sits in a one-version drift until the next
successful save. Worth a small hardening pass (retry the body write to
match the parent; consider a consistency flag). Lower-tier than B1–B5;
folded into the midday loop.

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

## Applying these rules (B1)

The rules live in `docs/firestore.rules` and `docs/storage.rules`. They
go in through the Firebase console — no Firebase CLI needed.

**Apply:**

1. **Firestore.** Firebase console → your project → **Firestore Database**
   → **Rules** tab. Select all, paste the contents of
   `docs/firestore.rules`, click **Publish**.
2. **Storage.** Console → **Storage** → **Rules** tab. Paste
   `docs/storage.rules`, **Publish**.

Both take effect within seconds. The console's Rules Playground can
dry-run individual reads/writes if you want to sanity-check before
publishing.

**Test (do all of these — a few minutes):**

- **Published reader link, logged out.** Open a `?read=<publishedId>`
  link in a private/incognito window. The book must load — text, and
  audio if it has any. This proves public reads work.
- **Unpublished folio is sealed.** In that same logged-out window, try a
  `?read=<id>` for a folio you have *not* published. It must fail to
  load (permission denied), not show the manuscript.
- **No cross-account writes.** Signed in as a different account, confirm
  you cannot edit or delete a folio you don't own. (The app's ownership
  gate should bounce you, but the rule is the real backstop.)
- **Your own editing still works.** Signed in as yourself: create a
  folio, edit, autosave, publish a release, add an annotation, generate
  a version — all should succeed.
- **Subscribe + unsubscribe still work.** On a published serial,
  subscribe with the lock-card form, then use the unsubscribe link in
  the email. Both must work — the `subscribers` rule is the interim-open
  one (B5); this confirms the interim is doing its job until the email
  worker's `/unsubscribe` endpoint replaces it this afternoon.

If the published reader link fails after applying, the most likely cause
is that the published folio's `release.published` field isn't actually
`true` — check the doc in the console.

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
