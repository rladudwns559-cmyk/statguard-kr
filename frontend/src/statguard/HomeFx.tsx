import type { CSSProperties, ReactNode } from 'react';
import data from './aiAnswers.json';

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
