# Folio — Canonical Feature Register

**Purpose.** A single source of truth for every user- or admin-facing feature Folio has. Any time you touch a file that owns a feature listed here, verify the feature still works before the deploy tick. If you're about to delete or move a DOM anchor or function that's listed here, that's a regression risk — pause and check.

**Convention.** Path + rough function name or DOM anchor lets a future refactor grep back to the right place. Rules-file line numbers are as of 2026-09-09; grep the collection name if the numbers drift.

**Last audited:** 2026-09-09.

---

## 1. Writing & Editing (the studio)

### Manuscript editor (preview mode)
Live-rendered book preview that updates as you type in sidebar fields. Main authoring surface.
Files: `C:\dev\folio\app.html` — `renderPreview()` ~L17518, `#previewArea`, `#previewScroller`
Backing: `folio_projects/{id}` doc

### Writing mode (distraction-free)
Full-screen chapter-focused writing pane with word count, dingbat bar, in-place title, keyboard shortcuts.
Files: `app.html` — `openWritingMode()` L19674, `#writingMode`, `#writingArea`, `#writingDingbar`, `_writingAreaKeydown()`
Backing: same `folio_projects/{id}`

### Chapter list (drag-reorder, typed rows)
Ordered chapters with pre/ch/post/toc badges, per-chapter reorder & rename.
Files: `app.html` — `renderChapterList()` L14265, `addBlankChapter()`, `removeChapter()`, `toggleChapterLock()`
Backing: `folio_projects/{id}.chapters[]`

### Auto-generated Table of Contents
Chapter-type "toc" renders a live-computed TOC inside the manuscript.
Files: `app.html` — `getTOC()` L16004, `chapterNumber()`, `.chip-toc`

### Front / back matter (dedication, copyright, epigraph, colophon)
Structured pre- and post-matter fields wired into preview and export.
Files: `app.html` — `#dedication`, `#copyright` L7054-7061, `_serialise()` L10653

### Manuscript ingest (docx / txt / md / rtf import)
Drop or pick single/batch documents; the app splits them into chapters.
Files: `app.html` — `handleFileImport()` L13038, `detectChapterLine()`, `previewAutoDetect()`, `applyImportToChapters()`, `#msInput`. Uses `docx` UMD bundle loaded at L119.

### Split-editor chapter reconciliation
Side-by-side view for reviewing auto-detected chapter splits before commit.
Files: `app.html` — `renderSplitEditor()` L13728, `exitSplitEditor()`, `buildImportList()`

### Version history / snapshots
Named save-point versions per folio; list, restore, delete.
Files: `app.html` — `saveVersion()` L11238, `_loadVersionList()`, `_restoreVersion()`, `_deleteVersion()`
Backing: `folio_projects/{id}/versions/{vid}`

### Backup / recovery dialog
Local backup recovery when Firestore state disagrees with cached local state.
Files: `app.html` — `_openBackupRecoveryDialog()` L9834

### Find & Replace
Cross-chapter regex-aware search with preview centering + flash highlight.
Files: `app.html` — `openFindReplace()` L20804, `_frCenterMatchInPreview()`, `_frFlashHighlight()`

### Autosave
Debounced background write of the current folio state.
Files: `app.html` — `_scheduleAutoSave()` L9240

### Series / saga assignment
Per-folio series name + number and umbrella saga name.
Files: `app.html` — `#seriesNum` L7068, series/saga fields in sidebar; shelf/imprint pages read them.
Backing: `folio_projects/{id}.series`, `.saga`

### Characters & pronunciation
Character register with voice assignments; per-word pronunciation library.
Files: `app.html` — `#charSection`, `#charModal`, `_ctxOpenCharacterModal()` L14386, `_charExportCSV()`, `_charImportCSV()`, `_pronExportCSV()`, `_pronImportCSV()`, `#pronModal`
Backing: `folio_projects/{id}/characters/{charId}`

### Dialogue selection / assignment
Right-click a passage of dialogue → assign to a character (drives TTS voice + analytics).
Files: `app.html` — `_ctxFindDialogueInText()` L21452, `_ctxIsSelectedTextDialogue()`, `_ctxSelectDialogue()`

