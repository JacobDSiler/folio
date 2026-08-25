# Affiliate program — end-to-end pilot test

**Purpose:** walk the whole affiliate loop before you invite Ken for real. Catches any surprises now rather than in front of him.

**You'll need:** two Google accounts (owner + affiliate — your alt email works fine), one Folio you own with paid release turned on and a sensible price ($4 works for testing), and about 20 minutes.

---

## 0. Pre-flight checklist

Before the pilot, confirm:

- [ ] **Firestore rules published.** Last `folio push` should show `+ firestore: released rules docs/firestore.rules to cloud.firestore`. If unsure, run again.
- [ ] **Paywall + email + share workers all deployed** (`Uploaded folio-paywall`, `Uploaded folio-email` in the deploy log).
- [ ] **Affiliate routes are live.** Hit `https://folio-paywall.jacobdsiler.workers.dev/affiliates/ping` in a browser — should return `{"ok":true,"affiliateRoutesDeployed":true,...}`. If it 404s, redeploy the paywall (`wrangler deploy`).
- [ ] **`EMAIL_WORKER` service binding is present.** Should be in `wrangler.toml` under `[[services]]` — it is. If the email calls fail silently, check the binding didn't get removed on redeploy.
- [ ] **You have a Folio with paid release turned on** — Ko-fi or PayPal-native, doesn't matter which for testing, but the test purchase will go through whichever is configured.

---

## 1. Invite yourself

1. Open the editor for the test Folio. Click **Ship** → **🤝 Affiliates**.
2. Enter your alt email (or a friend's — you'll need access to the inbox).
3. Set commission to **25%**.
4. Note: "Pilot test — remove after." Click **Send invite**.
5. Confirm the ledger row appears with status **invited** and the "Cancel invite" action.

**Expected:** the alt email inbox receives an email titled `<your primary email> invited you to sell "<book>" as an affiliate` — big gold `25%`, green Accept button.

**If no email arrives** — check the folio-email worker logs (`wrangler tail folio-email`). Common causes: `RESEND_API_KEY` missing, `FROM_EMAIL` not verified on Resend, or the send hit the 60/hr rate limit.

---

## 2. Accept as the affiliate

1. Open the invite email in your alt inbox.
2. Click **Accept invite** — lands on `https://onfolio.press/affiliate/`.
3. If not signed in, click **Sign in with Google** and use the alt account.
4. Confirm the "New invites" section shows the pending invite with the folio, rate, and note.
5. Click **Accept invite** on that card.

**Expected:** the invite card moves to "Your affiliate folios" with status **Active**. Copyable link + QR code appear. Stats all show `$0.00`.

**If it says "This invite was sent to a different email"** — your Google account email doesn't match the invite. Sign out, sign back in with the right one.

---

## 3. Set payout handles

Still on `/affiliate/`, scroll to **Payout handles**. Enter a test Ko-fi username (or your real one) and PayPal.me handle. Click **Save handles**. Confirm the green "Saved." message.

---

## 4. Click your affiliate link

1. Copy the affiliate link from your dashboard (looks like `https://onfolio.press/s/proj_.../?a=xY3kQ2Ab`).
2. **Open it in an incognito window** (fresh session — critical, otherwise your existing cookies muddle the test).
3. It should redirect to `app.html?read=...` — the reader loads.
4. Open browser DevTools → Application → Cookies → `onfolio.press`. You should see a `folio_aff_proj_...` cookie with the affiliate code as its value, 30-day expiry.

**Expected:** the cookie is set. The URL in the address bar is clean (no `?a=` — it was stripped after cookie capture).

**If no cookie is set** — either the share worker didn't redeploy, or the `?a=CODE` was invalid. Check the URL you copied — the code should match your dashboard.

---

## 5. Sign in as buyer

Still in the incognito window, click **Sign in with Google** and use a THIRD email (not the owner, not the affiliate — otherwise the self-purchase guard blocks attribution). If you don't have a third Google account, ask a friend to hit the link and complete a $0 test purchase.

