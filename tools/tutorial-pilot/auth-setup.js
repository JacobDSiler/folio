// One-time auth setup for the tutorial pilot.
//
// Run this ONCE:   node auth-setup.js
//
// It opens the user's REAL Chrome (not Playwright's Chrome for
// Testing — Google blocks CfT for OAuth). You sign in to Folio
// manually with Google, then press Enter in the terminal and the
// window closes. The sign-in lives in ./chrome-profile/ from now on;
// every pilot run loads with the account already signed in.
//
// If Google ever logs the test account out (rare), re-run this.

import { chromium } from 'playwright';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.join(__dirname, 'chrome-profile');

const wait = () => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n→ Sign in to Folio in the window, then press Enter here… ', () => {
    rl.close();
    resolve();
  });
});

(async () => {
  console.log('\n╔══ Folio tutorial-pilot — auth setup ══════════════════════╗');
  console.log('║ 1. A real Chrome window will open at onfolio.press        ║');
  console.log('║ 2. Click Sign in → use the account you want for the      ║');
  console.log('║    tutorial videos (jacob.siler91@gmail.com usually)      ║');
  console.log('║ 3. Google OAuth should work normally — if it says         ║');
  console.log('║    "browser not secure", make sure Chrome Stable is       ║');
  console.log('║    installed (not Chromium / not Chrome for Testing)      ║');
  console.log('║ 4. When fully signed in and you see the editor,          ║');
  console.log('║    come back to this terminal and press Enter            ║');
  console.log('║ 5. chrome-profile/ is written; close happens automatic   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  await fs.mkdir(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome', // use installed Chrome Stable, not CfT
    viewport: { width: 1280, height: 720 },
    chromiumSandbox: true,
    args: [
      '--window-position=100,80',
      '--window-size=1280,720',
      '--test-type', // suppresses Chrome's "unsupported flag" warning
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Mask automation signals (same as pilot.js) so Google OAuth works.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://onfolio.press/app.html');

  await wait();

  await context.close();
  console.log(`\n✓ Profile saved to: ${USER_DATA_DIR}`);
  console.log('  (gitignored — safe locally.)\n');
  console.log('  You can now run:  npm run run:01-hero\n');
})();
