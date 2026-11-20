import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../api/cloudClient';
import { ConnectionTest } from './ConnectionTest';

type KeyRow = {api_key_id:string;name:string;key_prefix:string;created_at:string;last_used_at:string|null;status:string};
export function ProjectApiKeys({projectId,onActiveKeysChange,onConnectionComplete}:{projectId:string;onActiveKeysChange?:(active:boolean)=>void;onConnectionComplete?:(result:{runId:string})=>void}) {
  const [keys,setKeys]=useState<KeyRow[]>([]),[name,setName]=useState(''),[secret,setSecret]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[testing,setTesting]=useState(false);
  const base='/api/v1/projects/'+encodeURIComponent(projectId)+'/api-keys';
  useEffect(()=>{
    const controller=new AbortController();
    apiRequest(base,{signal:controller.signal}).then(v=>{if(!Array.isArray(v.api_keys))throw new Error();if(!controller.signal.aborted){setKeys(v.api_keys);onActiveKeysChange?.(v.api_keys.some((k:KeyRow)=>k.status==='active'));}})
      .catch(()=>{if(!controller.signal.aborted)setError('API Key 목록을 불러오지 못했습니다.');});
    return ()=>controller.abort();
  },[base,onActiveKeysChange]);
  async function mutate(path:string,body?:object) {
    setBusy(true);setError('');setSecret('');setCopied(false);
    try {
      const value=await apiRequest(path,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
      // One-time secret stays only in this mounted component's memory.
      if(value.api_key)setSecret(value.api_key);
      setName('');
      const list=await apiRequest(base);setKeys(list.api_keys);onActiveKeysChange?.(list.api_keys.some((k:KeyRow)=>k.status==='active'));
    } catch(e) {setError(e instanceof Error?e.message:'요청을 완료하지 못했습니다. 키 목록과 서버 연결 상태를 확인하세요.');}
    finally {setBusy(false);}
  }
  function create(e:FormEvent){e.preventDefault();void mutate(base,{name});}
  async function copy(){
    try {await navigator.clipboard.writeText(secret);setCopied(true);}
    catch {setError('자동 복사에 실패했습니다. 표시된 키를 직접 복사하세요.');}
  }
  return <section id="api-keys" className="panel beta-projects" aria-label="프로젝트 API Keys">
    <h2>API 키 만들기</h2><p>API 키는 내 Agent가 WHEN2WARN 서버에 연결할 때 사용하는 비밀번호 같은 키입니다. 키를 가진 사람은 이 프로젝트에 기록을 보낼 수 있으니 공유하지 마세요.</p>
    {error&&<p role="alert">{error}</p>}
    <form onSubmit={create}><label>API Key 이름<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
      <button className="button" aria-busy={busy} disabled={busy||testing||!name.trim()}>API Key 생성</button></form>
    {secret&&<div className="key-once" role="status"><h3>키가 만들어졌습니다.</h3><p>아직 Python이나 코드를 몰라도 괜찮습니다. 먼저 아래 버튼으로 연결을 확인하세요.</p><strong>지금 키를 복사하세요. 닫거나 새로고침하면 다시 볼 수 없습니다.</strong>
      <pre aria-label="한 번만 표시되는 API Key">{secret}</pre>
      <button className="button" onClick={copy}>{copied?'복사됨':'키 복사'}</button>
      <button className="button secondary" disabled={testing} onClick={()=>setSecret('')}>키 표시 닫기</button><ConnectionTest projectId={projectId} apiKey={secret} onBusyChange={setTesting} onComplete={onConnectionComplete}/><button className="text-button" disabled={testing} onClick={()=>setSecret('')}>나중에 하기</button></div>}
    {!secret&&keys.some(k=>k.status==='active')&&<p className="key-lost" role="status">기존 키의 전체 값은 다시 볼 수 없습니다. 연결 테스트를 하려면 위에서 새 키를 만들어 주세요. 사용하지 않는 기존 키는 아래에서 폐기할 수 있습니다.</p>}
    {!keys.length?<p>생성한 API Key가 없습니다.</p>:<div className="table-scroll"><table className="run-table">
      <thead><tr><th>이름 / 공개 식별자</th><th>생성 시각</th><th>최근 사용</th><th>상태</th><th>관리</th></tr></thead>
      <tbody>{keys.map(k=><tr key={k.api_key_id}><td>{k.name}<code className="table-sub">{k.key_prefix}</code></td>
        <td>{k.created_at}</td><td>{k.last_used_at||'사용 전'}</td><td>{k.status==='active'?'활성':'폐기됨'}</td>
        <td>{k.status==='active'&&<><button className="button secondary" disabled={busy||testing} onClick={()=>void mutate(base+'/'+k.api_key_id+'/rotate')}>교체 · 기존 키 즉시 폐기</button>
        <button className="button secondary" disabled={busy||testing} onClick={()=>void mutate(base+'/'+k.api_key_id+'/revoke')}>폐기</button></>}</td></tr>)}</tbody>
    </table></div>}
    <p>키는 브라우저 저장소에 자동 저장하지 않습니다. 외부 Agent가 개입을 실행하며, WHEN2WARN 응답은 판단·추천입니다.</p>
  </section>;
}
