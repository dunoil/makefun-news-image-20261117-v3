// THE WORLD IN ONE IMAGE — Tuesday 17 November 2026 (v3)
// A denser broadsheet front page of the day's world news, drawn entirely in
// code with the Node standard library only (no network, no dependencies).
// It writes a deterministic 1024x1024 PNG to $MAKEFUN_OUTPUT_DIR/entry.png
// (or /output). Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// How it is built: a 2x supersampled RGB framebuffer, downsampled to 1024
// with ordered-dithered gradients, hand-drawn scenes for every story (a
// Shenzhen skyline under three flags, tankers burning in Hormuz, Kyiv under
// fire, COP31 turbines, an aid convoy, measles chart, an AI chip), a
// dot-matrix world map with the day's ten places numbered, a numbers band,
// six story panels, a "World in Brief" strip and a ticker — 11 stories in
// all — set in a hand-written 5x7 bitmap typeface, and a hand-rolled PNG
// encoder (zlib + CRC32). All pseudo-randomness comes from a seeded xorshift
// generator, so two runs write byte-identical files.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const RW = W * SS;
const RH = H * SS;

type RGB = [number, number, number];

// ------------------------------------------------------------------ palette
const PAPER: RGB = [247, 242, 231];
const PAPER2: RGB = [240, 234, 219];
const INK: RGB = [18, 25, 38];
const INK_SOFT: RGB = [52, 62, 76];
const RED: RGB = [176, 32, 44];
const RED_DK: RGB = [122, 18, 30];
const BLUE: RGB = [26, 68, 128];
const NAVY: RGB = [16, 32, 62];
const NAVY_DK: RGB = [10, 20, 40];
const GOLD: RGB = [198, 140, 32];
const GOLD_LT: RGB = [236, 190, 90];
const TEAL: RGB = [16, 106, 100];
const GREEN: RGB = [46, 114, 62];
const LEAF: RGB = [78, 164, 88];
const GREY: RGB = [96, 104, 114];
const GREY_LT: RGB = [172, 178, 184];
const WHITE: RGB = [255, 255, 255];
const CREAM: RGB = [255, 250, 238];
const SKY: RGB = [176, 206, 234];
const SKY_DK: RGB = [120, 160, 205];
const SEA: RGB = [48, 104, 156];
const SEA_DK: RGB = [26, 62, 104];
const SAND: RGB = [228, 200, 150];
const SAND_DK: RGB = [198, 164, 110];
const ORANGE: RGB = [224, 110, 40];
const ORANGE_LT: RGB = [248, 170, 80];
const SMOKE: RGB = [110, 110, 118];
const PINK: RGB = [214, 92, 108];

// ------------------------------------------------------- seeded randomness
// xorshift32, seeded from the date: deterministic across runs and platforms.
let rngState = 0x17112026;
function rnd(): number {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 4294967296;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }

// ------------------------------------------------------------- framebuffer
const fb = new Uint8ClampedArray(RW * RH * 3);

function lerpC(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// 4x4 Bayer matrix for ordered dithering (values 0..15).
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Optional clip rectangle (logical coords); every pixel goes through put().
let clipX0 = 0, clipY0 = 0, clipX1 = W, clipY1 = H;
function setClip(x: number, y: number, w: number, h: number): void {
  clipX0 = Math.floor(x); clipY0 = Math.floor(y);
  clipX1 = Math.ceil(x + w); clipY1 = Math.ceil(y + h);
}
function resetClip(): void { clipX0 = 0; clipY0 = 0; clipX1 = W; clipY1 = H; }

function put(x: number, y: number, c: RGB): void {
  // One logical pixel -> an SS x SS block in the framebuffer.
  if (x < clipX0 || x >= clipX1 || y < clipY0 || y >= clipY1) return;
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  for (let dy = 0; dy < SS; dy++) {
    const yy = y0 + dy;
    if (yy < 0 || yy >= RH) continue;
    for (let dx = 0; dx < SS; dx++) {
      const xx = x0 + dx;
      if (xx < 0 || xx >= RW) continue;
      const i = (yy * RW + xx) * 3;
      fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
    }
  }
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) put(xx, yy, c);
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 2): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

// Vertical gradient with ordered dithering (kills banding, adds texture).
function vgrad(x: number, y: number, w: number, h: number, a: RGB, b: RGB): void {
  for (let yy = 0; yy < h; yy++) {
    const t = h <= 1 ? 0 : yy / (h - 1);
    const base = lerpC(a, b, t);
    for (let xx = 0; xx < w; xx++) {
      const d = (BAYER[Math.floor(y + yy) % 4][Math.floor(x + xx) % 4] - 7.5) * 0.9;
      put(x + xx, y + yy, [
        Math.max(0, Math.min(255, Math.round(base[0] + d))),
        Math.max(0, Math.min(255, Math.round(base[1] + d))),
        Math.max(0, Math.min(255, Math.round(base[2] + d))),
      ]);
    }
  }
}

