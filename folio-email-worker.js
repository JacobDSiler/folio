/**
 * folio-email — Cloudflare Worker (Resend-backed)
 * ------------------------------------------------------------------
 * Transactional email sender for Folio's serial-release notifications.
 * The Folio app POSTs a payload describing "chapter N of folio X
 * just unlocked"; this worker formats it into HTML + plain-text and
 * forwards the actual send to Resend.
 *
 * It ALSO runs a scheduled (cron) job — see the SCHEDULED CRON block
 * further down — that closes the "scheduled unlocks email nobody" gap:
 * cadence-based chapter unlocks are computed client-side, so without a
 * server tick a chapter that unlocks on a schedule notifies no one.
 *
 * The /send + /test paths never store anything. The cron path reads
 * Firestore (serial releases + subscribers) but only writes one field
 * back: release.serialEmailedThrough, its own high-water mark.
 *
 * Endpoints
 *   GET  /                 Health check.
 *   GET  /test?to=<email>  Smoke test — sends a fixed sample payload.
 *                          Rate-limited to 5/hr per IP. Use this to
 *                          verify Resend wiring (API key, FROM_EMAIL,
 *                          DKIM, deliverability) without going through
 *                          the full Folio release flow.
 *                          → { ok, id, to, from, note }
 *                            or { error } with 4xx/5xx status.
 *   POST /send             {
 *                            folioId, chapterIndex, chapterTitle,
 *                            folioTitle, folioAuthor,
 *                            readerUrl, unsubscribeUrl,
 *                            to,
 *                          }
 *                          → { ok: true, id }
 *                            or { error } with 4xx/5xx status.
 *   GET  /cron-run?key=…   Manually trigger the scheduled job (the
 *                          same work the cron tick does). Disabled
 *                          unless CRON_TRIGGER_KEY is set; ?key must
 *                          match it. Handy for testing without
 *                          waiting for the hourly tick.
 *                          → { ok: true, summary }
 *
 * Scheduled handler (Cloudflare Cron Trigger)
 *   On each tick the worker reads Firestore, finds published serial
 *   releases whose cadence has unlocked a chapter that hasn't been
 *   emailed yet (tracked by release.serialEmailedThrough), and emails
 *   every subscriber once per newly-crossed chapter.
 *   Add the trigger in the dashboard: Workers → folio-email →
 *   Settings → Triggers → Cron Triggers → e.g. "0 * * * *" (hourly).
 *
 * Bindings (set in Cloudflare dashboard → Settings → Variables):
 *
 *   RESEND_API_KEY     Secret.  Your Resend API key (re_…).
 *                      Get one at https://resend.com/api-keys
 *
 *   FROM_EMAIL         Plain.   Verified sender address. Must be on
 *                      a domain you've verified in Resend. The
 *                      jacobsiler.com domain is verified, so any
 *                      address @jacobsiler.com works without adding
 *                      a new domain. Example:
 *                        "Folio <serials@jacobsiler.com>"
 *
 *   ALLOWED_ORIGIN     Plain text, CSV OK.
 *                      Defaults to https://www.onfolio.press
 *                      The first entry is also used as the base URL
 *                      for reader / unsubscribe links in cron emails.
 *
 *   ── Cron-only bindings (only needed for the scheduled handler) ──
 *
 *   GCP_SERVICE_ACCOUNT  Secret.  The FULL service-account JSON key
 *                      (the file Google Cloud hands you), pasted as
 *                      one secret. Used to authenticate to the
 *                      Firestore REST API. The service account needs
 *                      the "Cloud Datastore User" IAM role.
 *
 *   FIRESTORE_PROJECT_ID  Plain.  Optional — overrides the project_id
 *                      found inside GCP_SERVICE_ACCOUNT. Normally you
 *                      can leave this unset.
 *
 *   CRON_TRIGGER_KEY   Secret.  Optional — any random string. When
 *                      set, enables GET /cron-run?key=… for manual
 *                      testing. Leave unset in normal operation.
 *
 *   APP_PATH           Plain.   Optional — path of the reader app.
 *                      Defaults to /app.html.
 *
 * Security notes
 *   • Origin allowlist is CORS-only — it doesn't stop server-side
 *     callers from POSTing /send. For abuse protection, this worker
 *     also rate-limits by source IP (60 sends/hour) using the
 *     Cloudflare cache as a sloppy counter.
 *   • The Resend API key never leaves the worker. The Folio client
 *     calls THIS worker; the worker calls Resend.
 *   • Email validation is best-effort. Resend will reject malformed
 *     addresses with a 422 which we pass through.
 *   • The service account authenticates to Firestore via Google IAM,
 *     NOT Firestore security rules — so the rules don't need to open
 *     up. The SA just needs the "Cloud Datastore User" role.
 */

