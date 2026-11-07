// Integration test against the real Supabase project.
// node tests/integration/booking-api.mjs <slug>
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { slotsForDay, addDays, todayIn } from '../../src/shared/schedule.ts';

const cfg = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const slug = process.argv[2] || 'graphite';
const sb = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
const call = async (fn, body, token) => {
  const r = await fetch(`${cfg.supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${token ?? cfg.supabasePublishableKey}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const pass = (m) => console.log('  ✓', m);

const { data: t } = await sb.from('tenants').select('*').eq('slug', slug).single();
const { data: services } = await sb.from('services').select('*').eq('tenant_id', t.id).order('sort');
const { data: bays } = await sb.from('bays').select('*').eq('tenant_id', t.id);
const { data: off } = await sb.from('days_off').select('day').eq('tenant_id', t.id);
const clock = {
  timezone: t.timezone, schedule: t.schedule, daysOff: off.map((d) => d.day), prepMinutes: t.prep_minutes,
  stepMinutes: t.slot_step_minutes, minLeadMinutes: t.min_lead_minutes, horizonDays: t.booking_horizon_days,
};
const wash = services.find((s) => s.code === 'wash');
// pick a free slot ~10 days ahead
let day = addDays(todayIn(t.timezone), 10);
let busy = (await sb.rpc('get_busy', { p_tenant: t.id, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 40 * 864e5).toISOString() })).data;
let slot;
for (let i = 0; i < 10 && !slot; i++, day = addDays(day, 1)) {
  slot = slotsForDay(day, wash.duration_minutes, bays.map((b) => b.id), busy, clock).find((s) => s.free && s.freeBayIds.length === bays.length);
}
assert.ok(slot, 'found an empty slot');
console.log(`slot ${slot.start.toISOString()} (${slot.label}), bays: ${bays.length}`);

const base = { action: 'create', slug, serviceId: wash.id, start: slot.start.toISOString(), name: 'Тест Гонка', phone: '+7 900 111-22-33', car: 'Test Car' };

// 1. race: N parallel different clients for the same time -> exactly bays.length succeed
const N = bays.length + 2;
const results = await Promise.all(Array.from({ length: N }, (_, i) => call('booking', { ...base, idempotencyKey: `race-${Date.now()}-${i}` })));
console.log(results.map((r) => r.status + " " + JSON.stringify(r.body.error ?? r.body.booking?.bayId)));
const okCount = results.filter((r) => r.status === 201).length;
const taken = results.filter((r) => r.status === 409).length;
assert.equal(okCount, bays.length, `exactly ${bays.length} bookings succeed (got ${okCount})`);
assert.equal(taken, N - bays.length);
pass(`${N} одновременных запросов на одно время → успешно ${okCount} (по числу боксов), остальные получили «время занято»`);

// 2. idempotency: same key twice -> same booking
const slot2 = slotsForDay(addDays(day, 1), wash.duration_minutes, bays.map((b) => b.id), [], clock).find((s) => s.free);
const key = `dbl-${Date.now()}`;
const [a, b] = await Promise.all([
  call('booking', { ...base, start: slot2.start.toISOString(), idempotencyKey: key }),
  call('booking', { ...base, start: slot2.start.toISOString(), idempotencyKey: key }),
]);
assert.ok([200, 201].includes(a.status) && [200, 201].includes(b.status), JSON.stringify([a, b]));
assert.equal(a.body.booking.id, b.body.booking.id);
pass('двойное нажатие с одним ключом → одна запись');

// 3. busy slot is reported busy, and booking it fails
busy = (await sb.rpc('get_busy', { p_tenant: t.id, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 40 * 864e5).toISOString() })).data;
const again = slotsForDay(formatDay(slot.start), wash.duration_minutes, bays.map((x) => x.id), busy, clock).find((s) => s.start.getTime() === slot.start.getTime());
assert.equal(again.free, false);
const late = await call('booking', { ...base, idempotencyKey: `late-${Date.now()}` });
assert.equal(late.status, 409);
pass('занятое время отмечено занятым и повторно не бронируется');

// 4. anonymous users cannot read bookings
const anon = await sb.from('bookings').select('*').eq('tenant_id', t.id);
assert.equal(anon.data.length, 0);
pass('анонимный посетитель не видит чужие записи (RLS)');

// 5. manage token: get + cancel
const mine = results.find((r) => r.status === 201).body.booking;
const got = await call('booking', { action: 'get', token: mine.token });
assert.equal(got.body.booking.id, mine.id);
const cancelled = await call('booking', { action: 'cancel', token: mine.token });
assert.equal(cancelled.body.booking.status, 'cancelled');
pass('клиент видит свою запись по ссылке и может её отменить');

// cleanup test bookings
const owner = fs.readFileSync(`tenants/${slug}/.owner`, 'utf8').split('\n');
const s2 = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
const login = await s2.auth.signInWithPassword({ email: owner[0], password: owner[1] });
assert.ok(login.data.session, 'owner login');
const ownerRead = await s2.from('bookings').select('id').eq('tenant_id', t.id);
assert.ok(ownerRead.data.length >= bays.length);
pass(`владелец видит записи своей студии (${ownerRead.data.length})`);
const del = await s2.from('bookings').update({ status: 'cancelled' }).ilike('customer_name', 'Тест Гонка');
assert.ok(!del.error, del.error?.message);
console.log('done');

function formatDay(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: t.timezone }).format(d);
}