function hgrad(x: number, y: number, w: number, h: number, a: RGB, b: RGB): void {
  for (let xx = 0; xx < w; xx++) {
    const t = w <= 1 ? 0 : xx / (w - 1);
    const base = lerpC(a, b, t);
    for (let yy = 0; yy < h; yy++) {
      const d = (BAYER[Math.floor(y + yy) % 4][Math.floor(x + xx) % 4] - 7.5) * 0.9;
      put(x + xx, y + yy, [
        Math.max(0, Math.min(255, Math.round(base[0] + d))),
        Math.max(0, Math.min(255, Math.round(base[1] + d))),
        Math.max(0, Math.min(255, Math.round(base[2] + d))),
      ]);
    }
  }
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) {
    put(Math.round(x0 + (dx * i) / steps), Math.round(y0 + (dy * i) / steps), c);
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = -r; yy <= r; yy++)
    for (let xx = -r; xx <= r; xx++)
      if (xx * xx + yy * yy <= r * r) put(cx + xx, cy + yy, c);
}

function ring(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    put(Math.round(cx + Math.cos(rad) * r), Math.round(cy + Math.sin(rad) * r), c);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let yy = -ry; yy <= ry; yy++)
    for (let xx = -rx; xx <= rx; xx++)
      if ((xx * xx) / (rx * rx) + (yy * yy) / (ry * ry) <= 1) put(cx + xx, cy + yy, c);
}

// Even-odd scanline polygon fill.
function poly(pts: [number, number][], c: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) put(x, y, c);
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  poly([[x0, y0], [x1, y1], [x2, y2]], c);
}

// ------------------------------------------------------------ PNG encoder
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  // Downsample the supersampled buffer to 1024x1024 with a light paper grain.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: None
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++)
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * RW + (x * SS + dx)) * 3;
          r += fb[i]; g += fb[i + 1]; b += fb[i + 2];
        }
      const n = SS * SS;
      // Deterministic paper grain: integer hash of (x, y), +/-1 level.
      let hsh = (x * 374761393 + y * 668265263) | 0;
      hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
      const grain = (Math.abs(hsh ^ (hsh >>> 16)) % 3) - 1;
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.max(0, Math.min(255, Math.round(r / n) + grain));
      raw[o + 1] = Math.max(0, Math.min(255, Math.round(g / n) + grain));
      raw[o + 2] = Math.max(0, Math.min(255, Math.round(b / n) + grain));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------- 5x7 bitmap typeface
