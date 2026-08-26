' ═══════════════════════════════════════════════════════════════════
' FolioWatch — silent launcher
' ═══════════════════════════════════════════════════════════════════
' Double-click this file to start folio-watch.ps1 with ZERO visible
' console window. Uses wscript.exe (which itself has no console)
' rather than cmd.exe (which flashes briefly at startup even with
' -WindowStyle Hidden). PowerShell itself launches with WindowStyle
' 0 (SW_HIDE) so no window is ever painted on screen.
'
' The tray icon still appears normally — that's a separate window
' handle managed by folio-watch.ps1 itself.
'
' AUTO-START ON LOGIN:
'   1. Right-click this file → Create shortcut
'   2. Move the shortcut to:
'        %AppData%\Microsoft\Windows\Start Menu\Programs\Startup
'      (paste `shell:startup` into a File Explorer address bar to
'      open that folder directly)
'   3. Log out and back in — watcher will boot silently on login.
' ═══════════════════════════════════════════════════════════════════

Dim WshShell, cmd
Set WshShell = CreateObject("WScript.Shell")

' -NoProfile          : skip loading the user's PowerShell profile
'                       (saves ~200ms + avoids profile-injected errors)
' -ExecutionPolicy    : Bypass so the script runs regardless of the
'                       machine's default execution policy
' -WindowStyle Hidden : PowerShell hides its own window immediately
' -File               : path to the watcher script
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\dev\folio\scripts\folio-watch.ps1"""

' Run flags:
'   intWindowStyle = 0  (SW_HIDE — no window at all)
'   bWaitOnReturn  = False (fire and forget; VBS exits immediately)
WshShell.Run cmd, 0, False

Set WshShell = Nothing
