# Folio tutorial-pilot

Deterministic Playwright-based pilot for Folio tutorial videos.

Produces precisely-timed screen recordings with a branded visible
cursor and click-ring animations — no OBS babysitting, no cursor-
highlight overlays in post, no tool-call latency drift.

Each video is a declarative action script. Re-runs are identical.

---

## One-time setup

**Prerequisite:** Install Google Chrome Stable from
[google.com/chrome](https://www.google.com/chrome/) if you don't
already have it. The pilot uses your real installed Chrome (not
Playwright's "Chrome for Testing" build) because Google's OAuth
sign-in refuses CfT.

```bash
cd C:\dev\folio\tools\tutorial-pilot
npm install

# Sign into Folio once with the account you want to use for the
# tutorials. This opens your real Chrome, you sign in with Google,
# press Enter in the terminal — the profile is saved to
# ./chrome-profile/ and every subsequent pilot run loads with the
# account already signed in.
npm run auth
```

You do NOT need `npm run install-chromium` with this setup — we use
your installed Chrome Stable instead.

## Record a tutorial

```bash
npm run run:01-hero
# or:
node run.js 01-hero
```

Chromium opens at 1280×720. The pilot executes the video's action
script. When it finishes, Chromium closes and two files land in
`./output/`:

- `<random-id>.webm` — the recorded tutorial (1280×720, 30fps)
- `01-hero.events.json` — timestamped log of every click, move,
  scroll, pause, and marker

Give the `.webm` + the matching `.srt` subtitle to Allyson. She
records VO against the subtitled video. Composite = her audio +
the webm.

---

## What the branded cursor looks like

- **Cursor**: 22px amber circle with soft fill (`#c98c2a` brand)
- **Click ring**: pulses out from each click location in deep
  green (`#065f46`), ~0.65s animation
- Visible on every page — injected before site JS loads so even
  modals and iframes get the overlay
- OS cursor is hidden to avoid double-rendering

If a specific tutorial needs a different cursor colour, override
`BRAND` in `pilot.js`.

---

## Adding a new video

1. Create `videos/02-gutenberg.js` (etc.)
2. Export a default async function `(pilot) => { ... }`
3. Use the pilot verbs:

```js
export default async function myVideo(p) {
  await p.markStart();                       // Shortcuts collapse
  await p.pauseFor(26);
  await p.click('#someButton');              // selector OR {x,y}
  await p.moveTo({x: 500, y: 300});
  await p.scroll({x: 115, y: 300}, 500);
  await p.eval('openReleaseModal()');
  await p.key('Escape');
  // End marker is added automatically by run.js
}
```

4. Run with `node run.js 02-gutenberg`.

Each video script is a 50-150 line file. Pacing lives in the
`pauseFor()` calls — nudge any one to re-time a shot.

---

## Pilot verbs (full reference)

| Verb | Purpose |
|---|---|
| `pilot.markStart()` | Collapse the Shortcuts panel — the visible IN point for your editor |
| `pilot.markEnd()` | Expand the Shortcuts panel — the visible OUT point (auto-called by run.js) |
| `pilot.pauseFor(s)` | Idle hold for `s` seconds |
| `pilot.moveTo(target, {durationMs})` | Smooth animated mouse move. Target = selector string OR `{x,y}` |
| `pilot.click(target, {moveMs, settleAfterSec})` | Move cursor then click. Click ring pulses automatically |
| `pilot.scroll(target, dy)` | Move cursor to target, mouse-wheel scroll by `dy` pixels |
| `pilot.key(name)` | Press a keyboard key (e.g. `'Escape'`, `'Enter'`) |
| `pilot.eval(script, label)` | Run page JS directly (useful for complex clicks via function names) |
| `pilot.goto(url, waitAfterSec)` | Navigate; waits for networkidle |

Every verb records a timestamped event to `events.json`.

---

## Why this is better than live tool-call piloting

| Problem with live piloting | How this solves it |
|---|---|
| 1-2 sec latency per action → drift across a 4-min take | Native Playwright — sub-10ms action timing |
| No visible cursor in recordings | Branded cursor shim renders a 22px halo on every page |
| Clicks don't visually pulse | Click-ring animation auto-triggers on every click |
| Reshoots require re-doing everything from the top | Deterministic re-runs. Change one `pauseFor`, hit run again |
| Each take is bespoke, uncomposable work | Scripts are source-controlled. Diff against prior takes |
| Can't record multiple videos in a batch | `for v in 01 02 03; do node run.js $v; done` |

---

## File layout

```
tools/tutorial-pilot/
├── README.md              — you are here
├── package.json           — playwright dep
├── .gitignore             — ignore node_modules, output, auth
├── pilot.js               — framework (Pilot class)
├── auth-setup.js          — one-time Google sign-in
├── run.js                 — CLI runner
├── videos/
│   └── 01-hero.js         — Video 1 action script
├── auth.json              — saved storage state (gitignored)
└── output/
    ├── <id>.webm          — recorded tutorials
    └── *.events.json      — timestamp sidecars
```

---

## Troubleshooting

**"Browser not secure" or "Couldn't sign you in" on the Google OAuth page**
— means Playwright is using Chrome for Testing, which Google blocks.
Install Chrome Stable from google.com/chrome and re-run
`npm run auth`. The pilot calls Chrome via `channel: 'chrome'`.

**"Error: Executable doesn't exist" or Chrome Stable not found**
— install Chrome Stable from google.com/chrome. If you absolutely
can't install it, open `pilot.js` + `auth-setup.js` and remove the
`channel: 'chrome'` line; Playwright will fall back to its managed
Chromium build. Google OAuth may then refuse to sign you in — in
which case use Folio with an anonymous session only (publish will
be blocked but all other recording works).

**Signed-out on run** — Google may have expired the session. Rerun
`npm run auth` to re-sign-in; the profile persists after that.

**Chrome popup "already running"** — close any Chrome windows you
have open on your real profile. The pilot uses its own
`chrome-profile/` directory, but Chrome has a lock-file quirk when
two profiles share the same binary. If this bites you often, you
can switch to Edge: change `channel: 'chrome'` → `channel: 'msedge'`
in both `pilot.js` and `auth-setup.js`.

**Playwright can't find selector `#someId`** — the Folio UI may
have moved the anchor. Open the live site, inspect, update the
selector in the video script. All selectors live in the per-video
`videos/*.js` file; `pilot.js` never hardcodes any Folio-specific
IDs.

**Output .webm is huge or weird fps** — Playwright records at the
viewport's native rate. Convert to a cleaner MP4 for editing:

```bash
ffmpeg -i output/your-video.webm -c:v libx264 -preset slow \
       -crf 20 -pix_fmt yuv420p output/01-hero.mp4
```

---

## Long-term direction

This framework lives in `C:\dev\folio\tools\tutorial-pilot/` right
now because the first batch of tutorials is Folio-specific. The
architecture is deliberately clean so it can be lifted into
Orchestrator later as a cross-project module when you want to pilot
tutorials for Ink, Beam, or future apps too. See `docs/TUTORIAL_PILOT_FUTURE.md`
for the migration plan if that becomes a priority.
