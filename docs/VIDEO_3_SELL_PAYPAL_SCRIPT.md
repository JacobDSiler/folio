# Video 3 — "Sell your book on Folio — 0% commission" (PayPal Native)

**Target length:** 3:00 (matches tutorials page).
**Tier:** 1 — MONETIZATION.
**Audience:** An author who's already published once (free) and now wants to charge for a book.
**Primary purpose:** Convert free users into monetizing authors AND showcase the 0% commission promise.

---

## Verified flow (pilot-checked on live site 2026-10-14)

1. In Folio, open the sidebar and click **🔌 Vendor connections** (visible only when the author has at least one paid folio — if filming on a fresh account, Jacob will temporarily enable it or Radi will have one paid folio pre-set).

   **Alternative discovery path:** In the Release modal, when the author picks **💳 Paid** access and selects PayPal Native as the vendor, a status card appears pointing at the Vendor Connections modal — "Open Vendor connections" button is the same `_vcOpen()` function.

2. The modal lists vendors in order of recommendation:
   - **PayPal (native checkout)** — badged "Recommended". Two fields: `PayPal Client ID` (text, public — the clientId is embedded in the Buttons SDK on the reader page) and `PayPal Client Secret` (password, write-only). Both come from `developer.paypal.com` after creating a REST API app on a PayPal Business account.
   - **Ko-fi** — Verification token from Ko-fi Settings → API/Webhooks.
   - **Payhip** — IPN signing secret from Payhip Settings → Site Integration → IPN.

3. Save the PayPal credentials. Status flips to "✓ Connected. Every folio you release via PayPal Native uses this connection." One connection covers every paid folio on the author's account.

4. Back in the folio editor, click toolbar **🔖 Release**. In the Access row, click **💳 Paid**.

5. Set Price (now immediately above the vendor sub-fields per the T1-4 audit fix) and Currency.

6. Vendor picker defaults to PayPal Native (shown as a compact status card with a link to Vendor Connections — if credentials are already in place, this just confirms the connection).

7. Set Free preview sections (how many sections readers get before the paywall — default 1).

8. Fill the usual release metadata (description, shelf, rating, attestation).

9. Click **🔖 Release**.

10. On the reader page, when a reader hits the paywall, the PayPal Buttons SDK renders inline. Reader never leaves Folio. Payment lands in the author's PayPal Business account; the unlock JWT is minted automatically; reader-side access unlocks immediately.

**Important copy present on screen:** The release modal's PayPal Native fields block includes: *"PayPal (native checkout) renders the PayPal buttons directly on your paywall — buyer never leaves Folio, payment lands in your PayPal Business account."* Radi should echo this.

---

## Pre-production notes for Radi

- **Account:** Jacob will provide a PayPal Business sandbox account's Client ID + Secret. **Do not** show live credentials on screen — Radi should blur the ID and never show the Secret at all (it's write-only in the UI, so this is enforced by Folio, but the paste action itself is sensitive).
- **Folio with a paid-eligible release:** Jacob will pre-create a sample folio with real content so Radi can walk through the Paid access flow without having to write a manuscript on-camera.
- **Reader-side demo:** On the reader page, open in an incognito window (fresh user) to show the paywall from a buyer's perspective. Click the PayPal button, use the sandbox buyer account (Jacob will provide), complete the test payment, show the unlock happening live.
- **Blur:** Client ID is public but Radi should blur any dashboard URL or account name that would identify Jacob's PayPal account to viewers.
- **Palette:** matches Videos 1 & 2.

---

## Voiceover script (3:00 at ~145wpm)

> *(0:00)* Folio takes zero commission on every sale. Zero. Not 10%, not 3% — zero. Here's how to set up paid folios.
>
> *(0:15)* First-time setup. Open **Vendor connections** in the sidebar — this is where you connect your PayPal account to Folio. It's a one-time thing; after this, every paid book you release uses this connection.
>
> *(0:35)* PayPal is the recommended path. The buttons render directly on your folio's paywall — buyers never leave Folio. Payment lands in your PayPal Business account.
>
> *(0:52)* You'll need two things from PayPal's developer site: your Client ID and your Client Secret. Both come from a REST API app you create on developer.paypal.com. Paste them in here. Hit Save.
>
> *(1:15)* Connected. That's done forever. Now any folio you want to sell.
>
> *(1:22)* Open the folio you want to charge for. Hit **🔖 Release**. In the Access row, pick **💳 Paid**. Set your price — let's say five dollars. Pick a currency.
>
> *(1:48)* Decide how many chapters readers get for free before the paywall. One section is a good default — enough for them to decide if they want the rest.
>
> *(2:05)* Fill the usual bits — description, tick the Shelf if you want it discoverable, pick a rating, confirm you've got the rights. Hit Release.
>
> *(2:25)* Here's your folio in the reader view. See how the PayPal buttons render right here, inline? Reader clicks, pays through PayPal — never leaves Folio. The moment the payment clears, the paywall unlocks for them, automatically. No email codes, no copy-paste.
>
> *(2:48)* Every cent of that five dollars, minus whatever PayPal charges, lands in your account. Folio sees none of it. **onfolio.press — free, forever. Zero commission, always.**

