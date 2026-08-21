/**
 * folio-subdomain-worker — wildcard subdomain routing for onfolio.press.
 *
 * WHY IT EXISTS
 * ─────────────
 * Cloudflare Pages custom domains reject wildcards (`*.onfolio.press`) on
 * every plan below Enterprise. So we can't use the Pages Function
 * middleware (functions/_middleware.js) — subdomain requests never reach
 * the Pages project because there's no custom domain to route them to.
 *
 * Cloudflare Workers, however, support wildcard routes on the FREE plan.
 * This standalone Worker sits on `*.onfolio.press/*` and does what the
 * Pages middleware would have done: rewrite <slug>.onfolio.press/ →
 * /imprint/?slug=<slug> on the Pages origin.
 *
 * SSL: Cloudflare Universal SSL covers one-level-deep subdomains
 * automatically on domains proxied through the orange cloud. So
 * `thomas.onfolio.press` gets a valid cert with no extra config.
 * (If you ever add multi-level subdomains like `a.b.onfolio.press`,
 * that would need Advanced Certificate Manager at $10/mo — this Worker
 * defensively rejects multi-level subdomains regardless.)
 *
 * ROUTING FLOW
 * ────────────
 * 1. Request arrives at edge with Host `sub.onfolio.press`.
 * 2. Cloudflare's route matcher (`*.onfolio.press/*`) hands the request
 *    to this Worker.
 * 3. Worker inspects Host + path:
 *      • apex / www / reserved / bad shape / multi-level → proxy through
 *        to the Pages origin as-is (behaves like a passthrough).
 *      • valid slug + root path → rewrite to `/imprint/?slug=<sub>`
 *        on the Pages origin.
 *      • valid slug + deeper path → proxy to the Pages origin at
 *        the same path (so `thomas.onfolio.press/shelf` serves the
 *        Shelf page — the whole platform is still one origin).
 * 4. `fetch()` returns the Pages response verbatim, including its own
 *    caching headers, so the CDN handles the actual asset cache.
 *
 * KEEP IN SYNC
 * ────────────
 * The RESERVED set here is the source of truth for which subdomains
 * cannot be claimed as author slugs. It's mirrored byte-for-byte in
 * two other places — update all three together, always:
 *   • functions/_middleware.js — Pages Function fallback (dormant
 *     unless a wildcard custom domain is ever added on the Pages
 *     side; harmless no-op otherwise).
 *   • app.html — `_IMPRINT_SLUG_RESERVED` in the slug picker JS.
 *     Client-side check blocks the author from ever entering the
 *     slug, so they never even see it get rejected server-side.
 *
 * Added 2026-08-11 (Jacob) as part of the wildcard-subdomain rollout.
 * See docs/SUBDOMAIN_SETUP.md for the deploy runbook.
 */

const APEX = 'onfolio.press';

// Cloudflare Pages preview hostname. Requests get proxied here so the
// Worker doesn't recurse into itself (which would happen if we
// proxied back to *.onfolio.press). Everything the user's browser sees
// still shows the original subdomain URL — this is just where the
// static assets come from.
//
// If the Pages project is renamed, update this constant AND redeploy
// the Worker. The `-83d` suffix is Cloudflare's global-uniqueness
// hash; check it in the Pages dashboard if in doubt.
const PAGES_ORIGIN = 'https://folio-83d.pages.dev';

const RESERVED = new Set([
  'www', 'api', 'app', 'apps', 'admin', 'auth', 'account', 'accounts',
  'shelf', 'press', 'imprint', 'help', 'docs', 'blog', 'news',
  'about', 'contact', 'support', 'status', 'mail', 'email',
  'signin', 'signup', 'login', 'logout', 'oauth', 'sso',
  'test', 'dev', 'staging', 'prod', 'demo', 'preview',
  'cdn', 'static', 'assets', 'media', 'img', 'images',
  'folio', 'onfolio', 'official', 'staff', 'team',
  's', 'go', 'l', 't',
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export default {
  async fetch(request) {
    const url  = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const suffix = '.' + APEX;

    // Defensive early-outs — the route matcher already narrows to
    // *.onfolio.press/*, but a request could still land here for
    // the apex or www if a stray configuration ever changed. Both
    // pass through untouched.
    if (host === APEX || host === 'www' + suffix || !host.endsWith(suffix)) {
      return proxyToPages(request);
    }

    // Extract the subdomain label. Multi-level (`a.b.onfolio.press`) is
    // outside the shape we support — proxy through and let Pages 404.
    const sub = host.slice(0, -suffix.length);
    if (sub.includes('.')) return proxyToPages(request);

    // Reserved / bad-shape → passthrough. No slug rewrite, no CTA;
    // the caller sees whatever Pages serves for the requested path
    // (usually a 404 since these subdomains don't have real content).
    if (RESERVED.has(sub) || !SLUG_RE.test(sub)) {
      return proxyToPages(request);
    }

    // Only rewrite the ROOT path. Deep paths on the subdomain
    // (thomas.onfolio.press/shelf, /app.html, /help/…) pass through
    // so the subdomain is essentially an alias for the apex. Later
    // we could layer per-subdomain shelf filtering here (a "Thomas's
    // shelf" view) — see the "Later" section of SUBDOMAIN_SETUP.md.
    if (url.pathname !== '/' && url.pathname !== '') {
      return proxyToPages(request);
    }

    // Rewrite: fetch /imprint/?slug=<sub> from the Pages origin.
    // Preserve any extra query params the caller passed (theme= etc.)
    // — the imprint page reads them alongside slug.
    const target = new URL(PAGES_ORIGIN);
    target.pathname = '/imprint/';
    target.searchParams.set('slug', sub);
    url.searchParams.forEach(function (v, k) {
      if (k !== 'slug') target.searchParams.set(k, v);
    });

    return fetch(new Request(target.toString(), request));
  }
};

// Fetch from the Pages origin with the current request's path + query
// intact, just rehosted. This is what makes the subdomain "feel" like
// the apex — every deep asset is served by the same Pages project.
function proxyToPages(request) {
  const src = new URL(request.url);
  const target = new URL(PAGES_ORIGIN);
  target.pathname = src.pathname;
  target.search   = src.search;
  return fetch(new Request(target.toString(), request));
}
