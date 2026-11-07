import { describe, expect, it } from 'vitest';
import { addWorkingMinutes, nearestSlots, slotsForDay, workingIntervals, type StudioClock } from '../../src/shared/schedule';
import { tenantConfigSchema, bookingFormSchema } from '../../src/shared/tenantConfig';
import fs from 'node:fs';

const clock: StudioClock = {
  timezone: 'Asia/Yekaterinburg',
  schedule: {
    mon: [['09:00', '21:00']], tue: [['09:00', '21:00']], wed: [['09:00', '21:00']],
    thu: [['09:00', '21:00']], fri: [['09:00', '21:00']], sat: [['10:00', '18:00']], sun: [],
  },
  daysOff: ['2026-11-11'],
  prepMinutes: 30,
  stepMinutes: 30,
  minLeadMinutes: 0,
  horizonDays: 14,
};
const past = new Date('2026-01-01T00:00:00Z');

describe('working hours', () => {
  it('converts studio local time to UTC (Yekaterinburg = UTC+5)', () => {
    const [iv] = workingIntervals('2026-11-09', clock); // Monday
    expect(iv.start.toISOString()).toBe('2026-11-09T04:00:00.000Z');
    expect(iv.end.toISOString()).toBe('2026-11-09T16:00:00.000Z');
  });
  it('closed on sunday and on days off', () => {
    expect(workingIntervals('2026-11-08', clock)).toEqual([]);
    expect(workingIntervals('2026-11-11', clock)).toEqual([]);
  });
});

describe('multi-day jobs', () => {
  it('a 16h job started Monday 09:00 ends Tuesday 13:00 (12h + 4h)', () => {
    const end = addWorkingMinutes(new Date('2026-11-09T04:00:00Z'), 16 * 60, clock)!;
    expect(end.toISOString()).toBe('2026-11-10T08:00:00.000Z');
  });
  it('skips day off while walking', () => {
    // Tue 2026-11-10 09:00 + 16h -> Tue 21:00 (12h), Wed off, Thu 09:00 + 4h = 13:00
    const end = addWorkingMinutes(new Date('2026-11-10T04:00:00Z'), 16 * 60, clock)!;
    expect(end.toISOString()).toBe('2026-11-12T08:00:00.000Z');
  });
  it('a bay booked for two days is busy on both days', () => {
    const busy = [{ bay_id: 'A', starts_at: '2026-11-09T04:00:00Z', blocked_until: '2026-11-10T08:30:00Z' }];
    const mon = slotsForDay('2026-11-09', 60, ['A'], busy, clock, past);
    const tue = slotsForDay('2026-11-10', 60, ['A'], busy, clock, past);
    expect(mon.every((s) => !s.free)).toBe(true);
    expect(tue.find((s) => s.label === '12:00')!.free).toBe(false);
    expect(tue.find((s) => s.label === '13:30')!.free).toBe(true); // 13:00 + 30 min prep
  });
});

describe('slots', () => {
  it('short jobs must finish inside working hours', () => {
    const s = slotsForDay('2026-11-09', 120, ['A'], [], clock, past);
    expect(s.at(-1)!.label).toBe('19:00');
  });
  it('slot is free while at least one bay is free, and prep time blocks', () => {
    const busy = [{ bay_id: 'A', starts_at: '2026-11-09T05:00:00Z', blocked_until: '2026-11-09T07:30:00Z' }];
    const one = slotsForDay('2026-11-09', 60, ['A'], busy, clock, past);
    expect(one.find((s) => s.label === '12:00')!.free).toBe(false); // 12:00 local = 07:00Z inside prep
    expect(one.find((s) => s.label === '12:30')!.free).toBe(true);
    const two = slotsForDay('2026-11-09', 60, ['A', 'B'], busy, clock, past);
    expect(two.find((s) => s.label === '11:00')!.freeBayIds).toEqual(['B']);
  });
  it('past slots are not bookable', () => {
    const now = new Date('2026-11-09T10:00:00Z'); // 15:00 local
    const s = slotsForDay('2026-11-09', 60, ['A'], [], clock, now);
    expect(s.find((x) => x.label === '14:30')!.free).toBe(false);
    expect(s.find((x) => x.label === '15:00')!.free).toBe(true);
  });
  it('nearest slots skip closed days', () => {
    const now = new Date('2026-11-07T14:00:00Z'); // Sat 19:00 local, closed after 18
    const n = nearestSlots(60, ['A'], [], clock, 2, now);
    expect(n[0].start.toISOString()).toBe('2026-11-09T04:00:00.000Z');
  });
});

describe('tenant configs', () => {
  for (const slug of fs.readdirSync('tenants').filter((d) => !d.startsWith('_') && fs.statSync(`tenants/${d}`).isDirectory())) {
    it(`tenants/${slug}/tenant.json is valid`, () => {
      const raw = JSON.parse(fs.readFileSync(`tenants/${slug}/tenant.json`, 'utf8'));
      const r = tenantConfigSchema.safeParse(raw);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      expect(raw.slug).toBe(slug);
    });
  }
});

describe('booking form', () => {
  it('validates phone and name', () => {
    expect(bookingFormSchema.safeParse({ name: 'И', phone: '123', car: 'BMW X5' }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ name: 'Иван', phone: '+7 912 000-00-00', car: 'BMW X5' }).success).toBe(true);
  });
});
