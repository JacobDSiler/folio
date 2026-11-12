# Google Drive integration — one-time setup

This is a **one-time Google Cloud Console setup** you do before Drive
integration (`folio-drive.js`) will work in production. Takes ~10 minutes.

Nothing in this doc is a secret; the resulting Client ID and API Key are
designed for browser use. Just paste them into the two `window.FOLIO_DRIVE_*`
constants in `app.html` when you're done.

---

## 1. Pick your Google Cloud project

Use the same project your Firebase app already lives in
(**miscellaneous-117e9**). Shared project = shared OAuth consent screen =
fewer prompts for users who already granted Folio sign-in.

Open **https://console.cloud.google.com/** and switch the project picker
to that one.

## 2. Enable the two APIs you need

**APIs & Services → Library**, then enable:

1. **Google Drive API**
2. **Google Picker API**

Both are free at Folio's scale. Picker has no separate quota; Drive has
generous per-user limits that we're nowhere near.

## 3. OAuth consent screen — add the Drive scope

**APIs & Services → OAuth consent screen**:

- User type: **External** (same as your Firebase auth).
- Scopes → **Add or remove scopes** → find and tick
  `https://www.googleapis.com/auth/drive.file`.
  (**Not** `drive` — `drive.file` is the narrow scope that only grants
  access to files the user explicitly picks via the Google Picker. It
  does not require Google verification and gives users a clear privacy
  story. See the comment at the top of `folio-drive.js`.)
- Save. You do not need to go through app verification for `drive.file`.

## 4. OAuth 2.0 Client ID (web)

**APIs & Services → Credentials → Create credentials → OAuth client ID**:

- Application type: **Web application**
- Name: `Folio Drive (web)`
- **Authorized JavaScript origins**:
  - `https://onfolio.press`
  - `https://www.onfolio.press`
  - `http://localhost:8787` (or wherever you dev locally)
- **Authorized redirect URIs**: leave empty. We use the GIS token flow,
  which does not require redirect URIs.

Hit Create, copy the **Client ID**. It looks like
`123456789-xxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`.

## 5. API Key

**APIs & Services → Credentials → Create credentials → API key**:

- Name: `Folio Drive (browser)`
- After creation, click **Restrict key**:
  - **Application restrictions**: HTTP referrers → add
    `https://onfolio.press/*`, `https://www.onfolio.press/*`,
    `http://localhost:8787/*`.
  - **API restrictions**: restrict to **Google Drive API** and
    **Google Picker API** only.
- Save. Copy the API key.

## 6. Wire the keys into Folio

Open `app.html`, near the top of the `<head>` (just before the existing
`<script src="https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js">`
line), add:

```html
<script>
  window.FOLIO_DRIVE_CLIENT_ID = '123456789-xxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com';
  window.FOLIO_DRIVE_API_KEY   = 'AIza...';
</script>
<script src="/folio-drive.js" defer></script>
```

Deploy. That's it.

---

## How to verify

1. Open the editor in a browser, sign into Folio normally.
2. Open the devtools console and run:
   ```js
   FolioDrive.configured   // → true
   await FolioDrive.connect({})   // → opens Google chooser; pick an account
   await FolioDrive.listActiveConnections()   // → shows your account
   ```
3. If `configured` is false, the two `window.*` constants didn't land.
4. If `connect()` throws "popup blocked", the user has popups blocked
   for your site — real users on first use will see the browser's own
   popup-blocker UI.

## Tier gating sanity check

```js
FolioDrive.canImportOnce()       // true for everyone
FolioDrive.canLink()             // true only on Indie / Imprint
FolioDrive.canConnectMultiple()  // true only on Imprint
FolioDrive.tier()                // 'free' | 'indie' | 'imprint'
```

Those helpers read `window.pressSub()` — the same tier source every
other paid feature in Folio uses. No separate source of truth.

## Firestore model (for reference)

Per-user connection list (identity only, never tokens):
```
folio_user_settings/{uid}.driveConnections[]
  { email, displayName, picture, connectedAt, lastUsedAt }
```

Per-folio Drive link (set by the Save-to-Drive flow in Phase 2):
```
folio_projects/{id}.release.driveLink
  { accountEmail, fileId, fileName, format, mode, lastSyncedAt }
     format: 'gdoc' | 'md' | 'docx'
     mode:   'linked' (overwrite same file)
           | 'copy'   (snapshot-on-command)
```

The Firestore rules (`docs/firestore.rules`) already allow owners to
read/write their own `folio_user_settings` and `folio_projects` docs,
so no rules change is needed for Drive integration.

## What happens on sign-out

Session tokens are in-memory only, so closing the tab drops them. On
next session, Folio sees the persisted connection email and does a
silent re-auth against Google's cookie session — if the user is still
signed into that Google account in the browser, it's a no-UI flash.
If not, they get a sign-in prompt.

## Follow-up: "Stay connected across sessions"

The v1 session-only model means users re-auth once per browser session.
That's acceptable but not ideal for authors who live in the editor. A
Phase 3 pass would add a new Cloudflare Worker (`folio-drive-worker.js`)
that holds the OAuth client secret and exchanges refresh tokens so
tokens survive across sessions. The module is already shaped to accept
that: `ensureToken()` would get a backend-fetch path, everything else
stays the same.
