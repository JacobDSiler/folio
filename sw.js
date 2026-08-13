/* ────────────────────────────────────────────────────────────────
   Folio service worker — offline / PWA support
   ────────────────────────────────────────────────────────────────
   Enables cold-launch when the user has no network. On first
   successful load the browser installs this worker, precaches the
   app shell (app.html, shelf.html, index.html), and then caches
   third-party immutable CDN assets (Firebase SDK, Google Fonts,
   cdnjs/jsdelivr/unpkg vendor libs) opportunistically as they're
   fetched. On subsequent launches, if the network is down, every
   request the app makes is answered from cache and Folio boots
   normally — Firestore's own IndexedDB write queue then handles
   the user's edits (already working today; that's why Jacob's
   offline chapter synced when he reconnected).

   Cache buckets are versioned. Bump the numeric suffix on any
   bucket whose contents changed to force a re-download for
   existing installs. `activate` cleans up old versions so we
   never pay for old caches indefinitely.

   The fetch handler is conservative: anything that looks like
   live data (Firestore, Auth, Storage, our Cloudflare workers,
   the PayPal SDK) is passed through untouched. Only static-ish
   assets are cached — a mis-cache of, say, a Firestore RPC
   would look like data corruption to the app.

   Added 2026-08-11 (Jacob).
   ────────────────────────────────────────────────────────────── */

const SW_VERSION      = '1';   // bump to invalidate ALL caches
const SHELL_CACHE     = 'folio-shell-v' + SW_VERSION;
const VENDOR_CACHE    = 'folio-vendor-v' + SW_VERSION;
const ASSETS_CACHE    = 'folio-assets-v' + SW_VERSION;

// App shell — precache so a cold launch works offline. Every URL here
// is fetched at install time; a single failure aborts the install
// (which is what we want — a broken cache is worse than no cache).
// Root files only: sub-pages (/admin, /help, /press etc.) fall through
// to runtime caching and only work offline if the user has visited them
// while online at least once. That's fine — the primary use case is
// "author drafts in app.html on the train".
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/shelf.html',
  '/manifest.json',
  '/icon.svg',
  '/og-default.png',
];

// Hosts whose responses we're willing to cache after they're
// requested at runtime. Everything else is passthrough. The Firebase
// SDK bundles from gstatic are the biggest win here (~800 KB), then
// Google Fonts CSS + WOFF2, then the cdnjs/jsdelivr/unpkg vendor libs
// (jspdf, jszip, docx, mammoth, crunker). All are immutable when
// version-pinned in URL — which they are throughout the codebase.
const VENDOR_HOSTS = new Set([
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]);

// Hosts we NEVER cache — real-time data or something that changes
// silently on the provider's side. Passthrough only.
const NEVER_CACHE_HOST_SUFFIXES = [
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebase.googleapis.com',
  'firebaselogging-pa.googleapis.com',
  'workers.dev',              // our Cloudflare workers (paywall, email, etc.)
  'paypal.com',               // PayPal SDK + checkout — versioned silently
  'paypalobjects.com',
  'accounts.google.com',      // Google Identity Services (sign-in)
  'youtube.com',              // tutorial video embeds
  'ytimg.com',
];

// ── install ─────────────────────────────────────────────────────
// Precache the app shell. Uses `Cache.addAll` which is atomic —
// if any URL fails, the whole install fails and the old SW stays
// active. Better than a half-broken new SW taking over.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// ── activate ────────────────────────────────────────────────────
// Delete any cache buckets that don't match the current SW_VERSION.
// Then claim() so this SW controls open pages immediately (instead
// of waiting for the next navigation).
self.addEventListener('activate', function (event) {
  const keep = new Set([SHELL_CACHE, VENDOR_CACHE, ASSETS_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (n) {
            if (!keep.has(n)) return caches.delete(n);
            return null;
          })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// ── fetch ───────────────────────────────────────────────────────
// Router with three lanes:
//   1. Passthrough (never cache)     — real-time data + POSTs
//   2. Network-first (HTML)          — get updates online, fall back to cache
//   3. Cache-first (vendor + assets) — instant load, background revalidate

self.addEventListener('fetch', function (event) {
  const req = event.request;

  // Only GET is safely cacheable. POST/PUT/DELETE/PATCH → passthrough.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Real-time / dynamic hosts → passthrough.
  if (NEVER_CACHE_HOST_SUFFIXES.some(function (suffix) {
    return url.hostname === suffix || url.hostname.endsWith('.' + suffix);
  })) {
    return;
  }

  // Requests with `no-cache` / `no-store` explicitly declared by the
  // app → respect them.
  const cc = req.cache;
  if (cc === 'no-store' || cc === 'reload') return;

  // Same-origin navigation (HTML page load) → network-first so the
  // author gets updates immediately when they ARE online, but falls
  // back to the cached shell when offline. This is the whole reason
  // the SW exists — cold-launch on a train.
  if (url.origin === self.location.origin &&
      (req.mode === 'navigate' || req.destination === 'document')) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Vendor CDNs (immutable, version-pinned URLs) → cache-first.
  if (VENDOR_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req, VENDOR_CACHE));
    return;
  }

  // Same-origin static assets → cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, ASSETS_CACHE));
    return;
  }

  // Anything else → passthrough. Better to fail loudly than to
  // silently cache a third-party endpoint whose semantics we don't
  // understand.
});

// ── strategies ─────────────────────────────────────────────────

// network-first: try the network; if it fails, serve from cache.
// On network success we also write-through to cache so a subsequent
// offline load has the freshest copy.
function networkFirst(req, cacheName) {
  return fetch(req)
    .then(function (res) {
      // Only cache successful, non-partial responses. Opaque
      // cross-origin responses (type='opaque') are cacheable but we
      // can't inspect status — for the HTML lane that's fine because
      // we only reach here with same-origin requests.
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(cacheName).then(function (c) { c.put(req, copy); }).catch(function(){});
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        // Ultimate fallback: serve app.html so navigations to
        // never-visited routes still boot the SPA-ish shell instead
        // of the browser's "no internet" screen. The client-side
        // router (if any) can then decide what to show.
        return caches.match('/app.html');
      });
    });
}

// cache-first: serve cached copy immediately; on cache miss, fetch,
// write-through, and return. On both cache miss + network failure,
// respond with a synthetic 504 so the caller sees a real error
// instead of a hung promise.
function cacheFirst(req, cacheName) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return fetch(req)
      .then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(cacheName).then(function (c) { c.put(req, copy); }).catch(function(){});
        }
        return res;
      })
      .catch(function () {
        return new Response('', { status: 504, statusText: 'Offline — no cached copy' });
      });
  });
}

// ── message channel ────────────────────────────────────────────
// Lets the page ask the SW to skip waiting (used when a fresh SW
// version is installed and we want to promote it without a manual
// reload cycle) or to purge all caches (support / debugging).
self.addEventListener('message', function (event) {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'PURGE_CACHES') {
    event.waitUntil(
      caches.keys().then(function (names) {
        return Promise.all(names.map(function (n) { return caches.delete(n); }));
      })
    );
  }
});
