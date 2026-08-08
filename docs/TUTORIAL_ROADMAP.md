# Folio tutorial roadmap

**Status:** Adoption strategy doc. Jacob 2026-08-06: "The tutorials
are what is most missing. If I have those tutorials users can
adopt it very easily." This is the shipping plan.

## Why tutorials are the leverage right now

Every feature we've shipped this month has authors quietly benefiting
from it — chapter locks, universe grouping, WebP conversion, image
lightbox, sticky Buy button, Write preset. But those authors are:

1. Not documenting their aha moments for us,
2. Not showing new authors how to reach the same aha,
3. And therefore not generating the word-of-mouth signal that
   converts strangers into signups.

Tutorials collapse the distance between "curious visitor" and
"published author." They are the flywheel spoke that ads can't buy.

## The tutorial library — priority order

Ordered by adoption-per-hour-invested. Each tutorial is 2-4
minutes; longer than that and completion drops off a cliff.

### 🥇 Tier 1 — ship this week

1. **"Publish your first folio in 5 minutes"** — cold-start onboarding.
   New signup → paste manuscript → set cover → click Publish → see it
   on the shelf. Zero jargon, zero configuration, one clean happy path.
   THIS is the tutorial that turns curious visitors into authors.
2. **"Publish a public-domain book"** — Gutenberg Cleaner → Folio →
   Shelf. Already in production (`tutorial_v1.mp4`, awaiting Jacob's
   trim + blur inputs).
3. **"Sell your book on Folio — 0% commission"** — the PayPal Native
   setup + how a buyer experiences the paywall. This is the
   money-shot for authors evaluating the platform vs Gumroad, KDP, or
   Substack.

### 🥈 Tier 2 — ship this month

4. **"Set up your author imprint page"** — customizing accent colour,
   hero image, tagline. Shows what the Indie/Imprint tiers unlock
   without being pitchy.
5. **"Publish a series (and a universe)"** — the Sky Bridge Saga
   workflow. Series/universe/anchor/entry-point in plain language.
   Directly addresses a pain point traditional authors know well.
6. **"Serial releases — publish a chapter at a time"** — the Substack-
   for-fiction pitch. Very specific niche but the right authors have
   been waiting for exactly this and will convert immediately.

### 🥉 Tier 3 — ship as demand appears

7. **"The three workspace modes: Full, Write, Focus"** — Thomas's
   preset system. Sells the "distraction-free writing" angle.
8. **"Import from Word, Google Docs, PDF, or Markdown"** — the
   friction-remover. Positions Folio as "wherever you are now, we
   accept it."
9. **"Get reviews and boost your book on the shelf"** — the
   post-publish playbook. Marketing-and-analytics angle.
10. **"Audiobook production"** — when the TTS pipeline is solid.

## Format guidance

Same shape as the Gutenberg Cleaner tutorial in production:

- **1920×1080 MP4**, H.264, 30fps
- **3-4 minutes** target length
- **On-brand title cards** (cream + Playfair + amber accent)
- **Section-title freezes** as built-in voiceover pauses
- **Silent screen recording + voiceover** — screen recording done
  first; voiceover recorded to picture (Jacob or Allyson)
- **YouTube-first delivery** at a dedicated `@folio-press` channel
- **Companion written article** at `/help/tutorials/<slug>` — SEO
  fuel that Google indexes and readers can skim without watching

Each tutorial gets a description with the direct URL to the feature,
a link to `/press/` (tier context), and the Project Gutenberg licence
link when relevant.

## Delivery — where the tutorials live

**In the app.** Add a `Tutorials` link to the sidebar footer (next
to Guide / Tiers / Help). Points to `/help/tutorials/` — an index
page listing all published tutorials with thumbnails, durations, and
prerequisite tags. Each tutorial's page embeds the YouTube video and
carries the written companion below.

**On the shelf.** After a reader signs up but hasn't published,
the sidebar shows a small "🎬 New here? Watch the 5-minute
first-folio walkthrough" nudge that links to Tutorial #1.

**In context.** The release modal, imprint customize modal, and
series editor each grow a small "🎬 Watch a walkthrough" link
in their header. Reduces the "I opened this thing, now what?"
moment which is where authors abandon most.

**On social.** YouTube channel is primary. Short (30-60s)
extracts on Instagram Reels + TikTok — the "money shot" of each
tutorial (e.g. the moment a folio appears on the shelf, the
moment a paywall unlocks after a fake purchase, the moment a
series card materialises). Description on each: "Full tutorial
at onfolio.press/help/tutorials/…"

## Companion asset — testimonial from Caroline

Two-part ask this week:

