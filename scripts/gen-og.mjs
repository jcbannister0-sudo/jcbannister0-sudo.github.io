import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const W = 1200;
const H = 630;
const buf = new Uint8Array(W * H * 4);

// Solid terminal backdrop #050816
for (let i = 0; i < buf.length; i += 4) {
  buf[i] = 5;
  buf[i + 1] = 8;
  buf[i + 2] = 22;
  buf[i + 3] = 255;
}

function blend(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H || a <= 0) return;
  const idx = (y * W + x) * 4;
  if (a >= 1) {
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    return;
  }
  const inv = 1 - a;
  buf[idx] = Math.round(r * a + buf[idx] * inv);
  buf[idx + 1] = Math.round(g * a + buf[idx + 1] * inv);
  buf[idx + 2] = Math.round(b * a + buf[idx + 2] * inv);
}

function fillRect(x, y, w, h, r, g, b, a = 1) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      blend(px, py, r, g, b, a);
    }
  }
}

// 1. Terminal gridlines (exact index.html palette)
for (const gx of [110, 250, 390, 530, 670, 810, 950, 1090]) {
  fillRect(gx, 0, 3, H, 44, 65, 112, 0.28);
}
for (const gy of [95, 215, 335, 455, 575]) {
  if (gy === 335) {
    fillRect(0, gy, W, 3, 78, 242, 163, 0.14);
  } else {
    fillRect(0, gy, W, 3, 44, 65, 112, 0.26);
  }
}

// 2. Glowing mint stock chart & vertical gradient fill
const PTS = [
  [-10, 520],
  [95, 455],
  [165, 488],
  [285, 342],
  [388, 434],
  [504, 396]
];

function yTopAt(x) {
  for (let i = 0; i < PTS.length - 1; i++) {
    const [x1, y1] = PTS[i];
    const [x2, y2] = PTS[i + 1];
    if (x >= x1 && x <= x2) {
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    }
  }
  return H;
}

