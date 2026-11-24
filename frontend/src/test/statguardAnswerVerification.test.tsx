import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';
import { SAMPLE_ANSWER } from '../statguard/AnswerVerification';
import type { AnswerRequest } from '../statguard/answerClient';

const usage = (rows: number[]) => ({ selected_rows: rows, used_rows: rows, omitted_rows: [] as number[], filtered_out_count: 6 - rows.length });
function responseFor(req: AnswerRequest, overrides: Record<string, unknown> = {}) {
  const claims = [
    { claim_id: 'c1', sentence: 'A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 23.0% 증가했습니다.', status: 'CONTRADICTED', reason_code: 'NUMERIC_VALUE_CONFLICT', operation: 'percent_change', column: '방문자수',
      spec: { operation: 'percent_change', column: '방문자수', filters: { 지역: 'A', 연도: '2024' }, reference_filters: { 지역: 'A', 연도: '2023' } }, notes: [], interpretive: false,
      claimed: { text: '23.0%', value: '23', unit: '%', unit_stated: true, tolerance: '0.05', approximate: false },
      computed: { value: '17.8', unit: '%', expression: '(1178 - 1000) / 1000 * 100', usage: usage([2]), reference_usage: usage([1]) },
      difference: { signed: '5.2', absolute: '5.2', unit: '%p', relative_percent: '29.21' } },
    { claim_id: 'c2', sentence: '방문자 증가는 체류시간이 늘었기 때문입니다.', status: 'UNCERTAIN', reason_code: 'INTERPRETIVE_STATEMENT', operation: null, spec: null, notes: [], interpretive: true, claimed: null, computed: null },
  ];
  return { ok: true, bridge_version: 'statguard-local-calculation-v0.1', verification_version: 'statguard-answer-verification-v0.1', request_id: req.request_id,
    preview_sha256: req.preview_sha256, source_sha256: req.source_sha256, dataset_version: 'a'.repeat(64), units: req.units,
    verification: { extractor: 'statguard-rule-extractor-v0.1', claims, summary: { VERIFIED: 0, CONTRADICTED: 1, UNCERTAIN: 1, INSUFFICIENT_EVIDENCE: 0 }, scope: 'LINKED_CALCULATIONS_ONLY_NOT_WHOLE_ANSWER_TRUTH' }, ...overrides };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let seen: AnswerRequest;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.history.replaceState(null, '', '/statguard'); });
afterEach(() => vi.unstubAllGlobals());

async function openAnswerTab() {
  render(<StatGuardWorkspace/>);
  await userEvent.click(screen.getByRole('button', { name: '예제 CSV로 시작' }));
  await userEvent.click(await screen.findByRole('tab', { name: /AI 답변 검증/ }));
  return screen.getByRole('region', { name: 'AI 답변 속 숫자 검증' }) ?? null;
}

