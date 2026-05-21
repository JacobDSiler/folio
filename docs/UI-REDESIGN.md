# Folio — UI Redesign & Monetization Plan

_Audit and decisions recorded May 2026, pre-public-launch._

This document captures (1) an audit of Folio's editor UI, (2) the agreed
restructure from seven sidebar tabs to four, (3) the "global defaults"
change, and (4) the monetization model with its trust safeguards. It is
the reference for the redesign work; update it as phases land.

---

## 1. Why this redesign

Folio has accumulated a lot of genuinely strong features — multi-format
export, one-click audiobook generation, a real server-gated paywall,
serial releases, per-chapter teaser funnels, annotations, pronunciation
glossary. The risk at launch is not capability; it is **cognitive load**.

A non-technical novelist arriving for the first time — often at the tail
end of a long writing marathon — should not feel they have hit a second
marathon. The current sidebar presents seven tabs, twenty-three
sections, and over two hundred buttons at a flat hierarchy. Powerful,
but easy to read as "too hard for me."

The goal: keep every feature, but arrange them so the **import → format →
publish** path is obvious, the flagship audiobook feature is
discoverable, and the rarely-touched knobs stop competing for attention.

---

## 2. Current state (audit)

Seven tabs:

| Tab | Size | Contents |
|-----|------|----------|
| Import | 3.5 KB | Import Files, Import options, Paste Manuscript |
| Chapters | 1.8 KB | Chapter List |
| Details | 4 KB | Book Details (title / author / blurb) |
| Design | 1.8 KB | Theme, Accent Color, Chapter Ornaments, Page Size |
| Type | 8.6 KB | Accessibility Presets, Typography, Pronunciations, Cast |
| Images | 1.6 KB | Cover Image, Chapter Header Images |
| Folio (cloud) | 14 KB | Current Folio, Bookmarks, Annotations, Invite & Share, Collaborators, My Folios, Guided tour, Saved Versions |

### Problems, worst first

1. **Seven tabs is too many and sliced too thin.** Chapters, Design,
   and Images are a whole tab each for one small job. A first-time user
   must model all seven labels before acting.

2. **The "Type" tab is mislabelled and hides the flagship feature.**
   It is named for typography but contains Pronunciations and Cast — the
   audiobook glossary. The Audio *generation* button lives separately,
   at the bottom of the Export footer. Folio's most impressive,
   most shareable feature is split across two unrelated regions, and
   neither is labelled "Audio."

3. **Appearance is fragmented across three tabs** — Design, Type, and
   Images all answer "how does my book look."

4. **The Folio (cloud) tab is a 14 KB junk drawer** — eight unrelated
   sections, including Bookmarks and Annotations, which are *reading*
   features oddly filed under the editor's cloud tab.

5. **No global defaults.** Theme, font, and page size reset per folio.
   A writer who always wants the same setup re-configures every book,
   which trains them to treat configuration as a recurring chore.

---

## 3. The restructure — seven tabs to four

Decision: **7 → 4.** Rationale across all three lenses — user-friendliness
(four clear nouns beat seven), professionalism (tight navigation reads as
finished), and viral marketability (Audio gets its own named tab, so the
"it makes an audiobook" hook is visible in any screenshot or demo).

### New tabs

**Manuscript** — getting and organizing content.
Import Files, Import options, Paste Manuscript, the Chapter List
(reorder, split, add). This is where a writer lives day to day.

**Book** — how the book looks and what it is called.
Book Details (title / author / blurb), Theme, Accent Color, Cover image,
Chapter header images, Typography. The rarely-touched knobs — Chapter
Ornaments, Page Size, Accessibility Presets — collapse under an
"Advanced appearance" disclosure: available, not shouting.

**Audio** — the flagship, promoted to its own tab.
Pronunciations glossary, Cast, and the Generate-audiobook controls all
in one place. Today this feature is effectively hidden; a named tab is
the single biggest "this tool is powerful" win.

**Folio** — slimmed cloud / account home.
My Folios, Saved Versions, Share & Collaborators, account/cloud status,
the guided tour launcher. Bookmarks and Annotations move out of here
(they belong with the reader, or a small "My notes" affordance).

### Also in this redesign

- **Publish** stays a prominent, always-visible button — the end of the
  journey should never be hunted for.
- The **Export footer** collapses from nine always-visible format
  buttons to a single "Export ▾" control.
- **"Set as default for new folios"** appears wherever a design setting
  lives. One `localStorage` write; new folios start from the writer's
  defaults. Directly fixes problem 5.

### Implementation phases

