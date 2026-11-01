// gera build/splash.bmp (mostrada pelo executável portátil enquanto ele se descompacta): rode com "electron make-splash.js"
const { app, nativeImage } = require('electron'); const fs = require('fs'), path = require('path');
app.whenReady().then(() => {
  const W = 360, H = 260, S = 112, img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: S, height: S, quality: 'best' }), px = img.toBitmap(); // BGRA
  const bg = [0x22, 0x1f, 0x1e], row = Math.ceil(W * 3 / 4) * 4, out = Buffer.alloc(54 + row * H);
  out.write('BM'); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14); out.writeInt32LE(W, 18); out.writeInt32LE(H, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * H, 34);
  const ox = (W - S) >> 1, oy = 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = bg; const ix = x - ox, iy = y - oy;
    if (ix >= 0 && ix < S && iy >= 0 && iy < S) { const i = (iy * S + ix) * 4, a = px[i + 3] / 255; c = [0, 1, 2].map(k => Math.round(px[i + k] * a + bg[k] * (1 - a))); }
    else if (y >= 200 && y < 204 && x >= 100 && x < 260) c = (x - 100) % 53 < 30 ? [0xf2, 0x65, 0x58] : [0x3a, 0x38, 0x36]; // barrinha
    const o = 54 + (H - 1 - y) * row + x * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  fs.writeFileSync(path.join(__dirname, 'build', 'splash.bmp'), out); app.quit();
});
