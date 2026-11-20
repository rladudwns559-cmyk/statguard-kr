import { useEffect, useState } from 'react';
export function useResource<T>(load:(signal:AbortSignal)=>Promise<T>, key:string) {
  const [revision,setRevision]=useState(0);
  const [state,setState]=useState<{data:T|null;error:Error|null;loading:boolean}>({data:null,error:null,loading:true});
  useEffect(()=>{const controller=new AbortController();setState({data:null,error:null,loading:true});load(controller.signal).then(data=>{if(!controller.signal.aborted)setState({data,error:null,loading:false});}).catch(error=>{if(!controller.signal.aborted)setState({data:null,error:error instanceof Error?error:new Error('응답을 확인할 수 없습니다.'),loading:false});});return ()=>controller.abort();},[key,revision]);
  return {...state,retry:()=>setRevision(v=>v+1)};
}
