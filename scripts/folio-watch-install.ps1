<#
.SYNOPSIS
    Install/uninstall the FolioWatch tray watcher's auto-start hook.

.DESCRIPTION
    Places a shortcut in the user's Startup folder that launches
    scripts\folio-watch.ps1 with a HIDDEN window at login. No
    Task Scheduler, no admin rights needed - the Startup folder is
    user-level and applies immediately.

    Idempotent: run again to refresh the shortcut (target/args); run
    with -Uninstall to remove.

.PARAMETER Uninstall
    Remove the Startup shortcut instead of creating it.

.PARAMETER StartNow
    After installing, also launch FolioWatch immediately so you don't
    need to log out + back in to see it in the tray.

.EXAMPLE
    # First-time install + start now
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/folio-watch-install.ps1 -StartNow

    # Remove auto-start
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/folio-watch-install.ps1 -Uninstall

.NOTES
    ASCII-only source so PowerShell 5.1 (default on Windows 10/11)
    doesn't misinterpret non-ASCII characters as CP1252 garbage.
    Added 2026-08-11.
#>

param(
    [switch]$Uninstall,
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

# Resolve paths - this script lives in scripts/ next to folio-watch.ps1
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$watchPs1   = Join-Path $scriptDir 'folio-watch.ps1'
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'FolioWatch.lnk'

Write-Host ""
Write-Host "=== FolioWatch installer ===" -ForegroundColor Cyan
Write-Host "Watcher script : $watchPs1"
Write-Host "Startup folder : $startupDir"
Write-Host "Shortcut path  : $shortcutPath"
Write-Host ""

if ($Uninstall) {
    if (Test-Path $shortcutPath) {
        Remove-Item $shortcutPath -Force
        Write-Host "Removed Startup shortcut." -ForegroundColor Yellow
    } else {
        Write-Host "No Startup shortcut found - nothing to remove." -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Note: this only removes the auto-start hook. If FolioWatch is currently"
    Write-Host "running in your tray, right-click its icon and choose Quit to stop it."
    Write-Host ""
    exit 0
}

if (-not (Test-Path $watchPs1)) {
    Write-Host "ERROR: could not find $watchPs1" -ForegroundColor Red
    Write-Host "This installer must live in the same scripts/ folder as folio-watch.ps1."
    exit 1
}

# Build the Startup shortcut via WSH. The .lnk points at powershell.exe
# with arguments that hide the window and bypass ExecutionPolicy so it
# doesn't need per-user policy relaxation.
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($shortcutPath)
$lnk.TargetPath  = 'powershell.exe'
$lnk.Arguments   = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchPs1`""
$lnk.WorkingDirectory = 'C:\dev\folio'
$lnk.WindowStyle = 7   # 7 = Minimized (redundant with -WindowStyle Hidden, safety net)
$lnk.Description = 'FolioWatch - auto-deploy Folio on file changes'
# Use PowerShell's own icon so the shortcut is recognizable in the
# Startup folder if the user goes looking. Tray icon is separate.
$lnk.IconLocation = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"
$lnk.Save()

Write-Host "[OK] Installed Startup shortcut." -ForegroundColor Green
Write-Host "     FolioWatch will now launch automatically on every login."
Write-Host ""
Write-Host "     To remove it later:"
Write-Host "       powershell -NoProfile -ExecutionPolicy Bypass -File scripts/folio-watch-install.ps1 -Uninstall"
Write-Host ""

if ($StartNow) {
    Write-Host "Launching FolioWatch now (hidden - check your system tray)..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList @(
        '-NoProfile', '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', $watchPs1
    ) -WindowStyle Hidden
    Write-Host "[OK] Launched. Look for the green dot in your system tray." -ForegroundColor Green
    Write-Host ""
    Write-Host "     If you don't see it: click the up arrow (^) in the tray to expand hidden icons."
    Write-Host "     Right-click the green dot for the menu (Deploy Now, Pause, Show Log, Quit)."
    Write-Host ""
}
