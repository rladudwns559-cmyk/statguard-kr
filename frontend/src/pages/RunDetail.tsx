import { ExecutionSection } from '../components/ExecutionFlow';
import { useState } from 'react';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { DecisionBadge, EvidenceBadge, ErrorState, Icon, JsonPreview, Loading, Reasons, formatDate, short } from '../components/ui';
import { EventTimeline, EvidenceCards, DecisionTimeline } from '../components/Timelines';
import { InterventionCards, ProviderPanel } from '../components/Interventions';

export function RunDetail({id}:{id:string}) {
  const resource=useResource(signal=>api.bundle(id,signal),id);
  const [active,setActive]=useState<string|null>(null);
  if(resource.loading)return <Loading/>;
  if(resource.error)return <><a href="/runs" className="back-link"><Icon name="back"/>실행 목록</a><ErrorState error={resource.error} retry={resource.retry}/></>;
  if(!resource.data)return null;
  const {run,events,evidence,decisions}=resource.data;
  const latest=decisions.at(-1)||null;const selected=decisions.find(d=>d.backend_decision_id===active)||latest;
  const explanation=latest?.decision==='INTERVENE'?'개입을 추천했습니다':latest?.decision==='REVIEW'?'실행 기록을 검토해 주세요':latest?.decision==='CONTINUE'?'현재 경로를 계속 진행합니다':'아직 결정이 기록되지 않았습니다';
  return <><a className="back-link" href="/runs"><Icon name="back"/>실행 목록으로</a><div className="page-heading detail-heading"><div><p className="eyebrow">RUN DETAIL</p><h1>{run.external_run_id||run.task_id||'Agent 실행 상세'}</h1><p className="mono run-id">{run.run_id}</p></div><button className="button secondary" onClick={resource.retry}><Icon name="refresh"/>새로고침</button></div>
    {run.metadata.development_fixture===true&&<div className="fixture-note"><Icon name="info"/>명시적으로 생성한 개발용 UI 확인 기록입니다. 연구 성능 데이터가 아닙니다.</div>}
    <section className={`reliability-panel ${latest?.decision.toLowerCase()||'undecided'}`}><div className="reliability-main"><p className="eyebrow">RECORDED DECISION · 기록된 최신 판단</p><div className="row"><DecisionBadge value={latest?.decision||null} large/><h2>{explanation}</h2></div>{latest?.decision==='INTERVENE'&&<p className="recommendation-note">Recommended intervention · 추천이며 실행 완료가 아닙니다.</p>}<p className="muted small">{latest?`판단 시점 #${latest.decision_record.decision_event_index}까지의 prefix를 근거로 한 기록입니다.`:'완료된 행동 그룹에서 Decision API를 호출하면 판단을 볼 수 있습니다.'}</p></div><div className="reliability-evidence"><span className="eyebrow">EVIDENCE LEVEL</span><EvidenceBadge value={latest?.evidence_level||'NONE'}/><code>{latest?.policy_version||'정책 기록 없음'}</code>{latest&&<code title={latest.prefix_hash}>prefix {short(latest.prefix_hash,12)}</code>}</div>{latest&&<div className="reliability-reasons"><Reasons codes={latest.reason_codes.slice(0,2)}/></div>}</section>
    <ExecutionSection runId={id} decision={selected}/>
    <section className="run-summary"><div><span>Agent</span><strong>{run.agent_id||'미제공'}</strong></div><div><span>작업 ID</span><strong>{run.task_id||'미제공'}</strong></div><div><span>Host · source-asserted</span><strong>{run.source_host}</strong></div><div><span>생성 시각 / 상태</span><strong>{formatDate(run.created_at)} · {run.status}</strong></div><div><span>사건 / 결정</span><strong className="mono">{events.length} / {decisions.length}</strong></div><div className="summary-metadata"><JsonPreview label="Metadata" value={run.metadata}/></div></section>
    <div className="detail-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">OBSERVABLE EVENTS</p><h2>실행 타임라인 <span className="count-tag">{events.length}</span></h2></div><span className="small muted">호출 → 결과</span></div>{events.length?<EventTimeline events={events}/>:<div className="inline-empty"><strong>아직 입력된 event가 없습니다</strong></div>}</section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">RUNTIME SIGNALS</p><h2>관찰된 근거 <span className="count-tag">{evidence.length}</span></h2></div></div><EvidenceCards evidence={evidence}/></section></div>
    <div className="detail-grid"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">DECISION HISTORY</p><h2>판단 이력 <span className="count-tag">{decisions.length}</span></h2></div></div><DecisionTimeline decisions={decisions} active={selected?.backend_decision_id||null} onSelect={setActive}/></section><section className="panel"><div className="panel-heading"><div><p className="eyebrow">RECOMMENDATION ONLY</p><h2>개입 후보</h2><p>{selected?`선택한 판단 시점 #${selected.decision_record.decision_event_index}`:'선택한 판단 없음'}</p></div><Icon name="box"/></div><InterventionCards decision={selected}/></section></div>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PROVIDERS & LIMITATIONS</p><h2>점수 제공자와 해석 한계</h2><p>선택한 판단에 사용된 점수입니다. 보정된 성공·실패 확률이 아닙니다.</p></div></div><div className="provider-content"><ProviderPanel decision={selected}/></div></section>
  </>;
}
