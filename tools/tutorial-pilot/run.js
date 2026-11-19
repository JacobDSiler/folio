// CLI runner for tutorial pilot scripts.
//
//   node run.js 01-hero
//   node run.js 02-gutenberg
//
// Each name maps to ./videos/<name>.js which must export a default
// async function (pilot) => { ... }.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pilot } from './pilot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const videoId = process.argv[2];
  if (!videoId) {
    console.error('\nUsage: node run.js <video-id>');
    console.error('Example: node run.js 01-hero\n');
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, 'videos', `${videoId}.js`);
  let mod;
  try {
    mod = await import(pathToFileURL(scriptPath).href);
  } catch (e) {
    console.error(`\nCouldn't load ./videos/${videoId}.js\n${e.message}\n`);
    process.exit(1);
  }
  const action = mod.default;
  if (typeof action !== 'function') {
    console.error(`\n./videos/${videoId}.js must export a default async function.\n`);
    process.exit(1);
  }

  const pilot = new Pilot({ videoId });
  try {
    await pilot.start();
    await action(pilot);
    await pilot.markEnd();
  } catch (e) {
    console.error('\nPilot aborted:', e.message);
    console.error(e.stack);
  } finally {
    await pilot.end();
  }
})();
