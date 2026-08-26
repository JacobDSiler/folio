@echo off
REM ═════════════════════════════════════════════════════════════════
REM FolioWatch - silent launcher (CMD fallback)
REM ═════════════════════════════════════════════════════════════════
REM Alternative to folio-watch-hidden.vbs for environments where
REM VBScript execution is blocked by group policy. Double-click to
REM start folio-watch.ps1 hidden.
REM
REM Note: this .cmd itself flashes briefly on launch (cmd.exe opens,
REM invokes powershell.exe hidden, then closes). If you want ZERO
REM visible flicker, use folio-watch-hidden.vbs instead.
REM
REM The 'start "" /min' trick minimises the launcher window as it
REM opens, so the flicker is a minimised task on the taskbar rather
REM than a full console window - marginally less visible but still
REM present.
REM ═════════════════════════════════════════════════════════════════

start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\dev\folio\scripts\folio-watch.ps1"
exit
