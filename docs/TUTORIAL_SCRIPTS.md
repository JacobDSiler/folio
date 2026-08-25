# Folio tutorial scripts — for OBS recording

**Version:** 2 (rewritten against the current UI, Aug 2026)

A sequenced series, basic to advanced. Each script is short enough to
record in one take, structured so the presenter can talk naturally over
the actions without reading a wall of prose. Send me the raw footage
after and I'll cut, add captions, punch in b-roll, and produce the
finished tutorial.

Recording notes for all of them are at the bottom.

---

## Vocabulary (use these terms consistently across every script)

| Term | Meaning |
|---|---|
| **Write** tab | Manuscript import, chapter list, per-chapter editing, language toggle |
| **Design** tab | Page size, fonts, layout, book details (title/author/subtitle/series/ISBN), cover, ornaments |
| **Produce** tab | Audio generation and import, per-chapter media |
| **Ship** tab | Publishing — expands to two sub-tabs |
| **Ship › Folio** | Folio slug, save, reader link, publish modal, release controls |
| **Ship › Metrics** | Views, subscribers, reviews, annotations |
| **Publish button** | Green button in Ship › Folio that opens the release modal |
| **Release this Folio** | Green button inside the release modal that actually publishes |
| **Detected: N chapters** | Import-panel indicator after a `.docx` is dropped |
| **Split into chapters** | Button that commits the detected split |
| **List on the Folio Shelf** | Checkbox in the release modal for public discovery |
| **Copy link / Preview as reader** | Buttons that appear once the folio has a slug |
| **Folio Shelf** | Public catalogue at `onfolio.press/shelf` |

