// Operator API used by `pnpm tenant:*` commands. Protected by an admin token whose
// SHA-256 lives in public.app_secrets (never in the site code).
const decodeBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
import { admin, cors, fail, json, sha256 } from '../_shared/common.ts';
import { tenantConfigSchema } from '../_shared/tenantConfig.ts';

const mime = (f: string) => (f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = admin();
  const token = req.headers.get('x-admin-token') ?? '';
  const { data: secret } = await db.from('app_secrets').select('value').eq('name', 'admin_token_sha256').maybeSingle();
  if (!token || !secret || (await sha256(token)) !== secret.value) return fail('forbidden', 'bad admin token', 403);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'publish') {
    const p = tenantConfigSchema.safeParse(body.config);
    if (!p.success) return json({ error: { code: 'invalid', issues: p.error.issues } }, 422);
    const c = p.data;
    const existing = await db.from('tenants').select('id,status').eq('slug', c.slug).maybeSingle();
    if (existing.data && !body.force) return json({ ok: true, skipped: 'exists', id: existing.data.id, status: existing.data.status });

    const row = {
      slug: c.slug, name: c.name, kind: c.kind, tagline: c.tagline, accent: c.accent, address: c.address, map_url: c.mapUrl,
      phone: c.phone, timezone: c.timezone, currency: c.currency, features: c.features, schedule: c.schedule,
      prep_minutes: c.prepMinutes, slot_step_minutes: c.slotStepMinutes, booking_horizon_days: c.bookingHorizonDays,
      min_lead_minutes: c.minLeadMinutes, cancel_hours: c.cancelHours, cancel_policy: c.cancelPolicy,
    };
    const up = await db.from('tenants').upsert(row, { onConflict: 'slug' }).select('id').single();
    if (up.error) return fail('db', up.error.message, 500);
    const id = up.data.id as string;

    // media
    const media: Record<string, string> = body.media ?? {};
    const urls: Record<string, string> = {};
    for (const [file, b64] of Object.entries(media)) {
      const path = `${id}/seed/${file}`;
      const r = await db.storage.from('media').upload(path, decodeBase64(b64), { contentType: mime(file), upsert: true, cacheControl: '3600' });
      if (r.error) return fail('storage', `${file}: ${r.error.message}`, 500);
      urls[file] = db.storage.from('media').getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
    }
    await db.from('tenants').update({ logo_url: urls[c.logo] ?? null, hero_url: urls[c.hero] ?? null }).eq('id', id);

    for (const [i, s] of c.services.entries()) {
      await db.from('services').upsert(
        { tenant_id: id, code: s.code, name: s.name, description: s.description, price: s.price, price_from: s.priceFrom, duration_minutes: s.durationMinutes, sort: i, active: true },
        { onConflict: 'tenant_id,code' },
      );
    }
    for (const [i, b] of c.bays.entries()) {
      await db.from('bays').upsert({ tenant_id: id, code: b.code, name: b.name, sort: i, active: true }, { onConflict: 'tenant_id,code' });
    }
    await db.from('days_off').delete().eq('tenant_id', id);
    if (c.daysOff.length) await db.from('days_off').insert(c.daysOff.map((d) => ({ tenant_id: id, day: d })));
    await db.from('gallery').delete().eq('tenant_id', id);
    if (c.gallery.length) {
      await db.from('gallery').insert(c.gallery.map((g, i) => ({ tenant_id: id, image_url: urls[g.file] ?? '', caption: g.caption, sort: i })));
    }
    return json({ ok: true, id, created: !existing.data });
  }

  if (body.action === 'status') {
    if (!['sample', 'live', 'disabled'].includes(body.status)) return fail('invalid', 'status');
    const r = await db.from('tenants').update({ status: body.status }).eq('slug', body.slug).select('id,status').single();
    if (r.error) return fail('db', r.error.message, 500);
    if (body.status === 'live') await db.from('bookings').delete().eq('tenant_id', r.data.id).eq('is_demo', true);
    return json({ ok: true, ...r.data });
  }

  if (body.action === 'owner') {
    const { slug, email, password } = body;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '') || (password ?? '').length < 8) return fail('invalid', 'email / password ≥ 8');
    const t = await db.from('tenants').select('id').eq('slug', slug).single();
    if (t.error) return fail('not_found', 'tenant', 404);
    let userId: string | undefined;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.data.user) userId = created.data.user.id;
    else {
      const list = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = list.data.users.find((x) => x.email?.toLowerCase() === String(email).toLowerCase());
      if (!u) return fail('auth', created.error?.message ?? 'cannot create user', 500);
      userId = u.id;
      if (body.resetPassword) await db.auth.admin.updateUserById(u.id, { password });
    }
    await db.from('tenant_owners').upsert({ tenant_id: t.data.id, user_id: userId });
    return json({ ok: true, userId });
  }

  if (body.action === 'info') {
    const t = await db.from('tenants').select('id,slug,status,name,updated_at').eq('slug', body.slug).maybeSingle();
    if (!t.data) return fail('not_found', 'tenant', 404);
    const [s, b, g, o] = await Promise.all([
      db.from('services').select('id', { count: 'exact', head: true }).eq('tenant_id', t.data.id),
      db.from('bays').select('id', { count: 'exact', head: true }).eq('tenant_id', t.data.id),
      db.from('gallery').select('id', { count: 'exact', head: true }).eq('tenant_id', t.data.id),
      db.from('tenant_owners').select('user_id', { count: 'exact', head: true }).eq('tenant_id', t.data.id),
    ]);
    return json({ ...t.data, services: s.count, bays: b.count, gallery: g.count, owners: o.count });
  }

  if (body.action === 'list') {
    const t = await db.from('tenants').select('slug,status,name').order('slug');
    return json({ tenants: t.data });
  }

  return fail('unknown', 'unknown action');
});
