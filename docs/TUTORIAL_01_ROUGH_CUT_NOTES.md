# Series 01 — rough-cut notes
## File: folio-tutorial-01-rough-cut.mp4

**Duration:** 3:36.04  |  **Resolution:** 1920x1080 @ 30fps  |  **12 MB**

This is a first-pass scaffold, not a finished cut. The video and audio
are the correct length; timings on the segment boundaries are educated
guesses that you'll want to nudge in your video editor.

## What's in the cut

| Time | Duration | Contents | Speed |
|---|---|---|---|
| 0:00 - 0:16 | 16s | Dark title card: "This is Folio / Your book, published in four minutes" | still |
| 0:16 - 0:52 | 36s | **Clip 1** — file-drop, chapter detection, split-into-chapters | 5.87x |
| 0:52 - 3:04 | 132s | **Clip 2** — design tab, page-size dropdown, font cycle, title/author typing, ship-tab save, release modal, publish toggles, metrics tab | 5.87x |
| 3:04 - 3:36 | 32s | **Clip 3** — beat 11 reader-tab attempt (blank) | 1x |

## The known sync issues

**Beat 11 is in the wrong slot.** Audio at 2:44-3:04 talks about
copying the URL + opening the reader; the video there is still inside
clip 2 (probably showing metrics or the outro). Clip 3 (the reader
attempt) is stuck at the very end where audio is doing the outro
instead.

**Fix in your editor:** split clip 2 at whatever moment corresponds
to "click Publish → published toast." Move clip 3 to sit between
those two halves, so:

- Clip 2 first half → beats 5-10 (audio 0:52-2:44)
- Clip 3 → beat 11 (audio 2:44-3:04)
- Clip 2 second half → beats 12-13 (audio 3:04-3:36)

I couldn't do that split blind — I don't know where in clip 2 the
publish moment sits without scrubbing.

## The red-outline problem

Yes — the Chrome extension's "AI is controlling this browser" red
glow is baked into all three source clips. There's no clean way to
remove it in post; it's the whole window border pulsing red.

**Options:**
1. **Re-record the actions manually** now that you have the shot
   script — 15-20 minutes at real speed. The workflow proved the
   sequence works, so the second recording will go faster.
2. **Crop the frame** to hide the outer 40-60px on each side. Loses
   a bit of the browser chrome but removes the glow. Cheap fix if
   you don't want to re-record.
3. **Live with it** — after speed-ramping, the pulse is less
   noticeable and viewers may not spot it. Ship it, gather feedback,
   re-record only if it distracts.

## Recommended next moves

1. Open `folio-tutorial-01-rough-cut.mp4` in DaVinci Resolve /
   Premiere / CapCut.
2. Split clip 2 at the publish moment.
3. Rearrange to fix the beat-11 sync (see above).
4. Decide on the red-glow strategy.
5. If keeping this pilot recording: add cursor-highlight overlay in
   post (there's no cursor emphasis right now).
6. Replace the title card with something in your brand voice — the
   current one is minimal on purpose so you can override without
   fighting my design.

## Rebuild command (if you want to regenerate)

```bash
ffmpeg -y \
  -f lavfi -i "color=c=0x1a1a1a:s=1920x1080:r=30:d=16" \
  -i "2026-08-24 11-26-46.flv" \
  -i "2026-08-24 11-32-53.flv" \
  -i "2026-08-24 11-53-53.flv" \
  -i folioscript1full.wav \
  -filter_complex "[0:v]drawtext=fontfile=$FONT:text='This is Folio':...\
[1:v]scale=1920:1080,fps=30,setpts=PTS/5.87[v1];\
[2:v]scale=1920:1080,fps=30,setpts=PTS/5.87[v2];\
[3:v]scale=1920:1080,fps=30[v3];\
[intro][v1][v2][v3]concat=n=4:v=1:a=0[outv]" \
  -map "[outv]" -map "4:a:0" \
  -c:v libx264 -preset veryfast -crf 22 -c:a aac -b:a 192k \
  -pix_fmt yuv420p -shortest folio-tutorial-01-rough-cut.mp4
```

Adjust the `PTS/N` divisors to change speed. Lower N = slower.
