import { describe, it, expect } from 'vitest';
import { CsvError, decodeCsv, LIMITS, microUnits, numericStatus, parseCsv } from '../statguard/csv';
import { calculationSpec, emptyDraft, inspectConditions, matching, type Draft } from '../statguard/conditions';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const table = parseCsv('지역,연도,인원\nA,2023,1000\nA,2024,1178\nB,2024,960\n');
const draft = (): Draft => ({ ...emptyDraft(), column: '인원', unit: '명' });
describe('bounded browser CSV preview', () => {
  it('preserves BOM/CRLF, leading zeros, quoted commas, escaped quotes and multiline cells', () => {
    const t = parseCsv('\uFEFF코드,내용\r\n001,"가,나"\r\n002,"줄1\n줄2 ""인용"""\r\n');
    expect(t.rows).toEqual([['001', '가,나'], ['002', '줄1\n줄2 "인용"']]);
  });
  it.each(['', '열\n', ',열\n1,2', '열,열\n1,2', ' 열\n1', '열 \n1', '열,값\n1', '열\n\n', '열\n"닫힘 없음', '열\n"a"b', '열\nx"y', '열\n\u0000'])('rejects invalid fixture %#: no content echo', (text) => {
    expect(() => parseCsv(text)).toThrow(CsvError);
    try { parseCsv(text); } catch (e) { expect((e as Error).message).not.toContain('닫힘 없음'); }
  });
  it('allows a quoted empty cell but rejects an empty physical row', () => { expect(parseCsv('열\n""\n').rows).toEqual([['']]); });
  it('enforces row, column, cell and byte limits', () => {
    expect(() => parseCsv('열\n' + '1\n'.repeat(10_001))).toThrow();
    expect(parseCsv('열\n' + '1\n'.repeat(10_000)).rows.length).toBe(10_000);
    expect(() => parseCsv(Array.from({ length: 65 }, (_, i) => 'c' + i).join(',') + '\n1')).toThrow();
    expect(() => parseCsv('열\n' + '가'.repeat(513))).toThrow();
    expect(() => decodeCsv(new ArrayBuffer(LIMITS.bytes + 1), 'auto')).toThrow();
    expect(() => decodeCsv(new ArrayBuffer(0), 'auto')).toThrow();
  });
  it('decodes UTF-8 and Korean CP949 without a provider', () => {
    expect(decodeCsv(bytes('지역,값\n서울,1'), 'auto').rows[0][0]).toBe('서울');
    const cp949 = new Uint8Array([0xc1,0xf6,0xbf,0xaa,44,0xb0,0xaa,10,0xbc,0xad,0xbf,0xef,44,49]).buffer;
    expect(decodeCsv(cp949, 'auto').rows[0][0]).toBe('서울');
    expect(decodeCsv(cp949, 'euc-kr').encoding).toContain('CP949');
    expect(() => decodeCsv(cp949, 'utf-8')).toThrow();
  });
  it('renders formula/HTML-like cells as inert data without interpreting them', () => {
    expect(parseCsv('열\n=2+2\n<img src=x onerror=alert(1)>').rows).toEqual([['=2+2'], ['<img src=x onerror=alert(1)>']]);
  });
});
describe('explicit calculation conditions, no numerical verdict', () => {
  it.each(['1', '1,000.25', '-0.000001', '+12', ' 10 ', '999999999999999999.999999'])('accepts bounded numeric notation %#', s => expect(numericStatus(s)).toBe('number'));
  it.each(['1e3', '=1+1', '1명', 'NaN', 'Infinity', '1,00', '1.0000001', '1234567890123456789'])('rejects unsupported numeric notation %#', s => expect(numericStatus(s)).toBe('invalid'));
  it('does not lose decimal precision during base validity checking', () => { expect(microUnits('999999999999999999.999999')).toBe(999999999999999999999999n); expect(microUnits('-0.000001')).toBe(-1n); });
  it('requires explicit unit and column; no automatic guessing', () => { expect(inspectConditions(table, emptyDraft()).issues).toHaveLength(2); expect(inspectConditions(table, emptyDraft()).current.used).toBe(0); });
  it('uses exact AND filtering over all rows', () => {
    expect(matching(table, [{ column: '지역', value: 'A' }, { column: '연도', value: '2024' }]).map(r => r.index)).toEqual([2]);
    expect(matching(parseCsv('코드\n001\n1'), [{ column: '코드', value: '1' }]).map(r => r.index)).toEqual([2]);
  });
  it('allows explicit sum/mean conditions and creates the core spec shape', () => {
    const d = { ...draft(), operation: 'mean' as const };
    expect(inspectConditions(table, d).issues).toEqual([]);
    expect(calculationSpec(d)).toEqual({ operation: 'mean', column: '인원', filters: {}, reference_filters: null, group_by: null, aggregation: null, missing_policy: 'reject' });
  });
  it('requires disjoint comparison and a strictly positive base', () => {
    const d: Draft = { ...draft(), operation: 'percent_change', filters: [{ column: '연도', value: '2024' }], reference: [{ column: '연도', value: '2023' }] };
    expect(inspectConditions(table, d).issues).toEqual([]);
    expect(inspectConditions(table, { ...d, reference: [] }).issues.some(s => s.includes('기준 범위'))).toBe(true);
    expect(inspectConditions(table, { ...d, reference: d.filters }).issues.some(s => s.includes('겹칩니다'))).toBe(true);
    for (const t of ['0', '-1']) expect(inspectConditions(parseCsv(`지역,연도,인원\nA,2023,${t}\nA,2024,1`), d).issues.some(s => s.includes('0보다'))).toBe(true);
  });
  it('handles missing and invalid numbers differently and checks unseen preview rows', () => {
    const t = parseCsv('지역,연도,인원\nA,2023,\nA,2024,10\nB,2024,abc');
    expect(inspectConditions(t, { ...draft(), missing: 'omit' }).issues.some(s => s.includes('숫자로 읽을 수 없는'))).toBe(true);
    const selected = { ...draft(), filters: [{ column: '지역', value: 'A' }] };
    expect(inspectConditions(t, selected).issues.some(s => s.includes('빈 숫자'))).toBe(true);
    expect(inspectConditions(t, { ...selected, missing: 'omit' }).issues).toEqual([]);
    expect(inspectConditions(t, { ...selected, missing: 'omit' }).current).toMatchObject({ used: 1, missing: 1, invalid: 0 });
    expect(inspectConditions(parseCsv('인원\n' + '1\n'.repeat(10) + 'abc'), draft()).issues.length).toBeGreaterThan(0);
  });
  it('rejects no-match, invalid/duplicate filters and metadata mistakes', () => {
    expect(inspectConditions(table, { ...draft(), filters: [{ column: '지역', value: 'C' }] }).issues.some(s => s.includes('행이 없습니다'))).toBe(true);
    expect(inspectConditions(table, { ...draft(), filters: [{ column: '잘못된 열', value: 'A' }] }).issues.length).toBeGreaterThan(0);
    expect(inspectConditions(table, { ...draft(), filters: [{ column: '지역', value: 'A' }, { column: '지역', value: 'B' }] }).issues.length).toBeGreaterThan(0);
    expect(inspectConditions(table, { ...draft(), unit: 'x'.repeat(33) }).issues.length).toBeGreaterThan(0);
    expect(inspectConditions(table, { ...draft(), operation: 'toString' as Draft['operation'] }).issues.length).toBeGreaterThan(0);
  });
});