### Bookmarks (author sidebar)
Chapter-scoped bookmarks pane in the sidebar.
Files: `app.html` — `#bmPanel` L7582, `#bmFloatBtn`

### Annotations & suggestions (author-side)
Reader-submitted margin notes and typo suggestions surface for the author to accept/reject.
Files: `app.html` — `#annPanel` L7599, `_sugRenderReviewerCard()`, `_sugPreview()`
Backing: `folio_projects/{id}/annotations/{aid}`, `folio_projects/{id}/suggestions/{suggesterUid}`

### Presence (live collaborator badges)
Shows which invited editors/readers are currently viewing the folio.
Files: `app.html` — `_subscribePresence()` L12276
Backing: `folio_projects/{id}/presence/{uid}`

### Chapter-level lock / word-count stats
Per-chapter lock toggle + stats panel.
Files: `app.html` — `toggleChapterLock()` L14319, `updateChapterStats()` L15543, `#pageStatsInfoBtn`

### Custom schema editor
Advanced modal to edit the folio's structured schema.
Files: `app.html` — `openSchemaModal()` L13012, `saveSchema()`, `#schemaModal`

---

## 2. Cover & Book Design

### Theme picker (imprint styles)
Preset visual themes for the book interior.
Files: `app.html` — `THEMES` array, `selectTheme()` L16024, `buildThemeGrid()`

### Accent color + ornament picker
Palette + dingbat/ornament chooser used across covers, chapter breaks.
Files: `app.html` — `selectAccent()` L16025, `selectOrn()` L16026, `#writingOrnBtns`

### Cover image manager
Upload / arrange / reorder cover and interior images.
Files: `app.html` — `renderImgList()`, `removeImg()` L16284, `_imgRefreshCover()` L16314, `_imgPrefetchForExport()`

### Chapter-image drag-swap
Drag images between chapters/paragraphs.
Files: `app.html` — `_imgSwapMarkers()` L16631

### Font settings + preview
Body/heading font pickers with live preview.
Files: `app.html` — `_updateFontPreview()` L22123, `_updateFontSizeHint()`

### Drop cap toggle
Automatic drop-cap at each chapter opening.
Files: `app.html` — `#dropCap` L7133

### Cover position controls
Positioning of title/author over cover art.
Files: `app.html` — `#coverPos` L7368

### QR code generator
Generates a QR code linking to the folio's public URL.
Files: `app.html` — `openQR()` L12484, `#qrModal`

---

## 3. Export & Delivery

### Multi-format export (EPUB, DOCX, PDF, TXT)
Primary export drawer with per-format downloaders.
Files: `app.html` — `toggleExportDrawer()` L17330, `runPrimaryExport()`, `pickExport()`

### Per-chapter export menu
Export a single chapter.
Files: `app.html` — `showChapterExportMenu()` L18355, `#writingExportBtn`

### Manuscript view / clean readout
Full-document rendered view for review or copying.
Files: `app.html` — `openManuscriptView()` L19804

### Print-on-Demand (Lulu integration)
Send the finalized book to Lulu for print fulfilment.
Files: `app.html` — `openPOD()` L20244, `openLuluModal()` L20337, `_lmBuildCoverLinks()`, `_lmSaveJob()`, `#podPanel`, `#luluModal`
Worker: `C:\dev\folio\folio-publish-lulu-worker.js` — `POST /job`, `GET /cost`, `GET /token`, `GET /debug`
Backing: `lulu_jobs/{jobId}`

### Placeholder cover generator
Renders a fallback cover for POD when the user hasn't uploaded one.
Files: `app.html` — `_generatePlaceholderCover()` L20741

### KDP importer
Pulls a book's structure/metadata from a KDP export.
Files: `app.html` (referenced); endpoint `POST /kdp-import` in `folio-paywall-worker.js` L5063

---

## 4. Publishing & Release

### Release modal
The unified "put this book out" dialog: metadata, pricing, cadence, entry points, classifications.
Files: `app.html` — `openReleaseModal()` L24152, `#releasePanel` L36393
Backing: `folio_projects/{id}.release`

### Release attestation
Owner attests to authorship / rights before release.
Files: `app.html` — `#rlAttestationSection`, `#rlAttestStatus`

