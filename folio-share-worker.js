/**
 * folio-share — Cloudflare Worker
 * ------------------------------------------------------------------
 * Rich social previews for Folio share links.
 *
 * Folio's reader (app.html) is a static, client-side SPA hosted on
 * GitHub Pages. Social scrapers (Facebook/Messenger, Twitter/X,
 * LinkedIn, Slack, Discord, WhatsApp, …) do NOT execute JavaScript,
 * so any Open Graph tags injected by app.html's JS are invisible to
 * them — a pasted reader link unfurls as a bare URL.
 *
 * This worker sits on the share-link route and fixes that:
 *   • For social-crawler user-agents it fetches the folio's metadata
 *     from Firestore via a service account and returns a small HTML
 *     page carrying correct, per-book og:* / twitter:* tags.
 *   • For real browsers it 302-redirects straight to the reader,
 *     https://www.onfolio.press/app.html?read=<folioId>.
 *
 * Crawler detection is only relied on in the SAFE direction:
 * crawlers identify themselves on purpose, so matching their UA is
 * reliable. Anything not recognised as a crawler is treated as a
 * human and redirected — a human never sees the interstitial HTML.
 *
 * Cover image resolution chain (most-specific first):
 *   1. release.coverUrl on the parent doc (cheap; saved by
 *      _rlPublish from Phase 4 onward).
 *   2. Body-doc fallback: decompress folio_projects/<id>/body/main
 *      and use state.images[0].url. Works for folios published
 *      before the parent-doc field existed — no re-publish needed.
 *   3. DEFAULT_OG_IMAGE (the generic Folio og-default.png).
 *
 * ── DEPLOYMENT ────────────────────────────────────────────────────
 * Recommended: a Worker Route on  www.onfolio.press/s/*  — then share
 * links are clean and on-brand:  https://www.onfolio.press/s/<id>
 *
 * Variables (Cloudflare dashboard → Settings → Variables & Secrets):
 *   GCP_SERVICE_ACCOUNT   Secret. The same service-account JSON the
 *                         folio-paywall / folio-email workers use.
 *                         The SA needs the "Cloud Datastore User" role.
 *   FIRESTORE_PROJECT_ID  Optional. Overrides the SA JSON's project_id.
 *   READER_BASE           Optional. Default https://www.onfolio.press
 *   FB_APP_ID             Optional. Numeric Facebook App ID. When set,
 *                         the worker emits <meta property="fb:app_id">
 *                         which silences Facebook Sharing Debugger's
 *                         "missing required properties" warning. Get
 *                         one at developers.facebook.com (create an
 *                         app — no review required for OG metadata).
 */

const READER_BASE_DEFAULT = 'https://www.onfolio.press';
const SITE_NAME           = 'Folio';
const DEFAULT_OG_IMAGE    = 'https://www.onfolio.press/og-default.png';
const GOOGLE_TOKEN_URI    = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE     = 'https://www.googleapis.com/auth/datastore';

// Social-scraper user agents. Reliable to match — crawlers announce
// themselves deliberately. Everything else is treated as a browser.
const CRAWLER_RE = new RegExp(
  [
    'facebookexternalhit', 'facebookcatalog', 'Facebot',
    'Twitterbot', 'LinkedInBot', 'Slackbot', 'Slack-ImgProxy',
    'Discordbot', 'TelegramBot', 'WhatsApp', 'Pinterest',
    'redditbot', 'Googlebot', 'bingbot', 'Applebot', 'Embedly',
    'Iframely', 'SkypeUriPreview', 'vkShare', 'W3C_Validator',
    'Google-PageRenderer', 'Yahoo', 'Bitrix', 'XING-contenttabreceiver',
    'nuzzel', 'Qwantify', 'pinterestbot', 'Mastodon', 'MetaInspector',
  ].join('|'),
  'i'
);

/* ── base64url + crypto helpers (Web Crypto) ──────────────────── */
function b64urlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
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

/* Mint a Google OAuth2 access token for the service account.
   Identical flow to folio-paywall / folio-email. */
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

/* ── Firestore REST — decode typed values + fetch one document ── */
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

