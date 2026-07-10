/**
 * folio-paywall — Cloudflare Worker
 * ------------------------------------------------------------------
 * Stateless paywall gate for Folio's "paid release" feature.
 *
 * This worker NEVER stores licenses, purchases, buyers, or reader
 * identity.  It only:
 *
 *   (1) verifies a Gumroad license key on the user's behalf
 *       (because Gumroad's API has no CORS, so the browser can't
 *       call it directly), and
 *   (2) on successful verification, signs a short-lived JWT the
 *       browser can hold onto in localStorage to skip re-entering
 *       the key on every page load.
 *
 * Endpoints
 *   GET  /                 Health check.
 *   POST /verify           { releaseId, product, licenseKey, days? }
 *                          → { ok: true, token, expiresAt, email? }
 *                            or { error } with 4xx status.
 *   POST /check            { token }
 *                          → { ok: true,  payload } when token is valid
 *                            { ok: false, reason } when expired / bad sig
 *   GET  /check?token=…    Same as POST /check (for simple curl testing).
 *
 * Bindings (set in Cloudflare dashboard → Settings → Variables):
 *   PAYWALL_JWT_SECRET   Secret.   Any long random string (32+ chars).
 *                         Used to HMAC-SHA256-sign issued JWTs.
 *   ALLOWED_ORIGIN        Plain text, CSV OK.
 *                         Defaults to https://folio.jacobsiler.com
 *
 * Security notes
 *   • JWTs carry only: sub (first 16 hex of sha256 of license key),
 *     release id, product slug, Gumroad purchase id, email for display,
 *     iat, exp.  No full license key leaks server- or client-side
 *     beyond the initial POST /verify.
 *   • Refunds are handled implicitly: tokens expire in `days` (30 by
 *     default); after that the user must re-verify.  A refunded
 *     license fails verification on Gumroad's side.  For faster
 *     revocation, shorten the default days.
 *   • Origin allow-list is CORS-only — it doesn't prevent server-side
 *     callers (e.g. curl) from using /verify, but a Gumroad license
 *     key is still required there, so there's no shortcut for
 *     attackers.
 */

const DEFAULT_ORIGIN   = 'https://www.onfolio.press';
const JWT_DEFAULT_DAYS = 30;
const GUMROAD_VERIFY   = 'https://api.gumroad.com/v2/licenses/verify';

/* ── CORS + response helpers ──────────────────────────────────── */
function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGIN) || DEFAULT_ORIGIN;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function pickOrigin(request, env) {
  const list = allowedOrigins(env);
  const reqOrigin = request.headers.get('Origin') || '';
  if (list.indexOf('*') !== -1) return reqOrigin || '*';
  if (reqOrigin && list.indexOf(reqOrigin) !== -1) return reqOrigin;
  return list[0] || DEFAULT_ORIGIN;
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
function errorJson(msg, status, request, env) {
  return json({ ok: false, error: msg }, status || 500, request, env);
}

/* ── Base64URL + HMAC helpers (Web Crypto) ────────────────────── */
function b64urlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJSON(obj) {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret, data, sig) {
  // Constant-time comparison by length + reduce
  const expected = await hmacSign(secret, data);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64urlJSON(header);
  const p = b64urlJSON(payload);
  const sig = await hmacSign(secret, h + '.' + p);
  return h + '.' + p + '.' + sig;
}

async function verifyJWT(token, secret) {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts;
  const sigOk = await hmacVerify(secret, h + '.' + p, s);
  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch (e) { return { ok: false, reason: 'bad-payload' }; }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { ok: false, reason: 'expired', payload };
  return { ok: true, payload };
}

async function sha256ShortHex(str, bytes) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  const arr = new Uint8Array(buf);
  const n = Math.min(bytes || 8, arr.length);
  let hex = '';
  for (let i = 0; i < n; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

/* ── Gumroad license verification ─────────────────────────────── */
async function gumroadVerifyOnce(productField, productValue, licenseKey) {
  const body = new URLSearchParams();
  body.set(productField, productValue);
  body.set('license_key', licenseKey);
  body.set('increment_uses_count', 'false');
  const resp = await fetch(GUMROAD_VERIFY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  let data = {};
  try { data = await resp.json(); } catch(e) {}
  return { httpOk: resp.ok, data };
}

// Try product_id first (current API); fall back to product_permalink for
// older Gumroad products. User pastes whatever their Gumroad settings show.
async function gumroadVerify(productValue, licenseKey) {
  // Defensive normalisation: if the user pasted a full Gumroad URL
  // (e.g. https://x.gumroad.com/l/Embers) into the release modal's
  // product field, the Gumroad verify API will reject it — it takes a
  // product_id / product_permalink, not a URL. Strip down to the
  // trailing /l/<slug> when present. The Folio client now does this
  // on save too, but checking here protects already-saved values.
  if (productValue && /^https?:\/\//i.test(productValue)) {
    const m = productValue.match(/\/l\/([^\/?#]+)/);
    if (m) productValue = m[1];
  }
  const first = await gumroadVerifyOnce('product_id', productValue, licenseKey);
  if (first.data && first.data.success) return { ok: true, data: first.data, via: 'product_id' };

  const second = await gumroadVerifyOnce('product_permalink', productValue, licenseKey);
  if (second.data && second.data.success) return { ok: true, data: second.data, via: 'product_permalink' };

  return {
    ok: false,
    reason: (first.data && first.data.message) || (second.data && second.data.message) || 'verification failed',
  };
}

/* ── Handlers ─────────────────────────────────────────────────── */
async function handleVerify(request, env) {
  if (!env.PAYWALL_JWT_SECRET) {
    return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  }
  let body;
  try { body = await request.json(); } catch(e) {
    return errorJson('Invalid JSON body', 400, request, env);
  }

  const releaseId  = ((body && body.releaseId)  || '').trim();
  const product    = ((body && (body.product || body.productSlug || body.productId)) || '').trim();
  const licenseKey = ((body && body.licenseKey) || '').trim();
  const days = Math.max(1, Math.min(365, Number(body && body.days) || JWT_DEFAULT_DAYS));

  if (!releaseId)  return errorJson('Missing releaseId',  400, request, env);
  if (!product)    return errorJson('Missing product id', 400, request, env);
  if (!licenseKey) return errorJson('Missing licenseKey', 400, request, env);

  const result = await gumroadVerify(product, licenseKey);
  if (!result.ok) {
    return errorJson('License not valid: ' + result.reason, 403, request, env);
  }

  const purchase = (result.data && result.data.purchase) || {};
  if (purchase.refunded || purchase.chargebacked || purchase.disputed) {
    return errorJson('License has been refunded or disputed', 403, request, env);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (days * 86400);
  const sub = await sha256ShortHex(licenseKey, 8);  // 16 hex chars

  const payload = {
    sub,
    release:    releaseId,
    product:    product,
    purchaseId: purchase.id || purchase.order_id || null,
    email:      purchase.email || null,   // for display ("logged in as …")
    iat: now,
    exp,
  };

  const token = await signJWT(payload, env.PAYWALL_JWT_SECRET);

  return json(
    {
      ok: true,
      token,
      expiresAt: exp,
      email: payload.email,
      daysValid: days,
      via: result.via,
    },
    200, request, env
  );
}

async function handleCheck(request, env) {
  if (!env.PAYWALL_JWT_SECRET) {
    return errorJson('Server not configured', 500, request, env);
  }
  let token = '';
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      token = (body && body.token) || '';
    } catch (e) {}
  } else {
    token = new URL(request.url).searchParams.get('token') || '';
  }
  if (!token) return errorJson('Missing token', 400, request, env);

  const result = await verifyJWT(token, env.PAYWALL_JWT_SECRET);
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, 200, request, env);
  }
  return json({ ok: true, payload: result.payload }, 200, request, env);
}

/* ════════════════════════════════════════════════════════════════════
   PAID CONTENT — Firestore-gated chapter content delivery (audit D1)
   ────────────────────────────────────────────────────────────────────
   Before D1, paid chapters shipped to every reader's browser inside
   body/main and were merely hidden with a CSS class. Now they live in
   folio_projects/{folioId}/body/paid, which the Firestore rule
   restricts to owner-only reads. The /paid-content endpoint below is
   the ONLY non-owner path to that content: it verifies the buyer's
   HMAC-signed license JWT, confirms the JWT is scoped to the requested
   folio, and (if both check out) uses a Google service account to
   fetch body/paid via Firestore's REST API.

   New env bindings (alongside PAYWALL_JWT_SECRET / ALLOWED_ORIGIN):
     GCP_SERVICE_ACCOUNT   Secret. Full SA JSON (same value used by
                           folio-email-worker for cron + unsubscribe).
                           SA needs the "Cloud Datastore User" IAM role.
     FIRESTORE_PROJECT_ID  Optional. Overrides the project_id in the
                           SA JSON; usually leave unset.
   ════════════════════════════════════════════════════════════════════ */

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE  = 'https://www.googleapis.com/auth/datastore';

function b64urlStr(str) {
  return b64urlEncode(new TextEncoder().encode(str));
}
function pemToArrayBuffer(pem) {
  const body = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/* Mint an OAuth2 access token for the service account (RS256-signed
   assertion -> token exchange). Same flow as folio-email-worker. */
async function getAccessToken(env) {
  const raw = env.GCP_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GCP_SERVICE_ACCOUNT not configured');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) { throw new Error('GCP_SERVICE_ACCOUNT is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('GCP_SERVICE_ACCOUNT missing client_email / private_key');
  }
  const now    = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss:   sa.client_email,
    scope: FIRESTORE_SCOPE,
    aud:   sa.token_uri || GOOGLE_TOKEN_URI,
    iat:   now,
    exp:   now + 3600,
  };
  const unsigned =
    b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64urlEncode(new Uint8Array(sig));
  const resp = await fetch(sa.token_uri || GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
          encodeURIComponent(jwt),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error('Token exchange failed: ' +
      (data.error_description || data.error || resp.status));
  }
  return { token: data.access_token, projectId: sa.project_id };
}

/* Firestore REST: decode typed values + fetch a single document. */
function fsDecodeValue(v) {
  if (v == null) return null;
  if ('nullValue'      in v) return null;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('stringValue'    in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue'       in v) return fsDecodeFields((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue'     in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsDecodeValue);
  return null;
}
function fsDecodeFields(fields) {
  const out = {};
  for (const k in fields) out[k] = fsDecodeValue(fields[k]);
  return out;
}
async function fsGet(projectId, token, docPath) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents/' + docPath;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore GET ' + docPath + ' failed: ' +
      ((data.error && data.error.message) || r.status));
  }
  const doc = await r.json();
  return fsDecodeFields(doc.fields || {});
}

