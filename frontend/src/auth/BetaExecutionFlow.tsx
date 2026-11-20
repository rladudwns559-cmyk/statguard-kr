// Beta transport view; frozen local evidence view is preserved.
import { useResource } from '../api/useResource';
import { cloudApi as api } from '../api/cloudClient';
import type { DecisionRecordView, ExecutionHistory } from '../api/types';
import { ErrorState, JsonPreview, Loading } from '../components/ui';

const captions:Record<string,string>={RECOMMENDED_NOT_EXECUTED:'추천만 기록됨 · 실행되지 않음',DISPATCHED:'실행 권한 예약됨 · 결과 수신 대기',SKIPPED:'안전 조건 미충족 · 실행 거부',EXECUTED:'Host 실행 확인',EXECUTION_FAILED:'실행 실패',VERIFIED_RECOVERY:'개입 후 성공 상태 확인',VERIFIED_FAILURE:'개입 후 실패 상태 확인',INCONCLUSIVE:'검증 근거 불충분'};
export function ExecutionFlow({decision,history}:{decision:DecisionRecordView|null;history:ExecutionHistory}) {
  const execution=history.executions.find(e=>e.backend_decision_id===decision?.backend_decision_id);
  const verification=history.verifications.find(v=>v.execution_id===execution?.execution_id);
  const status=execution?.execution_status||(decision?.selected_intervention?'RECOMMENDED_NOT_EXECUTED':'NO_EXECUTION');
  return <div className="execution-flow"><div className="execution-stages">
    <div><span>01 · Decision / 판단</span><strong>{decision?.decision||'판단 없음'}</strong></div>
    <div><span>02 · Recommended / 추천</span><strong>{decision?.selected_intervention||'개입 후보 없음'}</strong></div>
    <div><span>03 · Execution / 실제 실행</span><strong>{status}</strong><p>{captions[status]||'자동 개입 실행 없음'}</p></div>
    <div><span>04 · Verification / 사후 검증</span><strong>{verification?.verification_status||'NOT_VERIFIED'}</strong><p>{verification?captions[verification.verification_status]:'검증 기록 없음'}</p></div>
  </div><p className="muted small">INTERVENE는 추천입니다. 실제 실행과 사후 검증은 각각의 별도 기록으로 확인합니다.</p>
  {execution&&<><p className="small mono">{execution.reason_code} · {execution.adapter_version}</p><div className="row">{execution.source_event_ids.map(id=><a key={id} href={`#event-${encodeURIComponent(id)}`}>사건 {id}</a>)}</div><JsonPreview label="실행 기록" value={execution}/></>}
  {verification&&<><p className="small">검증 근거: {verification.verification_basis}</p><JsonPreview label="사후 검증 전용 기록 · 판단 입력에서 제외" value={verification}/></>}
  </div>;
}
export function ExecutionSection({runId,decision}:{runId:string;decision:DecisionRecordView|null}) {
  const r=useResource(signal=>api.executionHistory(runId,signal),runId+':'+(decision?.backend_decision_id||''));
  return <section className="panel execution-panel"><div className="panel-heading"><div><p className="eyebrow">END-TO-END HOST LOOP</p><h2>추천 → 실행 → 검증</h2></div><button className="button secondary" onClick={r.retry}>실행 기록 새로고침</button></div>{r.loading?<Loading/>:r.error?<ErrorState error={r.error} retry={r.retry}/>:r.data?<ExecutionFlow decision={decision} history={r.data}/>:null}</section>;
}
