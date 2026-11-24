import large from './benchmarkSummaryLarge.json';
import { pct1, TOTALS, WRONG_UPPER } from './benchmarkTotals';
import correction from './benchmarkCorrection.json';
const flagFix = (correction as unknown as { groups: Record<string, { targeted_FLAG: { n: number; S1: number; R1: number } }> }).groups['전체'].targeted_FLAG;
import RecountScene from './RecountScene';
import CorrectionReplay from './CorrectionReplay';
import ProductShot from './ProductShot';
import DarkBackdrop from './DarkBackdrop';
import { RiseHeadline, WrongTicker } from './HomeFx';
import { SITE_NAME, STATGUARD_VERSION, StatGuardHeader, usePageTitle } from './StatGuardChrome';
import './statguard.css';
import './statguard-theme.css';

type Acc = { correct: number; n: number; rate: number };
const largeAcc = (large as unknown as { conditions: Record<string, { accuracy: Record<string, Acc> }> }).conditions;
const largePert = (large as unknown as { perturbation: Record<string, { precision: number | null; recall: number | null }> }).perturbation;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const latestRule = Object.keys(largePert).filter(k => k.startsWith('rule_')).sort().pop() ?? '';

const STEPS = [
  { title: '주장 찾기', en: 'Claim Extractor', body: '답변 문장에서 숫자·단위와 그 숫자가 가리키는 열·기간·계산을 찾습니다.' },
  { title: '다시 계산', en: 'Statistical Executor', body: '같은 CSV로 34자리 정밀도의 결정적 계산을 합니다. 계산식과 쓴 행을 남깁니다.' },
  { title: '비교', en: 'Claim Verifier', body: '답변에 적힌 자릿수로 반올림했을 때 같은지 봅니다. 단위가 다르면 비교하지 않습니다.' },
  { title: '판정 또는 보류', en: 'Abstention', body: '열·기간·기준이 모호하거나 해석이 필요한 문장은 판정하지 않고 보류합니다.' },
];
const STAMPS = [
  { cls: 'ok', label: '계산 일치', body: '연결된 계산이 답변의 숫자와 맞습니다.' },
  { cls: 'bad', label: '계산 불일치', body: '반올림 범위를 넘어 다릅니다. 오류로 표시합니다.' },
  { cls: 'warn', label: '해석 불확실', body: '열·기준 시점·범위가 모호하거나 원인·추세 같은 해석입니다. 보류합니다.' },
  { cls: 'hold', label: '근거 부족', body: '자료에 없는 기간·대상, 확인하지 않은 단위, 지원하지 않는 통계입니다. 보류합니다.' },
];

