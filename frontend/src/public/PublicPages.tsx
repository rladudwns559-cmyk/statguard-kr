import { BeginnerGuide } from './BeginnerGuide';
import { useEffect, useState, type ReactNode } from 'react';
import content from './content.json';
import './public.css';
import { useSectionMotion } from '../components/motion';
import { BrandMark } from '../components/Brand';
import { HeroSection, ProductLoop, ProductLoopSection, LiveDemoPreview, ArchitectureMap, BenefitsSection, EvaluationSection, DeveloperQuickstart, TrustSection, CTASection } from './LandingSections';

export function PublicShell({children}:{children:ReactNode}) {
  useSectionMotion();
  const [open,setOpen]=useState(false),[scrolled,setScrolled]=useState(false);
  useEffect(()=>{const update=()=>setScrolled(window.scrollY>24);update();window.addEventListener('scroll',update,{passive:true});return()=>window.removeEventListener('scroll',update);},[]);
  useEffect(()=>{
    try {document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView?.();} catch {/* Invalid fragments do not block public content. */}
  },[]);
  return <div className="public-site"><a className="skip-link" href="#public-main">본문으로 건너뛰기</a>
    <header className={"public-header"+(scrolled?" is-scrolled":"")}><a className="public-brand" href="/" aria-label="WHEN2WARN 홈"><BrandMark/>WHEN<span>2</span>WARN</a>
    <button className="menu-toggle" aria-label={open?"메뉴 닫기":"메뉴 열기"} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}} aria-expanded={open} aria-controls="public-nav" onClick={()=>setOpen(!open)}>메뉴 {open?'닫기':'열기'}</button>
    <nav id="public-nav" aria-label="제품 메뉴" className={open?'is-open':''} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);document.querySelector<HTMLButtonElement>('.menu-toggle')?.focus();}}}>
      <a href="/ask">AI 답변 검증</a><a href="/projects">Developer Console</a><a href="/#product">제품</a><a aria-current={window.location.pathname==='/how-it-works'?'page':undefined} href="/how-it-works">작동 방식</a><a aria-current={window.location.pathname==='/demo'?'page':undefined} href="/demo">데모</a><a aria-current={window.location.pathname==='/docs/quickstart'?'page':undefined} href="/docs/quickstart">연결 안내</a>
      <a href="/login">로그인</a><a className="button" href="/signup">시작하기 <span aria-hidden="true">↗</span></a>
    </nav></header>
    <main id="public-main">{children}</main>
    <footer className="public-footer"><a className="public-brand" href="/">WHEN2WARN</a><p>Agent Reliability · Public Beta</p>
      <div><a href="/demo">기록된 데모</a><a href="/docs/quickstart#limitations">현재 한계</a><a href="/privacy">개인정보·삭제</a><a href="/security">보안</a><a href="/signup">시작하기</a></div>
      <small>FOREWARN-AI research project · 연구 기반 Public Beta · 모든 실패의 탐지나 복구를 보장하지 않습니다.</small></footer>
  </div>;
}

function Intro({tag,title,children}:{tag:string;title:string;children:ReactNode}) {
  return <div className="public-intro"><p className="eyebrow">{tag}</p><h1>{title}</h1><p>{children}</p></div>;
}
export function Landing(){return <PublicShell><HeroSection/><ProductLoopSection/><LiveDemoPreview/><ArchitectureMap/><BenefitsSection/><EvaluationSection/><DeveloperQuickstart/><TrustSection/><CTASection/></PublicShell>;}

export function HowItWorks(){
  return <PublicShell><Intro tag="HOW IT WORKS" title="관찰한 근거를 판단으로 연결합니다.">Agent의 실행 권한은 그대로 유지하면서, 실행 중 어떤 신호가 있었는지 기록합니다.</Intro>
    <section className="public-section"><ProductLoop/><ol className="how-steps">{[
      ['Agent 연결','프로젝트를 만든 뒤 API Key를 생성합니다.'],
      ['실행 기록 전송','순서가 있는 행동과 반환된 결과를 보냅니다.'],
      ['근거 확인','완료된 판단 group에서 오류와 반복을 평가합니다.'],
      ['판단 수신','CONTINUE / REVIEW / INTERVENE와 이유를 받습니다.'],
      ['Agent가 행동','필요한 수정은 사용자 Agent가 자체 권한으로 실행합니다.'],
      ['Dashboard 확인','같은 run의 기록·판단·실행/검증 상태를 확인합니다.'],
    ].map(([title,text],i)=><li key={title}><span>0{i+1}</span><div><h2>{title}</h2><p>{text}</p></div></li>)}</ol>
    <div className="architecture-note"><code>Your Agent → WHEN2WARN API → Reliability Engine → Decision<br/>→ Your Agent executes → Telemetry returns → Dashboard</code><p>추천과 실행은 별도입니다. 이 API가 사용자의 컴퓨터나 브라우저를 원격 실행하지 않습니다.</p></div>
    <div className="public-actions"><a className="button" href="/demo">실제 기록으로 보기</a><a className="button secondary" href="/signup">내 Agent 연결하기</a></div></section></PublicShell>;
}

