import small from './benchmarkSummary.json';
import large from './benchmarkSummaryLarge.json';
import domain from './benchmarkSummaryDomain.json';
import stability from './benchmarkStability.json';

/** Totals across all benchmarks, derived from the generated result files (never typed by hand). */
type Meta = { questions: number; datasets: number };
type Usage = { calls: number; input_tokens: number; output_tokens: number; estimated_usd: number; model: string };
type S = { meta: Meta; usage: Usage; holdout?: { meta: { questions: number } } };
const sets = [small, large, domain] as unknown as S[];

export const TOTALS = {
  questions: sets.reduce((a, s) => a + s.meta.questions + (s.holdout?.meta.questions ?? 0), 0),
  datasets: sets.reduce((a, s) => a + s.meta.datasets, 0),
  calls: sets.reduce((a, s) => a + s.usage.calls, 0),
  inputTokens: sets.reduce((a, s) => a + s.usage.input_tokens, 0),
  outputTokens: sets.reduce((a, s) => a + s.usage.output_tokens, 0),
  usd: sets.reduce((a, s) => a + s.usage.estimated_usd, 0),
  model: sets[0].usage.model,
  passed: Object.values(stability as unknown as Record<string, { total_passed: number }>).reduce((a, r) => a + r.total_passed, 0),
  wrongPassed: Object.values(stability as unknown as Record<string, { total_wrong_among_passed: number }>).reduce((a, r) => a + r.total_wrong_among_passed, 0),
};
