import type { CSSProperties, ReactNode } from 'react';
import data from './aiAnswers.json';
import { COMPARISON } from './ResultsExtras';

/** Headline whose words rise into place one after another (Lusion-style reveal). Text content stays a plain sentence. */
export function RiseHeadline({ id, parts }: { id: string; parts: { text: string; grad?: boolean }[] }) {
  let n = 0;
  const words: ReactNode[] = [];
  parts.forEach((part, pi) => part.text.split(/(\s+)/).forEach((w, wi) => {
    if (!w) return;
    if (/^\s+$/.test(w)) { words.push(w); return; }
    const i = n++;
    words.push(<span key={`${pi}-${wi}`} className="sg-rise"><span className={part.grad ? 'sg-rise-in sg-grad' : 'sg-rise-in'} style={{ '--i': i } as CSSProperties}>{w}</span></span>);
  }));
  return <h1 id={id} className="sg-rise-h1">{words}</h1>;
}

type Item = { key: string; final: string; expected: string; correct: boolean; error_kind: string; statguard: string; corrected_round: number | null };
const SG = { FLAG: 'StatGuard 불일치', HOLD: 'StatGuard 보류', PASS: 'StatGuard 통과' } as Record<string, string>;
/** A running ribbon of real wrong answers recorded in the experiment (number errors only). */
export function WrongTicker() {
  const items = (data as unknown as { items: Item[] }).items.filter(i => !i.correct && /수치 오류|단위 오류/.test(i.error_kind));
  const row = items.map(i => <span key={i.key} className="sg-tick"><b>AI</b><span className="sg-num sg-tick-bad">{i.final}</span><i aria-hidden="true">→</i><b>실제</b><span className="sg-num sg-tick-ok">{i.expected}</span><em>{SG[i.statguard]}{i.corrected_round !== null ? ' · 근거로 교정됨' : ''}</em></span>);
  return <section className="sg-ticker" aria-label={`실험에서 기록된 AI 수치 오답 ${items.length}개가 흐르는 띠`}>
    <div className="sg-ticker-track" aria-hidden="true">{row}{row}</div>
  </section>;
}

/**
 * Error forensics on the home page: one recorded wrong answer (v0.3:R02), what StatGuard recomputed,
 * and the mistake that reproduces the wrong number exactly. All text comes from aiAnswers.json and benchmarkComparison.json.
 */
type Why = { title: string; explanation: string; confidence: 'high' | 'medium' };
type Recorded = { key: string; question: string; answer: string; flag: { claimed: string; recomputed: string } | null; why?: Why | null; dataset: string };
export function ForensicShowcase({ caseKey = 'v0.3:R02' }: { caseKey?: string }) {
  const item = (data as unknown as { model: string; items: Recorded[] }).items.find(i => i.key === caseKey);
  const f = COMPARISON.forensics, inj = f.injected, nInj = (inj.correct ?? 0) + (inj.other ?? 0) + (inj.missed ?? 0);
  if (!item?.flag || !item.why) return null;
  const sentence = item.answer.split('\n')[0];
  const at = sentence.indexOf(item.flag.claimed);
  const before = at >= 0 ? sentence.slice(0, at) : sentence + ' ', after = at >= 0 ? sentence.slice(at + item.flag.claimed.length) : '';
  const recomputed = item.flag.recomputed.replace(/(\.\d{2})\d+/, '$1').replace(' ', '');
  return <section className="sg-section sg-fx" aria-labelledby="fx-heading">
    <h2 id="fx-heading">틀렸다고 말하는 데서 끝나지 않습니다. 왜 틀렸는지 계산으로 재현합니다.</h2>
    <p>AI의 숫자가 재계산과 다르면, 흔한 계산 실수를 하나씩 다시 계산해 그 숫자가 똑같이 나오는 실수를 찾습니다. 아래는 실험에서 {(data as unknown as { model: string }).model}가 실제로 쓴 답입니다.</p>
    <ol className="sg-fx-chain">
      <li className="sg-fx-step sg-fx-ai"><small>AI의 답변 · {item.dataset}</small><p>{before}<mark>{item.flag.claimed}</mark>{after}</p></li>
      <li className="sg-fx-step sg-fx-recount"><small>StatGuard 재계산</small><strong className="sg-num">{recomputed}</strong><p>같은 CSV, 같은 조건(고소득 국가)으로 다시 계산한 값</p></li>
      <li className="sg-fx-step sg-fx-cause"><small>틀린 이유 역추적 · {item.why.confidence === 'high' ? '확신 높음' : '확신 중간'}</small><strong>{item.why.title}</strong><p>{item.why.explanation}</p></li>
    </ol>
    <p className="sg-hint">검증: 일부러 넣은 계산 실수 {nInj}개 중 {inj.correct}개({(inj.correct / nInj * 100).toFixed(0)}%)의 원인을 맞게 찾았고, 이유 없이 틀린 숫자 {f.random.n}개에는 {f.random.explained}개({(f.random.explained / f.random.n * 100).toFixed(0)}%)에만 설명을 붙였습니다. 재현은 가능성이 높은 원인이지 증명은 아닙니다.</p>
  </section>;
}