/* Body-doc fallback for the cover image. The parent doc only has
   release.coverUrl from Phase 4 onward; older folios store their
   cover URL inside the gzipped body/main state. This decompresses
   body/main and returns the first image's https URL, or null. */
async function fetchCoverFromBody(projectId, token, folioId) {
  const body = await fsGet(projectId, token,
    'folio_projects/' + encodeURIComponent(folioId) + '/body/main');
  if (!body) return null;
  let state = null;
  if (body.state_gz) {
    try {
      const bin = atob(body.state_gz);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const txt = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      ).text();
      state = JSON.parse(txt);
    } catch (e) { return null; }
  } else if (body.state && typeof body.state === 'object') {
    state = body.state;
  }
  if (!state || !Array.isArray(state.images) || state.images.length === 0) return null;
  const first = state.images[0];
  if (first && first.url && /^https:\/\//i.test(String(first.url))) {
    return String(first.url);
  }
  return null;
}

/* ── HTML helpers ─────────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Trim a description to a sensible preview length on a word boundary.
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim() + '…';
}

function ogPage(meta) {
  const card = meta.image ? 'summary_large_image' : 'summary';
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + esc(meta.title) + '</title>',
    '<meta name="description" content="' + esc(meta.description) + '">',
    '<link rel="canonical" href="' + esc(meta.shareUrl) + '">',
    '<meta property="og:site_name" content="' + esc(SITE_NAME) + '">',
    '<meta property="og:type" content="' + esc(meta.ogType) + '">',
    '<meta property="og:title" content="' + esc(meta.title) + '">',
    '<meta property="og:description" content="' + esc(meta.description) + '">',
    '<meta property="og:url" content="' + esc(meta.shareUrl) + '">',
  ];
  if (meta.fbAppId) {
    lines.push('<meta property="fb:app_id" content="' + esc(meta.fbAppId) + '">');
  }
  if (meta.image) {
    lines.push('<meta property="og:image" content="' + esc(meta.image) + '">');
    lines.push('<meta property="og:image:alt" content="' + esc(meta.title) + '">');
  }
  lines.push('<meta name="twitter:card" content="' + card + '">');
  lines.push('<meta name="twitter:title" content="' + esc(meta.title) + '">');
  lines.push('<meta name="twitter:description" content="' + esc(meta.description) + '">');
  if (meta.image) lines.push('<meta name="twitter:image" content="' + esc(meta.image) + '">');
  // NOTE: deliberately NO <meta http-equiv="refresh"> here. Facebook
  // (and most social scrapers) follow meta-refresh tags during preview
  // generation — they'd chase past these OG tags to app.html, which
  // carries only generic Folio fallback tags, and the carefully-built
  // per-book card would be discarded. The <script> location.replace
  // below and the visible link cover the rare case a real browser
  // lands here (it normally gets a 302 before reaching this HTML).
  lines.push('</head><body style="font-family:Georgia,serif;text-align:center;padding:48px 24px;color:#1a1504;background:#faf8f4">');
  lines.push('<p style="font-size:18px;margin:0 0 6px">Opening <strong>' + esc(meta.title) + '</strong>…</p>');
  lines.push('<p style="font-size:14px"><a href="' + esc(meta.readerUrl) + '" style="color:#8B4513">Continue to Folio &rarr;</a></p>');
  lines.push('<script>location.replace(' + JSON.stringify(meta.readerUrl) + ');<\/script>');
  lines.push('</body></html>');
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════════
 * Per-folio SEO landing (Task #26)
 *
 * /f/<slug> resolves to a full HTML page carrying:
 *   - Standard <title>, <meta description>, canonical <link>
 *   - Open Graph + Twitter Card
 *   - schema.org/Book JSON-LD (Google Books-style rich results)
 *   - A human-readable landing body (cover, title, author, blurb,
 *     "Read this folio" CTA linking to /s/<folioId>)
 *
 * The URL /f/<slug> is what we submit to sitemap.xml and what
 * Googlebot indexes. /s/<id> stays reader-focused + robots-blocked.
 * ═══════════════════════════════════════════════════════════════════ */
