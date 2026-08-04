# Modular UI plan — Folio workspace reconfigurability

**Status:** Design doc. No build committed. Awaiting Jacob's decision
between the three phased approaches below (§7).

**Trigger:** Jacob 2026-08-04 — "Between the top and bottom bars, you
can't really see the chapters and such. Can we modularize it in such
a way that top and bottom clutter is not cramping the UI? Maybe if we
can click and drag different boxes/widgets and move them around and
save/load common layouts it would help. Folio has a multiplicity of
tools, and I see interfacing with all of them comfortably, easily,
and well as the main challenge for users currently."

**Framing:** Jacob's read is correct. Folio has grown wide and fast —
the writing panel, the paginated preview, the sidebar tabs
(Manuscript / Book / Audio / Folio / Metrics), the release modal, the
image editor, the character panel, the annotations layer, the AI
translation panel, plus a top bar, a mode toggle strip, and a preview
toolbar. Users with larger font sizes on their devices genuinely lose
the middle. This doc is about what to do about it, not whether the
problem is real.

---

## 1. What "modular" could mean, concretely

Three interpretations, in ascending order of engineering cost:

### 1a. **Preset layouts** — the pragmatic v0
Author picks from 3-5 named workspace presets that hide/show + resize
existing panels. No drag-and-drop, no custom positions. The presets
are curated by us:

- **Manuscript focus** — sidebar collapsed to icons, top bar auto-hides,
  preview fills the screen, no bottom stats bar. For writing sessions.
- **Book setup** — sidebar wide (480px), Book tab open, top bar
  showing, preview visible. For metadata + cover work.
- **Editorial review** — sidebar showing the outline (chapter list
  only), preview zoomed, no toolbars. For read-throughs.
- **Publishing** — sidebar collapsed, release-modal-adjacent tools
  primary, preview showing chapter locks. For paywall config.
- **Distraction-free** — sidebar hidden, all toolbars hidden except a
  small floating "unhide" nub in the corner. For deep-writing.

Users pick from a dropdown. Selecting a preset toggles the relevant
CSS classes on `<body>`; existing panels don't move — they just show,
hide, or resize. Small localStorage flag remembers the last choice.

**Cost:** ~4-6 hours. **Value:** Solves 70% of the "cramping" complaint
without new abstractions. Every author gets a distraction-free write
mode + a Thomas-style wide sidebar without dragging anything.

