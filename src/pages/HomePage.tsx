import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { StudioCtx } from './StudioLayout';
import { Hero } from '../components/Hero';
import { BookingCard } from '../components/BookingCard';
import { Assistant } from '../components/Assistant';
import { Contacts, GalleryGrid, Reveal, SectionHead, ServiceCards } from '../components/Sections';
import { useReducedMotion } from '../lib/util';

export const CLIENT_EXAMPLES = ['Когда ближайшее окно?', 'Сколько стоит полировка?', 'Как найти студию?'];

export function useBookingScroll() {
  const reduced = useReducedMotion();
  return () => document.getElementById('booking')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

export function HomePage() {
  const { studio } = useOutletContext<StudioCtx>();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const toBooking = useBookingScroll();
  const services = studio.services.filter((s) => s.active);

  return (
    <>
      <Hero studio={studio} onBook={toBooking} />
      <div className="content">
        <Reveal>
          <SectionHead eyebrow="Прайс" title="Услуги и цены" />
          <ServiceCards services={services} currency={studio.tenant.currency} selectedId={serviceId} onPick={(id) => { setServiceId(id); toBooking(); }} />
        </Reveal>
        <Reveal>
          <BookingCard studio={studio} serviceId={serviceId} onServiceChange={setServiceId} />
        </Reveal>
        <Reveal>
          <Assistant
            slug={studio.tenant.slug}
            mode="client"
            examples={CLIENT_EXAMPLES}
            title="Помощник студии"
            intro="Ответит про цены, свободное время и как нас найти."
          />
        </Reveal>
        {studio.gallery.length > 0 && (
          <Reveal>
            <SectionHead eyebrow="Портфолио" title="Наши работы" />
            <GalleryGrid studio={studio} />
          </Reveal>
        )}
        <Reveal>
          <SectionHead eyebrow="Контакты" title="Как нас найти" />
          <Contacts studio={studio} />
        </Reveal>
        <footer className="footer">© {new Date().getFullYear()} {studio.tenant.name}</footer>
      </div>
    </>
  );
}
