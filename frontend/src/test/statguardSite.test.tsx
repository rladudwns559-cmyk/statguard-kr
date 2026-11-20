import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import App from '../App';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';
import BenchmarkResults from '../statguard/BenchmarkResults';
import StatGuardHome from '../statguard/StatGuardHome';
import { STATGUARD_VERSION } from '../statguard/StatGuardChrome';
import { TOTALS } from '../statguard/benchmarkTotals';
import stability from '../statguard/benchmarkStability.json';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test')); });
afterEach(() => vi.unstubAllGlobals());
const navOf = () => [...screen.getByRole('navigation', { name: 'StatGuard 메뉴' }).querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]);
const menu = (name: string) => within(screen.getByRole('navigation', { name: 'StatGuard 메뉴' })).getByRole('link', { name });
const NAV = [['소개', '/'], ['검증하기', '/statguard'], ['실험 결과', '/statguard/results']];

describe('StatGuard site consistency', () => {
  it('serves the StatGuard home at / with its own title, menu and calls to action, and no old service links', async () => {
    window.history.replaceState(null, '', '/'); render(<App/>);
    expect(await screen.findByRole('heading', { level: 1, name: 'AI가 말한 숫자, 다시 계산해서 확인합니다.' })).toBeVisible();
    expect(navOf()).toEqual(NAV);
    expect(screen.getByRole('link', { name: '소개' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '바로 체험하기' })).toHaveAttribute('href', '/statguard');
    expect(screen.getByRole('link', { name: '실험 결과 보기' })).toHaveAttribute('href', '/statguard/results');
    expect(document.querySelector('a[href="/ask"], a[href="/projects"], a[href="/signup"]')).toBeNull();
    await waitFor(() => expect(document.title).toBe('StatGuard-KR · LLM 데이터 분석 수치 검증'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows headline numbers taken from the result files, not hard-coded', () => {
    render(<StatGuardHome/>);
    const rows = Object.values(stability as unknown as Record<string, { total_passed: number; total_wrong_among_passed: number }>);
    const passed = rows.reduce((a, r) => a + r.total_passed, 0), wrong = rows.reduce((a, r) => a + r.total_wrong_among_passed, 0);
    expect(within(screen.getByLabelText('핵심 실험 결과')).getByText(`${passed}건 중 ${wrong}건`)).toBeVisible();
    expect(screen.getByText(new RegExp(`질문 ${TOTALS.questions}개·자료 ${TOTALS.datasets}종`))).toBeVisible();
    expect(screen.getByRole('link', { name: '이전 프로젝트(WHEN2WARN) 보기' })).toHaveAttribute('href', '/when2warn');
  });

  it('describes the 3D hero scene in text and shows the real model sentence and the recount', () => {
    render(<StatGuardHome/>);
    const scene = screen.getByRole('figure');
    expect(scene).toHaveAccessibleName(/AI는 연간 합계를 888\.4mm라고 했지만 다시 계산하면 888\.9mm/);
    expect(within(scene).getByText('888.4mm')).toBeVisible();
    expect(scene.querySelectorAll('.sg-bar')).toHaveLength(12);
  });

  it('draws the results overview chart with readable values for every experiment', () => {
    render(<BenchmarkResults/>);
    const chart = screen.getByRole('img', { name: /작은 표 \(2~12행\): 일반 LLM/ });
    expect(chart).toHaveAccessibleName(/큰 표 \(365·1,460행\): 일반 LLM 66\.7%, 계산 도구 96\.7%, StatGuard 통과 답변 100\.0%/);
    expect(chart.querySelectorAll('.sg-col')).toHaveLength(9);
  });

  it('keeps the previous WHEN2WARN landing at /when2warn with its original title', async () => {
    window.history.replaceState(null, '', '/when2warn'); render(<App/>);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('근거를 함께 확인하세요');
    await waitFor(() => expect(document.title).toBe('WHEN2WARN · Agent Reliability'));
  });

  it('opens on AI answer verification, describes both tabs, and the footer no longer contradicts the t-test feature', async () => {
    window.history.replaceState(null, '', '/statguard'); render(<StatGuardWorkspace/>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI가 말한 숫자, CSV로 다시 계산해 확인하세요.');
    expect(screen.getByText(/표준편차·분산·중앙값·최댓값·최솟값·상관계수·t-검정 주장을 판정합니다/)).toBeVisible();
    const footer = document.querySelector('.sg-footer')!;
    expect(footer).toHaveTextContent(`StatGuard-KR ${STATGUARD_VERSION}`);
    expect(footer.textContent).not.toMatch(/통계적 유의성.*판정하지 않습니다/);
    expect(screen.getByText(/시연용 ‘AI에게 직접 질문’을 누를 때만 질문과 CSV가 OpenAI로 전송/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '예제 CSV로 시작' }));
    expect(await screen.findByRole('tab', { name: 'AI 답변 검증' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['AI 답변 검증', '직접 계산·수치 비교']);
    expect(screen.getByRole('list', { name: '작업 단계' })).toHaveTextContent('AI 답변·단위 입력');
    await userEvent.click(screen.getByRole('tab', { name: '직접 계산·수치 비교' }));
    expect(screen.getByText(/직접 계산은 합계·평균·증감률을 지원합니다/)).toBeVisible();
    expect(screen.getByRole('list', { name: '작업 단계' })).toHaveTextContent('미리보기·조건 확인');
  });

  it('summarizes all benchmarks on the results page and drops the v0.1-only totals', async () => {
    window.history.replaceState(null, '', '/statguard/results'); render(<BenchmarkResults/>);
    expect(navOf()).toEqual(NAV);
    expect(screen.getByRole('link', { name: '실험 결과' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('실험 결과 · StatGuard-KR'));
    const scale = screen.getByLabelText('전체 실험 규모');
    expect(scale).toHaveTextContent(`${TOTALS.questions}개 · 자료 ${TOTALS.datasets}종`);
    expect(scale).toHaveTextContent(`${TOTALS.wrongPassed}/${TOTALS.passed}건`);
    expect(screen.getByText(new RegExp(`전체 질문 ${TOTALS.questions}개`))).toBeVisible();
    expect(screen.queryByText(/^질문 36개·자료 5종의 소규모 실험/)).toBeNull();
  });

  it('switches pages in place from the menu and links, without reloading, and the back button returns', async () => {
    window.history.replaceState(null, '', '/'); render(<App/>);
    await screen.findByRole('heading', { level: 1, name: 'AI가 말한 숫자, 다시 계산해서 확인합니다.' });
    await userEvent.click(menu('실험 결과'));
    await waitFor(() => expect(window.location.pathname).toBe('/statguard/results'));
    expect(await screen.findByLabelText('전체 실험 규모')).toBeVisible();
    expect(menu('실험 결과')).toHaveAttribute('aria-current', 'page');
    await userEvent.click(menu('검증하기'));
    expect(await screen.findByRole('heading', { level: 1, name: 'AI가 말한 숫자, CSV로 다시 계산해 확인하세요.' })).toBeVisible();
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/statguard/results'));
    expect(await screen.findByLabelText('전체 실험 규모')).toBeVisible();
  });

  it('asks before leaving the workspace in place once a CSV is loaded, and stays if the user cancels', async () => {
    window.history.replaceState(null, '', '/statguard'); render(<App/>);
    await userEvent.click(await screen.findByRole('button', { name: '예제 CSV로 시작' }));
    await screen.findByRole('tab', { name: 'AI 답변 검증' });
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(menu('소개'));
    expect(ask).toHaveBeenCalledWith(expect.stringMatching(/CSV와 검증 결과가 사라집니다/));
    expect(window.location.pathname).toBe('/statguard');
    expect(screen.getByRole('tab', { name: 'AI 답변 검증' })).toBeVisible();
    ask.mockReturnValue(true);
    await userEvent.click(menu('소개'));
    expect(await screen.findByRole('heading', { level: 1, name: 'AI가 말한 숫자, 다시 계산해서 확인합니다.' })).toBeVisible();
  });

  it('reads out the month under the pointer in the hero scene and the recount total otherwise', () => {
    render(<StatGuardHome/>);
    const hud = document.querySelector('.sg-hud')!;
    expect(hud).toHaveTextContent('12개월 다시 합산888.9mm');
    const bars = document.querySelectorAll('.sg-bar');
    fireEvent.pointerEnter(bars[11]);
    expect(hud).toHaveTextContent('2023년 12월215.4mm');
    expect(bars[11]).toHaveClass('is-on');
    fireEvent.pointerLeave(screen.getByRole('figure'));
    expect(hud).toHaveTextContent('12개월 다시 합산888.9mm');
  });
});
