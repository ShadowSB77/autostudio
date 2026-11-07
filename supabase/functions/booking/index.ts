// Booking API. Creation is a single INSERT guarded by:
//  - an exclusion constraint (no two active bookings overlap in one bay)  -> race-safe
//  - a unique (tenant_id, idempotency_key)                                -> double-click safe
import { z } from 'npm:zod@4';
import { addDays, addWorkingMinutes, slotsForDay, todayIn } from '../_shared/schedule.ts';
import { formatInTimeZone } from 'npm:date-fns-tz@3';
import { admin, clientIp, cors, fail, isOwner, json, loadBusy, loadStudio, userFrom } from '../_shared/common.ts';

const phoneRe = /^\+?[0-9][0-9 ()-]{8,18}$/;
const createSchema = z.object({
  action: z.literal('create'),
  slug: z.string(),
  serviceId: z.string().uuid(),
  start: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2).max(60),
  phone: z.string().trim().regex(phoneRe),
  car: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(300).optional().default(''),
  idempotencyKey: z.string().min(8).max(80),
  bayId: z.string().uuid().optional(), // owner only
  asOwner: z.boolean().optional(),
});
const tokenSchema = z.object({ action: z.enum(['get', 'cancel']), token: z.string().regex(/^[a-f0-9]{36}$/) });
const moveSchema = z.object({
  action: z.literal('move'),
  bookingId: z.string().uuid(),
  start: z.string().datetime({ offset: true }),
  bayId: z.string().uuid().optional(),
});
const pushSchema = z.object({
  action: z.literal('push'),
  token: z.string().regex(/^[a-f0-9]{36}$/),
  subscription: z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
});

