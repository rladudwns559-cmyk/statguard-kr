import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpenModelsSection, ScaleSection } from '../statguard/ResultsExtras';
import { COMPARISON } from '../statguard/comparisonData';

describe('open-model re-check section (statguard_benchmark_v0.4_local)', () => {
  it('shows the three open models, the big open judge, and the limits read from the results file', () => {
    const o = COMPARISON.open_models!;
    render(<OpenModelsSection/>);
    expect(screen.getByRole('heading', { name: 'OpenAI가 아닌 모델에서도 통할까?' })).toBeInTheDocument();
    for (const m of ['qwen2.5:7b', 'llama3.1:8b', 'gemma3:4b']) expect(screen.getAllByText(new RegExp(m.replace('.', '\\.'))).length).toBeGreaterThan(0);
    const q = o.models['qwen2.5:7b'];
    expect(screen.getByText(`${q.flagged_S1}/${q.flagged}`)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '공개 모델 심판 비교 표' })).toHaveTextContent(String(o.judge_a.judge.passed_wrong));
    expect(screen.getByText(/긴 표는 심판이 읽지 못합니다/)).toBeInTheDocument();
    expect(screen.getByText(/질문과 다른 나라를 고르고/)).toBeInTheDocument();
  });

  it('shows the v0.5 big-model results and the two pre-registered tests from the results file', () => {
    const s = COMPARISON.scale!;
    render(<ScaleSection/>);
    expect(screen.getByRole('heading', { name: '큰 모델, 더 많은 문항에서도 같을까?' })).toBeInTheDocument();
    const t = s.tables.all;
    expect(screen.getByRole('region', { name: '큰 모델 통과 중 오답 표' })).toHaveTextContent(`${t.statguard.passed_wrong}/${t.statguard.pass}`);
    const tests = screen.getByRole('region', { name: '미리 정한 검정 표' });
    expect(tests).toHaveTextContent('Fisher');
    expect(tests).toHaveTextContent(`근거로만 고침 ${s.tests.only_S} vs 재확인으로만 고침 ${s.tests.only_R}`);
    expect(tests).toHaveTextContent(/× 10−\d+/);
  });
});
