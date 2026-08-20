# Folio Smart Scan — design plan

**Status:** design logged, no code yet. Waiting on Jacob's sign-off
before implementation.
**Priority:** medium — after Stage 3.5 (Author Profile) + custom
subdomains land solidly. Slots roughly at Stage 4-ish.
**Origin:** Jacob, 2026-08-11.

---

## What Smart Scan is

A set of AI-assisted authoring tools inside the editor that turn
messy inputs (photos, PDFs, pasted text) into structured folio
content. Every task follows the same shape: user drops something in,
Smart Scan proposes a structured result, user confirms or edits.

Concrete use cases in scope:

1. **Photo of a page → chapter text.** OCR. Author scans a physical
   manuscript with their phone camera, gets typed text they can
   drop into a chapter.
2. **PDF → chapters.** Split a PDF into detected chapters (heading-
   pattern based), extract text, propose chapter titles.
3. **Book cover → suggested metadata.** Upload a cover image, get
   proposed title / subtitle / genre / age rating / three-tag list
   the author can accept or adjust.
4. **Chapter text → tags + summary.** Paste in a chapter, get
   suggested `release.tags[]`, a short back-blurb, and a
   one-sentence chapter summary (for the info-modal chapter strip).
5. **Chapter text → character list.** Extract named characters +
   suggested descriptions (fits into the character-cast tool
   Folio already has).
6. **Illustration match / generate.** Given a chapter or scene,
   propose an illustration that matches (retrieval from a curated
   set OR generation via image model).

Out of scope for v1:

- Full ghostwriting / rewriting of chapters.
- Voice-cloning for narration (Folio already has TTS; separate track).
- Real-time collaborative editing suggestions.

---

## The economic constraint

BYOK (bring your own key) sounds clean but has real UX friction:

- Most authors have never gotten an AI API key.
- Keys are irrevocable secrets; asking authors to trust Folio with
  them is a real cost to that relationship.
- Support burden: "why doesn't my key work?" tickets, key rotation,
  quota confusion.

Folio-hosted-everything sounds clean but has real cost friction:

- A single chapter analysis via GPT-4o-mini is ~$0.003; via Claude
  Sonnet ~$0.008. Cheap per call, but a heavy free user could rack up
  100 calls/day = $9/mo cost against $0 revenue.
- Free-tier abuse: bots signing up, running mass metadata extraction
  against their own book library, moving on.

The design that resolves both: **hybrid — on-device for cheap
deterministic tasks, Folio-hosted with a tier-capped allowance for
LLM tasks, BYOK as a power-user escape hatch.**

---

## Architecture — three lanes

### Lane A — On-device (free, unlimited, private, always)

Runs entirely in the browser. Zero API cost, zero data leaves the
device unless the author explicitly uploads the result to their folio.

Uses:
- **OCR** — Tesseract.js. Free, MIT licensed, ~10 MB WASM module,
  lazy-loaded on first Smart Scan invocation. Slower + slightly
  less accurate than cloud OCR but perfectly workable for print +
  clean handwriting. Perfect for a privacy-conscious author.
- **PDF parsing** — pdf.js (already imported for other flows). Split
  into pages, extract text streams, hand off to Tesseract for
  scanned/image-only pages.
- **Heading-pattern chapter split** — pure regex heuristics
  (`^Chapter \d+`, `^\s*\d+\s*$`, `^[A-Z\s]{6,}$` for all-caps
  section headers, etc.). Deterministic. No AI needed.
- **Image auto-crop / rotate** — client-side canvas transforms so
  the author can straighten a phone-snapped page before OCR.

Result: complete Smart Scan pipelines for "photo → chapter text"
and "PDF → chapters" without any AI API call. Ship this first;
it's the biggest win for the biggest cohort of users.

### Lane B — Folio-hosted LLM (per-tier allowance)

Requests go through a new `/smart-scan` endpoint on the paywall
Worker (or a new dedicated Worker; TBD). Worker uses Folio's central
API key (Anthropic or OpenAI, TBD by cost model).

Tasks in this lane:
- Cover → suggested metadata
- Chapter → tags + summary
- Chapter → character list
- Chapter → back-blurb draft

Rate limits, per calendar month, rolling reset on the 1st:

| Tier      | Calls/month | Approx Folio cost      |
|-----------|-------------|------------------------|
| Free      | 10          | ~$0.05                 |
| Indie     | 100         | ~$0.50                 |
| Imprint   | 500         | ~$2.50                 |
| Perpetual | 2,000 fair-use | ~$10.00              |

(Cost assumes GPT-4o-mini at ~$0.005/call blended. Adjust when
we lock the model choice.)

Enforcement: paywall Worker maintains a per-uid monthly counter in
KV or Firestore (`folio_user_settings/<uid>.smartScanMonth = "2026-08"`
+ `smartScanCount = N`). Hitting the cap returns HTTP 429 with a
JSON body:
```json
{
  "ok": false,
  "reason": "quota-exceeded",
  "used": 100,
  "limit": 100,
  "resetsAt": 1725148800000,
  "upgradeUrl": "/press/"
}
```

Client shows a friendly "you've used all 10 free scans this month —
upgrade to Indie for 100/mo, or paste your own API key below."

### Lane C — BYOK (power-user escape hatch)

For authors who already have their own OpenAI/Anthropic key and want
unlimited scans without upgrading tiers.

- User pastes key in `Settings → AI Integration → API Key`.
- Key stored in `folio_user_settings/<uid>.byokProvider = "anthropic"`
  and `byokKey = "sk-ant-..."` (**encrypted at rest** — see security
  section below).
- Client-side code, on Smart Scan invocation, checks: if BYOK set,
  call the provider directly from the browser using the user's key.
  If not, hit `/smart-scan` on Folio's Worker.
