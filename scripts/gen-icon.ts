/**
 * @file gen-icon.ts
 * @brief Generates build/icon.png + build/icons/*.png (gitignored; CI regenerates).
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Renders the icon from scratch — a rounded warm-dark tile with three lofi
 * bars and a live dot. Pure Node (zlib PNG encoder), so the repo carries no
 * binary assets and CI regenerates the icon anywhere.
 *
 * Two outputs, two different consumers:
 *  - build/icon.png (1024x1024) is what electron-builder's mac/win icon
 *    conversion wants (it derives .icns/.ico from a single source file), and
 *    what main.ts loads at runtime for the window/tray icon.
 *  - build/icons/<N>x<N>.png, a full freedesktop size set (16-1024), is what
 *    electron-builder's LINUX packaging wants. Pointing `linux.icon` at a
 *    single .png short-circuits electron-builder's icon converter: for the
 *    Linux "set" format the source already has the target extension, so it
 *    is copied through as ONE size (whatever the source's own dimensions
 *    are) instead of being resized into the set. Verified by unpacking a
 *    built .deb: only hicolor/1024x1024/apps/ccmon.png existed — nothing at
 *    16/24/32/48/64/128/256, which is what task bars and app launchers
 *    actually request, so they fell back to the desktop theme's generic
 *    placeholder icon instead. A DIRECTORY of size-named PNGs takes a
 *    different path in electron-builder (collectIconsFromDir) that uses the
 *    set as-is, no external conversion tool involved — see electron-builder.yml.
 */

import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

const S = 2048; // supersampled canvas, downsampled 2x for clean AA
const OUT = 1024;
const C = S / 1024; // scene coordinates are authored in 1024-space

// ---- tiny float RGBA canvas ----------------------------------------------

const px = new Float64Array(S * S * 4);

type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

function blend(i: number, rgb: RGB, a: number): void {
  if (a <= 0) return;
  const o = i * 4;
  const ia = px[o + 3];
  const na = a + ia * (1 - a);
  if (na <= 0) return;
  px[o] = (rgb[0] * a + px[o] * ia * (1 - a)) / na;
  px[o + 1] = (rgb[1] * a + px[o + 1] * ia * (1 - a)) / na;
  px[o + 2] = (rgb[2] * a + px[o + 2] * ia * (1 - a)) / na;
  px[o + 3] = na;
}

const cov = (d: number) => Math.min(1, Math.max(0, 0.5 - d)); // SDF → coverage

function roundRect(
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
): number {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return cov(Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r);
}

function capsule(x: number, y: number, cx: number, y1: number, y2: number, r: number): number {
  const py = Math.min(Math.max(y, y1), y2);
  return cov(Math.hypot(x - cx, y - py) - r);
}

function circle(x: number, y: number, cx: number, cy: number, r: number): number {
  return cov(Math.hypot(x - cx, y - cy) - r);
}

// ---- scene ----------------------------------------------------------------

const bgTop = hex('#221E19');
const bgBot = hex('#14110E');
const SAGE = hex('#A8B894');
const AMBER = hex('#D9A86C');
const ROSE = hex('#C98A7D');
const CREAM = hex('#EAE4D6');

const R = 58 * C; // bar radius
const BASE = 768 * C; // bars baseline
const BARS = [
  { cx: 348 * C, top: 520 * C, color: SAGE },
  { cx: 512 * C, top: 330 * C, color: AMBER },
  { cx: 676 * C, top: 580 * C, color: ROSE },
];

for (let y = 0; y < S; y++) {
  const t = y / S;
  const bg: RGB = [
    bgTop[0] + (bgBot[0] - bgTop[0]) * t,
    bgTop[1] + (bgBot[1] - bgTop[1]) * t,
    bgTop[2] + (bgBot[2] - bgTop[2]) * t,
  ];
  for (let x = 0; x < S; x++) {
    const i = y * S + x;
    blend(i, bg, roundRect(x, y, S / 2, S / 2, S, S, 232 * C));
    for (const b of BARS) {
      blend(i, b.color, capsule(x, y, b.cx, b.top + R, BASE - R, R));
    }
    blend(i, CREAM, circle(x, y, 512 * C, 234 * C, 44 * C));
  }
}

// ---- downsample S→dst, area-weighted + premultiplied ----------------------
//
// Generalises the original fixed 2x box filter to an arbitrary output size,
// so every icon size is drawn straight from the 2048px supersampled scene
// rather than resizing an already-downsampled copy (which would compound
// blur on the smallest sizes). `scale` need not be an integer divisor of S —
// each destination pixel's source rectangle is fractionally weighted at its
// edges, so odd sizes like 24 or 48 stay correctly area-averaged too.
function downsample(dst: number): Buffer {
  const out = Buffer.alloc(dst * dst * 4);
  const scale = S / dst;
  for (let oy = 0; oy < dst; oy++) {
    const sy0 = oy * scale;
    const sy1 = sy0 + scale;
    for (let ox = 0; ox < dst; ox++) {
      const sx0 = ox * scale;
      const sx1 = sx0 + scale;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const o = (sy * S + sx) * 4;
          const pa = px[o + 3];
          r += px[o] * pa * w;
          g += px[o + 1] * pa * w;
          b += px[o + 2] * pa * w;
          a += pa * w;
          wsum += w;
        }
      }
      const o = (oy * dst + ox) * 4;
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o + 3] = wsum > 0 ? Math.round((a / wsum) * 255) : 0;
    }
  }
  return out;
}

const out = downsample(OUT);

// ---- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w: number, h: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; //  bit depth
  ihdr[9] = 6; //  RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const buildDir = path.join(__dirname, '..', 'build');
const iconsDir = path.join(buildDir, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// The flagship file: main.ts's runtime window/tray icon, and the source
// electron-builder's mac/win targets convert into .icns/.ico.
const dest = path.join(buildDir, 'icon.png');
fs.writeFileSync(dest, encodePNG(OUT, OUT, out));
console.log(`icon → ${dest} (${OUT}x${OUT}, ${fs.statSync(dest).size} bytes)`);

// The freedesktop hicolor size set: standard sizes any Linux launcher/task
// bar is likely to ask for. 1024 is re-encoded rather than copied so every
// file in the set comes from the same code path.
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const size of LINUX_SIZES) {
  const buf = size === OUT ? out : downsample(size);
  const file = path.join(iconsDir, `${size}x${size}.png`);
  fs.writeFileSync(file, encodePNG(size, size, buf));
}
console.log(`icons → ${iconsDir} (${LINUX_SIZES.join(', ')})`);
