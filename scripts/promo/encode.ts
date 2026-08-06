/**
 * @file encode.ts
 * @brief Assembles recorded promo frames into the tour mp4, hero gif and teaser mp4.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Reads promo/take/ (frames + beat timeline from record.ts) and produces:
 *   promo/ccmon-tour.mp4    the full tour, 30fps, fades
 *   promo/ccmon-hero.gif    ~13s highlight cut, palette-optimized, ≤9.5MB
 *   promo/ccmon-teaser.mp4  the same highlight cut for socials
 *
 *   tsx scripts/promo/encode.ts [--take DIR]
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'promo');

interface TakeMeta {
  frames: Array<{ file: string; ts: number }>;
  beats: Array<{ name: string; t: number }>;
}

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed (${args.join(' ')})\n${r.stderr}`);
  }
  if (r.stderr?.trim()) console.warn(r.stderr.trim());
}

function probeDuration(file: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  return Number(r.stdout.trim()) || 0;
}

const mb = (file: string): string => `${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`;

function main(): void {
  const i = process.argv.indexOf('--take');
  const takeDir = i >= 0 ? path.resolve(process.argv[i + 1]) : path.join(OUT_DIR, 'take');
  const meta = JSON.parse(fs.readFileSync(path.join(takeDir, 'meta.json'), 'utf8')) as TakeMeta;
  const { frames, beats } = meta;
  if (frames.length < 2) throw new Error('take has no frames');

  // concat list with per-frame durations from compositor timestamps
  const t0 = frames[0].ts;
  let total = 0;
  const lines: string[] = ['ffconcat version 1.0'];
  for (let f = 0; f < frames.length; f++) {
    const dt =
      f + 1 < frames.length
        ? Math.min(3, Math.max(1 / 240, frames[f + 1].ts - frames[f].ts))
        : 0.4;
    total += dt;
    lines.push(`file 'frames/${frames[f].file}'`, `duration ${dt.toFixed(6)}`);
  }
  lines.push(`file 'frames/${frames[frames.length - 1].file}'`); // concat quirk: repeat last
  const listFile = path.join(takeDir, 'list.ffconcat');
  fs.writeFileSync(listFile, lines.join('\n') + '\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rel = (name: string): number => {
    const b = beats.find((x) => x.name === name);
    return b ? Math.max(0, b.t - t0) : 0;
  };
  // master window: shave the camera-up head and let the fade absorb the
  // closing dwell so the tour lands under 30s
  const mStart = 0.3;
  const mEnd = Math.min(total, Math.max(mStart + 1, (rel('end') || total) - 1.0));
  const dur = mEnd - mStart;

  // ---- full tour mp4 ----
  const tourMp4 = path.join(OUT_DIR, 'ccmon-tour.mp4');
  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf',
    `trim=start=${mStart.toFixed(2)}:end=${mEnd.toFixed(2)},setpts=PTS-STARTPTS,` +
      `fps=30,scale=1600:-2:flags=lanczos,format=yuv420p,` +
      `fade=t=in:st=0:d=0.45,fade=t=out:st=${(dur - 0.75).toFixed(2)}:d=0.75`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart',
    tourMp4,
  ]);
  console.log(`[encode] ${tourMp4}  ${mb(tourMp4)}  ${probeDuration(tourMp4).toFixed(1)}s`);

  // ---- highlight cut (gif + teaser) ---- (times relative to the trimmed master)
  // one stop per headline view in tour order — including the accounts
  // dashboard; the 3D stop shows the terrain plus the first mode hop
  const segs: Array<[number, number]> = [
    [rel('overview') + 0.4 - mStart, 1.6],
    [rel('activity') + 0.8 - mStart, 1.8],
    [rel('insights') + 0.5 - mStart, 1.6],
    [rel('models') + 0.7 - mStart, 1.8],
    [rel('projects') + 0.5 - mStart, 1.6],
    [rel('accounts') + 1.0 - mStart, 2.0],
    [rel('spatial') + 0.4 - mStart, 2.3],
  ].map(([s, len]) => {
    const start = Math.min(Math.max(0, s), dur - 0.1);
    return [start, Math.min(len, Math.max(0.1, dur - start))];
  });

  const trims = segs
    .map(([s, len], n) => `[0:v]trim=start=${s.toFixed(2)}:end=${(s + len).toFixed(2)},setpts=PTS-STARTPTS[v${n}]`)
    .join(';');
  const catLabels = segs.map((_, n) => `[v${n}]`).join('');
  const cut = `${trims};${catLabels}concat=n=${segs.length}:v=1:a=0[cat]`;

  const teaserMp4 = path.join(OUT_DIR, 'ccmon-teaser.mp4');
  const teaserLen = segs.reduce((s, [, len]) => s + len, 0);
  ffmpeg([
    '-i', tourMp4,
    '-filter_complex',
    `${cut};[cat]fps=30,scale=1280:-2:flags=lanczos,format=yuv420p,` +
      `fade=t=in:st=0:d=0.3,fade=t=out:st=${(teaserLen - 0.5).toFixed(2)}:d=0.5[out]`,
    '-map', '[out]',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', '-movflags', '+faststart',
    teaserMp4,
  ]);
  console.log(`[encode] ${teaserMp4}  ${mb(teaserMp4)}  ${probeDuration(teaserMp4).toFixed(1)}s`);

  const heroGif = path.join(OUT_DIR, 'ccmon-hero.gif');
  // real-data frames are dense — walk down size/fps/palette until it fits
  const attempts: Array<[number, number, number]> = [
    [960, 14, 256],
    [960, 12, 160],
    [864, 12, 160],
    [800, 12, 128],
    [768, 10, 96],
    [704, 10, 96],
  ];
  for (const [width, fps, colors] of attempts) {
    ffmpeg([
      '-i', tourMp4,
      '-filter_complex',
      `${cut};[cat]fps=${fps},scale=${width}:-1:flags=lanczos,split[ga][gb];` +
        `[ga]palettegen=stats_mode=diff:max_colors=${colors}[pal];` +
        `[gb][pal]paletteuse=dither=bayer:bayer_scale=${colors > 160 ? 3 : 4}:diff_mode=rectangle[gif]`,
      '-map', '[gif]', '-loop', '0',
      heroGif,
    ]);
    const size = fs.statSync(heroGif).size;
    console.log(`[encode] gif attempt ${width}px @ ${fps}fps, ${colors} colors → ${mb(heroGif)}`);
    if (size <= 9.5 * 1024 * 1024) break;
  }
  console.log(`[encode] ${heroGif}  ${mb(heroGif)}  ${probeDuration(heroGif).toFixed(1)}s`);

  // promo/ is gitignored, but the README embeds docs/media/ccmon-hero.gif —
  // so publish the hero there too. Copying by hand was an undocumented last
  // step, and forgetting it left the README showing an old build indefinitely.
  const published = path.join(REPO, 'docs', 'media', 'ccmon-hero.gif');
  fs.mkdirSync(path.dirname(published), { recursive: true });
  fs.copyFileSync(heroGif, published);
  console.log(`[encode] published → ${published} (the README's hero)`);
  console.log('[encode] done — assets in promo/');
}

main();
