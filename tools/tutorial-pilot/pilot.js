// Folio tutorial-pilot framework.
//
// A reusable Playwright wrapper that produces deterministic,
// sub-second-timed tutorial recordings with a branded visible cursor
// and click-ring animations.
//
// Per-video action scripts (under ./videos/) only need the exposed
// high-level verbs: pilot.start(), pilot.hover(), pilot.click(),
// pilot.pauseFor(), pilot.markStart(), pilot.markEnd(), pilot.end().
//
// The framework also writes a sidecar JSON next to each recording
// listing every action's absolute T+ timestamp — ready to drop into
// your editor as a cue sheet, or to generate click-highlight overlays
// in post if you ever need them (built-in cursor + ring already covers
// most tutorials).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Brand palette — matches Folio's hero video style guide.
const BRAND = {
  amber:     '#c98c2a',
  green:     '#065f46',
  amberSoft: 'rgba(201, 140, 42, 0.22)',
  greenSoft: 'rgba(6, 95, 70, 0.25)',
};

// Cursor + click-ring injection. Runs on every page BEFORE site JS
// so it's always present. The cursor overlay follows the real mouse
// via mousemove events, so Playwright's `page.mouse.move(x, y, {steps})`
// produces a smooth animated trail. Click rings auto-pulse on every
// user-initiated click.
const CURSOR_SHIM = ({ brandAmber, brandGreen, brandAmberSoft }) => `
(() => {
  if (window.__pilot_cursor_installed) return;
  window.__pilot_cursor_installed = true;

  const AMBER      = ${JSON.stringify(brandAmber)};
  const AMBER_SOFT = ${JSON.stringify(brandAmberSoft)};
  const GREEN      = ${JSON.stringify(brandGreen)};
  const CURSOR_ID  = '__pilot_cursor';
  const STYLE_ID   = '__pilot_cursor_style';

  // Last known cursor coords; survives DOM detach between re-renders.
  let lastX = (typeof window !== 'undefined' ? window.innerWidth : 1920) / 2;
  let lastY = (typeof window !== 'undefined' ? window.innerHeight : 1080) / 2;

  const ensureCursor = () => {
    if (!document.documentElement) return null;
    let el = document.getElementById(CURSOR_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = CURSOR_ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = [
      'position:fixed',
      'width:28px', 'height:28px',
      'border-radius:50%',
      'border:3px solid ' + AMBER,
      'background:' + AMBER_SOFT,
      'box-shadow:0 2px 10px rgba(0,0,0,0.35), 0 0 0 1.5px rgba(255,255,255,0.65) inset',
      'pointer-events:none',
      'z-index:2147483647',
      'transform:translate(-50%, -50%)',
      'transition:left 90ms cubic-bezier(.22,.9,.32,1), top 90ms cubic-bezier(.22,.9,.32,1)',
      'left:' + lastX + 'px',
      'top:'  + lastY + 'px',
      'margin:0', 'padding:0',
      'contain:layout style',
    ].join(';');
    document.documentElement.appendChild(el);
    return el;
  };

  const ensureStyle = () => {
    const host = document.head || document.documentElement;
    if (!host) return;
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      // Hide the OS cursor across the whole page.
      'html,body,*{cursor:none !important}',
      '@keyframes __pilot_click_ring{',
        '0%{transform:translate(-50%,-50%) scale(0.4);opacity:1}',
        '100%{transform:translate(-50%,-50%) scale(2.6);opacity:0}',
      '}',
      '.__pilot_ring{',
        'position:fixed;width:48px;height:48px;border-radius:50%;',
        'border:3.5px solid ' + GREEN + ';',
        'pointer-events:none;z-index:2147483647;',
        'animation:__pilot_click_ring 650ms ease-out forwards',
      '}',
    ].join('');
    host.appendChild(s);
  };

  const paint = () => {
    const el = ensureCursor();
    if (!el) return;
    el.style.left = lastX + 'px';
    el.style.top  = lastY + 'px';
  };

  const onMove = (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    paint();
  };

  const onClick = (e) => {
    ensureStyle();
    if (!document.documentElement) return;
    const ring = document.createElement('div');
    ring.className = '__pilot_ring';
    ring.style.left = e.clientX + 'px';
    ring.style.top  = e.clientY + 'px';
    document.documentElement.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  };

  const install = () => {
    ensureStyle();
    ensureCursor();
    if (!window.__pilot_listeners_attached) {
      window.__pilot_listeners_attached = true;
      // capture:true so site-level stopPropagation can't silence us
      document.addEventListener('mousemove',  onMove,  { capture: true, passive: true });
      document.addEventListener('pointermove', onMove, { capture: true, passive: true });
      document.addEventListener('click', onClick, { capture: true });
    }
    // Reinject if Folio's render detaches us (SPA re-renders, modals).
    try {
      const obs = new MutationObserver(() => { ensureStyle(); ensureCursor(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.__pilot_mo = obs;
    } catch(e) {}
    // Belt-and-braces: a slow heartbeat that reinjects if everything
    // else fails. 500ms is imperceptible for a cursor overlay.
    setInterval(() => { ensureStyle(); ensureCursor(); paint(); }, 500);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
`;

