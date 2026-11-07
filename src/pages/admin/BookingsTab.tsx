import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Dialog } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { CaretLeft, CaretRight, Plus, Phone } from '@phosphor-icons/react';
import type { StudioCtx } from '../StudioLayout';
import { api, ApiError, supabase, useBusy } from '../../lib/api';
import { addDays, slotsForDay, todayIn, zoned, DAY_KEYS, dayKeyOf } from '../../shared/schedule';
import { bookingFormSchema } from '../../shared/tenantConfig';
import { fmt, newKey, rub, statusLabel } from '../../lib/util';

interface Row {
  id: string; service_id: string | null; service_name: string; bay_id: string; customer_name: string; customer_phone: string; car: string; notes: string;
  starts_at: string; ends_at: string; status: string; price: number; source: string; is_demo: boolean; payments: { amount: number; kind: string }[];
}

export function BookingsTab({ session }: { session: Session }) {
  const { studio } = useOutletContext<StudioCtx>();
  const t = studio.tenant;
  const tz = t.timezone;
  const qc = useQueryClient();
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [anchor, setAnchor] = useState(todayIn(tz));
  const range = useMemo(() => {
    if (mode === 'day') return { from: anchor, to: addDays(anchor, 1) };
    const dow = DAY_KEYS.indexOf(dayKeyOf(anchor));
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 7) };
  }, [mode, anchor]);
  const fromTs = zoned(range.from, '00:00', tz).toISOString();
  const toTs = zoned(range.to, '00:00', tz).toISOString();

  const bookings = useQuery({
    queryKey: ['owner-bookings', t.id, fromTs, toTs],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('bookings').select('*, payments(amount,kind)').eq('tenant_id', t.id)
        .lt('starts_at', toTs).gt('ends_at', fromTs).order('starts_at');
      if (error) throw error;
      return data as Row[];
    },
  });
  const money = useQuery({
    queryKey: ['owner-money', t.id, fromTs, toTs],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments').select('amount').eq('tenant_id', t.id).gte('created_at', fromTs).lt('created_at', toTs);
      if (error) throw error;
      return (data ?? []).reduce((a, p) => a + Number(p.amount), 0);
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['owner-bookings', t.id] });
    qc.invalidateQueries({ queryKey: ['owner-money', t.id] });
    qc.invalidateQueries({ queryKey: ['busy', t.id] });
  };

  const rows = bookings.data ?? [];
  const active = rows.filter((r) => r.status !== 'cancelled');
  const startsInRange = active.filter((r) => r.starts_at >= fromTs && r.starts_at < toTs);
  const bayName = Object.fromEntries(studio.bays.map((b) => [b.id, b.name]));
  const [newOpen, setNewOpen] = useState(false);
  const [move, setMove] = useState<Row | null>(null);
  const [pay, setPay] = useState<{ row: Row; kind: 'payment' | 'refund' } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setStatus = async (r: Row, status: string) => {
    setErr(null);
    const { error } = await supabase.from('bookings').update({ status }).eq('id', r.id);
    if (error) setErr('Не удалось изменить статус');
    refresh();
  };

  const periodLabel = mode === 'day'
    ? fmt(`${anchor}T12:00:00Z`, 'UTC', 'EEEE, d MMMM')
    : `${fmt(`${range.from}T12:00:00Z`, 'UTC', 'd MMM')} — ${fmt(`${addDays(range.to, -1)}T12:00:00Z`, 'UTC', 'd MMM')}`;

  return (
    <div className="owner">
      <div className="owner__controls">
        <SegmentedControl label="Период" value={mode} onChange={(v) => setMode(v as 'day' | 'week')}>
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Неделя" />
        </SegmentedControl>
        <div className="period-nav">
          <IconButton label="Назад" icon={<CaretLeft size={18} />} variant="ghost" onClick={() => setAnchor(addDays(anchor, mode === 'day' ? -1 : -7))} />
          <button type="button" className="period-nav__label" onClick={() => setAnchor(todayIn(tz))} title="К сегодняшнему дню">{periodLabel}</button>
          <IconButton label="Вперёд" icon={<CaretRight size={18} />} variant="ghost" onClick={() => setAnchor(addDays(anchor, mode === 'day' ? 1 : 7))} />
        </div>
        <Button variant="primary" label="Добавить запись" icon={<Plus size={18} weight="bold" />} onClick={() => setNewOpen(true)} />
      </div>

      <ul className="kpis" aria-label="Показатели за период">
        <li className="kpi"><span className="kpi__value tnum">{startsInRange.length}</span><span className="kpi__label">заездов</span></li>
        <li className="kpi"><span className="kpi__value tnum">{startsInRange.filter((r) => r.status === 'done').length}</span><span className="kpi__label">завершено</span></li>
        <li className="kpi"><span className="kpi__value tnum">{money.data === undefined ? '…' : rub(money.data, t.currency)}</span><span className="kpi__label">получено</span></li>
      </ul>
      {err && <Banner status="error" title={err} />}
      {bookings.isLoading && <div className="slots-loading"><Spinner size="lg" aria-label="Загрузка" /></div>}
      {!bookings.isLoading && rows.length === 0 && <p className="empty">Записей на этот период нет.</p>}
      <ul className="owner-list">
        {rows.map((r) => {
          const paid = r.payments.reduce((a, p) => a + Number(p.amount), 0);
          return (
            <li key={r.id} className={`owner-card status-${r.status}`}>
              <div className="owner-card__time tnum">
                <strong>{fmt(r.starts_at, tz, mode === 'week' ? 'EEE d, HH:mm' : 'HH:mm')}</strong>
                <span>до {fmt(r.ends_at, tz, fmt(r.ends_at, tz, 'yyyyMMdd') === fmt(r.starts_at, tz, 'yyyyMMdd') ? 'HH:mm' : 'd MMM HH:mm')}</span>
                <span className="muted">{bayName[r.bay_id]}</span>
              </div>
              <div className="owner-card__main">
                <div className="owner-card__line">
                  <span className="owner-card__service">{r.service_name}</span>
                  <Badge variant={r.status === 'cancelled' ? 'neutral' : r.status === 'done' ? 'success' : r.status === 'ready' ? 'teal' : r.status === 'arrived' ? 'blue' : 'yellow'} label={statusLabel[r.status]} />
                  {r.is_demo && <Badge variant="neutral" label="тест" />}
                </div>
                <p className="owner-card__who">{r.car} · {r.customer_name} · <a href={`tel:${r.customer_phone.replace(/[^+\d]/g, '')}`}><Phone size={14} aria-hidden /> {r.customer_phone}</a></p>
                <p className="owner-card__money tnum">Цена {rub(Number(r.price), t.currency)} · оплачено {rub(paid, t.currency)}</p>
                {r.status !== 'cancelled' && (
                  <div className="owner-card__actions">
                    {r.status === 'booked' && <Button size="sm" variant="secondary" label="Машина принята" onClick={() => setStatus(r, 'arrived')} />}
                    {r.status === 'arrived' && <Button size="sm" variant="secondary" label="Готова" onClick={() => setStatus(r, 'ready')} />}
                    {r.status === 'ready' && <Button size="sm" variant="secondary" label="Выдана" onClick={() => setStatus(r, 'done')} />}
                    <Button size="sm" variant="ghost" label="Оплата" onClick={() => setPay({ row: r, kind: 'payment' })} />
                    {paid > 0 && <Button size="sm" variant="ghost" label="Возврат" onClick={() => setPay({ row: r, kind: 'refund' })} />}
                    {r.status === 'booked' && <Button size="sm" variant="ghost" label="Перенести" onClick={() => setMove(r)} />}
                    {r.status === 'booked' && <Button size="sm" variant="ghost" label="Отменить" onClick={() => { if (confirm('Отменить запись?')) setStatus(r, 'cancelled'); }} />}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {newOpen && <NewBookingDialog session={session} onClose={() => { setNewOpen(false); refresh(); }} defaultDay={anchor} />}
      {move && <MoveDialog session={session} row={move} onClose={() => { setMove(null); refresh(); }} />}
      {pay && <PaymentDialog row={pay.row} kind={pay.kind} session={session} onClose={() => { setPay(null); refresh(); }} />}
    </div>
  );
}

function SlotPicker({ serviceMinutes, day, setDay, value, onChange, excludeId }: {
  serviceMinutes: number; day: string; setDay: (d: string) => void; value: string; onChange: (iso: string) => void; excludeId?: string;
}) {
  const { studio } = useOutletContext<StudioCtx>();
  const busy = useBusy(studio.tenant.id, studio.clock.horizonDays);
  const busyFiltered = (busy.data ?? []).filter((b) => !excludeId || !(b as { id?: string }).id || (b as { id?: string }).id !== excludeId);
  const clock = { ...studio.clock, minLeadMinutes: 0 };
  const slots = slotsForDay(day, serviceMinutes, studio.bays.filter((b) => b.active).map((b) => b.id), busyFiltered, clock).filter((s) => s.reason !== 'past');
  return (
    <div className="field-group">
      <TextInput label="Дата" type="text" value={day} onChange={(v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && setDay(v)} placeholder="ГГГГ-ММ-ДД"
        description={fmt(`${day}T12:00:00Z`, 'UTC', 'EEEE, d MMMM')} />
      <div className="day-quick">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const d = addDays(todayIn(studio.clock.timezone), i);
          return <button key={d} type="button" className={`chip ${d === day ? 'is-selected' : ''}`} onClick={() => setDay(d)}>{fmt(`${d}T12:00:00Z`, 'UTC', 'EEE d')}</button>;
        })}
      </div>
      {slots.length === 0 ? <p className="hint">В этот день нет рабочих часов.</p> : (
        <div className="slots slots--compact">
          {slots.map((s) => (
            <button key={s.start.toISOString()} type="button" disabled={!s.free} className={`slot ${value === s.start.toISOString() ? 'is-selected' : ''} ${!s.free ? 'is-busy' : ''}`}
              onClick={() => onChange(s.start.toISOString())} aria-label={`${s.label}${s.free ? '' : ', занято'}`}>
              <span className="slot__time tnum">{s.label}</span>{!s.free && <span className="slot__busy">занято</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewBookingDialog({ session, onClose, defaultDay }: { session: Session; onClose: () => void; defaultDay: string }) {
  const { studio } = useOutletContext<StudioCtx>();
  const services = studio.services.filter((s) => s.active);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [day, setDay] = useState(defaultDay);
  const [start, setStart] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', car: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const [key] = useState(newKey);
  const svc = services.find((s) => s.id === serviceId);
  const save = async () => {
    setErr(null);
    const p = bookingFormSchema.safeParse(form);
    if (!p.success) { setErr(p.error.issues[0].message); return; }
    if (!start) { setErr('Выберите время'); return; }
    try {
      await api.createBooking({ slug: studio.tenant.slug, serviceId, start, ...p.data, idempotencyKey: key, asOwner: true }, session);
      onClose();
    } catch (e) { setErr((e as ApiError).message); }
  };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} purpose="form" width={520} padding={4}>
      <div className="dialog-body">
        <h3 className="dialog-title">Новая запись</h3>
        <Selector label="Услуга" value={serviceId} onChange={(v) => { setServiceId(v); setStart(''); }} options={services.map((s) => ({ value: s.id, label: s.name }))} />
        {svc && <SlotPicker serviceMinutes={svc.duration_minutes} day={day} setDay={(d) => { setDay(d); setStart(''); }} value={start} onChange={setStart} />}
        <TextInput label="Имя клиента" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <TextInput label="Телефон" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <TextInput label="Автомобиль" value={form.car} onChange={(v) => setForm({ ...form, car: v })} />
        {err && <Banner status="error" title={err} />}
        <div className="dialog-actions">
          <Button variant="secondary" label="Закрыть" onClick={onClose} />
          <Button variant="primary" label="Сохранить" clickAction={save} />
        </div>
      </div>
    </Dialog>
  );
}

function MoveDialog({ session, row, onClose }: { session: Session; row: Row; onClose: () => void }) {
  const { studio } = useOutletContext<StudioCtx>();
  const svc = studio.services.find((s) => s.id === row.service_id);
  const minutes = svc?.duration_minutes ?? Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000);
  const [day, setDay] = useState(fmt(row.starts_at, studio.clock.timezone, 'yyyy-MM-dd'));
  const [start, setStart] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!start) { setErr('Выберите новое время'); return; }
    try { await api.moveBooking(row.id, start, session); onClose(); } catch (e) { setErr((e as ApiError).message); }
  };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} purpose="form" width={520} padding={4}>
      <div className="dialog-body">
        <h3 className="dialog-title">Перенести запись</h3>
        <p>{row.service_name} · {row.car} · сейчас {fmt(row.starts_at, studio.clock.timezone, 'd MMMM HH:mm')}</p>
        <SlotPicker serviceMinutes={minutes} day={day} setDay={(d) => { setDay(d); setStart(''); }} value={start} onChange={setStart} excludeId={row.id} />
        {err && <Banner status="error" title={err} />}
        <div className="dialog-actions">
          <Button variant="secondary" label="Закрыть" onClick={onClose} />
          <Button variant="primary" label="Перенести" clickAction={save} />
        </div>
      </div>
    </Dialog>
  );
}

function PaymentDialog({ row, kind, session, onClose }: { row: Row; kind: 'payment' | 'refund'; session: Session; onClose: () => void }) {
  const { studio } = useOutletContext<StudioCtx>();
  const paid = row.payments.reduce((a, p) => a + Number(p.amount), 0);
  const [amount, setAmount] = useState<number>(kind === 'payment' ? Math.max(0, Number(row.price) - paid) : paid);
  const [method, setMethod] = useState('cash');
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!(amount > 0)) { setErr('Введите сумму больше нуля'); return; }
    if (kind === 'refund' && amount > paid) { setErr('Возврат больше полученной суммы'); return; }
    const { error } = await supabase.from('payments').insert({
      tenant_id: studio.tenant.id, booking_id: row.id, amount: kind === 'payment' ? amount : -amount, kind, method, created_by: session.user.id,
    });
    if (error) { setErr('Не удалось сохранить'); return; }
    onClose();
  };
  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} purpose="form" width={420} padding={4}>
      <div className="dialog-body">
        <h3 className="dialog-title">{kind === 'payment' ? 'Внести оплату' : 'Оформить возврат'}</h3>
        <p className="tnum">{row.service_name} · цена {rub(Number(row.price))} · оплачено {rub(paid)}</p>
        <NumberInput label="Сумма, ₽" value={amount} onChange={setAmount} min={0} step={100} />
        <Selector label="Способ" value={method} onChange={setMethod} options={[{ value: 'cash', label: 'Наличные' }, { value: 'card', label: 'Карта' }, { value: 'transfer', label: 'Перевод' }]} />
        {err && <Banner status="error" title={err} />}
        <div className="dialog-actions">
          <Button variant="secondary" label="Закрыть" onClick={onClose} />
          <Button variant={kind === 'payment' ? 'primary' : 'destructive'} label={kind === 'payment' ? 'Сохранить оплату' : 'Сохранить возврат'} clickAction={save} />
        </div>
      </div>
    </Dialog>
  );
}