function _renderFolioLanding({ slug, folio, folioId, readerBase, fbAppId }) {
  const rel     = folio.release || {};
  const title   = String(rel.title  || folio.name || 'Untitled Folio').trim();
  const author  = String(rel.author || '').trim();
  const blurb   = String(rel.description || '').trim();
  const cover   = (rel.coverUrl && /^https:\/\//i.test(rel.coverUrl)) ? rel.coverUrl : null;
  const lang    = String(rel.language || rel.lang || folio.primaryLang || 'en').trim();
  const isPaid  = rel.priceMode === 'paid';
  const price   = isPaid ? Number(rel.price || 0) : 0;
  const currency = String(rel.currency || 'USD').trim();
  const canonical = readerBase + '/f/' + encodeURIComponent(slug);
  const readerUrl = readerBase + '/s/' + encodeURIComponent(folioId);
  const displayTitle = clip(title + (author ? (' by ' + author) : ''), 85);
  const displayDesc = clip(blurb ||
    (author
      ? ('A ' + (isPaid ? 'book' : 'book') + ' by ' + author + ', published on Folio.')
      : 'Read this book on Folio.'), 200);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    'name': title,
    'author': author ? { '@type': 'Person', 'name': author } : undefined,
    'description': blurb || displayDesc,
    'inLanguage': lang,
    'url': canonical,
    'image': cover || undefined,
    'publisher': { '@type': 'Organization', 'name': 'Folio', 'url': readerBase },
    'offers': isPaid && price > 0
      ? { '@type': 'Offer', 'price': price, 'priceCurrency': currency,
          'availability': 'https://schema.org/InStock', 'url': readerUrl }
      : { '@type': 'Offer', 'price': 0, 'priceCurrency': currency,
          'availability': 'https://schema.org/InStock', 'url': readerUrl },
  };
  const jsonLdStr = JSON.stringify(jsonLd, function (k, v) { return v === undefined ? undefined : v; });
  const parts = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="' + esc(lang) + '"><head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<title>' + esc(displayTitle) + ' · Folio</title>');
  parts.push('<meta name="description" content="' + esc(displayDesc) + '">');
  parts.push('<link rel="canonical" href="' + esc(canonical) + '">');
  parts.push('<meta name="robots" content="index, follow, max-image-preview:large">');
  parts.push('<meta property="og:site_name" content="Folio">');
  parts.push('<meta property="og:type" content="book">');
  parts.push('<meta property="og:title" content="' + esc(displayTitle) + '">');
  parts.push('<meta property="og:description" content="' + esc(displayDesc) + '">');
  parts.push('<meta property="og:url" content="' + esc(canonical) + '">');
  if (fbAppId) parts.push('<meta property="fb:app_id" content="' + esc(fbAppId) + '">');
  if (cover) {
    parts.push('<meta property="og:image" content="' + esc(cover) + '">');
    parts.push('<meta property="og:image:alt" content="Cover of ' + esc(title) + '">');
  }
  parts.push('<meta name="twitter:card" content="' + (cover ? 'summary_large_image' : 'summary') + '">');
  parts.push('<meta name="twitter:title" content="' + esc(displayTitle) + '">');
  parts.push('<meta name="twitter:description" content="' + esc(displayDesc) + '">');
  if (cover) parts.push('<meta name="twitter:image" content="' + esc(cover) + '">');
  parts.push('<script type="application/ld+json">' + jsonLdStr.replace(/</g, '\\u003c') + '<\/script>');
  parts.push('<style>');
  parts.push('body{margin:0;font-family:Georgia,\'Playfair Display\',serif;background:#f6f4ee;color:#1a1611;line-height:1.6}');
  parts.push('.wrap{max-width:720px;margin:0 auto;padding:48px 24px}');
  parts.push('.eyebrow{font-family:-apple-system,\'Segoe UI\',sans-serif;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:#8a8378;margin-bottom:10px}');
  parts.push('.card{background:#fff;border-radius:14px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,.06);display:flex;gap:28px;flex-wrap:wrap}');
  parts.push('.cover{flex:0 0 180px;aspect-ratio:2/3;background:#e8e2d4 center/cover;border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.15)}');
  parts.push('.body{flex:1;min-width:260px}');
  parts.push('h1{font-size:30px;margin:0 0 4px;font-weight:600;line-height:1.15}');
  parts.push('.author{font-size:15px;color:#5a5347;font-style:italic;margin:0 0 20px}');
  parts.push('.blurb{font-size:14.5px;line-height:1.7;color:#1a1611;margin:0 0 22px;white-space:pre-wrap}');
  parts.push('.cta{display:inline-block;background:#065f46;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:500;font-family:-apple-system,\'Segoe UI\',sans-serif}');
  parts.push('.cta:hover{background:#054a37}');
  parts.push('.pill{display:inline-block;background:#f6f4ee;color:#5a5347;font-family:-apple-system,\'Segoe UI\',sans-serif;font-size:11.5px;padding:3px 9px;border-radius:11px;margin:0 4px 4px 0}');
  parts.push('footer{margin-top:32px;text-align:center;font-size:12px;color:#8a8378;font-family:-apple-system,\'Segoe UI\',sans-serif}');
  parts.push('footer a{color:#8a8378;text-decoration:none;border-bottom:.5px dotted currentColor;padding-bottom:1px}');
  parts.push('@media (prefers-color-scheme:dark){body{background:#141210;color:#f0ece2}.card{background:#1e1b17}.cover{background:#2a251e}.blurb{color:#e5ddce}.author{color:#a89e8d}.pill{background:#2a251e;color:#a89e8d}footer{color:#a89e8d}}');
  parts.push('</style>');
  parts.push('</head><body>');
  parts.push('<div class="wrap">');
  parts.push('<div class="eyebrow">A book on Folio</div>');
  parts.push('<article class="card">');
  parts.push('<div class="cover"' + (cover ? (' style="background-image:url(' + esc(cover) + ')"') : '') + ' aria-hidden="true"></div>');
  parts.push('<div class="body">');
  parts.push('<h1>' + esc(title) + '</h1>');
  if (author) parts.push('<p class="author">by ' + esc(author) + '</p>');
  if (blurb) parts.push('<p class="blurb">' + esc(blurb) + '</p>');
  const pills = [];
  if (isPaid && price > 0) pills.push('<span class="pill">' + esc(currency) + ' ' + price.toFixed(2) + '</span>');
  else pills.push('<span class="pill">Free to read</span>');
  if (rel.serial) pills.push('<span class="pill">Serial release</span>');
  if (lang && lang !== 'en') pills.push('<span class="pill">Language: ' + esc(lang) + '</span>');
  parts.push('<div>' + pills.join(' ') + '</div>');
  parts.push('<p style="margin-top:24px"><a class="cta" href="' + esc(readerUrl) + '">Read this folio &rarr;</a></p>');
  parts.push('</div>');
  parts.push('</article>');
  parts.push('<footer>');
  parts.push('Published on <a href="' + esc(readerBase) + '/">Folio</a> · ');
  parts.push('<a href="' + esc(readerBase) + '/shelf/">Browse the Shelf</a> · ');
  parts.push('<a href="' + esc(readerBase) + '/app.html">Write your own folio</a>');
  parts.push('</footer>');
  parts.push('</div>');
  parts.push('</body></html>');
  return parts.join('\n');
}

