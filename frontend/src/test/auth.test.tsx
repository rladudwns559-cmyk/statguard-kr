import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import BetaApp from '../auth/BetaApp';
import { cloudApi as api, apiRequest, setTokenProvider } from '../api/cloudClient';
import { run } from './fixtures';

const mocks=vi.hoisted(()=>({
  session:null as any, listener:null as any,
  getSession:vi.fn(), onAuthStateChange:vi.fn(), signInWithPassword:vi.fn(), signUp:vi.fn(), signOut:vi.fn()
}));
vi.mock('../auth/supabase',()=>({supabase:{auth:mocks}}));
const session={access_token:'unit-test-token',user:{id:'user-a',email:'a@example.test'}} as any;
function json(value:any,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
function fetchProjects(projects:any[]=[]){
  return vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    if(String(url).endsWith('/api/v1/projects'))return json({projects});
    if(String(url).includes('/api/v1/runs?'))return json({runs:[]});
    return json({error:{message:'not found'}},404);
  });
}
beforeEach(()=>{
  window.history.replaceState(null,'','/runs');
  mocks.session=null;mocks.listener=null;
  mocks.getSession.mockReset().mockImplementation(async()=>({data:{session:mocks.session},error:null}));
  mocks.onAuthStateChange.mockReset().mockImplementation(callback=>{mocks.listener=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};});
  mocks.signInWithPassword.mockReset().mockImplementation(async()=>{mocks.session=session;mocks.listener?.('SIGNED_IN',session);return {data:{session},error:null};});
  mocks.signUp.mockReset().mockResolvedValue({data:{session:null},error:null});
  mocks.signOut.mockReset().mockImplementation(async()=>{mocks.session=null;mocks.listener?.('SIGNED_OUT',null);return {error:null};});
});
afterEach(()=>{setTokenProvider(null);vi.unstubAllGlobals();});

