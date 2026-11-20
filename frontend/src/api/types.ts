export type Decision = 'CONTINUE' | 'REVIEW' | 'INTERVENE';
export type EvidenceLevel = 'NONE' | 'WEAK' | 'STRONG' | 'CRITICAL';
export interface RunDetail {
  run_id: string; external_run_id: string | null; task_id: string | null; agent_id: string | null;
  source_host: string; created_at: string; status: string; metadata: Record<string, unknown>;
  event_count: number; decision_count: number; source_asserted: boolean;
}
export interface RunSummary extends RunDetail { latest_decision: Decision | null; latest_evidence_level: EvidenceLevel }
export interface CanonicalEventView {
  event_id: string; event_index: number; actor: string; event_type: string; decision_group: number | null;
  action_name: string | null; arguments: unknown; observation: string | null; error: string | null;
  visible_text: string | null; parent_event_id: string | null; timestamp: string | null;
}
export interface RuntimeEvidenceView {
  evidence_id: string; event_index: number; decision_group: number; evidence_type: string;
  evidence_level: EvidenceLevel; reason_code: string; source: string; source_event_ids: string[];
  observed_value: string; host_verified: boolean; online_safe: boolean; deterministic: boolean;
}
export interface CandidateInterventionView {
  candidate_id: string; intervention_type: string; target: string; action: string;
  args: Record<string, unknown>; scope: string | null; executable: boolean; public_rationale?: string | null;
}
export interface ProviderStatusView {
  provider_name: string; provider_version: string; status: string; score: number | null; warnings: string[];
}
export interface DecisionRecordView {
  backend_decision_id: string; decision_id: string; decision: Decision; evidence_level: EvidenceLevel;
  runtime_evidence: RuntimeEvidenceView[]; reason_codes: string[]; selected_intervention: string | null;
  candidate_interventions: CandidateInterventionView[];
  provider_status: { p_failure: ProviderStatusView | null; q_recovery: Record<string, ProviderStatusView> };
  provider_warnings: string[]; prefix_hash: string; policy_version: string;
  decision_record: { decision_event_index: number; fallback_used: boolean; review_reason: string | null };
}
export interface RunBundle { run: RunDetail; events: CanonicalEventView[]; evidence: RuntimeEvidenceView[]; decisions: DecisionRecordView[] }

export interface ExecutionRecord {
  execution_id:string; run_id:string; decision_id:string; backend_decision_id:string; candidate_id:string;
  executed:boolean; execution_status:'DISPATCHED'|'SKIPPED'|'EXECUTED'|'EXECUTION_FAILED'; reason_code:string;
  source_event_ids:string[]; adapter_version:string; started_at:string; error:string|null;
}
export interface VerificationRecord {
  verification_id:string; run_id:string; execution_id:string;
  verification_status:'VERIFIED_RECOVERY'|'VERIFIED_FAILURE'|'INCONCLUSIVE';
  verification_basis:string; source_event_ids:string[];
}
export interface ExecutionHistory {run_id:string;executions:ExecutionRecord[];verifications:VerificationRecord[]}