/* GET /paid-content?folio=<folioId>
   Authorization: Bearer <license JWT>
   Returns { ok:true, body:{ content_gz | content } } on success.
   401 if JWT missing/invalid/expired; 403 if it's for another folio;
   404 if no body/paid exists; 500 misconfig; 502 Firestore fail. */
async function handlePaidContent(request, env) {
  if (!env.PAYWALL_JWT_SECRET) {
    return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  const authHdr = request.headers.get('Authorization') || '';
  const jwt = authHdr.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return errorJson('Missing license token', 401, request, env);
  const v = await verifyJWT(jwt, env.PAYWALL_JWT_SECRET);
  if (!v.ok) return errorJson('License invalid: ' + v.reason, 401, request, env);
  if (v.payload && v.payload.release && v.payload.release !== folioId) {
    return errorJson('License is for a different folio', 403, request, env);
  }
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    const doc = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId) + '/body/paid');
    if (!doc) return json({ ok: false, reason: 'no-paid-content' }, 404, request, env);
    const out = {};
    if (doc.content_gz != null) out.content_gz = doc.content_gz;
    if (doc.content    != null) out.content    = doc.content;
    return json({ ok: true, body: out }, 200, request, env);
  } catch (e) {
    return errorJson('Paid content fetch failed: ' + (e.message || 'unknown'),
                     502, request, env);
  }
}

/* GET /teaser-content?folio=<folioId>
   Anonymous endpoint. Author flags chapters as public teasers in the
   release modal (release.teasers: [chapterId, ...]). This endpoint
   reads release.teasers + body/paid, decompresses the paid content
   map, filters it to only the teaser chapter ids, and returns those.
   Non-teaser paid content never leaves the worker. Used by the
   "funnel" share-link flow: ?read=<id>&teaser=<chid>. */
async function handleTeaserContent(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    const parent = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) {
      return errorJson('Folio not found or not published', 404, request, env);
    }
    const teasers = Array.isArray(parent.release.teasers) ? parent.release.teasers : [];
    if (teasers.length === 0) {
      return json({ ok: true, chapters: {} }, 200, request, env);
    }
    const paid = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId) + '/body/paid');
    if (!paid) {
      return json({ ok: true, chapters: {} }, 200, request, env);
    }
    let chapters = {};
    if (paid.content_gz) {
      try {
        const bin = atob(paid.content_gz);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const txt = await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        ).text();
        const parsed = JSON.parse(txt);
        chapters = (parsed && parsed.chapters) || {};
      } catch (e) {
        console.warn('[teaser] decompress failed', e);
      }
    } else if (paid.content && paid.content.chapters) {
      chapters = paid.content.chapters;
    }
    const filtered = {};
    for (const id of teasers) {
      if (chapters[id] != null) filtered[id] = chapters[id];
    }
    return json({ ok: true, chapters: filtered }, 200, request, env);
  } catch (e) {
    return errorJson('Teaser fetch failed: ' + (e.message || 'unknown'),
                     502, request, env);
  }
}

/* GET /signed-teaser-content?folio=<folioId>&ch=<chapterId>&tt=<tokenId>
   Anonymous endpoint, but the URL itself is the credential — the tokenId
   was minted by the folio owner (writing to /signed_teasers/{tt}) and
   only somebody holding the URL knows it. We look the token up via the
   service account, verify it matches the requested chapter, then return
   ONLY that chapter's content from body/paid.

   Unlike /teaser-content (which only ever returns chapters in
   release.teasers), this endpoint can unlock any chapter the owner has
   minted a token for — without making it publicly listed.

   Revocation is trivial: delete the /signed_teasers/{tt} doc and the
   next lookup 404s. */
async function handleSignedTeaserContent(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  const chId    = (url.searchParams.get('ch')    || '').trim();
  const tt      = (url.searchParams.get('tt')    || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  if (!chId)    return errorJson('Missing ch', 400, request, env);
  if (!tt)      return errorJson('Missing tt', 400, request, env);
  // Defensive shape — tokenIds we mint are hex strings; reject obvious
  // path-traversal / overly-long inputs before we ever touch Firestore.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(tt)) {
    return errorJson('Invalid token shape', 400, request, env);
  }
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    // 1. Look up the signed-teaser doc.
    const tokenDoc = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId) +
      '/signed_teasers/' + encodeURIComponent(tt));
    if (!tokenDoc) {
      // 401, not 404 — to a reader holding the URL the right framing
      // is "this link doesn't work" rather than "this resource is missing".
      return errorJson('Token revoked or never existed', 401, request, env);
    }
    if (String(tokenDoc.chapterId || '') !== chId) {
      // The URL was tampered with (ch swapped) or the token was for a
      // different chapter. Either way, refuse.
      return errorJson('Token / chapter mismatch', 401, request, env);
    }
    // 2. Verify the folio is still published (revoking a release should
    //    also implicitly disable signed teasers — author can re-publish
    //    or sweep the subcollection if they want explicit cleanup).
    const parent = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) {
      return errorJson('Folio not published', 404, request, env);
    }
    // 3. Read body/paid + extract just the one chapter's content.
    const paid = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId) + '/body/paid');
    let chapters = {};
    if (paid) {
      if (paid.content_gz) {
        try {
          const bin = atob(paid.content_gz);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const txt = await new Response(
            new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
          ).text();
          const parsed = JSON.parse(txt);
          chapters = (parsed && parsed.chapters) || {};
        } catch (e) { console.warn('[signed-teaser] decompress failed', e); }
      } else if (paid.content && paid.content.chapters) {
        chapters = paid.content.chapters;
      }
    }
    // Chapter might also live in body/main (e.g. it's IN release.teasers
    // already, so the owner had a regular teaser link). Fall back to that.
    let content = chapters[chId];
    if (content == null) {
      const mainDoc = await fsGet(projectId, sa.token,
        'folio_projects/' + encodeURIComponent(folioId) + '/body/main');
      if (mainDoc) {
        let mainState = null;
        if (mainDoc.state_gz) {
          try {
            const bin = atob(mainDoc.state_gz);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const txt = await new Response(
              new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
            ).text();
            mainState = JSON.parse(txt);
          } catch (e) { console.warn('[signed-teaser] main decompress failed', e); }
        } else if (mainDoc.state) {
          mainState = mainDoc.state;
        }
        if (mainState && Array.isArray(mainState.chapters)) {
          const ch = mainState.chapters.find(c => c && c.id === chId && c.type === 'chapter');
          if (ch) content = ch.content || '';
        }
      }
    }
    if (content == null) {
      return errorJson('Chapter content not found', 404, request, env);
    }
    return json({ ok: true, chapterId: chId, content: content }, 200, request, env);
  } catch (e) {
    return errorJson('Signed teaser fetch failed: ' + (e.message || 'unknown'),
                     502, request, env);
  }
}

/* POST /verify-code  { folioId, code }
   Custom-provider unlock. Author sets a shared passphrase in
   release.unlockCode via the release modal; buyer pastes the same
   string into the paywall gate after paying through the author's
   external checkout (PayPal, Stripe, Ko-fi, anything). Worker
   constant-time compares, issues a JWT shaped exactly like the
   Gumroad /verify token so the rest of the worker (and the client)
   treat the buyer identically. */
