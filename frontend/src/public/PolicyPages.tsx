import { PublicShell } from './PublicPages';

export function Privacy(){return <PublicShell><section className="public-section"><p className="eyebrow">PUBLIC BETA · PRIVACY</p><h1>보내는 데이터와 삭제</h1>
  <h2>저장하는 정보</h2><p>Supabase Auth가 로그인 이메일과 인증 정보를 관리합니다. WHEN2WARN은 계정 식별자, 프로젝트 이름, 실행·행동·도구 결과·공개 텍스트·metadata, 근거·판단·실행·검증 기록을 저장합니다. API Key 비밀값은 생성 시 한 번 표시하며 서버에는 HMAC-SHA256 검증값만 저장합니다.</p>
  <h2>AI 답변 검증</h2><p>질문, 최근 대화, 답변과 검증 대상 주장은 답변 생성·웹 검색·근거 비교를 위해 OpenAI API로 전송됩니다. 검색된 출처의 짧은 본문도 비교에 사용합니다. 대화, 답변, 주장, 출처 발췌, 검증 상태와 사용량을 저장합니다. 대화 삭제 또는 계정 삭제로 해당 기록을 삭제할 수 있습니다. 프로젝트 삭제는 별도의 대화 기록을 삭제하지 않습니다.</p><p>OpenAI 요청에는 store=false를 사용합니다. 이것이 OpenAI의 보안·남용 모니터링 로그까지 즉시 삭제된다는 뜻은 아닙니다. 데이터 처리 범위는 <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">OpenAI 공식 데이터 안내</a>를 확인하세요. 민감정보를 입력하지 마세요. 모든 주장의 정확성이나 전체 답변의 사실성을 보장하지 않습니다.</p><h2>비밀정보를 보내지 마세요</h2><p>공개 API는 저장 전에 password, token, authorization, api_key, cookie 등 지정된 키의 값을 재귀적으로 가립니다. JSON 객체와 JSON 형식의 observation에 적용됩니다. 문장에 섞인 비밀번호, 개인정보, 파일 내용까지 모두 찾아내는 기능은 아닙니다. 민감한 실제 데이터 대신 합성된 테스트 기록을 사용하세요.</p>
  <h2>보관과 삭제</h2><p>Beta 실행 기록은 프로젝트나 계정을 삭제할 때까지 보관합니다. 프로젝트 삭제는 해당 프로젝트의 기록과 키를 지웁니다. 계정 삭제는 모든 애플리케이션 기록과 Supabase Auth 계정을 삭제합니다. 장애가 나면 접근을 차단한 삭제 대기 상태가 되며 재시도 또는 운영자 복구가 필요할 수 있습니다.</p>
  <p>삭제 후에도 기존 인증 토큰의 재사용을 막기 위한 계정 UUID와 삭제 상태는 별도로 남깁니다. 콘텐츠가 없는 요청 로그와 인프라 제공자의 백업·운영 로그는 제공자의 보관 정책에 따르며, 사용자 삭제가 그 사본의 즉시 삭제까지 보장하지는 않습니다.</p>
  <h2>CSV 수치 검증</h2><p>CSV 선택과 미리보기는 브라우저에서 처리합니다. 계산·수치 비교를 누르면 원본 CSV와 계산 조건이 Vercel 계산 서버로 HTTPS 전송됩니다. 앱은 요청 중 메모리에서만 계산하고 CSV·입력 수치를 파일이나 DB에 보관하지 않으며 GPT·검색 서비스로 보내지 않습니다. 처리된 데이터가 운영체제 메모리에서 즉시 완전히 삭제된다는 보장은 아닙니다. 인프라 운영 로그는 제공자의 정책을 따릅니다. 개인정보가 없는 자료로 사용하세요.</p>
  <h2>인프라</h2><p>Vercel은 웹사이트, Render는 API 서버, Supabase는 인증과 PostgreSQL을 제공합니다. Gmail SMTP를 통한 인증 메일은 도착이 지연되거나 제한될 수 있습니다.</p>
  <p>WHEN2WARN은 연구 기반 Public Beta입니다. 규제 준수 인증이나 모든 비밀정보의 탐지·제거를 주장하지 않습니다.</p><a href="/security">보안 범위 보기 →</a>
</section></PublicShell>;}

export function Security(){return <PublicShell><section className="public-section"><p className="eyebrow">PUBLIC BETA · SECURITY</p><h1>보안 경계와 사용 범위</h1>
  <ul><li>HTTPS를 통한 전송과 명시된 웹사이트 origin만 허용하는 CORS</li><li>로그인 계정 소유권에 따른 프로젝트 접근 제한</li><li>프로젝트 범위의 Agent API Key와 HMAC-SHA256 검증값 저장</li><li>저장 전 지정된 필드 이름 기반 비밀값 제거</li><li>프로젝트·키·실행·이벤트 수 제한 및 PostgreSQL 기반 요청 제한</li><li>프로젝트·계정 삭제와 삭제 대기 계정의 접근 차단</li></ul>
  <h2>실행 권한</h2><p>공개 Agent API는 판단·추천을 반환합니다. 사용자의 컴퓨터에서 임의 코드를 실행하지 않습니다. INTERVENE 응답이 실행 또는 복구 성공을 의미하지는 않습니다.</p>
  <h2>검증의 범위</h2><p>Evidence-to-Decision Canary는 정해진 합성 시나리오의 데이터 흐름과 판단 계약을 확인합니다. 모든 공격이나 Agent 실패를 방지한다는 보장은 아닙니다. Beta에서 민감한 데이터와 중요한 업무를 연결하지 마세요.</p>
  <h2>문제 신고</h2><p>현재 별도의 공개 보안 신고 접수처는 운영하지 않습니다. 담당자와 이미 연결되어 있다면 비밀키·원본 개인정보 대신 발생 시각과 요청 ID만 전달하세요.</p><a href="/privacy">데이터 보관·삭제 안내 →</a>
</section></PublicShell>;}
