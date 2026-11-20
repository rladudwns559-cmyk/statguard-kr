import { useState } from 'react';
import { API_BASE } from '../api/cloudClient';

export function CopyCommand({label,children}:{label:string;children:string}) {
  const [message,setMessage]=useState('');
  return <div className="public-code"><button type="button" aria-label={label+' 복사'} onClick={async()=>{try{await navigator.clipboard.writeText(children);setMessage('복사됨');}catch{setMessage('자동 복사에 실패했습니다. 아래 명령을 직접 선택해 복사하세요.');}}}>복사</button><pre><code>{children}</code></pre>{message&&<p role="status">{message}</p>}</div>;
}

export function BeginnerFaq(){return <section id="help" className="beginner-faq"><h2>막히셨나요?</h2>{[
  ['API 키는 내가 직접 만드는 건가요?','네. 로그인 후 프로젝트에서 ‘API Key 생성’을 누르세요. 연결 권한이 있는 비밀번호 같은 키이므로 다른 사람에게 보내지 마세요.'],
  ['API 키를 어디에 넣나요?','브라우저 테스트는 생성 직후 화면의 키를 사용하므로 직접 입력할 필요가 없습니다. 실제 Python 예제는 실행할 때 키를 물어봅니다.'],
  ['API Key가 사라졌어요','전체 키는 생성 직후에만 보입니다. 다시 볼 수 없으므로 새 키를 만들어 주세요. 사용하지 않는 이전 키는 폐기하세요.'],
  ['PowerShell이 뭔가요?','Windows에서 명령을 입력하는 프로그램입니다. 시작 버튼을 누르고 PowerShell을 검색해 여세요. 브라우저 연결 테스트에는 필요하지 않습니다.'],
  ['Python이 꼭 필요한가요?','브라우저 연결 테스트는 필요 없습니다. Python 예제나 직접 만든 Agent를 연결할 때만 PC의 Python 환경이 필요합니다.'],
  ['실행됐는지 어떻게 확인하나요?','연결 성공 뒤 ‘Dashboard에서 확인’을 누르세요. 방금 생성한 테스트 Run의 행동과 판단이 표시됩니다. 실제 Agent 성능을 검증한 결과는 아닙니다.'],
  ['실행했는데 Run이 안 보여요','키를 만든 프로젝트를 선택했는지 확인하고 목록을 새로고침하세요. Python 실행 결과의 Dashboard 주소로 바로 열 수도 있습니다. 키 값은 공유하지 마세요.'],
  ['WHEN2WARN이 제 컴퓨터를 직접 조종하나요?','아니요. Agent가 보내는 행동·결과를 확인하고 판단·추천을 반환합니다. 화면이나 모든 활동을 자동으로 보지 않습니다. 실제 행동 실행은 별도 Agent의 권한입니다.'],
  ['Python이 없다고 나와요','python.org에서 Python을 설치하고 명령 창을 새로 여세요. Windows 설치 화면에서는 PATH 추가 항목을 확인하세요. 설치가 어렵다면 먼저 브라우저 테스트를 이용하세요.'],
].map(([question,answer])=><details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>;}

export function BeginnerGuide(){
  const [mode,setMode]=useState<'beginner'|'developer'>('beginner'),[os,setOs]=useState<'windows'|'unix'>('windows');
  return <div className="beginner-guide public-section">
    <div className="onboarding-actions" aria-label="안내 수준"><button className={'button '+(mode==='beginner'?'':'secondary')} aria-pressed={mode==='beginner'} onClick={()=>setMode('beginner')}>처음 시작하기</button><button className={'button '+(mode==='developer'?'':'secondary')} aria-pressed={mode==='developer'} onClick={()=>setMode('developer')}>개발자 안내</button></div>
    {mode==='beginner'?<>
      <section id="get-started" className="panel beginner-card"><p className="eyebrow">GET STARTED · 가장 쉬움</p><h2>처음이신가요? 브라우저 연결 테스트부터 해보세요.</h2><p>Python 설치나 명령 입력 없이 안전한 예제 Run 하나를 만들어 볼 수 있습니다. Run은 Agent가 한 번 작업한 기록입니다.</p><ol><li>회원가입하고 이메일을 인증한 뒤 로그인하세요.</li><li>프로젝트를 만드세요. 실행 기록을 모아두는 작업 공간입니다.</li><li>프로젝트에서 API 키를 만들고 바로 ‘연결 테스트하기’를 누르세요.</li><li>‘연결되었습니다’가 나오면 ‘Dashboard에서 확인’을 누르세요.</li></ol><a className="button" href="/projects#api-keys">브라우저 연결 테스트 시작</a><p><a href="/signup">처음이라면 회원가입</a> · <a href="/login">로그인</a></p><p>약 1분 연결 테스트 · 서버가 처음 시작될 때는 더 걸릴 수 있습니다. 버튼을 누르기 전에는 기록을 만들지 않습니다.</p></section>
      <section className="panel beginner-card"><h2>실제 Agent도 연결할 수 있나요?</h2><p>여러 단계로 작업하는 AI 프로그램을 Agent라고 합니다. GPT·Claude·Gemini 등을 이용해 직접 만든 프로그램에서도 실행 기록을 보내도록 연결할 수 있습니다.</p><p><strong>현재 Public Beta는 Python/REST 방식으로 연결합니다.</strong> ChatGPT 대화창이나 GPT 계정을 클릭 한 번으로 연결하는 기능은 준비 중입니다. OpenAI/GPT 전용 연결 버튼은 아직 작동하는 기능이 아닙니다.</p><a className="button secondary" href="#python">Python으로 연결</a><button className="button secondary" disabled>OpenAI / GPT 직접 연결 · 준비 중</button></section>
      <section id="python" className="panel beginner-card"><h2>Python 연결 — PC에서 진행하세요.</h2><p>브라우저 테스트를 마친 뒤 실제 연결 예제를 실행하려는 분을 위한 안내입니다. Quickstart는 Agent 연결을 시험하는 예제이며 실제 개인 Agent를 자동으로 연결하지는 않습니다.</p>
        <label htmlFor="connection-os">사용하는 컴퓨터<select id="connection-os" value={os} onChange={e=>setOs(e.target.value as 'windows'|'unix')}><option value="windows">Windows</option><option value="unix">macOS / Linux</option></select></label>
        <h3>1. 명령 창을 열고 Python을 확인하세요.</h3><p>{os==='windows'?'Windows 시작 버튼 → PowerShell 검색 → Windows PowerShell을 여세요. 기본 Windows PowerShell에서도 사용할 수 있습니다.':'macOS는 Spotlight에서 Terminal을, Linux는 터미널 앱을 여세요.'}</p><CopyCommand label="Python 설치 확인">{os==='windows'?'python --version':'python3 --version'}</CopyCommand><p>Python 3.12 이상 버전이 보이면 준비된 것입니다. 없으면 <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">Python 공식 설치 페이지</a>에서 설치하고 명령 창을 다시 여세요.</p>
        <h3>2. 예제를 ‘다운로드’ 폴더에 저장하세요.</h3><a className="button secondary" download href="/quickstart/python_agent_quickstart.py">Python 예제 다운로드 ↓</a><p>파일 이름은 python_agent_quickstart.py입니다. 아래 명령은 기본 다운로드 폴더 기준입니다. 다른 폴더에 저장했다면 파일 경로를 바꿔야 합니다.</p>
        <h3>3. 아래 두 줄을 명령 창에서 실행하세요.</h3><CopyCommand label="예제 실행 명령">{os==='windows'?'python -m pip install httpx==0.27.2\npython "$HOME\\Downloads\\python_agent_quickstart.py" --demo':'python3 -m pip install httpx==0.27.2\npython3 "$HOME/Downloads/python_agent_quickstart.py" --demo'}</CopyCommand><p>프로젝트에서 복사한 키를 물어보면 붙여넣고 Enter를 누르세요. 입력 중 키가 화면에 보이지 않는 것이 정상입니다. 실제 키를 코드 파일이나 명령 문장에 적지 않습니다. 별도 서버 주소 설정은 필요 없습니다.</p><p>macOS/Linux에서 패키지 설치가 제한되면 개발자 안내의 가상환경을 사용하세요. 관리자 권한이나 시스템 Python 보호 해제는 요구하지 않습니다.</p>
        <h3>4. 성공 표시를 확인하세요.</h3><p>WHEN2WARN connected, Run created, Event received와 실제 Decision이 표시됩니다. 출력된 ‘Dashboard에서 확인하기’ 주소를 열면 해당 기록으로 바로 이동합니다.</p><a className="button" href="/runs">Dashboard로 이동 →</a>
      </section><BeginnerFaq/>
    </>:<section id="reference" className="panel beginner-card"><h2>개발자 연결 · API 상세</h2><p>브라우저 연결 테스트도 기존 Agent API를 사용합니다. 웹 사용자 로그인과 프로젝트 API 키는 서로 대체할 수 없습니다.</p><h3>API Key</h3><p>헤더: <code>X-WHEN2WARN-API-Key</code>. 생성·교체 직후 한 번만 표시되며 브라우저 저장소에 자동 저장하지 않습니다.</p><p>API 주소: <code>{API_BASE||'배포된 API 설정 필요'}</code></p>
      <h3>Runtime Event</h3><p>행동 요청과 결과를 순서대로 보냅니다. result의 parent_event_id는 call을 가리키고, 병렬 결과를 모두 받은 뒤 group_complete를 닫습니다.</p><CopyCommand label="REST 경로">{'POST /api/v1/agent/runs\nPOST /api/v1/agent/runs/{run_id}/events\nPOST /api/v1/agent/runs/{run_id}/decisions'}</CopyCommand><a href={(API_BASE||'')+'/docs'} target="_blank" rel="noreferrer">OpenAPI 상세 문서</a>
      <h3>환경변수는 무엇인가요?</h3><p>키를 코드 파일에 적지 않고 현재 실행 프로그램에 잠시 전달하는 방법입니다. 예제는 환경변수가 없으면 숨김 입력으로 키를 요청합니다. WHEN2WARN_BASE_URL로 서버 주소를 바꾸는 설정은 개발자용입니다.</p><CopyCommand label="Windows 키 전달">{'$secret = Read-Host "프로젝트 API 키" -AsSecureString\n$env:WHEN2WARN_API_KEY = ([System.Net.NetworkCredential]::new("", $secret)).Password'}</CopyCommand><p>터미널 작업 후에는 <code>Remove-Item Env:WHEN2WARN_API_KEY</code>로 해당 창의 값을 지우세요. 실제 키를 명령 기록에 직접 붙여넣지 마세요.</p><h3>macOS / Linux 가상환경</h3><CopyCommand label="가상환경 실행">{'python3 -m venv "$HOME/when2warn-env"\n"$HOME/when2warn-env/bin/python" -m pip install httpx==0.27.2\n"$HOME/when2warn-env/bin/python" "$HOME/Downloads/python_agent_quickstart.py" --demo'}</CopyCommand><p>HTTP 429는 Retry-After 안내 후 수동 재시도, 409는 중복/완료 상태, 422는 형식을 확인하세요. 예제 실행은 <code>--demo</code>를 지정할 때만 합성 기록을 생성합니다.</p>
      <h3>Decision / Evidence</h3><p>CONTINUE: 현재 근거로 개입 추천 없음. REVIEW: 검토 필요. INTERVENE: 개입 추천이며 실행 완료가 아님. NONE은 현재 지원하는 실패 근거 없음이며 성공 보장이 아닙니다.</p></section>}
    <section id="privacy" className="beginner-card"><h2>보내는 데이터</h2><p>WHEN2WARN은 Agent가 보내는 행동·인자·결과·공개 텍스트를 확인합니다. 컴퓨터 화면이나 모든 활동을 자동으로 보지 않습니다. 비밀번호·개인정보·회사 자료·비밀키를 보내지 마세요.</p><a href="/privacy">데이터 보관·삭제 안내</a> · <a href="/security">키와 보안 안내</a></section>
    <section id="limitations" className="beginner-card"><h2>현재 한계</h2><p>모든 실패를 발견하거나 안전·복구를 보장하지 않습니다. 공개 API는 판단·추천을 반환하며 실행 권한은 외부 Agent에 있습니다. p_failure는 약한 참고값, q_recovery는 실험적 점수입니다. 기존 소규모 평가에서 단순 오류 신호 기준보다 높은 성공률을 보이지 않았습니다.</p></section>
  </div>;
}
