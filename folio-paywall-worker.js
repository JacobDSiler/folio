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
   Option C+ — VENDOR WEBHOOK AUTO-DELIVERY of unlock codes.
   ────────────────────────────────────────────────────────────────────
   Two endpoints in this section:

     POST /vendor-config              — owner-authenticated write of
                                        vendor + secret for a folio.
                                        Stored server-side in
                                        folio_vendor_webhooks/{folioId}
                                        (rule: worker-only).

     POST /vendor-webhook/{folioId}   — public, vendor-callable.
                                        Validates vendor signature,
                                        mints JWT unlock token, calls
                                        email worker's /send-unlock
                                        to deliver a "click here to
                                        unlock" link to the buyer
                                        and a sale notification to
                                        the owner.

   Supported vendors (MVP):
     kofi   — verification_token match (Ko-fi's built-in webhook auth)
     payhip — HMAC-SHA256 of raw body (payhip's Signature header)
     paypal — Webhooks V2 (verifies via /v1/notifications/verify-webhook-signature)

   Adding a new vendor: implement a validator in _vendorValidate()
   and add its shape to _vendorExtract(). All the infrastructure
   (config storage, JWT mint, email dispatch, sale recording) is
   vendor-agnostic.
   ══════════════════════════════════════════════════════════════════ */
const _VENDOR_KINDS = new Set(['kofi', 'payhip', 'paypal', 'paypal_native']);

/* Owner writes their vendor webhook config for a folio. Auth via the
   Firebase ID token in Authorization: Bearer <token>. We decode the
   token, verify it against Google's public keys, extract the uid, and
   confirm it matches the folio's ownerUid before writing. */
async function handleVendorConfig(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Server not configured (service account)', 500, request, env);
  }
  const authHdr = request.headers.get('Authorization') || '';
  const idToken = authHdr.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return errorJson('Authorization: Bearer <firebase-id-token> required', 401, request, env);

  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }

  const folioId = String((body && body.folioId) || '').trim();
  const vendor  = String((body && body.vendor)  || '').trim().toLowerCase();
  const secret  = String((body && body.secret)  || '').trim();
  const enabled = body && body.enabled === false ? false : true;

  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (enabled && !_VENDOR_KINDS.has(vendor)) {
    return errorJson('Unknown vendor. Supported: kofi, payhip, paypal', 400, request, env);
  }
  if (enabled && !secret) return errorJson('Missing secret (webhook token / signing secret)', 400, request, env);

  try {
    // Verify the Firebase ID token via Google's Identity Toolkit (accountsLookup)
    const auth = await getAccessToken(env);
    const uid = await _verifyFirebaseIdToken(idToken, env);
    if (!uid) return errorJson('Invalid Firebase ID token', 401, request, env);

    // Confirm caller owns this folio.
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const parent = await fsGet(pid, auth.token, 'folio_projects/' + encodeURIComponent(folioId));
    if (!parent) return errorJson('Folio not found', 404, request, env);
    if (parent.uid !== uid) return errorJson('Not the folio owner', 403, request, env);

    // Owner email — pull from Firebase Auth via lookup so we can send
    // the sale-notification email later without touching the client.
    const ownerEmail = await _firebaseUserEmail(uid, env).catch(() => null);

    const nowIso = new Date().toISOString();
    const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
                '/databases/(default)/documents/folio_vendor_webhooks/' +
                encodeURIComponent(folioId);
    const fields = enabled ? {
      folioId:    { stringValue: folioId },
      ownerUid:   { stringValue: uid },
      ownerEmail: ownerEmail ? { stringValue: ownerEmail } : { nullValue: null },
      vendor:     { stringValue: vendor },
      secret:     { stringValue: secret },
      updatedAt:  { timestampValue: nowIso },
    } : {
      folioId:  { stringValue: folioId },
      ownerUid: { stringValue: uid },
      enabled:  { booleanValue: false },
      updatedAt:{ timestampValue: nowIso },
    };
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return errorJson('Config write failed: ' + ((err.error && err.error.message) || r.status), 502, request, env);
    }
    return json({
      ok: true,
      webhookUrl: new URL(request.url).origin + '/vendor-webhook/' + encodeURIComponent(folioId),
    }, 200, request, env);
  } catch (e) {
    return errorJson('Config failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* Vendor calls this endpoint on successful purchase. We fetch the
   stored config for this folio, validate the vendor-specific
   signature, extract buyer email + amount, mint a per-purchase JWT
   unlock token, and dispatch the delivery email via the email worker. */
async function handleVendorWebhook(request, env, folioId) {
  if (!folioId) return errorJson('Missing folioId in path', 400, request, env);
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured', 500, request, env);
  if (!env.PAYWALL_JWT_SECRET)  return errorJson('Server not configured', 500, request, env);

  // Grab raw body once — some vendors sign the raw string, so we
  // can't just parse-and-serialize (JSON key order + whitespace vary).
  const rawBody = await request.text();

  try {
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;

    // Load config for this folio.
    const cfg = await fsGet(pid, auth.token,
      'folio_vendor_webhooks/' + encodeURIComponent(folioId));
    if (!cfg || cfg.enabled === false) {
      return errorJson('Vendor webhook not configured for this folio', 404, request, env);
    }
    const vendor = String(cfg.vendor || '').toLowerCase();
    const secret = String(cfg.secret || '');
    if (!_VENDOR_KINDS.has(vendor) || !secret) {
      return errorJson('Vendor config invalid', 500, request, env);
    }

    // Validate the vendor's signature on the raw body.
    const validated = await _vendorValidate(vendor, secret, rawBody, request, env);
    if (!validated.ok) {
      return errorJson('Signature validation failed: ' + validated.reason, 401, request, env);
    }

    // Extract buyer email + amount + external order id from the vendor payload.
    const extracted = _vendorExtract(vendor, validated.parsed);
    if (!extracted.buyerEmail) {
      return errorJson('Vendor payload missing buyer email', 400, request, env);
    }

    // Pull folio metadata for the email body (title, author, reader URL).
    const parent = await fsGet(pid, auth.token, 'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) {
      return errorJson('Folio not found or not published', 404, request, env);
    }
    const folioTitle = String((parent.release && parent.release.title) || parent.name || 'Your folio');
    const folioAuthor = String((parent.release && parent.release.author) || '');

    // Mint a per-purchase JWT unlock token. 365-day validity — buyers
    // who paid once should stay unlocked long enough for a lost
    // browser / device switch to not require re-purchase.
    const now = Math.floor(Date.now() / 1000);
    const days = 365;
    const exp = now + (days * 86400);
    const sub = await sha256ShortHex(extracted.orderId + '::' + folioId + '::' + extracted.buyerEmail, 8);
    const payload = {
      sub,
      release:    folioId,
      product:    null,
      provider:   vendor,
      purchaseId: extracted.orderId || null,
      email:      extracted.buyerEmail,
      iat: now,
      exp,
    };
    const token = await signJWT(payload, env.PAYWALL_JWT_SECRET);

    // Build the one-click unlock URL the buyer will click from email.
    const origin = allowedOrigins(env)[0] || (new URL(request.url).origin);
    const unlockUrl = origin + '/app.html?read=' + encodeURIComponent(folioId) +
                      '&pwToken=' + encodeURIComponent(token);

    // Fire-and-forget: record the sale for the owner's metrics.
    // `env` passed so affiliate attribution + ledger bump can run.
    _writeSaleRecord(pid, auth.token, folioId, {
      vendor,
      orderId:    extracted.orderId,
      buyerEmail: extracted.buyerEmail,
      amount:     extracted.amount,
      currency:   extracted.currency,
      ts:         new Date().toISOString(),
    }, env).catch(function(){});

    // Dispatch unlock email via email worker. Prefers the Cloudflare
    // Service Binding (env.EMAIL_WORKER) — routes directly worker-to-
    // worker without going through Cloudflare's edge, sidestepping
    // the 404 / error 1042 that HTTPS worker-to-worker fetches hit
    // on the same account (which was breaking every /send-unlock
    // call before). Falls back to HTTPS fetch if the binding isn't
    // configured (e.g. before the wrangler.toml [[services]] block
    // ships). EMAIL_WORKER_SECRET must equal INTERNAL_WORKER_SECRET
    // on the email worker's side either way.
    if (env.EMAIL_WORKER_SECRET) {
      const emailReqBody = JSON.stringify({
        folioId,
        folioTitle,
        folioAuthor,
        buyerEmail: extracted.buyerEmail,
        ownerEmail: cfg.ownerEmail || null,
        amount: extracted.amount,
        currency: extracted.currency,
        unlockUrl,
        vendor,
      });
      const emailReqHeaders = { 'Content-Type': 'application/json', 'X-Internal-Secret': env.EMAIL_WORKER_SECRET };
      let emailResp = null;
      try {
        if (env.EMAIL_WORKER && typeof env.EMAIL_WORKER.fetch === 'function') {
          // Service-binding path — hostname in URL is ignored, CF
          // routes directly to the bound worker.
          emailResp = await env.EMAIL_WORKER.fetch('https://internal/send-unlock', {
            method: 'POST',
            headers: emailReqHeaders,
            body: emailReqBody,
          });
        } else {
          // Fallback: HTTPS fetch. Hits CF's same-account worker
          // restrictions — service binding above is strongly preferred.
          const _url = env.EMAIL_WORKER_URL || 'https://folio-email.jacobdsiler.workers.dev';
          emailResp = await fetch(_url.replace(/\/$/, '') + '/send-unlock', {
            method: 'POST',
            headers: emailReqHeaders,
            body: emailReqBody,
          });
        }
        if (!emailResp.ok) {
          const et = await emailResp.text().catch(() => '');
          console.warn('[vendor-webhook] email dispatch failed:', emailResp.status, et);
        } else {
          console.log('[vendor-webhook] email dispatched via', env.EMAIL_WORKER ? 'service binding' : 'HTTPS fetch');
        }
      } catch (e) {
        console.warn('[vendor-webhook] email dispatch threw:', e && (e.message || e));
      }
    } else {
      console.warn('[vendor-webhook] EMAIL_WORKER_SECRET not configured — sale processed but no email sent. Set with:  wrangler secret put EMAIL_WORKER_SECRET --config wrangler.toml');
    }

    return json({ ok: true }, 200, request, env);
  } catch (e) {
    console.warn('[vendor-webhook] error', e && (e.stack || e.message || e));
    return errorJson('Webhook error: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* Vendor-specific signature validation. Returns { ok, reason, parsed }. */
async function _vendorValidate(vendor, secret, rawBody, request, env) {
  if (vendor === 'kofi') {
    // Ko-fi POSTs form-encoded with a `data` field containing JSON.
    // The JSON includes a `verification_token` we compare against secret.
    let payload = null;
    // Try form-encoded first, then JSON.
    if (rawBody.startsWith('data=')) {
      try {
        const form = new URLSearchParams(rawBody);
        const dataStr = form.get('data') || '';
        payload = JSON.parse(dataStr);
      } catch (e) { return { ok: false, reason: 'form-parse failed' }; }
    } else {
      try { payload = JSON.parse(rawBody); }
      catch (e) { return { ok: false, reason: 'json-parse failed' }; }
    }
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'no payload' };
    if (String(payload.verification_token || '') !== secret) {
      return { ok: false, reason: 'verification_token mismatch' };
    }
    return { ok: true, parsed: payload };
  }

  if (vendor === 'payhip') {
    // Payhip signs body with HMAC-SHA256; signature in Payhip-Signature header.
    const sig = request.headers.get('payhip-signature') || request.headers.get('Payhip-Signature') || '';
    if (!sig) return { ok: false, reason: 'no signature header' };
    const expected = await _hmacHex(secret, rawBody);
    if (sig !== expected) return { ok: false, reason: 'hmac mismatch' };
    let payload = null;
    try { payload = JSON.parse(rawBody); }
    catch (e) { return { ok: false, reason: 'json-parse failed' }; }
    return { ok: true, parsed: payload };
  }

  if (vendor === 'paypal') {
    // PayPal Webhooks V2 — verify via /v1/notifications/verify-webhook-signature.
    // Needs the webhook id (which the owner stored as `secret`), plus PayPal
    // headers + body + our OAuth token.
    const headers = {
      auth_algo:       request.headers.get('paypal-auth-algo') || '',
      cert_url:        request.headers.get('paypal-cert-url') || '',
      transmission_id: request.headers.get('paypal-transmission-id') || '',
      transmission_sig:request.headers.get('paypal-transmission-sig') || '',
      transmission_time: request.headers.get('paypal-transmission-time') || '',
    };
    if (!headers.transmission_id) return { ok: false, reason: 'no PayPal signature headers' };
    let payload = null;
    try { payload = JSON.parse(rawBody); }
    catch (e) { return { ok: false, reason: 'json-parse failed' }; }

    const pp = await ppToken(env);
    const verifyResp = await fetch(ppBase(env) + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pp, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo:         headers.auth_algo,
        cert_url:          headers.cert_url,
        transmission_id:   headers.transmission_id,
        transmission_sig:  headers.transmission_sig,
        transmission_time: headers.transmission_time,
        webhook_id:        secret,
        webhook_event:     payload,
      }),
    });
    const vr = await verifyResp.json().catch(() => ({}));
    if (vr.verification_status !== 'SUCCESS') {
      return { ok: false, reason: 'PayPal verify: ' + (vr.verification_status || 'unknown') };
    }
    return { ok: true, parsed: payload };
  }

  return { ok: false, reason: 'unknown vendor' };
}

/* Extract {buyerEmail, amount, currency, orderId} from a validated vendor payload. */
function _vendorExtract(vendor, payload) {
  const out = { buyerEmail: null, amount: null, currency: null, orderId: null };
  if (vendor === 'kofi') {
    out.buyerEmail = payload.email || null;
    out.amount     = Number(payload.amount) || null;
    out.currency   = payload.currency || 'USD';
    out.orderId    = payload.kofi_transaction_id || payload.transaction_id || null;
  } else if (vendor === 'payhip') {
    out.buyerEmail = payload.customer_email || payload.email || null;
    out.amount     = Number(payload.price) || Number(payload.amount) || null;
    out.currency   = payload.currency || 'USD';
    out.orderId    = payload.id || payload.transaction_id || null;
  } else if (vendor === 'paypal') {
    // PayPal Webhooks V2: event_type 'CHECKOUT.ORDER.APPROVED' or
    // 'PAYMENT.CAPTURE.COMPLETED' both carry resource.payer + amount.
    const res = payload.resource || {};
    out.buyerEmail = (res.payer && res.payer.email_address) || null;
    const amt = res.amount || (res.gross_amount) || {};
    out.amount     = Number(amt.value) || null;
    out.currency   = amt.currency_code || 'USD';
    out.orderId    = res.id || payload.id || null;
  }
  return out;
}

/* Record the sale for the owner's metrics + audit. Written under
   folio_projects/{folioId}/paid_sales/{ts_uuid}.

   Since AFFILIATE_PROGRAM (Aug 2026): also looks up any active
   affiliate attribution for the buyer + folio and stamps
   affiliationId + affiliateRate + affiliateCommission onto the sale
   record, then bumps the affiliation's ledger totals. Lookup + bump
   are best-effort — a failure there NEVER blocks the sale write.
   `env` is optional to preserve compatibility with any legacy caller
   that doesn't pass it (attribution is skipped without env). */
async function _writeSaleRecord(projectId, token, folioId, sale, env) {
  const docId = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
  // Attribution lookup (safe — returns null on any failure).
  let attribution = null;
  if (env) {
    attribution = await _lookupSaleAttribution(
      projectId, token, folioId, sale.buyerEmail, Number(sale.amount) || 0, env
    );
  }
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents/folio_projects/' +
              encodeURIComponent(folioId) + '/paid_sales?documentId=' + encodeURIComponent(docId);
  const fields = {
    vendor:     { stringValue: String(sale.vendor || 'unknown') },
    orderId:    sale.orderId ? { stringValue: String(sale.orderId) } : { nullValue: null },
    buyerEmail: sale.buyerEmail ? { stringValue: String(sale.buyerEmail) } : { nullValue: null },
    amount:     sale.amount != null ? { doubleValue: Number(sale.amount) } : { nullValue: null },
    currency:   sale.currency ? { stringValue: String(sale.currency) } : { nullValue: null },
    ts:         { timestampValue: sale.ts || new Date().toISOString() },
    affiliationId:      attribution ? { stringValue: attribution.affiliationId }        : { nullValue: null },
    affiliateRate:      attribution ? { doubleValue: attribution.rate }                 : { nullValue: null },
    affiliateCommission:attribution ? { doubleValue: attribution.commission }           : { nullValue: null },
    affiliateSettlementId:                                                                { nullValue: null },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error('sale write ' + r.status + ': ' + JSON.stringify(err));
  }
  // Ledger bump — after sale write so we know the sale is durable.
  if (attribution) {
    await _bumpAffiliationLedger(
      projectId, token, attribution.affiliationId,
      Number(sale.amount) || 0, attribution.commission
    );
    // Fire-and-forget: notify affiliate on their first-ever sale for
    // this affiliation. Email worker dedupes.
    try {
      if (env && env.EMAIL_WORKER_URL && env.EMAIL_WORKER_SECRET) {
        await fetch(env.EMAIL_WORKER_URL + '/send-affiliate-first-sale', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.EMAIL_WORKER_SECRET,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            affiliationId: attribution.affiliationId,
            gross: Number(sale.amount) || 0,
            commission: attribution.commission,
          }),
        });
      }
    } catch (e) { console.warn('[aff-firstsale] email failed:', e && e.message); }
  }
}

