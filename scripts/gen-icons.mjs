import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const GRID = 32;
const PAL = {
  bg: [7, 13, 30, 255],
  frame: [44, 65, 112, 255],
  mint: [78, 242, 163, 255],
  gold: [245, 197, 66, 255],
  shadow: [3, 6, 15, 255],
  edge: [47, 93, 39, 255],
  face: [159, 209, 138, 255],
  trim: [109, 163, 90, 255],
  oval: [216, 239, 201, 255],
  ink: [30, 61, 24, 255],
  blush: [255, 158, 196, 255]
};

function buildMasterGrid() {
  const g = Array.from({ length: GRID }, () => Array(GRID).fill(PAL.bg));
  const fill = (x, y, w, h, col) => {
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= GRID) continue;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= GRID) continue;
        g[yy][xx] = col;
      }
    }
  };

  // Terminal border
  fill(1, 1, 30, 1, PAL.frame);
  fill(1, 30, 30, 1, PAL.frame);
  fill(1, 1, 1, 30, PAL.frame);
  fill(30, 1, 1, 30, PAL.frame);

  // Upward ticker line accent
  fill(2, 27, 3, 2, PAL.mint);
  fill(5, 25, 3, 2, PAL.mint);
  fill(8, 26, 3, 2, PAL.mint);
  fill(11, 23, 3, 2, PAL.mint);
  fill(24, 6, 2, 3, PAL.mint);
  fill(26, 4, 2, 2, PAL.gold);
  fill(27, 3, 2, 2, PAL.gold);

  // Drop shadow & dollar bill outer body
  fill(5, 11, 26, 15, PAL.shadow);
  fill(3, 9, 26, 15, PAL.edge);
  fill(4, 10, 24, 13, PAL.face);

  // Inner trim & corner pips
  fill(5, 11, 22, 1, PAL.trim);
  fill(5, 21, 22, 1, PAL.trim);
  fill(5, 11, 1, 11, PAL.trim);
  fill(26, 11, 1, 11, PAL.trim);
  fill(7, 13, 1, 3, PAL.ink);
  fill(24, 17, 1, 3, PAL.ink);

  // Center oval
  fill(12, 12, 8, 9, PAL.oval);
  fill(11, 13, 10, 7, PAL.oval);

  // Happy squinting eyes, blush & smile
  fill(12, 15, 1, 1, PAL.ink);
  fill(13, 14, 1, 1, PAL.ink);
  fill(14, 15, 1, 1, PAL.ink);
  fill(17, 15, 1, 1, PAL.ink);
  fill(18, 14, 1, 1, PAL.ink);
  fill(19, 15, 1, 1, PAL.ink);
  fill(11, 17, 1, 1, PAL.blush);
  fill(20, 17, 1, 1, PAL.blush);
  fill(13, 17, 1, 1, PAL.ink);
  fill(18, 17, 1, 1, PAL.ink);
  fill(14, 18, 4, 1, PAL.ink);

  return g;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(master, size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(GRID - 1, Math.floor((y * GRID) / size));
    const rowOff = y * stride;
    raw[rowOff] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const sx = Math.min(GRID - 1, Math.floor((x * GRID) / size));
      const [r, g, b, a] = master[sy][sx];
      const off = rowOff + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const master = buildMasterGrid();
for (const [name, size] of [
  ['favicon.png', 64],
  ['apple-touch-icon.png', 180]
]) {
  fs.writeFileSync(path.join(ROOT, name), encodePng(master, size));
  console.log(`Generated ${name} (${size}x${size})`);
}
