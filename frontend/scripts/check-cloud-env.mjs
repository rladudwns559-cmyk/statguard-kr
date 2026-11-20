// Deployment only: local tests/builds can still render the public preview without Auth.
import { loadEnv } from 'vite';
import { spawnSync } from 'node:child_process';
// Vercel injects this optional client-observability setting even with system
// variable exposure disabled. This app does not use it; exclude it from both
// validation and the build children instead of widening the public allowlist.
delete process.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG;
const allowedPublicKeys = new Set(['VITE_WHEN2WARN_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_LOCAL_RESEARCH_MODE']);
const unexpectedPublicKeys = Object.keys(loadEnv('production', process.cwd(), 'VITE_')).filter(k => !allowedPublicKeys.has(k));
if (unexpectedPublicKeys.length) {
  // Names only: never print environment values, even for a failed deployment.
  console.error('Unexpected public environment variable names: ' + unexpectedPublicKeys.map(k => k.replace(/[^A-Za-z0-9_]/g, '?')).join(', '));
  process.exit(1);
}
const keys = ['VITE_WHEN2WARN_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
function publicOrigin(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.origin === value && !u.username && !u.password
      && u.hostname.includes('.') && !/^(localhost|127\.|0\.)/.test(u.hostname)
      && !/\.(localhost|local|internal|invalid|example)$/.test(u.hostname);
  } catch { return false; }
}
if (keys.some(k => !process.env[k]) || !publicOrigin(process.env[keys[0]])
    || !publicOrigin(process.env[keys[1]]) || !process.env[keys[2]].startsWith('sb_publishable_')
    || process.env.VITE_LOCAL_RESEARCH_MODE === 'true') {
  console.error('Cloud frontend config missing/invalid. Required public variable names: ' + keys.join(', '));
  process.exit(1);
}
console.log('Cloud public configuration shape validated (connectivity not checked).');
if (process.argv.includes('--build')) {
  for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build']]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    if (result.error || result.status !== 0) process.exit(result.status ?? 1);
  }
}
