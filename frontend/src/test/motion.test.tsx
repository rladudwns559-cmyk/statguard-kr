import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeSections } from '../components/motion';
import { PublicShell, Demo } from '../public/PublicPages';

afterEach(() => vi.unstubAllGlobals());

describe('motion progressive enhancement', () => {
  it('keeps all content visible when observation is unavailable or motion is reduced', () => {
    const {container} = render(<div className="product-loop">Flow</div>);
    vi.stubGlobal('IntersectionObserver', undefined);
    observeSections(container)();
    expect(container.querySelector('.motion-pending')).toBeNull();
    const observer = vi.fn();
    vi.stubGlobal('IntersectionObserver', observer);
    vi.stubGlobal('matchMedia', () => ({matches:true}));
    observeSections(container)();
    expect(observer).not.toHaveBeenCalled();
  });
  it('reveals offscreen groups once and releases listeners and hidden state on cleanup', () => {
    let callback: IntersectionObserverCallback = () => {};
    const observe=vi.fn(), unobserve=vi.fn(), disconnect=vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb:IntersectionObserverCallback) { callback=cb; }
      observe=observe; unobserve=unobserve; disconnect=disconnect;
    });
    const preference={matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
    vi.stubGlobal('matchMedia', () => preference);
    const {container}=render(<div className="product-loop">Flow</div>);
    const node=container.firstElementChild as HTMLElement;
    vi.spyOn(node,'getBoundingClientRect').mockReturnValue({top:2000} as DOMRect);
    const clean=observeSections(container);
    expect(node).toHaveClass('motion-pending');
    callback([{isIntersecting:true,target:node} as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(node).not.toHaveClass('motion-pending');
    expect(unobserve).toHaveBeenCalledWith(node);
    clean();
    expect(disconnect).toHaveBeenCalled();
    expect(node).not.toHaveClass('motion-reveal');
    expect(preference.removeEventListener).toHaveBeenCalled();
  });
  it('closes mobile navigation with Escape on the toggle without losing focus', async () => {
    const user=userEvent.setup();render(<PublicShell><p>Content</p></PublicShell>);
    await user.click(screen.getByRole('button',{name:'메뉴 열기'}));
    const toggle=screen.getByRole('button',{name:'메뉴 닫기'});
    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded','false');
    expect(toggle).toHaveFocus();
  });
  it('changes inspector content without remounting the keyboard-focused next control', async () => {
    const user=userEvent.setup();render(<Demo/>);
    const next=screen.getByRole('button',{name:'다음 단계 →'});
    next.focus();await user.keyboard('{Enter}');
    expect(screen.getByRole('heading',{name:'도구가 오류를 반환'})).toBeVisible();
    expect(next).toHaveFocus();
  });
});
