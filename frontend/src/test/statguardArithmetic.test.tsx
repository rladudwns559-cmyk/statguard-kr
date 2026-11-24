import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.history.replaceState(null, '', '/statguard'); });
afterEach(() => vi.unstubAllGlobals());

describe('inline arithmetic check without a CSV', () => {
  it('sends only the answer text and shows which written-out calculation is wrong', async () => {
    let seen: Record<string, unknown> = {};
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      seen = JSON.parse(String(init?.body));
      return json({ ok: true, bridge_version: 'x', request_id: seen.request_id, arithmetic: { version: 'statguard-arithmetic-v0.1.1', summary: { checked: 1, inconsistent: 1 },
        checks: [{ sentence: 's', expression: '1000 + 1178 + 800', stated: '2878', recomputed: '2978', tolerance: '0.5', status: 'INCONSISTENT' }] } });
    });
    render(<StatGuardWorkspace/>);
    const card = screen.getByRole('region', { name: 'CSV가 없나요? 답변 속 계산만 검산하기' });
    const button = within(card).getByRole('button', { name: '답변 속 계산 검산' });
    expect(button).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('검산할 답변'), '합계는 1000 + 1178 + 800 = 2878명입니다.');
    await userEvent.click(button);
    const result = await within(card).findByRole('region', { name: '답변 속 계산 검산' });
    expect(Object.keys(seen).sort()).toEqual(['answer_text', 'mode', 'request_id']);
    expect(seen.mode).toBe('check_arithmetic');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveTextContent('1개가 틀렸습니다');
    expect(result).toHaveTextContent('계산 틀림');
    expect(result).toHaveTextContent('다시 계산하면 2978');
  });

  it('does not show a result that is not linked to this request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ ok: true, request_id: 'other', arithmetic: { version: 'v', summary: { checked: 0, inconsistent: 0 }, checks: [] } }));
    render(<StatGuardWorkspace/>);
    const card = screen.getByRole('region', { name: 'CSV가 없나요? 답변 속 계산만 검산하기' });
    await userEvent.type(within(card).getByLabelText('검산할 답변'), '1 + 1 = 3');
    await userEvent.click(within(card).getByRole('button', { name: '답변 속 계산 검산' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('검산을 완료하지 못했습니다');
  });
});
