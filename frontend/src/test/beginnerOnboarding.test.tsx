import { render,screen,waitFor,fireEvent,act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,afterEach,describe,it,expect,vi,type MockInstance } from 'vitest';
import { ConnectionTest, CONNECTION_SOURCE } from '../auth/ConnectionTest';
import { ProjectApiKeys } from '../auth/ProjectApiKeys';
import { Onboarding } from '../auth/Onboarding';
import { BeginnerGuide } from '../public/BeginnerGuide';
import { setTokenProvider } from '../api/cloudClient';

const key='SYNTHETIC_TEST_ONLY_NOT_A_VALID_KEY',rid='run-test';
const decision={backend_decision_id:'d1',decision:'CONTINUE',evidence_level:'NONE',recommendation_only:true,intervention_executed:false};
const row={api_key_id:'k1',name:'one',status:'active',key_prefix:'public-prefix',created_at:'2026-10-20',last_used_at:null};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
let fetcher:MockInstance<typeof fetch>,eventFail:boolean;
async function normal(url:unknown,init?:RequestInit):Promise<Response>{
  const path=String(url);
  if(path.endsWith('/api/v1/projects'))return json({projects:[{project_id:'p1',status:'active'}]});
  if(path.endsWith('/api-keys'))return init?.method==='POST'?json({...row,api_key:key},201):json({api_keys:[row]});
  if(path.endsWith('/agent/runs'))return json({run_id:rid},201);
  if(path.includes('/agent/')&&path.endsWith('/events')){
    if(eventFail){eventFail=false;return json({},503);}
    return json({accepted:true,event_id:JSON.parse(String(init?.body)).event_id});
  }
  if(path.includes('/agent/')&&path.endsWith('/decisions'))return json(decision);
  if(path.endsWith('/events'))return json({events:[{event_id:'call-1'},{event_id:'result-1'}]});
  if(path.endsWith('/decisions'))return json({decisions:[decision]});
  if(path.endsWith('/api/v1/runs/'+rid))return json({run_id:rid,project_id:'p1',metadata:{source:CONNECTION_SOURCE},event_count:2});
  return json({},404);
}
beforeEach(()=>{setTokenProvider(async()=>'synthetic-user-token');eventFail=false;fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(normal);});
afterEach(()=>{setTokenProvider(null);vi.useRealTimers();});
const mount=()=>render(<ConnectionTest projectId="p1" apiKey={key}/>);
async function start(){await userEvent.setup().click(screen.getByRole('button',{name:'연결 테스트하기'}));}
describe('beginner browser connection',()=>{
  it('shows primary CTA immediately after key creation',async()=>{
    const user=userEvent.setup();render(<ProjectApiKeys projectId="p1"/>);
    await user.type(screen.getByLabelText('API Key 이름'),'test');await user.click(screen.getByRole('button',{name:'API Key 생성'}));
    expect(await screen.findByRole('button',{name:'연결 테스트하기'})).toBeVisible();expect(screen.getByText('키가 만들어졌습니다.')).toBeVisible();
  });
  it('does not send any request until explicitly clicked',()=>{mount();expect(fetcher).not.toHaveBeenCalled();});
  it('composes real requests, shows returned decision and saved Dashboard link',async()=>{
    const storage=vi.spyOn(Storage.prototype,'setItem');mount();await start();
    expect(await screen.findByText('연결되었습니다.')).toBeVisible();
    expect(screen.getByRole('link',{name:'Dashboard에서 확인'})).toHaveAttribute('href','/runs/'+rid);
    expect(screen.getByText('CONTINUE')).toBeVisible();expect(screen.getByText('NONE')).toBeVisible();expect(storage).not.toHaveBeenCalled();
    const requests=fetcher.mock.calls.filter(([url])=>String(url).includes('/agent/'));
    expect(requests).toHaveLength(4);for(const [,init]of requests){expect(init).toMatchObject({redirect:'error',credentials:'omit',cache:'no-store'});expect(init?.headers).toMatchObject({'X-WHEN2WARN-API-Key':key});expect(String(init?.body)).not.toContain(key);}
    expect(JSON.parse(String(requests[0][1]?.body))).toMatchObject({metadata:{source:CONNECTION_SOURCE,synthetic:true}});
  });
  it('displays actual REVIEW instead of hardcoded CONTINUE',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/decisions')?json(String(url).includes('/agent/')?{...decision,decision:'REVIEW'}:{decisions:[{...decision,decision:'REVIEW'}]}):normal(url,init));
    mount();await start();expect(await screen.findByText('연결되었습니다.')).toBeVisible();expect(screen.getByText('REVIEW')).toBeVisible();
  });
  it('rejects project ownership mismatch before any Agent write',async()=>{
    fetcher.mockResolvedValue(json({projects:[{project_id:'other',status:'active'}]}));mount();await start();
    expect(await screen.findByRole('alert')).toHaveTextContent('프로젝트');expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not report success when owner persistence read is wrong project',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/api/v1/runs/'+rid)?json({project_id:'other',metadata:{source:CONNECTION_SOURCE},event_count:2}):normal(url,init));
    mount();await start();expect(await screen.findByRole('alert')).toHaveTextContent('성공으로 처리하지');expect(screen.queryByText('연결되었습니다.')).toBeNull();
  });
  it('requires saved decision and event, not just successful writes',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/runs/'+rid+'/decisions')&&!String(url).includes('/agent/')?json({decisions:[]}):normal(url,init));
    mount();await start();expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByRole('link',{name:'Dashboard에서 확인'})).toBeNull();
  });
  it('rejects malformed decision and never renders hostile response',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).includes('/agent/')&&String(url).endsWith('/decisions')?json({decision:key}):normal(url,init));
    mount();await start();expect(await screen.findByRole('alert')).toBeVisible();expect(document.body).not.toHaveTextContent(key);
  });
  it('explains invalid key without echoing raw error',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/agent/runs')?json({error:key},401):normal(url,init));mount();await start();
    expect(await screen.findByRole('alert')).toHaveTextContent('새 키');expect(document.body).not.toHaveTextContent(key);
  });
  it('gives rate limit guidance without automatic retries',async()=>{
    fetcher.mockImplementation(async(url,init)=>String(url).endsWith('/agent/runs')?json({},429):normal(url,init));mount();await start();expect(await screen.findByRole('alert')).toHaveTextContent('1분');expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retries a partial run using same run and event identities',async()=>{
    eventFail=true;mount();await start();await screen.findByRole('alert');await userEvent.setup().click(screen.getByRole('button',{name:'다시 시도'}));
    await screen.findByText('연결되었습니다.');expect(fetcher.mock.calls.filter(([u])=>String(u).endsWith('/agent/runs'))).toHaveLength(1);
  });
  it('reuses idempotency key when run creation response was lost',async()=>{
    let fail=true;fetcher.mockImplementation(async(url,init)=>{if(String(url).endsWith('/agent/runs')&&fail){fail=false;throw Error('network');}return normal(url,init);});
    mount();await start();await screen.findByRole('alert');await userEvent.setup().click(screen.getByRole('button',{name:'다시 시도'}));await screen.findByText('연결되었습니다.');
    const creates=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/agent/runs'));expect(creates).toHaveLength(2);expect(creates[0][1]?.headers).toEqual(creates[1][1]?.headers);expect(creates[0][1]?.body).toEqual(creates[1][1]?.body);
  });
  it('prevents double submission',async()=>{
    mount();const button=screen.getByRole('button',{name:'연결 테스트하기'});fireEvent.click(button);fireEvent.click(button);await screen.findByText('연결되었습니다.');expect(fetcher.mock.calls.filter(([u])=>String(u).endsWith('/agent/runs'))).toHaveLength(1);
  });
  it('shows cold-start waiting text and aborts on unmount',async()=>{
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    fetcher.mockImplementation(async(_url,init)=>{signal=init?.signal as AbortSignal;return new Promise(()=>{});});
    const view=mount();fireEvent.click(screen.getByRole('button',{name:'연결 테스트하기'}));await act(async()=>{await vi.advanceTimersByTimeAsync(4001);});
    expect(screen.getByText(/처음 연결은 서버 시작/)).toBeVisible();view.unmount();expect(signal?.aborted).toBe(true);
  });
  it('makes no lost-key recovery via browser storage on refresh',async()=>{
    const user=userEvent.setup();const view=render(<ProjectApiKeys projectId="p1"/>);await user.type(screen.getByLabelText('API Key 이름'),'test');await user.click(screen.getByRole('button',{name:'API Key 생성'}));await screen.findByText(key);view.unmount();render(<ProjectApiKeys projectId="p1"/>);
    expect(await screen.findByText(/기존 키의 전체 값은 다시 볼 수 없습니다/)).toBeVisible();expect(screen.queryByRole('button',{name:'연결 테스트하기'})).toBeNull();expect(document.body).not.toHaveTextContent(key);
  });
  it('stepper advances only after confirmed save',async()=>{
    const user=userEvent.setup();render(<Onboarding projectId="p1"/>);await user.type(screen.getByLabelText('API Key 이름'),'test');await user.click(screen.getByRole('button',{name:'API Key 생성'}));await start();await screen.findByText('연결되었습니다.');expect(screen.getByRole('link',{name:'다음: 첫 실행 확인 →'})).toHaveAttribute('href','/runs/'+rid);
  });
});
describe('plain-language guide',()=>{
  it('defaults to beginner, hides API reference until explicit developer selection',async()=>{
    render(<BeginnerGuide/>);expect(screen.getByRole('link',{name:'브라우저 연결 테스트 시작'})).toBeVisible();expect(screen.queryByRole('heading',{name:'Runtime Event'})).toBeNull();await userEvent.setup().click(screen.getByRole('button',{name:'개발자 안내'}));expect(screen.getByRole('heading',{name:'Runtime Event'})).toBeVisible();
  });
  it('provides Windows and macOS/Linux commands and honest unsupported GPT state',async()=>{
    const user=userEvent.setup();render(<BeginnerGuide/>);expect(screen.getByText(/Windows 시작 버튼/)).toBeVisible();expect(screen.getByRole('button',{name:'OpenAI / GPT 직접 연결 · 준비 중'})).toBeDisabled();await user.selectOptions(screen.getByLabelText('사용하는 컴퓨터'),'unix');expect(screen.getByText('python3 --version')).toBeVisible();expect(screen.getByText(/Linux는 터미널 앱/)).toBeVisible();
  });
  it('copies commands without embedding keys and exposes FAQ',async()=>{
    const user=userEvent.setup();render(<BeginnerGuide/>);await user.click(screen.getByRole('button',{name:'Python 설치 확인 복사'}));expect(await screen.findByRole('status')).toHaveTextContent('복사됨');expect(await navigator.clipboard.readText()).toBe('python --version');await user.click(screen.getByText('Python이 꼭 필요한가요?'));expect(screen.getByText(/브라우저 연결 테스트는 필요 없습니다/)).toBeVisible();
  });
});
