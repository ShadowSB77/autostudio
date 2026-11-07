// Studio assistant. Facts always come from our own read-only functions below;
// the model only phrases the answer. If the model is unavailable, a rule-based
// responder answers from the same facts.
//
// Server settings (Supabase → Edge Functions → Secrets):
//   OPENAI_API_KEY, OPENAI_BASE_URL (optional, OpenAI-compatible), OPENAI_MODEL (default gpt-4o-mini)
//   AI_DAILY_TOKENS_PER_STUDIO (default 300000), AI_MAX_REPLY_TOKENS (default 450)
import OpenAI from 'npm:openai@4';
import { z } from 'npm:zod@4';
import { formatInTimeZone } from 'npm:date-fns-tz@3';
import { addDays, DAY_KEYS, DAY_LABELS, isOpenNow, nearestSlots, slotsForDay, todayIn, zoned, formatPrice, formatDuration } from '../_shared/schedule.ts';
import { admin, clientIp, cors, fail, isOwner, json, loadBusy, loadStudio, userFrom } from '../_shared/common.ts';

const bodySchema = z.object({
  slug: z.string().min(2).max(42),
  mode: z.enum(['client', 'owner']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(800) })).min(1).max(16),
});

type Studio = NonNullable<Awaited<ReturnType<typeof loadStudio>>>;
type DB = ReturnType<typeof admin>;

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const stems = (s: string) => norm(s).split(/[^a-zа-я0-9]+/).filter((w) => w.length > 2).map((w) => w.slice(0, Math.max(4, w.length - 2)));

