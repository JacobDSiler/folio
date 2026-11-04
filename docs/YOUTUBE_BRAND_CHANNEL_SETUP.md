# Folio YouTube brand channel — setup walkthrough

Do this in your own Chrome, signed in with **jacob.siler91@gmail.com** (or whichever Google account you want as the channel's *owner*). I can't pilot Google OAuth for you — that would mean me touching your credentials, which I won't do. Follow the clicks below; it's about 10 minutes.

A **Brand Account** is the right choice (not a personal channel): it can have multiple managers later (Allyson, a VA), survives if you ever hand it off, and keeps "Folio" separate from "Jacob Siler" in search.

---

## 1. Sign in and open YouTube

1. Go to **https://www.youtube.com**.
2. Top-right → avatar → **Switch account** → confirm you're on `jacob.siler91@gmail.com`.
3. If YouTube says "Create a channel", you'll be routed through the personal-channel wizard. **Skip for now** — we want a Brand channel, not a personal one. Close that dialog.

## 2. Create the Brand channel

1. Go directly to **https://www.youtube.com/create_channel** → this opens the "Create your channel" flow tied to a NEW Brand Account.
2. Channel name: **Folio**
3. Handle: **@onfoliopress** (if taken, try `@folio_press` or `@FolioBooks`)
4. Click **Create channel**.

If that page redirects to the personal-channel flow instead:

1. Go to **https://www.youtube.com/account** → **Add or manage your channel(s)** → **Create a new channel**.
2. Enter **Folio** as the brand name → **Create**.

## 3. Verify the channel (needed before uploading videos over 15 min or custom thumbnails)

1. Go to **https://www.youtube.com/verify**.
2. Pick **Ireland** → **Text me the verification code** → enter your phone.
3. Enter the 6-digit code → **Submit**.

## 4. Customise the channel

Go to **YouTube Studio** → **Customization** → **Branding** tab.

- **Profile picture** (800×800, round-cropped): use the Folio book-ribbon mark. There's a candidate at `C:\dev\folio\logo-512.png` — upscale to 800 in any image editor (or I can run an ffmpeg scale for you).
- **Banner image** (2560×1440, safe area 1546×423): needs creating. I can design one — say the word and I'll produce `channel-banner.png`.
- **Video watermark** (150×150): same ribbon mark, transparent PNG.

Then **Customization → Basic info**:

- **Description**:
  > Folio is a browser-based book publisher for indie authors. Write, design, release — no desktop software, no 30% commission. Free forever to start. onfolio.press
- **Links**: `onfolio.press`, `onfolio.press/shelf`, `ink.jacobsiler.com` (if you want the mailing-list tool linked too).
- **Contact email**: `silertechireland@gmail.com` (public).

**Customization → Layout**:

- **Video spotlight** → leave blank until you have the hero tutorial up.
- **Featured sections**: Uploads → For you → Playlists.

## 5. Create playlists (before any upload, so the hero video lands in one cleanly)

YouTube Studio → **Content** → **Playlists** → **New playlist**:

- **Getting started with Folio** (public) — the 10-video tutorial series will live here.
- **Outreach cuts** (unlisted) — the 15-second silent-first cuts you'll run as ads.
- **Author stories** (public, empty for now) — space for interviews later.

## 6. Upload the hero tutorial (once Ibtisam's revised cut is back)

YouTube Studio → **Create** (top-right camera+) → **Upload videos**.

- File: `tutorial-workshop/production/Script 00 — final.mp4` (whatever the revised filename is).
- **Title**: `Publish your book in the browser — Folio tutorial`
- **Description** (first 2 lines show above fold):
  > Write, design, and release your book straight from your browser. No desktop software, no 30% store commission, free forever to start.
  >
  > • Onfolio: https://onfolio.press
  > • Start free: https://onfolio.press/app.html
  > • Shelf (browse books): https://onfolio.press/shelf
  >
  > Chapters:
  > 0:00 Open Folio
  > 0:20 Import a manuscript
  > 0:45 Pick a cover
  > 1:20 Design the interior
  > 2:10 Release to the Shelf
  > 2:40 What readers see
  >
  > #indieauthor #selfpublishing #writerslife
- **Thumbnail**: Ibtisam's 00:02 freeze with "Publish in your browser" overlay — I can generate a draft if you want.
- **Playlist**: Getting started with Folio.
- **Audience**: **No, it's not Made for Kids**.
- **Subtitles** → **Add** → upload `tutorial-workshop/production/Script 00.srt` (SRT, English).
- **Visibility**: **Unlisted** first (so you + Allyson can watch before it's public). Flip to **Public** once you're happy.

## 7. Upload the outreach 15-second cut

Same flow as above, but:

- Title: `Publish your book in the browser — Folio`
- Playlist: **Outreach cuts** (unlisted).
- Keep it **Unlisted**. You'll use its URL inside Meta/Reddit ad placements, not as organic discovery.

## 8. Add Allyson as a channel manager (optional but worth doing now)

1. **https://myaccount.google.com/brandaccounts** → click **Folio** → **Manage permissions**.
2. **Invite new users** → her Gmail → role: **Manager** (can upload, edit, respond to comments; can't delete the channel). **Owner** if you want her fully equal.

---

## Things I can do now — say which

- Produce an 800×800 channel avatar PNG from the Folio ribbon mark.
- Produce a 2560×1440 channel banner with "Folio — publish your book in the browser" wordmark and a safe-area-correct centre.
- Produce a thumbnail PNG (1280×720) from the hero video's best frame with overlay text.
- Generate chapter timestamps for the real hero cut once it's back from Ibtisam (I'll read the video and give you actual times).
