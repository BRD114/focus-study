/**
 * make-icons.js — 零依赖生成 App 图标 PNG
 * 设计：松针绿底 + 白色同心圆靶心（专注 / 收敛 / 聚焦）
 * 运行：node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 绘制 ---------------- */
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG = hexToRgb('#3C6B53');
const FG = [255, 255, 255];

/** 带圆角的实心背景 + 靶心，3x 超采样抗锯齿 */
function draw(size, radiusRatio) {
  const SS = 3;
  const W = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  const cx = W / 2, cy = W / 2;
  const rOuter = W * 0.30;
  const rInner = W * 0.075;
  const stroke = W * 0.058;
  const rCorner = W * radiusRatio;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;

          // 圆角矩形遮罩
          const dx = Math.max(Math.abs(px - cx) - (W / 2 - rCorner), 0);
          const dy = Math.max(Math.abs(py - cy) - (W / 2 - rCorner), 0);
          const inCorner = Math.hypot(dx, dy) <= rCorner;
          const inside = rCorner === 0 ? true : (Math.abs(px - cx) <= W / 2 && Math.abs(py - cy) <= W / 2 && inCorner);

          if (!inside) { continue; }

          // 靶心：外环 + 圆心点
          const dist = Math.hypot(px - cx, py - cy);
          const onRing = Math.abs(dist - rOuter) <= stroke / 2;
          const onDot = dist <= rInner;

          let r = BG[0], g = BG[1], b = BG[2];
          if (onRing || onDot) { r = FG[0]; g = FG[1]; b = FG[2]; }
          rs += r; gs += g; bs += b; as += 255;
        }
      }
      const total = SS * SS;
      const i = (y * size + x) * 4;
      if (as === 0) { buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0; continue; }
      buf[i] = Math.round(rs / (as / 255));
      buf[i + 1] = Math.round(gs / (as / 255));
      buf[i + 2] = Math.round(bs / (as / 255));
      buf[i + 3] = Math.round(as / total);
    }
  }
  return buf;
}

/* ---------------- 输出 ---------------- */
const outDir = path.join(__dirname, '..', 'www', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, radius: 0.22 },
  { name: 'icon-512.png', size: 512, radius: 0.22 },
  { name: 'maskable-512.png', size: 512, radius: 0 },   // 满色铺底，交给系统裁形
  { name: 'favicon.png', size: 64, radius: 0.22 }
];

targets.forEach(t => {
  const rgba = draw(t.size, t.radius);
  fs.writeFileSync(path.join(outDir, t.name), encodePNG(t.size, t.size, rgba));
  console.log('✓', t.name, t.size + 'x' + t.size);
});
console.log('图标生成完成 →', outDir);
