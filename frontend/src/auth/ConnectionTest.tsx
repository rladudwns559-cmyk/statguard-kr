import { useEffect, useRef, useState } from 'react';
import { API_BASE, apiRequest } from '../api/cloudClient';
import type { Decision, EvidenceLevel } from '../api/types';

export const CONNECTION_SOURCE = 'BEGINNER_CONNECTION_TEST';
export const SAMPLE_EVENTS = [
  {event_id:'call-1',event_index:0,actor:'agent',event_type:'action_requested',decision_group:1,action_name:'read_demo',arguments:{item:'public-demo'}},
  {event_id:'result-1',event_index:1,actor:'tool',event_type:'action_result',decision_group:1,action_name:'read_demo',parent_event_id:'call-1',observation:'{"status":"success","message":"demo item read"}',group_complete:true},
];
export const decisionExplanation:Record<Decision,string> = {
  CONTINUE:'현재 관찰된 근거로는 개입을 추천하지 않습니다. 성공을 보장하는 뜻은 아닙니다.',
  REVIEW:'확인이 필요한 상태입니다. 실행 기록과 판단 근거를 검토해 주세요.',
  INTERVENE:'개입을 고려할 신호가 있어 수정 행동을 추천합니다. 실제 실행 완료를 뜻하지 않습니다.',
};
type Result = {runId:string;decision:Decision;evidence:EvidenceLevel};
type Attempt = {id:string;runId?:string};

// No storage, URL, telemetry or console writes. Only the caller's one-time key in memory.
async function agentRequest(path:string,key:string,body:object,signal:AbortSignal,idempotency?:string) {
  const origin=new URL(API_BASE);
  if(origin.origin!==API_BASE || (origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname)))throw new Error('unavailable');
  const response=await fetch(API_BASE+path,{method:'POST',headers:{'Content-Type':'application/json','X-WHEN2WARN-API-Key':key,...(idempotency?{'Idempotency-Key':idempotency}:{})},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal});
  if(!response.ok) {
    // Never render raw errors/bodies: they may contain user-controlled secrets.
    throw new Error(response.status===401||response.status===403?'key':response.status===429?'rate':response.status===409?'conflict':'unavailable');
  }
  return response.json();
}

