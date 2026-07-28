<#
.SYNOPSIS
    Ship the 2026-07-07 batch (admin console + role management + shelf
    moderation scaffolding) to production.

.DESCRIPTION
    One-off deploy for this session's batch. Does NOT touch index.html or
    folio-tts-worker.js, so it doesn't collide with folio-push.ps1.

    Steps:
      0. Clear any stale .git\index.lock (VS Code sometimes leaves one).
      1. Verify shipping files landed on disk.
      2. Sanity-check app.html tail (VS Code truncation defence).
      3. gsutil cors set   (Firebase Storage CORS for product photos).
      4. firebase deploy --only firestore:rules (folio_roles + isAdmin).
      5. git add + git commit -F <msg> + git push (GitHub Pages picks up).

.EXAMPLE
    From Git Bash:   scripts/deploy-2026-07-07
    From PowerShell: .\scripts\deploy-2026-07-07.ps1

.NOTES
    Requires: PowerShell 5+, git, firebase-cli, gsutil (Google Cloud SDK).
    ASCII-only comments so PS 5.1 does not choke on encoding.
#>

$HOLD_OPEN = $true
$script:exitCode = 0

function Stop-Here([int]$code = 0) {
    $script:exitCode = $code
    if ($HOLD_OPEN) {
        Write-Host ""
        Write-Host "Press Enter to close..." -ForegroundColor DarkGray
        Read-Host | Out-Null
    }
    exit $code
}

