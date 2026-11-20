import { Privacy, Security } from './public/PolicyPages';
import { API_BASE } from './api/client';
import { Icon, Limitations, RenderBoundary } from './components/ui';
import { RunList } from './pages/RunList';
import { RunDetail } from './pages/RunDetail';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { interceptLinkClick, confirmLeave, NAVIGATE_EVENT, setPreloader, SPA_PATHS } from './statguard/navigation';
import { Landing, Demo, HowItWorks, Quickstart, PublicNotFound } from './public/PublicPages';
const BetaApp=lazy(()=>import('./auth/BetaApp'));
/** A lazy page that renders synchronously once its module has been preloaded, so in-place navigation never flashes a loading screen. */
function lazyPage(loader:()=>Promise<{default:ComponentType}>){
  let Loaded:ComponentType|null=null;
  const load=()=>loader().then(m=>{Loaded=m.default;return m;});
  const Lazy=lazy(load);
  const Page=()=>Loaded?<Loaded/>:<Lazy/>;
  return Object.assign(Page,{preload:load});
}
const StatGuardWorkspace=lazyPage(()=>import('./statguard/StatGuardWorkspace'));
const BenchmarkResults=lazyPage(()=>import('./statguard/BenchmarkResults'));
const StatGuardHome=lazyPage(()=>import('./statguard/StatGuardHome'));
const PRELOAD:Record<string,()=>Promise<unknown>>={'/':StatGuardHome.preload,'/statguard':StatGuardWorkspace.preload,'/statguard/results':BenchmarkResults.preload};
setPreloader(path=>PRELOAD[path]?.()??Promise.resolve());
const currentPath=()=>window.location.pathname.replace(/\/$/,'')||'/';
const sgLoading={minHeight:'100vh',padding:24,background:'#f3f6f9',color:'#193347'} as const;

export default function App(){
  const [path,setPath]=useState(currentPath);
  useEffect(()=>{
    let shown=currentPath();
    const sync=()=>{shown=currentPath();setPath(shown);};
    const back=()=>{if(currentPath()!==shown&&!confirmLeave()){window.history.pushState(null,'',shown);return;}sync();};
    window.addEventListener(NAVIGATE_EVENT,sync);window.addEventListener('popstate',back);
    return()=>{window.removeEventListener(NAVIGATE_EVENT,sync);window.removeEventListener('popstate',back);};
  },[]);
  const spa=SPA_PATHS.includes(path);
  useEffect(()=>{if(!spa)return;document.addEventListener('click',interceptLinkClick);return()=>document.removeEventListener('click',interceptLinkClick);},[spa]);
  // StatGuard pages set their own titles; the preserved WHEN2WARN pages keep the original one.
  const legacy=path!=='/'&&!path.startsWith('/statguard');
  useEffect(()=>{if(legacy)document.title='WHEN2WARN · Agent Reliability';},[legacy]);
  if(import.meta.env.DEV && import.meta.env.VITE_LOCAL_RESEARCH_MODE === 'true' && path.startsWith('/runs'))return <LocalDashboard/>;
  if(path==='/')return <Suspense fallback={<main role="status" style={sgLoading}>StatGuard-KR을 불러오는 중…</main>}><StatGuardHome/></Suspense>;
  if(path==='/when2warn')return <Landing/>;
  if(path==='/statguard/results')return <Suspense fallback={<main role="status" style={sgLoading}>실험 결과를 불러오는 중…</main>}><BenchmarkResults/></Suspense>;
  if(path==='/statguard')return <Suspense fallback={<main role="status" style={sgLoading}>CSV 화면을 준비하는 중…</main>}><StatGuardWorkspace/></Suspense>;
  if(path==='/privacy')return <Privacy/>;
  if(path==='/security')return <Security/>;
  if(path==='/demo')return <Demo/>;
  if(path==='/how-it-works')return <HowItWorks/>;
  if(path==='/docs/quickstart'||path==='/connect')return <Quickstart/>;
  if(['/login','/signup','/ask','/projects','/runs'].includes(path)||/^\/(runs|project)\/[^/]+$/.test(path))
    return <Suspense fallback={<main role="status">로그인 화면을 준비하는 중…</main>}><BetaApp/></Suspense>;
  return <PublicNotFound/>;
}

function LocalDashboard(){
  const match=window.location.pathname.match(/^\/runs\/([^/]+)\/?$/);
  let id:string|null=null;try{id=match?decodeURIComponent(match[1]):null;}catch{id=null;}
  return <div className="app-shell"><aside className="sidebar"><a href="/runs" className="brand"><span className="brand-symbol"><i/><i/><i/><i/></span><span>WHEN<span className="brand-two">2</span>WARN<small>AGENT RELIABILITY</small></span></a><div className="workspace"><span className="workspace-icon">W</span><div><strong>Local workspace</strong><small>개발 환경</small></div><span className="local-dot"/></div><p className="nav-label">OBSERVE</p><nav><a className="nav-item active" href="/runs" aria-current="page"><Icon name="grid"/><span>실행 기록</span><span className="nav-arrow">›</span></a><a className="nav-item" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer"><Icon name="activity"/><span>로컬 API 문서</span><span className="nav-arrow">↗</span></a></nav><div className="sidebar-bottom"><div className="read-only"><span className="square"/>읽기 전용 대시보드</div><p>Telemetry → Evidence → Decision</p><span className="mono">DASHBOARD v0.1</span></div></aside><div className="main-shell"><header className="topbar"><div><span className="muted">워크스페이스</span><span className="slash">/</span><strong>실행 모니터</strong>{id&&<><span className="slash">/</span><span className="muted">실행 상세</span></>}</div><span className="environment-chip"><span/>LOCAL MVP</span></header><main><RenderBoundary>{id?<RunDetail id={id}/>:<RunList/>}</RenderBoundary><Limitations/></main></div></div>;
}