export function ConnectionTest({projectId,apiKey,onBusyChange,onComplete}:{projectId:string;apiKey:string;onBusyChange?:(busy:boolean)=>void;onComplete?:(result:Result)=>void}) {
  const [phase,setPhase]=useState(0),[busy,setBusy]=useState(false),[slow,setSlow]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
  const attempt=useRef<Attempt|null>(null), controller=useRef<AbortController|null>(null), mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  async function start() {
    if(controller.current || result)return;
    const aborter=new AbortController();controller.current=aborter;setBusy(true);onBusyChange?.(true);setError('');setSlow(false);setPhase(0);
    const slowTimer=setTimeout(()=>{if(mounted.current)setSlow(true);},4000);
    const timeout=setTimeout(()=>aborter.abort(),75000);
    try {
      const owned=await apiRequest('/api/v1/projects',{signal:aborter.signal});
      if(!owned.projects?.some((p:{project_id:string;status:string})=>p.project_id===projectId&&p.status==='active'))throw new Error('project');
      setPhase(1);
      // Stable in-memory idempotency key survives manual retry, never a reload.
      const current=attempt.current ?? {id:crypto.randomUUID()};attempt.current=current;
      if(!current.runId){
        const run=await agentRequest('/api/v1/agent/runs',apiKey,{source_host:CONNECTION_SOURCE,agent_id:'browser-connection-test',external_run_id:'connection-test-'+current.id,metadata:{source:CONNECTION_SOURCE,synthetic:true}},aborter.signal,current.id);
        if(typeof run.run_id!=='string'||!run.run_id)throw new Error('contract');
        current.runId=run.run_id;
      }
      const runId=current.runId;
      if(!runId)throw new Error('contract');
      setPhase(2);
      const base='/api/v1/agent/runs/'+encodeURIComponent(runId);
      for(const event of SAMPLE_EVENTS){const accepted=await agentRequest(base+'/events',apiKey,event,aborter.signal);if(accepted.accepted!==true||accepted.event_id!==event.event_id)throw new Error('contract');}
      setPhase(3);
      const decision=await agentRequest(base+'/decisions',apiKey,{},aborter.signal);
      if(!['CONTINUE','REVIEW','INTERVENE'].includes(decision.decision)||!['NONE','WEAK','STRONG','CRITICAL'].includes(decision.evidence_level)||typeof decision.backend_decision_id!=='string'||decision.recommendation_only!==true||decision.intervention_executed!==false)throw new Error('contract');
      setPhase(4);
      // A real owner-authenticated read proves persistence and key/project alignment.
      const ownerBase='/api/v1/runs/'+encodeURIComponent(runId);
      const [saved,events,decisions]=await Promise.all([apiRequest(ownerBase,{signal:aborter.signal}),apiRequest(ownerBase+'/events',{signal:aborter.signal}),apiRequest(ownerBase+'/decisions',{signal:aborter.signal})]);
      if(saved.project_id!==projectId||saved.metadata?.source!==CONNECTION_SOURCE||saved.event_count!==2||!events.events?.some((e:{event_id:string})=>e.event_id==='result-1')||!decisions.decisions?.some((d:{backend_decision_id:string;decision:string;evidence_level:string})=>d.backend_decision_id===decision.backend_decision_id&&d.decision===decision.decision&&d.evidence_level===decision.evidence_level))throw new Error('contract');
      if(!mounted.current||aborter.signal.aborted)return;
      const complete={runId,decision:decision.decision as Decision,evidence:decision.evidence_level as EvidenceLevel};
      setPhase(5);setResult(complete);onComplete?.(complete);
    } catch(e) {
      if(mounted.current){
        const kind=e instanceof Error?e.message:'';
        setError(kind==='key'?'이 키로 연결할 수 없습니다. 폐기된 키인지 확인하고 새 키를 만들어 주세요.':kind==='rate'?'요청이 많습니다. 1분 이상 기다린 뒤 다시 시도하세요.':kind==='project'?'현재 프로젝트를 확인할 수 없습니다. 프로젝트를 다시 선택해 주세요.':kind==='contract'||kind==='conflict'?'기록 확인을 끝내지 못했습니다. 연결 성공으로 처리하지 않았습니다. 다시 시도하거나 도움말을 확인하세요.':'연결을 끝내지 못했습니다. 서버 시작이나 네트워크 지연일 수 있습니다. 잠시 후 다시 시도하세요.');
      }
    } finally {
      clearTimeout(timeout);clearTimeout(slowTimer);controller.current=null;
      if(mounted.current){setBusy(false);setSlow(false);onBusyChange?.(false);}
    }
  }
  return <section className="connection-test" aria-label="브라우저 연결 테스트" aria-busy={busy}>
    <h3>{result?'연결되었습니다.':'먼저 브라우저에서 연결해 보세요.'}</h3>
    <p>Python이나 코드 없이 안전한 예제 행동 2개를 서버에 보내고, 판단과 저장된 기록을 확인합니다. 실제 Agent나 컴퓨터를 조작하지 않습니다.</p>
    <p>‘연결 테스트’로 구분되는 실행 기록 1개가 이 프로젝트에 저장됩니다. 프로젝트를 삭제하면 함께 삭제됩니다.</p>
    {!result&&<button className="button" onClick={()=>void start()} disabled={busy}>{busy?'연결 확인 중…':error?'다시 시도':'연결 테스트하기'}</button>}
    {phase>0||busy?<ol className="connection-checks" aria-label="연결 확인 단계">{['프로젝트 연결 확인','API 인증 확인','예제 행동과 결과 전송','WHEN2WARN 판단 요청','Dashboard 저장 확인'].map((label,i)=><li key={label} aria-current={busy&&phase===i?'step':undefined}>{phase>i?'✓ 완료':busy&&phase===i?'확인 중':'대기'} · {label}</li>)}</ol>:null}
    {slow&&<p role="status">응답을 기다리고 있습니다. 처음 연결은 서버 시작으로 조금 더 걸릴 수 있습니다. 새로고침하지 말고 잠시 기다려 주세요.</p>}
    {error&&<div role="alert"><p>{error}</p><a href="#api-keys">새 키 만들기</a> · <a href="/docs/quickstart#help">도움말</a>{attempt.current?.runId&&<p>일부 기록은 이미 저장됐을 수 있습니다. 같은 화면에서 다시 시도하면 해당 기록을 이어서 확인합니다. 새로고침 후에는 새 테스트 기록이 생길 수 있습니다.</p>}</div>}
    {result&&<div className="connection-result" role="status"><strong>첫 번째 테스트 Run이 생성되었습니다.</strong><p>Run은 Agent가 한 번 작업한 기록입니다. 이 기록은 합성 예제이며 실제 Agent 연결 완료나 성능 검증을 뜻하지 않습니다.</p><p>판단: <strong>{result.decision}</strong></p><p>{decisionExplanation[result.decision]}</p><p>근거: <strong>{result.evidence}</strong>{result.evidence==='NONE'?' · 현재 지원하는 강한 오류 신호가 발견되지 않았습니다. 성공 보장은 아닙니다.':''}</p><a className="button" href={'/runs/'+encodeURIComponent(result.runId)}>Dashboard에서 확인</a><a className="button secondary" href="/docs/quickstart#python">실제 Agent 연결하기</a><p><a href={'/runs?project='+encodeURIComponent(projectId)}>Dashboard 둘러보기</a> · <a href="/projects">나중에 하기</a></p></div>}
  </section>;
}
