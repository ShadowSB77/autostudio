import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DeviceMobile, Export } from '@phosphor-icons/react';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; });
}

export function InstallPrompt({ name }: { name: string }) {
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  const [done, setDone] = useState(false);
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

  useEffect(() => {
    const h = () => setCanPrompt(true);
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('appinstalled', () => setDone(true));
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (standalone || done) return null;
  return (
    <section className="install">
      <DeviceMobile size={28} weight="duotone" aria-hidden />
      <div className="install__text">
        <p className="install__title">{name} на главном экране</p>
        {canPrompt ? (
          <p className="hint">Откроется как приложение — без адресной строки, со своей иконкой.</p>
        ) : isIOS ? (
          <p className="hint">В Safari нажмите <Export size={16} aria-label="Поделиться" style={{ verticalAlign: '-3px' }} /> «Поделиться» → «На экран „Домой“».</p>
        ) : (
          <p className="hint">В меню браузера выберите «Добавить на главный экран» или «Установить приложение».</p>
        )}
      </div>
      {canPrompt && (
        <Button variant="secondary" label="Установить" onClick={async () => { await deferred?.prompt(); deferred = null; setCanPrompt(false); }} />
      )}
    </section>
  );
}
