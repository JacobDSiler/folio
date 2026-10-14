# Video 2 — "Publish a public-domain book" (Gutenberg → Folio)

**Target length:** 3:45 (matches tutorials page).
**Tier:** 1 — IMPORT.
**Audience:** A new author who wants a quick, satisfying win — publishing an existing public-domain book under their own imprint. Teaches the whole flow in a safe sandbox (no original writing anxiety).
**Primary purpose:** Second slot on the tutorials page. Also a strong demo asset in its own right — "watch Folio publish Frankenstein from a URL in under four minutes."

---

## Verified flow (pilot-checked on live sites 2026-10-14)

1. Visit `gutenbergcleaner.jacobsiler.com`
2. Enter a Project Gutenberg URL (e.g. `https://www.gutenberg.org/ebooks/84` for *Frankenstein*) — the placeholder shows the format
3. Click **Fetch & Clean** — the cleaner tries Cloudflare Worker, direct fetch, then CORS proxies. Takes 3-6 seconds.
4. Boilerplate stripped; chapters appear in the Chapters panel (Frankenstein splits into ~27 chapters)
5. Click **Open in Folio** (recommended) — ships a structured payload (`folio-import-payload` with title, author, manuscript-as-markdown, source metadata) directly to Folio in a new tab
6. Alternative: export `.txt`, `.rtf`, or `.zip` and import manually into Folio's Write tab
7. In Folio, the new folio is pre-named after the book with chapters already split; author just needs cover + metadata + release

**Confirmed button labels:**
- `Fetch & Clean` (primary green button)
- `Open in Folio` (title: *"Open a brand-new folio named after this book, with chapters already split, ready for cover / intro / audio."*)
- `Download .zip (txt)` / `Export .txt` / `Export .rtf` (secondary exports)

**Confirmed footer promise:** *"All processing in-browser · nothing sent anywhere"* — important trust signal to call out in the voiceover.

---

## Pre-production notes for Radi

- **Book choice:** *Frankenstein* (`gutenberg.org/ebooks/84`) is the recommended demo. It's recognizable, 27 chapters splits beautifully, and Mary Shelley is clearly public domain. Fallback: *Dracula* (`/ebooks/345`), *The Secret Garden* (`/ebooks/17396`).
- **Browser:** Chrome at 1280×720.
- **Cover:** For the demo, a royalty-free painterly image (Unsplash: "lightning" or "gothic castle" gives period-appropriate options). Jacob will provide one.
- **Palette:** matches Video 1 (amber `#c98c2a`, deep green `#065f46`, cream `#f6f4ee`).
- **Account:** same comped Imprint account as Video 1.

---

## Voiceover script (3:45 at ~145wpm)

> *(0:00)* Here's a wild one. You can publish a classic novel — one that's been out of copyright for a century — on Folio tonight, under your own imprint, in about three minutes. Here's how.
>
> *(0:18)* Visit `gutenbergcleaner.jacobsiler.com`. This is a free companion tool that strips the Project Gutenberg header and footer boilerplate from any book they publish, then splits what's left into clean chapters.
>
> *(0:38)* Paste a Project Gutenberg URL. Let's use *Frankenstein* by Mary Shelley. Hit **Fetch & Clean**.
>
> *(0:52)* A few seconds, and here we go. Twenty-seven chapters, cleanly split. All processing happens in your browser — nothing is uploaded anywhere.
>
> *(1:10)* Now the magic bit. Click **Open in Folio**. The cleaner ships the title, author, and chapter structure straight across to Folio. A new folio opens, pre-named *Frankenstein by Mary Shelley*, with all 27 chapters already in place.
>
> *(1:35)* Over in Folio, switch to the **Design** tab. Pick a theme, choose an accent colour — maybe a deep forest green for Shelley — and upload a cover. There are gorgeous royalty-free images on Unsplash if you need one.
>
> *(2:05)* Head to **🔖 Release**. Set the access to **Public & free**, or if you want to charge a dollar, pick **Paid**. Add your own short editor's note as the description. Tick **List on the Folio Shelf** so readers can find it.
>
> *(2:35)* Content rating — probably teen or above for Frankenstein. And the attestation: for a public-domain work you're confirming it's genuinely out of copyright, not just old. Project Gutenberg's trademark has been stripped out by the cleaner, so you're clear to republish.
>
> *(3:05)* Click Release. Your edition of Frankenstein is live, at your URL, under your imprint. If you sell it, the money comes to you. Folio takes nothing.
>
> *(3:28)* That's your first published book. Later, do the same with your own writing. **onfolio.press — free, forever.**