// Each glyph is 7 rows of 5 cells; '#' is ink. Drawn at any scale >= 1:
// a set cell becomes a scale x scale block, so text stays crisp.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '&': ['.###.', '#...#', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '#..##'],
  '+': ['.....', '..#..', '..#..', '.###.', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '.###.', '.....', '.###.', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '•': ['.....', '.....', '.###.', '.###.', '.###.', '.....', '.....'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '*': ['.....', '.#.#.', '.###.', '#####', '.###.', '.#.#.', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
};

function textWidth(s: string, scale: number): number {
  let w = 0;
  for (const ch of s) w += 6 * scale;
  return w - scale; // no trailing advance
}

function drawText(x: number, y: number, s: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT['?'];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '#') {
          rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextC(cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cx - textWidth(s, scale) / 2, y, s, scale, c);
}

function drawTextR(x: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(x - textWidth(s, scale), y, s, scale, c);
}

// Greedy word wrap to a pixel width; returns lines (never more than maxLines).
function wrapText(s: string, maxW: number, scale: number, maxLines = 6): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (textWidth(trial, scale) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  return lines;
}

function drawLines(x: number, y: number, lines: string[], scale: number, c: RGB, lh: number): void {
  lines.forEach((ln, i) => drawText(x, y + i * lh, ln, scale, c));
}

// ------------------------------------------------------------ drawn scenes
// Every scene is drawn in code inside its panel rectangle (x, y, w, h).

function drawSkyline(x: number, y: number, w: number, h: number, c: RGB, lit: RGB): void {
  // A row of towers with lit windows; heights from the seeded generator.
  let bx = x;
  while (bx < x + w - 8) {
    const bw = 14 + Math.floor(rnd() * 22);
    const bh = h * (0.35 + rnd() * 0.6);
    rect(bx, y + h - bh, bw, bh, c);
    // Windows: deterministic grid of tiny lit dots.
    for (let wy = y + h - bh + 4; wy < y + h - 4; wy += 7)
      for (let wx = bx + 3; wx < bx + bw - 2; wx += 6)
        if (rnd() < 0.45) rect(wx, wy, 2, 3, lit);
    bx += bw + 2 + Math.floor(rnd() * 5);
  }
}

function drawFlag(x: number, y: number, w: number, h: number, kind: 'CN' | 'US' | 'RU'): void {
  if (kind === 'CN') {
    rect(x, y, w, h, RED);
    circle(x + 8, y + 7, 3, GOLD_LT);
    circle(x + 20, y + 5, 1.5, GOLD_LT);
    circle(x + 24, y + 9, 1.5, GOLD_LT);
    circle(x + 24, y + 14, 1.5, GOLD_LT);
    circle(x + 20, y + 18, 1.5, GOLD_LT);
  } else if (kind === 'US') {
    for (let i = 0; i < 7; i++) rect(x, y + (i * h) / 7, w, h / 7 + 1, i % 2 === 0 ? RED : WHITE);
    rect(x, y, w * 0.42, (h * 4) / 7, BLUE);
    for (let r = 0; r < 3; r++)
      for (let col = 0; col < 4; col++) rect(x + 2 + col * 3, y + 2 + r * 4, 1.5, 1.5, WHITE);
  } else {
    rect(x, y, w, h / 3, WHITE);
    rect(x, y + h / 3, w, h / 3, BLUE);
    rect(x, y + (2 * h) / 3, w, h / 3, RED);
  }
  frame(x, y, w, h, INK, 1);
}

// Lead scene: three flags over the Shenzhen skyline, leaders at one table.
function sceneLead(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [214, 228, 242], [250, 240, 214]);
  circle(x + w - 52, y + 22, 13, GOLD_LT);
  circle(x + w - 52, y + 22, 9, [252, 214, 110]);
  // Skyline along the bottom third.
  drawSkyline(x, y + h * 0.42, w, h * 0.34, NAVY, GOLD_LT);
  // One tapered landmark tower with an antenna.
  const tx = x + w * 0.62;
  poly([[tx, y + h * 0.30], [tx + 10, y + h * 0.30], [tx + 15, y + h * 0.76], [tx - 5, y + h * 0.76]], NAVY_DK);
  line(tx + 5, y + h * 0.30, tx + 5, y + h * 0.16, NAVY_DK);
  circle(tx + 5, y + h * 0.16, 2, RED);
  // Three flagpoles with the leaders' flags.
  const flags: ('CN' | 'US' | 'RU')[] = ['CN', 'US', 'RU'];
  const fx = x + w * 0.10;
  flags.forEach((f, i) => {
    const px0 = fx + i * 52;
    line(px0, y + 8, px0, y + h * 0.72, INK);
    drawFlag(px0 + 1, y + 10, 40, 24, f);
  });
  // Round table with three seated figures.
  const ty = y + h * 0.86;
  const suits: RGB[] = [NAVY, RED_DK, INK_SOFT];
  for (let i = 0; i < 3; i++) {
    const cx0 = x + w * 0.30 + i * w * 0.20;
    circle(cx0, ty - 26, 8, [232, 190, 150]); // head
    poly([[cx0 - 13, ty - 16], [cx0 + 13, ty - 16], [cx0 + 17, ty + 2], [cx0 - 17, ty + 2]], suits[i]);
    rect(cx0 - 2, ty - 16, 4, 5, WHITE); // shirt
  }
  ellipse(x + w * 0.50, ty + 2, w * 0.30, 7, [122, 74, 40]);
  rect(x + w * 0.50 - 4, ty + 6, 8, h * 0.14 - 6, [96, 58, 32]);
}

// War at sea: tankers burning in the Strait of Hormuz at dusk.
function sceneHormuz(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.48, [238, 140, 78], [96, 48, 96]);
  circle(x + w * 0.78, y + h * 0.20, 11, ORANGE_LT);
  // Sea.
  vgrad(x, y + h * 0.48, w, h * 0.52, SEA, SEA_DK);
  for (let i = 0; i < 7; i++) {
    const wy = y + h * 0.52 + i * (h * 0.06);
    for (let wx = x + 4; wx < x + w - 4; wx += 14)
      line(wx, wy, wx + 8, wy + 2, [150, 190, 220]);
  }
  // Carrier silhouette, far right.
  const cx0 = x + w * 0.66;
  rect(cx0, y + h * 0.56, w * 0.30, 5, NAVY_DK);
  rect(cx0 + w * 0.20, y + h * 0.48, 10, h * 0.08, NAVY_DK);
  // Two tankers, one burning.
  const tanker = (tx: number, tw: number, burning: boolean) => {
    const hullY = y + h * 0.66;
    poly([[tx, hullY], [tx + tw, hullY], [tx + tw - 8, hullY + 14], [tx + 6, hullY + 14]], NAVY_DK);
    rect(tx + tw * 0.55, hullY - 12, tw * 0.22, 12, NAVY_DK);
    rect(tx + tw * 0.30, hullY - 8, 5, 8, NAVY_DK);
    if (burning) {
      circle(tx + tw * 0.30, hullY - 14, 9, ORANGE);
      circle(tx + tw * 0.30, hullY - 18, 6, GOLD_LT);
      circle(tx + tw * 0.38, hullY - 26, 7, SMOKE);
      circle(tx + tw * 0.44, hullY - 34, 9, GREY_LT);
      circle(tx + tw * 0.50, hullY - 42, 11, [140, 140, 148]);
    }
  };
  tanker(x + 8, w * 0.34, true);
  tanker(x + w * 0.42, w * 0.30, false);
}

