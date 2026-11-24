import { useMemo, useState } from 'react';
import data from './aiAnswers.json';
import { SITE_NAME, STATGUARD_VERSION, StatGuardHeader, usePageTitle } from './StatGuardChrome';
import DarkBackdrop from './DarkBackdrop';
import './statguard.css';
import './statguard-theme.css';

/**
 * 'AI 오답 체험' page: a guess-the-mistake challenge and a gallery of every wrong answer,
 * built only from recorded answers (experiments/statguard_correction_v0.1/export_answers.py).
 */
export type Item = {
  key: string; bench: string; set: string; dataset: string; rows: number; question: string; answer: string; final: string; expected: string;
  answerable: boolean; correct: boolean; error_kind: string; statguard: 'FLAG' | 'PASS' | 'HOLD';
  flag: { claimed: string; recomputed: string } | null; targeted: boolean; corrected_round: number | null; recheck_fixed: boolean | null;
};
const D = data as unknown as { model: string; items: Item[] };
const ROUND = 5;
const clip = (t: string, n = 260) => (t.length > n ? t.slice(0, n) + '…' : t);
const SG_LABEL = { FLAG: '계산 불일치로 잡음', PASS: '계산 일치 확인', HOLD: '보류 (확정하지 않음)' } as const;

/** Mix of right and wrong recorded answers that end in a single number (the kind a reader would trust at a glance). */
export function pickRound(items: Item[], rand: () => number = Math.random): Item[] {
  const usable = items.filter(i => i.answerable && !/형식 오류|판단불가/.test(i.final));
  const wrong = usable.filter(i => !i.correct), right = usable.filter(i => i.correct);
  const take = (arr: Item[], k: number) => { const a = [...arr]; const out: Item[] = []; while (out.length < k && a.length) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; };
  const nWrong = 2 + Math.floor(rand() * 2);
  const round = [...take(wrong, nWrong), ...take(right, ROUND - nWrong)];
  return take(round, round.length);
}

function verdictOf(item: Item) {
  if (item.statguard === 'HOLD') return 'held';
  return (item.statguard === 'FLAG') !== item.correct ? 'right' : 'mistaken';
}

export function Challenge({ seed }: { seed?: () => number } = {}) {
  const [round, setRound] = useState(() => pickRound(D.items, seed));
  const [i, setI] = useState(0), [guess, setGuess] = useState<boolean | null>(null), [score, setScore] = useState<boolean[]>([]);
  const item = round[i], done = i >= round.length;
  function answer(saysCorrect: boolean) { if (guess !== null) return; setGuess(saysCorrect); setScore(s => [...s, saysCorrect === item.correct]); }
  function next() { setGuess(null); setI(n => n + 1); }
  function restart() { setRound(pickRound(D.items, seed)); setI(0); setGuess(null); setScore([]); }
  const sg = round.map(verdictOf);
  if (done) {
    const you = score.filter(Boolean).length;
    return <div className="sg-chal-card sg-chal-done" aria-label="챌린지 결과">
      <h3>결과</h3>
      <div className="sg-chal-scores">
        <div><strong>{you}/{round.length}</strong><span>당신이 맞힌 문제</span></div>
        <div><strong>{sg.filter(v => v === 'right').length}/{round.length}</strong><span>StatGuard가 판정해 맞힌 문제</span></div>
        <div><strong>{sg.filter(v => v === 'held').length}</strong><span>StatGuard가 확정하지 않고 보류</span></div>
        <div><strong>{sg.filter(v => v === 'mistaken').length}</strong><span>StatGuard가 잘못 판정</span></div>
      </div>
      <p className="sg-hint">이번 {round.length}문제 중 AI가 실제로 틀린 답은 {round.filter(r => !r.correct).length}개였습니다. 사람이 그럴듯한 숫자를 눈으로만 가려내기는 어렵습니다. StatGuard는 확정할 수 있을 때만 판정하고, 아니면 보류합니다.</p>
      <button type="button" className="sg-primary" onClick={restart}>새 문제로 다시 하기</button>
    </div>;
  }
  const revealed = guess !== null;
  return <div className="sg-chal-card" aria-label={`챌린지 ${i + 1}번 문제`}>
    <div className="sg-chal-progress" aria-hidden="true">{round.map((_, n) => <i key={n} className={n < i ? (score[n] ? 'ok' : 'bad') : n === i ? 'now' : ''}/>)}</div>
    <small>{i + 1} / {round.length} · 자료: {item.dataset} ({item.rows.toLocaleString('ko-KR')}행)</small>
    <h3>{item.question}</h3>
    <blockquote className="sg-chal-answer"><span>{D.model}의 실제 답변</span>{clip(item.answer)}</blockquote>
    {!revealed && <div className="sg-chal-buttons"><p>이 답의 최종값 <b>{item.final}</b>, 맞을까요?</p>
      <button type="button" className="sg-chal-yes" onClick={() => answer(true)}>맞다</button>
      <button type="button" className="sg-chal-no" onClick={() => answer(false)}>틀리다</button></div>}
    {revealed && <div className={'sg-chal-reveal ' + (item.correct ? 'is-right' : 'is-wrong')} role="status">
      <p className="sg-chal-verdict">{guess === item.correct ? '정답! ' : '아쉬워요. '}AI의 답은 <b>{item.correct ? '맞았습니다' : '틀렸습니다'}</b>. 실제 값: <b>{item.expected}</b>{!item.correct && item.error_kind ? ` (${item.error_kind})` : ''}</p>
      <p><span className={'sg-chal-sg sg-chal-sg-' + item.statguard.toLowerCase()}>StatGuard: {SG_LABEL[item.statguard]}</span>
        {item.flag && <> 답변의 {item.flag.claimed} → CSV 재계산 {item.flag.recomputed}</>}
        {!item.correct && item.corrected_round !== null && <> · 근거를 돌려주자 {item.corrected_round}번째 수정에서 고쳐짐</>}</p>
      <button type="button" className="sg-primary" onClick={next}>{i + 1 < round.length ? '다음 문제' : '결과 보기'}</button>
    </div>}
  </div>;
}

