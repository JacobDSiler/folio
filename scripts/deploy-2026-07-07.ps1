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
    exit $code
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
    Write-Host ""
    Write-Host "-- Firebase Storage CORS --" -ForegroundColor Cyan
    $gsutil = Get-Command gsutil -ErrorAction SilentlyContinue
    if (-not $gsutil) { $gsutil = Get-Command gsutil.cmd -ErrorAction SilentlyContinue }
    if (-not $gsutil) {
        Write-Host "gsutil not on PATH. Install Google Cloud SDK or run this step manually:" -ForegroundColor Yellow
        Write-Host "  gsutil cors set docs\firebase-storage-cors.json gs://miscellaneous-117e9.firebasestorage.app" -ForegroundColor Yellow
    } else {
        & gsutil cors set docs\firebase-storage-cors.json gs://miscellaneous-117e9.firebasestorage.app
        if ($LASTEXITCODE -ne 0) { Write-Host "gsutil failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
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
    # index.html is the main welcome/marketing page — it kept getting
    # dropped from this list, which is why deploys sometimes silently
    # skipped a batch when index.html was the only file changed. Added
    # 2026-07-17 after "your branch is up to date with origin/main"
    # errors traced back here.
    & git add index.html
    & git add app.html shelf.html
    # Product photo templates — the .psdt files themselves stay in
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
    & git add help\index.html
    & git add admin\_shared.js
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
    & git add docs\METRICS_PLAN.md
    & git add folio-paywall-worker.js
    & git add scripts\deploy-2026-07-07.ps1 scripts\deploy-2026-07-07.cmd

    # Commit message in a temp file so multi-line + non-ASCII survive
    # the round-trip through PowerShell -> git.
    $msgPath = Join-Path $env:TEMP "folio-deploy-2026-07-07.msg"
    $msg = @"
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
  from the earlier VS Code truncation-recovery paste — 'Missing catch
  or finally after try' killed boot(), so the page hung on the
  'Checking sign-in…' placeholder forever. Removed the duplicate.
- fix(GH Pages): add .nojekyll so /admin/_shared.js actually publishes.
  GitHub Pages runs Jekyll by default and Jekyll excludes every file
  whose name starts with '_'. That's why /admin/boost's author-lookup
  widget was completely invisible in production — the FolioAdmin
  script silently 404'd. .nojekyll disables Jekyll for the whole site
  so any file we ship reaches the browser.
- fix(find & replace): highlight lands on the ACTUAL match now.
  Bug 2026-07-22: search "Corlan" 3/497 → highlight lands on "since"
  ~13 chars before the real Corlan. Two compounding issues:
    (a) old code searched el.innerText (whitespace-collapsed, CSS-
        transformed) then walked TreeWalker text nodes (raw) to build
        the Range — any whitespace or transform difference shifted
        boundaries. Fixed by walking ONCE, building the searchable
        string from the same text nodes so search offsets and Range
        offsets reference identical char indices.
    (b) even after (a), a paragraph containing multiple occurrences
        of the needle always got the FIRST hit. Now enumerate all
        occurrences and pick the one CLOSEST to the expected
        position derived from match.start - paraStartInContent.
        Handles both duplicates and residual offset drift from
        markdown emphasis chars stripped by md().
- feat(admin/metrics): platform dashboard live at /admin/metrics/.
  Three sections shipping today, all using only queries firestore
  rules can prove satisfiable (no unbounded LIST). Content: published
  folio count, unique authors, imprint themes, founding contributors,
  pending shelf moderation, adult-flagged, currently featured, all-
  time viewCount sum. Revenue: buckets published-authors by tier
  (paid Imprint / paid Indie / comped Imprint / comped Indie / free)
  via per-uid getDoc against folio_user_settings — batched 6
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
      ("marketing analytics" — where to invest).
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
  paragraphs into a single pageWrap call and returned early — the
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
    2. On very narrow screens (<480 px) the ✏ Edit and 👁 Preview
       as reader buttons collapse to icon-only via a ::before pseudo
       element (title tooltips preserved).
    3. Book page rendered at 864 px (150 % zoom · Trade 6×9″) is
       wider than a 400-px phone viewport, clipping text off both
       sides. New _mobileAutoFit() fires zoomFit() at boot + on
       resize/orientation change so the page always fits. Belt-and-
       braces: .book-page max-width:calc(100vw-16px) + preview-
       scroller overflow-x:auto so manual override becomes a
       horizontal pan instead of silent clipping.
- ui(sidebar): auto-version snapshots collapsed under a closed
  <details> disclosure by default. Manual "📌 Save version" entries
  render inline as before; auto snapshots go under "Auto-saved
  snapshots (N)" so they stop drowning the panel. Rotates a small ▶
  caret when open. (Jacob 2026-07-21.)
- fix(find & replace): NAVIGATION rewrite — the previous version
  called scrollToChapter first (which starts a smooth scroll to the
  chapter top) and then queued the paragraph-center scroll 220 ms
  later, so the two animations raced and the browser landed
  somewhere between them. Now for content matches we skip
  scrollToChapter entirely and go straight to the target paragraph
  via native scrollIntoView({block:'center'}) — that walks the
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
  built from Range.getClientRects() on the matched substring —
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
  reads, no LIST — safe) and classified into Free / Comp · Tier /
  Paid · Tier / Expired · Tier / Cancelled, with a gold ✨ for founding
  contributors. Batched 6 at a time; live-refreshes the open dropdown
  as chips resolve. So Jacob can spot "already comped" or "already
  paid" before wasting a click, and skip unnecessary grants.
- fix(admin author lookup): the "Loading known authors…" widget was
  running three unfiltered LIST queries against folio_projects,
  folio_imprint_themes, and folio_user_settings. Firestore's rule
  engine cannot short-circuit isAdmin() for unbounded LIST queries,
  so folio_projects and folio_user_settings returned
  `permission-denied` — and a denied LIST puts the whole Firestore
  SDK into offline mode, which is exactly what surfaced as the
  "client is offline" error blocking the editor after sign-in.
  Diagnosed live via Chrome MCP: `folio_projects` unfiltered →
  permission-denied; `where('release.published', '==', true)` → 7
  docs in 208ms. Rewrote both admin/press/_loadAuthorList and
  admin/_shared.js mountAuthorLookup to use only queries the rules
  can prove satisfiable: published-folios filter + world-readable
  folio_imprint_themes. Dropped the folio_user_settings source —
  admins paste UID directly for signed-in-but-unpublished users
  (the input already existed for that path). Added fb.where to the
  helpers passed from admin/boost and to mountAuthorLookup's arg
  validation.
"@
    $msg | Out-File -FilePath $msgPath -Encoding utf8 -NoNewline

    & git commit -F $msgPath
    if ($LASTEXITCODE -ne 0) { Write-Host "git commit failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }

    & git push
    if ($LASTEXITCODE -ne 0) { Write-Host "git push failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }

    Write-Host ""
    Write-Host "All deployed. GitHub Pages publishes in ~30-60 seconds." -ForegroundColor Green
    Write-Host "Test at: https://www.onfolio.press/admin/" -ForegroundColor Green
    Stop-Here 0

} catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Stop-Here 1
}