Once signed in, the reader will fire `/affiliates/materialize` in the background. To confirm it worked, check the network tab for a POST to `/affiliates/materialize` returning `{"ok":true,"attributed":true,"firstTouch":true}`.

---

## 6. Test purchase

Complete the paid-release purchase in the incognito window. If you're using Ko-fi, use a real card (you'll refund it after). If PayPal-native, use PayPal Sandbox credentials if configured, otherwise a real account.

**Expected:**
1. Purchase completes, reader unlocks.
2. Within a few seconds, back in the **owner** editor → **Ship › Affiliates**, the affiliate's row now shows:
   - Sold: `$4.00` (or whatever the price)
   - Earned: `$1.00` (25% of $4)
   - Pending: `$1.00`
3. The alt email inbox receives a **first-sale email** titled `Your first sale — you earned $1.00`.
4. Re-test with a second purchase (different buyer email) — ledger updates but no second first-sale email fires (dedupe via `firstSaleEmailedAt` on the affiliation doc).

**If ledger doesn't update** — the sale record probably didn't get attribution. Check the `paid_sales` collection in Firestore for the new document; look for `affiliationId` field. If null, either the buyer's email doesn't match the attribution doc, or the attribution doc doesn't exist.

**If the first-sale email arrives twice** — the dedupe latch didn't stick. Check the affiliation doc; `firstSaleEmailedAt` should be a timestamp after the first sale.

---

## 7. Settle up

1. Back in the owner editor → **Ship › Affiliates**, click **Pay $1.00** on the affiliate row.
2. Modal opens with amount pre-filled to $1.00.
3. Enter the affiliate's Ko-fi username in the handle field.
4. Click **Open Ko-fi ↗** — Ko-fi opens in a new tab with the amount pre-filled. Send a real $1 tip to yourself (you'll refund).
5. Back in the modal, add a reference note like "Pilot test — Aug 2026". Click **Mark as sent**.

**Expected:**
1. Modal closes; ledger updates: Pending drops to $0, Settled shows $1.00.
2. Alt email inbox receives a **payment-received email** titled `Payment sent: $1.00 via Ko-fi`.
3. In the affiliate dashboard, the folio card shows Settled: $1.00.

---

## 8. Cleanup

1. Refund the Ko-fi tip if you sent one (Ko-fi allows this within 30 days).
2. Refund the paid-release purchase from your vendor dashboard.
3. Back in the owner editor → Ship › Affiliates → **Remove** the alt-email affiliation. Confirm the double-confirm prompt.
4. Check that the affiliate row now shows as "removed" (or disappears — either is acceptable). The affiliate dashboard still shows the folio card in a paused/removed state so the history is preserved.

---

## Debug endpoints

If anything breaks, these help pinpoint where:

- `GET /affiliates/ping` — 200 if routes deployed
- `GET /env-check?key=<ADMIN_DEBUG_TOKEN>` — shows which env vars are set
- `GET /affiliates/list?folio=X` (Bearer owner token) — raw ledger dump
- `GET /affiliates/mine` (Bearer affiliate token) — raw affiliation dump
- Firestore console → `folio_affiliations`, `folio_affiliate_attributions`, `folio_affiliate_settlements` — raw docs
- `wrangler tail folio-paywall` — live logs
- `wrangler tail folio-email` — live logs

---

## Once the pilot works

Send Ken:

1. The link to `/affiliate/` and a note that he'll get an invite email.
2. Send the invite from the Ship › Affiliates panel with his email.
3. Point him at `docs/AFFILIATE_TERMS.md` as the plain-language agreement.
4. Once he accepts and sees his link + QR, he's ready to share.

For his first month or two, check the Ship › Affiliates panel weekly. Settle promptly — trust compounds. If a payment method or country creates friction (his connections may prefer WeChat Pay or Alipay, not Ko-fi), we'll add that in Phase 2.
