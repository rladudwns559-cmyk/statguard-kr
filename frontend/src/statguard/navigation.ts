import { flushSync } from 'react-dom';

/** Pages that switch in place (no reload) with a view transition. Everything else is a normal link. */
export const SPA_PATHS = ['/', '/statguard', '/statguard/challenge', '/statguard/results'];
export const NAVIGATE_EVENT = 'sg:navigate';
/** Cancelable; a page with unsaved work calls preventDefault() so we can ask before leaving. */
export const LEAVE_EVENT = 'sg:beforeleave';
const LEAVE_MESSAGE = '불러온 CSV와 검증 결과가 사라집니다. 이 페이지를 떠날까요?';

const normalize = (p: string) => p.replace(/\/$/, '') || '/';
let preload: (path: string) => Promise<unknown> = () => Promise.resolve();
export function setPreloader(fn: (path: string) => Promise<unknown>) { preload = fn; }

export function reducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Runs a DOM-changing update inside a view transition when the browser supports it. */
export function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition !== 'function' || reducedMotion()) { update(); return; }
  const vt = doc.startViewTransition.call(doc, () => flushSync(update)) as { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> } | undefined;
  // A newer click skips the running transition; that rejection is expected, not an error.
  for (const p of [vt?.ready, vt?.finished, vt?.updateCallbackDone]) p?.catch(() => {});
}

export function confirmLeave() {
  const leave = new Event(LEAVE_EVENT, { cancelable: true });
  window.dispatchEvent(leave);
  return !leave.defaultPrevented || window.confirm(LEAVE_MESSAGE);
}

export async function navigate(href: string) {
  const url = new URL(href, window.location.href), path = normalize(url.pathname);
  if (normalize(window.location.pathname) === path && !url.hash) { window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
  if (!confirmLeave()) return;
  try { await preload(path); } catch { window.location.assign(url.href); return; }
  withTransition(() => {
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
    const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null;
    if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  });
}

/** Delegated click handler: same-origin, plain left clicks on links to StatGuard pages. */
export function interceptLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || !SPA_PATHS.includes(normalize(url.pathname))) return;
  event.preventDefault();
  void navigate(url.href);
}
