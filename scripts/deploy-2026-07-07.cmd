@echo off
REM ---------------------------------------------------------------------------
REM  deploy-2026-07-07.cmd -- launcher for deploy-2026-07-07.ps1
REM
REM  Mirrors folio-push.cmd. Runs PowerShell with -NoProfile and
REM  -ExecutionPolicy Bypass so the .ps1 works from Git Bash
REM  (scripts/deploy-2026-07-07) or a double-click.
REM
REM  Usage:
REM    From Git Bash:  scripts/deploy-2026-07-07
REM    From cmd/PS:    scripts\deploy-2026-07-07
REM    Double-click:   works too
REM ---------------------------------------------------------------------------

setlocal
set "HERE=%~dp0"
set "PS1=%HERE%deploy-2026-07-07.ps1"

if not exist "%PS1%" (
    echo Could not find deploy-2026-07-07.ps1 next to this launcher.
    echo Expected at: %PS1%
    echo.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*

REM  PowerShell script self-pauses; extra pause guards against a PS
REM  launch failure that would otherwise close the window instantly.
if errorlevel 1 (
    echo.
    echo PowerShell exited with code %errorlevel%.
    pause
)

endlocal
