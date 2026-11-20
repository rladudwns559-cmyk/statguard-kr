import { DeleteData } from './DeleteData';
import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { apiRequest, setTokenProvider } from '../api/cloudClient';
import { RunList } from '../pages/RunList';
import { RunDetail } from './BetaRunDetail';
import { RenderBoundary } from '../components/ui';
import { BrandMark } from '../components/Brand';
import { Onboarding } from './Onboarding';
import ChatWorkspace from '../chat/ChatWorkspace';

function AuthLoading({text}:{text:string}){return <main className="beta-login auth-loading" role="status"><div className="skeleton heading" aria-hidden="true"/><div className="skeleton card" aria-hidden="true"/><p>{text}</p><p>서버를 시작하는 중일 수 있습니다. 처음 요청은 잠시 걸릴 수 있습니다.</p></main>;}

type Project = { project_id: string; name: string; status: string };

export function Login() {
  const [email,setEmail]=useState(''), [password,setPassword]=useState('');
  const [signup,setSignup]=useState(()=>window.location.pathname==='/signup'), [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  async function submit(e:FormEvent) {
    e.preventDefault(); if(!supabase)return;
    setBusy(true); setMessage('');
    try {
      const result=signup ? await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+'/login'}})
        : await supabase.auth.signInWithPassword({email,password});
      if(result.error) setMessage('인증에 실패했습니다. 입력 정보와 이메일 확인 상태를 확인하세요.');
      else if(signup && !result.data.session) setMessage('가입 요청을 접수했습니다. 이메일의 확인 링크를 확인하세요. 도착까지 시간이 걸릴 수 있습니다. 스팸함도 확인하고 잠시 후 다시 시도하세요.');
    } catch { setMessage('인증 서비스에 연결할 수 없습니다. 다시 시도하세요.'); }
    finally {setBusy(false);setPassword('');}
  }
  return <main className="beta-login"><div className="auth-brand-art" aria-hidden="true"><BrandMark/><span>OBSERVE / DECIDE / VERIFY</span><strong>Ask. Compare.<br/>Understand.</strong><p>GPT 답변과 이를 뒷받침하는 근거를 함께 살펴보세요.</p><div className="auth-signal-line"/></div><div className="auth-form-panel"><a className="back-link" href="/">← 제품 소개로</a><p className="eyebrow">WHEN2WARN PUBLIC BETA</p><h1>{signup?'회원가입':'로그인'}</h1>
    {!supabase ? <p role="alert">Supabase 공개 연결 설정이 필요합니다. 설정 후 다시 열어주세요.</p> :
    <form onSubmit={submit}><label>이메일<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>비밀번호<input type="password" required minLength={8} autoComplete={signup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button className="button" aria-busy={busy} disabled={busy}>{busy?'확인 중…':signup?'가입하기':'로그인하기'}</button>
      <button type="button" className="button secondary" onClick={()=>{setSignup(!signup);setMessage('');window.history.replaceState(null,'',signup?'/login':'/signup');}}>{signup?'로그인으로 돌아가기':'계정 만들기'}</button></form>}
    {message&&<p role="status">{message}</p>}
    <p>비밀번호·API 비밀키·개인정보를 Agent 실행 기록에 입력하지 마세요.</p>
    <p><a className="text-button" href="/demo">로그인 없이 데모 보기</a> · <a className="text-button" href="/docs/quickstart">Agent 연결 안내</a></p>
  </div></main>;
}

