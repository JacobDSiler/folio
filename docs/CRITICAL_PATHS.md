# Critical paths — client queries → Firestore rule branches

**Purpose.** Every time we ship a new page or refactor a query, this
document should be checked and updated. It is the ground truth for
"which client query relies on which rule branch." When the shelf
broke for anonymous readers on 2026-08-03 and the imprint page broke
the same day, both were the same class of bug: opening the per-doc
GET rule left LIST branches uncovered for two legitimate query
patterns. A table would have surfaced the gap at review time
instead of in production.

**Convention.** Every row lists:

- **Surface** — the page or module (`/shelf`, `/imprint/`,
  `/admin/shelf/`, `app.html sidebar`, etc.)
- **Viewer** — who's making the query (anonymous / signed-in author
  / admin)
- **Query shape** — the actual Firestore `query(...)` with its WHERE
  clauses
- **Rule branch** — the specific line in `docs/firestore.rules` that
  allows this query
- **Notes** — anything gotcha-shaped (index requirements, moderation
  filters, etc.)

**Rule of thumb.** Firestore's `list` rule engine checks that every
returned document satisfies the rule based on the query's WHERE
clauses. If a query needs anonymous access, the WHERE clauses must
constrain results such that the rule can PROVE every result matches.

---

## `folio_projects` — reads

| Surface | Viewer | Query shape | Rule branch | Notes |
|---|---|---|---|---|
| `/shelf` | anon / any | `collection('folio_projects').where('release.listOnShelf','==',true).where('release.published','==',true).limit(200)` | list branch 2 (`listOnShelf==true`) | Client-side additionally filters out `shelfPendingModeration==true` unless viewer is owner. |
| `/imprint/?uid=X` | anon / any | `collection('folio_projects').where('uid','==',X).where('release.published','==',true).limit(200)` | list branch 3 (`published==true`) | Every result carries the target author's uid, but the RULE match happens via `published==true` — that's the branch that allows anon read. |
| `/admin/shelf/` | admin | `collection('folio_projects').where('release.listOnShelf','==',true).limit(300)` | list branch 4 (`isAdmin()`) | Shows pending + rejected + approved. Admin branch bypasses the listOnShelf/published constraints so moderators see everything. |
| `/admin/press/` | admin | `collection('folio_projects').where('release.published','==',true).limit(500)` | list branch 3 (`published==true`) or 4 (`isAdmin`) | Either works — but branch 3 is what makes it functional for a soon-to-be-admin who has bootstrapped but hasn't hit their first admin-only surface yet. |
| app.html sidebar "my folios" | signed-in author | `collection('folio_projects').where('uid','==',<me>).limit(50)` | list branch 1 (`isUser(uid)`) | The classic owner-scoped list. Signed-in-anonymous authors qualify (isUser matches the anon uid). |
| `/app.html?read=<folioId>` | anon / any | `getDoc('folio_projects', <folioId>)` — single-doc GET | `allow get: if true` | Per-doc reads unrestricted. Folio IDs are unguessable (~10^10 combinations). See CLASSIFICATION_PLAN + share-links rationale. |
| Reader mode share links `?share=<JWT>` | anon | same as above — direct getDoc | `allow get: if true` | JWT payload itself is not verified by rules; the URL is the credential. `body/paid` reads still require worker JWT verification. |

## `folio_projects` — writes

| Surface | Viewer | Query | Rule branch | Notes |
|---|---|---|---|---|
| Create a new folio | signed-in author | `setDoc(...)` with `uid: <me>` | `allow create: if isUser(request.resource.data.uid)` | Anonymous OK. If `release.listOnShelf==true` in the write, anonymous is BLOCKED by the anon-shelf-gate branch — signed-in Google required for public listing. |
| Update a folio | owner | `updateDoc(...)` | `allow update: if isUser(resource.data.uid)` OR admin | Same anon-shelf-gate applies to updates that set `release.listOnShelf` to true. |
| Delete | owner | `deleteDoc(...)` | `allow delete: if isUser(resource.data.uid)` | Owner-only; admin cannot delete (safer default). |

