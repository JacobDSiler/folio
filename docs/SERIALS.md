# Folio Serials — implementation notes

Phase 1 (shipped 2026-04-26-audio-recover-and-serials) wired up the
data model + UI + reader locks + author dashboard. Phase 2 (this
sweep) wires real subscriber email notifications via a Cloudflare
Worker that forwards to Resend.

## Data model

Every release doc on `folio_projects/{id}.release` may carry these
serial-related fields. All are optional; non-serial releases leave
them null/false:

| Field | Type | Notes |
| --- | --- | --- |
| `serial` | bool | Master toggle. False = legacy non-serial release. |
| `serialCadence` | `'weekly' \| 'biweekly' \| 'monthly' \| 'custom'` | Drip interval. |
| `serialCadenceCustom` | number | Days, only when cadence === 'custom'. |
| `serialFirstReleaseAt` | number (ms) | Unix-ms of chapter-1 unlock. |
| `serialReleasedThrough` | number | Highest manually-bumped chapter index. Auto-cadence advances `_serialAutoReleasedCount`; the rendered count is `max(auto, manual)`. |
| `notifyOnUnlock` | bool | When true, email subscribers each time `releasedThrough` advances. |

Subscribers live in a subcollection:

    folio_projects/{folioId}/subscribers/{docId}
      email:            string (lowercased, validated client-side)
      subscribedAt:     number (Date.now())
      unsubscribeToken: string (32 hex chars, generated client-side)

## Subscribe / unsubscribe flow (client-side)

1. Reader visits `?read=<folioId>` for a serial release with
   `notifyOnUnlock === true`. The `_serialApplyLocks` render path
   calls `_serialMaybeRenderSubscribeForm`, which mounts a small
   inline form below the first locked-chapter card.
2. Reader types email, hits Subscribe. Client calls
   `_subAdd(folioId, email)`:
   - Validates email shape.
   - Generates an `unsubscribeToken` via `crypto.getRandomValues`.
   - `addDoc` to `folio_projects/{folioId}/subscribers`.
3. Unsubscribe link points to the same Folio origin with
   `?unsubscribe=<token>&folio=<id>`. The boot path
   (`_subUnsubscribeBoot`) detects these params, paints a centred
   overlay, and `_subUnsubscribeByToken` does a `where`-keyed
   query + `deleteDoc`. Works from any deep link, no reader-mode
   boot required.

## Email transport — Resend via Cloudflare Worker

The client never holds an API key. `_sendNewChapterEmail` POSTs a
JSON payload to the **folio-email Worker**, which holds the Resend
API key in a Worker secret and forwards to Resend's `/emails`
endpoint.

Why a Worker? Three reasons:

1. **Keeps the Resend key off the client.** The key in `index.html`
   would be world-readable.
2. **Per-IP rate limiting.** The Worker uses the Cloudflare cache
   as a sloppy counter (60 sends/hour per IP) so a stolen client
   can't spam.
3. **Provider abstraction.** To swap Resend for another transport
   (Brevo, SendGrid, SES, Mailchimp Transactional, Cloudflare
   Email Workers), change the Worker. The Folio app keeps calling
   `/send` with the same payload.

### Worker source

Lives at the repo root: `folio-email-worker.js`.

### Worker bindings

Set these in **Cloudflare dashboard → Workers → folio-email →
Settings → Variables**:

| Key | Type | Value |
| --- | --- | --- |
| `RESEND_API_KEY` | Secret (encrypted) | `re_...` from https://resend.com/api-keys |
| `FROM_EMAIL` | Plain text | `Folio <serials@folio.jacobsiler.com>` (must be a verified Resend sender on a verified domain) |
| `ALLOWED_ORIGIN` | Plain text | `https://folio.jacobsiler.com` (CSV OK for staging) |

### Resend domain verification

Before the Worker can send, the `FROM_EMAIL` domain must be
verified in Resend:

1. Resend dashboard → Domains → Add Domain → `folio.jacobsiler.com`
   (or whatever subdomain you want to send from).
2. Add the DNS records Resend gives you to Cloudflare DNS:
   - SPF (TXT)
   - DKIM (CNAMEs, three of them)
   - Optional: MX for return-path tracking.
3. Click Verify. Takes ~5 minutes.

