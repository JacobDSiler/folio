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
 *   GET  /unsubscribe       { ?token=<unsubscribeToken>&folio=<folioId> }
 *                          Top-level navigation target for the
 *                          unsubscribe link in chapter-release
 *                          emails. Uses the service account to find
 *                          + delete the matching subscriber doc and
 *                          returns a styled HTML confirmation page.
 *                          Rate-limited (20/hr per IP). This lets
 *                          the Firestore subscribers rule lock down
 *                          to owner-only-read (audit item B5).
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

/* ── Author "new subscriber" notification email ──────────────────
   Separate template from the subscriber-facing chapter-release email
   because the audience and intent are different: this one lands in
   the author's inbox, telling them somebody just signed up to their
   pre-launch / serial release. Tight, plain, no unsubscribe footer
   (it's transactional to the author themselves). */
function buildSignupNotifyEmail({ folioTitle, subscriberEmail, readerUrl }) {
  const subject = 'New subscriber: ' + (subscriberEmail || 'someone') +
                  ' joined "' + (folioTitle || 'your folio') + '"';
  const text =
    'Good news — someone just subscribed to ' + (folioTitle || 'your folio') + '.\n\n' +
    'Their email: ' + subscriberEmail + '\n\n' +
    'See your reader link: ' + (readerUrl || '(no link)') + '\n\n' +
    '— — —\n' +
    'You are receiving this because you turned on "Email me when someone new subscribes" in your Folio release settings.\n';
  const html =
    '<!DOCTYPE html>' +
    '<html><body style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#222;background:#fafafa">' +
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin-bottom:6px">New subscriber</div>' +
      '<h1 style="font-size:22px;margin:0 0 18px;font-weight:600">' + esc(folioTitle || 'your folio') + '</h1>' +
      '<div style="background:#fff;border-radius:10px;padding:24px;border:1px solid #eee">' +
        '<div style="font-size:13px;color:#666;margin-bottom:6px">Someone just subscribed:</div>' +
        '<div style="font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:600;color:#111;margin-bottom:18px">' +
          esc(subscriberEmail) +
        '</div>' +
        (readerUrl
          ? '<a href="' + esc(readerUrl) + '" ' +
            'style="display:inline-block;background:#c98c2a;color:#fff;text-decoration:none;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:500">' +
            'Open your reader link →' +
            '</a>'
          : '') +
      '</div>' +
      '<p style="font-size:11px;color:#999;margin-top:32px;line-height:1.6">' +
        'You\'re receiving this because you turned on "Email me when someone new subscribes" in your Folio release settings.' +
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

/* ══════════════════════════════════════════════════════════════════
   ADMIN DAILY DIGEST — added 2026-07-20
   ──────────────────────────────────────────────────────────────────
   Scans folio_projects for release.shelfPendingModeration == true,
   counts them, sends one email per address in ADMIN_DIGEST_EMAILS
   (comma-separated Wrangler secret) with a link to /admin/shelf/.
   Latched via folio_admin_digest_state/latch — max one send per 20h
   regardless of how many times triggered.
   ══════════════════════════════════════════════════════════════════ */
async function runAdminDigest(env, opts) {
  opts = opts || {};
  const summary = { pending: 0, sent: 0, failed: 0, skipped: null, errors: [] };
  if (!env.ADMIN_DIGEST_EMAILS) {
    summary.skipped = 'ADMIN_DIGEST_EMAILS not configured';
    return summary;
  }
  const recipients = String(env.ADMIN_DIGEST_EMAILS).split(',')
    .map(function(s){ return s.trim(); })
    .filter(function(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); });
  if (recipients.length === 0) {
    summary.skipped = 'ADMIN_DIGEST_EMAILS had no valid addresses';
    return summary;
  }

  const auth = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || auth.projectId;
  if (!projectId) throw new Error('No Firestore project id for admin digest');
  const now = Date.now();

  // Latch check — skip if we sent within the last 20 hours (unless force=true)
  const _latchUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/folio_admin_digest_state/latch';
  if (!opts.force) {
    try {
      const r = await fetch(_latchUrl, { headers: { 'Authorization': 'Bearer ' + auth.token } });
      if (r.ok) {
        const data = await r.json().catch(function(){ return {}; });
        const fields = data.fields || {};
        const lastMs = fields.lastSentMs && Number(fields.lastSentMs.integerValue || fields.lastSentMs.doubleValue || 0);
        if (lastMs && (now - lastMs) < (20 * 60 * 60 * 1000)) {
          summary.skipped = 'latched — last sent ' + Math.round((now - lastMs) / (60*60*1000)) + 'h ago';
          return summary;
        }
      }
    } catch (e) { /* latch read failure is not fatal — proceed */ }
  }

  // Query folio_projects and count pending items. Also build a small
  // preview list (top 5) with title + author for the email body.
  const folios = await fsList(projectId, auth.token, 'folio_projects');
  const pending = [];
  for (const folio of folios) {
    const release = folio.data && folio.data.release;
    if (release && release.shelfPendingModeration === true && release.listOnShelf === true) {
      pending.push({
        id: folio.id,
        title: (release.title || folio.data.name || 'Untitled').slice(0, 100),
        author: (release.author || 'Unknown').slice(0, 80),
        submittedAt: Number(release.shelfListedAt || 0),
      });
    }
  }
  pending.sort(function(a, b){ return (b.submittedAt || 0) - (a.submittedAt || 0); });
  summary.pending = pending.length;

  if (pending.length === 0 && !opts.force) {
    summary.skipped = 'no pending items';
    return summary;
  }

  // Build + send one email per recipient.
  const appBase = allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const html = buildAdminDigestEmail({ pending: pending, appBase: appBase, now: now });
  const subject = pending.length === 1
    ? '1 folio awaiting review on Folio'
    : pending.length + ' folios awaiting review on Folio';

  for (const to of recipients) {
    try {
      const r = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL || 'Folio <no-reply@onfolio.press>',
          to: [to],
          subject: subject,
          html: html,
        }),
      });
      if (r.ok) {
        summary.sent++;
      } else {
        const err = await r.text().catch(function(){ return 'unknown'; });
        summary.failed++;
        summary.errors.push({ to: to, err: err.slice(0, 200) });
      }
    } catch (e) {
      summary.failed++;
      summary.errors.push({ to: to, err: (e && e.message) || 'network' });
    }
  }

  // Write latch — best-effort. If it fails, worst case is a duplicate
  // digest tomorrow; not a data-integrity concern.
  try {
    await fetch(_latchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.token,
      },
      body: JSON.stringify({
        fields: {
          lastSentMs: { integerValue: String(now) },
          lastPendingCount: { integerValue: String(pending.length) },
          lastRecipients: { integerValue: String(recipients.length) },
        },
      }),
    });
  } catch (e) { /* non-fatal */ }

  return summary;
}

