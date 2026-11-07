import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { StudioCtx } from './StudioLayout';
import { BookingCard } from '../components/BookingCard';
import { Reveal, SectionHead, ServiceCards } from '../components/Sections';
import { useBookingScroll } from './HomePage';

export function ServicesPage() {
  const { studio } = useOutletContext<StudioCtx>();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const toBooking = useBookingScroll();
  return (
    <div className="content content--page">
      <header className="page-head">
        <p className="eyebrow">{studio.tenant.name}</p>
        <h1 className="page-title">Услуги</h1>
        <p className="page-sub">Цены и время выполнения. Нажмите на услугу, чтобы выбрать время.</p>
      </header>
      <Reveal>
        <ServiceCards services={studio.services.filter((s) => s.active)} currency={studio.tenant.currency} selectedId={serviceId}
          onPick={(id) => { setServiceId(id); toBooking(); }} />
      </Reveal>
      <Reveal>
        <SectionHead title=" " />
        <BookingCard studio={studio} serviceId={serviceId} onServiceChange={setServiceId} />
      </Reveal>
    </div>
  );
}
