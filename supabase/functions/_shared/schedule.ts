// Shared availability engine. Used by the web app AND by Supabase edge functions
// (imported there with a relative path), so it must stay dependency-light.
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс',
};
/** "HH:mm" pairs per weekday; empty array = closed */
export type Schedule = Partial<Record<DayKey, [string, string][]>>;

export interface StudioClock {
  timezone: string;
  schedule: Schedule;
  daysOff: string[]; // yyyy-MM-dd in studio timezone
  prepMinutes: number;
  stepMinutes: number;
  minLeadMinutes: number;
  horizonDays: number;
}

export interface Busy { bay_id: string; starts_at: string | Date; blocked_until: string | Date }
export interface Interval { start: Date; end: Date }

export interface Slot {
  start: Date;
  end: Date;
  blockedUntil: Date;
  label: string;
  free: boolean;
  freeBayIds: string[];
  reason?: 'busy' | 'past';
}

const ms = (d: string | Date) => (typeof d === 'string' ? new Date(d).getTime() : d.getTime());

/** weekday key of a yyyy-MM-dd calendar day (calendar math, timezone-independent) */
export function dayKeyOf(day: string): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return DAY_KEYS[(wd + 6) % 7];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function todayIn(tz: string, now = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

export function zoned(day: string, hhmm: string, tz: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, tz);
}

/** Working intervals of one calendar day, as absolute instants. */
export function workingIntervals(day: string, c: StudioClock): Interval[] {
  if (c.daysOff.includes(day)) return [];
  const ranges = c.schedule[dayKeyOf(day)] ?? [];
  return ranges
    .map(([a, b]) => ({ start: zoned(day, a, c.timezone), end: zoned(day, b === '24:00' ? '23:59' : b, c.timezone) }))
    .filter((i) => i.end > i.start)
    .sort((x, y) => x.start.getTime() - y.start.getTime());
}

/**
 * Walks forward through working hours, consuming `minutes` of working time.
 * A job that does not fit into one day continues on the next working day,
 * and the bay stays occupied overnight (the car is in the bay).
 */
export function addWorkingMinutes(start: Date, minutes: number, c: StudioClock): Date | null {
  let left = minutes;
  let day = formatInTimeZone(start, c.timezone, 'yyyy-MM-dd');
  for (let i = 0; i < 120; i++) {
    for (const iv of workingIntervals(day, c)) {
      const from = Math.max(iv.start.getTime(), start.getTime());
      if (from >= iv.end.getTime()) continue;
      const avail = (iv.end.getTime() - from) / 60000;
      if (avail >= left) return new Date(from + left * 60000);
      left -= avail;
    }
    day = addDays(day, 1);
  }
  return null;
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/** All candidate start times of one day with availability per bay. */
export function slotsForDay(
  day: string,
  durationMinutes: number,
  bayIds: string[],
  busy: Busy[],
  c: StudioClock,
  now = new Date(),
): Slot[] {
  const out: Slot[] = [];
  const earliest = now.getTime() + c.minLeadMinutes * 60000;
  for (const iv of workingIntervals(day, c)) {
    for (let t = iv.start.getTime(); t < iv.end.getTime(); t += c.stepMinutes * 60000) {
      const start = new Date(t);
      const end = addWorkingMinutes(start, durationMinutes, c);
      if (!end) continue;
      const blockedUntil = new Date(end.getTime() + c.prepMinutes * 60000);
      // a job shorter than a working day must finish within the same working interval
      if (durationMinutes <= (iv.end.getTime() - iv.start.getTime()) / 60000 && end.getTime() > iv.end.getTime()) continue;
      const freeBayIds = bayIds.filter(
        (bay) => !busy.some((b) => b.bay_id === bay && overlaps(t, blockedUntil.getTime(), ms(b.starts_at), ms(b.blocked_until))),
      );
      const past = t < earliest;
      out.push({
        start,
        end,
        blockedUntil,
        label: formatInTimeZone(start, c.timezone, 'HH:mm'),
        free: !past && freeBayIds.length > 0,
        freeBayIds: past ? [] : freeBayIds,
        reason: past ? 'past' : freeBayIds.length === 0 ? 'busy' : undefined,
      });
    }
  }
  return out;
}

/** Nearest free slots across the booking horizon. */
export function nearestSlots(
  durationMinutes: number,
  bayIds: string[],
  busy: Busy[],
  c: StudioClock,
  limit = 3,
  now = new Date(),
  fromDay?: string,
): Slot[] {
  const res: Slot[] = [];
  let day = fromDay ?? todayIn(c.timezone, now);
  const last = addDays(todayIn(c.timezone, now), c.horizonDays);
  while (day <= last && res.length < limit) {
    for (const s of slotsForDay(day, durationMinutes, bayIds, busy, c, now)) {
      if (s.free) res.push(s);
      if (res.length >= limit) break;
    }
    day = addDays(day, 1);
  }
  return res;
}

export function bookingDays(c: StudioClock, now = new Date()): string[] {
  const first = todayIn(c.timezone, now);
  return Array.from({ length: c.horizonDays + 1 }, (_, i) => addDays(first, i));
}

export function isOpenNow(c: StudioClock, now = new Date()): { open: boolean; until?: string; next?: string } {
  const today = todayIn(c.timezone, now);
  for (const iv of workingIntervals(today, c)) {
    if (now >= iv.start && now < iv.end) return { open: true, until: formatInTimeZone(iv.end, c.timezone, 'HH:mm') };
  }
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    const iv = workingIntervals(d, c).find((x) => x.start > now);
    if (iv) return { open: false, next: formatInTimeZone(iv.start, c.timezone, i === 0 ? "'сегодня в' HH:mm" : i === 1 ? "'завтра в' HH:mm" : 'dd.MM HH:mm') };
  }
  return { open: false };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

export function formatPrice(v: number, from = false, currency = 'RUB'): string {
  const n = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  return from ? `от ${n}` : n;
}
