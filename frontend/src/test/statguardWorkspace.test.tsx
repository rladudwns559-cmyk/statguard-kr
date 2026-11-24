import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import StatGuardWorkspace, { SAMPLE } from '../statguard/StatGuardWorkspace';
import App from '../App';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden in this test'));
  window.history.replaceState(null, '', '/statguard');
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());
async function upload(text = SAMPLE, name = '사례.csv') {
  await userEvent.upload(screen.getByLabelText('CSV 파일 선택'), new File([text], name, { type: 'text/csv' }));
  await screen.findByRole('heading', { name: '자료 미리보기' });
}
async function setValid() {
  await userEvent.selectOptions(screen.getByLabelText('계산할 숫자 열'), '방문자수');
  await userEvent.type(screen.getByLabelText('열의 원래 단위'), '명');
}
describe('StatGuard existing page integration', () => {
  it('opens the real route without credentials, auth bypass, or network calls', async () => {
    render(<App/>); expect(await screen.findByRole('heading', { name: 'AI가 말한 숫자, CSV로 다시 계산해 확인하세요.' })).toBeVisible();
    expect(window.location.pathname).toBe('/statguard'); expect(fetch).not.toHaveBeenCalled();
    const nav = screen.getByRole('navigation', { name: 'StatGuard 메뉴' });
    expect([...nav.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')])).toEqual([['소개', '/'], ['검증하기', '/statguard'], ['AI 오답 체험', '/statguard/challenge'], ['실험 결과', '/statguard/results']]);
    expect(screen.getByRole('link', { name: '검증하기' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('a[href="/ask"], a[href="/projects"]')).toBeNull();
    await waitFor(() => expect(document.title).toBe('검증하기 · StatGuard-KR'));
  });
  it('previews the uploaded file, requires unit/column and explicit consent', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload();
    expect(screen.getByRole('table')).toHaveTextContent('1178');
    expect(screen.getByRole('button', { name: '이 조건으로 확인' })).toBeDisabled();
    await setValid(); expect(screen.getByRole('button', { name: '이 조건으로 확인' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '이 조건으로 확인' }));
    expect(screen.getByRole('region', { name: '확정된 계산 조건' })).toHaveTextContent('아직 계산 결과나 검증 판정은 생성하지 않았습니다');
    expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it('invalidates confirmation on ANY condition change, including unit, selection, operation or missing policy', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload(); await setValid();
    async function confirm() { await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '이 조건으로 확인' })); }
    await confirm(); await userEvent.selectOptions(screen.getByLabelText('빈 숫자 값 처리'), 'omit');
    expect(screen.queryByRole('region', { name: '확정된 계산 조건' })).not.toBeInTheDocument();
    await confirm(); await userEvent.type(screen.getByLabelText('열의 원래 단위'), '수');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await confirm(); await userEvent.selectOptions(screen.getByLabelText('계산 종류'), 'mean');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await confirm(); await userEvent.click(screen.getByRole('button', { name: '+ 선택 범위 조건 추가' }));
    expect(screen.queryByRole('region', { name: '확정된 계산 조건' })).not.toBeInTheDocument();
  });
  it('includes all rows in validation, while previewing at most ten', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload('지역,연도,방문자수\n' + 'A,2024,1\n'.repeat(10) + 'B,2024,오류'); await setValid();
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(10);
    expect(screen.getByText(/숫자로 읽을 수 없는 값이 1개/)).toBeVisible();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it('requires separate reference selection for percent change and preserves exact selected values', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload(); await setValid();
    await userEvent.selectOptions(screen.getByLabelText('계산 종류'), 'percent_change');
    await userEvent.click(screen.getByRole('button', { name: '+ 선택 범위 조건 추가' }));
    await userEvent.selectOptions(screen.getByLabelText('선택 범위 1 열'), '연도'); await userEvent.type(screen.getByLabelText('선택 범위 1 값'), '2024');
    await userEvent.click(screen.getByRole('button', { name: '+ 기준 범위 조건 추가' }));
    await userEvent.selectOptions(screen.getByLabelText('기준 범위 1 열'), '연도'); await userEvent.type(screen.getByLabelText('기준 범위 1 값'), '2023');
    expect(screen.getByRole('checkbox')).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '이 조건으로 확인' }));
    expect(screen.getByRole('region', { name: '확정된 계산 조건' })).toHaveTextContent('"reference_filters": { "연도": "2023" }');
  });
  it('clears stale preview and confirmation when a new invalid file is selected', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload(); await setValid();
    await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: '이 조건으로 확인' }));
    await userEvent.upload(screen.getByLabelText('CSV 파일 선택'), new File(['열,열\n1,2'], 'bad.csv', { type: 'text/csv' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('중복된 열 이름');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '확정된 계산 조건' })).not.toBeInTheDocument();
  });
  it('resets all data when encoding changes or the user clears the workspace', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload(); await userEvent.selectOptions(screen.getByLabelText('문자 인코딩'), 'utf-8');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '예제 CSV로 시작' })); await screen.findByRole('table');
    expect(screen.getByText('합성 예제 · 실측 자료 아님')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '자료 비우기' })); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('refuses oversized upload before reading it and catches unreadable content without echo', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>);
    await userEvent.upload(screen.getByLabelText('CSV 파일 선택'), new File([new Uint8Array(1_048_577)], 'large.csv', { type: 'text/csv' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('최대 1 MiB');
  });
  it('keeps HTML and spreadsheet formula content inert in the actual DOM', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload('열\n<img src=x onerror=alert(1)>\n=2+2');
    expect(screen.getByRole('table').querySelector('img')).toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('=2+2'); expect(fetch).not.toHaveBeenCalled();
  });
  it('has no persisted CSV after unmount/reopen and warns before navigation while data is present', async () => {
    const { unmount } = render(<StatGuardWorkspace initialMode="calculate"/>); await upload();
    // The navigation guard is attached in an effect after the data renders; wait for it instead of racing it.
    await waitFor(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); });
    unmount(); render(<StatGuardWorkspace initialMode="calculate"/>); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
  });
  it('can remove a condition without corrupting the other filter', async () => {
    render(<StatGuardWorkspace initialMode="calculate"/>); await upload();
    await userEvent.click(screen.getByRole('button', { name: '+ 선택 범위 조건 추가' }));
    await userEvent.click(screen.getByRole('button', { name: '+ 선택 범위 조건 추가' }));
    fireEvent.change(screen.getByLabelText('선택 범위 2 열'), { target: { value: '연도' } });
    fireEvent.change(screen.getByLabelText('선택 범위 2 값'), { target: { value: '2024' } });
    await userEvent.click(screen.getByRole('button', { name: '선택 범위 1 삭제' }));
    await waitFor(() => expect(screen.getByLabelText('선택 범위 1 값')).toHaveValue('2024'));
  });
});
