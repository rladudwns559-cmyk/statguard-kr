import { useState } from 'react';
import { ProjectApiKeys } from './ProjectApiKeys';

export function Onboarding({projectId}:{projectId:string}){
  const [hasKey,setHasKey]=useState<boolean|null>(null),[savedRun,setSavedRun]=useState('');
  const stages=[['프로젝트 만들기','완료'],['API 키 만들기',hasKey?'완료':'현재'],['연결 테스트',savedRun?'완료':hasKey?'현재':'아직 안 함'],['첫 실행 확인',savedRun?'현재':'아직 안 함'],['실제 Agent 연결','아직 안 함']];
  return <><section className="panel beta-projects onboarding" aria-label="첫 Agent 연결 안내">
    <p className="eyebrow">GET STARTED</p><h2>코드 없이 첫 연결을 확인하세요.</h2>
    <p>WHEN2WARN은 AI Agent가 보내는 실행 기록을 확인하고, 문제가 있을 때 개입 판단을 도와줍니다. 컴퓨터 화면이나 모든 활동을 자동으로 보는 프로그램이 아닙니다.</p>
    <ol className="onboarding-steps beginner-steps" aria-label="시작 단계">{stages.map(([name,state],i)=><li key={name} aria-current={state==='현재'?'step':undefined}><strong>{i+1}. {name}</strong><p>{state}</p></li>)}</ol>
    <div className="onboarding-actions"><a className="button" href={savedRun?'/runs/'+encodeURIComponent(savedRun):'#api-keys'}>{savedRun?'다음: 첫 실행 확인 →':hasKey?'다음: 새 키로 연결 테스트 ↓':'다음: API Key 만들기 ↓'}</a><a className="button secondary" href={'/runs?project='+encodeURIComponent(projectId)}>Dashboard로 이동</a></div>
    <p>프로젝트는 Agent 실행 기록을 모아두는 작업 공간입니다. 아래에서 키를 만들면 ‘연결 테스트하기’가 나타납니다.</p>
    <p className="onboarding-note">완료 표시는 확인된 단계에만 붙습니다. 실제 Agent 연결 완료를 자동으로 추측하지 않습니다.</p>
  </section><ProjectApiKeys projectId={projectId} onActiveKeysChange={setHasKey} onConnectionComplete={result=>setSavedRun(result.runId)}/></>;
}