function matchService(studio: Studio, text: string) {
  const words = stems(text);
  let best: { s: Studio['services'][number]; score: number } | null = null;
  for (const s of studio.services.filter((x) => x.active)) {
    const sw = stems(s.name + ' ' + s.description);
    const score = words.filter((w) => sw.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

function dayWord(day: string, tz: string) {
  const today = todayIn(tz);
  if (day === today) return 'сегодня';
  if (day === addDays(today, 1)) return 'завтра';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function scheduleText(studio: Studio) {
  return DAY_KEYS.map((k) => {
    const r = studio.clock.schedule[k] ?? [];
    return `${DAY_LABELS[k]}: ${r.length ? r.map(([a, b]) => `${a}–${b}`).join(', ') : 'выходной'}`;
  }).join('; ');
}

// ---------- read-only facts: client ----------
async function factsFindSlots(db: DB, studio: Studio, serviceName: string | undefined, date: string | undefined) {
  const service = serviceName ? matchService(studio, serviceName) : null;
  if (!service) {
    return { needService: true, services: studio.services.filter((s) => s.active).map((s) => s.name) };
  }
  const now = new Date();
  const busy = await loadBusy(db, studio.tenant.id, now, new Date(now.getTime() + (studio.clock.horizonDays + 40) * 864e5));
  const bayIds = studio.bays.map((b) => b.id);
  const tz = studio.clock.timezone;
  if (date) {
    const slots = slotsForDay(date, service.duration_minutes, bayIds, busy, studio.clock, now).filter((s) => s.free);
    return {
      service: service.name,
      date,
      dayWord: dayWord(date, tz),
      freeTimes: slots.map((s) => s.label),
      nearestAfter: slots.length ? [] : nearestSlots(service.duration_minutes, bayIds, busy, studio.clock, 3, now, date).map((s) => ({
        day: dayWord(formatInTimeZone(s.start, tz, 'yyyy-MM-dd'), tz), time: s.label,
      })),
    };
  }
  const n = nearestSlots(service.duration_minutes, bayIds, busy, studio.clock, 3, now);
  return {
    service: service.name,
    durationText: formatDuration(service.duration_minutes),
    nearest: n.map((s) => ({ day: dayWord(formatInTimeZone(s.start, tz, 'yyyy-MM-dd'), tz), time: s.label })),
  };
}

function factsStudio(studio: Studio) {
  const t = studio.tenant;
  const open = isOpenNow(studio.clock);
  return {
    name: t.name,
    address: t.address,
    mapUrl: t.map_url,
    phone: t.phone,
    hours: scheduleText(studio),
    openNow: open.open ? `открыто до ${open.until}` : open.next ? `закрыто, откроемся ${open.next}` : 'закрыто',
    cancelPolicy: t.cancel_policy || `Отмена онлайн не позднее чем за ${t.cancel_hours} ч.`,
    services: studio.services.filter((s) => s.active).map((s) => ({
      name: s.name, price: formatPrice(Number(s.price), s.price_from, t.currency), duration: formatDuration(s.duration_minutes), about: s.description,
    })),
  };
}

// ---------- read-only facts: owner ----------
function rangeOf(studio: Studio, period: string) {
  const tz = studio.clock.timezone;
  const today = todayIn(tz);
  const dow = DAY_KEYS.indexOf(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${today}T12:00:00Z`).getUTCDay()] as never);
  let from = today, to = addDays(today, 1), label = 'сегодня';
  if (period === 'yesterday') { from = addDays(today, -1); to = today; label = 'вчера'; }
  if (period === 'tomorrow') { from = addDays(today, 1); to = addDays(today, 2); label = 'завтра'; }
  if (period === 'this_week') { from = addDays(today, -dow); to = addDays(from, 7); label = 'эта неделя'; }
  if (period === 'last_7_days') { from = addDays(today, -6); to = addDays(today, 1); label = 'последние 7 дней'; }
  if (period === 'last_week') { from = addDays(today, -dow - 7); to = addDays(today, -dow); label = 'прошлая неделя'; }
  if (period === 'this_month') { from = today.slice(0, 8) + '01'; to = addDays(today, 1); label = 'этот месяц'; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) { from = period; to = addDays(period, 1); label = dayWord(period, tz); }
  return { from, to, label, fromTs: zoned(from, '00:00', tz), toTs: zoned(to, '00:00', tz) };
}

async function factsBookings(db: DB, studio: Studio, period: string) {
  const r = rangeOf(studio, period);
  const { data } = await db
    .from('bookings')
    .select('starts_at,ends_at,service_name,customer_name,car,status,price,bay_id')
    .eq('tenant_id', studio.tenant.id)
    .neq('status', 'cancelled')
    .lt('starts_at', r.toTs.toISOString())
    .gt('ends_at', r.fromTs.toISOString())
    .order('starts_at');
  const bay = Object.fromEntries(studio.bays.map((b) => [b.id, b.name]));
  const tz = studio.clock.timezone;
  return {
    period: r.label,
    count: data?.length ?? 0,
    bookings: (data ?? []).map((b) => ({
      start: formatInTimeZone(new Date(b.starts_at), tz, 'dd.MM HH:mm'),
      end: formatInTimeZone(new Date(b.ends_at), tz, 'dd.MM HH:mm'),
      service: b.service_name, client: b.customer_name, car: b.car, status: b.status, bay: bay[b.bay_id] ?? '', price: Number(b.price),
    })),
  };
}

async function factsStats(db: DB, studio: Studio, period: string) {
  const r = rangeOf(studio, period);
  const [bk, pay] = await Promise.all([
    db.from('bookings').select('status').eq('tenant_id', studio.tenant.id).neq('status', 'cancelled')
      .gte('starts_at', r.fromTs.toISOString()).lt('starts_at', r.toTs.toISOString()),
    db.from('payments').select('amount,kind').eq('tenant_id', studio.tenant.id)
      .gte('created_at', r.fromTs.toISOString()).lt('created_at', r.toTs.toISOString()),
  ]);
  const rows = bk.data ?? [];
  const pays = pay.data ?? [];
  const received = pays.filter((p) => p.kind === 'payment').reduce((a, p) => a + Number(p.amount), 0);
  const refunded = -pays.filter((p) => p.kind === 'refund').reduce((a, p) => a + Number(p.amount), 0);
  return {
    period: r.label,
    from: r.from,
    toExclusive: r.to,
    arrivals: rows.length,
    completed: rows.filter((b) => b.status === 'done').length,
    inWork: rows.filter((b) => b.status === 'arrived' || b.status === 'ready').length,
    received: formatPrice(received, false, studio.tenant.currency),
    refunded: formatPrice(refunded, false, studio.tenant.currency),
    net: formatPrice(received - refunded, false, studio.tenant.currency),
  };
}

// ---------- rule-based responder (also the fallback) ----------
async function rulesClient(db: DB, studio: Studio, text: string): Promise<string> {
  const q = norm(text);
  const info = factsStudio(studio);
  const svc = matchService(studio, text);
  if (/(окн|свобод|ближайш|когда|время|запис)/.test(q)) {
    if (!svc) {
      const quick = await factsFindSlots(db, studio, studio.services.filter((s) => s.active).sort((a, b) => a.duration_minutes - b.duration_minutes)[0]?.name, undefined);
      const hint = 'nearest' in quick && quick.nearest?.[0] ? ` Например, на «${quick.service}» ближайшее окно — ${quick.nearest[0].day} в ${quick.nearest[0].time}.` : '';
      return `Свободное время зависит от длительности работ. Для какой услуги посмотреть?${hint}\n\nУслуги: ${info.services.map((s) => s.name).join(', ')}.`;
    }
    const f = await factsFindSlots(db, studio, svc.name, undefined);
    if ('nearest' in f && f.nearest?.length) {
      return `Ближайшие окна на «${f.service}» (${f.durationText}):\n${f.nearest.map((n) => `• ${n.day} в ${n.time}`).join('\n')}\n\nЗаписаться можно прямо на этой странице.`;
    }
    return `На ближайшие ${studio.clock.horizonDays} дн. свободных окон на «${svc.name}» нет. Позвоните: ${info.phone}.`;
  }
  if (/(стои|цен|сколько|прайс|руб)/.test(q)) {
    if (svc) {
      const s = info.services.find((x) => x.name === svc.name)!;
      return `«${s.name}» — ${s.price}, по времени ${s.duration}. ${s.about}`.trim();
    }
    return `Цены:\n${info.services.map((s) => `• ${s.name} — ${s.price}`).join('\n')}\n\nКакая услуга интересует?`;
  }
  if (/(найти|адрес|где|добрат|проех|карт|располож)/.test(q)) {
    return `Мы находимся по адресу: ${info.address}.${info.mapUrl ? `\nМаршрут: ${info.mapUrl}` : ''}\nТелефон: ${info.phone}\nГрафик: ${info.hours}.`;
  }
  if (/(график|работает|открыт|часы)/.test(q)) return `Сейчас ${info.openNow}. График: ${info.hours}.`;
  if (/(отмен|перенес)/.test(q)) return `${info.cancelPolicy} Отменить запись можно в разделе «Моя запись».`;
  return 'Уточните, пожалуйста, что вас интересует: свободное время, цена услуги или как нас найти?';
}

async function rulesOwner(db: DB, studio: Studio, text: string): Promise<string> {
  const q = norm(text);
  const period = /вчера/.test(q) ? 'yesterday' : /завтра/.test(q) ? 'tomorrow' : /прошл\w* недел/.test(q) ? 'last_week'
    : /недел/.test(q) ? 'this_week' : /месяц/.test(q) ? 'this_month' : 'today';
  if (/(денег|деньг|выручк|получ|оплат|заработ|касс)/.test(q)) {
    const s = await factsStats(db, studio, period);
    return `За период «${s.period}» получено ${s.received}, возвратов ${s.refunded}. Итого: ${s.net}.`;
  }
  if (/(сколько|машин|заезд|статист|заверш)/.test(q) && period !== 'today' || /(сколько машин|сколько заезд)/.test(q)) {
    const s = await factsStats(db, studio, period);
    return `За период «${s.period}»: заездов ${s.arrivals}, завершено ${s.completed}, в работе ${s.inWork}.`;
  }
  const b = await factsBookings(db, studio, period);
  if (!b.count) return `На ${b.period} записей нет.`;
  return `Записи (${b.period}), всего ${b.count}:\n${b.bookings.map((x) => `• ${x.start} — ${x.service}, ${x.car}, ${x.client} (${x.bay})`).join('\n')}`;
}

// ---------- model ----------
const clientTools = [
  {
    type: 'function' as const,
    function: {
      name: 'find_free_time',
      description: 'Свободное время для записи на услугу. Без date — ближайшие окна.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Название услуги как сказал клиент' },
          date: { type: 'string', description: 'Дата yyyy-MM-dd в часовом поясе студии (необязательно)' },
        },
        required: ['service'],
      },
    },
  },
];
const ownerTools = [
  {
    type: 'function' as const,
    function: {
      name: 'list_bookings',
      description: 'Записи студии за период (только чтение).',
      parameters: { type: 'object', properties: { period: { type: 'string', description: 'today|tomorrow|yesterday|this_week|last_week|last_7_days|this_month|yyyy-MM-dd' } }, required: ['period'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stats',
      description: 'Количество заездов, завершённых работ и реально полученные деньги (оплаты минус возвраты) за период.',
      parameters: { type: 'object', properties: { period: { type: 'string', description: 'today|tomorrow|yesterday|this_week|last_week|last_7_days|this_month|yyyy-MM-dd' } }, required: ['period'] },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('invalid', 'Некорректный запрос', 422);
  const { slug, mode, messages } = parsed.data;
  const db = admin();
  const studio = await loadStudio(db, { slug });
  if (!studio) return fail('not_found', 'Студия не найдена', 404);

  if (mode === 'owner') {
    const uid = await userFrom(req);
    if (!(await isOwner(db, studio.tenant.id, uid))) return fail('forbidden', 'Войдите в кабинет владельца', 403);
  }

  // rate limit per visitor and per studio
  const who = mode === 'owner' ? 'owner' : clientIp(req);
  const limit = mode === 'owner' ? 60 : 15;
  const ok1 = await db.rpc('ai_hit', { p_key: `ai:${studio.tenant.id}:${who}`, p_limit: limit, p_window_seconds: 600 });
  const ok2 = await db.rpc('ai_hit', { p_key: `ai:${studio.tenant.id}:all`, p_limit: 300, p_window_seconds: 3600 });
  if (ok1.data === false || ok2.data === false) return fail('rate', 'Слишком много вопросов подряд. Попробуйте через несколько минут.', 429);

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')!.content;
  const rules = () => (mode === 'owner' ? rulesOwner(db, studio, lastUser) : rulesClient(db, studio, lastUser));

  const key = Deno.env.get('OPENAI_API_KEY');
  const dailyCap = Number(Deno.env.get('AI_DAILY_TOKENS_PER_STUDIO') ?? 300000);
  const { data: spend } = await db.from('ai_spend').select('tokens').eq('tenant_id', studio.tenant.id).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle();
  if (!key || (spend?.tokens ?? 0) >= dailyCap) return json({ reply: await rules(), source: 'rules' });

  const tz = studio.clock.timezone;
  const nowLocal = formatInTimeZone(new Date(), tz, "yyyy-MM-dd HH:mm, EEEE");
  const base = mode === 'client'
    ? `Ты — помощник детейлинг-студии / автосервиса «${studio.tenant.name}». Отвечай по-русски, коротко (до 5 строк), дружелюбно.
Используй ТОЛЬКО факты из блока ДАННЫЕ и из результатов функции find_free_time. Никогда не придумывай цены, услуги, адрес или свободное время.
Для вопросов о свободном времени ВСЕГДА вызывай find_free_time. Если не ясно, какая услуга нужна, задай один уточняющий вопрос.
Не обсуждай других клиентов и чужие записи — у тебя нет к ним доступа. Не обещай скидок. Записаться клиент может кнопкой «Записаться» на странице.
Сейчас в студии: ${nowLocal} (${tz}).
ДАННЫЕ: ${JSON.stringify(factsStudio(studio))}`
    : `Ты — помощник владельца студии «${studio.tenant.name}». Отвечай по-русски, коротко и точно, цифрами.
Данные получай ТОЛЬКО через функции list_bookings и get_stats; ничего не придумывай. Ты только читаешь данные: не предлагай, что сам что-то изменишь, и не меняй ничего.
«Получено денег» — это сумма оплат минус возвраты из get_stats. Если период не ясен, уточни.
Сейчас: ${nowLocal} (${tz}).`;

  try {
    const client = new OpenAI({ apiKey: key, baseURL: Deno.env.get('OPENAI_BASE_URL') || undefined, timeout: 25000, maxRetries: 1 });
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
    const maxTokens = Number(Deno.env.get('AI_MAX_REPLY_TOKENS') ?? 450);
    // deno-lint-ignore no-explicit-any
    const convo: any[] = [{ role: 'system', content: base }, ...messages.slice(-10)];
    let used = 0;
    for (let round = 0; round < 4; round++) {
      const res = await client.chat.completions.create({
        model,
        messages: convo,
        tools: mode === 'client' ? clientTools : ownerTools,
        tool_choice: 'auto',
        max_tokens: maxTokens,
        temperature: 0.2,
      });
      used += res.usage?.total_tokens ?? 0;
      const msg = res.choices[0]?.message;
      if (!msg) break;
      if (msg.tool_calls?.length) {
        convo.push(msg);
        for (const call of msg.tool_calls) {
          let out: unknown;
          try {
            const args = JSON.parse(call.function.arguments || '{}');
            if (call.function.name === 'find_free_time' && mode === 'client') out = await factsFindSlots(db, studio, args.service, args.date);
            else if (call.function.name === 'list_bookings' && mode === 'owner') out = await factsBookings(db, studio, String(args.period ?? 'today'));
            else if (call.function.name === 'get_stats' && mode === 'owner') out = await factsStats(db, studio, String(args.period ?? 'today'));
            else out = { error: 'unknown function' };
          } catch (e) {
            out = { error: String(e) };
          }
          convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
        }
        continue;
      }
      await db.rpc('ai_add_spend', { p_tenant: studio.tenant.id, p_tokens: used });
      const text = (msg.content ?? '').trim();
      if (text) return json({ reply: text, source: 'ai' });
      break;
    }
    await db.rpc('ai_add_spend', { p_tenant: studio.tenant.id, p_tokens: used });
  } catch (e) {
    console.error('model error', e instanceof Error ? e.message : e);
  }
  return json({ reply: await rules(), source: 'rules' });
});
