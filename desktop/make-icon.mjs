// Gera o ícone do app (PNG) sem dependências: quadrado arredondado azul-violeta com balão de conversa.
import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inRR = (x, y, x0, y0, x1, y1, r) => { const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r)); return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
const inC = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

// desenha em coordenadas 0..1 com supersampling
function draw(size, { bubbleOnly = false, bg = [88, 101, 242] } = {}) {
  const buf = Buffer.alloc(size * size * 4), SS = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + .5) / SS) / size, y = (py + (sy + .5) / SS) / size;
      let col = null;
      if (bubbleOnly || inRR(x, y, 0, 0, 1, 1, .22)) col = bubbleOnly ? null : bg;
      const bubble = inRR(x, y, .2, .24, .8, .64, .12) || (y >= .6 && y <= .78 && x >= .3 && x <= .46 && (y - .6) / .18 <= (.46 - x) / .16 + .0);
      const dots = inC(x, y, .36, .44, .045) || inC(x, y, .5, .44, .045) || inC(x, y, .64, .44, .045);
      if (bubble) col = dots ? bg : [255, 255, 255];
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = SS * SS, i = (py * size + px) * 4;
    const cnt = a / 255; buf[i] = cnt ? r / cnt : 0; buf[i + 1] = cnt ? g / cnt : 0; buf[i + 2] = cnt ? b / cnt : 0; buf[i + 3] = a / n;
  }
  return png(size, size, buf);
}
fs.mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./build/icon.png', import.meta.url), draw(512));
fs.writeFileSync(new URL('./build/tray.png', import.meta.url), draw(32));
console.log('ícones gerados em desktop/build');
