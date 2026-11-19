// Video 1 — Shot C: Import a manuscript
// Target length: ~35s (variable — depends on your drag speed)
// Narration: "Now, your own writing. If you have a Word document..."
//
// This shot requires HUMAN ACTION:
//   1. Pilot moves cursor to the import drop zone
//   2. Pilot pauses — you drag your sample .docx into the browser
//   3. You click "Split into chapters" (or whatever Folio prompts)
//   4. Preview updates with imported content
//   5. You press ENTER in the terminal to continue
//   6. Pilot moves cursor to preview to point at inline edit
//
// Run: node run.js 01c-import

export default async function shotC(p) {
  await p.eval(`
    const r = document.getElementById('readerPreviewBtn');
    if (r?.textContent?.includes('Resume')) r.click();
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '✍ Write')?.click();
    window.scrollTo(0, 0);
  `, 'reset to Write tab');
  await p.pauseFor(1);

  const SIDEBAR_X = 180;
  const PREVIEW_X = Math.round(p.opts.viewport.width * 0.6);

  await p.markStart();

  // Cursor glides to the import drop zone and holds.
  await p.moveTo({ x: SIDEBAR_X, y: 330 }, { durationMs: 900 });
  await p.pauseFor(3);

  // Open-ended pause. Jacob drags the file, clicks Split into
  // chapters, waits for the preview to render, THEN presses Enter
  // to continue. No timing pressure.
  await p.waitForEnter(
    'Drag your .docx into the drop zone, click Split into chapters, ' +
    'wait for preview to render — then press ENTER'
  );

  // Preview is now populated with imported chapters. Move cursor to
  // the preview to show the "or click to type directly" affordance.
  await p.moveTo({ x: PREVIEW_X, y: 500 }, { durationMs: 1100 });
  await p.pauseFor(6);
  await p.moveTo({ x: PREVIEW_X, y: 650 }, { durationMs: 700 });
  await p.pauseFor(4);
}
