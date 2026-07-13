# Multi-language folios — design

> **Status:** Foundation doc, July 2026. Actual implementation happens in
> the next 2–3 sessions after this one, following the phased plan below.

Localization is the single biggest reader-expansion feature Folio can
ship. An author with a Spanish translation of their fantasy folio suddenly
reaches ~500M more readers. It also gives the Imprint tier its
signature "this is why I pay $12/mo" line.

## Product intent

Two flows:

1. **Author-typed translations.** An author who speaks two languages (Irish
   + English, Spanish + English) hand-writes both versions. Zero AI. This
   is available on the Indie tier as a hook and to keep translation art
   honest.

2. **AI-assisted translations.** Author clicks "Translate to Spanish", Folio
   calls Claude via a worker endpoint, streams back chapter-by-chapter
   translations. Author reviews + can edit before flipping to published.
   This is the Imprint-tier tentpole.

## Data model

New subcollection under each folio project:

```
folio_projects/{folioId}/
  ├── translations/{lang}      ← doc per language
  │     canonical:   'en'      (which lang is the source)
  │     status:      'draft' | 'published' | 'archived'
  │     translator:  'human' | 'ai'
  │     model:       'claude-sonnet-4.6'  (if ai)
  │     translatedAt: number
  │     reviewedAt:   number
  │     reviewedBy:   uid
  │
  └── translations/{lang}/chapters/{chapterId}
        content:     '<p>...</p>'   (HTML)
        title:       string
        wordCount:   number
        updatedAt:   number
```

Language codes are ISO 639-1 (`en`, `es`, `fr`, `de`, `ga`, `zh`, `ja`, …).
Chapter IDs mirror the source folio's chapter structure. A translation
exists only for chapters the author has explicitly translated — untranslated
chapters fall back to the canonical language at read time.

## Author UX

New tab in the editor sidebar (below Audio): **🌍 Translations**.

- Row per configured language with progress bar, status chip, "Edit" and
  "Retranslate" buttons.
- "Add language" button opens a language picker.
- For AI translation: "Translate all chapters" → confirmation modal with
  estimated cost + word count, hit go → chapter-by-chapter streaming
  progress.
- Manual editing surface: split-view showing canonical chapter on left,
  translation on right, save per chapter.

## Reader UX

Language switcher in the reader's ☰ menu. Default = `navigator.language`
matched against available translations, fallback to canonical. Setting
persists in localStorage per folio. On chapter navigation the switcher
stays visible so the reader can toggle.

## Tier gating

| Tier      | Languages          | AI translation | Cost to author |
| --------- | ------------------ | -------------- | -------------- |
| Free      | Source only        | —              | —              |
| Indie ($5)| Source + 1 manual  | —              | Author-typed   |
| Imprint ($12) | Source + up to 5, including AI | Yes | AI usage counted against monthly quota (say 500k tokens/mo) |

Quota tracking: same `folio_press_subscriptions/{uid}` doc gets a
`translationTokensUsedThisMonth` field. Worker checks + increments on each
translate call, resets on the subscription anniversary.

## Worker endpoints

- `POST /translate-chapter { folioId, chapterId, sourceLang, targetLang, uid }`
  → streams SSE with the AI translation
- `GET /translations?folio=<id>` → list configured languages + status
- `POST /translate-publish { folioId, lang, uid }` → flip status draft → published

`/translate-chapter` calls Claude Sonnet with a prompt tuned for literary
translation (preserve voice, register, cultural specificity where possible,
transliterate names never).

## Prompt sketch

```
You are translating a novel from {source} to {target}. Preserve:
- authorial voice and register (formal/casual, dialogue vs prose)
- proper nouns (never transliterate character or place names unless the
  target script requires it)
- em-dashes, ellipses, and other typographic craft
- paragraph structure and pacing
Do not:
- add commentary or footnotes
- explain cultural references (fold explanation into the prose only if
  the meaning would otherwise be lost)
- change the emotional register of any scene

Return HTML matching the source structure.
```

## Compliance / attribution

Every translation carries provenance metadata:

```
{ translator: 'ai', model: 'claude-sonnet-4.6', reviewedBy: uid, reviewedAt: ts }
```

Reader-facing UI shows a small "Translated with AI (reviewed by author)"
chip on AI-translated chapters. Purists can filter out AI content in the
Shelf. Non-negotiable — the AI provenance chip stays regardless of tier.

## Phased rollout

**Phase 1 (Session N+1)** — Data model + Firestore rules + editor
"Translations" tab UI reading + displaying language rows. No AI, no
worker endpoints. Author can manually add + edit translations. Ships as
Indie-tier hook.

**Phase 2 (Session N+2)** — Worker `/translate-chapter` endpoint calling
Claude. Streaming translation into the editor. Draft → publish flow.
Ships as Imprint-tier tentpole.

**Phase 3 (Session N+3)** — Reader UX: language switcher, per-folio
localStorage persistence, chapter-level fallback. Quota tracking on the
subscription doc. Compliance chips on AI-translated chapters.

**Phase 4 (later)** — Shelf filter for translation availability, translated
descriptions/blurbs, translated imprint pages.

## Firestore rules addition (Phase 1)

```
match /folio_projects/{folioId}/translations/{lang} {
  // Read: same as parent folio visibility
  allow read: if folioVisible(folioId);
  // Write: only the folio owner
  allow write: if isUser(parentUid(folioId));

  match /chapters/{chapterId} {
    allow read: if folioVisible(folioId);
    allow write: if isUser(parentUid(folioId));
  }
}
```

## Estimated build time

- Phase 1: ~2 hours (data model + editor UI + rules)
- Phase 2: ~3 hours (worker + Claude integration + streaming)
- Phase 3: ~1.5 hours (reader switcher + provenance chips)
- Total: ~6.5 hours of focused work, split across 3 sessions.

Estimated Claude API cost per translated book (assuming ~80k words):
input ≈ 100k tokens, output ≈ 100k tokens ≈ $1.20 at Sonnet pricing.
Author sees this as "1 book ≈ 20% of your monthly quota" if we cap at
~500k tokens/mo.

## Notes for future me

- Translation queues per subscription — if an author queues 5 books at
  once, we throttle to N chapters/minute so Claude's rate limits are
  respected.
- Pin a specific Claude model version in the prompt payload so translations
  are reproducible.
- Consider offering community translations as a Phase 4 gift — an author
  can grant translator role to another Folio user for a specific folio,
  letting fans crowd-translate popular works.