// Kyiv: night skyline, missile streaks, a burst over the bridge.
function sceneKyiv(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, NAVY_DK, [96, 52, 52]);
  circle(x + w * 0.85, y + 14, 8, [240, 220, 180]);
  // Missile streaks.
  line(x + w * 0.20, y + 6, x + w * 0.42, y + h * 0.55, [255, 220, 140]);
  line(x + w * 0.24, y + 6, x + w * 0.46, y + h * 0.55, [255, 180, 90]);
  line(x + w * 0.62, y + 2, x + w * 0.76, y + h * 0.42, [255, 220, 140]);
  circle(x + w * 0.42, y + h * 0.55, 3, WHITE);
  circle(x + w * 0.76, y + h * 0.42, 3, WHITE);
  drawSkyline(x, y + h * 0.45, w, h * 0.35, [8, 12, 26], GOLD_LT);
  // Explosion burst over the skyline.
  const ex = x + w * 0.42, ey = y + h * 0.52;
  for (let a = 0; a < 12; a++) {
    const rad = (a * 30 * Math.PI) / 180;
    line(ex, ey, ex + Math.cos(rad) * 16, ey + Math.sin(rad) * 16, ORANGE_LT);
  }
  circle(ex, ey, 8, ORANGE);
  circle(ex, ey, 4, GOLD_LT);
  // The bridge: deck, arch, pillars.
  const by = y + h * 0.86;
  rect(x, by, w, 4, [8, 12, 26]);
  for (let i = 0; i < 5; i++) rect(x + 12 + i * (w / 5), by + 4, 4, h * 0.14 - 4, [8, 12, 26]);
  line(x + w * 0.10, by, x + w * 0.50, by - 12, [8, 12, 26]);
  line(x + w * 0.50, by - 12, x + w * 0.90, by, [8, 12, 26]);
}

// COP31: sun, turbines and solar panels above the Antalya coast.
function sceneCOP(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.62, SKY, [238, 244, 230]);
  circle(x + w * 0.82, y + 14, 10, GOLD_LT);
  ellipse(x + 30, y + 14, 18, 6, WHITE);
  ellipse(x + 52, y + 10, 14, 5, WHITE);
  // Green hills.
  ellipse(x + w * 0.28, y + h * 0.78, w * 0.42, h * 0.30, GREEN);
  ellipse(x + w * 0.78, y + h * 0.82, w * 0.40, h * 0.26, LEAF);
  // Wind turbines.
  const turbine = (tx: number, ty: number, s: number) => {
    line(tx, ty, tx, ty - 26 * s, WHITE);
    circle(tx, ty - 26 * s, 2, INK);
    for (let a = 0; a < 3; a++) {
      const rad = ((a * 120 + 30) * Math.PI) / 180;
      line(tx, ty - 26 * s, tx + Math.cos(rad) * 12 * s, ty - 26 * s + Math.sin(rad) * 12 * s, INK);
    }
  };
  turbine(x + w * 0.22, y + h * 0.72, 1);
  turbine(x + w * 0.48, y + h * 0.78, 0.85);
  turbine(x + w * 0.72, y + h * 0.74, 1.1);
  // Solar panels.
  const panel = (px0: number, py: number) => {
    poly([[px0, py], [px0 + 34, py - 6], [px0 + 34, py + 6], [px0, py + 12]], [28, 68, 128]);
    for (let i = 1; i < 4; i++) line(px0 + i * 8, py - 1 - i, px0 + i * 8, py + 11 - i, [140, 180, 220]);
    line(px0 + 17, py + 12, px0 + 17, py + 18, INK);
  };
  panel(x + w * 0.08, y + h * 0.80);
  panel(x + w * 0.58, y + h * 0.84);
  // The sea strip at the bottom.
  vgrad(x, y + h * 0.90, w, h * 0.10, [120, 180, 215], SEA);
  line(x + 6, y + h * 0.94, x + 30, y + h * 0.94, WHITE);
  line(x + w * 0.55, y + h * 0.95, x + w * 0.55 + 26, y + h * 0.95, WHITE);
}