describe('AI answer verification tab', () => {
  it('sends the CSV, confirmed units and answer only after an explicit click, then shows per-claim verdicts', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { seen = JSON.parse(String(init?.body)); return json(responseFor(seen)); });
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/calculate'))).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    const result = await screen.findByRole('region', { name: '답변 검증 결과' });
    expect(seen.mode).toBe('verify_answer');
    expect(seen.units).toEqual({ 방문자수: '명', 체류시간: '분' });
    expect(seen.answer_text).toBe(SAMPLE_ANSWER);
    expect(fetch).toHaveBeenCalledWith('/__statguard/calculate', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
    const contradicted = within(result).getByRole('article', { name: 'c1 계산 불일치' });
    expect(contradicted).toHaveTextContent('23.0%');
    expect(contradicted).toHaveTextContent('17.8 %');
    expect(contradicted).toHaveTextContent('+5.2 %p');
    expect(within(result).getByRole('article', { name: 'c2 해석 불확실 · 보류' })).toHaveTextContent('판정을 보류');
  });

  it('keeps the answer and verdicts when switching to the direct-calculation tab and back', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => { if (String(u).includes('live-status')) return json({ ok: true, enabled: false, remaining: 0, model: '' }); seen = JSON.parse(String(init?.body)); return json(responseFor(seen)); });
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    await userEvent.click(screen.getByRole('tab', { name: '직접 계산·수치 비교' }));
    expect(screen.queryByRole('region', { name: '답변 검증 결과' })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /AI 답변 검증/ }));
    expect(screen.getByRole('region', { name: '답변 검증 결과' })).toBeVisible();
    expect(screen.getByLabelText(/2\. AI 답변/)).toHaveValue(SAMPLE_ANSWER);
    expect(screen.getByRole('list', { name: '작업 단계' })).toHaveTextContent('판정·근거 확인 완료');
  });

  it('reads the answer back with each checked sentence tinted by verdict, and jumps to its card', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => { if (String(u).includes('live-status')) return json({ ok: true, enabled: false, remaining: 0, model: '' }); seen = JSON.parse(String(init?.body)); return json(responseFor(seen)); });
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    const readback = await screen.findByLabelText('판정을 표시한 AI 답변');
    const wrong = within(readback).getByRole('button', { name: /1,178명으로 23\.0% 증가/ });
    expect(wrong).toHaveClass('sg-rb-contradicted');
    expect(within(readback).getByRole('button', { name: /체류시간이 늘었기 때문/ })).toHaveClass('sg-rb-uncertain');
    await userEvent.click(wrong);
    expect(scroll).toHaveBeenCalled();
    expect(document.getElementById('sg-claim-c1')).toHaveClass('is-flash');
  });

  it('clears the verdicts when the answer changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { seen = JSON.parse(String(init?.body)); return json(responseFor(seen)); });
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    await userEvent.type(screen.getByLabelText(/2\. AI 답변/), ' 추가');
    expect(screen.queryByRole('region', { name: '답변 검증 결과' })).toBeNull();
  });

  it('refuses a response that is not linked to the current request', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { seen = JSON.parse(String(init?.body)); return json(responseFor(seen, { source_sha256: '0'.repeat(64) })); });
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('연결되는지 확인할 수 없어');
    expect(screen.queryByRole('region', { name: '답변 검증 결과' })).toBeNull();
  });

  it('asks for at least one unit and an answer before calling the engine', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await openAnswerTab();
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 답변을 입력');
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/calculate'))).toHaveLength(0);
  });

  it('hides the live ask box unless the local server enables it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async u => json(String(u).includes('live-status') ? { ok: true, enabled: false, remaining: 0, model: '' } : {}));
    await openAnswerTab();
    expect(screen.queryByRole('group', { name: 'AI에게 질문하기' })).toBeNull();
  });

  it('asks the live model, puts its answer in the box and verifies it immediately', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      calls.push(String(u));
      if (String(u).includes('live-status')) return json({ ok: true, enabled: true, remaining: 30, model: 'gpt-6-luna' });
      if (String(u).includes('/ask')) return json({ ok: true, answer: SAMPLE_ANSWER, model: 'gpt-6-luna' });
      seen = JSON.parse(String(init?.body)); return json(responseFor(seen));
    });
    await openAnswerTab();
    const box = await screen.findByRole('group', { name: 'AI에게 질문하기' });
    expect(box).toHaveTextContent('남은 질문 30회');
    await userEvent.type(within(box).getByLabelText('AI에게 할 질문'), 'A지역 방문자 증가율은?');
    await userEvent.click(within(box).getByRole('button', { name: '질문하고 검증' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    expect(seen.answer_text).toBe(SAMPLE_ANSWER);
    expect(calls.filter(c => c.includes('/ask'))).toHaveLength(1);
    expect(screen.getByText(/gpt-6-luna가 방금 작성한 답변/)).toBeInTheDocument();
    expect(await screen.findByText('남은 질문 29회', { exact: false })).toBeInTheDocument();
  });

  it('on the public site asks for the demo password and sends it only to the same-origin demo endpoint', async () => {
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'when2warn-public-beta.vercel.app', href: 'https://when2warn-public-beta.vercel.app/statguard', origin: 'https://when2warn-public-beta.vercel.app', pathname: '/statguard' });
    const asked: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      if (url === '/api/statguard_ask' && !init?.method) return json({ ok: true, enabled: true, requires_password: true, model: 'gpt-6-luna', remaining: 20 });
      if (url === '/api/statguard_ask') {
        const body = JSON.parse(String(init?.body)); asked.push({ url, body, headers: init?.headers as Record<string, string> });
        return body.password === 'right-pass' ? json({ ok: true, answer: SAMPLE_ANSWER, model: 'gpt-6-luna', remaining: 19 }) : json({ ok: false, error: { code: 'DEMO_PASSWORD_INVALID' } }, 401);
      }
      seen = JSON.parse(String(init?.body)); return json(responseFor(seen));
    });
    await openAnswerTab();
    const box = await screen.findByRole('group', { name: 'AI에게 질문하기' });
    expect(box).toHaveTextContent('시연 비밀번호를 아는 사용자만');
    await userEvent.type(within(box).getByLabelText('AI에게 할 질문'), 'A지역 방문자 증가율은?');
    await userEvent.click(within(box).getByRole('button', { name: '질문하고 검증' }));
    expect(await screen.findByText('시연 비밀번호를 입력해 주세요.')).toBeVisible();
    expect(asked).toHaveLength(0);
    await userEvent.type(within(box).getByLabelText('시연 비밀번호'), 'wrong');
    await userEvent.click(within(box).getByRole('button', { name: '질문하고 검증' }));
    expect(await screen.findByText('시연 비밀번호가 맞지 않습니다.')).toBeVisible();
    await userEvent.clear(within(box).getByLabelText('시연 비밀번호'));
    await userEvent.type(within(box).getByLabelText('시연 비밀번호'), 'right-pass');
    await userEvent.click(within(box).getByRole('button', { name: '질문하고 검증' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    expect(seen.answer_text).toBe(SAMPLE_ANSWER);
    expect(asked).toHaveLength(2);
    expect(Object.keys(asked[1].body).sort()).toEqual(['csv_base64', 'encoding', 'password', 'question']);
    expect(asked[1].headers['X-StatGuard-Client']).toBe('cloud-v0.1');
    expect(within(box).getByLabelText('시연 비밀번호')).toHaveAttribute('type', 'password');
  });

  it('sends StatGuard evidence back to the model, puts the corrected answer in the box and verifies it again', async () => {
    const asks: Record<string, unknown>[] = [];
    let verifications = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      if (url.includes('live-status')) return json({ ok: true, enabled: true, remaining: 30, model: 'gpt-6-luna' });
      if (url.includes('/ask')) { asks.push(JSON.parse(String(init?.body))); return json({ ok: true, answer: 'A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 17.8% 증가했습니다.', model: 'gpt-6-luna' }); }
      seen = JSON.parse(String(init?.body)); verifications++;
      if (verifications === 1) return json(responseFor(seen));
      const fixed = responseFor(seen); const v = fixed.verification as { claims: Record<string, unknown>[]; summary: Record<string, number> };
      v.claims = [{ ...v.claims[0], status: 'VERIFIED', reason_code: 'WITHIN_ROUNDING_OF_STATED_PRECISION' }]; v.summary = { VERIFIED: 1, CONTRADICTED: 0, UNCERTAIN: 0, INSUFFICIENT_EVIDENCE: 0 };
      return json(fixed);
    });
    await openAnswerTab();
    const box = await screen.findByRole('group', { name: 'AI에게 질문하기' });
    await userEvent.type(within(box).getByLabelText('AI에게 할 질문'), 'A지역 방문자 증가율은?');
    await userEvent.click(screen.getByRole('button', { name: '예시 답변 넣기' }));
    await userEvent.click(screen.getByRole('button', { name: '답변 검증' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    await userEvent.click(screen.getByRole('button', { name: '근거 보내고 AI에게 고치게 하기' }));
    expect(await screen.findByText(/StatGuard 근거로 고친 답변 \(1회차\) · 계산 불일치 1건 → 0건, 계산 일치 0건 → 1건/)).toBeVisible();
    expect(asks).toHaveLength(1);
    expect(asks[0].question).toBe('A지역 방문자 증가율은?');
    expect(asks[0].previous_answer).toBe(SAMPLE_ANSWER);
    expect(String(asks[0].feedback)).toMatch(/불일치: .*CSV 재계산 값 17\.8 %/);
    expect(String(asks[0].feedback)).not.toMatch(/expected|정답/);
    expect(seen.answer_text).toMatch(/17\.8% 증가/);
    expect(screen.queryByRole('button', { name: '근거 보내고 AI에게 고치게 하기' })).toBeNull();
  });

  it('asks for an analysis report without a question, then shows a before/after diff once StatGuard evidence fixes it', async () => {
    const asks: Record<string, unknown>[] = [];
    let verifications = 0;
    const REPORT = 'A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 23.0% 증가했습니다.\n\n방문자 증가는 체류시간이 늘었기 때문입니다.';
    const FIXED = 'A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 17.8% 증가했습니다.\n\n방문자 증가는 체류시간이 늘었기 때문입니다.';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      if (url.includes('live-status')) return json({ ok: true, enabled: true, remaining: 30, model: 'gpt-6-luna' });
      if (url.includes('/ask')) { const b = JSON.parse(String(init?.body)); asks.push(b); return json({ ok: true, answer: b.feedback ? FIXED : REPORT, model: 'gpt-6-luna' }); }
      seen = JSON.parse(String(init?.body)); verifications++;
      if (verifications === 1) return json(responseFor(seen));
      const fixed = responseFor(seen); const v = fixed.verification as { claims: Record<string, unknown>[]; summary: Record<string, number> };
      v.claims = [{ ...v.claims[0], status: 'VERIFIED', reason_code: 'WITHIN_ROUNDING_OF_STATED_PRECISION' }, v.claims[1]]; v.summary = { VERIFIED: 1, CONTRADICTED: 0, UNCERTAIN: 1, INSUFFICIENT_EVIDENCE: 0 };
      return json(fixed);
    });
    await openAnswerTab();
    await userEvent.click(await screen.findByRole('button', { name: 'AI에게 분석 보고서 쓰게 하기' }));
    await screen.findByRole('region', { name: '답변 검증 결과' });
    expect(asks[0]).toMatchObject({ mode: 'report' });
    expect(String(asks[0].question)).toMatch(/^이 자료로 분석 보고서를 작성해 주세요\. 열 단위: .+/);
    expect(screen.getByText(/gpt-6-luna가 방금 작성한 분석 보고서/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '근거 보내고 AI에게 고치게 하기' }));
    const diff = await screen.findByRole('region', { name: '수정 전후 비교' });
    expect(diff.querySelector('del')?.textContent).toContain('23.0%');
    expect(diff.querySelector('ins')?.textContent).toContain('17.8%');
    expect(asks[1]).toMatchObject({ mode: 'report' });
    expect(String(asks[1].feedback)).toMatch(/보고서를 고쳐 다시 작성하세요/);
  });
});
