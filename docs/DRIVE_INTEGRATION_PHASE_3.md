# Google Drive integration — Phase 3

Phase 3 adds four capabilities on top of Phase 2:

1. **`.docx` save-back** — real OOXML files, round-trip editable in Word.
2. **Conflict detection** — won't silently clobber edits made in Docs between Folio saves.
3. **Shared Drives** — Picker now shows Shared Drives alongside My Drive.
4. **Cross-session token persistence** — via a new Cloudflare Worker (`folio-drive-worker.js`) that holds the OAuth client secret and brokers refresh tokens. Without this, authors re-OAuth every browser session; with it, Folio silently re-auths in the background.

Items 1–3 are code-only and already shipped. Item 4 needs a one-time Worker deploy + secret setup — the steps are in the next section.

---

## 4a. Deploy the Drive Worker

The Worker file is `folio-drive-worker.js`; its config is `wrangler-drive.toml`.

Nothing in `wrangler-drive.toml` is a secret — the Firebase project ID and the CORS allow-list are plain `[vars]`. Everything sensitive goes in via Wrangler secrets.

```powershell
# From C:\dev\folio
wrangler secret put GOOGLE_OAUTH_CLIENT_ID     --config wrangler-drive.toml
# Paste: 514858431339-tkv60ka7j8sauhu83h89k14frcr3fsu8.apps.googleusercontent.com

wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --config wrangler-drive.toml
# Paste the client_secret from the JSON you downloaded during Google Cloud setup
# (the file in your Downloads folder titled client_secret_*.apps.googleusercontent.com.json).
# You want the value from the "client_secret" field.

wrangler secret put GCP_SERVICE_ACCOUNT        --config wrangler-drive.toml
# Paste the entire JSON of a service account with the "Cloud Datastore User" role
# on the miscellaneous-117e9 project. The folio-email worker already has an SA
# with this role — you can reuse that same key.

wrangler deploy --config wrangler-drive.toml
```

Deploy prints the Worker URL (something like `https://folio-drive.jacobdsiler.workers.dev`).

## 4b. Wire the URL into `app.html`

Open `app.html`, find the `window.FOLIO_DRIVE_WORKER_URL` constant near the top, and paste the deployed URL:

```html
<script>
  window.FOLIO_DRIVE_CLIENT_ID = '…';
  window.FOLIO_DRIVE_API_KEY   = '…';
  window.FOLIO_DRIVE_WORKER_URL = 'https://folio-drive.jacobdsiler.workers.dev';
</script>
```

Push `app.html`. From the next session onward, `ensureToken()` will try the Worker first and only fall back to the GIS popup if the Worker refuses (no stored refresh token, token revoked, etc.).

## 4c. Deploy the Firestore rules update

`docs/firestore.rules` now has a new block for `folio_drive_tokens/{uid}/accounts/{emailSlug}` — client READ by owner only, client WRITE denied (the Worker writes via its service account, which bypasses client rules).

```powershell
firebase deploy --only firestore:rules
```

## 4d. OAuth consent prompt — offline access

For the Worker flow to actually get a refresh token, the user's FIRST interactive OAuth needs to request offline access. The current `folio-drive.js` uses `prompt: 'consent'` which Google treats as "re-consent + issue a refresh token" — so new connections already receive one. Existing connections won't have a refresh token stored until the user disconnects and reconnects once; `folio-drive.js` falls back to the silent GIS path for those, which also works, just with a per-session re-auth.

This is intentional — no forced re-prompt for users who already granted access, just a graceful upgrade path when they disconnect + reconnect.

---

## 4e. Verify

Open the Settings tab → Google Drive connections → Disconnect your test account → Connect it again. Open the devtools Network tab → trigger a save. You should see:

- One POST to `/exchange` on the Worker (returns `{access_token, expires_in}`)
- One POST to `/store` on the Worker (silent, writes refresh token)
- Subsequent saves in the same session → no `/exchange` call (in-memory cache hits)
- Open a new tab the next day → first save triggers `/exchange` again, no UI

If `/exchange` returns 404 (`no-stored-token`), the user is still on the Phase-2 session-only path — `ensureToken` will fall back to GIS gracefully. Reconnecting the account forces a Worker store.

## 4f. Rotate / revoke

- **Disconnect from Settings** → Worker's `/revoke` endpoint hits Google's revoke URL AND deletes the Firestore row. One-click clean sever.
- **Rotate the client secret** → `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --config wrangler-drive.toml` with the new value, then `wrangler deploy --config wrangler-drive.toml`. No code changes.

---

## What's left (Phase 4?)

- **Live Docs embed inside the Folio editor** so an author can edit the Doc without leaving Folio — real-time co-editing with a collaborator who's in Docs. Needs the full `drive` scope (not `drive.file`), which triggers Google verification. Big lift.
- **Diff-aware merge** when a conflict dialog fires, instead of "overwrite yes/no". Shows the author what changed in Docs so they can pick lines. Uses Drive's revision history.
- **Scheduled background sync** — a Cloud Scheduler job (via the Worker) that keeps the Drive copy up to date without a release action. Needs careful quota + conflict handling.

None of these are planned yet; if they come up, start a new doc.
