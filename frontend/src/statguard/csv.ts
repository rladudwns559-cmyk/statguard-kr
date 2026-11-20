/** Browser-only preview adapter. Never uploads, evaluates, or persists cells. */
export const LIMITS = { bytes: 1_048_576, rows: 10_000, columns: 64, cell: 512 } as const;
export type Encoding = 'auto' | 'utf-8' | 'euc-kr';
export type CsvTable = { columns: string[]; rows: string[][]; encoding: string };
export class CsvError extends Error {}
const length = (s: string) => [...s].length;

export function parseCsv(text: string, encoding = 'UTF-8'): CsvTable {
  text = text.replace(/^\uFEFF/, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new CsvError('읽을 수 없는 제어 문자가 있습니다.');
  const records: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false, started = false;
  const field = () => {
    if (length(cell) > LIMITS.cell) throw new CsvError('한 셀은 최대 512자까지 지원합니다.');
    row.push(cell); cell = ''; closed = false;
    if (row.length > LIMITS.columns) throw new CsvError('열은 최대 64개까지 지원합니다.');
  };
  const record = () => {
    if (!started && !row.length && !cell && !closed) throw new CsvError('빈 줄이 있습니다. 빈 줄을 제거한 CSV를 선택해 주세요.');
    field(); records.push(row); row = []; started = false;
    if (records.length > LIMITS.rows + 1) throw new CsvError('데이터는 최대 10,000행까지 지원합니다.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else cell += c;
    } else if (c === ',') { field(); started = true; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; record(); }
    else if (c === '"' && !cell && !closed) { quoted = true; started = true; }
    else { if (closed || c === '"') throw new CsvError('따옴표 형식을 확인해 주세요.'); cell += c; started = true; }
  }
  if (quoted) throw new CsvError('닫히지 않은 따옴표가 있습니다.');
  if (started || row.length || cell || closed) record();
  const columns = records.shift();
  if (!columns?.length || columns.some(c => !c || c !== c.trim())) throw new CsvError('첫 행에 비어 있지 않은 열 이름이 필요합니다. 열 이름 양끝의 공백도 확인해 주세요.');
  if (new Set(columns).size !== columns.length) throw new CsvError('중복된 열 이름이 있습니다.');
  if (!records.length) throw new CsvError('열 이름 아래에 데이터가 한 행 이상 필요합니다.');
  if (records.some(r => r.length !== columns.length)) throw new CsvError('행마다 열 개수가 다릅니다. 빈 줄이나 쉼표를 확인해 주세요.');
  return { columns, rows: records, encoding };
}

export function decodeCsv(bytes: ArrayBuffer, encoding: Encoding): CsvTable {
  if (bytes.byteLength > LIMITS.bytes) throw new CsvError('파일은 최대 1 MiB까지 지원합니다.');
  if (!bytes.byteLength) throw new CsvError('빈 파일입니다.');
  for (const label of encoding === 'auto' ? ['utf-8', 'euc-kr'] : [encoding]) {
    let text: string;
    try { text = new TextDecoder(label, { fatal: true }).decode(bytes); }
    catch { continue; }
    return parseCsv(text, label === 'utf-8' ? 'UTF-8' : 'CP949 호환 (브라우저)');
  }
  throw new CsvError('문자 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949 CSV로 저장해 주세요.');
}

export function numericStatus(raw: string): 'number' | 'missing' | 'invalid' {
  const s = raw.trim(); if (!s) return 'missing';
  if (!/^[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?$/.test(s)) return 'invalid';
  const [integer, fraction = ''] = s.replace(/,/g, '').replace(/^[+-]/, '').split('.');
  return integer.length <= 18 && fraction.length <= 6 ? 'number' : 'invalid';
}

/** Exact micro-units only for denominator validity, never floating point. */
export function microUnits(raw: string): bigint {
  const clean = raw.trim().replace(/,/g, '');
  const negative = clean.startsWith('-');
  const [integer, fraction = ''] = clean.replace(/^[+-]/, '').split('.');
  return (negative ? -1n : 1n) * (BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, '0')));
}