function _renderFolioNotFound(slug, readerBase) {
  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Folio not found · Folio</title>' +
    '<meta name="robots" content="noindex, follow">' +
    '<link rel="canonical" href="' + esc(readerBase) + '/shelf/">' +
    '<style>body{margin:0;font-family:Georgia,serif;background:#f6f4ee;color:#1a1611;padding:60px 24px;text-align:center}h1{font-size:26px;margin:0 0 12px}p{color:#5a5347;margin:0 0 22px}a{display:inline-block;background:#065f46;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-family:-apple-system,sans-serif;font-weight:500}</style>' +
    '</head><body>' +
    '<h1>That folio isn\'t here.</h1>' +
    '<p>The slug <code>' + esc(slug) + '</code> doesn\'t match any published folio right now.</p>' +
    '<p><a href="' + esc(readerBase) + '/shelf/">Browse the Folio Shelf &rarr;</a></p>' +
    '</body></html>';
}

export default {
  async fetch(request, env) {
    const url        = new URL(request.url);
    const readerBase = (env.READER_BASE || READER_BASE_DEFAULT).replace(/\/+$/, '');
    const fbAppId    = (env.FB_APP_ID || '').trim();

    // ── Same-origin materialize proxy ─────────────────────────────
    // The affiliate cookie is set with Domain=.onfolio.press and is
    // HttpOnly, so it never reaches the paywall worker (different
    // origin). The reader (app.html) POSTs here after sign-in; we
    // read the cookie, forward the code to the paywall's
    // /affiliates/materialize with the same Authorization header the
    // caller supplied. Fire-and-forget for the caller; failures are
    // swallowed to avoid disrupting reader mode.
    if (request.method === 'POST' && url.pathname === '/aff-materialize') {
      const folio = (url.searchParams.get('folio') || '').trim();
      const authHdr = request.headers.get('Authorization') || '';
      const paywallUrl = (env.PAYWALL_WORKER_URL ||
        'https://folio-paywall.jacobdsiler.workers.dev').replace(/\/+$/, '');
      if (!folio || !authHdr) {
        return new Response(JSON.stringify({ ok: false, error: 'bad-request' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      // Extract the cookie value the paywall would otherwise miss.
      const rawCookie = request.headers.get('Cookie') || '';
      const safeKey = 'folio_aff_' + folio.replace(/[^A-Za-z0-9_-]/g, '_');
      let code = '';
      for (const part of rawCookie.split(/;\s*/)) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.substring(0, eq) === safeKey) {
          const v = part.substring(eq + 1).trim();
          if (/^[A-Za-z0-9]{4,16}$/.test(v)) { code = v; break; }
        }
      }
      // No cookie → nothing to do; return a truthful no-op so the
      // caller can distinguish "attribution skipped" from "network fail".
      if (!code) {
        return new Response(JSON.stringify({ ok: true, attributed: false, reason: 'no-cookie' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      try {
        const r = await fetch(paywallUrl + '/affiliates/materialize?folio=' + encodeURIComponent(folio), {
          method: 'POST',
          headers: {
            'Authorization': authHdr,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code }),
        });
        const text = await r.text();
        return new Response(text, {
          status: r.status,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e) }),
          { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // ── Sitemap for search engines ────────────────────────────────
    // Enumerates every published + shelf-listed folio as /f/<slug>
    // URLs. Cached at the edge for 1 hour so Googlebot doesn't hammer
    // Firestore. See docs/AFFILIATES_SPEC.md's per-folio SEO section
    // (Task #26).
    if (request.method === 'GET' && url.pathname === '/sitemap.xml') {
      try {
        const sa = await getAccessToken(env);
        const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
        // Query folio_slugs — small, indexed, no need to scan projects.
        const listUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId +
          '/databases/(default)/documents/folio_slugs?pageSize=500';
        const listRes = await fetch(listUrl, { headers: { 'Authorization': 'Bearer ' + sa.token } });
        const listData = await listRes.json().catch(() => ({}));
        const docs = (listData && listData.documents) || [];
        const urls = [];
        for (const d of docs) {
          const slug = String(d.name || '').split('/').pop();
          if (!slug) continue;
          const updatedAt = d.updateTime || new Date().toISOString();
          urls.push(
            '  <url>\n' +
            '    <loc>' + readerBase + '/f/' + slug + '</loc>\n' +
            '    <lastmod>' + updatedAt.substring(0, 10) + '</lastmod>\n' +
            '    <changefreq>weekly</changefreq>\n' +
            '  </url>'
          );
        }
        // Always include the top-level surfaces so the shelf itself is
        // discoverable even before anyone claims a slug.
        const top = [
          '  <url><loc>' + readerBase + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>',
          '  <url><loc>' + readerBase + '/shelf/</loc><changefreq>daily</changefreq><priority>0.9</priority></url>',
          '  <url><loc>' + readerBase + '/press/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>',
        ];
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          top.concat(urls).join('\n') + '\n' +
          '</urlset>\n';
        return new Response(xml, {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (e) {
        return new Response('<!-- sitemap generation failed: ' + String(e.message || 'unknown').replace(/[<>&]/g,'') + ' -->',
          { status: 500, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
      }
    }

    // ── /f/<slug> — per-folio SEO landing (Task #26) ───────────────
    // Google-indexable, canonical URL per folio. Server-rendered HTML
    // with OG + Twitter + schema.org/Book JSON-LD and a human-readable
    // body (cover, title, author, description, tags, "Read this folio"
    // CTA). Works for both crawlers and humans — humans get a nicely
    // styled landing; crawlers get the same page with all the meta.
    const fMatch = url.pathname.match(/^\/f\/([a-z0-9][a-z0-9-]{1,63})\/?$/);
    if (request.method === 'GET' && fMatch) {
      const slug = fMatch[1];
      try {
        const sa = await getAccessToken(env);
        const projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
        // Slug → folioId lookup (cheap, single doc read).
        const slugDoc = await fsGet(projectId, sa.token,
          'folio_slugs/' + encodeURIComponent(slug));
        if (!slugDoc || !slugDoc.folioId) {
          return new Response(_renderFolioNotFound(slug, readerBase), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
          });
        }
        const folio = await fsGet(projectId, sa.token,
          'folio_projects/' + encodeURIComponent(slugDoc.folioId));
        if (!folio || !folio.release || !folio.release.published) {
          return new Response(_renderFolioNotFound(slug, readerBase), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
          });
        }
        const html = _renderFolioLanding({
          slug, folio, folioId: slugDoc.folioId, readerBase, fbAppId,
        });
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Cache 5 min at the edge — folios change infrequently but
            // authors expect fresh data when they update their release.
            'Cache-Control': 'public, max-age=300',
          },
        });
      } catch (e) {
        return new Response('<!-- render failed: ' + String(e.message || 'unknown').replace(/[<>&]/g,'') + ' -->',
          { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }

    // folioId — from a /s/<id> path, or a ?read= / ?id= / ?folio= query.
    let folioId = '';
    const m = url.pathname.match(/\/s\/([^/?#]+)/);
    if (m) {
      try { folioId = decodeURIComponent(m[1]); } catch (e) { folioId = m[1]; }
    }
    if (!folioId) {
      folioId = url.searchParams.get('read') ||
                url.searchParams.get('id')   ||
                url.searchParams.get('folio') || '';
    }
    folioId = (folioId || '').trim();
    const teaser = (url.searchParams.get('teaser') || '').trim();
    // Signed-teaser token. Mirrors the `tt=` param the editor mints when
    // the author copies a teaser link for a NON-listed chapter — the URL
    // itself is the credential and the app's _readDocState calls
    // /signed-teaser-content to unlock just that chapter. Worker MUST
    // forward this through to the reader URL; dropping it makes the
    // signed-teaser feature silently no-op (locked card with banner,
    // no content unlock).
    const tt = (url.searchParams.get('tt') || '').trim();
    // Affiliate code — 8-char base62 minted per (owner, folio, affiliate)
    // triple by the paywall worker at invite time. Captured here into a
    // 30-day HttpOnly cookie so subsequent checkout requests can be
    // attributed even if the reader browses away and returns via a
    // non-affiliate link. See docs/AFFILIATES_SPEC.md → Attribution flow.
    // Strict charset check prevents cookie-stuffing with garbage codes.
    let affCode = (url.searchParams.get('a') || '').trim();
    if (affCode && !/^[A-Za-z0-9]{4,16}$/.test(affCode)) affCode = '';

    // No id → send everyone to the Folio home page.
    if (!folioId) return Response.redirect(readerBase + '/', 302);

    // Canonical reader URL (where humans end up).
    // We deliberately DO NOT propagate `?a=` — the cookie carries the
    // attribution from here on. Keeps the URL clean so readers don't
    // accidentally reshare someone else's affiliate code.
    let readerUrl = readerBase + '/app.html?read=' + encodeURIComponent(folioId);
    if (teaser) readerUrl += '&teaser=' + encodeURIComponent(teaser);
    if (tt)     readerUrl += '&tt='     + encodeURIComponent(tt);
    // Canonical share URL (what crawlers record as og:url).
    let shareUrl = url.origin + url.pathname;
    if (teaser) shareUrl += '?teaser=' + encodeURIComponent(teaser);
    if (tt)     shareUrl += (shareUrl.includes('?') ? '&' : '?') + 'tt=' + encodeURIComponent(tt);

    // Build the affiliate Set-Cookie header (if applicable). One cookie
    // per folioId so attributions for different folios don't clobber
    // each other — a reader could legitimately be attributed to different
    // affiliates for different books. Cookie name is sanitised to the
    // cookie-safe charset; folioIds in prod are `proj_<ts>_<rand>` so
    // this is a no-op for real IDs but hardens against exotic values.
    //
    // NOTE: intentionally NOT HttpOnly. The paywall worker lives on a
    // different origin (folio-paywall.jacobdsiler.workers.dev) than the
    // reader (onfolio.press), so an HttpOnly cookie would never reach
    // it. The reader JS reads the cookie and passes the code in the
    // materialize POST body. The cookie value is just an 8-char
    // affiliate code — not a secret; the worst an attacker with XSS
    // could do is claim someone else's referral on their OWN purchase,
    // which is exactly what the cookie is *supposed* to do anyway.
    const affCookieHeader = affCode
      ? [
          'folio_aff_' + folioId.replace(/[^A-Za-z0-9_-]/g, '_')
            + '=' + affCode,
          'Max-Age=2592000',        // 30 days
          'Path=/',
          'Domain=.onfolio.press',  // shared across app + paywall subdomains
          'SameSite=Lax',
          'Secure',
        ].join('; ')
      : null;

    const ua = request.headers.get('User-Agent') || '';
    if (!CRAWLER_RE.test(ua)) {
      // Real browser → straight to the reader, no interstitial. Attach
      // the affiliate cookie on the redirect response so the browser
      // stores it before landing on the reader.
      const headers = { Location: readerUrl };
      if (affCookieHeader) headers['Set-Cookie'] = affCookieHeader;
      return new Response(null, { status: 302, headers });
    }

    // ── Crawler: build per-book Open Graph metadata from Firestore ──
    let title       = 'A book on Folio';
    let description = 'Read it now on Folio — beautiful books in your browser.';
    let image       = '';
    let ogType      = 'book';
    let projectId   = null;
    let saToken     = null;
    try {
      const sa = await getAccessToken(env);
      projectId = env.FIRESTORE_PROJECT_ID || sa.projectId;
      saToken   = sa.token;
      if (projectId) {
        const folio = await fsGet(projectId, saToken,
          'folio_projects/' + encodeURIComponent(folioId));
        if (folio && folio.release && folio.release.published) {
          const rel    = folio.release;
          const bkName = (rel.title || folio.name || 'A book on Folio').toString();
          const author = (rel.author || '').toString().trim();
          // og:title carries BOTH the book identity AND "on Folio" so
          // platforms that only show the title prominently (Messenger,
          // Slack, etc.) still convey what + where in one glance.
          // Capped to ~85 chars — Facebook truncates around 90.
          title = clip(bkName + (author ? (' by ' + author) : '') + ' · on Folio', 85);
          let desc = (rel.description || '').toString().trim();
          if (!desc) {
            desc = author
              ? ('A book by ' + author + ', published on Folio.')
              : 'Read it now on Folio.';
          }
          description = clip(desc, 200);
          if (rel.coverUrl && /^https:\/\//i.test(String(rel.coverUrl))) {
            image = String(rel.coverUrl);
          }
          ogType = rel.serial ? 'article' : 'book';
          if (rel.serial && rel.priceMode !== 'paid') {
            description = clip('A serial release — new chapters unlock on a schedule. ' + desc, 200);
          }
          // Funnel teaser link: reframe as a free sample.
          if (teaser) {
            title = clip('Free chapter — ' + bkName + (author ? (' by ' + author) : '') + ' · on Folio', 85);
            description = clip(
              'Read a free chapter of "' + bkName + '"' +
              (author ? (' by ' + author) : '') + ' on Folio.', 200);
            ogType = 'article';
          }
        }
      }
    } catch (e) {
      // Parent-doc lookup failed — fall through; body-doc fallback or
      // the default OG image will keep the card useful.
    }

    // Body-doc cover fallback: when release.coverUrl is missing, dig
    // into folio_projects/<id>/body/main and use state.images[0].url.
    // Slower (gzip decompress + JSON parse) but works for folios that
    // were published before _rlPublish started saving coverUrl. Only
    // triggers when no image has been resolved yet AND we have a
    // working SA token from the parent-doc call.
    if (!image &&