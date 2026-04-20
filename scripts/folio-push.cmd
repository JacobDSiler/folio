@echo off
REM ---------------------------------------------------------------------------
REM  folio-push.cmd — double-click launcher for folio-push.ps1
REM
REM  Calls PowerShell with -NoProfile and -ExecutionPolicy Bypass so the .ps1
REM  runs cleanly regardless of the machine's policy.  The PS script handles
REM  its own "press Enter to close" prompt so the window always stays open
REM  long enough to read the output.
REM
REM  Usage: put this next to folio-push.ps1 in the same directory (ideally
REM  at <repo>\scripts\) and double-click it.
REM ---------------------------------------------------------------------------

setlocal
set "HERE=%~dp0"
set "PS1=%HERE%folio-push.ps1"

if not exist "%PS1%" (
    echo Could not find folio-push.ps1 next to this launcher.
    echo Expected at: %PS1%
    echo.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"

REM  PowerShell script self-pauses, but this extra pause guards against
REM  the script exiting before its own prompt runs (e.g. if PowerShell
REM  itself fails to launch).
if errorlevel 1 (
    echo.
    echo PowerShell exited with code %errorlevel%.
    pause
)

endlocal