1. **Phase 1 — tab shell.** Collapse the seven tab buttons to four,
   move the existing section `<div>`s into the new tab containers. No
   feature logic changes; pure DOM re-parenting. Keep every element id
   stable so existing JS keeps working.
2. **Phase 2 — Audio consolidation.** Bring the Generate-audiobook
   controls up from the Export footer into the Audio tab beside the
   glossary.
3. **Phase 3 — Advanced disclosure.** Wrap ornaments / page size /
   accessibility presets in a collapsible "Advanced appearance" block.
4. **Phase 4 — global defaults.** Add the "set as default" affordance +
   the new-folio hydration from `localStorage`.
5. **Phase 5 — Export footer collapse** to a single button + menu.

Each phase is independently shippable and testable.

---

## 4. Monetization

Folio takes **nothing** from an author's book sales — the author's
payment provider (Gumroad / Stripe / PayPal / Ko-fi) takes its standard
fee and the author keeps the rest. Folio is a tool, not a marketplace.
Folio's own revenue comes from the model below.

### Three doors, one honest house

1. **Free** — genuinely complete. Import any format, all design and
   typography, all standard exports (PDF / EPUB / DOCX / MD / HTML /
   TXT), publish free / private / paid, audiobook generation with the
   author's own API key, one active serial release. Not crippleware.
   This is the headline and it stays true forever.

2. **Folio Pro** — offered in two shapes at checkout, same features:
   - a subscription, around **$9/month** (or discounted annual), and
   - a one-time **per-book unlock**, around **$20**.

   The writer chooses: prolific authors subscribe; a one-novel writer
   pays once. Pro includes: **bundled audiobook minutes** (Folio pays
   the TTS cost, so no Google Cloud account is needed — the headline
   Pro value), unlimited serial releases with guaranteed cron, custom
   domain for reader links, removal of the "Made with Folio" footer,
   premium themes / fonts / cover templates, MOBI/Kindle + large-print
   exports, collaborator seats, and reader analytics.

3. **Support Folio (tip)** — a genuine pay-what-you-want button, framed
   transparently: _"Tip Folio anything you like — supporters get a
   14-day Pro pass as a thank-you."_ The user knows exactly what is
   happening: a tip, with a gift in return. This is the "carrot" kept
   honest because nothing is disguised.

Plus the resentment-remover: **every new user gets a 14-day Pro trial
automatically** — no card, no tip. Everyone feels the bundled-audio
magic once; the tip-for-a-pass is for those who already want more.

### The five trust rules (non-negotiable)

1. **Never call a feature-unlocking payment a "donation."** A donation
   is a gift with nothing expected back. If it unlocks features it is a
   purchase; calling it a donation erodes trust and blocks real
   donation rails later. Use "tip" / "support" with a clearly stated
   thank-you perk.
2. **Anything created during a trial or pass is the user's forever.**
   An audiobook made on a trial keeps playing after it ends. A book
   published stays published. Only *making more* pauses.
3. **The free tier is a complete publishing tool, never deliberately
   broken** to force upgrades.
4. **Data safety is always free** — local backup, autosave, and
   exporting one's own manuscript are never gated. Never hold a user's
   own work hostage.
5. **Trial-end is calm, not a wall.** Show a quiet "here is what
   changed" note. No lockout screen, no nagging.

### Build order for monetization

Do **not** build billing infrastructure yet — at one tester it is
premature. Instead:

1. Add a `plan` flag (`'free' | 'trial' | 'pro'`) that features can
   check. Default everyone to `trial` / `pro` so nothing is actually
   locked during early testing.
2. Add a "Folio Pro — coming soon" panel that collects email addresses.
3. Wire real billing (Stripe) only once there is an audience to charge.

This lets the redesign and the gate scaffold land now without blocking
on payment plumbing.

---

## 5. Status log

- _May 2026_ — audit completed; 7→4 restructure and three-door
  monetization model agreed.
- _May 2026_ — **Phase 1 DONE.** Seven tab buttons collapsed to four
  (Manuscript / Book / Audio / Folio). The pronunciation + cast
  sections were physically moved out of the old Type tab into a new
  `#tab-audio` div. `switchTab()` is now group-aware, with a
  `_tabNormalize()` shim so every legacy `switchTab('chapters', …)`
  call site keeps working unedited. Boot-restore, last-tab
  persistence, and the editor tour stops were all updated. Every
  element id preserved — no other JS affected.
- _Next_ — Phase 2: lift the Generate-audiobook controls from the
  Export footer into the Audio tab.
