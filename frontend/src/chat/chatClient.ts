import { API_BASE, getAccessToken } from '../api/cloudClient';
export const chatErrors:Record<string,string> = {
  CHAT_UNAVAILABLE:'AI 답변 검증을 준비 중입니다.',
  CHAT_DAILY_LIMIT:'오늘의 베타 사용 한도에 도달했습니다.',
  CHAT_MINUTE_LIMIT:'요청이 많습니다. 잠시 후 다시 질문해 주세요.',
  CHAT_BUSY:'이전 답변을 처리 중입니다. 완료된 뒤 다시 질문해 주세요.',
  CHAT_CAPACITY:'오늘의 서비스 사용 한도에 도달했습니다. 내일 다시 이용해 주세요.',
  CHAT_ALREADY_SUBMITTED:'이미 접수한 질문입니다. 대화를 다시 열어 확인해 주세요.',
};
export async function streamQuestion(cid:string,prompt:string,requestId:string,signal:AbortSignal,onEvent:(event:any)=>void){
  const token=await getAccessToken();
  if(!token)throw new Error('다시 로그인해 주세요.');
  const response=await fetch(API_BASE+'/api/v1/chat/conversations/'+encodeURIComponent(cid)+'/messages',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'},
    body:JSON.stringify({prompt,request_id:requestId}),signal,cache:'no-store',credentials:'omit',redirect:'error',
  });
  if(response.status===401){window.dispatchEvent(new Event('when2warn:unauthorized'));throw new Error('다시 로그인해 주세요.');}
  if(!response.ok){
    const body=await response.json().catch(()=>({}));
    throw new Error(chatErrors[body.error?.code]||'질문을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if(!response.headers.get('content-type')?.includes('text/event-stream')||!response.body)throw new Error('답변 연결을 확인할 수 없습니다.');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='',terminal=false;
  try{
    while(true){
      const {value,done}=await reader.read();
      buffer+=decoder.decode(value,{stream:!done}).replace(/\r\n/g,'\n');
      if(buffer.length>1_000_000)throw new Error('답변 크기 제한에 도달했습니다.');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const data=frame.split('\n').filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n');
        if(data){const event=JSON.parse(data);onEvent(event);if(event.type==='snapshot'&&['COMPLETE','ERROR'].includes(event.turn?.state))terminal=true;}
      }
      // A proxy can keep an SSE connection open after the final snapshot.
      if(terminal){await reader.cancel().catch(()=>{});break;}
      if(done)break;
    }
    if(!terminal)throw new Error('연결이 중단되었습니다. 대화를 다시 열면 저장된 답변을 확인할 수 있습니다.');
  }finally{reader.releaseLock();}
}
