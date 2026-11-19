// Video 1 — Shot D: Design tab + theme + cover
// Target length: ~40s. Narration: "Switch over to the Design tab..."
//
// Run: node run.js 01d-design

export default async function shotD(p) {
  await p.eval(`
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    // Make sure we're starting from the Write tab so the Design-tab
    // click is a visible transition.
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '✍ Write')?.click();
    window.scrollTo(0, 0);
  `, 'reset to Write tab');
  await p.pauseFor(1);

  const SIDEBAR_X = 180;

  await p.markStart();

  // Click Design tab — visible transition.
  await p.click('button:has-text("🎨 Design")');
  await p.pauseFor(3);

  // Scroll the sidebar down to reveal the theme grid.
  await p.scroll({ x: SIDEBAR_X, y: 400 }, 500, { settleAfterSec: 1.5 });

  // Hover a theme then click it. Try to find Sage by text; fall back
  // to a coordinate inside the theme grid if the selector misses.
  const sageSelector = 'button:has-text("Sage"), [data-theme="sage"], .theme-card:has-text("Sage")';
  try {
    await p.moveTo(sageSelector, { durationMs: 800 });
  } catch {
    await p.moveTo({ x: 150, y: 400 }, { durationMs: 800 });
  }
  await p.pauseFor(2);
  await p.click({ x: 150, y: 400 });
  await p.pauseFor(5);

  // Hover the accent-colour row below the theme grid.
  await p.moveTo({ x: 120, y: 620 }, { durationMs: 800 });
  await p.pauseFor(8);
}