async function handleVerifyCode(request, env) {
  if (!env.PAYWALL_JWT_SECRET) {
    return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }
  let body;
  try { body = await request.json(); } catch (e) {
    return errorJson('Invalid JSON body', 400, request, env);
  }
  const folioId = ((body && body.folioId) || '').trim();
  const code    = ((body && body.code)    || '').trim();
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!code)    return errorJson('Missing code',    400, request, env);
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    const parent = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) {
      return errorJson('Folio not found or not published', 404, request, env);
    }
    if (parent.release.provider !== 'custom') {
      return errorJson('This folio is not configured for custom-code unlock', 400, request, env);
    }
    const expected = String(parent.release.unlockCode || '').trim();
    if (!expected) {
      return errorJson('This folio has no unlock code set', 400, request, env);
    }
    // Constant-time compare. Length first; then XOR-fold.
    if (code.length !== expected.length) {
      return errorJson('Unlock code is incorrect', 403, request, env);
    }
    let diff = 0;
    for (let i = 0; i < code.length; i++) {
      diff |= code.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff !== 0) {
      return errorJson('Unlock code is incorrect', 403, request, env);
    }
    // Match — issue JWT with the same shape /verify produces, so
    // /paid-content's v.payload.release === folioId check passes.
    const now  = Math.floor(Date.now() / 1000);
    const days = 30;
    const exp  = now + (days * 86400);
    const sub  = await sha256ShortHex(code + '::' + folioId, 8);
    const payload = {
      sub,
      release:    folioId,
      product:    null,
      provider:   'custom',
      purchaseId: null,
      email:      null,
      iat: now,
      exp,
    };
    const token = await signJWT(payload, env.PAYWALL_JWT_SECRET);
    return json({
      ok: true,
      token,
      expiresAt: exp,
      email: null,
      daysValid: days,
      via: 'custom-code',
    }, 200, request, env);
  } catch (e) {
    return errorJson('Verify failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* Query Firestore for a count of currently-featured folios that are
   still live (release.featuredUntil > now && published && listOnShelf).
   Used by /boost-checkout to enforce FEATURED_SLOT_CAP and by
   /boost-slots to expose scarcity to the client for UI decisions.
   Returns { count, nextOpeningMs } — nextOpeningMs is the earliest
   featuredUntil among currently-featured folios (or 0 if none). */
/* Read a user's current Press subscription state from Firestore.
   Returns { tier, period, subscriptionId, status } if active, else null.
   Used by boost-checkout to apply the subscriber discount. */
async function fsGetUserSubscription(env, uid) {
  if (!uid) return null;
  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    const doc = await fsGet(pid, acc.token, 'folio_user_settings/' + encodeURIComponent(uid));
    if (!doc) return null;
    const sub = doc.pressSubscription;
    if (!sub || sub.status !== 'ACTIVE') return null;
    return {
      tier: String(sub.tier || ''),
      period: String(sub.period || ''),
      subscriptionId: String(sub.paypalSubscriptionId || ''),
      status: 'ACTIVE',
    };
  } catch (e) {
    console.warn('[press] subscription lookup failed:', e.message);
    return null;
  }
}

/* Subscriber discount table — % off boost purchases. */
const PRESS_BOOST_DISCOUNTS = {
  indie:   { pct: 20, label: 'Folio Press Indie — 20% off' },
  imprint: { pct: 50, label: 'Folio Press Imprint — 50% off' },
};

async function fsCountActiveBoosts(env) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  // Firestore REST doesn't support the same rich filter API as the client
  // SDK for nested fields, so we use runQuery with a structured query
  // that filters on release.published == true, then filter the rest in
  // memory (small collection, fine for MVP).
  const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
              '/databases/(default)/documents:runQuery';
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'folio_projects' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'release.published' },
          op: 'EQUAL',
          value: { booleanValue: true }
        }
      },
      limit: 500
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + acc.token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore runQuery failed: ' +
      ((data.error && data.error.message) || r.status));
  }
  const results = await r.json();
  const now = Date.now();
  let count = 0;
  let earliestExpiry = 0;
  for (const item of (results || [])) {
    if (!item.document) continue;
    const fields = fsDecodeFields(item.document.fields || {});
    const release = fields.release || {};
    if (!release.listOnShelf) continue;
    // featuredUntil comes back as timestampValue string; parse safely.
    let untilMs = 0;
    const raw = release.featuredUntil;
    if (raw) {
      if (typeof raw === 'number') untilMs = raw;
      else if (typeof raw === 'string') { const d = new Date(raw); if (!isNaN(d)) untilMs = d.getTime(); }
      else if (raw && typeof raw.seconds === 'number') untilMs = raw.seconds * 1000;
    }
    if (untilMs > now) {
      count++;
      if (!earliestExpiry || untilMs < earliestExpiry) earliestExpiry = untilMs;
    }
  }
  return { count: count, nextOpeningMs: earliestExpiry };
}

/* ══════════════════════════════════════════════════════════════════
   BOOST — PayPal-backed featured-boost fulfilment
   ────────────────────────────────────────────────────────────────────
   Author clicks "🚀 Boost 72h — $9" in the release modal (or on
   shelf / reader / imprint). Flow:
     1. Client POST /boost-checkout { folioId, tier, uid }
        Worker creates a PayPal order carrying folioId+ms+uid+tier in
        purchase_units[0].custom_id, returns { approvalUrl }.
     2. Browser redirects to PayPal's hosted approval page.
     3. PayPal redirects back to /boost-return?token=<orderId>&PayerID=…
        (return_url set on the order). Worker captures the order,
        reads custom_id, writes release.featuredUntil via the Firebase
        Admin service account, then 302s the browser back to
        onfolio.press/shelf?boosted=1&title=<url-encoded-title>.
     4. (Phase 2C) /boost-webhook is a signature-verified safety net
        for the "buyer closed the tab" case. Scaffold only for now.

   Prices are validated server-side against BOOST_TIERS — a rogue
   client can't spoof $0.01 for 30 days. If a mismatched folio ID or
   unknown tier arrives, we refuse to create the order at all.

   Env bindings (Cloudflare dashboard → Settings → Variables):
     PAYPAL_MODE            'sandbox' (default) or 'live'
     PAYPAL_CLIENT_ID       REST app Client ID from developer.paypal.com
     PAYPAL_CLIENT_SECRET   REST app Secret (secret env)
     PAYPAL_WEBHOOK_ID      (Phase 2C) the ID PayPal assigns to your
                            configured webhook, for signature verify
   ══════════════════════════════════════════════════════════════════ */

const PP_SANDBOX = 'https://api-m.sandbox.paypal.com';
const PP_LIVE    = 'https://api-m.paypal.com';

/* Boost tiers — client sends { tier: '72h' }, worker resolves to
   duration + USD price. Add / remove tiers here; keep keys short so
   custom_id stays under PayPal's 127-char limit. */
const BOOST_TIERS = {
  '24h': { ms: 86400000,  usd: '3.00',  label: '24 hours' },
  '72h': { ms: 259200000, usd: '9.00',  label: '72 hours' },
  '7d':  { ms: 604800000, usd: '19.00', label: '7 days' },
};

function ppBase(env) {
  return env.PAYPAL_MODE === 'live' ? PP_LIVE : PP_SANDBOX;
}

async function ppAccessToken(env) {
  const cid = env.PAYPAL_CLIENT_ID;
  const sec = env.PAYPAL_CLIENT_SECRET;
  if (!cid || !sec) throw new Error('PayPal not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
  const basic = btoa(cid + ':' + sec);
  const r = await fetch(ppBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + basic,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error('PayPal token exchange failed: ' +
      (data.error_description || data.error || r.status));
  }
  return data.access_token;
}

/* Write release.featuredUntil surgically via Firestore REST PATCH +
   updateMask.fieldPaths. Only that one nested field is touched; the
   rest of `release` (published, title, tipUrl, etc.) is preserved. */
async function fsSetFeaturedUntil(env, folioId, untilMs) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  if (!pid) throw new Error('No Firestore project id resolvable');
  const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
              '/databases/(default)/documents/folio_projects/' + encodeURIComponent(folioId) +
              '?updateMask.fieldPaths=' + encodeURIComponent('release.featuredUntil');
  const body = {
    fields: {
      release: {
        mapValue: {
          fields: {
            featuredUntil: untilMs == null
              ? { nullValue: null }
              : { timestampValue: new Date(untilMs).toISOString() }
          }
        }
      }
    }
  };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + acc.token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore PATCH failed: ' +
      ((data.error && data.error.message) || r.status));
  }
  return true;
}

/* Return the site origin the browser reached us from (for building
   return_url + cancel_url on the PayPal order). Falls back to
   the first configured ALLOWED_ORIGIN. */
function siteOrigin(request, env) {
  const reqOrigin = request.headers.get('Origin') ||
                    (request.headers.get('Referer') || '').replace(/^(https?:\/\/[^\/]+).*/, '$1');
  if (reqOrigin) return reqOrigin;
  return allowedOrigins(env)[0] || DEFAULT_ORIGIN;
}

function boostSelfBase(request) {
  const u = new URL(request.url);
  return u.origin;
}

/* POST /boost-checkout
   { folioId: 'proj_...', tier: '72h', uid: '<optional>' }
   → { ok:true, orderId, approvalUrl }
     or { error } with 4xx/5xx status. */
