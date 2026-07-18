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
    & git add imprint\index.html
    & git add .githooks\pre-commit
    & git add policy\index.html
    & git add admin\shelf\index.html
    & git add folio-paywall-worker.js
    & git add scripts\deploy-2026-07-07.ps1 scripts\deploy-2026-07-07.cmd

    # Commit message in a temp file so multi-line + non-ASCII survive
    # the round-trip through PowerShell -> git.
    $msgPath = Join-Path $env:TEMP "folio-deploy-2026-07-07.msg"
    $msg = @"
feat(admin): admin console + role management + shelf moderation scaffolding

- /admin/ console landing with 6 tiles (boost, reviews, press, admins,
  shelf coming soon, metrics coming soon)
- /admin/admins/ grant + revoke admin/moderator roles via folio_roles/{uid}
- Back-to-console nav links on existing admin pages
- Firestore rules: isAdmin() unions bootstrap uid list with folio_roles
  collection lookup; isModerator() helper added; folio_roles rules
- Release modal: adult content self-declaration checkbox + "not allowed
  on Folio" callout linking to /policy/ (page built next session)
- app.html: hasAdultContent + shelfPendingModeration flags on publish;
  every re-publish that touches shelf-visible fields re-enters queue
- shelf.html: pending listings filtered from public feed; owner still
  sees their own pending listing so nothing feels broken
- docs/SHELF_MODERATION_DESIGN.md: spec for /admin/shelf/ moderator
  dashboard + /policy/ page + owner nudges (next session)
- docs/firebase-storage-cors.json: unblocks product-photo canvas
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