Once the domain is green in Resend, the Worker can send from any
address `@folio.jacobsiler.com`.

### Activation checklist

1. Push `folio-email-worker.js` to Cloudflare:

       cd C:\dev\folio
       wrangler deploy folio-email-worker.js --name folio-email

   Or paste it into the Cloudflare dashboard's Quick Editor.

2. Note the deployed URL (e.g.
   `https://folio-email.jacobsiler.workers.dev`). Update the
   default in index.html if it differs:

       window.FOLIO_EMAIL_WORKER_URL = 'https://folio-email.<your-account>.workers.dev';

3. Set the bindings (`RESEND_API_KEY`, `FROM_EMAIL`,
   `ALLOWED_ORIGIN`) in the Worker dashboard.

4. Verify the Worker is alive:

       curl https://folio-email.jacobsiler.workers.dev/
       # → "folio-email worker OK"

5. Flip the flag in `index.html`:

       window.FOLIO_EMAIL_ENABLED = true;

   Or set it at runtime in devtools to test without redeploying.

6. Smoke test:
   - Publish a serial release with `notifyOnUnlock` on.
   - Subscribe with a test address from the reader view.
   - Click "Release next chapter now" in the editor.
   - Test inbox gets a real email; toast says "Notified 1 subscriber".

### Rollback

Set `window.FOLIO_EMAIL_ENABLED = false`. The same call site
falls back to console-logging the payload — no code changes
needed.

## Sender stub vs. live

`_sendNewChapterEmail(folioId, chapterIndex, subscriber, releaseMeta)`
builds this payload and dispatches:

    {
      folioId, chapterIndex, chapterTitle,
      folioTitle, folioAuthor,
      readerUrl, unsubscribeUrl,
      to: subscriber.email,
    }

- `FOLIO_EMAIL_ENABLED === false`: logs `[email stub] would send to
  …` to console, returns `{ ok: true, stub: true }`. Useful for
  testing the wiring without burning sends.
- `FOLIO_EMAIL_ENABLED === true`: POSTs to
  `${FOLIO_EMAIL_WORKER_URL}/send`. Worker validates the payload,
  rate-limits by IP, and forwards to Resend. Returns
  `{ ok: true, id }` on success.

## Hook surface

The release-next-chapter button (author dashboard) iterates
subscribers and fires the sender. Search for the comment
`// W3 — fire stub emails` inside `_serialReleaseNextChapter`.

The auto-cadence path (no manual button click — chapters unlock
themselves on the schedule) does NOT today fire emails. That needs
a server-side cron in the Worker, not a client tick. **TODO Phase 3**:
add a cron'd Worker route `/cron/sweep` that queries serial folios
where `auto_released_count > last_notified_count` and sends.

## Email template fields

The Worker (`folio-email-worker.js`) builds the HTML and plain-text
bodies inline — no template repo, no merge-variable dance. If you
want to redesign the email layout, edit the `buildEmail()` function
in the Worker and redeploy. The payload doesn't change.

The template includes a `List-Unsubscribe` header (RFC 8058) for
inbox-provider one-click unsubscribe, plus a footer link. Both
point at the same `?unsubscribe=...&folio=...` URL the reader
form generates.

## Cost on Resend's free tier

Resend free: 100 emails/day, 3000/month, 1 verified domain. For a
serial with a few hundred subscribers releasing weekly, that's
plenty. If you hit the cap, Resend's first paid tier is $20/month
for 50,000 emails — call it $0.0004/email.

The 60-sends-per-hour-per-IP rate limit on the Worker is a separate
abuse layer; it doesn't gate the author's button (the author's IP
sends one batch of N subscribers at click-time, well under the cap
for any realistic subscriber count).

## Testing the Worker locally

If you want to test the Worker without deploying:

    cd C:\dev\folio
    npx wrangler dev folio-email-worker.js --local

Then point the client at `http://localhost:8787`:

    window.FOLIO_EMAIL_WORKER_URL = 'http://localhost:8787';
    window.FOLIO_EMAIL_ENABLED = true;

You'll need `wrangler` configured with your Cloudflare account
and the bindings in `wrangler.toml` (or pass `--var
RESEND_API_KEY:re_...`). Wrangler's docs cover this.