## `folio_projects/{id}/body/*`

| Path | Viewer | Rule | Notes |
|---|---|---|---|
| `body/main` | anon / any if `folioVisible(id)` | Same as parent — parent exists = body/main readable | Free preview content. |
| `body/paid` | OWNER only from Firestore | `isUser(parentUid(id))` | Anonymous readers of paid content MUST route through the paywall worker's `/paid-content` endpoint which verifies the JWT server-side and reads via service account. |

## `folio_projects/{id}/subscribers`, `.../reviews`, etc.

Owner reads/writes only for subscribers. Reviews have their own
rules (see firestore.rules line 443 area). Not enumerated here
because they're not part of the anonymous-read critical path — if
these break we notice quickly because they affect admin surfaces
first.

## `folio_user_settings/{uid}`

| Surface | Viewer | Rule | Notes |
|---|---|---|---|
| Author's own settings load | signed-in owner | `isUser(uid)` | Anon can read/write own anon doc (that's how the auto-anon session gets tracked). |
| Cross-user Press subscription check | owner only | `isUser(uid)` | Non-owners never touch other users' settings docs from the client. Admin surfaces read via worker service account. |

## `folio_roles/{uid}` (admin allowlist)

| Surface | Viewer | Rule | Notes |
|---|---|---|---|
| isAdmin() rule helper | recursive | `read: if isUser(uid)` OR admin | Users can read their OWN role doc; the rule helper does the lookup to check for admin role. |
| Admin console `/admin/admins/` | admin | admin bypass | Modifies role assignments; owner-locked. |

## `folio_vendor_owner_configs/{uid}` (multi-tenant vendor creds)

Worker-only via service account. `read, write: if false` from
clients. The Vendor Connections modal in app.html goes through
`POST /vendor-owner-config` (worker endpoint) with a verified
Firebase ID token; the worker validates ownership before touching
the doc.

---

## Adding a new client query — checklist

Before shipping a new page or query, walk this:

1. **What does the query fetch?** Single doc? Filtered collection?
2. **Who runs it?** Anonymous browser? Signed-in author? Admin only?
3. **What's the RULE branch that allows it?** Point to the exact
   line in `docs/firestore.rules`. If no branch fits, either:
   a. Add a branch (be conservative — every branch is an attack
      surface),
   b. Change the query to constrain more strictly,
   c. Route the fetch through the worker with service-account access.
4. **Does the query need a composite index?** Any query with two
   `where` clauses on different fields does. Firebase Console
   auto-suggests these on first live query; deploy the index
   BEFORE the client goes live.
5. **Add a row to this table.** Even if it feels obvious. Future you
   will thank present you.

## Debugging a "Missing or insufficient permissions" error

1. Open DevTools Console on the failing surface.
2. Note the query the client is making. Console logs from
   `[shelf]`, `[imprint]`, `[admin-*]` prefixes surface this.
3. Cross-reference with this table.
4. If the query has NO matching row, that's the gap — add either a
   rule branch or change the query.
5. If the query IS in the table, the rule branch is either not
   deployed (`firebase deploy --only firestore:rules` in the deploy
   script) or was silently regressed (git-blame `docs/firestore.rules`
   for recent commits).

## Recent incidents (~ append as they happen)

- **2026-08-03** — `/shelf` broke for anonymous readers on mobile
  after the `allow get: if true` rule change opened per-doc reads
  but forgot to add a corresponding LIST branch for the shelf
  query. Fixed by adding LIST branch 2 (`listOnShelf==true`).
- **2026-08-03** — `/imprint/?uid=X` broke for anonymous readers
  the same day, discovered separately. Fixed by adding LIST branch
  3 (`published==true`). Should have been caught by this table
  existing at the time; hence this doc.
