import { render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import App from '../App';
import BetaApp from '../auth/BetaApp';
import { Landing,Demo,Quickstart } from '../public/PublicPages';
import content from '../public/content.json';
import { setTokenProvider } from '../api/cloudClient';

const mocks=vi.hoisted(()=>({session:null as any,listener:null as any,getSession:vi.fn(),onAuthStateChange:vi.fn(),signOut:vi.fn(),signUp:vi.fn(),signInWithPassword:vi.fn()}));
vi.mock('../auth/supabase',()=>({supabase:{auth:mocks}}));
const session={access_token:'test-jwt',user:{id:'u1',email:'a@example.test'}} as any;
const project={project_id:'project-one',name:'연결 시험',status:'active'};
const key={api_key_id:'key-one',name:'my-agent',status:'active',key_prefix:'w2w_beta_public',created_at:'2026-10-19',last_used_at:null};
const secret='TEST_ONLY_ONE_TIME_KEY_NOT_VALID';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
let projects:any[],keys:any[];
beforeEach(()=>{
  projects=[];keys=[];window.history.replaceState(null,'','/');
  mocks.session=null;mocks.listener=null;
  mocks.getSession.mockReset().mockImplementation(async()=>({data:{session:mocks.session},error:null}));
  mocks.onAuthStateChange.mockReset().mockImplementation(callback=>{mocks.listener=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};});
  mocks.signOut.mockReset().mockImplementation(async()=>{mocks.session=null;mocks.listener?.('SIGNED_OUT',null);return {error:null};});
  mocks.signUp.mockReset().mockResolvedValue({data:{session:null},error:null});
  mocks.signInWithPassword.mockReset().mockImplementation(async()=>{mocks.session=session;mocks.listener?.('SIGNED_IN',session);return {data:{session},error:null};});
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    const path=String(url);
    if(path.endsWith('/api/v1/projects')){
      if(init?.method==='POST'){projects=[project];return json(project,201);}
      return json({projects});
    }
    if(path.endsWith('/api-keys')){
      if(init?.method==='POST'){keys=[key];return json({...key,api_key:secret},201);}
      return json({api_keys:keys});
    }
    if(path.includes('/api/v1/runs?'))return json({runs:[]});
    return json({},404);
  });
});
afterEach(()=>setTokenProvider(null));

