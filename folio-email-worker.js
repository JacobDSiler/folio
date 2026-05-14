/**
 * folio-email — Cloudflare Worker (Resend-backed)
 * ------------------------------------------------------------------
 * Transactional email sender for Folio's serial-release notifications.
 * The Folio app POSTs a payload describing "chapter N of folio X
 * just unlocked"; this worker formats it into HTML + plain-text and
 * forwards the actual send to Resend.
 *
 * This worker never stores subscribers, never persists email
 * content. It's a stateless adapter: takes JSON in, makes one HTTP
 * call to Resend, returns the result.
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

/* ── Handler ──────────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
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

    // ── Fallthrough — unknown route ────────────────────────────
    return errorJson('Not found: ' + request.method + ' ' + path, 404, request, env);
  },
};