const DEFAULT_ORIGIN = 'https://www.onfolio.press';
const RESEND_API     = 'https://api.resend.com/emails';

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
  return json({ error: msg }, status || 400, request, env);
}

/* ── HTML escaping (don't trust any payload field) ────────────── */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Email template ───────────────────────────────────────────── */
function buildEmail(payload) {
  const {
    chapterIndex, chapterTitle,
    folioTitle, folioAuthor,
    readerUrl, unsubscribeUrl,
  } = payload;

  const subject = 'New chapter: ' + (chapterTitle || ('Chapter ' + chapterIndex));
  const byline  = folioAuthor ? ('by ' + folioAuthor) : '';

  // Plain text fallback. Always send both — better deliverability,
  // graceful fallback for plain-text-only clients.
  const text =
    (folioTitle || 'Untitled') + (byline ? '\n' + byline : '') + '\n\n' +
    'A new chapter just unlocked: ' + (chapterTitle || ('Chapter ' + chapterIndex)) + '\n\n' +
    'Read it here: ' + (readerUrl || '(no link)') + '\n\n' +
    '— — —\n' +
    'You are receiving this because you subscribed to updates for this serial.\n' +
    'Unsubscribe: ' + (unsubscribeUrl || '(missing)') + '\n';

  const html =
    '<!DOCTYPE html>' +
    '<html><body style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#222;background:#fafafa">' +
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin-bottom:6px">New chapter unlocked</div>' +
      '<h1 style="font-size:22px;margin:0 0 4px;font-weight:600">' + esc(folioTitle || 'Untitled') + '</h1>' +
      (byline
        ? '<div style="font-size:13px;color:#666;margin-bottom:24px;font-style:italic">' + esc(byline) + '</div>'
        : '<div style="height:18px"></div>') +
      '<div style="background:#fff;border-radius:10px;padding:24px;border:1px solid #eee">' +
        '<div style="font-size:12px;color:#888;margin-bottom:6px">Chapter ' + esc(chapterIndex) + '</div>' +
        '<div style="font-size:18px;font-weight:600;margin-bottom:18px">' + esc(chapterTitle || ('Chapter ' + chapterIndex)) + '</div>' +
        '<a href="' + esc(readerUrl || '#') + '" ' +
          'style="display:inline-block;background:#c98c2a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:500">' +
          'Read the new chapter →' +
        '</a>' +
      '</div>' +
      '<p style="font-size:11px;color:#999;margin-top:32px;line-height:1.6">' +
        'You\'re receiving this because you subscribed to updates for this serial. ' +
        '<a href="' + esc(unsubscribeUrl || '#') + '" style="color:#999">Unsubscribe</a>.' +
      '</p>' +
    '</body></html>';

  return { subject, html, text };
}

/* ── Lightweight rate limit (cache-based) ────────────────────── */
async function checkRateLimit(request, opts) {
  // Per-IP limit using the CF cache as a sloppy counter.
  // Not bulletproof but good enough to slow abuse.
  const cap     = (opts && opts.cap)     || 60;     // events per hour
  const bucket  = (opts && opts.bucket)  || 'email'; // separate keyspace
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const cache = caches.default;
  const key = new Request('https://rl.local/' + bucket + '/' + encodeURIComponent(ip));
  const cached = await cache.match(key);
  let count = 0;
  if (cached) {
    try { count = parseInt(await cached.text(), 10) || 0; } catch (e) {}
  }
  if (count >= cap) return false;
  const resp = new Response(String(count + 1), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
  await cache.put(key, resp);
  return true;
}

/* ── Resend call ──────────────────────────────────────────────── */
async function sendViaResend(env, payload) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }
  if (!env.FROM_EMAIL) {
    throw new Error('FROM_EMAIL not configured');
  }
  const { subject, html, text } = buildEmail(payload);
  const body = {
    from:    env.FROM_EMAIL,
    to:      [payload.to],
    subject: subject,
    html:    html,
    text:    text,
    headers: payload.unsubscribeUrl
      ? { 'List-Unsubscribe': '<' + payload.unsubscribeUrl + '>' }
      : undefined,
  };
  const r = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) {
    const msg = (data && (data.message || data.name)) || ('Resend ' + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data; // { id: '...' }
}

/* ═══════════════════════════════════════════════════════════════════
   SCHEDULED CRON — serial chapter auto-unlock emails
   ───────────────────────────────────────────────────────────────────
   The Folio app computes cadence-based chapter unlocks purely
   client-side: a reader who loads the page after the unlock time just
   sees the chapter. Nothing "fires" at the unlock moment, so a
   chapter that unlocks on a SCHEDULE (vs. the author's manual
   "Release next chapter now" button) emails nobody.

   This handler closes that gap. On each tick it:
     1. Lists every folio_projects doc.
     2. Keeps the ones that are a published serial.
     3. Computes how many chapters SHOULD be unlocked now — the same
        math as the app's _serialReleasedCount — capped at the doc's
        chapterCount.
     4. Compares that against release.serialEmailedThrough, a
        high-water mark this worker owns.
     5. Emails every subscriber once per newly-crossed chapter.
     6. Bumps serialEmailedThrough so nothing is emailed twice.

   FIRST CONTACT with a serial that has no serialEmailedThrough field
   yet is a BASELINE run: it records the current count and sends
   nothing. That way switching the cron on doesn't blast every
   already-released chapter to every existing subscriber.

   Firestore access uses a Google service account (GCP_SERVICE_ACCOUNT,
   the full SA JSON pasted in as a secret). Service accounts
   authenticate via Google IAM, not Firestore security rules, so the
   rules don't need to change — the SA just needs the "Cloud Datastore
   User" role.
   ═══════════════════════════════════════════════════════════════════ */

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE  = 'https://www.googleapis.com/auth/datastore';

/* base64url helpers for the service-account JWT */
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return b64url(new TextEncoder().encode(str));
}

