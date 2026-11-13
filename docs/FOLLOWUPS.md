# Followups — tracked but not yet scheduled

Running list of known rough edges and planned improvements. When something
here gets scheduled, move it into a dated plan doc (`docs/PLAN_<topic>.md`)
and link it back here. When shipped, delete from this file and note in the
`.deploy-tick`.

---

## folio-email worker CORS allow-list

**Flagged 2026-11-12 during Drive integration smoke test.** Request
from `https://onfolio.press` → `folio-email.jacobdsiler.workers.dev/send-welcome`
was rejected by preflight because the Worker sends
`Access-Control-Allow-Origin: https://www.onfolio.press` as a static
string. Both the apex and `www.` origins need to pass.

Fix: `folio-email-worker.js` — replace the hard-coded origin header with
a check against an allow-list and echo the request origin when it
matches:

```js
const ALLOWED = ['https://onfolio.press', 'https://www.onfolio.press', 'http://localhost:8787'];
const origin = request.headers.get('Origin') || '';
const allow  = ALLOWED.includes(origin) ? origin : ALLOWED[0];
// use `allow` in both the preflight response and the real response
// also include: Vary: Origin
```

Not blocking Drive — Drive uses no cross-origin header of its own. But
`send-welcome` is currently failing silently for every user signing in
on the apex domain, which likely explains any "where's my welcome
email?" reports.

Owner: Jacob + Claude. Priority: high-ish (silent user-visible failure).

## Drive integration — remaining pieces

- **Phase 2a** — ✅ shipped 2026-11-13. Release-modal Save-to-Drive section
  with tier gating, Linked/Copy mode, Doc/Markdown format, per-folio
  file link persisted on `release.driveLink`.
- **Phase 2b** — not yet shipped. Settings tab "Google Drive connections"
  panel: list persisted connections with avatar + email + lastUsedAt,
  Disconnect buttons, tier-gated "+ Connect another account" button
  (free locked to 1, Indie 1, Imprint unlimited). Scaffold in
  `docs/DRIVE_INTEGRATION_PHASE_2.md` section 2b. The release-modal's
  NoConn state already covers the main "I need to connect" case, so
  2b is quality-of-life for authors managing multiple accounts rather
  than blocking.
- **Phase 3**:
  - `.docx` save-back (use the `docx@8.5.0` library already loaded).
  - Cross-session token persistence via a new `folio-drive-worker.js`
    (OAuth refresh token exchange with client secret — the JSON you
    downloaded during Cloud Console setup holds what the Worker needs).
  - Conflict detection: compare Drive's `modifiedTime` against
    `driveLink.lastSyncedAt` before overwriting so edits made in Docs
    between Folio saves don't get silently clobbered.
  - Shared Drive picker (shared Drives, not just My Drive).

## Product mockup quality

**Flagged by Jacob 2026-11-12.** The custom product-mockup generator
produces output that looks like junk — the mockups don't sell the book
visually. Imprint-tier buyers judge Folio partly by what their book
*looks like* in the mockup output, and the current generator is
undermining that.

Likely culprits (not investigated yet):
- Low-res base images for the mockup frames (hardware, paperback, etc.)
- Cover-art placement math — perspective / shadows / lighting look pasted-on
- No depth: single flat layer rather than realistic compositing
- Possibly too many templates, each of mediocre quality — better to have
  3 excellent mockups than 10 mediocre ones

When this is scheduled:
1. Find the mockup-rendering code in `app.html` (grep for `mockup` + the
   product-photos section near line 6491 — Imprint-tier gated).
2. Audit the current output visually against competitors (Vellum, Atticus,
   Reedsy, and the main POD vendors' preview tools).
3. Design pass: pick 3–5 mockup styles that genuinely look professional.
   Prefer static high-quality PNG frames + careful placement math over
   trying to do 3D compositing in the browser.
4. Consider offloading to a Cloudflare Worker that composites via
   something like Sharp / Jimp for higher-quality results if browser
   canvas isn't enough.

Owner: Jacob + Claude pair. Priority: medium (not blocking launch but
hurts Imprint-tier sell).

---

(Add new followups above this line; keep the oldest at the bottom so
the newest stuff is easy to see.)