/* HMAC-SHA256 helper — returns lowercase hex. */
async function _hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/* Verify a Firebase ID token via Identity Toolkit's :lookup endpoint,
   auth'd with the public Firebase Web API key (the same key that
   ships in every client — the Firebase config in app.html).
   Returns the user's uid if the token is valid + not expired, else null.
   The endpoint validates the token's signature + expiry + audience on
   Google's side, so we don't need to import JWKS + verify RS256 here.

   Falls back to env.FIREBASE_WEB_API_KEY if set (lets us rotate the
   key without a code deploy); otherwise uses the hard-coded default.
   The key is intentionally NOT a secret — treating it as one is a
   common misconception. Firebase security lives in the rules layer,
   not in the key. */
const _FIREBASE_WEB_API_KEY_DEFAULT = 'AIzaSyDxLI57pgS9WX1ekMerbcx8M6aVeWacpy0';
async function _verifyFirebaseIdToken(idToken, env) {
  try {
    if (!idToken || typeof idToken !== 'string') return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const apiKey = env.FIREBASE_WEB_API_KEY || _FIREBASE_WEB_API_KEY_DEFAULT;
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!r.ok) {
      // Surface the actual error into the worker log so future 401s
      // are diagnosable without another round-trip.
      const err = await r.text().catch(() => '');
      console.warn('[verifyIdToken] lookup failed', r.status, err.slice(0, 300));
      return null;
    }
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.users) || !data.users[0]) return null;
    return data.users[0].localId || null;
  } catch (e) {
    console.warn('[verifyIdToken] threw:', e && e.message);
    return null;
  }
}

/* Look up a Firebase user's email by uid. This one DOES need the
   service-account OAuth token because it queries by uid (a privileged
   operation — you can't get someone's email just because you have
   their uid unless you're the project admin). The endpoint path
   differs from the client-key variant above: it uses the
   /projects/{pid}/accounts:lookup form. Falls back to null on any
   error so callers can carry on without the owner-notification
   email (the sale still gets recorded). */
async function _firebaseUserEmail(uid, env) {
  try {
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/projects/' + pid + '/accounts:lookup',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: [uid] }),
      }
    );
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      console.warn('[firebaseUserEmail] lookup failed', r.status, err.slice(0, 300));
      return null;
    }
    const data = await r.json().catch(() => null);
    if (!data || !Array.isArray(data.users) || !data.users[0]) return null;
    return data.users[0].email || null;
  } catch (e) {
    console.warn('[firebaseUserEmail] threw:', e && e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════
   AFFILIATE PROGRAM (Phase 1)
   ────────────────────────────────────────────────────────────────────
   Owner invites affiliates per folio + sets a commission rate.
   Affiliates get a short link (?a=CODE) that sets a 30-day HttpOnly
   cookie in the share worker. Paywall worker (this file) is the
   authority for:
     - minting invites + codes,
     - materialising cookies → attribution docs at sign-in time,
     - looking up attribution at sale time + snapshotting rate,
     - computing commission,
     - bumping ledger totals,
     - recording settlements when the owner marks a payout sent.

   Payout mechanics are DELIBERATELY out of scope — Folio never holds
   the affiliate's money. Owner pays affiliate direct via Ko-fi /
   PayPal; this worker only tracks the ledger. See docs/AFFILIATES_SPEC.md.
   ══════════════════════════════════════════════════════════════════ */

/* 8-char base62 code — ~218 trillion possibilities, cheap collision
   check on write. Uses crypto.getRandomValues for real entropy. */
function _genAffiliateCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % 62];
  return s;
}

/* Parse the folio_aff_<folioId> cookie set by folio-share-worker.js. */
function _readAffilCookie(request, folioId) {
  const raw = request.headers.get('Cookie') || '';
  if (!raw || !folioId) return null;
  const safeKey = 'folio_aff_' + folioId.replace(/[^A-Za-z0-9_-]/g, '_');
  const parts = raw.split(/;\s*/);
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq <= 0) continue;
    if (parts[i].substring(0, eq) === safeKey) {
      const v = parts[i].substring(eq + 1).trim();
      return /^[A-Za-z0-9]{4,16}$/.test(v) ? v : null;
    }
  }
  return null;
}

function _normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

/* Verifies Bearer id-token, returns uid + email or throws a Response.
   Consolidates the 401 boilerplate every affiliate endpoint needs. */
async function _requireAffilAuth(request, env) {
  const hdr = request.headers.get('Authorization') || '';
  const idToken = hdr.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) throw errorJson('Missing auth', 401, request, env);
  const uid = await _verifyFirebaseIdToken(idToken, env);
  if (!uid) throw errorJson('Invalid auth', 401, request, env);
  const email = await _firebaseUserEmail(uid, env);
  return { uid, email: _normalizeEmail(email) };
}

/* Resolve folio → ownerUid. Uses fsGet + the folio_projects doc. */
async function _resolveFolioOwner(projectId, token, folioId) {
  const folio = await fsGet(projectId, token, 'folio_projects/' + encodeURIComponent(folioId));
  if (!folio) return null;
  return folio.uid || folio.ownerId || null;
}

/* Firestore field encoding — mirrors _writeSaleRecord's inline shape. */
function _fsField(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date)      return { timestampValue: v.toISOString() };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(_fsField) } };
  if (typeof v === 'object')  {
    const fields = {};
    for (const k in v) fields[k] = _fsField(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function _fsFields(obj) {
  const out = {};
  for (const k in obj) out[k] = _fsField(obj[k]);
  return out;
}

async function _fsCreate(projectId, token, collection, docId, obj) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/' + collection +
    '?documentId=' + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: _fsFields(obj) }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error('fsCreate ' + collection + '/' + docId + ' → ' + r.status + ' ' + err.slice(0, 300));
  }
  return await r.json();
}

/* PATCH with updateMask so we don't clobber untouched fields. */
async function _fsPatch(projectId, token, collection, docId, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const qs = keys.map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/' + collection + '/' + encodeURIComponent(docId) +
    '?' + qs;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: _fsFields(obj) }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error('fsPatch ' + collection + '/' + docId + ' → ' + r.status + ' ' + err.slice(0, 300));
  }
}

/* List documents in a collection matching a single field-equals query.
   Small helper — full runQuery for compound filters can come later. */
async function _fsQuery(projectId, token, collection, fieldEq) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents:runQuery';
  const filters = [];
  for (const k in fieldEq) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: k },
        op: 'EQUAL',
        value: _fsField(fieldEq[k]),
      },
    });
  }
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: filters.length === 1 ? filters[0] : {
        compositeFilter: { op: 'AND', filters },
      },
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error('fsQuery ' + collection + ' → ' + r.status + ' ' + err.slice(0, 300));
  }
  const rows = await r.json();
  const out = [];
  for (const row of rows) {
    if (!row.document) continue;
    const id = row.document.name.split('/').pop();
    out.push({ id, data: fsDecodeFields(row.document.fields || {}) });
  }
  return out;
}

