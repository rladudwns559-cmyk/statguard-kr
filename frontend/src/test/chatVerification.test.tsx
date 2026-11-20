import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import ChatWorkspace,{VerificationPanel,safeSource} from '../chat/ChatWorkspace';
import {streamQuestion} from '../chat/chatClient';
import {setTokenProvider} from '../api/cloudClient';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const claim={claim_id:'c',claim_text:'A는 B입니다.',source_sentence:'A는 B입니다.',verification_status:'SUPPORTED',reason:'출처가 뒷받침합니다.',conflict:false,stale:false,evidence_ids:['e']};
const turn={turn_id:'t',prompt:'질문',answer:'A는 B입니다.',state:'COMPLETE',notice:'',claims:[claim],evidence:[{evidence_id:'e',url:'https://example.com',title:'Source',domain:'example.com',excerpt:'A는 B입니다.',retrieved_at:'2026-10-20T00:00:00Z',source_type:'UNKNOWN'}]};
beforeEach(()=>{window.history.replaceState(null,'','/ask');setTokenProvider(async()=>'synthetic-jwt');});
afterEach(()=>setTokenProvider(null));
function mockChat(){
 return vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const path=String(url);
  if(path.endsWith('/capabilities'))return json({enabled:true,notice:'',prompt_chars:3000,daily_limit:10});
  if(path.endsWith('/conversations'))return init?.method==='POST'?json({conversation_id:'cid'}):json({conversations:[{conversation_id:'cid',title:'저장된 질문'}]});
  if(path.endsWith('/conversations/cid'))return json({turns:[turn]});
  if(path.endsWith('/messages')){
   const events=[{type:'snapshot',turn:{...turn,answer:'',state:'ANSWERING',claims:[],evidence:[]}},
    {type:'delta',turn_id:'t',text:'A는 B입니다.'},{type:'snapshot',turn}];
   return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  }
  return json({},404);
 });
}
it('general user can ask without project or key calls and sees streamed answer plus evidence',async()=>{
 const fetch=mockChat();render(<ChatWorkspace onSignOut={async()=>{}}/>);
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'질문'})).toBeEnabled());
 await userEvent.type(screen.getByRole('textbox',{name:'질문'}),'대한민국 질문');
 await userEvent.click(screen.getByRole('button',{name:'질문하기'}));
 expect(await screen.findByText('검증 절차 완료')).toBeVisible();
 expect(screen.getByText('A는 B입니다.',{selector:'.chat-answer'})).toBeVisible();
 expect(fetch.mock.calls.some(([u])=>String(u).includes('/projects'))).toBe(false);
 expect(screen.getByRole('link',{name:'Developer Console'})).toHaveAttribute('href','/projects');
});
it('restores persisted history and switches mobile sections',async()=>{
 mockChat();render(<ChatWorkspace onSignOut={async()=>{}}/>);
 await userEvent.click(await screen.findByRole('button',{name:'저장된 질문'}));
 expect(await screen.findByText('검증 절차 완료')).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'근거 확인'}));
 expect(screen.getByRole('button',{name:'근거 확인'})).toHaveAttribute('aria-pressed','true');
 await userEvent.click(screen.getByRole('button',{name:'A는 B입니다.'}));
 expect(document.querySelector('mark')).toHaveTextContent('A는 B입니다.');
});
it('source details use safe external links and explicit support semantics',()=>{
 render(<VerificationPanel turn={turn}/>);
 const link=screen.getByRole('link',{name:'출처 원문 열기 ↗',hidden:true});
 expect(link).toHaveAttribute('rel','noopener noreferrer');
 expect(screen.getByText('근거 확인',{exact:true})).toHaveAttribute('title','확인한 출처가 이 주장을 뒷받침합니다.');
});
it('model and source HTML are text, never executable markup',()=>{
 render(<VerificationPanel turn={{...turn,claims:[{...claim,claim_text:'<img src=x onerror=alert(1)>'}],evidence:[{...turn.evidence[0],url:'javascript:alert(1)',excerpt:'<script>alert(1)</script>'}]}}/>);
 expect(document.querySelector('img')).toBeNull();
 expect(document.querySelector('script')).toBeNull();
 expect(screen.queryByRole('link',{name:'출처 원문 열기 ↗',hidden:true})).not.toBeInTheDocument();
 expect(safeSource('https://x:secret@example.com')).toBe(false);
});
it.each(['PARTIALLY_SUPPORTED','NOT_SUPPORTED','INSUFFICIENT_EVIDENCE','NOT_CHECKABLE'])('renders %s without a fabricated percentage',status=>{
 render(<VerificationPanel turn={{...turn,claims:[{...claim,verification_status:status,conflict:true,stale:true}]}}/>);
 expect(screen.getByText('출처 간 내용이 충돌합니다.')).toBeInTheDocument();
 expect(screen.getByText('자료의 최신성을 충분히 확인하지 못했습니다.')).toBeInTheDocument();
 expect(document.body.textContent).not.toMatch(/\d+%/);
});
it('daily limit maps to Korean error and no implicit retry',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(json({error:{code:'CHAT_DAILY_LIMIT'}},429));
 await expect(streamQuestion('c','p','r',new AbortController().signal,()=>{})).rejects.toThrow('오늘의 베타 사용 한도');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('split SSE frames and Unicode survive chunk boundaries; EOF without terminal fails',async()=>{
 const bytes=new TextEncoder().encode('data: {"type":"delta","text":"한국어"}\n\ndata: {"type":"snapshot","turn":{"state":"COMPLETE"}}\n\n');
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=5)c.enqueue(bytes.slice(i,i+5));c.close();}}),{headers:{'content-type':'text/event-stream'}}));
 const received:any[]=[];await streamQuestion('c','p','r',new AbortController().signal,e=>received.push(e));
 expect(received[0].text).toBe('한국어');
 vi.mocked(fetch).mockResolvedValue(new Response('data: {"type":"delta","text":"partial"}\n\n',{headers:{'content-type':'text/event-stream'}}));
 await expect(streamQuestion('c','p','r',new AbortController().signal,()=>{})).rejects.toThrow('연결이 중단');
});
it('terminal SSE snapshot finishes even when the proxy keeps the connection open',async()=>{
 let canceled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"snapshot","turn":{"state":"ERROR"}}\n\n'));},cancel(){canceled=true;}});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(stream,{headers:{'content-type':'text/event-stream'}}));
 const events:any[]=[];
 await streamQuestion('c','p','r',new AbortController().signal,e=>events.push(e));
 expect(events).toHaveLength(1);
 expect(canceled).toBe(true);
});
it('maintenance keeps developer entry available and disables paid submission',async()=>{
 mockChat().mockImplementation(async(url)=>String(url).endsWith('/capabilities')?json({enabled:false,notice:'준비 중',prompt_chars:3000,daily_limit:10}):json({conversations:[]}));
 render(<ChatWorkspace onSignOut={async()=>{}}/>);
 expect(await screen.findByText('준비 중')).toBeVisible();
 expect(screen.getByRole('button',{name:'질문하기'})).toBeDisabled();
 expect(screen.getByRole('link',{name:'Developer Console'})).toBeVisible();
});
