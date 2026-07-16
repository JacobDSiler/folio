# Stock photo composite templates — design + shopping list

> Follow-up to the pure-canvas product-photo templates. Canvas can only
> get us so far — photorealistic templates need real photography plus a
> perspective-transform composite.

## What we need per template

For each stock template we buy, we need to know exactly where the
author's cover goes. That's a **quad** (four corner coordinates in
image space) that defines the destination on the template photo.

Data structure:

```json
{
  "id": "flatlay-01",
  "name": "Cozy Flatlay — Coffee & Candle",
  "asset": "/press/photos/templates/flatlay-01.jpg",
  "coverQuad": {
    "topLeft":     [412, 388],
    "topRight":    [734, 372],
    "bottomLeft":  [428, 826],
    "bottomRight": [750, 810]
  },
  "textOverlays": [
    { "text": "Read at onfolio.press", "x": 540, "y": 970, "align": "center",
      "font": "500 22px system-ui", "color": "rgba(255,255,255,0.9)" }
  ]
}
```

The `coverQuad` corners are where the author's cover corners land AFTER
perspective transform. We use `ctx.transform()` matrix math to warp the
cover into that quad, then compose over the template.

## Rendering pipeline (canvas)

1. Load the template photo
2. Load the author's cover (with CORS)
3. Compute the affine (or full perspective) transform matrix that maps
   the cover's rectangle onto the target quad
4. `ctx.drawImage(template)`, then `ctx.setTransform(...)` and
   `ctx.drawImage(cover)` inside the warped context
5. Draw text overlays with fixed coordinates on top

For pure affine (parallel-preserving) warps we can use `ctx.setTransform`
directly. For true perspective (four independent corner points), we need
either:
- A JavaScript perspective library (small, ~2KB — I'll write one inline)
- OR a WebGL fallback (bigger, more accurate for extreme angles)

For book flatlays the perspective is mild — affine will look great and
we don't need WebGL.

## What to buy

Look for these on **Adobe Stock, Shutterstock, iStock, or Envato Elements**.
Key search terms in quotes:

**1. Cozy flatlay — "book coffee candle table flatlay"**
   - Needs: a book with a **plain or neutral cover** we can composite over.
     Some sellers offer "book mockup" photos with a clearly-cover-shaped
     region.
   - Ideal props: mug + candle + optional blanket, plant, or glasses.
   - Photograph angle: 3/4 view (not pure top-down — pure top-down looks
     flat and can't show the book's thickness).
   - Buy 2–3 variants (autumn, spring/summer, minimalist).
   - Budget: ~$15–30 each.

**2. Book on shelf mockup — "hardcover book mockup shelf"**
   - Multiple books lined up, one facing camera as hero. Good for series.
   - Buy 1–2 variants.

**3. E-reader mockup — "kindle mockup lifestyle"**
   - E-reader on a table with cover-blank screen. Compose author's cover onto
     the screen.
   - Buy 1–2 variants.

**4. Book in hands — "reader hands book mockup"**
   - Someone holding an open or closed book. Very lifestyle. Great for social.
   - Buy 1–2 variants.

**5. Multi-book stack — "book stack top down mockup"**
   - 3–5 books stacked with the top book's cover visible. Perfect for
     Series Stack replacement.
   - Buy 1 variant.

Total budget suggestion: **~$200 for 8–10 great templates**. Envato
Elements is $16.50/mo with unlimited downloads if you'd rather subscribe.

## Licensing note

Check that each purchased template's license permits:
- **Commercial use** (Folio is a paid product)
- **Modification** (we composite covers over the mockup surface)
- **End-user redistribution** — the author's downloaded PNG will be
  posted publicly. Some licenses require attribution or restrict this.

Adobe Stock's standard license covers all of this. Envato Elements'
"unlimited" license does too. iStock's "Editorial" licenses do NOT —
avoid those.

## File structure once bought

```
press/photos/
  ├── index.html                  (existing generator UI)
  ├── templates/
  │     ├── manifest.json         (list of all templates with quads)
  │     ├── flatlay-01.jpg
  │     ├── flatlay-01-preview.jpg   (400px thumbnail for the picker)
  │     ├── shelf-01.jpg
  │     ├── shelf-01-preview.jpg
  │     └── ...
  └── composite.js                (perspective-warp helper — I'll build this)
```

Templates load lazily so the picker stays fast. Each template photo is
~200–800 KB depending on dimensions.

## Implementation phases

**Phase 1 — infrastructure** (2 hours, no purchases needed yet)
- Build `composite.js` with an affine/perspective warp helper
- Add a `template.type = 'photo'` branch to the render dispatch
- Ship with one HAND-DRAWN sample template so the pipeline is proven

**Phase 2 — first purchases** (Jacob buys 2–3 templates, I wire them in)
- Add the flatlay + shelf-lineup templates
- Retire the pure-canvas Cozy Flatlay and Series Stack (or keep them as
  budget alternatives)

**Phase 3 — quality-of-life**
- Preview thumbnails in the template picker
- Author-uploaded template feature (Imprint-tier upsell): author
  photographs their own book on their own aesthetic surface, uploads once,
  gets an unlimited-download "signature" template

## Meanwhile, what got improved today

- **Cozy Flatlay**: rewritten to 3/4 consistent view. Book uses drawBook3D
  (angled, spine visible). Mug is upright side-view with vertical steam.
  Candle upright. Everything agrees where the camera is.
- **Series Stack**: pulls real siblings from `window._folios` matching the
  featured folio's `folio.series` field. Stacks up to 3 books with proper
  z-order and slight rotational jitter. Falls back to spine-only slabs
  when no siblings exist so the "there's more here" read stays intact.
- `_folios` now carries `series` and `seriesOrder` fields for future use.
