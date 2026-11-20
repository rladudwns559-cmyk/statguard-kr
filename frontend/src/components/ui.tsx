import { Component, type ReactNode } from 'react';
import type { Decision, EvidenceLevel } from '../api/types';

export function Icon({ name, size=18 }: { name: 'grid'|'arrow'|'back'|'refresh'|'search'|'activity'|'box'|'check'|'info'; size?:number }) {
  const paths = {grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',arrow:'M5 12h14 M13 6l6 6-6 6',back:'M19 12H5 M11 6l-6 6 6 6',refresh:'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 11-2l3 3 M4 16l3 3a7 7 0 0 0 11-2',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',activity:'M2 12h5l3-8 4 16 3-8h5',box:'M4 7l8-4 8 4v10l-8 4-8-4z M4 7l8 4 8-4 M12 11v10',check:'M5 12l4 4L19 6',info:'M12 10v7 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
export function DecisionBadge({ value, large=false }: { value:Decision|null; large?:boolean }) {
  return <span className={`badge decision ${value?.toLowerCase() || 'no_decision'} ${large?'large':''}`}><span aria-hidden="true">{value==='CONTINUE'?'✓':value==='REVIEW'?'!':value==='INTERVENE'?'↗':'○'}</span>{value || 'NO_DECISION'}</span>;
}
export function EvidenceBadge({ value }: { value:EvidenceLevel }) { return <span className={`badge evidence ${value.toLowerCase()}`}><span className="square" aria-hidden="true"/>{value}</span>; }
export const short = (value:string, length=10) => value.length > length ? value.slice(0,length)+'…' : value;
export const formatDate = (value:string) => { const date=new Date(value); return Number.isNaN(date.getTime()) ? '시각 미제공' : date.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); };
export function JsonPreview({ value, label }: {value:unknown;label:string}) {
  let formatted:string;
  if (typeof value==='string') { try { formatted=JSON.stringify(JSON.parse(value),null,2); } catch { formatted=value; } }
  else formatted=JSON.stringify(value,null,2) ?? '미제공';
  const preview=formatted.replace(/\s+/g,' ').slice(0,96);
  return <details className="json-preview"><summary><span className="json-label">{label}</span><code>{preview || '빈 결과'}</code><span className="expand-label">펼치기</span></summary><pre>{formatted}</pre></details>;
}
const reasonMessages:Record<string,string> = {
  NO_RUNTIME_FAILURE_EVIDENCE:'현재 관찰에서 명시적인 실패 근거가 없습니다.',
  REPEATED_ACTION_WEAK:'같은 행동이 반복됐지만 실행 실패는 확인되지 않았습니다.',
  EXPLICIT_TOOL_ERROR:'도구가 명시적인 오류를 반환했습니다.',
  INVALID_ARGUMENT:'Host가 잘못된 인자를 보고했습니다.',
  NO_INTERVENTION_CANDIDATE:'실행 가능한 개입 후보가 제공되지 않았습니다.',
  FALLBACK_SINGLE_VERIFIED_CANDIDATE:'허용 목록과 정적 검사를 통과한 단일 후보를 추천했습니다.',
  REPEATED_FAILED_ACTION:'동일 행동에서 확인된 실패가 반복됐습니다.',
  Q_RECOVERY_EXPERIMENTAL:'실험적 회복 점수가 포함됐습니다.',
  CONSECUTIVE_ERROR:'완료된 행동 그룹에서 오류가 연속됐습니다.',
  AUTONOMOUS_INTERVENTION_DISABLED:'Host의 자율 개입 권한이 꺼져 있습니다.',
};
export function Reasons({ codes }: {codes:string[]}) { return <ul className="reasons">{codes.map(code=><li key={code}><span>{reasonMessages[code] || (code.startsWith('HOST_SIGNAL:')?'Host 실행 결과의 명시적 상태를 근거로 사용했습니다.':'정책에 기록된 추가 근거입니다.')}</span><code>{code}</code></li>)}</ul>; }
export function Limitations() { return <footer className="limitations"><Icon name="info"/><div><strong>제품 상태 · Local MVP</strong><p>INTERVENE는 개입 추천입니다. 실제 실행과 복구 여부는 별도의 실행·검증 기록에서 확인하세요. q_recovery는 실험적 점수, p_failure는 약한 참고값입니다. Host 정보는 발신자 주장(source-asserted)이며, 운영용 인증은 아직 없습니다.</p></div></footer>; }
export function Loading() { return <div className="loading" role="status" aria-label="불러오는 중"><div className="skeleton heading"/><div className="skeleton card"/><div className="skeleton card"/><span>실행 기록을 불러오는 중…</span></div>; }
export function ErrorState({error,retry}:{error:Error;retry:()=>void}) { return <div className="state-card error-state" role="alert"><span className="state-icon">!</span><p className="eyebrow">CONNECTION / RESPONSE</p><h2>{'kind' in error && error.kind==='unavailable'?'백엔드에 연결할 수 없습니다':'실행 기록을 불러오지 못했습니다'}</h2><p>{error.message}</p><button className="button" onClick={retry}><Icon name="refresh"/>다시 시도</button></div>; }
export class RenderBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}; static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="state-card" role="alert"><h2>화면을 표시하지 못했습니다.</h2><p>응답을 확인한 후 다시 열어 주세요.</p><a className="button" href="/runs">실행 목록으로</a></div>:this.props.children;}
}
