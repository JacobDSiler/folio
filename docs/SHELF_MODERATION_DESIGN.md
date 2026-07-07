# Shelf Moderation — design for follow-up session

> **Status:** Scaffolding shipped July 2026. Owner-facing pieces (adult-content
> checkbox, `shelfPendingModeration` flag, owner-only pending visibility,
> `folio_roles` collection + `isModerator()` rule helper, `/admin/admins/`
> role management, `/admin/` console) are all live. The follow-up session
> builds the **moderator experience** on top.

## Product intent (from Jacob, verbatim)

- **"No porn on Folio. No real gore, violence, or filth on Folio. That sort of thing."** — hard content policy, not a matter of tiers.
- Adult content tickbox is for **higher ratings** — mature themes, literary
  sexuality, graphic-but-legitimate violence. Ticking it is honesty, not
  authorization to publish prohibited content.
- Moderators approve **before** listings appear publicly. Republishing with
  new images or high-risk text re-airgaps the release into the queue.
- Owners get notified when they publish something that ends up queued so they
  understand why their folio isn't visible on the Shelf yet.

## Data model (already wired in this session)

```
folio_projects/{id}
  release:
    listOnShelf: bool                   // (existing) opt-in for public listing
    shelfPendingModeration: bool        // NEW — true = hidden pending review
    hasAdultContent: bool               // NEW — author 18+ self-declare
    shelfListedAt: number               // (existing) preserved across edits
    shelfApprovedAt: number             // NEW — set by moderator on approve
    shelfRejectedAt: number             // NEW — set by moderator on reject
    shelfRejectionReason: string?       // NEW — short human-readable note
    shelfLastReviewedBy: string?        // NEW — moderator uid audit trail

folio_roles/{uid}                       // NEW collection
  roles: [ "admin" | "moderator" ]
  displayName: string
  grantedBy: string (uid)
  grantedAt: ISO8601
```

`isAdmin()` in Firestore rules now unions the hardcoded bootstrap list with
the dynamic `folio_roles` collection. `isModerator()` returns true for
anyone with either `admin` OR `moderator` in their roles array.

## Session-N+1 work items

### 1. `/admin/shelf/` — moderator dashboard

Mirrors `/admin/reviews/` structure:

- Tabs: **Pending** (default) / Approved / Rejected / All
- List renders one card per pending listing with:
  - Cover thumbnail (loaded from `release.coverUrl`)
  - Title, author, genre, adult flag, published date
  - "Open in reader" link (opens the actual `/read/?fid=…`)
  - **Approve** — sets `shelfPendingModeration=false`, `shelfApprovedAt=Date.now()`,
    `shelfLastReviewedBy=modUid`
  - **Reject** — prompts for a short reason, sets `shelfPendingModeration=false`
    (so it stops appearing in the pending queue), `shelfRejectedAt=Date.now()`,
    `shelfRejectionReason=reason`, `listOnShelf=false` (kicks it off the Shelf
    even if `shelfPendingModeration` flips back), `shelfLastReviewedBy=modUid`
  - "Republish air-gap" is automatic: because `shelfPendingModeration` is
    always set to `true` on publish whenever `listOnShelf` is checked
    (in `app.html` line ~19660), any re-edit puts it back in the queue.

Query: `where('release.listOnShelf', '==', true).where('release.shelfPendingModeration', '==', true).orderBy('release.publishedAt', 'desc')`
— composite index needed; Firebase Console auto-suggests it on first run.

Auth gate: `isModerator()` check (via `folio_roles` doc lookup) — admins
inherit access; pure-moderators also allowed.

### 2. `/policy/` — content policy page (public)

Static markdown-rendered page under `docs/content-policy.md`, mounted at
`/policy/`. Structure:

- **What's allowed** — the whole point of Folio: literary fiction, memoir,
  poetry, essays, self-help, business, YA, romance, thriller, horror, etc.
  Adult themes welcome behind the 🔞 flag.
- **What's not allowed** (verbatim from Jacob): pornographic content, real-world
  gore, content that exists purely to shock or degrade. Reasoned: Folio is a
  publisher-facing platform; discovery surfaces have to be approachable for
  browsers of any age or background.
- **What we do about it** — pre-moderation for the Shelf, takedowns for
  violations, account restrictions for repeated violations.
- **Appeals** — email `folio@jacobsiler.com` (or whatever address you want).

The release modal already links to `/policy/` in the "Not allowed" callout.

### 3. Owner notification on publish (moderation nudge)

When the user publishes with `listOnShelf=true`, the confirmation panel
already shows a success message. Add a follow-up chip when
`shelfPendingModeration=true`:

> "Your release is in the moderation queue and will appear on the Shelf
> shortly after review. You'll still be able to see your own listing while
> it waits."

If it's flagged adult content, add a second chip:

> "You marked this as adult content — moderators will confirm the
> classification. If you accidentally ticked it, un-tick and republish."

Nothing to build here in the worker — pure client message driven off the
`shelfPendingModeration` value in the doc snapshot.

### 4. High-risk publish confirmation (optional Session-N+2)

If we want a friction step, add a pre-publish check: if `hasAdultContent=true`
or the manuscript exceeds N images uploaded in the last edit, show a modal:

> "This release will enter the Folio moderation queue before appearing on
> the Shelf. Review our [content policy](/policy/). Do you confirm the
> content follows the rules?"

Cheap to add; delays only the intentionally-high-risk publishes. Deferred
because in Session-N+1 the Shelf audience is still small and Jacob can
personally moderate the queue.

### 5. Firestore composite index

Needed for the pending queue:

```
Collection: folio_projects
Fields:
  release.listOnShelf          Ascending
  release.shelfPendingModeration  Ascending
  release.publishedAt          Descending
```

Firebase Console auto-suggests it on first run of the moderator dashboard.

### 6. Shelf render tweak — 🔞 badge

`shelf.html` already pulls `hasAdultContent` per folio; wire the render
to show a small 🔞 chip next to the title on adult-flagged cards. Optional
"hide adult content" toggle in the Shelf's filter row for readers who
want a filtered view (defaults to visible-with-badge).

### 7. Rejection recovery UX

When a release is rejected, `listOnShelf` is force-set to `false`. The next
time the owner opens the release modal, they see:

- A red banner at the top: "Your Shelf listing was declined on {date}.
  Reason: {shelfRejectionReason}. Adjust the content and re-tick 'List on
  the Folio Shelf' to submit for re-review."
- The Shelf tickbox is un-ticked (matching the actual state).

Purely client-side, driven off the fields the moderator wrote.

## Session-N+1 deploy sequence

Once the above is built:

1. `firebase deploy --only firestore:rules` — no new rules; the isModerator()
   already covers the shelf/admin surfaces via existing patterns.
2. Firebase Console → Indexes → accept the composite index prompt.
3. `git push` — GitHub Pages serves the new `/admin/shelf/` and `/policy/`.
4. Grant a test moderator role via `/admin/admins/`, sign in as them, walk
   the approve + reject flow end-to-end.