export function Demo(){
  const [step,setStep]=useState(0),demo=content.demo;
  const stages=[
    ['Agent action','제출 버튼에 fill 요청','버튼을 입력란으로 다룬 행동입니다.'],
    ['Host error','도구가 오류를 반환','버튼에는 텍스트를 입력할 수 없다는 도구 결과가 기록됐습니다.'],
    ['Runtime evidence','STRONG','행동과 연결된 명시적 오류가 강한 runtime evidence가 됐습니다.'],
    ['Decision','INTERVENE','오류 근거와 실행 가능한 후보를 바탕으로 개입을 추천했습니다.'],
    ['Recommended action','fill → click','같은 제출 버튼을 클릭하도록 다음 행동을 변경합니다.'],
    ['Execution','EXECUTED','통제된 로컬 데모의 BrowserGym adapter가 실제 클릭을 실행했습니다.'],
    ['Verification','VERIFIED_RECOVERY','연결된 행동 결과와 MiniWoB terminal positive reward 기준으로 확인했습니다.'],
  ];
  return <PublicShell><Intro tag="RECORDED VERIFIED DEMO" title="오류가 추천으로, 실행과 검증 기록으로.">Replay of a verified local BrowserGym run · 실시간 cloud 실행이 아닌, 실제 검증된 로컬 기록의 replay입니다.</Intro>
    <section className="demo-workspace"><aside><p className="eyebrow">BROWSERGYM / MINIWOB++</p><h2>로그인 화면의 제출 행동</h2><p>{demo.goal}</p><ol className="demo-stages" aria-label="데모 단계">{stages.map(([title,_,description],i)=><li key={title}><button onClick={()=>setStep(i)} aria-current={step===i?'step':undefined} aria-label={title+' 단계'}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{title}</strong><small>{i===step?description:'기록된 단계 보기'}</small></div></button></li>)}</ol></aside>
    <article className="demo-detail" aria-live="polite"><div className="demo-inspector-content" key={step}><p className="eyebrow">STEP {String(step+1).padStart(2,'0')} / 07 · RECORDED REPLAY</p><h2>{stages[step][1]}</h2><p>{stages[step][2]}</p>
      {step===0&&<pre><code>{JSON.stringify(demo.events[0],null,2)}</code></pre>}
      {step===1&&<><p className="demo-error">버튼은 입력 가능한 요소가 아닙니다.</p><pre><code>{demo.events[1].error}</code></pre></>}
      {step===2&&<pre><code>{JSON.stringify(demo.evidence,null,2)}</code></pre>}
      {step===3&&<div className="demo-decision"><strong>{demo.decision}</strong><p>개입 추천 · 아직 실행 아님</p><code>EXPLICIT_TOOL_ERROR</code></div>}
      {step===4&&<pre><code>{JSON.stringify(demo.recommendation,null,2)}</code></pre>}
      {step===5&&<pre><code>{JSON.stringify(demo.execution,null,2)}</code></pre>}
      {step===6&&<><div className="demo-verified">✓ {demo.verification.status}</div><pre><code>{JSON.stringify(demo.verification,null,2)}</code></pre></>}
      </div><div className="demo-controls"><button className="button secondary" disabled={step===0} onClick={()=>setStep(step-1)}>이전 단계</button><span>{step+1} / 7</span><button className="button" disabled={step===6} onClick={()=>setStep(step+1)}>다음 단계 →</button></div>
    </article></section>
    <section className="public-section demo-scope"><h2>이 데모가 보여주는 범위</h2><p>{demo.scope}</p><p>{demo.advisory_note}</p><details><summary>사용된 검증 기준과 연구 경고 보기</summary><p>검증 기준: {demo.verification.criterion}. 하나의 controlled run의 결과이며 일반적인 복구 성공률이 아닙니다.</p><code>{demo.provider_warnings.join(' · ')}</code></details>
    <div className="public-actions"><a className="button" href="/signup">내 Agent 연결하기 →</a><a className="button secondary" href="/docs/quickstart">연결 방법 먼저 보기</a></div></section></PublicShell>;
}

export function Quickstart(){return <PublicShell><Intro tag="GET STARTED / CONNECT" title="Agent를 연결해 볼까요?">코드를 몰라도 먼저 연결 테스트부터 할 수 있습니다.</Intro><BeginnerGuide/></PublicShell>;}

export function PublicNotFound(){return <PublicShell><Intro tag="PAGE NOT FOUND" title="페이지를 찾을 수 없습니다.">주소를 확인하거나 제품 소개에서 다시 시작하세요.</Intro><div className="public-actions"><a className="button" href="/">제품 소개로</a><a className="button secondary" href="/docs/quickstart">연결 안내</a></div></PublicShell>;}
