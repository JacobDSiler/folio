// Stitch per-shot .webm clips into a single MP4 with subtitles burned in.
//
//   node stitch.js 01
//
// Scans output/ for the most recently created .webm files, pairs them
// to the videos/01*.js scripts you've run, concatenates them in a→b→c
// order, burns in VO/AI/script-00.srt as hard subtitles, and writes
// output/01-hero-stitched.mp4 ready to hand to Allyson.
//
// Requires: ffmpeg on PATH (`winget install Gyan.FFmpeg`).

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execP = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const VIDEOS_DIR = path.join(__dirname, 'videos');
const SRT_FILE   = path.join('C:', 'dev', 'folio', 'VO', 'AI', 'script-00.srt');

const videoId = process.argv[2] || '01';

async function main() {
  // 1. Find per-shot scripts for this videoId: `<videoId><letter>-...js`
  //    e.g. 01a-cold-open.js, 01b-signin.js, ..., 01f-reader.js.
  //    This pattern ignores a legacy all-in-one `<videoId>-hero.js`
  //    file if one is still lying around.
  const shotRegex = new RegExp(`^${videoId}[a-z]-.*\\.js$`);
  const scripts = (await fs.readdir(VIDEOS_DIR))
    .filter((f) => shotRegex.test(f))
    .sort();
  if (!scripts.length) {
    console.error(`No shot scripts found matching /^${videoId}[a-z]-.*\\.js$/ in ${VIDEOS_DIR}`);
    console.error(`Expected files like: ${videoId}a-*.js, ${videoId}b-*.js, …`);
    process.exit(1);
  }
  console.log(`Found ${scripts.length} shot scripts:`, scripts.join(', '));

  // 2. For each shot script, find its most recent .webm in output/.
  // Convention: run.js writes <random>.webm but the events.json has
  // the videoFile name. Match by events.json shot id → webm name.
  const clips = [];
  for (const script of scripts) {
    const shotId = script.replace('.js', '');
    const eventsPath = path.join(OUTPUT_DIR, `${shotId}.events.json`);
    try {
      const events = JSON.parse(await fs.readFile(eventsPath, 'utf8'));
      const webmName = events.videoFile;
      if (!webmName) throw new Error('no videoFile in events');
      clips.push({
        shotId,
        webm: path.join(OUTPUT_DIR, webmName),
        duration: events.totalDurationSec,
      });
    } catch (e) {
      console.error(`  ✗ ${shotId}: couldn't read ${eventsPath} (${e.message})`);
      console.error(`    Make sure you have run: node run.js ${shotId}`);
      process.exit(1);
    }
  }

  // 3. Verify every webm exists. If any is missing it's usually
  //    because the matching shot's output was cleaned up — tell
  //    Jacob which specific shot to re-run.
  for (const c of clips) {
    try {
      await fs.access(c.webm);
    } catch {
      console.error(`\n✗ Missing recording for shot "${c.shotId}":`);
      console.error(`    ${c.webm}`);
      console.error(`\n  To fix: re-run that shot:`);
      console.error(`    node run.js ${c.shotId}`);
      console.error(`\n  (Or if you want to drop that shot from the stitch,`);
      console.error(`   delete videos/${c.shotId}.js + output/${c.shotId}.events.json`);
      console.error(`   and re-run stitch.)\n`);
      process.exit(1);
    }
  }

  console.log('\nClip inventory:');
  clips.forEach((c, i) => {
    console.log(`  ${i+1}. ${c.shotId}  ${c.duration.toFixed(1)}s  ${path.basename(c.webm)}`);
  });

  // 4. Write ffmpeg concat list.
  const concatListPath = path.join(OUTPUT_DIR, `${videoId}-concat.txt`);
  const concatContent = clips.map((c) => `file '${c.webm.replace(/\\/g, '/')}'`).join('\n');
  await fs.writeFile(concatListPath, concatContent);

  // 5. Decide whether to burn SRT. If the file exists, burn it in.
  const outMp4 = path.join(OUTPUT_DIR, `${videoId}-hero-stitched.mp4`);
  let subsAvailable = false;
  try { await fs.access(SRT_FILE); subsAvailable = true; } catch {}

  // ffmpeg command — concat demuxer + optional subtitles filter.
  //  -f concat -safe 0 -i concat.txt  : stitch the clips
  //  -vf subtitles=...                : burn SRT if we have one
  //  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p : clean MP4
  const srtPathForFilter = SRT_FILE
    .replace(/\\/g, '/')
    .replace(/^([a-zA-Z]):/, '$1\\:'); // ffmpeg quirk: C:/ → C\:/
  const subsFilter = subsAvailable
    ? `,subtitles='${srtPathForFilter}'`
    : '';
  const vfArg = `scale=1920:1080${subsFilter}`;

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-vf', vfArg,
    '-c:v', 'libx264',
    '-crf', '20',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    outMp4,
  ];

  console.log('\nStitching with ffmpeg…');
  if (subsAvailable) console.log('  (burning subtitles from ' + SRT_FILE + ')');
  else console.log('  (no SRT found — stitching without subtitles)');

  const ff = spawn('ffmpeg', args, { stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    ff.on('exit', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code)));
    ff.on('error', reject);
  });

  console.log('\n╔══ Stitch complete ═════════════════════════════════╗');
  console.log('║ Output: ' + outMp4);
  console.log('║ Hand this file to Allyson for VO recording.');
  console.log('╚═════════════════════════════════════════════════════╝\n');
}

main().catch((e) => { console.error('\nStitch failed:', e.message); process.exit(1); });
