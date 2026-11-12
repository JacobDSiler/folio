# Google Drive integration — Phase 2 scaffolding

Phase 1 shipped (2026-11-12): the Drive module, config constants in
`app.html`, "Import from Google Drive" button in the manuscript import
section. Everyone (including free tier) can import-once.

Phase 2 is **Linked save-back** (Indie+) and the **connections management
panel** (Indie for single-account, Imprint for multi). This doc is the
drop-in plan so the work doesn't have to be re-figured out next time.

---

## 2a. Release modal — "Save to Google Drive" section

**Where:** `app.html`, inside the release modal, below the Access picker
(moved above Description per T2-12). Add a new collapsible section:

```html
<details class="rl-section" id="rlDriveSection">
  <summary>
    <span>☁ Save to Google Drive</span>
    <span class="rl-section-hint" id="rlDriveHint">Optional · Indie+</span>
  </summary>
  <div class="rl-section-body">
    <!-- Free: upsell card. Indie/Imprint: controls below. -->
    <div id="rlDriveUpsell" style="display:none">
      <p>Save a copy of this folio back to Google Drive — editable in
      Docs, downloadable from anywhere.</p>
      <a href="/press" class="btn-sm">Unlock with Indie →</a>
    </div>
    <div id="rlDriveControls" style="display:none">
      <!-- Mode -->
      <label><input type="radio" name="rlDriveMode" value="linked" checked>
        Linked — overwrite the same Drive file every time I save this folio</label>
      <label><input type="radio" name="rlDriveMode" value="copy">
        Copy on command — "Save to Drive" button writes a fresh file each time</label>
      <!-- Format -->
      <label>Drive format:
        <select id="rlDriveFormat">
          <option value="gdoc">Google Doc (editable in Docs)</option>
          <option value="md">Markdown (.md)</option>
          <option value="docx" disabled>Word (.docx) — coming in Phase 3</option>
        </select>
      </label>
      <!-- Account picker (Imprint shows a <select> of connections; Indie sees just one) -->
      <label>Save to account:
        <select id="rlDriveAccount"></select>
      </label>
      <!-- Target file -->
      <div id="rlDriveTarget">
        <button type="button" id="rlDrivePickTarget">Pick existing file…</button>
        or <button type="button" id="rlDriveNewTarget">Save as new file</button>
        <div id="rlDriveTargetInfo"></div>
      </div>
      <button type="button" id="rlDriveSaveNow">Save to Drive now</button>
    </div>
  </div>
</details>
```

**Hydration on modal open:**

```js
// In openReleaseModal() or whichever function populates _rlCurrent fields:
(function hydrateDriveSection() {
  if (!window.FolioDrive) return;
  const upsell   = document.getElementById('rlDriveUpsell');
  const controls = document.getElementById('rlDriveControls');
  const hint     = document.getElementById('rlDriveHint');

  if (!FolioDrive.canLink()) {
    upsell.style.display = 'block';
    controls.style.display = 'none';
    hint.textContent = 'Indie+';
    return;
  }
  upsell.style.display = 'none';
  controls.style.display = 'block';
  hint.textContent = FolioDrive.canConnectMultiple() ? 'Imprint — multi-account' : 'Indie';

  // Populate account dropdown
  const sel = document.getElementById('rlDriveAccount');
  sel.innerHTML = '';
  FolioDrive.listPersistedConnections().then(list => {
    list.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.email; opt.textContent = c.displayName + ' (' + c.email + ')';
      sel.appendChild(opt);
    });
    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = '— Connect a Google account first —';
      sel.appendChild(opt);
    }
    // Multi-account lock: Indie can only save to one connection (the oldest)
    if (!FolioDrive.canConnectMultiple() && list.length > 1) {
      sel.disabled = true;
    }
  });

  // Prefill from _rlCurrent.driveLink
  if (_rlCurrent && _rlCurrent.driveLink) {
    sel.value = _rlCurrent.driveLink.accountEmail || '';
    document.getElementById('rlDriveFormat').value = _rlCurrent.driveLink.format || 'gdoc';
    const mode = _rlCurrent.driveLink.mode || 'linked';
    document.querySelector(`input[name=rlDriveMode][value=${mode}]`).checked = true;
    if (_rlCurrent.driveLink.fileName)
      document.getElementById('rlDriveTargetInfo').textContent =
        'Linked to: ' + _rlCurrent.driveLink.fileName;
  }
})();
```

**Save handler** — wired to `rlDriveSaveNow` button:

