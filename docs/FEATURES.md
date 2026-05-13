# Folio — Features & Use-Cases

A living reference for what Folio does, who it's for, and how each piece fits together. Written for the author of Folio (Jacob) and end-users who want to understand the surface area before diving in.

Sections are independent — feel free to jump around. Anything marked **WIP** is partially built; **Planned** is on the roadmap but not yet shipped.

---

## Table of contents

1. [What Folio is](#what-folio-is)
2. [URLs & app surface](#urls--app-surface)
3. [Authoring](#authoring)
4. [Formatting & typesetting](#formatting--typesetting)
5. [Audiobooks (TTS)](#audiobooks-tts)
6. [Reading mode & sharing](#reading-mode--sharing)
7. [Annotations & bookmarks](#annotations--bookmarks)
8. [URL anchor protocol — deep links](#url-anchor-protocol--deep-links)
9. [Releases — Free / Paid / Private](#releases--free--paid--private)
10. [Serial releases](#serial-releases)
11. [Collaboration & roles](#collaboration--roles)
12. [Versions](#versions)
13. [Cloud sync & local backup](#cloud-sync--local-backup)
14. [Theme, typography, and accessibility](#theme-typography-and-accessibility)
15. [Print-on-demand (Lulu)](#print-on-demand-lulu)
16. [Settings & API keys](#settings--api-keys)
17. [Architecture notes (developer)](#architecture-notes-developer)
18. [Troubleshooting](#troubleshooting)
19. [Roadmap & open ideas](#roadmap--open-ideas)

---

## What Folio is

Folio is a browser-based "book studio" — a single editor that handles drafting, galley-grade typesetting, audiobook generation, and release (free, paid, or serial) for authors. No software install, no per-word fees, autosave from the first keystroke. The editor lives at **`folio.jacobsiler.com/app.html`**; the public-facing marketing page is at **`/`**.

The core promise is end-to-end: the same document carries from first sentence through cover-design, EPUB/PDF export, narrated audiobook, and a shareable reader link. Folio doesn't take a cut of paid releases — payment runs through Gumroad and the author keeps 100% of revenue (less Gumroad's own fee).

---

## URLs & app surface

| URL | Purpose |
|---|---|
| `/` (index.html) | Welcome / marketing landing page. Redirects returning authors to `/app.html`. |
| `/app.html` | The editor + reader. Single-page app, all flows live here. |
| `/serials-guide.html` | How serial releases work (author guide). |
| `/api-keys-guide.html` | How to set up Google / ElevenLabs TTS keys. |
| `/privacy.html`, `/terms.html` | Legal. |

The welcome page sets a `folio_visited` flag on first interaction so subsequent visits skip straight to the editor. Reader links and editor-bound deep-links bypass the welcome entirely.

---

## Authoring

The editor opens to a writing surface with a left-hand sidebar (Folios, Current Folio, Chapters, Audio, Settings tabs) and a main preview pane.

- **Distraction-free editor** — typewriter-style writing mode, autosave, undo history.
- **Chapters & front matter** — drag-to-reorder, scene breaks, dedications, table of contents.
- **Word count + word goals** — per-folio goal tracking (`folio_wg_global_target` in localStorage).
- **Real-time galley preview** — the right pane shows typeset output as you write (drop caps, ornaments, page numbers, justification).
- **Find & replace, pronunciation overrides, character notes** — right-click context menu in the editor.

**WIP**: There's a writing-mode UI (`#writingMode`) that hides the sidebar for full-screen prose. Toggle from the chapter view.

---

## Formatting & typesetting

Folio renders galley-grade typography in the browser. Outputs:

- **EPUB** — for e-readers and Kindle.
- **PDF** — print-ready, with trim-size presets (5×8, 6×9, etc.).
- **DOCX** — via docx-from-template; mostly for editor handoff.
- **HTML** — single-file portable book.

Toggles you can set per-folio:

- Typeface family (Crimson Pro, Playfair Display, IM Fell English, Libre Baskerville).
- Drop caps on/off, ornament style, scene-break marker.
- Embed Tinos font — required for Lulu/IngramSpark POD exports (`folio_embedFonts` flag).
- Justified vs ragged-right.
- Page numbers, running heads.

---

## Audiobooks (TTS)

Generate a chaptered audiobook from your manuscript using your own TTS provider keys (bring-your-own — Folio doesn't proxy them):

- **Google Cloud TTS** — wide voice library, supports Neural2 / Studio voices.
- **ElevenLabs** — higher-fidelity, includes voice cloning.

Per-chapter / per-character voice assignment lives in the Audio tab. You can:

- Assign a voice to a character (with auto-detection based on "said NAME" / "NAME said" dialog patterns).
- Test a voice with a sample line.
- Generate one chapter, then bulk-generate the rest in the background.
- Import an externally-recorded audio file for a chapter (the system tracks text-hash so it tells you when the text has changed since recording).
- Bundle the audiobook with the paid release (one Gumroad purchase = ebook + MP3).

Output: chaptered MP3 with ID3 tags and chapter marks. Workers in `folio-tts-worker.js` orchestrate the requests against the user's keys.

API key setup: see `api-keys-guide.html` or [Settings & API keys](#settings--api-keys) below.

---

## Reading mode & sharing

When a folio is opened with `?read=<folioId>` (e.g. via a share link), the editor switches to a stripped-down "reader" chrome:

- Top bar with: chapter picker, typography controls (font size, line height), pronunciation tooltips, bookmarks drawer, annotations drawer, audiobook drawer.
- No editor sidebar; reading-only.
- Reading-progress tracking — scroll position is autosaved (per-folio) and a "Continue reading" pill restores it on return.

The author can copy the reader link from the release modal's URL box once a folio is released.

**Audiobook drawer** — if the release bundles audio, the reader gets an in-browser player synced to the chapters.

---

## Annotations & bookmarks

Both live on the manuscript and sync across devices via Firestore (subcollections under `folio_projects/{id}`).

### Annotations

Highlights and notes pinned to a text range. Each carries a **scope** that controls who else sees it:

| Scope | Visible to |
|---|---|
| `personal` | The creator only — their own working notes, across their devices. |
| `editor` | Author + anyone whose role is `editor`. |
| `collaborator` | Author + editors + beta readers. |
| `public` | Anyone reading the folio. Author-only — readers/betas can't publish to all. |

The default scope when you create a new note depends on your role:

- **Author** → `personal` (private working notes)
- **Editor** (`?role=editor`) → `editor`
- **Beta** (`?role=beta`) → `collaborator` (so feedback goes back to the author and other betas)
- **Reader** (`?role=reader` or default) → `personal` (their own reading log)

You can change the scope from the dropdown in the note-edit dialog. The picker only shows scopes you're allowed to use.

**Real-time sync**: annotations push to Firestore on every change and subscribe via `onSnapshot`, so collaborators see each other's notes appear live.

### Bookmarks

A bookmark pins a paragraph in a chapter. Same `scope` system as annotations (in current code, scope is mostly informational for bookmarks — `personal` is the typical use). Bookmarks sync in the same way.

### Copy link to a specific annotation or bookmark

Every annotation and bookmark row in the sidebar now has a 🔗 button that copies a deep-link URL pointing at exactly that note or place. See the next section for the URL spec.

---

## URL anchor protocol — deep links

You can build URLs that open a folio scrolled and flashed at a specific spot. Useful for citing a passage in a forum, embedding a link in technical documentation, or pointing a beta reader at "this paragraph specifically."

### Parameters

| Param | Meaning |
|---|---|
| `read=<folioId>` | Open in reader mode (the share-friendly form). |
| `folio=<folioId>` | Open in editor mode (the author form). |
| `annot=<annId>` | Scroll to this annotation, flash it. |
| `bm=<bmId>` | Scroll to this bookmark, flash it. |
| `ch=<chapterId>` | Jump to the start of this chapter. |
| `p=<paragraphIndex>` | Paragraph offset (0-based). Use with `ch=`. |
| `role=reader\|beta\|editor` | Role label for the visitor. |
| `welcome=1` | Force-show the welcome page even for returning users. |

### Examples

```
https://folio.jacobsiler.com/app.html?read=proj_abc&annot=an_xyz
    → opens reader, scrolls to and flashes annotation an_xyz

https://folio.jacobsiler.com/app.html?read=proj_abc&ch=ch_intro&p=4
    → opens reader, jumps to paragraph 4 of chapter ch_intro

https://folio.jacobsiler.com/app.html?folio=proj_abc&annot=an_xyz&role=editor
    → opens editor with editor role, scrolls to annotation an_xyz

https://folio.jacobsiler.com/app.html?read=proj_abc&bm=bm_pq3
    → opens reader, scrolls to bookmark bm_pq3
```

### How to get one

- **Annotation** → click the 🔗 button on the annotation row in the Notes sidebar (or annotations drawer in reader mode).
- **Bookmark** → click the 🔗 button on the bookmark row.
- **Chapter / paragraph** — programmatically via the console: `_chCopyDeepLink('<chapterId>', <paragraphIndex>)`. A UI button for this is **Planned**.

### Limits

- The recipient still needs to be able to read the folio. For a draft (unpublished) folio, only the author can read; for a published folio, anyone with the link can read.
- Annotations with `personal` scope are visible only to their creator — sharing a deep-link to your own personal annotation will scroll the recipient to the paragraph, but the annotation itself won't be visible to them. Use `collaborator` or `public` scope for sharable notes.
- If the manuscript is edited after the link is shared, the paragraph offset may shift. The link will still scroll to the closest paragraph; the annotation flash may be off by a few paragraphs.

---

## Releases — Free / Paid / Private

The release modal (🔖 button in the editor) publishes a read-only copy of your folio that readers can open via the reader URL.

Three access modes:

| Mode | Behavior |
|---|---|
| **Public & free** | Anyone with the link can read. Best for newsletter giveaways, social posts, free serialization. |
| **Paid** | Readers hit a paywall gate and buy on Gumroad to unlock. Folio takes 0%; Gumroad takes their usual cut. |
| **Private link** | Anyone with the exact link can read — no listing, no discovery. Use for editors, beta readers, advance copies. |

Paid mode adds fields for:

- **Gumroad product id** (the slug after `gumroad.com/l/`)
- **Price** and **currency** (USD / EUR / GBP / CAD / AUD)
- **Free preview sections** (0–99): how many chapters readers can read before the paywall appears.

### Attaching audio to any release

A separate **Include the audiobook with this release** checkbox lives below the paid-fields container, available for *every* release mode. When ticked:

- **Free** release → readers see a 🎧 button in the reader bar; tracks play immediately.
- **Paid** release → tracks are bundled with the Gumroad purchase; locked until the buyer's license is verified.
- **Serial** release → each chapter's audio unlocks alongside its text chapter (driven by the same cadence).
- **Private** release → tracks are available to anyone with the link.

### How audio reaches the reader

Audio tracks are generated and stored in the author's browser-side IndexedDB (`folio_audio` store) by the editor's Audio panel. On every publish where the "Include the audiobook" box is ticked, the publish flow:

1. Walks the local audio store for this folio and uploads each blob to Firebase Storage at `folio_audio/{folioId}/{trackKey}`.
2. Captures each track's download URL plus metadata (title, duration, section type, voice, etc.) into a manifest array.
3. Writes the manifest to `release.audioManifest` on the parent Firestore doc, alongside `audioBundle: true`.

The publish modal's status line shows live progress ("Uploading audiobook 3/12 — Chapter 3…"). On any per-track failure the publish aborts cleanly with the error surfaced — no partial state lands on disk.

The reader's audiobook drawer prefers `release.audioManifest` over the local IDB. Phones / fresh browsers / friends stream from the manifest URLs; the owner falls back to IDB when previewing their own work before publish (or for legacy releases that predate the manifest).

**Storage rules** — once you ship this, add this block in Firebase Console → Storage → Rules:

```
service firebase.storage {
  match /b/{bucket}/o {
    match /folio_audio/{folioId}/{trackKey} {
      // Read: owner of the folio always; anyone authed when the
      // matching parent doc has release.published == true.
      allow read: if
        (request.auth != null
         && request.auth.uid ==
              firestore.get(/databases/(default)/documents/folio_projects/$(folioId)).data.uid)
        ||
        (request.auth != null
         && firestore.get(/databases/(default)/documents/folio_projects/$(folioId)).data.release != null
         && firestore.get(/databases/(default)/documents/folio_projects/$(folioId)).data.release.published == true);

      // Write / delete: folio owner only.
      allow write, delete: if request.auth != null
                           && request.auth.uid ==
                                firestore.get(/databases/(default)/documents/folio_projects/$(folioId)).data.uid;
    }
  }
}
```

**Delta uploads** (skip unchanged tracks via `textHash` compare) are a known optimization but not in Phase 1. Full re-upload on every publish; tractable for typical audiobooks. If you have a 10-hour audiobook and that becomes onerous, that's the optimization to chase next.

The reader URL is shown in the modal once published; copy it with the 📋 button. The published URL is stable across edits — readers always see the latest content.

**Paywall workflow**: License keys are issued by Gumroad on purchase. The reader pastes their key to unlock; tokens are cached locally in `folio_paywall_<releaseId>`. Verification runs through `folio-paywall-worker.js` (Cloudflare Worker).

---

## Serial releases

A serial release unlocks chapters one at a time on a schedule (weekly, biweekly, monthly, or a custom interval). Set up in the same modal — tick "Serial release" to expose the schedule fields:

- **Cadence**: Weekly / Every 2 weeks / Monthly / Custom (specify days).
- **First release at**: the moment Chapter 1 becomes available.
- **Preview**: a live "Chapter N · date" line shows the next 5 unlock dates.
- **Email subscribers each time a chapter unlocks**: when checked, the system sends an unlock notification to readers who opted in via the inline subscribe form. Handled by `folio-email-worker.js`.

Until a chapter's unlock date, readers see a locked countdown card in its place. The reader's sidebar dashboard shows "Ch X of Y · next: date".

Author actions:

- **🔓 Release Ch N now** — manual override button in the sidebar; releases the next chapter immediately, regardless of schedule.
- **Resubscribe / unsubscribe** — tokens in the URL handle this; see `subscribers` subcollection in Firestore.

Detailed author guide: `/serials-guide.html`.

---

## Collaboration & roles

Folio has four conceptual roles, indicated via the `role=` URL param when you share a link:

| Role | Default scope | Sees |
|---|---|---|
| **Author** (owner) | `personal` | Everything (theirs + everyone else's). |
| **Editor** (`?role=editor`) | `editor` | Their notes + author's editor-scope + collaborator-scope. |
| **Beta** (`?role=beta`) | `collaborator` | Their notes + author's collaborator-scope + other betas' collaborator-scope. |
| **Reader** (`?role=reader` or default) | `personal` | Their own personal notes + author's `public` annotations. |

Role is a soft label set by URL; there's no per-uid role assignment yet. **Planned**: a per-folio "betaPeersVisible" toggle so the author can choose whether betas see each other's feedback, plus uid-based role assignment for stricter privacy. Both will require Firestore rule changes.

---

## Versions

Save named snapshots of a folio at any point — full state, restorable later.

- **Save version** button in the sidebar's Current Folio section.
- Versions list in the sidebar shows date, chapter count, word count.
- **Restore** swaps the in-memory folio for that version's state.
- **Delete** removes a snapshot.

Versions are stored at `folio_projects/{id}/versions/{verId}`. They include the full body, so a long manuscript with many versions can use significant storage.

---

## Cloud sync & local backup

Two layers of persistence:

1. **Firestore cloud** — source of truth for everything (parent doc with metadata, body subcollection with manuscript content, annotations / bookmarks / versions / presence / subscribers subcollections). Real-time and multi-device.
2. **localStorage backup** — every save (manual or autosave) also writes a copy to `localStorage.folio_local_backup`. Used as:
   - Offline cache (read first on page load).
   - Last-resort recovery if the cloud is unreachable or rules deny a write.

### Local-backup recovery UI

If a cloud save fails — or if you just want to fork off the most-recent saved state — the editor surfaces three things:

- **Sidebar pill** ("💾 Local backup") next to the cloud-status badge — persistent shortcut, visible whenever a backup exists.
- **Banner at the top of the preview** on page load when a backup is detected.
- **Recovery dialog** (opened from either) showing the backup's name, save time, chapter/word count, and three actions:
  - **Restore into the current editor** — adopt the backup's id, replace in-memory state, push to cloud.
  - **Save as a new folio** — fresh id, populate from backup, save to cloud. Original editor state stays untouched.
  - **Discard backup permanently** — removes the localStorage entry with a confirm.

The banner is suppressed in reader mode and after a per-session dismiss.

### Failure handling

- **Cloud rules deny a save** — a friendly toast tells you the backup just landed locally and points you at the sidebar pill for recovery.
- **Browser quota exhausted / private mode** — the toast warns that the in-memory state is the only copy and reload will lose it.

---

## Theme, typography, and accessibility

- **Dark mode** — toggle in Settings; respects `prefers-color-scheme` initially.
- **Reader typography** — readers control their own font size, line height, paragraph spacing.
- **WCAG AA contrast** — the editor's palette is contrast-tuned (AA on muted, AAA on text).
- **Keyboard shortcuts**: Ctrl+B / Ctrl+I for bold/italic in the editor; arrow-key navigation in reader chapter picker.

---

## Print-on-demand (Lulu)

Folio integrates with Lulu's print API for paperback / hardcover production runs. Submit a folio with a chosen trim size and binding, receive a print proof, order copies.

- Settings for shipping country, paper stock, cover material, binding type.
- The submission record lives in `lulu_jobs/{jobDoc}` (per-user, owner-only).
- IngramSpark and other POD providers are **Planned**.

---

## Settings & API keys

The Settings tab in the sidebar lets you:

- Set your Google Cloud TTS key (`folio_audio_google_key`).
- Set your ElevenLabs key (`folio_audio_el_key`).
- Toggle font embedding (`folio_embedFonts`).
- Choose dark / light mode (`folio_dark`).
- Set a global daily word goal (`folio_wg_global_target`).

API keys are stored in `folio_user_settings/{uid}` on Firestore — owner-only read+write — and **never exposed via any public read rule**. They never leave your browser unencrypted unless you explicitly export the doc.

Step-by-step setup: `/api-keys-guide.html`.

---

## Architecture notes (developer)

Single-page app, ~17k lines of HTML/JS in `app.html`. Major subsystems:

- **Editor state** — `chapters` array, `_projId`, `_state` serialised via `_serialise()` / `_deserialise()`.
- **Cloud save** — `_writeFolioCloud(folioId, name, opts)` writes parent doc first (carries `uid`), then body subdoc (carries `uid` so the rule's `get()` against the parent resolves to the same owner).
- **Body compression** — manuscripts gzip via `CompressionStream` to fit Firestore's 1 MiB per-doc cap; body lives in its own subcollection so the parent stays metadata-only.
- **Auth** — anonymous sign-in by default; Google sign-in via popup or redirect. Anonymous → Google upgrade preserves state via `folio_pending_upgrade` flag.
- **Reader mode** — `_rdMaybeActivate()` runs on `?read=`; sets `_readerMode` + `_readerRole`, calls `loadFolioById`, applies role-aware reader chrome.
- **Annotations** — Phase 2 cloud sync via `_annAttachCloudSync(folioId)` — pulls + subscribes via `onSnapshot`, diff-pushes on `_annSave`.
- **Deep-link runtime** — `_deepLinkApply()` reads `?annot=`, `?bm=`, `?ch=`, `?p=` from the URL and scrolls accordingly.

### Firestore data model

```
folio_projects/{folioId}
├── (metadata fields: uid, name, chapterCount, wordCount, release, updatedAt)
├── body/main                  ← gzipped manuscript state
├── annotations/{annId}        ← per-annotation; carries scope + uid
├── versions/{verId}           ← named snapshots
├── presence/{uid}             ← who's viewing this folio right now
└── subscribers/{subId}        ← serial-release email list

folio_user_settings/{uid}      ← API keys, prefs (owner-only)
folio_landing/config           ← marketing-page showcase + stats config
lulu_jobs/{jobDoc}             ← print-on-demand orders
```

### Workers

- `folio-tts-worker.js` — runs against `folio-tts.jacobdsiler.workers.dev`. Proxies the user's TTS provider keys, returns audio bytes. Voice cloning, ID3 tagging.
- `folio-paywall-worker.js` — runs against `folio-paywall.jacobdsiler.workers.dev`. Verifies Gumroad license keys, issues JWTs that the reader caches locally.
- `folio-email-worker.js` — sends serial-unlock notifications via Resend / Mailgun (configurable). Manages unsubscribe tokens.

### Push workflow

`scripts\folio-push.cmd` (Windows double-click) → `scripts\folio-push.ps1`:

1. Auto-discover the most recent Cowork outputs folder containing `.folio-pending-commit.txt`.
2. Copy any present content files into the repo root (`app.html`, `index.html`, workers, marketing pages).
3. Stage + commit + push. The commit message comes from `.folio-pending-commit.txt`. Everything except the commit-message stamp is optional.

---

## Troubleshooting

**"Save blocked by cloud rules (body subdoc)"**
The body subdoc rule denies the write. Most likely fix: ensure `bodyPayload` carries `uid` and the parent doc is written FIRST (so the body rule's `get()` finds it). See `_writeFolioCloud` in app.html.

**Reader link shows the Night Garden demo on someone else's device**
The deployed `_rdMaybeActivate` is calling `loadFolio` (non-existent) instead of `loadFolioById`. Hard-refresh the deployed version; if the issue persists, redeploy after the fix described in the commit history (March 2026).

**Reader can click "← Editor" and edit my book**
Fixed via three layers of defense:
1. The `rdBack` button is hidden in `_rdHydrate` unless `_loadedFolioOwnerUid === window._uid`.
2. `loadFolioById` adds an ownership gate — if a non-owner lands in editor mode (no `?read=`) for a folio they don't own, it redirects to `?read=ID` if published, refuses with a 🔒 toast otherwise.
3. `folio_last_open` only gets written when the loader actually owns the folio, so reader-mode visits don't poison the editor's auto-restore path on the next visit.

**Serial release shows the full book / no subscribe form**
Two issues compounded:
1. `_rlCurrent` was populated by a setInterval polling `_projId`, which fires *after* `previewRendered` already ran with `_rlCurrent === null` — so the serial-locks handler had nothing to act on. Fixed by populating `_rlCurrent = data.release` synchronously in `loadFolioById` before deserialise/render.
2. `_serialMaybeRenderSubscribeForm` only ran after `_serialApplyLocks` succeeded, which required step 1. With locks now appearing on first render, the form auto-mounts next to the first lock card. The load tail also calls it directly as a belt-and-braces safety.

**Cloud save reports success but the body never updates**
Check Firestore rules — `match /body/{bodyDoc}` must allow write for the owner, and the body payload must include `uid`. The current shape is `get(/folio_projects/{projectId}).data.uid == request.auth.uid`.

**Local-backup recovery banner shows on the reader view**
Should be fixed — `_refreshLocalBackupUI` bails when `_readerMode` is true. If you still see it, reload the page; cached old JS may be in play.

**Anonymous → Google sign-in loses the current folio**
The `folio_local_backup` is set before sign-in to preserve state; after the OAuth round trip, `_restoreFolioBackupAfterUpgrade()` rehydrates. If the flag `folio_pending_upgrade` is set but the user comes back anonymous, the redirect failed (authorized domains, OAuth consent, third-party cookies blocked) — check the console for `[AUTH]` logs.

---

## Roadmap & open ideas

### WIP / partially-shipped

- **Annotation cloud sync** — shipped (Phase 2). Defaults by role, scope-aware visibility, per-annotation Firestore docs.
- **URL anchor protocol** — shipped. Deep-links for annotations, bookmarks, chapters, paragraphs.
- **Local-backup recovery UI** — shipped.

### Planned (next loops)

- **Audio delta upload** — current pattern re-uploads every track on every publish, even unchanged ones. Compare `textHash` per track against the prior `release.audioManifest` entry and skip uploads that match. Big win for long audiobooks where the author re-publishes after editing one chapter.
- **Per-folio `betaPeersVisible` setting** — author toggles whether betas see each other's feedback. Needs a fifth scope or a `peersHidden` flag plus matching rules.
- **Per-page funnel sharing for paid books** — share a single chapter or page as a free teaser, with a Gumroad CTA to unlock the rest. Different from `previewSections` (which is a fixed prefix from the start); this is "share any single chunk." Probably uses `?upto=` or `?only=` URL params.
- **Copy-link UI for chapter/paragraph** — currently console-only via `_chCopyDeepLink()`. Needs a small "Copy link to this paragraph" affordance on hover or right-click.
- **Uid-based role assignment** — the author maintains a list of editor / beta / collaborator uids on the folio doc; rules enforce role permissions server-side. Replaces the URL-role soft label.
- **IngramSpark + other POD providers** beyond Lulu.
- **Annotation threading** — replies to a comment, resolve workflow, mention notifications.

### Ideas to explore

- **Excerpt-to-graphic** — auto-generate a shareable "quote card" image from a selected passage (think Kindle highlight cards).
- **Reading-room mode** — multiple readers see each other's anonymous cursor positions in real-time, optional chat. "Book club" mode.
- **Annotation digest** — once a week / on-demand, email the author a summary of recent beta/editor comments.

---

*Last updated: 2026-05. Push changes here whenever a feature lands, gets restructured, or learns a new failure mode worth documenting.*
