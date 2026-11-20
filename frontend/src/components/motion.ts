import { useEffect } from 'react';

/** Presentation only: never changes routes, auth, focus, or data arrival time. */
export function observeSections(root: ParentNode = document): () => void {
  const groups = Array.from(root.querySelectorAll<HTMLElement>(
    '.public-section > .section-heading, .product-loop, .preview-console, .architecture-map, .benefit-grid, .evaluation-table, .developer-card, .trust-section, .public-cta'
  ));
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (preference?.matches || typeof IntersectionObserver === 'undefined') return () => {};
  const reveal = (node: HTMLElement) => {
    node.classList.remove('motion-pending');
    node.classList.add('motion-reveal');
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      reveal(entry.target as HTMLElement);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px 24px 0px' });
  for (const node of groups) {
    // Only off-screen content can wait for an observer. Visible content never waits.
    if (node.getBoundingClientRect().top > window.innerHeight) node.classList.add('motion-pending');
    else reveal(node);
    observer.observe(node);
  }
  const showAll = () => { if (preference?.matches) {
    groups.forEach(node => node.classList.remove('motion-pending', 'motion-reveal'));
    observer.disconnect();
  }};
  preference?.addEventListener?.('change', showAll);
  return () => {
    observer.disconnect();
    preference?.removeEventListener?.('change', showAll);
    groups.forEach(node => node.classList.remove('motion-pending', 'motion-reveal'));
  };
}

export function useSectionMotion() {
  useEffect(() => observeSections(), []);
}
