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

const DEFAULT_ORIGIN   = 'https://folio.jacobsiler.com';
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
    'Access-Control-Allow-Headers': 'Content-Type',
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

/* ── Dispatcher ───────────────────────────────────────────────── */
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
          'POST /verify  { releaseId, product, licenseKey, days? }',
          'POST /check   { token }',
          'GET  /check?token=…',
        ],
      }, 200, request, env);
    }

    if (path === '/verify' && request.method === 'POST') return handleVerify(request, env);
    if (path === '/check'  && (request.method === 'POST' || request.method === 'GET')) return handleCheck(request, env);

    return errorJson('Not found: ' + path, 404, request, env);
  },
};