/* PEM (PKCS8) → ArrayBuffer for crypto.subtle.importKey */
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

/* Mint a short-lived OAuth2 access token for the service account.
   Signs a JWT assertion with the SA private key (RS256) and exchanges
   it at Google's token endpoint for a bearer token scoped to Firestore. */
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
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64url(new Uint8Array(sig));

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

/* ── Firestore REST: decode typed values ──────────────────────── */
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

/* ── Firestore REST: list a collection (handles pagination) ───── */
async function fsList(projectId, token, collPath) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + projectId +
               '/databases/(default)/documents/' + collPath;
  const docs = [];
  let pageToken = '';
  do {
    const url = base + '?pageSize=300' +
                (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error('Firestore list ' + collPath + ' failed: ' +
        ((data.error && data.error.message) || r.status));
    }
    for (const d of (data.documents || [])) {
      const id = (d.name || '').split('/').pop();
      docs.push({ id: id, name: d.name, data: fsDecodeFields(d.fields || {}) });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/* ── Firestore REST: bump release.serialEmailedThrough ────────────
   Uses a nested field path in updateMask so ONLY that one sub-field
   changes — the rest of the release map is left untouched. */
async function fsPatchEmailedThrough(projectId, token, folioId, value) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/folio_projects/' + encodeURIComponent(folioId) +
    '?updateMask.fieldPaths=' + encodeURIComponent('release.serialEmailedThrough') +
    '&currentDocument.exists=true';
  const body = {
    fields: {
      release: {
        mapValue: {
          fields: {
            serialEmailedThrough: { integerValue: String(value) },
          },
        },
      },
    },
  };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore patch ' + folioId + ' failed: ' +
      ((data.error && data.error.message) || r.status));
  }
}

/* ── Serial unlock math — mirrors the app's _serial* helpers ──── */
function serialCadenceMs(release) {
  if (!release || !release.serial) return 0;
  const cad = release.serialCadence || 'weekly';
  const day = 24 * 60 * 60 * 1000;
  if (cad === 'weekly')   return  7 * day;
  if (cad === 'biweekly') return 14 * day;
  if (cad === 'monthly')  return 30 * day;
  if (cad === 'custom') {
    const d = Number(release.serialCadenceCustom);
    return (isFinite(d) && d > 0) ? d * day : 7 * day;
  }
  return 7 * day;
}
function serialAutoReleasedCount(release, now) {
  if (!release || !release.serial || !release.serialFirstReleaseAt) return 0;
  const start = Number(release.serialFirstReleaseAt);
  if (!isFinite(start) || now < start) return 0;
  const cMs = serialCadenceMs(release);
  if (cMs <= 0) return 0;
  return Math.floor((now - start) / cMs) + 1;
}
function serialReleasedCount(release, now) {
  if (!release || !release.serial) return 0;
  const auto   = serialAutoReleasedCount(release, now);
  const manual = Number(release.serialReleasedThrough) || 0;
  return Math.max(auto, manual);
}