1. **Written pinnable quote** (~2 sentences, honest) — goes on
   `/press/` between the pricing tiers and the FAQ. Pin format:
   > "Folio makes publishing feel like the writing part — the
   > tools get out of the way. I published my first novel here
   > and told my agent to use it too." — Caroline Siler
2. **30-second phone video** for the YouTube channel + Instagram
   Reels. Doesn't need production value; the authenticity IS the
   value. She talks about her book on-camera and what she likes
   about Folio in her own words.

Being your mother, Caroline can film this in one sitting with no
back-and-forth. That's your MVP social proof for launch.

## Voiceover scripts — Tier 1

Written for a slightly warm, conversational read. Timing marks
in the margin (e.g. `[0:12]`) sync to where in the screen
recording the narrator should be. Screen actions in `[brackets]`
tell the recorder what the visual is doing at that moment.

---

### Script 1 — "Publish your first folio in 5 minutes"

**Target length:** 3:30

**Opening card (5s hold):**

> Publish your first folio in five minutes.
> Free forever. Zero commission on sales.

**[0:05 — screen: welcome page, `Sign in with Google` button]**

> Folio is a browser-based publishing platform for writers. There's
> nothing to install, no invoice at the end of the month, and Folio
> takes zero percent of what your readers pay you. Ever.

**[0:20 — click Sign in with Google, redirect completes]**

> Sign in with Google — that's the whole sign-up. Your work saves to
> the cloud so it's on every device you sign in on, and your
> anonymous drafts from before you signed in come with you.

**[0:32 — editor loads, empty state visible]**

> This is the editor. Sidebar on the left, book preview on the right.
> The preview is a real, paginated book — what you write is what a
> reader will see.

**[0:45 — paste manuscript into the Import panel]**

> Paste your manuscript into the Import panel — or drop a .docx,
> .txt, or .md file straight onto it. Folio detects chapter breaks
> automatically and lays them out.

**[1:00 — Split into chapters clicked, chapter list populates]**

> That's your chapter list on the left. Drag to reorder. Click a
> title to edit it. The 🔒 lock button pins a chapter so it survives
> a re-import — useful for the frontispiece and anything you've
> hand-crafted.

**[1:20 — switch to Book tab, cover upload]**

> Book tab. Drop a cover image — Folio auto-converts it to WebP and
> upscales small covers so they stay crisp on high-DPI shelves. Set
> your title, subtitle, and author name.

**[1:40 — Design tab, pick a font]**

> Design tab picks the typography. Serif, sans, chapter numbering
> style. The preview updates live as you tweak.

**[1:55 — click Release / Ship tab]**

> Ship tab. Click Release to publish. Give it a description, tick
> "List on the Folio Shelf," pick a genre and a couple of tags.

**[2:20 — release modal, price mode]**

> Price mode. Free means anyone can read it. Paid gives you PayPal
> Native — buyers click Buy, checkout happens inline, they unlock
> the book. Zero commission. You keep every cent.

**[2:45 — click Publish, transition to shelf view]**

> Publish. Your folio is now live on the Folio Shelf.

**[3:00 — shelf shows the new folio card]**

> That's your book, live, browsable, readable, shareable. Send the
> reader URL anywhere. Share on Twitter, embed on your site, drop
> in an email.

**[3:15 — end card]**

> Start writing at onfolio.press. Zero percent commission. Beautiful
> books in your browser.

---

### Script 2 — "Publish a public-domain book"

**Target length:** 3:45 (matches `tutorial_v1.mp4` structure)

**Welcome card (6s hold — already in v1):**

> Publishing a Public-Domain Book to the Folio Shelf.
> From Project Gutenberg to your own shelf — in under five minutes.

**Step 1 title (3s):** Clean the source.

**[0:09 — Gutenberg Cleaner, empty state]**

> Project Gutenberg has a hundred thousand public-domain books. Their
> plain text comes wrapped in Project Gutenberg's own header and
> footer — legal boilerplate, redistribution notices. The Gutenberg
> Cleaner strips all that so you're left with just the book.

**[0:20 — paste Gutenberg URL, book loads, chapters appear]**

> Paste a Project Gutenberg URL. The Cleaner fetches, strips the
> boilerplate, and shows you the chapters it found. Verify the split
> looks right — front matter, chapters, back matter.

**Step 2 title (3s):** Open in Folio.

**[0:38 — click Open in Folio, transition to editor]**

> One click hands the whole clean manuscript to Folio. Front matter,
> every chapter, back matter — all in the right order, ready to
> edit.

**Step 3 title (3s):** Review + polish.

**[1:20 — Folio preview showing loaded book]**

