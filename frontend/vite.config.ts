import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import process from 'node:process';
export default defineConfig(({mode,command})=>{
  const env=loadEnv(mode,process.cwd(),'VITE_');
  const allowed=new Set(['VITE_WHEN2WARN_API_URL','VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_LOCAL_RESEARCH_MODE']);
  for(const [key,value] of Object.entries(env)){
    if(!allowed.has(key))throw new Error('Unapproved frontend environment variable');
    if(/sb_secret_|postgres(?:ql)?:\/\//i.test(value))throw new Error('Private credentials are not frontend configuration');
  }
  if(env.VITE_SUPABASE_PUBLISHABLE_KEY && !env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'))
    throw new Error('Only a Supabase publishable key is allowed');
  if(command==='build'){
    if(env.VITE_LOCAL_RESEARCH_MODE==='true')throw new Error('Local research bypass cannot be built for production');
    if(env.VITE_WHEN2WARN_API_URL && !env.VITE_WHEN2WARN_API_URL.startsWith('https://'))
      throw new Error('Production API origin requires HTTPS');
  }
  return {
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], restoreMocks: true },
};});
