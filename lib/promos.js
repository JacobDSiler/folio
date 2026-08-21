/* ═══════════════════════════════════════════════════════════════════
 * FolioPromos — shared promo lookup + banner rendering.
 *
 * Small self-contained module loaded by /press/, /shelf.html, and
 * /app.html to check whether a discount promo is currently in its
 * teaser window (banner: "starts in 3 days") or active window
 * (banner: "30% off through Dec 5, code SAVE30").
 *
 * Everything is public-readable — the folio_promos Firestore rules
 * allow anonymous get() so signed-out visitors see the same banner
 * a signed-in author would. That's intentional: the promo is the
 * marketing surface.
 *
 * USAGE
 * ─────
 *   <script src="/lib/promos.js"></script>
 *   <script>
 *     // After you've initialized Firestore + set window._promoDb
 *     // + window._promoFb (with collection/getDocs/query/where/orderBy):
 *     FolioPromos.mountBanner({
 *       slot: document.getElementById('promoSlot'),   // where to render
 *       tier: 'both',                                 // 'indie'|'imprint'|'both'
 *       compact: false,                               // compact style (for /app.html sidebar)
 *     });
 *   </script>
 *
 * Renders NOTHING if there's no active or upcoming (within teaser
 * window) promo. Silent no-op is the correct empty state.
 *
 * Added 2026-08-11 alongside the /admin/promos/ manager.
 * ═══════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // Cache the query result for a page load so a shelf render doesn't
  // re-hit Firestore N times. TTL 60s covers "banner flickered off
  // right at the end of the promo window" edge cases.
  let _cache = null;
  let _cacheAt = 0;
  const CACHE_TTL_MS = 60000;

  async function fetchAllPromos(db, fb) {
    const now = Date.now();
    if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;
    if (!db || !fb || !fb.collection || !fb.getDocs) {
      console.warn('[FolioPromos] fetchAllPromos: missing db/fb helpers');
      return [];
    }
    try {
      const snap = await fb.getDocs(fb.collection(db, 'folio_promos'));
      const list = [];
      snap.forEach(function (d) {
        const data = d.data() || {};
        list.push({
          id:            d.id,
          code:          String(data.code || d.id || '').toUpperCase(),
          label:         String(data.label || ''),
          pct:           Number(data.pct || 0),
          tiers:         Array.isArray(data.tiers) ? data.tiers : [],
          billingModes:  Array.isArray(data.billingModes) ? data.billingModes : [],
          validFrom:     Number(data.validFrom || 0),
          validTo:       Number(data.validTo || 0),
          teaserFrom:    Number(data.teaserFrom || 0),
          teaserCopy:    String(data.teaserCopy || ''),
          activeCopy:    String(data.activeCopy || ''),
        });
      });
      _cache = list;
      _cacheAt = now;
      return list;
    } catch (e) {
      console.warn('[FolioPromos] fetch failed:', e && e.message);
      return [];
    }
  }

  // Given the full promo list, pick the most-relevant one to display
  // right now. Priority:
  //   1. Active promo (now within validFrom..validTo). Higher pct wins.
  //   2. Teasing promo (now within teaserFrom..validFrom). Nearest
  //      validFrom wins (upcoming feels more urgent than distant).
  //   3. Nothing.
  function selectNow(promos, tierFilter) {
    const now = Date.now();
    const tierOk = function (p) {
      if (!tierFilter || tierFilter === 'both') return true;
      return p.tiers.includes(tierFilter);
    };
    const active = promos.filter(function (p) {
      return tierOk(p) && p.validFrom <= now && p.validTo >= now && p.pct > 0;
    });
    if (active.length) {
      active.sort(function (a, b) { return b.pct - a.pct; });
      return { promo: active[0], state: 'active' };
    }
    const teasing = promos.filter(function (p) {
      return tierOk(p) && p.teaserFrom > 0 && p.teaserFrom <= now && p.validFrom > now;
    });
    if (teasing.length) {
      teasing.sort(function (a, b) { return a.validFrom - b.validFrom; });
      return { promo: teasing[0], state: 'teasing' };
    }
    return { promo: null, state: 'none' };
  }

  // Format the days-until countdown in human terms. "in 3 days",
  // "tomorrow", "today". Never "in 0 days" (feels broken).
  function formatCountdown(msUntil) {
    if (msUntil <= 0) return 'now';
    const days = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
    if (days === 1) return 'tomorrow';
    if (days <= 0) return 'today';
    return 'in ' + days + ' days';
  }

  function formatEndDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, {
        month: 'long', day: 'numeric',
      });
    } catch (_) { return ''; }
  }

  // esc — attribute-safe. Promo copy is admin-written, but escape
  // anyway so a stray < doesn't break markup.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Render the banner into the given slot element. `compact` produces
  // a narrower single-line variant for cramped sidebars.
  function renderBanner(slot, sel, opts) {
    if (!slot) return;
    if (!sel || !sel.promo) { slot.innerHTML = ''; slot.style.display = 'none'; return; }
    const p = sel.promo;
    const compact = !!(opts && opts.compact);
    const teasing = sel.state === 'teasing';
    const countdown = teasing ? formatCountdown(p.validFrom - Date.now()) : '';
    const endDate = formatEndDate(p.validTo);
    const copy = teasing
      ? (p.teaserCopy || (p.label + ' — ' + p.pct + '% off starts ' + countdown + '. Get ready.'))
      : (p.activeCopy || (p.label + ' — ' + p.pct + '% off through ' + endDate + '. Code ' + p.code + '.'));
    const icon = teasing ? '⏳' : '🎁';
    const accent = teasing ? '#c98c2a' : '#065f46';
    const bg     = teasing ? 'rgba(201,140,42,0.08)' : 'rgba(6,95,70,0.08)';
    const border = teasing ? 'rgba(201,140,42,0.35)' : 'rgba(6,95,70,0.32)';

    slot.style.display = 'block';
    slot.innerHTML =
      '<div class="folio-promo-banner" data-state="' + esc(sel.state) + '" data-code="' + esc(p.code) + '"' +
        ' style="max-width:820px;margin:12px auto;padding:' + (compact ? '8px 12px' : '12px 16px') + ';' +
        'background:' + bg + ';border:.5px solid ' + border + ';border-radius:9px;' +
        'display:flex;align-items:flex-start;gap:10px;font-size:' + (compact ? '12px' : '13px') + ';' +
        'line-height:1.55;color:var(--text,#1a1611);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',system-ui,sans-serif">' +
        '<span aria-hidden="true" style="font-size:' + (compact ? '15px' : '18px') + ';line-height:1;flex-shrink:0">' + icon + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<strong style="color:' + accent + '">' + esc(p.label || (teasing ? 'Upcoming discount' : 'Discount live')) + '</strong>' +
          ' — ' + esc(copy) +
          (sel.state === 'active'
            ? ' <a href="/press/" style="color:' + accent + ';font-weight:500;white-space:nowrap">See tiers →</a>'
            : '') +
        '</div>' +
      '</div>';
  }

  // Public: mount a banner into the given slot. Handles the whole
  // pipeline: fetch → select → render → auto-refresh every 5 min so
  // teasing → active transitions eventually pick up without a reload.
  async function mountBanner(opts) {
    opts = opts || {};
    const slot = opts.slot;
    if (!slot) { console.warn('[FolioPromos] mountBanner: no slot'); return; }
    const db = global._promoDb;
    const fb = global._promoFb;
    if (!db || !fb) {
      console.warn('[FolioPromos] mountBanner: _promoDb / _promoFb not set. Set them after Firestore init.');
      return;
    }
    const draw = async function () {
      const promos = await fetchAllPromos(db, fb);
      const sel = selectNow(promos, opts.tier || 'both');
      renderBanner(slot, sel, opts);
    };
    await draw();
    // Refresh every 5 min so a promo that's teasing during the load
    // eventually flips to active without a full page reload. Cheap:
    // one Firestore read per 5 min per open tab.
    setInterval(function () { _cache = null; draw(); }, 5 * 60 * 1000);
  }

  // Public: look up a specific promo by code (used at /press/ checkout
  // when the buyer types a code into the "Have a promo code?" field).
  // Returns { ok, promo, reason } — reason is one of: 'unknown',
  // 'expired', 'not-yet', 'tier-mismatch', 'billing-mismatch', 'ok'.
  async function verifyCode(code, opts) {
    opts = opts || {};
    const db = global._promoDb;
    const fb = global._promoFb;
    if (!db || !fb || !fb.doc || !fb.getDoc) {
      return { ok: false, reason: 'not-loaded' };
    }
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { ok: false, reason: 'unknown' };
    try {
      const snap = await fb.getDoc(fb.doc(db, 'folio_promos', clean));
      if (!snap.exists()) return { ok: false, reason: 'unknown' };
      const data = snap.data() || {};
      const promo = {
        code:         String(data.code || snap.id).toUpperCase(),
        label:        String(data.label || ''),
        pct:          Number(data.pct || 0),
        tiers:        Array.isArray(data.tiers) ? data.tiers : [],
        billingModes: Array.isArray(data.billingModes) ? data.billingModes : [],
        validFrom:    Number(data.validFrom || 0),
        validTo:      Number(data.validTo || 0),
      };
      const now = Date.now();
      if (promo.validFrom > now) return { ok: false, reason: 'not-yet', promo };
      if (promo.validTo   < now) return { ok: false, reason: 'expired', promo };
      if (opts.tier && !promo.tiers.includes(opts.tier))
        return { ok: false, reason: 'tier-mismatch', promo };
      if (opts.billing && !promo.billingModes.includes(opts.billing))
        return { ok: false, reason: 'billing-mismatch', promo };
      return { ok: true, promo, reason: 'ok' };
    } catch (e) {
      console.warn('[FolioPromos] verifyCode failed:', e);
      return { ok: false, reason: 'error' };
    }
  }

  global.FolioPromos = {
    fetchAllPromos: fetchAllPromos,
    selectNow:      selectNow,
    mountBanner:    mountBanner,
    verifyCode:     verifyCode,
  };
})(window);