/* ── POST /affiliates/invite ──────────────────────────────────────
   Body: { folioId, email, rate, note? }
   Owner-only. Creates an 'invited' affiliation, mints a unique code,
   sends invite email via folio-email worker. */
async function handleAffiliateInvite(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const body = await request.json().catch(() => ({}));
  const folioId = String(body.folioId || '').trim();
  const inviteEmail = _normalizeEmail(body.email);
  const rate = Number(body.rate);
  const note = String(body.note || '').slice(0, 300);
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
    return errorJson('Invalid email', 400, request, env);
  }
  if (!(rate > 0 && rate <= 0.75)) {
    return errorJson('Rate must be > 0 and ≤ 0.75', 400, request, env);
  }
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const ownerId = await _resolveFolioOwner(projectId, sa.token, folioId);
  if (!ownerId) return errorJson('Folio not found', 404, request, env);
  if (ownerId !== auth.uid) return errorJson('Not folio owner', 403, request, env);
  if (inviteEmail === auth.email) {
    return errorJson('Cannot self-affiliate', 400, request, env);
  }
  // Dedupe: an owner shouldn't invite the same email twice for the
  // same folio. Look for existing (any status except removed).
  const existing = await _fsQuery(projectId, sa.token, 'folio_affiliations', {
    folioId, affiliateEmail: inviteEmail,
  });
  const live = existing.filter(r => r.data && r.data.status !== 'removed');
  if (live.length) {
    return errorJson('Already invited this email', 409, request, env);
  }
  // Mint unique code (retry on collision — extremely unlikely).
  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = _genAffiliateCode();
    const clash = await _fsQuery(projectId, sa.token, 'folio_affiliations', { code: candidate });
    if (!clash.length) { code = candidate; break; }
  }
  if (!code) return errorJson('Could not mint code', 500, request, env);
  const now = new Date().toISOString();
  const affId = 'aff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await _fsCreate(projectId, sa.token, 'folio_affiliations', affId, {
    folioId, ownerId, ownerEmail: auth.email,
    affiliateUserId: null,
    affiliateEmail: inviteEmail,
    affiliateHandle: null,
    rate, code, status: 'invited',
    invitedAt: now, acceptedAt: null, pausedAt: null, removedAt: null,
    note,
    lifetimeGross: 0, lifetimeCommission: 0,
    pendingCommission: 0, settledCommission: 0,
  });
  // Fire-and-forget email (best-effort — we don't fail the invite if
  // the email worker is down; owner sees the affiliation immediately).
  try {
    if (env.EMAIL_WORKER_URL && env.EMAIL_WORKER_SECRET) {
      await fetch(env.EMAIL_WORKER_URL + '/send-affiliate-invite', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.EMAIL_WORKER_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          affiliationId: affId, folioId, ownerEmail: auth.email,
          affiliateEmail: inviteEmail, rate, code,
        }),
      });
    }
  } catch (e) { console.warn('[aff-invite] email failed:', e && e.message); }
  return json({ ok: true, affiliationId: affId, code }, 200, request, env);
}

/* ── GET /affiliates/list?folio=<folioId> ─────────────────────────
   Owner-only. Lists every affiliation for a folio + ledger totals. */
async function handleAffiliateList(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const ownerId = await _resolveFolioOwner(projectId, sa.token, folioId);
  if (!ownerId) return errorJson('Folio not found', 404, request, env);
  if (ownerId !== auth.uid) return errorJson('Not folio owner', 403, request, env);
  const rows = await _fsQuery(projectId, sa.token, 'folio_affiliations', { folioId });
  const affiliates = rows
    .filter(r => r.data && r.data.status !== 'removed')
    .map(r => ({ id: r.id, ...r.data }));
  return json({ ok: true, affiliates }, 200, request, env);
}

/* ── GET /affiliates/mine ─────────────────────────────────────────
   Signed-in-user view: every affiliation they hold (accepted or
   invited). Backs the /affiliate dashboard. */
async function handleAffiliateMine(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  // Accepted (linked to uid) — the common case.
  const active = await _fsQuery(projectId, sa.token, 'folio_affiliations', {
    affiliateUserId: auth.uid,
  });
  // Invited-but-not-yet-accepted (linked to email only).
  const invited = auth.email
    ? await _fsQuery(projectId, sa.token, 'folio_affiliations', {
        affiliateEmail: auth.email, status: 'invited',
      })
    : [];
  const seen = new Set();
  const affiliations = [];
  for (const r of [...active, ...invited]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.data && r.data.status !== 'removed') {
      affiliations.push({ id: r.id, ...r.data });
    }
  }
  return json({ ok: true, affiliations }, 200, request, env);
}

/* ── POST /affiliates/accept ──────────────────────────────────────
   Body: { affiliationId }
   Signed-in affiliate whose email matches the invite flips the
   affiliation from 'invited' to 'active' and stamps their userId +
   a default handle (email prefix). Server-mediated so we control
   the fields being set and the invite email match. */
async function handleAffiliateAccept(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const body = await request.json().catch(() => ({}));
  const affiliationId = String(body.affiliationId || '').trim();
  if (!affiliationId) return errorJson('Missing affiliationId', 400, request, env);
  if (!auth.email)    return errorJson('Account missing email', 400, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const aff = await fsGet(projectId, sa.token, 'folio_affiliations/' + encodeURIComponent(affiliationId));
  if (!aff) return errorJson('Not found', 404, request, env);
  if (aff.status !== 'invited') {
    return errorJson('Already ' + aff.status, 409, request, env);
  }
  if (_normalizeEmail(aff.affiliateEmail) !== auth.email) {
    return errorJson('This invite was sent to a different email', 403, request, env);
  }
  const handle = auth.email.split('@')[0] || 'affiliate';
  await _fsPatch(projectId, sa.token, 'folio_affiliations', affiliationId, {
    status: 'active',
    affiliateUserId: auth.uid,
    affiliateHandle: handle,
    acceptedAt: new Date().toISOString(),
  });
  return json({ ok: true, affiliationId, status: 'active' }, 200, request, env);
}

/* ── POST /affiliates/edit-rate ───────────────────────────────────
   Body: { affiliationId, rate }
   Owner-only. Rate changes apply to FUTURE sales only — existing
   purchase records keep their snapshotted rate. */
async function handleAffiliateEditRate(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const body = await request.json().catch(() => ({}));
  const affiliationId = String(body.affiliationId || '').trim();
  const rate = Number(body.rate);
  if (!affiliationId) return errorJson('Missing affiliationId', 400, request, env);
  if (!(rate > 0 && rate <= 0.75)) return errorJson('Rate must be > 0 and ≤ 0.75', 400, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const aff = await fsGet(projectId, sa.token, 'folio_affiliations/' + encodeURIComponent(affiliationId));
  if (!aff) return errorJson('Not found', 404, request, env);
  if (aff.ownerId !== auth.uid) return errorJson('Not owner', 403, request, env);
  await _fsPatch(projectId, sa.token, 'folio_affiliations', affiliationId, { rate });
  return json({ ok: true }, 200, request, env);
}

/* ── POST /affiliates/pause  &  /affiliates/remove ────────────────
   Body: { affiliationId }
   Owner-only. Pause blocks new attribution but preserves ledger.
   Remove is a soft-delete (status = 'removed') — history stays. */
async function _setAffiliationStatus(request, env, newStatus) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const body = await request.json().catch(() => ({}));
  const affiliationId = String(body.affiliationId || '').trim();
  if (!affiliationId) return errorJson('Missing affiliationId', 400, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const aff = await fsGet(projectId, sa.token, 'folio_affiliations/' + encodeURIComponent(affiliationId));
  if (!aff) return errorJson('Not found', 404, request, env);
  if (aff.ownerId !== auth.uid) return errorJson('Not owner', 403, request, env);
  const patch = { status: newStatus };
  const now = new Date().toISOString();
  if (newStatus === 'paused')  patch.pausedAt  = now;
  if (newStatus === 'removed') patch.removedAt = now;
  if (newStatus === 'active')  patch.pausedAt  = null;  // resume
  await _fsPatch(projectId, sa.token, 'folio_affiliations', affiliationId, patch);
  return json({ ok: true, status: newStatus }, 200, request, env);
}

/* ── POST /affiliates/materialize?folio=<folioId> ─────────────────
   Called by app.html once the user signs in on a reader page. Reads
   the folio_aff_<folioId> cookie set by the share worker and writes a
   persistent attribution doc keyed by (userId, folioId) so the sale
   can be attributed even if the buyer clears cookies or purchases
   from another device. First-touch: if an attribution already exists
   for this user+folio we DO NOT overwrite it. */
async function handleAffiliateMaterialize(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  // Cookie path (same-origin caller — share worker at onfolio.press).
  // Body-code path (proxy caller passed the cookie value in the body so
  // the cookie itself doesn't have to cross origins). Cookie wins when
  // both are present because it's less tamperable.
  let code = _readAffilCookie(request, folioId);
  if (!code) {
    try {
      const body = await request.json().catch(() => ({}));
      const bodyCode = String(body.code || '').trim();
      if (/^[A-Za-z0-9]{4,16}$/.test(bodyCode)) code = bodyCode;
    } catch (_) {}
  }
  if (!code) return json({ ok: true, attributed: false, reason: 'no-cookie' }, 200, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const matches = await _fsQuery(projectId, sa.token, 'folio_affiliations', {
    code, folioId, status: 'active',
  });
  if (!matches.length) {
    return json({ ok: true, attributed: false, reason: 'code-not-active' }, 200, request, env);
  }
  const aff = matches[0];
  // Self-purchase can't earn commission.
  if (aff.data.ownerId === auth.uid || aff.data.affiliateUserId === auth.uid) {
    return json({ ok: true, attributed: false, reason: 'self' }, 200, request, env);
  }
  const attributionId = auth.uid + '_' + folioId.replace(/[^A-Za-z0-9_-]/g, '_');
  const existing = await fsGet(projectId, sa.token,
    'folio_affiliate_attributions/' + encodeURIComponent(attributionId));
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  if (existing && existing.affiliationId) {
    // First-touch wins — just refresh lastTouchAt.
    await _fsPatch(projectId, sa.token, 'folio_affiliate_attributions', attributionId, {
      lastTouchAt: nowIso,
    });
    return json({ ok: true, attributed: true, firstTouch: false }, 200, request, env);
  }
  await _fsCreate(projectId, sa.token, 'folio_affiliate_attributions', attributionId, {
    affiliationId: aff.id, folioId,
    userId: auth.uid, userEmail: auth.email,
    firstTouchAt: nowIso, lastTouchAt: nowIso, expiresAt,
  });
  return json({ ok: true, attributed: true, firstTouch: true }, 200, request, env);
}

/* ── POST /affiliates/settle ──────────────────────────────────────
   Body: { affiliationId, amount, method, externalTxnRef?, note? }
   Owner-only. Records that the owner paid the affiliate `amount`,
   moves that amount from pendingCommission to settledCommission,
   and tags the covered purchase docs. Best-effort tagging — if the
   owner has paid slightly more or less than pending, we settle the
   requested amount and let the ledger show the diff. */
async function handleAffiliateSettle(request, env) {
  let auth;
  try { auth = await _requireAffilAuth(request, env); } catch (r) { return r; }
  const body = await request.json().catch(() => ({}));
  const affiliationId = String(body.affiliationId || '').trim();
  const amount = Number(body.amount);
  const method = String(body.method || 'other');
  const externalTxnRef = String(body.externalTxnRef || '').slice(0, 200);
  const note = String(body.note || '').slice(0, 300);
  if (!affiliationId) return errorJson('Missing affiliationId', 400, request, env);
  if (!(amount > 0)) return errorJson('Amount must be > 0', 400, request, env);
  const sa = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
  const aff = await fsGet(projectId, sa.token, 'folio_affiliations/' + encodeURIComponent(affiliationId));
  if (!aff) return errorJson('Not found', 404, request, env);
  if (aff.ownerId !== auth.uid) return errorJson('Not owner', 403, request, env);
  const now = new Date().toISOString();
  const settlementId = 'set_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await _fsCreate(projectId, sa.token, 'folio_affiliate_settlements', settlementId, {
    affiliationId, folioId: aff.folioId,
    ownerId: aff.ownerId, affiliateUserId: aff.affiliateUserId,
    amount, method, externalTxnRef, note,
    settledAt: now,
    purchaseIds: [],  // Phase-2: enumerate covered purchases
  });
  const newPending  = Math.max(0, (aff.pendingCommission  || 0) - amount);
  const newSettled  =            (aff.settledCommission  || 0) + amount;
  await _fsPatch(projectId, sa.token, 'folio_affiliations', affiliationId, {
    pendingCommission: newPending,
    settledCommission: newSettled,
  });
  // Fire-and-forget notify affiliate.
  try {
    if (env.EMAIL_WORKER_URL && env.EMAIL_WORKER_SECRET && aff.affiliateEmail) {
      await fetch(env.EMAIL_WORKER_URL + '/send-affiliate-payment-received', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.EMAIL_WORKER_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          affiliateEmail: aff.affiliateEmail, amount, method,
          folioId: aff.folioId, note,
        }),
      });
    }
  } catch (e) { console.warn('[aff-settle] email failed:', e && e.message); }
  return json({ ok: true, settlementId, pendingCommission: newPending, settledCommission: newSettled }, 200, request, env);
}

