import { useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Dialog } from '@astryxdesign/core/Dialog';
import { BellRinging, CalendarPlus, GoogleLogo, MapPin, Car, User, CheckCircle, XCircle } from '@phosphor-icons/react';
import type { StudioCtx } from './StudioLayout';
import { api, ApiError, myBookings, type BookingView, type Studio } from '../lib/api';
import { downloadIcs, fmt, googleCalendarUrl, icsFile, pushSupport, rub, statusLabel, subscribePush } from '../lib/util';
import { InstallPrompt } from '../components/InstallPrompt';
import { Assistant } from '../components/Assistant';
import { CLIENT_EXAMPLES } from './HomePage';

export function MyBookingPage() {
  const { studio } = useOutletContext<StudioCtx>();
  const [params] = useSearchParams();
  const fresh = params.get('new') === '1' ? params.get('b') : null;
  const tokens = useMemo(() => {
    const l = myBookings.list(studio.tenant.slug);
    const b = params.get('b');
    if (b && /^[a-f0-9]{36}$/.test(b) && !l.includes(b)) { myBookings.add(studio.tenant.slug, b); return [b, ...l]; }
    return l;
  }, [params, studio.tenant.slug]);

  const results = useQueries({
    queries: tokens.map((t) => ({ queryKey: ['booking', t], queryFn: () => api.getBooking(t), retry: false, staleTime: 15_000 })),
  });
  const loading = results.some((r) => r.isLoading);
  const items = results
    .map((r, i) => ({ token: tokens[i], data: r.data, error: r.error as ApiError | null }))
    .filter((x) => x.data || (x.error && x.error.status !== 404));
  const upcoming = items.filter((x) => x.data && new Date(x.data.booking.endsAt) > new Date() && x.data.booking.status !== 'cancelled');
  const past = items.filter((x) => !upcoming.includes(x));

  return (
    <div className="content content--page">
      <header className="page-head">
        <p className="eyebrow">{studio.tenant.name}</p>
        <h1 className="page-title">Моя запись</h1>
      </header>
      {fresh && (
        <div className="success-hero" role="status">
          <CheckCircle size={40} weight="duotone" aria-hidden />
          <div>
            <p className="success-hero__title">Вы записаны</p>
            <p className="success-hero__sub">Подробности ниже. Ссылка на запись сохранена на этом устройстве.</p>
          </div>
        </div>
      )}
      {loading && <div className="slots-loading"><Spinner size="xl" aria-label="Загружаем записи" /></div>}
      {!loading && items.length === 0 && (
        <div className="empty">
          <p>На этом устройстве пока нет записей.</p>
          <Link className="btn-primary-link" to={`/s/${studio.tenant.slug}#booking`}>Записаться</Link>
        </div>
      )}
      {upcoming.map((x) => (
        <BookingDetails key={x.token} studio={studio} data={x.data!} highlight={x.token === fresh} />
      ))}
      {past.length > 0 && (
        <details className="past">
          <summary>Прошедшие и отменённые ({past.length})</summary>
          {past.map((x) => x.data && <BookingDetails key={x.token} studio={studio} data={x.data} highlight={false} compact />)}
        </details>
      )}
      <InstallPrompt name={studio.tenant.name} />
      <Assistant slug={studio.tenant.slug} mode="client" examples={CLIENT_EXAMPLES} title="Есть вопрос?" intro="Помощник студии ответит сразу." />
    </div>
  );
}

