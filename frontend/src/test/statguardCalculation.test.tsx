import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import StatGuardWorkspace, { SAMPLE } from '../statguard/StatGuardWorkspace';
import CalculationResult from '../statguard/CalculationResult';
import { base64Bytes, calculateLocal, previewHash, validateResponse, type CalculationRequest } from '../statguard/calculationClient';
import { parseCsv } from '../statguard/csv';

const responseFor=(req: CalculationRequest, value='4938')=>({ok:true,bridge_version:'statguard-local-calculation-v0.1',request_id:req.request_id,preview_sha256:req.preview_sha256,result:{contract_version:'statguard-calculation-v0.1',dataset_id:'local-upload',dataset_version:'a'.repeat(64),source_sha256:req.source_sha256,calculation_id:'b'.repeat(64),spec:req.spec,value,unit:'명',expression:'sum(방문자수) = '+value,groups:[],usage:{selected_rows:[1,2,3,4,5,6],used_rows:[1,2,3,4,5,6],omitted_rows:[] as number[],filtered_out_count:0},reference_usage:null,warnings:[],precision:34,rounding:'ROUND_HALF_EVEN',unit_provenance:'CALLER_ASSERTED_NOT_INFERRED'}});
let requestSeen: CalculationRequest;
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);window.history.replaceState(null,'','/statguard');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
const json=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mockSuccess(){return vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{requestSeen=JSON.parse(String(init?.body));return json(responseFor(requestSeen));});}
async function ready(){
  render(<StatGuardWorkspace initialMode="calculate"/>);await userEvent.click(screen.getByRole('button',{name:'예제 CSV로 시작'}));await screen.findByRole('table');
  await userEvent.selectOptions(screen.getByLabelText('계산할 숫자 열'),'방문자수');await userEvent.type(screen.getByLabelText('열의 원래 단위'),'명');
  await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'이 조건으로 확인'}));
}
describe('local core calculation UI',()=>{
  it('waits for explicit calculate, sends original bytes and confirmed spec only to same origin',async()=>{
    const fetch=mockSuccess();await ready();expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));const panel=await screen.findByRole('region',{name:'계산 결과와 사용 근거'});
    expect(panel).toHaveTextContent('4938');expect(panel).toHaveTextContent('sum(방문자수) = 4938');
    expect(within(panel).getByRole('region',{name:'선택 범위 사용한 행 표'}).querySelectorAll('tbody tr')).toHaveLength(6);
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('/__statguard/calculate',expect.objectContaining({credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json','X-StatGuard-Client':'local-v0.1'}}));
    expect(new TextDecoder().decode(Uint8Array.from(atob(requestSeen.csv_base64),c=>c.charCodeAt(0)))).toBe(SAMPLE);
    expect(requestSeen.preview_sha256).toBe(await previewHash(parseCsv(SAMPLE)));
    expect(screen.getByRole('button',{name:'계산 완료'})).toBeDisabled();
  });
  it('clears result on a unit edit and requires a new confirmation',async()=>{
    mockSuccess();await ready();await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));await screen.findByRole('region',{name:'계산 결과와 사용 근거'});
    await userEvent.type(screen.getByLabelText('열의 원래 단위'),'수');expect(screen.queryByRole('region',{name:'계산 결과와 사용 근거'})).toBeNull();expect(screen.queryByRole('button',{name:'계산 실행'})).toBeNull();
  });
  it('ignores a late old response after conditions are changed',async()=>{
    let finish: (r:Response)=>void=()=>{};vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>{requestSeen=JSON.parse(String(init?.body));return new Promise(resolve=>{finish=resolve;});});
    await ready();await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));await userEvent.selectOptions(screen.getByLabelText('계산 종류'),'mean');
    await act(async()=>finish(json(responseFor(requestSeen))));expect(screen.queryByRole('region',{name:'계산 결과와 사용 근거'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
  });
  it('ignores a pending old result after the file is cleared',async()=>{
    let finish: (r:Response)=>void=()=>{};vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>{requestSeen=JSON.parse(String(init?.body));return new Promise(resolve=>{finish=resolve;});});
    await ready();await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));await userEvent.click(screen.getByRole('button',{name:'자료 비우기'}));
    await act(async()=>finish(json(responseFor(requestSeen))));expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByRole('region',{name:'계산 결과와 사용 근거'})).toBeNull();
  });
  it('shows a bounded engine error without raw response, and does not retry',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({ok:false,error:{code:'NON_POSITIVE_BASELINE',message:'UNTRUSTED_DETAILS'}},422));
    await ready();await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));expect(await screen.findByRole('alert')).toHaveTextContent('기준 합계는 0보다');expect(screen.queryByText('UNTRUSTED_DETAILS')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong-source or wrong-spec results instead of rendering them',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const req=JSON.parse(String(init?.body));const payload=responseFor(req);payload.result.source_sha256='0'.repeat(64);return json(payload);});
    await ready();await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));expect(await screen.findByRole('alert')).toHaveTextContent('표시하지 않았습니다');expect(screen.queryByRole('region',{name:'계산 결과와 사용 근거'})).toBeNull();
  });
  it('times out a stalled request and never automatically retries',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}));
    await ready();vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'계산 실행'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(12001);});
    expect(screen.getByRole('alert')).toHaveTextContent('계산 시간이 초과');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('shows pagination of actual original row numbers and omitted rows separately',async()=>{
    const table=parseCsv('값\n'+Array.from({length:25},(_,i)=>String(i+1)).join('\n')+'\n""');
    const req:CalculationRequest={mode:'calculate',csv_base64:'',encoding:'utf-8-sig',request_id:'x',preview_sha256:'p',source_sha256:'s',spec:{operation:'sum',column:'값',filters:{},reference_filters:null,group_by:null,aggregation:null,missing_policy:'omit'},units:{값:'명'}};
    const payload=responseFor(req);payload.result.usage={selected_rows:Array.from({length:26},(_,i)=>i+1),used_rows:Array.from({length:25},(_,i)=>i+1),omitted_rows:[26],filtered_out_count:0};
    render(<CalculationResult result={payload.result as any} table={table}/>);
    expect(screen.getByRole('region',{name:'선택 범위 사용한 행 표'}).querySelectorAll('tbody tr')).toHaveLength(20);
    await userEvent.click(screen.getByRole('button',{name:'선택 범위 다음 행'}));expect(screen.getByRole('region',{name:'선택 범위 사용한 행 표'}).querySelector('tbody th')).toHaveTextContent('21');
    await userEvent.click(screen.getByRole('button',{name:'제외된 빈 값 행 (1)'}));expect(screen.getByRole('region',{name:'선택 범위 제외된 빈 값 행 표'}).querySelector('tbody th')).toHaveTextContent('26');
  });
});
describe('response-to-confirmation linkage',()=>{
  const req: CalculationRequest={mode:'calculate',request_id:'11111111-1111-4111-8111-111111111111',csv_base64:'',source_sha256:'1'.repeat(64),preview_sha256:'2'.repeat(64),encoding:'utf-8-sig',units:{방문자수:'명'},spec:{operation:'sum',column:'방문자수',filters:{},reference_filters:null,group_by:null,aggregation:null,missing_policy:'reject'}};
  it('preserves raw byte values in base64',()=>{const bytes=new Uint8Array([0,128,255]).buffer;expect(base64Bytes(bytes)).toBe('AID/');});
  it('accepts key-order-independent equivalent specs and never treats ordering as a value change',()=>{const payload=responseFor(req);payload.result.spec={...req.spec,filters:{}};expect(validateResponse(payload,req,6).value).toBe('4938');});
  it.each(['request','preview','source','spec','unit','out_of_range','duplicate_row','omitted_overlap','precision','nan','reference','version'])('rejects linkage/shape mismatch %s',kind=>{
    const p=responseFor(req) as any;
    if(kind==='request')p.request_id='other';if(kind==='preview')p.preview_sha256='other';if(kind==='source')p.result.source_sha256='other';if(kind==='spec')p.result.spec={...req.spec,column:'다른열'};if(kind==='unit')p.result.unit='건';if(kind==='out_of_range')p.result.usage.used_rows=[7];if(kind==='duplicate_row')p.result.usage.used_rows=[1,1];if(kind==='omitted_overlap')p.result.usage.omitted_rows=[1];if(kind==='precision')p.result.precision=53;if(kind==='nan')p.result.value='NaN';if(kind==='reference')p.result.reference_usage=p.result.usage;if(kind==='version')p.result.contract_version='other';
    expect(()=>validateResponse(p,req,6)).toThrow();
  });
  it('handles absent local middleware without echoing HTML errors',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('<html>UNTRUSTED</html>',{status:404}));await expect(calculateLocal(req,6,new AbortController().signal)).rejects.toThrow('계산 엔진에 연결');});
});

