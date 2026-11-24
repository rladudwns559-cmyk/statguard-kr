/** Experiment numbers shared by the home and results pages (statguard_comparison_v0.1 and later); kept apart from
 * the results-page components so the home page does not load them. Built by experiments/export_site_comparison.py. */
import comparison from './benchmarkComparison.json';

export type V = { n: number; pass: number; passed_wrong: number; wrong: number; wrong_flagged: number; false_alarm: number; coverage: number; upper95: number };
export type ModelRow = { n: number; A: number; R1: number; S1: number; S2: number; flagged: number; flagged_R1: number; flagged_S1: number; S1_broken: number; passed_wrong: Record<string, [number, number]> };
export type Fx = { injected: Record<string, number>; random: { explained: number; n: number; high: number }; real_by_model: Record<string, { contradicted: number; explained: number; high?: number }>;
  injected_by_kind: Record<string, Record<string, number>>; examples: { model: string; question: string; sentence: string; diagnosis: { title: string; explanation: string } }[] };
export const COMPARISON = comparison as unknown as { verifiers: Record<'prereg' | 'final_rule' | 'judge' | 'hybrid', V>; main88: Record<string, V>; models: Record<string, ModelRow>;
  after_correction_prereg: Record<string, { R2: number; S2: number }>; judge5_partial: { done: number; of: number }; forensics: Fx;
  final_rule_validation: { answers: number; prereg: V; final_rule: V };
  extractor_v08: { adopted: boolean; table: Record<string, { pass: number; passed_wrong: number; false_alarm: number; wrong_flagged: number }> };
  arithmetic: { version: string; groups: Record<string, Ar>; total: Ar; before_fix_total: Ar; right_flagged: ArCase[]; examples: ArCase[] };
  cost_speed?: { machine: string; statguard: { answers: number; median_ms: number; p95_ms: number; usd_per_1000: number; passed: number; passed_wrong: number };
    llm_judge: { calls: number; median_s: number; p95_s: number; usd_per_1000: number; mean_input_tokens: number; passed: number; passed_wrong: number }; speedup_median: number };
  ranges?: { holds_before: number; holds_after: number; computed: number; passed_before: number; passed_after: number; passed_wrong_after: number; false_alarm_after: number; passed_wrong_before: number; false_alarm_before: number } };
export type Ar = { answers: number; wrong: number; with_checks: number; flagged: number; flagged_wrong: number; flagged_right: number; added: number };
export type ArCase = { source: string; question: string; expression: string; stated: string; recomputed: string; correct: boolean; statguard: string };
