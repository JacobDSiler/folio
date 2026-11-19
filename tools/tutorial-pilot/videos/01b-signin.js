// Video 1 — Shot B: Sign in with Google
// Target length: ~40s. Narration: "Head to onfolio.press... sign in with Google..."
//
// The test account is already signed in via the chrome-profile; this
// shot visually hovers around the sidebar sign-in area while the
// narration explains the sign-in benefit. (If you want to film an
// actual sign-in flow instead, sign out first in Folio — then this
// shot can click Sign in and complete the Google popup live.)
//
// Run: node run.js 01b-signin

export default async function shotB(p) {
  await p.eval(`
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '✍ Write')?.click();
    window.scrollTo(0, 0);
  `, 'reset to Write tab');
  await p.pauseFor(1);

  const SIDEBAR_X = 180;

  await p.markStart();

  // Hover around the top of the sidebar — the account/sign-in zone.
  await p.moveTo({ x: SIDEBAR_X, y: 90 }, { durationMs: 900 });
  await p.pauseFor(10);
  await p.moveTo({ x: SIDEBAR_X, y: 180 }, { durationMs: 700 });
  await p.pauseFor(12);
  await p.moveTo({ x: SIDEBAR_X, y: 260 }, { durationMs: 700 });
  await p.pauseFor(12);
}
