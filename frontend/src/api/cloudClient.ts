import { ApiError, parseRuns, parseRun, parseEvents, parseEvidence, parseDecisions, parseExecutionHistory } from './client';
import type { RunBundle } from './types';
export const API_BASE = (import.meta.env.VITE_WHEN2WARN_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8001' : '')).replace(/\/$/, '');
let tokenProvider: (()=>Promise<string|null>) | null = null;
export function setTokenProvider(provider: (()=>Promise<string|null>) | null) { tokenProvider=provider; }
export async function getAccessToken(){return tokenProvider?tokenProvider():null;}
export async function apiRequest(path: string, init: RequestInit = {}): Promise<any> {
  if(!API_BASE)throw new ApiError('unavailable','서비스 연결 설정이 없습니다. 운영자에게 문의하세요.');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  init.signal?.addEventListener('abort',abort,{once:true});
  if(init.signal?.aborted)controller.abort();
  const timer=setTimeout(abort,20000);
  try {
    const token=await Promise.race([tokenProvider?tokenProvider():Promise.resolve(null),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))]);
    if(!token)throw new ApiError('request','로그인이 필요합니다.');
    const headers:Record<string,string>={Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+token};
    const response=await fetch(API_BASE+path,{...init,signal:controller.signal,headers,cache:'no-store'});
    const rid=response.headers.get('X-Request-ID');
    const suffix=rid&&/^[a-f0-9]{32}$/.test(rid)?` (요청 ID: ${rid})`:'';
    if(response.status===401){window.dispatchEvent(new Event('when2warn:unauthorized'));throw new ApiError('request','로그인이 필요합니다. 다시 로그인하세요.'+suffix);}
    if(!response.ok){
      let code='';try{code=(await response.json()).error?.code||'';}catch{/* Safe status fallback. */}
      const friendly:Record<string,string>={PROJECT_LIMIT:'프로젝트 개수 제한에 도달했습니다. 사용하지 않는 프로젝트를 삭제하세요.',API_KEY_LIMIT:'활성 API Key 제한에 도달했습니다. 사용하지 않는 키를 폐기하세요.',RUN_LIMIT:'프로젝트의 실행 기록 제한에 도달했습니다.',EVENT_LIMIT:'이 실행의 이벤트 제한에 도달했습니다.',DELETION_PENDING:'계정 삭제가 대기 중입니다. 접근은 차단되었으며 잠시 후 삭제를 다시 시도하세요.',ACCOUNT_DELETION_UNAVAILABLE:'계정 삭제 서비스가 준비되지 않았습니다. 운영자에게 문의하세요.'};
      throw new ApiError(response.status===404?'not-found':'request',(friendly[code]||(response.status===429?'요청이 많습니다. 1분 뒤 다시 시도하세요.':response.status===403?'이 기록에 접근할 수 없습니다.':response.status===404?'요청한 기록을 찾을 수 없습니다.':'서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도하세요.'))+suffix);
    }
    try{return await response.json();}catch{throw new ApiError('malformed','API가 올바른 JSON을 반환하지 않았습니다.'+suffix);}
  } catch(e) {
    if(init.signal?.aborted)throw e;
    if(e instanceof ApiError)throw e;
    throw new ApiError('unavailable','서버 연결이 지연되거나 끊어졌습니다. 처음 요청은 서버 시작에 시간이 걸릴 수 있습니다. 잠시 후 다시 시도하세요.');
  } finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}

}
function get(path:string,signal?:AbortSignal){return apiRequest(path,{signal});}
export const cloudApi = {
  async executionHistory(id:string,signal?:AbortSignal){return parseExecutionHistory(await get(`/api/v1/runs/${encodeURIComponent(id)}/execution-history`,signal));},
  async runs(signal?: AbortSignal,projectId?:string) { return parseRuns(await get('/api/v1/runs'+(projectId?'?project_id='+encodeURIComponent(projectId):''), signal)); },
  async bundle(id: string, signal?: AbortSignal): Promise<RunBundle> {
    const base = `/api/v1/runs/${encodeURIComponent(id)}`;
    const [run, events, evidence, decisions] = await Promise.all([get(base,signal),get(base+'/events',signal),get(base+'/evidence',signal),get(base+'/decisions',signal)]);
    return {run:parseRun(run),events:parseEvents(events),evidence:parseEvidence(evidence),decisions:parseDecisions(decisions)};
  }
};
