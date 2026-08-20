<#
.SYNOPSIS
    FolioWatch - system-tray file watcher that auto-runs deploy on change.

.DESCRIPTION
    Sits in the Windows system tray. Watches C:\dev\folio for tracked-file
    changes (respects .gitignore via `git status`). When something changes,
    debounces for 60 seconds, then triggers scripts/folio-push.ps1 to
    stage + commit + push. Idle rest of the time.

    STATES (tray icon color)
      GREEN  - idle, watching
      YELLOW - change detected, debouncing
      BLUE   - deploy in progress
      RED    - last deploy failed (click for log)
      GRAY   - paused

    RIGHT-CLICK MENU
      Deploy now
      Pause / Resume watching
      Show recent deploys log
      Open Folio repo
      Quit

    STATE / LOG LOCATIONS
      State JSON: %LOCALAPPDATA%\FolioWatch\state.json
      Log file:   %LOCALAPPDATA%\FolioWatch\folio-watch.log
                  (rotates when it hits 1 MB - old copy kept as .old)

    STARTUP
      Run scripts/folio-watch-install.ps1 once to add a Startup-folder
      shortcut that launches this hidden. Uninstall with the -Uninstall
      switch on the installer.

.EXAMPLE
    # Run interactively (visible console for debugging)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/folio-watch.ps1

    # Run hidden (what the Startup shortcut does)
    powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File scripts/folio-watch.ps1

.NOTES
    Requires PowerShell 5+ (built-in on Windows 10/11), git on PATH.
    ASCII-only source so PowerShell 5.1 doesn't misinterpret non-ASCII
    characters as CP1252 garbage.
    Added 2026-08-11 (Jacob).
#>

# =====================================================================
# Config
# =====================================================================

$RepoRoot     = 'C:\dev\folio'
$DeployScript = Join-Path $RepoRoot 'scripts\folio-push.ps1'
$DebounceMs   = 60000    # 60s - settles multi-file edits into one deploy
$SettleMs     = 3000     # extra pause after debounce, so the last saved file finishes flushing
$StateDir     = Join-Path $env:LOCALAPPDATA 'FolioWatch'
$StateFile    = Join-Path $StateDir 'state.json'
$LogFile      = Join-Path $StateDir 'folio-watch.log'
$LogMaxBytes  = 1MB
$AppName      = 'FolioWatch'

# Directories inside the repo we NEVER want to trigger on. .git is the
# big one (git operations write there constantly and would cause loops).
$IgnoreSubpaths = @('\.git\', '\node_modules\', '\.wrangler\', '\dist\', '\build\', '\.vscode\')

# Files we ignore even if they change. Local scratch, state files.
$IgnoreFilenames = @('.folio-pending-commit.txt', '.folio-watch-state.json')

# =====================================================================
# Setup
# =====================================================================

# Make sure the state dir exists before we do anything else.
if (-not (Test-Path $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
}

# =====================================================================
# Singleton lock - prevents two watcher instances stacking up in the
# tray. Uses a named global mutex; the second copy silently exits
# instead of racing the first for FileSystemWatcher events.
# =====================================================================

$script:SingletonMutex = New-Object System.Threading.Mutex($false, 'Global\FolioWatchSingleton')
$acquired = $false
try {
    $acquired = $script:SingletonMutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    # Previous instance died holding the mutex - inherit ownership
    # cleanly (the mutex is ours now).
    $acquired = $true
}
if (-not $acquired) {
    # Another FolioWatch is already running. Bail silently - no error
    # dialog, no console noise, just exit. If the user WANTED a fresh
    # instance they can Quit the existing one first via its tray menu.
    exit 0
}

# Load WinForms + Drawing for the tray icon + notifications.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# P/Invoke DestroyIcon so we can free the HICON handles we allocate
# via Bitmap.GetHicon(). Without this, each icon swap leaks unmanaged
# memory - and on some machines the handle gets GC-orphaned before
# Windows renders it, producing the blank tray icon Jacob saw.
Add-Type -Namespace WinAPI -Name User32 -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
    public static extern bool DestroyIcon(System.IntPtr hIcon);
'@

# =====================================================================
# Logging (rotates at 1 MB)
# =====================================================================

function Write-WatchLog {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "[{0}] {1} {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt $LogMaxBytes) {
            $old = "$LogFile.old"
            if (Test-Path $old) { Remove-Item $old -Force }
            Move-Item $LogFile $old -Force
        }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch { }
    # Also print to console when running interactively (visible window).
    Write-Host $line
}

Write-WatchLog "FolioWatch starting (PID $PID)"

# =====================================================================
# State (deploy history, pause flag, etc.)
# =====================================================================

function Load-State {
    if (-not (Test-Path $StateFile)) {
        return @{
            totalDeploys       = 0
            lastDeployAt       = $null
            lastDeployedCommit = $null
            lastResult         = $null
            lastError          = $null
            paused             = $false
            recentDeploys      = @()
            watchStartedAt     = (Get-Date -Format 'o')
        }
    }
    try {
        $raw = Get-Content -Path $StateFile -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        # ConvertFrom-Json gives a PSCustomObject - convert to hashtable
        # so we can mutate + count on stable field access.
        $ht = @{}
        foreach ($p in $obj.PSObject.Properties) { $ht[$p.Name] = $p.Value }
        if (-not $ht.recentDeploys) { $ht.recentDeploys = @() }
        return $ht
    } catch {
        Write-WatchLog "Could not read state file: $_" 'WARN'
        return @{ totalDeploys = 0; recentDeploys = @(); paused = $false }
    }
}

function Save-State {
    param($State)
    try {
        # Only keep the last 20 deploys - the log has the full history.
        if ($State.recentDeploys.Count -gt 20) {
            $State.recentDeploys = @($State.recentDeploys | Select-Object -Last 20)
        }
        $State | ConvertTo-Json -Depth 4 | Set-Content -Path $StateFile -Encoding UTF8
    } catch {
        Write-WatchLog "Failed to save state: $_" 'WARN'
    }
}

$script:State = Load-State

# =====================================================================
# Tray icon (system-drawn - no external asset needed)
# =====================================================================

# Build a small colored square icon in-memory. Windows scales this
# to whatever the tray needs. Simpler than shipping an .ico file.
function New-ColorIcon {
    param([byte]$R, [byte]$G, [byte]$B)
    $bmp = New-Object System.Drawing.Bitmap 16, 16
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $R, $G, $B))
    $g.FillEllipse($brush, 1, 1, 14, 14)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 0, 0, 0)), 1
    $g.DrawEllipse($pen, 1, 1, 14, 14)
    $g.Dispose()
    $brush.Dispose()
    $pen.Dispose()
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    return $icon
}

