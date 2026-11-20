import { microUnits, numericStatus, type CsvTable } from './csv';
export const OPERATIONS = { sum: '합계', mean: '평균', percent_change: '증감률' } as const;
export type Filter = { column: string; value: string };
export type Draft = { operation: keyof typeof OPERATIONS; column: string; unit: string; filters: Filter[]; reference: Filter[]; missing: 'reject' | 'omit' };
export const emptyDraft = (): Draft => ({ operation: 'sum', column: '', unit: '', filters: [], reference: [], missing: 'reject' });
export function matching(table: CsvTable, filters: Filter[]) {
  return table.rows.map((row, i) => ({ row, index: i + 1 })).filter(({ row }) => filters.every(f => row[table.columns.indexOf(f.column)] === f.value));
}
export function inspectConditions(table: CsvTable, draft: Draft) {
  const issues: string[] = [];
  if (!Object.hasOwn(OPERATIONS, draft.operation)) issues.push('지원하는 계산 종류를 선택해 주세요.');
  const column = table.columns.indexOf(draft.column);
  if (column < 0) issues.push('계산할 숫자 열을 선택해 주세요.');
  if (!draft.unit.trim() || [...draft.unit].length > 32 || /[\x00-\x1f]/.test(draft.unit)) issues.push('자료에서 확인한 단위를 1~32자로 입력해 주세요.');
  for (const filters of [draft.filters, ...(draft.operation === 'percent_change' ? [draft.reference] : [])]) {
    if (filters.length > 4 || new Set(filters.map(f => f.column)).size !== filters.length) issues.push('조건은 서로 다른 열로 최대 4개까지 지정해 주세요.');
    if (filters.some(f => !table.columns.includes(f.column))) issues.push('조건의 열을 모두 선택해 주세요.');
  }
  if (draft.operation === 'percent_change' && !draft.reference.length) issues.push('증감률은 기준 범위를 하나 이상 지정해 주세요.');
  if (!['reject', 'omit'].includes(draft.missing)) issues.push('누락값 처리 방식을 선택해 주세요.');
  const selected = matching(table, draft.filters);
  const reference = draft.operation === 'percent_change' ? matching(table, draft.reference) : [];
  function profile(rows: typeof selected, name: string) {
    const missingRows = rows.filter(r => column >= 0 && numericStatus(r.row[column]) === 'missing').map(r => r.index);
    const missing = missingRows.length;
    const invalidRows = rows.filter(r => column >= 0 && numericStatus(r.row[column]) === 'invalid').map(r => r.index);
    const invalid = invalidRows.length;
    const locations = (ids: number[]) => `해당 데이터 행: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` 외 ${ids.length - 5}행` : ''}.`;
    if (!rows.length) issues.push(`${name}에 해당하는 행이 없습니다.`);
    if (column >= 0) {
      if (invalid) issues.push(`${name}에 숫자로 읽을 수 없는 값이 ${invalid}개 있습니다. ${locations(invalidRows)} 수식·단위 접미사·지수 표기는 지원하지 않습니다.`);
      if (missing && draft.missing === 'reject') issues.push(`${name}에 빈 숫자 값이 ${missing}개 있습니다. ${locations(missingRows)} 자료를 수정하거나 제외 정책을 명시해 주세요.`);
      if (rows.length && missing === rows.length) issues.push(`${name}에 사용할 숫자가 없습니다.`);
    }
    return { selected: rows.length, used: column < 0 ? 0 : rows.length - missing - invalid, missing, invalid, missingRows, invalidRows, rowNumbers: rows.map(r => r.index) };
  }
  const current = profile(selected, '선택 범위');
  const base = draft.operation === 'percent_change' ? profile(reference, '기준 범위') : null;
  if (base && column >= 0) {
    const ids = new Set(selected.map(r => r.index));
    if (reference.some(r => ids.has(r.index))) issues.push('증감률의 선택 범위와 기준 범위가 겹칩니다. 서로 다른 행을 지정해 주세요.');
    if (!base.invalid && reference.length && reference.reduce((s, r) => numericStatus(r.row[column]) === 'number' ? s + microUnits(r.row[column]) : s, 0n) <= 0n)
      issues.push('증감률의 기준 합계는 0보다 커야 합니다. 0 또는 음수인 기준은 지원하지 않습니다.');
  }
  return { issues: [...new Set(issues)], current, base };
}

export function calculationSpec(draft: Draft) {
  const filters = (rows: Filter[]) => Object.fromEntries(rows.map(f => [f.column, f.value]));
  return { operation: draft.operation, column: draft.column, filters: filters(draft.filters), reference_filters: draft.operation === 'percent_change' ? filters(draft.reference) : null, group_by: null, aggregation: null, missing_policy: draft.missing };
}
