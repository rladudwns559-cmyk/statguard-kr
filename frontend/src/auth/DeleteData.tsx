import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/cloudClient';

export function DeleteData({projectId,projectName,onProjectDeleted,onAccountDeleted}:{projectId:string;projectName:string;onProjectDeleted:()=>void;onAccountDeleted:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement|null>(null);
  const [kind,setKind]=useState<'project'|'account'>('project'),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const d=dialog.current; const close=()=>trigger.current?.focus(); d?.addEventListener('close',close);return()=>d?.removeEventListener('close',close);},[]);
  function open(type:'project'|'account',button:HTMLButtonElement){trigger.current=button;setKind(type);setValue('');setError('');dialog.current?.showModal();}
  async function remove(){
    setBusy(true);setError('');
    try {
      await apiRequest(kind==='project'?'/api/v1/projects/'+encodeURIComponent(projectId):'/api/v1/account',{method:'DELETE',body:JSON.stringify({confirmation:value})});
      dialog.current?.close();
      if(kind==='project')onProjectDeleted();else await onAccountDeleted();
    } catch(e){setError(e instanceof Error?e.message:'삭제를 완료하지 못했습니다. 다시 시도하세요.');}
    finally{setBusy(false);}
  }
  const required=kind==='project'?projectName:'DELETE';
  return <section className="panel beta-projects"><h2>데이터 삭제</h2><p>삭제하면 실행 기록과 연결된 API Key를 복원할 수 없습니다. <a href="/privacy">보관·삭제 안내</a></p>
    {projectId&&<button className="button secondary" onClick={e=>open('project',e.currentTarget)}>현재 프로젝트 삭제</button>}
    <button className="button secondary" onClick={e=>open('account',e.currentTarget)}>내 계정 삭제</button>
    <dialog ref={dialog} className="deletion-dialog" aria-labelledby="delete-title" onCancel={e=>{if(busy)e.preventDefault();}}>
      <h2 id="delete-title">{kind==='project'?'프로젝트 삭제':'계정 및 모든 데이터 삭제'}</h2>
      <p>{kind==='project'?'이 프로젝트의 Runs, Events, Evidence, Decisions, 실행·검증 기록과 API Key가 삭제됩니다. 다른 프로젝트는 유지됩니다.':'모든 대화와 답변 검증 기록, 프로젝트와 실행 기록, API Key, 로그인 계정이 삭제됩니다. 삭제가 시작되면 접근이 차단됩니다. 서비스 장애 시 삭제 완료가 지연될 수 있습니다.'}</p>
      <label>확인을 위해 <strong>{required}</strong> 입력<input autoFocus value={value} onChange={e=>setValue(e.target.value)} disabled={busy}/></label>
      {error&&<p role="alert">{error}</p>}
      <div className="public-actions"><button className="button secondary" disabled={busy} onClick={()=>dialog.current?.close()}>취소</button><button className="button" disabled={busy||value!==required} aria-busy={busy} onClick={()=>void remove()}>{busy?'삭제 처리 중…':'영구 삭제 확인'}</button></div>
    </dialog>
  </section>;
}