### Content classification & tagging
Primary + secondary classifications, tag suggestions, adult-content flag.
Files: `app.html` — `#rlClassifyPrimary`, `#rlClassifySecondaries`, `#rlClassifyTags`, `#rlClassifySuggest`, `#rlContentRatingSection`, `#rlHasAdultContent`

### Release CTA / description / entry point
Author-facing CTA blurb, description, "start here" entry point.
Files: `app.html` — `#rlCtaLabel`, `#rlCtaBlurb`, `#rlDescField`, `#rlEntryPoint`, `#rlAuthorField`

### Custom-fields on the sale page
Extra fields (dedication note, personalization) at checkout.
Files: `app.html` — `#rlCustomFields`

### Bonus content attachments
Uploaded files or links delivered to buyers as bonuses.
Files: `app.html` — `#rlBonusForm`, `#rlBonusesList`, `_rlAddBonus`, `#rlAddBonusBtn`

### Audio bundle attachment
Bundle a pre-recorded audiobook with the paid folio.
Files: `app.html` — `#rlAudioBundle`

### Serial cadence engine
Time-gated chapter unlock schedule (drip release).
Files: `app.html` — `_serialCadenceMs()` L22941, `_serialAutoReleasedCount()`, `_serialReleasedCount()`, `_serialMsUntilUnlock()`, `_serialUnlockDate()`, `_serialFormatCountdown()`, `_serialReleaseNextChapter()` L23531, `_serialPreviewUpcoming()`

### Serial dashboard line
Sidebar row summarizing the serial state.
Files: `app.html` — `#serialDashboardLine` L7524

### Auto-release next chapter
Automated tick that unlocks the next serial chapter when its window opens.
Files: `app.html` — `_serialReleaseNextChapter()` L23531

### Disable export of unpurchased content
Toggle preventing anonymous readers from exporting the paid portion.
Files: `app.html` — `#rlDisableUnpurchasedExport`

### Slug reservation (short URL)
Human-readable `/f/<slug>` short link for a released folio.
Files: `app.html` slug fields; `folio-share-worker.js` L507 `/f/<slug>` route
Backing: `folio_slugs/{slug}`

### Signed teaser links
Signed short URL for a free preview.
Files: `folio-share-worker.js` L550 `/s/<token>`; paywall worker `POST /sign-share`, `GET /signed-teaser-content`, `GET /teaser-content`
Backing: `folio_projects/{id}/signed_teasers/{tokenId}`

---

## 5. Paywall & Monetization

### Buy / paywall flow
Public reader hits paywall, pays through a configured vendor, gets a signed license JWT.
Worker: `folio-paywall-worker.js` — `POST /verify`, `GET|POST /check`, `POST /verify-code`, `GET /paid-content`

### Payment providers — Ko-fi, Payhip, PayPal
Per-vendor webhooks that translate a payment into a license.
Worker endpoints: `POST /kofi-webhook`, `POST /payhip-webhook`, `POST /paypal-webhook`, `POST /paypal-create-order`, `POST /paypal-capture-order`, `GET /paypal-native-config`
Backing: `folio_vendor_webhooks/{folioId}`, `folio_vendor_owner_configs/{ownerUid}`

### Per-author vendor configuration
Author connects their own Ko-fi/Payhip/PayPal.
Worker: `POST /vendor-config`, `POST /vendor-owner-config`, `GET /vendor-owner-config`
UI: `app.html` release-panel help tabs `#rlHelpTabKofi/Payhip/Paypal`, `#rlAutoVendor`, `#rlAutoSecret`, `#rlAutoWebhookUrl`

### Pricing / currency
Price + currency selector on release.
Files: `app.html` — `#rlCurrency`, price fields in release panel

### Gumroad legacy fields
Legacy payment-link fallback.
Files: `app.html` — `#rlGumroadFields`

### Promo codes / discounts
Codes that unlock discounted or free access.
Admin UI: `C:\dev\folio\admin\promos\index.html`
Worker: `POST /verify-code`
Backing: `folio_promos/{code}`, `folio_promo_redemptions/{subscriptionId}`

