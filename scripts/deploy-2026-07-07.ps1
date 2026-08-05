<#
.SYNOPSIS
    Ship the 2026-07-07 batch (admin console + role management + shelf
    moderation scaffolding) to production.

.DESCRIPTION
    One-off deploy for this session's batch. Does NOT touch index.html or
    folio-tts-worker.js, so it doesn't collide with folio-push.ps1.

    Steps:
      0. Clear any stale .git\index.lock (VS Code sometimes leaves one).
      1. Verify shipping files landed on disk.
      2. Sanity-check app.html tail (VS Code truncation defence).
      3. gsutil cors set   (Firebase Storage CORS for product photos).
      4. firebase deploy --only firestore:rules (folio_roles + isAdmin).
      5. git add + git commit -F <msg> + git push (GitHub Pages picks up).

.EXAMPLE
    From Git Bash:   scripts/deploy-2026-07-07
    From PowerShell: .\scripts\deploy-2026-07-07.ps1

.NOTES
    Requires: PowerShell 5+, git, firebase-cli, gsutil (Google Cloud SDK).
    ASCII-only comments so PS 5.1 does not choke on encoding.
#>

$HOLD_OPEN = $true
$script:exitCode = 0

function Stop-Here([int]$code = 0) {
    $script:exitCode = $code
    if ($HOLD_OPEN) {
        Write-Host ""
        Write-Host "Press Enter to close..." -ForegroundColor DarkGray
        Read-Host | Out-Null
    }
    # Force the powershell.exe process to terminate — plain `exit` only
    # exits the SCRIPT, not the shell, and if the shortcut still carries
    # a stale -NoExit flag (which Windows can cache on pinned taskbar
    # copies even after the .lnk file is refreshed on disk), the window
    # stays open as a bare prompt after Enter. [Environment]::Exit bypasses
    # -NoExit entirely and closes the terminal every time.
    [Environment]::Exit($code)
}

