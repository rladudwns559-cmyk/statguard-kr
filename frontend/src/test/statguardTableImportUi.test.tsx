import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.history.replaceState(null, '', '/statguard'); });
afterEach(() => vi.unstubAllGlobals());

describe('loading a table from Excel or a paste', () => {
  it('opens an .xlsx file as a CSV and says so', async () => {
    render(<StatGuardWorkspace/>);
    const bytes = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.xlsx'));
    await userEvent.upload(screen.getByLabelText('CSV·엑셀 파일 선택'), new File([bytes], '강수량.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    expect(await screen.findByText(/엑셀 파일의 ‘강수량’ 시트\(시트 2개 중 첫 번째\)를 CSV로 바꿔 읽었습니다/)).toBeVisible();
    expect(screen.getAllByText('강수량.csv').length).toBeGreaterThan(0);
  });

  it('starts from a pasted tab-separated range', async () => {
    render(<StatGuardWorkspace/>);
    await userEvent.click(screen.getByRole('button', { name: '표 붙여넣기' }));
    const card = screen.getByRole('region', { name: '표 붙여넣기' });
    await userEvent.click(within(card).getByLabelText('붙여 넣을 표'));
    await userEvent.paste('연도\t방문자수\n2023\t1000\n2024\t1178');
    await userEvent.click(within(card).getByRole('button', { name: '이 표로 시작' }));
    expect(await screen.findByText('붙여 넣은 표를 CSV로 바꿔 읽었습니다.')).toBeVisible();
    expect(screen.getAllByText('붙여넣은_표.csv').length).toBeGreaterThan(0);
  });

  it('explains that the old .xls format cannot be read', async () => {
    render(<StatGuardWorkspace/>);
    await userEvent.upload(screen.getByLabelText('CSV·엑셀 파일 선택'), new File(['x'], 'old.xls'), { applyAccept: false });
    expect(await screen.findByText(/엑셀 97-2003 형식\(.xls\)은 읽을 수 없습니다/)).toBeVisible();
  });
});
