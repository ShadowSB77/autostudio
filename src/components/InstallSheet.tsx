import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Export, PlusSquare, X } from '@phosphor-icons/react';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; window.dispatchEvent(new Event('autostudio:can-install')); });
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

const isPhone = () => /Android|iPhone|iPod/i.test(navigator.userAgent);
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent);

/** Bottom sheet shown once on a phone browser: one tap turns the link into a real app on the home screen. */
export function InstallSheet({ name, icon }: { name: string; icon?: string | null }) {
  const key = `autostudio:install-dismissed:${location.pathname.split('/').slice(0, 4).join('/')}`;
  const [open, setOpen] = useState(false);
  const [canPrompt, setCanPrompt] = useState(!!deferred);

  useEffect(() => {
    if (isStandalone() || !isPhone() || navigator.webdriver) return;
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(key); } catch { /* ignore */ }
    if (dismissed) return;
    const t = window.setTimeout(() => setOpen(true), 1800);
    const h = () => setCanPrompt(true);
    window.addEventListener('autostudio:can-install', h);
    window.addEventListener('appinstalled', () => setOpen(false));
    return () => { window.clearTimeout(t); window.removeEventListener('autostudio:can-install', h); };
  }, [key]);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  };

  if (!open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onClick={close}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet__close" aria-label="Закрыть" onClick={close}><X size={20} /></button>
        <div className="sheet__app">
          {icon ? <img src={icon} alt="" className="sheet__icon" /> : <span className="sheet__icon" />}
          <div>
            <p className="sheet__name">{name}</p>
            <p className="sheet__sub">Запись, цены и помощник — в одно касание</p>
          </div>
        </div>
        <h2 id="install-title" className="sheet__title">Установите приложение</h2>
        {canPrompt ? (
          <>
            <p className="hint">Появится на главном экране и будет открываться как обычное приложение. Ничего скачивать из магазина не нужно.</p>
            <Button variant="primary" size="lg" width="100%" label="Установить" onClick={async () => { await deferred?.prompt(); deferred = null; close(); }} />
          </>
        ) : isIOS() ? (
          <ol className="sheet__steps">
            <li>Нажмите <Export size={20} aria-label="Поделиться" className="inline-icon" /> внизу экрана Safari</li>
            <li>Выберите <PlusSquare size={20} aria-hidden className="inline-icon" /> «На экран „Домой“»</li>
            <li>Нажмите «Добавить» — иконка появится среди приложений</li>
          </ol>
        ) : (
          <ol className="sheet__steps">
            <li>Откройте меню браузера (⋮ справа вверху)</li>
            <li>Выберите «Установить приложение» или «Добавить на главный экран»</li>
          </ol>
        )}
        <button type="button" className="sheet__later" onClick={close}>Не сейчас</button>
      </div>
    </div>
  );
}