const publicBooking = (b: Record<string, unknown>) => ({
  id: b.id,
  serviceName: b.service_name,
  startsAt: b.starts_at,
  endsAt: b.ends_at,
  status: b.status,
  price: b.price,
  customerName: b.customer_name,
  customerPhone: b.customer_phone,
  car: b.car,
  notes: b.notes,
  isDemo: b.is_demo,
  token: b.manage_token,
  bayId: b.bay_id,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const db = admin();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('bad_json', 'Некорректный запрос');
  }

  // simple abuse guard for anonymous calls
  const okRate = await db.rpc('ai_hit', { p_key: `book:${clientIp(req)}`, p_limit: 60, p_window_seconds: 600 });
  if (okRate.data === false) return fail('rate', 'Слишком много запросов, попробуйте через несколько минут', 429);

  if (body.action === 'create') {
    const p = createSchema.safeParse(body);
    if (!p.success) return fail('invalid', 'Проверьте имя, телефон и автомобиль', 422);
    const input = p.data;
    const studio = await loadStudio(db, { slug: input.slug });
    if (!studio) return fail('not_found', 'Студия не найдена', 404);
    const { tenant, clock } = studio;
    const uid = await userFrom(req);
    const owner = input.asOwner ? await isOwner(db, tenant.id, uid) : false;
    if (input.asOwner && !owner) return fail('forbidden', 'Нет доступа', 403);

    // idempotency: same key -> same booking, no duplicate
    const existing = await db.from('bookings').select('*').eq('tenant_id', tenant.id).eq('idempotency_key', input.idempotencyKey).maybeSingle();
    if (existing.data) return json({ booking: publicBooking(existing.data), repeated: true });

    const service = studio.services.find((s) => s.id === input.serviceId && (s.active || owner));
    if (!service) return fail('service', 'Услуга недоступна', 422);
    const start = new Date(input.start);
    const day = formatInTimeZone(start, clock.timezone, 'yyyy-MM-dd');
    const horizonEnd = addDays(todayIn(clock.timezone), clock.horizonDays);
    if (!owner && day > horizonEnd) return fail('horizon', 'Запись на эту дату пока закрыта', 422);

    const busy = await loadBusy(db, tenant.id, new Date(start.getTime() - 40 * 864e5), new Date(start.getTime() + 40 * 864e5));
    const bayIds = studio.bays.map((b) => b.id);
    let candidates: string[];
    let end: Date | null;
    if (owner) {
      end = addWorkingMinutes(start, service.duration_minutes, clock);
      candidates = input.bayId ? [input.bayId] : bayIds;
    } else {
      const slot = slotsForDay(day, service.duration_minutes, bayIds, busy, { ...clock }, new Date()).find(
        (s) => s.start.getTime() === start.getTime(),
      );
      if (!slot) return fail('slot_invalid', 'Это время недоступно для записи', 409);
      if (!slot.free) return fail('slot_taken', 'Это время только что заняли. Выберите другое.', 409);
      end = slot.end;
      candidates = slot.freeBayIds;
    }
    if (!end) return fail('slot_invalid', 'Не удалось рассчитать окончание работ', 422);
    const blockedUntil = new Date(end.getTime() + clock.prepMinutes * 60000);

    for (const bayId of candidates) {
      const ins = await db
        .from('bookings')
        .insert({
          tenant_id: tenant.id,
          service_id: service.id,
          service_name: service.name,
          bay_id: bayId,
          customer_name: input.name,
          customer_phone: input.phone,
          car: input.car,
          notes: input.notes,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          blocked_until: blockedUntil.toISOString(),
          price: service.price,
          source: owner ? 'owner' : 'client',
          is_demo: tenant.status === 'sample',
          idempotency_key: input.idempotencyKey,
        })
        .select('*')
        .single();
      if (!ins.error) return json({ booking: publicBooking(ins.data) }, 201);
      if (ins.error.code === '23505') {
        const again = await db.from('bookings').select('*').eq('tenant_id', tenant.id).eq('idempotency_key', input.idempotencyKey).single();
        return json({ booking: publicBooking(again.data!), repeated: true });
      }
      if (ins.error.code !== '23P01') return fail('db', 'Не удалось сохранить запись', 500);
      // 23P01 = exclusion violation: this bay was taken a moment ago, try the next bay
    }
    return fail('slot_taken', 'Это время только что заняли. Выберите другое.', 409);
  }

  if (body.action === 'get' || body.action === 'cancel') {
    const p = tokenSchema.safeParse(body);
    if (!p.success) return fail('invalid', 'Запись не найдена', 404);
    const { data: b } = await db.from('bookings').select('*').eq('manage_token', p.data.token).maybeSingle();
    if (!b) return fail('not_found', 'Запись не найдена', 404);
    const { data: t } = await db.from('tenants').select('cancel_hours,cancel_policy,slug').eq('id', b.tenant_id).single();
    const deadline = new Date(new Date(b.starts_at).getTime() - (t!.cancel_hours ?? 0) * 3600e3);
    const canCancel = b.status === 'booked' && new Date() < deadline;
    if (p.data.action === 'get') return json({ booking: publicBooking(b), canCancel, cancelDeadline: deadline.toISOString(), slug: t!.slug });
    if (!canCancel) {
      if (b.status === 'cancelled') return fail('cancel_closed', 'Запись уже отменена.', 409);
      if (b.status !== 'booked') return fail('cancel_closed', 'Машина уже принята в работу — отменить онлайн нельзя. Позвоните в студию.', 409);
      return fail('cancel_closed', `Отменить онлайн можно не позднее чем за ${t!.cancel_hours} ч. Позвоните в студию.`, 409);
    }
    const upd = await db.from('bookings').update({ status: 'cancelled' }).eq('id', b.id).select('*').single();
    return json({ booking: publicBooking(upd.data!), canCancel: false });
  }

  if (body.action === 'move') {
    const p = moveSchema.safeParse(body);
    if (!p.success) return fail('invalid', 'Некорректные данные', 422);
    const { data: b } = await db.from('bookings').select('*').eq('id', p.data.bookingId).maybeSingle();
    if (!b) return fail('not_found', 'Запись не найдена', 404);
    if (!(await isOwner(db, b.tenant_id, await userFrom(req)))) return fail('forbidden', 'Нет доступа', 403);
    const studio = (await loadStudio(db, { id: b.tenant_id }))!;
    const service = studio.services.find((s) => s.id === b.service_id);
    const minutes = service?.duration_minutes ?? (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000;
    const start = new Date(p.data.start);
    const end = addWorkingMinutes(start, minutes, studio.clock);
    if (!end) return fail('slot_invalid', 'Не удалось рассчитать окончание', 422);
    const blockedUntil = new Date(end.getTime() + studio.clock.prepMinutes * 60000);
    const bays = p.data.bayId ? [p.data.bayId] : [b.bay_id, ...studio.bays.map((x) => x.id).filter((x) => x !== b.bay_id)];
    for (const bayId of bays) {
      const upd = await db
        .from('bookings')
        .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), blocked_until: blockedUntil.toISOString(), bay_id: bayId })
        .eq('id', b.id)
        .select('*')
        .single();
      if (!upd.error) return json({ booking: publicBooking(upd.data) });
      if (upd.error.code !== '23P01') return fail('db', 'Не удалось перенести', 500);
    }
    return fail('slot_taken', 'Это время занято во всех боксах', 409);
  }

  if (body.action === 'push') {
    const p = pushSchema.safeParse(body);
    if (!p.success) return fail('invalid', 'Некорректная подписка', 422);
    const { data: b } = await db.from('bookings').select('id,starts_at,status').eq('manage_token', p.data.token).maybeSingle();
    if (!b || b.status === 'cancelled') return fail('not_found', 'Запись не найдена', 404);
    const remindAt = new Date(new Date(b.starts_at).getTime() - 24 * 3600e3);
    const r = await db.from('push_subscriptions').upsert(
      { booking_id: b.id, endpoint: p.data.subscription.endpoint, keys: p.data.subscription.keys, remind_at: remindAt.toISOString(), sent_at: null },
      { onConflict: 'booking_id,endpoint' },
    );
    if (r.error) return fail('db', 'Не удалось включить напоминание', 500);
    return json({ ok: true, remindAt: remindAt.toISOString() });
  }

  return fail('unknown', 'Неизвестное действие');
});