type Filter = 'all' | 'FLAG' | 'HOLD' | 'fixed';
export function Gallery() {
  const wrong = useMemo(() => D.items.filter(i => !i.correct), []);
  const [filter, setFilter] = useState<Filter>('all');
  const shown = wrong.filter(i => filter === 'all' || (filter === 'fixed' ? i.corrected_round !== null : i.statguard === filter));
  const count = (f: Filter) => wrong.filter(i => f === 'all' || (f === 'fixed' ? i.corrected_round !== null : i.statguard === f)).length;
  const tabs: [Filter, string][] = [['all', '전체'], ['FLAG', 'StatGuard가 잡은 것'], ['HOLD', '보류한 것'], ['fixed', '근거로 고쳐진 것']];
  return <>
    <div className="sg-result-tabs" aria-label="오답 갤러리 거르기">{tabs.map(([f, l]) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l} ({count(f)})</button>)}</div>
    <div className="sg-gallery">{shown.map(i => <article key={i.key} className={'sg-gallery-card sg-gallery-' + i.statguard.toLowerCase()} aria-label={`${i.key} 오답`}>
      <header><span className="sg-gallery-kind">{i.error_kind}</span><small>{i.dataset} · 실험 {i.key}</small></header>
      <h3>{i.question}</h3>
      <dl><div><dt>AI의 최종값</dt><dd className="sg-gallery-bad">{i.final}</dd></div><div><dt>실제 값</dt><dd>{i.expected}</dd></div></dl>
      <p className="sg-gallery-sg"><b>StatGuard</b> {SG_LABEL[i.statguard]}{i.flag ? ` (재계산 ${i.flag.recomputed})` : ''}</p>
      <p className="sg-gallery-fix"><b>근거 교정</b> {i.corrected_round !== null ? `${i.corrected_round}번째 수정에서 고쳐짐` : '고쳐지지 않음'} · <b>단순 재확인</b> {i.recheck_fixed ? '고쳐짐' : '고쳐지지 않음'}</p>
      <details><summary>AI 답변 원문</summary><p>{i.answer}</p></details>
    </article>)}</div>
  </>;
}

export default function AnswerChallenge() {
  usePageTitle(`AI 오답 체험 · ${SITE_NAME}`);
  const wrong = D.items.filter(i => !i.correct);
  return <div className="sg-shell sg-dark">
    <DarkBackdrop/>
    <StatGuardHeader current="challenge"/>
    <main className="sg-main sg-challenge">
      <section className="sg-section" aria-labelledby="chal-heading">
        <h1 id="chal-heading">AI가 말한 숫자, 맞을까 틀릴까?</h1>
        <p className="sg-hero-lead">실험에서 {D.model}가 실제로 쓴 답변 {D.items.length}개 중 {ROUND}개를 골랐습니다. 숫자만 보고 맞는지 맞혀 보세요. 답을 고르면 실제 값과 StatGuard의 판정이 공개됩니다.</p>
        <Challenge/>
      </section>
      <section className="sg-section" aria-labelledby="gallery-heading">
        <h2 id="gallery-heading">AI 오답 갤러리</h2>
        <p>일반 LLM이 실험에서 실제로 틀린 답 {wrong.length}개 전부입니다. StatGuard는 {wrong.filter(i => i.statguard === 'FLAG').length}개를 ‘계산 불일치’로 잡고 {wrong.filter(i => i.statguard === 'HOLD').length}개는 확정하지 않고 보류했으며, 틀린 답을 ‘계산 일치’로 통과시킨 경우는 {wrong.filter(i => i.statguard === 'PASS').length}개입니다. 재계산 근거를 돌려주자 {wrong.filter(i => i.corrected_round !== null).length}개가 고쳐졌습니다(단순 재확인 {wrong.filter(i => i.recheck_fixed).length}개).</p>
        <Gallery/>
      </section>
      <footer className="sg-footer">{SITE_NAME} {STATGUARD_VERSION} · 답변·정답·판정은 모두 실험 기록에서 그대로 가져왔습니다(experiments/statguard_correction_v0.1). ‘형식 오류’는 답을 끝내지 못해 최종값이 없는 경우입니다.</footer>
    </main>
  </div>;
}
