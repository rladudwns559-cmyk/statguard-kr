import { useRef, useState } from 'react';
import { checkArithmetic, type ArithmeticResult } from './answerClient';
import { localCalculationAvailable } from './calculationClient';

/**
 * Inline arithmetic check (statguard-arithmetic): recompute the calculations an answer writes out itself.
 * Needs no CSV and no LLM. Shown inside answer verification, and on its own when there is no CSV.
 */
const short = (v: string) => (v.length > 14 ? (Number(v).toPrecision(10).replace(/\.?0+$/, '')) : v);

export function ArithmeticList({ result }: { result: ArithmeticResult }) {
  if (!result.checks.length) return null;
  return <section className="sg-arith" aria-label="답변 속 계산 검산">
    <h3>답변 속 계산 검산 <small>CSV 없이, 답변이 적은 식만 다시 계산</small></h3>
    <p className="sg-hint">계산식 {result.summary.checked}개 중 {result.summary.inconsistent ? <strong>{result.summary.inconsistent}개가 틀렸습니다</strong> : '틀린 식은 없습니다'}. 결과의 마지막 자릿수로 반올림해 비교합니다.</p>
    <ul>{result.checks.map((c, i) => <li key={i} className={c.status === 'INCONSISTENT' ? 'is-bad' : 'is-ok'}>
      <span className="sg-arith-status">{c.status === 'INCONSISTENT' ? '계산 틀림' : '계산 맞음'}</span>
      <code>{c.expression} = {c.stated}</code>
      {c.status === 'INCONSISTENT' && <span className="sg-arith-fix">다시 계산하면 <b className="sg-num">{short(c.recomputed)}</b></span>}
    </li>)}</ul>
    <p className="sg-hint">답변이 적은 계산 과정만 확인합니다. 숫자를 자료에서 잘못 옮겨 적은 경우는 CSV로 검증해야 찾을 수 있습니다.</p>
  </section>;
}

export function ArithmeticOnly() {
  const [answer, setAnswer] = useState(''), [result, setResult] = useState<ArithmeticResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  async function run() {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await checkArithmetic(answer, controller.signal)); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '검산을 완료하지 못했습니다.'); }
    finally { if (abort.current === controller) setBusy(false); }
  }
  return <section className="sg-card sg-arith-only" aria-labelledby="arith-heading">
    <h2 id="arith-heading">CSV가 없나요? 답변 속 계산만 검산하기</h2>
    <p>AI 답변에 적힌 계산식(예: “78.5 + 60.1 + … = 789.0”, “(426.6 / 3726.8) × 100 ≈ 11.4%”)을 다시 계산해 맞는지 확인합니다. 자료가 없어도 되고, GPT를 쓰지 않습니다.</p>
    <label className="sg-arith-input">검산할 답변<textarea value={answer} rows={5} maxLength={6000} placeholder="예: 전체 합계는 1000 + 1178 + 800 + 960 + 500 + 500 = 3938명입니다." onChange={e => { setAnswer(e.target.value); setResult(null); }}/></label>
    <button className="sg-primary" disabled={busy || !answer.trim() || !localCalculationAvailable()} aria-busy={busy} onClick={() => void run()}>{busy ? '검산 중…' : '답변 속 계산 검산'}</button>
    {error && <p className="sg-error" role="alert">{error}</p>}
    {result && (result.checks.length ? <ArithmeticList result={result}/> : <p role="status" className="sg-hint">답변에서 ‘식 = 결과’ 형태의 계산을 찾지 못했습니다. 숫자 자체를 확인하려면 CSV를 올려 검증하세요.</p>)}
  </section>;
}
