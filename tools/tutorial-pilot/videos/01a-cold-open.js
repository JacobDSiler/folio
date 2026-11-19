// Video 1 — Shot A: Cold open (hero intro)
// Target length: ~25s. Narration: "You have a story..."
//
// Pre-conditions:
//   - Signed into Folio (chrome-profile has valid session)
//   - A folio with real content is the active one in your account
//     (open your demo folio in auth-setup first if it's "Untitled")
//
// Run: node run.js 01a-cold-open

export default async function shotA(p) {
  // Reset to Write tab, clean preview, no modals.
  await p.eval(`
    document.querySelectorAll('button').forEach(b => {
      if (b.getAttribute('aria-label')?.toLowerCase().includes('dismiss')
          || b.textContent?.trim() === '×') b.click();
    });
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    if (document.documentElement.classList.contains('dark')
        || document.body.classList.contains('dark')) {
      document.getElementById('darkModeBtn')?.click();
    }
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '✍ Write')?.click();
    window.scrollTo(0, 0);
  `, 'pre-roll cleanup');
  await p.pauseFor(1.5);

  const PREVIEW_X = Math.round(p.opts.viewport.width * 0.6);

  await p.markStart();

  // Hold on preview with slow cursor drifts so it feels alive.
  await p.moveTo({ x: PREVIEW_X, y: 350 }, { durationMs: 1200 });
  await p.pauseFor(8);
  await p.moveTo({ x: PREVIEW_X, y: 500 }, { durationMs: 1000 });
  await p.pauseFor(8);
  await p.moveTo({ x: PREVIEW_X, y: 650 }, { durationMs: 1000 });
  await p.pauseFor(5);

  // End marker fires automatically from run.js.
}
