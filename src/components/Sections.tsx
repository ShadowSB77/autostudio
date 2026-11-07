import type { ReactNode } from 'react';
import { MapPin, Phone, NavigationArrow, Clock } from '@phosphor-icons/react';
import type { Service, Studio } from '../lib/api';
import { DAY_KEYS, DAY_LABELS, dayKeyOf, formatDuration, formatPrice, todayIn } from '../shared/schedule';
import { useReveal } from '../lib/util';

export function Reveal({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  const r = useReveal<HTMLElement>();
  return <section ref={r.ref} id={id} className={`${r.className} ${className}`}>{children}</section>;
}

export function SectionHead({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="section-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function ServiceCards({ services, currency, onPick, selectedId }: { services: Service[]; currency: string; onPick: (id: string) => void; selectedId?: string | null }) {
  return (
    <ul className="svc-grid">
      {services.map((s) => (
        <li key={s.id}>
          <button type="button" className={`svc-card ${selectedId === s.id ? 'is-selected' : ''}`} onClick={() => onPick(s.id)}>
            <span className="svc-card__name">{s.name}</span>
            {s.description && <span className="svc-card__desc">{s.description}</span>}
            <span className="svc-card__row">
              <span className="svc-card__price tnum">{formatPrice(Number(s.price), s.price_from, currency)}</span>
              <span className="svc-card__time tnum"><Clock size={15} aria-hidden /> {formatDuration(s.duration_minutes)}</span>
            </span>
            <span className="svc-card__cta">Записаться →</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function GalleryGrid({ studio }: { studio: Studio }) {
  if (!studio.gallery.length) return null;
  return (
    <ul className="gallery">
      {studio.gallery.map((g) => (
        <li key={g.id} className="gallery__item">
          <figure>
            <img src={g.image_url} alt={g.caption || 'Пример работы'} loading="lazy" decoding="async" width={900} height={675} />
            {g.caption && <figcaption>{g.caption}</figcaption>}
          </figure>
        </li>
      ))}
    </ul>
  );
}

export function Contacts({ studio }: { studio: Studio }) {
  const t = studio.tenant;
  const today = dayKeyOf(todayIn(t.timezone));
  return (
    <div className="contacts">
      <div className="contacts__card">
        <div className="contacts__row">
          <MapPin size={22} weight="duotone" aria-hidden />
          <div>
            <p className="contacts__label">Адрес</p>
            <p className="contacts__value">{t.address}</p>
          </div>
        </div>
        <div className="contacts__actions">
          {t.map_url && (
            <a className="btn-ghost" href={t.map_url} target="_blank" rel="noopener noreferrer"><NavigationArrow size={18} aria-hidden /> Маршрут</a>
          )}
          <a className="btn-ghost" href={`tel:${t.phone.replace(/[^+\d]/g, '')}`}><Phone size={18} aria-hidden /> {t.phone}</a>
        </div>
      </div>
      <div className="contacts__card">
        <p className="contacts__label">График работы</p>
        <dl className="hours">
          {DAY_KEYS.map((k) => {
            const r = t.schedule[k] ?? [];
            return (
              <div key={k} className={`hours__row ${k === today ? 'is-today' : ''}`}>
                <dt>{DAY_LABELS[k]}</dt>
                <dd className="tnum">{r.length ? r.map(([a, b]) => `${a}–${b}`).join(', ') : 'выходной'}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