---

## Shots (4 of them)

### Shot 1 — Hook + Vendor Connections open (0:00–0:35)
**Screen:** Open the editor on a folio. Cursor goes to the sidebar's **🔌 Vendor connections** button (zoom in slightly on the button so viewers can find it). Click. Modal opens showing PayPal (native checkout) at top with the "Recommended" badge.
**Callouts:**
- At 0:03, bottom-third banner: **0% commission. Always.**
- At 0:25, highlight the sidebar button: *"One-time setup — covers every paid folio."*
- At 0:30, highlight the Recommended badge on PayPal: *"Recommended — buyer stays on Folio."*

### Shot 2 — PayPal credentials paste + save (0:35–1:22)
**Screen:** Click into the Client ID field, paste the sandbox Client ID (visible but blurred in post). Click into the Secret field, paste (field is masked by design). Click **Save** on the PayPal section. Status line flips to "✓ Connected. Every folio you release via PayPal Native uses this connection."
**Callouts:**
- At 0:58, overlay a URL callout: **developer.paypal.com** (small, bottom-right)
- At 1:08, label the Client ID field: *"Public — safe to show in your paywall."*
- At 1:12, label the Secret field: *"Write-only — Folio never shows it back to you after save."*
- At 1:18, highlight the "Connected" status: *"That's it. One connection, every book."*

### Shot 3 — Release flow — set to Paid (1:22–2:25)
**Screen:** Close Vendor Connections. Open any folio with content. Click toolbar **🔖 Release**. Modal opens with the audit-corrected field order (Title → Author → Access → Description). Click **💳 Paid** in the Access row — the paid-fields block reveals itself below. Scroll to Price → type `5.00`. Currency stays USD. Scroll past the (collapsed) auto-deliver walkthrough. Set Free preview sections to `1`. Scroll down — tick Shelf, pick rating, tick attestation. Click **🔖 Release**.
**Callouts:**
- At 1:35, highlight the **💳 Paid** access button: *"Switches on the vendor + price fields."*
- At 1:50, highlight Price + Currency: *"Price lives right where you'd expect — above the vendor-specific help."*
- At 2:00, highlight Free preview sections: *"How many chapters readers get before the paywall."*
- At 2:18, highlight the Release button inside the modal: *"Same label everywhere — one word, one action."*

### Shot 4 — Reader-side demo (2:25–3:00)
**Screen:** Open the released folio's reader URL in an incognito window. Scroll past the free preview — the paywall card appears with the PayPal Buttons rendered inline. Click the yellow PayPal button → PayPal checkout appears (modal-style, still inside Folio) → authorise with the sandbox buyer account → return to Folio → paywall gate dissolves and the full book is unlocked.
**Callouts:**
- At 2:32, highlight the inline PayPal buttons: *"Buyer never leaves Folio."*
- At 2:46, highlight the dissolve: *"Unlock is automatic — no code, no email."*
- At 2:55, bottom-centre overlay: **onfolio.press — 0% commission, always.**

---

## End-card (5 seconds)

Cream background. Big: **0%**. Below: *Folio's commission on your sales — always has been, always will be.* Below that: `onfolio.press`.

---

## Notes on messaging / what to be careful about

**"Zero commission" vs PayPal fees** — the voiceover is explicit: *"Every cent of that five dollars, minus whatever PayPal charges, lands in your account. Folio sees none of it."* This is honest. PayPal takes their own standard fee (typically ~2.9% + fixed per transaction, varies by country). Folio takes nothing on top. Don't let the final cut imply the author pockets 100% of the retail — that's PayPal's fee, not Folio's cut.

**Sandbox vs production** — the Client ID / Secret shown on-screen MUST be a PayPal **sandbox** app's credentials, not production. The sandbox buyer flow is identical to production for demo purposes.

**Credential handling** — Jacob provides the sandbox credentials via a secure channel (not the Fiverr chat). Radi pastes them live but blurs the Client ID in post-production. The Secret is masked by Folio's UI so it's never shown.

**PayPal Business requirement** — the voiceover says *"Payment lands in your PayPal Business account."* This is true: PayPal Native needs a Business account (free to upgrade from Personal). Worth having that line because it's a prerequisite viewers will otherwise discover when they try to set it up themselves.

**Alternate vendors** — the video uses PayPal because it's recommended and the inline-checkout UX is dramatic on video. Ko-fi and Payhip are also supported (visible in the Vendor Connections modal). A future tutorial could cover those as alternatives; this one keeps it to the single recommended path.
