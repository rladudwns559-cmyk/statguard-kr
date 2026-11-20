import type { CsvTable } from './csv';
import type { calculationSpec } from './conditions';
export type Spec = ReturnType<typeof calculationSpec>;
export type Usage = { selected_rows: number[]; used_rows: number[]; omitted_rows: number[]; filtered_out_count: number };
export type EngineResult = {
  contract_version: string; dataset_id: string; dataset_version: string; source_sha256: string; calculation_id: string;
  spec: Spec; value: string; unit: string; expression: string; usage: Usage; reference_usage: Usage | null;
  warnings: string[]; precision: number; rounding: string; unit_provenance: string;
};
export type CalculationRequest = { mode: 'calculate'; request_id: string; csv_base64: string; source_sha256: string; preview_sha256: string; encoding: 'utf-8-sig' | 'cp949'; units: Record<string,string>; spec: Spec };
const MESSAGES: Record<string,string> = {
  SOURCE_MISMATCH: '확인한 CSV와 계산에 전달된 파일이 다릅니다. 자료를 다시 선택해 주세요.',
  PREVIEW_INTERPRETATION_MISMATCH: '미리보기와 계산 엔진의 CSV 해석이 다릅니다. UTF-8 CSV로 다시 저장한 뒤 확인해 주세요.',
  MISSING_NUMERIC_VALUE: '선택 범위에 빈 숫자 값이 있습니다. 빈 값 처리 조건을 다시 확인해 주세요.',
  INVALID_NUMERIC_VALUE: '계산 범위에 지원하지 않는 숫자 형식이 있습니다.',
  NUMERIC_PRECISION_LIMIT: '숫자 크기 또는 소수 자릿수가 지원 범위를 넘었습니다.',
  EMPTY_SELECTION: '조건을 만족하는 행이 없습니다.', NO_NUMERIC_ROWS: '계산할 숫자 행이 없습니다.',
  NON_POSITIVE_BASELINE: '증감률의 기준 합계는 0보다 커야 합니다.', OVERLAPPING_COMPARISON: '선택 범위와 기준 범위가 겹칩니다.',
  ENGINE_TIMEOUT: '계산 시간이 초과되었습니다. 자동으로 다시 실행하지 않았습니다.',
  ENGINE_BUSY: '다른 계산이 진행 중입니다. 잠시 뒤 직접 다시 실행해 주세요.',
  ENGINE_UNAVAILABLE: '계산 엔진에 연결할 수 없습니다. 잠시 뒤 직접 다시 시도해 주세요.',
  CSV_DECODE_FAILED: '계산 엔진이 한글 인코딩을 읽지 못했습니다. UTF-8로 저장해 다시 선택해 주세요.',
  LOCAL_ORIGIN_REQUIRED: '로컬 계산 화면에서 다시 실행해 주세요.',
};
export class CalculationError extends Error {}
export const cloudCalculation = () => location.protocol === 'https:' && !['127.0.0.1','localhost','[::1]'].includes(location.hostname);
export const localCalculationAvailable = () => cloudCalculation() || location.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(location.hostname);
export const calculationEndpoint = () => cloudCalculation() ? '/api/statguard' : '/__statguard/calculate';
export const calculationClientHeader = () => cloudCalculation() ? 'cloud-v0.1' : 'local-v0.1';
export function base64Bytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes); let text = '';
  for (let i = 0; i < view.length; i += 8192) text += String.fromCharCode(...view.subarray(i,i+8192));
  return btoa(text);
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export const previewHash = (table: CsvTable) => sha256(new TextEncoder().encode(JSON.stringify([table.columns,table.rows])).buffer as ArrayBuffer);
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown,b: unknown) => {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])) : v;
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
};
function validUsage(value: unknown, total: number): value is Usage {
  if (!object(value)) return false;
  const rows = (a: unknown): a is number[] => Array.isArray(a) && a.length<=total && a.every((v,i)=>Number.isInteger(v)&&v>=1&&v<=total&&(i===0||v>a[i-1]));
  if(!rows(value.selected_rows)||!rows(value.used_rows)||!rows(value.omitted_rows)||!Number.isInteger(value.filtered_out_count))return false;
  const selected=new Set(value.selected_rows), used=new Set(value.used_rows);
  return value.used_rows.length>0 && value.filtered_out_count===total-selected.size && value.used_rows.every(i=>selected.has(i)) && value.omitted_rows.every(i=>selected.has(i)&&!used.has(i)) && used.size+value.omitted_rows.length===selected.size;
}
export function validateResponse(payload: unknown, request: CalculationRequest, total: number): EngineResult {
  const fail = () => { throw new CalculationError('결과가 현재 자료·계산 조건과 연결되는지 확인할 수 없어 표시하지 않았습니다.'); };
  if (!object(payload)||payload.ok!==true||payload.request_id!==request.request_id||payload.preview_sha256!==request.preview_sha256||payload.bridge_version!=='statguard-local-calculation-v0.1'||!object(payload.result))return fail();
  const r=payload.result;
  if(r.contract_version!=='statguard-calculation-v0.1'||r.dataset_id!=='local-upload'||r.source_sha256!==request.source_sha256||!same(r.spec,request.spec)||!Array.isArray(r.groups)||r.groups.length||!validUsage(r.usage,total))return fail();
  if(!['dataset_version','calculation_id'].every(k=>typeof r[k]==='string'&&/^[0-9a-f]{64}$/.test(r[k] as string))||typeof r.value!=='string'||r.value.length>128||!(/^-?\d+(?:\.\d+)?$/).test(r.value)||typeof r.expression!=='string'||r.expression.length>2048)return fail();
  if(r.unit!==(request.spec.operation==='percent_change'?'%':request.units[request.spec.column])||r.precision!==34||r.rounding!=='ROUND_HALF_EVEN'||r.unit_provenance!=='CALLER_ASSERTED_NOT_INFERRED')return fail();
  if(!Array.isArray(r.warnings)||!r.warnings.every(v=>['NUMERIC_ROWS_OMITTED','REFERENCE_NUMERIC_ROWS_OMITTED'].includes(String(v))))return fail();
  if(request.spec.operation==='percent_change') {
    if(!validUsage(r.reference_usage,total))return fail();
    const ids=new Set((r.usage as Usage).selected_rows);if(r.reference_usage.selected_rows.some(i=>ids.has(i)))return fail();
  } else if(r.reference_usage!==null)return fail();
  return r as unknown as EngineResult;
}

export async function calculateLocal(request: CalculationRequest, total: number, signal: AbortSignal): Promise<EngineResult> {
  if(!localCalculationAvailable())throw new CalculationError(MESSAGES.ENGINE_UNAVAILABLE);
  const response=await fetch(calculationEndpoint(),{method:'POST',headers:{'Content-Type':'application/json','X-StatGuard-Client':calculationClientHeader()},body:JSON.stringify(request),cache:'no-store',credentials:'omit',redirect:'error',signal});
  let payload: unknown;
  try { payload=await response.json(); } catch { throw new CalculationError(MESSAGES.ENGINE_UNAVAILABLE); }
  if(!response.ok||!object(payload)||payload.ok!==true){
    const code=object(payload)&&object(payload.error)&&typeof payload.error.code==='string'?payload.error.code:'';
    throw new CalculationError(MESSAGES[code] || '계산을 완료하지 못했습니다. CSV와 조건을 다시 확인해 주세요.');
  }
  return validateResponse(payload,request,total);
}