export class Pilot {
  constructor(opts) {
    this.opts = {
      videoId: 'untitled',
      // Full HD. Matches YouTube's native target and makes the site
      // fill the Chromium window instead of letterboxing inside it.
      // If you want a smaller recording, override this and also drop
      // --window-size below to match.
      viewport: { width: 1920, height: 1080 },
      startUrl: 'https://onfolio.press/app.html',
      // User data dir for the persistent context. Living in the pilot
      // folder (gitignored). The sign-in you do in auth-setup.js is
      // persisted here forever; subsequent runs load with the account
      // already signed in.
      userDataDir: path.join(__dirname, 'chrome-profile'),
      outputDir: path.join(__dirname, 'output'),
      cursorMoveSteps: 20, // 20 interpolated frames per move — smooth
      // Use the user's installed stable Chrome (not Playwright's
      // Chrome for Testing build) because Google's OAuth sign-in
      // detects and blocks CfT. 'chrome' = Chrome Stable channel.
      // If you don't have Chrome Stable installed, change to undefined
      // to fall back to Chromium (sign-in may be more restricted).
      channel: 'chrome',
      ...opts,
    };
    this.events = []; // {t, kind, label, x?, y?, selector?}
    this.t0 = null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cursorX = 0;
    this.cursorY = 0;
  }

  // ── lifecycle ─────────────────────────────────────────────────