function Projects({session}:{session:Session}) {
  const [projects,setProjects]=useState<Project[]>([]), [selected,setSelected]=useState('');
  const [loading,setLoading]=useState(true), [error,setError]=useState(''), [name,setName]=useState(''), [busy,setBusy]=useState(false);
  const [detail,setDetail]=useState(()=>window.location.pathname.match(/^\/runs\/([^/]+)\/?$/)?.[1] || '');
  const showingRuns=window.location.pathname.startsWith('/runs');
  useEffect(()=>{
    if(selected&&window.location.hash==='#api-keys')document.getElementById('api-keys')?.scrollIntoView?.();
  },[selected]);
  useEffect(()=>{
    const controller=new AbortController();
    apiRequest('/api/v1/projects',{signal:controller.signal}).then(async value=>{
      if(!Array.isArray(value.projects))throw new Error();
      const requested=window.location.pathname.match(/^\/project\/([^/]+)$/)?.[1] || new URLSearchParams(window.location.search).get('project');
      if(requested&&!value.projects.some((p:Project)=>p.project_id===requested))throw new Error();
      let selectedId=requested||value.projects[0]?.project_id || '';
      if(detail){
        const target=await apiRequest('/api/v1/runs/'+encodeURIComponent(detail),{signal:controller.signal});
        if(!value.projects.some((p:Project)=>p.project_id===target.project_id))throw new Error();
        selectedId=target.project_id;
      }
      if(!controller.signal.aborted){setProjects(value.projects);setSelected(selectedId);}
    }).catch(()=>{if(!controller.signal.aborted)setError('프로젝트를 불러올 수 없습니다. 다시 로그인하거나 새로고침하세요.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[session.user.id]);
  async function create(e:FormEvent) {
    e.preventDefault();setBusy(true);setError('');
    try {
      const project=await apiRequest('/api/v1/projects',{method:'POST',body:JSON.stringify({name})});
      setProjects(old=>[...old,project]);setSelected(project.project_id);setName('');setDetail('');
      window.history.replaceState(null,'','/projects');
    } catch(e) {setError(e instanceof Error?e.message:'프로젝트를 만들 수 없습니다. 다시 시도하세요.');}
    finally {setBusy(false);}
  }
  async function signOut() {
    // Local sign-out removes this browser session even when global revocation is unavailable.
    try {const result=await supabase?.auth.signOut({scope:'local'});if(result?.error)throw result.error;} catch {setError('로그아웃에 실패했습니다. 다시 시도하세요.');}
  }
  if(loading)return <AuthLoading text="프로젝트를 불러오는 중…"/>;
  return <div className="beta-shell"><header className="beta-header"><a className="beta-wordmark" href="/"><BrandMark/>WHEN2WARN</a><span>PUBLIC BETA · {session.user.email}</span>
    <nav aria-label="내 작업 메뉴"><a href="/ask">AI 답변 검증</a><a href="/statguard">CSV 수치 검증</a><span>Developer Console</span><a href="/projects">프로젝트</a><a href={selected?'/runs?project='+encodeURIComponent(selected):'/runs'}>Runs / Dashboard</a><a href={selected?'/projects?project='+encodeURIComponent(selected)+'#api-keys':'/projects'}>API Keys</a><a href="/docs/quickstart">연결 안내</a></nav>
    <button className="button secondary" onClick={signOut}>로그아웃</button></header>
    <main><section className="panel beta-projects">{showingRuns?<p className="eyebrow">현재 프로젝트</p>:<h1>내 프로젝트</h1>}{error&&<p role="alert">{error}</p>}
    {!projects.length&&!error&&<div className="first-project"><h2>첫 프로젝트를 만들어 시작하세요.</h2><p>프로젝트는 실행 기록을 모아두는 작업 공간입니다. 프로젝트 → API 키 → 브라우저 연결 테스트 → 첫 실행 확인 순서로 시작하세요. Python 설치는 필요하지 않습니다.</p></div>}
    {!!projects.length&&<label>프로젝트 선택<select value={selected} onChange={e=>{setSelected(e.target.value);setDetail('');window.history.replaceState(null,'',showingRuns?'/runs':'/projects');}}>
      {projects.map(p=><option key={p.project_id} value={p.project_id}>{p.name}{p.status==='archived'?' (보관됨)':''}</option>)}</select></label>}
    <form onSubmit={create}><label>새 프로젝트 이름<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
    <button className="button" aria-busy={busy} disabled={busy||!name.trim()}>프로젝트 만들기</button></form></section>
    {selected&&!showingRuns&&<Onboarding key={session.user.id+':'+selected} projectId={selected}/>}
    <div id="dashboard"><RenderBoundary key={session.user.id+':'+selected+':'+detail}>{detail?<RunDetail id={detail}/>:selected&&window.location.pathname.startsWith('/runs')?<RunList key={selected} projectId={selected}/>:null}</RenderBoundary></div>
    {!showingRuns&&<DeleteData projectId={selected} projectName={projects.find(p=>p.project_id===selected)?.name||''} onProjectDeleted={()=>{setProjects(old=>old.filter(p=>p.project_id!==selected));setSelected('');setDetail('');window.history.replaceState(null,'','/projects');}} onAccountDeleted={async()=>{await supabase?.auth.signOut({scope:'local'});window.location.assign('/');}}/>}
    <footer className="limitations"><div><strong>제품 상태 · Public Beta Foundation</strong><p>INTERVENE는 개입 추천입니다. 실제 실행과 복구 여부는 별도의 실행·검증 기록에서 확인하세요. q_recovery는 실험적 점수, p_failure는 약한 참고값입니다. Host 정보는 발신자 주장(source-asserted)이며 사용자 인증이 실행 사실 자체를 보증하지는 않습니다.</p></div></footer></main></div>;
}

export default function BetaApp() {
  const [session,setSession]=useState<Session|null>(null), [loading,setLoading]=useState(true);
  const [expired,setExpired]=useState(false);
  useEffect(()=>{
    if(!supabase){setLoading(false);return;}
    let active=true, changed=false;
    const timeout=setTimeout(()=>{if(active)setLoading(false);},22000);
    setTokenProvider(async()=>{const {data,error}=await supabase!.auth.getSession(); if(error)throw error;return data.session?.access_token || null;});
    const {data}=supabase.auth.onAuthStateChange((_event,next)=>{
      changed=true;if(active){setSession(next);if(next)setExpired(false);setLoading(false);}
    });
    supabase.auth.getSession().then(({data,error})=>{
      if(active&&!changed){setSession(error?null:data.session);setLoading(false);}
    }).catch(()=>{if(active){setSession(null);setLoading(false);}});
    const unauthorized=()=>{setExpired(true);setSession(null);supabase!.auth.signOut({scope:'local'}).catch(()=>{});};
    window.addEventListener('when2warn:unauthorized',unauthorized);
    return ()=>{clearTimeout(timeout);active=false;data.subscription.unsubscribe();setTokenProvider(null);window.removeEventListener('when2warn:unauthorized',unauthorized);};
  },[]);
  useEffect(()=>{
    if(loading)return;
    if(!session && !['/login','/signup'].includes(window.location.pathname))window.history.replaceState(null,'','/login');
    else if(session && ['/login','/signup'].includes(window.location.pathname))window.history.replaceState(null,'','/ask');
  },[loading,session]);
  if(loading)return <AuthLoading text="로그인 상태 확인 중…"/>;
  return session?(['/ask','/login','/signup'].includes(window.location.pathname)?<ChatWorkspace key={session.user.id} onSignOut={async()=>{const r=await supabase?.auth.signOut({scope:'local'});if(r?.error)throw r.error;}}/>:<Projects key={session.user.id} session={session}/>):<>{expired&&<p className="auth-notice" role="alert">로그인 세션이 만료되었거나 유효하지 않습니다. 다시 로그인하세요.</p>}<Login/></>;
}