### Paid sales ledger
Per-folio ledger of paid sales.
Backing: `folio_projects/{id}/paid_sales/{saleId}`

### Tip jar
Reader-side tip to author, independent of paywall.
Files: `app.html` — `#rdTipSection`
Backing: `folio_users_public/{uid}/tips/{tipId}`

### Migrate anonymous account to Google
Preserve purchases when an anon reader signs in.
Worker: `POST /migrate-anon-to-google`

---

## 6. Reader Experience

### Public reader (read view)
The published-folio reading UI.
Files: `app.html` — `#previewArea`, `#readerBar` L36061, `_editorPreviewAsReader()` L19517

### Reader toolbar
Bookmarks, annotations, audio, tips, pronunciation, boost, buy, menu buttons.
Files: `app.html` — `#rdBmBtn`, `#rdAnBtn`, `#rdAudioBtn`, `#rdPronBtn`, `#rdTipSection`, `#rdBoostSection`, `#rdBuyBtn`, `#rdMenuBtn`

### Reader annotations & highlights
Readers leave notes/highlights on paragraphs.
Backing: `folio_projects/{id}/annotations/{aid}`

### Reader review submission
Submit a starred review of a folio.
Worker: `POST /review-submit`
Backing: `reviews/{reviewId}`

### Reader-preview from editor
Author toggle to see their book exactly as a reader would.
Files: `app.html` — `#readerPreviewBtn`, `_editorPreviewAsReader()` L19517

### View tracking
Records a read/view event.
Worker: `POST /view-record`, `POST /event`
Backing: `folio_events/{eventId}`, `folio_projects/{id}/metrics/{doc}`

### Dark mode
Reader-side dark theme toggle.
Files: `app.html` — `#darkModeBtn`

---

## 7. Audio / TTS

### Audio production panel
Per-chapter generate → segment → stitch → download workflow.
Files: `app.html` — `openAudioPanel()` L35195, `#audioPanel` L35734, `#apSegmentsSection`, `#apGenAllLinesBtn`, `#apFinalizeChapterBtn`, `#apStitchedChapterSection`

### Voice assignment (per character)
Assign a Google/ElevenLabs voice to a character (drives dialogue TTS).
Files: `app.html` — `_charPopulateVoiceDropdown()` L14587, `_charFilterVoiceDropdown()`, `_charAssignTestVoice()`
Worker: `folio-tts-worker.js` — `POST /google`, `POST /elevenlabs`, `GET /voices/google`, `GET /voices/elevenlabs`

### TTS test-speak
Try a voice on a snippet before committing.
Files: `app.html` — `_ttsTestSpeak()` L15000, `_ttsTestPlay()`

### Pronunciation library
User-defined pronunciation overrides used by TTS.
Files: `app.html` — `#pronSection`, `#pronModal`, `_pronExportCSV()`, `_pronImportCSV()`

### Audio segment modal
Fine-tune / re-render an individual audio segment.
Files: `app.html` — `#audioSegModal` L35844

---

## 8. Subscribers & Email

### Subscriber list per folio
Readers subscribe for new-chapter notifications.
Files: `app.html` — `_rlSubscribersRefresh()` L23124, `_rlSubscribersRenderList()`, `_rlSubscribersToggleList()`, `_rlSubscribersExport()`, `_rlSubscribersTestWebhook()`
Backing: `folio_projects/{id}/subscribers/{sid}`

### New-chapter email
Automated email when a serial chapter unlocks.
Files: `app.html` — `_sendNewChapterEmail()` L23410, `_subNotifyAuthor()` L23236
Worker: `folio-email-worker.js` `POST /send`, `POST /notify-subscriber-signup`

### Unsubscribe flow (service-account)
Tokenized unsubscribe URL that goes through the worker with elevated IAM.
Files: `app.html` — `_subUnsubscribeUrl()` L23395, `_subUnsubscribeByToken()`, `_subUnsubscribeBoot()`
Worker: `GET|POST /unsubscribe`

### Cron mail runner
Scheduled catch-up run of pending emails.
Worker: `GET /cron-run`

### Welcome email
Sent to new signups.
Worker: `POST /send-welcome`

