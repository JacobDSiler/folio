// Video 1 — Shot F: Reader view + dark mode + close
// Target length: ~40s. Narration: "Here's what your reader sees..."
//
// Run: node run.js 01f-reader

export default async function shotF(p) {
  // Pre-roll: close any lingering modal, make sure we're NOT already
  // in reader-preview, make sure light mode is active for the toggle
  // to be a visible dark-flip during the shot.
  await p.key('Escape');
  await p.eval(`
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    if (document.documentElement.classList.contains('dark')
        || document.body.classList.contains('dark')) {
      document.getElementById('darkModeBtn')?.click();
    }
    window.scrollTo(0, 0);
  `, 'reset');
  await p.pauseFor(1);

  const PREVIEW_X = Math.round(p.opts.viewport.width * 0.6);

  await p.markStart();

  // Enter reader-preview mode (click the toolbar's Preview-as-reader).
  await p.eval(
    `document.getElementById('readerPreviewBtn')?.click()`,
    'enter reader preview'
  );
  await p.pauseFor(4);

  // Scroll a little to show reader scroll works.
  await p.scroll({ x: PREVIEW_X, y: 500 }, 500, { settleAfterSec: 2 });

  // Toggle dark mode for the "dark mode for the late nights" beat.
  await p.eval(
    `document.getElementById('darkModeBtn')?.click()`,
    'toggle dark'
  );
  await p.pauseFor(5);

  // One more scroll in dark mode.
  await p.scroll({ x: PREVIEW_X, y: 500 }, 600, { settleAfterSec: 2 });
  await p.pauseFor(3);

  // Clean up for end marker — back to light + exit reader preview.
  await p.eval(`
    if (document.documentElement.classList.contains('dark')
        || document.body.classList.contains('dark')) {
      document.getElementById('darkModeBtn')?.click();
    }
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
  `, 'reset for end marker');
  await p.pauseFor(2);
}
