import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../api/cloudClient';
import { streamQuestion } from './chatClient';
import { BrandMark } from '../components/Brand';
import { DeleteData } from '../auth/DeleteData';
import './chat.css';

type Claim={claim_id:string;claim_text:string;source_sentence:string;verification_status:string;reason:string;conflict:boolean;stale:boolean;evidence_ids:string[]};
type Evidence={evidence_id:string;url:string;title:string;domain:string;retrieved_at:string;excerpt:string;source_type:string};
type Turn={turn_id:string;prompt:string;answer:string;state:string;notice:string;claims:Claim[];evidence:Evidence[]};
type Conversation={conversation_id:string;title:string};
const phases:Record<string,string>={WAITING:'질문을 접수했습니다',ANSWERING:'답변 생성 중',EXTRACTING_CLAIMS:'검증할 주장 찾는 중',SEARCHING_EVIDENCE:'근거 탐색 중',CHECKING_SUPPORT:'근거와 비교 중',COMPLETE:'검증 절차 완료',ERROR:'일부 처리를 완료하지 못했습니다'};
const statuses:Record<string,string>={SUPPORTED:'근거 확인',PARTIALLY_SUPPORTED:'부분 근거',NOT_SUPPORTED:'반대 근거',INSUFFICIENT_EVIDENCE:'근거 부족',NOT_CHECKABLE:'검증 대상 아님'};
export function safeSource(url:string){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}

export function VerificationPanel({turn,onClaim}:{turn?:Turn;onClaim?:(claim:Claim)=>void}){
  const busy=turn&&!['COMPLETE','ERROR'].includes(turn.state);
  return <section className="verify-panel" aria-label="답변 근거 확인"><div className="verify-heading"><p className="eyebrow">WHEN2WARN VERIFY</p><h2>어떤 근거가 있나요?</h2><p>확인한 출처와 주장을 비교합니다. 사실을 보장하지 않습니다.</p></div>
    <p role="status">{turn?phases[turn.state]:'질문하면 이곳에 근거가 표시됩니다.'}</p>
    {turn?.notice&&<p className="chat-notice">{turn.notice}</p>}
    {!!turn?.claims.length&&<p>{turn.claims.length}개 주장 · {turn.claims.filter(c=>c.verification_status==='SUPPORTED').length}개 근거 확인 · {turn.claims.filter(c=>c.verification_status==='PARTIALLY_SUPPORTED').length}개 부분 근거 · {turn.claims.filter(c=>c.verification_status==='INSUFFICIENT_EVIDENCE').length}개 근거 부족</p>}
    {turn?.claims.map(claim=><article className="claim-card" id={'claim-'+claim.claim_id} key={claim.claim_id} tabIndex={-1}>
      <span className={'claim-status status-'+claim.verification_status} title={claim.verification_status==='SUPPORTED'?'확인한 출처가 이 주장을 뒷받침합니다.':'현재 확보한 근거 기준의 상태입니다.'}>{busy?'확인 중':statuses[claim.verification_status]||'근거 부족'}</span>
      <h3><button className="claim-focus" onClick={()=>onClaim?.(claim)}>{claim.claim_text}</button></h3><p>{claim.reason}</p>
      {claim.conflict&&<p className="chat-notice">출처 간 내용이 충돌합니다.</p>}{claim.stale&&<p className="chat-notice">자료의 최신성을 충분히 확인하지 못했습니다.</p>}
      {turn.evidence.filter(e=>claim.evidence_ids.includes(e.evidence_id)).map(e=><details key={e.evidence_id}><summary>근거 보기 · {e.domain}</summary><strong>{e.title}</strong><p>{e.domain} · {e.source_type==='OFFICIAL'?'공식 도메인':'출처 유형 미확인'}</p><p>가져온 시각: {new Date(e.retrieved_at).toLocaleString('ko-KR')}</p><blockquote>{e.excerpt}</blockquote>{safeSource(e.url)&&<a href={e.url} target="_blank" rel="noopener noreferrer">출처 원문 열기 ↗</a>}</details>)}
    </article>)}
  </section>;
}