/* Attribution lookup called from _writeSaleRecord. Returns
   { affiliationId, rate, commission } or null. NEVER throws — a
   lookup failure must not block the sale from being recorded. */
async function _lookupSaleAttribution(projectId, token, folioId, buyerEmail, amount, env) {
  try {
    if (!folioId || !amount || amount <= 0) return null;
    // Prefer userId-keyed attribution (survives cookie clear); fall
    // back to buyer email if the attribution was materialised under a
    // different signed-in account than the checkout account.
    let attribution = null;
    if (buyerEmail) {
      const attrByEmail = await _fsQuery(projectId, token,
        'folio_affiliate_attributions', {
          userEmail: _normalizeEmail(buyerEmail), folioId,
        });
      if (attrByEmail.length) attribution = attrByEmail[0].data;
    }
    if (!attribution) return null;
    if (attribution.expiresAt && new Date(attribution.expiresAt).getTime() < Date.now()) {
      return null;  // expired 30-day window
    }
    const aff = await fsGet(projectId, token,
      'folio_affiliations/' + encodeURIComponent(attribution.affiliationId));
    if (!aff) return null;
    if (aff.status !== 'active') return null;
    const rate = Number(aff.rate) || 0;
    if (!(rate > 0 && rate <= 0.75)) return null;
    const commission = Math.round(amount * rate * 100) / 100;
    return { affiliationId: attribution.affiliationId, rate, commission };
  } catch (e) {
    console.warn('[aff-lookup] threw:', e && e.message);
    return null;
  }
}

/* Best-effort ledger bump after a sale is recorded. Non-transactional
   for MVP — sale doc already carries the attribution so we can
   reconcile if this fails. */
async function _bumpAffiliationLedger(projectId, token, affiliationId, gross, commission) {
  try {
    const aff = await fsGet(projectId, token,
      'folio_affiliations/' + encodeURIComponent(affiliationId));
    if (!aff) return;
    await _fsPatch(projectId, token, 'folio_affiliations', affiliationId, {
      lifetimeGross:     (aff.lifetimeGross     || 0) + gross,
      lifetimeCommission:(aff.lifetimeCommission|| 0) + commission,
      pendingCommission: (aff.pendingCommission || 0) + commission,
    });
  } catch (e) { console.warn('[aff-bump] threw:', e && e.message); }
}

/* ══════════════════════════════════════════════════════════════════
   MULTI-TENANT VENDOR WEBHOOKS
   ────────────────────────────────────────────────────────────────────
   Ko-fi / Payhip / PayPal each allow only ONE webhook URL per account.
   The single-tenant flow above (/vendor-webhook/{folioId}) required a
   unique URL per folio, so authors with 2+ paid books couldn't use
   the same vendor account for all of them. This section fixes that.

   Design:
     - Owner sets one config PER VENDOR PER ACCOUNT (not per folio),
       stored in folio_vendor_owner_configs/{ownerUid}. Config carries
       the vendor secret + owner email + when it was updated.
     - Owner pastes ONE Folio webhook URL into their vendor account
       (e.g. https://.../kofi-webhook). Same URL for every purchase.
     - On webhook: validate signature → look up owner by matching
       secret → extract product identifier from payload → find that
       owner's folio whose release.checkoutUrl contains the identifier
       → mint JWT for THAT folio → dispatch email.

   Vendor-specific product-to-folio matching:
     Ko-fi:   shop_items[].direct_link_code (short slug like 'a1a00a3286')
              matched to /s/{slug} segment of release.checkoutUrl
     Payhip:  product_link URL matched directly to release.checkoutUrl
     PayPal:  reference_id / item name matched to release.checkoutUrl
              — PayPal.me lacks a clean product identifier so matching
              is heuristic. Best used when the owner has ≤1 PayPal-
              backed folio; PayPal invoicing/products API would give
              clean IDs but requires more setup.

   The legacy /vendor-webhook/{folioId} endpoint stays live for
   backwards compat — folios already configured that way keep working.
   ══════════════════════════════════════════════════════════════════ */

