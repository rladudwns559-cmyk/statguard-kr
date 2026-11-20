import { calculationEndpoint, calculationClientHeader, cloudCalculation, CalculationError, localCalculationAvailable, type CalculationRequest, type EngineResult } from './calculationClient';
export type ComparisonRequest = { mode:'compare'; request_id:string; calculation:CalculationRequest; expected_dataset_version:string; expected_calculation_id:string; claim_value:string; claim_unit:string; tolerance_absolute:string };
export type Comparison = { display_status:'EXACT_MATCH'|'WITHIN_TOLERANCE'|'MISMATCH'; claim_value:string; computed_value:string; claim_unit:string; tolerance_absolute:string; difference:{signed:string;absolute:string;direction:'HIGHER'|'LOWER'|'EQUAL';unit:string}; verification:{status:string;reason_code:string;warnings:string[]} };
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const decimal=(v:unknown):v is string=>typeof v==='string'&&v.length<=128&&/^-?\d+(?:\.\d+)?$/.test(v);
const messages:Record<string,string>={
  CALCULATION_LINKAGE_MISMATCH:'현재 계산과 비교 대상을 연결할 수 없습니다. 자료와 조건을 다시 확인해 계산하세요.',
  UNIT_NOT_CONFIRMED_OR_MISMATCH:'입력 수치와 계산 결과의 단위가 달라 비교하지 않았습니다.',
  INVALID_NUMERIC_VALUE:'일반 숫자로 입력해 주세요. 수식·단위 기호·지수 표기는 지원하지 않습니다.',
  NUMERIC_PRECISION_LIMIT:'입력은 정수부 18자리, 소수부 6자리 이내로 작성해 주세요.',
  INVALID_TOLERANCE:'허용 차이는 0 이상, 1,000,000,000,000,000,000 이하로 입력해 주세요.',
  SOURCE_MISMATCH:'확인한 CSV가 달라졌습니다. 다시 계산한 뒤 비교해 주세요.',
  PREVIEW_INTERPRETATION_MISMATCH:'CSV 해석이 달라 비교를 중단했습니다. 다시 계산해 주세요.',
  ENGINE_TIMEOUT:'비교 시간이 초과되었습니다. 자동 재시도하지 않았습니다.',
  ENGINE_BUSY:'다른 작업이 진행 중입니다. 잠시 후 직접 다시 비교해 주세요.',
};
export function validateComparison(payload:unknown,request:ComparisonRequest,result:EngineResult):Comparison {
  const fail=()=>{throw new CalculationError('비교 결과가 현재 계산·입력값과 연결되지 않아 표시하지 않았습니다.');};
  if(!obj(payload)||payload.ok!==true||payload.bridge_version!=='statguard-local-calculation-v0.1'||payload.comparison_version!=='statguard-manual-comparison-v0.1'||payload.request_id!==request.request_id||payload.dataset_version!==result.dataset_version||payload.calculation_id!==result.calculation_id||payload.source_sha256!==result.source_sha256||payload.claim_input!==request.claim_value||payload.tolerance_input!==request.tolerance_absolute||payload.claim_unit!==result.unit||payload.computed_value!==result.value)return fail();
  if(!['EXACT_MATCH','WITHIN_TOLERANCE','MISMATCH'].includes(String(payload.display_status))||!decimal(payload.claim_value)||!decimal(payload.tolerance_absolute)||payload.tolerance_absolute.startsWith('-')||!obj(payload.difference)||!obj(payload.verification))return fail();
  const d=payload.difference,v=payload.verification;
  if(!decimal(d.signed)||!decimal(d.absolute)||d.absolute.startsWith('-')||!['HIGHER','LOWER','EQUAL'].includes(String(d.direction))||d.unit!==(result.unit==='%'?'%p':result.unit))return fail();
  const exact=payload.display_status==='EXACT_MATCH', mismatch=payload.display_status==='MISMATCH';
  if(v.dataset_version!==result.dataset_version||v.calculation_id!==result.calculation_id||v.status!==(mismatch?'CONTRADICTED':'VERIFIED_WITHIN_SCOPE')||v.reason_code!==(mismatch?'NUMERIC_VALUE_CONFLICT':'WITHIN_EXPLICIT_TOLERANCE')||v.claimed_value!==payload.claim_value||v.computed_value!==result.value||v.unit!==result.unit||v.absolute_tolerance!==payload.tolerance_absolute||v.relative_tolerance!=='0'||v.scope!=='EXPLICIT_CALCULATION_ONLY_NOT_WHOLE_ANSWER_TRUTH')return fail();
  if(exact ? d.absolute!=='0'||d.signed!=='0'||d.direction!=='EQUAL' : d.absolute==='0'||d.direction==='EQUAL')return fail();
  if(d.direction==='HIGHER'&&d.signed.startsWith('-')||d.direction==='LOWER'&&!d.signed.startsWith('-'))return fail();
  if(!Array.isArray(v.warnings)||JSON.stringify(v.warnings)!==JSON.stringify(result.warnings))return fail();
  return payload as unknown as Comparison;
}
export async function compareLocal(request:ComparisonRequest,result:EngineResult,signal:AbortSignal):Promise<Comparison>{
  if(!localCalculationAvailable())throw new CalculationError('이 주소에서는 수치 비교 엔진을 사용할 수 없습니다.');
  const response=await fetch(calculationEndpoint(),{method:'POST',headers:{'Content-Type':'application/json','X-StatGuard-Client':calculationClientHeader()},body:JSON.stringify(request),cache:'no-store',credentials:'omit',redirect:'error',signal});
  let payload:unknown;try{payload=await response.json();}catch{throw new CalculationError(cloudCalculation()?'수치 비교 엔진에 연결하지 못했습니다.':'로컬 비교 엔진에 연결하지 못했습니다.');}
  if(!response.ok||!obj(payload)||payload.ok!==true){const code=obj(payload)&&obj(payload.error)&&typeof payload.error.code==='string'?payload.error.code:'';throw new CalculationError(messages[code]||'비교를 완료하지 못했습니다. 연결 상태와 입력값을 확인해 주세요.');}
  return validateComparison(payload,request,result);
}
