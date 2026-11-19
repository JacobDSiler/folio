# Folio Junior

Family-linked kid accounts for Folio. Local-first, guardian-gated, built because
the Shelf and Guild were never designed for children and I want a safe route
instead of opening those to kids.

Owner / primary author: Jacob Siler. Phase 1a shipped 2026-11-19.

## Core concept

- A **Junior** is a profile that lives under an adult Folio user's Firebase
  Auth session. Juniors do **not** get their own Firebase Auth account.
- The adult is the **guardian** — the Firebase Auth UID is always theirs.
  The Junior "signs in" by picking their tile on the guardian's signed-in
  device and entering a short PIN.
- All Firestore rules just check "is the authenticated user this Junior's
  guardian?" — no second auth account, no credential recovery for kids, no
  password reset emails for 7-year-olds.

## Data model

### `folio_juniors/{juniorId}`
Guardian-owned profile doc.
```
guardianUid:        string                    # the Firebase Auth uid
harborLearnerId:    string | null             # idempotent import key (Phase 1b)
name:               string
avatar:             string
birthYear:          number
pinSalt, pinHash:   string                    # PBKDF2(SHA-256), 100k iter
perms: {                                      # defaults all false
  canShareExternally:  bool
  canExportToThirdParty: bool
  canUseAi:            bool
  canDictate:          bool
  canUseGuild:         bool                   # kept false in Phase 1a
}
paused:             bool
createdAt / updatedAt: timestamp
```

### `folio_juniors/{juniorId}/approvals/{approvalId}`
Append-only audit ledger. Nothing is ever updated or deleted. Revocation is
a new doc with `decision: 'revoked'` that references the original.
```
kind:         'share-to-shelf' | 'share-link' | 'export' | 'print'
            | 'ai' | 'dictation' | 'guild'
target:       string                          # folio id, feature name, etc.
decision:     'approved' | 'declined' | 'revoked'
guardianUid:  string                          # audit — who approved
at:           timestamp
note:         string?                         # guardian's reason
revokes:      approvalId?                     # if a revocation, pointer to the original
```

### `folio_projects/{id}` — new field
```
juniorId:     string | null
release.juniorShareApprovalId: string | null  # matches an approval doc
```

Adult folios have `juniorId: null` and behave exactly as before.

## Rules architecture

See `docs/firestore.rules` for the actual rules + the three helpers:
`isJuniorGuardian(juniorId)`, `hasJuniorShelfApproval(juniorId, folioId, approvalId)`,
`hasJuniorShareApproval(juniorId, folioId)`.

### Three safety invariants (Phase 1a)

1. **Junior work cannot be flipped `listOnShelf=true` without a matching,
   approved, un-revoked approvals doc of kind `share-to-shelf` for that
   specific folio.** Enforced by `hasJuniorShelfApproval()` in the
   `folio_projects` update rule.
2. **Signed share tokens (`/s/` links) cannot be created on a Junior folio
   without the Junior profile existing, and a client-side flow that
   writes the `share-link` approval first.**
3. **Only the guardian can read, write, update, or delete a Junior profile
   OR their approvals ledger.** No admin write access — abuse cases go
   through legal process, not a silent takeover.

Run `npx mocha docs/firestore.rules.test.js --timeout 10000` against the
Firebase emulator (`firebase emulators:start --only firestore`) to prove
the three invariants hold on every rules change.

## Client architecture

- `window._user` — always the guardian's Firebase Auth user. Never swaps
  identity at the Auth layer.
- `window._activeJunior` — the Junior profile currently in control, or
  `null` meaning the guardian is working on their own folios.
- Writes stamp `juniorId: _activeJunior.id` on new folios when non-null.
- Reads filter the sidebar folio list by juniorId.
- Switching Juniors or returning to the guardian goes through the profile
  picker modal; the Junior path requires the PIN.

## Guild

Phase 1a — **hard-blocked** for all Juniors. The Guild landing (`guild/`)
and Swap board are not reachable from a Junior session. No per-Junior toggle
yet. Phase 4 (separate project) designs the supervised Guild: moderated
posts, no DMs, no open directory, age-appropriate interaction, kid-safe
mod pipeline. Nothing in Phase 1a locks us out of adding that later.

## Dictation + Notes

Phase 2 (dictation, for everyone) and Phase 3 (Author's Notes drawer) land
on top of this. Dictation for Juniors is default off; guardian can approve
per-Junior, and the approval writes a `dictation` approvals doc. Notes
inherit the folio's ownership and are excluded from every export surface.

## Privacy + legal

- `junior/privacy/index.html` — the plain-language privacy notice.
- Ireland (GDPR, digital age of consent 16) + US (COPPA) users supported;
  the privacy page explains both.
- Data minimisation: first name, avatar, birth year, grade (if imported),
  works. No analytics, no third-party trackers on Junior pages, ever.
- Guardian can export all data for a Junior (one-click JSON dump with
  folios + approvals + profile) and delete all data (recursive delete of
  the Junior profile + their folios + their approvals).
- **I am not a lawyer. Have a solicitor review before onboarding non-family
  users.** The page says this in plain language too.

## Phase 1b (next)

Harbor family-code import via a `harbor-bridge-worker.js` on the
`homeschool-math` Firebase project. Endpoint: `POST /import { familyCode, parentPin }`
→ validates PIN hash against `families/{code}.parentPin` → returns the
sanitized profiles. Folio's "Link Harbor family" button calls it, matches
by `harborLearnerId`, and renames stay safe.

Design-locked but not yet written. See the deploy-tick entry from
2026-11-17 for the project-split reasoning.
