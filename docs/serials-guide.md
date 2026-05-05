# Publishing a serial in Folio

Folio's serial mode lets you release a book chapter by chapter on a schedule — like Substack, but for fiction. This guide walks through writing, publishing, selling, and running a serial from start to finish.

## What is a serial?

A serial is a book that doesn't unlock all at once. Instead, you set a release cadence (weekly, every two weeks, monthly, or your own custom interval), and chapters become available to readers one at a time on that schedule. Readers see locked chapters with a live countdown ("Chapter 4 unlocks in 2d 14h"). They can subscribe to get an email each time a new chapter drops.

Serials work for both free books and paid books. Paid serials gate the whole thing behind a one-time purchase; once a reader has bought it, the cadence still controls when they can read each chapter.

## Step 1 — Write the book

Write your manuscript in Folio the same way you'd write any book. Each chapter in your sidebar is a unit that can be drip-released. The unit of release is the chapter, so make sure your chapter breaks are where you want subscribers to receive an email. If you have a 3-chapter prologue you want to drop as one piece, either combine them into one chapter, or accept that subscribers will get three rapid emails on launch day.

Front matter (foreword, dedication) and back matter (acknowledgements, copyright page) are not part of the cadence. They appear immediately for everyone with access. Only the body chapters are drip-released.

## Step 2 — Open the Release modal

Click the **Release** button at the top of the sidebar. You'll see four sections:

**Title, author, description.** These pre-fill from your sidebar fields. The title and author show up on the locked-paywall card if you're charging, in the email subscribers receive, and at the top of the reader's screen.

**Mode picker.** Choose "Public & free", "Paid", or "Private link". Serials work with all three.

**Paid fields.** Only visible when you've picked Paid. Set your Gumroad product ID, price, currency, free-preview chapters, and whether to include an audiobook.

**Serial release section.** Toggle "Drip-release as a serial" to expand it.

## Step 3 — Configure the cadence

Inside the Serial section:

**Cadence.** Pick weekly, every two weeks, monthly, or custom. Custom lets you set any interval in days. Weekly is the most common for serial fiction.

**First chapter unlocks at.** A datetime picker. This is when chapter 1 becomes available. For a launch, pick a date in the near future so you can announce "chapter 1 is out!" and have it actually be true at click-time. If you set a date in the past, every chapter whose computed unlock time has already passed becomes immediately available.

**Schedule preview.** As you change the cadence and first-unlock date, Folio shows you the next 5 unlock dates so you can sanity-check before committing.

**Email subscribers when each chapter unlocks.** Check this if you want every chapter release to send an email to your subscribers. Leave it unchecked if you'd rather not send emails (subscribers can still sign up, but releases happen quietly).

## Step 4 — If you're selling: set up Gumroad

For paid serials, payments go through Gumroad. Folio doesn't process money itself — it gates the reader on a Gumroad license-key check.

