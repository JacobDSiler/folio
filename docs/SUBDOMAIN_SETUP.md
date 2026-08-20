# Custom subdomains — Cloudflare setup runbook

**What this enables:** `<slug>.onfolio.press` → resolves to the
imprint page for whoever's claimed `<slug>`. E.g.
`thomas.onfolio.press` loads Thomas's imprint.

**Who needs to do this:** Jacob, once, in the Cloudflare dashboard
(steps below). The code side is done:
  • `folio-subdomain-worker.js` — standalone Worker with wildcard
    routing, deployed via `wrangler-subdomain.toml`.
  • `functions/_middleware.js` — dormant Pages Function fallback,
    unused in the current architecture; kept in case we ever
    consolidate on Pages custom domains (Enterprise plan required).
  • `app.html` Customize Imprint modal has the slug picker.
  • `imprint/index.html` resolves `?slug=` via
    `folio_imprint_slugs/{slug}`.

**Architecture note (2026-08-11 revision):** the ORIGINAL plan used
Cloudflare Pages custom domains with a wildcard `*.onfolio.press`
and a Pages Function for routing. Cloudflare Pages custom domains
REJECT wildcards below Enterprise tier — we hit this during setup.
So the wildcard routing lives on a **standalone Cloudflare Worker**
(`folio-subdomain-worker.js`) with a route matcher on
`*.onfolio.press/*`. The Pages project still hosts the site
(apex + www + all deep paths); the Worker only intercepts subdomain
requests, rewrites `<slug>.onfolio.press/` → `/imprint/?slug=<slug>`
on the Pages origin, and passes everything else through.

**Time estimate:** 60–90 min including SSL propagation wait.

---

## Prerequisite check

