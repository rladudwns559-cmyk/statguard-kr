import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from './navigation';
import './fonts';
import { BrandMark } from '../components/Brand';

/** One place for the version shown on every StatGuard page (must match claims.EXTRACTOR_VERSION). */
export const STATGUARD_VERSION = 'v0.7.1';
export const SITE_NAME = 'StatGuard-KR';

type Page = 'home' | 'workspace' | 'challenge' | 'results';
const NAV: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: '/', label: '소개' },
  { page: 'workspace', href: '/statguard', label: '검증하기' },
  { page: 'challenge', href: '/statguard/challenge', label: 'AI 오답 체험' },
  { page: 'results', href: '/statguard/results', label: '실험 결과' },
];

export function usePageTitle(title: string) {
  useEffect(() => { const previous = document.title; document.title = title; return () => { document.title = previous; }; }, [title]);
}

/** Cards that lean toward the pointer in 3D. Mouse/pen only; off for reduced motion. */
const TILT = '[data-tilt], .sg-receipt > div, .sg-rail > li, .sg-stamps > div, .sg-results-meta > div';
export function useTiltEffect() {
  useEffect(() => {
    if (reducedMotion()) return;
    let active: HTMLElement | null = null;
    const release = () => { if (active) { active.classList.remove('is-tilting'); active.style.removeProperty('--rx'); active.style.removeProperty('--ry'); active = null; } };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const el = (event.target as Element | null)?.closest?.(TILT) as HTMLElement | null;
      if (el !== active) release();
      if (!el) return;
      active = el; el.classList.add('is-tilting');
      const r = el.getBoundingClientRect(), x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
      el.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`); el.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`); el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerleave', release);
    return () => { release(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', release); };
  }, []);
}

/** Adds is-armed, then is-in once the element scrolls into view (CSS animates the change). */
export function useRevealOnScroll<T extends Element>() {
  const ref = useRef<T>(null), [state, setState] = useState<'' | ' is-armed' | ' is-armed is-in'>('');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function' || reducedMotion()) return;
    setState(' is-armed');
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setState(' is-armed is-in'); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, className: state };
}

export function StatGuardHeader({ current, extra }: { current: Page; extra?: ReactNode }) {
  useTiltEffect();
  return <header className="sg-header">
    <a className="sg-brand" href="/"><BrandMark/>StatGuard-KR</a>
    <nav aria-label="StatGuard 메뉴">{NAV.map(n => <a key={n.page} href={n.href} aria-current={n.page === current ? 'page' : undefined}>{n.label}</a>)}</nav>
    {extra}
  </header>;
}
