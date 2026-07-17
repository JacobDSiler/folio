# Fix: Firebase auth/unauthorized-domain error

*You're seeing "Sign-in failed: Firebase: Error (auth/unauthorized-domain)"
in the Folio admin console or app.html sign-in flow.*

## What's actually happening

Firebase Auth won't complete a Google sign-in from a domain unless
that domain is on its explicit "Authorized Domains" list. Your
current config uses `authDomain: "auth.jacobsiler.com"` for the auth
iframe. The site itself has to also be on the allowlist — otherwise
Firebase blocks the callback.

The domains that MUST be authorized:
- `www.onfolio.press` — your primary hosting domain
- `onfolio.press` — the bare domain (some users type it without www)
- `auth.jacobsiler.com` — where the auth iframe lives (already there
  by definition, but worth checking)
- `localhost` — for local dev (Firebase adds this by default)

The odd behaviour with "new UID every sign-in" happens because when
the OAuth popup fails, the client-side auth state falls back to what
the browser cached from a *different* Firebase Auth session — often
one from a different Google account you've been signed into.

## Fix (5 minutes, in Firebase Console)

1. Open https://console.firebase.google.com/project/miscellaneous-117e9/authentication/settings
2. Scroll to **Authorized domains**
3. Click **Add domain** and add each of these that isn't already there:
   - `www.onfolio.press`
   - `onfolio.press`
   - `auth.jacobsiler.com`
   - `folio.press` — only if you plan to serve the app from there too
4. Save.
5. Hard-refresh your admin page (Ctrl+Shift+R) and try Sign in with Google again.

## The folio.press vs onfolio.press confusion

**Your site is at `onfolio.press`, not `folio.press`.** They're
different registered domains. If typing `folio.press` in the address
bar takes you somewhere that shows an HTTP-warning page, one of two
things is true:

**Case A: You don't actually own `folio.press`.**
Someone else registered it. Typing it in the URL bar just resolves
to whatever they've parked at that domain, or a browser suggestion
of your recent site. Nothing to fix — just type the real URL:
`https://www.onfolio.press`.

**Case B: You do own `folio.press` and want it to redirect to onfolio.press.**
Set up a 301 redirect at your DNS host:
- If domain is on Cloudflare: add a Page Rule
  `folio.press/*` → `https://www.onfolio.press/$1` (301 permanent)
- If on Namecheap / GoDaddy / other: use their URL forwarding feature
  with the same 301 setup. Enable "HTTPS" or "SSL forwarding".

Test: after DNS propagates (~10 min), typing `folio.press` in any
browser should silently land you at `https://www.onfolio.press`
with no HTTPS warning.

## Why you don't own `folio.press` (probably)

Short domains without the "on" prefix are usually taken. Domain
squatters buy up any noun.tld combo and hold it hostage. The good
news: `onfolio.press` is your brand — no one associates it with the
generic word "folio", so this hurts less than you might think.

If you want `folio.press` to serve the app, you'll need to buy it.
Check availability at your registrar; low-traffic .press domains
often go for ~$50-100/year.

## While you're in the Firebase Console

Consider also:
- **Enable "Multi-factor authentication"** — Authentication → Sign-in
  method → Advanced. Recommended for admin accounts.
- **Review "Authorized domains"** for any stale/dev domains you
  don't recognize. Remove them — they're an unnecessary attack
  surface.
