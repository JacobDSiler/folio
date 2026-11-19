# Video 1 — today's run order

Six per-shot takes → one stitched MP4 → hand to Allyson.

## Prerequisites (one-time, you've already done these)

- `npm install` + `npm run auth` ran, chrome-profile exists
- ffmpeg installed (`winget install Gyan.FFmpeg`), new PowerShell opened
- Your demo folio with real text + author name is the active folio in your account

## Today's run order

### 1. Record each shot — one at a time

```powershell
cd C:\dev\folio\tools\tutorial-pilot

npm run run:01a   # cold open — ~25s, no interaction
# review the webm in output/
# if it looks bad: just re-run — overwrites the events.json;
# the newest webm wins

npm run run:01b   # sign in hover — ~40s, no interaction

npm run run:01c   # IMPORT — this one asks you to drag a .docx,
                  # click Split into chapters, wait for render,
                  # then press ENTER in the terminal
                  # (have your sample .docx handy)

npm run run:01d   # Design tab + theme — ~40s, no interaction

npm run run:01e   # RELEASE modal — ~75s, publishes for real
                  # (goes to shelf review; never actually visible)

npm run run:01f   # Reader view + dark mode — ~40s, no interaction
```

**Between takes:** peek at `output/<id>.webm` to confirm the shot
looks right. If not, just re-run the same command — the newest
events + webm win in the stitch step.

### 2. Stitch

```powershell
npm run stitch:01
```

Scans the 6 events files, finds the matching webms, stitches in
order, burns in `VO/AI/script-00.srt`, outputs
`output/01-hero-stitched.mp4`.

### 3. Send to Allyson

Attach `01-hero-stitched.mp4` + a line of context:

> Here's the finished pilot visual for Video 1 — the subtitles on
> screen are the words I'd love you to read. Record your VO against
> this with your mic, at whatever pace feels natural. If you want to
> pause between any two sentences for breath, go ahead — I'll
> stretch the picture to match in post. Thanks love xx

She records a .wav/.mp3 against the video, sends back, and you drop
her audio onto the mp4 in CapCut as the single audio track.

## If something breaks

- **Shot's visually off** — re-run just that shot: `npm run run:01d`
- **Modal didn't open on 01e** — Folio may have a stale banner;
  manually dismiss banners first, then re-run
- **Stitch fails on "no videoFile"** — one of the shots didn't finish;
  re-run that shot
- **Burned subtitles unreadable** — SRT uses white text with no shadow;
  if your preview is light cream, add `-vf force_style='Shadow=1'` to
  the subtitles filter in stitch.js (one-line edit)

## Rough timings

- Shot recording: 10-20 min total (plus any retakes)
- Stitching: 1-2 min
- Allyson's turnaround: however long she needs
- Final composite (dropping her audio onto the MP4): 5 min in CapCut

Realistic ETA to a shippable Video 1: **~1 hour today**, plus whatever
Allyson's turnaround is on her side.
