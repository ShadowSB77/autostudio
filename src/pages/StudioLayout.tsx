import { useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { Theme, defineTheme } from '@astryxdesign/core/theme';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HouseSimple, ListBullets, CalendarCheck } from '@phosphor-icons/react';
import { useStudio, type Studio } from '../lib/api';
import { Glass } from '../components/Glass';

export type StudioCtx = { studio: Studio };

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function StudioLayout() {
  const { slug } = useParams();
  const { data: studio, isLoading, error } = useStudio(slug);
  const loc = useLocation();
  const isAdmin = loc.pathname.endsWith('/admin');
  const accent = studio?.tenant.accent ?? '#D4AF37';

  const theme = useMemo(
    () =>
      defineTheme({
        name: `studio-${slug}`,
        tokens: {
          '--color-accent': accent,
          '--color-accent-muted': `${accent}33`,
          '--color-on-accent': '#0B0C10',
          '--color-text-accent': accent,
          '--color-icon-accent': accent,
          '--color-background-body': '#0B0C10',
          '--color-background-surface': '#14161D',
          '--color-background-card': '#14161D',
          '--color-background-popover': '#1A1D25',
          '--color-text-primary': '#F4F4F6',
          '--color-text-secondary': '#9499A3',
          '--color-icon-primary': '#F4F4F6',
          '--color-icon-secondary': '#9499A3',
        },
      }),
    [slug, accent],
  );

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(accent));
    if (studio) document.title = isAdmin ? `Кабинет · ${studio.tenant.name}` : `${studio.tenant.name} — запись онлайн`;
    window.scrollTo({ top: 0 });
  }, [accent, studio, isAdmin, loc.pathname]);

  if (isLoading) {
    return (
      <div className="page-center">
        <Spinner size="xl" aria-label="Загрузка" />
      </div>
    );
  }
  if (error || !studio) {
    return (
      <div className="page-center">
        <VStack gap={2} hAlign="center">
          <Heading level={1}>Студия не найдена</Heading>
          <Text color="secondary">{error ? 'Нет связи с сервером. Проверьте интернет.' : 'Проверьте ссылку.'}</Text>
        </VStack>
      </div>
    );
  }

  const base = `/s/${slug}`;
  return (
    <Theme theme={theme} mode="dark">
      <div className={`app ${isAdmin ? 'app--admin' : ''}`}>
        {studio.tenant.status === 'sample' && !isAdmin && (
          <div className="sample-ribbon" role="note">Образец приложения · записи тестовые</div>
        )}
        <main className="app__main">
          <Outlet context={{ studio } satisfies StudioCtx} />
        </main>
        {!isAdmin && (
          <div className="dock">
            <Glass as="nav" ariaLabel="Основная навигация" snapshot=".app__main" zIndex={40} refreshKey={loc.pathname} className="dock__bar" frost={4} resolution={1} tint="rgba(9, 10, 14, 0.62)">
              <NavLink end to={base} className="dock__item">
                <HouseSimple size={22} weight="duotone" aria-hidden />
                <span>Главная</span>
              </NavLink>
              <NavLink to={`${base}/services`} className="dock__item">
                <ListBullets size={22} weight="duotone" aria-hidden />
                <span>Услуги</span>
              </NavLink>
              <NavLink to={`${base}/my`} className="dock__item">
                <CalendarCheck size={22} weight="duotone" aria-hidden />
                <span>Моя запись</span>
              </NavLink>
            </Glass>
          </div>
        )}
      </div>
    </Theme>
  );
}