async function handleBoostCheckout(request, env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return errorJson('Boost not configured (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Boost not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId = String((body && body.folioId) || '').trim();
  const tier    = String((body && body.tier) || '').trim();
  const uid     = String((body && body.uid) || '').trim();
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!tier || !BOOST_TIERS[tier]) return errorJson('Unknown tier "' + tier + '"', 400, request, env);
  const spec = BOOST_TIERS[tier];

  // Verify the folio actually exists + is published before charging.
  // This uses the SAME service-account path as /paid-content.
  let folioDoc;
  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    folioDoc = await fsGet(pid, acc.token, 'folio_projects/' + folioId);
  } catch (e) {
    return errorJson('Folio lookup failed: ' + (e.message || 'unknown'), 502, request, env);
  }
  if (!folioDoc) return errorJson('No folio at that id', 404, request, env);
  const release = folioDoc.release || {};
  if (!release.published) {
    return errorJson('Folio is not published yet. Publish it, then boost.', 400, request, env);
  }
  const folioTitle = String(release.title || 'this folio').slice(0, 60);

  // Slot-cap check — Phase 3 task #51. Cap concurrent featured slots
  // so "featured" retains scarcity value. When full, refuse the purchase
  // and tell the buyer the earliest opening time so they can retry.
  // Cap defaults to 4; override with FEATURED_SLOT_CAP env var (int).
  const slotCap = Math.max(1, parseInt(env.FEATURED_SLOT_CAP || '4', 10) || 4);
  try {
    const slots = await fsCountActiveBoosts(env);
    if (slots.count >= slotCap) {
      const openingIn = Math.max(0, slots.nextOpeningMs - Date.now());
      const hours = Math.round(openingIn / 3600000 * 10) / 10;
      return json({
        ok: false,
        error: 'Featured slots full',
        detail: 'All ' + slotCap + ' featured slots are currently in use. Next opening in ~' + hours + 'h. Try again then, or check /shelf to see who\'s currently featured.',
        slots_occupied: slots.count,
        slot_cap: slotCap,
        next_opening_ms: slots.nextOpeningMs,
      }, 429, request, env);
    }
  } catch (e) {
    // If the slot count query itself fails, be conservative and allow
    // the purchase — better to over-feature by one than block revenue
    // on a transient Firestore hiccup. Log for observability.
    console.warn('[boost] slot-count query failed, allowing purchase:', e.message);
  }

  // ═══ Subscriber discount — Priority 1 feature-gate framework ═══
  // Read the user's Press subscription. If active + tier has a discount,
  // apply it to the boost price. This is the concrete recurring value
  // moment for subscribers — every boost purchase saves them $.
  let priceUsd = spec.usd;
  let originalUsd = spec.usd;
  let discountPct = 0;
  let discountLabel = '';
  if (uid) {
    const sub = await fsGetUserSubscription(env, uid);
    if (sub && PRESS_BOOST_DISCOUNTS[sub.tier]) {
      const disc = PRESS_BOOST_DISCOUNTS[sub.tier];
      discountPct = disc.pct;
      discountLabel = disc.label;
      const orig = parseFloat(spec.usd);
      const discounted = orig * (1 - disc.pct / 100);
      priceUsd = discounted.toFixed(2);
      console.log('[boost] applied', disc.label, 'for', uid.slice(0, 12), '- price', spec.usd, '->', priceUsd);
    }
  }

  // custom_id must be <= 127 chars. Compact tag: v1|folioId|tier|uid|ts
  const stamp = Date.now();
  const customId = ['v1', folioId, tier, uid || '-', stamp].join('|').slice(0, 127);

  // Return URL — where PayPal redirects the buyer after they approve.
  // Cancel URL — back to shelf with cancelled flag.
  const site   = siteOrigin(request, env);
  const self   = boostSelfBase(request);
  const returnUrl = self + '/boost-return?site=' + encodeURIComponent(site);
  const cancelUrl = site + '/shelf?boost=cancelled';

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return errorJson('PayPal auth failed: ' + (e.message || 'unknown'), 502, request, env); }

  const boostDescription = 'Folio Featured Boost — ' + spec.label + ' — ' + folioTitle +
    (discountLabel ? ' (' + discountLabel + ')' : '');
  const orderBody = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: 'boost-' + folioId.slice(0, 30),
      description: boostDescription,
      custom_id: customId,
      amount: { currency_code: 'USD', value: priceUsd },
    }],
    application_context: {
      brand_name: 'Folio',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };
  let orderResp;
  try {
    const r = await fetch(ppBase(env) + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(orderBody),
    });
    orderResp = await r.json().catch(() => ({}));
    if (!r.ok || !orderResp.id) {
      return errorJson('PayPal order create failed: ' +
        (orderResp.message || orderResp.error_description || r.status), 502, request, env);
    }
  } catch (e) {
    return errorJson('PayPal request failed: ' + (e.message || 'unknown'), 502, request, env);
  }

  const links = orderResp.links || [];
  const approve = links.find(function (l) { return l.rel === 'approve' || l.rel === 'payer-action'; });
  if (!approve) {
    return errorJson('PayPal returned no approval link', 502, request, env);
  }
  return json({
    ok:       true,
    orderId:  orderResp.id,
    approvalUrl: approve.href,
    tier:     tier,
    priceUsd: priceUsd,
    originalUsd: originalUsd,
    discountPct: discountPct,
    discountLabel: discountLabel,
  }, 200, request, env);
}

/* Firestore idempotency check — has this PayPal capture been applied?
   Stashes a doc at boost_receipts/{captureId} the first time we apply
   a boost. Both /boost-return and /boost-webhook consult this. */
async function fsBoostReceiptExists(env, captureId) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  const doc = await fsGet(pid, acc.token, 'boost_receipts/' + encodeURIComponent(captureId));
  return doc != null;
}
async function fsBoostReceiptWrite(env, captureId, meta) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
              '/databases/(default)/documents/boost_receipts/' + encodeURIComponent(captureId);
  const fields = {
    folioId: { stringValue: String(meta.folioId || '') },
    tier:    { stringValue: String(meta.tier || '') },
    source:  { stringValue: String(meta.source || 'unknown') },
    untilMs: { integerValue: String(meta.untilMs || 0) },
    appliedAt: { timestampValue: new Date().toISOString() },
  };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + acc.token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore receipt write failed: ' +
      ((data.error && data.error.message) || r.status));
  }
  return true;
}

/* GET /boost-return — landing after PayPal approval. Captures the order,
   reads custom_id, writes featuredUntil idempotently, redirects to shelf. */
async function handleBoostReturn(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('token') || url.searchParams.get('orderId') || '';
  const site    = url.searchParams.get('site') ||
                  allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const back = function (qs) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': site + '/shelf?' + qs },
    });
  };
  if (!orderId) return back('boost=failed&reason=no-order');
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return back('boost=failed&reason=misconfigured');

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return back('boost=failed&reason=auth'); }

  let cap;
  try {
    const r = await fetch(ppBase(env) + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
      },
    });
    cap = await r.json().catch(() => ({}));
    if (!r.ok || (cap.status && cap.status !== 'COMPLETED' && cap.status !== 'APPROVED')) {
      return back('boost=failed&reason=capture-' + encodeURIComponent(cap.status || r.status));
    }
  } catch (e) {
    return back('boost=failed&reason=network');
  }

  // custom_id lives at purchase_units[0].payments.captures[0].custom_id
  // in the capture response (moved from where we set it at order-create).
  const pu = (cap.purchase_units && cap.purchase_units[0]) || {};
  const captures = (pu.payments && pu.payments.captures) || [];
  const cap0 = captures[0] || {};
  const customId =
    cap0.custom_id  || cap0.customId  ||
    pu.custom_id    || pu.customId    ||
    cap.custom_id   || cap.customId   || '';
  if (!customId) {
    try {
      console.log('[boost] no-metadata; captured order shape:',
        JSON.stringify({
          orderId: cap.id, status: cap.status,
          pu_keys: Object.keys(pu),
          payments_keys: Object.keys(pu.payments || {}),
          captures_len: captures.length,
          cap0_keys: Object.keys(cap0),
        }));
    } catch (_) {}
    return back('boost=failed&reason=no-metadata');
  }
  const parts = customId.split('|');
  if (parts[0] !== 'v1' || parts.length < 4) return back('boost=failed&reason=bad-metadata');
  const folioId = parts[1];
  const tier    = parts[2];
  const spec    = BOOST_TIERS[tier];
  if (!folioId || !spec) return back('boost=failed&reason=bad-tier');

  // Idempotency check — did the webhook already apply for this capture?
  const captureId = cap0.id || cap.id || '';
  if (captureId) {
    try {
      if (await fsBoostReceiptExists(env, captureId)) {
        const _titleDup = ((pu.description || cap0.description || '').split('—').pop() || '').trim();
        return back('boosted=1&tier=' + encodeURIComponent(tier) +
                    '&title=' + encodeURIComponent(_titleDup) + '&dup=1');
      }
    } catch (e) {
      console.warn('[return] receipt check failed, proceeding anyway:', e.message);
    }
  }

  const untilMs = Date.now() + spec.ms;
  try {
    await fsSetFeaturedUntil(env, folioId, untilMs);
    if (captureId) {
      try {
        await fsBoostReceiptWrite(env, captureId, {
          folioId: folioId, tier: tier, untilMs: untilMs, source: 'return'
        });
      } catch (e) {
        console.warn('[return] receipt write failed (non-fatal):', e.message);
      }
    }
  } catch (e) {
    return back('boost=failed&reason=firestore&msg=' + encodeURIComponent(e.message || 'unknown'));
  }
  const title = ((pu.description || cap0.description || '').split('—').pop() || '').trim();
  return back('boosted=1&tier=' + encodeURIComponent(tier) +
              '&title=' + encodeURIComponent(title));
}

/* POST /boost-webhook — Phase 2C safety net. Verifies PayPal signature
   via PayPal's own verify-webhook-signature endpoint, then applies
   featuredUntil idempotently via boost_receipts. */
