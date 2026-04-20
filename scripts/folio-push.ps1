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

    # -- Auto-discover the most recent Cowork outputs folder ---------
    $base = Join-Path $env:APPDATA "Claude\local-agent-mode-sessions"
    if (-not (Test-Path $base)) {
        Write-Host "Cowork sessions folder not found at: $base" -ForegroundColor Red
        Write-Host "Make sure Claude / Cowork has been opened at least once." -ForegroundColor Yellow
        Stop-Here 1
    }

    $outputsDir = Get-ChildItem -Path $base -Directory -Recurse -Filter 'outputs' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $outputsDir) {
        Write-Host "No Cowork 'outputs' folder found under: $base" -ForegroundColor Red
        Stop-Here 1
    }

    $srcRoot   = $outputsDir.FullName
    $srcIndex  = Join-Path $srcRoot 'index.html'
    $srcWorker = Join-Path $srcRoot 'folio-tts-worker.js'
    $srcCommit = Join-Path $srcRoot '.folio-pending-commit.txt'

    Write-Host "Source: $srcRoot" -ForegroundColor Cyan
    Write-Host "        (modified $($outputsDir.LastWriteTime))" -ForegroundColor DarkGray

    $missing = @()
    if (-not (Test-Path $srcIndex))  { $missing += 'index.html' }
    if (-not (Test-Path $srcWorker)) { $missing += 'folio-tts-worker.js' }
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
    Copy-Item -Force $srcIndex  (Join-Path $repoRoot 'index.html')
    Copy-Item -Force $srcWorker (Join-Path $repoRoot 'folio-tts-worker.js')
    Write-Host "  index.html           -> repo root" -ForegroundColor DarkGray
    Write-Host "  folio-tts-worker.js  -> repo root" -ForegroundColor DarkGray

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

    # -- Confirm -----------------------------------------------------
    Write-Host ""
    $confirm = Read-Host "Commit and push to origin? (y/N)"
    if ($confirm -notmatch '^(y|Y|yes|YES)$') {
        Write-Host "Aborted. Files copied into repo but NOT committed." -ForegroundColor Yellow
        Remove-Item $tmpCommitFile -ErrorAction SilentlyContinue
        Stop-Here 0
    }

    # -- Commit + push -----------------------------------------------
    Write-Host ""
    Write-Host "Committing..." -ForegroundColor Cyan
    git add index.html folio-tts-worker.js
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