describe('Public beta auth',()=>{
  it('unauthenticated protected route redirects to login without reading runs',async()=>{
    const fetch=fetchProjects();render(<BetaApp/>);
    expect(await screen.findByRole('heading',{name:'로그인'})).toBeVisible();
    await waitFor(()=>expect(window.location.pathname).toBe('/login'));expect(fetch).not.toHaveBeenCalled();
  });
  it('restores session and shows an honest first-project state',async()=>{
    mocks.session=session;const fetch=fetchProjects();render(<BetaApp/>);
    expect(await screen.findByText(/첫 프로젝트를 만들어/)).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/projects'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer unit-test-token'})}));
    expect(screen.queryByText(run.external_run_id!)).not.toBeInTheDocument();
  });
  it('waits for session restoration before rendering private content',async()=>{
    mocks.getSession.mockReturnValue(new Promise(()=>{}));render(<BetaApp/>);
    expect(screen.getByRole('status')).toHaveTextContent('로그인 상태 확인 중');
    expect(screen.queryByText('내 프로젝트')).not.toBeInTheDocument();
  });
  it('signs in then opens consumer chat',async()=>{
    fetchProjects();render(<BetaApp/>);await screen.findByRole('heading',{name:'로그인'});
    await userEvent.type(screen.getByLabelText('이메일'),'a@example.test');
    await userEvent.type(screen.getByLabelText('비밀번호'),'password-test');
    await userEvent.click(screen.getByRole('button',{name:'로그인하기'}));
    expect(await screen.findByRole('heading',{name:'답변을 읽고, 근거를 확인하세요.'})).toBeVisible();
    expect(window.location.pathname).toBe('/ask');
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({email:'a@example.test',password:'password-test'});
  });
  it('sign up waits for email confirmation and creates no fake project',async()=>{
    const fetch=fetchProjects();render(<BetaApp/>);await screen.findByRole('heading',{name:'로그인'});
    await userEvent.click(screen.getByRole('button',{name:'계정 만들기'}));
    await userEvent.type(screen.getByLabelText('이메일'),'a@example.test');await userEvent.type(screen.getByLabelText('비밀번호'),'password-test');
    await userEvent.click(screen.getByRole('button',{name:'가입하기'}));
    expect(await screen.findByText(/가입 요청을 접수/)).toBeVisible();expect(fetch).not.toHaveBeenCalled();
  });
  it('sign out removes private project content',async()=>{
    mocks.session=session;fetchProjects([{project_id:'p-a',name:'내 비공개 프로젝트',status:'active'}]);render(<BetaApp/>);
    await screen.findByText('내 비공개 프로젝트');await userEvent.click(screen.getByRole('button',{name:'로그아웃'}));
    expect(await screen.findByRole('heading',{name:'로그인'})).toBeVisible();
    expect(screen.queryByText('내 비공개 프로젝트')).not.toBeInTheDocument();
  });
  it('creates project with name only, then selects it',async()=>{
    mocks.session=session;const fetch=fetchProjects();
    fetch.mockImplementation(async(url,options)=>String(url).endsWith('/api/v1/projects')?
      options?.method==='POST'?json({project_id:'new',name:'새 프로젝트',status:'active'},201):json({projects:[]}):json({runs:[]}));
    render(<BetaApp/>);await screen.findByText(/첫 프로젝트를 만들어/);
    await userEvent.type(screen.getByLabelText('새 프로젝트 이름'),'새 프로젝트');
    await userEvent.click(screen.getByRole('button',{name:'프로젝트 만들기'}));
    expect(await screen.findByLabelText('프로젝트 선택')).toHaveValue('new');
    expect(fetch).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({method:'POST',body:JSON.stringify({name:'새 프로젝트'})}));
  });
  it('switches project and requests only selected project runs',async()=>{
    mocks.session=session;const fetch=fetchProjects([{project_id:'p1',name:'하나',status:'active'},{project_id:'p2',name:'둘',status:'active'}]);
    fetch.mockImplementation(async(url)=>String(url).endsWith('/api/v1/projects')?json({projects:[{project_id:'p1',name:'하나',status:'active'},{project_id:'p2',name:'둘',status:'active'}]}):
      json({runs:String(url).endsWith('project_id=p1')?[run]:[]}));
    render(<BetaApp/>);expect(await screen.findByRole('link',{name:'검색 복구 확인'})).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('프로젝트 선택'),'p2');
    expect(await screen.findByText('아직 기록된 Agent 실행이 없습니다')).toBeVisible();
    expect(screen.queryByRole('link',{name:'검색 복구 확인'})).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('project_id=p2'),expect.anything());
  });
  it('handles sign-in failure without echoing provider internals',async()=>{
    mocks.signInWithPassword.mockResolvedValue({data:{},error:{message:'internal secret'}});
    render(<BetaApp/>);await screen.findByRole('heading',{name:'로그인'});
    await userEvent.type(screen.getByLabelText('이메일'),'a@example.test');await userEvent.type(screen.getByLabelText('비밀번호'),'password-test');
    await userEvent.click(screen.getByRole('button',{name:'로그인하기'}));
    expect(await screen.findByText(/인증에 실패했습니다/)).toBeVisible();expect(screen.queryByText('internal secret')).not.toBeInTheDocument();
  });
  it('401 ends the displayed session',async()=>{
    mocks.session=session;vi.spyOn(globalThis,'fetch').mockResolvedValue(json({},401));render(<BetaApp/>);
    expect(await screen.findByRole('heading',{name:'로그인'})).toBeVisible();expect(mocks.signOut).toHaveBeenCalled();
  });
  it('403 returns a safe message',async()=>{
    setTokenProvider(async()=>'unit-test-token');
    vi.spyOn(globalThis,'fetch').mockResolvedValue(json({trace:'secret'},403));
    await expect(apiRequest('/api/v1/projects')).rejects.toThrow('이 기록에 접근할 수 없습니다.');
  });
  it('401/403 never pass partial records to a dashboard',async()=>{
    setTokenProvider(async()=>'unit-test-token');
    for(const status of [401,403]){
      vi.spyOn(globalThis,'fetch').mockResolvedValue(json({runs:[run]},status));
      await expect(api.runs(undefined,'other-project')).rejects.toThrow();
    }
  });
});
