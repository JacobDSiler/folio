<#
.SYNOPSIS
    One-run helper - creates two Windows shortcuts on your desktop:
      1. "Deploy Folio"  -> runs the latest deploy-*.ps1 in a console window
      2. "Folio folder"  -> opens C:\dev\folio in Explorer
    Both are .lnk files that Windows accepts when you right-click and
    pick "Pin to taskbar" (unlike raw .cmd files and raw folder paths,
    which Windows refuses to pin).

.NOTES
    ASCII-only source so PowerShell 5.1 reads it correctly regardless
    of the file's byte-order-mark state. PS 5.1 assumes CP-1252 for
    BOM-less files, which mangles multi-byte UTF-8 characters (like
    em-dashes) and can break string terminators. This file avoids
    the problem entirely by staying inside 7-bit ASCII.

    Run this ONCE. After it finishes:
      1. Look on your desktop for the two new shortcuts.
      2. Right-click each and choose "Pin to taskbar".
      3. Delete the desktop copies if you dont want them there - the
         pinned copies live independently.

    You can re-run this any time to refresh the icons or update the
    target path (e.g. if you rename the deploy script).

.EXAMPLE
    From PowerShell:
        .\scripts\create-taskbar-shortcuts.ps1
#>

$ErrorActionPreference = 'Stop'

# Where things live -------------------------------------------------
$repoRoot   = 'C:\dev\folio'
$scriptsDir = Join-Path $repoRoot 'scripts'
$desktop    = [Environment]::GetFolderPath('Desktop')

# Pick the newest deploy-*.ps1 automatically so this script keeps
# working as we roll out new deploy batches (deploy-2026-07-07.ps1,
# deploy-2026-08-15.ps1, ...). Falls back to a plain wildcard if only
# one exists.
$deployPs1 = Get-ChildItem -Path $scriptsDir -Filter 'deploy-*.ps1' `
    | Sort-Object LastWriteTime -Descending `
    | Select-Object -First 1
if (-not $deployPs1) {
    Write-Host "No deploy-*.ps1 found in $scriptsDir - aborting." -ForegroundColor Red
    exit 1
}
Write-Host "Using deploy script: $($deployPs1.FullName)" -ForegroundColor Cyan

# Icon for Deploy: prefer a .ico anywhere in the repo, fall back to
# a generic Windows icon if none is present. PNGs can't be used
# directly as shortcut icons on Windows.
$deployIcon = "$env:SystemRoot\System32\imageres.dll,109"
$ico = Get-ChildItem -Path $repoRoot -Filter '*.ico' -Recurse -ErrorAction SilentlyContinue `
    | Select-Object -First 1
if ($ico) { $deployIcon = $ico.FullName }

$folderIcon = "$env:SystemRoot\System32\imageres.dll,3"

# Create the two shortcuts ------------------------------------------
$WshShell = New-Object -ComObject WScript.Shell

# 1. Deploy Folio -------------------------------------------------
$deployLnk = Join-Path $desktop 'Deploy Folio.lnk'
$sc1 = $WshShell.CreateShortcut($deployLnk)
# Wrapping the .ps1 in a powershell.exe launch is what makes Windows
# accept "Pin to taskbar" - a bare .cmd or .ps1 cant be pinned.
# NOTE: no -NoExit. The deploy script's Stop-Here helper already prompts
# "Press Enter to close..." at the end via Read-Host, so the window
# holds long enough to read the summary; pressing Enter then closes it
# cleanly. Adding -NoExit would leave a raw PS prompt hanging around
# after Enter, which Jacob didn't want.
$sc1.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$sc1.Arguments  = "-NoProfile -ExecutionPolicy Bypass -File `"$($deployPs1.FullName)`""
$sc1.WorkingDirectory = $repoRoot
$sc1.Description = 'Ship the current deploy batch - GitHub Pages + Firestore rules + Cloudflare Workers.'
$sc1.WindowStyle = 1
$sc1.IconLocation = $deployIcon
$sc1.Save()
Write-Host "Created: $deployLnk" -ForegroundColor Green

# 2. Folio folder -------------------------------------------------
$folderLnk = Join-Path $desktop 'Folio folder.lnk'
$sc2 = $WshShell.CreateShortcut($folderLnk)
# The explorer.exe trick - Windows will pin this because the target
# executable is explorer.exe, even though it opens a specific folder.
$sc2.TargetPath = "$env:SystemRoot\explorer.exe"
$sc2.Arguments  = "`"$repoRoot`""
$sc2.WorkingDirectory = $repoRoot
$sc2.Description = 'Open the Folio repo in Explorer.'
$sc2.IconLocation = $folderIcon
$sc2.Save()
Write-Host "Created: $folderLnk" -ForegroundColor Green

# Done --------------------------------------------------------------
Write-Host ""
Write-Host "Two shortcuts are on your Desktop." -ForegroundColor Cyan
Write-Host "To finish setup:" -ForegroundColor Cyan
Write-Host "  1. Right-click each shortcut" -ForegroundColor Gray
Write-Host "  2. Choose 'Show more options' (Win 11) or use the menu directly (Win 10)" -ForegroundColor Gray
Write-Host "  3. Click 'Pin to taskbar'" -ForegroundColor Gray
Write-Host "  4. Delete the desktop copies if you want - the pinned ones stay put" -ForegroundColor Gray
Write-Host ""
Write-Host "The Deploy Folio shortcut auto-tracks the newest deploy-*.ps1," -ForegroundColor DarkGray
Write-Host "so when we roll out deploy-2026-08-XX.ps1 you can re-run this" -ForegroundColor DarkGray
Write-Host "script and the pinned button will point at the right one." -ForegroundColor DarkGray