### Test-mail endpoint
Diagnostic single-send test.
Worker: `GET /test`

---

## 9. Imprint & Author Identity

### Author imprint page (public)
Per-author public shelf at `/imprint/?uid=…` (or `<slug>.onfolio.press`), showing their released folios.
Files: `C:\dev\folio\imprint\index.html`
Backing: `folio_imprint_themes/{uid}`, folios queried by `release.published==true`

### Imprint theme customizer
Author picks accent / bg / font / wallpaper / hero / tagline / bio / links for their imprint page.
Files: `imprint/index.html` — Customize drawer (`#customizeDrawer`, `_cdSave()` L1339), auto-opens on `?customize=1`
Backing: `folio_imprint_themes/{uid}`

### Custom imprint slug (subdomain / vanity URL)
Reserve a slug for `<slug>.onfolio.press`. Atomic runTransaction claim (creates new + deletes old), reserved-list guard, live availability status.
Files: `imprint/index.html` — `#cdSlugInput`, `#cdSlugSaveBtn`, `_cdLoadSlug()`, `_cdSaveSlug()`
Backing: `folio_imprint_slugs/{slug}`
Worker: `folio-subdomain-worker.js` routes `<slug>` subdomain to imprint

---

## 10. Discovery — The Shelf

### Public shelf page
Browsable grid of published folios and series.
Files: `C:\dev\folio\shelf.html` — `#shelfGrid`, `#shelfFeaturedGrid`, `#shelfBrowseSeriesBtn`
Backing: `folio_projects` where `release.listOnShelf==true`

### Shelf moderation queue
Admin approves/rejects listings before they appear publicly.
Files: `C:\dev\folio\admin\shelf\index.html`

### Featured / boosted listings (paid promotion)
Author pays to get their folio featured for a period.
Files: `app.html` — `#rlBoostButtonsRow`, `#rlFeaturedSection`, `#rlBoostScarcity`, `#rlBoostStatus`
Worker: `POST /boost-checkout`, `GET /boost-return`, `POST /boost-webhook`, `GET /boost-slots`
Admin: `C:\dev\folio\admin\boost\index.html`
Backing: `folio_projects/{id}.release.featuredUntil`

### Sitemap
Machine-readable index of public folios.
Worker: `folio-share-worker.js` — `GET /sitemap.xml`

### Author-facing shelves (private organization)
User's own shelves to organize their WIP folios.
Files: `app.html` — `_createShelf()`, `_renameShelf()`, `_deleteShelf()`, `_setFolioShelf()`, `_shelfMenu()`, `_toggleShelfCollapsed()`, `_renderShelfBlock()` L11128-11362

---

## 11. Share / Editor Invites / Collaboration

### Share link generator
Signed public share URL for a folio.
Files: `app.html` — `_rlGetSignedLink()` L12428, `copyShareEmail()` L12459, `#shareLinkBox`, `#shareLinkText`
Worker: `folio-share-worker.js` (root); paywall `POST /sign-share`

### Role-based invite links (reader / beta / editor)
Different roles give different write-scopes on a shared folio.
Files: `app.html` — `_inviteRole()` L12353, `_inviteURL()`, `_updateInviteUI()`, `copyInviteLink()` L12451, `_quickInvite()` L12471, `#inviteArea` L7638

### Signed teasers (free preview URLs)
Short-lived signed URL exposing a preview slice.
Worker: `POST /sign-share`, `GET /signed-teaser-content`, `GET /teaser-content`

---

## 12. Guild — Community & Marketplace

### Guild landing
Public entry to the community of authors, editors, and service pros.
Files: `C:\dev\folio\guild\index.html`

### Guild directory
Author + pro profiles (self-published). Pen-name pre-fill from Folio identity; author's published folios display as cover thumbnails on the card.
Files: `guild/index.html` — `#dirList`, `#meForm`
Backing: `folio_guild_directory/{uid}`

### Author swaps (peer review / trade)
Authors trade reads/edits.
Files: `guild/index.html` — `#swapsList`, `#saveSwapBtn`
Backing: `folio_guild_swaps/{swapId}`, `folio_guild_swaps/{id}/replies/{replyId}`
Worker: `folio-email-worker.js` `POST /send-author-swap-reply`

