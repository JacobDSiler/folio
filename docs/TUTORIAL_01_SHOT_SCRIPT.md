# Series 01 — First folio in five minutes
## Shot script for folioscript1full.wav

**Voice track:** `folioscript1full.wav`  |  **Total length:** 3:35.46
**Workflow:** Jacob screen-records Folio while I pilot Chrome. Audio dubbed
in post — clip speed-ramps in the video editor absorb any drift.

The `[audio]` column is the actual spoken timestamps from the delivered
take (transcribed by whisper). The `[action]` column is what needs to be
on screen during that segment. Each row is one continuous beat.

---

| # | Audio span | Voiceover (delivered) | On-screen action |
|---|---|---|---|
| 1 | **0:00 - 0:07** | "This is Folio. If you have a manuscript, I'll show you how to get it published and readable at a link" | Landing page (`onfolio.press`), no interaction. Cursor rests. |
| 2 | **0:07 - 0:16** | "at a link in about 4 minutes. Ready? Navigate to onfolio.press. Click Sign in with Google in the top right. Pick the test account." | Cursor moves to **Sign in with Google** (top right), clicks. Google account chooser appears; pick the test account. Editor loads. |
| 3 | **0:16 - 0:35** | "Land in the editor. Everything about your book lives on this page. On the left is where you build it. On the right, you see it as your readers will see it." | Editor is loaded. Slow cursor sweep across the LEFT panel (chapter list / import area), then a slow sweep across the RIGHT panel (paginated preview). |
| 4 | **0:35 - 0:53** | "Click Manuscript tab. Point at the Import panel. Drop your Word doc here. Drag the .docx onto the drop zone. It uploads." | Click **Manuscript** tab. Cursor hovers Import panel. Drag `alice.docx` (or equiv) from desktop → drop zone. Progress bar → chapters populate. |
| 5 | **0:53 - 1:12** | "Chapter Detection dropdown says Auto. Chapter list populates. Folio found my three chapters. If it got it wrong, I could pick a different detection mode or use Split view to mark them by eye." | Cursor points at Chapter Detection dropdown (open + close briefly to show options). Cursor traces down the chapter list (should show three). |
| 6 | **1:12 - 1:27** | "But this looks right, so I'll accept it. Book tab. Point at Trade 6x9 in the dropdown. Default is a standard trade paperback size. Change it if you want a different feel. Digest is a bit smaller, A4 or Letter for a manual." | Click **Book** tab. Cursor hovers page-size dropdown. Open it, hover **Trade 6x9**, then **Digest**, then **A4**, then close (leave on Trade 6x9). |
| 7 | **1:27 - 1:46** | "Once a size is selected, it's time to check out some fonts. Cycle through 2-3 body fonts. Then choose the font that sets the right mood for your manuscript." | Cursor moves to body-font dropdown. Cycle: **Garamond → Georgia → Baskerville**. Preview updates each time. Land on Garamond. |
| 8 | **1:46 - 2:03** | "Once you've chosen your font, you can add a book title and author name if these are not already included in your document's front matter. To do this, look for the Folio tab, which looks like a cloud icon." | Type in **Book title** field: "Alice's Adventures". Type in **Author** field: "Lewis Carroll". Cursor moves to hover the **Folio** (cloud icon) tab but does NOT click yet. |
| 9 | **2:03 - 2:24** | "Click the Folio tab. Point at the Folio name field. Type any name. Then click Save. In order to get your Folio published, click the Release/Manage tab. Modal opens. Toggle Publish." | Click **Folio** (cloud) tab. Type in folio-name field: "alice-first-folio". Click **Save**. Wait for save toast (~1s). Click **Release / Manage** button. Modal opens. Cursor moves to **Publish** toggle and clicks it on. |
| 10 | **2:24 - 2:44** | "Toggle List on Shelf. If you leave this off, it will keep your Folio private-link only. Once you've made your preferred selection, click Publish. Toast confirms your Folio is ready to go. Modal shows the reader URL." | Toggle **List on Shelf** on. Cursor rests briefly on the label. Click **Publish** button. Toast appears. Modal now shows the reader URL prominently. |
| 11 | **2:44 - 3:04** | "Copy your custom URL. Open your Folio in a new tab. Here's where you see what your readers will see. Scroll a page or two. This will show the paginated reader, header, footer, and page number." | Click the **copy URL** button. Cursor opens a **new tab** and pastes the URL (Ctrl+L, Ctrl+V, Enter). Reader loads. Wait 1 sec. Scroll down slowly ~2 pages. Cursor points at running header, then footer, then page number. |
| 12 | **3:04 - 3:25** | "Back in the editor, click the Metrics tab. Any views, subscribers, or reviews will appear here. Refresh to update the numbers." | Switch tab back to the editor. Click **📊 Metrics** tab. Cursor hovers each tile: Views → Subscribers → Reviews. Click the refresh icon. Numbers pulse. |
| 13 | **3:25 - 3:35** | "That's it. You have a folio, it's published, it's live at a link, and you know how to check on it. If you want to charge for it, add audio, or run a serial release, watch the next tutorials in this series." | Static wide view of the editor with published-state chrome visible (green Published badge, folio name in title). Cursor rests. |

---

## Notes on delivery vs. original script

The take runs **3:35.46**, ~5 seconds long of the 3:30 plan. Only three
noticeable drifts vs. the written script:

- Beat 7 (fonts) — VO added a lead-in phrase ("Once a size is selected,
  it's time to check out some fonts"). Absorbable with a slight
  slow-ramp on the size-dropdown close.
- Beat 8 (title/author) — VO expanded ("Once you've chosen your font,
  you can add a book title and author name if these are not already
  included in your document's front matter"). Give the typing a
  full 4-5 seconds instead of rushing.
- Beat 13 (outro) — VO delivered slightly slower than planned. Only
  ~10 seconds of on-screen action needed here; a static wide shot
  works better than trying to fill with motion.

## Pilot notes

- I'll drive Chrome for the whole take, silent. Jacob starts OBS and
  triggers me to begin; I do the full walkthrough at a steady pace.
- Take is ~3:30-4:00 for me to execute (my clicks/typing are slower
  than a fast human, closer to what a first-time user looks like — a
  feature for a tutorial).
- Any single beat can be retaken and stitched — my actions are
  deterministic, so I can rerun a specific beat and Jacob cuts it in.
- The video editor will speed-ramp / slow-ramp segments to match the
  audio timestamps above. Absolute cursor speed doesn't need to be
  perfect.

## Pre-flight checklist for Jacob

- [ ] Test Google account signed OUT (so sign-in flow is honest).
- [ ] `alice.docx` on desktop with 3 chapters styled as Heading 1.
- [ ] OBS scene: browser window fills ~90% of screen. Bookmarks
      bar hidden. Cursor highlight filter ON.
- [ ] Screen resolution set to 1920x1080. Chrome window sized to fit.
- [ ] Chrome extension (Claude in Chrome) connected — check the tray.
- [ ] Delete any prior test folios so the editor loads clean.
- [ ] Start OBS recording, then tell me "go" — I'll drive from there.
