import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalculationError, type CalculationRequest, type EngineResult } from './calculationClient';
import { microUnits, numericStatus } from './csv';
import { compareLocal, type Comparison } from './comparisonClient';

export default function ManualComparison({calculation,result}:{calculation:CalculationRequest;result:EngineResult}){
  const [value,setValue]=useState(''),[tolerance,setTolerance]=useState('0'),[comparison,setComparison]=useState<Comparison|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0),aborter=useRef<AbortController|null>(null);
  useEffect(()=>()=>{epoch.current++;aborter.current?.abort();},[]);
  function clear(){epoch.current++;aborter.current?.abort();aborter.current=null;setComparison(null);setError('');setBusy(false);}
  const numeric=numericStatus(value)==='number';
  const toleranceValid=numericStatus(tolerance)==='number'&&microUnits(tolerance)>=0n&&microUnits(tolerance)<=1_000_000_000_000_000_000_000_000n;
  async function submit(event:FormEvent){
    event.preventDefault();if(!numeric||!toleranceValid||aborter.current)return;
    const generation=++epoch.current,controller=new AbortController();aborter.current=controller;
    setBusy(true);setError('');setComparison(null);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},12000);
    try{
      const next=await compareLocal({mode:'compare',request_id:crypto.randomUUID(),calculation,expected_dataset_version:result.dataset_version,expected_calculation_id:result.calculation_id,claim_value:value,claim_unit:result.unit,tolerance_absolute:tolerance},result,controller.signal);
      if(epoch.current===generation&&!controller.signal.aborted)setComparison(next);
    }catch(e){if(epoch.current===generation)setError(timedOut?'비교 시간이 초과되었습니다. 자동 재시도하지 않았습니다.':e instanceof CalculationError?e.message:'수치 비교 엔진에 연결하지 못했습니다. 직접 다시 시도해 주세요.');}
    finally{clearTimeout(timer);if(aborter.current===controller)aborter.current=null;if(epoch.current===generation)setBusy(false);}
  }
  const differenceUnit=comparison?.difference.unit==='%p'?'퍼센트포인트':comparison?.difference.unit;
  return <section className="sg-manual-compare" aria-labelledby="manual-compare-heading"><h3 id="manual-compare-heading">내 수치와 비교하기</h3>
    <p className="sg-hint">계산한 값 <strong>{result.value} {result.unit}</strong>와 같은 의미·단위의 숫자를 직접 입력하세요. 같은 자료를 다시 확인해 비교합니다.</p>
    <form onSubmit={e=>void submit(e)}><label htmlFor="sg-claim-value">비교할 수치 ({result.unit})<input id="sg-claim-value" name="claim_value" type="text" inputMode="decimal" autoComplete="off" maxLength={64} value={value} placeholder="숫자만 입력" aria-invalid={!!value&&!numeric} onChange={e=>{clear();setValue(e.target.value);}}/></label>
      {!!value&&!numeric&&<p className="sg-hint sg-input-problem">정수부 18자리·소수부 6자리 이내의 숫자를 입력하세요. 단위·% 기호는 빼고 입력합니다.</p>}
      <details className="sg-tolerance"><summary>허용 차이 설정 · 현재 {tolerance || '미입력'} {result.unit==='%'?'퍼센트포인트':result.unit}</summary><label htmlFor="sg-absolute-tolerance">허용 차이 (절대값)<input id="sg-absolute-tolerance" name="tolerance_absolute" type="text" inputMode="decimal" autoComplete="off" maxLength={64} value={tolerance} aria-invalid={!toleranceValid} onChange={e=>{clear();setTolerance(e.target.value);}}/></label><p className="sg-hint">기본값 0은 정확히 같은 수치만 일치로 봅니다. 반올림을 고려할 때만 직접 지정하세요. 두 값의 절대 차이가 허용 차이 이하면 범위 안입니다.</p>{!toleranceValid&&<p className="sg-hint sg-input-problem">허용 차이는 0 이상의 지원 범위 숫자여야 합니다.</p>}</details>
      <button className="sg-primary" disabled={!numeric||!toleranceValid||busy} aria-busy={busy}>{busy?'비교 중…':'수치 비교'}</button>
    </form>
    {busy&&<p className="sg-hint" role="status">현재 CSV·계산 조건에 연결해 비교하는 중…</p>}
    {error&&<p className="sg-error" role="alert">{error}</p>}
    {comparison&&<div className={'sg-comparison-output sg-comparison-'+comparison.display_status} role="status" aria-label="수치 비교 결과"><strong className="sg-comparison-verdict">{comparison.display_status==='EXACT_MATCH'?'정확히 일치':comparison.display_status==='WITHIN_TOLERANCE'?'허용 차이 이내':'불일치'}</strong>
      <dl><div><dt>직접 입력한 값</dt><dd>{comparison.claim_value} {comparison.claim_unit}</dd></div><div><dt>계산한 값</dt><dd>{comparison.computed_value} {comparison.claim_unit}</dd></div><div><dt>절대 차이</dt><dd>{comparison.difference.absolute} {differenceUnit}</dd></div><div><dt>허용 차이</dt><dd>{comparison.tolerance_absolute} {comparison.claim_unit==='%'?'퍼센트포인트':comparison.claim_unit}</dd></div></dl>
      <p>{comparison.difference.direction==='EQUAL'?'입력한 수치와 계산한 수치가 같습니다.':`입력한 수치가 계산한 수치보다 ${comparison.difference.absolute} ${differenceUnit} ${comparison.difference.direction==='HIGHER'?'높습니다.':'낮습니다.'}`}</p>
      {comparison.display_status==='WITHIN_TOLERANCE'&&<p>정확히 같은 값은 아니며, 지정한 허용 차이 안에 있습니다.</p>}
      {comparison.claim_unit==='%'&&<p className="sg-hint">차이는 퍼센트포인트입니다. 상대적인 증가·감소율을 뜻하지 않습니다.</p>}
    </div>}
    <p className="sg-hint">현재 자료·계산 조건·단위 안의 수치 비교입니다. 문장의 의미나 전체 답변이 사실인지 판정하지 않습니다. 입력 수치는 저장하거나 GPT로 보내지 않습니다.</p>
  </section>;
}