export default function StatGuardHome() {
  usePageTitle(`${SITE_NAME} · LLM 데이터 분석 수치 검증`);
  const a = largeAcc.A?.accuracy.all, c = largeAcc.C?.accuracy.all, p = largePert[latestRule];
  return <div className="sg-shell sg-dark">
    <DarkBackdrop/>
    <StatGuardHeader current="home"/>
    <main className="sg-main sg-home">
      <section className="sg-hero-grid" aria-labelledby="home-heading">
        <div className="sg-hero">
          <RiseHeadline id="home-heading" parts={[{ text: 'AI가 말한 숫자, ' }, { text: '다시 계산해서', grad: true }, { text: ' 확인합니다.' }]}/>
          <p className="sg-hero-lead"><strong>LLM이 표(CSV)를 보고 쓴 답변에서 수치 주장을 찾아 같은 자료로 다시 계산합니다.</strong> 맞으면 일치, 틀리면 불일치로 표시하고, 근거가 부족하거나 해석이 필요한 문장은 억지로 판정하지 않고 보류합니다.</p>
          <div className="sg-hero-actions"><a className="sg-primary sg-link-button" href="/statguard">바로 체험하기</a><a className="sg-secondary sg-link-button" href="/statguard/challenge">AI 오답 맞혀 보기</a><a className="sg-secondary sg-link-button" href="/statguard/results">실험 결과 보기</a></div>
        </div>
        <RecountScene/>
      </section>

      <WrongTicker/>

      <section className="sg-receipt" aria-label="핵심 실험 결과">
        {a && c && <div><strong className="sg-num">{pct(a.rate)} → {pct(c.rate)}</strong><span>365·1,460행 표에서 일반 LLM의 정답률 → 계산 도구를 쓴 LLM의 정답률</span></div>}
        <div><strong className="sg-num">{TOTALS.passed}건 중 {TOTALS.wrongPassed}건</strong><span>StatGuard가 통과시킨 LLM 답변 중 오답 (실험 3개, A·C 조건, 각 3회). 95% 신뢰구간 상한 {pct1(WRONG_UPPER.all)}</span></div>
        {p && <div><strong className="sg-num">{p.precision?.toFixed(2)} / {p.recall?.toFixed(2)}</strong><span>일부러 틀린 숫자를 넣은 문장에서 오류 탐지 정밀도 / 재현율 (판정한 문장 기준)</span></div>}
      </section>

      <CorrectionReplay/>

      <ProductShot/>

      <section className="sg-section" aria-labelledby="how-heading">
        <h2 id="how-heading">답변 하나를 이렇게 확인합니다</h2>
        <p>네 단계는 순서대로 실행됩니다. 어느 단계에서든 확정할 수 없으면 그 자리에서 보류합니다. 판정 뒤에는 불일치한 수치의 재계산 값과 계산식을 AI에게 돌려보내 답변을 고치게 할 수 있습니다. 실험에서 불일치로 잡힌 오답 {flagFix.n}건 중 {flagFix.S1}건이 한 번에 고쳐졌고, 근거 없이 다시 확인만 시킨 경우는 {flagFix.R1}건이었습니다.</p>
        <ol className="sg-rail">{STEPS.map((s, i) => <li key={s.title}><span className="num" aria-hidden="true">{i + 1}</span><h3>{s.title}</h3><small>{s.en}</small><p>{s.body}</p></li>)}</ol>
      </section>

      <section className="sg-section" aria-labelledby="stamp-heading">
        <h2 id="stamp-heading">판정은 네 가지입니다</h2>
        <p>숫자 하나하나에 도장을 찍듯 판정합니다. 보류도 결과입니다.</p>
        <div className="sg-stamps">{STAMPS.map(s => <div key={s.cls} className={'sg-stamp-' + s.cls}><strong>{s.label}</strong><p>{s.body}</p></div>)}</div>
      </section>

      <section className="sg-section sg-columns" aria-label="확인 범위와 자료 처리">
        <div><h2>확인할 수 있는 주장</h2><ul><li>합계·평균·증감률·비율·특정 행의 값</li><li>표준편차·분산(표본과 모집단 정의 모두 확인)·중앙값</li><li>최댓값·최솟값, “가장 많은 달”처럼 지목한 행</li><li>피어슨 상관계수, Welch t-검정의 p값과 유의성(유의수준 0.05)</li></ul>
          <p className="sg-hint">보류하는 것: 회귀·추세, 원인·영향 해석, 일부 기간 범위(예: 2016~2020년), 조건부 개수, 앞 문장의 대상을 이어받는 문장, 자료에 없는 기간·대상.</p></div>
        <div><h2>자료를 다루는 방식</h2><ul><li>CSV와 답변은 계산에만 쓰고 파일·DB·브라우저 저장소에 보관하지 않습니다.</li><li>검증과 계산에는 GPT를 쓰지 않습니다. 규칙 기반 추출과 결정적 계산만 씁니다.</li><li>단위는 추정하지 않고 사용자가 직접 확인해 입력합니다.</li><li>‘AI에게 직접 질문’은 시연 비밀번호를 아는 사용자만 쓸 수 있으며, 그때만 질문과 CSV가 OpenAI로 전송됩니다.</li></ul></div>
      </section>

      <section className="sg-section" aria-labelledby="limit-heading">
        <h2 id="limit-heading">‘계산 일치’가 보증하지 않는 것</h2>
        <p className="sg-note">‘계산 일치’는 답변의 숫자 하나가 연결된 계산과 맞는다는 뜻입니다. 답변 전체의 사실, 인과관계, 자료 자체의 정확성은 보증하지 않습니다. 실험은 질문 {TOTALS.questions}개·자료 {TOTALS.datasets}종·모델 1종({TOTALS.model})의 소규모이며, 조건과 한계는 <a href="/statguard/results">실험 결과</a>에 모두 공개합니다.</p>
      </section>

      <footer className="sg-footer">{SITE_NAME} {STATGUARD_VERSION} · 2026 하반기 SW·AI 융합연구개발 일반과제</footer>
    </main>
  </div>;
}
