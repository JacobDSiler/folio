<#
.SYNOPSIS
    Rotate Folio worker secrets in one command.

.DESCRIPTION
    Generates fresh random tokens and pushes them to both Cloudflare
    workers (paywall + email) via wrangler. Handles all four secret
    entries needed for the admin flows + internal worker auth to
    stay consistent.

    Secrets rotated:
      ADMIN_DEBUG_TOKEN
        Set on BOTH paywall + email workers (same value).
        Gates: /admin/shelf/'s "Contact author" author-email lookup;
        the email worker's /admin-digest + /metrics-rollup manual
        trigger endpoints. This is the one you paste in the shelf
        moderation prompt.

      INTERNAL_WORKER_SECRET  (on email worker)
      EMAIL_WORKER_SECRET     (on paywall worker) - SAME value as above
        Pair. Gates the paywall->email internal fetch that runs
        after a purchase (paywall calls email's /send-unlock).
        Both entries MUST hold the same string.

    Backs up the new values to
      %LOCALAPPDATA%\FolioWatch\secrets-<timestamp>.txt
    so you have them if wrangler ever locks you out. Never commit
    that file (it's outside the repo by design).

.PARAMETER SkipConfirm
    Skip the "push these to Cloudflare?" y/N prompt. Handy when
    scripting a full rotation from another automation.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/folio-rotate-secrets.ps1

.NOTES
    ASCII-only. Requires wrangler on PATH (npm i -g wrangler).
    Added 2026-08-20 after the "I don't have the ADMIN_DEBUG_TOKEN
    saved anywhere" moment.
#>

param(
    [switch]$SkipConfirm
)

$ErrorActionPreference = 'Stop'

# =====================================================================
# Config
# =====================================================================

$RepoRoot     = 'C:\dev\folio'
$PaywallToml  = Join-Path $RepoRoot 'wrangler.toml'
$EmailToml    = Join-Path $RepoRoot 'wrangler-email.toml'
$BackupDir    = Join-Path $env:LOCALAPPDATA 'FolioWatch'

# =====================================================================
# Preflight
# =====================================================================

Write-Host ""
Write-Host "=== Folio secret rotation ===" -ForegroundColor Cyan
Write-Host ""

# Is wrangler on PATH?
$wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $wrangler) { $wrangler = Get-Command wrangler.cmd -ErrorAction SilentlyContinue }
if (-not $wrangler) {
    Write-Host "ERROR: wrangler not found on PATH." -ForegroundColor Red
    Write-Host "Install with: npm install -g wrangler" -ForegroundColor DarkGray
    exit 1
}
Write-Host "wrangler: $($wrangler.Source)" -ForegroundColor DarkGray

# Do both configs exist?
if (-not (Test-Path $PaywallToml)) { Write-Host "ERROR: missing $PaywallToml" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $EmailToml))   { Write-Host "ERROR: missing $EmailToml"   -ForegroundColor Red; exit 1 }
Write-Host "paywall config: $PaywallToml" -ForegroundColor DarkGray
Write-Host "email config:   $EmailToml"   -ForegroundColor DarkGray

# =====================================================================
# Generate strong random tokens (crypto RNG)
# =====================================================================

function New-RandomToken {
    param([int]$Bytes = 32)
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    $b = New-Object byte[] $Bytes
    $rng.GetBytes($b)
    $rng.Dispose()
    # Base64 URL-safe (no + / =) so the value is safe in headers/env vars.
    $s = [Convert]::ToBase64String($b)
    return ($s -replace '\+', '-' -replace '/', '_' -replace '=', '')
}

$adminDebug = New-RandomToken 32   # 32 bytes -> ~43 chars base64url
$workerPair = New-RandomToken 32

Write-Host ""
Write-Host "Generated tokens (save these NOW before pushing):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ADMIN_DEBUG_TOKEN      = $adminDebug" -ForegroundColor Yellow
Write-Host "  INTERNAL_WORKER_SECRET = $workerPair" -ForegroundColor Yellow
Write-Host "  EMAIL_WORKER_SECRET    = $workerPair  (same value)" -ForegroundColor Yellow
Write-Host ""
Write-Host "USE the ADMIN_DEBUG_TOKEN above when the /admin/shelf/ prompt asks" -ForegroundColor DarkGray
Write-Host "for it to look up an author's email." -ForegroundColor DarkGray
Write-Host ""
Write-Host "wrangler WILL NOT let you read these back after this script exits." -ForegroundColor Red
Write-Host "A backup copy will be written to $BackupDir - keep it, or move it" -ForegroundColor Red
Write-Host "to your password manager." -ForegroundColor Red
Write-Host ""

