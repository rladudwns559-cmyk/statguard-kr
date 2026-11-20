/** Loopback-only UI preview. Never loads .env files or provider configuration. */
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {readFileSync} from 'node:fs';
import {calculationPlugin} from './statguard-calculation-plugin.mjs';
// --live [--live-env-file <path>]: local demo that asks gpt-6-luna (max 30 calls per run).
// The key is read from OPENAI_API_KEY or the given env file and only passed to the ask child process.
const argv=process.argv.slice(2);
function liveConfig(){
  if(!argv.includes('--live'))return null;
  let apiKey=process.env.OPENAI_API_KEY||'';
  const fileIndex=argv.indexOf('--live-env-file');
  if(!apiKey&&fileIndex>=0){const line=readFileSync(argv[fileIndex+1],'utf8').split(/\r?\n/).find(l=>l.startsWith('OPENAI_API_KEY='));apiKey=line?line.slice(15).trim().replace(/^"|"$/g,''):'';}
  if(!apiKey){console.error('--live requires OPENAI_API_KEY or --live-env-file');process.exit(1);}
  return {apiKey,maxCalls:30};
}
const live=liveConfig();
const frontend=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(frontend,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const react=(await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
const server=await createServer({root:frontend,configFile:false,envFile:false,envPrefix:'STATGUARD_NO_ENV_',plugins:[react(),calculationPlugin({project:path.dirname(frontend.replace(/[\\/]$/, '')),live})],cacheDir:path.join(os.tmpdir(),'when2warn-statguard-local-v0.1'),define:{'import.meta.env.VITE_LOCAL_RESEARCH_MODE':JSON.stringify('false'),'import.meta.env.VITE_WHEN2WARN_API_URL':JSON.stringify('http://127.0.0.1:8001'),'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(''),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('')},server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false,fs:{allow:[frontend]}}});
await server.listen();
console.log('StatGuard CSV: http://127.0.0.1:5173/statguard');
console.log(live?'LIVE DEMO: AI 질문 기능 켜짐 (gpt-6-luna, 최대 30회). 화면에서 질문할 때만 호출합니다.':'Local CSV preview and Python calculation only. No private .env, provider, or deployment.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