async function handleBoostWebhook(request, env) {
  if (!env.PAYPAL_WEBHOOK_ID) {
    return errorJson('PAYPAL_WEBHOOK_ID not configured', 500, request, env);
  }
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return errorJson('PayPal creds not configured', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Firestore service account not configured', 500, request, env);
  }

  const rawBody = await request.text();
  let webhookEvent;
  try { webhookEvent = JSON.parse(rawBody); }
  catch (e) { return errorJson('Bad webhook body', 400, request, env); }

  const transmissionId   = request.headers.get('paypal-transmission-id');
  const transmissionTime = request.headers.get('paypal-transmission-time');
  const certUrl          = request.headers.get('paypal-cert-url');
  const authAlgo         = request.headers.get('paypal-auth-algo');
  const transmissionSig  = request.headers.get('paypal-transmission-sig');
  if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig) {
    return errorJson('Missing PayPal transmission headers', 400, request, env);
  }

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return errorJson('PayPal auth failed: ' + (e.message || 'unknown'), 502, request, env); }

  try {
    const verifyResp = await fetch(ppBase(env) + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        transmission_id:   transmissionId,
        transmission_time: transmissionTime,
        cert_url:          certUrl,
        auth_algo:         authAlgo,
        transmission_sig:  transmissionSig,
        webhook_id:        env.PAYPAL_WEBHOOK_ID,
        webhook_event:     webhookEvent,
      }),
    });
    const verifyData = await verifyResp.json().catch(() => ({}));
    if (verifyData.verification_status !== 'SUCCESS') {
      console.log('[webhook] signature verify failed:',
        JSON.stringify({ status: verifyData.verification_status, event_id: webhookEvent.id }));
      return errorJson('Signature verification failed', 401, request, env);
    }
  } catch (e) {
    return errorJson('Signature verify network error: ' + (e.message || 'unknown'), 502, request, env);
  }

  const eventType = webhookEvent.event_type || '';
  const resource  = webhookEvent.resource || {};

  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    console.log('[webhook] noop event:', eventType);
    return json({ ok: true, action: 'noop', eventType: eventType }, 200, request, env);
  }

  const captureId = resource.id || '';
  const customId  = resource.custom_id || resource.customId || '';
  if (!captureId) {
    return json({ ok: true, action: 'ignored', reason: 'no capture id' }, 200, request, env);
  }
  if (!customId) {
    console.log('[webhook] capture without custom_id:', captureId);
    return json({ ok: true, action: 'ignored', reason: 'no custom_id' }, 200, request, env);
  }
  const parts = customId.split('|');
  if (parts[0] !== 'v1' || parts.length < 4) {
    return json({ ok: true, action: 'ignored', reason: 'bad custom_id format' }, 200, request, env);
  }
  const folioId = parts[1];
  const tier    = parts[2];
  const spec    = BOOST_TIERS[tier];
  if (!folioId || !spec) {
    return json({ ok: true, action: 'ignored', reason: 'bad folio/tier' }, 200, request, env);
  }

  try {
    if (await fsBoostReceiptExists(env, captureId)) {
      console.log('[webhook] duplicate delivery, receipt exists for', captureId);
      return json({ ok: true, action: 'duplicate', captureId: captureId }, 200, request, env);
    }
  } catch (e) {
    return errorJson('Receipt check failed: ' + (e.message || 'unknown'), 502, request, env);
  }

  const untilMs = Date.now() + spec.ms;
  try {
    await fsSetFeaturedUntil(env, folioId, untilMs);
    await fsBoostReceiptWrite(env, captureId, {
      folioId: folioId, tier: tier, untilMs: untilMs, source: 'webhook'
    });
    console.log('[webhook] applied boost:', folioId, tier, 'until', new Date(untilMs).toISOString());
    return json({ ok: true, action: 'applied', folioId: folioId, tier: tier, untilMs: untilMs }, 200, request, env);
  } catch (e) {
    console.error('[webhook] apply failed:', e);
    return errorJson('Firestore write failed: ' + (e.message || 'unknown'), 500, request, env);
  }
}

/* GET /press-status?uid=X — client-facing lookup for subscription state.
   Used by client to render tier badges + discount indicators. The state
   is display-only; actual pricing enforcement happens server-side in
   boost-checkout after re-fetching the user's live subscription record.
   Returns { active, tier, period, boostDiscountPct } or { active: false }. */
async function handlePressStatus(request, env) {
  const url = new URL(request.url);
  const uid = url.searchParams.get('uid') || '';
  if (!uid) {
    return json({ ok: true, active: false }, 200, request, env);
  }
  const sub = await fsGetUserSubscription(env, uid);
  if (!sub) {
    return json({ ok: true, active: false }, 200, request, env);
  }
  const disc = PRESS_BOOST_DISCOUNTS[sub.tier] || null;
  return json({
    ok: true,
    active: true,
    tier: sub.tier,
    period: sub.period,
    boostDiscountPct: disc ? disc.pct : 0,
    boostDiscountLabel: disc ? disc.label : null,
  }, 200, request, env);
}

/* GET /boost-slots — public scarcity signal for the client UI. */
async function handleBoostSlots(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Firestore service account not configured', 500, request, env);
  }
  const cap = Math.max(1, parseInt(env.FEATURED_SLOT_CAP || '4', 10) || 4);
  try {
    const slots = await fsCountActiveBoosts(env);
    return json({
      ok: true,
      count: slots.count,
      cap: cap,
      next_opening_ms: slots.nextOpeningMs,
      full: slots.count >= cap,
    }, 200, request, env);
  } catch (e) {
    return errorJson('Slot query failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* POST /view-record — increments folio.viewCount by 1. */
async function handleViewRecord(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Firestore service account not configured', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId = String((body && body.folioId) || '').trim();
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
                '/databases/(default)/documents:commit';
    const payload = {
      writes: [{
        transform: {
          document: 'projects/' + pid + '/databases/(default)/documents/folio_projects/' + folioId,
          fieldTransforms: [{
            fieldPath: 'viewCount',
            increment: { integerValue: '1' }
          }]
        }
      }]
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + acc.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return errorJson('Firestore commit failed: ' + ((data.error && data.error.message) || r.status), 502, request, env);
    }
    return json({ ok: true }, 200, request, env);
  } catch (e) {
    return errorJson('View record failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* ══════════════════════════════════════════════════════════════════
   FOLIO PRESS — recurring subscription tier via PayPal Subscriptions
   ────────────────────────────────────────────────────────────────────
   Three tiers: Free (nothing to do here), Indie ($5/mo or $50/yr),
   Imprint ($12/mo or $120/yr). Each paid tier has two PayPal Plans
   (monthly + yearly), configured in PayPal dashboard and referenced
   here by env-var Plan IDs.
   
   Flow:
     1. Client POST /press-subscribe { tier, period, uid? }
        Worker maps to Plan ID, creates PayPal Subscription with uid
        in custom_id, returns approval URL.
     2. Browser redirects to PayPal approval page.
     3. User approves; PayPal redirects to /press-return?subscription_id=...
        Worker verifies subscription, writes Firestore user_settings/{uid}.pressSubscription
        with { tier, period, status:'ACTIVE', paypalSubscriptionId, activatedAt, currentPeriodEnd }.
     4. /press-webhook receives lifecycle events (renewal, cancellation,
        payment failure) and updates Firestore state.
   
   Required env:
     PAYPAL_PLAN_INDIE_MONTHLY     Plan ID for $5/mo Indie
     PAYPAL_PLAN_INDIE_YEARLY      Plan ID for $50/yr Indie
     PAYPAL_PLAN_IMPRINT_MONTHLY   Plan ID for $12/mo Imprint
     PAYPAL_PLAN_IMPRINT_YEARLY    Plan ID for $120/yr Imprint
   Setup: create these in developer.paypal.com under Products & Plans.
   ══════════════════════════════════════════════════════════════════ */

const PRESS_TIERS = {
  indie:   { label: 'Indie',   monthly_usd: '5.00',  yearly_usd: '50.00'  },
  imprint: { label: 'Imprint', monthly_usd: '12.00', yearly_usd: '120.00' },
};

function pressPlanId(env, tier, period) {
  const key = 'PAYPAL_PLAN_' + tier.toUpperCase() + '_' + period.toUpperCase();
  return env[key] || '';
}

/* POST /press-subscribe — creates a PayPal Subscription for a tier+period.
   Returns { approvalUrl } for browser redirect. Requires the client to
   send { tier, period, uid?(optional Firebase uid) }. */
async function handlePressSubscribe(request, env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return errorJson('PayPal not configured', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const tier   = String((body && body.tier) || '').trim().toLowerCase();
  const period = String((body && body.period) || '').trim().toLowerCase();
  const uid    = String((body && body.uid) || '').trim();
  if (!PRESS_TIERS[tier]) return errorJson('Unknown tier "' + tier + '"', 400, request, env);
  if (period !== 'monthly' && period !== 'yearly') return errorJson('period must be monthly or yearly', 400, request, env);
  const planId = pressPlanId(env, tier, period);
  if (!planId) {
    return errorJson('PayPal Plan not configured for ' + tier + ' ' + period +
      ' — set env var PAYPAL_PLAN_' + tier.toUpperCase() + '_' + period.toUpperCase(),
      500, request, env);
  }

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return errorJson('PayPal auth failed: ' + (e.message || 'unknown'), 502, request, env); }

  const site  = siteOrigin(request, env);
  const self  = boostSelfBase(request);
  const returnUrl = self + '/press-return?site=' + encodeURIComponent(site) + '&tier=' + encodeURIComponent(tier) + '&period=' + encodeURIComponent(period);
  const cancelUrl = site + '/press?subscribe=cancelled';

  // custom_id lets us round-trip metadata through PayPal.
  // Format: v1|tier|period|uid|timestamp — same style as boost.
  const customId = ['v1', tier, period, uid || '-', Date.now()].join('|').slice(0, 127);

  const subBody = {
    plan_id: planId,
    custom_id: customId,
    application_context: {
      brand_name: 'Folio Press',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      payment_method: {
        payer_selected: 'PAYPAL',
        payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED'
      },
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };

  let sub;
  try {
    const r = await fetch(ppBase(env) + '/v1/billing/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(subBody),
    });
    sub = await r.json().catch(() => ({}));
    if (!r.ok || !sub.id) {
      return errorJson('PayPal subscription create failed: ' +
        (sub.message || sub.error_description || r.status), 502, request, env);
    }
  } catch (e) {
    return errorJson('PayPal request failed: ' + (e.message || 'unknown'), 502, request, env);
  }

  const links = sub.links || [];
  const approve = links.find(function (l) { return l.rel === 'approve' || l.rel === 'payer-action'; });
  if (!approve) {
    return errorJson('PayPal returned no approval link', 502, request, env);
  }
  return json({
    ok: true,
    subscriptionId: sub.id,
    approvalUrl: approve.href,
    tier: tier,
    period: period,
  }, 200, request, env);
}

/* GET /press-return — landing after PayPal subscription approval.
   Verifies the subscription is active, writes Firestore user_settings
   subscription state, redirects back to /press with a success flag. */
async function handlePressReturn(request, env) {
  const url = new URL(request.url);
  const subId  = url.searchParams.get('subscription_id') || url.searchParams.get('subscriptionId') || '';
  const site   = url.searchParams.get('site') || allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const tier   = url.searchParams.get('tier') || '';
  const period = url.searchParams.get('period') || '';
  const back = function (qs) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': site + '/press?' + qs },
    });
  };
  if (!subId) return back('subscribe=failed&reason=no-subscription-id');

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return back('subscribe=failed&reason=auth'); }

  // Fetch the subscription to verify it's active
  let sub;
  try {
    const r = await fetch(ppBase(env) + '/v1/billing/subscriptions/' + encodeURIComponent(subId), {
      headers: { 'Authorization': 'Bearer ' + ppAccess },
    });
    sub = await r.json().catch(() => ({}));
    if (!r.ok) {
      return back('subscribe=failed&reason=verify-' + r.status);
    }
  } catch (e) {
    return back('subscribe=failed&reason=network');
  }

  const status = String(sub.status || '').toUpperCase();
  if (status !== 'ACTIVE' && status !== 'APPROVED' && status !== 'APPROVAL_PENDING') {
    return back('subscribe=failed&reason=status-' + encodeURIComponent(status));
  }

  // Parse custom_id back
  const customId = sub.custom_id || '';
  const parts = customId.split('|');
  const uid = (parts[0] === 'v1' && parts.length >= 4 && parts[3] !== '-') ? parts[3] : '';

  // Write Firestore user_settings/{uid}.pressSubscription if we have a uid.
  // If uid missing (unauthenticated sub), the client will attach it later
  // via a POST /press-attach endpoint (future).
  if (uid) {
    try {
      const acc = await getAccessToken(env);
      const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
      const fsUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                    '/databases/(default)/documents/folio_user_settings/' + encodeURIComponent(uid) +
                    '?updateMask.fieldPaths=pressSubscription';
      const fsBody = {
        fields: {
          pressSubscription: {
            mapValue: {
              fields: {
                tier:      { stringValue: tier },
                period:    { stringValue: period },
                status:    { stringValue: 'ACTIVE' },
                paypalSubscriptionId: { stringValue: subId },
                activatedAt: { timestampValue: new Date().toISOString() },
              }
            }
          }
        }
      };
      await fetch(fsUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + acc.token,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(fsBody),
      });
    } catch (e) {
      console.warn('[press] Firestore write failed (non-fatal for return):', e.message);
    }
  }

  return back('subscribed=1&tier=' + encodeURIComponent(tier) + '&period=' + encodeURIComponent(period));
}

