/* ══════════════════════════════════════════════════════════════════════
   FOLIO ↔ GOOGLE DRIVE  (folio-drive-worker.js)
   ══════════════════════════════════════════════════════════════════════

   Purpose
   -------
   Server-side token broker so authors don't have to re-OAuth every browser
   session. Phase 3 of the Drive integration (see
   docs/DRIVE_INTEGRATION_PHASE_2.md and PHASE_3.md).

   Endpoints
   ---------
   POST /exchange   { email } → { access_token, expires_in }
     Trades the user's stored refresh token for a fresh access token.
     Called by folio-drive.js whenever a session token is missing or
     expired. Authenticated by a Firebase ID token in the Authorization
     header (identifies which user's tokens to read).

   POST /store      { email, refresh_token } → { ok }
     Called after an interactive OAuth that produced an offline grant.
     Encrypts and persists the refresh token keyed by (uid, email).

   POST /revoke     { email } → { ok }
     Called from folio-drive.js disconnectAccount(). Calls Google's
     revoke endpoint and deletes the stored token.

   GET  /health → "ok"

   Storage
   -------
   Firestore collection: folio_drive_tokens/{uid}/accounts/{emailSlug}
     { refresh_token, scopes, updatedAt }
   Rules (docs/firestore.rules) allow only the owning uid to read;
   nobody can WRITE directly from client (Worker uses a service account).

   Secrets (Wrangler secrets)
   --------------------------
   GOOGLE_OAUTH_CLIENT_ID     — the Web OAuth client id (not secret,
                                could be a plain var, but kept together)
   GOOGLE_OAUTH_CLIENT_SECRET — THE client secret for the Drive web client
   GCP_SERVICE_ACCOUNT        — JSON for the Firestore service account
                                (same one folio-email-worker uses)
   FIREBASE_PROJECT_ID        — 'miscellaneous-117e9'

   See docs/DRIVE_INTEGRATION_PHASE_3.md for deploy steps.
   ══════════════════════════════════════════════════════════════════════ */

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_JWKS_URL   = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const ALLOWED_ORIGIN_DEFAULT = 'https://onfolio.press,https://www.onfolio.press,http://localhost:8787';

/* ─────────── CORS ─────────── */
function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGIN) || ALLOWED_ORIGIN_DEFAULT;
  const set = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  for (const o of Array.from(set)) {
    const m = o.match(/^https?:\/\/(www\.)?(onfolio\.press)(:\d+)?$/i);
    if (m) {
      const proto = o.split('://')[0];
      const port = m[3] || '';
      set.add(proto + '://' + m[2] + port);
      set.add(proto + '://www.' + m[2] + port);
    }
  }
  return Array.from(set);
}
function pickOrigin(request, env) {
  const list = allowedOrigins(env);
  const reqOrigin = request.headers.get('Origin') || '';
  if (list.indexOf(reqOrigin) !== -1) return reqOrigin;
  return list[0];
}
function corsHeaders(request, env, extra) {
  const h = {
    'Access-Control-Allow-Origin': pickOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}
function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: corsHeaders(request, env, { 'Content-Type': 'application/json' }),
  });
}

/* ─────────── Firebase ID-token verification (lightweight) ───────────
   We don't want to pull in a full JWT library. Firebase ID tokens are
   signed RS256 by Google. Verify signature against Google's public
   JWKS, check aud=projectId, iss=https://securetoken.google.com/<pid>,
   and exp > now. Returns { uid, email } on success or null. */
