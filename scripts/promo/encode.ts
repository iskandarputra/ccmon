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

  // A beat that is not in the take used to resolve to 0, which silently cut a
  // highlight segment out of the opening frames instead of the view it names.
  // Beat names are declared in tour.ts; a mismatch is a bug, so say so.
  const rel = (name: string): number => {
    const b = beats.find((x) => x.name === name);
    if (!b) {
      throw new Error(
        `[encode] take has no beat "${name}" — HIGHLIGHTS in encode.ts and the ` +
          `beat names in tour.ts have diverged (take has: ${beats.map((x) => x.name).join(', ')})`,
      );
    }
    return Math.max(0, b.t - t0);
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
  // One stop per headline view, in tour order. Beat names MUST match those
  // declared in tour.ts#ACTS — rel() throws rather than silently cutting the
  // opening frames in place of a beat that was renamed.
  // [beat, offset into the beat, seconds to hold]
  //
  // Offsets are measured from a FULLY PAINTED view: tour.ts#arrive stamps the
  // beat only after the 300ms `.view-anim` entrance fade has finished. They
  // used to be measured from the moment navigation was requested, so a small
  // offset opened its segment on a view still at opacity 0 — a blank page in
  // the gif with the shell painted around it. Keep offsets pointed at the
  // MOMENT worth showing, not at padding for a fade that is already over.
  const HIGHLIGHTS: Array<[string, number, number]> = [
    ['pulse', 0.2, 1.7],
    ['analytics', 1.6, 1.8], //  after the tab switch, so the sub-nav reads
    ['projects', 0.2, 1.6], //   beat is stamped on the grid itself (branching act)
    ['accounts', 1.3, 2.1], //   after the scroll lands on the pacing banner
    ['advisor', 0.3, 1.7],
    ['themes', 2.2, 2.0], //     mid theme-tour, so the palette visibly swaps
    ['spatial', 0.3, 2.4],
  ];

  /**
   * Keep this much clear of the act's end. The next act navigates immediately
   * after, and `.view-anim` fades the new view in from opacity 0 over 300ms —
   * a segment that ran to the wire ended on a blank page in the gif.
   */
  const TAIL_MARGIN = 0.45;

  const segs: Array<[number, number]> = HIGHLIGHTS.map(([name, off, len]) => {
    const start = Math.min(Math.max(0, rel(name) + off - mStart), dur - 0.1);
    // clamp to the act's own end, so a segment can never bleed into the next
    // view's entrance fade no matter how the choreography is retimed
    const actEnd = rel(`${name}:end`) - mStart - TAIL_MARGIN;
    const room = Math.max(0.4, Math.min(dur, actEnd) - start);
    const kept = Math.min(len, room);
    if (kept < len - 0.05) {
      console.warn(
        `[encode] segment "${name}" trimmed ${len.toFixed(1)}s → ${kept.toFixed(1)}s ` +
          `to stay inside its act. Lower its offset or lengthen the act in tour.ts.`,
      );
    }
    // A segment is only as good as the frames behind it. startScreencast emits
    // NOTHING while the page is still, and the concat holds the last frame it
    // did get across the gap — so a segment whose window contains no fresh
    // frame silently shows whatever was on screen BEFORE it. That is how the
    // projects segment came to show the knowledge graph: the grid was up, the
    // beat was correct, and 3.4s passed with zero frames captured.
    // Use tour.ts#dwell for any dwell the gif is meant to show.
    const absStart = start + mStart;
    const newest = frames.reduce(
      (best, f) => (f.ts - t0 <= absStart && f.ts - t0 > best ? f.ts - t0 : best),
      -Infinity,
    );
    const staleness = absStart - newest;
    if (Number.isFinite(newest) && staleness > 0.5) {
      console.warn(
        `[encode] segment "${name}" opens on a frame ${staleness.toFixed(1)}s stale — ` +
          `nothing repainted during that dwell, so it will show the PREVIOUS screen. ` +
          `Wrap that dwell in tour.ts#dwell() so the compositor emits frames.`,
      );
    }
    return [start, Math.min(kept, Math.max(0.1, dur - start))] as [number, number];
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