### Guild moderation
Admin queue for guild content.
Files: `C:\dev\folio\admin\guild\index.html`

### Guild seal / branding
The Guild's dedicated wax-seal favicon + header badge.
Files: `guild/seal.svg`, `guild/index.html` favicon + hero mark

### Service-pros landing
Marketing page for editors/cover designers/narrators.
Files: `C:\dev\folio\for\service-pros\index.html`

### Serials landing
Marketing page for serial-fiction writers.
Files: `C:\dev\folio\for\serials\index.html`

### Serials guide
Long-form author guide (tiers, cadence, providers).
Files: `C:\dev\folio\serials-guide.html`

---

## 13. Folio Press (pro subscription)

### Press landing + pitch
The pro subscription offer page.
Files: `C:\dev\folio\press\index.html`

### Press subscribe / checkout
Paid signup for pro tier.
Worker: `POST /press-subscribe`, `GET /press-return`, `POST /press-webhook`, `GET /press-status`

### Press-photo purchases (asset store)
Buy licensed cover art from the Folio Press library.
Files: `C:\dev\folio\press\photos\`
Worker: `POST /photo-checkout`, `GET /photo-return`, `GET /photo-status`
Backing: `folio_photo_purchases/{captureId}`

### Press-photo import
Import purchased assets into a folio's cover.
Files: `C:\dev\folio\press\import\index.html`

### Press subscription comp (admin)
Grant / revoke pro comp subscriptions.
Files: `C:\dev\folio\admin\press\index.html`

---

## 14. Affiliates

### Affiliate dashboard (self-serve)
Authors + partners see their affiliations, clicks, sales, payouts.
Files: `C:\dev\folio\affiliate\index.html`

### Affiliate invite / accept
Author invites a partner; partner accepts.
Files: `app.html` — `#affInviteSection`, `#affListSection`, `#affInviteBtn`, `#affRefreshBtn`, `#affExportBtn`
Worker: `POST /affiliates/invite`, `POST /affiliates/accept`, `GET /affiliates/list`, `GET /affiliates/mine`, `POST /affiliates/edit-rate`, `POST /affiliates/pause|resume|remove`, `POST /affiliates/materialize`, `POST /affiliates/settle`, `GET /affiliates/ping`
Backing: `folio_affiliations/{affiliationId}`, `folio_affiliate_attributions/{attributionId}`, `folio_affiliate_clicks/{clickId}`, `folio_affiliate_settlements/{settlementId}`

### Affiliate click tracking
Landing-link tracker that stamps attribution before checkout.
Worker: `folio-share-worker.js` — `POST /aff-materialize`

### Affiliate emails
First-sale + payment-received transactional emails.
Worker: `folio-email-worker.js` — `POST /send-affiliate-invite`, `POST /send-affiliate-first-sale`, `POST /send-affiliate-payment-received`

---

## 15. Reviews

### Public review submission
Star-rated review on a released folio.
Worker: `POST /review-submit`
Backing: `reviews/{reviewId}`

### Review moderation queue
Admin approves / rejects pending reviews.
Files: `C:\dev\folio\admin\reviews\index.html`

---

## 16. Support

### Support form (reader/author)
Contact-support submission.
Files: `C:\dev\folio\support\index.html`
Worker: `POST /support-submit`
Backing: `folio_support_tickets/{ticketId}`

### Admin ticket queue
Admin lists / replies / resolves tickets.
Files: `C:\dev\folio\admin\support\index.html`
Worker: `GET /support-list`, `POST /support-reply`, `POST /support-resolve`; emails via `folio-email-worker.js` `POST /send-support-ticket-created`, `POST /send-support-reply`

