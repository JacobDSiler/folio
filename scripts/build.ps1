param([switch]$Watch)

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "`n=== Folio Build - Phase 1 (Utils) ===" -ForegroundColor Cyan

$modules = @("src/utils/constants.js")

foreach ($m in $modules) {
  if (Test-Path $m) {
    Write-Host "[OK] Found: $m" -ForegroundColor Green
  } else {
    Write-Host "[FAIL] Missing: $m" -ForegroundColor Red
    exit 1
  }
}

if (Test-Path "app.html") {
  $content = Get-Content "app.html" -Raw
  if ($content -like "*src/utils/constants.js*") {
    Write-Host "[OK] app.html imports constants.js" -ForegroundColor Green
  } else {
    Write-Host "[INFO] Import check (will be added during refactoring)" -ForegroundColor Yellow
  }
}

Write-Host "`n[OK] Build complete - ready for browser test`n" -ForegroundColor Green