/* ── The scheduled job ────────────────────────────────────────── */
async function runCron(env) {
  const summary = {
    folios: 0, serials: 0, baselined: 0,
    foliosEmailed: 0, sent: 0, failed: 0, errors: [],
  };
  const PER_RUN_SEND_CAP = 200;  // safety brake against a runaway burst

  const auth = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || auth.projectId;
  if (!projectId) {
    throw new Error('No Firestore project id — set FIRESTORE_PROJECT_ID or ' +
      'use a full service-account JSON (which carries project_id).');
  }

  const appBase = allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const appPath = env.APP_PATH || '/app.html';
  const now = Date.now();

  const folios = await fsList(projectId, auth.token, 'folio_projects');
  summary.folios = folios.length;

  for (const folio of folios) {
    try {
      const release = folio.data && folio.data.release;
      if (!release || !release.published || !release.serial) continue;
      summary.serials++;

      const total = Number(folio.data.chapterCount) || 0;
      let releasedNow = serialReleasedCount(release, now);
      if (total > 0) releasedNow = Math.min(releasedNow, total);
      if (releasedNow < 0) releasedNow = 0;

      // First contact (no high-water mark yet) → baseline, send nothing.
      const hasMark =
        Object.prototype.hasOwnProperty.call(release, 'serialEmailedThrough') &&
        release.serialEmailedThrough != null;
      if (!hasMark) {
        await fsPatchEmailedThrough(projectId, auth.token, folio.id, releasedNow);
        summary.baselined++;
        console.log('[cron] baselined', folio.id,
          '→ serialEmailedThrough =', releasedNow);
        continue;
      }

      const emailedThrough = Number(release.serialEmailedThrough) || 0;
      if (releasedNow <= emailedThrough) continue;  // nothing newly crossed

      // Subscribers for this folio.
      const subs = (await fsList(
        projectId, auth.token, 'folio_projects/' + folio.id + '/subscribers'
      )).map(s => s.data).filter(s => s && s.email);

      console.log('[cron]', folio.id, 'crossed Ch',
        (emailedThrough + 1) + '..' + releasedNow,
        '| subscribers:', subs.length);

      if (subs.length === 0) {
        // Nobody to email — still advance the mark so it isn't reconsidered.
        await fsPatchEmailedThrough(projectId, auth.token, folio.id, releasedNow);
        continue;
      }

      let folioSent = 0, capped = false;
      for (let ch = emailedThrough + 1; ch <= releasedNow && !capped; ch++) {
        for (const sub of subs) {
          if (summary.sent >= PER_RUN_SEND_CAP) {
            summary.errors.push('per-run send cap hit (' + PER_RUN_SEND_CAP + ')');
            capped = true;
            break;
          }
          const payload = {
            folioId:      folio.id,
            chapterIndex: ch,
            chapterTitle: 'Chapter ' + ch,   // titles live in the body subdoc;
                                             // matches the app's manual path,
                                             // which also sends "Chapter N".
            folioTitle:   release.title  || 'Untitled',
            folioAuthor:  release.author || '',
            readerUrl:    appBase + appPath + '?read=' + encodeURIComponent(folio.id),
            unsubscribeUrl: sub.unsubscribeToken
              ? (appBase + appPath +
                 '?unsubscribe=' + encodeURIComponent(sub.unsubscribeToken) +
                 '&folio=' + encodeURIComponent(folio.id))
              : '',
            to: sub.email,
          };
          try {
            await sendViaResend(env, payload);
            summary.sent++; folioSent++;
          } catch (e) {
            summary.failed++;
            console.warn('[cron] send failed', folio.id, 'Ch' + ch,
              sub.email, e && e.message);
          }
        }
      }

      summary.foliosEmailed++;
      // Advance the high-water mark so these chapters never re-send.
      await fsPatchEmailedThrough(projectId, auth.token, folio.id, releasedNow);
      console.log('[cron]', folio.id, 'sent', folioSent,
        '→ serialEmailedThrough =', releasedNow);
    } catch (e) {
      summary.errors.push(folio.id + ': ' + (e && e.message || e));
      console.error('[cron] folio error', folio.id, e);
    }
  }

  console.log('[cron] run complete', JSON.stringify(summary));
  return summary;
}