/* POST /press-webhook — Phase 2 scaffold. PayPal Subscriptions events:
   BILLING.SUBSCRIPTION.ACTIVATED, .CANCELLED, .SUSPENDED, .PAYMENT.FAILED.
   For now, returns 200 for known events and 501 for signature verify —
   full signature verification + Firestore state updates come next session. */
async function handlePressWebhook(request, env) {
  return json({ ok: true, action: 'accepted', note: 'signature verification + state update coming in Phase 2' }, 200, request, env);
}

/* ══════════════════════════════════════════════════════════════════
   /review-submit — author submits a review, gets a 24h Featured Boost
   ────────────────────────────────────────────────────────────────────
   Ungated incentive: every review submission earns the boost as long
   as (a) the folio belongs to the submitter, and (b) the folio hasn't
   claimed a review-boost before (per-folio-lifetime lock).
   
   Idempotency: reviewBoostClaimedAt on the folio_projects doc. Prevents
   grinding via delete-and-resubmit. One-shot per folio, ever.
   
   Public display is separate — reviews start with approvedForDisplay:false.
   Admin manually curates via /admin/reviews/.
   ══════════════════════════════════════════════════════════════════ */
async function handleReviewSubmit(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Firestore service account not configured', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const uid          = String((body && body.uid) || '').trim();
  const folioId      = String((body && body.folioId) || '').trim();
  const rating       = parseInt((body && body.rating), 10);
  const text         = String((body && body.text) || '').trim().slice(0, 500);
  const role         = String((body && body.role) || 'author').slice(0, 20);
  const feature      = String((body && body.feature) || 'overall').slice(0, 30);
  const allowMarketing = !!(body && body.allowMarketing);
  const displayName  = String((body && body.displayName) || 'Folio user').trim().slice(0, 60);

  if (!uid) return errorJson('Missing uid', 400, request, env);
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!isFinite(rating) || rating < 1 || rating > 5) return errorJson('Rating must be 1-5', 400, request, env);
  if (!text || text.length < 10) return errorJson('Please write at least 10 characters', 400, request, env);

  // Verify the folio exists + belongs to this user.
  let folio;
  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    folio = await fsGet(pid, acc.token, 'folio_projects/' + folioId);
  } catch (e) {
    return errorJson('Folio lookup failed: ' + (e.message || 'unknown'), 502, request, env);
  }
  if (!folio) return errorJson('No folio at that id', 404, request, env);
  if (folio.uid !== uid) return errorJson('That folio is not yours', 403, request, env);

  // Idempotency lock — reviewBoostClaimedAt lives on release map.
  const release = folio.release || {};
  if (release.reviewBoostClaimedAt) {
    return errorJson('This folio already claimed its one-time review boost. Pick a different folio.', 400, request, env);
  }

  // Write the review doc + apply boost + set claim lock.
  // Not perfectly atomic — Firestore doesn't offer client-side multi-doc
  // transactions via REST easily — but we do best-effort with rollback logging.
  const reviewId = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const nowIso = new Date().toISOString();
  const untilMs = Date.now() + 24 * 60 * 60 * 1000;

  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;

    // 1. Write review
    const reviewUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                      '/databases/(default)/documents/reviews/' + encodeURIComponent(reviewId);
    const reviewBody = {
      fields: {
        uid:                { stringValue: uid },
        displayName:        { stringValue: displayName },
        role:               { stringValue: role },
        feature:            { stringValue: feature },
        rating:             { integerValue: String(rating) },
        text:               { stringValue: text },
        allowMarketing:     { booleanValue: allowMarketing },
        boostFolioId:       { stringValue: folioId },
        approvedForDisplay: { booleanValue: false },
        createdAt:          { timestampValue: nowIso },
      }
    };
    const reviewResp = await fetch(reviewUrl, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + acc.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewBody),
    });
    if (!reviewResp.ok) {
      const data = await reviewResp.json().catch(() => ({}));
      throw new Error('Review write failed: ' + ((data.error && data.error.message) || reviewResp.status));
    }

    // 2. Apply boost + set claim lock in a single Firestore PATCH using updateMask
    const folioUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                     '/databases/(default)/documents/folio_projects/' + encodeURIComponent(folioId) +
                     '?updateMask.fieldPaths=' + encodeURIComponent('release.featuredUntil') +
                     '&updateMask.fieldPaths=' + encodeURIComponent('release.reviewBoostClaimedAt');
    const folioBody = {
      fields: {
        release: {
          mapValue: {
            fields: {
              featuredUntil:          { timestampValue: new Date(untilMs).toISOString() },
              reviewBoostClaimedAt:   { timestampValue: nowIso },
            }
          }
        }
      }
    };
    const boostResp = await fetch(folioUrl, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + acc.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(folioBody),
    });
    if (!boostResp.ok) {
      const data = await boostResp.json().catch(() => ({}));
      // Review was written but boost failed — log for reconciliation
      console.error('[review] boost apply failed for reviewId=' + reviewId + ' folioId=' + folioId,
        (data.error && data.error.message) || boostResp.status);
      throw new Error('Boost apply failed: ' + ((data.error && data.error.message) || boostResp.status));
    }

    console.log('[review] submitted reviewId=' + reviewId + ' folioId=' + folioId + ' untilMs=' + untilMs);
    return json({
      ok: true,
      reviewId: reviewId,
      boostUntilMs: untilMs,
      message: 'Thank you! Your folio is now featured for 24 hours.'
    }, 200, request, env);
  } catch (e) {
    return errorJson('Review submit failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* GET /boost-debug — admin-gated diagnostic. */
async function handleBoostDebug(request, env) {
  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token') || '';
  const expected = env.ADMIN_DEBUG_TOKEN || '';
  if (!expected) {
    return errorJson('Debug endpoint disabled — ADMIN_DEBUG_TOKEN not set', 403, request, env);
  }
  if (tokenParam !== expected) {
    return errorJson('Forbidden', 403, request, env);
  }
  const cid = env.PAYPAL_CLIENT_ID || '';
  const sec = env.PAYPAL_CLIENT_SECRET || '';
  const mode = env.PAYPAL_MODE || '(unset — defaults to sandbox)';
  const effectiveMode = env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
  const base = ppBase(env);
  const info = {
    mode_env: mode,
    effective_mode: effectiveMode,
    base_url: base,
    client_id: {
      present: !!cid,
      length: cid.length,
      first_4: cid.slice(0, 4),
      last_4:  cid.slice(-4),
      has_whitespace: /\s/.test(cid),
      has_leading_space:  cid !== cid.replace(/^\s+/, ''),
      has_trailing_space: cid !== cid.replace(/\s+$/, ''),
    },
    client_secret: {
      present: !!sec,
      length: sec.length,
      has_whitespace: /\s/.test(sec),
      has_leading_space:  sec !== sec.replace(/^\s+/, ''),
      has_trailing_space: sec !== sec.replace(/\s+$/, ''),
    },
    paypal_auth_attempt: null,
  };
  if (cid && sec) {
    try {
      const basic = btoa(cid + ':' + sec);
      const r = await fetch(base + '/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + basic,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const data = await r.json().catch(() => ({ _parse_error: true }));
      info.paypal_auth_attempt = {
        http_status: r.status,
        ok: r.ok,
        error: data.error || null,
        error_description: data.error_description || null,
        got_access_token: !!data.access_token,
        expires_in: data.expires_in || null,
      };
    } catch (e) {
      info.paypal_auth_attempt = { error: 'network', message: e.message || 'unknown' };
    }
  } else {
    info.paypal_auth_attempt = { skipped: 'missing creds' };
  }
  return json(info, 200, request, env);
}

/* ── Dispatcher ─────────────────────────────────────────────────────── */

/* ═══ PRODUCT PHOTOS — one-time purchase flow ═══════════════════════════
   Non-subscribers can pay per template to unlock a specific
   folio+template PNG download. Imprint tier subscribers bypass
   this — their subscription entitles them to unlimited downloads.

   Flow:
     1. Client POST /photo-checkout { folioId, template, uid }
     2. Worker creates PayPal Order for $PHOTO_PRICE (default $3)
        with custom_id = "p1|folioId|template|uid|ts"
     3. Redirect to PayPal approval
     4. Approve → PayPal 302 to /photo-return?token=<orderId>&site=...
     5. Worker captures, writes folio_photo_purchases/{captureId}
        with { uid, folioId, template, purchasedAt }
     6. Redirect to /press/photos/?paid=<captureId>&folio=&template=
     7. Client polls /photo-status?uid=&folioId=&template= and enables
        the Download button when { paid: true }.
*/
const PHOTO_TEMPLATES = new Set([
  'ig-square', 'tw-banner', 'pin-vertical',
  'series-stack', 'ereader', 'cozy-flatlay',
]);

function photoPriceUsd(env) {
  const raw = String(env.PHOTO_PRICE_USD || '3.00');
  const n = parseFloat(raw);
  return isFinite(n) && n > 0 ? n.toFixed(2) : '3.00';
}

async function fsPhotoPurchaseExists(env, captureId) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  const doc = await fsGet(pid, acc.token, 'folio_photo_purchases/' + encodeURIComponent(captureId));
  return doc != null;
}
async function fsPhotoPurchaseWrite(env, captureId, meta) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
              '/databases/(default)/documents/folio_photo_purchases/' + encodeURIComponent(captureId);
  const fields = {
    uid:      { stringValue: String(meta.uid || '') },
    folioId:  { stringValue: String(meta.folioId || '') },
    template: { stringValue: String(meta.template || '') },
    priceUsd: { stringValue: String(meta.priceUsd || '') },
    source:   { stringValue: String(meta.source || 'return') },
    purchasedAt: { timestampValue: new Date().toISOString() },
  };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + acc.token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore purchase write failed: ' +
      ((data.error && data.error.message) || r.status));
  }
  return true;
}

