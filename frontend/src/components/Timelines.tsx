import type { CanonicalEventView, DecisionRecordView, RuntimeEvidenceView } from '../api/types';
import { DecisionBadge, EvidenceBadge, JsonPreview, Reasons, short } from './ui';

const names:Record<string,string>={user_message:'사용자 목표',agent_text:'공개 Agent 메시지',action_requested:'도구 호출',action_result:'도구 결과',environment_observation:'환경 관찰',agent_final:'공개 최종 응답'};
export function EventTimeline({events}:{events:CanonicalEventView[]}) {
  return <ol className="event-timeline">{[...events].sort((a,b)=>a.event_index-b.event_index).map(e=><li key={e.event_id} id={`event-${encodeURIComponent(e.event_id)}`} className={e.error?'has-error':''}>
    <div className="event-rail"><span>{String(e.event_index).padStart(2,'0')}</span></div><div className="event-body">
      <div className="row between"><div className="event-title"><strong>{names[e.event_type] || e.event_type}</strong>{e.action_name&&<code>{e.action_name}</code>}</div><span className="muted mono small">{e.decision_group ? `그룹 ${e.decision_group}`:e.actor}</span></div>
      <div className="event-meta mono">{e.actor} · {e.event_id}{e.parent_event_id&&<> <span className="linkage">← 호출 <a href={`#event-${encodeURIComponent(e.parent_event_id)}`}>{e.parent_event_id}</a></span></>}</div>
      {e.visible_text&&(e.visible_text.length>180?<JsonPreview label="공개 텍스트" value={e.visible_text}/>:<p className="visible-text">{e.visible_text}</p>)}
      {e.arguments!==null&&e.arguments!==undefined&&<JsonPreview value={e.arguments} label="인자"/>}
      {e.observation!==null&&<JsonPreview value={e.observation} label="결과"/>}
      {e.error&&<div className="error-line"><strong>실행 오류</strong><code>{e.error}</code></div>}
    </div></li>)}</ol>;
}
export function EvidenceCards({evidence}:{evidence:RuntimeEvidenceView[]}) {
  if (!evidence.length) return <div className="inline-empty"><span>✓</span><strong>기록된 이상 근거가 없습니다</strong><p>실패가 없다는 보장이 아니라, 명시적 근거가 저장되지 않았다는 뜻입니다.</p></div>;
  return <div className="evidence-list">{evidence.map(e=><article className="evidence-card" key={e.evidence_id}><div className="row between"><EvidenceBadge value={e.evidence_level}/><span className="mono small muted">#{e.event_index}</span></div><h3>{e.evidence_type}</h3><p>{e.observed_value}</p><code className="reason-tag">{e.reason_code}</code><dl className="compact-dl"><div><dt>출처</dt><dd>{e.source}</dd></div><div><dt>연결 사건</dt><dd>{e.source_event_ids.map(id=><a key={id} href={`#event-${encodeURIComponent(id)}`}>{id}</a>)}</dd></div></dl><p className="source-note" title="Host가 반환했다고 보고한 실행 결과이며, 발신자의 암호학적 인증을 뜻하지 않습니다.">{e.host_verified?'Host 실행 결과로 보고됨':'행동 순서에서 관찰된 약한 신호'} · 발신자 미인증</p></article>)}</div>;
}
export function DecisionTimeline({decisions,active,onSelect}:{decisions:DecisionRecordView[];active:string|null;onSelect:(id:string)=>void}) {
  if (!decisions.length) return <div className="inline-empty"><strong>아직 기록된 결정이 없습니다</strong><p>완료된 행동 그룹에서 Decision API를 호출하면 표시됩니다.</p></div>;
  return <ol className="decision-timeline">{[...decisions].sort((a,b)=>a.decision_record.decision_event_index-b.decision_record.decision_event_index).map((d,i)=><li key={d.backend_decision_id} className={active===d.backend_decision_id?'active':''}><div className="row between"><div className="row"><span className="decision-number">{i+1}</span><DecisionBadge value={d.decision}/><EvidenceBadge value={d.evidence_level}/></div><span className="muted mono small">판단 시점 #{d.decision_record.decision_event_index}</span></div><Reasons codes={d.reason_codes}/><div className="decision-meta"><code>{d.policy_version} · {short(d.prefix_hash,12)}</code><span>{d.decision_record.fallback_used?'규칙 기반 후보 선택':'선택 정책 기록'}</span></div><p className="small muted">추천 후보: <code>{d.selected_intervention||'없음'}</code></p>{d.provider_warnings.length>0&&<details className="history-warnings"><summary>제공자 한계 경고 {d.provider_warnings.length}개</summary><div className="warning-tags">{d.provider_warnings.map(w=><code key={w}>{w}</code>)}</div></details>}<button className="text-button" aria-pressed={active===d.backend_decision_id} onClick={()=>onSelect(d.backend_decision_id)}>{active===d.backend_decision_id?'현재 후보·제공자 표시 중':'이 결정의 후보·제공자 보기'} →</button></li>)}</ol>;
}
