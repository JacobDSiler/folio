/* ══════════════════════════════════════════════════════════════════════
   FOLIO ↔ GOOGLE DRIVE  (folio-drive.js)
   ══════════════════════════════════════════════════════════════════════

   Purpose
   -------
   Browser-side Google Drive integration for Folio. Session-only tokens,
   multi-account support, Google Picker for file selection. Zero backend
   required for v1.

   Tier policy (three-way split, locked in 2026-11-12)
   ---------------------------------------------------
                                           Free   Indie   Imprint
      Import once from Drive (read-only)   ✅     ✅       ✅
      Linked folio ↔ Drive file (two-way)  —      ✅       ✅
      Multiple connected Drive accounts    —      —        ✅

   Scopes
   ------
   drive.file — grants access ONLY to files the user picks via the
   Google Picker or that Folio creates. Avoids the OAuth-verification
   burden of broader drive scope and gives users a strong privacy story
   ("Folio only sees files you explicitly hand it").

   Token model (v1)
   ---------------
   Session-only. We hold access tokens in memory; they expire after ~1h.
   Re-auth is silent for the same account if the Google session is still
   live. A follow-up pass can add a Cloudflare Worker that proxies
   refresh-token exchange for a cross-session "Stay connected" option
   (that was option 2 in the design brief — deferred, not forgotten).

   Account IDENTITY is persisted to folio_user_settings/{uid}.
   driveConnections[]. TOKENS ARE NEVER PERSISTED. Each browser session
   does a silent re-prompt against the stored email hint; if the user is
   signed into that Google account in their browser, it's a no-UI flash.

   Configuration — set these on window BEFORE this script loads:
     window.FOLIO_DRIVE_CLIENT_ID = '<your-oauth2-client-id>.apps.googleusercontent.com';
     window.FOLIO_DRIVE_API_KEY   = '<your-api-key>';

   See docs/GOOGLE_DRIVE_SETUP.md for the Google Cloud Console steps.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ────────── Configuration ──────────
  // Project number is the leading digits of the OAuth Client ID (e.g.
  // '514858431339' in '514858431339-xxxxx.apps.googleusercontent.com').
  // Picker MUST be built with this as appId so the drive.file grant it
  // creates is recognized by subsequent Drive API calls from the same
  // project — otherwise files.get / files.export return 403 even on
  // user-picked files. See bug fix 2026-11-12 (first real import attempt).
  const _clientId = (typeof window !== 'undefined' && window.FOLIO_DRIVE_CLIENT_ID) || '';
  const _derivedProject = _clientId.split('-')[0] || '';
  const CFG = {
    CLIENT_ID:      _clientId,
    API_KEY:        (typeof window !== 'undefined' && window.FOLIO_DRIVE_API_KEY) || '',
    PROJECT_NUMBER: (typeof window !== 'undefined' && window.FOLIO_DRIVE_PROJECT_NUMBER) || _derivedProject,
    SCOPES:         'https://www.googleapis.com/auth/drive.file',
    DISCOVERY:      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  };

  const MIME = {
    GDOC: 'application/vnd.google-apps.document',
    DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    MD:   'text/markdown',
    MD_X: 'text/x-markdown',
    TXT:  'text/plain',
    HTML: 'text/html',
  };

  // ────────── Session state ──────────
  // email → { email, name, picture, token, expiresAt, tokenClient }
  const sessionConnections = Object.create(null);
  let _initPromise = null;

  // ────────── Event bus ──────────
  const _listeners = new Set();
  function onChange(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
  function _notifyChange() {
    for (const cb of _listeners) {
      try { cb(); } catch (e) { console.warn('[FolioDrive] listener threw', e); }
    }
  }

  // ────────── Script loader ──────────
  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  // ────────── Init (lazy; first call that needs Google loads it) ──────────
  function _ensureInit() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      if (!CFG.CLIENT_ID || !CFG.API_KEY) {
        throw new Error(
          'Google Drive integration not configured. ' +
          'Set window.FOLIO_DRIVE_CLIENT_ID and window.FOLIO_DRIVE_API_KEY. ' +
          'See docs/GOOGLE_DRIVE_SETUP.md.'
        );
      }
      // Google API client (for Picker + Drive REST discovery)
      await _loadScript('https://apis.google.com/js/api.js');
      await new Promise(r => gapi.load('client:picker', r));
      await gapi.client.init({ apiKey: CFG.API_KEY, discoveryDocs: [CFG.DISCOVERY] });
      // Google Identity Services (for OAuth token flow)
      await _loadScript('https://accounts.google.com/gsi/client');
    })().catch(err => { _initPromise = null; throw err; });
    return _initPromise;
  }

  // ────────── Connect / re-auth a Drive account ──────────
  // Opens Google's chooser. If hintEmail given, pre-selects that account.
  async function connect({ hintEmail = '', silent = false } = {}) {
    await _ensureInit();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CFG.CLIENT_ID,
        scope: CFG.SCOPES,
        hint: hintEmail || undefined,
        prompt: silent ? '' : 'consent',
        callback: async (resp) => {
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          try {
            const uinfo = await fetch(
              'https://www.googleapis.com/oauth2/v3/userinfo',
              { headers: { Authorization: `Bearer ${resp.access_token}` } }
            ).then(r => r.json());
            const email = uinfo.email;
            if (!email) return reject(new Error('Could not read account email'));
            sessionConnections[email] = {
              email,
              name: uinfo.name || email,
              picture: uinfo.picture || '',
              token: resp.access_token,
              expiresAt: Date.now() + ((resp.expires_in || 3600) * 1000) - 60_000,
            };
            await _persistConnection(email, uinfo);
            _notifyChange();
            resolve(sessionConnections[email]);
          } catch (e) { reject(e); }
        },
        error_callback: (err) => reject(new Error(err && err.type ? err.type : 'OAuth cancelled')),
      });
      client.requestAccessToken({ prompt: silent ? '' : 'consent' });
    });
  }

  // Returns a valid access token for `email`, re-authing silently if expired.
  async function ensureToken(email) {
    const c = sessionConnections[email];
    if (c && c.token && c.expiresAt > Date.now()) return c.token;
    // Silent re-auth (uses cookies from current browser session with Google)
    try {
      const fresh = await connect({ hintEmail: email, silent: true });
      return fresh.token;
    } catch (e) {
      // Fall back to interactive prompt
      const fresh = await connect({ hintEmail: email, silent: false });
      return fresh.token;
    }
  }

  // ────────── Pick a file via Google Picker ──────────
  // mimeTypes: comma-separated string, or null for default (Docs + .docx + text/md)
  async function pickFile(email, { mimeTypes, title } = {}) {
    await _ensureInit();
    const token = await ensureToken(email);
    const types = mimeTypes || [MIME.GDOC, MIME.DOCX, MIME.MD, MIME.TXT].join(',');
    return new Promise((resolve, reject) => {
      try {
        const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setIncludeFolders(false)
          .setSelectFolderEnabled(false)
          .setMimeTypes(types);
        const builder = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(CFG.API_KEY)
          .setTitle(title || 'Pick a manuscript');
        // CRITICAL for drive.file scope: appId must match the OAuth client's
        // project number so the Picker's implicit drive.file grant is
        // recognized by subsequent Drive API calls. Without this you get
        // 403 on files.get / files.export even for files the user just picked.
        if (CFG.PROJECT_NUMBER) builder.setAppId(CFG.PROJECT_NUMBER);
        console.log('[FolioDrive] Opening Picker with appId=' + CFG.PROJECT_NUMBER +
                    ', apiKey=' + CFG.API_KEY.slice(0, 10) + '…');
        const picker = builder
          .setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) {
              const d = data.docs && data.docs[0];
              if (!d) return resolve(null);
              resolve({
                id: d.id,
                name: d.name,
                mimeType: d.mimeType,
                url: d.url || '',
                sizeBytes: d.sizeBytes || 0,
              });
            } else if (data.action === google.picker.Action.CANCEL) {
              resolve(null);
            }
          })
          .build();
        picker.setVisible(true);
      } catch (e) { reject(e); }
    });
  }

  // ────────── Import file contents ──────────
  // Returns { bytes?, text?, html?, format, fileId, mimeType, name }
  async function importFile(email, fileRef) {
    const token = await ensureToken(email);
    const fileId = fileRef.id || fileRef;
    const mimeType = fileRef.mimeType || '';
    const h = { Authorization: `Bearer ${token}` };

    if (mimeType === MIME.GDOC) {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text%2Fhtml`,
        { headers: h }
      );
      if (!r.ok) throw new Error('Drive export failed: ' + r.status);
      return { html: await r.text(), format: 'gdoc', fileId, mimeType, name: fileRef.name };
    }

    if (mimeType === MIME.DOCX) {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: h }
      );
      if (!r.ok) throw new Error('Drive download failed: ' + r.status);
      return { bytes: await r.arrayBuffer(), format: 'docx', fileId, mimeType, name: fileRef.name };
    }

    // Plain text / markdown / anything else text-like
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: h }
    );
    if (!r.ok) throw new Error('Drive download failed: ' + r.status);
    const text = await r.text();
    const format = (mimeType === MIME.MD || mimeType === MIME.MD_X ||
                    (fileRef.name || '').toLowerCase().endsWith('.md')) ? 'md' : 'txt';
    return { text, format, fileId, mimeType, name: fileRef.name };
  }

  // ────────── Save/update file contents ──────────
  // If fileId is given → PATCH that file (keeps it in place).
  // If fileId is null → POST a new file.
  // format: 'gdoc' | 'md' | 'txt' | 'html'
  //   ('docx' save is deferred — client-side .docx generation needs a bundled
  //    builder lib. Use 'gdoc' or 'md' for v1 save-back.)
  async function saveFile(email, { fileId = null, name, content, format = 'gdoc' }) {
    const token = await ensureToken(email);

    if (format === 'docx') {
      throw new Error(
        'Saving back as .docx is coming in a follow-up. ' +
        'For now, pick Google Doc or Markdown as the Drive format.'
      );
    }

    let uploadMime, body;
    if (format === 'gdoc') {
      uploadMime = MIME.HTML;         // upload as HTML
      body = String(content || '');    // Drive converts HTML → Google Doc
    } else if (format === 'md') {
      uploadMime = MIME.MD;
      body = String(content || '');
    } else if (format === 'txt') {
      uploadMime = MIME.TXT;
      body = String(content || '');
    } else if (format === 'html') {
      uploadMime = MIME.HTML;
      body = String(content || '');
    } else {
      throw new Error('Unknown save format: ' + format);
    }

    const metadata = { name: name || 'Untitled' };
    if (format === 'gdoc' && !fileId) metadata.mimeType = MIME.GDOC;

    const boundary = 'folio_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const multipart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${uploadMime}\r\n\r\n` +
      body + `\r\n--${boundary}--`;

    const base = 'https://www.googleapis.com/upload/drive/v3/files';
    const url = fileId
      ? `${base}/${fileId}?uploadType=multipart&supportsAllDrives=true`
      : `${base}?uploadType=multipart&supportsAllDrives=true`;
    const method = fileId ? 'PATCH' : 'POST';

    const r = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    });
    if (!r.ok) throw new Error('Drive save failed: ' + r.status + ' ' + (await r.text()));
    const result = await r.json();

    // Mark this connection as freshly used (for sort-order in the UI)
    _touchConnection(email).catch(() => {});

    return result;
  }

  // ────────── Firestore persistence (account IDENTITY only, never tokens) ──
  async function _persistConnection(email, uinfo) {
    if (!window._db || !window._fb || !window._uid) return;
    const ref = window._fb.doc(window._db, 'folio_user_settings', window._uid);
    const snap = await window._fb.getDoc(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const existing = Array.isArray(data.driveConnections) ? data.driveConnections : [];
    const prior = existing.find(c => c.email === email);
    const others = existing.filter(c => c.email !== email);
    const next = {
      email,
      displayName: (uinfo && uinfo.name) || email,
      picture: (uinfo && uinfo.picture) || '',
      connectedAt: (prior && prior.connectedAt) || Date.now(),
      lastUsedAt: Date.now(),
    };
    await window._fb.setDoc(ref, { driveConnections: [...others, next] }, { merge: true });
  }

  async function _touchConnection(email) {
    if (!window._db || !window._fb || !window._uid) return;
    const list = await listPersistedConnections();
    const next = list.map(c => c.email === email ? { ...c, lastUsedAt: Date.now() } : c);
    const ref = window._fb.doc(window._db, 'folio_user_settings', window._uid);
    await window._fb.setDoc(ref, { driveConnections: next }, { merge: true });
  }

  async function listPersistedConnections() {
    if (!window._db || !window._fb || !window._uid) return [];
    const ref = window._fb.doc(window._db, 'folio_user_settings', window._uid);
    const snap = await window._fb.getDoc(ref);
    return snap.exists() ? (snap.data().driveConnections || []) : [];
  }

  async function disconnectAccount(email) {
    delete sessionConnections[email];
    if (window._db && window._fb && window._uid) {
      const list = await listPersistedConnections();
      const next = list.filter(c => c.email !== email);
      const ref = window._fb.doc(window._db, 'folio_user_settings', window._uid);
      await window._fb.setDoc(ref, { driveConnections: next }, { merge: true });
    }
    // Revoke the token server-side too so the OAuth grant goes away.
    // (Best-effort — we might not have a session token right now.)
    try {
      if (google && google.accounts && google.accounts.oauth2 && sessionConnections[email]) {
        google.accounts.oauth2.revoke(sessionConnections[email].token, () => {});
      }
    } catch (_) {}
    _notifyChange();
  }

  function listActiveConnections() {
    return Object.values(sessionConnections).map(c => ({
      email: c.email, name: c.name, picture: c.picture, expiresAt: c.expiresAt,
    }));
  }

  // ────────── Tier gating helpers ──────────
  // Mirrors the pattern established in app.html (see _mxRefresh — uses window.pressSub()).
  function _tier() {
    try {
      const sub = (typeof window.pressSub === 'function') ? window.pressSub() : null;
      if (sub && sub.active) return String(sub.tier || '').toLowerCase();
    } catch (_) {}
    return 'free';
  }
  function canImportOnce() { return true; }                 // free+: import-only
  function canLink()       { const t = _tier(); return t === 'indie' || t === 'imprint'; }
  function canConnectMultiple() { return _tier() === 'imprint'; }
  function tier() { return _tier(); }

  // ────────── Convenience: import-once UX ──────────
  // Opens picker for the user's primary Google account (or first connected),
  // or asks them to connect if none. Returns the imported file payload.
  async function importOnce({ hintEmail, mimeTypes, title } = {}) {
    await _ensureInit();
    let email = hintEmail;
    if (!email) {
      // Use first already-connected session account, else the first persisted
      const active = listActiveConnections();
      if (active.length) email = active[0].email;
      else {
        const persisted = await listPersistedConnections();
        if (persisted.length) email = persisted[0].email;
      }
    }
    if (!email) {
      const conn = await connect({});           // prompt user to pick account
      email = conn.email;
    }
    const picked = await pickFile(email, { mimeTypes, title });
    if (!picked) return null;
    const imported = await importFile(email, picked);
    return { ...imported, accountEmail: email };
  }

  // ────────── Public surface ──────────
  window.FolioDrive = {
    // Config / init
    configured: !!(CFG.CLIENT_ID && CFG.API_KEY),
    configDebug: () => ({
      clientId: CFG.CLIENT_ID,
      apiKeyPreview: CFG.API_KEY ? CFG.API_KEY.slice(0, 10) + '…' : '(none)',
      projectNumber: CFG.PROJECT_NUMBER,
      scopes: CFG.SCOPES,
    }),
    init: _ensureInit,

    // Accounts
    connect,
    disconnectAccount,
    listActiveConnections,
    listPersistedConnections,
    ensureToken,

    // Files
    pickFile,
    importFile,
    saveFile,
    importOnce,

    // Tier
    canImportOnce,
    canLink,
    canConnectMultiple,
    tier,

    // Observability
    onChange,
    MIME,
  };

  // Announce once ready for any UI code waiting on us.
  document.dispatchEvent(new CustomEvent('foliodrive:ready'));
})();