$IconIdle      = New-ColorIcon  50 180  80    # green
$IconDebounce  = New-ColorIcon 220 180  40    # yellow
$IconDeploying = New-ColorIcon  60 130 220    # blue
$IconError     = New-ColorIcon 200  60  60    # red
$IconPaused    = New-ColorIcon 140 140 140    # gray

$Tray = New-Object System.Windows.Forms.NotifyIcon
$Tray.Icon = $IconIdle
$Tray.Text = "$AppName - idle"
$Tray.Visible = $true

function Set-TrayState {
    param([string]$State, [string]$Tooltip)
    switch ($State) {
        'idle'      { $Tray.Icon = $IconIdle }
        'debounce'  { $Tray.Icon = $IconDebounce }
        'deploying' { $Tray.Icon = $IconDeploying }
        'error'     { $Tray.Icon = $IconError }
        'paused'    { $Tray.Icon = $IconPaused }
    }
    # NotifyIcon Text has a 63-char limit; truncate long tooltips.
    $t = "$AppName - $Tooltip"
    if ($t.Length -gt 60) { $t = $t.Substring(0, 60) + '...' }
    $Tray.Text = $t
}

function Show-Balloon {
    param([string]$Title, [string]$Message, [string]$Level = 'Info')
    try {
        $iconKind = switch ($Level) {
            'Error' { [System.Windows.Forms.ToolTipIcon]::Error }
            'Warn'  { [System.Windows.Forms.ToolTipIcon]::Warning }
            default { [System.Windows.Forms.ToolTipIcon]::Info }
        }
        $Tray.BalloonTipTitle = $Title
        $Tray.BalloonTipText  = $Message
        $Tray.BalloonTipIcon  = $iconKind
        $Tray.ShowBalloonTip(4500)
    } catch { }
}

# =====================================================================
# Deploy runner - invokes the existing folio-push.ps1 with output
# captured so success/failure can drive the tray state + balloon.
# =====================================================================

$script:DeployInFlight = $false

function Should-Deploy {
    # Only deploy if git has actual staged/unstaged/untracked changes.
    # `git status --porcelain` is empty when clean. This filters false
    # positives from the watcher (build tools touching files, etc.).
    Push-Location $RepoRoot
    try {
        $out = & git status --porcelain 2>$null
        return -not [string]::IsNullOrWhiteSpace($out)
    } finally {
        Pop-Location
    }
}