- [ ] `onfolio.press` is on Cloudflare DNS. (`dig onfolio.press NS`
      should list Cloudflare's nameservers.)
- [ ] You have owner/admin access to the Cloudflare account holding
      `onfolio.press`.
- [ ] The Folio repo (`C:\dev\folio` → GitHub) is where the app.html
      lives. This becomes the source for Cloudflare Pages too.

If any of the above isn't true, resolve that first — the rest of this
runbook assumes them.

---

## Step 1 — Create the Cloudflare Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages**
   tab → **Connect to Git**.
2. Authorise the GitHub connector if you haven't already.
3. Pick the Folio repo. Branch: `main` (or whichever branch
   `deploy-2026-07-07.ps1` pushes to).
4. Build settings:
   - **Framework preset:** None.
   - **Build command:** (leave blank — the repo is prebuilt HTML)
   - **Build output directory:** `/` (or leave blank).
   - **Root directory:** `/`.
5. Environment variables: none required for the initial deploy. Any
   worker secrets stay on the Cloudflare *Worker* side (paywall,
   email), NOT the Pages project.
6. Click **Save and Deploy**. First deploy takes ~1–2 min.
7. Confirm the site loads at `folio-<something>.pages.dev`. If
   something's broken, fix before adding custom domains — easier to
   debug on the preview URL.

## Step 2 — Add the apex + www as custom domains

1. In the Pages project → **Custom domains** tab → **Set up a domain**.
2. Add `onfolio.press`.
   - Cloudflare will offer to create the DNS record for you (a CNAME
     to `<project>.pages.dev`, proxied through the orange cloud).
     Accept.
   - Wait for SSL cert to issue — usually 30–60 seconds. Status
     changes from "Verifying" → "Active".
3. Add `www.onfolio.press`. Same flow, accept the auto-DNS.
4. In the site's **Redirects** or DNS, ensure `www` redirects to apex
   (or vice-versa — whichever is currently your canonical). Set that
   with a **Bulk Redirect** on the Rules tab if it isn't already.

**Sanity check:** visit `https://onfolio.press`. It should serve the
Pages project. If it's serving the old GitHub Pages content, DNS
propagation may still be catching up (usually < 5 min for Cloudflare
proxied records). Give it up to an hour before troubleshooting.

## Step 3 — Add the wildcard DNS record

Cloudflare Pages can't have `*.onfolio.press` as a custom domain
(Enterprise-only). Instead, DNS is a wildcard record that resolves to
Cloudflare's edge, and a standalone Worker (Step 4) intercepts every
subdomain request.

1. In the Cloudflare dashboard → `onfolio.press` zone → **DNS**.
2. Add a new record:
   - **Type:** `AAAA`
   - **Name:** `*`
   - **IPv6 address:** `100::` (special "black hole" address —
     Cloudflare's documented pattern for Worker-only wildcards; the
     Worker returns its own response so the address is never hit).
   - **Proxy status:** Proxied (orange cloud) — REQUIRED.
   - **TTL:** Auto.
3. Save. Propagation is instant since Cloudflare is authoritative.
4. **SSL:** Cloudflare Universal SSL covers `*.onfolio.press` at
   one depth automatically for proxied wildcard records. No ACM
   purchase needed. Verify at **SSL/TLS → Edge Certificates** —
   Universal SSL certificate hostnames should include
   `*.onfolio.press`. Can take 5–10 min after adding the wildcard
   DNS record to appear on the cert.

## Step 4 — Deploy the subdomain Worker

The Worker code + config are in the repo:
- `folio-subdomain-worker.js` — the routing logic
- `wrangler-subdomain.toml` — deploy config with the wildcard route

Deploy from a terminal in the repo root:

```bash
cd C:\dev\folio
wrangler deploy --config wrangler-subdomain.toml
```

Expected output (line-by-line, roughly):
```
Total Upload: ~4 KiB / gzip: ~2 KiB
Uploaded folio-subdomain (~2 sec)
Deployed folio-subdomain triggers (~0 sec)
  *.onfolio.press/* (zone_id = ...)
```

The route is declared in the toml, so `wrangler deploy` auto-registers
`*.onfolio.press/*` on the onfolio.press zone. Confirm in the dashboard:
Workers & Pages → folio-subdomain → Triggers → Routes should list
`*.onfolio.press/*`.

**Sanity check** (before adding Pages custom domains for apex):
- Visit `https://folio-subdomain.jacobdsiler.workers.dev/` — should
  either return a Worker response or a passthrough proxy response.
- Visit `https://random-slug-that-doesnt-exist.onfolio.press/` —
  should proxy through to Pages and render the imprint page's
  "this subdomain isn't claimed yet" empty state (or a 404 if the
  imprint page hasn't been deployed yet).

The Pages Function `functions/_middleware.js` is dormant in this
architecture (Pages custom domains only cover apex + www, so it
never receives subdomain requests). Leave the file in place — it's
a harmless no-op and provides a fallback path if you ever migrate
to Enterprise + consolidate on Pages custom domains.

## Step 5 — End-to-end test

1. In `app.html`, sign in with an account that has **Imprint tier**
   active (comp yourself via `/admin/press/` if needed).
2. Open **Customize Imprint** modal. Scroll to the "🌐 Custom
   subdomain" section.
3. Enter a slug (e.g. `test-jacob`). Tab out — should say "✓
   Available".
4. Click **Save**. Status line should say "✅ Saved".
5. In a new tab, visit `https://test-jacob.onfolio.press`.
6. **Expected:** the imprint page loads for your uid, with the URL
   still showing `test-jacob.onfolio.press` in the address bar.
7. Console should log `[imprint] slug test-jacob → uid <yourUid>`.

If step 6 shows a 404 or the wrong content:
- Wait 2–3 min (DNS + Cloudflare edge caching).
- Check DevTools Network tab for the request — Cloudflare should
  return a 200 (not a redirect).
- Check the Pages Functions log in the CF dashboard for
  `_middleware.js` invocations. If none, the wildcard DNS or custom
  domain isn't wired correctly — go back to Step 3.

## Step 6 — Retire GitHub Pages

Once Steps 1–5 all work:

1. GitHub repo → Settings → Pages → set source to **None** (or leave
   as-is; it doesn't matter since Cloudflare Pages is now the
   canonical origin).
2. Update `docs/CRITICAL_PATHS.md` (or wherever "hosted on GitHub
   Pages" is documented) to reflect the migration.
3. The `deploy-2026-07-07.ps1` script keeps working — `git push`
   remains the trigger; Cloudflare Pages watches the branch.

---

## Reserved slugs — kept in sync

Two files enforce the reserved-subdomain list:

- **`functions/_middleware.js`** — edge check. A slug in this list
  never gets rewritten; the subdomain falls through to the normal
  routing lane (which will 404 unless there's a real service there).
- **`app.html`** — `_IMPRINT_SLUG_RESERVED` in the slug picker JS.
  Client-side check blocks the user from claiming the slug at all.

**Keep the two lists byte-for-byte identical.** A slug approved by
the picker but rejected at the edge = confused user support ticket.
When adding a new reserved slug (e.g. launching `api.onfolio.press`
as a real service), update BOTH files in the same commit.

---

## Later (Option C — BYO custom domain)

Jacob's follow-on plan: authors point their own domain
(`books.jacobsiler.com`) at Folio via CNAME. That flow is separate:

1. Author enters their domain in Customize Imprint.
2. We add it as a custom domain on the Pages project (via the CF
   API — automatable).
3. Author points a CNAME from their DNS to our Pages hostname.
4. Cloudflare auto-issues SSL via Universal.
5. Middleware needs a second lookup path: `books.jacobsiler.com` →
   folio_imprint_custom_domains → uid.

Not built. Log the intent in `docs/PERPETUAL_TIER_PLAN.md` or its
own doc when the time comes.

---

## Cost summary

- Cloudflare Pages: **free** (100k requests/day, more than enough).
- Universal SSL: **free**.
- Wildcard SSL: **free if included** in Pages custom-domain flow,
  else **$10/month** for Advanced Certificate Manager.
- DNS: **free** (Cloudflare DNS is always free).
- Bandwidth: **free** (Cloudflare Pages has no bandwidth cap).

**Total ongoing cost:** **$0/month** if wildcard SSL is included,
**$10/month** if ACM is required. Compare to Vercel/Netlify wildcard
hosting: ~$20+/month.

---

## Log

- 2026-08-11 — Runbook drafted. Middleware + Firestore rules +
  app-side slug picker shipped in the same commit. Cloudflare-side
  setup awaits Jacob.