Over in Gumroad, create a product. Either "Digital download" or "Membership" works (you don't actually upload anything to Gumroad — Folio is the reader). Set your price. Note the short product ID at the end of the Gumroad URL: if your product is at `gumroad.com/l/midnight-rain`, the ID is `midnight-rain`.

Back in Folio, paste that ID into the "Gumroad product ID" field and set the same price. Save.

When someone buys, Gumroad emails them a license key. They paste it into Folio's paywall, and Folio unlocks the book for them. The unlock lasts 30 days before they have to re-enter the key (this is automatic, not something you configure).

## Step 5 — Publish

Click **Publish** in the Release modal. Folio saves the release and shows you a reader URL — something like `https://folio.jacobsiler.com/?read=<your-folio-id>`. Click "Copy link" to grab it.

The book is now live. If you set the first-unlock for the future, no chapters are visible yet. Readers see locked cards counting down to chapter 1.

## Step 6 — Share the link

For free serials, post the reader URL anywhere — your blog, Twitter, Reddit, your newsletter. Anyone who clicks lands in reader mode and sees whatever has been released so far, plus locked cards for upcoming chapters.

For paid serials, share the **Gumroad product URL** (`gumroad.com/l/your-product`), not the Folio reader URL. Buyers land on Gumroad, pay, and get a license key emailed to them. In your Gumroad product description, paste your Folio reader URL with a note like:

> After purchase, head to [folio.jacobsiler.com/?read=...](#) and paste the license key when prompted.

This way buyers know exactly what to do with the key Gumroad sends them.

## Step 7 — Release chapters

Once your serial is live, chapters become available in two ways:

**Automatically on schedule.** Folio computes which chapters should be available based on your cadence and first-unlock date. If you set a weekly cadence with chapter 1 unlocking last Saturday, chapter 2 will unlock itself this Saturday — no action needed from you.

**Manually with the "Release next chapter now" button.** This button lives in the sidebar next to the Release button (it appears once a serial is published). Click it to release the next chapter immediately, ahead of schedule. Useful if you wrote a chapter early and want to drop it now, or if you're not using a strict schedule and want to hand-pace the releases.

The two methods combine: a chapter is released if either the schedule says so OR you've clicked the button enough times. A manual bump never un-releases a chapter that the schedule has already opened.

**One important note about emails:** today, only the manual button sends emails to subscribers. Auto-scheduled releases happen silently. If you want subscribers pinged each time a new chapter drops, click "Release next chapter now" — it does both jobs (releases the chapter AND sends the email).

## Step 8 — Iterate as you go

You can edit your manuscript freely after publishing. Save and readers see the latest version next time they refresh.

You can add new chapters at the end as you write them — the cadence extends automatically. You can edit existing released chapters for typo fixes or revisions; readers see updates immediately.

Be careful about reordering chapters in a serial that's already partway through release. The cadence math is based on chapter position, so reordering can confuse subscribers about which chapter is "next."

To change the cadence after publishing — say you set weekly but realized you want every two weeks instead — open the Release modal, adjust the settings, and click Publish again. Chapters that have already been released stay released. The new cadence applies going forward.

## What readers see

When someone opens the reader URL for your serial:

They see the book's title and author at the top. The chapters that are released render normally — they can read them, bookmark them, take notes if they're a beta reader or editor. Chapters that aren't yet released show as a card with a lock icon, the chapter number, and a live countdown that ticks down every 30 seconds: "Chapter 4 unlocks in 2d 14h 03m."

Below the first locked card (only when "Email subscribers" is enabled), there's a small inline form: an email field and a Subscribe button. Readers who want to be notified type their email and hit Subscribe. They get added to your subscriber list immediately.

When you release the next chapter (using the button), Folio sends every subscriber an email with the chapter title, a button that takes them straight to the new chapter, and a one-click unsubscribe link.

For paid serials, this all happens behind the Gumroad paywall. The reader buys the book once, enters their license key, and from that point on they see the same locked-card-with-countdown experience that free serial readers see.

## Your serial dashboard

Once a folio is published as a serial, your sidebar shows a small dashboard line above the Release button:

> Currently released: Ch 3 of 12 · Next unlock: Sat May 9 <br> [🔓 Release next chapter now]

That's the at-a-glance view of where you are in the run. The "next unlock" date is what subscribers will see counting down on the next locked card.

## Tips and gotchas

**Pick a launch date you can actually announce.** "Chapter 1 drops Friday at 9am Pacific" works much better than just hitting Publish and letting people stumble across it. Your launch email or social post should land at the same time chapter 1 unlocks.

**Don't stress about being early.** If you've already written ahead, you don't have to release on the strict cadence. The "Release next chapter now" button exists exactly for this — let your readers pull you forward if engagement is high. Or stick to the schedule for predictability. Both work.

**Subscribers persist across re-publishes.** If you re-publish a serial (to fix a setting or update the description), your subscriber list stays intact. You won't lose the people who've already signed up.

**Time zones.** The unlock countdown shows each reader their local time. A reader in Tokyo and a reader in New York both see the same actual moment, just rendered for their zone.

**Test the subscriber flow with another email.** As the author, you'll always have full access in editor view, so you won't see the locked cards or the subscribe form on your own folio. Open your reader URL in an incognito window (or with a different account) to see what subscribers actually experience.

**Releases are forever.** Once a chapter is released, it stays released, even if you change the cadence later. There's no way to "un-release" a chapter from the schedule view — if you really need to pull a chapter back, you'd have to delete the chapter content from your manuscript and re-publish.

## What's still coming

A few pieces of the serial workflow are planned but not built yet:

**Auto-emails on scheduled releases.** Today, scheduled releases (the cadence ticking forward without you clicking the button) don't send emails. Only the manual button does. The fix is server-side and is on the roadmap.

**Subscriber list management.** Right now subscribers are stored but there's no UI to view, export, or manually remove them (other than the unsubscribe link they get in every email). A subscriber-list panel is planned.

**Schedule editing UX.** Today you change the cadence by re-publishing. A dedicated "edit schedule" view that's clearer about which chapters move and which stay is on the list.

If you hit any rough edges, mention it — the serial flow is new and feedback shapes what gets built next.

## Quick checklist

Before launching:

1. Manuscript chapters are where you want them, with clear breaks.
2. Title, author, description all filled in. They appear in emails and on the reader page.
3. Cadence and first-unlock date set. Schedule preview confirms the next 5 unlock dates look right.
4. If paid: Gumroad product created, ID and price entered in Folio.
5. "Email subscribers" checked if you want notifications sent.
6. Published. Reader URL copied.
7. (Paid only) Reader URL added to your Gumroad product description.
8. Launch date announced wherever your readers are.

That's the full pipeline. Once you've shipped chapter 1, your weekly rhythm is: write the next chapter → save → click "Release next chapter now" when you're ready. Subscribers get an email, the lock card flips to readable content, and the countdown starts ticking on the next one.