```js
document.getElementById('rlDriveSaveNow').onclick = async () => {
  const email  = document.getElementById('rlDriveAccount').value;
  const format = document.getElementById('rlDriveFormat').value;
  const mode   = document.querySelector('input[name=rlDriveMode]:checked').value;
  if (!email) { alert('Connect a Google account first.'); return; }

  // Build content from current folio state. Use the same manuscript-serialization
  // helper the "📄 Print" / POD path uses, then slice to the format we need:
  //   gdoc → HTML (Drive converts on upload)
  //   md   → the raw markdown Folio stores internally
  //   html → HTML
  const manuscriptMd = _folioExportMarkdown();   // use existing helper
  const name = (document.getElementById('rlTitle').value || 'Folio export') +
               (format === 'md' ? '.md' : '');

  let content;
  if (format === 'gdoc') content = _folioMarkdownToHtml(manuscriptMd);
  else if (format === 'md') content = manuscriptMd;

  // Target file ID: null = create new, else overwrite
  const existing = (mode === 'linked' && _rlCurrent.driveLink && _rlCurrent.driveLink.fileId)
    ? _rlCurrent.driveLink.fileId : null;

  try {
    const r = await FolioDrive.saveFile(email, { fileId: existing, name, content, format });
    // Record the link on the folio
    _rlCurrent.driveLink = {
      accountEmail: email, fileId: r.id, fileName: r.name,
      format, mode, lastSyncedAt: Date.now(),
    };
    // Persist via the existing release-save pipeline (writes to folio_projects/{id}.release)
    await _rlSaveCurrent();
    alert('Saved to Drive: ' + r.name);
  } catch (e) {
    alert('Save failed: ' + (e.message || e));
  }
};
```

## 2b. Settings tab — "Google Drive connections" panel

**Where:** `app.html`, Settings tab (previously "⚙ Settings" per T1-2
rename). Add a new section after the existing settings cards:

```html
<div class="settings-card" id="driveConnectionsCard">
  <h3>Google Drive connections</h3>
  <div id="driveConnectionsList"></div>
  <button id="btnConnectDrive">+ Connect a Google account</button>
  <p class="settings-note" id="driveConnectionsNote"></p>
</div>
```

**Render + connect handlers:**

```js
async function renderDriveConnectionsPanel() {
  const list = document.getElementById('driveConnectionsList');
  const note = document.getElementById('driveConnectionsNote');
  const btn  = document.getElementById('btnConnectDrive');
  const t = FolioDrive.tier();

  const persisted = await FolioDrive.listPersistedConnections();
  list.innerHTML = persisted.length
    ? persisted.map(c => `
        <div class="drive-conn-row" data-email="${c.email}">
          <img src="${c.picture}" alt="">
          <div><strong>${c.displayName}</strong><br>
               <small>${c.email}</small></div>
          <button class="disconnect-btn" data-email="${c.email}">Disconnect</button>
        </div>`).join('')
    : '<p style="color:var(--hint)">No Google accounts connected yet.</p>';

  // Tier gating on the Connect button:
  if (t === 'free') {
    btn.disabled = false;
    btn.textContent = '+ Connect a Google account';
    note.innerHTML = 'Free tier can connect one account for import-once. ' +
      'Upgrade to <a href="/press">Indie</a> to save folios back to Drive, or ' +
      '<a href="/press">Imprint</a> to connect multiple accounts.';
  } else if (t === 'indie') {
    if (persisted.length >= 1) {
      btn.disabled = true;
      btn.textContent = 'Multi-account requires Imprint';
      note.innerHTML = 'Indie supports one connected account. ' +
        'Upgrade to <a href="/press">Imprint</a> for multiple.';
    } else {
      btn.disabled = false;
      note.textContent = 'Indie: one connected account.';
    }
  } else {
    btn.disabled = false;
    note.textContent = 'Imprint: connect as many Google accounts as you need.';
  }

  // Wire disconnect buttons
  list.querySelectorAll('.disconnect-btn').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Disconnect ' + b.dataset.email + ' from Folio?')) return;
      await FolioDrive.disconnectAccount(b.dataset.email);
      renderDriveConnectionsPanel();
    };
  });
}

document.getElementById('btnConnectDrive').onclick = async () => {
  try {
    await FolioDrive.connect({});
    renderDriveConnectionsPanel();
  } catch (e) {
    alert('Could not connect: ' + (e.message || e));
  }
};

// Hook into whenever the Settings tab is opened:
FolioDrive.onChange(() => renderDriveConnectionsPanel());
```

## 2c. Tier enforcement at connect-time

A free user clicking "+ Connect a Google account" is allowed, but when
`FolioDrive.listPersistedConnections()` already returns ≥1, the button
should offer the upsell instead. The render function above handles that.

Attempting `FolioDrive.saveFile()` on free tier currently throws nothing
— it's the UI's job to not expose the save button. If we want defence
in depth, add this to `folio-drive.js`:

```js
async function saveFile(email, args) {
  if (!canLink()) throw new Error('Linked save is an Indie+ feature.');
  // ... existing code
}
```

Leaving that out for v1 since the UI already gates it.

## 2d. Unified naming consistency

Drive-integration surfaces should refer to this feature as **"Drive sync"**
in marketing copy and **"Save to Drive"** in UI. The feature name in
`CANONICAL_FEATURES.md` is "Google Drive import / sync".

---

## Not in Phase 2 — Phase 3 candidates

- `.docx` save-back (needs a client-side docx builder — the `docx@8.5.0`
  CDN library is already loaded for other features; wire it in).
- Cross-session persistence via `folio-drive-worker.js` (OAuth refresh
  token exchange with the client secret held server-side).
- Conflict detection: when a user has also edited the Drive copy in Docs
  between saves. Needs `files.get?fields=modifiedTime` compared against
  `driveLink.lastSyncedAt`; if newer, show a merge/overwrite dialog.
- Shared Drives (`supportsAllDrives=true` is already passed; still needs
  UI to pick which shared Drive to save into).
