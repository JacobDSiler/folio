/* ═══════════════════════════════════════════════════════════════════
 * FolioAdmin — shared helpers for /admin/* pages.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Each admin page (/admin/press, /admin/boost, /admin/shelf, etc.)
 * used to inline its own copy of: Firebase config, boot(), onAuthChange,
 * ADMIN_UIDS constant, sign-in / sign-out handlers, and author-lookup
 * markup + logic. This meant every regression had to be fixed in N
 * places — and, in practice, some pages got the fix while others didn't.
 *
 * This file exposes a single global `FolioAdmin` object with reusable
 * building blocks. Pages load it via a plain <script src="/admin/_shared.js">
 * tag (no bundler, no import maps) and then call the pieces they need.
 *
 * NON-GOALS
 * ─────────
 * - Not a framework. Just a namespace + a few well-tested functions.
 * - Not opinionated about page layout. Each page owns its DOM.
 * - Doesn't do dynamic imports of Firebase itself — pages still do
 *   that (already async), because doing it here would delay every
 *   admin page's paint by a network round-trip.
 * ═══════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDxLI57pgS9WX1ekMerbcx8M6aVeWacpy0',
    authDomain: 'auth.jacobsiler.com',
    projectId: 'miscellaneous-117e9',
    storageBucket: 'miscellaneous-117e9.firebasestorage.app',
    messagingSenderId: '514858431339',
    appId: '1:514858431339:web:8b3acbe89966b45fe3922e'
  };

  // Bootstrap admin allowlist — mirrors firestore.rules isAdmin().
  // KEEP THESE IN SYNC. If you add a bootstrap admin here, add the same
  // uid to firestore.rules or the client will see the admin body but
  // every Firestore write will fail with permission-denied.
  const ADMIN_UIDS = ['x9AgFZ7O8WVz2UVtyO4ggWKNfc73', 'Y1bO4mc8aAclkbRNIYXyez8i7Rj2'];

  /* ─────────────────────────────────────────────────────────────────
   * Author lookup widget.
   *
   * Renders a search input + a suggestions dropdown into a container
   * you provide. Fetches folio_projects (up to 500 rows), dedupes by
   * uid, sorts by author name. Type-to-filter matches against author
   * name, uid prefix, or sample folio title.
   *
   * USAGE
   * ─────
   *   FolioAdmin.mountAuthorLookup({
   *     container: document.getElementById('authorLookupSlot'),
   *     db, fb,   // your Firestore db + { collection, getDocs, query, limit }
   *     placeholder: 'Type an author name…',
   *     onSelect: (uid, authorName) => {
   *       document.getElementById('targetUid').value = uid;
   *     },
   *   });
   *
   * The container gets the widget markup injected; nothing else on the
   * page needs to know about the internal structure.
   * ───────────────────────────────────────────────────────────────── */
  function mountAuthorLookup(opts) {
    const container = opts && opts.container;
    const db = opts && opts.db;
    const fb = opts && opts.fb;
    const onSelect = (opts && opts.onSelect) || function () { };
    const placeholder = (opts && opts.placeholder) || 'Start typing an author name (e.g. Thomas)…';
    const label = (opts && opts.label) || 'Look up author by name';
    if (!container) { console.warn('[FolioAdmin] mountAuthorLookup: no container'); return; }
    if (!db || !fb || !fb.collection || !fb.getDocs || !fb.query || !fb.limit || !fb.where) {
      console.warn('[FolioAdmin] mountAuthorLookup: db/fb helpers missing (need collection/getDocs/query/limit/where)'); return;
    }

    // Widget id suffix so multiple lookups on the same page don't collide.
    // (Boost + Press share the same page one day? This keeps it safe.)
    const uid = 'fal-' + Math.random().toString(36).slice(2, 8);

    container.innerHTML =
      '<label for="' + uid + '-input">' + esc(label) + '</label>' +
      '<div style="position:relative">' +
        '<input type="text" id="' + uid + '-input" placeholder="' + esc(placeholder) + '" autocomplete="off">' +
        '<div id="' + uid + '-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface);border:.5px solid var(--border-mid);border-top:none;border-radius:0 0 8px 8px;max-height:300px;overflow-y:auto;z-index:5;box-shadow:0 4px 12px rgba(0,0,0,0.08)"></div>' +
      '</div>' +
      '<div id="' + uid + '-status" style="font-size:11px;color:var(--hint);margin-top:4px">Loading known authors…</div>';

    const inputEl = document.getElementById(uid + '-input');
    const dropEl = document.getElementById(uid + '-drop');
    const statusEl = document.getElementById(uid + '-status');

    let authorList = [];  // [{ uid, author, sampleTitle, count }]

    function refresh() {
      const q = (inputEl.value || '').trim().toLowerCase();
      if (!authorList.length) { dropEl.style.display = 'none'; return; }
      const matches = q
        ? authorList.filter(function (a) {
            return a.author.toLowerCase().indexOf(q) >= 0
              || a.uid.toLowerCase().indexOf(q) >= 0
              || (a.sampleTitle || '').toLowerCase().indexOf(q) >= 0;
          })
        : authorList;
      const cap = matches.slice(0, 40);
      dropEl.innerHTML = cap.map(function (a) {
        return '<div class="author-suggestion" data-uid="' + escAttr(a.uid) + '" data-name="' + escAttr(a.author) + '" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:.5px solid var(--border);font-size:12.5px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(a.author) + '</div>' +
            '<div style="font-size:10.5px;color:var(--hint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(a.sampleTitle || '') + ' · ' + a.count + ' folio' + (a.count === 1 ? '' : 's') + '</div>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--hint);font-family:ui-monospace,monospace">' + esc(a.uid.slice(0, 12)) + '…</div>' +
        '</div>';
      }).join('') +
        (matches.length > cap.length
          ? '<div style="padding:8px 12px;text-align:center;color:var(--hint);font-style:italic;font-size:11.5px">…and ' + (matches.length - cap.length) + ' more — narrow your search</div>'
          : '');
      dropEl.style.display = cap.length ? 'block' : 'none';

      // Wire click handlers via delegation (safer than inline onclick with
      // string-escaped author names containing quotes).
      const items = dropEl.querySelectorAll('.author-suggestion[data-uid]');
      items.forEach(function (item) {
        item.addEventListener('click', function () {
          const selUid = item.getAttribute('data-uid') || '';
          const selName = item.getAttribute('data-name') || '';
          inputEl.value = selName;
          dropEl.style.display = 'none';
          try { onSelect(selUid, selName); } catch (e) { console.warn('[FolioAdmin] onSelect handler threw:', e); }
        });
      });
    }

    inputEl.addEventListener('input', refresh);
    inputEl.addEventListener('focus', refresh);

    // Close dropdown when clicking outside.
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#' + uid + '-input') && !e.target.closest('#' + uid + '-drop')) {
        dropEl.style.display = 'none';
      }
    });

    // Fetch author list — merges TWO safe sources:
    //   1. folio_projects WHERE release.published == true — the
    //      firestore rule allows this LIST because the query filter
    //      matches the rule's `published` clause.
    //   2. folio_imprint_themes unfiltered — rule is `allow read: if
    //      true;` so any LIST is fine.
    //
    // 2026-07-21 rewrite: dropped the unfiltered folio_projects and
    // folio_user_settings queries. Both returned `permission-denied`
    // (Firestore's LIST rule engine won't short-circuit isAdmin() for
    // unbounded queries), and worse, a denied LIST puts the whole SDK
    // into offline mode — which was the "client is offline" symptom
    // Jacob was hitting on both /admin/press/ and the editor.
    //
    // Signed-in-but-unpublished-and-uncustomized users won't appear
    // in the dropdown any more, but every admin page that uses this
    // lookup already exposes a "Target UID" paste input for that
    // fallback path — which is the only workflow that ever needed it.
    (async function loadList() {
      try {
        const byUid = new Map();

        // 1. Published folios — reliable LIST for admins.
        try {
          const snap = await fb.getDocs(fb.query(
            fb.collection(db, 'folio_projects'),
            fb.where('release.published', '==', true),
            fb.limit(500)
          ));
          snap.forEach(function (d) {
            const data = d.data() || {};
            const authorUid = String(data.uid || '');
            if (!authorUid) return;
            const author = String((data.release && data.release.author) || data.name || 'Unknown');
            const title = String((data.release && data.release.title) || data.name || '');
            if (!byUid.has(authorUid)) {
              byUid.set(authorUid, { uid: authorUid, author: author, sampleTitle: title, count: 1 });
            } else {
              const cur = byUid.get(authorUid);
              cur.count++;
              if (author && author !== 'Unknown' && cur.author === 'Unknown') cur.author = author;
            }
          });
        } catch (e) {
          console.warn('[FolioAdmin] published folios list failed:', e.message);
        }
        const fromProjects = byUid.size;

        // 2. Imprint themes — customized imprints. Doc id = uid.
        try {
          const themesSnap = await fb.getDocs(fb.query(
            fb.collection(db, 'folio_imprint_themes'),
            fb.limit(500)
          ));
          themesSnap.forEach(function(d){
            const authorUid = String(d.id || '');
            if (!authorUid || byUid.has(authorUid)) return;
            const data = d.data() || {};
            const author = String(data.authorName || data.displayName || 'Imprint author');
            byUid.set(authorUid, { uid: authorUid, author: author, sampleTitle: '(imprint customized — no published folios yet)', count: 0 });
          });
        } catch (e) { console.warn('[FolioAdmin] folio_imprint_themes list failed:', e.message); }

        authorList = Array.from(byUid.values()).sort(function (a, b) {
          const ac = a.count > 0 ? 0 : 1;
          const bc = b.count > 0 ? 0 : 1;
          if (ac !== bc) return ac - bc;
          return String(a.author).localeCompare(String(b.author));
        });
        statusEl.innerHTML = '✅ ' + authorList.length + ' users loaded (' + fromProjects + ' published, ' + (byUid.size - fromProjects) + ' imprint-only) — type a name or UID. '
          + '<span style="color:var(--hint, #6b7280)">Users who’ve signed in but not published or customized won’t appear — paste their UID directly.</span>';
        statusEl.style.color = 'var(--accent-ui, #065f46)';
        console.log('[FolioAdmin] author list loaded:', authorList.length, 'total,', fromProjects, 'published');
      } catch (e) {
        statusEl.textContent = '⚠ Author list load failed: ' + (e.message || 'unknown');
        statusEl.style.color = 'var(--danger, #c04040)';
        console.error('[FolioAdmin] author load failed', e);
      }
    })();

    // Return a small handle so the caller can reset / refresh / prefill.
    return {
      focus: function () { inputEl.focus(); },
      clear: function () { inputEl.value = ''; dropEl.style.display = 'none'; },
      // Programmatically fill the input (e.g., when the target UID is
      // already set from a URL param and we want the display to match).
      setDisplay: function (name) { inputEl.value = String(name || ''); },
    };
  }

  /* ─────────────────────────────────────────────────────────────────
   * Escaping helpers — tiny + local, no external dep.
   * ───────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────────────────────────
   * Export.
   * ───────────────────────────────────────────────────────────────── */
  global.FolioAdmin = {
    FIREBASE_CONFIG: FIREBASE_CONFIG,
    ADMIN_UIDS: ADMIN_UIDS,
    mountAuthorLookup: mountAuthorLookup,
    esc: esc,
    escAttr: escAttr,
  };
})(window);