function buildAdminDigestEmail(payload) {
  const pending = payload.pending || [];
  const appBase = payload.appBase || 'https://www.onfolio.press';
  const shelfAdminUrl = appBase + '/admin/shelf/';
  const rows = pending.slice(0, 10).map(function(p){
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Georgia,serif;font-size:15px;color:#1a1611">' +
      esc(p.title) +
      '</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#5a5347">' +
      esc(p.author) +
      '</td></tr>';
  }).join('');
  const overflow = pending.length > 10
    ? '<p style="font-size:13px;color:#8a8174;margin:10px 0 0">…and ' + (pending.length - 10) + ' more.</p>'
    : '';
  return '<!doctype html><html><body style="margin:0;padding:24px;background:#faf7f1;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#1a1611">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:.5px solid rgba(0,0,0,0.10);border-radius:12px;padding:28px 32px">' +
    '<div style="font-family:\'Playfair Display\',Georgia,serif;font-size:22px;font-weight:600;margin:0 0 4px;color:#1a1611">' +
    '<span style="color:#c98c2a">✨</span> Folio · Moderation queue</div>' +
    '<p style="font-size:14.5px;color:#5a5347;margin:0 0 18px;line-height:1.55">' +
    (pending.length === 1
      ? 'One folio is waiting for you to review.'
      : pending.length + ' folios are waiting for you to review.') +
    '</p>' +
    (pending.length > 0
      ? '<table style="width:100%;border-collapse:collapse;margin:0 0 18px"><thead><tr>' +
        '<th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:#8a8174;text-transform:uppercase;letter-spacing:.08em;border-bottom:.5px solid rgba(0,0,0,0.14)">Title</th>' +
        '<th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:#8a8174;text-transform:uppercase;letter-spacing:.08em;border-bottom:.5px solid rgba(0,0,0,0.14)">Author</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' + overflow
      : '') +
    '<div style="text-align:center;margin:22px 0 6px">' +
    '<a href="' + esc(shelfAdminUrl) + '" style="display:inline-block;padding:11px 22px;background:#065f46;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">Open the moderation queue →</a>' +
    '</div>' +
    '<p style="font-size:11px;color:#8a8174;margin:24px 0 0;line-height:1.55;text-align:center">' +
    'You\'re receiving this because your email is in the Folio admin digest list. Sent max once per 20 hours regardless of activity.' +
    '</p>' +
    '</div></body></html>';
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

/* ── Firestore REST: delete a doc by its full resource name ──────
   `name` is the value from fsList()'s doc.name, e.g.
   "projects/<proj>/databases/(default)/documents/folio_projects/<id>/subscribers/<sid>".
   A 404 is treated as success — if the doc is already gone, the
   unsubscribe goal is achieved. */
async function fsDelete(projectId, token, name) {
  const r = await fetch('https://firestore.googleapis.com/v1/' + name, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!r.ok && r.status !== 404) {
    const data = await r.json().catch(() => ({}));
    throw new Error('Firestore delete failed: ' +
      ((data.error && data.error.message) || r.status));
  }
}

/* ── Confirmation HTML for the /unsubscribe page ────────────────
   Returned as a real top-level page (user clicked an email link),
   styled to match Folio's palette. state: 'ok' | 'already' | 'error'. */
function unsubHtml(env, state, message) {
  const appBase = allowedOrigins(env)[0] || DEFAULT_ORIGIN;
  const icon =
    state === 'ok'      ? '✓' :
    state === 'already' ? '✉' :
                          '⚠';
  const head =
    state === 'ok'      ? 'Unsubscribed' :
    state === 'already' ? 'Already unsubscribed' :
                          'Unsubscribe error';
  return '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(head) + ' · Folio</title>' +
    '<style>' +
      'body{font-family:Georgia,"Times New Roman",serif;max-width:520px;margin:0 auto;padding:48px 24px;color:#222;background:#faf8f3;line-height:1.6}' +
      '.box{background:#fff;padding:36px 32px;border-radius:14px;border:1px solid #e8dfc8;box-shadow:0 12px 30px rgba(0,0,0,.06);text-align:center}' +
      '.icon{font-size:42px;margin-bottom:12px;color:#c98c2a}' +
      'h1{font-family:"Playfair Display",Georgia,serif;font-size:24px;font-weight:700;margin:0 0 12px;color:#1a1504}' +
      'p{font-size:15.5px;color:#444;margin:0 0 16px}' +
      '.btn{display:inline-block;margin-top:14px;padding:10px 20px;border-radius:8px;background:#c98c2a;color:#fff;text-decoration:none;font-family:"Inter",system-ui,sans-serif;font-size:13.5px;font-weight:500}' +
      '.btn:hover{background:#b07919}' +
      '.muted{color:#888;font-size:12.5px;margin-top:24px}' +
    '</style></head><body><div class="box">' +
    '<div class="icon">' + icon + '</div>' +
    '<h1>' + esc(head) + '</h1>' +
    '<p>' + esc(message) + '</p>' +
    '<a class="btn" href="' + esc(appBase) + '">Back to Folio</a>' +
    '<p class="muted">Folio · folio@jacobsiler.com</p>' +
    '</div></body></html>';
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
    // ── Admin digest: manual trigger + cron-callable ───────────────
    // GET /admin-digest?key=<ADMIN_DEBUG_TOKEN>[&force=1]
    // Scans folio_projects for pending moderation items, sends one
    // email per address in ADMIN_DIGEST_EMAILS. Latched to max 1 send
    // per 20h (force=1 bypasses the latch). Also fires automatically
    // from the scheduled() handler at the bottom of this file.
    if (request.method === 'GET' && path === '/admin-digest') {
      const key = url.searchParams.get('key') || '';
      const expected = env.ADMIN_DEBUG_TOKEN || '';
      if (!expected) {
        return errorJson('Admin digest disabled — ADMIN_DEBUG_TOKEN not set', 403, request, env);
      }
      if (key !== expected) {
        return errorJson('Unauthorized', 401, request, env);
      }
      const force = url.searchParams.get('force') === '1';
      try {
        const result = await runAdminDigest(env, { force: force });
        return json({ ok: true, result: result }, 200, request, env);
      } catch (e) {
        return errorJson('Admin digest failed: ' + (e.message || 'unknown'),
          502, request, env);
      }
    }

    // GET /metrics-rollup?key=<ADMIN_DEBUG_TOKEN>[&day=YYYYMMDD]
    // Manual trigger for the daily metrics rollup. Same auth pattern
    // as /admin-digest. ?day= forces a specific day rollup (idempotent
    // — safe to re-run); without ?day= it advances from the latch.
    if (request.method === 'GET' && path === '/metrics-rollup') {
      const key = url.searchParams.get('key') || '';
      const expected = env.ADMIN_DEBUG_TOKEN || '';
      if (!expected) return errorJson('Metrics rollup disabled — ADMIN_DEBUG_TOKEN not set', 403, request, env);
      if (key !== expected) return errorJson('Unauthorized', 401, request, env);
      const day = (url.searchParams.get('day') || '').trim();
      try {
        const result = await runMetricsRollup(env, day ? { force: true, day: day } : {});
        return json({ ok: true, result: result }, 200, request, env);
      } catch (e) {
        return errorJson('Metrics rollup failed: ' + (e.message || 'unknown'),
          502, request, env);
      }
    }

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
      try {
        const result = await sendViaResend(env, payload);
        return json({ ok: true, id: result && result.id }, 200, request, env);
      } catch (e) {
        return errorJson('Send failed: ' + (e.message || 'unknown'),
                         e.status || 502, request, env);
      }
    }

    // ── Author "new subscriber" notification ────────────────────────
    // POST /notify-subscriber-signup
    //   { folioId, subscriberEmail }
    //
    // Called by the reader's _serialCardSubscribe / _serialModalSubscribe
    // right after _subAdd writes to Firestore, IFF the release has
    // notifyOwnerOnSubscribe set. We re-validate that flag server-side
    // (the public release doc) so a third-party can't spam the author's
    // notification email by hand-crafting requests.
    //
    // The author's email lives on the release doc as `notifyEmail`. It's
    // therefore publicly visible — the modal tooltip recommends a
    // `you+folio@gmail.com`-style alias for privacy. Future v2 could
    // move this to an owner-only doc + Identity Toolkit lookup.
    //
    // Rate limit: 60/hr per IP. A viral signup moment shouldn't
    // email-bomb the author either; future v2 can batch.
    if (request.method === 'POST' && path === '/notify-subscriber-signup') {
      const okRate = await checkRateLimit(request, { cap: 60, bucket: 'notify-signup' });
      if (!okRate) {
        return errorJson('Rate limited (60/hr per IP)', 429, request, env);
      }
      let payload;
      try { payload = await request.json(); }
      catch (e) { return errorJson('Body must be valid JSON', 400, request, env); }
      const folioId         = String((payload && payload.folioId) || '').trim();
      const subscriberEmail = String((payload && payload.subscriberEmail) || '').trim();
      if (!folioId)
        return errorJson('Missing folioId', 400, request, env);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subscriberEmail))
        return errorJson('Missing or invalid subscriberEmail', 400, request, env);

      // Look up the release on the parent doc via service account.
      let auth, parentData;
      try {
        auth = await getAccessToken(env);
        const parentUrl = 'https://firestore.googleapis.com/v1/projects/' +
          auth.projectId + '/databases/(default)/documents/folio_projects/' +
          encodeURIComponent(folioId);
        const r = await fetch(parentUrl, {
          headers: { 'Authorization': 'Bearer ' + auth.token },
        });
        if (!r.ok) return errorJson('Folio not found', 404, request, env);
        const raw = await r.json();
        parentData = fsDecodeFields((raw && raw.fields) || {});
      } catch (e) {
        return errorJson('Folio lookup failed: ' + (e.message || 'unknown'),
                         502, request, env);
      }
      const release = (parentData && parentData.release) || {};
      if (!release.notifyOwnerOnSubscribe) {
        // Silently no-op — the author hasn't opted in. Returning OK
        // (not 4xx) so the client never sees a "failed" toast.
        return json({ ok: true, sent: false, reason: 'opt-out' }, 200, request, env);
      }
      const notifyTo = String(release.notifyEmail || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyTo)) {
        return json({ ok: true, sent: false, reason: 'no-notify-email' }, 200, request, env);
      }
      // Build the email + send.
      const folioTitle = String(release.title || parentData.name || 'your folio');
      const readerUrl = 'https://onfolio.press/app.html?read=' + encodeURIComponent(folioId);
      try {
        const { subject, html, text } = buildSignupNotifyEmail({
          folioTitle, subscriberEmail, readerUrl,
        });
        const body = {
          from: env.FROM_EMAIL,
          to: [notifyTo],
          subject, html, text,
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
          return errorJson('Send failed: ' + ((data && (data.message || data.name)) || r.status),
                           r.status, request, env);
        }
        return json({ ok: true, sent: true, id: (data && data.id) || null }, 200, request, env);
      } catch (e) {
        return errorJson('Notify send failed: ' + (e.message || 'unknown'),
                         502, request, env);
      }
    }

    // ── Unsubscribe endpoint (audit B5) ────────────────────────────
    // GET (or POST) /unsubscribe?token=<unsubscribeToken>&folio=<folioId>
    // Top-level navigation target for the unsubscribe link in
    // chapter-release emails. Uses the service account to find +
    // delete the matching subscriber doc and returns a styled HTML
    // confirmation page. Rate-limited (20/hr per IP).
    if ((request.method === 'GET' || request.method === 'POST') && path === '/unsubscribe') {
      const okRate = await checkRateLimit(request, { cap: 20, bucket: 'unsub' });
      if (!okRate) {
        return new Response(
          unsubHtml(env, 'error', 'Too many unsubscribe attempts from this network. Please wait an hour and try again.'),
          { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      const tokenQ = (url.searchParams.get('token') || '').trim();
      const folioId = (url.searchParams.get('folio') || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(tokenQ) || !folioId) {
        return new Response(
          unsubHtml(env, 'error', 'This unsubscribe link is malformed.'),
          { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      try {
        const auth = await getAccessToken(env);
        const projectId = env.FIRESTORE_PROJECT_ID || auth.projectId;
        if (!projectId) throw new Error('No Firestore project id');
        const subs = await fsList(
          projectId, auth.token,
          'folio_projects/' + encodeURIComponent(folioId) + '/subscribers'
        );
        const match = subs.filter(s => s.data && s.data.unsubscribeToken === tokenQ);
        if (match.length === 0) {
          return new Response(
            unsubHtml(env, 'already', 'You were already unsubscribed (or this link has expired). No further chapter emails will be sent.'),
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
        for (const m of match) {
          await fsDelete(projectId, auth.token, m.name);
        }
        console.log('[unsub] removed', match.length, 'subscriber(s) from', folioId);
        return new Response(
          unsubHtml(env, 'ok', 'You\'ve been unsubscribed. You won\'t receive any further chapter emails from this serial.'),
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      } catch (e) {
        console.error('[unsub] failed', folioId, e && (e.stack || e.message || e));
        return new Response(
          unsubHtml(env, 'error', 'Unsubscribe failed: ' + (e.message || 'unknown error') + '. Please try again or email folio@jacobsiler.com.'),
          { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
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

    // ── Fallthrough — unknown route ────────────────────────
    return errorJson('Not found: ' + request.method + ' ' + path, 404, request, env);
  },

  // ── Scheduled (Cron Trigger) handler ─────────────────────
  // Runs THREE jobs on each tick:
  //   1. serial-release notifier (chapter unlock emails)
  //   2. admin moderation digest
  //   3. metrics daily rollup (folio_events → per-folio metrics/daily_*)
  // All three are internally latched — safe to run on any cron cadence.
  async scheduled(event, env, ctx) {
    try {
      const summary = await runCron(env);
      console.log('[cron] serial-release tick OK', JSON.stringify(summary));
    } catch (e) {
      console.error('[cron] serial-release tick FAILED',
        e && (e.stack || e.message || e));
    }
    try {
      const digestSummary = await runAdminDigest(env, {});
      console.log('[cron] admin-digest tick', JSON.stringify(digestSummary));
    } catch (e) {
      console.error('[cron] admin-digest tick FAILED',
        e && (e.stack || e.message || e));
    }
    try {
      const rollupSummary = await runMetricsRollup(env, {});
      console.log('[cron] metrics-rollup tick', JSON.stringify(rollupSummary));
    } catch (e) {
      console.error('[cron] metrics-rollup tick FAILED',
        e && (e.stack || e.message || e));
    }
  },
};

/* ══════════════════════════════════════════════════════════════════
   Metrics daily rollup
   ────────────────────────────────────────────────────────────────────
   Aggregates yesterday's rows from folio_events into per-folio summary
   docs at folio_projects/{folioId}/metrics/daily_YYYYMMDD.

   Latch: folio_metrics_rollup_state/latch tracks the last-rolled-up
   date (UTC). We roll up any UTC day between last+1 and yesterday
   inclusive, up to MAX_DAYS_PER_TICK per invocation.

   Query strategy: folio_events doc ids are prefixed with YYYYMMDD_,
   so a startAt/endBefore filter on __name__ selects a whole day
   without needing a Firestore index on the ts field.

   Rollup fields written per folio per day:
     day:                 'YYYYMMDD'
     folioId:             string
     views:               number of 'view' events
     chapter_opens:       number of 'chapter_open' events
     chapter_open_by_id:  map<chapterId, count>
     read_completes:      number of 'read_complete' events
     paywall_hits:        number of 'paywall_hit' events
     purchases:           number of 'purchase' events
     purchase_amount:     sum of meta.amount for purchase events
     tips:                number of 'tip' events
     tip_amount:          sum of meta.amount for tip events
     countries:           map<countryCode, count>
     referrers:           map<host, count>    (top 20 kept)
     computedAt:          ISO timestamp
   ══════════════════════════════════════════════════════════════════ */
const _METRICS_MAX_DAYS_PER_TICK = 3;

async function runMetricsRollup(env, opts) {
  opts = opts || {};
  const force = !!opts.force;
  const auth = await getAccessToken(env);
  const projectId = env.FIRESTORE_PROJECT_ID || auth.projectId;
  if (!projectId) return { skipped: 'no project id' };

  // Determine days to roll up.
  const todayUtc = _ymdUtc(new Date());
  const yesterdayUtc = _ymdUtc(new Date(Date.now() - 86_400_000));

  let lastRolled = null;
  try {
    const latch = await fsGetDoc(projectId, auth.token,
      'folio_metrics_rollup_state/latch');
    if (latch && latch.lastRolledDay) lastRolled = String(latch.lastRolledDay);
  } catch (e) { /* first-run — no latch yet */ }

  const daysToRoll = [];
  if (force && opts.day) {
    daysToRoll.push(String(opts.day));
  } else {
    // Walk from (lastRolled + 1) to yesterday inclusive.
    let cursor = lastRolled ? _addDaysYmd(lastRolled, 1) : yesterdayUtc;
    while (cursor <= yesterdayUtc && daysToRoll.length < _METRICS_MAX_DAYS_PER_TICK) {
      daysToRoll.push(cursor);
      cursor = _addDaysYmd(cursor, 1);
    }
  }
  if (!daysToRoll.length) return { skipped: 'nothing to roll up', lastRolled: lastRolled };

  const results = { daysRolled: 0, folioDaysWritten: 0, errors: [], lastRolled: lastRolled };
  for (const day of daysToRoll) {
    try {
      const perFolio = await _rollupDay(projectId, auth.token, day);
      // Write one rollup doc per folio touched today.
      for (const folioId of Object.keys(perFolio)) {
        try {
          await _writeMetricsDoc(projectId, auth.token, folioId, day, perFolio[folioId]);
          results.folioDaysWritten++;
        } catch (e) {
          results.errors.push({ folioId, day, msg: e.message });
        }
      }
      results.daysRolled++;
      results.lastRolled = day;
    } catch (e) {
      results.errors.push({ day, msg: e.message });
      // Don't advance latch on failure — retry next tick.
      break;
    }
  }
  // Advance the latch to the last day we successfully rolled up.
  if (results.lastRolled && results.lastRolled !== lastRolled) {
    try {
      await fsWriteDoc(projectId, auth.token,
        'folio_metrics_rollup_state/latch',
        { lastRolledDay: results.lastRolled, updatedAt: new Date().toISOString() });
    } catch (e) { results.errors.push({ msg: 'latch write: ' + e.message }); }
  }
  return results;
}

// Query folio_events by __name__ prefix range for one YYYYMMDD, then
// bucket by folioId + event kind. Returns { folioId: { views: N, ... } }.
async function _rollupDay(projectId, token, day) {
  const perFolio = Object.create(null);
  // Use the runQuery endpoint with a __name__ range filter. Doc ids
  // start with 'YYYYMMDD_<millis>_<rand>' so we bracket by that prefix.
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents:runQuery';
  // We use pageSize via limit; if a day has >1000 events we paginate
  // via startAfter — most days won't come close.
  let lastDocName = null;
  const PAGE = 1000;
  let safety = 0;
  while (safety++ < 50) {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'folio_events' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: {
                  field: { fieldPath: '__name__' },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { referenceValue: 'projects/' + projectId +
                    '/databases/(default)/documents/folio_events/' + day + '_' } } },
              { fieldFilter: {
                  field: { fieldPath: '__name__' },
                  op: 'LESS_THAN',
                  value: { referenceValue: 'projects/' + projectId +
                    '/databases/(default)/documents/folio_events/' + day + '`' } } },
            ]
          }
        },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: PAGE,
      }
    };
    if (lastDocName) {
      body.structuredQuery.startAt = {
        values: [{ referenceValue: lastDocName }],
        before: false,
      };
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error('runQuery ' + r.status + ': ' + JSON.stringify(err));
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    let seenAny = false;
    for (const row of rows) {
      if (!row.document) continue;
      seenAny = true;
      lastDocName = row.document.name;
      const f = fsDecodeFields(row.document.fields || {});
      const folioId = f.folioId;
      if (!folioId) continue;
      const bucket = perFolio[folioId] || (perFolio[folioId] = _emptyRollup());
      const kind = f.kind;
      switch (kind) {
        case 'view':          bucket.views++; break;
        case 'chapter_open':
          bucket.chapter_opens++;
          if (f.chapterId) bucket.chapter_open_by_id[f.chapterId] =
            (bucket.chapter_open_by_id[f.chapterId] || 0) + 1;
          break;
        case 'read_complete': bucket.read_completes++; break;
        case 'paywall_hit':   bucket.paywall_hits++; break;
        case 'purchase': {
          bucket.purchases++;
          const amt = _amountFromMeta(f.metaJson);
          if (amt) bucket.purchase_amount += amt;
          break;
        }
        case 'tip': {
          bucket.tips++;
          const amt = _amountFromMeta(f.metaJson);
          if (amt) bucket.tip_amount += amt;
          break;
        }
      }
      if (f.geo) bucket.countries[f.geo] = (bucket.countries[f.geo] || 0) + 1;
      if (f.referrer) bucket.referrers[f.referrer] = (bucket.referrers[f.referrer] || 0) + 1;
    }
    if (!seenAny || rows.length < PAGE) break;
  }
  // Truncate referrers to top 20 to keep the rollup doc small.
  for (const folioId of Object.keys(perFolio)) {
    perFolio[folioId].referrers = _topN(perFolio[folioId].referrers, 20);
  }
  return perFolio;
}

function _emptyRollup() {
  return {
    views: 0, chapter_opens: 0, chapter_open_by_id: {}, read_completes: 0,
    paywall_hits: 0, purchases: 0, purchase_amount: 0, tips: 0, tip_amount: 0,
    countries: {}, referrers: {},
  };
}
function _amountFromMeta(metaJson) {
  if (!metaJson) return 0;
  try { const o = JSON.parse(metaJson); return Number(o && o.amount) || 0; }
  catch (e) { return 0; }
}
function _topN(obj, n) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const out = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}
function _ymdUtc(d) {
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') +
         String(d.getUTCDate()).padStart(2, '0');
}
function _addDaysYmd(ymd, n) {
  const y = +ymd.slice(0, 4), m = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return _ymdUtc(dt);
}

async function _writeMetricsDoc(projectId, token, folioId, day, r) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents/folio_projects/' +
              encodeURIComponent(folioId) + '/metrics/daily_' + day;
  const fields = {
    day: { stringValue: day },
    folioId: { stringValue: folioId },
    views: { integerValue: String(r.views) },
    chapter_opens: { integerValue: String(r.chapter_opens) },
    read_completes: { integerValue: String(r.read_completes) },
    paywall_hits: { integerValue: String(r.paywall_hits) },
    purchases: { integerValue: String(r.purchases) },
    purchase_amount: { doubleValue: r.purchase_amount },
    tips: { integerValue: String(r.tips) },
    tip_amount: { doubleValue: r.tip_amount },
    chapter_open_by_id: { mapValue: { fields: _numMapToFields(r.chapter_open_by_id) } },
    countries: { mapValue: { fields: _numMapToFields(r.countries) } },
    referrers: { mapValue: { fields: _numMapToFields(r.referrers) } },
    computedAt: { timestampValue: new Date().toISOString() },
  };
  // PATCH creates or overwrites — safe to re-run (idempotent per day).
  const rsp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!rsp.ok) {
    const err = await rsp.json().catch(() => ({}));
    throw new Error('metrics doc write ' + rsp.status + ': ' + JSON.stringify(err));
  }
}
function _numMapToFields(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    out[k] = { integerValue: String(obj[k]) };
  }
  return out;
}

// Small helpers reused by rollup — mirror fsPatchEmailedThrough's style.
async function fsGetDoc(projectId, token, path) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents/' + path;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
  if (r.status === 404) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('getDoc ' + path + ' failed: ' +
    ((data.error && data.error.message) || r.status));
  return fsDecodeFields(data.fields || {});
}
async function fsWriteDoc(projectId, token, path, data) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents/' + path;
  const fields = {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = Number.isInteger(v)
      ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const rsp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!rsp.ok) {
    const err = await rsp.json().catch(() => ({}));
    throw new Error('writeDoc ' + path + ' failed: ' + JSON.stringify(err));
  }
}
