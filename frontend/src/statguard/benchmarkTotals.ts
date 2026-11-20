import small from './benchmarkSummary.json';
import large from './benchmarkSummaryLarge.json';
import domain from './benchmarkSummaryDomain.json';
import stability from './benchmarkStability.json';

/** Totals across all benchmarks, derived from the generated result files (never typed by hand). */
type Meta = { questions: number; datasets: number };
type Usage = { calls: number; input_tokens: number; output_tokens: number; estimated_usd: number; model: string };
type S = { meta: Meta; usage: Usage; holdout?: { meta: { questions: number } } };
const sets = [small, large, domain] as unknown as S[];

/**
 * Exact (Clopper-Pearson) two-sided upper confidence limit for a binomial rate with k events in n trials.
 * Solves P(X <= k | n, p) = (1 - level) / 2 by bisection; for k = 0 this equals 1 - ((1 - level) / 2) ** (1 / n).
 */
export function upperLimit(k: number, n: number, level = 0.95) {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  const tail = (1 - level) / 2;
  const cdf = (p: number) => { let sum = 0, term = Math.pow(1 - p, n); for (let i = 0; i <= k; i++) { sum += term; term *= ((n - i) / (i + 1)) * (p / (1 - p)); } return sum; };
  let lo = k / n, hi = 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) > tail) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
type Run = { passed: number; wrong_among_passed: number };
const stableRows = Object.values(stability as unknown as Record<string, { total_passed: number; total_wrong_among_passed: number; per_run: Run[] }>);

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
  /** First run only: one answer per question and condition, so repeats of the same question are not counted as extra evidence. */
  firstRunPassed: stableRows.reduce((a, r) => a + r.per_run[0].passed, 0),
  firstRunWrong: stableRows.reduce((a, r) => a + r.per_run[0].wrong_among_passed, 0),
};
/** 95% upper limits for "wrong among passed": all 3 runs treated as independent, and the stricter first-run-only count. */
export const WRONG_UPPER = { all: upperLimit(TOTALS.wrongPassed, TOTALS.passed), firstRun: upperLimit(TOTALS.firstRunWrong, TOTALS.firstRunPassed) };
export const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