function Get-CurrentCommit {
    Push-Location $RepoRoot
    try {
        $c = & git rev-parse --short HEAD 2>$null
        return $c
    } finally {
        Pop-Location
    }
}

function Run-Deploy {
    if ($script:DeployInFlight) {
        Write-WatchLog "Deploy already in flight, skipping duplicate trigger"
        return
    }
    if (-not (Test-Path $DeployScript)) {
        Write-WatchLog "Deploy script not found: $DeployScript" 'ERROR'
        Set-TrayState 'error' "deploy script missing"
        Show-Balloon 'FolioWatch - deploy skipped' "Deploy script not found at $DeployScript" 'Error'
        return
    }
    if (-not (Should-Deploy)) {
        Write-WatchLog "No git changes to deploy - treating as no-op"
        Set-TrayState 'idle' 'watching (clean)'
        return
    }
    $script:DeployInFlight = $true
    Set-TrayState 'deploying' 'running deploy...'
    $startedAt = Get-Date
    Write-WatchLog "Starting deploy via $DeployScript"

    try {
        # Run the deploy script with -NoNewWindow so its output can be
        # captured. The existing folio-push.ps1 uses Read-Host for a
        # confirmation prompt when interactive - set an env var so it
        # skips that when running under FolioWatch.
        $env:FOLIO_WATCH_AUTO = '1'
        $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $DeployScript 2>&1 | Out-String
        Remove-Item Env:FOLIO_WATCH_AUTO -ErrorAction SilentlyContinue

        $duration = [int](New-TimeSpan -Start $startedAt -End (Get-Date)).TotalMilliseconds
        $success = ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE)

        $entry = @{
            at        = (Get-Date -Format 'o')
            commit    = (Get-CurrentCommit)
            durationMs = $duration
            result    = if ($success) { 'success' } else { 'error' }
        }
        $script:State.recentDeploys = @($script:State.recentDeploys) + $entry
        $script:State.totalDeploys  = ([int]$script:State.totalDeploys) + 1
        $script:State.lastDeployAt  = $entry.at
        $script:State.lastDeployedCommit = $entry.commit
        $script:State.lastResult    = $entry.result

        if ($success) {
            $script:State.lastError = $null
            Save-State $script:State
            Write-WatchLog "Deploy succeeded in ${duration}ms (commit $($entry.commit))"
            Set-TrayState 'idle' "last deploy OK ($($entry.commit))"
            Show-Balloon 'FolioWatch - deployed' "Commit $($entry.commit) pushed in ${duration}ms." 'Info'
        } else {
            $tail = ($out -split "`n" | Select-Object -Last 5) -join "`n"
            $script:State.lastError = $tail
            Save-State $script:State
            Write-WatchLog "Deploy FAILED (exit $LASTEXITCODE). Last output lines:`n$tail" 'ERROR'
            Set-TrayState 'error' "deploy failed (see log)"
            Show-Balloon 'FolioWatch - deploy failed' "Right-click the tray icon > Show Log for details." 'Error'
        }
    } catch {
        Write-WatchLog "Deploy threw an exception: $_" 'ERROR'
        $script:State.lastError = "$_"
        Save-State $script:State
        Set-TrayState 'error' 'deploy exception'
        Show-Balloon 'FolioWatch - deploy exception' "$_" 'Error'
    } finally {
        $script:DeployInFlight = $false
    }
}

# =====================================================================
# Debounce timer - collects rapid file changes into one deploy.
# =====================================================================

$script:DebounceTimer = New-Object System.Windows.Forms.Timer
$script:DebounceTimer.Interval = $DebounceMs
$script:DebounceTimer.Add_Tick({
    $script:DebounceTimer.Stop()
    # Small settle sleep to let the last file finish flushing to disk.
    Start-Sleep -Milliseconds $SettleMs
    Run-Deploy
})

function Trigger-Debounce {
    param([string]$Reason)
    if ($script:State.paused) {
        Write-WatchLog "Change detected but watcher is paused ($Reason)"
        return
    }
    if ($script:DeployInFlight) {
        Write-WatchLog "Change detected during deploy - will be picked up on next cycle"
        return
    }
    $script:DebounceTimer.Stop()
    $script:DebounceTimer.Start()
    Set-TrayState 'debounce' "change: $Reason (waiting ${DebounceMs}ms)"
    Write-WatchLog "Debounce (re)started: $Reason"
}

# =====================================================================
# FileSystemWatcher - the actual "notice a change" mechanism.
# =====================================================================