// Gaza: an aid convoy on a desert road.
function sceneGaza(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h * 0.55, [240, 214, 170], [232, 190, 130]);
  circle(x + w * 0.86, y + 14, 10, [252, 220, 130]);
  // Distant buildings.
  rect(x + w * 0.62, y + h * 0.34, 26, h * 0.20, [150, 128, 92]);
  rect(x + w * 0.74, y + h * 0.28, 20, h * 0.26, [150, 128, 92]);
  rect(x + w * 0.84, y + h * 0.38, 30, h * 0.16, [150, 128, 92]);
  // Road.
  poly([[x, y + h], [x + w * 0.30, y + h * 0.55], [x + w, y + h * 0.55], [x + w, y + h]], [206, 178, 128]);
  line(x + w * 0.30, y + h * 0.55, x, y + h, SAND_DK);
  // Three aid trucks.
  const truck = (tx: number, s: number) => {
    const ty = y + h * 0.62 + (tx - x) * 0.02;
    rect(tx, ty, 46 * s, 20 * s, WHITE);
    frame(tx, ty, 46 * s, 20 * s, INK, 1);
    rect(tx + 46 * s, ty + 6 * s, 14 * s, 14 * s, RED);
    rect(tx + 49 * s, ty + 9 * s, 8 * s, 6 * s, SKY);
    drawText(tx + 12 * s, ty + 7 * s, 'AID', 1, RED);
    circle(tx + 10 * s, ty + 22 * s, 4 * s, INK);
    circle(tx + 34 * s, ty + 22 * s, 4 * s, INK);
    circle(tx + 52 * s, ty + 22 * s, 4 * s, INK);
  };
  truck(x + 10, 0.9);
  truck(x + w * 0.38, 1);
  truck(x + w * 0.70, 0.85);
  // Aid boxes stacked at the kerb.
  rect(x + w * 0.06, y + h * 0.44, 16, 10, [190, 150, 96]);
  rect(x + w * 0.06 + 4, y + h * 0.44 - 10, 16, 10, [210, 172, 112]);
  // Border fence, right: posts and two rails.
  for (let i = 0; i < 5; i++) line(x + w * 0.90 + i * 7, y + h * 0.30, x + w * 0.90 + i * 7, y + h * 0.55, INK);
  line(x + w * 0.90, y + h * 0.32, x + w, y + h * 0.32, INK);
  line(x + w * 0.90, y + h * 0.44, x + w, y + h * 0.44, INK);
}

// Measles: spiky viruses and a rising case chart.
function sceneMeasles(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [250, 240, 232], [244, 226, 216]);
  const virus = (cx0: number, cy: number, r: number) => {
    for (let a = 0; a < 12; a++) {
      const rad = (a * 30 * Math.PI) / 180;
      line(cx0, cy, cx0 + Math.cos(rad) * (r + 5), cy + Math.sin(rad) * (r + 5), RED_DK);
      circle(cx0 + Math.cos(rad) * (r + 6), cy + Math.sin(rad) * (r + 6), 2, RED_DK);
    }
    circle(cx0, cy, r, PINK);
    circle(cx0 - r * 0.3, cy - r * 0.3, r * 0.25, [232, 130, 145]);
    circle(cx0 + r * 0.35, cy + r * 0.3, r * 0.18, [232, 130, 145]);
  };
  virus(x + 42, y + h * 0.42, 16);
  virus(x + 78, y + h * 0.68, 10);
  // Rising bars: 2024, 2025, 2026.
  const bx = x + w * 0.48;
  const bars: [number, RGB, string][] = [[14, GREY_LT, '24'], [26, ORANGE, '25'], [44, RED, '26']];
  bars.forEach(([bh, c, lbl], i) => {
    rect(bx + i * 26, y + h - 16 - bh, 20, bh, c);
    drawText(bx + i * 26 + 5, y + h - 13, lbl, 1, INK);
  });
  line(bx - 4, y + h - 16, bx + 82, y + h - 16, INK);
  // Red cross.
  rect(x + w - 30, y + 8, 8, 22, RED);
  rect(x + w - 37, y + 15, 22, 8, RED);
}