export default function ChatWorkspace({onSignOut}:{onSignOut:()=>Promise<void>}){
  const [history,setHistory]=useState<Conversation[]>([]),[cid,setCid]=useState(''),[turns,setTurns]=useState<Turn[]>([]);
  const [prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('');
  const [cap,setCap]=useState<{enabled:boolean;notice:string;prompt_chars:number;daily_limit:number}|null>(null);
  const [tab,setTab]=useState('chat'),[highlight,setHighlight]=useState(''),[deleteConfirm,setDeleteConfirm]=useState(false);
  const aborter=useRef<AbortController|null>(null),loadGeneration=useRef(0);
  async function refreshHistory(){const data=await apiRequest('/api/v1/chat/conversations');setHistory(data.conversations);}
  useEffect(()=>{
    const ctl=new AbortController();
    Promise.all([apiRequest('/api/v1/chat/capabilities',{signal:ctl.signal}),apiRequest('/api/v1/chat/conversations',{signal:ctl.signal})])
      .then(async([c,h])=>{if(ctl.signal.aborted)return;setCap(c);setHistory(h.conversations);
        const current=new URLSearchParams(window.location.search).get('conversation');
        if(current&&h.conversations.some((v:Conversation)=>v.conversation_id===current)){
          const d=await apiRequest('/api/v1/chat/conversations/'+encodeURIComponent(current),{signal:ctl.signal});
          if(!ctl.signal.aborted){setCid(current);setTurns(d.turns);setSelected(d.turns.at(-1)?.turn_id||'');}
        }
      }).catch(()=>{if(!ctl.signal.aborted)setError('대화를 불러오지 못했습니다. 새로고침해 주세요.');});
    return()=>{ctl.abort();aborter.current?.abort();loadGeneration.current++;};
  },[]);
  async function open(id:string){
    if(busy)return;
    const generation=++loadGeneration.current;setError('');setDeleteConfirm(false);
    try{const d=await apiRequest('/api/v1/chat/conversations/'+id);if(generation!==loadGeneration.current)return;setCid(id);setTurns(d.turns);setSelected(d.turns.at(-1)?.turn_id||'');window.history.replaceState(null,'','/ask?conversation='+encodeURIComponent(id));}
    catch{if(generation===loadGeneration.current)setError('대화를 열 수 없습니다.');}
  }
  function newChat(){if(busy)return;loadGeneration.current++;setCid('');setTurns([]);setSelected('');setPrompt('');setError('');setDeleteConfirm(false);window.history.replaceState(null,'','/ask');}
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||aborter.current||!prompt.trim()||!cap?.enabled)return;
    const controller=new AbortController();aborter.current=controller;loadGeneration.current++;
    const question=prompt;setBusy(true);setError('');setPrompt('');setTab('chat');
    const timer=setTimeout(()=>controller.abort(),200000);
    try{
      let id=cid;
      if(!id){const created=await apiRequest('/api/v1/chat/conversations',{method:'POST',signal:controller.signal});id=created.conversation_id;setCid(id);window.history.replaceState(null,'','/ask?conversation='+encodeURIComponent(id));}
      await streamQuestion(id,question,crypto.randomUUID(),controller.signal,event=>{
        if(event.type==='snapshot'){
          const turn=event.turn as Turn;setTurns(old=>old.some(t=>t.turn_id===turn.turn_id)?old.map(t=>t.turn_id===turn.turn_id?turn:t):[...old,turn]);setSelected(turn.turn_id);
        }else if(event.type==='delta'){setTurns(old=>old.map(t=>t.turn_id===event.turn_id?{...t,answer:t.answer+event.text}:t));}
      });
      await refreshHistory();
    }catch(e){setError(e instanceof Error&&!controller.signal.aborted?e.message:'연결이 중단되었습니다. 대화 기록에서 저장된 답변을 확인해 주세요.');}
    finally{clearTimeout(timer);aborter.current=null;setBusy(false);}
  }
  async function remove(){
    try{await apiRequest('/api/v1/chat/conversations/'+cid,{method:'DELETE',body:JSON.stringify({confirmation:'DELETE'})});newChat();await refreshHistory();}
    catch{setError('대화를 삭제하지 못했습니다. 처리 중이면 완료 후 다시 시도하세요.');}
  }
  const chosen=turns.find(t=>t.turn_id===selected)||turns.at(-1);
  return <div className="chat-shell"><header className="chat-header"><a href="/" className="public-brand"><BrandMark/>WHEN2WARN</a><nav aria-label="서비스 선택"><a href="/ask" aria-current="page">AI 답변 검증</a><a href="/statguard">CSV 수치 검증</a><a href="/projects">Developer Console</a></nav><button onClick={()=>onSignOut().catch(()=>setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'))}>로그아웃</button></header>
    <div className="chat-intro"><p className="eyebrow">ASK / COMPARE / UNDERSTAND</p><h1>답변을 읽고, 근거를 확인하세요.</h1><p>GPT가 답변합니다. WHEN2WARN은 답변의 검증 가능한 주장을 확인된 출처와 비교합니다.</p></div>
    <main className="chat-layout"><aside className="chat-history" aria-label="최근 대화"><button className="button" disabled={busy} onClick={newChat}>새 대화</button><h2>최근 대화</h2>{history.map(h=><button disabled={busy} key={h.conversation_id} aria-pressed={cid===h.conversation_id} onClick={()=>void open(h.conversation_id)}>{h.title}</button>)}
      {cid&&!busy&&<button onClick={()=>setDeleteConfirm(true)}>현재 대화 삭제</button>}
      {deleteConfirm&&<div role="group" aria-label="대화 삭제 확인"><p>이 대화와 검증 기록을 영구 삭제할까요?</p><button onClick={()=>void remove()}>영구 삭제</button><button onClick={()=>setDeleteConfirm(false)}>취소</button></div>}
    </aside><div className="chat-mobile-tabs" role="group" aria-label="화면 선택"><button aria-pressed={tab==='chat'} onClick={()=>setTab('chat')}>대화</button><button aria-pressed={tab==='verify'} onClick={()=>setTab('verify')}>근거 확인</button></div>
    <section className={'chat-thread mobile-'+(tab==='chat'?'show':'hide')} aria-label="GPT 대화">
      {!turns.length&&<div className="chat-empty"><h2>무엇이 궁금한가요?</h2><p>예: 대한민국 대통령 임기는 몇 년인가요?</p><p>답변과 출처를 함께 살펴보세요. 확인할 수 없는 부분은 그대로 알려드립니다.</p></div>}
      {turns.map(t=><article key={t.turn_id} className="chat-turn"><p className="chat-question">{t.prompt}</p><p className="eyebrow">GPT 답변</p><div className="chat-answer" id={'answer-'+t.turn_id}>{highlight&&t.turn_id===selected&&t.answer.includes(highlight)?<>{t.answer.slice(0,t.answer.indexOf(highlight))}<mark>{highlight}</mark>{t.answer.slice(t.answer.indexOf(highlight)+highlight.length)}</>:t.answer||'답변 생성 중…'}</div><button disabled={!t.claims.length} onClick={()=>{setSelected(t.turn_id);setTab('verify');}}>이 답변의 근거 보기</button></article>)}
      {error&&<p role="alert" className="chat-notice">{error}</p>}{cap&&!cap.enabled&&<p role="status" className="chat-notice">{cap.notice}</p>}
      <form onSubmit={submit} className="chat-composer"><label htmlFor="chat-question">질문<textarea id="chat-question" name="question" rows={3} maxLength={cap?.prompt_chars||3000} value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={busy||!cap?.enabled} placeholder="궁금한 내용을 입력하세요"/></label><div><small>{prompt.length}/{cap?.prompt_chars||3000} · 하루 최대 {cap?.daily_limit||10}개 질문</small><button className="button" disabled={busy||!prompt.trim()||!cap?.enabled}>{busy?'답변과 근거 확인 중…':'질문하기'}</button></div><p>질문과 최근 대화가 OpenAI로 전송되고, 검색에 필요한 주장은 웹 검색에 사용됩니다. 민감정보를 입력하지 마세요. <a href="/privacy">데이터 처리 안내</a></p></form>
    </section><div className={'chat-verification mobile-'+(tab==='verify'?'show':'hide')}><VerificationPanel turn={chosen} onClaim={c=>{setHighlight(c.source_sentence);setTab('chat');document.getElementById('answer-'+chosen?.turn_id)?.scrollIntoView?.({block:'center'});}}/></div></main>
    <details className="chat-account"><summary>계정 및 데이터 관리</summary><DeleteData projectId="" projectName="" onProjectDeleted={()=>{}} onAccountDeleted={onSignOut}/></details>
  </div>;
}
