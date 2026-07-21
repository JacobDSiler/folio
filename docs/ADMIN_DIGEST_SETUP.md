# Admin daily digest — setup runbook

*Shipped 2026-07-20 (task #17).*

The admin email digest scans `folio_projects` daily for pending shelf
moderation items and emails a summary to each address in the digest
recipient list. Max one email per 20-hour window regardless of how
many times triggered.

---

## One-time setup (Cloudflare Workers)

Run each of these in the folio repo root. Values are pastes from your
own accounts — nothing you set here ever hits the git repo.

### 1. Configure recipient email addresses

The addresses that should receive the digest. Comma-separated. These
are ideally your admin + moderator inboxes.

```bash
wrangler secret put ADMIN_DIGEST_EMAILS --config wrangler-email.toml
# When prompted, paste:  jacob@yourdomain.com,moderator2@example.com
```

If you only want yourself for now:

```
jacob.siler91@gmail.com
```

### 2. Confirm ADMIN_DEBUG_TOKEN is set

Used for manual trigger via `/admin-digest?key=…` — must already be
set for other paywall debug endpoints. Verify:

```bash
wrangler secret list --config wrangler-email.toml
# Look for ADMIN_DEBUG_TOKEN in the output
```

If missing, set with a random string:

```bash
wrangler secret put ADMIN_DEBUG_TOKEN --config wrangler-email.toml
# When prompted, paste a long random string you keep somewhere safe
```

### 3. Add a daily cron trigger to wrangler config

Add this block to your email-worker `wrangler.toml` (or wherever the
email worker's Wrangler config lives — check what `runCron` currently
uses):

```toml
[triggers]
crons = ["0 9 * * *"]  # every day at 09:00 UTC
```

If a `[triggers]` block already exists (from the existing
serial-release cron), skip this — the same cron tick fires BOTH jobs.

### 4. Deploy the email worker

```bash
wrangler deploy --config wrangler-email.toml
# or the deploy script that covers this worker
```

---

## Test it (before waiting 20 hours)

Manual trigger via URL:

```
https://folio-email.jacobsiler.workers.dev/admin-digest?key=YOUR_ADMIN_DEBUG_TOKEN&force=1
```

`force=1` bypasses the 20-hour latch so you can retest immediately.
Returns JSON with what happened:

```json
{
  "ok": true,
  "result": {
    "pending": 3,
    "sent": 1,
    "failed": 0,
    "skipped": null,
    "errors": []
  }
}
```

Check the inbox of every address in `ADMIN_DIGEST_EMAILS`. You should
see a beige email with the folio count + a preview table (top 10) +
a green "Open the moderation queue →" button linking to `/admin/shelf/`.

---

## Latch behavior

- Latch doc: `folio_admin_digest_state/latch`
- Fields: `lastSentMs` (timestamp of last successful send), `lastPendingCount`, `lastRecipients`
- Cron fires many times per day (even if you set `0 9 * * *`, Cloudflare may fire once) — the latch check inside `runAdminDigest` skips if the last send was <20h ago
- Force parameter (`?force=1`) bypasses the latch for testing / re-send after fixing something

---

## What the email contains

- Header: **✨ Folio · Moderation queue**
- Subject: `N folios awaiting review on Folio` (singular/plural correct)
- Preview table (up to 10 rows): Title + Author, sorted by most-recently-listed
- If more than 10: "…and N more."
- Call-to-action: **Open the moderation queue →** button linking to `/admin/shelf/`
- Footer: quiet reminder that this sends max once per 20h

---

## When the digest DOES NOT send

- `ADMIN_DIGEST_EMAILS` not configured or empty → `skipped: "ADMIN_DIGEST_EMAILS not configured"`
- No valid email addresses in the list → `skipped: "ADMIN_DIGEST_EMAILS had no valid addresses"`
- Last send was within 20 hours → `skipped: "latched — last sent Nh ago"`
- Zero pending items AND not forced → `skipped: "no pending items"`

All show up in the JSON response so you always know why it didn't send.

---

## Future ideas (not shipped)

- Per-admin opt-in via `folio_admin_settings/{uid}.digestEmail`
- Digest frequency setting (daily / weekly / immediate)
- Include reviews queue count, boost fulfillment queue count
- Slack webhook alternative for admins who prefer Slack