### 1b. **Dockable widgets** — the mid-tier build
The sidebar tabs, top bar toolbars, and bottom stats bar become
first-class "widgets" that can be:
- Docked left / right / top / bottom / floated
- Resized within their dock
- Hidden entirely
- Grouped into tabs within a dock (e.g. "put Characters + Annotations
  in a right-side tab group")

Layout state saves to localStorage; presets from §1a become the
starter set but users can build their own on top.

**Reference implementations to steal from:** VS Code's activity bar +
side bar + panel tri-split; Blender's editor-type-per-region model;
Figma's inspector-toggle.

**Cost:** ~30-40 hours. New abstractions: widget registry, dock model,
drag-drop-into-dock, persist/restore, undo layout changes, mobile
graceful degradation, printable-preview safety (widgets can't cover
the preview when the author wants a screenshot).

**Value:** Real workspace personalization. Different author types
(planners vs. discovery writers vs. audiobook producers) can shape
Folio around their day.

### 1c. **Free-floating widgets** — the full canvas
No docks. Every panel is a floating window the author positions
anywhere. Presets = named window arrangements. Windows can overlap.

**Cost:** ~60+ hours + ongoing UX debt. Free-floating layouts are
notoriously easy to break (windows off-screen, z-index fights, mobile
impossible). Photoshop and Blender both moved AWAY from pure floating
in favor of docked-with-detach.

**Value:** Marginal over §1b. Recommend against.

---

## 2. The actual sources of "clutter" (from a walk-through)

Naming what exists so §1's rearrangement can target real elements,
not vibes:

**Top bar** (fixed height ~48px):
- Folio logo + save-status chip
- Folio title editor
- Language selector (multi-lang folios)
- Save button
- Menu (New / Open / Backups / Sign in / …)
- Vendor Connections trigger (Imprint tier)

**Sidebar left column** (default 360px, resizable 260-640px):
- Tab strip: Manuscript · Book · Audio · Folio · Metrics
- Tab contents scroll independently
- Each tab has its own sub-toolbar

**Mode strip** (~36px, above preview):
- Preview mode / Writing mode / Edit toggle
- Chapter dropdown (jump-to)
- Zoom control
- Print button (Thomas has noted this)
- Export button

**Preview / writing area** (fills remaining space):
- Book pages OR editable manuscript
- Overlays: image drag markers, annotation gutters, dialogue highlights

**Bottom bar** (varies — sometimes 0, sometimes ~40px):
- Word count strip
- Local-backup banner (conditional)
- Paywall CTA on paid folios (reader mode)

On a 1080p screen with normal DPI, that's ~48 (top) + 36 (mode) + 40
(bottom) = 124px chrome vertical, plus 360px sidebar horizontal. On
Thomas's larger-font setup, the top/bottom chrome grows to ~160-180px
because the buttons scale with system font size. That's what makes the
middle feel cramped.

**Punchline:** the fastest wins aren't drag-and-drop widgets. The
fastest wins are:
- Auto-hide top bar on scroll / after 3s idle
- Bottom bar only when it has content to show
- Collapse mode strip to a single icon row when width < 900px
- Persist a "chrome off" mode per Jacob's writer's request from Thomas

Those are §1a preset territory.

---

## 3. Where Thomas's requests fit

Thomas from earlier sessions asked for:
- Wider editor
- Fewer distractions
- Sidebar resize persistence (SHIPPED — folio_sidebar_w localStorage)
- Sidebar scroll persistence (SHIPPED — folio_sidebar_scroll)
- Print-ready button repositioning (still open — location unclear)

Preset layouts (§1a) would satisfy his wider-editor + fewer-distractions
requests **immediately** with the "Distraction-free" and "Manuscript
focus" presets. The print button ambiguity would resolve because in
"Publishing" preset the print button gets primary placement.

Recommend: build §1a as a Thomas-ready feature. Ship. See if the
demand for §1b materialises, or if presets carry the load.

---

## 4. Interaction with existing state

**Already persisted per-session:**
- Sidebar width (localStorage `folio_sidebar_w`)
- Sidebar scroll (localStorage `folio_sidebar_scroll`)
- Active sidebar tab (session)
- Zoom level (session)
- Preview vs writing mode (session)

**Would need to move to a layout preset:**
- Which top bar buttons are visible
- Whether bottom bar is on
- Whether mode strip is compact or full
- Which sidebar tabs are enabled at all (some authors never touch
  Audio; letting them hide it de-clutters the tab strip)

Migration plan: a preset is just a map `{ topBar: 'compact', bottomBar:
'auto', sidebarTabs: ['manuscript','book','folio'], … }`. Existing
persisted keys (sidebar width, scroll) live outside the preset and
survive preset changes. Presets can be per-folio (Manuscript-focus for
this novel, Publishing for the release process) or global.

---

## 5. Sidebar tab surface — the highest-return single change

Regardless of which of §1a / §1b / §1c we pursue, the sidebar tab
strip is where the "multiplicity of tools" hits hardest. Five tabs +
sub-toolbars in each = ~25 discoverable surfaces in one column.

**Proposal (independent of presets):** collapsible tab groups. Group
tabs by user intent:

- **Write** = Manuscript
- **Design** = Book (cover, typography, layout)
- **Produce** = Audio, AI translation
- **Ship** = Folio (release + shelf), Metrics

Default view shows the four group headers with the LAST-USED tab
expanded per group. Author clicks a group header to expand it +
collapse others.

**Cost:** ~3 hours. Independent of presets. Recommend shipping either
before or alongside §1a.

---

## 6. Mobile — the harder cousin

The reason full drag-and-drop widgets is expensive: every layout
decision doubles because mobile can't dock. Mobile presets would need
to be entirely separate + curated (mobile writers vs. mobile readers
have very different needs).

For §1a: mobile gets a subset of the presets (Manuscript focus,
Distraction-free, Editorial review). Book setup + Publishing default
to hiding on mobile because those workflows are largely desktop.

For §1b: mobile users are locked to preset picker only — dragging is
disabled. Presets translate to CSS media-query layouts.

---

## 7. Decision points for Jacob

Answer these and Phase 1 can start.

**1. Which tier of ambition?**
- (a) §1a preset layouts only — pragmatic, 4-6 hours, ships this session
- (b) §5 (sidebar tab grouping) + §1a — layered, ~10 hours over two sessions
- (c) §1b dockable widgets — proper workspace reconfiguration, 30-40 hours across 4-5 sessions

**2. Presets to seed with (§1a)?**
The five I sketched are a starting point. Would you cut any? Add any?
Naming — "Distraction-free" is common but reads clinical; do you
prefer "Deep write" or "Focus" or something else?

**3. Preset scope — global or per-folio?**
Global is simpler (one preset for the whole app). Per-folio means an
author can have "Publishing" preset auto-load when they open a paid
folio + "Manuscript focus" for their WIP. Per-folio is more expensive
(~1.5x §1a's cost).

**4. Ship §5 sidebar grouping independently?**
Even if you pick §1a-only, the tab regrouping (Write / Design /
Produce / Ship) is a small ~3-hour ship that stands alone and would
noticeably de-clutter the sidebar.

---

## 8. Recommendation (my read)

**Phase 1 (this session or next, if you greenlight):** §5 tab grouping
+ §1a with three presets (Manuscript focus, Book setup, Distraction-
free). Global scope for the preset. Ship, gather feedback, watch which
presets get used.

**Phase 2 (if the data justifies):** two more presets (Editorial
review, Publishing). Add per-folio scoping.

**Phase 3 (only if authors ask):** §1b dockable widgets — starting with
detachable sidebar tabs (a Character panel that pops out as its own
floating window during a scene-writing session, then re-docks). Ship
narrow before expanding.

The reason not to leap to §1b: dockable widget systems are seductive
to build but expensive to maintain — every new panel we add needs to
know how to dock, resize, save state, and handle mobile fallbacks.
Preset layouts hit 80% of the same value at 20% of the cost, and
teach us which arrangements authors actually want before we invest
in a general drag system.
