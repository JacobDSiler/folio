# Folio tutorial content — launch-week strategy

*Written 2026-07-17 in response to Thomas's "hard to find things" feedback + Jacob's launch onboarding gap.*

## The real problem

New authors don't struggle because Folio is bad. They struggle
because Folio is *dense*. Thomas is a smart adult and he still lost
work trying to figure out how to create a new folio. That's a
navigation problem, not a capability problem.

Two-track strategy:

- **Track A** — Short video tutorials that meet users where they are (YouTube, embedded in `/help/`).
- **Track B** — In-product signals that reduce the *need* for tutorials in the first place.

Both matter. Track A is what you record. Track B is what I ship
alongside.

---

## Track A — video tutorials

### The overall rules

1. **Under 3 minutes each.** Anything longer is a training course, not a tutorial. YouTube retention data is brutal for 5-minute videos and worse beyond.
2. **One task per video.** "Create a new folio" is a video. "How Folio works" is not — it's a course.
3. **Real content, not lorem ipsum.** Use one of your own folios (Sky Bridge Saga is perfect — you'll be linking to it from your marketing anyway).
4. **Captions on every video.** ~70% of YouTube is watched on mute. Captions also make the content indexable and accessible.
5. **Screen recording first, talking-head optional.** Show, don't tell. A voiceover over a screen recording is the fastest to produce and the most useful.

### The starter set (five videos)

Record in this order — each unblocks the next.

| # | Title | Length | Task shown |
|---|---|---|---|
| 1 | **Your first folio in 90 seconds** | 90s | Land on `/app.html`, sign in with Google, type a title, paste some manuscript, hit Save. |
| 2 | **Publishing to the Folio Shelf** | 2:30 | Open a saved folio, hit Release, choose free/paid, set cover, tick List on Shelf, submit for review. |
| 3 | **Serial release: publishing one chapter at a time** | 2:00 | Turn on Serial in the release modal, pick a cadence, show the auto-unlock behaviour. |
| 4 | **Making your Imprint yours** | 2:00 | Open Customize Imprint, pick accent + background, add bio/photo/links, save. Show the resulting `/imprint/?uid=...` page. |
| 5 | **Sharing a teaser chapter** | 90s | Open a paid folio, copy the Share Link on chapter 3, paste into a browser, show unlock. Wrap with "one signed link per reader, revocable any time." |

Later, deeper videos:
- Product photos + templates (5 min — Adobe Stock license, generate photos, export).
- Audio: making an audiobook from a folio (3 min).
- The Manuscript tab (2 min — import, chapter types, drag reorder).
- Paid folio setup with PayPal (2 min).
- Comping a founding contributor / manual role grant (admin, 90s).

### Tooling — pick one from each row

**Screen recorder:**
- **OBS Studio** — free, powerful, steeper learning curve. Best long-term investment.
- **ScreenPal** (formerly Screencast-O-Matic) — free tier, dead simple, captions built in. Best short-term.
- **Loom** — dead simplest but hosted (they can rate-limit / paywall you unpredictably).
- **QuickTime Screen Recording** (macOS) or **Xbox Game Bar** (Windows) — free, no install.

*Recommendation for launch week: **ScreenPal**. Captions are the killer feature. Upgrade to OBS later.*

**Voiceover (eating your own dogfood angle 🎤):**
- **Folio's own TTS** — the Google + ElevenLabs pipeline you already built. Use one of the neural voices, write the script in a scratch folio, "export chapter as MP3", drop that audio track into the video editor. This is a great story to tell publicly: *"I made the tutorials with Folio itself."*
- **Your own voice** — always higher trust than TTS if you're OK on camera / mic. Record with a decent USB mic (Blue Yeti, ATR2100x-USB, both ~$100).
- **AI voiceover services** — ElevenLabs directly (not through Folio), Play.ht, Murf. Broadly interchangeable; ElevenLabs has the most natural voices right now.

*Recommendation: **use Folio's own TTS for videos 1-3**, then decide. It's cheap, fast, and it's a great marketing hook. Videos where you appear on camera (interviews, "why I built Folio") stay in your own voice.*

**Editor:**
- **DaVinci Resolve** — free, professional, overkill for tutorials but easy to grow into.
- **iMovie** (macOS) — free, simple, good enough.
- **Shotcut** — free, cross-platform, ugly but capable.
- **CapCut** — free, laptop + phone, YouTube-Shorts-friendly.

*Recommendation: **CapCut** for the tutorial series. Fast enough to record → publish in an hour per video.*

**Storage / distribution:**
- Host on **YouTube** (public unlisted for private drafts, then flip to public when ready). Free, indexed, ubiquitous.
- Embed on your `/help/` page below the relevant FAQ item.
- Link from the launch email you're drafting.

### The script pattern that works

For every tutorial script, follow this shape:

1. **Hook (5-10 seconds):** "In this 90 seconds you'll create your first folio."
2. **Show the outcome first:** flash to the finished result. "Here's where we're going."
3. **Walk through the steps** — every click narrated. Every keystroke visible. Zoom in on tiny UI targets.
4. **One 'gotcha' callout:** the specific mistake people make. ("Don't click Publish until you've saved — otherwise you'll get an empty release.")
5. **Next step:** "Want to put your folio on the Shelf? Watch [video 2]." Always chain forward.

Total word count per minute of video: ~150 words. So a 90-second video is ~225 words of script. Write it in a scratch folio, run TTS, done.

---

## Track B — In-product signals that ship this week

These reduce the tutorial dependence *now*, not next week when the videos are up. Fast to implement.

### B1. First-run tour banner

When a user opens `/app.html` for the first time (localStorage check for a `folio_first_run_dismissed` flag), show a small banner at the top:

> 👋 New to Folio? **Watch the 90-second intro** or **skip and figure it out**.

The first CTA opens the tutorial video in a modal. The second dismisses the banner forever for this browser. Zero friction, high signal.

### B2. Empty-state tips inside the sidebar tabs

- **Chapter list is empty:** "No chapters yet. Import a Word doc, paste manuscript, or add a blank chapter to get started." (Already in place.)
- **Book tab has no title:** Add "Give your book a title so it appears on the Shelf" as a placeholder hint.
- **Folio tab is signed out:** Green Continue-with-Google button is already prominent — add a one-line tooltip: "Your work saves permanently to your Google account."

### B3. "What's this?" chips on cluttered UI

Small `?` badges next to genuinely confusing labels (Pre/TOC/Ch/Post, previewSections, teaser). Click opens a small popover with the plain-language explanation and a link to the relevant `/help/` FAQ item.

*Already partially in place via the tooltip pass I did in this session — the chapter type badges now show descriptive hovers.*

### B4. `/help/` gets video embeds

For each of the five starter tutorials, add the YouTube embed as an accordion item on `/help/` under the matching FAQ:
- "How do I create a new folio?" → embed video 1
- "How do I publish to the Shelf?" → embed video 2
- ...etc.

Users who prefer reading get the existing text. Users who prefer watching get the video. Same page, no gate.

---

## Launch week distribution plan

Day-by-day:

**Day 0 (today):**
- Record videos 1 and 2 (create + publish). Under 2 hours total including edits.
- Upload as unlisted on YouTube.
- Send yourself the links.

**Day 1:**
- Watch your own videos as a fresh user. Note what's still confusing.
- Fix the most obvious 2-3 UI issues surfaced.
- Flip both videos to public.
- Add embeds to `/help/`.
- Add the first-run tour banner to `/app.html`.

**Day 2-3:**
- Record videos 3 (serial), 4 (imprint), 5 (teaser).
- Draft the launch email around the videos: "here's Folio in 5 videos, total 8 minutes."
- Send launch email to the mailing list.

**Day 5+:**
- Watch YouTube retention data. If people drop off at a specific second, that's a UX issue — fix the product, don't just re-record.

---

## The "eating your own dogfood" story

If you make even ONE of the tutorial voiceovers with Folio's own TTS,
you have a fantastic marketing angle:

> "These tutorials were narrated by Folio's own audiobook engine.
> Every author on Folio gets the same tool."

Tweet it. Post it on IndieAuthor Facebook groups. Reference it in the
next Folio Press page revision. The demo *is* the product.

---

## What NOT to do

- Don't record a single 15-minute walkthrough. Users won't watch.
- Don't polish scripts endlessly. Ship rough. Iterate.
- Don't skip captions. That will haunt you.
- Don't paywall tutorials. They're the top of your funnel; keep them free forever.
- Don't hide `/help/` in a footer. Link from the app sidebar (already done) AND the welcome page (already done).