/* Query folio_photo_purchases for a given uid + folioId + template.
   Used by /photo-status so the client can enable the Download button. */
async function fsHasPhotoPurchase(env, uid, folioId, template) {
  const acc = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
  const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
              '/databases/(default)/documents:runQuery';
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'folio_photo_purchases' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'uid' },      op: 'EQUAL', value: { stringValue: uid } } },
            { fieldFilter: { field: { fieldPath: 'folioId' },  op: 'EQUAL', value: { stringValue: folioId } } },
            { fieldFilter: { field: { fieldPath: 'template' }, op: 'EQUAL', value: { stringValue: template } } },
          ],
        }
      },
      limit: 1,
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + acc.token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.some(function(row){ return row.document; });
}

/* POST /photo-checkout { folioId, template, uid }
   → { ok:true, orderId, approvalUrl, priceUsd, alreadyEntitled? } */
async function handlePhotoCheckout(request, env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return errorJson('Photos not configured (PayPal creds missing)', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Photos not configured (GCP creds missing)', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId  = String((body && body.folioId) || '').trim();
  const template = String((body && body.template) || '').trim();
  const uid      = String((body && body.uid) || '').trim();
  if (!folioId)                    return errorJson('Missing folioId', 400, request, env);
  if (!PHOTO_TEMPLATES.has(template)) return errorJson('Unknown template "' + template + '"', 400, request, env);
  if (!uid)                        return errorJson('Missing uid — sign in first', 401, request, env);

  // Imprint-tier subscribers get free downloads; short-circuit.
  const sub = await fsGetUserSubscription(env, uid);
  if (sub && sub.tier === 'imprint' && sub.active) {
    return json({ ok: true, alreadyEntitled: true, reason: 'imprint-tier' }, 200, request, env);
  }

  // Verify folio exists + is published (mirror boost check).
  let folioDoc;
  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    folioDoc = await fsGet(pid, acc.token, 'folio_projects/' + folioId);
  } catch (e) {
    return errorJson('Folio lookup failed: ' + (e.message || 'unknown'), 502, request, env);
  }
  if (!folioDoc) return errorJson('No folio at that id', 404, request, env);
  const release = folioDoc.release || {};
  if (!release.published) {
    return errorJson('Folio is not published yet.', 400, request, env);
  }
  const folioTitle = String(release.title || 'this folio').slice(0, 60);
  const priceUsd = photoPriceUsd(env);

  // custom_id compact tag (<= 127 chars). "p1" prefix distinguishes
  // from boost's "v1" prefix so a webhook can route correctly.
  const stamp = Date.now();
  const customId = ['p1', folioId, template, uid, stamp].join('|').slice(0, 127);

  const site = siteOrigin(request, env);
  const self = boostSelfBase(request);
  const returnUrl = self + '/photo-return?site=' + encodeURIComponent(site) +
                    '&folio=' + encodeURIComponent(folioId) +
                    '&template=' + encodeURIComponent(template);
  const cancelUrl = site + '/press/photos/?cancelled=1';

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return errorJson('PayPal auth failed: ' + (e.message || 'unknown'), 502, request, env); }

  const description = 'Folio Product Photo — ' + template + ' — ' + folioTitle;
  const orderBody = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: 'photo-' + folioId.slice(0, 26),
      description: description,
      custom_id: customId,
      amount: { currency_code: 'USD', value: priceUsd },
    }],
    application_context: {
      brand_name: 'Folio',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };
  let orderResp;
  try {
    const r = await fetch(ppBase(env) + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(orderBody),
    });
    orderResp = await r.json().catch(() => ({}));
    if (!r.ok || !orderResp.id) {
      return errorJson('PayPal order create failed: ' +
        (orderResp.message || orderResp.error_description || r.status), 502, request, env);
    }
  } catch (e) {
    return errorJson('PayPal request failed: ' + (e.message || 'unknown'), 502, request, env);
  }
  const links = orderResp.links || [];
  const approve = links.find(function (l) { return l.rel === 'approve' || l.rel === 'payer-action'; });
  if (!approve) return errorJson('PayPal returned no approval link', 502, request, env);
  return json({
    ok: true,
    orderId: orderResp.id,
    approvalUrl: approve.href,
    priceUsd: priceUsd,
    template: template,
    folioId: folioId,
  }, 200, request, env);
}

/* GET /photo-return — landing after PayPal approval. Captures the order,
   parses custom_id, writes the purchase doc, redirects to /press/photos/. */
