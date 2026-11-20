import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import ManualComparison from '../statguard/ManualComparison';
import { compareLocal, validateComparison, type ComparisonRequest } from '../statguard/comparisonClient';
import type { CalculationRequest, EngineResult } from '../statguard/calculationClient';

const calculation:CalculationRequest={mode:'calculate',request_id:'11111111-1111-4111-8111-111111111111',csv_base64:'',source_sha256:'a'.repeat(64),preview_sha256:'d'.repeat(64),encoding:'utf-8-sig',units:{수치:'명'},spec:{operation:'percent_change',column:'수치',filters:{연도:'2024'},reference_filters:{연도:'2023'},group_by:null,aggregation:null,missing_policy:'reject'}};
const result:EngineResult={contract_version:'statguard-calculation-v0.1',dataset_id:'local-upload',dataset_version:'b'.repeat(64),source_sha256:calculation.source_sha256,calculation_id:'c'.repeat(64),spec:calculation.spec,value:'17.8',unit:'%',expression:'(1178 - 1000) / 1000 * 100',usage:{selected_rows:[2],used_rows:[2],omitted_rows:[],filtered_out_count:1},reference_usage:{selected_rows:[1],used_rows:[1],omitted_rows:[],filtered_out_count:1},warnings:[],precision:34,rounding:'ROUND_HALF_EVEN',unit_provenance:'CALLER_ASSERTED_NOT_INFERRED'};
const request=(value='23',tolerance='0'):ComparisonRequest=>({mode:'compare',request_id:'22222222-2222-4222-8222-222222222222',calculation,expected_dataset_version:result.dataset_version,expected_calculation_id:result.calculation_id,claim_value:value,claim_unit:result.unit,tolerance_absolute:tolerance});
// Fixed synthetic responses test rendering/linkage; actual arithmetic is tested in Python and browser QA.
function response(req:ComparisonRequest){
  const exact=req.claim_value==='17.8',within=req.claim_value==='17.9'&&req.tolerance_absolute==='0.1';
  const absolute=exact?'0':within?'0.1':'5.2';
  return {ok:true,bridge_version:'statguard-local-calculation-v0.1',comparison_version:'statguard-manual-comparison-v0.1',request_id:req.request_id,source_sha256:result.source_sha256,dataset_version:result.dataset_version,calculation_id:result.calculation_id,claim_input:req.claim_value,tolerance_input:req.tolerance_absolute,claim_value:req.claim_value,claim_unit:'%',computed_value:'17.8',tolerance_absolute:req.tolerance_absolute,display_status:exact?'EXACT_MATCH':within?'WITHIN_TOLERANCE':'MISMATCH',difference:{signed:absolute,absolute,direction:exact?'EQUAL':'HIGHER',unit:'%p'},verification:{status:exact||within?'VERIFIED_WITHIN_SCOPE':'CONTRADICTED',reason_code:exact||within?'WITHIN_EXPLICIT_TOLERANCE':'NUMERIC_VALUE_CONFLICT',dataset_version:result.dataset_version,calculation_id:result.calculation_id,computed_value:'17.8',claimed_value:req.claim_value,unit:'%',absolute_tolerance:req.tolerance_absolute,relative_tolerance:'0',scope:'EXPLICIT_CALCULATION_ONLY_NOT_WHOLE_ANSWER_TRUTH',warnings:[]}};
}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);window.history.replaceState(null,'','/statguard');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function success(){return vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>json(response(JSON.parse(String(init?.body)))));}
function show(){return render(<ManualComparison calculation={calculation} result={result}/>);}
async function input(value='23'){await userEvent.type(screen.getByLabelText('비교할 수치 (%)'),value);}
describe('manual numeric comparison',()=>{
  it('does not send anything until a valid value is explicitly submitted',async()=>{
    const fetch=success();show();expect(screen.getByRole('button',{name:'수치 비교'})).toBeDisabled();await input();expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));expect(await screen.findByRole('status',{name:'수치 비교 결과'})).toHaveTextContent('불일치');
    expect(fetch).toHaveBeenCalledWith('/__statguard/calculate',expect.objectContaining({cache:'no-store',credentials:'omit'}));
    const sent=JSON.parse(String(fetch.mock.calls[0][1]?.body));expect(sent).toMatchObject({mode:'compare',calculation,expected_calculation_id:result.calculation_id,expected_dataset_version:result.dataset_version,claim_value:'23',claim_unit:'%',tolerance_absolute:'0'});
  });
  it('shows a percentage-point difference and direction without calling it relative percent',async()=>{
    success();show();await input();await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));
    const output=await screen.findByRole('status',{name:'수치 비교 결과'});expect(output).toHaveTextContent('5.2 퍼센트포인트 높습니다.');expect(output).toHaveTextContent('상대적인 증가·감소율을 뜻하지 않습니다');
  });
  it('distinguishes exact match from tolerance-based agreement',async()=>{
    success();show();await input('17.8');await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));expect(await screen.findByRole('status',{name:'수치 비교 결과'})).toHaveTextContent('정확히 일치');
    fireEvent.change(screen.getByLabelText('비교할 수치 (%)'),{target:{value:'17.9'}});await userEvent.click(screen.getByText(/허용 차이 설정/));fireEvent.change(screen.getByLabelText('허용 차이 (절대값)'),{target:{value:'0.1'}});
    await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));expect(await screen.findByRole('status',{name:'수치 비교 결과'})).toHaveTextContent('허용 차이 이내');expect(screen.getByRole('status',{name:'수치 비교 결과'})).toHaveTextContent('정확히 같은 값은 아니며');
  });
  it('clears a previous verdict whenever the value or tolerance changes',async()=>{
    success();show();await input();await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));await screen.findByRole('status',{name:'수치 비교 결과'});
    fireEvent.change(screen.getByLabelText('비교할 수치 (%)'),{target:{value:'17.8'}});expect(screen.queryByRole('status',{name:'수치 비교 결과'})).toBeNull();
    await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));await screen.findByRole('status',{name:'수치 비교 결과'});fireEvent.change(screen.getByLabelText('허용 차이 (절대값)'),{target:{value:'0.1'}});expect(screen.queryByRole('status',{name:'수치 비교 결과'})).toBeNull();
  });
  it('never restores a late response for an old edited value',async()=>{
    let finish:(r:Response)=>void=()=>{};let old=request();vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>{old=JSON.parse(String(init?.body));return new Promise(resolve=>{finish=resolve;});});
    show();await input();await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));fireEvent.change(screen.getByLabelText('비교할 수치 (%)'),{target:{value:'17.8'}});await act(async()=>finish(json(response(old))));expect(screen.queryByRole('status',{name:'수치 비교 결과'})).toBeNull();
  });
  it('aborts pending work on unmount',async()=>{
    let signal:AbortSignal|null|undefined;vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>{signal=init?.signal;return new Promise(()=>{});});const view=show();await input();await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));view.unmount();expect(signal?.aborted).toBe(true);
  });
  it.each(['23%','=2+2','1e3','NaN','0.0000001'])('blocks unsupported input %# without a request',value=>{
    const fetch=success();show();fireEvent.change(screen.getByLabelText('비교할 수치 (%)'),{target:{value}});expect(screen.getByRole('button',{name:'수치 비교'})).toBeDisabled();expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects negative tolerance and keeps a unit fixed to the calculation',async()=>{
    const fetch=success();show();await input();fireEvent.change(screen.getByLabelText('허용 차이 (절대값)'),{target:{value:'-1'}});expect(screen.getByRole('button',{name:'수치 비교'})).toBeDisabled();expect(screen.queryByRole('combobox')).toBeNull();expect(fetch).not.toHaveBeenCalled();
  });
  it('shows bounded errors without server detail or automatic retries',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({ok:false,error:{code:'CALCULATION_LINKAGE_MISMATCH',detail:'UNTRUSTED_DETAIL'}},422));show();await input();await userEvent.click(screen.getByRole('button',{name:'수치 비교'}));expect(await screen.findByRole('alert')).toHaveTextContent('현재 계산과 비교 대상을 연결');expect(screen.queryByText('UNTRUSTED_DETAIL')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('ends a stalled comparison with an explicit timeout',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})));
    show();await input();vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'수치 비교'}));await act(async()=>{await vi.advanceTimersByTimeAsync(12001);});expect(screen.getByRole('alert')).toHaveTextContent('비교 시간이 초과');expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe('manual response linkage',()=>{
  it('accepts a linked response',()=>expect(validateComparison(response(request()),request(),result).difference.absolute).toBe('5.2'));
  it.each(['source','dataset','calculation','request','input','tolerance','unit','computed','differenceUnit','status','direction','scope','warning'])('rejects stale or inconsistent %s',kind=>{
    const p=response(request());
    if(kind==='source')p.source_sha256='x';if(kind==='dataset')p.dataset_version='x';if(kind==='calculation')p.calculation_id='x';if(kind==='request')p.request_id='x';if(kind==='input')p.claim_input='20';if(kind==='tolerance')p.tolerance_input='1';if(kind==='unit')p.claim_unit='명';if(kind==='computed')p.computed_value='23';if(kind==='differenceUnit')p.difference.unit='%';if(kind==='status')p.display_status='EXACT_MATCH';if(kind==='direction')p.difference.direction='LOWER';if(kind==='scope')p.verification.scope='WHOLE_ANSWER';if(kind==='warning')p.verification.warnings=['OTHER'] as never[];
    expect(()=>validateComparison(p,request(),result)).toThrow();
  });
  it('does not echo arbitrary HTML on a missing local bridge',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('<html>UNTRUSTED</html>',{status:404}));await expect(compareLocal(request(),result,new AbortController().signal)).rejects.toThrow('로컬 비교 엔진');});
});
