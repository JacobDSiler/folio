# Google Play Reader Apps Program — Folio Application

**Submit at:** [Reader Apps program application form](https://support.google.com/googleplay/android-developer/contact/reader) (linked from https://support.google.com/googleplay/android-developer/answer/12570971)

**When to submit:** After you have an app live in at least one Play track (closed testing counts) and the app has an active Play Console listing. So: after Step 8 of the main brief.

---

## Application answers — copy and paste

### Developer / account info
Use whatever's on file for your existing Play developer account (silertechireland@gmail.com).

### App(s) covered
`Folio` — package name `press.onfolio.app`

### Category
**Books**
Secondary: **Productivity** (writing tool aspect)

### Which of Google's Reader App categories does your app fit?
> "Reader apps enable users to access previously purchased or subscription-based digital content or services (including magazines, newspapers, books, audio, music, and video) that they access in the app."

Folio fits the **Books** category. Users create, read, edit, and publish long-form written works (books) in the app. The subscription unlocks additional publishing and formatting features related to producing and distributing that book content.

---

## Written justification (paste into the "describe your app" box)

Folio is a browser-based writing and publishing tool for authors of long-form written work. Users draft, structure, format, and publish books directly in the app. Its primary purpose is content creation and consumption of book-format material — users spend the vast majority of their time inside the app reading their own drafts and manuscripts, refining typography, and preparing books for publication and distribution.

The Android app is a Trusted Web Activity wrapping the existing web application at https://onfolio.press. It offers the same book-authoring, reading, and formatting features as the web version. Users produce EPUB, PDF, and print-ready outputs of their book content, which they then publish through the third-party vendor of their choice (Amazon KDP, IngramSpark, Lulu, Draft2Digital, etc.).

Subscription plans (INDIE and IMPRINT tiers) unlock additional publishing, formatting, and distribution features. Subscriptions are managed on the Folio website and payment is processed by PayPal. Users can also optionally tip the developer via Ko-fi — entirely separate from any subscription.

We are requesting Reader App status so that we can direct users to the Folio website for account creation and subscription management, consistent with how similar reader apps (Kindle, Audible, Kobo, Scribd) operate under this exemption.

### Percentage of app functionality that is reader-oriented
**> 90%.** Reading drafts, writing/editing text, formatting book layouts, and generating book output files (EPUB, PDF, print) are the app's core and near-exclusive functions.

### Does your app offer digital content that users have purchased outside the app?
**Yes** — user-created book content, saved via the user's Folio account, is accessible across devices (web + Android app) once purchased/subscribed.

### Payment processing
Current: PayPal subscriptions (INDIE/IMPRINT tiers) processed via the web app at https://onfolio.press/subscribe.
Ko-fi tips (optional) via https://ko-fi.com/[your-page].
No in-app billing implementation.

### Requested treatment under the program
- Permit account creation and subscription management via the Folio website
- Permit the Android app to include a link to the Folio subscription page (opened in the user's external browser, with the required disclosure)
- Not required: alternative in-app billing SDK integration

---

## Materials Google may ask for

Have these ready to attach or link:

| Item | Where to get it |
|---|---|
| Screenshots of the app (5+) | Take on your Redmi after install |
| Screenshot showing reader-app functionality (drafting/reading a book) | Same |
| Screenshot showing subscription page (web version) | From onfolio.press/subscribe |
| Privacy policy URL | https://onfolio.press/privacy.html |
| Play Store listing URL | Available after your closed-testing release goes live |
| Package name | press.onfolio.app |

---

## After you submit

Google review time: typically **7–21 days**. They may come back with clarifying questions — reply promptly.

Approval outcomes:
- **Approved:** Flip `MODE = 'safe'` → `MODE = 'reader'` in `folio-twa.js`, redeploy the site, and rebuild + re-upload the AAB with a bumped version code.
- **Rejected with feedback:** Fix the concerns, resubmit. Usually the fix is more prominent disclosure or clarifying the reader-first nature of the app.
- **Rejected outright:** Fallback plan is to keep MODE = 'safe' in production too (no revenue path in the Android app; users find subscribe on onfolio.press directly). Or invest in Play Billing integration (much bigger job — requires moving off TWA to a hybrid/native shell).

---

## Notes for the application

- Emphasise "books" and "reading" language. The reader-app exception is designed around media consumption apps; framing Folio as "a book reader/writer" (rather than "a productivity SaaS") aligns with the program's intent.
- Don't hide the writing/authoring side — but present it as book *content creation and consumption*, which is well within scope. Kindle Direct Publishing App has been approved as a reader app despite being an authoring/publishing tool.
- Mention the existing established third-party vendor exports (Amazon KDP, IngramSpark, etc.) — this makes clear you're a **tool for authors publishing books**, which is squarely book-industry.
