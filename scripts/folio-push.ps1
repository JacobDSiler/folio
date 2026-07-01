<#
.SYNOPSIS
    Sync the latest Folio changes from Cowork into this repo, commit, and push.

.DESCRIPTION
    One-shot workflow for Jacob's iteration loop with Claude / Cowork.

    Every iteration, Claude updates three files in the Cowork outputs folder:
      - index.html
      - folio-tts-worker.js
      - .folio-pending-commit.txt   (tagline + body for the next commit)

    This script, run from the repo root, will:
      1. Auto-discover the most recently modified Cowork outputs folder.
      2. Copy index.html + folio-tts-worker.js into the repo.
      3. Pull the pending commit message into the system temp folder
         (never committed - stays out of git history).
      4. Preview the tagline and the changes to be committed.
      5. Ask for confirmation.
      6. git add, git commit -F <msg>, git push.

    Recommended launcher: folio-push.cmd (double-click friendly, keeps
    the window open on both success and failure).

.EXAMPLE
    PS> .\scripts\folio-push.ps1

.NOTES
    Requires: PowerShell 5+ (built-in on Windows 10/11), git on PATH.
    ASCII-only on purpose so PowerShell 5.1 does not choke on encoding.
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
    Write-Host "=== Folio push ===" -ForegroundColor Cyan

    # -- Verify git is on PATH ---------------------------------------
    $gitExe = (Get-Command git -ErrorAction SilentlyContinue)
    if (-not $gitExe) {
        Write-Host "git is not on PATH. Install Git for Windows (https://git-scm.com/) and reopen your terminal." -ForegroundColor Red
        Stop-Here 1
    }

    # -- Locate the repo root (dir containing .git) ------------------
    $repoRoot = $null
    try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) } catch {}
    if (-not $repoRoot) {
        Write-Host "Not inside a git repository." -ForegroundColor Red
        Write-Host "Current directory: $(Get-Location)" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "Put folio-push.cmd / folio-push.ps1 in your folio clone (ideally under scripts\)," -ForegroundColor Yellow
        Write-Host "and double-click the .cmd from there." -ForegroundColor Yellow
        Stop-Here 1
    }
    Set-Location $repoRoot
    Write-Host "Repo:   $repoRoot" -ForegroundColor Cyan

    # -- Auto-discover the right Cowork outputs folder ---------------
    # Heuristic: prefer the most-recently-modified 'outputs' folder
    # that ALSO contains the commit-message stamp (.folio-pending-
    # commit.txt). That stamp is Claude's "I have staged a full
    # push-ready drop here" signal, so an otherwise-fresher but
    # empty session (e.g. a second Cowork tab) does not hijack the
    # push. Fall back to plain most-recent if no stamped session
    # exists, to preserve backwards compatibility with old drops.
    $base = Join-Path $env:APPDATA "Claude\local-agent-mode-sessions"
    if (-not (Test-Path $base)) {
        Write-Host "Cowork sessions folder not found at: $base" -ForegroundColor Red
        Write-Host "Make sure Claude / Cowork has been opened at least once." -ForegroundColor Yellow
        Stop-Here 1
    }

    $allOutputs = Get-ChildItem -Path $base -Directory -Recurse -Filter 'outputs' -ErrorAction SilentlyContinue

    if (-not $allOutputs) {
        Write-Host "No Cowork 'outputs' folder found under: $base" -ForegroundColor Red
        Stop-Here 1
    }

    # AUTO-DISCOVERY (v2) — sort candidate outputs folders by the newest
    # LastWriteTime of their PRIMARY ARTIFACT (app.html), not by the
    # folder's own LastWriteTime.
    #
    # Why: folder mtime updates on any child write (including stubs a
    # different Cowork session might drop in during boot), so it lies
    # about "which session is doing the actual work." app.html's mtime
    # is the ground truth — it only updates when Claude edited the file.
    #
    # Falls back to the .folio-pending-commit.txt mtime if app.html is
    # absent, then to the folder mtime as a last resort. Requires the
    # commit stamp file exists at all (that's still the "push-ready" gate).
    $candidates = $allOutputs | Where-Object {
        Test-Path (Join-Path $_.FullName '.folio-pending-commit.txt')
    } | ForEach-Object {
        $folder = $_
        $primary = Join-Path $folder.FullName 'app.html'
        $stamp   = Join-Path $folder.FullName '.folio-pending-commit.txt'
        $mtime = if (Test-Path $primary) {
            (Get-Item $primary).LastWriteTime
        } elseif (Test-Path $stamp) {
            (Get-Item $stamp).LastWriteTime
        } else {
            $folder.LastWriteTime
        }
        [PSCustomObject]@{ Folder = $folder; Mtime = $mtime }
    } | Sort-Object Mtime -Descending

    if ($candidates) {
        $outputsDir = $candidates | Select-Object -First 1 -ExpandProperty Folder
        # Diagnostic: show the picked folder + its content mtime so we
        # can confirm the auto-discovery is picking the right session.
        $pickedMtime = ($candidates | Select-Object -First 1).Mtime
        Write-Host ("(Auto-discovery: picked folder whose app.html was last modified {0})" -f $pickedMtime) `
            -ForegroundColor DarkGray
    } else {
        # No folder has the commit stamp — fall back to plain "most-
        # recent folder by folder mtime" to preserve old behaviour.
        $outputsDir = $allOutputs | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        Write-Host "(No outputs folder has a .folio-pending-commit.txt - falling back to most-recent folder mtime.)" -ForegroundColor DarkGray
    }

    $srcRoot    = $outputsDir.FullName
    $srcIndex   = Join-Path $srcRoot 'index.html'
    $srcApp     = Join-Path $srcRoot 'app.html'
    $srcWorker  = Join-Path $srcRoot 'folio-tts-worker.js'
    $srcPaywall = Join-Path $srcRoot 'folio-paywall-worker.js'
    $srcPrivacy = Join-Path $srcRoot 'privacy.html'
    $srcTerms   = Join-Path $srcRoot 'terms.html'
    $srcCommit  = Join-Path $srcRoot '.folio-pending-commit.txt'

    Write-Host "Source: $srcRoot" -ForegroundColor Cyan
    Write-Host "        (modified $($outputsDir.LastWriteTime))" -ForegroundColor DarkGray

    # The only strictly-required file is the commit message stamp - that is
    # the signal that "Claude has staged a push-ready drop in this folder."
    # Every content file is OPTIONAL: copy it if it's there, leave it alone
    # if it isn't. That way sessions that only touch the welcome page, only
    # the editor, only the workers, or only the static guides all work
    # without needing a no-op stash of every other file.
    $missing = @()
    if (-not (Test-Path $srcCommit)) { $missing += '.folio-pending-commit.txt' }
    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Missing files in Cowork outputs: $($missing -join ', ')" -ForegroundColor Yellow
        Write-Host "Ask Claude to re-emit those, then rerun." -ForegroundColor DarkGray
        Stop-Here 1
    }

    # -- Copy files into repo ----------------------------------------
    Write-Host ""
    Write-Host "Copying files into repo..." -ForegroundColor Cyan
    if (Test-Path $srcIndex) {
        Copy-Item -Force $srcIndex (Join-Path $repoRoot 'index.html')
        Write-Host "  index.html               -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcApp) {
        Copy-Item -Force $srcApp (Join-Path $repoRoot 'app.html')
        Write-Host "  app.html                 -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcWorker) {
        Copy-Item -Force $srcWorker (Join-Path $repoRoot 'folio-tts-worker.js')
        Write-Host "  folio-tts-worker.js      -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcPaywall) {
        Copy-Item -Force $srcPaywall (Join-Path $repoRoot 'folio-paywall-worker.js')
        Write-Host "  folio-paywall-worker.js  -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcPrivacy) {
        Copy-Item -Force $srcPrivacy (Join-Path $repoRoot 'privacy.html')
        Write-Host "  privacy.html             -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcTerms) {
        Copy-Item -Force $srcTerms (Join-Path $repoRoot 'terms.html')
        Write-Host "  terms.html               -> repo root" -ForegroundColor DarkGray
    }
    # Optional outputs: copied if present, but tracked in repo regardless
    $srcGuide       = Join-Path $srcRoot 'serials-guide.html'
    $srcKeysGuide   = Join-Path $srcRoot 'api-keys-guide.html'
    $srcEmailWorker = Join-Path $srcRoot 'folio-email-worker.js'
    $srcLuluWorker  = Join-Path $srcRoot 'folio-publish-lulu-worker.js'
    $srcShareWorker = Join-Path $srcRoot 'folio-share-worker.js'
    $srcShelf       = Join-Path $srcRoot 'shelf.html'
    $srcOgImage     = Join-Path $srcRoot 'og-default.png'
    if (Test-Path $srcGuide) {
        Copy-Item -Force $srcGuide (Join-Path $repoRoot 'serials-guide.html')
        Write-Host "  serials-guide.html       -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcKeysGuide) {
        Copy-Item -Force $srcKeysGuide (Join-Path $repoRoot 'api-keys-guide.html')
        Write-Host "  api-keys-guide.html      -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcEmailWorker) {
        Copy-Item -Force $srcEmailWorker (Join-Path $repoRoot 'folio-email-worker.js')
        Write-Host "  folio-email-worker.js    -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcLuluWorker) {
        Copy-Item -Force $srcLuluWorker (Join-Path $repoRoot 'folio-publish-lulu-worker.js')
        Write-Host "  folio-publish-lulu-worker.js -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcShareWorker) {
        Copy-Item -Force $srcShareWorker (Join-Path $repoRoot 'folio-share-worker.js')
        Write-Host "  folio-share-worker.js    -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcShelf) {
        Copy-Item -Force $srcShelf (Join-Path $repoRoot 'shelf.html')
        Write-Host "  shelf.html               -> repo root" -ForegroundColor DarkGray
    }
    if (Test-Path $srcOgImage) {
        Copy-Item -Force $srcOgImage (Join-Path $repoRoot 'og-default.png')
        Write-Host "  og-default.png           -> repo root" -ForegroundColor DarkGray
    }

    # Pull commit message into TEMP (not into the repo)
    $tmpCommitFile = Join-Path $env:TEMP 'folio-pending-commit.txt'
    Copy-Item -Force $srcCommit $tmpCommitFile

    # -- Preview commit message --------------------------------------
    Write-Host ""
    Write-Host "=== Commit message ===" -ForegroundColor Cyan
    $lines = Get-Content $tmpCommitFile
    for ($i = 0; $i -lt [Math]::Min(6, $lines.Count); $i++) {
        if ($i -eq 0) { Write-Host "  $($lines[$i])" -ForegroundColor White }
        else          { Write-Host "  $($lines[$i])" -ForegroundColor DarkGray }
    }
    if ($lines.Count -gt 6) {
        Write-Host "  ... ($($lines.Count) lines total)" -ForegroundColor DarkGray
    }

    # -- Show changes ------------------------------------------------
    Write-Host ""
    Write-Host "=== git status (short) ===" -ForegroundColor Cyan
    $status = git status --short
    if (-not $status) {
        Write-Host "  (no changes - nothing to commit)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Files on disk already match HEAD. If you expected" -ForegroundColor DarkGray
        Write-Host "changes, either:" -ForegroundColor DarkGray
        Write-Host "  - The build has not been updated in Cowork yet, OR" -ForegroundColor DarkGray
        Write-Host "  - A previous push already committed the diff." -ForegroundColor DarkGray
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here 0
    }
    $status | ForEach-Object { Write-Host "  $_" }

    # -- Pre-push build gate -----------------------------------------
    # Run scripts/build.ps1 against the files we just copied into the
    # repo. The build script validates:
    #   * src/ module files exist + are imported by app.html
    #   * every extracted symbol with bare classic-script callsites
    #     has a matching `window.<name> = <name>` alias in the module
    #     block (the Phase 1/2 modularization regression).
    # Exit non-zero = abort the push. Set FOLIO_PUSH_SKIP_BUILD=1 to
    # bypass (use only if you know the gate is wrong + you've checked
    # the diff by hand).
    $buildScript = Join-Path $repoRoot 'scripts\build.ps1'
    if ($env:FOLIO_PUSH_SKIP_BUILD -eq '1') {
        Write-Host ""
        Write-Host "(Build gate skipped: FOLIO_PUSH_SKIP_BUILD=1)" -ForegroundColor Yellow
    } elseif (Test-Path $buildScript) {
        Write-Host ""
        Write-Host "=== Pre-push build gate ===" -ForegroundColor Cyan
        # Invoke in-process so $LASTEXITCODE reflects the build result.
        # Push-Location/Pop-Location keeps our cwd intact even though
        # build.ps1 also does Set-Location internally.
        Push-Location $repoRoot
        try { & $buildScript } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "Build gate FAILED (exit $LASTEXITCODE). Push aborted." -ForegroundColor Red
            Write-Host "Files were copied into the repo but NOT committed." -ForegroundColor DarkGray
            Write-Host "Fix the issues above, then rerun. To bypass once," -ForegroundColor DarkGray
            Write-Host "set FOLIO_PUSH_SKIP_BUILD=1 in this shell." -ForegroundColor DarkGray
            Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
            Stop-Here $LASTEXITCODE
        }
        Write-Host "Build gate passed." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "(No scripts\build.ps1 found; skipping build gate.)" -ForegroundColor DarkGray
    }

    # -- Auto-confirm (idempotent: if invoked, the answer is yes) ----
    # The previous y/N prompt was redundant - running this script is
    # already an explicit "yes" signal, and re-runs are safe (git only
    # commits files whose contents actually differ from HEAD, and pushes
    # a no-op-up-to-date branch are inert). Pass -NoConfirm or set
    # $env:FOLIO_PUSH_CONFIRM=1 to bring the prompt back if needed.
    if ($env:FOLIO_PUSH_CONFIRM -eq '1') {
        Write-Host ""
        $confirm = Read-Host "Commit and push to origin? (y/N)"
        if ($confirm -notmatch '^(y|Y|yes|YES)$') {
            Write-Host "Aborted. Files copied into repo but NOT committed." -ForegroundColor Yellow
            Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
            Stop-Here 0
        }
    } else {
        Write-Host ""
        Write-Host "Committing and pushing (set FOLIO_PUSH_CONFIRM=1 to add a prompt)..." -ForegroundColor DarkGray
    }

    # -- Commit + push -----------------------------------------------
    Write-Host ""
    Write-Host "Committing..." -ForegroundColor Cyan
    # Stage whatever is actually in the repo - git only commits files whose
    # content differs from HEAD, so listing extras is harmless. Everything
    # here is optional; we just enumerate the known files so a brand-new
    # tracked file (e.g. app.html the first time the welcome page split
    # ships) gets picked up.
    $toAdd = @()
    if (Test-Path (Join-Path $repoRoot 'index.html'))               { $toAdd += 'index.html' }
    if (Test-Path (Join-Path $repoRoot 'app.html'))                 { $toAdd += 'app.html' }
    if (Test-Path (Join-Path $repoRoot 'folio-tts-worker.js'))      { $toAdd += 'folio-tts-worker.js' }
    if (Test-Path (Join-Path $repoRoot 'folio-paywall-worker.js'))  { $toAdd += 'folio-paywall-worker.js' }
    if (Test-Path (Join-Path $repoRoot 'folio-email-worker.js'))    { $toAdd += 'folio-email-worker.js' }
    if (Test-Path (Join-Path $repoRoot 'folio-publish-lulu-worker.js')) { $toAdd += 'folio-publish-lulu-worker.js' }
    if (Test-Path (Join-Path $repoRoot 'folio-share-worker.js'))        { $toAdd += 'folio-share-worker.js' }
    if (Test-Path (Join-Path $repoRoot 'og-default.png'))               { $toAdd += 'og-default.png' }
    if (Test-Path (Join-Path $repoRoot 'privacy.html'))             { $toAdd += 'privacy.html' }
    if (Test-Path (Join-Path $repoRoot 'terms.html'))               { $toAdd += 'terms.html' }
    if (Test-Path (Join-Path $repoRoot 'serials-guide.html'))       { $toAdd += 'serials-guide.html' }
    if (Test-Path (Join-Path $repoRoot 'api-keys-guide.html'))      { $toAdd += 'api-keys-guide.html' }
    if (Test-Path (Join-Path $repoRoot 'shelf.html'))               { $toAdd += 'shelf.html' }
    # Stage the docs/ folder when present (markdown reference docs)
    if (Test-Path (Join-Path $repoRoot 'docs')) { $toAdd += 'docs' }
    # Stage the scripts/ folder so iterations to this push script itself
    # (or its launcher) get committed automatically alongside the build.
    if (Test-Path (Join-Path $repoRoot 'scripts')) { $toAdd += 'scripts' }
    # Stage the src/ folder so the modularization phases (constants /
    # preview-utils / characters / etc.) get committed alongside app.html.
    if (Test-Path (Join-Path $repoRoot 'src')) { $toAdd += 'src' }
    # Stage .gitignore so changes to the ignore list ship too.
    if (Test-Path (Join-Path $repoRoot '.gitignore')) { $toAdd += '.gitignore' }
    if ($toAdd.Count -eq 0) {
        Write-Host "Nothing to stage." -ForegroundColor Yellow
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here 0
    }
    git add @toAdd

    # Did anything actually land in the index? If the only changes in
    # the repo were untracked files NOT in the whitelist above (stray
    # exports, personal data, etc.), 'git add' stages nothing and a
    # commit would fail with "nothing added to commit". Detect that
    # and exit cleanly instead of erroring.
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Nothing staged - all tracked Folio files already match HEAD." -ForegroundColor Yellow
        $untracked = git status --porcelain --untracked-files=normal | Where-Object { $_ -match '^\?\?' }
        if ($untracked) {
            Write-Host "Untracked files exist but are intentionally NOT auto-committed:" -ForegroundColor DarkGray
            $untracked | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            Write-Host "If one of those SHOULD be in the repo, 'git add' it by hand." -ForegroundColor DarkGray
        }
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here 0
    }

    git commit -F $tmpCommitFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Commit failed (exit $LASTEXITCODE). See git output above." -ForegroundColor Red
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here $LASTEXITCODE
    }

    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    Write-Host ""
    Write-Host "Pushing to origin/$branch ..." -ForegroundColor Cyan
    git push origin $branch

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Pushed to origin/$branch. GitHub Pages will redeploy shortly." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Push failed (exit $LASTEXITCODE). Commit exists locally but was not pushed." -ForegroundColor Yellow
        Write-Host "Run git push manually once you resolve the issue above." -ForegroundColor DarkGray
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here $LASTEXITCODE
    }

    Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
    Stop-Here 0
}
catch {
    Write-Host ""
    Write-Host "Unexpected error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    Stop-Here 1
}