// Area fill underneath polyline cleanly stopping at x = 504
for (let x = 0; x <= 504; x++) {
  const yStart = Math.max(0, Math.ceil(yTopAt(x)));
  for (let y = yStart; y < H; y++) {
    const t = Math.max(0, Math.min(1, (y - 330) / (H - 330)));
    const a = 0.24 - t * 0.22;
    blend(x, y, 78, 242, 163, a);
  }
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Polyline stroke (outer glow, solid mint core, inner gleam)
for (let y = 315; y <= 550; y++) {
  for (let x = 0; x <= 518; x++) {
    let d = Infinity;
    for (let i = 0; i < PTS.length - 1; i++) {
      const sd = distToSeg(x, y, PTS[i][0], PTS[i][1], PTS[i + 1][0], PTS[i + 1][1]);
      if (sd < d) d = sd;
    }
    if (d < 15) {
      blend(x, y, 78, 242, 163, 0.28 * Math.pow(1 - d / 15, 1.8));
    }
    if (d < 4.5) {
      blend(x, y, 78, 242, 163, d <= 3.5 ? 1 : 4.5 - d);
    }
    if (d < 2.0) {
      blend(x, y, 198, 255, 228, 0.55 * (1 - d / 2.0));
    }
  }
}

// 3. Exact drawBill pixel-art VEBL dollar bill centered at (504, 396)
const BILL_S = 8;
const BILL_X = 416;
const BILL_Y = 352;
const billPx = (gx, gy, gw, gh, r, g, b, a = 1) =>
  fillRect(BILL_X + gx * BILL_S, BILL_Y + gy * BILL_S, gw * BILL_S, gh * BILL_S, r, g, b, a);

billPx(2, 2, 22, 11, 0, 0, 0, 0.38);       // drop shadow
billPx(-1, -1, 24, 13, 47, 93, 39);        // edge #2f5d27
billPx(0, 0, 22, 11, 159, 209, 138);       // face #9fd18a
billPx(1, 1, 20, 1, 109, 163, 90);         // top trim #6da35a
billPx(1, 9, 20, 1, 109, 163, 90);         // bottom trim
billPx(1, 1, 1, 9, 109, 163, 90);          // left trim
billPx(20, 1, 1, 9, 109, 163, 90);         // right trim
billPx(3, 3, 1, 3, 30, 61, 24);            // left pip #1e3d18
billPx(18, 5, 1, 3, 30, 61, 24);           // right pip
billPx(7, 2, 8, 7, 216, 239, 201);         // center oval #d8efc9
billPx(6, 3, 10, 5, 216, 239, 201);
billPx(8, 3, 1, 2, 30, 61, 24);            // left eye
billPx(13, 3, 1, 2, 30, 61, 24);           // right eye
billPx(9, 7, 4, 1, 30, 61, 24);            // neutral mouth

// 4. Retro "$VEBL $1.00M" ticker pill
fillRect(624, 362, 296, 68, 10, 18, 38, 0.94);
fillRect(624, 362, 296, 6, 78, 242, 163, 1);
fillRect(624, 424, 296, 6, 78, 242, 163, 1);

const FONT_5X7 = {
  $: ['..#..', '.###.', '#.#..', '.###.', '..#.#', '.###.', '..#..'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  1: ['.##.', '###.', '.##.', '.##.', '.##.', '.##.', '####'],
  '.': ['..', '..', '..', '..', '..', '##', '##'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#']
};

function drawBitmapText(str, startX, startY, scale, gapCols, font, r, g, b, a = 1) {
  let col = 0;
  for (const ch of str) {
    const rows = font[ch];
    const cw = rows[0].length;
    for (let ry = 0; ry < rows.length; ry++) {
      for (let rx = 0; rx < cw; rx++) {
        if (rows[ry][rx] === '#') {
          fillRect(startX + (col + rx) * scale, startY + ry * scale, scale, scale, r, g, b, a);
        }
      }
    }
    col += cw + gapCols;
  }
}

drawBitmapText('$VEBL $1.00M', 642, 382, 4, 1, FONT_5X7, 78, 242, 163, 1);

// 5. Bold chromatic pixel "VEBL" wordmark at top
const WORDMARK_FONT = {
  V: ['##....##', '##....##', '##....##', '.##..##.', '.##..##.', '..####..', '...##...'],
  E: ['#######', '##.....', '##.....', '######.', '##.....', '##.....', '#######'],
  B: ['######.', '##...##', '##...##', '######.', '##...##', '##...##', '######.'],
  L: ['##.....', '##.....', '##.....', '##.....', '##.....', '##.....', '#######']
};

// Soft warm gold glow halo behind the wordmark
for (let y = 40; y <= 222; y++) {
  for (let x = 300; x <= 900; x++) {
    const nx = (x - 600) / 290;
    const ny = (y - 131) / 85;
    const d2 = nx * nx + ny * ny;
    if (d2 < 1) {
      blend(x, y, 245, 197, 66, 0.13 * Math.pow(1 - d2, 2));
    }
  }
}

drawBitmapText('VEBL', 348, 82, 14, 2, WORDMARK_FONT, 78, 242, 163, 1);   // mint -7px
drawBitmapText('VEBL', 362, 82, 14, 2, WORDMARK_FONT, 245, 197, 66, 1);   // gold +7px
drawBitmapText('VEBL', 355, 82, 14, 2, WORDMARK_FONT, 255, 255, 255, 1);  // crisp white

// 6. CRT scanlines & radial vignette (matching #crt)
for (let y = 0; y < H; y++) {
  const isScanline = y % 3 === 0;
  for (let x = 0; x < W; x++) {
    if (isScanline) blend(x, y, 0, 0, 0, 0.14);
    const d = Math.hypot((x - 600) / 600, (y - 315) / 315);
    if (d > 0.58) {
      const va = Math.min(0.45, Math.pow((d - 0.58) / 0.85, 1.6) * 0.45);
      blend(x, y, 0, 0, 0, va);
    }
  }
}

// PNG encoder (zero dependencies)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const stride = W * 4 + 1;
const raw = Buffer.alloc(stride * H);
for (let y = 0; y < H; y++) {
  const rowOff = y * stride;
  raw[rowOff] = 0; // filter None
  raw.set(buf.subarray(y * W * 4, (y + 1) * W * 4), rowOff + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0))
]);

const outPath = path.join(ROOT, 'og-preview.png');
fs.writeFileSync(outPath, png);
console.log(`Generated og-preview.png (${W}x${H}, ${(png.length / 1024).toFixed(1)} KB)`);