> The preview is a real book — flip through, check chapter breaks,
> spot typos the Gutenberg source missed. Add a cover, tune the
> typography, set the author name. Your public-domain adaptation
> can look better than the original ever did.

**Step 4 title (3s):** Publish to the Shelf.

**[2:33 — release modal in Ship tab]**

> Release modal. Pick your price — free to share, or paid if you're
> offering something the base text doesn't have (annotations, a new
> introduction, a definitive edition). Tick "List on the Folio
> Shelf" so browsers can find it.

**[3:00 — Publish, then shelf view of the new folio]**

> Published. Your edition is live. Every purchase — if you're
> charging — goes directly from the reader to you. Folio takes
> zero commission.

**Disclaimer card (4s hold):**

> Every Gutenberg text carries its own licence terms. Read them and
> stay inside the lines. Link in the description.

**End card (6s):** Start writing / publishing at onfolio.press.

---

### Script 3 — "Sell your book on Folio — 0% commission"

**Target length:** 3:00

**Welcome card (5s):**

> Sell your book on Folio.
> Zero commission. Direct to reader. Instant unlock.

**[0:05 — release modal, Price mode picker]**

> When you publish a folio, you pick a price mode. Free is free.
> Paid lets readers buy it — and there are two ways to run that.

**[0:20 — Paid mode, provider dropdown showing PayPal Native + Gumroad]**

> PayPal Native is the fast path. Buyers click Buy inside Folio,
> PayPal Checkout appears inline, they pay, the book unlocks
> instantly. No leaving the reader. No license keys. No middleman.

**[0:45 — click Vendor Connections, paste PayPal Client ID + Secret]**

> One-time setup. Open Vendor Connections in the sidebar Folio tab.
> Paste your PayPal Client ID and Secret from developer.paypal.com
> — these are your PayPal account's credentials, not something we
> issue. Save.

**[1:10 — back to release modal, set price + free preview + Publish]**

> Back in Release. Set your price, currency, and how many chapters
> to give away free as a preview. Two or three free is standard —
> gives browsers enough to bite. Publish.

**[1:30 — reader view of the paid folio, paywall visible]**

> This is what a reader sees. Free preview chapters render normally.
> Then a paywall — with the price, a description of what they'll
> get, and a big PayPal button. In the top bar, a sticky Buy
> button follows them wherever they scroll, so they can never
> lose the checkout.

**[2:00 — simulated purchase, book unlocks]**

> Reader clicks Buy. PayPal Checkout in a popup. Approve.
> Immediately — no email, no key, no wait — the book unlocks.
> Every locked chapter opens. Sticky Buy button disappears.
> Reader gets what they paid for.

**[2:25 — Folio shelf, folio card with PAID badge]**

> Your paid folio sits on the Folio Shelf like any other. Same info
> modal. Same series grouping. Same everything — except the Buy
> button on the card goes to the paywall instead of the reader.

**[2:45 — end card]**

> Zero commission. Every cent goes to you. Start selling at
> onfolio.press.

---

## What I can do to accelerate this

I can, right now:

- **Draft the remaining Tier 1 + Tier 2 scripts** — I've written 3
  above; the rest are a session each.
- **Set up the /help/tutorials/ index page** — hooks into the
  existing /help/ site with cards for each tutorial.
- **Add the sidebar footer "Tutorials" link** — one-line change
  matching Guide / Tiers / Help.
- **Build the in-context "🎬 Watch a walkthrough" links** in the
  release / imprint-customize / series-editor modals — small ships
  once we know the tutorial URLs.

I cannot record the voiceover. That's you or Allyson — the
authenticity of your own voice matters more than any polish I
could add. Same for the screen recordings — those are you doing
the workflow live.

## Suggested week-1 execution

- **Monday**: text Caroline. Ask for a 30-second phone video +
  two-sentence pinnable quote. She'll say yes; you're her son.
- **Tuesday**: record the Tutorial #1 screen capture (5 min of
  actual work, filmed unedited). I'll trim + card + assemble.
- **Wednesday**: record voiceover for Tutorial #1 to the picture
  I've assembled. Or hand it to Allyson.
- **Thursday**: ship Tutorial #1 to YouTube + `/help/tutorials/`
  + sidebar-footer link. Ship Caroline's testimonial to `/press/`.
- **Friday**: post the 30-second Reel extract of Tutorial #1 on
  Instagram + TikTok + Twitter. Post the full one to Bluesky +
  r/selfpublish + r/writing.

That's one tutorial and one testimonial live in five days, and
the infrastructure to add more without redoing any of the setup.
The next one is faster because the pattern's now proved.
