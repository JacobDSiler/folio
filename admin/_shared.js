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
   * bootAuth — shared admin-page auth flow.
   *
   * Every admin subpage had ~40 lines of near-identical boot():
   * import Firebase, initializeApp, setPersistence, onAuthStateChanged.
   * Nearly identical, but not quite — some were missing setPersistence,
   * some were missing authStateReady, and some flashed the sign-in gate
   * on every navigation because the initial render happens BEFORE
   * IndexedDB hydrates the persisted user. That flash was what Jacob
   * kept reading as auth invalidation ("clicking Review moderation
   * particularly invalidates it immediately").
   *
   * This helper consolidates the fix:
   *   1. Awaits Firebase Auth persistence hydration (authStateReady)
   *      before making any signed-in-or-out decision. On modern
   *      Firebase (10.14+) that's a single await; older builds get a
   *      short polled fallback.
   *   2. Sets indexedDBLocalPersistence with localStorage fallback so
   *      Firefox ETP purges don't demote the session to session-only.
   *   3. Treats anonymous sessions as signed-out (never shows "signed
   *      in as ANON_UID — not on allowlist" — that read as needing
   *      to sign out first).
   *   4. Manages three DOM slots — a loading splash, the sign-in
   *      gate, the admin body — so the page never flashes the wrong
   *      one during hydration.
   *   5. Signs out any anonymous session before starting a Google
   *      sign-in popup so linkWithCredential can't collide with an
   *      already-existing admin uid.
   *
   * USAGE
   * ─────
   *   FolioAdmin.bootAuth({
   *     firebaseModules: { appMod, authMod, fsMod },     // caller does the imports
   *     domIds: {
   *       loading:   'authLoading',   // splash shown while hydrating
   *       gate:      'authGate',      // sign-in prompt
   *       body:      'adminBody',     // main content
   *       signedInAs:'signedInAs',    // header email/uid display
   *       signOutBtn:'signOutBtn',    // header sign-out button
   *       status:    'authStatus',    // sign-in error line
   *     },
   *     onAdmin: (user, ctx) => { ... }, // called when signed-in admin resolved
   *     onNonAdmin: (user, ctx) => { ... }, // signed in but not on allowlist
   *   })
   *   .then(ctx => {
   *     // ctx.auth, ctx.db, ctx.fb are ready to use.
   *   });
   *
   * The caller owns the DOM (splash / gate / body markup) and page-
   * specific rendering (onAdmin callback). This helper only does the
   * auth plumbing.
   * ───────────────────────────────────────────────────────────────── */
  async function bootAuth(opts) {
    opts = opts || {};
    const mods = opts.firebaseModules || {};
    const authMod = mods.authMod;
    const appMod = mods.appMod;
    const fsMod = mods.fsMod;
    const domIds = opts.domIds || {};
    const onAdmin = opts.onAdmin || function(){};
    const onNonAdmin = opts.onNonAdmin || null;

    const $ = function(id) { return id ? document.getElementById(id) : null; };
    const loadingEl = $(domIds.loading);
    const gateEl = $(domIds.gate);
    const bodyEl = $(domIds.body);
    const signedInAsEl = $(domIds.signedInAs);
    const signOutBtnEl = $(domIds.signOutBtn);
    const statusEl = $(domIds.status);

    function showLoading() {
      if (loadingEl) loadingEl.classList.remove('hidden');
      if (gateEl) gateEl.classList.add('hidden');
      if (bodyEl) bodyEl.classList.add('hidden');
    }
    function showGate(msg) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (gateEl) gateEl.classList.remove('hidden');
      if (bodyEl) bodyEl.classList.add('hidden');
      if (signOutBtnEl) signOutBtnEl.classList.add('hidden');
      if (signedInAsEl) signedInAsEl.textContent = '';
      if (statusEl) statusEl.textContent = msg || '';
    }
    function showBody(user) {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (gateEl) gateEl.classList.add('hidden');
      if (bodyEl) bodyEl.classList.remove('hidden');
      if (signOutBtnEl) signOutBtnEl.classList.remove('hidden');
      if (signedInAsEl) signedInAsEl.textContent = user.email || user.uid.slice(0, 12) + '…';
      if (statusEl) statusEl.textContent = '';
    }

    showLoading();

    if (!authMod || !appMod) {
      showGate('Boot failed: missing Firebase modules.');
      throw new Error('bootAuth: firebaseModules.authMod and .appMod required');
    }

    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    const db = fsMod ? fsMod.getFirestore(app) : null;

    // Persistence — indexedDB survives Firefox ETP better than localStorage;
    // fall back if indexedDB is unavailable (Safari private mode).
    try {
      if (authMod.indexedDBLocalPersistence) {
        await authMod.setPersistence(auth, authMod.indexedDBLocalPersistence);
      } else if (authMod.browserLocalPersistence) {
        await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      }
    } catch (_e1) {
      try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); }
      catch (_e2) { console.warn('[FolioAdmin.bootAuth] persistence set failed:', _e2 && _e2.message); }
    }

    // Wait for the initial auth state to hydrate. authStateReady is
    // Firebase v10.14+; older builds get a short polled fallback.
    // Hard-capped at 1.5s so a stuck hydration can never stall the
    // page — onAuthStateChanged catches up if it resolves later.
    await Promise.race([
      (async function(){
        if (typeof authMod.authStateReady === 'function') {
          try { await authMod.authStateReady(auth); }
          catch (e) { console.warn('[FolioAdmin.bootAuth] authStateReady threw:', e && e.message); }
        } else {
          for (let i = 0; i < 30 && !auth.currentUser; i++) {
            await new Promise(function(r){ setTimeout(r, 50); });
          }
        }
      })(),
      new Promise(function(r){ setTimeout(r, 1500); }),
    ]);

    const fb = fsMod ? {
      doc: fsMod.doc,
      getDoc: fsMod.getDoc,
      setDoc: fsMod.setDoc,
      updateDoc: fsMod.updateDoc,
      deleteDoc: fsMod.deleteDoc,
      collection: fsMod.collection,
      query: fsMod.query,
      where: fsMod.where,
      orderBy: fsMod.orderBy,
      getDocs: fsMod.getDocs,
      limit: fsMod.limit,
      addDoc: fsMod.addDoc,
      serverTimestamp: fsMod.serverTimestamp,
    } : {};

    const ctx = { auth: auth, db: db, fb: fb, appModule: appMod, authModule: authMod, fsModule: fsMod };

    async function isAdmin(uid) {
      if (!uid) return false;
      if (ADMIN_UIDS.indexOf(uid) >= 0) return true;
      if (!db || !fsMod || !fsMod.getDoc || !fsMod.doc) return false;
      try {
        const roleDoc = await fsMod.getDoc(fsMod.doc(db, 'folio_roles', uid));
        if (!roleDoc.exists()) return false;
        const d = roleDoc.data() || {};
        return Array.isArray(d.roles) && d.roles.indexOf('admin') >= 0;
      } catch (e) {
        console.warn('[FolioAdmin.bootAuth] folio_roles lookup failed:', e && e.message);
        return false;
      }
    }

    async function handleAuthChange(u) {
      // Anonymous sessions are treated identically to signed-out on
      // admin pages — the "signed in as ANON_UID / not on allowlist"
      // combination reads as if the user needs to sign out first,
      // which is not what we mean.
      if (!u || u.isAnonymous) {
        showGate('');
        return;
      }
      const admin = await isAdmin(u.uid);
      if (!admin) {
        showGate('Signed in as ' + (u.email || u.uid) + ' — not on admin allowlist.');
        if (onNonAdmin) { try { onNonAdmin(u, ctx); } catch (e) { console.warn('[FolioAdmin.bootAuth] onNonAdmin threw:', e); } }
        return;
      }
      showBody(u);
      try { await onAdmin(u, ctx); }
      catch (e) { console.warn('[FolioAdmin.bootAuth] onAdmin threw:', e); }
    }

    // Fire once now with the hydrated state so the page doesn't wait
    // on the async callback for the first render.
    handleAuthChange(auth.currentUser);
    // Register the ongoing listener so future sign-in/sign-out flips
    // update the UI without a reload.
    authMod.onAuthStateChanged(auth, handleAuthChange);

    // Sign-in / sign-out helpers exported for the page's buttons.
    ctx.signIn = async function() {
      try {
        if (auth.currentUser && auth.currentUser.isAnonymous) {
          try { await authMod.signOut(auth); } catch (_) {}
        }
        const p = new authMod.GoogleAuthProvider();
        await authMod.signInWithPopup(auth, p);
      } catch (e) {
        if (statusEl) statusEl.textContent = 'Sign-in failed: ' + (e.message || 'unknown');
      }
    };
    ctx.signOut = async function() {
      try { await authMod.signOut(auth); } catch (_) {}
    };

    return ctx;
  }

  /* ─────────────────────────────────────────────────────────────────
   * Export.
   * ───────────────────────────────────────────────────────────────── */
  global.FolioAdmin = {
    FIREBASE_CONFIG: FIREBASE_CONFIG,
    ADMIN_UIDS: ADMIN_UIDS,
    mountAuthorLookup: mountAuthorLookup,
    bootAuth: bootAuth,
    esc: esc,
    escAttr: escAttr,
  };
})(window);
