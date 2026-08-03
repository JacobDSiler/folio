# Folio classification plan (open taxonomy + power-tags)

**Status:** Design doc, v2. Pivoted away from paid BISAC after Jacob
weighed the ~$225/yr license against the actual problem it solves.
The real problem is fine-grained discovery, and BISAC doesn't fix
that — TAGS do. This plan is free, Folio-owned, and better matches
the reader-side "find me a book I'll actually like" workflow.

**Motivating test case:** *The Kept Hour* — fantasy / romance / sci-fi
in a Brontë-chaste tone. "Romantasy" implies steam Jacob's book
doesn't have. If The Kept Hour appears in "Romantasy" searches and
readers arrive expecting heat, the platform has failed the author.
The classification system has to let readers say **"show me
fantasy + romance BUT NOT tagged 'spicy' or 'explicit'."** That
filter operator is the whole game.

Companion case still tracked: *The Fain Cycle* — period-gothic
romance / fantasy / class-tragedy. Same shape, different tonal
register.

---

## What changed from v1

- **Dropped BISAC.** Not worth $225/yr for a platform that isn't yet
  paying for itself. Also doesn't solve the tone-signalling problem
  (BISAC has "FICTION / Romance / Gothic" but no way to say "NOT
  spicy" — that's a tag concern).
- **Kept the shape of the design.** Data model, editor UX, backwards-
  compat, retailer-forward-compat — same skeleton, just wearing a
  Folio-owned coat instead of a licensed one.
- **Elevated tags from "supplementary" to "primary discovery layer."**
  Genre codes become a coarse anchor (Fantasy, Romance, Historical);
  tags do all the fine-grained work.
- **Added power-user filter operators.** ANY-OF (union) + NONE-OF
  (exclusion) on both genre codes AND tags. The filter row is where
  the Romantasy problem actually gets solved for readers.

---

## Design principles

1. **Genre = coarse. Tags = fine.** A book has one primary genre + up
   to a few secondaries (~30-value list). Tags are unlimited-ish (soft
   cap 24) and free-form.
2. **Tags are first-class citizens.** They're not sidecar
   labels — they're a searchable/filterable dimension equal to genre.
3. **Filter operators over filter categories.** Readers should be able
   to say "any of these genres AND none of these tags." Reduces the
   pressure on the taxonomy to be exhaustive.
4. **Community-curated tags.** New tags come from authors typing them
   in. The system suggests popular existing tags via autocomplete so
   we don't fragment (`slowburn` vs `slow-burn` vs `slow burn`).
5. **No paid dependencies.** Folio owns its own genre list. Regenerate
   any time. If we later want retailer-compatible codes, we add a
   mapping table (see forward-compat section).

---

## The genre list (Folio-owned, free, ~35 entries)

A hand-curated list that trades exhaustiveness for readability. Every
Folio release picks one primary + up to 4 secondaries from this list.

```
Fiction
  General fiction
  Literary fiction
  Historical fiction
  Fantasy
  Science fiction
  Romance
  Mystery
  Thriller
  Horror
  Gothic
  Speculative
  Magical realism
  Adventure
  Western
  Satire / Comic

Genre-crossover buckets (explicitly signposted so multi-genre
authors don't feel forced to pick just one)
  Fantasy Romance
  Historical Romance
  Historical Fantasy
  Science Fantasy
  Romantic Suspense

Young readers
  Young adult
  Middle grade
  Children's

Non-fiction
  Memoir
  Biography
  Essays
  Poetry
  Drama / Screenplay
  Self-help
  Business
  Health
  Reference
  Travel
  Cookery
  How-to
  Other non-fiction
```

**Storage:** shipped as a static JSON in the repo
(`docs/folio-taxonomy.json`). Editable by anyone with commit access.
No sync, no license, no annual refresh — just Folio's own list.

```json
[
  { "code": "FOL_FAN",  "label": "Fantasy" },
  { "code": "FOL_FAN_ROM", "label": "Fantasy Romance" },
  { "code": "FOL_HIS_ROM", "label": "Historical Romance" },
  { "code": "FOL_ROM_GOT", "label": "Gothic Romance" },
  ...
]
```

Codes are Folio's own (`FOL_*`) — we don't misrepresent BISAC
compatibility. If Jacob later wants BISAC on top of this, we add a
one-time mapping table and license the codes then.

**Why keep codes at all if labels are unique?** Two reasons: (1)
labels may drift over time ("Historical fiction" → "Period fiction")
and codes give us a stable anchor for existing folios' saved
metadata, (2) forward-compat for the mapping-to-retailers case.

---

## Tags — the fine-grained discovery layer

Free-text, unlimited (soft cap 24 per folio, 32 chars per tag),
case-normalised (lowercase, single-space between words). Anywhere a
tag input appears, we autocomplete against existing-tags-in-system
so authors don't accidentally fragment the vocabulary.

Real examples from Jacob's own books (motivational):

*The Kept Hour* — `slow-burn`, `bronte-chaste`, `no-explicit-content`,
`class-tragedy`, `period`, `character-driven`, `hopepunk`, `queer`,
`ensemble-cast`

*The Fain Cycle* — `slow-burn`, `enemies-to-lovers`, `period`,
`class-tragedy`, `family-saga`, `dark-academia`, `no-explicit-content`

*Resonance* — `psychological`, `unreliable-narrator`, `literary`,
`grief`, `contemporary`

Notice what tags let you say that genres can't:

- **Tonal register** — `bronte-chaste`, `spicy`, `no-explicit-content`
- **Trope shape** — `slow-burn`, `enemies-to-lovers`, `found-family`
- **Reader mood** — `hopepunk`, `cozy`, `dark-academia`
- **Structural notes** — `unreliable-narrator`, `ensemble-cast`,
  `epistolary`
- **Content advisories** — `content-grief`, `content-violence` (opt-in
  by author; readers filter these OUT if they want to)

Tags are what let *The Kept Hour* be honestly labelled "Fantasy
Romance" without inheriting Romantasy expectations — because the
`bronte-chaste` and `no-explicit-content` tags do the tonal signalling
BISAC / genre lists can't.

---

## Filter operators — the reader-side game-changer

The shelf's current filter row is single-select per category
(one Genre, one Language, one Sort). Post-change:

### Genre filter — multi-select with modes

Genre dropdown becomes a multi-select popover:

```
+--------------------------------------------------+
| Genres                                           |
|                                                  |
| Match mode:                                      |
|   ( ) ALL of the below (intersection)            |
|   (•) ANY of the below (union — recommended)     |
|                                                  |
| INCLUDE:                                         |
|   [x] Fantasy                                    |
|   [x] Romance                                    |
|   [ ] Sci-fi                                     |
|   [ ] Historical                                 |
|   ...                                            |
|                                                  |
| EXCLUDE (hide books tagged with):                |
|   [ ] Young adult                                |
|   [ ] Middle grade                               |
|   ...                                            |
+--------------------------------------------------+
```

Default match mode is **ANY** — readers looking for fantasy/romance
overlaps want more results, not fewer. (ALL is available for pickier
readers.)

For The Kept Hour: reader ticks Fantasy + Romance + Sci-fi under
INCLUDE (mode = ANY), the book appears because it has at least one
of those primary/secondary codes. If the reader wants to also
exclude YA, they tick YA under EXCLUDE and every YA book drops out.

### Tag filter — same operators, free-text input

```
+--------------------------------------------------+
| Tags                                             |
|                                                  |
| Include tags:  [slow-burn] [hopepunk] [+]        |
|   Match mode:  ( ) ALL   (•) ANY                 |
|                                                  |
| Exclude tags:  [explicit] [spicy] [gore] [+]     |
+--------------------------------------------------+
```

Autocomplete against existing tags in the system. Include is ANY by
default (find me anything hopepunk); exclude ANY (hide anything
tagged with any of these).

### The one filter combination that saves The Kept Hour

A reader looking for slow-burn Brontë-tone fantasy romance types:

- **Genre INCLUDE (ANY):** Fantasy, Romance, Fantasy Romance
- **Tag EXCLUDE:** `spicy`, `explicit`

Result: The Kept Hour, and other Brontë-chaste books in similar
tonal registers. NOT Romantasy books that lean into the trope.

If Jacob wants, we can also add a small **"tonal register"** preset row
above the filters — one-click chips for common combinations
(`Chaste`, `Slow-burn`, `Content-warned`, `Cozy`) — that populate the
include/exclude fields as shortcuts. Deferred for now; the raw filter
already solves the problem.

---

## Data model

Same as v1, just with our own codes:

```
folio_projects/{id}
  release:
    // NEW — canonical field. Ordered array; [0] is primary genre.
    genreCodes: [
      { code: "FOL_FAN_ROM", label: "Fantasy Romance" },
      { code: "FOL_FAN",     label: "Fantasy" },
      { code: "FOL_SCI",     label: "Science fiction" }
    ]

    // NEW — free-text tags for reader discovery.
    tags: ["slow-burn", "bronte-chaste", "no-explicit-content", "period"]

    // KEPT — legacy shelfGenre stays populated (derived from
    // genreCodes[0] on save) so the current single-select Genre
    // filter dropdown keeps working while the multi-select rolls
    // out. Once the multi-select ships, shelfGenre becomes a
    // display-only mirror of genreCodes[0].label.
    shelfGenre: "fantasy"
```

Firestore rules: no changes needed — new fields land on the existing
`release` map. Same read/write rules apply.

---

## Editor UX

### Genre picker (release modal)

Two dropdowns stacked:

```
+---------------------------------------------------+
| Primary genre                                     |
| [ Fantasy Romance                            ▾ ]  |
|                                                   |
| Secondary genres (up to 4)                        |
| [ Fantasy                                     ▾ ] |
| [ Science fiction                             ▾ ] |
| [+ Add another]                                   |
+---------------------------------------------------+
```

Each dropdown is a simple `<select>` populated from the taxonomy JSON
(35 entries — no typeahead needed at this size). Reorder by clicking
a chip and using up/down arrows (or drag; same pattern we already
have for chapter reorder).

### Tag input (release modal)

Below the genre picker:

```
+---------------------------------------------------+
| Tags (help readers find your book)                |
| [slow-burn] [bronte-chaste] [no-explicit-content] |
| [type a tag or pick from suggestions...]          |
|                                                   |
| Popular in Fantasy Romance: slow-burn ·           |
| enemies-to-lovers · found-family · dark-academia  |
+---------------------------------------------------+
```

Type-to-add + autocomplete against existing tags. "Popular in
[primary genre]" chips underneath suggest tags that appear on other
folios in the same primary genre, so authors pick up the local
vocabulary instead of inventing new near-duplicates.

Save on blur / comma / Enter. Backspace on empty input removes the
last chip.

---

## Public display

### Shelf card

- **Primary genre badge** — chip on the card corner (e.g. "Fantasy
  Romance").
- **Top 3 tags** — pill row below the blurb. Click a tag to filter
  the shelf by it.
- Secondary genres NOT shown on the card (space) — visible on tap-
  through to the folio's page.

### Folio's own reader page (title spread / footer)

- Under title/author: "A Fantasy Romance / Fantasy / Science fiction
  novel" (all three codes as inline links to shelf filters).
- Below the blurb: pill row with all tags.
- Every chip is a link to the shelf pre-filtered by that code or tag.

### Shelf filter row

Existing row (Search / All releases / All genres / Newest) becomes:

```
[ Search title or author ] [ All releases ▾ ] [ Genres 0 ▾ ] [ Tags 0 ▾ ] [ Newest ▾ ]
```

`Genres 0` and `Tags 0` are the count of active filters — clicking
either opens the popover from the "Filter operators" section above.

### Admin surfaces

`/admin/shelf/` — moderation card gets the primary genre chip + a
small "+2 codes · 5 tags" summary so moderators can see the shape
without expanding.

---

## Backwards-compat / migration

Same approach as v1 (suggest on next edit), just against the smaller
list:

- On release-modal open, if `genreCodes` is empty AND legacy
  `shelfGenre` exists, show a suggestion banner offering to convert.
- Mapping: `shelfGenre → genreCode` uses a small table (below).
- Author can Accept, Skip, or immediately refine.
- No forced backfill; no folios blocked from re-publish.

**Legacy `shelfGenre` → new default `genreCode`:**

| Legacy shelfGenre | Suggested code | Label            |
| ----------------- | -------------- | ---------------- |
| literary          | FOL_LIT        | Literary fiction |
| general           | FOL_GEN        | General fiction  |
| mystery           | FOL_MYS        | Mystery          |
| thriller          | FOL_THR        | Thriller         |
| romance           | FOL_ROM        | Romance          |
| fantasy           | FOL_FAN        | Fantasy          |
| scifi             | FOL_SCI        | Science fiction  |
| horror            | FOL_HOR        | Horror           |
| historical        | FOL_HIS        | Historical fiction |
| ya                | FOL_YA         | Young adult      |
| children          | FOL_CHI        | Children's       |
| memoir            | FOL_MEM        | Memoir           |
| selfhelp          | FOL_SEL        | Self-help        |
| business          | FOL_BUS        | Business         |
| health            | FOL_HEA        | Health           |
| poetry            | FOL_POE        | Poetry           |
| essays            | FOL_ESS        | Essays           |
| educational       | FOL_REF        | Reference        |
| other             | FOL_GEN        | General fiction  |

Reverse-derive for legacy dropdown: on save, `shelfGenre` mirrors
the first three letters of the leaf label (fallback: "other").

---

## Retailer forward-compat

If Folio ever adds "publish to KDP / Kobo / Ingram," we add a
one-time mapping table `docs/folio-to-bisac-map.json` that translates
our codes to the retailer's expected format:

```json
{
  "FOL_FAN_ROM": { "bisac": "FIC009050", "amazon": "Fantasy > Romantic" },
  "FOL_ROM_GOT": { "bisac": "FIC027030", "amazon": "Romance > Gothic" },
  ...
}
```

Then the sync worker translates on the way out. No re-classification
required from authors; the metadata pipeline handles it.

If at that point we DO want to license BISAC (because we're pushing
enough books to retailers that the license pays for itself), we
license, drop the map, and use BISAC directly in `genreCodes[].code`.
Our schema is agnostic to what the string looks like as long as
codes are unique — the plan doesn't have to change.

---

## Effort estimate

Slightly smaller than v1 because the taxonomy is 35 entries not
4000:

| Stage | Work | Hours |
| ----- | ---- | ----- |
| 1 | Data model + `folio-taxonomy.json` file (hand-write the 35 entries) | 1 |
| 2 | Release modal picker (dropdowns + tag input + autocomplete) | 3 |
| 3 | Shelf filter row: multi-select popover + tag filter + operator UI | 4 |
| 4 | Public display (folio page + shelf card renders) | 2 |
| 5 | Backwards-compat suggest-on-open + mapping table | 1 |
| 6 | Kept Hour + Fain Cycle test — publish, tag, verify filters | 1 |

**Total: ~12 hours**, splittable across 3 sessions. Stage 3 is the
biggest single chunk; if we time-box tightly we can ship Stages 1-2
as a first drop (authors gain the picker + tags) and Stage 3 as a
second drop (readers gain the filters).

---

## Slot in TOMORROW_PLAN.md

**Stage 3.6 — Classification + power-tags (2-3 sessions)**

Slots after 3.5 (Author profile). Prerequisites: nothing — just
Jacob greenlighting the design in this doc.

Session split:
1. Data model + picker (Stages 1–2 from plan) — ~4h. Ships the author-
   side work; new folios can be tagged even before readers see any
   filter changes.
2. Shelf filter multi-select + operators (Stage 3) — ~4h. Ships the
   reader-facing power. Immediately unblocks The Kept Hour's tonal
   discovery problem.
3. Public display + backwards-compat + tests (Stages 4–6) — ~4h.
   Polishes the surfaces and migrates old folios via the
   suggest-on-edit banner.

---

## The Kept Hour test — nine steps that must all pass

At ship:

1. Open The Kept Hour's release modal.
2. Genres section: primary = **Fantasy Romance**; secondaries =
   **Fantasy**, **Science fiction**.
3. Tags: add `slow-burn`, `bronte-chaste`, `no-explicit-content`,
   `class-tragedy`, `period`.
4. Save.
5. Open `/shelf` — the folio card shows a "Fantasy Romance" badge
   and pill tags for the top 3 tags.
6. Filter shelf by Genre INCLUDE (ANY) = **Fantasy** + **Romance** —
   The Kept Hour appears.
7. Filter shelf by Tag INCLUDE (ANY) = `slow-burn` — appears.
8. Filter shelf by Tag EXCLUDE = `explicit`, `spicy` — appears
   (because it's tagged `no-explicit-content`, not `explicit` or
   `spicy`).
9. A reader looking for spicy Romantasy filters INCLUDE `spicy` —
   The Kept Hour does NOT appear, because it doesn't have that tag.
   Authorial intent is respected. Reader arrives at the right book,
   not the wrong one.

Step 9 is the one BISAC couldn't have given us. It's the reason
this pivot is a better design.

---

## What's still deliberately out of scope

- **AI-suggested classification.** Feed the manuscript to a model,
  get suggested codes + tags. Powerful but a separate project — needs
  the taxonomy + tag system in place first, and involves a cost /
  quality call. Deferred.
- **Tag moderation.** Right now tags are open — anyone can add
  anything. If we later see spam or trolling in tags, we add a
  moderator flag / ban list. Cross that bridge if needed.
- **International genre systems (Thema, BIC, CLIL).** English-first
  Folio-owned list is enough while we're anglophone-first. Thema is
  worth revisiting if we ever add French/German UI.
- **Per-tag stats and trending tags on the welcome page.**
  ("Popular this week: `hopepunk`, `dark-academia`.") Nice discovery
  layer, deferred.
- **Genre browsable tree on the shelf.** With only ~35 codes, a
  flat multi-select popover is enough. If the list grows past ~60,
  add a two-level grouping.