// AI chips: a circuit board with a glowing chip.
function sceneChips(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [20, 34, 66], [12, 22, 46]);
  // Circuit traces.
  for (let i = 0; i < 8; i++) {
    const ty = y + 8 + i * 9;
    const tx0 = x + 6 + (i % 3) * 8;
    line(tx0, ty, x + w * 0.30, ty, GOLD);
    line(x + w * 0.30, ty, x + w * 0.30 + 8, ty + 6, GOLD);
    circle(tx0, ty, 2, GOLD_LT);
    circle(x + w * 0.30 + 8, ty + 6, 2, GOLD_LT);
  }
  for (let i = 0; i < 5; i++) {
    const tx0 = x + w - 10 - i * 10;
    line(tx0, y + 8, tx0, y + h * 0.32, GOLD);
    circle(tx0, y + 8, 2, GOLD_LT);
  }
  // The chip.
  const cx0 = x + w * 0.5 - 26, cy = y + h * 0.5 - 20;
  rect(cx0 - 4, cy - 4, 60, 48, GOLD);
  rect(cx0, cy, 52, 40, [14, 20, 38]);
  for (let i = 0; i < 6; i++) {
    rect(cx0 - 9, cy + 3 + i * 6, 5, 3, GOLD_LT);
    rect(cx0 + 56, cy + 3 + i * 6, 5, 3, GOLD_LT);
    rect(cx0 + 3 + i * 8, cy - 9, 3, 5, GOLD_LT);
    rect(cx0 + 3 + i * 8, cy + 44, 3, 5, GOLD_LT);
  }
  drawText(cx0 + 16, cy + 13, 'AI', 2, GOLD_LT);
  circle(cx0 + 52, cy + 40, 3, ORANGE_LT);
  circle(x + w * 0.14, y + h * 0.72, 4, TEAL);
  circle(x + w * 0.86, y + h * 0.78, 4, ORANGE_LT);
}

// ------------------------------------------------------- dot-matrix map
// Stylised continents as lon/lat ellipses; sampled on a dot grid.
const LAND: [number, number, number, number][] = [
  // North America
  [-100, 50, 38, 16], [-96, 33, 24, 9], [-88, 18, 10, 5], [-152, 64, 13, 6],
  [-42, 74, 11, 7], [-105, 60, 20, 8],
  // South America
  [-60, -8, 15, 16], [-66, -28, 9, 11],
  // Europe
  [14, 52, 19, 9], [10, 63, 9, 6], [24, 41, 9, 5], [-2, 54, 4, 4],
  // Africa
  [16, 6, 19, 17], [22, -17, 13, 11], [35, 8, 7, 6],
  // Asia
  [85, 58, 48, 13], [105, 38, 26, 11], [78, 21, 9, 8], [104, 14, 11, 8],
  [46, 25, 13, 8], [140, 37, 7, 6], [127, 38, 6, 5], [100, 65, 30, 8],
  // Oceania
  [134, -25, 15, 8], [172, -41, 4, 5],
];

