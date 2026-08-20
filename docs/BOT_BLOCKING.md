# AI-crawler blocking — three-layer defence

**Goal:** stop AI training crawlers from ingesting authors' work,
while keeping search engines indexing the discovery surface (welcome,
shelf, imprint) so readers can still find folios organically.

**Status (2026-08-11):** layers 1 + 2 shipped in code, layer 3 needs
Jacob to enable a Cloudflare dashboard toggle.

---

## Layer 1 — robots.txt (well-behaved bots)

File: `robots.txt` at repo root. Served at `/robots.txt`.

Denies ~25 named AI training crawlers (GPTBot, ClaudeBot,
Google-Extended, Applebot-Extended, CCBot, PerplexityBot, Bytespider,
Meta-ExternalAgent, Amazonbot, cohere-ai, YouBot, AI2Bot,
DuckAssistBot, ImagesiftBot, omgilibot, MistralAI-User, Timpibot,
SemrushBot-OCOB, Kangaroo, Scrapy, and more).

Allows search engines (Googlebot, Bingbot, DuckDuckBot, Slurp,
Baiduspider, Applebot) on `/`, `/shelf`, `/press/*`, `/help/*`,
`/imprint/*`. Blocks them from `/admin/`, `/s/`, and per-folio
reader URLs (`app.html` + `?read=` params).

**Adding a new AI bot to block:** add a `User-agent: <BotName>` +
`Disallow: /` pair. Keep alphabetical-by-vendor for maintainability.

**Caveat:** robots.txt is voluntary. Bad actors ignore it entirely.
That's why we have layers 2 and 3.

---

## Layer 2 — `_headers` + per-page meta tags (crawlers that read headers)

File: `_headers` at repo root. Cloudflare Pages ships this as HTTP
response headers on every matching path.

Sets `X-Robots-Tag: noai, noimageai` on author-content paths:
- `/app.html` (reader view — also `noindex, nofollow` since readers
  reach folios via the Shelf, not search)
- `/imprint/*` (author profile pages — indexing on so name searches
  work, `noai, noimageai` so AI doesn't train on the author's bio)

Sets `X-Robots-Tag: noindex, nofollow, noai, noimageai` on
ephemeral / private paths: `/admin/*`, `/s/*`.

Sets `X-Robots-Tag: index, follow, noai, noimageai` on discovery
paths: `/`, `/shelf`, `/press/*`, `/help/*`. That's the balance —
findable to humans, unusable to AI.

**Per-page meta tag** (belt+braces for cases where the header layer
is stripped by a caching proxy): `<meta name="robots" content="noai,
noimageai">` on reader and imprint pages. Layer 2b, sits inside the
HTML so it survives any weird routing.

---

## Layer 3 — Cloudflare dashboard (enforcement for bad actors)

Cloudflare has server-side bot detection that catches crawlers even
when they lie about their User-agent or ignore headers. Requires
turning on a couple of toggles in the CF dashboard.

### Free / all plans

1. **Bot Fight Mode** — Cloudflare dashboard → onfolio.press zone →
   Security → Bots → **Bot Fight Mode: On**. Free. Blocks obvious
   bad-actor bots by traffic patterns + JS challenges. Some false
   positives possible but rare for a book-reading audience.

### Cloudflare Pro plan and above

2. **Block AI Bots** — Security → Bots → **AI Scrapers and Crawlers:
   Block**. Pro plan or above. This is Cloudflare's curated list of
   AI-training bots, kept updated so we don't have to maintain
   robots.txt entries for every new one.

3. **AI Audit** — Security → AI Audit tab. Shows a dashboard of how
   many AI bot requests were blocked in the last 24h / 7d / 30d.
   Useful for verifying the layers are actually catching traffic.

### Enterprise plan

4. **AI Labyrinth** — a newer offering that serves AI crawlers a
   dead-end maze of pointless auto-generated content, wasting their
   compute budget instead of just blocking them. Enterprise-only,
   not needed at Folio's scale.

**Recommendation:** turn on Bot Fight Mode today (free). Consider Pro
plan once revenue justifies (~$20/mo per zone, gives you AI Bot
Blocking + Enhanced HTTP/2 Prioritization + a bunch of other stuff).

---

## Verification

**robots.txt** — visit `https://onfolio.press/robots.txt` and
confirm the content matches the repo file.

**Response headers** — from a terminal:
```
curl -sI https://onfolio.press/app.html?read=<any-folio-id> | grep -i X-Robots
# Expected: X-Robots-Tag: noai, noimageai, noindex, nofollow
```

**Meta tags** — view-source on a reader URL, search for
`<meta name="robots"`.

**Bot Fight Mode active** — dashboard → onfolio.press → Security →
Bots → Overview should show it as enabled.

---

## What this doesn't do

- Doesn't stop a determined human from copying + pasting a reader's
  view into their own training pipeline. That's a legal question
  (Terms of Service + copyright), not a technical one.
- Doesn't retroactively remove pages that were already ingested by
  training crawlers before this shipped. Contact each provider's
  opt-out form if you want backfill removal — OpenAI, Anthropic,
  Google all have web forms for this.
- Doesn't affect analytics or ad-blockers or good citizens; only the
  specific AI-training User-agents listed.

---

## Log

- 2026-08-11 — Layers 1 (robots.txt) + 2 (_headers + meta tags)
  shipped. Layer 3 dashboard toggles await Jacob.
