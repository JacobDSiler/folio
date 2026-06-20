param([switch]$Watch)

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "`n=== Folio Build - Phase 3 (Utils + Preview + Characters) ===" -ForegroundColor Cyan

$modules = @("src/utils/constants.js", "src/modules/preview-utils.js", "src/modules/characters.js")

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
    Write-Host "[INFO] Constants import (will be added during refactoring)" -ForegroundColor Yellow
  }
  if ($content -like "*src/modules/preview-utils.js*") {
    Write-Host "[OK] app.html imports preview-utils.js" -ForegroundColor Green
  } else {
    Write-Host "[INFO] Preview-utils import (will be added during refactoring)" -ForegroundColor Yellow
  }
  if ($content -like "*src/modules/characters.js*") {
    Write-Host "[OK] app.html imports characters.js" -ForegroundColor Green
  } else {
    Write-Host "[INFO] Characters import (will be added during refactoring)" -ForegroundColor Yellow
  }
}

Write-Host "`n[OK] Build complete - ready for browser test`n" -ForegroundColor Green