### Help center
Static help + FAQ page.
Files: `C:\dev\folio\help\index.html`, `C:\dev\folio\help\tutorials\`

### Tutorial workshop
Interactive/scripted tutorials.
Files: `C:\dev\folio\tutorial-workshop\`

---

## 17. Admin & Moderation

### Admin console home
Landing router for admin surfaces.
Files: `C:\dev\folio\admin\index.html`

### Role management
Grant admin / moderator roles.
Files: `C:\dev\folio\admin\admins\index.html`
Backing: `folio_roles/{uid}`

### User directory + broadcast messaging
List users, compose targeted messages.
Files: `C:\dev\folio\admin\users\index.html`
Backing: `folio_admin_messages/{messageId}`, `folio_admin_digest_state/{doc}`
Worker: `GET /user-list`, `GET /admin/user-lookup`

### Platform metrics dashboard
Tier time-series + funnel dropoff.
Files: `C:\dev\folio\admin\metrics\index.html`, `app.html` — `_mxLoadTimeSeries()` L12851, `_mxRenderDropoff()`

### Boost fulfilment
Manually feature a paid listing.
Files: `C:\dev\folio\admin\boost\index.html`

### Promos & discounts management
Create / bulk-import promo codes.
Files: `C:\dev\folio\admin\promos\index.html`

### Shelf moderation
Approve public shelf listings; contact author.
Files: `C:\dev\folio\admin\shelf\index.html`

### Guild moderation
Same for guild content.
Files: `C:\dev\folio\admin\guild\index.html`

### Content policy page
Public policy + reporting flow.
Files: `C:\dev\folio\policy\index.html`

---

## 18. Ink integration (symbiotic sibling app)

### Announce in Ink handoff
Post-publish button on the release success screen: opens Ink with a base64-encoded blob of {title, author, blurb, cover, readerUrl} for a launch newsletter.
Files: `app.html` L26944 (`ink_folio=` URL construction), `#rlUrlBox` `_rlAnnounceInInk` handler
Ink side: `C:\dev\ink\index.html` — `#folioHandoff` banner + receiver script

### Ink launcher in header
Explicit "open in Ink" affordance in the studio.
Files: `app.html` L7965

---

## 19. Auth & Account

### Sign-in pill (Google / anonymous)
Header auth indicator with mode + name + photo.
Files: `app.html` — `_renderAuthPill()` L8725

### Anonymous → Google account merge
Preserves purchases and folios when converting an anon session.
Worker: `POST /migrate-anon-to-google`

### Per-user settings
User preferences store.
Backing: `folio_user_settings/{uid}`

### Author public profile
Author-scoped public docs (for tips, pro handles).
Backing: `authors/{uid}` (Ink block), `folio_users_public/{uid}`

---

## 20. Static / Marketing / Policy

### Welcome / homepage
Marketing homepage.
Files: `C:\dev\folio\index.html`, `C:\dev\folio\Folio - Welcome.html`

### Terms + Privacy
Legal pages.
Files: `C:\dev\folio\terms.html`, `C:\dev\folio\privacy.html`

### 404 page
Custom not-found.
Files: `C:\dev\folio\404.html`

### API keys guide
Author-facing doc on connecting external providers.
Files: `C:\dev\folio\api-keys-guide.html`

### Android app landing / brief
The TWA / Android packaging surface.
Files: `C:\dev\folio\folio-android-brief_1.html`, `app-release-signed.apk`, `twa-manifest.json`, `build.gradle`

### PWA manifest + service worker
Offline / installable web app.
Files: `C:\dev\folio\manifest.json`, `C:\dev\folio\sw.js`

---

## 21. Infrastructure / DX

### Subdomain router
`<slug>.onfolio.press` → imprint / folio.
Worker: `C:\dev\folio\folio-subdomain-worker.js`

### Short-URL router (`/f/`, `/s/`)
Slugged folio + signed-teaser routing.
Worker: `C:\dev\folio\folio-share-worker.js` — `/f/<slug>`, `/s/<token>`

### Env-check / health endpoints
Ops probes.
Worker: `folio-paywall-worker.js` `GET /env-check`, `GET /` root banner
Also `folio-tts-worker.js`, `folio-email-worker.js`, `folio-publish-lulu-worker.js` root banners

### Firestore rules bundle
Single-source rules shared with Boxes + Ink. **Never delete another app's block.** See top of `docs/CRITICAL_PATHS.md`.
Files: `C:\dev\folio\docs\firestore.rules`

---

**Total: ~110 distinct user- or admin-facing features across 21 categories.**

If a feature disappears from the app but is still listed here, that's a regression — file paths above tell you where it lived.
