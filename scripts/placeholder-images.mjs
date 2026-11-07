// Generates temporary, clearly-synthetic images for a sample studio:
// hero.jpg, logo.png and gallery/NN.jpg. Owner photos always replace these.
// usage: node scripts/placeholder-images.mjs <slug> [accentHex]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const slug = process.argv[2];
if (!slug) throw new Error('usage: placeholder-images.mjs <slug> [accent]');
const dir = path.join('tenants', slug);
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'tenant.json'), 'utf8'));
const accent = process.argv[3] || cfg.accent || '#D4AF37';
fs.mkdirSync(path.join(dir, 'gallery'), { recursive: true });

// Stylised coupe side profile (normalised to 1000 x 300 box)
const carPath =
  'M40 230 C 40 205 60 190 95 184 L 250 160 C 300 120 360 92 450 82 C 560 72 650 80 720 112 L 800 150 ' +
  'C 880 160 935 172 955 196 C 968 210 965 232 950 238 L 905 240 C 900 196 850 176 815 178 C 775 180 745 208 742 240 ' +
  'L 300 240 C 297 200 266 176 228 178 C 190 180 162 208 160 240 L 70 240 C 50 240 40 238 40 230 Z';
const glassPath = 'M290 160 C 330 125 380 104 450 97 C 540 89 620 96 680 122 L 712 152 Z';

function scene({ w, h, hue, lights = 'hex', angle = 0, zoom = 1, seed = 1, car = true, floorY = 0.78 }) {
  const cx = w / 2;
  const carW = w * 0.78 * zoom;
  const s = carW / 1000;
  const carX = cx - carW / 2 + angle * w * 0.05;
  const carY = h * floorY - 240 * s;
  const rnd = (n) => {
    const x = Math.sin(seed * 999 + n * 77.7) * 10000;
    return x - Math.floor(x);
  };
  let light = '';
  if (lights === 'hex') {
    const r = w * 0.045;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 15; col++) {
        const x = col * r * 1.75 + (row % 2 ? r * 0.87 : 0) - r;
        const y = h * 0.08 + row * r * 1.5;
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          return `${x + r * Math.cos(a)},${y + r * 0.55 * Math.sin(a)}`;
        }).join(' ');
        light += `<polygon points="${pts}" fill="none" stroke="rgba(255,250,235,${0.55 + rnd(row * 12 + col) * 0.35})" stroke-width="${w * 0.004}"/>`;
      }
  } else {
    for (let i = 0; i < 6; i++) {
      const x = w * (0.05 + i * 0.18);
      light += `<rect x="${x}" y="${h * 0.06}" width="${w * 0.12}" height="${h * 0.012}" rx="${h * 0.006}" fill="rgba(255,248,230,0.85)"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="80%">
      <stop offset="0" stop-color="hsl(${hue},12%,20%)"/><stop offset="0.55" stop-color="hsl(${hue},10%,9%)"/><stop offset="1" stop-color="#07080b"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15171d"/><stop offset="1" stop-color="#050608"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue},14%,${34}%)"/><stop offset="0.35" stop-color="hsl(${hue},10%,16%)"/>
      <stop offset="0.6" stop-color="hsl(${hue},12%,9%)"/><stop offset="1" stop-color="#040506"/>
    </linearGradient>
    <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(255,255,255,0)"/><stop offset="0.5" stop-color="rgba(255,252,240,0.9)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <radialGradient id="rim" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#2a2d35"/><stop offset="0.62" stop-color="#9aa0aa"/><stop offset="0.7" stop-color="#17191e"/><stop offset="1" stop-color="#050506"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="${w * 0.012}"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="${w * 0.003}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${light}
  <rect y="${h * (floorY - 0.08)}" width="${w}" height="${h * (1.08 - floorY)}" fill="url(#floor)"/>
  <ellipse cx="${cx}" cy="${h * (floorY + 0.01)}" rx="${w * 0.45}" ry="${h * 0.035}" fill="${accent}" opacity="0.10" filter="url(#blur)"/>
  ${car ? `<g transform="translate(${carX} ${carY}) scale(${s})">
    <ellipse cx="500" cy="244" rx="470" ry="18" fill="#000" opacity="0.85" filter="url(#soft)"/>
    <path d="${carPath}" fill="url(#body)" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
    <path d="${glassPath}" fill="#0a0c10" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
    <path d="M110 186 C 300 150 600 140 940 190" stroke="url(#streak)" stroke-width="5" fill="none" opacity="0.85"/>
    <path d="M300 205 L 760 205" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
    <rect x="905" y="190" width="40" height="8" rx="4" fill="${accent}" opacity="0.9"/>
    <rect x="60" y="196" width="34" height="7" rx="3" fill="#b8202a" opacity="0.9"/>
    <circle cx="229" cy="240" r="58" fill="url(#rim)"/><circle cx="229" cy="240" r="18" fill="#0c0d10"/>
    <circle cx="815" cy="240" r="58" fill="url(#rim)"/><circle cx="815" cy="240" r="18" fill="#0c0d10"/>
  </g>
  <g transform="translate(${carX} ${h * (floorY + 0.012)}) scale(${s} ${-s * 0.35})" opacity="0.18">
    <path d="${carPath}" fill="url(#body)"/>
  </g>` : ''}
  <rect width="${w}" height="${h}" fill="url(#bg)" opacity="0.12"/>
</svg>`;
}

const out = async (svg, file, opts = {}) => {
  let img = sharp(Buffer.from(svg));
  if (file.endsWith('.jpg')) img = img.jpeg({ quality: 82, mozjpeg: true });
  else img = img.png();
  await img.toFile(path.join(dir, file));
  console.log('  wrote', path.join(dir, file), opts.note ?? '');
};

await out(scene({ w: 1600, h: 1100, hue: 220, lights: 'hex', zoom: 0.62, seed: 1, floorY: 0.56 }), 'hero.jpg');
const variants = [
  { hue: 30, lights: 'hex', zoom: 1.15, angle: 1 },
  { hue: 210, lights: 'bars', zoom: 1.0, angle: -1 },
  { hue: 140, lights: 'bars', zoom: 1.25, angle: 2 },
  { hue: 260, lights: 'hex', zoom: 0.95, angle: 0 },
  { hue: 10, lights: 'bars', zoom: 1.1, angle: -2 },
  { hue: 190, lights: 'hex', zoom: 1.35, angle: 1 },
];
for (const [i, v] of variants.entries()) {
  await out(scene({ w: 900, h: 675, ...v, seed: i + 3 }), `gallery/${String(i + 1).padStart(2, '0')}.jpg`);
}
const letter = (cfg.shortName || cfg.name).trim()[0].toUpperCase();
await out(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1e26"/><stop offset="1" stop-color="#0b0c10"/></linearGradient></defs>
  <rect width="512" height="512" rx="0" fill="url(#g)"/><rect x="56" y="56" width="400" height="400" rx="96" fill="none" stroke="${accent}" stroke-width="10" opacity="0.9"/>
  <text x="256" y="330" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="230" fill="${accent}">${letter}</text></svg>`,
  'logo.png',
);
