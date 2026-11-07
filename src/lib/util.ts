import { formatInTimeZone } from 'date-fns-tz';
import { ru } from 'date-fns/locale';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { appConfig } from './api';

export const fmt = (d: Date | string, tz: string, pattern: string) =>
  formatInTimeZone(typeof d === 'string' ? new Date(d) : d, tz, pattern, { locale: ru });

export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia('(prefers-reduced-motion: reduce)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/** Adds .is-visible when the element scrolls into view (once). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, className: visible ? 'reveal is-visible' : 'reveal' };
}

export const statusLabel: Record<string, string> = {
  booked: 'Записан', arrived: 'Машина принята', ready: 'Готова', done: 'Выдана', cancelled: 'Отменена',
};

// ---- calendar ----
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function icsFile(o: { title: string; start: Date; end: Date; location: string; description: string; uid: string }) {
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//autostudio//RU', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${o.uid}@autostudio`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(o.start)}`, `DTEND:${icsDate(o.end)}`,
    `SUMMARY:${esc(o.title)}`, `LOCATION:${esc(o.location)}`, `DESCRIPTION:${esc(o.description)}`,
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}
export function downloadIcs(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function googleCalendarUrl(o: { title: string; start: Date; end: Date; location: string; description: string }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: o.title, dates: `${icsDate(o.start)}/${icsDate(o.end)}`, location: o.location, details: o.description });
  return `https://calendar.google.com/calendar/render?${p}`;
}

// ---- push ----
export function pushSupport(): 'ok' | 'ios-install' | 'no' {
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS && !standalone ? 'ios-install' : 'no';
  return 'ok';
}
const b64ToU8 = (b: string) => {
  const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
export async function subscribePush(): Promise<PushSubscriptionJSON> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(appConfig.vapidPublicKey) }));
  return sub.toJSON();
}

// ---- images (owner uploads) ----
export async function resizeImage(file: File, maxW = 1800, quality = 0.84): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('resize'))), 'image/jpeg', quality));
}

export const rub = (v: number, currency = 'RUB') =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** short tap feedback on Android (ignored elsewhere and with reduced motion) */
export function haptic(ms = 8) {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate?.(ms);
  } catch { /* unsupported */ }
}
