import type { DecisionRecordView, ProviderStatusView } from '../api/types';
import { JsonPreview, Icon } from './ui';

export function InterventionCards({decision}:{decision:DecisionRecordView|null}) {
  if (!decision?.candidate_interventions.length) return <div className="inline-empty"><Icon name="box"/><strong>제공된 개입 후보가 없습니다</strong><p>후보가 없으면 시스템이 임의의 행동을 만들지 않습니다.</p></div>;
  return <div className="candidate-list">{decision.candidate_interventions.map(c=><article key={c.candidate_id} className={`candidate-card ${decision.selected_intervention===c.candidate_id?'selected':''}`}>
    <div className="row between"><code className="candidate-id">{c.candidate_id}</code>{decision.selected_intervention===c.candidate_id&&<span className="recommended">↗ 추천 후보</span>}</div><h3>{c.action}</h3><div className="chips"><span>{c.intervention_type}</span><span>{c.scope || '범위 미제공'}</span></div><dl className="compact-dl"><div><dt>대상</dt><dd className="mono">{c.target}</dd></div><div><dt>실행 가능 신고</dt><dd>{c.executable?'Host가 가능으로 신고':'미확인'}</dd></div></dl>
    <JsonPreview label="후보 인자" value={c.args}/>{decision.provider_status.q_recovery[c.candidate_id]?.score!=null&&<p className="score-line">실험적 회복 점수 <strong className="mono">{decision.provider_status.q_recovery[c.candidate_id].score!.toFixed(2)}</strong></p>}
    {c.public_rationale&&<p>{c.public_rationale}</p>}{decision.selected_intervention===c.candidate_id&&<p className="recommendation-note">Recommended intervention · 추천 기록이며 실행 완료를 뜻하지 않습니다.</p>}
  </article>)}</div>;
}
function ProviderCard({signal,title}:{signal:ProviderStatusView;title:string}) { return <article className="provider-card"><span className="eyebrow">{title}</span><div className="row between"><h3>{signal.score==null?'미제공':signal.score.toFixed(2)}</h3><code className="status-tag">{signal.status}</code></div><p className="mono small muted">{signal.provider_name} · {signal.provider_version}</p></article>; }
export function ProviderPanel({decision}:{decision:DecisionRecordView|null}) {
  const p=decision?.provider_status.p_failure; const q=decision?Object.entries(decision.provider_status.q_recovery):[];
  return <><div className="provider-grid">{p?<ProviderCard signal={p} title="약한 실패 위험 참고 점수"/>:<div className="provider-card"><span className="eyebrow">실패 위험 참고값</span><h3 className="no-provider">제공자 미사용</h3><p>모델 점수 없이도 규칙에 따라 판단합니다.</p></div>}{q.length?q.map(([id,signal])=><ProviderCard key={id} signal={signal} title={`실험적 회복 점수 · ${id}`}/>):<div className="provider-card"><span className="eyebrow">실험적 회복 점수</span><h3 className="no-provider">제공자 미사용</h3><p>점수가 제공되면 상태와 한계 경고를 함께 표시합니다.</p></div>}</div>{!!decision?.provider_warnings.length&&<div className="provider-warnings"><Icon name="info"/><div><strong>점수 해석 시 주의</strong><p>회복 점수는 보정된 확률이 아닙니다. 참고 점수는 단독 개입 근거로 사용되지 않습니다.</p><div className="warning-tags">{decision.provider_warnings.map(w=><code key={w}>{w}</code>)}</div></div></div>}</>;
}