/* ── Handler ──────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && path === '/') {
      return new Response('folio-email worker OK', {
        status: 200,
        headers: corsHeaders(request, env, { 'Content-Type': 'text/plain' }),
      });
    }

    // ── Smoke-test endpoint ────────────────────────────────────
    // GET /test?to=<email>
    // Sends a fixed sample payload so you can verify Resend wiring
    // (API key, FROM_EMAIL, DKIM/SPF deliverability) without going
    // through the full Folio release flow. Stricter rate limit
    // (5/hr per IP) keeps it unattractive for abuse.
    if (request.method === 'GET' && path === '/test') {
      const to = url.searchParams.get('to') || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return errorJson('Pass ?to=<email>', 400, request, env);
      }
      const okRate = await checkRateLimit(request, { cap: 5, bucket: 'test' });
      if (!okRate) return errorJson('Rate limited (5/hr per IP for /test)', 429, request, env);

      // Sample payload — mirrors the shape POST /send expects, so a
      // successful /test proves the whole Resend path (key, FROM_EMAIL,
      // DKIM/SPF, template render) without needing a real release.
      const sampleBase = allowedOrigins(env)[0] || DEFAULT_ORIGIN;
      const samplePayload = {
        folioId:        'test-folio',
        chapterIndex:   3,
        chapterTitle:   'A Test Chapter',
        folioTitle:     'Folio Email Smoke Test',
        folioAuthor:    'Folio',
        readerUrl:      sampleBase + '/app.html?read=test-folio',
        unsubscribeUrl: sampleBase + '/app.html?unsubscribe=sample&folio=test-folio',
        to:             to,
      };
      try {
        const result = await sendViaResend(env, samplePayload);
        return json({
          ok:   true,
          id:   result && result.id,
          to:   to,
          from: env.FROM_EMAIL,
          note: 'Sample email sent. Check the inbox (and the spam folder).',
        }, 200, request, env);
      } catch (e) {
        return errorJson('Send failed: ' + (e.message || 'unknown'),
                         e.status || 502, request, env);
      }
    }

    // ── Real send endpoint ─────────────────────────────────────
    // POST /send
    //   { folioId, chapterIndex, chapterTitle, folioTitle,
    //     folioAuthor, readerUrl, unsubscribeUrl, to }
    // The Folio app calls this once per subscriber when a chapter
    // unlocks. Rate-limited by source IP (60/hr) — the origin
    // allowlist is CORS-only and doesn't stop server-side callers,
    // so the IP cap is the real abuse brake.
    if (request.method === 'POST' && path === '/send') {
      const okRate = await checkRateLimit(request, { cap: 60, bucket: 'send' });
      if (!okRate) {
        return errorJson('Rate limited (60/hr per IP)', 429, request, env);
      }

      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return errorJson('Body must be valid JSON', 400, request, env);
      }
      if (!payload || typeof payload !== 'object') {
        return errorJson('Body must be a JSON object', 400, request, env);
      }

      const to = String(payload.to || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return errorJson('Missing or invalid "to" address', 400, request, env);
      }
      payload.to = to;

      // chapterIndex / chapterTitle are expected but not hard-required —
      // buildEmail() falls back to "Chapter N" if the title is missing.
      try {
        const result = await sendViaResend(env, payload);
        return json({ ok: true, id: result && result.id }, 200, request, env);
      } catch (e) {
        return errorJson('Send failed: ' + (e.message || 'unknown'),
                         e.status || 502, request, env);
      }
    }

    // ── Manual cron trigger (testing only) ─────────────────────
    // GET /cron-run?key=<CRON_TRIGGER_KEY>
    // Runs the scheduled job on demand so you don't have to wait for
    // the hourly tick. Disabled entirely unless CRON_TRIGGER_KEY is
    // set; ?key must match it exactly.
    if (request.method === 'GET' && path === '/cron-run') {
      if (!env.CRON_TRIGGER_KEY) {
        return errorJson('Manual cron trigger disabled (set CRON_TRIGGER_KEY to enable)',
                         403, request, env);
      }
      if (url.searchParams.get('key') !== env.CRON_TRIGGER_KEY) {
        return errorJson('Bad or missing ?key', 403, request, env);
      }
      try {
        const summary = await runCron(env);
        return json({ ok: true, summary }, 200, request, env);
      } catch (e) {
        return errorJson('Cron run failed: ' + (e.message || 'unknown'),
                         502, request, env);
      }
    }

    // ── Fallthrough — unknown route ────────────────────────────
    return errorJson('Not found: ' + request.method + ' ' + path, 404, request, env);
  },

  // ── Scheduled (Cron Trigger) handler ─────────────────────────
  // Wired up in the dashboard: Workers → folio-email → Settings →
  // Triggers → Cron Triggers. "0 * * * *" runs it hourly. Errors are
  // swallowed (logged, not thrown) so one bad run doesn't wedge the
  // schedule — check `wrangler tail` or the worker's logs to see
  // the [cron] output.
  async scheduled(event, env, ctx) {
    try {
      const summary = await runCron(env);
      console.log('[cron] scheduled tick OK', JSON.stringify(summary));
    } catch (e) {
      console.error('[cron] scheduled tick FAILED',
        e && (e.stack || e.message || e));
    }
  },
};