---

## Shots (5 of them)

### Shot 1 — Opening hook (0:00–0:18)
**Screen:** Hero shot of the Folio homepage, then quick cut to the Gutenberg Cleaner landing.
**Callout:** At 0:08, bottom-third banner: *"Classics are public domain. You can publish them."*

### Shot 2 — Gutenberg Cleaner setup (0:18–1:10)
**Screen:** The Cleaner page. Cursor clicks into the URL field; types `https://www.gutenberg.org/ebooks/84`; cursor moves to the green **Fetch & Clean** button and clicks. Spinner appears briefly. Chapters panel populates (27 numbered chapters). Scroll a little to show the chapter list.
**Callouts:**
- At 0:48, highlight the Fetch & Clean button: *"One click — fetches the book + strips boilerplate."*
- At 1:00, highlight the "All processing in-browser" footer line: *"Nothing is uploaded. Your copy is yours."*

### Shot 3 — Open in Folio handoff (1:10–1:35)
**Screen:** Scroll to the **Open in Folio** button. Hover briefly to show the tooltip ("Open a brand-new folio named after this book, with chapters already split, ready for cover / intro / audio."). Click. New tab opens; Folio's editor loads with the title **Frankenstein**, author **Mary Shelley**, and the chapter list in the sidebar already populated.
**Callouts:**
- At 1:14, highlight the Open in Folio button: *"Hands off title, author, chapters, and public-domain metadata."*
- At 1:28, highlight the Folio chapter list: *"27 chapters already split."*

### Shot 4 — Cover + Design (1:35–2:05)
**Screen:** Click **Design** tab. Pick a dark/gothic theme. Click a deep-green accent swatch. Upload cover (`frankenstein-cover.jpg`). Preview updates live on the right.
**Callouts:**
- At 1:45, label the theme picker: *"Interior styles — pick one that fits the book."*
- At 1:58, label the cover upload area: *"PNG or JPG, up to 2000×3000."*

### Shot 5 — Release + close (2:05–3:45)
**Screen:** Click toolbar **🔖 Release**. Modal opens. Fields: Title/Author pre-filled. **Access** — click Paid, enter $0.99, then switch back to Public & free (showing both work). Description — type one line. Scroll to **List on the Folio Shelf** → tick. Pick content rating (Teen). Scroll to attestation; tick. Click Release. Share link appears; copy; open in new tab; reader view loads showing the cover and the opening of Frankenstein.
**Callouts:**
- At 2:12, highlight the Access row: *"Free, paid, or private — your call per book."*
- At 2:48, label the attestation for public-domain context: *"For public-domain works: you're confirming genuine public domain status, not just old."*
- At 3:25, bottom-centre overlay: **onfolio.press · gutenbergcleaner.jacobsiler.com**

---

## End-card (5 seconds)

Cream background. Side-by-side: Folio wordmark + Gutenberg Cleaner wordmark. Below: *Two free tools. One pipeline from URL to published book.*

---

## Notes on messaging / what to be careful about

**The attestation copy** on the release modal says the author is confirming the work "is my own original creation, or that I hold all necessary rights and permissions to publish it, and that it does not infringe any third party's copyright." Public domain works satisfy the "necessary rights" clause because the public domain is permission by default. Radi's voiceover handles this correctly at the 2:35 beat; it's worth being clear.

**Don't claim** that any book on Gutenberg is public domain — Project Gutenberg hosts works that are public domain *in the US* under US law, and dates vary. For the demo, Frankenstein (1818) is unambiguous. If Radi substitutes a book, pick something pre-1900.

**Trademark note** — Project Gutenberg's name is a registered trademark they ask you not to use. The Gutenberg Cleaner strips this; the voiceover doesn't claim association with Project Gutenberg.