describe('public pages and protected onboarding',()=>{
  it.each(['/','/demo','/docs/quickstart','/how-it-works'])('%s renders without session or private requests',async(path)=>{
    window.history.replaceState(null,'',path);render(<App/>);
    expect(await screen.findByRole('heading',{level:1})).toBeVisible();
    expect(mocks.getSession).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('landing remains available when Auth would fail',()=>{
    mocks.getSession.mockRejectedValue(new Error('unavailable'));render(<Landing/>);
    expect(screen.getByRole('heading',{level:1})).toHaveTextContent('근거를 함께 확인하세요');
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
  it('Get Started links signed-out visitors to signup',()=>{
    render(<Landing/>);expect(screen.getAllByRole('link',{name:/시작하기/}).every(a=>a.getAttribute('href')==='/signup')).toBe(true);
  });
  it('shows honest evaluation scope and baseline limitation',()=>{
    render(<Landing/>);expect(screen.getByText(/단순 error-trigger baseline보다 높은 성공률/)).toBeVisible();
    expect(screen.getByText(/12개 paired condition/)).toBeVisible();expect(screen.getAllByText('83.3%')).toHaveLength(2);
  });
  it('does not publish unsupported safety or recovery claims',()=>{
    const {container}=render(<Landing/>);
    for(const bad of ['Guarantees safe agents','Guaranteed recovery','Prevents all AI failures','99% recovery','Free during beta','Production-grade safety'])
      expect(container).not.toHaveTextContent(bad);
    expect(screen.getByText(/공개 API는 추천을 반환/)).toBeVisible();
  });
  it('mobile menu expands and exposes semantic navigation',async()=>{
    const user=userEvent.setup();render(<Landing/>);
    const menu=screen.getByRole('button',{name:'메뉴 열기'});expect(menu).toHaveAttribute('aria-expanded','false');
    await user.click(menu);expect(menu).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('navigation',{name:'제품 메뉴'})).toHaveClass('is-open');
    await user.click(menu);expect(menu).toHaveAttribute('aria-expanded','false');
  });
  it('keyboard reaches the skip link and navigation links',async()=>{
    const user=userEvent.setup();render(<Landing/>);await user.tab();
    expect(screen.getByRole('link',{name:'본문으로 건너뛰기'})).toHaveFocus();await user.tab();
    expect(screen.getByRole('link',{name:'WHEN2WARN 홈'})).toHaveFocus();
  });
  it('replays recorded verification without network calls',async()=>{
    const user=userEvent.setup();render(<Demo/>);
    expect(screen.getByText(/실시간 cloud 실행이 아닌/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Host error 단계'}));
    expect(screen.getByText(/Locator.fill/)).toBeVisible();
    await user.click(screen.getByRole('button',{name:'Verification 단계'}));
    expect(screen.getAllByText(/VERIFIED_RECOVERY/).length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('public demo has no source UUID, path, credential, or internal hash',()=>{
    const raw=JSON.stringify(content.demo);
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    for(const privateField of ['run_id','verification_id','_token_hash','C:\\Users','augus','"eO"'])expect(raw).not.toContain(privateField);
    expect(content.demo.verification.status).toBe('VERIFIED_RECOVERY');
  });
  it('Quickstart starts with browser test and separates technical reference',async()=>{
    render(<Quickstart/>);
    expect(screen.getByRole('link',{name:'Python 예제 다운로드 ↓'})).toHaveAttribute('download');
    expect(screen.getByRole('link',{name:'브라우저 연결 테스트 시작'})).toHaveAttribute('href','/projects#api-keys');
    expect(screen.queryByRole('heading',{name:'Runtime Event'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Dashboard로 이동 →'})).toHaveAttribute('href','/runs');
    await userEvent.setup().click(screen.getByRole('button',{name:'개발자 안내'}));
    expect(screen.getByRole('heading',{name:'Runtime Event'})).toBeVisible();
    expect(screen.getByText(/X-WHEN2WARN-API-Key/)).toBeVisible();
    expect(screen.getAllByText(/--demo/,{selector:'code'}).length).toBeGreaterThan(0);
  });
  it('signup entry selects signup form',async()=>{
    window.history.replaceState(null,'','/signup');render(<BetaApp/>);
    expect(await screen.findByRole('heading',{name:'회원가입'})).toBeVisible();
    expect(screen.getByRole('button',{name:'가입하기'})).toBeVisible();
  });
  it('logged in Get Started reaches consumer chat',async()=>{
    mocks.session=session;window.history.replaceState(null,'','/signup');render(<BetaApp/>);
    expect(await screen.findByRole('heading',{name:'답변을 읽고, 근거를 확인하세요.'})).toBeVisible();
    expect(window.location.pathname).toBe('/ask');
    expect(screen.getByRole('link',{name:'Developer Console'})).toHaveAttribute('href','/projects');
  });
  it('owned project without active key points to key creation',async()=>{
    mocks.session=session;projects=[project];window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    expect(await screen.findByRole('link',{name:'다음: API Key 만들기 ↓'})).toHaveAttribute('href','#api-keys');
    expect(await screen.findByText(/아래에서 키를 만들면/)).toBeVisible();
  });
  it('existing active key points to Connect Agent',async()=>{
    mocks.session=session;projects=[project];keys=[key];window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    expect(await screen.findByRole('link',{name:'다음: 새 키로 연결 테스트 ↓'})).toHaveAttribute('href','#api-keys');
    expect(screen.getByRole('link',{name:'Dashboard로 이동'})).toHaveAttribute('href','/runs?project=project-one');
  });
  it('project -> one-time key -> Quickstart -> Dashboard journey',async()=>{
    const user=userEvent.setup();mocks.session=session;window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    await screen.findByRole('button',{name:'프로젝트 만들기'});
    await user.type(screen.getByLabelText('새 프로젝트 이름'),'연결 시험');await user.click(screen.getByRole('button',{name:'프로젝트 만들기'}));
    await user.type(await screen.findByLabelText('API Key 이름'),'my-agent');await user.click(screen.getByRole('button',{name:'API Key 생성'}));
    expect(await screen.findByText(/지금 키를 복사하세요/)).toBeVisible();
    expect(screen.getByLabelText('한 번만 표시되는 API Key')).toHaveTextContent(secret);
    expect(await screen.findByRole('link',{name:'다음: 새 키로 연결 테스트 ↓'})).toBeVisible();
    expect(screen.getByRole('link',{name:'Dashboard로 이동'})).toBeVisible();
  });
  it('backend outage displays a friendly error without internals',async()=>{
    mocks.session=session;vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('SQL secret /private/path'));
    window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('프로젝트를 불러올 수 없습니다');
    expect(document.body).not.toHaveTextContent('/private/path');
  });
  it('session restoration has loading state',()=>{
    mocks.getSession.mockReturnValue(new Promise(()=>{}));window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    expect(screen.getByRole('status')).toHaveTextContent('로그인 상태 확인 중');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('expired session returns to login and clears project content',async()=>{
    mocks.session=session;projects=[project];window.history.replaceState(null,'','/projects');
    vi.spyOn(globalThis,'fetch').mockResolvedValue(json({},401));render(<BetaApp/>);
    expect(await screen.findByRole('heading',{name:'로그인'})).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('세션이 만료되었거나');
    expect(screen.queryByLabelText('API Key 이름')).not.toBeInTheDocument();
  });
  it('logout clears onboarding and secret state',async()=>{
    const user=userEvent.setup();mocks.session=session;projects=[project];window.history.replaceState(null,'','/projects');render(<BetaApp/>);
    await screen.findByLabelText('API Key 이름');await user.click(screen.getByRole('button',{name:'로그아웃'}));
    expect(await screen.findByRole('heading',{name:'로그인'})).toBeVisible();
    expect(screen.queryByLabelText('API Key 이름')).not.toBeInTheDocument();
  });
});
