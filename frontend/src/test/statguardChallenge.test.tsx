import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import AnswerChallenge, { Challenge, pickRound, type Item } from '../statguard/AnswerChallenge';
import data from '../statguard/aiAnswers.json';

const items = (data as unknown as { items: Item[] }).items;
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('AI 오답 체험', () => {
  it('uses the 120 recorded answers and their real outcomes', () => {
    expect(items).toHaveLength(120);
    const wrong = items.filter(i => !i.correct);
    expect(wrong).toHaveLength(27);
    expect(wrong.filter(i => i.statguard === 'PASS')).toHaveLength(0);
    expect(items.find(i => i.key === 'v0.2:W08')).toMatchObject({ correct: false, statguard: 'FLAG', final: '7.9 ℃', expected: '7.6333 ℃' });
  });

  it('builds a 5-question round mixing right and wrong single-number answers', () => {
    for (const r of [seq(0.1, 0.7, 0.3), seq(0.9, 0.2), seq(0.5)]) {
      const round = pickRound(items, r);
      expect(round).toHaveLength(5);
      expect(new Set(round.map(i => i.key)).size).toBe(5);
      expect(round.filter(i => !i.correct).length).toBeGreaterThanOrEqual(2);
      expect(round.every(i => i.answerable && !/형식 오류|판단불가/.test(i.final))).toBe(true);
    }
  });

  it('reveals the real value and StatGuard verdict after a guess, then scores the round honestly', async () => {
    render(<Challenge seed={seq(0.1, 0.4, 0.8)}/>);
    for (let n = 1; n <= 5; n++) {
      const card = screen.getByLabelText(`챌린지 ${n}번 문제`);
      await userEvent.click(within(card).getByRole('button', { name: '틀리다' }));
      expect(within(card).getByRole('status')).toHaveTextContent(/실제 값: .*StatGuard: /);
      await userEvent.click(within(card).getByRole('button', { name: n < 5 ? '다음 문제' : '결과 보기' }));
    }
    const result = screen.getByLabelText('챌린지 결과');
    expect(result).toHaveTextContent('당신이 맞힌 문제');
    expect(result).toHaveTextContent('StatGuard가 확정하지 않고 보류');
    await userEvent.click(within(result).getByRole('button', { name: '새 문제로 다시 하기' }));
    expect(screen.getByLabelText('챌린지 1번 문제')).toBeVisible();
  });

  it('lists every wrong answer in the gallery with filters', async () => {
    window.history.replaceState(null, '', '/statguard/challenge'); render(<AnswerChallenge/>);
    expect(screen.getAllByRole('article')).toHaveLength(27);
    await userEvent.click(screen.getByRole('button', { name: /StatGuard가 잡은 것 \(8\)/ }));
    expect(screen.getAllByRole('article')).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: /근거로 고쳐진 것/ }));
    expect(screen.getAllByRole('article').every(a => /번째 수정에서 고쳐짐/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/틀린 답을 ‘계산 일치’로 통과시킨 경우는 0개/)).toBeVisible();
  });

  it('shows the reproduced cause (error forensics) on wrong answers that have one', async () => {
    window.history.replaceState(null, '', '/statguard/challenge'); render(<AnswerChallenge/>);
    await userEvent.click(screen.getByRole('button', { name: /틀린 이유를 찾은 것 \(4\)/ }));
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(4);
    expect(cards.every(a => /왜 틀렸을까/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByLabelText('v0.3:R02 오답')).toHaveTextContent(/Guyana.*44,871\.10달러로 답변의 숫자와 같습니다/);
  });
});