function isLand(lon: number, lat: number): boolean {
  for (const [cx, cy, rx, ry] of LAND) {
    const dx = (lon - cx) / rx, dy = (lat - cy) / ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

// The day's places, in the order they are numbered on the map.
const PLACES: [string, number, number][] = [
  ['SHENZHEN', 114.1, 22.5],
  ['HORMUZ', 56.3, 26.6],
  ['KYIV', 30.5, 50.4],
  ['ANTALYA', 30.7, 36.9],
  ['GAZA', 34.5, 31.5],
  ['WASHINGTON', -77.0, 38.9],
  ['PARIS', 2.3, 48.9],
  ['TOKYO', 139.7, 35.7],
  ['MUSCAT', 58.5, 23.6],
  ['LONDON', -0.1, 51.5],
];

function drawMap(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [206, 222, 236], [188, 208, 226]);
  const step = 6;
  for (let gy = 3; gy < h - 2; gy += step) {
    for (let gx = 3; gx < w - 2; gx += step) {
      const lon = (gx / w) * 360 - 180;
      const lat = 90 - (gy / h) * 150;
      if (isLand(lon, lat)) circle(x + gx, y + gy, 1.8, [58, 78, 104]);
    }
  }
  // Numbered place markers.
  PLACES.forEach(([name, lon, lat], i) => {
    const px0 = x + ((lon + 180) / 360) * w;
    const py = y + ((90 - lat) / 150) * h;
    circle(px0, py, 7, RED);
    ring(px0, py, 7, WHITE);
    drawTextC(px0, py - 3.5, String(i + 1), 1, WHITE);
    void name;
  });
}

// ------------------------------------------------------------------ layout
const M = 16; // page margin
const CW = W - 2 * M; // 992 content width

function rule(y: number, c: RGB, t = 2): void { rect(M, y, CW, t, c); }

function buildPage(): void {
  rect(0, 0, W, H, PAPER);

  // ---- masthead
  drawTextC(W / 2, 12, 'THE WORLD IN ONE IMAGE', 4, INK);
  line(M, 48, M + 210, 48, INK);
  line(W - M - 210, 48, W - M, 48, INK);
  drawTextC(W / 2, 50, 'ONE DAY  •  ONE PAGE  •  THE WHOLE WORLD', 1, INK_SOFT);
  rule(62, INK, 2);
  rule(66, INK, 1);

  // ---- date band
  rect(M, 72, CW, 42, RED);
  drawText(M + 14, 84, 'THE DAY IN WORLD NEWS', 1, [255, 220, 220]);
  drawTextC(W / 2, 79, 'TUESDAY 17 NOVEMBER 2026', 4, WHITE);
  drawTextR(W - M - 14, 84, 'ONE PAGE, ONE DAY', 1, [255, 220, 220]);

  // ---- lead story (left) + map column (right)
  const leadX = M, leadY = 122, leadW = 620, leadH = 236;
  const colX = leadX + leadW + 8, colW = W - M - colX;
  frame(leadX, leadY, leadW, leadH, INK);
  rect(leadX + 2, leadY + 2, leadW - 4, leadH - 4, CREAM);
  drawText(leadX + 12, leadY + 10, 'LEAD STORY — DIPLOMACY', 1, RED);
  drawText(leadX + 12, leadY + 24, 'XI, TRUMP AND PUTIN', 3, INK);
  drawText(leadX + 12, leadY + 51, 'TO MEET IN SHENZHEN', 3, INK);
  setClip(leadX + 10, leadY + 82, leadW - 20, 96);
  sceneLead(leadX + 10, leadY + 82, leadW - 20, 96);
  resetClip();
  const leadBody = [
    'CHINA CONFIRMED THE THREE LEADERS',
    'WILL MEET ON THURSDAY 19 NOVEMBER',
    'IN SHENZHEN, ON THE APEC SIDELINES.',
  ];
  drawLines(leadX + 12, leadY + 186, leadBody, 2, INK_SOFT, 17);

  // Map panel.
  const mapY = leadY, mapH = 188;
  frame(colX, mapY, colW, mapH, INK);
  rect(colX + 2, mapY + 2, colW - 4, mapH - 4, CREAM);
  drawTextC(colX + colW / 2, mapY + 9, 'THE DAY ON THE MAP', 2, INK);
  setClip(colX + 10, mapY + 28, colW - 20, 126);
  drawMap(colX + 10, mapY + 28, colW - 20, 126);
  resetClip();
  drawText(colX + 10, mapY + 160, '1 SHENZHEN  2 HORMUZ  3 KYIV  4 ANTALYA  5 GAZA', 1, INK_SOFT);
  drawText(colX + 10, mapY + 171, '6 WASHINGTON  7 PARIS  8 TOKYO  9 MUSCAT  10 LONDON', 1, INK_SOFT);

  // Editor's note box under the map.
  const noteY = mapY + mapH + 8, noteH = leadY + leadH - noteY;
  frame(colX, noteY, colW, noteH, INK);
  rect(colX + 2, noteY + 2, 6, noteH - 4, RED);
  drawText(colX + 16, noteY + 7, 'EVERY STORY ON THIS PAGE HAPPENED', 1, INK);
  drawText(colX + 16, noteY + 18, 'OR WAS FIRST REPORTED ON 17 NOV 2026.', 1, INK);
  drawText(colX + 16, noteY + 31, '11 STORIES  •  10 PLACES  •  5 NUMBERS', 1, RED);

  // ---- numbers band
  const numY = 366, numH = 50;
  const stats: [string, string][] = [
    ['264', 'DAYS OF THE US-IRAN WAR'],
    ['5,412', 'US MEASLES CASES IN 2026'],
    ['$120BN', 'ADAPTATION FINANCE A YEAR'],
    ['19 NOV', 'UNTIL THE SUMMIT IN SHENZHEN'],
    ['1 WICKET', "INDIA BEAT PAKISTAN, U19 FINAL"],
  ];
  stats.forEach(([num, lbl], i) => {
    const bx = M + i * 199;
    frame(bx, numY, 196, numH, INK);
    rect(bx + 2, numY + 2, 192, numH - 4, i % 2 === 0 ? CREAM : PAPER2);
    drawTextC(bx + 98, numY + 8, num, 3, RED);
    drawTextC(bx + 98, numY + 33, lbl, 1, INK_SOFT);
  });

  // ---- six story panels
  const panels: {
    tag: string; head: string; body: string;
    scene: (x: number, y: number, w: number, h: number) => void;
  }[] = [
    {
      tag: 'WAR AT SEA — DAY 264',
      head: 'TANKERS BURN IN HORMUZ',
      body: 'US JETS STRUCK AN IRGC MISSILE SITE ON QESHM ISLAND. TANKERS HIT MINES IN THE STRAIT. A THIRD US CARRIER ARRIVED IN THE REGION.',
      scene: sceneHormuz,
    },
    {
      tag: 'UKRAINE — KYIV',
      head: 'KYIV HIT, BRIDGE SHUT',
      body: 'RUSSIAN BALLISTIC MISSILES CUT HEAT AND WATER IN KYIV. THE CRIMEAN BRIDGE CLOSED AFTER A UKRAINIAN STRIKE.',
      scene: sceneKyiv,
    },
    {
      tag: 'CLIMATE — COP31, ANTALYA',
      head: 'DRAFT: PHASE OUT FOSSIL FUELS',
      body: 'THE ANTALYA DRAFT CALLS FOR FASTER FOSSIL-FUEL PHASE-OUT AND TRIPLING ADAPTATION FINANCE TO AT LEAST $120BN A YEAR BY 2035.',
      scene: sceneCOP,
    },
    {
      tag: 'GAZA — AID CRISIS',
      head: 'OPEN GAZA CROSSINGS NOW',
      body: 'THE UK, AUSTRALIA, CANADA AND ITALY JOINTLY URGED ISRAEL TO OPEN THE CROSSINGS, CALLING THE AID CRISIS CATASTROPHIC.',
      scene: sceneGaza,
    },
    {
      tag: 'HEALTH — UNITED STATES',
      head: 'US LOSES MEASLES-FREE STATUS',
      body: 'PAHO ANNOUNCED THE US HAS LOST ITS MEASLES ELIMINATION STATUS AFTER 26 YEARS. THE CDC COUNTED 5,412 CASES IN 2026.',
      scene: sceneMeasles,
    },
    {
      tag: 'TECH — MARKETS',
      head: 'AI CHIP CURBS HIT CHINA',
      body: 'THE US COMMERCE DEPARTMENT TIGHTENED AI CHIP EXPORT RULES TO CLOSE A FOREIGN-PURCHASE LOOPHOLE. NVIDIA REPORTED EARNINGS AFTER THE BELL.',
      scene: sceneChips,
    },
  ];
  const gridY = 424, rowH = 208, colW2 = 320;
  panels.forEach((p, i) => {
    const px0 = M + (i % 3) * (colW2 + 8);
    const py = gridY + Math.floor(i / 3) * (rowH + 8);
    frame(px0, py, colW2, rowH, INK);
    rect(px0 + 2, py + 2, colW2 - 4, rowH - 4, CREAM);
    drawText(px0 + 10, py + 9, p.tag, 1, RED);
    setClip(px0 + 10, py + 22, colW2 - 20, 76);
    p.scene(px0 + 10, py + 22, colW2 - 20, 76);
    resetClip();
    frame(px0 + 10, py + 22, colW2 - 20, 76, INK, 1);
    const headLines = wrapText(p.head, colW2 - 20, 2, 2);
    drawLines(px0 + 10, py + 106, headLines, 2, INK, 17);
    const bodyY = py + 106 + headLines.length * 17 + 6;
    const bodyLines = wrapText(p.body, colW2 - 20, 1.6, 5);
    drawLines(px0 + 10, bodyY, bodyLines, 1.6, INK_SOFT, 14);
  });

  // ---- world in brief
  const briefY = 848, briefH = 92;
  frame(M, briefY, CW, briefH, INK);
  rect(M + 2, briefY + 2, CW - 4, briefH - 4, PAPER2);
  drawTextC(W / 2, briefY + 7, 'WORLD IN BRIEF', 2, RED);
  const briefs: [string, string, string][] = [
    ['PARIS', 'DEPARDIEU GUILTY', 'THE ACTOR PLEADS GUILTY TO SEXUAL ASSAULT CHARGES AND DROPS HIS APPEAL.'],
    ['TOKYO', 'JETS SCRAMBLED', 'JAPAN SCRAMBLES JETS AFTER RUSSIAN AIRCRAFT ENTER ITS AIRSPACE.'],
    ['MUSCAT', 'INDIA WIN U19 CUP', 'INDIA EDGE PAKISTAN BY ONE WICKET OFF THE LAST BALL IN OMAN.'],
    ['LONDON', 'UK SANCTIONS', 'BRITAIN ANNOUNCES SANCTIONS LINKED TO THE WEST BANK AND GAZA.'],
  ];
  briefs.forEach(([city, head, body], i) => {
    const bx = M + 6 + i * 248;
    if (i > 0) line(bx - 5, briefY + 28, bx - 5, briefY + briefH - 6, GREY_LT);
    drawText(bx, briefY + 26, city, 1, RED);
    drawText(bx, briefY + 37, head, 2, INK);
    const bl = wrapText(body, 230, 1.5, 3);
    drawLines(bx, briefY + 54, bl, 1.5, INK_SOFT, 11);
  });

  // ---- ticker
  const tickY = 948;
  rect(M, tickY, CW, 34, INK);
  drawTextC(
    W / 2, tickY + 11,
    'HORMUZ • KYIV • COP31 • GAZA • MEASLES • CHIP CURBS • DEPARDIEU • JAPAN JETS • INDIA WIN • SUMMIT 19 NOV',
    1.5, WHITE,
  );

  // ---- footer
  drawTextC(W / 2, 992, 'THE WORLD IN ONE IMAGE • TUESDAY 17 NOVEMBER 2026 • DRAWN IN CODE • MAKE.FUN', 1, INK_SOFT);
}

// ---------------------------------------------------------------------- main
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
buildPage();
writeFileSync(join(outDir, 'entry.png'), encodePNG());
