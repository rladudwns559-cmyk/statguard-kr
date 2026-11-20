import type { ExecutionHistory, RunSummary, RunDetail, RunBundle, CanonicalEventView, RuntimeEvidenceView, DecisionRecordView } from './types';

export const API_BASE = (import.meta.env.VITE_WHEN2WARN_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public kind: 'unavailable' | 'malformed' | 'not-found' | 'request', message: string) { super(message); }
}
const object = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const count = (v: unknown) => Number.isInteger(v) && Number(v) >= 0;
const level = (v: unknown) => ['NONE', 'WEAK', 'STRONG', 'CRITICAL'].includes(String(v));
const decision = (v: unknown) => ['CONTINUE', 'REVIEW', 'INTERVENE'].includes(String(v));
const forbidden = new Set(['final_outcome', 'final_success', 'final_reward', 'reward', 'correct', 'pass_rate', 'reference_answer', 'evaluator_verdict', 'repaired_outcome', 'future_observation', 'future_action_result', 'hidden_analysis', 'chain_of_thought']);
function online(v: unknown): void {
  if (Array.isArray(v)) v.forEach(online);
  else if (object(v)) Object.entries(v).forEach(([key, value]) => { if (forbidden.has(key.toLowerCase())) throw new ApiError('malformed', '응답에 온라인 표시가 허용되지 않은 필드가 있습니다.'); online(value); });
}
function requireShape(ok: boolean): asserts ok { if (!ok) throw new ApiError('malformed', 'API 응답이 누락되었거나 형식이 올바르지 않습니다.'); }
export function parseRun(v: unknown): RunDetail {
  online(v);
  requireShape(object(v) && typeof v.run_id === 'string' && typeof v.source_host === 'string' && typeof v.created_at === 'string' && typeof v.status === 'string' && object(v.metadata) && count(v.event_count) && count(v.decision_count) && typeof v.source_asserted === 'boolean' && ['external_run_id','task_id','agent_id'].every(k => nullableString(v[k])));
  return v as unknown as RunDetail;
}
export function parseRuns(v: unknown): RunSummary[] {
  requireShape(object(v) && Array.isArray(v.runs));
  return v.runs.map((row: unknown) => { parseRun(row); requireShape(object(row) && (row.latest_decision === null || decision(row.latest_decision)) && level(row.latest_evidence_level)); return row as unknown as RunSummary; });
}
function provider(v: unknown): boolean { return object(v) && typeof v.provider_name === 'string' && typeof v.provider_version === 'string' && typeof v.status === 'string' && (v.score === null || (typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score <= 1)) && strings(v.warnings); }
export function parseEvents(v: unknown): CanonicalEventView[] {
  online(v); requireShape(object(v) && Array.isArray(v.events));
  for (const e of v.events) requireShape(object(e) && typeof e.event_id === 'string' && count(e.event_index) && typeof e.actor === 'string' && typeof e.event_type === 'string' && (e.decision_group === null || count(e.decision_group)) && ['action_name','observation','error','visible_text','parent_event_id','timestamp'].every(k => nullableString(e[k])) && 'arguments' in e);
  return [...v.events].sort((a,b) => a.event_index - b.event_index);
}
export function parseEvidence(v: unknown): RuntimeEvidenceView[] {
  online(v); requireShape(object(v) && Array.isArray(v.evidence));
  for (const e of v.evidence) requireShape(object(e) && typeof e.evidence_id === 'string' && count(e.event_index) && count(e.decision_group) && level(e.evidence_level) && ['evidence_type','reason_code','source','observed_value'].every(k => typeof e[k] === 'string') && strings(e.source_event_ids) && ['host_verified','online_safe','deterministic'].every(k => typeof e[k] === 'boolean'));
  return [...v.evidence].sort((a,b) => a.event_index - b.event_index);
}
export function parseDecisions(v: unknown): DecisionRecordView[] {
  online(v); requireShape(object(v) && Array.isArray(v.decisions));
  for (const d of v.decisions) {
    requireShape(object(d) && decision(d.decision) && level(d.evidence_level) && ['backend_decision_id','decision_id','prefix_hash','policy_version'].every(k => typeof d[k] === 'string') && strings(d.reason_codes) && strings(d.provider_warnings) && nullableString(d.selected_intervention) && Array.isArray(d.candidate_interventions) && object(d.provider_status) && (d.provider_status.p_failure === null || provider(d.provider_status.p_failure)) && object(d.provider_status.q_recovery) && Object.values(d.provider_status.q_recovery).every(provider) && object(d.decision_record) && count(d.decision_record.decision_event_index) && typeof d.decision_record.fallback_used === 'boolean' && nullableString(d.decision_record.review_reason));
    for (const c of d.candidate_interventions) requireShape(object(c) && ['candidate_id','intervention_type','target','action'].every(k => typeof c[k] === 'string') && object(c.args) && nullableString(c.scope) && typeof c.executable === 'boolean');
    parseEvidence({evidence:d.runtime_evidence});
  }
  return [...v.decisions].sort((a,b) => a.decision_record.decision_event_index - b.decision_record.decision_event_index);
}
async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(API_BASE + path, { signal, headers: { Accept: 'application/json' } }); }
  catch (e) { if (signal?.aborted) throw e; throw new ApiError('unavailable', '백엔드에 연결할 수 없습니다. 로컬 API가 실행 중인지 확인하세요.'); }
  if (!response.ok) throw new ApiError(response.status === 404 ? 'not-found' : 'request', response.status === 404 ? '요청한 실행 기록을 찾을 수 없습니다.' : `API 요청에 실패했습니다. (${response.status})`);
  try { return await response.json(); } catch { throw new ApiError('malformed', 'API가 올바른 JSON을 반환하지 않았습니다.'); }
}
export function parseExecutionHistory(v:unknown):ExecutionHistory {
  requireShape(object(v)&&typeof v.run_id==='string'&&Array.isArray(v.executions)&&Array.isArray(v.verifications));
  online(v.executions);
  for(const e of v.executions)requireShape(object(e)&&e.run_id===v.run_id&&['execution_id','decision_id','backend_decision_id','candidate_id','reason_code','adapter_version','started_at'].every(k=>typeof e[k]==='string')&&typeof e.executed==='boolean'&&['DISPATCHED','SKIPPED','EXECUTED','EXECUTION_FAILED'].includes(e.execution_status)&&strings(e.source_event_ids));
  // Verification terminal fields are deliberately separate from the online timeline.
  for(const r of v.verifications)requireShape(object(r)&&r.run_id===v.run_id&&['verification_id','execution_id','verification_basis'].every(k=>typeof r[k]==='string')&&['VERIFIED_RECOVERY','VERIFIED_FAILURE','INCONCLUSIVE'].includes(r.verification_status)&&strings(r.source_event_ids));
  return v as unknown as ExecutionHistory;
}
export const api = {
  async executionHistory(id:string,signal?:AbortSignal){return parseExecutionHistory(await get(`/api/v1/runs/${encodeURIComponent(id)}/execution-history`,signal));},
  async runs(signal?: AbortSignal) { return parseRuns(await get('/api/v1/runs', signal)); },
  async bundle(id: string, signal?: AbortSignal): Promise<RunBundle> {
    const base = `/api/v1/runs/${encodeURIComponent(id)}`;
    const [run, events, evidence, decisions] = await Promise.all([get(base,signal),get(base+'/events',signal),get(base+'/evidence',signal),get(base+'/decisions',signal)]);
    return {run:parseRun(run),events:parseEvents(events),evidence:parseEvidence(evidence),decisions:parseDecisions(decisions)};
  }
};