function BookingDetails({ studio, data, highlight, compact }: {
  studio: Studio; data: { booking: BookingView; canCancel: boolean; cancelDeadline: string }; highlight: boolean; compact?: boolean;
}) {
  const b = data.booking;
  const t = studio.tenant;
  const tz = t.timezone;
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reminder, setReminder] = useState<'idle' | 'busy' | 'on' | 'denied'>('idle');
  const support = pushSupport();
  const cal = {
    title: `${b.serviceName} — ${t.name}`,
    start: new Date(b.startsAt),
    end: new Date(b.endsAt),
    location: t.address,
    description: `Автомобиль: ${b.car}. Телефон студии: ${t.phone}`,
  };
  const multiDay = fmt(b.startsAt, tz, 'yyyyMMdd') !== fmt(b.endsAt, tz, 'yyyyMMdd');

  const cancel = async () => {
    setErr(null);
    try {
      await api.cancelBooking(b.token);
      await qc.invalidateQueries({ queryKey: ['booking', b.token] });
      qc.invalidateQueries({ queryKey: ['busy', t.id] });
      setConfirm(false);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };

  const remind = async () => {
    setReminder('busy');
    try {
      const sub = await subscribePush();
      await api.subscribePush(b.token, sub);
      setReminder('on');
    } catch {
      setReminder('denied');
    }
  };

  return (
    <article className={`ticket ${highlight ? 'is-fresh' : ''} ${compact ? 'ticket--compact' : ''}`} aria-label={`Запись: ${b.serviceName}`}>
      <div className="ticket__top">
        <Badge variant={b.status === 'cancelled' ? 'neutral' : b.status === 'ready' ? 'success' : 'info'} label={statusLabel[b.status]} />
        {b.isDemo && <Badge variant="warning" label="Тестовая" />}
      </div>
      <h2 className="ticket__service">{b.serviceName}</h2>
      <p className="ticket__when tnum">{fmt(b.startsAt, tz, 'EEEE, d MMMM')} <span className="ticket__time">{fmt(b.startsAt, tz, 'HH:mm')}</span></p>
      <p className="ticket__ready tnum">Готово {multiDay ? fmt(b.endsAt, tz, 'EEEE, d MMMM, в HH:mm') : `примерно в ${fmt(b.endsAt, tz, 'HH:mm')}`}</p>
      {!compact && (
        <ul className="ticket__facts">
          <li><Car size={18} aria-hidden /> {b.car}</li>
          <li><User size={18} aria-hidden /> {b.customerName}, {b.customerPhone}</li>
          <li><MapPin size={18} aria-hidden /> {t.address}</li>
          <li className="tnum"><strong>{rub(Number(b.price), t.currency)}</strong></li>
        </ul>
      )}
      {!compact && b.status !== 'cancelled' && (
        <>
          <div className="reminder">
            <p className="reminder__title"><BellRinging size={20} weight="duotone" aria-hidden /> Напомнить за сутки?</p>
            {support === 'ok' && reminder !== 'denied' && (
              reminder === 'on'
                ? <p className="ok-note">Напоминание включено — придёт за 24 часа до записи.</p>
                : <Button variant="primary" label="Включить напоминание" onClick={remind} isLoading={reminder === 'busy'} />
            )}
            {support === 'ios-install' && <p className="hint">На iPhone уведомления работают, если добавить приложение на экран «Домой». Или добавьте запись в календарь:</p>}
            {(support === 'no' || reminder === 'denied') && <p className="hint">Уведомления на этом устройстве недоступны. Добавьте запись в календарь — он напомнит за сутки:</p>}
            <div className="reminder__cal">
              <Button variant="secondary" label="В календарь (.ics)" icon={<CalendarPlus size={18} />} onClick={() => downloadIcs(`zapis-${b.id.slice(0, 8)}.ics`, icsFile({ ...cal, uid: b.id }))} />
              <Button variant="ghost" label="Google Календарь" icon={<GoogleLogo size={18} />} href={googleCalendarUrl(cal)} target="_blank" />
            </div>
          </div>
          {data.canCancel ? (
            <Button variant="ghost" label="Отменить запись" icon={<XCircle size={18} />} onClick={() => setConfirm(true)} />
          ) : (
            b.status === 'booked' && <p className="fine">Онлайн-отмена закрыта (менее {t.cancel_hours} ч до начала). Позвоните: <a href={`tel:${t.phone.replace(/[^+\d]/g, '')}`}>{t.phone}</a></p>
          )}
          {data.canCancel && <p className="fine tnum">Отменить онлайн можно до {fmt(data.cancelDeadline, tz, 'd MMMM, HH:mm')}.</p>}
        </>
      )}
      <Dialog isOpen={confirm} onOpenChange={setConfirm} purpose="form" width={380} padding={4}>
        <div className="dialog-body">
          <h3 className="dialog-title">Отменить запись?</h3>
          <p>{b.serviceName}, {fmt(b.startsAt, tz, 'd MMMM в HH:mm')}. Время освободится для других клиентов.</p>
          {err && <Banner status="error" title={err} />}
          <div className="dialog-actions">
            <Button variant="secondary" label="Оставить" onClick={() => setConfirm(false)} />
            <Button variant="destructive" label="Отменить запись" clickAction={cancel} />
          </div>
        </div>
      </Dialog>
    </article>
  );
}
