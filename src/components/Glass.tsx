import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/util';

type Lens = { destroy?: () => void };

interface GlassProps {
  /** CSS selector of the element whose pixels are refracted. Keep it small: only the photo
   *  for the hero button, so text from other sections can never show inside the glass. */
  snapshot: string;
  className?: string;
  children: ReactNode;
  /** re-create the lens when these change (e.g. new photo, new page) */
  refreshKey?: unknown;
  zIndex: number;
  tint?: string;
  as?: 'div' | 'nav';
  ariaLabel?: string;
  frost?: number;
  resolution?: number;
}

/**
 * Real optical glass via liquid-gl (WebGPU → WebGL → CSS backdrop-filter fallback).
 * The children (labels, icons) stay normal DOM above the lens, so text is always crisp.
 */
export function Glass({ snapshot, className = '', children, refreshKey, zIndex, tint, as = 'div', ariaLabel, frost = 0, resolution = 1.5 }: GlassProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let lens: Lens | Lens[] | null = null;
    let cancelled = false;
    const el = ref.current;
    if (!el) return;
    el.classList.remove('glass--gl');
    const start = async () => {
      const snap = document.querySelector(snapshot);
      if (!snap) return;
      // wait for images inside the snapshot so the refraction texture is complete
      await Promise.all(
        Array.from(snap.querySelectorAll('img')).map((img) =>
          img.complete ? Promise.resolve() : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }),
        ),
      );
      if (cancelled) return;
      try {
        const { default: liquidGL } = await import('liquid-gl');
        if (cancelled) return;
        lens = liquidGL({
          target: `[data-glass="${id}"]`,
          snapshot,
          engine: 'webgl2', // WebGL2 → WebGL1 → CSS; most stable on phones
          resolution,
          zIndex,
          content: false,
          refraction: 0.012,
          bevelDepth: 0.07,
          bevelWidth: 0.2,
          frost,
          shadow: true,
          specular: !reduced,
          reveal: reduced ? 'none' : 'fade',
          tilt: false,
          tint: tint ?? 'rgba(10, 11, 16, 0.18)',
          on: { init: () => el.classList.add('glass--gl') },
        }) as Lens | Lens[];
      } catch (e) {
        console.warn('liquid glass unavailable, using CSS fallback', e);
      }
    };
    const t = window.setTimeout(start, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      const all = Array.isArray(lens) ? lens : lens ? [lens] : [];
      all.forEach((l) => { try { l.destroy?.(); } catch { /* already gone */ } });
    };
  }, [id, snapshot, refreshKey, zIndex, tint, reduced, frost, resolution]);

  const Tag = as;
  return (
    <Tag ref={ref as never} data-glass={id} className={`glass ${className}`} style={{ zIndex }} aria-label={ariaLabel}>
      <span className="glass__edge" aria-hidden="true" />
      <div className="glass__content">{children}</div>
    </Tag>
  );
}
