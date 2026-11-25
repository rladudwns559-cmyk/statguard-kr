import large from './benchmarkSummaryLarge.json';
import { pct1, TOTALS, WRONG_UPPER } from './benchmarkTotals';
import RecountScene from './RecountScene';
import CorrectionReplay from './CorrectionReplay';
import ProductShot from './ProductShot';
import DarkBackdrop from './DarkBackdrop';
import { RiseHeadline } from './HomeFx';
import { COMPARISON } from './comparisonData';
import { SITE_NAME, STATGUARD_VERSION, StatGuardHeader, usePageTitle } from './StatGuardChrome';
import './statguard.css';
import './statguard-theme.css';
import './statguard-home-layout.css';
import './statguard-pages.css';
import './statguard-clean.css';

type Acc = { correct: number; n: number; rate: number };
const largeAcc = (large as unknown as { conditions: Record<string, { accuracy: Record<string, Acc> }> }).conditions;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const PROBLEMS = [
  { head: '그럴듯하지만 틀린 숫자', body: '표가 커지면 일반 LLM의 정답률이 크게 떨어짐. 문장은 자연스러워 오류를 알아채기 어려움.' },
  { head: '보이지 않는 근거', body: '어떤 열·기간·계산으로 나온 숫자인지 드러나지 않음. 확인하려면 직접 다시 계산해야 함.' },
];
const SOLUTIONS = [
  { head: '다시 계산', body: '같은 CSV로 숫자를 다시 계산함. LLM을 쓰지 않아 결과가 항상 같음.' },
  { head: '모르면 보류', body: '열·기간·단위가 모호하면 판정하지 않고 이유와 함께 보류함.' },
  { head: '근거로 교정', body: '재계산 값과 계산식을 AI에게 돌려주면 AI가 스스로 고침.' },
];
const STAMPS = [
  { cls: 'ok', label: '계산 일치', body: '재계산 값과 답변의 숫자가 같음' },
  { cls: 'bad', label: '계산 불일치', body: '반올림 범위를 넘어 다름' },
  { cls: 'warn', label: '해석 불확실', body: '기준이 모호하거나 원인·추세 해석이라 보류' },
  { cls: 'hold', label: '근거 부족', body: '자료에 없는 기간·대상, 확인 안 된 단위라 보류' },
];

export default function StatGuardHome() {
  usePageTitle(`${SITE_NAME} · LLM 데이터 분석 수치 검증`);
  const a = largeAcc.A?.accuracy.all, c = largeAcc.C?.accuracy.all;
  return <div className="sg-shell sg-dark sg-home2">
    <DarkBackdrop/>
    <StatGuardHeader current="home"/>
    <main className="sg-main sg-home">
      <section className="sg-hero-grid" aria-labelledby="home-heading">
        <div className="sg-hero">
          <RiseHeadline id="home-heading" parts={[{ text: 'AI가 말한 숫자, ' }, { text: '다시 계산해서', grad: true }, { text: ' 확인합니다.' }]}/>
          <p className="sg-hero-lead">AI가 표(CSV)를 보고 쓴 답변의 숫자를 같은 자료로 다시 계산해, 맞는지 알려 줍니다.</p>
          <div className="sg-hero-actions"><a className="sg-primary sg-link-button" href="/statguard">바로 체험하기</a><a className="sg-secondary sg-link-button" href="/statguard/results">실험 결과 보기</a></div>
        </div>
        <RecountScene bare/>
      </section>

      <section className="sg-receipt" aria-label="핵심 실험 결과">
        {a && c && <div><strong className="sg-num">{pct(a.rate)} → {pct(c.rate)}</strong><span>큰 표 정답률<br/>일반 LLM → 계산 도구 사용</span></div>}
        <div><strong className="sg-num">{TOTALS.passed}건 중 {TOTALS.wrongPassed}건</strong><span>StatGuard가 통과시킨 오답<br/>95% 신뢰구간 상한 {pct1(WRONG_UPPER.all)}</span></div>
        <div><strong className="sg-num">{COMPARISON.verifiers.judge.passed_wrong} vs {COMPARISON.verifiers.prereg.passed_wrong}</strong><span>통과시킨 오답 수<br/>LLM 채점 vs StatGuard</span></div>
      </section>

      <section className="sg-band sg-problem" aria-labelledby="problem-heading">
        <header className="sg-h2-block"><h2 id="problem-heading">AI가 쓴 분석 답변, <span className="sg-accent">그대로 믿어도 될까?</span></h2></header>
        <div className="sg-strip-cards sg-two">{PROBLEMS.map(x => <article key={x.head} className="sg-strip-card"><h3>{x.head}</h3><p>{x.body}</p></article>)}</div>
      </section>

      <section className="sg-band sg-solution" aria-labelledby="solution-heading">
        <header className="sg-h2-block"><p className="sg-h2-eyebrow">해결 방법</p><h2 id="solution-heading">숫자를 <span className="sg-accent">다시 계산해</span> 확인한다</h2></header>
        <div className="sg-strip-cards sg-three">{SOLUTIONS.map((x, i) => <article key={x.head} className="sg-strip-card"><h3><span className="sg-step-no">{i + 1}</span>{x.head}</h3><p>{x.body}</p></article>)}</div>
      </section>

      <CorrectionReplay/>

      <section className="sg-section sg-verdicts" aria-labelledby="stamp-heading">
        <header className="sg-h2-block"><h2 id="stamp-heading">판정은 <span className="sg-accent">네 가지</span></h2></header>
        <div className="sg-stamps">{STAMPS.map(x => <div key={x.cls} className={'sg-stamp-' + x.cls}><strong>{x.label}</strong><p>{x.body}</p></div>)}</div>
      </section>

      <ProductShot/>

      <section className="sg-section sg-scope" aria-label="확인 범위와 자료 처리">
        <article className="sg-scope-col"><h3>확인할 수 있는 숫자</h3><ul><li>합계·평균·증감률·비율·특정 값</li><li>“7~12월”, “상반기” 같은 기간 범위</li><li>표준편차·분산·중앙값·최댓값·최솟값</li><li>상관계수, t-검정 p값</li><li className="muted">회귀·추세·원인 해석은 보류함</li></ul></article>
        <article className="sg-scope-col"><h3>자료를 다루는 방식</h3><ul><li>CSV와 답변은 계산에만 쓰고 저장하지 않음</li><li>검증에 GPT를 쓰지 않음</li><li>단위는 사용자가 직접 확인함</li><li>‘AI에게 직접 질문’ 시연 때만 OpenAI로 전송</li></ul></article>
      </section>

      <section className="sg-section sg-closing" aria-labelledby="limit-heading">
        <h2 id="limit-heading">직접 확인해 보세요</h2>
        <p>‘계산 일치’는 숫자 하나가 계산과 맞는다는 뜻이다. 답변 전체의 사실이나 인과관계까지 보증하지는 않는다.</p>
        <div className="sg-hero-actions"><a className="sg-primary sg-link-button" href="/statguard">CSV로 검증하기</a><a className="sg-secondary sg-link-button" href="/statguard/challenge">AI 오답 맞혀 보기</a></div>
      </section>

      <footer className="sg-footer">{SITE_NAME} {STATGUARD_VERSION} · 2026 하반기 SW·AI 융합연구개발 일반과제</footer>
    </main>
  </div>;
}
