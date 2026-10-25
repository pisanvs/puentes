// Generates the desktop app's icons (no image libraries: a tiny supersampled rasterizer + PNG encoder)
// and bridgr.json, which tells the packaged app where this checkout lives.
//   tsx desktop/prepare.ts

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = "desktop/build";

// ── PNG ──────────────────────────────────────────────────────────────────────────────────────────

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size: number, rgba: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ── Shapes (unit square, y down) ─────────────────────────────────────────────────────────────────

const inRect = (u: number, v: number, x0: number, y0: number, x1: number, y1: number) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
function inRoundRect(u: number, v: number, x0: number, y0: number, x1: number, y1: number, r: number) {
  if (!inRect(u, v, x0, y0, x1, y1)) return false;
  const dx = Math.max(x0 + r - u, 0, u - (x1 - r));
  const dy = Math.max(y0 + r - v, 0, v - (y1 - r));
  return dx * dx + dy * dy <= r * r;
}
function nearSegment(u: number, v: number, ax: number, ay: number, bx: number, by: number, hw: number) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * vx + (v - ay) * vy) / (vx * vx + vy * vy)));
  const dx = u - (ax + t * vx);
  const dy = v - (ay + t * vy);
  return dx * dx + dy * dy <= hw * hw;
}

// The main cable's curve, v = 0.27 + 0.27·(1 − ((u − .5)/.16)²), as 32 segments.
const CABLE = Array.from({ length: 33 }, (_, i) => {
  const u = 0.34 + (0.32 * i) / 32;
  const k = (u - 0.5) / 0.16;
  return [u, 0.27 + 0.27 * (1 - k * k)] as const;
});

/** A suspension bridge: two towers, a deck, a sagging main cable and side stays. */
function bridge(u: number, v: number, w: number, stays = true) {
  const tower = (cx: number) => inRect(u, v, cx - w, 0.24, cx + w, 0.8);
  const deck = inRect(u, v, 0.1, 0.62 - w * 0.9, 0.9, 0.62 + w * 0.9);
  // Main cable between tower tops, lowest at mid-span — true distance to a fine polyline of the curve.
  let cable = false;
  if (u >= 0.3 && u <= 0.7 && v >= 0.2 && v <= 0.6)
    for (let i = 0; i < CABLE.length - 1 && !cable; i++) cable = nearSegment(u, v, CABLE[i][0], CABLE[i][1], CABLE[i + 1][0], CABLE[i + 1][1], w * 0.8);
  const stay = stays && (nearSegment(u, v, 0.34, 0.27, 0.1, 0.62, w * 0.8) || nearSegment(u, v, 0.66, 0.27, 0.9, 0.62, w * 0.8));
  return tower(0.34) || tower(0.66) || deck || cable || stay;
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

type Sample = (u: number, v: number) => [number, number, number, number];

function render(size: number, sample: Sample, ss = size >= 256 ? 3 : 8) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      const i = (y * size + x) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  return out;
}

// macOS icon grid: an 824px rounded square centered on a 1024px canvas.
const INSET = 100 / 1024;
const SPAN = 1 - 2 * INSET;
const appIcon: Sample = (u, v) => {
  if (!inRoundRect(u, v, INSET, INSET, 1 - INSET, 1 - INSET, 0.18)) return [0, 0, 0, 0];
  const cu = (u - INSET) / SPAN;
  const cv = (v - INSET) / SPAN;
  if (bridge(cu, cv, 0.028)) return [255, 255, 255, 1];
  // bridgr green, lighter at the top.
  const t = cv;
  return [Math.round(36 - 22 * t), Math.round(168 - 58 * t), Math.round(130 - 42 * t), 1];
};
// The menu bar is ~18pt: drop the side stays (they merge with the towers) and keep the silhouette.
const trayIcon: Sample = (u, v) => (bridge(u, v, 0.05, false) ? [0, 0, 0, 1] : [0, 0, 0, 0]);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.png"), png(1024, render(1024, appIcon)));
writeFileSync(join(OUT, "trayTemplate.png"), png(18, render(18, trayIcon)));
writeFileSync(join(OUT, "trayTemplate@2x.png"), png(36, render(36, trayIcon)));

// .icns from an iconset (iconutil ships with macOS).
const set = join(OUT, "icon.iconset");
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(set, `icon_${s}x${s}.png`), png(s, render(s, appIcon)));
  writeFileSync(join(set, `icon_${s}x${s}@2x.png`), png(s * 2, render(s * 2, appIcon)));
}
execSync(`iconutil -c icns "${set}" -o "${join(OUT, "icon.icns")}"`);
rmSync(set, { recursive: true, force: true });

// Where the packaged app should find this checkout.
writeFileSync(join(OUT, "bridgr.json"), JSON.stringify({ home: process.cwd() }, null, 2));
console.log(`icons + bridgr.json written to ${OUT} (home: ${process.cwd()})`);
