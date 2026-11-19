// Video 1 — Shot E: Release modal → tick → publish
// Target length: ~75s. Narration: "Ready? Hit the Release button..."
//
// This is the longest shot in the video. All interactions are
// visible: the modal scrolls smoothly between fields, the Shelf
// toggle and attestation click rings pulse, Publish lands with a
// visible click ring.
//
// Run: node run.js 01e-release

export default async function shotE(p) {
  await p.eval(`
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    // Any open modal needs to be closed before we start — Escape
    // handles it harmlessly if nothing is open.
    document.querySelectorAll('[role="dialog"], .modal').forEach(m => {
      m.style.display = '';
    });
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '✍ Write')?.click();
    window.scrollTo(0, 0);
  `, 'reset');
  await p.key('Escape');
  await p.pauseFor(1);

  await p.markStart();

  // Open the release modal via its JS function (toolbar button is
  // small; the modal itself has stable IDs we can target reliably).
  await p.eval('openReleaseModal()', 'open release modal');
  await p.pauseFor(3);

  // Hover each access-mode button in sequence as Allyson narrates
  // "Public and free is the default — Paid if you want to sell it,
  //  or Private link..."
  await p.moveTo('#rlModePaid', { durationMs: 700 });
  await p.pauseFor(4);
  await p.moveTo('#rlModePriv', { durationMs: 500 });
  await p.pauseFor(4);
  await p.moveTo('#rlModeFree', { durationMs: 500 });
  await p.pauseFor(3);

  // Hover description.
  await p.moveTo('#rlDescField', { durationMs: 700 });
  await p.pauseFor(5);

  // Smooth-scroll Shelf toggle into view, then click it.
  await p.eval(
    `document.getElementById('rlListOnShelf')?.scrollIntoView({behavior:'smooth', block:'center'})`,
    'scroll shelf toggle into view'
  );
  await p.pauseFor(1.5);
  await p.click('#rlListOnShelf', { moveMs: 600 });
  await p.pauseFor(3);

  // Smooth-scroll attestation into view, then click it.
  await p.eval(
    `document.getElementById('rlRightsAttest')?.scrollIntoView({behavior:'smooth', block:'center'})`,
    'scroll attestation into view'
  );
  await p.pauseFor(1.5);
  await p.click('#rlRightsAttest', { moveMs: 600 });
  await p.pauseFor(3);

  // Smooth-scroll to Publish button.
  await p.eval(
    `document.getElementById('rlPublishBtn')?.scrollIntoView({behavior:'smooth', block:'center'})`,
    'scroll publish into view'
  );
  await p.pauseFor(1.5);

  // Hover for the climactic beat as Allyson narrates "Click Release."
  await p.moveTo('#rlPublishBtn', { durationMs: 800 });
  await p.pauseFor(2);

  // THE moment — real click.
  await p.click('#rlPublishBtn');
  await p.pauseFor(6);

  // Hover the share-link area that appears post-publish.
  await p.moveTo('#rlUrlBox', { durationMs: 600 }).catch(() => {});
  await p.pauseFor(5);
}
