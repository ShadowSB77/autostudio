import { Badge } from '@astryxdesign/core/Badge';
import { CalendarPlus, ShieldCheck, Clock, Sparkle, Drop, Car, Wrench, Star, Medal, Gauge, Thermometer } from '@phosphor-icons/react';
import type { Feature, Studio } from '../lib/api';
import { isOpenNow } from '../shared/schedule';
import { Glass } from './Glass';

export const featureIcons = {
  shield: ShieldCheck, clock: Clock, sparkle: Sparkle, drop: Drop, car: Car, wrench: Wrench, star: Star, medal: Medal, gauge: Gauge, thermometer: Thermometer,
};

export function FeatureIcon({ icon, size = 22 }: { icon: Feature['icon']; size?: number }) {
  const I = featureIcons[icon] ?? Star;
  return <I size={size} weight="duotone" aria-hidden />;
}

export function Hero({ studio, onBook }: { studio: Studio; onBook: () => void }) {
  const t = studio.tenant;
  const open = isOpenNow(studio.clock);
  return (
    <section className="hero" aria-labelledby="hero-title">
      {/* Only this layer is refracted by the glass button: no text inside it */}
      <div className="hero__media">
        {t.hero_url && <img src={t.hero_url} alt="" crossOrigin="anonymous" fetchPriority="high" decoding="async" />}
        <div className="hero__shade" />
      </div>
      <div className="hero__inner">
        <div className="hero__top">
          {t.logo_url && <img className="hero__logo" src={t.logo_url} alt={`Логотип ${t.name}`} width={44} height={44} />}
          <Badge
            variant={open.open ? 'success' : 'neutral'}
            label={open.open ? `Сейчас открыто · до ${open.until}` : open.next ? `Закрыто · откроемся ${open.next}` : 'Закрыто'}
          />
        </div>
        <div className="hero__copy">
          <p className="eyebrow">{t.kind === 'service' ? 'Автосервис' : 'Детейлинг-студия'}</p>
          <h1 id="hero-title" className="hero__title">{t.name}</h1>
          {t.tagline && <p className="hero__tagline">{t.tagline}</p>}
        </div>
        <Glass snapshot=".hero__media" zIndex={5} refreshKey={t.hero_url} className="hero__cta" tint="rgba(12,13,18,0.22)">
          <button type="button" className="hero__cta-btn" onClick={onBook}>
            <CalendarPlus size={22} weight="bold" aria-hidden />
            <span>Записаться</span>
          </button>
        </Glass>
        <ul className="dash" aria-label="Преимущества">
          {(t.features ?? []).slice(0, 3).map((f, i) => (
            <li key={i} className="dash__card">
              <span className="dash__icon"><FeatureIcon icon={f.icon} /></span>
              <span className="dash__value tnum">{f.value}</span>
              <span className="dash__label">{f.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
