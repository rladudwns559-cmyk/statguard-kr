import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {calculationPlugin,MAX_BODY,runBridge} from './statguard-calculation-plugin.mjs';
const origin='http://127.0.0.1:5173';
const project=fileURLToPath(new URL('../../',import.meta.url));
const allowed={host:'127.0.0.1:5173',origin,'content-type':'application/json','x-statguard-client':'local-v0.1'};
function handler(bridge){let fn;calculationPlugin({project,origin,bridge}).configureServer({middlewares:{use:f=>{fn=f;}}});return fn;}
async function invoke(fn,{url='/__statguard/calculate',method='POST',headers=allowed,remote='127.0.0.1',body='{}'}={}){
 const req=new PassThrough();Object.assign(req,{url,method,headers,socket:{remoteAddress:remote}});
 const res=new EventEmitter();Object.assign(res,{writableEnded:false,destroyed:false,writeHead(status,headers){this.status=status;this.headers=headers;},end(text){this.body=text;this.writableEnded=true;}});
 const pending=fn(req,res,()=>{res.next=true;});queueMicrotask(()=>req.end(body));await pending;return res;
}
test('transports only local allowed requests and disables response caching',async()=>{
 let calls=0;const fn=handler(async bytes=>{calls++;assert.equal(bytes.toString(),'{}');return {ok:true};});
 const res=await invoke(fn);assert.equal(res.status,200);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(calls,1);
});
for(const [name,options] of [
 ['wrong origin',{headers:{...allowed,origin:'https://untrusted.invalid'}}],['missing origin',{headers:{host:allowed.host,'content-type':'application/json','x-statguard-client':'local-v0.1'}}],
 ['host rebinding',{headers:{...allowed,host:'untrusted.invalid'}}],['no client header',{headers:{host:allowed.host,origin,'content-type':'application/json'}}],
 ['form post',{headers:{...allowed,'content-type':'application/x-www-form-urlencoded'}}],['remote address',{remote:'192.0.2.1'}]
])test('rejects '+name,async()=>{let calls=0;const res=await invoke(handler(async()=>{calls++;return {ok:true};}),options);assert.equal(res.status,403);assert.equal(calls,0);});
test('bounds declared and streamed request sizes',async()=>{
 const fn=handler(async()=>{throw new Error('Should not execute');});
 assert.equal((await invoke(fn,{headers:{...allowed,'content-length':String(MAX_BODY+1)}})).status,413);
 assert.equal((await invoke(fn,{body:Buffer.alloc(MAX_BODY+1)})).status,413);
});
test('has no preflight permission and never intercepts existing routes',async()=>{
 assert.equal((await invoke(handler(async()=>({ok:true})),{method:'OPTIONS'})).status,404);
 assert.equal((await invoke(handler(async()=>({ok:true})),{url:'/api/v1/runs'})).next,true);
});
test('capabilities use no uploaded data',async()=>{
 const fn=handler(async bytes=>{assert.deepEqual(JSON.parse(bytes),{mode:'capabilities'});return {ok:true};});
 assert.equal((await invoke(fn,{url:'/__statguard/capabilities',method:'GET',headers:{host:allowed.host}})).status,200);
});
test('engine failures expose bounded codes and no thrown exception message',async()=>{
 const fn=handler(async()=>{throw new Error('SYNTHETIC_PRIVATE_MARKER');});const res=await invoke(fn);
 assert.equal(res.status,500);assert.ok(!res.body.includes('SYNTHETIC_PRIVATE_MARKER'));
 for(const [code,status] of [['ENGINE_TIMEOUT',504],['ENGINE_UNAVAILABLE',503],['SOURCE_MISMATCH',422]])assert.equal((await invoke(handler(async()=>({ok:false,error:{code}})))).status,status);
});
test('limits in-flight work instead of spawning unlimited children',async()=>{
 const pending=[];const fn=handler(()=>new Promise(resolve=>pending.push(resolve)));
 const first=invoke(fn),second=invoke(fn);await new Promise(setImmediate);
 assert.equal((await invoke(fn)).status,429);pending.forEach(resolve=>resolve({ok:true}));await Promise.all([first,second]);
});
test('isolated Python process executes capabilities and unavailable executable is handled',async()=>{
 const value=await runBridge(Buffer.from('{"mode":"capabilities"}'),{project});assert.equal(value.ok,true);assert.equal(value.provider,'NONE');
 const failure=await runBridge(Buffer.from('{}'),{project,python:'C:/not-a-real-executable/statguard.exe'});assert.equal(failure.error.code,'ENGINE_UNAVAILABLE');
});
test('cancellation and process timeout are explicit and never retry',async()=>{
 const ctl=new AbortController();ctl.abort();assert.equal((await runBridge(Buffer.from('{}'),{project,signal:ctl.signal})).error.code,'CALCULATION_CANCELLED');
 assert.equal((await runBridge(Buffer.from('{}'),{project,timeout:0})).error.code,'ENGINE_TIMEOUT');
});
function liveHandler(bridge,live){let fn;calculationPlugin({project,origin,bridge,live}).configureServer({middlewares:{use:f=>{fn=f;}}});return fn;}
test('live ask is off by default and reports disabled status',async()=>{
 const fn=liveHandler(async()=>({ok:true}),null);
 const status=await invoke(fn,{url:'/__statguard/live-status',method:'GET',headers:{host:allowed.host}});
 assert.equal(status.status,200);assert.equal(JSON.parse(status.body).enabled,false);
 assert.equal((await invoke(fn,{url:'/__statguard/ask'})).status,404);
});
test('live ask passes the key only to the ask child and enforces the call cap',async()=>{
 const seen=[];const fn=liveHandler(async(bytes,options)=>{seen.push(options);return {ok:true,answer:'x'};},{apiKey:'TEST_KEY_NOT_REAL',maxCalls:2});
 assert.equal((await invoke(fn,{url:'/__statguard/ask'})).status,200);
 assert.equal((await invoke(fn,{url:'/__statguard/ask'})).status,200);
 assert.equal((await invoke(fn,{url:'/__statguard/ask'})).status,429);
 assert.equal(seen.length,2);assert.equal(seen[0].extraEnv.OPENAI_API_KEY,'TEST_KEY_NOT_REAL');assert.ok(seen[0].code.includes('live_ask'));
 await invoke(fn);assert.equal(seen[2].extraEnv,undefined);
 const status=JSON.parse((await invoke(fn,{url:'/__statguard/live-status',method:'GET',headers:{host:allowed.host}})).body);
 assert.equal(status.remaining,0);assert.ok(!JSON.stringify(status).includes('TEST_KEY'));
 assert.equal((await invoke(fn,{url:'/__statguard/ask',headers:{...allowed,origin:'https://untrusted.invalid'}})).status,403);
});
