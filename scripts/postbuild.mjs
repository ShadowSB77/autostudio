// After `vite build`: give every studio in tenants/ its own address, icon set and install manifest.
//   dist/s/<slug>/index.html (+ services/, my/, admin/)  — same app, studio-specific <head>
//   dist/s/<slug>/manifest.webmanifest                   — name, icons, start_url, scope
//   dist/s/<slug>/icons/*.png                            — generated from tenants/<slug>/logo.png
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const cfg = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const base = cfg.basePath; // e.g. /autostudio/
const dist = 'dist';
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const BG = '#0B0C10';

const slugs = fs.readdirSync('tenants').filter((d) => !d.startsWith('_') && fs.existsSync(path.join('tenants', d, 'tenant.json')));
for (const slug of slugs) {
  const c = JSON.parse(fs.readFileSync(path.join('tenants', slug, 'tenant.json'), 'utf8'));
  const out = path.join(dist, 's', slug);
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  const logo = path.join('tenants', slug, c.logo || 'logo.png');
  const icon = async (size, file, { pad = 0 } = {}) => {
    const inner = Math.round(size * (1 - pad * 2));
    const img = await sharp(logo).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
      .composite([{ input: img, gravity: 'center' }]).png().toFile(path.join(out, 'icons', file));
  };
  await icon(192, 'icon-192.png');
  await icon(512, 'icon-512.png');
  await icon(512, 'maskable-512.png', { pad: 0.12 });
  await icon(180, 'apple-touch-icon.png', { pad: 0.06 });
  await icon(64, 'favicon-64.png');

  const scope = `${base}s/${slug}/`;
  const manifest = {
    id: scope,
    name: c.name,
    short_name: c.shortName || c.name.slice(0, 12),
    description: c.tagline || `Онлайн-запись: ${c.name}`,
    lang: 'ru',
    start_url: scope,
    scope,
    display: 'standalone',
    orientation: 'portrait',
    background_color: BG,
    theme_color: BG,
    icons: [
      { src: `${scope}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${scope}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${scope}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Записаться', url: `${scope}#booking` },
      { name: 'Моя запись', url: `${scope}my` },
    ],
  };
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  const head = [
    `<link rel="manifest" href="${scope}manifest.webmanifest" />`,
    `<link rel="apple-touch-icon" href="${scope}icons/apple-touch-icon.png" />`,
    `<link rel="icon" type="image/png" href="${scope}icons/favicon-64.png" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(manifest.short_name)}" />`,
    `<meta name="application-name" content="${esc(manifest.short_name)}" />`,
    `<meta name="description" content="${esc(manifest.description)}" />`,
    `<meta property="og:title" content="${esc(c.name)}" />`,
    `<meta property="og:description" content="${esc(manifest.description)}" />`,
  ].join('\n    ');
  const page = html
    .replace('<!--tenant-head-->', head)
    .replace(/<link rel="icon" href="[^"]*favicon\.svg"[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(c.name)} — запись онлайн</title>`);
  for (const sub of ['', 'services', 'my', 'admin']) {
    fs.mkdirSync(path.join(out, sub), { recursive: true });
    fs.writeFileSync(path.join(out, sub, 'index.html'), page);
  }
  console.log(`  studio page: ${scope}`);
}
// Unknown deep links still load the app (GitHub Pages serves 404.html)
fs.copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`postbuild: ${slugs.length} studio(s)`);