async function verifyFirebaseIdToken(idToken, env) {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp || Date.now() / 1000 > payload.exp) return null;
    if (payload.aud !== env.FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID) return null;

    // Fetch JWKS (Google serves these as PEMs). Cache per Worker instance.
    if (!globalThis._fbJwks || Date.now() - globalThis._fbJwksAt > 3600_000) {
      const jr = await fetch(GOOGLE_JWKS_URL);
      if (!jr.ok) return null;
      globalThis._fbJwks = await jr.json();
      globalThis._fbJwksAt = Date.now();
    }
    const kid = header.kid;
    const pem = globalThis._fbJwks[kid];
    if (!pem) return null;
    const key = await crypto.subtle.importKey(
      'spki',
      pemToBuffer(pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const sig = b64urlDecode(parts[2]);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
    if (!ok) return null;
    return { uid: payload.user_id || payload.sub, email: payload.email || null };
  } catch (_) {
    return null;
  }
}
function pemToBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/* ─────────── Firestore REST helpers (via service account) ─────────── */
function emailSlug(email) {
  return String(email).toLowerCase().replace(/[^a-z0-9]/g, '_');
}
async function saGetAccessToken(env) {
  if (globalThis._saTok && globalThis._saExp > Date.now() + 60_000) return globalThis._saTok;
  const sa = JSON.parse(env.GCP_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const toSign = enc(header) + '.' + enc(claim);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = toSign + '.' + sigB64;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('SA token exchange failed: ' + JSON.stringify(data));
  globalThis._saTok = data.access_token;
  globalThis._saExp = Date.now() + ((data.expires_in || 3600) * 1000);
  return data.access_token;
}
async function fsRead(env, path) {
  const tok = await saGetAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Firestore read failed: ' + r.status);
  return await r.json();
}
async function fsWrite(env, path, fields) {
  const tok = await saGetAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('Firestore write failed: ' + r.status + ' ' + (await r.text()));
  return await r.json();
}
async function fsDelete(env, path) {
  const tok = await saGetAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const r = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  return r.ok;
}
function strField(s) { return { stringValue: String(s) }; }
function tsField(d)  { return { timestampValue: new Date(d).toISOString() }; }

/* ─────────── Handlers ─────────── */

async function handleExchange(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: 'missing-bearer' }, 401, request, env);
  const user = await verifyFirebaseIdToken(m[1], env);
  if (!user) return json({ error: 'invalid-token' }, 401, request, env);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad-json' }, 400, request, env); }
  if (!body.email) return json({ error: 'missing-email' }, 400, request, env);

  const path = `folio_drive_tokens/${user.uid}/accounts/${emailSlug(body.email)}`;
  const doc = await fsRead(env, path);
  const refresh = doc && doc.fields && doc.fields.refresh_token && doc.fields.refresh_token.stringValue;
  if (!refresh) return json({ error: 'no-stored-token' }, 404, request, env);

  const form = new URLSearchParams();
  form.set('client_id',     env.GOOGLE_OAUTH_CLIENT_ID);
  form.set('client_secret', env.GOOGLE_OAUTH_CLIENT_SECRET);
  form.set('refresh_token', refresh);
  form.set('grant_type',    'refresh_token');
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    // If Google rejected the refresh token (revoked, expired, etc.) we
    // nuke the stored row so the next connect attempt starts clean.
    if (r.status === 400 || r.status === 401) {
      await fsDelete(env, path).catch(() => {});
    }
    return json({ error: 'google-refused', detail: data }, 502, request, env);
  }
  return json({ access_token: data.access_token, expires_in: data.expires_in || 3600 }, 200, request, env);
}

async function handleStore(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: 'missing-bearer' }, 401, request, env);
  const user = await verifyFirebaseIdToken(m[1], env);
  if (!user) return json({ error: 'invalid-token' }, 401, request, env);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad-json' }, 400, request, env); }
  if (!body.email || !body.refresh_token) return json({ error: 'missing-fields' }, 400, request, env);

  const path = `folio_drive_tokens/${user.uid}/accounts/${emailSlug(body.email)}`;
  await fsWrite(env, path, {
    email:         strField(body.email),
    refresh_token: strField(body.refresh_token),
    updatedAt:     tsField(Date.now()),
  });
  return json({ ok: true }, 200, request, env);
}

async function handleRevoke(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: 'missing-bearer' }, 401, request, env);
  const user = await verifyFirebaseIdToken(m[1], env);
  if (!user) return json({ error: 'invalid-token' }, 401, request, env);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad-json' }, 400, request, env); }
  if (!body.email) return json({ error: 'missing-email' }, 400, request, env);

  const path = `folio_drive_tokens/${user.uid}/accounts/${emailSlug(body.email)}`;
  const doc = await fsRead(env, path);
  const refresh = doc && doc.fields && doc.fields.refresh_token && doc.fields.refresh_token.stringValue;
  if (refresh) {
    // Best-effort revoke at Google; Firestore delete happens regardless.
    try {
      await fetch(GOOGLE_REVOKE_URL + '?token=' + encodeURIComponent(refresh), { method: 'POST' });
    } catch (_) {}
  }
  await fsDelete(env, path).catch(() => {});
  return json({ ok: true }, 200, request, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { headers: corsHeaders(request, env, { 'Content-Type': 'text/plain' }) });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Folio Drive Worker — endpoints: POST /exchange, POST /store, POST /revoke, GET /health', {
        headers: corsHeaders(request, env, { 'Content-Type': 'text/plain' }),
      });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method-not-allowed' }, 405, request, env);
    }
    try {
      if (url.pathname === '/exchange') return await handleExchange(request, env);
      if (url.pathname === '/store')    return await handleStore(request, env);
      if (url.pathname === '/revoke')   return await handleRevoke(request, env);
      return json({ error: 'not-found' }, 404, request, env);
    } catch (e) {
      return json({ error: 'server-error', detail: String(e && e.message || e) }, 500, request, env);
    }
  },
};