**Deprecated names** (do not use): Manuscript tab, Book tab, Folio (cloud icon) tab, Metrics (as top-level tab), Release / Manage, "publish toggle" (it's a button now).

---

## Series 01 — Your first Folio, published

**Target duration:** 4:00 – 4:15. **Learning goal:** a first-time user
lands in the editor with a manuscript and finishes with a published
folio at a shareable link.

The full script with per-beat direction, pronunciations, and reader
guidance lives in **`docs/TUTORIAL_01_SCRIPT_V2.md`**. Summary below.

**Setup:**
- Fresh Google test account signed out.
- Word doc on the desktop, 2-3 chapters styled as Heading 1.

**Beats:**

1. *(0:00)* Cold open on `onfolio.press`. "This is Folio. If you have
   a manuscript, I'm going to show you how to publish it in about five
   minutes."
2. *(0:12)* Click **Sign in with Google**, land in the editor.
3. *(0:28)* Wide orientation — four top tabs (**Write / Design /
   Produce / Ship**), left panel builds, right panel previews.
4. *(0:48)* **Write** tab → drag `.docx` onto the drop zone →
   "Detected: N chapters" → click **Split into chapters**.
5. *(1:18)* If detection was wrong: switch **detection mode**
   (Heading 1 / Page break / Manual) or use split view.
6. *(1:38)* **Design** tab → set page size (Trade 6×9 / Digest / A4)
   → cycle body fonts → land on your pick.
7. *(2:10)* Design tab → **Book Details** → type title, author,
   optional subtitle/series/ISBN.
8. *(2:35)* **Ship** tab → **Folio** sub-tab → type slug → Save →
   custom URL appears.
9. *(2:58)* Click green **Publish** button → modal opens → pick
   visibility (Public and free / Paid / Private link) → tick **List
   on the Folio Shelf** → click **Release this Folio**.
10. *(3:30)* Click **Copy link** or **Preview as reader** → reader
    loads → scroll to show pagination, header, page number.
11. *(3:52)* Back in editor → **Ship › Metrics** → hover Views,
    Subscribers, Reviews, Annotations tiles.
12. *(4:08)* Outro: "You've got a folio. It's live, it's shareable,
    it's yours. Next tutorials cover charging, audio, serial release."

**Post-production notes:**
- Cut sign-in flow to under 5 seconds.
- Punch in on the reader URL when it's copied so it's legible.
- Overlay a text card at the Publish modal flagging "0% commission on
  tips and paid releases."

---

## Series 02 — Design a folio that actually looks good

**Target duration:** 7:30 – 8:15. **Learning goal:** an author with an
imported manuscript makes deliberate design choices instead of
accepting defaults.

**Setup:**
- Start with a folio already imported (skip Series 01's import). Real
  in-progress folio if possible so choices land on real content.

**Script:**

1. *(0:00 – 0:30)* "Defaults are fine, but a handful of small choices
   turn a fine folio into one that feels like a book you'd want to
   own. Let me walk you through the ones that matter."
2. *(0:30 – 1:15)* **Design** tab. Page-size dropdown — open, hover
   each option, close on Trade 6×9. "Trade six-by-nine is your safe
   default. Pocket is intimate. Custom if you're doing a chapbook or
   a zine."
3. *(1:15 – 1:55)* Toggle **drop caps** on. Point at the first
   paragraph of chapter 1 in the preview. Let it settle. "One little
   choice, big difference."
4. *(1:55 – 2:50)* Change **body font**. Cycle three options
   deliberately — pause 3-4 seconds on each so the preview repaints.
   Land on your pick. "I read for a living and I still can't tell you
   why one serif reads more comfortably than another. Pick the one
   that feels right on the first page."
5. *(2:50 – 3:35)* Change **line spacing** from 1.5 to 1.7. Show the
   preview reflow. "Loose is easier on the eye. Tight is more
   literary. Split the difference if you're unsure."
6. *(3:35 – 4:20)* **Justification** toggle. Show justified, then
   left-aligned, then justified again. "Justified is book-standard.
   Left-aligned is casual and slightly easier on some readers."
7. *(4:20 – 5:05)* **Cover image** — click upload, pick the file,
   watch it appear in the preview. Let it hold.
8. *(5:05 – 5:55)* Turn on **chapter images**. Scroll the preview to
   show two chapters using different images. "One image per chapter,
   cycles through your uploads. Skip it if you don't have images —
   the book still looks great without."
9. *(5:55 – 6:35)* **Ornament** dropdown. Open it, cycle three
   options, land on one. "Scene breaks use this — pick one that fits
   the tone."
10. *(6:35 – 7:15)* **Running header** mode. Show 'both', then 'title
    only', then back. "Both means author on the left page, book title
    on the right — the classic book layout."
11. *(7:15 – 8:00)* **Book Details** → scroll to **Dedication** →
    type it. Preview scrolls to the dedication page. Let it hold.
12. *(8:00 – 8:15)* Save. Refresh preview. "Now it looks like a book.
    Next up: publishing so readers can actually get to it."

**Post-production:**
- Split-screen before/after comparisons work great here — same page,
  default vs. deliberate.
- Slow the drop-caps toggle down; that's the visual "ah-ha" moment.

---

## Series 03 — Publish, share, and go serial

**Target duration:** 8:00 – 8:45. **Learning goal:** an author knows
the difference between private-link, Folio Shelf, and serial releases,
and picks the right one for their situation.

**Setup:**
- One folio ready to publish. Keep the release modal closed at start.
- On **Ship › Folio**.

**Script:**

1. *(0:00 – 0:30)* "Three ways to publish, three different audiences.
   Let's walk through them so you know which one fits what you're
   making."
2. *(0:30 – 1:30)* Click green **Publish**. Modal opens — let it
   settle a beat. Point at each of the three visibility options in
   turn: **Public and free**, then **Paid**, then **Private link
   only**. "Public and free is exactly what it sounds like. Paid
   we'll cover in the next tutorial. Private link means only people
   you send the URL to can read it — perfect for editors, beta
   readers, or a family-only folio."
3. *(1:30 – 2:15)* Point at **List on the Folio Shelf**. "This adds
   you to Folio's public catalogue. Off means the link works but
   nobody browsing the Shelf will see it. Leave it off while you're
   still tweaking; turn it on when you're ready to be discovered."
4. *(2:15 – 2:55)* Point at **Adult content**. "If your work contains
   adult material, tick this. Adult folios get flagged appropriately
   and aren't shown to logged-out browsers."
5. *(2:55 – 3:30)* Scroll to the **Serial release** section. Toggle
   it on. Let the schedule options animate in.
6. *(3:30 – 4:15)* Show the schedule picker. Hover the day / week /
   fortnight options. "One chapter every day, week, or fortnight —
   you pick. Subscribers get an email when each chapter unlocks."
7. *(4:15 – 4:55)* Set a schedule — three chapters per week starting
   tomorrow. Show it committed.
8. *(4:55 – 5:35)* Point at **Teasers**. Mark chapter 1 as a teaser.
   "These are chapters that stay publicly readable ahead of your
   cadence — great for pulling in new readers from social."
9. *(5:35 – 6:15)* Click **Release this Folio**. Watch the modal
   close and the toast confirm. Let the published-state chrome
   settle (green Published badge appears).
10. *(6:15 – 7:00)* Click **Copy link**, open in incognito. Scroll
    slowly to show what a first-time reader sees — locked chapters
    with unlock dates, teaser-open chapters, subscribe panel.
11. *(7:00 – 7:35)* Back in the editor → **Ship › Folio** → click
    **Manage release**. Turn Serial off. Save. "You can flip serial
    off any time — everything unlocks immediately."
12. *(7:35 – 8:00)* Turn Serial back on. Confirm the Shelf-listing
    state didn't move.
13. *(8:00 – 8:35)* Click your **author avatar** top-right → **View
    imprint**. Point at the **Customize imprint** button. "Your
    author profile lives here — bio, imprint colours, folios on
    display. Free tier gets the basics; Indie unlocks custom
    styling."
14. *(8:35 – 8:45)* "That's publishing. Serial for building
    anticipation, Shelf for discovery, private link for the people
    you choose. Charging for it? Next tutorial."

**Post-production:**
- Insert a "3 paths" diagram at 0:15 that lights up each visibility
  option as it's discussed.
- Cut save/toast confirmations if they run longer than a second.

---

## Series 04 — Getting paid: tips, paid releases, and boosts

**Target duration:** 8:00 – 8:45. **Learning goal:** an author knows
which monetisation option fits which situation, how commission works,
and how to set each one up.

**Setup:**
- Folio published from Series 03. Reopen the publish modal fresh.

**Script:**

1. *(0:00 – 0:35)* "Three ways to make money on Folio: tips, paid
   releases, and Featured Boosts to promote your own folio. Folio
   takes zero commission on the first two. You keep everything."
2. *(0:35 – 1:30)* Open the reader. Scroll to the footer. Show the
   **Tip the author** button. Hover it. "Readers hit this, drop you a
   couple of dollars, done. Free tier has it. No setup on your side
   beyond adding a PayPal or Ko-fi link — money goes straight through
   to you."
3. *(1:30 – 2:15)* Back in the editor → **Ship › Folio** → open the
   release modal → click the **Paid** visibility option. Let the new
   fields appear.
4. *(2:15 – 3:00)* "Paid releases run through Ko-fi or Gumroad — you
   create the product there, paste the license URL here, readers pay
   them, they pay you. Folio just handles the unlock." Point at the
   help link in the modal.
5. *(3:00 – 3:45)* Point at **Free preview chapters**. Set to 3. "The
   first three chapters stay free-to-read. Chapter 4 onward requires
   a purchase. That's how you convert curious browsers into buyers."
6. *(3:45 – 4:45)* Click **Release this Folio**. Wait for the
   published toast. Open reader URL in incognito. Scroll past chapter
   3 slowly. Show the paywall lock. Click it — purchase modal opens.
   Let it hold.
7. *(4:45 – 5:15)* Close incognito. "That's paid releases. Now the
   third thing — Boosts."
8. *(5:15 – 6:00)* Go to the **Folio Shelf** at `onfolio.press/shelf`.
   Scroll to find your folio in the grid. Click its **Boost** button.
9. *(6:00 – 6:50)* Boost checkout modal opens. Show the tier prices —
   hover each one. "Indie subscribers get twenty percent off, Imprint
   gets fifty percent off. If you're going to boost often, the
   subscription pays for itself in a couple of boosts."
10. *(6:50 – 7:20)* Don't complete the purchase — just show the flow.
    Close the modal.
11. *(7:20 – 8:15)* Bonus: the review-for-boost swap. Navigate to
    another author's folio. Show the review composer. "Leave a review
    of another author's folio, you get a free twenty-four-hour boost
    on one of yours. Encourages the community, gets you seen —
    everybody wins."
12. *(8:15 – 8:45)* "That's monetisation. Tips are free money. Paid
    releases are the big win. Boosts are optional discovery. Pick
    what fits your work."

**Post-production:**
- Emphasise the 0% commission line with a text overlay.
- Keep Ko-fi/Gumroad setup detail out of this cut — link to a
  separate help article.

---

## Series 05 — Audio: give your folio a voice

**Target duration:** 6:30 – 7:15. **Learning goal:** an author either
generates TTS or imports their own recording for a chapter, and knows
both flows exist.

**Setup:**
- Folio with 2-3 chapters. Google TTS or ElevenLabs API key handy. A
  short MP3 recording ready for the import demo.

**Script:**

1. *(0:00 – 0:35)* "Every chapter of your folio can have audio. Two
   ways: generate it with text-to-speech, or import your own
   recording. Both live in the same tab, both work the same way for
   your reader."
2. *(0:35 – 1:15)* Click **Produce** tab. Point at the chapter list —
   one row per chapter, each showing a grey circle meaning "no audio
   yet". Scroll through them.
3. *(1:15 – 2:15)* Click **Settings / gear**. Add a Google TTS or
   ElevenLabs API key — paste it, hit save, wait for the green tick.
   "You need your own key — Folio doesn't rent one out. Google is
   roughly four dollars per million characters, so a whole book runs
   you a few dollars. ElevenLabs is pricier but the voices are
   noticeably warmer."
4. *(2:15 – 3:00)* Close settings. Click the **Generate** button on
   chapter 1. Watch the row: grey → yellow (generating) → green
   (ready). Let each state hold long enough to read.
5. *(3:00 – 3:50)* Click **Play** on chapter 1. Let it run for 10-12
   seconds so the listener actually hears the voice. "That's Google's
   WaveNet voice. Great for drafts, accessibility, or if you don't
   want to record yourself."
6. *(3:50 – 4:20)* Scroll to chapter 2. Click the **Import**
   paperclip icon. File picker opens.
7. *(4:20 – 4:55)* Choose the MP3 you prepared. Watch it upload —
   progress bar, then the row turns green.
8. *(4:55 – 5:45)* Click **Play** on chapter 2. Play 10-12 seconds of
   your recording. "That's my voice. Same button, same UI — Folio
   doesn't care where the audio came from."
9. *(5:45 – 6:20)* Open the reader in a new tab. Point at the **Play**
   button in the reader header. Play a chapter. Point at the seek
   bar. Let it play a few seconds before pausing.
10. *(6:20 – 6:50)* "Readers can listen while they read, or listen
    instead of reading. Some readers only ever consume audio — this
    can double your reach if you invest in the recordings."
11. *(6:50 – 7:15)* "Recording tips: quiet room, cheap USB mic beats
    a laptop mic, one chapter per session. If you want, send the raw
    recording and I can normalise and split it into per-chapter
    files — that's covered in the audio-production tutorial."

**Post-production:**
- Include a before/after — chapter with default Google voice vs. a
  warm human recording. Shows the range.
- Include short "recording setup" b-roll if we can find or make one.

---

## Series 06 — Multi-language folios

**Target duration:** 6:30 – 7:15. **Learning goal:** an author
publishes the same folio in two languages and understands the
reader-side language switcher.

**Setup:**
- Folio with 2-3 chapters in one language. A short translation of
  chapter 1 pasted in a scratch doc, ready to demo.

**Script:**

1. *(0:00 – 0:40)* "If you write in more than one language — or you
   have a translator working with you — you can publish both under a
   single folio. Same URL, same imprint page, the reader picks their
   language."
2. *(0:40 – 1:25)* **Write** tab. Point at the **primary language**
   picker in the language bar. Open it, hover a couple of options,
   land on English.
3. *(1:25 – 2:20)* Click **+ Language**. Language picker opens. Pick
   French. Watch the language bar update — a French chip appears next
   to English. "Folio adds a per-chapter language toggle. Everything
   you write from here on gets remembered per language."
4. *(2:20 – 3:10)* Open chapter 1. Point at the language chips at the
   top of the editor pane. Toggle to French. The editor pane fades
   and reloads an empty French copy of chapter 1. Let the empty state
   sit visible for a moment.
5. *(3:10 – 4:15)* Paste the French translation of chapter 1. Give it
   a few seconds to render. Toggle back to English — original text
   reappears, unchanged. Toggle to French once more. "Each language
   is a completely separate copy of the chapter content. Same folio,
   same design, different words."
6. *(4:15 – 4:45)* Save. Publish if not already. Copy the reader URL.
7. *(4:45 – 5:30)* Open in incognito. Point at the **language
   switcher** in the reader header. Toggle French. Watch chapter 1
   render in French. Scroll a paragraph.
8. *(5:30 – 6:00)* Toggle back to English. "Same folio, both
   languages available. Reader's choice, remembered for the session."
9. *(6:00 – 6:40)* Back in the editor. Toggle to French, chapter 2.
   Show it blank. "You don't have to translate everything at once —
   untranslated chapters fall back to the original language for that
   reader. Ship one chapter's translation, keep going in your own
   time."
10. *(6:40 – 7:15)* Navigate to the Folio Shelf. Filter by language.
    "The Shelf tags multi-language folios so browsers can filter by
    the language they read in."

**Post-production:**
- Overlay language codes visibly on the reader as you switch.
- Callout that Folio doesn't auto-translate — you provide the
  translations. AI-translate is on the roadmap.

---

## Series 07 — Grow: imprint page, subscribers, reviews

**Target duration:** 7:30 – 8:15. **Learning goal:** an author knows
how to run a small platform of their own on Folio — reader list,
catalogue, reviews.

**Setup:**
- Author account with at least two published folios so the imprint
  page has content to show.

**Script:**

1. *(0:00 – 0:40)* "Folio isn't just an editor. Once you've published
   something, you have a public author profile — an imprint page —
   plus tools for building a reader list, gathering reviews, and
   getting discovered. Let's walk through them."
2. *(0:40 – 1:20)* Click your avatar in the top right of the editor.
   Menu opens. Click **View imprint**. Imprint page loads in a new
   tab.
3. *(1:20 – 1:55)* Point at the folios grid. Scroll it. "Everything
   you've published shows here. Readers can browse your whole
   catalogue in one place — a small bookshop of your own."
4. *(1:55 – 2:30)* Click **Customize imprint** (owner-only button).
   Modal opens. Let it settle.
5. *(2:30 – 3:45)* Change accent colour — pick something warm. Change
   font. Upload a hero image. Watch the preview update after each.
   Save. "Indie tier unlocks styling. Imprint tier adds a custom
   subdomain and a few other perks."
6. *(3:45 – 4:30)* Back in a folio → **Ship › Folio** → open the
   release modal. Point at **Newsletter subscribers**. "Any reader
   can subscribe to be notified when you publish updates or new
   chapters. On serial releases this becomes an email per chapter."
7. *(4:30 – 5:15)* Open the reader in incognito. Scroll slowly to the
   subscribe panel at the end of the folio. Enter an email. Submit.
   Wait for the confirmation.
8. *(5:15 – 5:45)* Back in the editor → **Ship › Metrics** → point at
   the Subscribers tile. "It went up by one."
9. *(5:45 – 6:20)* In the reader (still incognito), scroll to the
   review section. Point at the rating stars. "Readers who finish
   your work can leave a rating and a written review. Approved
   reviews show on your Shelf listing."
10. *(6:20 – 7:00)* Submit a review as a test reader — click stars,
    write a sentence, hit submit. Show the "thanks — pending
    moderation" state.
11. *(7:00 – 7:30)* Back in the editor as owner. Show the
    notification that a new review is waiting for moderation.
12. *(7:30 – 8:00)* "One more thing: if you leave a review of someone
    else's folio, you get a free twenty-four-hour Featured Boost on
    one of your own. Encourages the community, gets you in front of
    new readers."
13. *(8:00 – 8:15)* "Imprint page, subscribers, reviews, boosts —
    that's how you grow. None of it requires you to leave Folio."

**Post-production:**
- Show the customize modal as split-screen with the imprint page
  live-updating as changes are made.
- Add a small callout when the subscribers count ticks up.

---

## Series 08 — Metrics: what the numbers mean and what to do about them

**Target duration:** 6:30 – 7:15. **Learning goal:** an author reads
their Ship › Metrics tab and knows what an underperforming folio
looks like vs. one that's working, plus what to try.

**Setup:**
- Real folio with a few weeks of live data would be ideal (Jacob's
  own Resonance, or Thomas's Psalms of the Heart with permission).

**Script:**

1. *(0:00 – 0:35)* "Metrics are only useful if you know what to do
   with them. Let me walk through what to look at first, what to
   look at last, and what to try when a number is disappointing."
2. *(0:35 – 1:10)* Open a folio → **Ship** tab → **Metrics** sub-tab.
   Let it fully load — the tiles animate in.
3. *(1:10 – 1:50)* Point at the **Views** tile. Hold. "Total lifetime
   views. Big number, easy dopamine hit, doesn't tell you much on
   its own. You want the trend."
4. *(1:50 – 2:45)* (Indie / Imprint tier) Point at the 30-day
   sparkline. Trace it with the cursor. "A rising line means your
   folio is picking up momentum — usually someone shared it, or you
   posted about it. Flat means discoverable but not being actively
   shared. Dropping usually means yesterday's spike is fading."
5. *(2:45 – 3:45)* Point at the **drop-off chart**. Hover each bar in
   turn. "This is my favourite metric. Each bar is a chapter, the
   height is how many readers opened it. If chapter three is half the
   height of chapter two, you're losing readers at chapter two.
   That's the chapter to reread and sharpen."
6. *(3:45 – 4:35)* Point at **Subscribers**. "Slower to grow than
   views but ten times more valuable. Every subscriber wants to hear
   from you again. Aim for a one-to-two percent subscribe rate — if a
   hundred people read the folio and two subscribed, that's healthy."
7. *(4:35 – 5:25)* Point at **Reviews + average rating**. "Reviews
   are your discoverability engine. A folio with five reviews at a
   four-point-two average converts far better than one with no
   reviews at all — even a three-point-nine with five reviews beats a
   blank slate."
8. *(5:25 – 6:15)* (Imprint tier) Point at **Top countries + Top
   referrers**. "These tell you where to invest marketing. If a third
   of your traffic is from Reddit, spend more time on Reddit. If most
   is from Australia, that's a real audience you should speak to."
9. *(6:15 – 7:15)* "What to do when a number is bad: sparkline flat
   → share the folio somewhere new this week. Drop-off cliff at
   chapter two → rewrite the chapter-one ending. Low reviews → ask
   your five most engaged readers directly. Metrics are boring until
   you use them to change something."

**Post-production:**
- Overlay the "1-2% subscribe rate" and "5-review threshold" as
  small info callouts.
- Cut a version without the Imprint-tier stuff for Free and Indie
  authors — same script, minus the geo/referrer segment.

---

## Recording notes (apply to all tutorials)

- **Resolution + audio:** 1080p or 1440p, 30 fps. Audio at 44.1 kHz
  mono. USB headset or lav mic beats a laptop mic every time.
- **OBS scene setup:** browser window taking 80% of screen, no
  taskbar showing. Hide the bookmarks bar for a clean frame.
- **Cursor:** enable cursor highlighting in OBS so viewers can
  follow the mouse.
- **Talk to a friend, not a camera:** pick one specific person you
  know and imagine you're showing them. Delivery will be warmer.
- **Don't read the script:** use it as scaffolding. Improvise around
  it. Retakes are cheap.
- **One take per section:** if you fluff a line, keep going — I can
  cut around it. Only start over if you lost the thread.
- **Save the raw file** as `folio-tut-NN-YYYYMMDD-vN.mkv` before
  handing it to me. Keep multiple takes if you have them — I'll pick
  the best sentences from each.
- **Room:** soft furnishings, closed door, phone on silent. If
  you've got a wardrobe you can record inside, that's actually the
  ideal home vocal booth.

### If both you and Thomas record

Different voices for different tutorials works well — pick who
records which by fit. Rough thoughts:
- **Thomas:** 01 (First folio), 05 (Audio), 08 (Metrics). Explanatory,
  warm, patient — those are Thomas's strengths.
- **Jacob:** 02 (Design), 03 (Publish/serial), 04 (Getting paid).
  More design-forward and operational — Jacob's built the mental
  model.
- **Either:** 06 (Multi-language), 07 (Grow). Whoever wants it.

A consistent set of intros and outros across recordings ("Hi, I'm
___, welcome to Folio") gives the series a shared feel even with
different presenters.

### Timeline suggestion

- Record 01 first — the polished script is in
  `docs/TUTORIAL_01_SCRIPT_V2.md`. Ship it as its own thing. See how
  the performance lands before recording the whole series — you may
  want to adjust pacing, length, or tone based on real feedback.
- Then batch-record 02-04 in one session, 05-08 in another.
- Publish weekly to build an audience around the series.

### Why the pacing budgets grew (v2 vs. v1)

The v1 scripts targeted 3:30-5:00 and referenced old tab names
(Manuscript / Book / Folio cloud icon / Metrics as top-level). The
paid VA on Series 01 got squeezed by the tight budget and the take
overshot. v2 rewrites against the current UI (Write / Design /
Produce / Ship with Ship › Folio and Ship › Metrics sub-tabs) and
gives every beat a real time range — most beats are 30-60 seconds
now, up from the 15-25-second cramp of v1. Totals landed at:

| Series | v1 target | v2 target | Reason |
|---|---|---|---|
| 01 | 3:30 | 4:00 – 4:15 | Kept lean — it's the shortest teaser |
| 02 | 5:00 | 7:30 – 8:15 | Font/style cycles need visual breathing room |
| 03 | 5:00 | 8:00 – 8:45 | Modal + serial schedule is a lot to explain |
| 04 | 5:00 | 8:00 – 8:45 | Three monetisation flows, each needs its own beat |
| 05 | 4:30 | 6:30 – 7:15 | Audio playback needs 10-12s of actual listening |
| 06 | 4:30 | 6:30 – 7:15 | Language switching needs the switch to be seen |
| 07 | 5:30 | 7:30 – 8:15 | Customize modal + subscribe + review flows |
| 08 | 4:30 | 6:30 – 7:15 | Each metric tile needs a real pointing-and-explaining beat |

Every beat now uses a `(start – end)` range rather than a single
timestamp, so the VA can see exactly how long they have and the
video editor can see exactly where to cut. Visuals speed-ramp or
slow-ramp in post to match the take — never the other way around.
