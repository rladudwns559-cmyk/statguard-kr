import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
// Only the public publishable format is accepted; never accept a service-role JWT.
export const supabase = url.startsWith('https://') && key.startsWith('sb_publishable_')
  ? createClient(url, key, { global: { fetch: (input,init)=>fetch(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(20000)])}) }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
