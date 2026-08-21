/**
 * Folio — Cloudflare Pages middleware.
 * Handles wildcard subdomain routing: <slug>.onfolio.press → /imprint/?slug=<slug>.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Marketed on /press/ as an Imprint-tier feature ("Custom subdomain").
 * GitHub Pages (Folio's original host) can't do wildcard subdomains at
 * all — one custom domain per site, hard limit. Cloudflare Pages CAN,
 * as long as (a) the wildcard is set up as a custom domain on the
 * Pages project, and (b) DNS points *.onfolio.press at the Pages
 * hostname. See docs/SUBDOMAIN_SETUP.md for the dashboard steps that
 * need to happen ONCE, out of band, by Jacob.
 *
 * WHAT THIS DOES
 * ──────────────
 * For every request that reaches this Pages project:
 *
 *   1. Look at the Host header.
 *   2. If it's a subdomain of onfolio.press that isn't `www` or a
 *      reserved system prefix, rewrite the URL so that the "/" path
 *      serves /imprint/?slug=<sub> — i.e. thomas.onfolio.press loads
 *      the imprint page for whoever's registered `thomas` as their
 *      slug in folio_imprint_slugs.
 *   3. Any deeper path on the subdomain (/shelf, /app.html, /help/…)
 *      passes through untouched. Rationale: the whole platform is
 *      still one origin; the subdomain is just a friendlier way to
 *      land on someone's imprint. Deep-linking the author's own books
 *      under their subdomain is a nice-to-have for later — see the
 *      "Later" section in docs/SUBDOMAIN_SETUP.md.
 *
 * NEVER-CACHE NOTE
 * ────────────────
 * This middleware runs at the edge. Every request's Host is different
 * so caching would poison lookups. We don't set Cache-Control here —
 * Pages defaults + the asset handler take care of the actual asset
 * cache once we've decided what to serve.
 */

// System subdomains that MUST NOT be treated as author slugs. If we
// ever add a real service on `api.onfolio.press` or `admin.onfolio.press`,
// list it here so an author can't accidentally (or maliciously) claim
// the slug. Also matches the client-side reserved list in app.html —
// keep the two in sync.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'apps', 'admin', 'auth', 'account', 'accounts',
  'shelf', 'press', 'imprint', 'help', 'docs', 'blog', 'news',
  'about', 'contact', 'support', 'status', 'mail', 'email',
  'signin', 'signup', 'login', 'logout', 'oauth', 'sso',
  'test', 'dev', 'staging', 'prod', 'demo', 'preview',
  'cdn', 'static', 'assets', 'media', 'img', 'images',
  'folio', 'onfolio', 'official', 'staff', 'team',
  's', 'go', 'l', 't',  // short URL / redirect prefixes
]);

// Only rewrite for the apex we own. This lets Pages preview URLs
// (*.pages.dev) and any other custom-domain testing pass straight
// through to the normal static asset handler.
const APEX_DOMAIN = 'onfolio.press';

// Slug shape — same rules the client-side picker enforces. 3–30 chars,
// lowercase letters/digits/hyphens, no leading or trailing hyphen. A
// slug that fails validation gets treated as if the subdomain doesn't
// exist (fall through — most likely it's a typo or a stale DNS entry).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export async function onRequest(context) {
  const { request, env, next } = context;
  const url  = new URL(request.url);
  const host = url.hostname.toLowerCase();

  // Not our apex? Pass through — this catches pages.dev previews,
  // localhost during dev, and any future extra domains.
  const apexSuffix = '.' + APEX_DOMAIN;
  if (host !== APEX_DOMAIN && !host.endsWith(apexSuffix)) {
    return next();
  }

  // Apex or root www? Nothing to rewrite; serve as normal.
  if (host === APEX_DOMAIN || host === 'www.' + APEX_DOMAIN) {
    return next();
  }

  // Extract everything to the left of `.onfolio.press`. If there are
  // multiple labels (`a.b.onfolio.press`), we conservatively bail —
  // depth-1 subdomains are the only supported shape.
  const sub = host.slice(0, -apexSuffix.length);
  if (sub.includes('.')) return next();

  // Reserved / system prefix → pass through untouched. A future
  // `admin.onfolio.press` or `api.onfolio.press` service would need
  // its own routing, but not this one.
  if (RESERVED_SUBDOMAINS.has(sub)) return next();

  // Slug shape check. Anything that doesn't match the client-side
  // picker's rules can't possibly be a legitimate slug, so we skip
  // the rewrite and let the request 404 naturally (or fall through
  // to a static asset if one happens to match).
  if (!SLUG_RE.test(sub)) return next();

  // Only rewrite the root request. Deep paths under the subdomain
  // (/shelf, /app.html, static assets, /help/…) pass through so the
  // subdomain is just an alias for the apex origin. Later we can layer
  // in per-subdomain shelf filtering (see SUBDOMAIN_SETUP.md § Later).
  if (url.pathname !== '/' && url.pathname !== '') return next();

  // Rewrite to /imprint/ with the slug carried as a query param. The
  // imprint page's boot() checks for ?slug=<sub>, resolves it via a
  // folio_imprint_slugs/{sub} Firestore lookup to get the owner uid,
  // then renders as normal. Preserves ?theme=dark etc. if the caller
  // passed extra params.
  const target = new URL(url);
  target.pathname = '/imprint/';
  target.searchParams.set('slug', sub);

  // Use the ASSETS binding to serve the rewritten path from the
  // static asset store. This keeps the Response's own caching headers,
  // status, and body intact — we just changed which file we asked for.
  const rewritten = new Request(target.toString(), request);
  return env.ASSETS.fetch(rewritten);
}