# =====================================================================
# Confirm before pushing (unless -SkipConfirm)
# =====================================================================

if (-not $SkipConfirm) {
    $go = Read-Host "Push these to Cloudflare now? (y/N)"
    if ($go -notmatch '^(y|Y|yes|YES)$') {
        Write-Host "Aborted. Nothing pushed. Tokens above still valid to save if you want to" -ForegroundColor Yellow
        Write-Host "keep them for a manual rotation later." -ForegroundColor Yellow
        exit 0
    }
}

# =====================================================================
# Push each secret via wrangler
# =====================================================================

function Push-Secret {
    param([string]$Name, [string]$Value, [string]$Config)
    Write-Host ""
    Write-Host "-> $Name  (config: $(Split-Path -Leaf $Config))" -ForegroundColor Cyan
    # Reliable stdin delivery on Windows: write value to a temp file and
    # redirect via cmd.exe. Wrangler reads its secret from stdin when
    # not attached to a TTY.
    $tmpFile = [System.IO.Path]::GetTempFileName()
    try {
        # Trailing newline is fine - wrangler strips it.
        [System.IO.File]::WriteAllText($tmpFile, "$Value`n")
        $cmdLine = "wrangler secret put $Name --config `"$Config`" < `"$tmpFile`""
        $output = & cmd /c $cmdLine 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Host $output -ForegroundColor Red
            throw "wrangler secret put $Name failed with exit $LASTEXITCODE"
        }
        # Wrangler's success messages are quiet; show a trimmed excerpt
        # so the user knows something happened.
        $tail = ($output -split "`n" | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 1)
        if ($tail) { Write-Host "   $tail" -ForegroundColor DarkGray }
        Write-Host "   [OK]" -ForegroundColor Green
    } finally {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    }
}

try {
    Push-Secret 'ADMIN_DEBUG_TOKEN'      $adminDebug $PaywallToml
    Push-Secret 'ADMIN_DEBUG_TOKEN'      $adminDebug $EmailToml
    Push-Secret 'INTERNAL_WORKER_SECRET' $workerPair $EmailToml
    Push-Secret 'EMAIL_WORKER_SECRET'    $workerPair $PaywallToml
} catch {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "PARTIAL FAILURE:" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "The tokens above ARE STILL VALID (still shown at the top of this" -ForegroundColor Yellow
    Write-Host "window). Copy them somewhere safe before closing." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Check what got pushed with:" -ForegroundColor DarkGray
    Write-Host "  wrangler secret list --config $(Split-Path -Leaf $PaywallToml)" -ForegroundColor DarkGray
    Write-Host "  wrangler secret list --config $(Split-Path -Leaf $EmailToml)" -ForegroundColor DarkGray
    exit 1
}

# =====================================================================
# Backup the new values to a user-scoped file
# =====================================================================

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}
$backupFile = Join-Path $BackupDir ("secrets-" + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + ".txt")
@(
    "# Folio worker secrets rotated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    "# DO NOT COMMIT. Delete this file after saving to your password manager."
    ""
    "ADMIN_DEBUG_TOKEN=$adminDebug"
    "INTERNAL_WORKER_SECRET=$workerPair"
    "EMAIL_WORKER_SECRET=$workerPair"
    ""
    "# Which key gates what:"
    "#   ADMIN_DEBUG_TOKEN      : paywall + email workers (same value)"
    "#     - paste in /admin/shelf/ 'Contact author' email-lookup prompt"
    "#     - also gates email worker /admin-digest + /metrics-rollup"
    "#   INTERNAL_WORKER_SECRET : email worker"
    "#   EMAIL_WORKER_SECRET    : paywall worker"
    "#     - the last two MUST match; they gate the paywall->email"
    "#       internal call after a purchase (send-unlock)."
) | Set-Content -Path $backupFile -Encoding UTF8

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "All 4 secret entries updated in Cloudflare."
Write-Host ""
Write-Host "Backup written to:" -ForegroundColor DarkGray
Write-Host "  $backupFile" -ForegroundColor Yellow
Write-Host ""
Write-Host "Move the ADMIN_DEBUG_TOKEN to your password manager now, then" -ForegroundColor DarkGray
Write-Host "either keep or delete the backup file. Both workers should" -ForegroundColor DarkGray
Write-Host "pick up the new values on their next request (no redeploy needed)." -ForegroundColor DarkGray
Write-Host ""