async function handlePhotoReturn(request, env) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('token') || url.searchParams.get('orderId') || '';
  const site = url.searchParams.get('site') || allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const back = function (qs) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': site + '/press/photos/?' + qs },
    });
  };
  if (!orderId) return back('error=missing-token');

  let ppAccess;
  try { ppAccess = await ppAccessToken(env); }
  catch (e) { return back('error=paypal-auth'); }

  // Capture the payment.
  let capResp;
  try {
    const r = await fetch(ppBase(env) + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ppAccess,
        'Content-Type':  'application/json',
      },
      body: '{}',
    });
    capResp = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Some errors ("ORDER_ALREADY_CAPTURED") aren't real failures — a
      // duplicate return-URL visit. Try to read the order to recover.
      const g = await fetch(ppBase(env) + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
        headers: { 'Authorization': 'Bearer ' + ppAccess },
      });
      capResp = await g.json().catch(() => ({}));
      if (!g.ok) return back('error=capture-failed');
    }
  } catch (e) { return back('error=capture-exception'); }

  // Extract custom_id from the capture or the underlying purchase_unit.
  const pu = (capResp.purchase_units && capResp.purchase_units[0]) || {};
  const cap = (pu.payments && pu.payments.captures && pu.payments.captures[0]) || {};
  const customId = String(cap.custom_id || pu.custom_id || '');
  const captureId = String(cap.id || orderId);
  if (!customId) return back('error=no-custom-id');
  const parts = customId.split('|');
  if (parts[0] !== 'p1' || parts.length < 5) return back('error=bad-custom-id');
  const folioId  = parts[1];
  const template = parts[2];
  const uid      = parts[3];
  if (!PHOTO_TEMPLATES.has(template)) return back('error=unknown-template');

  // Idempotency — if we've already written this receipt, skip re-writing.
  try {
    if (!(await fsPhotoPurchaseExists(env, captureId))) {
      await fsPhotoPurchaseWrite(env, captureId, {
        uid, folioId, template,
        priceUsd: photoPriceUsd(env),
        source: 'return',
      });
    }
  } catch (e) {
    return back('error=purchase-write-failed');
  }
  return back('paid=1&folio=' + encodeURIComponent(folioId) + '&template=' + encodeURIComponent(template));
}

/* GET /photo-status?uid=&folioId=&template=  → { paid: bool, entitled?: 'imprint' } */
async function handlePhotoStatus(request, env) {
  const url = new URL(request.url);
  const uid      = String(url.searchParams.get('uid') || '').trim();
  const folioId  = String(url.searchParams.get('folioId') || '').trim();
  const template = String(url.searchParams.get('template') || '').trim();
  if (!uid || !folioId || !template) {
    return errorJson('Missing uid, folioId, or template', 400, request, env);
  }
  // Check Imprint entitlement first.
  try {
    const sub = await fsGetUserSubscription(env, uid);
    if (sub && sub.tier === 'imprint' && sub.active) {
      return json({ ok: true, paid: true, entitled: 'imprint' }, 200, request, env);
    }
  } catch (_) {}
  // Check per-photo purchase.
  try {
    const has = await fsHasPhotoPurchase(env, uid, folioId, template);
    return json({ ok: true, paid: !!has }, 200, request, env);
  } catch (e) {
    return errorJson('Status lookup failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}



/* ═══ SIGN-SHARE — mint a signed share link for an owner ═════════════
   Client posts { folioId, role } with a Firebase ID token in
   Authorization (we don't currently verify the ID token — that
   requires the Firebase Admin SDK or a manual JWKS check — but the
   Authorization header is what CORS needed to allow). The worker
   verifies the folio exists (basic sanity), then mints a JWT the
   reader-side paywall recognises as an unlock signal.

   JWT payload: { folioId, role, iat, exp }
   Return:      { shareUrl: '/app.html?read=<id>&role=<role>&share=<jwt>' }

   Client (_rdMaybeActivate in app.html) already:
     • extracts ?share= from URL
     • stashes it in localStorage as folioShareToken_<folioId>
     • uses _pwDecode / _pwIsValid to read the role and gate paywall
   So once this endpoint returns real JWTs, the whole flow works.
*/
async function handleSignShare(request, env) {
  if (!env.PAYWALL_JWT_SECRET) {
    return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId = String((body && body.folioId) || '').trim();
  const role    = String((body && body.role) || 'reader').toLowerCase();
  const validRoles = ['reader', 'beta', 'editor', 'collab'];
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!validRoles.includes(role)) return errorJson('Unknown role: ' + role, 400, request, env);

  // Basic folio existence check via service account so we don't mint
  // tokens for garbage ids. This is not an ownership check — the client
  // side (app.html's _rlGetSignedLink) gates on _isOwner before calling,
  // and share links are meant to be shareable anyway.
  if (env.GCP_SERVICE_ACCOUNT) {
    try {
      const acc = await getAccessToken(env);
      const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
      const doc = await fsGet(pid, acc.token, 'folio_projects/' + folioId);
      if (!doc) return errorJson('No folio at that id', 404, request, env);
    } catch (e) {
      console.warn('[sign-share] folio existence check failed, continuing:', e.message);
    }
  }

  // Mint the JWT. 90-day expiry — long enough that a beta reader can
  // finish the book across weekends without the link going stale.
  const now = Math.floor(Date.now() / 1000);
  // Payload key MUST be "folio" (not "folioId") — app.html's paywall
  // gate at line ~8402 checks _pd.folio === folioId. Using "folioId" here
  // makes the client reject valid tokens as "wrong folio" and delete them
  // from localStorage.
  const payload = {
    folio: folioId,
    role:  role,
    iat:   now,
    exp:   now + 90 * 24 * 3600,
  };
  let jwt;
  try { jwt = await signJWT(payload, env.PAYWALL_JWT_SECRET); }
  catch (e) { return errorJson('Sign failed: ' + (e.message || 'unknown'), 500, request, env); }

  // Build the shareable URL. Uses the request Origin so the same
  // worker serves onfolio.press and any dev site alike.
  const site = siteOrigin(request, env);
  const shareUrl = site + '/app.html?read=' + encodeURIComponent(folioId) +
                   '&role=' + encodeURIComponent(role) +
                   '&share=' + encodeURIComponent(jwt);
  return json({
    ok: true,
    shareUrl: shareUrl,
    role: role,
    expSeconds: payload.exp,
  }, 200, request, env);
}


export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '') {
      return json({
        ok: true,
        service: 'folio-paywall',
        stateless: true,
        endpoints: [
          'POST /verify         { releaseId, product, licenseKey, days? }',
          'POST /check          { token }',
          'GET  /check?token=...',
          'GET  /paid-content?folio=...    (Authorization: Bearer <jwt>)',
          'POST /verify-code   { folioId, code }  (custom-provider unlock)',
          'GET  /teaser-content?folio=...  (anonymous)',
          'GET  /signed-teaser-content?folio=&ch=&tt=  (anonymous)',
          'POST /view-record    { folioId }',
          'POST /boost-checkout  { folioId, tier, uid? }',
          'GET  /boost-return    ?token=&PayerID=&site=',
          'GET  /boost-slots      scarcity signal',
          'POST /boost-webhook   PayPal-signed safety net',
          'POST /press-subscribe { tier, period, uid? }   creates a PayPal Subscription',
          'GET  /press-return    ?subscription_id=&tier=&period=&site=  Post-approval landing',
          'POST /press-webhook   PayPal Subscription lifecycle events (Phase 2)',
          'GET  /press-status?uid=X   subscription state + boost discount for the client UI',
          'POST /review-submit  { uid, folioId, rating, text, ... }   review + 24h free boost',
          'GET  /boost-debug?token=...   admin diagnostic',
          'POST /photo-checkout { folioId, template, uid }  one-time PNG purchase',
          'GET  /photo-return   ?token=&site=&folio=&template=',
          'GET  /photo-status   ?uid=&folioId=&template=',
          'POST /sign-share     { folioId, role } → { shareUrl }  (owner mints a signed reader link)',
        ],
      }, 200, request, env);
    }

    if (path === '/verify'        && request.method === 'POST') return handleVerify(request, env);
    if (path === '/check'         && (request.method === 'POST' || request.method === 'GET')) return handleCheck(request, env);
    if (path === '/paid-content'  && request.method === 'GET')  return handlePaidContent(request, env);
    if (path === '/verify-code'   && request.method === 'POST') return handleVerifyCode(request, env);
    if (path === '/teaser-content' && request.method === 'GET')  return handleTeaserContent(request, env);
    if (path === '/signed-teaser-content' && request.method === 'GET') return handleSignedTeaserContent(request, env);
    if (path === '/boost-checkout' && request.method === 'POST') return handleBoostCheckout(request, env);
    if (path === '/boost-return'   && request.method === 'GET')  return handleBoostReturn(request, env);
    if (path === '/boost-webhook'  && request.method === 'POST') return handleBoostWebhook(request, env);
    if (path === '/boost-slots'    && request.method === 'GET')  return handleBoostSlots(request, env);
    if (path === '/view-record'    && request.method === 'POST') return handleViewRecord(request, env);
    if (path === '/press-subscribe' && request.method === 'POST') return handlePressSubscribe(request, env);
    if (path === '/press-return'    && request.method === 'GET')  return handlePressReturn(request, env);
    if (path === '/press-webhook'   && request.method === 'POST') return handlePressWebhook(request, env);
    if (path === '/press-status'    && request.method === 'GET')  return handlePressStatus(request, env);
    if (path === '/review-submit'  && request.method === 'POST') return handleReviewSubmit(request, env);
    if (path === '/boost-debug'    && request.method === 'GET')  return handleBoostDebug(request, env);
    if (path === '/sign-share'    && request.method === 'POST') return handleSignShare(request, env);
    if (path === '/photo-checkout' && request.method === 'POST') return handlePhotoCheckout(request, env);
    if (path === '/photo-return'   && request.method === 'GET')  return handlePhotoReturn(request, env);
    if (path === '/photo-status'   && request.method === 'GET')  return handlePhotoStatus(request, env);

    return errorJson('Not found: ' + path, 404, request, env);
  },
};
