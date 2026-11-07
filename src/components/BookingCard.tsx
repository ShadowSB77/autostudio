import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { CheckCircle, ArrowLeft, Clock as ClockIcon } from '@phosphor-icons/react';
import { api, ApiError, myBookings, useBusy, type Studio } from '../lib/api';
import { bookingDays, dayKeyOf, formatDuration, formatPrice, slotsForDay, workingIntervals } from '../shared/schedule';
import { bookingFormSchema } from '../shared/tenantConfig';
import { fmt, haptic, newKey } from '../lib/util';

interface Props {
  studio: Studio;
  serviceId: string | null;
  onServiceChange: (id: string) => void;
}

const DOW: Record<string, string> = { mon: 'пн', tue: 'вт', wed: 'ср', thu: 'чт', fri: 'пт', sat: 'сб', sun: 'вс' };

export function BookingCard({ studio, serviceId, onServiceChange }: Props) {
  const { tenant, clock } = studio;
  const tz = clock.timezone;
  const services = studio.services.filter((s) => s.active);
  const bays = studio.bays.filter((b) => b.active);
  const service = services.find((s) => s.id === serviceId) ?? null;
  const busyQ = useBusy(tenant.id, clock.horizonDays);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const days = useMemo(() => bookingDays(clock), [clock]);
  const [day, setDay] = useState(days[0]);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [form, setForm] = useState({ name: '', phone: '', car: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const keyRef = useRef(newKey());
  const submittingRef = useRef(false);

  // remember contact details on this device for the next booking
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('autostudio:contact') ?? 'null');
      if (saved) setForm((f) => ({ ...f, ...saved }));
    } catch { /* ignore */ }
  }, []);

  const slots = useMemo(() => {
    if (!service) return [];
    return slotsForDay(day, service.duration_minutes, bays.map((b) => b.id), busyQ.data ?? [], clock).filter((s) => s.reason !== 'past');
  }, [service, day, bays, busyQ.data, clock]);

  // first day with a free slot, so people don't land on an empty day
  useEffect(() => {
    if (!service || !busyQ.data) return;
    if (slots.some((s) => s.free)) return;
    const next = days.find((d) => slotsForDay(d, service.duration_minutes, bays.map((b) => b.id), busyQ.data!, clock).some((s) => s.free));
    if (next && next !== day) setDay(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id, busyQ.data]);

  const selected = slots.find((s) => s.start.toISOString() === slotIso) ?? null;

  const pickSlot = (iso: string) => {
    haptic();
    setSlotIso(iso);
    setSubmitError(null);
    keyRef.current = newKey();
  };

  const submit = async () => {
    if (submittingRef.current || !service || !selected) return;
    const parsed = bookingFormSchema.safeParse(form);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] = i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api.createBooking({
        slug: tenant.slug,
        serviceId: service.id,
        start: selected.start.toISOString(),
        ...parsed.data,
        idempotencyKey: keyRef.current,
      });
      haptic(20);
      myBookings.add(tenant.slug, r.booking.token);
      try { localStorage.setItem('autostudio:contact', JSON.stringify({ name: parsed.data.name, phone: parsed.data.phone, car: parsed.data.car })); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['busy', tenant.id] });
      navigate(`/s/${tenant.slug}/my?b=${r.booking.token}&new=1`);
    } catch (e) {
      const err = e as ApiError;
      setSubmitError(err.message);
      if (err.code === 'slot_taken' || err.code === 'slot_invalid') {
        await qc.invalidateQueries({ queryKey: ['busy', tenant.id] });
        setSlotIso(null);
        setStep('pick');
      }
      keyRef.current = newKey();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="booking" id="booking">
      <div className="booking__head">
        <p className="eyebrow">Онлайн-запись</p>
        <h2 className="section-title">Запись в студию</h2>
      </div>
      <div className="booking__card">
        {step === 'pick' && (
          <>
            <fieldset className="field-group">
              <legend className="step-label"><span className="step-num">1</span> Услуга</legend>
              <div className="svc-picker" role="radiogroup" aria-label="Услуга">
                {services.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={s.id === serviceId}
                    className={`svc-option ${s.id === serviceId ? 'is-selected' : ''}`}
                    onClick={() => { onServiceChange(s.id); setSlotIso(null); }}
                  >
                    <span className="svc-option__name">{s.name}</span>
                    <span className="svc-option__meta tnum">
                      {formatPrice(Number(s.price), s.price_from, tenant.currency)} · {formatDuration(s.duration_minutes)}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="field-group" disabled={!service}>
              <legend className="step-label"><span className="step-num">2</span> Дата</legend>
              <div className="days" role="radiogroup" aria-label="Дата">
                {days.map((d) => {
                  const closed = workingIntervals(d, clock).length === 0;
                  const isSel = d === day;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={isSel}
                      disabled={closed}
                      className={`day ${isSel ? 'is-selected' : ''}`}
                      onClick={() => { setDay(d); setSlotIso(null); }}
                      aria-label={`${fmt(`${d}T12:00:00Z`, 'UTC', 'EEEE, d MMMM')}${closed ? ', выходной' : ''}`}
                    >
                      <span className="day__dow">{DOW[dayKeyOf(d)]}</span>
                      <span className="day__num tnum">{Number(d.slice(8))}</span>
                      <span className="day__mon">{closed ? 'выходн.' : fmt(`${d}T12:00:00Z`, 'UTC', 'LLL')}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="field-group" disabled={!service}>
              <legend className="step-label"><span className="step-num">3</span> Время</legend>
              {!service && <p className="hint">Сначала выберите услугу — свободное время зависит от длительности работ.</p>}
              {service && busyQ.isLoading && <div className="slots-loading"><Spinner size="lg" aria-label="Загружаем свободное время" /></div>}
              {service && busyQ.isError && <Banner status="error" title="Не удалось загрузить свободное время" description="Проверьте интернет и обновите страницу." />}
              {service && busyQ.data && (
                slots.length === 0 ? (
                  <p className="hint">В этот день записи нет. Выберите другую дату.</p>
                ) : (
                  <div className="slots" key={`${service.id}-${day}`} role="radiogroup" aria-label="Время">
                    {slots.map((s) => {
                      const iso = s.start.toISOString();
                      const isSel = iso === slotIso;
                      return (
                        <button
                          key={iso}
                          type="button"
                          role="radio"
                          aria-checked={isSel}
                          disabled={!s.free}
                          className={`slot ${isSel ? 'is-selected' : ''} ${!s.free ? 'is-busy' : ''}`}
                          onClick={() => pickSlot(iso)}
                          aria-label={`${s.label}${s.free ? '' : ', занято'}`}
                          data-testid={s.free ? 'slot-free' : 'slot-busy'}
                        >
                          <span className="slot__time tnum">{s.label}</span>
                          {!s.free && <span className="slot__busy">занято</span>}
                        </button>
                      );
                    })}
                  </div>
                )
              )}
              {selected && service && (
                <p className="slot-summary tnum">
                  <ClockIcon size={16} aria-hidden /> {fmt(selected.start, tz, 'EEEE, d MMMM, HH:mm')} — готово {fmt(selected.end, tz, fmt(selected.end, tz, 'yyyyMMdd') === fmt(selected.start, tz, 'yyyyMMdd') ? 'в HH:mm' : 'EEEE d MMMM в HH:mm')}
                </p>
              )}
            </fieldset>
            {submitError && <Banner status="warning" title={submitError} />}
            <Button
              variant="primary"
              size="lg"
              width="100%"
              label="Продолжить"
              isDisabled={!selected}
              onClick={() => setStep('form')}
            />
          </>
        )}

        {step === 'form' && service && selected && (
          <form
            className="booking-form"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            noValidate
          >
            <button type="button" className="back-link" onClick={() => setStep('pick')}>
              <ArrowLeft size={18} aria-hidden /> Изменить услугу или время
            </button>
            <div className="summary">
              <span className="summary__service">{service.name}</span>
              <span className="summary__when tnum">{fmt(selected.start, tz, 'EEEE, d MMMM · HH:mm')}</span>
              <span className="summary__price tnum">{formatPrice(Number(service.price), service.price_from, tenant.currency)}</span>
            </div>
            <TextInput label="Имя" value={form.name} onChange={(v) => setForm({ ...form, name: v })} autoComplete="name" isRequired
              status={errors.name ? { type: 'error', message: errors.name } : undefined} statusVariant="detached" enterKeyHint="next" size="lg" />
            <TextInput label="Телефон" type="tel" inputMode="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} autoComplete="tel" isRequired
              placeholder="+7 900 000-00-00" status={errors.phone ? { type: 'error', message: errors.phone } : undefined} statusVariant="detached" enterKeyHint="next" size="lg" />
            <TextInput label="Автомобиль" value={form.car} onChange={(v) => setForm({ ...form, car: v })} isRequired placeholder="Марка, модель, цвет"
              status={errors.car ? { type: 'error', message: errors.car } : undefined} statusVariant="detached" enterKeyHint="done" size="lg" />
            {submitError && <Banner status="error" title={submitError} />}
            <Button type="submit" variant="primary" size="lg" width="100%" label="Подтвердить запись" isLoading={submitting} icon={<CheckCircle size={20} weight="bold" />} />
            <p className="fine">
              {tenant.cancel_policy || `Отменить запись онлайн можно не позднее чем за ${tenant.cancel_hours} ч.`}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
