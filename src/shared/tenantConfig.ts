// Single source of truth for a studio's config file: tenants/<slug>/tenant.json
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'время в формате ЧЧ:ММ');
const range = z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, 'начало раньше конца');
const day = z.array(range).max(3);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'цвет в формате #RRGGBB');

export const featureSchema = z.object({
  icon: z.enum(['shield', 'clock', 'sparkle', 'drop', 'car', 'wrench', 'star', 'medal', 'gauge', 'thermometer']).default('star'),
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(60),
});

export const serviceSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(80),
  description: z.string().max(400).default(''),
  price: z.number().nonnegative(),
  priceFrom: z.boolean().default(false),
  durationMinutes: z.number().int().min(10).max(10080),
});

export const tenantConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'латиница, цифры и дефис'),
  name: z.string().min(2).max(60),
  shortName: z.string().min(1).max(12).optional(),
  kind: z.enum(['detailing', 'service']).default('detailing'),
  tagline: z.string().max(160).default(''),
  accent: hex.default('#D4AF37'),
  address: z.string().min(3).max(200),
  mapUrl: z.string().url().or(z.literal('')).default(''),
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/, 'телефон'),
  timezone: z.string().min(3),
  currency: z.string().length(3).default('RUB'),
  logo: z.string().default('logo.png'),
  hero: z.string().default('hero.jpg'),
  features: z.array(featureSchema).length(3, 'нужно ровно 3 карточки'),
  schedule: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
  daysOff: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  prepMinutes: z.number().int().min(0).max(600).default(30),
  slotStepMinutes: z.number().int().min(10).max(240).default(30),
  bookingHorizonDays: z.number().int().min(1).max(120).default(21),
  minLeadMinutes: z.number().int().min(0).max(2880).default(60),
  cancelHours: z.number().int().min(0).max(168).default(12),
  cancelPolicy: z.string().max(300).default(''),
  bays: z.array(z.object({ code: z.string().regex(/^[a-z0-9-]{1,40}$/), name: z.string().min(1).max(40) })).min(1),
  services: z.array(serviceSchema).min(1),
  gallery: z.array(z.object({ file: z.string().min(1), caption: z.string().max(120).default('') })).default([]),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;

// What people type in forms
export const phoneRe = /^\+?[0-9][0-9 ()-]{8,18}$/;
export const bookingFormSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(60),
  phone: z
    .string()
    .trim()
    .regex(phoneRe, 'Телефон в формате +7 900 000-00-00'),
  car: z.string().trim().min(2, 'Укажите марку и модель').max(80),
  notes: z.string().trim().max(300).optional().default(''),
});
export type BookingForm = z.infer<typeof bookingFormSchema>;
