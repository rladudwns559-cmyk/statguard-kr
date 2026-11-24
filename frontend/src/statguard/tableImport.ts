/**
 * Excel (.xlsx) and pasted tables → CSV text, entirely in the browser (no library, nothing uploaded).
 * The result goes through the same CSV path as an uploaded CSV, so the engine still re-checks every byte.
 *
 * .xlsx: the first worksheet only. Shared/inline strings, numbers, booleans; date-formatted numbers become
 * YYYY-MM-DD (or YYYY-MM-DD HH:MM); float noise (0.30000000000000004) is rounded to 15 significant digits.
 */
import { CsvError } from './csv';

export const XLSX_MAX_BYTES = 5 * 1_048_576;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new CsvError('이 브라우저는 엑셀 파일을 읽을 수 없습니다. 엑셀에서 CSV로 저장한 뒤 선택해 주세요.');
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal ZIP reader: central directory → entry bytes (stored or deflated). */
export async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buffer), out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new CsvError('엑셀 파일 형식을 읽을 수 없습니다. .xlsx 파일인지 확인해 주세요.');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new CsvError('엑셀 파일이 손상되었습니다.');
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32), local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!wanted(name)) continue;
    if (u32(b, local) !== 0x04034b50) throw new CsvError('엑셀 파일이 손상되었습니다.');
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28), raw = b.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new CsvError('지원하지 않는 압축 방식의 엑셀 파일입니다.');
  }
  return out;
}

const xml = (bytes: Uint8Array | undefined) => (bytes ? new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml') : null);
const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));
const textOf = (node: Element) => byTag(node, 't').map(t => t.textContent ?? '').join('');

const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function isDateFormat(code: string): boolean {
  const plain = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[yd]/i.test(plain) || /h.*m|m.*s/i.test(plain);
}

/** Excel serial date → "YYYY-MM-DD" or "YYYY-MM-DD HH:MM". */
export function excelDate(serial: number, date1904 = false): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}

export function cleanNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const s = String(Number(n.toPrecision(15)));
  return /e/i.test(s) ? v : s;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  return [...letters].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Drop fully empty rows, pad to the widest row, trim header names (Excel headers often carry stray spaces). */
function tidy(grid: string[][]): string[][] {
  const rows = grid.filter(r => r.some(c => c.trim() !== ''));
  if (!rows.length) throw new CsvError('표에 데이터가 없습니다.');
  let width = Math.max(...rows.map(r => r.length));
  while (width > 0 && rows.every(r => (r[width - 1] ?? '').trim() === '')) width--;
  const out = rows.map(r => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  out[0] = out[0].map(c => c.trim());
  return out;
}

export type XlsxResult = { csv: string; sheet: string; sheets: number };

export async function xlsxToCsv(buffer: ArrayBuffer): Promise<XlsxResult> {
  if (buffer.byteLength > XLSX_MAX_BYTES) throw new CsvError('엑셀 파일은 최대 5 MiB까지 지원합니다.');
  const files = await unzip(buffer, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || n.startsWith('xl/worksheets/'));
  const workbook = xml(files.get('xl/workbook.xml')), rels = xml(files.get('xl/_rels/workbook.xml.rels'));
  if (!workbook) throw new CsvError('엑셀 파일 형식을 읽을 수 없습니다. .xlsx 파일인지 확인해 주세요.');
  const sheets = byTag(workbook, 'sheet');
  const first = sheets[0];
  if (!first) throw new CsvError('엑셀 파일에 시트가 없습니다.');
  const rid = first.getAttribute('r:id') ?? first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = rels ? byTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid)?.getAttribute('Target') : null;
  const path = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
  const sheet = xml(files.get(path));
  if (!sheet) throw new CsvError('엑셀의 첫 번째 시트를 읽을 수 없습니다.');
  const date1904 = byTag(workbook, 'workbookPr')[0]?.getAttribute('date1904') === '1' || byTag(workbook, 'workbookPr')[0]?.getAttribute('date1904') === 'true';
  const shared = (() => { const doc = xml(files.get('xl/sharedStrings.xml')); return doc ? byTag(doc, 'si').map(textOf) : []; })();
  const dateStyles = (() => {
    const doc = xml(files.get('xl/styles.xml'));
    if (!doc) return [] as boolean[];
    const custom = new Map(byTag(doc, 'numFmt').map(f => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
    const xfs = byTag(doc, 'cellXfs')[0];
    return xfs ? byTag(xfs, 'xf').map(xf => { const id = Number(xf.getAttribute('numFmtId') ?? 0); return DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!)); }) : [];
  })();
  const grid: string[][] = [];
  for (const row of byTag(sheet, 'row')) {
    const r = Number(row.getAttribute('r') ?? grid.length + 1) - 1;
    if (r > 10_001) throw new CsvError('데이터는 최대 10,000행까지 지원합니다.');
    const cells: string[] = [];
    for (const c of byTag(row, 'c')) {
      const col = columnIndex(c.getAttribute('r') ?? '');
      if (col < 0 || col >= 64) { if (col >= 64) throw new CsvError('열은 최대 64개까지 지원합니다.'); continue; }
      const type = c.getAttribute('t'), v = byTag(c, 'v')[0]?.textContent ?? '';
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = byTag(c, 'is')[0] ? textOf(byTag(c, 'is')[0]) : '';
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str') value = v;
      else if (type === 'e') value = '';
      else if (v !== '') value = dateStyles[Number(c.getAttribute('s') ?? 0)] ? excelDate(Number(v), date1904) : cleanNumber(v);
      cells[col] = value;
    }
    grid[r] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
  }
  return { csv: toCsv(tidy(Array.from(grid, r => r ?? []))), sheet: first.getAttribute('name') ?? '', sheets: sheets.length };
}

/** A table copied from Excel / Google Sheets (tab-separated) or typed as CSV → CSV text. */
export function pastedToCsv(text: string): string {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) throw new CsvError('붙여 넣은 표가 비어 있습니다.');
  if (!lines.some(l => l.includes('\t'))) return lines.join('\r\n') + '\r\n';  // already comma-separated
  return toCsv(tidy(lines.map(l => l.split('\t'))));
}
