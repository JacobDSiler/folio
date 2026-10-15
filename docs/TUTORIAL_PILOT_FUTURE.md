# Tutorial pilot — long-term direction

**Short answer to "Option A or Orchestrator mode?":** Ship Option A
now (it's done — `tools/tutorial-pilot/`), use it for Folio's 10
tutorial videos over the next few weeks, then graduate it into
Orchestrator **when a second project needs tutorials**. Not before.

---

## Why ship Option A first

The framework at `tools/tutorial-pilot/` is 100% ready to produce
Videos 1-10 for Folio. The time to go from "ship Option A" to "Video
1 in the editor" is one `npm install` plus one `npm run auth` away
— minutes, not days.

Orchestrator-as-the-home for this would take 2-3 days of integration
work. During those 2-3 days you'd ship zero tutorials. That's bad
economics for a 10-video project where video #1 is the one that
actually drives signups.

## Why Option A graduates cleanly later

The framework is deliberately clean:

- `pilot.js` has **zero Folio-specific logic**. Every Folio ID or
  URL lives in `videos/*.js` scripts. The framework itself knows
  about: browsers, cursors, click rings, mouse movement, keyboards,
  JS evaluation, event logging. Nothing more.
- Per-video scripts are small (~100-150 lines) and declarative.
- Auth is isolated in a single `auth.json`.
- Output format (`.webm` + `.events.json`) is portable.

To lift into Orchestrator later, the migration is:

1. Move `tools/tutorial-pilot/` → `C:\dev\orchestrator\modes\tutorial-pilot/`
2. Add Orchestrator-level config so each project (`folio`, `ink`,
   `beam`) has its own `auth.json`, brand palette, and video index
3. Expose as an Orchestrator skill: `orchestrator tutorial run folio 01-hero`
4. Optional additions once lifted:
   - ElevenLabs API wrapper (generate VO + SRT per video, no manual
     paste)
   - ffmpeg subtitle burn-in step (produce finished MP4 with subs
     already baked)
   - Per-project brand palettes (cursor + ring colours per app)
   - Scheduled recording — run a tutorial each week against the live
     site to catch UI drift

**Lift effort when the time comes: 1-2 days.** Everything already
written in Option A becomes the Orchestrator mode's internals.

## When to actually make the move

Three trigger conditions. If any one fires, graduate to Orchestrator:

1. **Second project needs tutorials.** Ink gets its own 10-video
   series. Beam launches and needs a demo loop. Doing them in parallel
   copies of `tools/tutorial-pilot/` becomes maintenance pain.
2. **Tutorials become scheduled.** You want to re-record Video 1
   every month to keep the UI accurate as Folio evolves. Orchestrator
   is already the home for scheduled long-running tasks.
3. **You start selling the capability.** If "I can produce polished
   tutorial videos for your SaaS" becomes a line of work, having it
   productized inside Orchestrator makes it an offering.

If none of those fire, Option A is permanent-enough. Not every tool
needs to be a platform.

## What NOT to do

- Don't delay Videos 1-2 to wait for Orchestrator work. Ship them
  with Option A this week.
- Don't blur the layers while using Option A. Keep Folio-specific
  selectors out of `pilot.js`. That's what makes the lift painless
  later.
- Don't over-feature Option A. If you find yourself adding
  cross-project abstractions to `tools/tutorial-pilot/`, that's the
  signal to graduate — not to keep patching.

## TL;DR

- **Right now:** Option A is done. Run Video 1 through it, see the
  output, decide if the cursor + ring + timing are what you want.
- **Over the next few weeks:** Ship Folio's 10 videos with Option A.
- **When a second project needs tutorials:** Spend 1-2 days lifting
  into Orchestrator. Everything you built in Option A becomes the
  core.
- **Never:** Use "it should probably be in Orchestrator" as a reason
  to delay the Folio videos.
