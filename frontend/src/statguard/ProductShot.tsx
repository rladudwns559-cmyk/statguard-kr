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
      <h2 id="shot-heading">숫자 하나하나에 <span className="sg-grad">도장을 찍습니다.</span></h2>
      <p><strong>문장마다 판정 색이 칠해지고,</strong> 누르면 재계산 값·계산식·사용한 행이 바로 열립니다. 확정할 수 없는 문장은 억지로 판정하지 않고 보류합니다.</p>
      <a className="sg-primary sg-link-button" href="/statguard">직접 검증해 보기</a>
    </div>
    <div className="sg-shot" aria-hidden="true">
      <div className="sg-shot-frame" data-tilt>
        <div className="sg-shot-bar"><i/><i/><i/><span>when2warn-public-beta.vercel.app/statguard</span></div>
        <div className="sg-shot-body">
          <div className="sg-shot-summary"><b className="ok">1</b><b className="bad">1</b><b className="warn">0</b><b className="hold">0</b></div>
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
