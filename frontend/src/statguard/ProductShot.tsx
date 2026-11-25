import recorded from './correctionCase.json';

/**
 * A tilted, Linear-style preview of the verification screen, drawn with the site's own components' styles
 * and filled with the recorded case (experiments/statguard_correction_v0.1, export_case.py). Decorative copy of real UI.
 */
type Case = { question: string; original: { answer: string }; corrected: { answer: string; claimed: string }; recompute: { claimed: string; value: string; unit: string; used_rows: number } };
const c = recorded as unknown as Case;
const line = (a: string) => a.split('\n').filter(l => l.trim() && !l.includes('최종값'))[0]?.trim() ?? a;
const v = String(Number(Number(c.recompute.value).toFixed(4)));

export default function ProductShot() {
  return <section className="sg-section sg-shot-section" aria-labelledby="shot-heading">
    <div className="sg-shot-copy">
      <p className="sg-shot-eyebrow">검증 화면</p>
      <h2 id="shot-heading">숫자 하나하나에 <span className="sg-grad">판정을 붙인다</span></h2>
      <p>CSV와 AI 답변을 넣으면 문장마다 판정이 표시된다. 틀린 숫자는 재계산 값과 함께 보여 준다.</p>
      <a className="sg-primary sg-link-button" href="/statguard">직접 검증해 보기</a>
    </div>
    <div className="sg-shot" aria-hidden="true">
      <div className="sg-shot-frame">
        <div className="sg-shot-bar"><span>검증 결과</span></div>
        <div className="sg-shot-body">
          <div className="sg-shot-summary"><span className="ok"><b>1</b>일치</span><span className="bad"><b>1</b>불일치</span><span className="warn"><b>0</b>불확실</span><span className="hold"><b>0</b>근거 부족</span></div>
          <p className="sg-shot-q">{c.question}</p>
          <p className="sg-shot-line bad">{line(c.original.answer)}</p>
          <div className="sg-shot-card"><span className="sg-rp-stamp sg-rp-bad">계산 불일치</span>
            <dl><div><dt>답변의 수치</dt><dd className="sg-num">{c.recompute.claimed}</dd></div><div><dt>CSV 재계산</dt><dd className="sg-num">{v}{c.recompute.unit}</dd></div><div><dt>사용한 행</dt><dd className="sg-num">{c.recompute.used_rows}개</dd></div></dl></div>
          <p className="sg-shot-line ok">{line(c.corrected.answer)}</p>
        </div>
      </div>
    </div>
  </section>;
}
