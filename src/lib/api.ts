import { createClient, type Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import cfg from '../../app.config.json';
import type { Busy, Schedule, StudioClock } from '../shared/schedule';

export const supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
  auth: { persistSession: true, storageKey: 'autostudio-auth' },
});
export const appConfig = cfg;

export type FeatureIcon = 'shield' | 'clock' | 'sparkle' | 'drop' | 'car' | 'wrench' | 'star' | 'medal' | 'gauge' | 'thermometer';
export interface Feature { icon: FeatureIcon; value: string; label: string }
export interface Tenant {
  id: string; slug: string; status: 'sample' | 'live' | 'disabled'; name: string; kind: string; tagline: string; accent: string;
  address: string; map_url: string; phone: string; timezone: string; currency: string; logo_url: string | null; hero_url: string | null;
  features: Feature[]; schedule: Schedule; prep_minutes: number; slot_step_minutes: number; booking_horizon_days: number;
  min_lead_minutes: number; cancel_hours: number; cancel_policy: string;
}
export interface Service { id: string; tenant_id: string; code: string | null; name: string; description: string; price: number; price_from: boolean; duration_minutes: number; active: boolean; sort: number }
export interface Bay { id: string; tenant_id: string; code: string | null; name: string; active: boolean; sort: number }
export interface GalleryItem { id: string; tenant_id: string; image_url: string; caption: string; sort: number }
export interface Studio { tenant: Tenant; services: Service[]; bays: Bay[]; gallery: GalleryItem[]; daysOff: string[]; clock: StudioClock }

export interface BookingView {
  id: string; serviceName: string; startsAt: string; endsAt: string; status: 'booked' | 'arrived' | 'ready' | 'done' | 'cancelled';
  price: number; customerName: string; customerPhone: string; car: string; notes: string; isDemo: boolean; token: string; bayId: string;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export const clockOf = (t: Tenant, daysOff: string[]): StudioClock => ({
  timezone: t.timezone,
  schedule: t.schedule,
  daysOff,
  prepMinutes: t.prep_minutes,
  stepMinutes: t.slot_step_minutes,
  minLeadMinutes: t.min_lead_minutes,
  horizonDays: t.booking_horizon_days,
});

export async function fetchStudio(slug: string): Promise<Studio | null> {
  const { data: tenant, error } = await supabase.from('tenants').select('*').eq('slug', slug).maybeSingle<Tenant>();
  if (error) throw error;
  if (!tenant) return null;
  const [services, bays, gallery, off] = await Promise.all([
    supabase.from('services').select('*').eq('tenant_id', tenant.id).order('sort'),
    supabase.from('bays').select('*').eq('tenant_id', tenant.id).order('sort'),
    supabase.from('gallery').select('*').eq('tenant_id', tenant.id).order('sort'),
    supabase.from('days_off').select('day').eq('tenant_id', tenant.id),
  ]);
  const daysOff = (off.data ?? []).map((d) => d.day as string);
  return {
    tenant,
    services: (services.data ?? []) as Service[],
    bays: (bays.data ?? []) as Bay[],
    gallery: (gallery.data ?? []) as GalleryItem[],
    daysOff,
    clock: clockOf(tenant, daysOff),
  };
}

export function useStudio(slug: string | undefined) {
  return useQuery({ queryKey: ['studio', slug], queryFn: () => fetchStudio(slug!), enabled: !!slug, staleTime: 60_000 });
}

export function useBusy(tenantId: string | undefined, horizonDays: number) {
  return useQuery({
    queryKey: ['busy', tenantId],
    enabled: !!tenantId,
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async () => {
      const from = new Date(Date.now() - 30 * 864e5);
      const to = new Date(Date.now() + (horizonDays + 30) * 864e5);
      const { data, error } = await supabase.rpc('get_busy', { p_tenant: tenantId, p_from: from.toISOString(), p_to: to.toISOString() });
      if (error) throw error;
      return (data ?? []) as Busy[];
    },
  });
}

async function invoke<T>(fn: string, body: unknown, session?: Session | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: cfg.supabasePublishableKey,
        Authorization: `Bearer ${session?.access_token ?? cfg.supabasePublishableKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'error', data?.error?.message ?? 'Что-то пошло не так', res.status);
  return data as T;
}

export const api = {
  createBooking: (b: Record<string, unknown>, session?: Session | null) =>
    invoke<{ booking: BookingView; repeated?: boolean }>('booking', { action: 'create', ...b }, session),
  getBooking: (token: string) =>
    invoke<{ booking: BookingView; canCancel: boolean; cancelDeadline: string; slug: string }>('booking', { action: 'get', token }),
  cancelBooking: (token: string) => invoke<{ booking: BookingView }>('booking', { action: 'cancel', token }),
  moveBooking: (bookingId: string, start: string, session: Session | null, bayId?: string) =>
    invoke<{ booking: BookingView }>('booking', { action: 'move', bookingId, start, bayId }, session),
  subscribePush: (token: string, subscription: PushSubscriptionJSON) =>
    invoke<{ ok: boolean; remindAt: string }>('booking', { action: 'push', token, subscription }),
  ask: (slug: string, mode: 'client' | 'owner', messages: { role: 'user' | 'assistant'; content: string }[], session?: Session | null) =>
    invoke<{ reply: string; source: 'ai' | 'rules' }>('assistant', { slug, mode, messages }, session),
};

// "My bookings" are remembered on this device only (no registration needed)
const key = (slug: string) => `autostudio:bookings:${slug}`;
export const myBookings = {
  list(slug: string): string[] {
    try { return JSON.parse(localStorage.getItem(key(slug)) ?? '[]'); } catch { return []; }
  },
  add(slug: string, token: string) {
    try {
      const l = myBookings.list(slug).filter((t) => t !== token);
      localStorage.setItem(key(slug), JSON.stringify([token, ...l].slice(0, 20)));
    } catch { /* storage unavailable */ }
  },
  remove(slug: string, token: string) {
    try { localStorage.setItem(key(slug), JSON.stringify(myBookings.list(slug).filter((t) => t !== token))); } catch { /* ignore */ }
  },
};
