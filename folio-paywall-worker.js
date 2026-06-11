/**
 * folio-paywall — Cloudflare Worker
 * (VIP bypass patch applied — see handlePaidContent)
 */

const DEFAULT_ORIGIN   = 'https://www.onfolio.press';
const JWT_DEFAULT_DAYS = 30;
const GUMROAD_VERIFY   = 'https://api.gumroad.com/v2/licenses/verify';

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
    'Access-Control-Allow-Headers': 'Content-Type, authorization, X-Folio-VIP',
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
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}
async function hmacVerify(secret, data, sig) {
  const expected = await hmacSign(secret, data);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
async function signJWT(payload, secret) {
  const h = b64urlJSON({ alg: 'HS256', typ: 'JWT' });
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
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))); }
  catch (e) { return { ok: false, reason: 'bad-payload' }; }
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
async function gumroadVerify(productValue, licenseKey) {
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

async function handleVerify(request, env) {
  if (!env.PAYWALL_JWT_SECRET) return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  let body;
  try { body = await request.json(); } catch(e) { return errorJson('Invalid JSON body', 400, request, env); }
  const releaseId  = ((body && body.releaseId)  || '').trim();
  const product    = ((body && (body.product || body.productSlug || body.productId)) || '').trim();
  const licenseKey = ((body && body.licenseKey) || '').trim();
  const days = Math.max(1, Math.min(365, Number(body && body.days) || JWT_DEFAULT_DAYS));
  if (!releaseId)  return errorJson('Missing releaseId',  400, request, env);
  if (!product)    return errorJson('Missing product id', 400, request, env);
  if (!licenseKey) return errorJson('Missing licenseKey', 400, request, env);
  const result = await gumroadVerify(product, licenseKey);
  if (!result.ok) return errorJson('License not valid: ' + result.reason, 403, request, env);
  const purchase = (result.data && result.data.purchase) || {};
  if (purchase.refunded || purchase.chargebacked || purchase.disputed) {
    return errorJson('License has been refunded or disputed', 403, request, env);
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (days * 86400);
  const sub = await sha256ShortHex(licenseKey, 8);
  const payload = {
    sub, release: releaseId, product,
    purchaseId: purchase.id || purchase.order_id || null,
    email: purchase.email || null, iat: now, exp,
  };
  const token = await signJWT(payload, env.PAYWALL_JWT_SECRET);
  return json({ ok: true, token, expiresAt: exp, email: payload.email, daysValid: days, via: result.via }, 200, request, env);
}

async function handleCheck(request, env) {
  if (!env.PAYWALL_JWT_SECRET) return errorJson('Server not configured', 500, request, env);
  let token = '';
  if (request.method === 'POST') {
    try { const body = await request.json(); token = (body && body.token) || ''; } catch (e) {}
  } else {
    token = new URL(request.url).searchParams.get('token') || '';
  }
  if (!token) return errorJson('Missing token', 400, request, env);
  const result = await verifyJWT(token, env.PAYWALL_JWT_SECRET);
  if (!result.ok) return json({ ok: false, reason: result.reason }, 200, request, env);
  return json({ ok: true, payload: result.payload }, 200, request, env);
}

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE  = 'https://www.googleapis.com/auth/datastore';

function b64urlStr(str) { return b64urlEncode(new TextEncoder().encode(str)); }
function pemToArrayBuffer(pem) {
  const body = String(pem || '')
    .replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
async function getAccessToken(env) {
  const raw = env.GCP_SERVICE_ACCOUNT;
  if (!raw) throw new Error('GCP_SERVICE_ACCOUNT not configured');
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { throw new Error('GCP_SERVICE_ACCOUNT is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('GCP_SERVICE_ACCOUNT missing client_email / private_key');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64urlStr(JSON.stringify({ iss: sa.client_email, scope: FIRESTORE_SCOPE,
      aud: sa.token_uri || GOOGLE_TOKEN_URI, iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlEncode(new Uint8Array(sig));
  const resp = await fetch(sa.token_uri || GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) throw new Error('Token exchange failed: ' + (data.error_description || data.error || resp.status));
  return { token: data.access_token, projectId: sa.project_id };
}

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
    throw new Error('Firestore GET ' + docPath + ' failed: ' + ((data.error && data.error.message) || r.status));
  }
  const doc = await r.json();
  return fsDecodeFields(doc.fields || {});
}

/* GET /paid-content?folio=<folioId>
   Authorization: Bearer <license JWT>   (skipped for VIP token)
   X-Folio-VIP: <token>                  (must match FOLIO_VIP_TOKEN secret) */
async function handlePaidContent(request, env) {
  console.log('[PW] ENV KEYS:', Object.keys(env || {}).join(', '));
  console.log('[PW] PAYWALL_JWT_SECRET exists:', !!env.PAYWALL_JWT_SECRET);
  console.log('[PW] GCP_SERVICE_ACCOUNT exists:', !!env.GCP_SERVICE_ACCOUNT);
  console.log('[PW] FOLIO_VIP_TOKEN exists:', !!env.FOLIO_VIP_TOKEN);
  
  
  if (!env.PAYWALL_JWT_SECRET) {
    console.error('[PW] Missing PAYWALL_JWT_SECRET');
    return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  }
  if (!env.GCP_SERVICE_ACCOUNT) {
    console.error('[PW] Missing GCP_SERVICE_ACCOUNT');
    return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  }

  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  console.log('[PW] folioId:', folioId);
  
  if (!folioId) return errorJson('Missing folio', 400, request, env);

  const unlockParam = (url.searchParams.get('unlock') || '').trim();
  const vipEnv = (env.FOLIO_VIP_TOKEN || '').trim();
  const isVip = !!(vipEnv && unlockParam && unlockParam === vipEnv);
  console.log('[PW] VIP check: unlockParam=', unlockParam, 'vipEnv=', vipEnv ? 'SET' : 'NOT SET', 'isVip=', isVip);

  if (!isVip) {
    const authHdr = request.headers.get('Authorization') || '';
    const jwt = authHdr.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return errorJson('Missing license token', 401, request, env);
    const v = await verifyJWT(jwt, env.PAYWALL_JWT_SECRET);
    if (!v.ok) return errorJson('License invalid: ' + v.reason, 401, request, env);
  }

  try {
    console.log('[PW] Calling getAccessToken');
    const sa = await getAccessToken(env);
    console.log('[PW] getAccessToken succeeded, projectId:', sa.projectId);
    
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    
    console.log('[PW] Fetching from Firestore path: folio_projects/', folioId, '/body/paid');
    const doc = await fsGet(projectId, sa.token,
      'folio_projects/' + encodeURIComponent(folioId) + '/body/paid');
    
    console.log('[PW] Firestore doc:', doc ? 'EXISTS' : 'NOT FOUND');
    
    if (!doc) return json({ ok: false, reason: 'no-paid-content' }, 404, request, env);
    
    const out = {};
    if (doc.content_gz != null) out.content_gz = doc.content_gz;
    if (doc.content != null) out.content = doc.content;
    console.log('[PW] Returning content, has content_gz:', !!out.content_gz, 'has content:', !!out.content);
    return json({ ok: true, body: out }, 200, request, env);
  } catch (e) {
    console.error('[PW] EXCEPTION:', e.message);
    console.error('[PW] Stack:', e.stack);
    return errorJson('Paid content fetch failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

async function handleTeaserContent(request, env) {
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  const url = new URL(request.url);
  const folioId = (url.searchParams.get('folio') || '').trim();
  if (!folioId) return errorJson('Missing folio', 400, request, env);
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    const parent = await fsGet(projectId, sa.token, 'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) return errorJson('Folio not found or not published', 404, request, env);
    const teasers = Array.isArray(parent.release.teasers) ? parent.release.teasers : [];
    if (teasers.length === 0) return json({ ok: true, chapters: {} }, 200, request, env);
    const paid = await fsGet(projectId, sa.token, 'folio_projects/' + encodeURIComponent(folioId) + '/body/paid');
    if (!paid) return json({ ok: true, chapters: {} }, 200, request, env);
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
      } catch (e) { console.warn('[teaser] decompress failed', e); }
    } else if (paid.content && paid.content.chapters) {
      chapters = paid.content.chapters;
    }
    const filtered = {};
    for (const id of teasers) { if (chapters[id] != null) filtered[id] = chapters[id]; }
    return json({ ok: true, chapters: filtered }, 200, request, env);
  } catch (e) {
    return errorJson('Teaser fetch failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

async function handleVerifyCode(request, env) {
  if (!env.PAYWALL_JWT_SECRET) return errorJson('Server not configured (missing PAYWALL_JWT_SECRET)', 500, request, env);
  if (!env.GCP_SERVICE_ACCOUNT) return errorJson('Server not configured (missing GCP_SERVICE_ACCOUNT)', 500, request, env);
  let body;
  try { body = await request.json(); } catch (e) { return errorJson('Invalid JSON body', 400, request, env); }
  const folioId = ((body && body.folioId) || '').trim();
  const code    = ((body && body.code)    || '').trim();
  if (!folioId) return errorJson('Missing folioId', 400, request, env);
  if (!code)    return errorJson('Missing code',    400, request, env);
  try {
    const sa = await getAccessToken(env);
    const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
    if (!projectId) return errorJson('No Firestore project id', 500, request, env);
    const parent = await fsGet(projectId, sa.token, 'folio_projects/' + encodeURIComponent(folioId));
    if (!parent || !parent.release || !parent.release.published) return errorJson('Folio not found or not published', 404, request, env);
    if (parent.release.provider !== 'custom') return errorJson('This folio is not configured for custom-code unlock', 400, request, env);
    const expected = String(parent.release.unlockCode || '').trim();
    if (!expected) return errorJson('This folio has no unlock code set', 400, request, env);
    if (code.length !== expected.length) return errorJson('Unlock code is incorrect', 403, request, env);
    let diff = 0;
    for (let i = 0; i < code.length; i++) diff |= code.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return errorJson('Unlock code is incorrect', 403, request, env);
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (30 * 86400);
    const sub = await sha256ShortHex(code + '::' + folioId, 8);
    const payload = { sub, release: folioId, product: null, provider: 'custom', purchaseId: null, email: null, iat: now, exp };
    const token = await signJWT(payload, env.PAYWALL_JWT_SECRET);
    return json({ ok: true, token, expiresAt: exp, email: null, daysValid: 30, via: 'custom-code' }, 200, request, env);
  } catch (e) {
    return errorJson('Verify failed: ' + (e.message || 'unknown'), 502, request, env);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') {
      return json({ ok: true, service: 'folio-paywall', stateless: true,
        endpoints: [
          'POST /verify         { releaseId, product, licenseKey, days? }',
          'POST /check          { token }',
          'GET  /check?token=...',
          'GET  /paid-content?folio=...    (Authorization: Bearer <jwt> | X-Folio-VIP: <token>)',
          'POST /verify-code   { folioId, code }',
          'GET  /teaser-content?folio=...',
        ],
      }, 200, request, env);
    }
    if (path === '/verify'         && request.method === 'POST') return handleVerify(request, env);
    if (path === '/check'          && (request.method === 'POST' || request.method === 'GET')) return handleCheck(request, env);
    if (path === '/paid-content'   && request.method === 'GET')  return handlePaidContent(request, env);
    if (path === '/verify-code'    && request.method === 'POST') return handleVerifyCode(request, env);
    if (path === '/teaser-content' && request.method === 'GET')  return handleTeaserContent(request, env);
    return errorJson('Not found: ' + path, 404, request, env);
  },
};
