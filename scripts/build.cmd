@echo off
REM Folio Build Script Wrapper
REM Double-click this file to run the build

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

REM Run PowerShell with the build.ps1 script
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build.ps1" %*

REM Keep the window open if there was an error
if %ERRORLEVEL% neq 0 (
  echo.
  echo Build failed. Press any key to close this window.
  pause
  exit /b %ERRORLEVEL%
)

REM Close window on success (optional - comment out to see success message)
REM exit /b 0
