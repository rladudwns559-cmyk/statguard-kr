import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../statguard/csv';
import { cleanNumber, excelDate, pastedToCsv, xlsxToCsv } from '../statguard/tableImport';

const fixture = () => { const b = readFileSync(resolve(process.cwd(), 'src/test/fixtures/sample.xlsx')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe('Excel and pasted tables → CSV', () => {
  it('reads the first sheet: shared and inline strings, dates, float noise, gaps', async () => {
    const r = await xlsxToCsv(fixture());
    expect(r.sheet).toBe('강수량');
    expect(r.sheets).toBe(2);
    const t = parseCsv(r.csv);
    expect(t.columns).toEqual(['날짜', '강수량', '비고']);  // trailing space in the header trimmed
    expect(t.rows).toEqual([
      ['2023-12-31', '0.3', '비, "많음"'],                  // built-in date format, float noise, quoted cell
      ['2024-01-01', '78.5', '맑음'],                       // custom date format, inline string; empty row 3 dropped
      ['2024-01-02', '1178', ''],                           // missing cell padded
    ]);
  });

  it('rejects a file that is not a zip', async () => {
    await expect(xlsxToCsv(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow('엑셀 파일 형식을 읽을 수 없습니다');
  });

  it('turns a pasted tab-separated range into CSV and keeps CSV as it is', () => {
    expect(pastedToCsv('연도\t방문자수 \n2023\t1,000\n2024\t1178\n\n')).toBe('연도,방문자수\r\n2023,"1,000"\r\n2024,1178\r\n');
    expect(pastedToCsv('연도,값\n2023,1\n')).toBe('연도,값\r\n2023,1\r\n');
    expect(() => pastedToCsv('  \n ')).toThrow('비어 있습니다');
  });

  it('formats Excel serial dates and numbers', () => {
    expect(excelDate(45291)).toBe('2023-12-31');
    expect(excelDate(45291.5)).toBe('2023-12-31 12:00');
    expect(cleanNumber('0.30000000000000004')).toBe('0.3');
    expect(cleanNumber('51712619')).toBe('51712619');
  });
});
