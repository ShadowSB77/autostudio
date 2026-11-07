import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Busy, StudioClock, Schedule } from './schedule.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
export const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status);

function serviceKey(): string {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (k) return k;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys);
    return parsed.default ?? Object.values(parsed)[0];
  }
  throw new Error('no service key');
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false } });
}

/** Returns the signed-in user id from the Authorization header, or null. */
export async function userFrom(req: Request): Promise<string | null> {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!token || token.split('.').length !== 3) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function isOwner(db: SupabaseClient, tenantId: string, userId: string | null) {
  if (!userId) return false;
  const { data } = await db.from('tenant_owners').select('user_id').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
  return !!data;
}

export interface TenantRow {
  id: string; slug: string; status: string; name: string; kind: string; tagline: string; address: string; map_url: string;
  phone: string; timezone: string; currency: string; schedule: Schedule; prep_minutes: number; slot_step_minutes: number;
  booking_horizon_days: number; min_lead_minutes: number; cancel_hours: number; cancel_policy: string; features: unknown;
}

export async function loadStudio(db: SupabaseClient, by: { slug?: string; id?: string }) {
  let q = db.from('tenants').select('*');
  q = by.slug ? q.eq('slug', by.slug) : q.eq('id', by.id!);
  const { data: tenant } = await q.maybeSingle<TenantRow>();
  if (!tenant || tenant.status === 'disabled') return null;
  const [services, bays, off] = await Promise.all([
    db.from('services').select('id,name,description,price,price_from,duration_minutes,active,sort').eq('tenant_id', tenant.id).order('sort'),
    db.from('bays').select('id,name,active,sort').eq('tenant_id', tenant.id).order('sort'),
    db.from('days_off').select('day').eq('tenant_id', tenant.id),
  ]);
  const clock: StudioClock = {
    timezone: tenant.timezone,
    schedule: tenant.schedule,
    daysOff: (off.data ?? []).map((d: { day: string }) => d.day),
    prepMinutes: tenant.prep_minutes,
    stepMinutes: tenant.slot_step_minutes,
    minLeadMinutes: tenant.min_lead_minutes,
    horizonDays: tenant.booking_horizon_days,
  };
  return {
    tenant,
    services: (services.data ?? []) as { id: string; name: string; description: string; price: number; price_from: boolean; duration_minutes: number; active: boolean }[],
    bays: ((bays.data ?? []) as { id: string; name: string; active: boolean }[]).filter((b) => b.active),
    clock,
  };
}

export async function loadBusy(db: SupabaseClient, tenantId: string, from: Date, to: Date, excludeId?: string): Promise<Busy[]> {
  let q = db
    .from('bookings')
    .select('id,bay_id,starts_at,blocked_until')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .lt('starts_at', to.toISOString())
    .gt('blocked_until', from.toISOString());
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return (data ?? []) as Busy[];
}

export const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}
