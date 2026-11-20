/** Same-origin, loopback-only transport to the existing Python calculation core. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const MAX_BODY=1_500_000;
const PREFIX='/__statguard/';
const CODE='import sys;sys.path.insert(0,sys.argv[1]);from when2warn.statguard.local_bridge import main;main()';
const ASK_CODE='import sys;sys.path.insert(0,sys.argv[1]);from when2warn.statguard.live_ask import main;main()';
const failure=code=>({ok:false,error:{code}});
export function pythonExecutable(){
  return process.env.STATGUARD_PYTHON || [path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')].find(existsSync) || 'python';
}

export function runBridge(payload,{project,python=pythonExecutable(),signal,timeout=8000,code=CODE,extraEnv={}}={}){
  return new Promise(resolve=>{
    if(signal?.aborted){resolve(failure('CALCULATION_CANCELLED'));return;}
    // Do not inherit API keys, DB credentials or provider settings.
    const env={...Object.fromEntries(['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),...extraEnv};
    const child=spawn(python,['-I','-S','-B','-c',code,path.join(project,'src')],{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let done=false,size=0;const chunks=[];
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(child.exitCode===null)child.kill();resolve(value);};
    const cancel=()=>finish(failure('CALCULATION_CANCELLED'));
    const timer=setTimeout(()=>finish(failure('ENGINE_TIMEOUT')),timeout);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',()=>finish(failure('ENGINE_UNAVAILABLE')));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>750_000)finish(failure('ENGINE_RESPONSE_LIMIT'));else chunks.push(chunk);});
    // Drain without logging or forwarding exception text or raw input.
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(done)return;
      if(code!==0){finish(failure('ENGINE_UNAVAILABLE'));return;}
      try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof result?.ok!=='boolean')throw new Error();finish(result);}
      catch{finish(failure('ENGINE_INVALID_RESPONSE'));}
    });
    child.stdin.end(payload);
  });
}

function readBody(req){
  return new Promise(resolve=>{
    let size=0,done=false;const chunks=[];
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish({error:'REQUEST_TIMEOUT'}),5000);
    req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>MAX_BODY)finish({error:'REQUEST_TOO_LARGE'});else chunks.push(chunk);});
    req.on('end',()=>finish({body:Buffer.concat(chunks)}));
    req.on('error',()=>finish({error:'REQUEST_ABORTED'}));req.on('aborted',()=>finish({error:'REQUEST_ABORTED'}));
  });
}

/** live: {apiKey, maxCalls} enables the local-only demo route that asks an LLM (never in the Vercel bundle). */
export function calculationPlugin({project,origin='http://127.0.0.1:5173',bridge=runBridge,live=null}={}){
  let active=0,liveUsed=0;
  return {name:'statguard-local-calculation',apply:'serve',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const route=(req.url||'').split('?')[0];if(!route.startsWith(PREFIX))return next();
    const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const remote=req.socket.remoteAddress;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)||req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin){send(403,failure('LOCAL_ORIGIN_REQUIRED'));return;}
    const capabilities=route===PREFIX+'capabilities'&&req.method==='GET';
    const calculate=route===PREFIX+'calculate'&&req.method==='POST';
    const liveStatus=route===PREFIX+'live-status'&&req.method==='GET';
    const ask=route===PREFIX+'ask'&&req.method==='POST';
    if(liveStatus){send(200,{ok:true,enabled:!!live,remaining:live?Math.max(0,live.maxCalls-liveUsed):0,model:'gpt-6-luna'});return;}
    if(!capabilities&&!calculate&&!ask){send(404,failure('NOT_FOUND'));return;}
    if(ask&&!live){send(404,failure('LIVE_ASK_DISABLED'));return;}
    if(ask&&liveUsed>=live.maxCalls){send(429,failure('LIVE_ASK_LIMIT'));return;}
    if((calculate||ask)&&(req.headers.origin!==origin||req.headers['x-statguard-client']!=='local-v0.1'||(req.headers['content-type']||'').split(';')[0]!=='application/json')){send(403,failure('LOCAL_ORIGIN_REQUIRED'));return;}
    if(active>=2){send(429,failure('ENGINE_BUSY'));return;}
    const length=req.headers['content-length'];
    if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY)){send(413,failure('REQUEST_TOO_LARGE'));req.resume();return;}
    const controller=new AbortController();const closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
    active++;
    try{
      const input=capabilities?{body:Buffer.from('{"mode":"capabilities"}')} : await readBody(req);
      if(input.error){send(input.error==='REQUEST_TOO_LARGE'?413:400,failure(input.error));return;}
      if(controller.signal.aborted)return;
      if(ask)liveUsed++;
      const result=ask?await bridge(input.body,{project,signal:controller.signal,timeout:95000,code:ASK_CODE,extraEnv:{OPENAI_API_KEY:live.apiKey}})
        :await bridge(input.body,{project,signal:controller.signal});
      const status=result.ok?200:result.error?.code==='ENGINE_TIMEOUT'?504:result.error?.code==='ENGINE_UNAVAILABLE'?503:422;
      send(status,result);
    }catch{send(500,failure('LOCAL_CALCULATION_ERROR'));}
    finally{active--;res.removeListener('close',closed);}
  });}};
}
