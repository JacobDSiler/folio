# Folio info surfaces + tier differentiation plan

**Status:** Design doc. Phase 1 (Free-tier modal) + auto-WebP shipped
2026-08-04. Phases 2 + 3 need Jacob's greenlight before build.

**Guiding principle** (Jacob's framing, worth quoting):

> Low threshold for readers and sales is perfect. The premium tiers
> can be differentiated for this also. Some authors may prefer
> clicking it takes customers straight to a store/sales page for the
> book and Imprint is designed to make this the most customizable.

Every design choice below is trying to hold that shape: reader taps
a folio, opens the book. Everything else is opt-in surface for
authors who want more.

---

## Three tiers, three surfaces

### Free tier — info modal (SHIPPED 2026-08-04)

Every shelf card now has an ⓘ button in the bottom-right corner.
Tap → modal opens with:

- Cover thumbnail (larger than the card)
- Title, author (author name links to imprint page)
- Price (if paid)
- Primary genre + rating chip
- Full blurb / description
- "Also filed under" secondary genre chips
- Tags (clickable → shelf-filtered by tag)
- Meta row: published date, page count, view count, series, language
- Close + "Open in reader →" primary CTA

Reads from `window._allFolios` — instant, no extra Firestore hit.
Card body click still opens the reader directly.

**Author controls:** none. Modal is fully derived from existing
folio metadata. No per-folio configuration required.

### Indie tier — enhanced modal + preview slice (Phase 2, ~4h)

Same modal shell as Free, plus:

- **Custom accent stripe** — the author's Imprint accent color is
  used on the primary CTA button + section-header underlines (if
  they've customized their imprint theme).
- **Chapter preview strip** — a small horizontal list of the first
  N free chapters with titles + word counts, styled as clickable
  chips that take the reader directly to that chapter in the reader.
- **"Also by this author" row** — up to 4 sibling folios from the
  same imprint. One-doc-per-uid query — cheap.
- **Review snippet** — up to 3 approved reviews for THIS folio (see
  reviews rule; per-folio reviews are a future-work item — right
  now reviews are platform-level).

**Author controls:** minimal. Indie authors don't need per-folio
info-page authoring; they just get a richer default.

### Imprint tier — standalone product page + click-behavior override (Phase 3, multi-session)

Two big shifts:

**1. Dedicated URL** — every Imprint-tier folio gets a canonical
product page at `/folio/<slug>` (or `/imprint/<uid>/<slug>` for
disambiguation). Real page, SEO-indexable, share-friendly URL.
Reader landing there gets:

- Hero: cover + title + author + price + primary CTA
- Long blurb (Imprint-tier folios get a richer `longBlurb` field —
  the current `shelfBlurb` is 280 chars, product-page can go to
  a few thousand)
- Section-by-section chapter TOC with word counts + optional
  first-line previews
- Author bio + photo (pulled from imprint theme)
- Reviews (once per-folio reviews ship)
- "Also by this author" carousel
- Rich CTA row: buy · sample · gift · add-to-wishlist (which of
  these render is author-configurable)

**2. Click-behavior override** — the author picks what happens when
a reader taps their card on the shelf:

- **"Open the reader"** (default; matches Free / Indie behavior)
- **"Open the product page"** (Imprint choice — sends reader to
  `/folio/<slug>` where the full sales pitch lives)
- **"Open external URL"** (Kickstarter pre-launch, Substack chapter
  reveal, etc. — for authors who use Folio as the listing but sell
  elsewhere)

**Author controls (Imprint):**

- Long blurb (rich text — bold, italic, headers, one image inline)
- Product page layout choice (2-3 templates: Classic / Editorial /
  Cinematic)
- Custom hero image (separate from cover — landscape orientation
  for the product page banner)
- Assign a generated product photo from `/press/photos/` as either
  the cover OR the product-page hero
- CTA button label override (already exists on release)
- Click-behavior override (as above)
- Reviews toggle (some authors want reviews shown, some don't)
- SEO metadata (title tag override, meta description)

**Author controls surface:** new "Product page" section in the
release modal (Imprint-tier only), OR a dedicated `/admin/product-page/`
editor for the Imprint author's own folios.

---

## Thomas's related asks

Handled inline where possible:

### Reposition print-ready button

Deferred pending clarification. Thomas didn't specify WHERE he wants
it. Options:
- Move it out of the export menu into its own always-visible sidebar
  button (higher visibility)
- Move it into the Print & Publish (POD) panel where the Lulu +
  IngramSpark + KDP flows live (grouped by intent)
- Keep it where it is but make it visually louder

Ask Thomas which he'd prefer.

### Wider editor + fewer distractions

Partially addressed by the resizable sidebar (shipped last session).
Thomas may mean:
- **Sidebar wider** — already possible via drag handle (up to 640px).
  If he wants HIGHER cap, we bump `MAX_W` in the resize helper.
- **Writing area (writing-mode) wider** — currently constrained to
  a comfortable line-length column. If he wants it edge-to-edge,
  we'd add a "wide writing mode" toggle (Free-tier fine).
- **Preview toolbar too busy** — hide-when-idle affordance for the
  less-used buttons. Small design pass.
- **Sidebar tabs too crowded** — reduce Manuscript / Book / Audio /
  Folio / Metrics to 3 top-level tabs with grouping.

Needs Thomas to say which of these is the itch.

---

## Auto-WebP conversion (SHIPPED 2026-08-04)

Every image upload on the platform is now auto-converted to WebP
if the browser supports it AND the WebP result is at least 15%
smaller than the source.

- Covers uploaded via the Book tab's dropzone (`handleImages`)
- Inline images uploaded via the release-modal image picker
  (`_imgModalUpload`)
- Both call the shared `_maybeConvertToWebP(file, {quality})` helper
  before the file lands in `S.images` / Firebase Storage.

**No tier gating.** Client-side conversion costs Folio nothing, and
shelf-load speed benefits every reader equally. Making authors pay
to unlock "your images load faster" would be a bad look. Basic
conversion is universal.

**Paid tier upsell (Phase 2, optional):**

- **Quality slider** — Free = 0.85 default; Indie = 0.5 to 0.95
  slider so authors can tune size vs fidelity per-folio.
- **Bulk-convert existing images** — one-click "convert all my
  already-uploaded folios to WebP retroactively" for authors who
  built their library before this shipped. Runs in the browser,
  uploads swapped files to Storage, updates `S.images[].url` +
  `.type`.
- **AVIF conversion** — newer format, even smaller than WebP for
  photos. Browser support is more variable so we'd need a fallback
  path. Imprint-only worth-it because it needs a more involved
  build.

Skips gracefully for:
- Files already < 40KB (overhead not worth it)
- GIFs (animation), SVGs (vector), already-WebP
- Browsers without `canvas.toBlob('image/webp',…)` support

Logs conversion outcomes to console (`[webp] converted foo.jpg
480KB → 92KB (81% smaller)`) so developers can see what's happening
during author testing.

---

## Implementation staging

**Phase 1 (SHIPPED)** — Free-tier info modal + auto-WebP.

**Phase 2 (~one session)** — Indie enhancements: accent stripe,
chapter preview strip, "Also by this author" row. Blocked on
nothing.

**Phase 3 (multi-session)** — Imprint standalone product page +
click-behavior override. Needs:
- `release.longBlurb` field addition + save/hydrate
- New `/folio/<slug>` static page or worker-rendered SSR
- Product-page authoring UI in the release modal (Imprint-only)
- Click-behavior override read on shelf card click handler
- Template picker (2-3 layouts)
- Product-photo assign hook to `/press/photos/`

Suggest starting Phase 3 once Phase 2 is live + at least 5-10
folios are actively getting info-modal clicks (proves the demand
before investing in the bigger surface).

---

## Blocking questions — Jacob's answers (2026-08-04)

1. **Chapter-preview-strip on the Indie modal.**
   → **Ship it. Configurable per-folio.** Authors who don't want
   readers seeing chapter titles get a checkbox in the release
   modal's shelf-fields to hide it. Default: shown, because most
   authors WANT the free-preview chapters obvious to browsers.

2. **Imprint product-page URL structure.**
   → **Not answered directly** — Jacob's priority for Imprint is
   "expose the preview chapters as click-to-read links AND buy
   buttons directly on the shelf card" (so readers can purchase
   from the shelf without a product-page detour). This makes the
   product-page URL less urgent; the shelf card itself becomes
   the primary conversion surface for Imprint tier.
   Leaving URL structure decision for when we build the product
   page in Phase 3. `/imprint/<uid>/<slug>` remains my
   recommendation for collision safety.

3. **Reviews per-folio.**
   → **Defer until Imprint product page ships.** Aligns with
   Jacob's "let the product page be where reviews live" framing.

4. **Bulk-convert existing images retroactively.**
   → **No. New uploads only.** Jacob will re-upload as needed;
   the cost of a bulk-migration tool isn't justified against a
   manual re-upload for the current ~12-folio corpus.

---

## New scope revealed by Jacob's answers

**Imprint-tier shelf-card exposure** (new — was implicit before):

For an Imprint-tier folio, the SHELF CARD itself should expose:
- **Chapter preview links** — clickable chips right on the card
  (not just in the modal) so readers can start reading in one tap
- **Buy button** — for paid folios, the buy CTA lives on the card
  itself so a reader who arrived via the shelf can convert without
  ever opening the modal or the reader

This is the tier's real value prop: your card becomes a mini
product page. Free/Indie folios keep the current minimal card;
Imprint folios "unfold" with the extra affordances.

**Implementation lift:**
- Detect Imprint tier at shelf-render time (author's uid → look
  up their subscription in folio_user_settings; cache per session)
- Conditional card render: Imprint gets extra rows for preview
  chapters + buy button
- For paid Imprint folios with `provider=paypal_native`, the buy
  button on the card either scrolls to a mini-Buttons SDK mount
  slot inline (heavier) OR opens the reader at the paywall with
  buttons scrolled into view (lighter — reuses existing path)

Multi-session build. Ships alongside or after the Imprint product
page since both are the same tier's conversion story.

---

## Immediate roadmap (revised)

**Phase 2 (this session)** — Chapter preview strip on the info
modal, per-folio configurable. All tiers see it, authors can hide
it per-folio in the release modal's shelf-fields section. Reader
honours `#chap-<id>` fragment so preview chips can deep-link
into the reader at a specific chapter.

**Phase 3 (next multi-session)** — Imprint tier work:
- Imprint-tier shelf-card unfolds with preview links + buy button
- Standalone product page at `/imprint/<uid>/<slug>` (leaning
  toward this vs `/folio/<slug>` for collision safety)
- Product-photo assign hook to `/press/photos/`
- Long blurb authoring
- Click-behavior override (open reader / open product page /
  open external URL)

**Follow-up polish (future)** — per-book reviews (aligned with
Phase 3 product page), Imprint-tier layout templates,
AVIF conversion option.