try {
    $ErrorActionPreference = 'Stop'

    Write-Host ""
    Write-Host "=== Folio deploy 2026-07-07 ===" -ForegroundColor Cyan

    # -- Locate repo root ---------------------------------------------
    $repoRoot = $null
    try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) } catch {}
    if (-not $repoRoot) {
        Write-Host "Not inside a git repository. cd into the folio clone first." -ForegroundColor Red
        Stop-Here 1
    }
    Set-Location $repoRoot
    Write-Host "Repo:   $repoRoot" -ForegroundColor Cyan

    # -- 0. Clear stale git lock --------------------------------------
    $lock = Join-Path $repoRoot ".git\index.lock"
    if (Test-Path $lock) {
        Write-Host "Clearing stale .git\index.lock ..." -ForegroundColor Yellow
        try { Remove-Item $lock -Force -ErrorAction Stop }
        catch {
            Write-Host "Could not remove the lock: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Close VS Code (or any editor holding a git handle) and re-run." -ForegroundColor Yellow
            Stop-Here 1
        }
    }

    # -- 1. File inventory --------------------------------------------
    Write-Host ""
    Write-Host "-- File inventory --" -ForegroundColor Cyan
    $must = @(
        "app.html", "shelf.html",
        "docs\firestore.rules", "docs\firebase-storage-cors.json",
        "docs\SHELF_MODERATION_DESIGN.md", "docs\LOCALIZATION_DESIGN.md",
        "admin\index.html", "admin\admins\index.html",
        "admin\boost\index.html", "admin\reviews\index.html", "admin\press\index.html",
        "wrangler.toml", ".gitignore"
    )
    $missing = @()
    foreach ($f in $must) {
        if (Test-Path $f) {
            $sz = (Get-Item $f).Length
            Write-Host ("  OK   {0}  ({1} bytes)" -f $f, $sz)
        } else {
            Write-Host ("  MISS {0}" -f $f) -ForegroundColor Red
            $missing += $f
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Missing files - aborting." -ForegroundColor Red
        Stop-Here 1
    }

    # -- 2. app.html tail sanity --------------------------------------
    # PS 5.1 disallows -Raw + -Tail together, so read the tail as lines
    # and rejoin. 4 lines is plenty to catch a </html> close.
    $tail = ((Get-Content "app.html" -Tail 4) -join "`n")
    if ($tail -notmatch "</html>\s*$") {
        Write-Host ""
        Write-Host "ERROR: app.html does not end with </html>." -ForegroundColor Red
        Write-Host "VS Code may have truncated it. Close app.html in VS Code" -ForegroundColor Red
        Write-Host "(or Ctrl+Shift+P -> 'Revert File') and re-run." -ForegroundColor Yellow
        Stop-Here 1
    }
    Write-Host "  OK   app.html closes with </html>" -ForegroundColor Green

    # -- 3. Firebase Storage CORS -------------------------------------
    # Locks Storage bucket CORS to the origins declared in
    # docs/firebase-storage-cors.json. Skipped gracefully if neither
    # gsutil NOR gcloud is on PATH — falls back to manual instructions.
    # Either tool works; gcloud is the successor and shipping with newer
    # Google Cloud SDK installs, so we try it first.
    Write-Host ""
    Write-Host "-- Firebase Storage CORS --" -ForegroundColor Cyan
    $bucket = 'miscellaneous-117e9.firebasestorage.app'
    $corsFile = 'docs\firebase-storage-cors.json'

    # Prefer gcloud (newer). gcloud storage buckets update supersedes
    # gsutil cors set and works with the same JSON config file.
    $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
    if (-not $gcloud) { $gcloud = Get-Command gcloud.cmd -ErrorAction SilentlyContinue }
    $gsutil = Get-Command gsutil -ErrorAction SilentlyContinue
    if (-not $gsutil) { $gsutil = Get-Command gsutil.cmd -ErrorAction SilentlyContinue }

    if ($gcloud) {
        Write-Host "  Using gcloud storage buckets update..." -ForegroundColor Cyan
        & $gcloud.Source storage buckets update "gs://$bucket" --cors-file="$corsFile"
        if ($LASTEXITCODE -ne 0) { Write-Host "gcloud failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
    } elseif ($gsutil) {
        Write-Host "  Using gsutil cors set..." -ForegroundColor Cyan
        & $gsutil.Source cors set $corsFile "gs://$bucket"
        if ($LASTEXITCODE -ne 0) { Write-Host "gsutil failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
    } else {
        Write-Host "Neither gcloud nor gsutil on PATH. Skipping CORS update." -ForegroundColor Yellow
        Write-Host "  Two ways to apply the config in $corsFile :" -ForegroundColor Yellow
        Write-Host "" -ForegroundColor Yellow
        Write-Host "  Option A - one-time via Google Cloud Console (no install):" -ForegroundColor Gray
        Write-Host "    https://console.cloud.google.com/storage/browser/$bucket" -ForegroundColor Gray
        Write-Host "    click the three-dot menu -> Edit CORS configuration ->" -ForegroundColor Gray
        Write-Host "    paste the contents of $corsFile -> Save." -ForegroundColor Gray
        Write-Host "" -ForegroundColor Yellow
        Write-Host "  Option B - install Google Cloud SDK (permanent fix):" -ForegroundColor Gray
        Write-Host "    https://cloud.google.com/sdk/docs/install-sdk" -ForegroundColor Gray
        Write-Host "    then re-run this deploy - CORS will apply automatically." -ForegroundColor Gray
    }

    # -- 4. Firestore + Storage rules ---------------------------------
    # Storage rules gate cover-image uploads (folio_images/{folioId}/...).
    # If you get a 403 uploading a cover, this step probably didn't run.
    Write-Host ""
    Write-Host "-- Firestore + Storage rules --" -ForegroundColor Cyan
    # firebase-cli on Windows ships as a .cmd shim from npm-global,
    # which Get-Command doesn't always resolve. Try both the bare name
    # and the .cmd suffix before giving up.
    $firebase = Get-Command firebase -ErrorAction SilentlyContinue
    if (-not $firebase) { $firebase = Get-Command firebase.cmd -ErrorAction SilentlyContinue }
    if (-not $firebase) {
        Write-Host "firebase-cli not on PATH. Install and run:" -ForegroundColor Yellow
        Write-Host "  firebase deploy --only firestore:rules,storage" -ForegroundColor Yellow
    } else {
        & $firebase.Source deploy --only firestore:rules,storage
        if ($LASTEXITCODE -ne 0) { Write-Host "firebase deploy failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
    }

    # -- 5. Git commit + push -----------------------------------------
    Write-Host ""
    Write-Host "-- Git commit + push --" -ForegroundColor Cyan

    # Stage only what this batch touches. Prior drift on imprint/,
    # press/, and scripts/folio-push.ps1 stays uncommitted; Jacob can
    # review + commit those separately if desired.
    & git add .gitignore
    # GitHub Pages runs Jekyll by default, which excludes every file whose
    # name starts with '_'. That silently 404'd /admin/_shared.js in
    # production and made /admin/boost's author-lookup widget invisible
    # (FolioAdmin was undefined at runtime). Adding an empty .nojekyll
    # tells GitHub Pages to skip Jekyll entirely so underscore files ship.
    & git add .nojekyll
    # index.html is the main welcome/marketing page -- it kept getting
    # dropped from this list, which is why deploys sometimes silently
    # skipped a batch when index.html was the only file changed. Added
    # 2026-07-17 after "your branch is up to date with origin/main"
    # errors traced back here.
    & git add index.html
    & git add app.html shelf.html docs\CRITICAL_PATHS.md
    # Product photo templates -- the .psdt files themselves stay in
    # Firebase Storage (gitignored), but manifest.json IS tracked so
    # the app knows which templates exist and where their metadata
    # lives. Untracked manifest = photos page shows an empty catalog.
    & git add press\photos\templates\manifest.json
    & git add docs\firestore.rules docs\storage.rules docs\firebase-storage-cors.json docs\SHELF_MODERATION_DESIGN.md
    & git add docs\LOCALIZATION_DESIGN.md
    & git add docs\TOMORROW_PLAN.md docs\EMAIL_FOLIO_LAUNCH.md docs\STOCK_PHOTO_TEMPLATES.md
    & git add firebase.json .firebaserc
    & git add admin\index.html admin\admins\index.html
    & git add admin\boost\index.html admin\reviews\index.html admin\press\index.html
    & git add wrangler.toml
    & git add press\photos\index.html
    & git add press\index.html press\import\index.html
    & git add 404.html s\index.html
    & git add help\index.html serials-guide.html
    & git add admin\_shared.js admin\reviews\index.html
    & git add docs\AUTH_UNAUTHORIZED_DOMAIN_FIX.md docs\STABILITY_PLAN.md
    & git add docs\TUTORIAL_STRATEGY.md
    & git add docs\ADMIN_DIGEST_SETUP.md
    & git add folio-email-worker.js
    & git add imprint\index.html
    & git add .githooks\pre-commit
    & git add policy\index.html
    & git add admin\shelf\index.html
    & git add admin\metrics\index.html
    & git add press\index.html
    & git add docs\METRICS_PLAN.md docs\BISAC_CLASSIFICATION_PLAN.md docs\folio-taxonomy.json docs\CRITICAL_PATHS.md docs\FOLIO_INFO_SURFACES_PLAN.md docs\MODULAR_UI_PLAN.md
    & git add folio-paywall-worker.js
    & git add scripts\deploy-2026-07-07.ps1 scripts\deploy-2026-07-07.cmd scripts\create-taskbar-shortcuts.ps1

    # Commit message in a temp file so multi-line + non-ASCII survive
    # the round-trip through PowerShell -> git.
    $msgPath = Join-Path $env:TEMP "folio-deploy-2026-07-07.msg"
    $msg = @"
feat: Write-mode bottom-bar compression + shelf series card + info modal

Two shipping items this turn.

Write-mode bottom bar
─────────────────────
Jacob 2026-08-05: "Write mode still has a huge honking bottom bar
with export button. Can we make the export bar much smaller /
minimized for the write mode? Maybe a little (i) button next to
it that displays a tooltip on hover/press with the folio stats
would be an elegant way to minimize this all much more."

Added a compact ⓘ #pageStatsInfoBtn beside the export primary /
drawer-toggle buttons. Populated with the same page + word +
chapter counts (and short-chapter warning) that the textual
#pageCountLine gets, via native title tooltip. Hidden in Full
preset (where the textual line has the room); shown only in
Write preset.

Write-preset CSS additions hide the whole bottom stack:
  #pageCountLine, #statusBar, #sidebarCtaBar, .sidebar-footer
And shrink the export section itself (padding + button font-size).
Full preset unaffected — this is purely opt-in through the preset
picker.

Series card on the shelf + series info modal
────────────────────────────────────────────
Jacob 2026-08-05: "make a series card on the shelf, that has an
info button which leads to a bigger series blurb. Many authors
will want this I think."

Author-side (app.html)
- New release.seriesBlurb field (up to 800 chars). Textarea in
  the Series section of the release modal, right below the name
  + book# inputs. Hint tells authors it only needs to live on
  ONE folio in the series — the shelf picks the earliest-order
  book that has one populated.
- Hydrate + save wired in the normal release payload path. Nulled
  when blank so the picker falls through cleanly.

Shelf-side (shelf.html)
- New #shelfSeriesContainer row between #shelfStatus and
  #shelfFeaturedContainer. Horizontal-scroll ("📚 series on the
  shelf"), shown only when at least one series has 2+ folios in
  the current filtered view.
- _renderSeriesRow() groups by folio.series (case-insensitive
  match, case-preserving display), sorts each group by
  seriesOrder, picks the series blurb from the earliest-order
  folio that has one, alphabetical across series so ordering is
  deterministic between renders.
- .shelf-series-card CSS: 260px flex-basis, 16:9 cover backdrop
  (from earliest-order folio), Playfair serif name, meta row
  (book count · pages), 3-line clamp blurb, ⓘ "more" button.
- Card CLICK = filter shelf to that series (existing
  /shelf?series=X behaviour).
- ⓘ CLICK = _openSeriesInfo(seriesKey) which re-derives the
  group from window._allFolios and opens a modal listing every
  folio in order with book # + title + price ("Free" or
  "$X.XX"). Primary CTA "Browse series →" filters the shelf.

Reuses the existing folio-info-modal shell + backdrop for zero
extra CSS — only the book-row list styling is bespoke
(.fi-series-books + .fi-series-book).

Files touched
─────────────
  app.html    — Write-preset CSS block extended (bottom-bar hide
                + export-section shrink + #pageStatsInfoBtn CSS),
                #pageStatsInfoBtn added to .exp-primary-wrap,
                pageStatsInfoBtn title update in renderPreview
                stats block, rlSeriesBlurb textarea + hydrate +
                save in release modal Series section
  shelf.html  — .shelf-series-card + .fi-series-books CSS,
                #shelfSeriesContainer + #shelfSeriesRow HTML,
                _renderSeriesRow() + _openSeriesInfo(), folio
                mapping now includes seriesBlurb

---

Previous batch — kept in commit history:

feat: chapter lock — 🔒 button preserves chapters through re-imports

Jacob 2026-08-05: "It is work to set up a frontispiece and when a
re-import clobbers it it's frustrating. Maybe we can set a lock
button or something on all chapters so they will persist through
re-imports, which would solve post chapters persisting and any
other chapter persisting as well."

What ships
──────────
Every chapter list row now has a 🔓/🔒 lock button between the
writing-mode ✍ and the import ⇧. Click to toggle. Locked rows
show a subtle accent-coloured left border so authors can see
at a glance which chapters are protected.

Preservation logic sits in applyImportToChapters(). Before the
existing `chapters = newChapters` clobber, we snapshot any
`ch.locked === true` entries with their original indices, sort
by index ascending, then splice each one back into newChapters
at (or as close as possible to) its original position. Position
is clamped to newChapters.length so a locked chapter that was
position 12 in a 15-chapter book doesn't overflow a freshly-
imported 4-chapter draft — it just lands at the end.

Toast on lock/unlock confirms the state change; toast on re-import
tells the author how many locked chapters were preserved. Console
logs `[import] preserved N locked chapter(s)` for later debugging.

Solves the whole class of clobber pain
──────────────────────────────────────
Not just frontispieces — anything the author has hand-crafted
around an auto-import: dedication, table of contents (though TOC
regenerates itself so lock is often unnecessary), preface,
appendix, acknowledgements, epilogue, author's note, colophon.
Also lets authors freeze a specific chapter mid-draft when they
want to iterate on the rest via re-import.

Field shape
───────────
`ch.locked: boolean` — new field on the chapter object. Saves
with the manuscript through the normal state persistence path;
no schema migration needed (undefined is falsy, so existing
chapters just default to unlocked). Pre-lock folios keep working
identically until an author flips a lock.

Files touched
─────────────
  app.html    — chItemHTML: 🔒/🔓 button + ch-locked class on
                the row; toggleChapterLock() function + window
                export; applyImportToChapters(): snapshot-and-
                splice preservation of locked chapters; new
                .ch-item.ch-locked CSS rule (accent left border)

---

Previous batch — kept in commit history:

feat: long blurb + price/buy CTA prominence on info modal

Jacob 2026-08-05: "the feature doesn't look like it has a great deal
of purpose if both are the same, and the one fits the shelf listing
anyway. The information button doesn't add more information at all."
Plus: "make the information panel show the price directly on it or
free according to the folio Release details. Seeing the prices and
being exposed to the buy buttons as often as possible is going to
serve my authors justly."

Two distinct blurb fields
─────────────────────────
- release.shelfBlurb — the 280-char short blurb, shown on the shelf
  card (was already there).
- release.longBlurb — NEW field, up to 2,000 chars. Shown when a
  reader opens the ⓘ info card. Nulled when blank so the shelf
  renderer can gracefully fall back to shelfBlurb → description.

Release modal UI
────────────────
New "Full description" textarea (rlLongBlurb, rows=6, maxlength=2000)
right below the shelf blurb, labeled clearly:
  "shown when readers open the info card — pitch harder, go longer"
Hint below explains the fallback + notes rich text is Imprint-tier
future work. Hydrated on release-modal open; saved with the
release payload.

Price line + buy CTA on info modal
──────────────────────────────────
Fixed a latent bug that Jacob's screenshot surfaced: the shelf's
folio mapping never pulled price + currency out of the release
doc, so the info modal's priceStr computation was always empty
even for paid folios. Now:
- price + currency added to the folio object mapping.
- Price line ALWAYS renders in the modal — accent-coloured "$X.XX"
  for paid, muted "Free" for free. No more silent-missing.
- Primary CTA button adapts: "🛒 Buy for $X →" for paid folios,
  "Open in reader →" for free. Both routes land on the same reader
  URL — paywall takes over inside the reader for paid, plain
  reader for free.

Info-modal blurb precedence
───────────────────────────
Rendered blurb is now `folio.longBlurb || folio.blurb || folio.description`
in that order. Existing folios (no longBlurb yet) still show the
shelf blurb — no visible regression. Once an author writes a long
blurb, the info modal starts showing meaningfully more content
than the card, which is what makes the ⓘ button feel worth
clicking.

Files touched
─────────────
  app.html    — rlLongBlurb textarea in the release-modal shelf
                section (below rlShelfBlurb), hydrate + save wiring
  shelf.html  — folio mapping (longBlurb + price + currency),
                info modal render (always-shown price line, longBlurb
                precedence, buy-vs-open CTA)

---

Previous batch — kept in commit history:

fix: lightbox image now actually fills the viewport (was staying at source size)

Jacob 2026-08-05: "the zoomed in image is not full size. Currently
the Folio preview/reading pane is larger than the zoomed in image,
which somewhat defeats the purpose."

Root cause: the lightbox `<img>` was styled with `max-width:100%;
max-height:100%; object-fit:contain`. Those `max-*` caps only
scale DOWN — they don't force UP. When the source image was
smaller than the viewport (which is common for shelf covers
uploaded at moderate resolution), the image rendered at its
intrinsic dimensions surrounded by black. object-fit:contain
doesn't upscale on its own; it just fits within given dimensions.

Fix: explicit width/height on the image using viewport units
minus the backdrop's 24px padding on each side:

  width:  calc(100vw - 48px)
  height: calc(100vh - 48px)
  object-fit: contain

Now the image is stretched to fill the viewport (minus padding),
and object-fit:contain preserves aspect ratio within that stretched
box. Tall images fit vertically, wide images fit horizontally, and
smaller-than-viewport sources scale up to fill without cropping.
Reader inspects detail the way Jacob intended.

Files touched
─────────────
  app.html — _openImageLightbox img.style.cssText width/height rewrite

---

Previous batch — kept in commit history:

feat: reader review CTA + drafts-unshipped metric + perpetual pricing on /press/

Three ships triggered by Jacob's metrics questions + friend-comp
context this turn.

Reader review CTA
─────────────────
Root cause of the 172 shelf views / 0 reviews gap: readers literally
had no entry point to leave one. The review modal only opened from
an AUTHOR-side sidebar button in the editor. Every existing review
must have come from an author who happened to know where the
button lived.

Fix: added a "★ Leave a review" button to the end-of-book panel
(#rdEndOfBook) — the natural "you just finished, what did you
think?" moment. Reuses the existing _openReviewModal() flow so no
new submission UI to maintain. Small copy above it: "Enjoyed it?
Help other readers find their next favourite book." Reviews are
still platform-wide (per-book reviews are deferred until the
Imprint product page ships).

Drafts-unshipped metric
───────────────────────
Jacob greenlit the "authors with a folio but nothing published"
metric from the earlier insights conversation. Turns out the
existing /user-list worker endpoint already returns folioCount +
publishedCount per uid, so no new endpoint needed — pure client-
side count from _serverUsers:

  draftAuthors = users where folioCount > 0 AND publishedCount === 0

Rendered as a new tile in the Content section with subtitle
"N% ship rate" (published / (draft + published)). Falls back to
"— (needs ADMIN_DEBUG_TOKEN)" when the token isn't set, matching
the existing pattern for Signed-in users.

Perpetual pricing on /press/
────────────────────────────
Jacob told a friend (Chais) that Folio Press has perpetual
pricing. Backfilling the commitment:

- Added a third toggle button "Perpetual" alongside Monthly /
  Yearly on the pricing page.
- Added data-perpetual attributes to each tier's price + period +
  yearly-note spans: Indie \$199 one-time, Imprint \$499 one-time
  (roughly 4x yearly — friendly early-adopter pricing).
- setBilling() extended to handle the new period.
- subscribe() intercepts perpetual clicks and routes them to a
  pre-composed mailto: (subject "Perpetual Indie/Imprint —
  Folio Press", body with amount + placeholder for user email).
  This lets Jacob process the payment via PayPal invoice + attach
  an admin comp with paypalSubscriptionId set to LIFETIME-<n>.
  Full self-serve perpetual checkout is a follow-up (needs the
  worker to support one-time PayPal orders as a distinct flow
  from recurring subscriptions).
- Added a new FAQ entry explaining what Perpetual means, why it
  exists, and how the two-step invoice handoff works today.

Files touched
─────────────
  app.html                    — review CTA row in #rdEndOfBook
  admin/metrics/index.html    — Drafts-unshipped tile + fill
                                logic reading _serverUsers
  press/index.html            — Perpetual toggle button, data-
                                perpetual attributes on all three
                                tiers, setBilling() + subscribe()
                                perpetual routing, FAQ entry

---

Previous batch — kept in commit history:

feat: sidebar tab grouping — Write / Design / Produce / Ship (§5 of MODULAR_UI_PLAN.md)

Jacob greenlit §5 as the next thing. The 5-tab strip (Manuscript /
Book / Audio / Folio / Metrics) is now 4 intent-forward top-level
groups. Ship groups Folio + Metrics under a small sub-strip that
appears only when Ship is active.

Structure
─────────
Old:  [Manuscript] [Book] [Audio] [☁ Folio] [📊 Metrics]  (5 tabs
      crammed into a repeat(4, 1fr) grid — 5th was wrapping)

New:  [✍ Write] [🎨 Design] [🎧 Produce] [📤 Ship]
      When Ship active, sub-strip appears below:
      [☁ Folio] [📊 Metrics]

Behaviour
─────────
- Click Write / Design / Produce → same as clicking the old
  Manuscript / Book / Audio tabs (aliased via existing _tabNormalize).
- Click Ship → routes to whichever sub-tab (Folio or Metrics) was
  last active; defaults to Folio for first-time users.
- Click a sub-tab → highlights BOTH the Ship top-level button AND
  the sub-tab, persists the choice in localStorage
  (`folio_lastShipSub`) so re-clicking Ship remembers.
- Legacy switchTab('folio' / 'metrics' / 'project' / 'chapters' /
  ...) call sites keep working unchanged — the Ship-active flag
  attaches automatically when id is folio or metrics.
- Boot-flicker script updated so refreshing on Folio or Metrics
  lands with Ship highlighted + sub-strip visible immediately (no
  visible flash of an unselected state before _restoreLastTabOr
  fires).

Grid fix (bonus)
────────────────
Also silently fixes a small visual bug: the tab strip's CSS was
`grid-template-columns: repeat(4, 1fr)` while there were actually
5 tabs, so the 5th (Metrics) was wrapping to a second row. Now
that we're truly at 4 top-level tabs, the grid layout matches
what the CSS always intended.

Interaction with presets (from previous batch)
──────────────────────────────────────────────
Works cleanly in all three preset modes:
  Full   → full tab strip + sub-strip when Ship active
  Write  → shortcuts collapsed, tab strip normal
  Focus  → sidebar hidden entirely (whole strip disappears)

Files touched
─────────────
  app.html — tab strip HTML (5 → 4 buttons + sub-strip div),
             _shipGroupClicked handler + _shipGetLastSub +
             _SHIP_SUBTABS constant, switchTab rewrite that
             routes Ship group's dual state, boot-flicker script
             updated to handle Ship sub-tab hydration, .tab-btn
             .ship-subtab CSS overrides for the flex sub-strip

---

Previous batch — kept in commit history:

fix+docs: admin-digest tile err + tier docs surfaced + Author Guide refresh

Small pass triggered by Jacob's admin-metrics screenshot + Adrian
comp asking "What is the Imprint?" via mid-turn message.

Admin digest "err" tile
───────────────────────
See previous commit for the Firestore rule fix. Now shipped.

Sidebar footer — added Tiers + Help links
─────────────────────────────────────────
Jacob's read was "the docs are on the bottom of the editor bar,
right?" — half right. There WAS a Guide link but no Tiers or
Help link, so pointing a friend at "what is the Imprint?" meant
opening a browser to type /press/ manually. Now the sidebar
footer carries:
  Guide · Tiers · Help · Keys · Privacy · Terms · Contact
Tiers points at /press/ (the actual pricing page). Help points
at /help/ (FAQ).

Author Guide refresh — serials-guide.html
─────────────────────────────────────────
Retitled "Serials Guide" → "The Folio author guide" (still lives
at /serials-guide.html for link compat, but the page identifies
itself as the general guide now). Refreshed for the current
platform:

- New "The tiers — Free, Indie, Imprint" section at the top
  answering Adrian's exact question, with a link to /press/ for
  the full comparison. Notes the Founding Contributor comp path.
- Paid fields section now mentions PayPal Native (Path A) as
  the recommended default alongside Gumroad. Explains where the
  Vendor Connections modal lives.
- Step 4 restructured — PayPal Native setup instructions first,
  Gumroad as the alternative flow. Matches current UX where the
  release-modal provider picker offers both.
- URLs updated from folio.jacobsiler.com/?read=... to
  onfolio.press/app.html?read=... (current custom domain).
- Step 5 now mentions the Folio Shelf + moderation gate.
- Step 6 covers all three share flows: free, PayPal Native paid
  (same reader URL), Gumroad paid (product URL).
- New "Beyond serials — the rest of the platform" section:
  Shelf, imprint page, ratings + moderation, genres + tags,
  workspace layout presets, reader image lightbox.
- Ends with a "Where to go next" pointer at /press/, /help/,
  /shelf, and the contact email.

Stale prices in help/index.html
───────────────────────────────
"How much does Folio cost?" FAQ had Indie at $2/mo + Imprint at
$6/mo — contradicted /press/'s current $5 / $12. Updated to
match /press/ + added yearly pricing ($50/yr Indie, $120/yr
Imprint) + expanded the feature descriptions per tier. Also fixed
the trailing /press → /press/ link.

Files touched
─────────────
  app.html            — sidebar footer +Tiers +Help links
  serials-guide.html  — retitled, added tiers section, PayPal
                        Native throughout, current URLs, Beyond
                        Serials section, Where to Next pointer
  help/index.html     — cost FAQ prices reconciled with /press/

---

Previous batch — kept in commit history:

fix: admin metrics "Last admin digest sent" tile — add missing Firestore rule branch

Jacob 2026-08-04 (metrics screenshot): "Last admin digest sent"
tile showed "err" instead of a timestamp. Root cause found via
critical-paths audit — worker writes fine (service account
bypasses rules) but client-side getDoc from admin/metrics/index.html
hit the default-deny because folio_admin_digest_state had no rule
branch at all.

Fix:
- Add `match /folio_admin_digest_state/{doc}` to
  docs/firestore.rules with `allow read: if isAdmin()` and
  `allow write: if false` (worker-only via service account).
- Add the row to docs/CRITICAL_PATHS.md so future rule audits
  catch this class of bug (same shape as the shelf + imprint
  incidents from 2026-08-03).
- Log the incident in CRITICAL_PATHS.md recent-incidents section.

Same class of bug: worker writes fine → client reads blocked →
silently surfaces as an "err" tile in an admin surface. This is
now the THIRD instance of this pattern in a week, all caught
against CRITICAL_PATHS.md as it exists. The pattern to remember:
whenever you add a new collection touched by a worker AND read
by any client surface (admin or otherwise), immediately add a
rule branch AND a row to the critical-paths table.

Files touched
─────────────
  docs/firestore.rules      — new match block for
                              folio_admin_digest_state
  docs/CRITICAL_PATHS.md    — added the collection to the reads
                              table + logged the 2026-08-04
                              incident

---

Previous batch — kept in commit history:

feat: reader image lightbox — click any book image to zoom, click again to close

Jacob 2026-08-04: readers were struggling to see cover / illustration
details on smaller cards. Now every image in the paginated book
preview is click-to-zoom in reader (and non-edit) mode.

Behaviour
─────────
Delegated click listener on document. When a click's target is an
<img> that's inside #bookPreview AND we're NOT in edit mode AND the
image isn't a drag-marker, opens a full-screen lightbox: dark
backdrop (rgba(10,8,6,0.94)) with the image centered via object-fit:
contain, plus a × button in the corner and a subtle 140ms fade-in.

Any click on the backdrop / image / × button OR pressing Escape
dismisses. Matches Jacob's exact ask: "clicking on it again closes
it out."

Cursor affordance
─────────────────
html[data-reader] #bookPreview img (excluding [data-imgmarker])
gets cursor:zoom-in so readers see the image is clickable at hover.
Skipped in edit mode because those clicks route to _imgClickMarker
(image editor).

Coverage
────────
Delegated pattern catches every image the paginator emits —
inline, full-page, full-bleed, quad plates — because they all
render as <img> tags inside #bookPreview. No per-render wiring
needed. Explicitly skips images inside modals, release UI, boost
picker, etc. because those are outside #bookPreview.

Files touched
─────────────
  app.html    — _openImageLightbox + delegated click listener +
                fade-in keyframes, reader-mode img cursor:zoom-in
                CSS

---

Previous batch — kept in commit history:

feat: info button inline + image sharpness upscale + workspace presets (§1a)

Big turn. Three shipping changes, one plan-doc phase now live.

Shelf info button — moved inline below the blurb
────────────────────────────────────────────────
Jacob: "put it right after the ellipsis on the description that
shows already. If it's at the end of that box, it won't overlap
chips and will actually communicate its job instantly."

Old bottom-right corner button collided with the boost chip,
paid/free/rating badges. Now renders as a subtle "ⓘ more" button
on its own line right below the -webkit-line-clamp blurb, flush
right, styled as the natural continuation of the ellipsis. Only
renders when the folio has a blurb (no dangling more link into
an empty modal). Hover state highlights in the accent-UI green.

Image sharpness — optional upscale-before-WebP
──────────────────────────────────────────────
Physics honesty: upscaling doesn't create real detail. But on 2x
DPR displays (Retina, most modern screens), shelf cards render
at 520x780 device px — sources smaller than that force the
browser to upscale at RENDER time, which looks blurry. Providing
a bigger source at UPLOAD means the browser only ever downscales,
which browsers do well.

Added `upscaleTo` opt to _maybeConvertToWebP. When set, sources
whose SHORTER edge is below the threshold get upscaled (preserving
aspect ratio) using canvas imageSmoothingQuality: 'high' (best
resampling filter available). Cover uploads (handleImages) now
pass `upscaleTo: 1600` — covers are 2:3, so this gives at least
1600x2400 source pixels, comfortably above 2x-DPR shelf display.

Inline images (via _imgModalUpload) do NOT upscale — they render
at author-chosen inline sizes inside the book, different physics.

Upscaled files skip the "must be 15% smaller" check (goal was
dimensions, not size); capped at 2MB to keep Firestore/Storage
happy. Console log honest: "[webp] upscaling foo.png 800x1200 →
1600x2400 (shorter edge < 1600px — no real detail added, but
avoids browser-upscale blur on high-DPI displays)".

Also added upload guidance note under the cover dropzone:
"Upload covers at 1600x2400 or larger for crisp shelf display.
Smaller sources are auto-scaled at upload but this doesn't add
real detail. WebP conversion applied automatically."

Workspace presets — Phase 1 of MODULAR_UI_PLAN.md (§1a)
───────────────────────────────────────────────────────
Three named workspace layouts, toggled via `data-preset` on
<body>, persisted per browser in localStorage `folio_preset`:

  Full (default) — everything visible, current behaviour
  Write          — sidebar shortcuts collapsed + preview toolbar
                   minimised (page size selector, dividers,
                   edit-hint band hidden). Sidebar-header
                   subtitle hidden. Maximises vertical writing
                   space without hiding the sidebar itself.
  Focus          — sidebar + resize handle + preview toolbar +
                   scroll-top/bottom buttons ALL hidden. Preview
                   area expands to full width via grid override.
                   For deep-write sessions.

Picker lives in the sidebar-header (small select next to dark-mode
toggle). Escape-hatch floating button (⚙, bottom-right) appears
in Write / Focus so the author can always change preset back —
opens a small preset menu with hint text explaining each mode.
Outside-click + Escape key both dismiss the menu.

CSS-driven show/hide via body[data-preset="..."] rules — no
JS-generated inline styles, so the transition is instant and
undoable by clearing the attribute. Sidebar-width + scroll
persistence (previous batches) keep working across preset
changes because they read from localStorage independently.

Thomas's "wider editor / fewer distractions" ask that lived on
the TODO list is largely resolved by Write mode.

Deferred (per plan doc):
  §5 sidebar tab grouping (Write/Design/Produce/Ship) — small
     independent ship, kept for a future turn since presets alone
     already solve the main cramping complaint.
  §1b dockable widgets — awaits demand signal from preset usage.

Files touched
─────────────
  app.html    — _maybeConvertToWebP upscaleTo opt + high-quality
                imageSmoothing + upscale-branch size handling,
                handleImages upscaleTo:1600, cover-dropzone
                guidance text; workspace preset CSS block (~120
                lines), sidebar-header preset picker, floating
                escape-hatch button + menu, preset JS runtime
                (apply/set/toggleMenu + hydrate on boot)
  shelf.html  — .shelf-card-info-inline styles + .info-row wrapper,
                removed .shelf-card-info corner button rules,
                infoBtn markup now renders as inline "ⓘ more"
                below the blurb (only if folio has a blurb)

---

Previous batch — kept in commit history:

fix: sidebar drag handle actually draggable + scroll persistence actually persists

Jacob 2026-08-04 follow-up — the previous "fix" batch shipped both
of these but each had a lingering bug that made them not work.

Sidebar drag handle
───────────────────
Root cause of the previous fix not working: the grid template still
had `6px` for the handle column, so the handle's own `width: 8px`
CSS was overridden by the grid track (grid track always wins over
inline width on the grid item). Handle stayed 6px visible, clicks
just outside landed on the sidebar content (which is a scrollable
div with default text selection), and Jacob's cursor started
highlighting frames instead of dragging.

Fix:
- Widened the grid track from 6px to 10px (the ONLY place that
  actually controls handle width — noted in the CSS comment so we
  don't hunt for it next time).
- Handle CSS now `width: 100%` (fills its 10px track).
- ::after overhang reduced from 4px each side to 2px (now 14px
  effective vs the underlying 10px visible) — no longer needed to
  compensate for a 6px track.
- Added `pointer-events: auto` + `z-index: 1` on ::after so nothing
  underneath can steal clicks in the overhang zone.
- Made the vertical ridge (::before) always visible at 35% opacity
  so users see the affordance at rest. Brightens to full opacity in
  the accent-UI color on hover / drag.

Sidebar scroll persistence
──────────────────────────
Root cause of the previous fix not working: on refresh, the sidebar's
tab content re-renders across ~600-1200ms (chapter list, metrics
Firestore query, etc.). Each re-render resets scrollTop to 0. The
save listener saw the 0 and dutifully saved it back to localStorage,
clobbering the real saved position. Restore only tried at 40ms and
400ms so late-rendering tabs never got a working restore.

Fix:
- Added a suppression flag around programmatic scrollTop sets, so
  the "restore" doesn't itself trigger a save.
- Five restore attempts across likely render windows: 40ms, 400ms,
  900ms, 1800ms, 3000ms. Each is a no-op if we've already landed
  within 12px of the saved position, so no visible re-jumping.
- Wrapped window.switchTab() to save-then-restore around every tab
  change so tab-switch-then-close-tab-and-refresh still persists
  the LAST tab's position (the shared .sidebar-scroll gets stomped
  by the incoming tab's layout otherwise).
- Save on beforeunload + pagehide as a safety net — never lose
  position to a crashed save timer.
- Console log `[sidebar-scroll] restored to N via <reason>` on
  successful restores so debugging is trivial next time.

Files touched
─────────────
  app.html    — .app grid-template-columns 6px→10px, handle CSS
                width:100%, ::after overhang 4px→2px + pointer-events
                + z-index, ::before always-visible + accent color on
                hover, scroll persistence rewrite

---

Previous batch — kept in commit history:

fix+feat: markdown heading shortcut + running-title bug + drag-handle rewrite + modular UI plan

Four items — three shipping fixes plus a design doc for the next
big workspace conversation.

Markdown headings (##, ###, ####) in the paragraph renderer
────────────────────────────────────────────────────────────
Author-facing shortcut: a paragraph that starts with 2-4 hashes
+ a space is now rendered as an in-chapter section heading.
  ## Foo   -> H2 (Playfair 1.4x, centered, bold)
  ### Foo  -> H3 (body font 1.2x, left, bold)
  #### Foo -> H4 (body font 1.05x, left, italic bold)
Stored text keeps the hashes so re-render is idempotent. In edit
mode the hashes render at 28% opacity so authors see the marker;
in reader mode they hide entirely so the finished book is clean.
Backspace at line-start still deletes to a plain paragraph
(inherits ordinary editable behaviour).

DOES NOT overlap with the import pipeline's chapter-split logic
(that uses # / ## for chapter breaks at import time only). Once
in an existing chapter's body, these shortcuts are safe.

Running-title dropdown "Author (left) . Chapter (right)"
────────────────────────────────────────────────────────
Bug: the recto slot fell back to book title when the chapter title
was missing, so users saw the book title on the right of every
non-first page even after selecting the chapter-title option.
Root cause: pageWrap(inner, pn, isFirst, chapId, chTitle) — the
5th arg was never passed at chapter render sites, defaulting to
'' and triggering the `chapterTitle || title` fallback.

Fixed by (a) passing ch.title as the 5th arg at both pageWrap call
sites in the chapter render loop, and (b) changing the fallback
from `|| title` to `chapterTitle ? title : ''` so untitled
chapters render a blank recto slot instead of masquerading as the
book title.

Sidebar resize handle
─────────────────────
Rewrote from mousedown/document-mousemove/mouseup to modern
pointer events with setPointerCapture. The old implementation
failed on Jacob's setup: clicking + dragging started text
selection instead of resizing because Chromium began a selection
gesture between mousedown firing and the JS setting
body.folio-resizing. Pointer capture keeps events routed to the
handle regardless of what's under the cursor.

Also:
- Widened handle from 6px to 8px + a 4px overhang each side
  (::after pseudo-element) for a 16px effective hit target so
  imprecise clicks still land on the handle.
- Added `user-select: none` + `touch-action: none` on the handle
  itself as belt-and-braces against selection races.
- Added `selectstart` document listener that preventDefaults
  while dragging is active — final line of defence.
- draggable="false" on the handle so native drag-drop can't
  start.

MODULAR_UI_PLAN.md — design doc
───────────────────────────────
Jacob's ask: "modularize it in such a way that top and bottom
clutter is not cramping the UI. Maybe if we can click and drag
different boxes/widgets and move them around and save/load
common layouts."

Doc explores three tiers of ambition:
  §1a Preset layouts     (4-6h, ships value immediately)
  §1b Dockable widgets   (30-40h, real workspace reconfiguration)
  §1c Free-floating      (60h+, recommend against)

Plus §5 sidebar-tab grouping (Write / Design / Produce / Ship) as
an independent 3-hour ship that stands alone. Names the actual
sources of chrome (top bar, mode strip, bottom bar) so future
work can target real elements. Ends with four decision points for
Jacob to answer before Phase 1 starts.

Recommendation: §5 + §1a with 3 presets this or next session.
Watch which presets get used before investing in §1b's drag
infrastructure.

Files touched
─────────────
  app.html    — heading shortcut in _apRenderPreviewParagraph,
                running-title fallback fix, ch.title through
                pageWrap x2, drag-handle CSS rewrite + pointer-
                events implementation, handle HTML draggable=false
  docs/MODULAR_UI_PLAN.md — new design doc, 4 decision points

---

Previous batch — kept in commit history:

feat: chapter preview strip on shelf info modal (Phase 2, per-folio configurable)

Phase 2 of FOLIO_INFO_SURFACES_PLAN.md — the Indie-tier enhancement
Jacob greenlit after Phase 1 (info modal) shipped last session.

What ships
──────────
Every info modal now renders a "First chapters" strip beneath the
blurb — a stack of clickable chips, one per free-preview chapter.
Each chip shows chapter number, title (up to 80 chars, single-line
ellipsis), and word count (e.g. "2.4k words"). Chip click deep-
links to the reader with ?goto=<chId> and the reader scrolls
straight to that chapter's opening page.

For PAID folios: the strip is the first `previewSections` chapters
(matches what the paywall already lets anonymous readers see).
For FREE folios: the strip is the first 3 chapters as a taste —
enough to feel the voice without spoiling structure.

Per-folio configurable
──────────────────────
New checkbox in the release modal's shelf-fields section:
  "Show chapter preview strip on the info card"

Default ON — the shelf-conversion story wants opening chapter
titles visible. Authors with spoiler-sensitive titles (mystery
reveals, chapter-title-as-punchline structure) uncheck it per-folio.
Setting persists in release.showChapterPreview; the shelf render
respects it via `folio.showChapterPreview !== false` (so pre-strip
folios light up automatically).

Chapter metadata computed at save time
──────────────────────────────────────
release.previewChapterMeta is populated on _rlPublish from the
in-editor chapters array. Each entry is { id, title, wordCount }
so the shelf render is INSTANT — no need to open the body/main
subcollection just to show the strip. Word count strips HTML tags
before counting so the number matches what a reader would count
in the browser.

Reader — new ?goto= URL param
──────────────────────────────
Reader boot already handled ?teaser=<chId> (with a "shared chapter"
banner) for signed-teaser deep-links. Preview-strip clicks don't
warrant that banner — nobody shared it, the reader chose it — so
this batch adds ?goto=<chId> as a plain jump: same double-fire
retry pattern (600ms + 1600ms) for slow-loading paid folios, no
banner. Reuses _rdJumpToChapter which is idempotent.

Deferred (per Jacob's answers to the plan-doc blocking questions):
  • Imprint-tier shelf card exposure (preview chips + buy button
    ON the card itself, no modal needed) — bigger design pass,
    ships alongside the Imprint product page in Phase 3.
  • Per-book reviews — deferred until Imprint product page ships.
  • Bulk-convert existing images to WebP — deferred; Jacob will
    re-upload as needed.

Files touched
─────────────
  app.html    — reader ?goto= parse + jump, save previewChapterMeta
                + showChapterPreview, hydrate rlShowChapterPreview,
                release-modal checkbox HTML
  shelf.html  — read new fields into _allFolios, render preview
                strip in _openFolioInfo modal, CSS for chip row
  docs/FOLIO_INFO_SURFACES_PLAN.md — Jacob's answers logged;
                Imprint shelf-card exposure added as new Phase 3
                scope; roadmap revised

---

Previous batch — kept in commit history:

feat: shelf info modal + auto-WebP + FOLIO_INFO_SURFACES_PLAN doc

Two shipping wins + one design doc.

Shelf info modal (Phase 1)
──────────────────────────
Every shelf card gets an ⓘ button in the bottom-right corner.
Tap → non-navigational modal opens with cover, title, author (linked
to imprint), price, primary genre, rating chip, full blurb,
secondary genres, tags (clickable to filter shelf), meta row
(published, page count, view count, series, language), and a
primary "Open in reader →" CTA. Reads from window._allFolios so
it's instant — no extra Firestore round-trip. Card body click
still opens the reader directly; this is the "before I commit,
tell me more" surface a reader can tap without leaving the shelf.

Card layout tweak: added position:relative so the ⓘ button sits
correctly in the bottom-right without overlapping the pending
review chip in the top-right (they're at opposite corners now).

Auto-WebP conversion on upload
──────────────────────────────
New _maybeConvertToWebP(file, opts) helper — wired into both
image upload paths (Book-tab cover dropzone via handleImages, and
release-modal inline image picker via _imgModalUpload). Client-
side canvas.toBlob('image/webp', 0.85) conversion; the swap
happens ONLY if the WebP is at least 15% smaller than the source,
so already-optimised images aren't churned.

Skips gracefully for files < 40KB, GIFs (animation), SVGs
(vector), already-WebP, and browsers without webp encoding
support. Fallback path returns the ORIGINAL file so callers get a
drop-in replacement — no code path changes at call sites.

Logs the outcome to console — "[webp] converted foo.jpg 480KB →
92KB (81% smaller)" — so authors + developers can see what's
happening during testing.

Not gated behind paid tiers. Client-side conversion costs Folio
nothing, and faster shelf loads benefit every reader. Paid tier
upsell (quality slider, bulk-convert existing, AVIF) is a Phase 2
option — see plan doc.

Plan doc — docs/FOLIO_INFO_SURFACES_PLAN.md
───────────────────────────────────────────
Covers the three-tier vision:
  Free    → info modal (SHIPPED)
  Indie   → enhanced modal (accent stripe, chapter preview strip,
            author's other folios, review snippet)
  Imprint → standalone product page at /folio/<slug> with
            click-behavior override (open reader / open product
            page / open external URL), rich long-blurb authoring,
            layout templates, product-photo assign hook to
            /press/photos/, SEO metadata
Also captures Thomas's asks (print button reposition, wider
editor) with the specific clarification questions needed to
progress. Blocking questions listed at the bottom for Jacob's
call before Phase 2/3 build.

---

Previous batch — kept in commit history:

fix+feat: tag-suggestion click + live stats strip on welcome page

Tag suggestion buttons — HTML escape bug
────────────────────────────────────────
The "+character-driven / +literary / +grief" suggestion chips
under the Tags input in the release modal didn't add tags when
clicked. Root cause: `onclick="window._folioClassify.addTag(' +
JSON.stringify(t) + ')"` produced attribute value
`onclick="window._folioClassify.addTag("slow-burn")"` — nested
double quotes broke the HTML and the browser parsed onclick as
`window._folioClassify.addTag(` with the rest orphaned. Silent
click, no error.

Fix: switched to a data-attribute pattern —
`data-tag="slow-burn" onclick="window._folioClassify.addTag(this.dataset.tag)"`
Sidesteps the escape hell entirely. Click a chip, tag appears,
suggestion disappears from the list.

Live stats strip on welcome page
────────────────────────────────
New "N folios on the Shelf · N authors publishing · N reader
reviews" strip beneath the hero on onfolio.press. Reads live from
Firestore via the same queries the shelf uses (published +
listOnShelf, higher limit for the count). Reviews count uses the
same double-flag filter the testimonials render already uses
(approvedForDisplay + allowMarketing) — both flags mandatory for
anonymous read per the reviews rule.

Deliberately understated visual — small serif numbers in accent
colour, all-caps uppercase micro labels beneath. Hidden entirely
until at least one metric is non-zero (no "0 folios" on the very
first anonymous visit). Piggybacks on the existing
testimonialsBoot script so no new Firebase-init overhead.

Both new queries recorded in CRITICAL_PATHS.md so future rule
changes cross-check against them.

---

Previous batch — kept in commit history:

feat+fix: resizable sidebar, scroll persistence, deploy force-exit

Sidebar UX (Thomas)
───────────────────
1. Sidebar is now resizable on desktop. Drag the 6px handle between
   sidebar and preview to adjust width; range 260-640px, default 360.
   Double-click the handle to reset. Width persists to localStorage
   as folio_sidebar_w and is restored BEFORE first paint (via a
   head-block boot script that mirrors the existing bootRestoreTab
   pattern) so returning sessions don't flash back to the default.
   Handle hidden on mobile (<768px) where the sidebar is a slide-in
   panel rather than a fixed column.

2. Sidebar scroll position persists across reloads. Debounced
   scroll listener saves scrollTop to folio_sidebar_scroll every
   250ms; restore fires on load + a 400ms follow-up to catch
   late-rendered content. Fixes Thomas's "every reload dumps me
   back at the top of the Book tab / Cover Image section" — the
   scroll offset within whichever tab was last active now sticks.

Deploy force-exit — third time's the charm
──────────────────────────────────────────
Even after removing -NoExit from the pinned shortcut, the taskbar
copy stayed open as a bare prompt after Enter — because Windows
caches the parsed shortcut arguments and a Copy-Item to the pinned
.lnk doesn't reliably invalidate that cache. Fixed the ROOT of the
problem instead: Stop-Here now ends with [Environment]::Exit which
force-terminates the powershell.exe process regardless of any
-NoExit flag that may still be lurking in the shortcut's cached
argument list. exit was too polite; this is nuclear and correct.

---

Previous batch — kept in commit history:

fix(paywall): per-chapter buy button + hide Gumroad key input for PayPal Native

Two follow-on paywall fixes after Jacob confirmed the PayPal Buttons
render on the top CTA card:

1. Per-chapter locked-chapter cards now have a purchase button.
   Previously each locked chapter showed the 🔒 icon + "This chapter
   is part of the rest of the book" + "Unlock with a purchase code
   or buy below" but NO button — reader had to scroll back to the
   top CTA to find one. For paypal_native releases, the buy element
   is now a <button> labelled "💳 Purchase with PayPal to unlock →"
   that calls _pwScrollToCTA — smooth-scrolls to the main CTA card
   (where the Buttons SDK is mounted) and pulses it. For custom-
   URL releases, the anchor label uses _pwGuessVendor to say
   "Continue reading on Ko-fi →" (or whichever vendor) instead of
   the domain-only fallback. Gumroad path unchanged.

2. Gumroad license-key input hidden on paypal_native CTA cards.
   Jacob reported the current build still asked for a "XXXX-XXXX-
   XXXX-XXXX" Gumroad-format license key on his PayPal Native
   folio, which is nonsensical — PayPal Native mints a JWT that
   the client stashes automatically via _pwMountPaypalNative's
   onApprove callback. There's nothing for the reader to paste
   manually. Fix: the whole pwpc-have block (input + Unlock
   button + status line) is omitted for paypal_native releases.
   Button-wiring null-guarded so a missing .pwpc-unlock element
   doesn't throw at render time.

Together with the previous batch (dead-code _pwShowGate replaced
with _pwShowPreview + provider-aware _serialShowLockModal), the
PayPal Native paywall flow now works end-to-end with the pressure
Jacob wanted: reader lands on the paywall, sees the main CTA card
with Buttons, sees per-chapter locks each with their own buy
button, clicking any lock scrolls back to the buttons with a
pulse — every locked surface has a purchase path visible from
where the reader is.

---

Previous batch — kept in commit history:

fix(paywall): route paid folios through inline CTA + paypal_native aware lock modal

Two root causes for "PayPal Buttons don't appear + clicking a lock
does nothing" after Jacob's release actually saved with the
paypal_native provider:

1. Dead _pwShowGate branch. The router used to split paid folios
   two ways: _pwShowPreview when the release had previewSections>0
   OR teasers, else _pwShowGate (a modal-style gate). But the
   #pwGate HTML template was removed at some point — the function
   early-returns silently. So a paid release with previewSections=0
   AND no teasers rendered locked TOC rows but NO purchase CTA
   anywhere. Fix: route ALL paid releases through _pwShowPreview
   with previewN=0 as the zero-preview case. The inline CTA card
   is now the single canonical purchase surface. Same fix applied
   to _pwReapply's editorReaderPreview branch.

2. _serialShowLockModal was Gumroad-hardcoded. The click handler on
   locked TOC rows opened this modal, which required
   (release.product || release.checkoutUrl) to consider itself
   "paid" — a paypal_native release has NEITHER, so isPaid was
   false and no buy button rendered at all. Even if isPaid HAD
   been true, the button label + href assumed Gumroad. Fix:
     - isPaid now accepts paypal_native as a valid purchase path
     - Button label is vendor-aware: "Go to purchase (PayPal) →"
       for paypal_native, "Buy on Ko-fi →" (or whatever vendor
       _pwGuessVendor detects) for custom, hardcoded Gumroad text
       stays as fallback for the Gumroad path
     - For paypal_native, the button is a <button> not an <a> —
       clicking it closes the lock modal and calls _pwScrollToCTA
       which smooth-scrolls to the inline CTA card (where the
       PayPal Buttons SDK is mounted) and pulses it briefly so the
       reader can see where the purchase actually happens

Once this ships, the paywall flow for PayPal Native releases works
end-to-end regardless of previewSections setting:
  - No preview → CTA card renders at top of the hidden region with
    PayPal Buttons SDK mounted inline
  - Preview → CTA card renders after the last visible free page,
    same buttons mount
  - Click a locked TOC row → modal explains + button scrolls
    reader to the mounted buttons with a highlight pulse

Deploy this and Jacob's Resonance PayPal Native test should
complete end-to-end for the first time.

---

Previous batch — kept in commit history:

fix(release): P0 paypal_native save silently failed + export-for-support

P0 — paypal_native releases weren't saving
──────────────────────────────────────────
Author picks all their release settings, clicks Update, thinks it
saved. Reopens the modal — everything's clobbered. Root cause:
the paid-mode validation in _rlPublish branched on `custom` vs
implicit-else. paypal_native fell into the else, hit the Gumroad
`if (!productId)` check, silently returned early with a red
status line. No save happened, but the modal closed anyway on
the next click and the settings looked like they'd been eaten.

Also broke PayPal Native paywall rendering as a downstream effect:
release.provider was never persisted as 'paypal_native' because
save never ran, so the paywall render fell into the default
(gumroad) branch and skipped the PayPal Buttons mount slot.

Fix: dedicated paypal_native branch in the validation block —
no productId or checkoutUrl needed (credentials live in Vendor
Connections, account-wide; buttons SDK handles the checkout).
Save proceeds unconditionally so the author isn't blocked from
publishing while they configure the vendor side; the paywall
render shows a "not configured" line if credentials are missing.

Once this ships and the release actually saves, PayPal Native
paywall rendering will start working on Jacob's test folio.

Export release settings for support
───────────────────────────────────
New 🩺 Export for support button next to Publish. Copies a
snapshot of the CURRENT MODAL STATE (not saved Firestore data —
that way in-flight edits that produce bug reports are captured
too) as JSON to clipboard. Redacts unlock codes to
"REDACTED_N_CHARS" so length is preserved without leaking the
secret. Includes classification state, vendor config summary
(via /vendor-owner-config GET when signed-in on a paid folio),
serial settings, subscribe wiring, ageRating, series metadata.

Fallback: if clipboard write fails (Safari private mode, etc.),
downloads as folio-release-<folioId>-<ts>.json.

Solves the "screenshot the whole modal" round-trip when authors
seek support — they paste the JSON, we have every field in
plain text.

---

Previous batch — kept in commit history:

feat+fix: per-chapter import, mobile rename, clipboard menu, pin fix

Per-chapter import (new — the biggest UX unlock in this batch)
──────────────────────────────────────────────────────────────
Each chapter row in the sidebar gets a new ⇧ button. Click →
file picker (docx/txt/md/rtf) → smartSplit runs → one of three
outcomes:

  - 1 section detected: replace this chapter's content in place.
    Only adopts the file's title if the chapter is currently
    untitled (author's manual title always wins).
  - 2+ sections detected: three-way choice dialog:
    (a) Insert AFTER this chapter — keeps this chapter, adds the
        N new sections right after (RECOMMENDED, default framing)
    (b) Replace this chapter with the N new ones
    (c) Merge everything into this chapter as one big content
        block with scene-break separators (advanced case)

Reuses the manuscript-level importer's readFileAsText +
smartSplit paths, so docx heading detection, YAML frontmatter
stripping, scene breaks, and pre/post-matter type detection
all work identically.

Fixes the "import is limited to the initial manuscript" barrier
that made bringing in follow-up chapters awkward.

Mobile rename latency — fixed
─────────────────────────────
updateChTitle() was calling renderPreview() on every keystroke,
which on mobile (or any 10+-chapter folio) made typing feel like
typing through mud — full paginated repaint per character. Debounced
to fire once 350ms after the last keystroke; the state mutation +
autosave stay synchronous so nothing desyncs.

Clipboard actions on the context menu
─────────────────────────────────────
Custom right-click / long-press menu now shows Copy / Cut / Paste
at the top. Priority: navigator.clipboard (async, works on modern
HTTPS) with a document.execCommand fallback for older browsers +
Safari private mode. Copy + Cut show only when there's a selection;
Paste shows on any editable surface (textarea / contenteditable).
Divider hides entirely if no clipboard items are visible.

Fixes the "long-press on mobile has no way to copy/paste" gap —
our menu was suppressing the native browser menu and never
offering replacements.

Pinned taskbar shortcut refresh
───────────────────────────────
create-taskbar-shortcuts.ps1 now finds already-pinned copies in
%APPDATA%\...\User Pinned\TaskBar\ and refreshes them in place.
Fixes "I edited the shortcut but the pinned taskbar icon still
opens with the old arguments" — Windows COPIES the .lnk on first
pin, so later desktop edits don't propagate. Re-run the script
after any shortcut change and the pinned copy updates too. May
need explorer.exe restart to see the icon change; the -NoExit
argument fix takes effect immediately.

---

Previous batch — kept in commit history:

fix(rules): unblock imprint LIST + CRITICAL_PATHS.md tracking table

P0 imprint fix
──────────────
Second query pattern that broke after the `allow get: if true`
rules change: /imprint/?uid=X couldn't load for anonymous readers.
The imprint query is `where('uid','==',X).where('release.published',
'==',true).limit(200)` — every result IS published, but the LIST
rule only covered owner + listOnShelf + admin. Anonymous readers
hit "Missing or insufficient permissions" trying to view any
author's public folios.

Added LIST branch 3: allow when `resource.data.release.published
== true`. Every returned doc satisfies via the query's WHERE
clause. Anonymous readers can now browse author pages without
signing in — as designed.

CRITICAL_PATHS.md — ongoing tracking table
──────────────────────────────────────────
Both the shelf break (earlier this session) and this imprint break
were the same class of bug: adding a new client query without
checking the LIST rule covers it. docs/CRITICAL_PATHS.md is now
the ground truth for "which client query relies on which rule
branch." Maps every surface (/shelf, /imprint, /admin/shelf,
sidebar my-folios, share links, etc.) to its exact query shape
+ the rule branch that allows it.

Includes:
  - Adding-a-new-query checklist (walk through this before
    deploying any new query).
  - Debugging-a-permissions-error checklist (cross-reference the
    table before guessing).
  - Recent incidents log (both permission bugs from today
    logged as append-only history).

Next new page or query MUST update this table. Reviewers can
challenge PRs that don't.

---

Previous batch — kept in commit history:

feat(classify): Folio open taxonomy + power-tags shipped end-to-end

Full Stages 1-4 of the v2 classification plan (docs/BISAC_CLASSIFICATION_
PLAN.md). Free, Folio-owned, no license. Solves the tone-signalling
problem BISAC couldn't have (The Kept Hour = Brontë-chaste fantasy
romance, NOT Romantasy-spicy) via reader-side tag filters.

Backend / data
──────────────
  - docs/folio-taxonomy.json — 37 hand-curated codes across Fiction,
    Crossovers, Young readers, Non-fiction. Includes legacyMap
    (shelfGenre string → FOL code) and reverseMap (FOL code →
    shelfGenre string) so the current single-select Genre dropdown
    keeps working during migration.
  - release.genreCodes[] — new field. Ordered array; [0] is primary.
    Each entry carries { code, label } so display doesn't need
    runtime taxonomy lookups.
  - release.tags[] — new field. Free-text, case-normalised (lower-
    case, hyphenated, 32-char cap), soft cap 24 per folio.
  - Save auto-derives shelfGenre from genreCodes[0] via reverseMap —
    so old shelf's Genre filter dropdown stays populated correctly
    without any client-side change.

Release modal
─────────────
  - New "Genre + tags" section under the Shelf-fields block.
  - Primary genre dropdown, grouped by Fiction / Crossovers /
    Young readers / Non-fiction.
  - Secondary genres (up to 4) as removable chips with a "+ Add
    secondary" chooser.
  - Tag input: type + Enter (or comma) to add a chip; backspace
    on empty input removes the last tag. Per-primary-genre
    starter suggestions ("Popular in Fantasy Romance: slow-burn ·
    enemies-to-lovers · found-family · dark-academia · bronte-chaste").
  - Suggest-on-open banner: when a legacy folio (has shelfGenre,
    no genreCodes) opens in the release modal, offers to convert
    to the picker with a suggested FOL code — one click accepts.

Runtime (window._folioClassify)
───────────────────────────────
  - Loads docs/folio-taxonomy.json lazily on first modal open,
    caches for the session. Falls back to empty taxonomy on fetch
    failure — picker degrades gracefully rather than breaking the
    modal.
  - collectCodes() / collectTags() read out ephemeral picker state
    at save time. Both exposed on window for the save code to call.
  - Tag normalisation is centralised: lowercase, spaces→hyphens,
    strip non-word except hyphen, collapse hyphens, 32-char cap.
    Prevents "slow burn" / "slow-burn" / "slowburn" fragmentation.

Shelf display + filters
───────────────────────
  - Card render: primary genre label pulled from genreCodes[0]
    (falls back to legacy GENRE_LABELS[shelfGenre] for old folios).
    Top-3 tags appear as pill chips below the card foot; each links
    to /shelf?tag=<tag>.
  - New filter row under the primary controls: "With any of:"
    include input (comma-separated, ANY-OF semantics) + "Hide any:"
    exclude input (NONE-OF semantics). ?tag= and ?nottag= URL
    params combine with the input values so tag-chip clicks feed
    the include list.
  - The Kept Hour test at ship: filter Include tag 'spicy' → The
    Kept Hour does NOT appear (because it's tagged
    'no-explicit-content'). This is the operator combination
    that authorial-intent-respects. Reader arrives at the right
    book, not the wrong one.

Slotted into TOMORROW_PLAN.md as Stage 3.6 (SHIPPED) with the
deferred items called out: Genre multi-select popover with
operators, cross-folio tag autocomplete, folio-page render of
secondaries + tags, admin surface counts.

Small follow-on polish in same batch: the tag-filter inputs on the
shelf now hydrate from ?tag= / ?nottag= URL params on boot, so
readers arriving via a tag chip SEE the active filter in the input
rather than experiencing its effect without visual context.

---

Previous batch — kept in commit history:

fix(rules): unblock anonymous shelf LIST + open-taxonomy plan pivot

Rules — P0 shelf regression
───────────────────────────
Anonymous readers hitting /shelf on mobile / incognito were getting
FirebaseError: Missing or insufficient permissions. Root cause: the
earlier rules change ("allow get: if true; allow list: if
isUser(uid) || isAdmin()") opened per-doc GET but left the collection
LIST rule locked to owner + admin — so the public shelf's own query
(`where('release.listOnShelf','==',true).where('release.published',
'==',true)`) failed the rules check for every anonymous session.

Fix: LIST now allowed when the query filters to shelf-listed folios
(`resource.data.release.listOnShelf == true`) in addition to the
existing owner + admin branches. Every returned doc satisfies the
rule because the query constraint enforces the filter. Any
unfiltered `collection(folio_projects)` query stays denied — the
"no enumeration" invariant is preserved.

Classification plan v2 (docs/BISAC_CLASSIFICATION_PLAN.md)
──────────────────────────────────────────────────────────
Rewrote the plan from paid BISAC → free, Folio-owned taxonomy with
power-user filter operators. Not worth $225/yr for a platform that
isn't paying for itself, and BISAC didn't solve the tone-signalling
problem anyway (its "Romance / Gothic" leaf couldn't tell readers a
book was Brontë-chaste vs Romantasy-spicy). Tags do that; the
pivot elevates them to first-class.

Key design changes from v1:
  - ~35-entry hand-curated genre list, shipped as
    docs/folio-taxonomy.json. Folio-owned codes (FOL_*), free,
    editable in the repo.
  - Tags are first-class + rich (soft-cap 24 per folio). Community-
    curated via autocomplete-against-existing-tags. Signal tone,
    trope shape, mood, structure, and content advisories that
    coarse genres can't.
  - Filter operators: INCLUDE (ANY / ALL) + EXCLUDE on both
    genres and tags. Solves the Romantasy trap directly — reader
    filters INCLUDE Fantasy+Romance EXCLUDE spicy/explicit, gets
    The Kept Hour but not the steam-forward Romantasy books.
  - New test case: The Kept Hour (Brontë-chaste fantasy/romance/
    scifi). Nine-step verification at the bottom of the plan;
    step 9 (reader filters INCLUDE 'spicy' and The Kept Hour does
    NOT appear because it's tagged 'no-explicit-content') is the
    step BISAC couldn't have given us.
  - Effort estimate: ~12h across 3 sessions (vs 13-16h for v1),
    since the taxonomy is 35 entries instead of 4000+.
  - Forward-compat: if we ever want BISAC on top (retailer sync),
    add a one-time mapping table; schema doesn't have to change.

Not yet slotted into TOMORROW_PLAN.md — waiting on Jacob's
greenlight of the pivoted plan first.

---

Previous batch — kept in commit history:

feat(images): 2x2 plate layout + deploy shortcut closes on Enter

Two small quality-of-life shipments:

1. Quad (2x2) image layout — a new size option in the insert-image
   modal, alongside Small / Medium / Full / Full page. Selecting Quad
   swaps the single-image selector for a live 2x2 plate picker:
   click library thumbnails above to fill the four slots in order
   (upper-left, upper-right, lower-left, lower-right); click any
   filled slot to clear it. Renders as a real CSS grid — square
   plate, four object-cover tiles, gap between cells that matches
   the rest of the folio's typography scale. Empty slots show a
   subtle "plate N" placeholder so the grid geometry stays intact
   even when only 3 of 4 plates are populated.

   Data model: same __IMG__ marker line, with a new `ids` array of
   up to four image ids and `size:"quad"`. Singular `id` field is
   populated with the first non-empty slot for downstream single-
   image consumers (thumbnails, exports that fall back to a
   placeholder). Alignment is always centered; bleed is disabled
   (quads are inline flow blocks, not full-page treatments).

   Use case: classical illustration/frontispiece plate spreads.
   Wife's four hand-drawn character studies, chapter-opening
   fourfold thematic art, quartet portraits — anything the author
   wants to present as a single unified figure rather than four
   separate inline images stacked vertically.

2. Deploy shortcut closes cleanly on Enter. Dropped the -NoExit
   flag from the shortcut's PowerShell invocation. The deploy
   script's Stop-Here helper already prompts "Press Enter to
   close..." at the end via Read-Host, so the window still holds
   long enough to read the summary; pressing Enter now exits the
   script AND closes the window (previously -NoExit left a raw
   PS prompt hanging around after Enter). Re-run
   create-taskbar-shortcuts.ps1 to update your pinned shortcut,
   or edit the shortcut's Arguments manually to remove -NoExit.

---

Previous batch — kept in commit history:

ux(release-modal): collapse vendor picker + tighter deploy CORS

Release modal
─────────────
Vendor picker used to keep all three provider buttons visible after
you clicked one — visually noisy once you've made your choice. Now
picks collapse to a single-line chip: "Using PayPal (native
checkout) — [Change vendor]". The "Change vendor" button re-opens
the full picker. Matches Jacob's original design proposal (the
release modal is for THIS folio's release settings; account-wide
credential setup belongs in Vendor Connections).

Follows through on that split:
  - PayPal Native section in the release modal shrank from a full
    Client ID + Secret + Save form to a compact "Open Vendor
    connections" link with a live "✓ Connected / Not connected"
    status line so the author knows the state without leaving.
  - Credential form ONLY lives in Vendor Connections now.
    /vendor-owner-config still accepts writes from either surface
    but the release modal no longer duplicates the fields.

Deploy CORS
───────────
gsutil isn't installed on Jacob's machine so the CORS step was
skipping every deploy — Firebase Storage was running with default
permissive CORS. Two fixes:
  - The deploy now prefers `gcloud storage buckets update` (newer,
    ships with current Google Cloud SDK) and falls back to `gsutil
    cors set` if only the older tool is around.
  - When neither is installed, prints TWO clear paths: (Option A)
    the Google Cloud Console web UI URL that lets you paste the
    config once, (Option B) install the Google Cloud SDK link so
    future deploys apply CORS automatically. Both take ~5 minutes.

Bucket name + config file path pulled into vars for readability.

---

Previous batch — kept in commit history:

feat(vendor-connections): account-wide credentials modal

New Vendor Connections modal (sidebar footer, alongside Release
button). Shows three sections — PayPal (native checkout) first
(recommended), then Ko-fi, then Payhip. Each section:

  - Live connection status pill (Connected + last-updated timestamp
    OR Not connected)
  - Credential fields with intelligent placeholders (when connected,
    fields read "configured — paste new value to update, or leave
    blank")
  - Save + Disconnect buttons per vendor
  - For Ko-fi + Payhip: the webhook URL surfaces below the fields
    with click-to-copy affordance, matching Folio's own conventions
    for account-scoped URLs
  - PayPal Native's public Client ID is echoed back in the text
    input so authors can confirm which PayPal account is on file
    (the Secret is never echoed — masked forever after save)

Uses the same /vendor-owner-config GET+POST endpoints as the release-
modal inline UI. Both paths write to the same
folio_vendor_owner_configs/{ownerUid} doc — so authors who set things
up either way stay in sync. The modal is the recommended surface
for account-wide setup; the release-modal inline path stays for
authors who prefer to configure while releasing.

Reached from the new "Vendor connections" button beneath Release in
the sidebar footer. Only sign-in-verified accounts can open it
(gates match the release modal's own signed-in-required rule).

Also in this batch:
  - Rewrote create-taskbar-shortcuts.ps1 in ASCII-only so PS 5.1
    doesn't choke on em-dashes and arrows when reading the BOM-less
    UTF-8 file. Same trap the deploy-*.ps1 hit and fixed with a BOM;
    for a small utility script ASCII is simpler than shepherding BOM
    state. Also removed the PNG-fallback branch since PNGs don't
    render as .lnk icons on Windows — script now prefers any .ico
    in the repo, falls back to a generic Windows imageres.dll icon.

---

Previous batch — kept in commit history:

feat(paywall+tools): Path C polish + taskbar shortcut helper

Path C — vendor auto-detect on the paywall CTA
──────────────────────────────────────────────
Redirect-vendor releases (release.provider === 'custom') used to
show a generic "Buy & get unlock code →" button regardless of the
actual vendor, leaving the reader with no idea WHERE the button
would send them. Adds _pwGuessVendor(url) which recognises Ko-fi,
Payhip, PayPal, PayPal.me, Gumroad, Stripe, Lemon Squeezy, Buy Me
a Coffee, Patreon, Substack, itch.io, Kickstarter, Indiegogo from
their checkout URL patterns.

Where the vendor is recognised:
  • CTA button label becomes "Buy on Ko-fi →" (or whichever vendor)
    unless the author has overridden ctaLabel.
  • A small hint line appears under the button: "You'll be
    redirected to Ko-fi for secure checkout, then your unlock link
    arrives here by email within 60 seconds." Also suppressed if
    the author set a ctaBlurb.
  • Same treatment applied to the reader-drawer audio-CTA path
    (rdad-cta) so audiobook purchases feel identically grounded.

Anything not in the table falls through to the generic default —
no regression for exotic checkout URLs.

Taskbar shortcut helper — new scripts/create-taskbar-shortcuts.ps1
──────────────────────────────────────────────────────────────────
Windows blocks direct pinning of .cmd/.ps1 files and raw folder
paths. Workaround: create .lnk shortcuts whose *target* is
powershell.exe (for scripts) or explorer.exe (for folders); those
Windows accepts. Run the helper once, right-click each resulting
desktop shortcut, "Pin to taskbar."

Auto-picks the newest deploy-*.ps1 in scripts/ so it stays valid as
we roll out new deploy batches — re-run the helper any time.

---

Previous batch — kept in commit history:

feat(paypal-native): Path A shipped — inline PayPal Buttons checkout

Also in this batch: fixes for the image-insert cover side-effect,
click-to-edit on freshly-inserted images, and release-independent
share links.

═══ Path A — PayPal Native ═══════════════════════════════════════

Reader lands on a paid folio, sees the PayPal Buttons SDK inline
on the paywall, clicks Buy, popup opens for PayPal login/approval,
popup closes on approval, worker captures the payment against the
AUTHOR's PayPal Business account, mints an unlock JWT, dispatches
the confirmation emails. Buyer never leaves Folio.

Backend (folio-paywall-worker.js):
  - _VENDOR_KINDS extended with 'paypal_native'.
  - /vendor-owner-config accepts { vendor:'paypal_native', clientId,
    secret } — clientId is public (embedded in the Buttons SDK URL)
    so it's returned by the GET; secret stays server-side only.
  - GET  /paypal-native-config?folio=<id> — public. Returns author's
    Client ID + price + currency + title so the paywall can render.
  - POST /paypal-create-order — creates a PayPal order via the
    author's credentials (ppAccessTokenFor helper — parameterized
    version of ppAccessToken). Returns { orderId } for the SDK's
    onCreateOrder callback.
  - POST /paypal-capture-order — captures the approved order, mints
    the unlock JWT (same shape as Ko-fi flow), records the sale,
    dispatches buyer + owner emails via the email worker. Returns
    { ok, token, unlockUrl } so the paywall unlocks in place
    without waiting for the email.

Frontend (app.html):
  - Release modal: new "PayPal (native checkout)" provider button
    alongside Custom + Gumroad. Selecting it shows an inline config
    panel for Client ID + Secret + "Save" that hits /vendor-owner-
    config. Saves apply account-wide — every folio the author sells
    via PayPal Native reuses the same credentials.
  - Release save: provider now accepts 'paypal_native' as a stored
    value (previously only 'custom' / 'gumroad'). Save + hydrate
    paths updated in parallel.
  - Paywall lock card: when release.provider === 'paypal_native',
    the buy-now anchor is replaced with a mount slot that
    _pwMountPaypalNative populates. That function fetches the
    config, injects the PayPal SDK for the author's Client ID,
    renders paypal.Buttons with createOrder + onApprove wired to
    /paypal-create-order + /paypal-capture-order, stashes the
    returned JWT in localStorage, and switches the folio to
    unlocked view — no page reload.
  - Same-Client-ID SDK loads are deduped via a per-Client-ID script
    tag id; per-release mount is a Set of releaseIds so repeat
    renders don't stack multiple Buttons.

Money invariant: payments land DIRECTLY in the author's PayPal
Business account (Folio's API keys are never used for buyer
transactions). Folio is never merchant of record. Same "0% cut"
posture as the redirect vendors.

═══ Image-insert fixes ═══════════════════════════════════════════

  - Cover no longer gets clobbered by inline uploads. _imgRefreshCover
    now preserves an existing cover if the image is still in the
    library; only promotes "first image" when there's no cover yet
    OR the current cover was removed. _imgModalUpload (the inline
    insert path) doesn't call _imgRefreshCover at all — inline
    uploads add to the library without touching cover designation.
    Fixes Thomas's cover-getting-replaced issue.
  - Click-to-edit on rendered images now works even when the chapter
    has a preserved blank paragraph before the image. Root cause:
    render stamped paraIdx as the index into _paragraphsOf() output
    (which includes blank paragraphs up to MAX_BLANK_RUN), while
    _imgFilteredToRaw only counted non-empty raw lines — indices
    diverged the moment ANY blank paragraph existed. Rewrote
    _imgFilteredToRaw to mirror _paragraphsOf's walk exactly. Same
    fix applied to the writing-mode caret → paraIdx calculation.
  - Writing-mode textarea now mirrors ch.content on insert/update/
    remove so the __IMG__ marker line shows immediately without
    needing to close writing mode (was in prior batch, mentioned
    here for completeness).

═══ Share links pre-release ══════════════════════════════════════

Firestore rules loosened further: per-doc GET on folio_projects is
now unrestricted (the folio ID's ~10^10 combinations ARE the
credential). LIST stays owner-scoped so nobody can enumerate the
collection. body/paid stays owner-only via the paywall worker's
JWT-verified service-account path. Share links (reader / beta /
editor) now work on pure drafts before any release object exists.

Rationale: Jacob's mental model is "generating a share URL IS the
distribute gesture" — requiring a release step first was friction
that broke the beta-reader workflow. New rule matches that.

folioVisible(id) simplified to `parentDoc(id) != null` — same
"if the folio exists, its metadata is fetchable" posture propagated
to subcollections (characters, metadata, presence, annotations).

═══════════════════════════════════════════════════════════════════

Previous batch — kept in commit history:

fix+feat(images): writing-mode Insert works, drag-to-reorder in preview

Two related fixes to Thomas's image struggle:

1. Insert image from writing-mode context menu now WORKS. Previously
   it either silently failed or showed a "switch to preview mode"
   toast that was easy to miss. Now the handler flushes any pending
   textarea edits, derives the caret's paragraph index (raw line
   → filtered non-empty-line count), and opens the standard insert
   modal targeting that paragraph. After the modal confirms, the
   writing-area textarea is mirrored with the updated ch.content so
   the __IMG__ marker line appears immediately without needing to
   close writing mode. Same treatment applied to _imgUpdateMarker +
   _imgRemoveMarker so edits and deletions stay in sync too.

2. Drag inline images in the preview to reorder them, no writing-
   mode round-trip required. In edit mode every rendered image is
   draggable="true"; dragging one onto another swaps their positions
   in ch.content (same chapter → straight swap; cross-chapter →
   swap-in-place with content lists preserving length so no index
   shifts). Event handlers install once via delegation on the
   preview scroller so re-renders don't need re-wiring. Source
   image gets a subtle shrink + fade during drag, drop target gets
   a dashed accent outline. Same-chapter swap-with-self is a no-op.

---

Previous batch — kept in commit history:

ux(chapters): split drag-drop targets into upper/lower halves

Reordering the chapter list previously highlighted the whole target
row on hover and always inserted BEFORE the target. That made it
impossible to tell whether a drop would land above or below the row,
and — critically — made it feel like you couldn't drag a PRE
section (frontispiece, dedication, prologue) above the auto-inserted
Table of Contents at position 0. Jacob had to work around by
dragging Contents DOWN below the PRE section instead of PRE up.

New behaviour:
  - Each row splits into two half-height drop zones. Hovering the
    top half shows a coloured line ABOVE the row; bottom half shows
    a line BELOW. The drop position mirrors what you see.
  - Drop math adjusts for source-removal shift so above/below reads
    naturally regardless of drag direction. Edge cases (drop-on-self,
    drop just above the next-neighbour) become no-ops rather than
    unintended swaps.
  - .drag-over-top / .drag-over-bottom classes with a 3px accent-
    colour box-shadow give a clean insertion-line visual — no
    layout shift, no ghost rows, minimal reflow.

Same drop UX standard as Notion / Trello / VS Code file trees. Works
for every row type (Pre, Ch, Post, TOC) — no type-based restrictions
on where you can drop, since the author is the authority on their
book's structure.

---

Previous batch — kept in commit history:

fix(rules): unblock share links on unpublished folios

Anonymous readers hitting reader / beta / editor share links on
UNPUBLISHED folios were getting FirebaseError: Missing or insufficient
permissions from getDoc(folio_projects/{id}). The prior rule only
allowed non-owner reads when release.published == true, which
excluded every legitimate beta/editor sharing scenario (the whole
point of beta shares is pre-publication feedback).

The fix aligns the rule with the release-modal's mental model:
creating a release object AT ALL — Public & free, Paid, or
Private link — is itself the "I want this distributable via URL"
signal. Folio IDs are timestamp + 6-char random suffix (~10^10
guesses), unguessable in practice; the URL is the credential.

New helper parentHasRelease(id) mirrors parentPublished(id) but
checks release != null rather than release.published == true.
folioVisible(id) — used by subcollection read rules (body/main,
metadata, etc.) — now returns true when parentHasRelease.

body/paid stays owner-only. Paid content still routes through the
paywall worker's /paid-content endpoint which HMAC-verifies the
share/paywall JWT via service account before returning anything.
No change to paid-content security.

folio_projects/{id} top-level read rule updated in parallel
(the rule uses resource.data.uid directly, not the helper).

---

Previous batch — kept in commit history:

feat(auth): full anonymous → Google migration on sign-in

Previously, when an anonymous user tried to link to a Google account
that already had its own Firebase uid, Firebase threw
auth/credential-already-in-use and we silently signed them into the
existing Google account. Anything they'd built on the anon session
(folios, comps, subscribers, metrics) was orphaned in Firestore —
"contact support" was the recovery path.

This batch fixes it end-to-end:

1. Worker endpoint POST /migrate-anon-to-google
   Body: { anonIdToken, googleIdToken }. Verifies both tokens
   via Identity Toolkit, extracts uids from the verified tokens
   (never trusts client-provided uids). Then via service account:
     - Queries folio_projects where uid == anonUid (up to 100)
     - PATCHes each doc's uid to googleUid. Subcollections
       (body/, versions/, subscribers/, paid_sales/, metrics/)
       stay put because they're keyed by folio ID, not uid.
     - Reads folio_user_settings/{anonUid} + /{googleUid}, merges
       ONLY scalar fields that don't already exist on the Google
       side. Critical fields like pressSubscription on the Google
       side are never overwritten by anon-side data.
   Returns { migrated, failed, anonUid, googleUid, notes[] }.

2. Client refactor — release-modal sign-in prompt
   (window._rlShelfSignInPrompt in app.html):
     - Captures the anon ID token BEFORE the popup (once
       signInWithCredential fires the anon session is dead and
       its token can't be regenerated).
     - Tries linkWithPopup. On success the anon uid is preserved
       with Google added as a provider — no migration needed.
     - On credential-already-in-use: extracts credential via
       GoogleAuthProvider.credentialFromError, signs into the
       existing Google account via signInWithCredential, calls
       /migrate-anon-to-google, then reloads the app so
       everything re-renders under the new uid.
     - Shows migration progress + result in the release modal's
       status line.

3. GIS sign-in flow (sidebar / main app sign-in button) gets the
   same treatment. Captures anon token BEFORE linkWithCredential
   attempt, falls back through migration on credential-in-use.
   The legacy _restoreFolioBackupAfterUpgrade path (localStorage
   backup of just the currently-open folio) stays as a
   belt-and-braces safety net if the worker migration fails.

4. Fixed the sibling regression from the previous batch: when
   onAuthStateChanged fired with no user AND
   localStorage.folio_had_real_session === '1', we were skipping
   auto-anon entirely — leaving the app hanging on "Loading your
   folios…" forever because downstream code expects SOME user.
   Now auto-anon runs unconditionally; the folio-needs-resignin
   event still fires so the amber re-sign-in banner shows on top,
   giving the user a one-click path back to their real account.

5. New re-sign-in banner (app.html top of page). Listens for the
   folio-needs-resignin event, renders a dismissible amber bar:
   "Your Google session was cleared. You were signed in as
   <email>. Sign back in to reach your existing folios."
   Clicking the button signs out the fresh anon session first
   (so linkWithCredential doesn't collide with the pre-existing
   admin uid) then opens the Google popup. Dismissing hides for
   the tab; reappears on next reload if the situation persists.
   Auto-removes on successful non-anon sign-in.

Related UI polish:
  - "Review Folio" button lifted out of the collapsible Shortcuts
    <details> — now a sibling so it stays visible even when the
    Shortcuts menu is collapsed. Amber-tinted background lifts it
    above the neutral row of sibling buttons.
  - Two-line label ("Review Folio" / "Earn a free 24h Featured
    Boost") makes the exchange explicit; tooltip expands.
  - Modal intro explicitly says "Honest reviews of Folio itself"
    to distinguish from any book-review flow.
  - Help page (/help/) gains a "Reviews + feedback" section with
    deep-linkable #reviews anchor referenced from the modal.

---

Previous batch — kept in commit history:

fix(auth): kill flash-of-signed-out across all admin subpages

Follow-up to the earlier anon-account-churn fix. Even after
persistence was stabilized, Jacob kept getting kicked to the sign-in
gate mid-navigation ("clicking Review moderation particularly
invalidates it immediately"). Two contributing issues:

1. First-render race. Every admin subpage was calling
   onAuthStateChanged BEFORE Firebase's IndexedDB hydration had
   settled. That first fire came through with user=null, we rendered
   the sign-in gate, and then a second fire came through with the
   real Google user — but the gate had already flashed into view
   and read as an auth invalidation. Fix: await authStateReady()
   (Firebase v10.14+; polled fallback for older builds) BEFORE
   wiring the listener, and fire the initial handler synchronously
   with the resolved state.

2. Anonymous sessions from app.html were still leaking into admin
   pages when Firefox ETP purged auth.jacobsiler.com storage.
   The admin pages now treat anonymous identically to signed-out —
   sign-in gate, no confusing "signed in as ANON_UID / not on
   allowlist" combo. Sign-in button signs the anonymous session out
   first before opening the Google popup so linkWithCredential
   can't collide with the pre-existing admin uid.

Structural changes:
  - New "authLoading" splash on every admin subpage. Shown by default;
    swapped for either the sign-in gate or the admin body once auth
    resolves. Prevents the sign-in gate from ever being visible
    during the hydration window.
  - Persistence ladder standardised: indexedDBLocalPersistence first
    (Firefox ETP resilient), browserLocalPersistence fallback for
    Safari private mode.
  - New FolioAdmin.bootAuth helper in admin/_shared.js consolidates
    the auth-plumbing boilerplate. Existing pages keep their inline
    boot() (each has page-specific rendering); new admin pages should
    call bootAuth to inherit these fixes automatically.

Pages updated: admin/index.html, admin/reviews/, admin/shelf/,
admin/metrics/, admin/press/, admin/admins/, admin/boost/.

---

Previous batch — kept in commit history:

fix(auth): stop anonymous account churn clobbering admin sessions

Root cause: Firefox ETP + Chrome's third-party-storage protections
treat the custom auth.jacobsiler.com domain as third-party and purge
its IndexedDB between visits. When app.html's onAuthStateChanged
then fired with user=null, it silently auto-created a fresh
anonymous account. That new anon session became the current auth
state — and when Jacob navigated back to /admin/, the console
showed 'Signed in as ANON_UID — not on admin allowlist' every
single visit, driving him nuts.

Fixes in this batch:

1. app.html — explicit persistence setup. Try indexedDBLocalPersistence
   first, fall back to browserLocalPersistence. The SDK's default is
   already local, but the fallback ladder can silently drop to
   session-only when IndexedDB is blocked — being explicit at least
   documents intent + logs a warning if it can't be set at all.

2. app.html — history-aware auto-anon guard. Every non-anonymous
   sign-in stamps localStorage.folio_had_real_session=1. When
   onAuthStateChanged later fires with null, we check that flag:
     - Flag absent → first-time visitor, auto-anon as before
       (preserves the "try Folio without signing up" path).
     - Flag present → their real session was wiped; do NOT create
       a new anon that would orphan every subsequent uid. Instead
       fire a folio-needs-resignin event and let the user re-sign-in
       cleanly.

3. admin/index.html — anonymous sessions rendered as signed-out.
   Anonymous uid + 'not on allowlist' error text read as if Jacob
   needed to sign out first. Now anonymous is treated identically to
   the no-user case: sign-in gate visible, no confusing 'signed in
   as ANON_UID' line, no allowlist error. Clicking Sign in with
   Google signs the anon out first (so linkWithCredential doesn't
   collide with the pre-existing admin uid) then does a fresh popup.

---

Previous batch — kept in commit history:

feat(moderation): tiered ratings, contact author, sign-in gate

Content rating tiers replace the single hasAdultContent boolean:
  all / 12+ / 16+ / 18+. Any rating above 'all' queues for moderator
  review; 16+ and 18+ are hidden from signed-out shelf visitors. Save
  logic re-queues on ANY rating change (up OR down) so an approved
  18+ folio can't silently downgrade to 'all' and appear to signed-out
  browsers. Legacy hasAdultContent stays in sync (=== 18+) for older
  readers/exports that key off the boolean.

Moderator experience on /admin/shelf/:
  - Rating dropdown on every card: pick All / 12+ / 16+ / 18+, saves
    immediately (no confirm), audit stamps written
    (shelfRatingSetByModerator + shelfRatingSetAt).
  - Contact author button opens templated composer + hands off to
    the moderator's mail client via mailto:. Templates cover the
    common cases: structural fixes, rating adjustment, content policy
    check, approval welcome, blank.
  - Fact sheet in the Contact modal — Firebase Auth record for the
    author (email, display name, sign-in providers, account creation,
    last sign-in, disabled flag, federated Google profile URL). Used
    both for outreach and as the paper trail if a report ever needs
    to go to authorities.
  - New /admin/user-lookup?uid=X&key=<ADMIN_DEBUG_TOKEN> endpoint on
    the paywall worker fetches Firebase Auth records via service
    account. Used as the fallback when folio_user_settings/{uid}.
    lastEmail is missing (older signups that pre-date the merge-write).

Sign-in gate for Shelf listing:
  - Anonymous accounts can no longer publish to the public Shelf.
    Ticking List on Shelf while anonymous swaps the sub-fields for
    a sign-in prompt that uses Firebase's linkWithCredential path
    (via the existing GIS handler around app.html:7871) so the
    anonymous uid is preserved and Google gets attached — every
    folio, comp, subscription, and metric on that uid survives.
  - Save-time guard: listOnShelf silently downgrades to false if the
    user is anonymous at save time. Firestore rule enforces the
    same constraint server-side (request.auth.token.firebase.
    sign_in_provider != 'anonymous' required for release.
    listOnShelf == true) so a bad client can't force it. Admins
    bypass so moderator write-throughs still work.

Shelf display:
  - New rating badges: 12+ (teal), 16+ (amber), 🔞 18+ (existing
    adult styling). All ages renders no badge.
  - 16+/18+ hidden from signed-out visitors on the shelf grid
    (12+ stays visible; teen-appropriate content doesn't need a
    login gate).
  - Author metrics tab publish-state line shows the specific tier
    (Rated 12+ / Rated 16+ / Rated 🔞 18+) instead of the old
    all-or-nothing "Adult content flag".

Admin metrics dashboard:
  - "Adult-flagged" tile replaced with "Rated content" —
    breakdown as "X at 12+ · Y at 16+ · Z at 18+" so Jacob sees
    per-tier volume at a glance.
  - Recently-published table renders tier-specific rating chips
    instead of a flat "adult" bucket.

Firestore rules:
  - folio_projects create + update require
    request.auth.token.firebase.sign_in_provider != 'anonymous'
    when release.listOnShelf is being set true.

---

Previous batch — kept in commit history:

feat(paid folios): multi-tenant vendor auto-delivery

Vendor webhook secrets are now stored ONCE per Folio account rather
than once per folio. Previously an author with two Ko-fi-backed
folios needed two Ko-fi accounts (Ko-fi only lets you set one
webhook URL per account). Now:

  - One /vendor-owner-config doc per account
    (folio_vendor_owner_configs/{ownerUid}) with { vendors: { kofi:
    { secret, ownerEmail, updatedAt }, payhip: {...}, paypal: {...} } }
  - Three new fixed webhook URLs — /kofi-webhook, /payhip-webhook,
    /paypal-webhook — that any vendor purchase routes to
  - Webhook lookup:
      Ko-fi   -> owner identified by matching verification_token in
                 the payload against configured kofi.secret
      Payhip  -> HMAC signature enumerated against every configured
                 payhip.secret; first match wins
      PayPal  -> PayPal verify-signature endpoint called with each
                 configured paypal webhook_id; first SUCCESS wins
  - Folio matching (after owner is known):
      Ko-fi   -> shop_items[0].direct_link_code slug matched to the
                 /s/{slug} tail of release.checkoutUrl
      Payhip  -> product_link / product_id matched into checkoutUrl
      PayPal  -> reference_id / item name matched into checkoutUrl
                 (PayPal.me is ident-poor; if only one paid folio
                 exists for the owner, we fall through to it)
    If no folio matches, we log and return 200 so the vendor doesn't
    retry — sale is real, routing is manual until the release URL
    is fixed.
  - Legacy /vendor-webhook/{folioId} endpoint stays live for
    backwards compat: folios already configured that way keep firing
    through the old per-folio config.

Client changes (app.html, release modal):
  - Save writes to /vendor-owner-config (no folioId). "Account-wide
    setup" callout at the top of the auto-delivery drawer.
  - On modal open, GET /vendor-owner-config preloads which vendors
    are already connected. Picking a vendor that's already connected
    shows "✓ already connected on your account — paste new secret
    only to rotate" + reveals the webhook URL box immediately.
  - Disable now says "disconnect from account" (was "disable for
    this folio") with a warning that it affects every paid folio
    using that vendor.

Firestore rules:
  - folio_vendor_owner_configs/{ownerUid} — read/write: if false
    (worker-only via service account, same pattern as folio_vendor_
    webhooks/{folioId}).

No new env bindings or secrets required — reuses GCP_SERVICE_ACCOUNT,
PAYWALL_JWT_SECRET, EMAIL_WORKER binding, and (from PayPal) the
existing paypal_client_id / paypal_client_secret pair.

---

Previous batch — kept in commit history:

fix(reader): robust page-clipping + blank-paragraph persistence

Two Thomas-reported production bugs, both fixed with a single audit
of the paragraph pipeline:

1. Text clipping at page bottom (phone AND laptop, still hitting after
   the 0.5-to-1.2-line slack bump on 2026-07-20). Root causes: fonts
   not fully loaded at first paginate, sub-pixel drift on non-integer
   viewports, drop-cap float behaviour mismatch. Fixes:
     - Pagination slack bumped 1.2 to 2.5 lines (worst case: ~2 lines
       whitespace at page bottom; alternative is losing paid-customer
       content off the bottom which we do NOT accept)
     - document.fonts.ready gate before first pagination (re-renders
       once real fonts swap in)
     - Post-render watchdog _fixOverflowingPages: walks every
       .page-content, detects scrollHeight > clientHeight, tags with
       .page-overflowed for a visible fade + ellipsis instead of an
       invisible hard-clip, logs chapter+page to console so we can
       diagnose any remaining drift

2. Blank paragraphs (author scene-separators, psalm gaps) silently
   deleted. Root cause: ~30 rendering/export sites used the idiom
   ch.content.split('\n').filter(p => p.trim()) which dropped every
   empty line. Fixes:
     - New canonical splitter _paragraphsOf() preserves internal blanks
       up to a MAX_BLANK_RUN cap of 3
     - All 33 call sites migrated to _paragraphsOf via automated rewrite
     - Reader renders blank paragraphs as one-line editable spacers
     - Pagination measures blanks as lineH so page budgets stay honest
     - Enter key in preview editor now inserts a blank paragraph after
       the current one (was previously just calling .blur()); Backspace
       on an empty spacer paragraph deletes it and pulls the caret to
       the previous line. Feels like every other rich-text editor.
     - _onParaBlur / _onEditBlur walk _paragraphsOf so paraIdx stays
       consistent between render and save-back
     - EPUB, XHTML, RTF, DOCX exports all emit visible blank paragraphs

Also in this batch:
- fix(app): rename _paragraphsOf helper to avoid identifier collision
  with the pre-existing _splitParas array used by the manuscript split
  editor (the collision produced 'Identifier already declared' and
  killed the entire <script> block, blanking the whole app)
- fix(admin/admins): renderRoles() used \\' escapes inside single-quoted
  strings which closed the string prematurely and threw a SyntaxError
  that killed the whole boot script, leaving the page body blank.
  Rewrote button HTML with double-quoted strings + esc() on uid.
- fix(admin/press): revokeSub() had a duplicated try{} block left over
  from the earlier VS Code truncation-recovery paste -- 'Missing catch
  or finally after try' killed boot(), so the page hung on the
  'Checking sign-in...' placeholder forever. Removed the duplicate.
- fix(GH Pages): add .nojekyll so /admin/_shared.js actually publishes.
  GitHub Pages runs Jekyll by default and Jekyll excludes every file
  whose name starts with '_'. That's why /admin/boost's author-lookup
  widget was completely invisible in production -- the FolioAdmin
  script silently 404'd. .nojekyll disables Jekyll for the whole site
  so any file we ship reaches the browser.
- fix(find & replace): pick the correct continuation slice when a
  paragraph is split across pages. Long paragraphs render as a head
  slice + one or more .para-cont slices, all sharing data-paraidx.
  Old code always picked the head (:not(.para-cont)). If the match
  lived in the middle/tail, the needle wasn't in the head's walked
  text so we fell back to pulsing the whole head slice -- which on
  screen appeared as an unrelated short paragraph like "quarter-
  inch." (screenshot 2026-07-22: searching "Tarin" pulsed
  "quarter-inch." because "Tarin" was in a continuation slice on a
  later page). Now we enumerate all slices, walk each in DOM order
  tracking cumulative text length, and pick the slice whose range
  covers match.start - paraStartInContent. Also shift
  paraStartInContent so the highlight helper's offset math
  references the CHOSEN slice's start, not the whole paragraph's.
- fix(find & replace): highlight now waits for scroll to actually
  stop rather than firing on a fixed 520 ms timer. Chrome smooth-
  scroll takes 300 ms for short jumps and 1500+ ms across dozens
  of pages, so long-distance finds pulsed and faded before the
  paragraph arrived on screen. rAF-poll scrollTop; fire when it's
  been stable for 3 consecutive frames, hard-cap 2500 ms.
- fix(find & replace): highlight lands on the ACTUAL match now.
  Bug 2026-07-22: search "Corlan" 3/497 -> highlight lands on "since"
  ~13 chars before the real Corlan. Two compounding issues:
    (a) old code searched el.innerText (whitespace-collapsed, CSS-
        transformed) then walked TreeWalker text nodes (raw) to build
        the Range -- any whitespace or transform difference shifted
        boundaries. Fixed by walking ONCE, building the searchable
        string from the same text nodes so search offsets and Range
        offsets reference identical char indices.
    (b) even after (a), a paragraph containing multiple occurrences
        of the needle always got the FIRST hit. Now enumerate all
        occurrences and pick the one CLOSEST to the expected
        position derived from match.start - paraStartInContent.
        Handles both duplicates and residual offset drift from
        markdown emphasis chars stripped by md().
- ui(release modal): payment provider order swapped. "Any vendor
  (recommended)" now the default + first button; Gumroad moved to
  second position. Fresh new releases default to Custom + Auto-
  deliver; existing folios keep whichever provider they were saved
  with. Provider hint copy rewritten to lead with the vendors it
  supports (Ko-fi, Payhip, PayPal, Stripe, Lemon Squeezy) rather
  than the generic "any vendor" abstraction, so authors immediately
  see recognisable brand names.
- feat(deploy script): now runs wrangler deploy for both workers
  after the git push. Graceful skip if wrangler isn't on PATH; per-
  worker skip if that worker's toml isn't present locally
  (email worker's wrangler-email.toml is gitignored because it may
  carry env-specific bindings). A single deploy-script run now
  publishes site + workers together.
- feat(paid-folio help): in-modal walkthrough drawer with per-vendor
  click-by-click setup. "Show me exactly what to do" link opens
  tabbed guides for Ko-fi / Payhip / PayPal — each tells the author
  EXACTLY where to click (Ko-fi's Verification Token under More >
  Account Settings > API/Webhooks, Payhip's Signing Secret under
  Settings > Site Integration > IPN, PayPal's Webhook ID from
  developer.paypal.com after adding a webhook). Written for authors
  not developers — no jargon, "you can't break anything" language,
  explicit "where does this live in the vendor's dashboard" hints.
- feat(spacing): new line-break marker syntax [-N-] renders as N
  blank lines. [-] = 1 line, [--] = 2, [-----] = 5, any N. Bracketed
  so it can't collide with markdown horizontal-rule scene-breaks.
  Paginator budgets N x lineH for the marker; preview renders it
  as a monospace centered spacer at 35% opacity in edit mode, fully
  invisible in reader mode. Closes Thomas's "I want to control the
  space between Psalms" request without needing rich text.
- feat(paid folios — Option C+): full vendor-webhook auto-delivery
  of unlock codes. Owner picks a vendor (Ko-fi, Payhip, or PayPal),
  pastes its webhook secret in the release modal, gets back a per-
  folio webhook URL to paste into the vendor's dashboard. On any
  purchase:
    1. Vendor POSTs to /vendor-webhook/{folioId} on the paywall
       worker with the sale details.
    2. Worker validates the vendor-specific signature (Ko-fi's
       verification_token, Payhip's HMAC-SHA256, PayPal Webhooks V2
       verify-signature endpoint), extracts buyer email + amount +
       order id.
    3. Mints a per-purchase JWT unlock token signed with the
       existing PAYWALL_JWT_SECRET.
    4. Calls the email worker's new /send-unlock endpoint (auth via
       shared X-Internal-Secret) which sends two Resend emails:
         a. Buyer gets a one-click unlock link:
            /app.html?read=<folioId>&pwToken=<jwt> — clicking it
            stores the token in localStorage automatically, no code
            paste, no friction, works on any device.
         b. Owner gets a sale notification with amount + buyer
            email + vendor.
    5. Sale recorded under folio_projects/{id}/paid_sales/{ts_uuid}
       for revenue metrics.
  Vendor config stored in folio_vendor_webhooks/{folioId} —
  worker-only via service account, never exposed to clients (the
  secret would let anyone forge a purchase).
  New client-side URL-token pickup: on reader boot, if ?pwToken=
  is in the URL, decode + verify release matches + stash in
  localStorage + strip from URL bar (so shared URLs don't leak the
  token).
  New env bindings needed on the paywall worker:
    EMAIL_WORKER_URL     = https://folio-email.jacobsiler.workers.dev
    EMAIL_WORKER_SECRET  = <random 32+ char string, same on both>
  And on the email worker:
    INTERNAL_WORKER_SECRET = <same value>
- rule(folio_vendor_webhooks): worker-only (allow r/w if false).
- rule(folio_projects/{id}/paid_sales/{d}): owner + admin read,
  worker-only write.
- ui(mobile round 2): reader bar and editor toolbar tidy-up.
  Reader bar: chapter picker was allowed max-width 220px which on
  a 360px phone consumed most of the row and pushed Aa/notes/audio/
  menu off-screen (Jacob 2026-07-22 screenshot). Now on <=768px:
  chapter picker capped at 130px, title font shrunk + max-width 90px
  with subtitle hidden, all buttons icon-only (Shelf text label
  dropped, Back button collapses to a left-arrow glyph via
  ::before), Tour button hidden entirely (still reachable from the
  menu later), overflow-x:auto as a safety net if anything still
  overflows so nothing becomes unreachable.
  Editor toolbar: the two vertical | dividers now tagged with
  .tb-divider and hidden below 768px so the toolbar wrapping
  reads as natural row breaks rather than cluttered visual noise.
- feat(auth): every non-anonymous sign-in now writes a stub
  folio_user_settings/{uid} doc with lastEmail + lastDisplayName +
  signInAt. Previously the doc was only created when someone saved
  an audio setting or a shelf entry — brand-new signups were
  invisible to the admin /user-list endpoint until they DID
  something. Now every sign-in is instantly trackable + comp-able.
  Merge-write with a stable set of fields so subsequent sign-ins
  refresh lastEmail without stomping other settings.
- feat(user-list): endpoint returns email + displayName so admin
  search can match on either. /admin/press dropdown now filters on
  author name, uid, title, email, and Google display name — paste
  any of them and the right user surfaces.
- feat(user-list): server-side endpoint surfaces unpublished
  signed-in users so /admin/press can comp them before they publish
  and /admin/metrics can track total user growth. New GET /user-list
  ?key=<ADMIN_DEBUG_TOKEN> on the paywall worker lists all
  folio_user_settings via service account (bypasses the LIST rule
  that denies clients), cross-references folio_projects for per-uid
  folio + published counts, and folio_imprint_themes for display
  names + founding-contributor flag. Returns compact JSON sorted
  paid-first, comp-second, published-third, then everyone else.
  /admin/press picks it up and merges those users into the search
  dropdown (labelled "signed in, no folios yet") when the ADMIN_
  DEBUG_TOKEN is cached in localStorage; offers a click-to-paste
  prompt if missing. /admin/metrics adds a "Signed-in users" tile
  in the Content section and switches Revenue buckets to count
  ALL users, not just published ones — so Jacob sees his actual
  growth curve and full subscription-tier distribution.
- feat(editor suggestions): full owner review flow shipped.
  When someone with an editor/collab share link edits the manuscript
  and hits save, their edits divert to
  folio_projects/{id}/suggestions/{their-uid} rather than clobbering
  body/main. Owner sees a new "Reviewer suggestions" panel on the
  Folio tab with:
    - Live badge showing pending-change count across all reviewers
    - Per-reviewer card with name, role, timestamp, and Reject-all
    - Per-chapter row with one-line change summary
      (title/added-N-words/removed-N-words/text-tweaks)
    - "Preview" opens a full side-by-side modal (master left,
      suggested right) with an Accept-this-chapter button
    - "Accept" copies the reviewer's chapter content into your
      master chapters array, saves, and prunes just that chapter
      from the reviewer's suggestion doc (so it stops appearing on
      refresh). Deletes the whole reviewer doc when nothing changed
      remains.
  Firestore rule added for folio_projects/{id}/suggestions/{uid}:
  create/update by suggester (stamped with suggestedByUid); read by
  owner + suggester; delete by owner or suggester.
- feat(events pipeline): full ingestion + rollup infrastructure
  for time-series metrics. Three moving parts landed together:
    1. Paywall worker: POST /event validates + stamps + writes to
       folio_events collection. Attaches server timestamp, Cloudflare
       cf-ipcountry geo, sanitized Referer, and extracts reader uid
       from paywall JWT if present. Kind whitelist (view, chapter_
       open, read_complete, paywall_hit, purchase, tip, boost_click)
       -- unknown kinds rejected. 512-byte meta size cap. Doc id
       prefixed YYYYMMDD_ so rollup queries range by __name__.
    2. Client tracker: window._folioTrack(kind, folioId, extra) in
       app.html. Uses navigator.sendBeacon (or fetch keepalive with
       auth) so it doesn't block page unload. 5-second per-key dedupe
       so scroll storms don't flood. Call sites installed for view
       (reader boot), chapter_open + read_complete (reader chapter
       jump). Purchase / tip / boost_click sites to come via their
       existing success handlers.
    3. Email worker: runMetricsRollup() daily cron pass. Latched
       at folio_metrics_rollup_state/latch so cron cadence is safe;
       rolls up to 3 days per tick. Uses runQuery with __name__
       range on folio_events (no composite index needed). Aggregates
       per folio into folio_projects/{id}/metrics/daily_YYYYMMDD
       docs (views - chapter_opens - chapter_open_by_id map - read_
       completes - paywall_hits - purchases - purchase_amount -
       tips - tip_amount - countries - top-20 referrers - computedAt).
       New GET /metrics-rollup?key=<token>[&day=YYYYMMDD] endpoint
       for manual trigger/backfill.
- rules(folio_events + metrics subcollection):
    folio_events                     -> read/write: if false (worker only)
    folio_projects/{id}/metrics/{d}  -> read: owner OR admin; write: false
- feat(author metrics): sparklines + drop-off + geo + referrers now
  populate from the rollup docs when they exist. 30-day sparkline
  and per-chapter drop-off render for Indie+; top countries + top
  referrers render for Imprint. Rendered as inline SVG / flexbox
  bars -- no Chart.js dependency added to the editor bundle. Falls
  back gracefully to "activates with event tracking" placeholder
  text on days with no rollup data.
- fix(deploy script): "nothing to commit" (all local changes already
  on origin) no longer treated as fatal. Prints a gray note and
  continues to git push in case origin was behind for some reason.
  Real commit failures (with staged/unstaged changes) still abort
  and dump git status --short so you can see what's dirty.
- feat(author metrics): new sidebar tab in the editor next to
  Manuscript / Book / Audio / ☁ Folio. Content varies by Press tier
  per the pricing-page contract:
    Free    -> basic 2×2 grid (Views - Subscribers - Reviews - Annots)
              plus live publish-state pill (Published / Pending
              moderation / Featured Xh left / Adult flag) and gold
              upsell tiles pointing to Indie + Imprint unlocks.
    Indie   -> same basic grid + 30-day sparkline slot + per-chapter
              drop-off slot (both marked "activates with event
              tracking" until Task #18 ships) + Imprint upsell for
              geo + referrers.
    Imprint -> everything unlocked; the two Imprint-only slots (Top
              countries, Top referrers) replace the upsells.
  All counts today are REAL live reads: viewCount from the folio
  doc, subcollection sizes for subscribers + annotations, filtered
  reviews query for review count + avg rating. Reuses window.pressSub()
  as the tier gate (same helper the boost UI uses) so no new
  subscription plumbing.
- feat(admin/metrics): platform dashboard live at /admin/metrics/.
  Three sections shipping today, all using only queries firestore
  rules can prove satisfiable (no unbounded LIST). Content: published
  folio count, unique authors, imprint themes, founding contributors,
  pending shelf moderation, adult-flagged, currently featured, all-
  time viewCount sum. Revenue: buckets published-authors by tier
  (paid Imprint / paid Indie / comped Imprint / comped Indie / free)
  via per-uid getDoc against folio_user_settings -- batched 6
  concurrent. Health: reviews pending vs approved (needs the reviews
  rule update below), last admin digest timestamp. Recent activity:
  8 most recently-published folios with pending/adult/featured
  badges. Follow-up noted inline: subscription counts among
  UNPUBLISHED subscribers need a /subscription-counts endpoint on
  the paywall worker (service account bypasses client rules).
- feat(pricing): revised Indie vs Imprint analytics ladder.
    - Indie now: 30-day view sparkline + per-chapter drop-off
      ("reader engagement" fundamentals).
    - Imprint now: everything Indie plus geo + referrers
      ("marketing analytics" -- where to invest).
  This is a deliberate commitment upsell: Free proves the count,
  Indie proves the engagement pattern, Imprint proves where to
  invest marketing. Copy updated on /press/ tier cards.
- rule(reviews): allow read now includes || isAdmin() so the
  moderation queue + metrics dashboard can list pending reviews
  reliably. Was working incidentally when all reviews happened to
  match the (approvedForDisplay && allowMarketing) clause but broke
  as soon as pending items arrived.
- docs/METRICS_PLAN.md updated with the revised tier gating.
- fix(paginator): FRONT-MATTER and BACK-MATTER now paginate.
  Root cause of Thomas's Introduction cramming everything onto one
  page then getting hidden by the .page-overflowed fade: renderPreview
  had a special-case branch for type=='pre'||'post' that dumped ALL
  paragraphs into a single pageWrap call and returned early -- the
  full paginator (measure + slice + multi-page flow) was chapter-only.
  Routed pre/post through the same paginator; guarded chapter-only
  bits (chapter number, chapter image) behind an isBodyChapter flag
  so front matter still displays without "Chapter N" prefix. The
  overflow watchdog + fade become the last-resort safety net they
  were always meant to be, not the primary "gee this section is long"
  failure mode.
- ui(mobile): editor UI tidy-up per Jacob's phone screenshot.
  Three collisions:
    1. Preview toolbar's 9+ controls overflowed off-screen with no
       visible scroll affordance. Now flex-wraps to 2-3 rows on
       mobile with a 52-px left gutter so the fixed hamburger has
       dedicated space. Zoom slider gets min-width so it doesn't
       collapse to a thumb-with-no-track when other controls wrap
       around it.
    2. On very narrow screens (<480 px) the  Edit and  Preview
       as reader buttons collapse to icon-only via a ::before pseudo
       element (title tooltips preserved).
    3. Book page rendered at 864 px (150 % zoom - Trade 6×9″) is
       wider than a 400-px phone viewport, clipping text off both
       sides. New _mobileAutoFit() fires zoomFit() at boot + on
       resize/orientation change so the page always fits. Belt-and-
       braces: .book-page max-width:calc(100vw-16px) + preview-
       scroller overflow-x:auto so manual override becomes a
       horizontal pan instead of silent clipping.
- ui(sidebar): auto-version snapshots collapsed under a closed
  <details> disclosure by default. Manual " Save version" entries
  render inline as before; auto snapshots go under "Auto-saved
  snapshots (N)" so they stop drowning the panel. Rotates a small ▶
  caret when open. (Jacob 2026-07-21.)
- fix(find & replace): NAVIGATION rewrite -- the previous version
  called scrollToChapter first (which starts a smooth scroll to the
  chapter top) and then queued the paragraph-center scroll 220 ms
  later, so the two animations raced and the browser landed
  somewhere between them. Now for content matches we skip
  scrollToChapter entirely and go straight to the target paragraph
  via native scrollIntoView({block:'center'}) -- that walks the
  ancestor chain and scrolls whichever element is the real overflow
  container (previous manual math targeted #previewScroller which
  has overflow:visible and isn't actually the scroller). Highlight
  overlay flash is delayed to 520 ms so the rects are drawn at the
  paragraph's FINAL screen position rather than pre-scroll. Title
  matches still use scrollToChapter (title block is only anchored
  by [id=chap-<chId>]).
- fix(find & replace): centered highlight on the actual match.
  Previously frJumpToCurrent called scrollToChapter which landed at
  the chapter top with no signal of where in that chapter the word
  actually was. Now we map match.start (raw content offset) to the
  containing paragraph via _paragraphsOf, scroll that paragraph to
  the CENTER of the preview scroller (custom offset math because
  scrollIntoView block:'center' undershoots inside our fixed
  toolbar layout), then flash a fixed-position highlight overlay
  built from Range.getClientRects() on the matched substring --
  no DOM mutation of contenteditable paragraphs. Falls back to a
  full-paragraph outline pulse for title matches or when substring
  ranging fails.
- feat(admin/admins): author search widget now on the Role Management
  page too. Imports _shared.js, wires FolioAdmin.mountAuthorLookup
  into a new roleAuthorLookupSlot right above the Target UID input,
  and picking a suggestion auto-fills both the UID and the Display
  name. Same safe queries as admin/press (published + world-readable
  imprint themes).
- feat(admin/press): plan/comp indicator chip next to every author in
  the search dropdown. After the author list loads, each author's
  folio_user_settings/{uid}.pressSubscription is fetched (single-doc
  reads, no LIST -- safe) and classified into Free / Comp - Tier /
  Paid - Tier / Expired - Tier / Cancelled, with a gold * for founding
  contributors. Batched 6 at a time; live-refreshes the open dropdown
  as chips resolve. So Jacob can spot "already comped" or "already
  paid" before wasting a click, and skip unnecessary grants.
- fix(admin author lookup): the "Loading known authors..." widget was
  running three unfiltered LIST queries against folio_projects,
  folio_imprint_themes, and folio_user_settings. Firestore's rule
  engine cannot short-circuit isAdmin() for unbounded LIST queries,
  so folio_projects and folio_user_settings returned
  `permission-denied` -- and a denied LIST puts the whole Firestore
  SDK into offline mode, which is exactly what surfaced as the
  "client is offline" error blocking the editor after sign-in.
  Diagnosed live via Chrome MCP: `folio_projects` unfiltered ->
  permission-denied; `where('release.published', '==', true)` -> 7
  docs in 208ms. Rewrote both admin/press/_loadAuthorList and
  admin/_shared.js mountAuthorLookup to use only queries the rules
  can prove satisfiable: published-folios filter + world-readable
  folio_imprint_themes. Dropped the folio_user_settings source --
  admins paste UID directly for signed-in-but-unpublished users
  (the input already existed for that path). Added fb.where to the
  helpers passed from admin/boost and to mountAuthorLookup's arg
  validation.
"@
    $msg | Out-File -FilePath $msgPath -Encoding utf8 -NoNewline

    & git commit -F $msgPath
    if ($LASTEXITCODE -ne 0) {
        # Distinguish "nothing to commit" (benign -- everything is already
        # committed and probably already pushed) from a real failure.
        # Real failures leave uncommitted changes in `git status`.
        $porcelain = (& git status --porcelain 2>$null) -join ""
        if ([string]::IsNullOrWhiteSpace($porcelain)) {
            Write-Host "  Nothing new to commit -- working tree already matches HEAD." -ForegroundColor Gray
            Write-Host "  Continuing to push in case origin is behind." -ForegroundColor Gray
        } else {
            Write-Host "git commit failed (exit $LASTEXITCODE)." -ForegroundColor Red
            Write-Host "Uncommitted changes:" -ForegroundColor Yellow
            & git status --short
            Stop-Here $LASTEXITCODE
        }
    }

    & git push
    if ($LASTEXITCODE -ne 0) {
        # 'Everything up-to-date' also returns 0 for push, so a non-zero
        # here is a real failure (network, auth, non-fast-forward, etc.).
        Write-Host "git push failed (exit $LASTEXITCODE)." -ForegroundColor Red
        Stop-Here $LASTEXITCODE
    }

    # -- 6. Cloudflare Workers (paywall + email) ----------------------
    # Deploys BOTH workers after the git push so any code that shipped
    # to GitHub Pages this batch matches the worker code Cloudflare
    # runs. Skipped gracefully if wrangler isn't on PATH; skipped for
    # a specific worker if its wrangler config isn't present locally.
    # ----------------------------------------------------------------
    Write-Host ""
    Write-Host "-- Cloudflare Workers deploy --" -ForegroundColor Cyan
    $wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
    if (-not $wrangler) { $wrangler = Get-Command wrangler.cmd -ErrorAction SilentlyContinue }
    if (-not $wrangler) {
        Write-Host "wrangler CLI not on PATH." -ForegroundColor Yellow
        Write-Host "  Install with:  npm install -g wrangler" -ForegroundColor Yellow
        Write-Host "  Then deploy the workers manually:" -ForegroundColor Yellow
        Write-Host "     wrangler deploy --config wrangler.toml" -ForegroundColor Yellow
        Write-Host "     wrangler deploy --config wrangler-email.toml" -ForegroundColor Yellow
    } else {
        # Paywall worker — always deploy (wrangler.toml is tracked).
        if (Test-Path "wrangler.toml") {
            Write-Host "  wrangler deploy (paywall) ..." -ForegroundColor Cyan
            & $wrangler.Source deploy --config wrangler.toml
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  wrangler deploy (paywall) failed (exit $LASTEXITCODE)." -ForegroundColor Red
                Stop-Here $LASTEXITCODE
            }
        } else {
            Write-Host "  wrangler.toml missing — skipping paywall worker." -ForegroundColor Yellow
        }
        # Email worker — deploy only if its config is present locally.
        # wrangler-email.toml is gitignored (may carry cron triggers +
        # binding hints specific to Jacob's environment), so it's not
        # tracked but it's expected to exist on the dev machine.
        if (Test-Path "wrangler-email.toml") {
            Write-Host "  wrangler deploy (email) ..." -ForegroundColor Cyan
            & $wrangler.Source deploy --config wrangler-email.toml
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  wrangler deploy (email) failed (exit $LASTEXITCODE)." -ForegroundColor Red
                Stop-Here $LASTEXITCODE
            }
        } else {
            Write-Host "  wrangler-email.toml not found locally — skipping email worker." -ForegroundColor Yellow
            Write-Host "  If you meant to deploy it, run:  wrangler deploy --config wrangler-email.toml" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "All deployed. GitHub Pages publishes in ~30-60 seconds." -ForegroundColor Green
    Write-Host "Test at: https://www.onfolio.press/admin/" -ForegroundColor Green
    Stop-Here 0

} catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Stop-Here 1
}
