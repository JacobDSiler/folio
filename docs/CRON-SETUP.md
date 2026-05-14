# Folio — Scheduled serial-email cron setup

This is a one-time setup. Once it's done, the `folio-email` worker will
automatically email subscribers when a **scheduled** serial chapter
unlocks — closing the gap where cadence-based unlocks (vs. the author's
manual "Release next chapter now" button) notified nobody.

You only need this if you use serial releases with a **cadence** (weekly
/ biweekly / monthly / custom). Manual releases already email on the
button press and don't need any of this.

---

## What the cron actually does

Every tick (hourly is recommended) the worker:

1. Reads every `folio_projects` document from Firestore.
2. Keeps the ones that are a **published serial**.
3. Works out how many chapters *should* be unlocked right now — the same
   cadence math the app uses — capped at the folio's chapter count.
4. Compares that to `release.serialEmailedThrough`, a high-water mark the
   worker writes and owns.
5. Emails every subscriber once for each chapter that newly crossed its
   unlock time.
6. Bumps `serialEmailedThrough` so no chapter is ever emailed twice.

**First contact is a "baseline" run.** The very first time the cron sees
a serial that has no `serialEmailedThrough` field yet, it just records
the current count and sends *nothing*. That's deliberate — it means
switching the cron on won't blast every already-released chapter to
every existing subscriber. Real emails start from the *next* chapter
that unlocks after the baseline.

It needs Firestore access, and a Cloudflare Worker can't use the Firebase
SDK / your security rules. Instead it authenticates with a **Google
service account**, which goes through Google IAM — so **your Firestore
security rules do not need to change**.

---

## Step 1 — Create the service account

1. Go to <https://console.cloud.google.com/> and pick the project that
   backs your Firebase app (same project id as in your Firebase config).
2. **IAM & Admin → Service Accounts → + Create service account**.
3. Name it something like `folio-email-cron`. Click **Create and
   continue**.
4. Under **Grant this service account access**, add the role
   **Cloud Datastore User** (this is the role that covers Firestore
   reads + writes). Click **Continue**, then **Done**.

## Step 2 — Create a JSON key

1. Click the new service account, open the **Keys** tab.
2. **Add key → Create new key → JSON → Create**.
3. A `.json` file downloads. **This is a secret** — treat it like a
   password. You'll paste its entire contents into Cloudflare next.

## Step 3 — Add the secrets to the worker

In the Cloudflare dashboard: **Workers & Pages → folio-email →
Settings → Variables and Secrets**.

Add these (use **Encrypt / Secret** for the secret ones):

| Name                  | Type   | Value |
|-----------------------|--------|-------|
| `GCP_SERVICE_ACCOUNT` | Secret | The **entire contents** of the JSON key file from Step 2 — open it in a text editor, select all, paste. |
| `CRON_TRIGGER_KEY`    | Secret | *Optional.* Any long random string. Setting this enables the manual test endpoint (Step 5). You can delete it afterward. |

You do **not** normally need `FIRESTORE_PROJECT_ID` — the worker reads
the project id out of the service-account JSON. Only set it if you ever
need to override that.

`APP_PATH` defaults to `/app.html` and only needs setting if your reader
ever moves off that path.

(`RESEND_API_KEY`, `FROM_EMAIL`, and `ALLOWED_ORIGIN` are already set
from the existing email setup — the cron reuses them. The first entry of
`ALLOWED_ORIGIN` is used as the base URL for the links in cron emails.)

## Step 4 — Add the Cron Trigger

Still in **folio-email → Settings → Triggers → Cron Triggers**:

1. **+ Add Cron Trigger**.
2. Enter `0 * * * *` (top of every hour). Hourly is plenty — the cron
   only emails when a chapter has actually crossed its unlock time.
3. Save.

Then **redeploy the worker** so the new `scheduled()` handler and the
new code are live (a fresh deploy of the current `folio-email-worker.js`).

## Step 5 — Test it without waiting an hour

If you set `CRON_TRIGGER_KEY` in Step 3, you can trigger a run on demand:

```
https://folio-email.jacobdsiler.workers.dev/cron-run?key=YOUR_CRON_TRIGGER_KEY
```

Open that in a browser. You'll get back JSON like:

```json
{ "ok": true, "summary": { "folios": 4, "serials": 1, "baselined": 1,
  "foliosEmailed": 0, "sent": 0, "failed": 0, "errors": [] } }
```

- The **first** run on each serial shows up under `baselined` and sends
  nothing — that's the expected baseline behavior.
- Run it again *after* a chapter's unlock time passes and you'll see
  `foliosEmailed` and `sent` climb.

To watch live logs while it runs, use `wrangler tail folio-email` or the
worker's **Logs** tab in the dashboard — look for `[cron]` lines.

When you're done testing you can remove `CRON_TRIGGER_KEY` to disable the
manual endpoint; the scheduled tick keeps working without it.

---

## Good to know

- **The cron notifies *current* subscribers at the unlock moment.** It is
  not a catch-up/welcome system — someone who subscribes *after* Ch 5
  unlocked won't get a Ch 5 email; they'll just see Ch 5 already open
  when they read. A "here's what you missed" welcome email for new
  subscribers is a separate feature, not this one.
- **Manual + scheduled coexist.** If you hit "Release next chapter now"
  in the editor, that emails immediately (unchanged). The cron's
  high-water mark accounts for it, so a chapter won't be double-emailed.
- **One bad folio won't wedge the run.** Each folio is processed in its
  own try/catch; failures are logged under `errors` in the summary and
  the rest still run.
- **Safety cap.** A single run won't send more than 200 emails — a brake
  against a runaway burst. If you ever hit that, it's logged in `errors`
  and the next run picks up where it left off.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `GCP_SERVICE_ACCOUNT not configured` | Secret not set (or set on the wrong worker). |
| `GCP_SERVICE_ACCOUNT is not valid JSON` | Pasted something other than the full JSON file contents. |
| `Token exchange failed` | The service-account key was revoked, or the system clock is off. Recreate the key. |
| `Firestore list … failed: 403` | The service account is missing the **Cloud Datastore User** role. |
| `Firestore patch … failed` | Same role issue, or the folio doc was deleted mid-run. |
| Emails never arrive but summary looks fine | Check `RESEND_API_KEY` / `FROM_EMAIL` — same wiring as `/test`. Try `GET /test?to=you@example.com`. |
| Everything `baselined`, nothing sent | Expected on first run. Wait for the next real unlock, or temporarily set the serial's first-release date in the past and re-run. |
