#!/usr/bin/env node
// Studio management commands.
//   pnpm tenant:new <slug> --name "Название" [--accent #E5A93C] [--from graphite]
//   pnpm tenant:validate <slug>
//   pnpm tenant:publish <slug> [--force] [--no-push]
//   pnpm tenant:owner <slug> <email> [password]
//   pnpm tenant:check <slug> [--keep-sample]
//   pnpm tenant:list
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import sharp from 'sharp';

// behind a corporate/agent proxy Node's fetch needs this switch
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
const cfg = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const env = Object.fromEntries(
  (fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || env.ADMIN_TOKEN;
const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a, i, arr) => {
  const k = a.slice(2);
  const idx = rest.indexOf(a);
  const next = rest[idx + 1];
  return [k, next && !next.startsWith('--') ? next : true];
}));
const args = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && flags[rest[i - 1].slice(2)] === a));
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✗\x1b[0m ${m}`);
const die = (m) => { bad(m); process.exit(1); };
const siteUrl = (slug) => `${cfg.siteUrl}${cfg.basePath}s/${slug}/`;

async function ops(body) {
  if (!ADMIN_TOKEN) die('Нет ADMIN_TOKEN в .env.local');
  const r = await fetch(`${cfg.supabaseUrl}/functions/v1/ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN, apikey: cfg.supabasePublishableKey },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) die(`Сервер ответил ${r.status}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

async function validate(slug, { quiet = false } = {}) {
  const dir = path.join('tenants', slug);
  if (!fs.existsSync(path.join(dir, 'tenant.json'))) die(`Нет файла ${dir}/tenant.json`);
  const { tenantConfigSchema } = await import('../src/shared/tenantConfig.ts');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'tenant.json'), 'utf8')); } catch (e) { die(`tenant.json: ошибка JSON — ${e.message}`); }
  const r = tenantConfigSchema.safeParse(raw);
  const problems = [];
  if (!r.success) for (const i of r.error.issues) problems.push(`${i.path.join('.')}: ${i.message}`);
  if (raw.slug !== slug) problems.push(`slug в файле (${raw.slug}) не совпадает с папкой (${slug})`);
  const c = r.success ? r.data : raw;
  for (const f of [c.logo ?? 'logo.png', c.hero ?? 'hero.jpg', ...(c.gallery ?? []).map((g) => g.file)]) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { problems.push(`нет файла ${p}`); continue; }
    try {
      const m = await sharp(p).metadata();
      if (f === (c.hero ?? 'hero.jpg') && (m.width ?? 0) < 1000) problems.push(`${f}: главное фото меньше 1000 px по ширине`);
      if (f === (c.logo ?? 'logo.png') && (m.width ?? 0) < 192) problems.push(`${f}: логотип меньше 192 px`);
      if (fs.statSync(p).size > 4 * 1024 * 1024) problems.push(`${f}: файл больше 4 МБ`);
    } catch { problems.push(`${f}: не картинка`); }
  }
  try { new Intl.DateTimeFormat('ru', { timeZone: c.timezone }); } catch { problems.push(`timezone: неизвестный часовой пояс ${c.timezone}`); }
  if (c.schedule && !Object.values(c.schedule).some((d) => d.length)) problems.push('schedule: нет ни одного рабочего дня');
  const codes = new Set();
  for (const s of c.services ?? []) { if (codes.has(s.code)) problems.push(`services: повтор кода ${s.code}`); codes.add(s.code); }
  if (problems.length) { problems.forEach(bad); die(`Настройки ${slug} с ошибками (${problems.length})`); }
  if (!quiet) ok(`Настройки ${slug} в порядке: ${c.services.length} услуг, ${c.bays.length} бокс(ов), ${c.gallery.length} фото`);
  return c;
}

async function main() {
  if (cmd === 'new') {
    const slug = args[0];
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug ?? '')) die('Укажите адрес студии латиницей: pnpm tenant:new my-studio --name "Моя студия"');
    const dir = path.join('tenants', slug);
    if (fs.existsSync(dir)) die(`Папка ${dir} уже есть`);
    const from = flags.from || '_template';
    fs.mkdirSync(path.join(dir, 'gallery'), { recursive: true });
    const base = JSON.parse(fs.readFileSync(path.join('tenants', from, 'tenant.json'), 'utf8'));
    base.slug = slug;
    if (flags.name) { base.name = flags.name; base.shortName = String(flags.name).slice(0, 12); }
    if (flags.accent) base.accent = flags.accent;
    fs.writeFileSync(path.join(dir, 'tenant.json'), JSON.stringify(base, null, 2) + '\n');
    execSync(`node scripts/placeholder-images.mjs ${slug}`, { stdio: 'ignore' });
    ok(`Создана папка ${dir}`);
    console.log(`\nДальше:\n  1) отредактируйте ${dir}/tenant.json (название, адрес, телефон, цены, график)\n  2) положите фото владельца: ${dir}/hero.jpg, ${dir}/logo.png, ${dir}/gallery/*.jpg\n  3) pnpm tenant:validate ${slug}\n  4) pnpm tenant:publish ${slug}\n  5) pnpm tenant:owner ${slug} owner@mail.ru\n  6) pnpm tenant:check ${slug}`);
    return;
  }

  if (cmd === 'validate') { await validate(args[0]); return; }

  if (cmd === 'publish') {
    const slug = args[0];
    const c = await validate(slug);
    const dir = path.join('tenants', slug);
    const media = {};
    for (const f of [c.logo, c.hero, ...c.gallery.map((g) => g.file)]) {
      const buf = await sharp(path.join(dir, f)).rotate().resize({ width: f === c.hero ? 2000 : 1400, withoutEnlargement: true })
        .toFormat(f.endsWith('.png') ? 'png' : 'jpeg', { quality: 84 }).toBuffer();
      media[f] = buf.toString('base64');
    }
    const r = await ops({ action: 'publish', config: c, media, force: !!flags.force });
    if (r.skipped) ok(`Студия уже в базе (статус: ${r.status}). Данные из кабинета владельца не перезаписаны. Чтобы перезаписать: --force`);
    else ok(`Данные студии загружены в базу (${r.created ? 'новая' : 'обновлена'}), статус: образец`);
    if (!flags['no-push']) {
      try {
        execSync(`git add tenants/${slug} && git commit -m "tenant: ${slug}" --quiet || true`, { stdio: 'inherit' });
        execSync('git push --quiet origin HEAD', { stdio: 'inherit' });
        ok('Изменения отправлены на GitHub — сайт пересоберётся за 1–2 минуты');
      } catch { bad('Не удалось отправить на GitHub — выполните git push вручную'); }
    }
    console.log(`\nОбразец: ${siteUrl(slug)}\nКабинет: ${siteUrl(slug)}admin\nПосле проверки: pnpm tenant:check ${slug}`);
    return;
  }

  if (cmd === 'owner') {
    const [slug, email] = args;
    const password = args[2] || crypto.randomBytes(9).toString('base64url');
    const r = await ops({ action: 'owner', slug, email, password, resetPassword: !!args[2] });
    ok(`Владелец ${email} привязан к ${slug}`);
    console.log(`\nВход в кабинет: ${siteUrl(slug)}admin\nПочта: ${email}\nПароль: ${password}\n(пароль владелец может сменить в кабинете)`);
    fs.writeFileSync(path.join('tenants', slug, '.owner'), `${email}\n${password}\n${r.userId}\n`);
    return;
  }

  if (cmd === 'check') {
    const slug = args[0];
    await validate(slug, { quiet: true });
    let failed = 0;
    const url = siteUrl(slug);
    const t = (m, cond) => { cond ? ok(m) : (bad(m), failed++); };
    const page = await fetch(url).catch(() => null);
    t(`Страница открывается: ${url}`, page?.ok);
    const html = page?.ok ? await page.text() : '';
    t('Своя иконка и настройки установки на телефон', html.includes(`s/${slug}/manifest.webmanifest`));
    const man = await fetch(`${url}manifest.webmanifest`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    t('Манифест: название, адрес запуска и режим без адресной строки', !!man && man.display === 'standalone' && man.start_url?.includes(`/s/${slug}/`));
    for (const icon of man?.icons ?? []) {
      const r = await fetch(new URL(icon.src, url)).catch(() => null);
      t(`Иконка ${icon.sizes}`, r?.ok);
    }
    const sw = await fetch(`${cfg.siteUrl}${cfg.basePath}sw.js`).catch(() => null);
    t('Работа без сети (service worker)', sw?.ok);
    const info = await ops({ action: 'info', slug });
    t(`В базе: услуг ${info.services}, боксов ${info.bays}, фото ${info.gallery}`, info.services > 0 && info.bays > 0);
    t(`Владелец привязан (${info.owners})`, info.owners > 0);
    const run = spawnSync('npx', ['playwright', 'test', 'tests/e2e/smoke.spec.ts', '--reporter=line'], {
      stdio: 'inherit', env: { ...process.env, BASE_URL: url, TENANT: slug },
    });
    t('Автотест: главная, услуги, свободное время, помощник', run.status === 0);
    if (failed) die(`Проверка не пройдена (${failed}). Студия остаётся образцом.`);
    if (!flags['keep-sample']) {
      await ops({ action: 'status', slug, status: 'live' });
      ok('Студия переведена из образца в рабочий режим (тестовые записи удалены)');
    }
    console.log(`\nГотовая ссылка для владельца: ${url}`);
    return;
  }

  if (cmd === 'list') {
    const r = await ops({ action: 'list' });
    for (const x of r.tenants) console.log(`${x.status.padEnd(7)} ${x.slug.padEnd(20)} ${x.name}  ${siteUrl(x.slug)}`);
    return;
  }
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n'));
}
main().catch((e) => die(e.stack || String(e)));
