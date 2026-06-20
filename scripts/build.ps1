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

# ──────────────────────────────────────────────────────────────────
# Reference-aliasing check (added after the modularization regression
# caught on 2026-06-20: Phase 1/2 modules exported symbols but the
# classic <script> below still referenced them as bare globals, with
# no window.<name> alias — every callsite would have ReferenceError'd
# at runtime).
#
# For each exported symbol from a tracked src/ module:
#   1. Find the symbol's bare-identifier callsites in app.html's
#      classic <script> region (the BIG block after the module block).
#   2. If any exist, require a matching `window.<name> = <name>` line
#      somewhere in the module block at the top of app.html.
#   3. Symbols with zero bare callsites are fine — they were either
#      never used by the classic script, or every callsite was already
#      refactored to the namespaced form (window._previewUtils.getV).
# Fails the build with a clear message naming the offending module +
# symbol so the next extraction phase can't ship the same regression.
# ──────────────────────────────────────────────────────────────────
if (Test-Path "app.html") {
  Write-Host "`n--- Symbol-alias regression check ---" -ForegroundColor Cyan
  $appText = Get-Content "app.html" -Raw

  # Known-OK exports whose "bare" references are actually function
  # PARAMETERS (and therefore locally-scoped) rather than free-variable
  # lookups. Add an entry here if a check fires on a symbol that's only
  # used as a parameter, after manually verifying every callsite.
  #   dialogueGetCharacter — passed in to _apRenderPreviewParagraph as
  #     a parameter at line ~23602; called as that local parameter at
  #     line ~23619. Caller (line ~13556) passes the underscore-aliased
  #     window._dialogueGetCharacter into the slot.
  $ignoredSymbols = @{
    'dialogueGetCharacter' = 'param of _apRenderPreviewParagraph; caller passes window._dialogueGetCharacter'
  }

  # Locate the module block (single <script type="module"> at file top)
  # so we can constrain the alias-lookup to it (no false positives from
  # similar-looking lines deep in the classic script).
  $modStart = $appText.IndexOf('<script type="module">')
  if ($modStart -lt 0) {
    Write-Host "[FAIL] No <script type=`"module`"> block in app.html" -ForegroundColor Red
    exit 1
  }
  # End of module block = closing </script> AFTER modStart.
  $modEnd = $appText.IndexOf('</script>', $modStart)
  $modBlock = $appText.Substring($modStart, $modEnd - $modStart)
  # Everything after the module block is the classic-script + body region.
  $classicRegion = $appText.Substring($modEnd)

  $totalBad = 0
  foreach ($mod in $modules) {
    if (-not (Test-Path $mod)) { continue }
    $src = Get-Content $mod -Raw
    # Pull out every exported identifier. Handles:
    #   export const NAME = ...
    #   export function NAME(...) { ... }
    #   export async function NAME(...) { ... }
    $exports = [System.Collections.Generic.HashSet[string]]::new()
    $matches = [regex]::Matches(
      $src,
      '(?m)^\s*export\s+(?:async\s+)?(?:const|let|var|function)\s+([A-Za-z_]\w*)'
    )
    foreach ($m in $matches) { [void]$exports.Add($m.Groups[1].Value) }
    if ($exports.Count -eq 0) { continue }

    Write-Host ("  $mod  ({0} exports)" -f $exports.Count) -ForegroundColor Gray
    foreach ($sym in $exports) {
      # Bare callsites = `<symbol>` boundary match in the classic region.
      # `\b` is fine here because we're looking for the identifier as a
      # standalone token (call, property access, etc.).
      $bareCount = ([regex]::Matches($classicRegion, "\b$sym\b")).Count
      if ($bareCount -eq 0) { continue }

      # Skip allow-listed function-parameter-name false positives.
      if ($ignoredSymbols.ContainsKey($sym)) {
        $why = $ignoredSymbols[$sym]
        Write-Host ("    [SKIP] $sym  -- $bareCount bare ref(s) ignored ($why)") -ForegroundColor Yellow
        continue
      }

      # Alias = `window.<sym> = <sym>` (or = <sym>;) in the module block.
      $aliasPattern = "window\.$sym\s*=\s*$sym\b"
      $hasAlias = [regex]::IsMatch($modBlock, $aliasPattern)
      if ($hasAlias) {
        Write-Host ("    [OK]   $sym  -- $bareCount bare ref(s), window alias present") -ForegroundColor Green
      } else {
        Write-Host ("    [FAIL] $sym  -- $bareCount bare ref(s) in classic script, NO `window.$sym = $sym` alias in module block") -ForegroundColor Red
        $totalBad++
      }
    }
  }

  if ($totalBad -gt 0) {
    Write-Host ("`n[FAIL] {0} symbol(s) need window aliases (or their callsites refactored) before push." -f $totalBad) -ForegroundColor Red
    Write-Host "       Add `window.<name> = <name>;` lines to the module block at the top of app.html," -ForegroundColor Red
    Write-Host "       mirroring the pattern used for the characters module." -ForegroundColor Red
    exit 1
  } else {
    Write-Host "[OK] All extracted symbols with classic-script callsites have window aliases." -ForegroundColor Green
  }
}

Write-Host "`n[OK] Build complete - ready for browser test`n" -ForegroundColor Green