function New-Watcher {
    $w = New-Object System.IO.FileSystemWatcher $RepoRoot
    $w.IncludeSubdirectories = $true
    $w.EnableRaisingEvents   = $true
    $w.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'

    $action = {
        $path = $Event.SourceEventArgs.FullPath
        $name = $Event.SourceEventArgs.Name
        $type = $Event.SourceEventArgs.ChangeType
        # Ignore paths inside .git/, node_modules/, etc.
        foreach ($ig in $script:IgnoreSubpaths) {
            if ($path -like "*$ig*") { return }
        }
        # Ignore specific filenames (state files, pending commit msg, etc.)
        $leaf = [System.IO.Path]::GetFileName($path)
        if ($script:IgnoreFilenames -contains $leaf) { return }
        # Ignore .tmp / .swp / editor lock files - usually flurries of
        # them accompany a normal save, but they self-clean quickly.
        if ($leaf -match '\.(tmp|swp|swx|swo|~)$' -or $leaf -match '^~') { return }
        # Ignore directory-only events (we care about file-level saves).
        if (Test-Path $path -PathType Container) { return }
        Trigger-Debounce "$type $leaf"
    }

    Register-ObjectEvent -InputObject $w -EventName 'Changed' -Action $action | Out-Null
    Register-ObjectEvent -InputObject $w -EventName 'Created' -Action $action | Out-Null
    Register-ObjectEvent -InputObject $w -EventName 'Renamed' -Action $action | Out-Null
    Register-ObjectEvent -InputObject $w -EventName 'Deleted' -Action $action | Out-Null

    return $w
}

# Stash ignores in script scope for the event handler closure.
$script:IgnoreSubpaths   = $IgnoreSubpaths
$script:IgnoreFilenames  = $IgnoreFilenames

$script:Watcher = New-Watcher

# =====================================================================
# Tray right-click menu
# =====================================================================

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miDeploy = $menu.Items.Add('&Deploy now')
$miDeploy.Add_Click({
    Write-WatchLog "Manual deploy triggered from tray menu"
    Run-Deploy
})

$miPause = $menu.Items.Add('&Pause watching')
$miPause.Add_Click({
    if ($script:State.paused) {
        $script:State.paused = $false
        $miPause.Text = '&Pause watching'
        Set-TrayState 'idle' 'watching (resumed)'
        Show-Balloon 'FolioWatch resumed' 'Auto-deploy is watching for changes again.'
        Write-WatchLog "Watching resumed"
    } else {
        $script:State.paused = $true
        $miPause.Text = '&Resume watching'
        $script:DebounceTimer.Stop()
        Set-TrayState 'paused' 'paused'
        Show-Balloon 'FolioWatch paused' 'Auto-deploy is paused. Deploy Now still works manually.'
        Write-WatchLog "Watching paused"
    }
    Save-State $script:State
})

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miLog = $menu.Items.Add('Show &log')
$miLog.Add_Click({
    if (Test-Path $LogFile) {
        Start-Process notepad.exe -ArgumentList $LogFile
    } else {
        Show-Balloon 'FolioWatch' 'Log file not created yet.'
    }
})

$miState = $menu.Items.Add('Show &state.json')
$miState.Add_Click({
    if (Test-Path $StateFile) {
        Start-Process notepad.exe -ArgumentList $StateFile
    } else {
        Show-Balloon 'FolioWatch' 'State file not created yet.'
    }
})

$miRepo = $menu.Items.Add('Open &Folio repo')
$miRepo.Add_Click({
    Start-Process explorer.exe $RepoRoot
})

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miQuit = $menu.Items.Add('&Quit FolioWatch')
$miQuit.Add_Click({
    Write-WatchLog "Quit selected from tray menu"
    $script:Watcher.EnableRaisingEvents = $false
    $script:Watcher.Dispose()
    $script:DebounceTimer.Stop()
    $Tray.Visible = $false
    $Tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$Tray.ContextMenuStrip = $menu

# Double-click tray -> deploy now (fast path for the frequent case)
$Tray.Add_MouseDoubleClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Write-WatchLog "Tray double-click - deploying now"
        Run-Deploy
    }
})

# =====================================================================
# Initial state announcement
# =====================================================================

Set-TrayState 'idle' 'watching for changes'
Show-Balloon 'FolioWatch started' "Watching $RepoRoot for changes. Right-click for options."
Write-WatchLog "Ready. Watching $RepoRoot"

# =====================================================================
# Message loop - keeps the tray icon alive.
# =====================================================================

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    try { $Tray.Visible = $false; $Tray.Dispose() } catch { }
    try { $script:Watcher.Dispose() } catch { }
    Write-WatchLog "FolioWatch exiting"
}