  async start() {
    await fs.mkdir(this.opts.outputDir, { recursive: true });
    await fs.mkdir(this.opts.userDataDir, { recursive: true });

    // Launch persistent context — uses the user's installed real
    // Chrome and keeps a dedicated profile directory. Google's OAuth
    // sign-in works here because:
    //   (a) channel:'chrome' uses Chrome Stable, not CfT
    //   (b) a persistent context looks like a normal profile, not
    //       the ephemeral automation context Google rejects
    //   (c) the init script below removes the navigator.webdriver
    //       flag that Google explicitly checks
    //
    // Sign-in persists in the user data dir, so once auth-setup.js
    // has been run, every pilot session loads already-signed-in.
    const { width, height } = this.opts.viewport;
    this.context = await chromium.launchPersistentContext(
      this.opts.userDataDir,
      {
        headless: false,
        channel: this.opts.channel, // 'chrome' = user's Chrome Stable
        viewport: this.opts.viewport,
        recordVideo: {
          dir: this.opts.outputDir,
          size: this.opts.viewport,
        },
        // Keep the Chrome sandbox enabled. Without this, Playwright
        // defaults to --no-sandbox and Chrome shows a yellow warning
        // banner at the top of every window — ugly in the recording.
        chromiumSandbox: true,
        args: [
          '--window-position=0,0',
          `--window-size=${width},${height}`,
          // --test-type is Chrome's own "I know what I'm doing"
          // signal: it suppresses the yellow "You are using an
          // unsupported command-line flag" warning banner that
          // Chrome Stable shows for any non-standard launch arg.
          '--test-type',
          // Reduce the "automation" fingerprints Google / reCAPTCHA
          // sniff for. Combined with the webdriver-flag removal
          // below, OAuth sign-in succeeds reliably. Also needed if
          // Google re-prompts for sign-in mid-session.
          '--disable-blink-features=AutomationControlled',
          // Hide the "Install Folio" PWA prompt + other infobars
          // that would otherwise appear across the top of recordings.
          '--disable-infobars',
          '--disable-features=InstalledAppProvider,TranslateUI,PrivacySandboxSettings4',
        ],
        // Suppress "Chrome is being controlled by automated test
        // software" infobar explicitly (defense in depth with the
        // --disable-infobars arg above).
        ignoreDefaultArgs: ['--enable-automation'],
        // Explicitly do NOT set a custom userAgent — using the real
        // Chrome's native UA makes us indistinguishable from a human.
      }
    );

    // Remove navigator.webdriver (set to true by default under
    // automation; Google's OAuth gate checks it). Also remove a few
    // other automation signals.
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Mask that we're running under CDP automation.
      if (window.chrome) {
        // noop — real Chrome has this
      } else {
        window.chrome = { runtime: {} };
      }
    });

    // Inject the branded cursor + click-ring shim BEFORE any site
    // script runs. Playwright calls this on every page load.
    await this.context.addInitScript(
      CURSOR_SHIM,
      {
        brandAmber: BRAND.amber,
        brandGreen: BRAND.green,
        brandAmberSoft: BRAND.amberSoft,
      }
    );

    // Persistent context opens with a default blank page; reuse it
    // instead of making a new one so the recording starts cleanly.
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.cursorX = this.opts.viewport.width / 2;
    this.cursorY = this.opts.viewport.height / 2;
    await this.page.mouse.move(this.cursorX, this.cursorY);

    this.t0 = Date.now();
    this._record('boot', 'pilot started');

    if (this.opts.startUrl) {
      await this.goto(this.opts.startUrl);
    } else {
      // No navigation needed, but still inject the cursor overlay
      // into whatever document is currently loaded.
      await this._injectCursor();
    }
  }

  async end() {
    this._record('end', 'pilot finished');

    // Stop audio if still playing.
    try {
      if (this._audioProc && !this._audioProc.killed) {
        this._audioProc.kill();
      }
    } catch (_) {}

    const videoPath = await this.page.video()?.path();
    await this.context.close(); // writes the .webm + closes Chrome

    // Write the sidecar event log next to the recording.
    const eventsFile = path.join(
      this.opts.outputDir,
      `${this.opts.videoId}.events.json`
    );
    await fs.writeFile(
      eventsFile,
      JSON.stringify({
        videoId: this.opts.videoId,
        startedAt: this.t0,
        totalDurationSec: this.events[this.events.length - 1].t,
        videoFile: videoPath ? path.basename(videoPath) : null,
        events: this.events,
      }, null, 2)
    );

    console.log('\n╔══ Pilot complete ══════════════════════════════════╗');
    console.log('║ Video file  :', videoPath || '(none)');
    console.log('║ Events file :', eventsFile);
    console.log('║ Duration    :', this.events[this.events.length - 1].t.toFixed(2) + 's');
    console.log('║ Events      :', this.events.length);
    console.log('╚═════════════════════════════════════════════════════╝\n');

    return { videoPath, eventsFile };
  }

  // ── high-level verbs each video script uses ───────────────────

  async goto(url, waitAfterSec = 1.5) {
    this._record('goto', url);
    // 'load' instead of 'networkidle' — Folio keeps live Firebase +
    // auth connections open indefinitely, so networkidle never fires
    // and the goto times out. 'load' waits for all synchronous
    // resources (scripts, stylesheets, images) which is what we
    // actually care about for a tutorial recording.
    await this.page.goto(url, { waitUntil: 'load', timeout: 30000 });
    // Re-inject the cursor shim directly into THIS document.
    // addInitScript is unreliable on persistent contexts with
    // existing pages — this guarantees the overlay appears every
    // time, including after Folio's own SPA navigations.
    await this._injectCursor();
    await this.pauseFor(waitAfterSec);
  }

  // Belt-and-braces cursor injection. Called after every navigation
  // AND once at pilot start. Safe to call multiple times — the shim
  // itself gates on window.__pilot_cursor_installed.
  async _injectCursor() {
    try {
      await this.page.evaluate(
        ({ brandAmber, brandGreen, brandAmberSoft, src }) => {
          // Guard — only inject once per document.
          if (window.__pilot_cursor_installed) {
            // Even if "installed", force the overlay to exist in the
            // current document (SPA navigations can leave the flag
            // true but the overlay element detached).
            if (!document.getElementById('__pilot_cursor')) {
              window.__pilot_cursor_installed = false;
            } else {
              return 'already installed';
            }
          }
          // Rebuild from source string so it closures over the brand
          // palette values the caller passed in.
          // eslint-disable-next-line no-new-func
          new Function(src)();
          return 'injected';
        },
        {
          brandAmber: BRAND.amber,
          brandGreen: BRAND.green,
          brandAmberSoft: BRAND.amberSoft,
          src: CURSOR_SHIM({
            brandAmber: BRAND.amber,
            brandGreen: BRAND.green,
            brandAmberSoft: BRAND.amberSoft,
          }),
        }
      );
    } catch (e) {
      // Non-fatal — recording continues even if cursor overlay fails.
      console.warn('[pilot] cursor shim injection failed:', e.message);
    }
  }

  // Smooth animated mouse move. Target = either a selector string or
  // {x, y} coordinates. Visible cursor overlay interpolates between
  // Playwright's `steps` ticks via CSS transitions.
  async moveTo(target, { durationMs = 400 } = {}) {
    const point = await this._resolvePoint(target);
    const steps = Math.max(
      3,
      Math.round((durationMs / 1000) * this.opts.cursorMoveSteps)
    );
    await this.page.mouse.move(point.x, point.y, { steps });
    this.cursorX = point.x;
    this.cursorY = point.y;
    this._record('move', typeof target === 'string' ? target : `(${point.x},${point.y})`, point);
  }

  // Click a selector or coordinates. Moves cursor there first (so the
  // click ring lands over the visible cursor), then clicks.
  async click(target, { moveMs = 400, settleAfterSec = 0.6 } = {}) {
    await this.moveTo(target, { durationMs: moveMs });
    await this.page.mouse.down();
    await this.page.mouse.up();
    this._record('click', typeof target === 'string' ? target : `(${this.cursorX},${this.cursorY})`);
    if (settleAfterSec > 0) await this.pauseFor(settleAfterSec);
  }

  // Fire a page-level function call. Use this for things the UI makes
  // hard to click (e.g. opening the release modal via openReleaseModal()
  // instead of hunting for the toolbar button). Still records as an event.
  async eval(script, label = 'eval') {
    const result = await this.page.evaluate(script);
    this._record('eval', label);
    return result;
  }

  // Idle hold — the primary pacing primitive.
  async pauseFor(seconds) {
    await this.page.waitForTimeout(Math.round(seconds * 1000));
    this._record('pause', `${seconds}s`);
  }

  // Scroll a container by N wheel ticks (standard tutorial scroll).
  async scroll(target, dy = 240, { settleAfterSec = 0.3 } = {}) {
    await this.moveTo(target, { durationMs: 300 });
    await this.page.mouse.wheel(0, dy);
    this._record('scroll', `dy=${dy}`);
    if (settleAfterSec > 0) await this.pauseFor(settleAfterSec);
  }

  // Keyboard shortcut (e.g. Escape to close a modal).
  async key(name) {
    await this.page.keyboard.press(name);
    this._record('key', name);
  }

  // Play an audio file alongside the pilot. Useful for having the
  // AI narration play in your ears so you can (a) feel the rhythm
  // as the pilot runs and (b) time any manual actions (e.g. drag
  // a file in) to the narrated beats.
  //
  // Uses ffplay (shipped with ffmpeg; already installed on your
  // machine). The audio is NOT recorded into the .webm — Playwright
  // only captures the browser pane's visual stream. Audio is for
  // the person watching the pilot run only.
  async playAudio(filePath) {
    try {
      // -nodisp = no window; -autoexit = quit when file ends;
      // -loglevel error = don't spam the terminal.
      this._audioProc = spawn(
        'ffplay',
        ['-nodisp', '-autoexit', '-loglevel', 'error', filePath],
        { stdio: 'ignore', detached: false }
      );
      this._audioProc.on('error', (err) => {
        console.warn('[pilot] ffplay failed:', err.message,
          '— continuing without audio. Install ffmpeg to enable.');
      });
      this._record('audio', `play: ${path.basename(filePath)}`);
    } catch (e) {
      console.warn('[pilot] playAudio failed:', e.message);
    }
  }

  // Hold the pilot and let the human do something manual (drag a
  // file in, approve a dialog, etc). Prints a loud reminder in the
  // terminal and still records the pause so the composite timeline
  // stays honest.
  //
  //   await p.waitForHuman('Drag frankenstein.docx into the import area', 10);
  //
  // The pilot keeps the cursor still during this window so the
  // viewer's eye lands on whatever you drop in.
  async waitForHuman(message, seconds) {
    console.log('\n╔══ HUMAN ACTION REQUIRED ═══════════════════════════╗');
    console.log('║ ' + message.padEnd(50) + ' ║');
    console.log(`║ Pilot pauses for ${seconds}s — do your thing now`.padEnd(55) + ' ║');
    console.log('╚═════════════════════════════════════════════════════╝');
    this._record('human', message + ` (${seconds}s window)`);
    await this.page.waitForTimeout(seconds * 1000);
  }

  // Open-ended hold — pilot waits as long as it takes for you to
  // press Enter in the terminal. Use for actions whose duration you
  // can't predict (file drag + click Split + wait for Folio to
  // re-render the chapter list, etc.).
  //
  //   await p.waitForEnter('Drag file, click Split, wait for preview');
  async waitForEnter(message) {
    const readline = await import('node:readline');
    console.log('\n╔══ WAITING FOR YOU ═════════════════════════════════╗');
    console.log('║ ' + message.padEnd(50) + ' ║');
    console.log('║ Press ENTER in this terminal when you want to      ║');
    console.log('║ continue to the next step.                         ║');
    console.log('╚═════════════════════════════════════════════════════╝');
    this._record('wait-enter', message);
    await new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
    this._record('resume', 'enter pressed');
  }

  // Markers for the editor — collapse Shortcuts panel at start,
  // expand at end. These are the visual IN/OUT points for OBS/post.
  async markStart() {
    await this._toggleShortcuts();
    this._record('mark', 'START');
  }

  async markEnd() {
    await this._toggleShortcuts();
    this._record('mark', 'END');
  }

  // ── internals ─────────────────────────────────────────────────

  _record(kind, label, point = {}) {
    const tSec = (Date.now() - this.t0) / 1000;
    this.events.push({
      t: Number(tSec.toFixed(3)),
      kind,
      label,
      ...point,
    });
    const ts = `[${tSec.toFixed(2).padStart(7, ' ')}s]`;
    console.log(`${ts} ${kind.padEnd(6)} ${label}`);
  }

  async _resolvePoint(target) {
    if (target && typeof target === 'object' && 'x' in target && 'y' in target) {
      return { x: target.x, y: target.y };
    }
    if (typeof target === 'string') {
      // Treat as selector; return its centre.
      const el = this.page.locator(target).first();
      await el.waitFor({ state: 'visible', timeout: 10000 });
      const box = await el.boundingBox();
      if (!box) throw new Error(`No bounding box for ${target}`);
      return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      };
    }
    throw new Error('Target must be {x,y} or a selector string');
  }

  async _toggleShortcuts() {
    // The Shortcuts header's text is unique in the sidebar; find the
    // nearest clickable ancestor and click it. Robust across minor
    // DOM refactors.
    await this.page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('*')).find(
        el => el.textContent?.trim() === 'Shortcuts' && el.children.length === 0
      );
      const target = h?.closest('button') || h?.closest('[onclick]') || h?.parentElement;
      target?.click();
    });
    await this.page.waitForTimeout(400);
  }
}