- No rate limit on BYOK path; user pays their provider directly.
- Zero cost to Folio.

Trade-off surfaced clearly in the UI: "BYOK bypasses your Folio
allowance. We never see your key or your prompt."

---

## Security considerations

### For Lane B (Folio-hosted)

- Folio's central API key lives on the Worker as a `wrangler secret
  put ANTHROPIC_API_KEY`. Never in the client, never in git.
- Requests from the client must be authenticated: pass the user's
  Firebase ID token in the Authorization header; Worker verifies the
  token and looks up the user's tier before deciding rate limit.
- Prompt injection: user-supplied text is passed to the LLM. Structure
  responses via JSON schema (Anthropic tool_use / OpenAI structured
  outputs) so malicious prompts can't derail the response format.
- Content policy: don't process anything Folio's ToS prohibits (see
  the "No porn, real gore, violence, or filth on Folio" rule in
  CLAUDE.md). Return HTTP 400 for content that trips the LLM's own
  safety filters — surfaces as "content couldn't be processed" to
  the user rather than a policy lecture.

### For Lane C (BYOK)

- Keys are user-typed secrets. Storage options:
  - **localStorage only** (never leaves the device). Simplest,
    highest-privacy. Downside: key doesn't roam if the author
    signs in on another device.
  - **Firestore, encrypted with a per-user key derived from their
    Firebase auth token.** More complex but roams. Not doing this
    for v1 — pick localStorage.
- Warn the user: "This key never leaves your browser. Folio does not
  see it. You can delete it any time."
- Never log the key. Never include it in analytics events. Ever.

### For all lanes

- Never surface a user's original prompt or the LLM's response to
  anyone but the user themselves. No admin visibility, no logs
  beyond metric counters.
- Give the user a "clear my Smart Scan history" button in Settings.

---

## Data model additions

**`folio_user_settings/{uid}`** — new fields:
```
{
  smartScanMonth: "YYYY-MM",       // rolling month bucket
  smartScanCount: 42,               // calls used this month
  byokProvider: "anthropic" | "openai" | null,
  // NOTE: byokKey is NOT stored here. Lives in localStorage only
  // in v1. If we ever add roaming, we'd add byokKeyEncrypted here
  // with a proper key-derivation scheme.
}
```

**No Firestore rules change needed** — the doc is already
owner-only-read-write per the existing rules.

---

## UI surfaces

### Entry point — the camera/attach buttons (see task #12)

Added to the import panel of app.html. Two buttons:

- **📷 Take photo** — only shown if `navigator.mediaDevices &&
  navigator.mediaDevices.getUserMedia` is truthy AND the user is
  on a mobile UA (avoid confusing desktop users with a "take
  photo" button that opens their webcam). Uses
  `<input type="file" accept="image/*" capture="environment">`
  which triggers the native back-camera on iOS + Android.

- **📎 Attach photos/PDFs** — `<input type="file" multiple
  accept="image/*,application/pdf">`. Universal.

After a file drops:

### Smart Scan panel — task picker

A modal opens with the attached file(s) and asks: what do you want
to do?

Options (contextual to file type):
- Photo: [OCR to new chapter] [OCR to append to current chapter]
  [Use as cover] [Use as illustration]
- PDF: [Split into chapters] [OCR + split into chapters]
  [Use as cover] [Extract text only]
- Multiple photos: [Concatenate → one chapter] [One per chapter]

### Processing view

Progress bar + streaming preview. OCR is slow (Tesseract runs client-
side, ~5s per page on a mid-range phone). Show "Page 3 of 12" so
authors know it's alive.

### Review + accept

Author reviews the extracted output before it commits to their folio.
Nothing writes to their manuscript until they say Confirm. Standard
"undo last import" available even after confirm.

---

## Rollout phases

**Phase 1 (ship first):** Lane A only. Photo/PDF → OCR/split → text.
No AI API calls. Free for everyone, unlimited. Delivers 70% of the
practical value for 0% of the ongoing cost.

**Phase 2:** Lane B for cover→metadata (single well-scoped LLM task).
Rate-limited per tier. Validates the Worker + rate-limit
infrastructure with the lowest-risk task.

**Phase 3:** Lane B expanded to chapter→tags, chapter→summary,
chapter→characters. Lane C (BYOK) added simultaneously so power
users don't hit the meter.

**Phase 4:** Illustration matching / generation. Higher cost per
call (image models), separate quota, likely Imprint+ only.

Each phase is independently shippable. Phase 1 alone is worth
building even if 2-4 never happen.

---

## Open decisions before Phase 2 build

1. **Which LLM provider?** Anthropic Sonnet is best-in-class for
   editorial tasks; OpenAI GPT-4o-mini is cheapest. Probably start
   with GPT-4o-mini for cost, revisit if quality is a problem.
2. **Where does the rate-limit counter live?** Cloudflare KV
   (fast, cheap, eventual consistency across regions — fine for a
   monthly counter) vs. Firestore (strongly consistent, integrates
   with the existing tier check). Lean KV.
3. **How aggressive is the "you're at 90% of your monthly quota"
   nudge?** Silent below 80%, banner at 80%, hard-stop at 100%
   with upgrade CTA. Prevents surprise 429s.
4. **Do we ever cache scan results?** Same photo scanned twice
   should probably return the cached OCR without burning quota.
   Content-hash keyed cache on the Worker.

---

## Log

- 2026-08-11 — Jacob asked for BYOK-for-free + Folio-hosted for
  paid. Claude proposed hybrid on-device + Folio-hosted + BYOK
  because pure BYOK has too much UX friction for the target
  author. Waiting on Jacob to endorse the hybrid model.
