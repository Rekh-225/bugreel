import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rawDir = path.join(root, 'docs', 'demo-raw');
const mp4 = path.join(root, 'docs', 'demo.mp4');
const gif = path.join(root, 'docs', 'demo.gif');
const GIF_LIMIT = 6 * 1024 * 1024;
const GIF_LIMIT_LABEL = `${GIF_LIMIT / 1024 / 1024} MB`;

function fail(message) {
  console.error(`demo:encode: ${message}`);
  process.exit(1);
}

function run(binary, args) {
  const result = spawnSync(binary, args, { stdio: 'inherit' });
  if (result.error) fail(`could not run ${binary}: ${result.error.message}`);
  if (result.status !== 0) fail(`command failed (exit ${result.status}): ${binary} ${args.join(' ')}`);
}

function capture(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8' });
  return { ...result, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// A usable encoder needs libx264 for the mp4 and palettegen/paletteuse for the GIF.
function probe(binary) {
  const version = capture(binary, ['-hide_banner', '-version']);
  if (version.error || version.status !== 0) return { ok: false, reason: version.error ? version.error.message : `exit ${version.status}` };
  const encoders = capture(binary, ['-hide_banner', '-encoders']).out;
  const filters = capture(binary, ['-hide_banner', '-filters']).out;
  const missing = [];
  if (!/\blibx264\b/.test(encoders)) missing.push('libx264 encoder');
  if (!/\bpalettegen\b/.test(filters)) missing.push('palettegen filter');
  if (!/\bpaletteuse\b/.test(filters)) missing.push('paletteuse filter');
  return { ok: missing.length === 0, missing };
}

function candidates() {
  const list = [];
  if (process.env.FFMPEG) list.push(process.env.FFMPEG);
  list.push('ffmpeg');
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    list.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    const packages = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(packages)) {
      for (const pkg of fs.readdirSync(packages).filter(entry => entry.startsWith('Gyan.FFmpeg'))) {
        for (const build of fs.readdirSync(path.join(packages, pkg))) list.push(path.join(packages, pkg, build, 'bin', 'ffmpeg.exe'));
      }
    }
    const msPlaywright = path.join(localAppData, 'ms-playwright');
    if (fs.existsSync(msPlaywright)) {
      for (const entry of fs.readdirSync(msPlaywright)) {
        if (entry.startsWith('ffmpeg')) list.push(path.join(msPlaywright, entry, 'ffmpeg-win64.exe'));
      }
    }
  }
  return list;
}

let ffmpeg;
const problems = [];
for (const candidate of candidates()) {
  if (candidate !== 'ffmpeg' && !fs.existsSync(candidate)) continue;
  const result = probe(candidate);
  if (result.ok) { ffmpeg = candidate; break; }
  problems.push(`  - ${candidate}: ${result.ok ? '' : (result.missing ? `missing ${result.missing.join(', ')}` : result.reason)}`);
}
if (!ffmpeg) {
  fail(`no usable ffmpeg found. Tried:\n${problems.join('\n')}\nInstall ffmpeg (winget install --id Gyan.FFmpeg -e) or set FFMPEG to a full-featured binary.`);
}
console.log(`Using ffmpeg: ${ffmpeg}`);

const segmentsFile = path.join(rawDir, 'segments.json');
if (!fs.existsSync(segmentsFile)) fail(`missing ${path.relative(root, segmentsFile)} — run npm run demo:record first`);
const { segments } = JSON.parse(fs.readFileSync(segmentsFile, 'utf8'));
if (!Array.isArray(segments) || segments.length === 0) fail('segments.json contains no segments');
for (const segment of segments) if (!fs.existsSync(segment)) fail(`missing segment file: ${segment}`);

const concatList = path.join(rawDir, 'concat.txt');
fs.writeFileSync(concatList, `${segments.map(segment => `file '${segment.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')}\n`);
const webm = path.join(rawDir, 'demo.webm');
const copied = spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', webm], { stdio: 'inherit' });
if (copied.status !== 0) {
  console.log('stream copy concat failed; re-encoding segments together instead');
  run(ffmpeg, ['-y', ...segments.flatMap(segment => ['-i', segment]), '-filter_complex', `concat=n=${segments.length}:v=1:a=0`, webm]);
}

run(ffmpeg, ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'medium', '-movflags', '+faststart', '-an', mp4]);

const palette = path.join(rawDir, 'palette.png');
function encodeGif(fps, width) {
  run(ffmpeg, ['-y', '-i', webm, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`, palette]);
  run(ffmpeg, ['-y', '-i', webm, '-i', palette, '-lavfi', `fps=${fps},scale=${width}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
}
for (const { fps, width } of [{ fps: 8, width: 960 }, { fps: 6, width: 960 }, { fps: 6, width: 800 }]) {
  encodeGif(fps, width);
  const size = fs.statSync(gif).size;
  if (size <= GIF_LIMIT) break;
  console.log(`GIF is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${GIF_LIMIT_LABEL} target; retrying smaller`);
}

function durationSeconds(file) {
  const info = capture(ffmpeg, ['-i', file]).out;
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
}

// Verification stills at 10/40/70/95% of the mp4.
const duration = durationSeconds(mp4);
if (duration) {
  for (const [index, at] of [0.1, 0.4, 0.7, 0.95].entries()) {
    run(ffmpeg, ['-y', '-ss', (duration * at).toFixed(2), '-i', mp4, '-frames:v', '1', path.join(rawDir, `still-${index + 1}.png`)]);
  }
}

const mb = file => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`demo.mp4: ${mb(mp4)}${duration ? `, ${duration.toFixed(1)}s` : ''}`);
console.log(`demo.gif: ${mb(gif)}${fs.statSync(gif).size > GIF_LIMIT ? ` (over the ${GIF_LIMIT_LABEL} target)` : ''}`);