try {
    $ErrorActionPreference = 'Stop'

    Write-Host ""
    Write-Host "=== Folio deploy 2026-07-07 ===" -ForegroundColor Cyan

    # -- Locate repo root ---------------------------------------------
    $repoRoot = $null
    try { $repoRoot = (& git rev-parse --show-toplevel 2>$null) } catch {}
    if (-not $repoRoot) {
        Write-Host "Not inside a git repository. cd into the folio clone first." -ForegroundColor Red
        Stop-Here 1
    }
    Set-Location $repoRoot
    Write-Host "Repo:   $repoRoot" -ForegroundColor Cyan

    # -- 0. Clear stale git lock --------------------------------------
    $lock = Join-Path $repoRoot ".git\index.lock"
    if (Test-Path $lock) {
        Write-Host "Clearing stale .git\index.lock ..." -ForegroundColor Yellow
        try { Remove-Item $lock -Force -ErrorAction Stop }
        catch {
            Write-Host "Could not remove the lock: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Close VS Code (or any editor holding a git handle) and re-run." -ForegroundColor Yellow
            Stop-Here 1
        }
    }

    # -- 1. File inventory --------------------------------------------
    Write-Host ""
    Write-Host "-- File inventory --" -ForegroundColor Cyan
    $must = @(
        "app.html", "shelf.html",
        "docs\firestore.rules", "docs\firebase-storage-cors.json",
        "docs\SHELF_MODERATION_DESIGN.md", "docs\LOCALIZATION_DESIGN.md",
        "admin\index.html", "admin\admins\index.html",
        "admin\boost\index.html", "admin\reviews\index.html", "admin\press\index.html",
        "wrangler.toml", ".gitignore"
    )
    $missing = @()
    foreach ($f in $must) {
        if (Test-Path $f) {
            $sz = (Get-Item $f).Length
            Write-Host ("  OK   {0}  ({1} bytes)" -f $f, $sz)
        } else {
            Write-Host ("  MISS {0}" -f $f) -ForegroundColor Red
            $missing += $f
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Missing files - aborting." -ForegroundColor Red
        Stop-Here 1
    }

    # -- 2. app.html tail sanity --------------------------------------
    # PS 5.1 disallows -Raw + -Tail together, so read the tail as lines
    # and rejoin. 4 lines is plenty to catch a </html> close.
    $tail = ((Get-Content "app.html" -Tail 4) -join "`n")
    if ($tail -notmatch "</html>\s*$") {
        Write-Host ""
        Write-Host "ERROR: app.html does not end with </html>." -ForegroundColor Red
        Write-Host "VS Code may have truncated it. Close app.html in VS Code" -ForegroundColor Red
        Write-Host "(or Ctrl+Shift+P -> 'Revert File') and re-run." -ForegroundColor Yellow
        Stop-Here 1
    }
    Write-Host "  OK   app.html closes with </html>" -ForegroundColor Green

    # -- 3. Firebase Storage CORS -------------------------------------
    Write-Host ""
    Write-Host "-- Firebase Storage CORS --" -ForegroundColor Cyan
    $gsutil = Get-Command gsutil -ErrorAction SilentlyContinue
    if (-not $gsutil) { $gsutil = Get-Command gsutil.cmd -ErrorAction SilentlyContinue }
    if (-not $gsutil) {
        Write-Host "gsutil not on PATH. Install Google Cloud SDK or run this step manually:" -ForegroundColor Yellow
        Write-Host "  gsutil cors set docs\firebase-storage-cors.json gs://miscellaneous-117e9.firebasestorage.app" -ForegroundColor Yellow
    } else {
        & gsutil cors set docs\firebase-storage-cors.json gs://miscellaneous-117e9.firebasestorage.app
        if ($LASTEXITCODE -ne 0) { Write-Host "gsutil failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
    }

    # -- 4. Firestore + Storage rules ---------------------------------
    # Storage rules gate cover-image uploads (folio_images/{folioId}/...).
    # If you get a 403 uploading a cover, this step probably didn't run.
    Write-Host ""
    Write-Host "-- Firestore + Storage rules --" -ForegroundColor Cyan
    # firebase-cli on Windows ships as a .cmd shim from npm-global,
    # which Get-Command doesn't always resolve. Try both the bare name
    # and the .cmd suffix before giving up.
    $firebase = Get-Command firebase -ErrorAction SilentlyContinue
    if (-not $firebase) { $firebase = Get-Command firebase.cmd -ErrorAction SilentlyContinue }
    if (-not $firebase) {
        Write-Host "firebase-cli not on PATH. Install and run:" -ForegroundColor Yellow
        Write-Host "  firebase deploy --only firestore:rules,storage" -ForegroundColor Yellow
    } else {
        & $firebase.Source deploy --only firestore:rules,storage
        if ($LASTEXITCODE -ne 0) { Write-Host "firebase deploy failed (exit $LASTEXITCODE)." -ForegroundColor Red; Stop-Here $LASTEXITCODE }
    }

    # -- 5. Git commit + push -----------------------------------------
    Write-Host ""
    Write-Host "-- Git commit + push --" -ForegroundColor Cyan

    # Stage only what this batch touches. Prior drift on imprint/,
    # press/, and scripts/folio-push.ps1 stays uncommitted; Jacob can
    # review + commit those separately if desired.
    & git add .gitignore
    # GitHub Pages runs Jekyll by default, which excludes every file whose
    # name starts with '_'. That silently 404'd /admin/_shared.js in
    # production and made /admin/boost's author-lookup widget invisible
    # (FolioAdmin was undefined at runtime). Adding an empty .nojekyll
    # tells GitHub Pages to skip Jekyll entirely so underscore files ship.
    & git add .nojekyll
    # index.html is the main welcome/marketing page -- it kept getting
    # dropped from this list, which is why deploys sometimes silently
    # skipped a batch when index.html was the only file changed. Added
    # 2026-07-17 after "your branch is up to date with origin/main"
    # errors traced back here.
    & git add index.html
    & git add app.html shelf.html
    # Product photo templates -- the .psdt files themselves stay in
    # Firebase Storage (gitignored), but manifest.json IS tracked so
    # the app knows which templates exist and where their metadata
    # lives. Untracked manifest = photos page shows an empty catalog.
    & git add press\photos\templates\manifest.json
    & git add docs\firestore.rules docs\storage.rules docs\firebase-storage-cors.json docs\SHELF_MODERATION_DESIGN.md
    & git add docs\LOCALIZATION_DESIGN.md
    & git add docs\TOMORROW_PLAN.md docs\EMAIL_FOLIO_LAUNCH.md docs\STOCK_PHOTO_TEMPLATES.md
    & git add firebase.json .firebaserc
    & git add admin\index.html admin\admins\index.html
    & git add admin\boost\index.html admin\reviews\index.html admin\press\index.html
    & git add wrangler.toml
    & git add press\photos\index.html
    & git add press\index.html press\import\index.html
    & git add 404.html s\index.html
    & git add help\index.html
    & git add admin\_shared.js admin\reviews\index.html
    & git add docs\AUTH_UNAUTHORIZED_DOMAIN_FIX.md docs\STABILITY_PLAN.md
    & git add docs\TUTORIAL_STRATEGY.md
    & git add docs\ADMIN_DIGEST_SETUP.md
    & git add folio-email-worker.js
    & git add imprint\index.html
    & git add .githooks\pre-commit
    & git add policy\index.html
    & git add admin\shelf\index.html
    & git add admin\metrics\index.html
    & git add press\index.html
    & git add docs\METRICS_PLAN.md
    & git add folio-paywall-worker.js
    & git add scripts\deploy-2026-07-07.ps1 scripts\deploy-2026-07-07.cmd

    # Commit message in a temp file so multi-line + non-ASCII survive
    # the round-trip through PowerShell -> git.
    $msgPath = Join-Path $env:TEMP "folio-deploy-2026-07-07.msg"
    $msg = @"
feat(auth): full anonymous → Google migration on sign-in

Previously, when an anonymous user tried to link to a Google account
that already had its own Firebase uid, Firebase threw
auth/credential-already-in-use and we silently signed them into the
existing Google account. Anything they'd built on the anon session
(folios, comps, subscribers, metrics) was orphaned in Firestore —
"contact support" was the recovery path.

This batch fixes it end-to-end:

1. Worker endpoint POST /migrate-anon-to-google
   Body: { anonIdToken, googleIdToken }. Verifies both tokens
   via Identity Toolkit, extracts uids from the verified tokens
   (never trusts client-provided uids). Then via service account:
     - Queries folio_projects where uid == anonUid (up to 100)
     - PATCHes each doc's uid to googleUid. Subcollections
       (body/, versions/, subscribers/, paid_sales/, metrics/)
       stay put because they're keyed by folio ID, not uid.
     - Reads folio_user_settings/{anonUid} + /{googleUid}, merges
       ONLY scalar fields that don't already exist on the Google
       side. Critical fields like pressSubscription on the Google
       side are never overwritten by anon-side data.
   Returns { migrated, failed, anonUid, googleUid, notes[] }.

2. Client refactor — release-modal sign-in prompt
   (window._rlShelfSignInPrompt in app.html):
     - Captures the anon ID token BEFORE the popup (once
       signInWithCredential fires the anon session is dead and
       its token can't be regenerated).
     - Tries linkWithPopup. On success the anon uid is preserved
       with Google added as a provider — no migration needed.
     - On credential-already-in-use: extracts credential via
       GoogleAuthProvider.credentialFromError, signs into the
       existing Google account via signInWithCredential, calls
       /migrate-anon-to-google, then reloads the app so
       everything re-renders under the new uid.
     - Shows migration progress + result in the release modal's
       status line.

3. GIS sign-in flow (sidebar / main app sign-in button) gets the
   same treatment. Captures anon token BEFORE linkWithCredential
   attempt, falls back through migration on credential-in-use.
   The legacy _restoreFolioBackupAfterUpgrade path (localStorage
   backup of just the currently-open folio) stays as a
   belt-and-braces safety net if the worker migration fails.

4. Fixed the sibling regression from the previous batch: when
   onAuthStateChanged fired with no user AND
   localStorage.folio_had_real_session === '1', we were skipping
   auto-anon entirely — leaving the app hanging on "Loading your
   folios…" forever because downstream code expects SOME user.
   Now auto-anon runs unconditionally; the folio-needs-resignin
   event still fires so the amber re-sign-in banner shows on top,
   giving the user a one-click path back to their real account.

5. New re-sign-in banner (app.html top of page). Listens for the
   folio-needs-resignin event, renders a dismissible amber bar:
   "Your Google session was cleared. You were signed in as
   <email>. Sign back in to reach your existing folios."
   Clicking the button signs out the fresh anon session first
   (so linkWithCredential doesn't collide with the pre-existing
   admin uid) then opens the Google popup. Dismissing hides for
   the tab; reappears on next reload if the situation persists.
   Auto-removes on successful non-anon sign-in.

Related UI polish:
  - "Review Folio" button lifted out of the collapsible Shortcuts
    <details> — now a sibling so it stays visible even when the
    Shortcuts menu is collapsed. Amber-tinted background lifts it
    above the neutral row of sibling buttons.
  - Two-line label ("Review Folio" / "Earn a free 24h Featured
    Boost") makes the exchange explicit; tooltip expands.
  - Modal intro explicitly says "Honest reviews of Folio itself"
    to distinguish from any book-review flow.
  - Help page (/help/) gains a "Reviews + feedback" section with
    deep-linkable #reviews anchor referenced from the modal.

---

Previous batch — kept in commit history:

fix(auth): kill flash-of-signed-out across all admin subpages

Follow-up to the earlier anon-account-churn fix. Even after
persistence was stabilized, Jacob kept getting kicked to the sign-in
gate mid-navigation ("clicking Review moderation particularly
invalidates it immediately"). Two contributing issues:

1. First-render race. Every admin subpage was calling
   onAuthStateChanged BEFORE Firebase's IndexedDB hydration had
   settled. That first fire came through with user=null, we rendered
   the sign-in gate, and then a second fire came through with the
   real Google user — but the gate had already flashed into view
   and read as an auth invalidation. Fix: await authStateReady()
   (Firebase v10.14+; polled fallback for older builds) BEFORE
   wiring the listener, and fire the initial handler synchronously
   with the resolved state.

2. Anonymous sessions from app.html were still leaking into admin
   pages when Firefox ETP purged auth.jacobsiler.com storage.
   The admin pages now treat anonymous identically to signed-out —
   sign-in gate, no confusing "signed in as ANON_UID / not on
   allowlist" combo. Sign-in button signs the anonymous session out
   first before opening the Google popup so linkWithCredential
   can't collide with the pre-existing admin uid.

Structural changes:
  - New "authLoading" splash on every admin subpage. Shown by default;
    swapped for either the sign-in gate or the admin body once auth
    resolves. Prevents the sign-in gate from ever being visible
    during the hydration window.
  - Persistence ladder standardised: indexedDBLocalPersistence first
    (Firefox ETP resilient), browserLocalPersistence fallback for
    Safari private mode.
  - New FolioAdmin.bootAuth helper in admin/_shared.js consolidates
    the auth-plumbing boilerplate. Existing pages keep their inline
    boot() (each has page-specific rendering); new admin pages should
    call bootAuth to inherit these fixes automatically.

Pages updated: admin/index.html, admin/reviews/, admin/shelf/,
admin/metrics/, admin/press/, admin/admins/, admin/boost/.

---

Previous batch — kept in commit history:

fix(auth): stop anonymous account churn clobbering admin sessions

Root cause: Firefox ETP + Chrome's third-party-storage protections
treat the custom auth.jacobsiler.com domain as third-party and purge
its IndexedDB between visits. When app.html's onAuthStateChanged
then fired with user=null, it silently auto-created a fresh
anonymous account. That new anon session became the current auth
state — and when Jacob navigated back to /admin/, the console
showed 'Signed in as ANON_UID — not on admin allowlist' every
single visit, driving him nuts.

Fixes in this batch:

1. app.html — explicit persistence setup. Try indexedDBLocalPersistence
   first, fall back to browserLocalPersistence. The SDK's default is
   already local, but the fallback ladder can silently drop to
   session-only when IndexedDB is blocked — being explicit at least
   documents intent + logs a warning if it can't be set at all.

2. app.html — history-aware auto-anon guard. Every non-anonymous
   sign-in stamps localStorage.folio_had_real_session=1. When
   onAuthStateChanged later fires with null, we check that flag:
     - Flag absent → first-time visitor, auto-anon as before
       (preserves the "try Folio without signing up" path).
     - Flag present → their real session was wiped; do NOT create
       a new anon that would orphan every subsequent uid. Instead
       fire a folio-needs-resignin event and let the user re-sign-in
       cleanly.

3. admin/index.html — anonymous sessions rendered as signed-out.
   Anonymous uid + 'not on allowlist' error text read as if Jacob
   needed to sign out first. Now anonymous is treated identically to
   the no-user case: sign-in gate visible, no confusing 'signed in
   as ANON_UID' line, no allowlist error. Clicking Sign in with
   Google signs the anon out first (so linkWithCredential doesn't
   collide with the pre-existing admin uid) then does a fresh popup.

---

Previous batch — kept in commit history:

feat(moderation): tiered ratings, contact author, sign-in gate

Content rating tiers replace the single hasAdultContent boolean:
  all / 12+ / 16+ / 18+. Any rating above 'all' queues for moderator
  review; 16+ and 18+ are hidden from signed-out shelf visitors. Save
  logic re-queues on ANY rating change (up OR down) so an approved
  18+ folio can't silently downgrade to 'all' and appear to signed-out
  browsers. Legacy hasAdultContent stays in sync (=== 18+) for older
  readers/exports that key off the boolean.

Moderator experience on /admin/shelf/:
  - Rating dropdown on every card: pick All / 12+ / 16+ / 18+, saves
    immediately (no confirm), audit stamps written
    (shelfRatingSetByModerator + shelfRatingSetAt).
  - Contact author button opens templated composer + hands off to
    the moderator's mail client via mailto:. Templates cover the
    common cases: structural fixes, rating adjustment, content policy
    check, approval welcome, blank.
  - Fact sheet in the Contact modal — Firebase Auth record for the
    author (email, display name, sign-in providers, account creation,
    last sign-in, disabled flag, federated Google profile URL). Used
    both for outreach and as the paper trail if a report ever needs
    to go to authorities.
  - New /admin/user-lookup?uid=X&key=<ADMIN_DEBUG_TOKEN> endpoint on
    the paywall worker fetches Firebase Auth records via service
    account. Used as the fallback when folio_user_settings/{uid}.
    lastEmail is missing (older signups that pre-date the merge-write).

Sign-in gate for Shelf listing:
  - Anonymous accounts can no longer publish to the public Shelf.
    Ticking List on Shelf while anonymous swaps the sub-fields for
    a sign-in prompt that uses Firebase's linkWithCredential path
    (via the existing GIS handler around app.html:7871) so the
    anonymous uid is preserved and Google gets attached — every
    folio, comp, subscription, and metric on that uid survives.
  - Save-time guard: listOnShelf silently downgrades to false if the
    user is anonymous at save time. Firestore rule enforces the
    same constraint server-side (request.auth.token.firebase.
    sign_in_provider != 'anonymous' required for release.
    listOnShelf == true) so a bad client can't force it. Admins
    bypass so moderator write-throughs still work.

Shelf display:
  - New rating badges: 12+ (teal), 16+ (amber), 🔞 18+ (existing
    adult styling). All ages renders no badge.
  - 16+/18+ hidden from signed-out visitors on the shelf grid
    (12+ stays visible; teen-appropriate content doesn't need a
    login gate).
  - Author metrics tab publish-state line shows the specific tier
    (Rated 12+ / Rated 16+ / Rated 🔞 18+) instead of the old
    all-or-nothing "Adult content flag".

Admin metrics dashboard:
  - "Adult-flagged" tile replaced with "Rated content" —
    breakdown as "X at 12+ · Y at 16+ · Z at 18+" so Jacob sees
    per-tier volume at a glance.
  - Recently-published table renders tier-specific rating chips
    instead of a flat "adult" bucket.

Firestore rules:
  - folio_projects create + update require
    request.auth.token.firebase.sign_in_provider != 'anonymous'
    when release.listOnShelf is being set true.

---

Previous batch — kept in commit history:

feat(paid folios): multi-tenant vendor auto-delivery

Vendor webhook secrets are now stored ONCE per Folio account rather
than once per folio. Previously an author with two Ko-fi-backed
folios needed two Ko-fi accounts (Ko-fi only lets you set one
webhook URL per account). Now:

  - One /vendor-owner-config doc per account
    (folio_vendor_owner_configs/{ownerUid}) with { vendors: { kofi:
    { secret, ownerEmail, updatedAt }, payhip: {...}, paypal: {...} } }
  - Three new fixed webhook URLs — /kofi-webhook, /payhip-webhook,
    /paypal-webhook — that any vendor purchase routes to
  - Webhook lookup:
      Ko-fi   -> owner identified by matching verification_token in
                 the payload against configured kofi.secret
      Payhip  -> HMAC signature enumerated against every configured
                 payhip.secret; first match wins
      PayPal  -> PayPal verify-signature endpoint called with each
                 configured paypal webhook_id; first SUCCESS wins
  - Folio matching (after owner is known):
      Ko-fi   -> shop_items[0].direct_link_code slug matched to the
                 /s/{slug} tail of release.checkoutUrl
      Payhip  -> product_link / product_id matched into checkoutUrl
      PayPal  -> reference_id / item name matched into checkoutUrl
                 (PayPal.me is ident-poor; if only one paid folio
                 exists for the owner, we fall through to it)
    If no folio matches, we log and return 200 so the vendor doesn't
    retry — sale is real, routing is manual until the release URL
    is fixed.
  - Legacy /vendor-webhook/{folioId} endpoint stays live for
    backwards compat: folios already configured that way keep firing
    through the old per-folio config.

Client changes (app.html, release modal):
  - Save writes to /vendor-owner-config (no folioId). "Account-wide
    setup" callout at the top of the auto-delivery drawer.
  - On modal open, GET /vendor-owner-config preloads which vendors
    are already connected. Picking a vendor that's already connected
    shows "✓ already connected on your account — paste new secret
    only to rotate" + reveals the webhook URL box immediately.
  - Disable now says "disconnect from account" (was "disable for
    this folio") with a warning that it affects every paid folio
    using that vendor.

Firestore rules:
  - folio_vendor_owner_configs/{ownerUid} — read/write: if false
    (worker-only via service account, same pattern as folio_vendor_
    webhooks/{folioId}).

No new env bindings or secrets required — reuses GCP_SERVICE_ACCOUNT,
PAYWALL_JWT_SECRET, EMAIL_WORKER binding, and (from PayPal) the
existing paypal_client_id / paypal_client_secret pair.

---

Previous batch — kept in commit history:

fix(reader): robust page-clipping + blank-paragraph persistence

Two Thomas-reported production bugs, both fixed with a single audit
of the paragraph pipeline:

1. Text clipping at page bottom (phone AND laptop, still hitting after
   the 0.5-to-1.2-line slack bump on 2026-07-20). Root causes: fonts
   not fully loaded at first paginate, sub-pixel drift on non-integer
   viewports, drop-cap float behaviour mismatch. Fixes:
     - Pagination slack bumped 1.2 to 2.5 lines (worst case: ~2 lines
       whitespace at page bottom; alternative is losing paid-customer
       content off the bottom which we do NOT accept)
     - document.fonts.ready gate before first pagination (re-renders
       once real fonts swap in)
     - Post-render watchdog _fixOverflowingPages: walks every
       .page-content, detects scrollHeight > clientHeight, tags with
       .page-overflowed for a visible fade + ellipsis instead of an
       invisible hard-clip, logs chapter+page to console so we can
       diagnose any remaining drift

2. Blank paragraphs (author scene-separators, psalm gaps) silently
   deleted. Root cause: ~30 rendering/export sites used the idiom
   ch.content.split('\n').filter(p => p.trim()) which dropped every
   empty line. Fixes:
     - New canonical splitter _paragraphsOf() preserves internal blanks
       up to a MAX_BLANK_RUN cap of 3
     - All 33 call sites migrated to _paragraphsOf via automated rewrite
     - Reader renders blank paragraphs as one-line editable spacers
     - Pagination measures blanks as lineH so page budgets stay honest
     - Enter key in preview editor now inserts a blank paragraph after
       the current one (was previously just calling .blur()); Backspace
       on an empty spacer paragraph deletes it and pulls the caret to
       the previous line. Feels like every other rich-text editor.
     - _onParaBlur / _onEditBlur walk _paragraphsOf so paraIdx stays
       consistent between render and save-back
     - EPUB, XHTML, RTF, DOCX exports all emit visible blank paragraphs

Also in this batch:
- fix(app): rename _paragraphsOf helper to avoid identifier collision
  with the pre-existing _splitParas array used by the manuscript split
  editor (the collision produced 'Identifier already declared' and
  killed the entire <script> block, blanking the whole app)
- fix(admin/admins): renderRoles() used \\' escapes inside single-quoted
  strings which closed the string prematurely and threw a SyntaxError
  that killed the whole boot script, leaving the page body blank.
  Rewrote button HTML with double-quoted strings + esc() on uid.
- fix(admin/press): revokeSub() had a duplicated try{} block left over
  from the earlier VS Code truncation-recovery paste -- 'Missing catch
  or finally after try' killed boot(), so the page hung on the
  'Checking sign-in...' placeholder forever. Removed the duplicate.
- fix(GH Pages): add .nojekyll so /admin/_shared.js actually publishes.
  GitHub Pages runs Jekyll by default and Jekyll excludes every file
  whose name starts with '_'. That's why /admin/boost's author-lookup
  widget was completely invisible in production -- the FolioAdmin
  script silently 404'd. .nojekyll disables Jekyll for the whole site
  so any file we ship reaches the browser.
- fix(find & replace): pick the correct continuation slice when a
  paragraph is split across pages. Long paragraphs render as a head
  slice + one or more .para-cont slices, all sharing data-paraidx.
  Old code always picked the head (:not(.para-cont)). If the match
  lived in the middle/tail, the needle wasn't in the head's walked
  text so we fell back to pulsing the whole head slice -- which on
  screen appeared as an unrelated short paragraph like "quarter-
  inch." (screenshot 2026-07-22: searching "Tarin" pulsed
  "quarter-inch." because "Tarin" was in a continuation slice on a
  later page). Now we enumerate all slices, walk each in DOM order
  tracking cumulative text length, and pick the slice whose range
  covers match.start - paraStartInContent. Also shift
  paraStartInContent so the highlight helper's offset math
  references the CHOSEN slice's start, not the whole paragraph's.
- fix(find & replace): highlight now waits for scroll to actually
  stop rather than firing on a fixed 520 ms timer. Chrome smooth-
  scroll takes 300 ms for short jumps and 1500+ ms across dozens
  of pages, so long-distance finds pulsed and faded before the
  paragraph arrived on screen. rAF-poll scrollTop; fire when it's
  been stable for 3 consecutive frames, hard-cap 2500 ms.
- fix(find & replace): highlight lands on the ACTUAL match now.
  Bug 2026-07-22: search "Corlan" 3/497 -> highlight lands on "since"
  ~13 chars before the real Corlan. Two compounding issues:
    (a) old code searched el.innerText (whitespace-collapsed, CSS-
        transformed) then walked TreeWalker text nodes (raw) to build
        the Range -- any whitespace or transform difference shifted
        boundaries. Fixed by walking ONCE, building the searchable
        string from the same text nodes so search offsets and Range
        offsets reference identical char indices.
    (b) even after (a), a paragraph containing multiple occurrences
        of the needle always got the FIRST hit. Now enumerate all
        occurrences and pick the one CLOSEST to the expected
        position derived from match.start - paraStartInContent.
        Handles both duplicates and residual offset drift from
        markdown emphasis chars stripped by md().
- ui(release modal): payment provider order swapped. "Any vendor
  (recommended)" now the default + first button; Gumroad moved to
  second position. Fresh new releases default to Custom + Auto-
  deliver; existing folios keep whichever provider they were saved
  with. Provider hint copy rewritten to lead with the vendors it
  supports (Ko-fi, Payhip, PayPal, Stripe, Lemon Squeezy) rather
  than the generic "any vendor" abstraction, so authors immediately
  see recognisable brand names.
- feat(deploy script): now runs wrangler deploy for both workers
  after the git push. Graceful skip if wrangler isn't on PATH; per-
  worker skip if that worker's toml isn't present locally
  (email worker's wrangler-email.toml is gitignored because it may
  carry env-specific bindings). A single deploy-script run now
  publishes site + workers together.
- feat(paid-folio help): in-modal walkthrough drawer with per-vendor
  click-by-click setup. "Show me exactly what to do" link opens
  tabbed guides for Ko-fi / Payhip / PayPal — each tells the author
  EXACTLY where to click (Ko-fi's Verification Token under More >
  Account Settings > API/Webhooks, Payhip's Signing Secret under
  Settings > Site Integration > IPN, PayPal's Webhook ID from
  developer.paypal.com after adding a webhook). Written for authors
  not developers — no jargon, "you can't break anything" language,
  explicit "where does this live in the vendor's dashboard" hints.
- feat(spacing): new line-break marker syntax [-N-] renders as N
  blank lines. [-] = 1 line, [--] = 2, [-----] = 5, any N. Bracketed
  so it can't collide with markdown horizontal-rule scene-breaks.
  Paginator budgets N x lineH for the marker; preview renders it
  as a monospace centered spacer at 35% opacity in edit mode, fully
  invisible in reader mode. Closes Thomas's "I want to control the
  space between Psalms" request without needing rich text.
- feat(paid folios — Option C+): full vendor-webhook auto-delivery
  of unlock codes. Owner picks a vendor (Ko-fi, Payhip, or PayPal),
  pastes its webhook secret in the release modal, gets back a per-
  folio webhook URL to paste into the vendor's dashboard. On any
  purchase:
    1. Vendor POSTs to /vendor-webhook/{folioId} on the paywall
       worker with the sale details.
    2. Worker validates the vendor-specific signature (Ko-fi's
       verification_token, Payhip's HMAC-SHA256, PayPal Webhooks V2
       verify-signature endpoint), extracts buyer email + amount +
       order id.
    3. Mints a per-purchase JWT unlock token signed with the
       existing PAYWALL_JWT_SECRET.
    4. Calls the email worker's new /send-unlock endpoint (auth via
       shared X-Internal-Secret) which sends two Resend emails:
         a. Buyer gets a one-click unlock link:
            /app.html?read=<folioId>&pwToken=<jwt> — clicking it
            stores the token in localStorage automatically, no code
            paste, no friction, works on any device.
         b. Owner gets a sale notification with amount + buyer
            email + vendor.
    5. Sale recorded under folio_projects/{id}/paid_sales/{ts_uuid}
       for revenue metrics.
  Vendor config stored in folio_vendor_webhooks/{folioId} —
  worker-only via service account, never exposed to clients (the
  secret would let anyone forge a purchase).
  New client-side URL-token pickup: on reader boot, if ?pwToken=
  is in the URL, decode + verify release matches + stash in
  localStorage + strip from URL bar (so shared URLs don't leak the
  token).
  New env bindings needed on the paywall worker:
    EMAIL_WORKER_URL     = https://folio-email.jacobsiler.workers.dev
    EMAIL_WORKER_SECRET  = <random 32+ char string, same on both>
  And on the email worker:
    INTERNAL_WORKER_SECRET = <same value>
- rule(folio_vendor_webhooks): worker-only (allow r/w if false).
- rule(folio_projects/{id}/paid_sales/{d}): owner + admin read,
  worker-only write.
- ui(mobile round 2): reader bar and editor toolbar tidy-up.
  Reader bar: chapter picker was allowed max-width 220px which on
  a 360px phone consumed most of the row and pushed Aa/notes/audio/
  menu off-screen (Jacob 2026-07-22 screenshot). Now on <=768px:
  chapter picker capped at 130px, title font shrunk + max-width 90px
  with subtitle hidden, all buttons icon-only (Shelf text label
  dropped, Back button collapses to a left-arrow glyph via
  ::before), Tour button hidden entirely (still reachable from the
  menu later), overflow-x:auto as a safety net if anything still
  overflows so nothing becomes unreachable.
  Editor toolbar: the two vertical | dividers now tagged with
  .tb-divider and hidden below 768px so the toolbar wrapping
  reads as natural row breaks rather than cluttered visual noise.
- feat(auth): every non-anonymous sign-in now writes a stub
  folio_user_settings/{uid} doc with lastEmail + lastDisplayName +
  signInAt. Previously the doc was only created when someone saved
  an audio setting or a shelf entry — brand-new signups were
  invisible to the admin /user-list endpoint until they DID
  something. Now every sign-in is instantly trackable + comp-able.
  Merge-write with a stable set of fields so subsequent sign-ins
  refresh lastEmail without stomping other settings.
- feat(user-list): endpoint returns email + displayName so admin
  search can match on either. /admin/press dropdown now filters on
  author name, uid, title, email, and Google display name — paste
  any of them and the right user surfaces.
- feat(user-list): server-side endpoint surfaces unpublished
  signed-in users so /admin/press can comp them before they publish
  and /admin/metrics can track total user growth. New GET /user-list
  ?key=<ADMIN_DEBUG_TOKEN> on the paywall worker lists all
  folio_user_settings via service account (bypasses the LIST rule
  that denies clients), cross-references folio_projects for per-uid
  folio + published counts, and folio_imprint_themes for display
  names + founding-contributor flag. Returns compact JSON sorted
  paid-first, comp-second, published-third, then everyone else.
  /admin/press picks it up and merges those users into the search
  dropdown (labelled "signed in, no folios yet") when the ADMIN_
  DEBUG_TOKEN is cached in localStorage; offers a click-to-paste
  prompt if missing. /admin/metrics adds a "Signed-in users" tile
  in the Content section and switches Revenue buckets to count
  ALL users, not just published ones — so Jacob sees his actual
  growth curve and full subscription-tier distribution.
- feat(editor suggestions): full owner review flow shipped.
  When someone with an editor/collab share link edits the manuscript
  and hits save, their edits divert to
  folio_projects/{id}/suggestions/{their-uid} rather than clobbering
  body/main. Owner sees a new "Reviewer suggestions" panel on the
  Folio tab with:
    - Live badge showing pending-change count across all reviewers
    - Per-reviewer card with name, role, timestamp, and Reject-all
    - Per-chapter row with one-line change summary
      (title/added-N-words/removed-N-words/text-tweaks)
    - "Preview" opens a full side-by-side modal (master left,
      suggested right) with an Accept-this-chapter button
    - "Accept" copies the reviewer's chapter content into your
      master chapters array, saves, and prunes just that chapter
      from the reviewer's suggestion doc (so it stops appearing on
      refresh). Deletes the whole reviewer doc when nothing changed
      remains.
  Firestore rule added for folio_projects/{id}/suggestions/{uid}:
  create/update by suggester (stamped with suggestedByUid); read by
  owner + suggester; delete by owner or suggester.
- feat(events pipeline): full ingestion + rollup infrastructure
  for time-series metrics. Three moving parts landed together:
    1. Paywall worker: POST /event validates + stamps + writes to
       folio_events collection. Attaches server timestamp, Cloudflare
       cf-ipcountry geo, sanitized Referer, and extracts reader uid
       from paywall JWT if present. Kind whitelist (view, chapter_
       open, read_complete, paywall_hit, purchase, tip, boost_click)
       -- unknown kinds rejected. 512-byte meta size cap. Doc id
       prefixed YYYYMMDD_ so rollup queries range by __name__.
    2. Client tracker: window._folioTrack(kind, folioId, extra) in
       app.html. Uses navigator.sendBeacon (or fetch keepalive with
       auth) so it doesn't block page unload. 5-second per-key dedupe
       so scroll storms don't flood. Call sites installed for view
       (reader boot), chapter_open + read_complete (reader chapter
       jump). Purchase / tip / boost_click sites to come via their
       existing success handlers.
    3. Email worker: runMetricsRollup() daily cron pass. Latched
       at folio_metrics_rollup_state/latch so cron cadence is safe;
       rolls up to 3 days per tick. Uses runQuery with __name__
       range on folio_events (no composite index needed). Aggregates
       per folio into folio_projects/{id}/metrics/daily_YYYYMMDD
       docs (views - chapter_opens - chapter_open_by_id map - read_
       completes - paywall_hits - purchases - purchase_amount -
       tips - tip_amount - countries - top-20 referrers - computedAt).
       New GET /metrics-rollup?key=<token>[&day=YYYYMMDD] endpoint
       for manual trigger/backfill.
- rules(folio_events + metrics subcollection):
    folio_events                     -> read/write: if false (worker only)
    folio_projects/{id}/metrics/{d}  -> read: owner OR admin; write: false
- feat(author metrics): sparklines + drop-off + geo + referrers now
  populate from the rollup docs when they exist. 30-day sparkline
  and per-chapter drop-off render for Indie+; top countries + top
  referrers render for Imprint. Rendered as inline SVG / flexbox
  bars -- no Chart.js dependency added to the editor bundle. Falls
  back gracefully to "activates with event tracking" placeholder
  text on days with no rollup data.
- fix(deploy script): "nothing to commit" (all local changes already
  on origin) no longer treated as fatal. Prints a gray note and
  continues to git push in case origin was behind for some reason.
  Real commit failures (with staged/unstaged changes) still abort
  and dump git status --short so you can see what's dirty.
- feat(author metrics): new sidebar tab in the editor next to
  Manuscript / Book / Audio / ☁ Folio. Content varies by Press tier
  per the pricing-page contract:
    Free    -> basic 2×2 grid (Views - Subscribers - Reviews - Annots)
              plus live publish-state pill (Published / Pending
              moderation / Featured Xh left / Adult flag) and gold
              upsell tiles pointing to Indie + Imprint unlocks.
    Indie   -> same basic grid + 30-day sparkline slot + per-chapter
              drop-off slot (both marked "activates with event
              tracking" until Task #18 ships) + Imprint upsell for
              geo + referrers.
    Imprint -> everything unlocked; the two Imprint-only slots (Top
              countries, Top referrers) replace the upsells.
  All counts today are REAL live reads: viewCount from the folio
  doc, subcollection sizes for subscribers + annotations, filtered
  reviews query for review count + avg rating. Reuses window.pressSub()
  as the tier gate (same helper the boost UI uses) so no new
  subscription plumbing.
- feat(admin/metrics): platform dashboard live at /admin/metrics/.
  Three sections shipping today, all using only queries firestore
  rules can prove satisfiable (no unbounded LIST). Content: published
  folio count, unique authors, imprint themes, founding contributors,
  pending shelf moderation, adult-flagged, currently featured, all-
  time viewCount sum. Revenue: buckets published-authors by tier
  (paid Imprint / paid Indie / comped Imprint / comped Indie / free)
  via per-uid getDoc against folio_user_settings -- batched 6
  concurrent. Health: reviews pending vs approved (needs the reviews
  rule update below), last admin digest timestamp. Recent activity:
  8 most recently-published folios with pending/adult/featured
  badges. Follow-up noted inline: subscription counts among
  UNPUBLISHED subscribers need a /subscription-counts endpoint on
  the paywall worker (service account bypasses client rules).
- feat(pricing): revised Indie vs Imprint analytics ladder.
    - Indie now: 30-day view sparkline + per-chapter drop-off
      ("reader engagement" fundamentals).
    - Imprint now: everything Indie plus geo + referrers
      ("marketing analytics" -- where to invest).
  This is a deliberate commitment upsell: Free proves the count,
  Indie proves the engagement pattern, Imprint proves where to
  invest marketing. Copy updated on /press/ tier cards.
- rule(reviews): allow read now includes || isAdmin() so the
  moderation queue + metrics dashboard can list pending reviews
  reliably. Was working incidentally when all reviews happened to
  match the (approvedForDisplay && allowMarketing) clause but broke
  as soon as pending items arrived.
- docs/METRICS_PLAN.md updated with the revised tier gating.
- fix(paginator): FRONT-MATTER and BACK-MATTER now paginate.
  Root cause of Thomas's Introduction cramming everything onto one
  page then getting hidden by the .page-overflowed fade: renderPreview
  had a special-case branch for type=='pre'||'post' that dumped ALL
  paragraphs into a single pageWrap call and returned early -- the
  full paginator (measure + slice + multi-page flow) was chapter-only.
  Routed pre/post through the same paginator; guarded chapter-only
  bits (chapter number, chapter image) behind an isBodyChapter flag
  so front matter still displays without "Chapter N" prefix. The
  overflow watchdog + fade become the last-resort safety net they
  were always meant to be, not the primary "gee this section is long"
  failure mode.
- ui(mobile): editor UI tidy-up per Jacob's phone screenshot.
  Three collisions:
    1. Preview toolbar's 9+ controls overflowed off-screen with no
       visible scroll affordance. Now flex-wraps to 2-3 rows on
       mobile with a 52-px left gutter so the fixed hamburger has
       dedicated space. Zoom slider gets min-width so it doesn't
       collapse to a thumb-with-no-track when other controls wrap
       around it.
    2. On very narrow screens (<480 px) the  Edit and  Preview
       as reader buttons collapse to icon-only via a ::before pseudo
       element (title tooltips preserved).
    3. Book page rendered at 864 px (150 % zoom - Trade 6×9″) is
       wider than a 400-px phone viewport, clipping text off both
       sides. New _mobileAutoFit() fires zoomFit() at boot + on
       resize/orientation change so the page always fits. Belt-and-
       braces: .book-page max-width:calc(100vw-16px) + preview-
       scroller overflow-x:auto so manual override becomes a
       horizontal pan instead of silent clipping.
- ui(sidebar): auto-version snapshots collapsed under a closed
  <details> disclosure by default. Manual " Save version" entries
  render inline as before; auto snapshots go under "Auto-saved
  snapshots (N)" so they stop drowning the panel. Rotates a small ▶
  caret when open. (Jacob 2026-07-21.)
- fix(find & replace): NAVIGATION rewrite -- the previous version
  called scrollToChapter first (which starts a smooth scroll to the
  chapter top) and then queued the paragraph-center scroll 220 ms
  later, so the two animations raced and the browser landed
  somewhere between them. Now for content matches we skip
  scrollToChapter entirely and go straight to the target paragraph
  via native scrollIntoView({block:'center'}) -- that walks the
  ancestor chain and scrolls whichever element is the real overflow
  container (previous manual math targeted #previewScroller which
  has overflow:visible and isn't actually the scroller). Highlight
  overlay flash is delayed to 520 ms so the rects are drawn at the
  paragraph's FINAL screen position rather than pre-scroll. Title
  matches still use scrollToChapter (title block is only anchored
  by [id=chap-<chId>]).
- fix(find & replace): centered highlight on the actual match.
  Previously frJumpToCurrent called scrollToChapter which landed at
  the chapter top with no signal of where in that chapter the word
  actually was. Now we map match.start (raw content offset) to the
  containing paragraph via _paragraphsOf, scroll that paragraph to
  the CENTER of the preview scroller (custom offset math because
  scrollIntoView block:'center' undershoots inside our fixed
  toolbar layout), then flash a fixed-position highlight overlay
  built from Range.getClientRects() on the matched substring --
  no DOM mutation of contenteditable paragraphs. Falls back to a
  full-paragraph outline pulse for title matches or when substring
  ranging fails.
- feat(admin/admins): author search widget now on the Role Management
  page too. Imports _shared.js, wires FolioAdmin.mountAuthorLookup
  into a new roleAuthorLookupSlot right above the Target UID input,
  and picking a suggestion auto-fills both the UID and the Display
  name. Same safe queries as admin/press (published + world-readable
  imprint themes).
- feat(admin/press): plan/comp indicator chip next to every author in
  the search dropdown. After the author list loads, each author's
  folio_user_settings/{uid}.pressSubscription is fetched (single-doc
  reads, no LIST -- safe) and classified into Free / Comp - Tier /
  Paid - Tier / Expired - Tier / Cancelled, with a gold * for founding
  contributors. Batched 6 at a time; live-refreshes the open dropdown
  as chips resolve. So Jacob can spot "already comped" or "already
  paid" before wasting a click, and skip unnecessary grants.
- fix(admin author lookup): the "Loading known authors..." widget was
  running three unfiltered LIST queries against folio_projects,
  folio_imprint_themes, and folio_user_settings. Firestore's rule
  engine cannot short-circuit isAdmin() for unbounded LIST queries,
  so folio_projects and folio_user_settings returned
  `permission-denied` -- and a denied LIST puts the whole Firestore
  SDK into offline mode, which is exactly what surfaced as the
  "client is offline" error blocking the editor after sign-in.
  Diagnosed live via Chrome MCP: `folio_projects` unfiltered ->
  permission-denied; `where('release.published', '==', true)` -> 7
  docs in 208ms. Rewrote both admin/press/_loadAuthorList and
  admin/_shared.js mountAuthorLookup to use only queries the rules
  can prove satisfiable: published-folios filter + world-readable
  folio_imprint_themes. Dropped the folio_user_settings source --
  admins paste UID directly for signed-in-but-unpublished users
  (the input already existed for that path). Added fb.where to the
  helpers passed from admin/boost and to mountAuthorLookup's arg
  validation.
"@
    $msg | Out-File -FilePath $msgPath -Encoding utf8 -NoNewline

    & git commit -F $msgPath
    if ($LASTEXITCODE -ne 0) {
        # Distinguish "nothing to commit" (benign -- everything is already
        # committed and probably already pushed) from a real failure.
        # Real failures leave uncommitted changes in `git status`.
        $porcelain = (& git status --porcelain 2>$null) -join ""
        if ([string]::IsNullOrWhiteSpace($porcelain)) {
            Write-Host "  Nothing new to commit -- working tree already matches HEAD." -ForegroundColor Gray
            Write-Host "  Continuing to push in case origin is behind." -ForegroundColor Gray
        } else {
            Write-Host "git commit failed (exit $LASTEXITCODE)." -ForegroundColor Red
            Write-Host "Uncommitted changes:" -ForegroundColor Yellow
            & git status --short
            Stop-Here $LASTEXITCODE
        }
    }

    & git push
    if ($LASTEXITCODE -ne 0) {
        # 'Everything up-to-date' also returns 0 for push, so a non-zero
        # here is a real failure (network, auth, non-fast-forward, etc.).
        Write-Host "git push failed (exit $LASTEXITCODE)." -ForegroundColor Red
        Stop-Here $LASTEXITCODE
    }

    # -- 6. Cloudflare Workers (paywall + email) ----------------------
    # Deploys BOTH workers after the git push so any code that shipped
    # to GitHub Pages this batch matches the worker code Cloudflare
    # runs. Skipped gracefully if wrangler isn't on PATH; skipped for
    # a specific worker if its wrangler config isn't present locally.
    # ----------------------------------------------------------------
    Write-Host ""
    Write-Host "-- Cloudflare Workers deploy --" -ForegroundColor Cyan
    $wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
    if (-not $wrangler) { $wrangler = Get-Command wrangler.cmd -ErrorAction SilentlyContinue }
    if (-not $wrangler) {
        Write-Host "wrangler CLI not on PATH." -ForegroundColor Yellow
        Write-Host "  Install with:  npm install -g wrangler" -ForegroundColor Yellow
        Write-Host "  Then deploy the workers manually:" -ForegroundColor Yellow
        Write-Host "     wrangler deploy --config wrangler.toml" -ForegroundColor Yellow
        Write-Host "     wrangler deploy --config wrangler-email.toml" -ForegroundColor Yellow
    } else {
        # Paywall worker — always deploy (wrangler.toml is tracked).
        if (Test-Path "wrangler.toml") {
            Write-Host "  wrangler deploy (paywall) ..." -ForegroundColor Cyan
            & $wrangler.Source deploy --config wrangler.toml
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  wrangler deploy (paywall) failed (exit $LASTEXITCODE)." -ForegroundColor Red
                Stop-Here $LASTEXITCODE
            }
        } else {
            Write-Host "  wrangler.toml missing — skipping paywall worker." -ForegroundColor Yellow
        }
        # Email worker — deploy only if its config is present locally.
        # wrangler-email.toml is gitignored (may carry cron triggers +
        # binding hints specific to Jacob's environment), so it's not
        # tracked but it's expected to exist on the dev machine.
        if (Test-Path "wrangler-email.toml") {
            Write-Host "  wrangler deploy (email) ..." -ForegroundColor Cyan
            & $wrangler.Source deploy --config wrangler-email.toml
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  wrangler deploy (email) failed (exit $LASTEXITCODE)." -ForegroundColor Red
                Stop-Here $LASTEXITCODE
            }
        } else {
            Write-Host "  wrangler-email.toml not found locally — skipping email worker." -ForegroundColor Yellow
            Write-Host "  If you meant to deploy it, run:  wrangler deploy --config wrangler-email.toml" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "All deployed. GitHub Pages publishes in ~30-60 seconds." -ForegroundColor Green
    Write-Host "Test at: https://www.onfolio.press/admin/" -ForegroundColor Green
    Stop-Here 0

} catch {
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Stop-Here 1
}