/* POST /vendor-owner-config
   Owner writes their per-vendor account-wide config.
   Body: { vendor, secret, enabled }
   Auth: Firebase ID token in Authorization: Bearer <token>
*/
async function handleVendorOwnerConfig(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured (service account)', 500, request, env);
  const authHdr = request.headers.get('Authorization') || '';
  const idToken = authHdr.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return errorJson('Authorization: Bearer <firebase-id-token> required', 401, request, env);

  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }

  const vendor  = String((body && body.vendor)  || '').trim().toLowerCase();
  const secret  = String((body && body.secret)  || '').trim();
  // PayPal Native carries a clientId (public — used in the buttons SDK
  // URL) alongside the client secret. Every other vendor stores only
  // the single `secret` value (kofi verification token, payhip HMAC
  // signing secret, paypal webhook id).
  const clientId = String((body && body.clientId) || '').trim();
  const enabled = body && body.enabled === false ? false : true;

  if (enabled && !_VENDOR_KINDS.has(vendor)) {
    return errorJson('Unknown vendor. Supported: kofi, payhip, paypal, paypal_native', 400, request, env);
  }
  if (enabled && !secret) return errorJson('Missing secret', 400, request, env);
  if (enabled && vendor === 'paypal_native' && !clientId) {
    return errorJson('PayPal Native requires clientId (public) alongside secret', 400, request, env);
  }

  try {
    const uid = await _verifyFirebaseIdToken(idToken, env);
    if (!uid) return errorJson('Invalid Firebase ID token', 401, request, env);

    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const ownerEmail = await _firebaseUserEmail(uid, env).catch(() => null);

    // Read existing config (may be empty) so we merge per-vendor rather
    // than clobber other vendors the owner may have configured.
    const existing = await fsGet(pid, auth.token, 'folio_vendor_owner_configs/' + encodeURIComponent(uid)).catch(() => null);
    const vendorMap = (existing && existing.vendors && typeof existing.vendors === 'object') ? { ...existing.vendors } : {};
    if (enabled) {
      const entry = { secret, ownerEmail: ownerEmail || null, updatedAt: new Date().toISOString() };
      if (vendor === 'paypal_native') entry.clientId = clientId;
      vendorMap[vendor] = entry;
    } else {
      delete vendorMap[vendor];
    }

    // Write. Firestore REST needs typed values.
    const vendorMapFields = {};
    for (const v of Object.keys(vendorMap)) {
      const inner = {
        secret:     { stringValue: String(vendorMap[v].secret || '') },
        ownerEmail: vendorMap[v].ownerEmail ? { stringValue: vendorMap[v].ownerEmail } : { nullValue: null },
        updatedAt:  { stringValue: String(vendorMap[v].updatedAt || new Date().toISOString()) },
      };
      if (vendorMap[v].clientId) inner.clientId = { stringValue: String(vendorMap[v].clientId) };
      vendorMapFields[v] = { mapValue: { fields: inner } };
    }

    const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
                '/databases/(default)/documents/folio_vendor_owner_configs/' + encodeURIComponent(uid);
    const fields = {
      ownerUid:   { stringValue: uid },
      ownerEmail: ownerEmail ? { stringValue: ownerEmail } : { nullValue: null },
      vendors:    { mapValue: { fields: vendorMapFields } },
      updatedAt:  { timestampValue: new Date().toISOString() },
    };

    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return errorJson('Config write failed: ' + ((err.error && err.error.message) || r.status), 502, request, env);
    }

    // Return the vendor's webhook URL so owner can copy-paste. PayPal
    // Native doesn't use a webhook — the buttons SDK calls our create/
    // capture endpoints directly, so no URL to configure vendor-side.
    const origin = new URL(request.url).origin;
    const usesWebhook = enabled && vendor !== 'paypal_native';
    const webhookUrl = usesWebhook ? (origin + '/' + vendor + '-webhook') : null;
    return json({
      ok: true,
      vendor,
      enabled,
      webhookUrl,
      configured: Object.keys(vendorMap),
    }, 200, request, env);
  } catch (e) {
    return errorJson('Config failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* ══════════════════════════════════════════════════════════════════
   PATH A — PayPal Buttons native checkout
   ──────────────────────────────────────────────────────────────────
   Author-native, popup-based PayPal checkout that never leaves Folio.
   Reader hits a paid folio, sees the PayPal Buttons SDK inline on the
   paywall, clicks a button, popup opens for PayPal login/approval,
   popup closes on approval, worker captures the payment against the
   AUTHOR's PayPal Business account, mints an unlock JWT, dispatches
   the confirmation emails. Same downstream flow as Ko-fi webhook.

   Key architectural decision: the author's PayPal credentials
   (Client ID + Secret) are used for both order creation AND capture,
   so payment lands DIRECTLY in the author's PayPal account. Folio is
   never merchant of record. No pass-through, no revenue sharing, no
   platform-level tax complications. Same "0% cut" invariant as the
   redirect vendors.

   Three endpoints:
     GET  /paypal-native-config?folio=<id> — public. Returns the
          author's PayPal Client ID (safe to expose — it's what
          the SDK URL embeds) + price + currency + folio meta so
          the paywall can render Buttons.
     POST /paypal-create-order — server-side order creation via the
          author's PayPal credentials. Returns { orderId }.
     POST /paypal-capture-order — server-side capture after the
          buyer approves. On success: mint JWT, record sale,
          dispatch emails, return { ok, token, unlockUrl }.
   ══════════════════════════════════════════════════════════════════ */

/* Parameterized version of ppAccessToken that uses SPECIFIC credentials
   (the author's, not Jacob's platform ones). Lets us call PayPal APIs
   on behalf of an individual author for their own paid folios. */
async function ppAccessTokenFor(clientId, clientSecret, mode) {
  if (!clientId || !clientSecret) throw new Error('Missing PayPal credentials');
  const base = (mode === 'live') ? PP_LIVE : PP_SANDBOX;
  const basic = btoa(clientId + ':' + clientSecret);
  const r = await fetch(base + '/v1/oauth2/token', {
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
  return { token: data.access_token, base };
}

/* Load a folio's PayPal Native config (owner's clientId + secret + mode)
   and pricing from the folio doc. Returns null if the folio isn't
   configured for PayPal Native. */
async function _loadPaypalNativeConfig(env, folioId) {
  if (!env.GCP_SERVICE_ACCOUNT) throw new Error('Server not configured');
  const auth = await getAccessToken(env);
  const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
  const folio = await fsGet(pid, auth.token, 'folio_projects/' + encodeURIComponent(folioId));
  if (!folio) return null;
  const rel = folio.release || {};
  if (rel.priceMode !== 'paid' || rel.provider !== 'paypal_native') return null;
  const ownerUid = folio.uid;
  if (!ownerUid) return null;
  const cfg = await fsGet(pid, auth.token, 'folio_vendor_owner_configs/' + encodeURIComponent(ownerUid));
  const vendors = (cfg && cfg.vendors) || {};
  const pn = vendors.paypal_native;
  if (!pn || !pn.secret || !pn.clientId) return null;
  return {
    folio,
    ownerUid,
    ownerEmail: pn.ownerEmail || null,
    clientId: String(pn.clientId),
    clientSecret: String(pn.secret),
    mode: (env.PAYPAL_MODE === 'live') ? 'live' : 'sandbox',
    price: Number(rel.price) || 0,
    currency: String(rel.currency || 'USD'),
    title: String(rel.title || folio.name || 'Folio'),
    author: String(rel.author || ''),
  };
}

/* GET /paypal-native-config?folio=<id>
   Public. Returns the author's PayPal Client ID (safe to expose — it's
   embedded in the Buttons SDK URL by design), price, currency, folio
   title/author. Client uses this to load the PayPal SDK and render
   the Buttons on the paywall. */
async function handlePaypalNativeConfig(request, env) {
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  try {
    const cfg = await _loadPaypalNativeConfig(env, folioId);
    if (!cfg) return errorJson('Folio not configured for PayPal Native', 404, request, env);
    return json({
      ok: true,
      folioId,
      clientId: cfg.clientId,
      currency: cfg.currency,
      price:    cfg.price,
      title:    cfg.title,
      author:   cfg.author,
      mode:     cfg.mode,
    }, 200, request, env);
  } catch (e) {
    return errorJson('Config lookup failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* POST /paypal-create-order
   Body: { folioId, buyerEmail? }
   Creates a PayPal order in the author's account for the folio price,
   returns { orderId } for the Buttons SDK to open the popup with. */
async function handlePaypalCreateOrder(request, env) {
  let body;
  try { body = await request.json(); }
  catch (_) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId = String((body && body.folioId) || '').trim();
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  try {
    const cfg = await _loadPaypalNativeConfig(env, folioId);
    if (!cfg) return errorJson('Folio not configured for PayPal Native', 404, request, env);
    if (!cfg.price || cfg.price <= 0) return errorJson('Folio has no price set', 400, request, env);
    const pp = await ppAccessTokenFor(cfg.clientId, cfg.clientSecret, cfg.mode);
    const r = await fetch(pp.base + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pp.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: folioId,
          description: String(cfg.title).slice(0, 127),
          amount: { currency_code: cfg.currency, value: cfg.price.toFixed(2) },
        }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) {
      return errorJson('PayPal create failed: ' + (data.message || data.error || r.status), 502, request, env);
    }
    return json({ ok: true, orderId: data.id }, 200, request, env);
  } catch (e) {
    return errorJson('Create order failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* POST /paypal-capture-order
   Body: { folioId, orderId, buyerEmail? }
   Captures the approved order. On success: mint the unlock JWT, record
   the sale under paid_sales/, dispatch buyer + owner emails via the
   email worker. Returns { ok, token, unlockUrl } so the paywall can
   immediately stash the token in localStorage and unlock content
   without waiting for the email. */
async function handlePaypalCaptureOrder(request, env) {
  if (!env.PAYWALL_JWT_SECRET) return errorJson('Server not configured', 500, request, env);
  let body;
  try { body = await request.json(); }
  catch (_) { return errorJson('Bad JSON body', 400, request, env); }
  const folioId = String((body && body.folioId) || '').trim();
  const orderId = String((body && body.orderId) || '').trim();
  const suppliedBuyerEmail = String((body && body.buyerEmail) || '').trim();
  if (!folioId || !orderId) return errorJson('Missing folioId or orderId', 400, request, env);
  try {
    const cfg = await _loadPaypalNativeConfig(env, folioId);
    if (!cfg) return errorJson('Folio not configured for PayPal Native', 404, request, env);
    const pp = await ppAccessTokenFor(cfg.clientId, cfg.clientSecret, cfg.mode);
    const r = await fetch(pp.base + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pp.token, 'Content-Type': 'application/json' },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.status !== 'COMPLETED') {
      return errorJson('PayPal capture failed: ' + (data.message || data.error || r.status), 502, request, env);
    }
    // Extract buyer email + captured amount from the response.
    const payer = data.payer || {};
    const buyerEmail = suppliedBuyerEmail || payer.email_address || '';
    const captureRes = (data.purchase_units && data.purchase_units[0] &&
                        data.purchase_units[0].payments &&
                        data.purchase_units[0].payments.captures &&
                        data.purchase_units[0].payments.captures[0]) || {};
    const capturedAmount = (captureRes.amount && captureRes.amount.value) || cfg.price.toFixed(2);
    const capturedCurrency = (captureRes.amount && captureRes.amount.currency_code) || cfg.currency;
    if (!buyerEmail) {
      return errorJson('PayPal capture succeeded but no buyer email available', 502, request, env);
    }

    // Mint unlock JWT (same shape as Ko-fi flow).
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (365 * 86400);
    const sub = await sha256ShortHex(orderId + '::' + folioId + '::' + buyerEmail, 8);
    const jwtPayload = {
      sub,
      release:    folioId,
      product:    null,
      provider:   'paypal_native',
      purchaseId: orderId,
      email:      buyerEmail,
      iat: now,
      exp,
    };
    const token = await signJWT(jwtPayload, env.PAYWALL_JWT_SECRET);
    const origin = allowedOrigins(env)[0] || (new URL(request.url).origin);
    const unlockUrl = origin + '/app.html?read=' + encodeURIComponent(folioId) +
                      '&pwToken=' + encodeURIComponent(token);

    // Record sale + dispatch emails (best-effort — don't fail the
    // capture response over email issues; buyer already paid).
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    _writeSaleRecord(pid, acc.token, folioId, {
      vendor: 'paypal_native',
      orderId,
      buyerEmail,
      amount: Number(capturedAmount) || cfg.price,
      currency: capturedCurrency,
      ts: new Date().toISOString(),
    }, env).catch(function(){});

    if (env.EMAIL_WORKER_SECRET) {
      const emailReqBody = JSON.stringify({
        folioId,
        folioTitle: cfg.title,
        folioAuthor: cfg.author,
        buyerEmail,
        ownerEmail: cfg.ownerEmail || null,
        amount: Number(capturedAmount) || cfg.price,
        currency: capturedCurrency,
        unlockUrl,
        vendor: 'paypal_native',
      });
      const emailReqHeaders = { 'Content-Type': 'application/json', 'X-Internal-Secret': env.EMAIL_WORKER_SECRET };
      try {
        if (env.EMAIL_WORKER && typeof env.EMAIL_WORKER.fetch === 'function') {
          await env.EMAIL_WORKER.fetch('https://internal/send-unlock', {
            method: 'POST', headers: emailReqHeaders, body: emailReqBody,
          });
        } else {
          const _url = env.EMAIL_WORKER_URL || 'https://folio-email.jacobdsiler.workers.dev';
          await fetch(_url.replace(/\/$/, '') + '/send-unlock', {
            method: 'POST', headers: emailReqHeaders, body: emailReqBody,
          });
        }
      } catch (e) {
        console.warn('[paypal-capture] email dispatch failed:', e && e.message);
      }
    }

    return json({
      ok: true,
      token,
      unlockUrl,
      folioId,
      buyerEmail,
      amount: Number(capturedAmount) || cfg.price,
      currency: capturedCurrency,
    }, 200, request, env);
  } catch (e) {
    return errorJson('Capture failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* GET /vendor-owner-config — owner reads their current config (secrets returned as booleans, not values). */
async function handleVendorOwnerConfigGet(request, env) {
  const authHdr = request.headers.get('Authorization') || '';
  const idToken = authHdr.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return errorJson('Authorization: Bearer <firebase-id-token> required', 401, request, env);
  try {
    const uid = await _verifyFirebaseIdToken(idToken, env);
    if (!uid) return errorJson('Invalid Firebase ID token', 401, request, env);
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const cfg = await fsGet(pid, auth.token, 'folio_vendor_owner_configs/' + encodeURIComponent(uid)).catch(() => null);
    const origin = new URL(request.url).origin;
    const vendors = (cfg && cfg.vendors) || {};
    // Return only presence + updatedAt per vendor, never the secret value.
    // clientId (paypal_native only) IS returned — it's public by design
    // (embedded in the PayPal Buttons SDK URL that renders on paywalls).
    const out = {};
    for (const v of Object.keys(vendors)) {
      const usesWebhook = v !== 'paypal_native';
      out[v] = {
        configured: !!vendors[v].secret,
        updatedAt: vendors[v].updatedAt || null,
        webhookUrl: usesWebhook ? (origin + '/' + v + '-webhook') : null,
      };
      if (v === 'paypal_native' && vendors[v].clientId) {
        out[v].clientId = String(vendors[v].clientId);
      }
    }
    return json({ ok: true, vendors: out }, 200, request, env);
  } catch (e) {
    return errorJson('Config read failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* POST /kofi-webhook, /payhip-webhook, /paypal-webhook
   Multi-tenant webhook. Vendor identified from URL path. Owner
   identified by matching secret against folio_vendor_owner_configs.
   Folio identified by matching product identifier from payload
   against owner's release.checkoutUrl. */
async function handleMultiTenantVendorWebhook(request, env, vendor) {
  if (!_VENDOR_KINDS.has(vendor)) return errorJson('Unknown vendor', 400, request, env);
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured', 500, request, env);
  if (!env.PAYWALL_JWT_SECRET)  return errorJson('Server not configured', 500, request, env);

  const rawBody = await request.text();

  try {
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;

    // Parse payload to extract the secret / verification token from it,
    // so we can look up the owner. Different vendors put it in
    // different places; extract based on vendor.
    let payload = null;
    try {
      if (vendor === 'kofi' && rawBody.startsWith('data=')) {
        // Ko-fi form-encoded
        const form = new URLSearchParams(rawBody);
        payload = JSON.parse(form.get('data') || '{}');
      } else {
        payload = JSON.parse(rawBody);
      }
    } catch (e) {
      return errorJson('Bad payload — could not parse', 400, request, env);
    }

    // For Ko-fi + Payhip: secret is inside the payload (Ko-fi's
    // verification_token, Payhip has one too). For PayPal we need to
    // find the owner by webhook_id header first, then verify the
    // signature via PayPal's API.
    let ownerConfig = null;
    let ownerUid    = null;

    if (vendor === 'kofi') {
      const token = String((payload && payload.verification_token) || '');
      if (!token) return errorJson('Ko-fi payload missing verification_token', 400, request, env);
      const found = await _findOwnerByVendorSecret(pid, auth.token, vendor, token);
      if (!found) return errorJson('No owner configured with this Ko-fi token', 401, request, env);
      ownerConfig = found.config;
      ownerUid    = found.ownerUid;
    } else if (vendor === 'payhip') {
      // Payhip: HMAC signature in header, we need to enumerate owners.
      // For per-vendor multi-tenant with Payhip we'd typically also
      // require the payload to carry an identifier or the owner
      // uid — Payhip's product_link matches, so we can look up owner
      // by iterating configured payhip owners. For simplicity + speed,
      // we require a payhip Signature match. Rare vendor, small owner
      // set — full-scan iteration works.
      const found = await _findPayhipOwnerBySignature(pid, auth.token, request, rawBody);
      if (!found) return errorJson('Payhip signature did not match any configured owner', 401, request, env);
      ownerConfig = found.config;
      ownerUid    = found.ownerUid;
      // payload already parsed above
    } else if (vendor === 'paypal') {
      // PayPal Webhooks V2: verify signature against webhook_id in
      // config. Enumerate paypal-configured owners; whichever verifies
      // wins. Same iteration approach as Payhip.
      const found = await _findPaypalOwnerBySignature(pid, auth.token, request, rawBody, payload, env);
      if (!found) return errorJson('PayPal signature did not verify against any configured owner', 401, request, env);
      ownerConfig = found.config;
      ownerUid    = found.ownerUid;
    }

    // Extract product identifier + buyer info.
    const extracted = _vendorExtract(vendor, payload);
    if (!extracted.buyerEmail) return errorJson('Vendor payload missing buyer email', 400, request, env);

    // Find the owner's folio whose release.checkoutUrl matches the
    // vendor-specific product identifier.
    const folio = await _findFolioByProduct(pid, auth.token, ownerUid, vendor, payload, extracted);
    if (!folio) {
      console.warn('[' + vendor + '-webhook] purchase received but no matching folio found for owner', ownerUid);
      // Still return 200 so the vendor doesn't retry — sale is real,
      // we just can't route it. Log for manual investigation.
      return json({ ok: true, warning: 'no matching folio' }, 200, request, env);
    }
    const folioId = folio.id;
    const release = folio.data.release || {};
    const folioTitle = String(release.title || folio.data.name || 'Your folio');
    const folioAuthor = String(release.author || '');

    // Mint JWT + record sale + dispatch email — same logic as legacy path.
    const now = Math.floor(Date.now() / 1000);
    const days = 365;
    const exp = now + (days * 86400);
    const sub = await sha256ShortHex((extracted.orderId || '') + '::' + folioId + '::' + extracted.buyerEmail, 8);
    const jwtPayload = {
      sub,
      release:    folioId,
      product:    null,
      provider:   vendor,
      purchaseId: extracted.orderId || null,
      email:      extracted.buyerEmail,
      iat: now,
      exp,
    };
    const token = await signJWT(jwtPayload, env.PAYWALL_JWT_SECRET);
    const origin = allowedOrigins(env)[0] || (new URL(request.url).origin);
    const unlockUrl = origin + '/app.html?read=' + encodeURIComponent(folioId) +
                      '&pwToken=' + encodeURIComponent(token);

    // Record + email.
    _writeSaleRecord(pid, auth.token, folioId, {
      vendor, orderId: extracted.orderId, buyerEmail: extracted.buyerEmail,
      amount: extracted.amount, currency: extracted.currency,
      ts: new Date().toISOString(),
    }, env).catch(function(){});

    if (env.EMAIL_WORKER_SECRET) {
      const emailReqBody = JSON.stringify({
        folioId, folioTitle, folioAuthor,
        buyerEmail: extracted.buyerEmail,
        ownerEmail: ownerConfig.ownerEmail || null,
        amount: extracted.amount, currency: extracted.currency,
        unlockUrl, vendor,
      });
      const emailReqHeaders = { 'Content-Type': 'application/json', 'X-Internal-Secret': env.EMAIL_WORKER_SECRET };
      try {
        let emailResp;
        if (env.EMAIL_WORKER && typeof env.EMAIL_WORKER.fetch === 'function') {
          emailResp = await env.EMAIL_WORKER.fetch('https://internal/send-unlock', {
            method: 'POST', headers: emailReqHeaders, body: emailReqBody,
          });
        } else {
          const _url = env.EMAIL_WORKER_URL || 'https://folio-email.jacobdsiler.workers.dev';
          emailResp = await fetch(_url.replace(/\/$/, '') + '/send-unlock', {
            method: 'POST', headers: emailReqHeaders, body: emailReqBody,
          });
        }
        if (!emailResp.ok) {
          const et = await emailResp.text().catch(() => '');
          console.warn('[' + vendor + '-webhook] email dispatch failed:', emailResp.status, et);
        } else {
          console.log('[' + vendor + '-webhook] email dispatched for folio', folioId);
        }
      } catch (e) {
        console.warn('[' + vendor + '-webhook] email dispatch threw:', e && e.message);
      }
    }

    return json({ ok: true, folioId }, 200, request, env);
  } catch (e) {
    console.warn('[' + vendor + '-webhook] error', e && (e.stack || e.message || e));
    return errorJson('Webhook error: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* Look up owner by matching a secret against their configured vendor
   secret. Iterates owner configs — small set (one per Folio account),
   so O(n) is fine. Returns { ownerUid, config } or null. */
async function _findOwnerByVendorSecret(projectId, token, vendor, secret) {
  const rows = await _plList(token, projectId, 'folio_vendor_owner_configs', 500);
  for (const row of rows) {
    const vendors = (row.data && row.data.vendors) || {};
    const v = vendors[vendor];
    if (v && v.secret === secret) {
      return {
        ownerUid: row.id,
        config: { ownerEmail: v.ownerEmail || row.data.ownerEmail || null, secret: v.secret },
      };
    }
  }
  return null;
}

/* Payhip HMAC: try each configured payhip owner, return the first
   whose HMAC of the raw body matches the header signature. */
async function _findPayhipOwnerBySignature(projectId, token, request, rawBody) {
  const sig = request.headers.get('payhip-signature') || request.headers.get('Payhip-Signature') || '';
  if (!sig) return null;
  const rows = await _plList(token, projectId, 'folio_vendor_owner_configs', 500);
  for (const row of rows) {
    const vendors = (row.data && row.data.vendors) || {};
    const v = vendors.payhip;
    if (!v || !v.secret) continue;
    const expected = await _hmacHex(v.secret, rawBody);
    if (sig === expected) {
      return {
        ownerUid: row.id,
        config: { ownerEmail: v.ownerEmail || row.data.ownerEmail || null, secret: v.secret },
      };
    }
  }
  return null;
}

/* PayPal: try each configured paypal owner (webhook_id), first that
   verifies via PayPal's own signature endpoint wins. */
async function _findPaypalOwnerBySignature(projectId, token, request, rawBody, payload, env) {
  const rows = await _plList(token, projectId, 'folio_vendor_owner_configs', 500);
  const headers = {
    auth_algo:       request.headers.get('paypal-auth-algo') || '',
    cert_url:        request.headers.get('paypal-cert-url') || '',
    transmission_id: request.headers.get('paypal-transmission-id') || '',
    transmission_sig:request.headers.get('paypal-transmission-sig') || '',
    transmission_time: request.headers.get('paypal-transmission-time') || '',
  };
  if (!headers.transmission_id) return null;
  const pp = await ppToken(env);
  for (const row of rows) {
    const vendors = (row.data && row.data.vendors) || {};
    const v = vendors.paypal;
    if (!v || !v.secret) continue;
    const r = await fetch(ppBase(env) + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pp, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo:         headers.auth_algo,
        cert_url:          headers.cert_url,
        transmission_id:   headers.transmission_id,
        transmission_sig:  headers.transmission_sig,
        transmission_time: headers.transmission_time,
        webhook_id:        v.secret,
        webhook_event:     payload,
      }),
    });
    const vr = await r.json().catch(() => ({}));
    if (vr.verification_status === 'SUCCESS') {
      return {
        ownerUid: row.id,
        config: { ownerEmail: v.ownerEmail || row.data.ownerEmail || null, secret: v.secret },
      };
    }
  }
  return null;
}

/* Find an owner's folio whose release.checkoutUrl matches the product
   identifier from the vendor payload. Returns { id, data } or null. */
async function _findFolioByProduct(projectId, token, ownerUid, vendor, payload, extracted) {
  // Extract vendor-specific product identifier from the payload.
  let ident = '';
  if (vendor === 'kofi') {
    const items = Array.isArray(payload.shop_items) ? payload.shop_items : [];
    ident = String((items[0] && items[0].direct_link_code) || '').trim();
  } else if (vendor === 'payhip') {
    ident = String(payload.product_link || payload.product_id || '').trim();
  } else if (vendor === 'paypal') {
    const res = payload.resource || {};
    const pu = Array.isArray(res.purchase_units) ? res.purchase_units[0] : null;
    ident = String((pu && pu.reference_id) ||
                   (pu && pu.items && pu.items[0] && pu.items[0].name) || '').trim();
  }

  // Query owner's folio_projects (safe LIST via runQuery with uid filter).
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents:runQuery';
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'folio_projects' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'uid' },
          op: 'EQUAL',
          value: { stringValue: ownerUid },
        }
      },
      limit: 100,
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  const rows = await r.json();
  if (!Array.isArray(rows)) return null;

  // Score each folio: does its checkoutUrl contain the identifier?
  // Fall back to any paid folio if there's only one (single-folio owners).
  const candidates = [];
  for (const row of rows) {
    if (!row.document) continue;
    const id = (row.document.name || '').split('/').pop();
    const data = fsDecodeFields(row.document.fields || {});
    const rel = data.release || {};
    if (rel.priceMode !== 'paid' || rel.provider !== 'custom') continue;
    const chk = String(rel.checkoutUrl || '');
    if (ident && chk.indexOf(ident) >= 0) {
      return { id, data };
    }
    if (chk) candidates.push({ id, data });
  }
  // If no exact match but only one candidate paid folio, assume it.
  if (candidates.length === 1) return candidates[0];
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   POST /event — analytics ingestion for the metrics dashboards.
   ────────────────────────────────────────────────────────────────────
   Client fires-and-forgets via navigator.sendBeacon. Worker validates,
   stamps ts + geo + optional uid, writes to folio_events collection
   via the service account (bypasses client rules, which deny direct
   client writes to this collection).

   Body shape:
     { kind, folioId, chapterId?, meta? }

   Recognized kinds (whitelist — reject others to prevent stuffing):
     view           → reader opened the folio
     chapter_open   → reader clicked into a chapter
     read_complete  → reader reached the last chapter
     paywall_hit    → paywall lock modal rendered for a paid chapter
     purchase       → reader completed a paid-release purchase
     tip            → reader sent a tip
     boost_click    → owner started a boost checkout

   Auto-attached:
     ts             — server timestamp
     geo            — Cloudflare cf-ipcountry (2-letter code)
     referrer       — Referer header (host+path only, no query string)
     uid            — extracted from Authorization: Bearer <JWT> if valid

   Meta size cap: 512 bytes serialized. Keeps a malicious client from
   ballooning our Firestore storage bill.

   Daily rollup cron (folio-email-worker.js runCron) walks yesterday's
   events and writes folio_projects/{folioId}/metrics/daily_YYYYMMDD
   summary docs. Raw events auto-expire after 90 days via Firestore
   TTL policy (see docs/METRICS_PLAN.md).
   ══════════════════════════════════════════════════════════════════ */
const _EVENT_KINDS = new Set([
  'view', 'chapter_open', 'read_complete', 'paywall_hit',
  'purchase', 'tip', 'boost_click',
]);

async function handleEvent(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) {
    return errorJson('Firestore service account not configured', 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }

  const kind = String((body && body.kind) || '').trim();
  const folioId = String((body && body.folioId) || '').trim();
  if (!_EVENT_KINDS.has(kind)) return errorJson('Unknown event kind', 400, request, env);
  if (!folioId || folioId.length > 200) return errorJson('Missing/invalid folioId', 400, request, env);

  const chapterId = body && body.chapterId ? String(body.chapterId).slice(0, 100) : null;
  let meta = null;
  if (body && body.meta && typeof body.meta === 'object') {
    try {
      const serialized = JSON.stringify(body.meta);
      if (serialized.length > 512) return errorJson('meta too large (512 byte cap)', 400, request, env);
      meta = body.meta;
    } catch (e) { /* ignore malformed meta */ }
  }

  // Extract uid from paywall JWT if present. Doesn't error if missing —
  // anonymous reads are legitimate events.
  let uid = null;
  try {
    const authHdr = request.headers.get('Authorization') || '';
    const token = authHdr.replace(/^Bearer\s+/i, '').trim();
    if (token && env.PAYWALL_JWT_SECRET) {
      const v = await verifyJWT(token, env.PAYWALL_JWT_SECRET);
      if (v && v.ok && v.payload && v.payload.uid) uid = String(v.payload.uid);
    }
  } catch (e) { /* anonymous is fine */ }

  // Geo from Cloudflare edge, referrer sanitized to host+path only.
  const geo = String(request.headers.get('cf-ipcountry') || '').slice(0, 4).toUpperCase() || null;
  let referrer = null;
  try {
    const raw = request.headers.get('referer') || request.headers.get('Referer') || '';
    if (raw) {
      const u = new URL(raw);
      referrer = (u.hostname + u.pathname).slice(0, 200);
    }
  } catch (e) { /* invalid referer, skip */ }

  // Build the Firestore document. All values wrapped in the typed-value
  // envelope Firestore's REST API expects.
  const nowIso = new Date().toISOString();
  const fields = {
    kind:     { stringValue: kind },
    folioId:  { stringValue: folioId },
    ts:       { timestampValue: nowIso },
  };
  if (chapterId) fields.chapterId = { stringValue: chapterId };
  if (uid)       fields.uid       = { stringValue: uid };
  if (geo)       fields.geo       = { stringValue: geo };
  if (referrer)  fields.referrer  = { stringValue: referrer };
  if (meta) {
    // Encode meta as JSON string — the daily rollup cron re-parses.
    // Keeps the doc schema flat + avoids per-key type wrapping.
    fields.metaJson = { stringValue: JSON.stringify(meta) };
  }

  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    // Doc id: <YYYYMMDD>_<millis>_<random> so rollup queries can range
    // by prefix and doc ids are sortable by time.
    const day = nowIso.slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 8);
    const docId = day + '_' + Date.now() + '_' + rand;
    const url = 'https://firestore.googleapis.com/v1/projects/' + pid +
                '/databases/(default)/documents/folio_events?documentId=' + encodeURIComponent(docId);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + acc.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return errorJson('Firestore write failed: ' + ((data.error && data.error.message) || r.status), 502, request, env);
    }
    return json({ ok: true }, 200, request, env);
  } catch (e) {
    return errorJson('Event write failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* ══════════════════════════════════════════════════════════════════
   GET /user-list?key=<ADMIN_DEBUG_TOKEN>
   ────────────────────────────────────────────────────────────────────
   Returns every user who has signed into Folio at least once, plus:
     • folioCount           — total folio_projects docs with their uid
     • publishedCount       — subset marked release.published == true
     • hasCustomizedImprint — bool (imprint theme doc exists)
     • displayName          — from imprint theme if present, else null
     • pressSubscription    — { status, tier, isComp, isFounding, expiresAt } or null
     • updatedAt            — ISO string, from folio_user_settings

   Why this endpoint exists:
     Firestore rules deny client LIST on folio_user_settings (rule is
     per-doc isUser/isAdmin, which the LIST engine can't statically
     prove). So the client-side author-lookup on /admin/press/ only
     surfaces authors who've PUBLISHED a folio or CUSTOMIZED an
     imprint. This endpoint uses the service account (bypasses client
     rules) to return the full universe so admins can comp brand-new
     signups too.

   Also powers the "Total signed-in users" metric on /admin/metrics/.

   Auth: same ADMIN_DEBUG_TOKEN as /admin-digest + /metrics-rollup.
   Data limit: capped at 2000 users per response (~2 kB per user).
   ══════════════════════════════════════════════════════════════════ */
/* GET /admin/user-lookup?uid=<uid>&key=<ADMIN_DEBUG_TOKEN>
   Moderator-only Firebase Auth record lookup. Returns whatever the
   Identity Toolkit has on file for that uid — email, display name,
   sign-in providers (google.com, password, anonymous), account
   creation timestamp, last-login timestamp, disabled flag.

   Purpose: get contact info + provider details for a signed-in author
   when folio_user_settings/{uid}.lastEmail is missing (older signups
   that pre-date the merge-write, or edge cases where the write
   failed). Also the audit path for reporting content: providerData
   includes the linked Google account so we can identify the person
   even when they've never given us an email directly.

   Anonymous accounts have no email or displayName — those authors
   are unreachable by design. The response surfaces this cleanly so
   the moderator UI can say "anonymous account, cannot be contacted"
   rather than a generic "no email on file".

   Auth: shared ADMIN_DEBUG_TOKEN (same as /user-list).
*/
async function handleAdminUserLookup(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const uid = String(url.searchParams.get('uid') || '').trim();
  const expected = env.ADMIN_DEBUG_TOKEN || '';
  if (!expected) return errorJson('User lookup disabled — ADMIN_DEBUG_TOKEN not set', 403, request, env);
  if (key !== expected) return errorJson('Unauthorized', 401, request, env);
  if (!uid) return errorJson('Missing uid', 400, request, env);
  try {
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/projects/' + pid + '/accounts:lookup',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ localId: [uid] }),
      }
    );
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return errorJson('Auth lookup failed: ' + r.status + ' ' + err.slice(0, 200), 502, request, env);
    }
    const data = await r.json().catch(() => null);
    const u = (data && Array.isArray(data.users) && data.users[0]) || null;
    if (!u) return json({ ok: true, found: false, uid }, 200, request, env);

    // Extract provider info — providerUserInfo is the array of linked
    // identity providers with their per-provider email + displayName.
    const providers = Array.isArray(u.providerUserInfo)
      ? u.providerUserInfo.map(function(p){
          return {
            providerId: p.providerId || '',       // 'google.com', 'password', 'facebook.com', …
            email: p.email || null,
            displayName: p.displayName || null,
            federatedId: p.federatedId || null,   // Google account URL etc — for reports
          };
        })
      : [];

    return json({
      ok: true,
      found: true,
      uid,
      email: u.email || null,
      emailVerified: !!u.emailVerified,
      displayName: u.displayName || null,
      photoUrl: u.photoUrl || null,
      // Firebase timestamps come back as strings of ms since epoch.
      createdAt: u.createdAt ? Number(u.createdAt) : null,
      lastLoginAt: u.lastLoginAt ? Number(u.lastLoginAt) : null,
      lastRefreshAt: u.lastRefreshAt || null,
      disabled: !!u.disabled,
      // isAnonymous isn't in the response directly — infer from providers.
      isAnonymous: providers.length === 0 && !u.email,
      providers,
    }, 200, request, env);
  } catch (e) {
    return errorJson('Lookup threw: ' + (e.message || 'unknown'), 502, request, env);
  }
}

/* POST /migrate-anon-to-google
   ────────────────────────────────────────────────────────────────
   Reassigns folio_projects owned by an anonymous uid to a Google
   uid — used when the reader tries to link their anon session to a
   Google account that already has its own Firebase uid (Firebase
   throws auth/credential-already-in-use in that case).

   Client sends { anonIdToken, googleIdToken }. Both tokens are
   verified via Firebase Identity Toolkit; anonUid + googleUid are
   extracted from the verified tokens (NOT from the request body)
   so the caller can't migrate someone else's folios into their own
   account.

   Migration steps, using the service account (bypasses client rules):
     1. Query folio_projects where uid == anonUid (up to 100)
     2. For each, PATCH uid = googleUid (single-field update, cheap)
        Subcollections (body/, versions/, subscribers/, paid_sales/,
        metrics/) stay put automatically because they're keyed by
        folio ID, not by uid.
     3. Merge folio_user_settings/{anonUid} into folio_user_settings/
        {googleUid} for fields that don't already exist on the Google
        side. Critical fields like pressSubscription on Google side
        are NEVER overwritten by anon-side data (protects existing
        subscriptions from being clobbered by an empty anon settings).

   Returns { ok, migrated, anonUid, googleUid, notes[] }.
*/
async function handleMigrateAnonToGoogle(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured (service account)', 500, request, env);
  let body;
  try { body = await request.json(); }
  catch (_) { return errorJson('Bad JSON body', 400, request, env); }
  const anonIdToken   = String((body && body.anonIdToken)   || '').trim();
  const googleIdToken = String((body && body.googleIdToken) || '').trim();
  if (!anonIdToken || !googleIdToken) {
    return errorJson('Both anonIdToken and googleIdToken required', 400, request, env);
  }
  const anonUid   = await _verifyFirebaseIdToken(anonIdToken, env);
  const googleUid = await _verifyFirebaseIdToken(googleIdToken, env);
  if (!anonUid)   return errorJson('anonIdToken invalid or expired', 401, request, env);
  if (!googleUid) return errorJson('googleIdToken invalid or expired', 401, request, env);
  if (anonUid === googleUid) return errorJson('Same uid — nothing to migrate', 400, request, env);
  try {
    const auth = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || auth.projectId;
    const notes = [];

    // 1. Query the anon user's folios.
    const runQueryUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                        '/databases/(default)/documents:runQuery';
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'folio_projects' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'uid' },
            op: 'EQUAL',
            value: { stringValue: anonUid },
          }
        },
        limit: 100,
      }
    };
    const qResp = await fetch(runQueryUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });
    if (!qResp.ok) {
      const err = await qResp.text().catch(() => '');
      return errorJson('Folio query failed: ' + qResp.status + ' ' + err.slice(0, 200), 502, request, env);
    }
    const rows = await qResp.json();

    // 2. Reassign each folio's uid to googleUid via a targeted PATCH.
    let migrated = 0;
    let failed = 0;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row.document) continue;
        const folioId = String(row.document.name || '').split('/').pop();
        if (!folioId) continue;
        const patchUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                         '/databases/(default)/documents/folio_projects/' +
                         encodeURIComponent(folioId) + '?updateMask.fieldPaths=uid';
        const pResp = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { uid: { stringValue: googleUid } } }),
        });
        if (pResp.ok) {
          migrated++;
        } else {
          failed++;
          const err = await pResp.text().catch(() => '');
          console.warn('[migrate] folio', folioId, 'update failed:', pResp.status, err.slice(0, 200));
        }
      }
    }
    notes.push(migrated + ' folio(s) reassigned' + (failed ? ' (' + failed + ' failed)' : ''));

    // 3. Merge folio_user_settings/{anonUid} into {googleUid}. Never
    //    clobber existing values on the Google side — the Google account
    //    may already carry a pressSubscription, comp status, or preferences
    //    we don't want an empty anon settings doc to overwrite.
    try {
      const anonSet   = await fsGet(pid, auth.token, 'folio_user_settings/' + encodeURIComponent(anonUid)).catch(() => null);
      const googleSet = await fsGet(pid, auth.token, 'folio_user_settings/' + encodeURIComponent(googleUid)).catch(() => null);
      if (anonSet && Object.keys(anonSet).length > 0) {
        const missingOnGoogle = {};
        for (const key of Object.keys(anonSet)) {
          if (!googleSet || googleSet[key] == null) {
            missingOnGoogle[key] = anonSet[key];
          }
        }
        const mergeKeys = Object.keys(missingOnGoogle);
        if (mergeKeys.length > 0) {
          const fields = {};
          for (const k of mergeKeys) {
            const v = missingOnGoogle[k];
            // Only merge scalar-ish leaf types for safety; complex nested
            // objects (subcollections, etc.) are skipped. The typical anon
            // settings doc holds lastEmail/lastDisplayName/signInAt which
            // are all strings/timestamps.
            if (typeof v === 'string') fields[k] = { stringValue: v };
            else if (typeof v === 'number') fields[k] = { doubleValue: v };
            else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
            else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
            // else skip (map/array — too risky to auto-merge)
          }
          if (Object.keys(fields).length > 0) {
            const updateMask = 'updateMask.fieldPaths=' + Object.keys(fields).map(encodeURIComponent).join('&updateMask.fieldPaths=');
            const mergeUrl = 'https://firestore.googleapis.com/v1/projects/' + pid +
                             '/databases/(default)/documents/folio_user_settings/' +
                             encodeURIComponent(googleUid) + '?' + updateMask;
            const mResp = await fetch(mergeUrl, {
              method: 'PATCH',
              headers: { 'Authorization': 'Bearer ' + auth.token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields }),
            });
            if (mResp.ok) {
              notes.push('Merged ' + Object.keys(fields).length + ' settings field(s)');
            } else {
              notes.push('Settings merge failed (non-fatal)');
            }
          } else {
            notes.push('No settings fields to merge');
          }
        } else {
          notes.push('Google settings already carry every anon field');
        }
      }
    } catch (e) {
      notes.push('Settings merge threw: ' + (e.message || 'unknown') + ' (non-fatal)');
    }

    return json({ ok: true, migrated, failed, anonUid, googleUid, notes }, 200, request, env);
  } catch (e) {
    return errorJson('Migration failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

async function handleUserList(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const expected = env.ADMIN_DEBUG_TOKEN || '';
  if (!expected) return errorJson('User list disabled — ADMIN_DEBUG_TOKEN not set', 403, request, env);
  if (key !== expected) return errorJson('Unauthorized', 401, request, env);

  try {
    const acc = await getAccessToken(env);
    const pid = env.FIRESTORE_PROJECT_ID || acc.projectId;
    const [settings, projects, themes] = await Promise.all([
      _plList(acc.token, pid, 'folio_user_settings', 2000),
      _plList(acc.token, pid, 'folio_projects', 2000),
      _plList(acc.token, pid, 'folio_imprint_themes', 2000),
    ]);

    // Build a per-uid buckets map.
    const byUid = Object.create(null);
    const _touch = (uid) => {
      if (!byUid[uid]) byUid[uid] = {
        uid, folioCount: 0, publishedCount: 0,
        hasCustomizedImprint: false, displayName: null,
        pressSubscription: null, updatedAt: null,
      };
      return byUid[uid];
    };

    // 1. Settings — establishes the signed-in universe.
    for (const s of settings) {
      const b = _touch(s.id);
      const data = s.data || {};
      const sub = data.pressSubscription;
      if (sub && sub.status) {
        const isComp = String(sub.paypalSubscriptionId || '').indexOf('COMP-') === 0;
        const expiresAt = sub.expiresAt || null;
        b.pressSubscription = {
          status: String(sub.status),
          tier: String(sub.tier || '').toLowerCase(),
          isComp: isComp,
          isFounding: !!sub.foundingContributor,
          expiresAt: expiresAt,
        };
      }
      // Email + display name written by the client on every sign-in
      // via the ensure-settings-doc hook in app.html onAuthStateChanged.
      // Lets admins search /admin/press by name AND email, not just uid.
      if (data.lastEmail) b.email = String(data.lastEmail);
      if (data.lastDisplayName) b.displayName = b.displayName || String(data.lastDisplayName);
      b.updatedAt = data.updatedAt && data.updatedAt.toDate ? data.updatedAt.toDate().toISOString()
                  : (typeof data.updatedAt === 'string' ? data.updatedAt : null);
      b.signInAt  = data.signInAt && data.signInAt.toDate ? data.signInAt.toDate().toISOString()
                  : (typeof data.signInAt === 'string' ? data.signInAt : null);
    }

    // 2. Projects — count folios + published folios per uid.
    for (const p of projects) {
      const uid = String((p.data && p.data.uid) || '');
      if (!uid) continue;
      const b = _touch(uid);
      b.folioCount++;
      const rel = p.data && p.data.release;
      if (rel && rel.published) b.publishedCount++;
    }

    // 3. Imprint themes — display name + customization flag.
    for (const t of themes) {
      const uid = String(t.id || '');
      if (!uid) continue;
      const b = _touch(uid);
      b.hasCustomizedImprint = true;
      const dn = String((t.data && (t.data.authorName || t.data.displayName)) || '').trim();
      if (dn) b.displayName = dn;
      // Themes can also carry foundingContributor flag independently of pressSubscription
      if (t.data && t.data.foundingContributor && b.pressSubscription) {
        b.pressSubscription.isFounding = true;
      }
    }

    const list = Object.values(byUid);
    // Order: paid subs first, then comps, then anyone with published folios, then rest.
    // Within each group, most-recently-updated first.
    list.sort((a, b) => {
      const rankA = _plRank(a), rankB = _plRank(b);
      if (rankA !== rankB) return rankA - rankB;
      const ua = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const ub = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return ub - ua;
    });

    return json({
      ok: true,
      count: list.length,
      users: list,
    }, 200, request, env);
  } catch (e) {
    return errorJson('User list failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

function _plRank(u) {
  const sub = u.pressSubscription;
  if (sub && sub.status === 'ACTIVE' && !sub.isComp) return 0; // paid
  if (sub && sub.status === 'ACTIVE' && sub.isComp)  return 1; // comp
  if (u.publishedCount > 0)                          return 2; // published free
  if (u.folioCount > 0)                              return 3; // has folios, none published
  if (u.hasCustomizedImprint)                        return 4; // customized only
  return 5;                                                    // bare signup
}

// Firestore REST list helper — paginates with pageToken until done or
// hardCap is reached. Returns [{ id, data }] with typed values decoded.
async function _plList(token, projectId, collPath, hardCap) {
  const out = [];
  let pageToken = '';
  let safety = 0;
  const base = 'https://firestore.googleapis.com/v1/projects/' + projectId +
               '/databases/(default)/documents/' + collPath;
  while (safety++ < 50) {
    const url = base + '?pageSize=300' +
                (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('list ' + collPath + ': ' + ((data.error && data.error.message) || r.status));
    for (const d of (data.documents || [])) {
      const id = (d.name || '').split('/').pop();
      out.push({ id: id, data: fsDecodeFields(d.fields || {}) });
      if (out.length >= hardCap) return out;
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
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



/* KDP METADATA IMPORT
   Fetches an Amazon author page (or a single book page) and extracts
   title / blurb / cover / pageCount / series metadata for each book.
   BEST-EFFORT — Amazon changes HTML periodically; expect breakage.
   Client falls back to manual entry cleanly.
*/
async function handleKdpImport(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return errorJson('Bad JSON body', 400, request, env); }
  const url = String((body && body.url) || '').trim();
  if (!url) return errorJson('Missing url', 400, request, env);
  let parsed;
  try { parsed = new URL(url); } catch (e) { return errorJson('Invalid URL', 400, request, env); }
  if (!/^(?:www\.)?amazon\.[a-z.]{2,6}$/i.test(parsed.hostname)) {
    return errorJson('URL must be an Amazon domain', 400, request, env);
  }
  let html;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) return errorJson('Amazon returned HTTP ' + r.status, 502, request, env);
    html = await r.text();
  } catch (e) {
    return errorJson('Fetch failed: ' + (e.message || 'unknown'), 502, request, env);
  }
  const isBookPage = /\/(dp|gp\/product)\//i.test(parsed.pathname);
  const books = isBookPage ? _kdpParseBookPage(html, url) : _kdpParseAuthorPage(html, url);
  return json({ ok: true, books: books, count: books.length, source: isBookPage ? 'book' : 'author' }, 200, request, env);
}

function _kdpParseBookPage(html, url) {
  const book = {};
  const titleM = html.match(/<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/i)
              || html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (titleM) book.title = _kdpClean(titleM[1]);
  const asinM = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)
             || html.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/i);
  if (asinM) book.asin = asinM[1];
  const blurbM = html.match(/<div[^>]*id="bookDescription_feature_div"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (blurbM) book.blurb = _kdpClean(blurbM[1].replace(/<[^>]+>/g, ' ')).slice(0, 2000);
  const coverM = html.match(/<img[^>]*id="(?:imgBlkFront|ebooksImgBlkFront|landingImage)"[^>]+src="([^"]+)"/i);
  if (coverM) book.coverUrl = coverM[1];
  const pagesM = html.match(/(\d{2,4})\s*pages/i);
  if (pagesM) book.pageCount = parseInt(pagesM[1], 10);
  const seriesM = html.match(/Book\s+(\d+)\s+of\s+\d+\s*:\s*([^<\n]+)/i);
  if (seriesM) { book.seriesOrder = parseInt(seriesM[1], 10); book.series = _kdpClean(seriesM[2]); }
  if (!book.title) return [];
  return [book];
}

function _kdpParseAuthorPage(html, baseUrl) {
  const books = [];
  const seen = new Set();
  const bookLinks = html.matchAll(/href="([^"]*\/(?:dp|gp\/product)\/([A-Z0-9]{10})[^"]*)"/gi);
  for (const m of bookLinks) {
    const asin = m[2];
    if (seen.has(asin)) continue;
    seen.add(asin);
    const linkIdx = m.index;
    const chunk = html.slice(Math.max(0, linkIdx - 500), Math.min(html.length, linkIdx + 500));
    const titleM = chunk.match(/alt="([^"]+)"/i) || chunk.match(/>([^<]{3,120})</);
    const coverM = chunk.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    if (!titleM) continue;
    books.push({
      asin: asin,
      title: _kdpClean(titleM[1]).slice(0, 200),
      coverUrl: coverM ? coverM[1] : '',
      amazonUrl: 'https://www.amazon.com/dp/' + asin,
    });
    if (books.length >= 30) break;
  }
  return books;
}

function _kdpClean(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
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
          'POST /kdp-import    { url } → { books: [...] }  (Amazon author/book page metadata scrape)',
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
    if (path === '/event'          && request.method === 'POST') return handleEvent(request, env);
    if (path === '/user-list'      && request.method === 'GET')  return handleUserList(request, env);
    if (path === '/admin/user-lookup' && request.method === 'GET') return handleAdminUserLookup(request, env);
    if (path === '/migrate-anon-to-google' && request.method === 'POST') return handleMigrateAnonToGoogle(request, env);
    // GET /env-check?key=<ADMIN_DEBUG_TOKEN> — reports which env
    // bindings the paywall worker can see at runtime, without leaking
    // any values. Diagnostic-only. Use to confirm secrets landed on
    // the right worker + survived redeploy.
    if (path === '/env-check' && request.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_DEBUG_TOKEN || key !== env.ADMIN_DEBUG_TOKEN) {
        return errorJson('Unauthorized', 401, request, env);
      }
      return json({
        ok: true,
        worker: 'folio-paywall',
        env: {
          PAYWALL_JWT_SECRET:   !!env.PAYWALL_JWT_SECRET,
          GCP_SERVICE_ACCOUNT:  !!env.GCP_SERVICE_ACCOUNT,
          EMAIL_WORKER_SECRET:  !!env.EMAIL_WORKER_SECRET,
          EMAIL_WORKER_URL:     !!env.EMAIL_WORKER_URL,
          ADMIN_DEBUG_TOKEN:    !!env.ADMIN_DEBUG_TOKEN,
          PAYPAL_CLIENT_ID:     !!env.PAYPAL_CLIENT_ID,
          PAYPAL_CLIENT_SECRET: !!env.PAYPAL_CLIENT_SECRET,
          FIREBASE_WEB_API_KEY: !!env.FIREBASE_WEB_API_KEY,
        },
      }, 200, request, env);
    }
    if (path === '/vendor-config'  && request.method === 'POST') return handleVendorConfig(request, env);
    if (path.startsWith('/vendor-webhook/') && request.method === 'POST') {
      const folioId = decodeURIComponent(path.substring('/vendor-webhook/'.length));
      return handleVendorWebhook(request, env, folioId);
    }
    // Multi-tenant vendor webhooks — one URL per vendor per account
    // (vs the legacy /vendor-webhook/{folioId} above which was per-folio).
    if (path === '/vendor-owner-config' && request.method === 'POST') return handleVendorOwnerConfig(request, env);
    if (path === '/vendor-owner-config' && request.method === 'GET')  return handleVendorOwnerConfigGet(request, env);
    // Path A — PayPal Buttons native checkout.
    if (path === '/paypal-native-config' && request.method === 'GET')  return handlePaypalNativeConfig(request, env);
    if (path === '/paypal-create-order'  && request.method === 'POST') return handlePaypalCreateOrder(request, env);
    if (path === '/paypal-capture-order' && request.method === 'POST') return handlePaypalCaptureOrder(request, env);
    if (path === '/kofi-webhook'   && request.method === 'POST') return handleMultiTenantVendorWebhook(request, env, 'kofi');
    if (path === '/payhip-webhook' && request.method === 'POST') return handleMultiTenantVendorWebhook(request, env, 'payhip');
    if (path === '/paypal-webhook' && request.method === 'POST') return handleMultiTenantVendorWebhook(request, env, 'paypal');
    if (path === '/press-subscribe' && request.method === 'POST') return handlePressSubscribe(request, env);
    if (path === '/press-return'    && request.method === 'GET')  return handlePressReturn(request, env);
    if (path === '/press-webhook'   && request.method === 'POST') return handlePressWebhook(request, env);
    if (path === '/press-status'    && request.method === 'GET')  return handlePressStatus(request, env);
    if (path === '/review-submit'  && request.method === 'POST') return handleReviewSubmit(request, env);
    if (path === '/boost-debug'    && request.method === 'GET')  return handleBoostDebug(request, env);
    if (path === '/sign-share'    && request.method === 'POST') return handleSignShare(request, env);
    if (path === '/kdp-import'   && request.method === 'POST') return handleKdpImport(request, env);
    if (path === '/photo-checkout' && request.method === 'POST') return handlePhotoCheckout(request, env);
    if (path === '/photo-return'   && request.method === 'GET')  return handlePhotoReturn(request, env);
    if (path === '/photo-status'   && request.method === 'GET')  return handlePhotoStatus(request, env);
    // ── Affiliate program (see docs/AFFILIATES_SPEC.md) ─────────────
    if (path === '/affiliates/invite'      && request.method === 'POST') return handleAffiliateInvite(request, env);
    if (path === '/affiliates/accept'      && request.method === 'POST') return handleAffiliateAccept(request, env);
    if (path === '/affiliates/list'        && request.method === 'GET')  return handleAffiliateList(request, env);
    if (path === '/affiliates/mine'        && request.method === 'GET')  return handleAffiliateMine(request, env);
    if (path === '/affiliates/edit-rate'   && request.method === 'POST') return handleAffiliateEditRate(request, env);
    if (path === '/affiliates/pause'       && request.method === 'POST') return _setAffiliationStatus(request, env, 'paused');
    if (path === '/affiliates/resume'      && request.method === 'POST') return _setAffiliationStatus(request, env, 'active');
    if (path === '/affiliates/remove'      && request.method === 'POST') return _setAffiliationStatus(request, env, 'removed');
    if (path === '/affiliates/materialize' && request.method === 'POST') return handleAffiliateMaterialize(request, env);
    if (path === '/affiliates/settle'      && request.method === 'POST') return handleAffiliateSettle(request, env);

    return errorJson('Not found: ' + path, 404, request, env);
  },
};
