// Sends "your booking is tomorrow" web-push notifications. Called every 10 minutes by pg_cron.
import webpush from 'npm:web-push@3.6.7';
import { formatInTimeZone } from 'npm:date-fns-tz@3';
import { admin, cors, fail, json } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = admin();
  const { data: secrets } = await db.from('app_secrets').select('name,value').in('name', ['cron_secret', 'vapid_public', 'vapid_private']);
  const s = Object.fromEntries((secrets ?? []).map((x) => [x.name, x.value]));
  if (!s.cron_secret || req.headers.get('x-cron-secret') !== s.cron_secret) return fail('forbidden', 'nope', 403);
  webpush.setVapidDetails('mailto:noreply@autostudio.app', s.vapid_public, s.vapid_private);

  const { data: due } = await db
    .from('push_subscriptions')
    .select('id,endpoint,keys,booking:bookings(id,starts_at,status,service_name,tenant:tenants(name,timezone,slug,address))')
    .is('sent_at', null)
    .lte('remind_at', new Date().toISOString())
    .limit(200);
  let sent = 0;
  for (const sub of due ?? []) {
    // deno-lint-ignore no-explicit-any
    const b: any = sub.booking;
    if (!b || b.status === 'cancelled' || new Date(b.starts_at) < new Date()) {
      await db.from('push_subscriptions').update({ sent_at: new Date().toISOString() }).eq('id', sub.id);
      continue;
    }
    const when = formatInTimeZone(new Date(b.starts_at), b.tenant.timezone, 'dd.MM в HH:mm');
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        JSON.stringify({ title: `${b.tenant.name}: запись завтра`, body: `${b.service_name}, ${when}. ${b.tenant.address}`, url: `s/${b.tenant.slug}/my` }),
        { TTL: 6 * 3600 },
      );
      sent++;
    } catch (e) {
      console.error('push failed', e instanceof Error ? e.message : e);
    }
    await db.from('push_subscriptions').update({ sent_at: new Date().toISOString() }).eq('id', sub.id);
  }
  return json({ ok: true, sent, checked: due?.length ?? 0 });
});
