import { SITE_NAME, STATGUARD_VERSION, StatGuardHeader, usePageTitle, useRevealOnScroll } from './StatGuardChrome';
import { pct1, REAL_A, TOTALS, WRONG_UPPER } from './benchmarkTotals';
import summary from './benchmarkSummary.json';
import summaryLarge from './benchmarkSummaryLarge.json';
import summaryDomain from './benchmarkSummaryDomain.json';
import stability from './benchmarkStability.json';
import correction from './benchmarkCorrection.json';
import { CorrectionBars, CoverageRiskSection, DatasetSection, RelatedWorkSection } from './ResultsExtras';
import './statguard.css';
import './statguard-theme.css';

type Metric = { n: number; decided: number; coverage: number | null; precision: number | null; recall: number | null; f1: number | null;
  raw_error_rate: number | null; passed: number; error_rate_among_passed: number | null; errors_total: number; tp: number; fp: number; fn: number;
  missed_errors_on_hold: number; unanswerable_asserted?: number; unanswerable_asserted_passed?: number; decisions: Record<string, number> };
type Acc = { correct: number; n: number; rate: number };
type Summary = { conditions: Record<string, { accuracy: Record<string, Acc>; error_kinds: Record<string, number> }>;
  statguard: Record<string, Metric>; perturbation?: Record<string, Metric & { by_kind: Record<string, Record<string, number>> }>;
  usage: { calls: number; input_tokens: number; output_tokens: number; estimated_usd: number; price_basis: string; model: string };
  meta: { questions: number; answerable: number; unanswerable: number; datasets: number; generated: string };
  wrong_answers: { id: string; condition: string; question: string; final: string; kind: string; decisions: Record<string, string> }[];
  holdout: { meta: { questions: number }; accuracy: Acc; statguard: Record<string, Metric> } };
const data = summary as unknown as Summary;
type Large = Omit<Summary, 'holdout' | 'wrong_answers'> & { wrong_answers: { id: string; condition: string; question: string; final: string; expected: string; kind: string; decisions: Record<string, string> }[]; holdout?: Summary['holdout'] };
const large = summaryLarge as unknown as Large;
const domain = summaryDomain as unknown as Large;
type Stability = Record<string, { benchmark: string; condition: string; runs: number; per_run: { accuracy: number; coverage: number; passed: number; wrong_among_passed: number }[];
  questions_same_correctness_all_runs: number; questions_wrong_in_some_run: number; total_passed: number; total_wrong_among_passed: number }>;
const stable = stability as unknown as Stability;
const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
const num = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toFixed(2);
const CONDITION: Record<string, string> = { A: 'A 일반 LLM (CSV만 제공)', B: 'B LLM + 자료 설명', C: 'C LLM + 계산 도구' };
const EXTRACTOR: Record<string, string> = { 'rule_v0.1': '규칙 추출 v0.1 (사전 고정)', 'rule_v0.2': '규칙 추출 v0.2 (기간 범위 수정)', 'rule_v0.3': '규칙 추출 v0.3 (오탐 분석 후 수정)', 'rule_v0.4': '규칙 추출 v0.4 (통계 연산 추가)', 'rule_v0.5': '규칙 추출 v0.5 (큰 표 답변 분석 후 수정)', 'rule_v0.6': '규칙 추출 v0.6', 'rule_v0.7': '규칙 추출 v0.7 (웹 적용 버전)', llm: 'LLM 추출 (gpt-6-luna)' };
const DECISION: Record<string, string> = { FLAG: '오류 표시', PASS: '통과', HOLD: '보류' };
function AccuracyTable({ conditions, label }: { conditions: Summary['conditions']; label: string }) {
  return <div className="sg-table-scroll" tabIndex={0} role="region" aria-label={label}><table><thead><tr><th scope="col">조건</th><th scope="col">전체</th><th scope="col">답변 가능</th><th scope="col">답변 불가(판단불가가 정답)</th><th scope="col">오답 유형</th></tr></thead>
    <tbody>{Object.entries(conditions).map(([c, v]) => <tr key={c}><th scope="row">{CONDITION[c] ?? c}</th>
      {['all', 'answerable', 'unanswerable'].map(k => <td key={k}>{v.accuracy[k] ? `${v.accuracy[k].correct}/${v.accuracy[k].n} (${pct(v.accuracy[k].rate)})` : '—'}</td>)}
      <td>{Object.entries(v.error_kinds).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}</td></tr>)}</tbody></table></div>;
}
function PerturbationTable({ rows, label }: { rows: NonNullable<Summary['perturbation']>; label: string }) {
  return <div className="sg-table-scroll" tabIndex={0} role="region" aria-label={label}><table><thead><tr><th scope="col">추출 방식</th><th scope="col">판정 비율</th><th scope="col">정밀도</th><th scope="col">재현율</th><th scope="col">F1</th><th scope="col">유형별 판정 (오류 표시/통과/보류)</th></tr></thead>
    <tbody>{Object.entries(rows).map(([k, v]) => <tr key={k}><th scope="row">{EXTRACTOR[k] ?? k}</th><td>{pct(v.coverage)} ({v.decided}/{v.n})</td><td>{num(v.precision)}</td><td>{num(v.recall)}</td><td>{num(v.f1)}</td>
      <td>{Object.entries(v.by_kind).map(([kind, d]) => `${KIND[kind] ?? kind}: ${d.FLAG ?? 0}/${d.PASS ?? 0}/${d.HOLD ?? 0}`).join(' · ')}</td></tr>)}</tbody></table></div>;
}
function LargeSection({ large, eyebrow, title, intro }: { large: Large; eyebrow: string; title: string; intro: string }) {
  const m = large.meta;
  return <section className="sg-card sg-large" aria-label={title}><p className="sg-eyebrow">{eyebrow}</p><h2>{title}</h2>
    <p className="sg-hint">{intro} 질문 {m.questions}개(답변 가능 {m.answerable} · 불가 {m.unanswerable}).</p>
    <h3 className="sg-results-sub">조건별 정답률</h3><AccuracyTable conditions={large.conditions} label={title + " 조건별 정답률 표"}/>
    <h3 className="sg-results-sub">실제 답변에 대한 StatGuard 판정</h3><DetectionTable rows={large.statguard} label={title + " 오류 탐지 표"}/>
    {large.holdout && <><h3 className="sg-results-sub">별도 검증 세트 ({large.holdout.meta.questions}문항, 규칙 v0.5 고정 후 새로 작성 · A 정답 {large.holdout.accuracy.correct}/{large.holdout.accuracy.n})</h3>
      <DetectionTable rows={large.holdout.statguard} label={title + " 별도 검증 세트 표"}/></>}
    <p className="sg-hint">StatGuard가 ‘통과’시킨 답변 중 오답은 모든 조건·추출 방식에서 0건이었습니다. ‘사후’ 표시 버전은 이 답변을 본 뒤 고친 것이라, 실행 전 고정 버전과 나란히 보고합니다.</p>
    <h3 className="sg-results-sub">LLM 오답과 StatGuard 판정</h3>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label={title + " 오답 목록 표"}><table><thead><tr><th scope="col">문항</th><th scope="col">조건</th><th scope="col">답변</th><th scope="col">정답</th><th scope="col">유형</th><th scope="col">StatGuard</th></tr></thead>
      <tbody>{large.wrong_answers.map(w => <tr key={w.id + w.condition}><th scope="row">{w.id} · {w.question}</th><td>{w.condition}</td><td>{w.final}</td><td>{w.expected}</td><td>{w.kind}</td><td>{Object.entries(w.decisions).map(([k, d]) => `${EXTRACTOR[k]?.split(' (')[0] ?? k}: ${DECISION[d] ?? d}`).join(' · ')}</td></tr>)}</tbody></table></div>
    {large.perturbation && <><h3 className="sg-results-sub">오류 주입 세트</h3><PerturbationTable rows={large.perturbation} label={title + " 오류 주입 표"}/></>}
  </section>;
}
/** Oblique 3D columns: per experiment, plain LLM vs LLM with the calculation tool vs answers StatGuard passed. */
function OverviewChart() {
  const groups = [
    { key: 'v0.1 작은 표', label: '작은 표 (2~12행)', s: data },
    { key: 'v0.2 큰 표', label: '큰 표 (365·1,460행)', s: large },
    { key: 'v0.3 국가별', label: '국가별 (176행)', s: domain },
  ];
  const passRate = (bench: string) => {
    const rows = Object.values(stable).filter(r => r.benchmark === bench);
    const passed = rows.reduce((a, r) => a + r.total_passed, 0), wrong = rows.reduce((a, r) => a + r.total_wrong_among_passed, 0);
    return passed ? (passed - wrong) / passed : null;
  };
  const reveal = useRevealOnScroll<HTMLDivElement>();
  return <section className="sg-card" aria-labelledby="overview-heading"><h2 id="overview-heading">한눈에 보기: 정답률</h2>
    <p className="sg-hint">일반 LLM과 계산 도구를 쓴 LLM은 1회차 전체 질문 기준, StatGuard는 반복 3회에서 ‘통과’시킨 답변 기준입니다.</p>
    <div ref={reveal.ref} className={'sg-chart' + reveal.className} style={{ ['--groups' as string]: groups.length }} role="img" aria-label={groups.map(g => `${g.label}: 일반 LLM ${pct(g.s.conditions.A.accuracy.all.rate)}, 계산 도구 ${pct(g.s.conditions.C.accuracy.all.rate)}, StatGuard 통과 답변 ${pct(passRate(g.key))}`).join('. ')}>
      {groups.map((g, gi) => { const a = g.s.conditions.A.accuracy.all.rate, c = g.s.conditions.C.accuracy.all.rate, sg = passRate(g.key) ?? 0;
        return <div className="sg-chart-group" data-tilt key={g.key}><div className="sg-chart-bars">
          <div className="sg-col sg-col-a" style={{ ['--k' as string]: gi * 3 + 0, ['--v' as string]: a * 100 }}><b>{pct(a)}</b></div>
          <div className="sg-col sg-col-c" style={{ ['--k' as string]: gi * 3 + 1, ['--v' as string]: c * 100 }}><b>{pct(c)}</b></div>
          <div className="sg-col sg-col-s" style={{ ['--k' as string]: gi * 3 + 2, ['--v' as string]: sg * 100 }}><b>{pct(sg)}</b></div>
        </div><h3>{g.label}</h3></div>; })}
    </div>
    <div className="sg-chart-legend" aria-hidden="true"><span><i style={{ background: '#7D90A1' }}/>일반 LLM (A)</span><span><i style={{ background: '#0F7C86' }}/>LLM + 계산 도구 (C)</span><span><i style={{ background: '#1C9467' }}/>StatGuard가 통과시킨 답변</span></div>
  </section>;
}
function StabilitySection() {
  const rows = Object.values(stable);
  const passed = rows.reduce((a, r) => a + r.total_passed, 0), wrong = rows.reduce((a, r) => a + r.total_wrong_among_passed, 0);
  return <section className="sg-card sg-large" aria-label="반복 실행 안정성"><p className="sg-eyebrow">반복 실행</p><h2>같은 질문을 세 번 물으면?</h2>
    <p className="sg-hint">A·C 조건을 같은 요청으로 3회 실행했습니다. StatGuard는 고정 사본(규칙 v0.6)으로 판정했습니다. <strong>통과시킨 답변 {passed}건 중 오답 {wrong}건.</strong></p>
    <p className="sg-hint" aria-label="오답률 신뢰구간">오답 0건이 ‘오답률 0%’를 뜻하지는 않습니다. 정확(Clopper–Pearson) 95% 신뢰구간으로 보면 통과 답변의 오답률은 <strong>최대 {pct1(WRONG_UPPER.all)}</strong>까지 가능합니다. 다만 같은 질문을 3번 반복한 답변은 서로 독립이 아니므로, 반복을 빼고 1회차 통과 답변 {TOTALS.firstRunPassed}건({TOTALS.firstRunWrong}건 오답)만 쓰면 상한은 <strong>{pct1(WRONG_UPPER.firstRun)}</strong>로 더 넓어집니다. 실제 오답률은 0%에서 이 상한 사이 어딘가로 보는 것이 정직한 해석입니다.</p>
    <p className="sg-hint" aria-label="일반 LLM 실제 오답 처리">통과 답변 {passed}건 중 {REAL_A.passedA}건은 오답이 많은 일반 LLM(A) 답변이며, 이 답변들도 오답은 0건이었습니다. 다만 1회차 본 세트에서 일반 LLM의 실제 오답 {REAL_A.errors}건을 보면, 실행 전 고정한 규칙은 {REAL_A.flagged}건만 ‘계산 불일치’로 잡고 {REAL_A.held}건은 보류했으며 통과시킨 오답은 {REAL_A.passedWrong}건이었습니다. 즉 오답을 막는 주된 방식은 틀렸다고 잡아내기보다 확정하지 않고 보류하는 것이었습니다(보류에는 답을 끝내지 못한 형식 오류도 포함).</p>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="반복 실행 표"><table><thead><tr><th scope="col">벤치마크 · 조건</th><th scope="col">회차별 정답률</th><th scope="col">정답 여부가 3회 모두 같은 문항</th><th scope="col">한 번이라도 틀린 문항</th><th scope="col">통과 답변 중 오답</th><th scope="col">회차별 판정 비율</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.benchmark + r.condition}><th scope="row">{r.benchmark} · {r.condition}</th><td>{r.per_run.map(p => pct(p.accuracy)).join(' / ')}</td><td>{pct(r.questions_same_correctness_all_runs)}</td><td>{r.questions_wrong_in_some_run}</td><td>{r.total_wrong_among_passed}/{r.total_passed}</td><td>{r.per_run.map(p => pct(p.coverage)).join(' / ')}</td></tr>)}</tbody></table></div>
    <p className="sg-hint">일반 LLM(A)은 같은 질문에도 회차마다 정답이 바뀌었습니다(큰 표에서 문항의 약 20%). 계산 도구(C)는 거의 일정했습니다.</p>
  </section>;
}
type CorrStep = { correct: number; fixed: number; broken: number; passed_wrong: number };
type CorrGroup = { n: number; A: number; targeted: number; R1: CorrStep; S1: CorrStep; R2: CorrStep; S2: CorrStep;
  targeted_FLAG: { n: number; A: number; R1: number; S1: number }; targeted_HOLD: { n: number; A: number; R1: number; S1: number } };
const corr = correction as unknown as { groups: Record<string, CorrGroup>; usage: { calls: number; estimated_usd: number } };
function CorrectionSection() {
  const all = corr.groups['전체'], flag = all.targeted_FLAG, hold = all.targeted_HOLD;
  const rate = (a: number, n: number) => `${a}/${n} (${(a / n * 100).toFixed(1)}%)`;
  const rows = ['전체', '본 세트', '별도 검증 세트', 'v0.1', 'v0.2', 'v0.3'];
  const label: Record<string, string> = { 'v0.1': '작은 표 (v0.1)', 'v0.2': '큰 표 (v0.2)', 'v0.3': '국가별 (v0.3)' };
  return <section className="sg-card sg-large" aria-labelledby="correction-heading"><p className="sg-eyebrow">검증 → 교정</p><h2 id="correction-heading">근거를 돌려주면 AI가 고칠까?</h2>
    <p className="sg-hint">일반 LLM(A)의 기존 답변 {all.n}개에서 출발해, StatGuard가 ‘통과’시키지 않은 {all.targeted}개 답변에 대해 두 가지를 비교했습니다. <strong>R 단순 재확인</strong>은 “CSV로 다시 확인해 다시 쓰라”고만 하고, <strong>S StatGuard 근거</strong>는 불일치한 수치의 재계산 값·계산식과 보류 사유를 보냅니다. 정답은 채점에만 쓰고 모델에게 보내지 않았으며, 조건은 실행 전에 PROTOCOL로 고정했습니다(모델 {TOTALS.model}, 최대 2회, 호출 {corr.usage.calls}회).</p>
    <dl className="sg-data-meta sg-results-meta" aria-label="자동 교정 핵심 결과">
      <div><dt>불일치로 잡힌 오답 고침 (1회)</dt><dd>S {flag.S1}/{flag.n}건 · R {flag.R1}/{flag.n}건</dd></div>
      <div><dt>전체 정답률 A → S 1회 → S 2회</dt><dd>{(all.A / all.n * 100).toFixed(1)}% → {(all.S1.correct / all.n * 100).toFixed(1)}% → {(all.S2.correct / all.n * 100).toFixed(1)}%</dd></div>
      <div><dt>같은 문항 R 단순 재확인 1회</dt><dd>{(all.R1.correct / all.n * 100).toFixed(1)}%</dd></div>
      <div><dt>맞던 답이 틀려짐 (S 1회 / 2회)</dt><dd>{all.S1.broken}건 / {all.S2.broken}건</dd></div>
    </dl>
    <CorrectionBars/>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="자동 교정 정답률 표"><table><thead><tr><th scope="col">묶음</th><th scope="col">A 원래</th><th scope="col">R 단순 재확인 1회</th><th scope="col">S StatGuard 근거 1회</th><th scope="col">S 2회</th><th scope="col">교정 대상</th></tr></thead>
      <tbody>{rows.map(k => { const g = corr.groups[k]; return <tr key={k}><th scope="row">{label[k] ?? k}</th><td>{rate(g.A, g.n)}</td><td>{rate(g.R1.correct, g.n)}</td><td>{rate(g.S1.correct, g.n)}</td><td>{rate(g.S2.correct, g.n)}</td><td>{g.targeted}</td></tr>; })}</tbody></table></div>
    <p className="sg-hint">효과는 ‘계산 불일치’로 잡힌 답변에서 뚜렷했습니다(S {flag.S1}/{flag.n}건 고침, R {flag.R1}건). 반면 보류된 답변 {hold.n}건에서는 근거 피드백(정답 {hold.S1}건)이 단순 재확인(정답 {hold.R1}건)보다 낫지 않았고, 별도 검증 세트에서는 변화가 없었습니다. 교정 후에도 통과 답변 중 오답은 0건이었지만, 계산 도구를 처음부터 쓴 조건(C)의 정답률에는 미치지 못합니다. 소규모·1회 실행이므로 경향으로만 해석합니다.</p>
  </section>;
}
function DetectionTable({ rows, label }: { rows: Record<string, Metric>; label: string }) {
  return <div className="sg-table-scroll" tabIndex={0} role="region" aria-label={label}><table><thead><tr><th scope="col">답변 / 추출 방식</th><th scope="col">판정 비율</th><th scope="col">오류 표시/통과/보류</th><th scope="col">정밀도</th><th scope="col">재현율</th><th scope="col">원래 오답률 → 통과 답변 오답률</th><th scope="col">근거 없는 단정 통과</th></tr></thead>
    <tbody>{Object.entries(rows).map(([k, v]) => { const [c, e] = k.split('/'); return <tr key={k}><th scope="row">{c} · {EXTRACTOR[e] ?? e}</th><td>{pct(v.coverage)} ({v.decided}/{v.n})</td><td>{v.decisions.FLAG ?? 0}/{v.decisions.PASS ?? 0}/{v.decisions.HOLD ?? 0}</td><td>{num(v.precision)}</td><td>{num(v.recall)}</td><td>{pct(v.raw_error_rate)} → {pct(v.error_rate_among_passed)}</td><td>{v.unanswerable_asserted_passed ?? 0}/{v.unanswerable_asserted ?? 0}</td></tr>; })}</tbody></table></div>;
}
const KIND: Record<string, string> = { correct: '정답 문장', scaled_10pct: '수치 10% 왜곡', swapped_base: '증감률 기준 뒤바뀜' };

export default function BenchmarkResults() {
  const m = data.meta;
  usePageTitle(`실험 결과 · ${SITE_NAME}`);
  return <div className="sg-shell">
    <StatGuardHeader current="results"/>
    <main className="sg-main sg-results">
      <div className="sg-intro"><div><h1>LLM의 숫자, 다시 계산하면 맞을까?</h1>
        <p>공개 표 자료 {TOTALS.datasets}종(작은 표·큰 표·국가별)에 대한 질문 {TOTALS.questions}개로 일반 LLM(A), 자료 설명을 더한 LLM(B), 계산 도구를 쓴 LLM(C)과 StatGuard를 비교했습니다. 기대값은 계산 엔진과 별도로 계산해 실행 전에 고정했고, 조건은 각 실험의 PROTOCOL.md에 실행 전에 기록했습니다.</p></div></div>
      <dl className="sg-data-meta sg-results-meta" aria-label="전체 실험 규모"><div><dt>모델</dt><dd>{TOTALS.model}</dd></div><div><dt>질문</dt><dd>{TOTALS.questions}개 · 자료 {TOTALS.datasets}종</dd></div><div><dt>API 호출(반복 포함)</dt><dd>{TOTALS.calls.toLocaleString('ko-KR')}회</dd></div><div><dt>추정 비용</dt><dd>${TOTALS.usd.toFixed(2)}</dd></div><div><dt>통과 답변 중 오답</dt><dd>{TOTALS.wrongPassed}/{TOTALS.passed}건</dd></div><div><dt>오답률 95% 상한</dt><dd>{pct1(WRONG_UPPER.all)}</dd></div></dl>
      <OverviewChart/>
      <StabilitySection/>
      <CorrectionSection/>
      <CoverageRiskSection/>
      <RelatedWorkSection/>
      <DatasetSection questions={TOTALS.questions} wrong={(correction as unknown as { groups: Record<string, { n: number; A: number }> }).groups['전체'].n - (correction as unknown as { groups: Record<string, { n: number; A: number }> }).groups['전체'].A}/>
      <LargeSection large={large} eyebrow="실험 v0.2 · 큰 표와 통계" title="행이 많아지면 LLM은 틀리기 시작한다" intro="NOAA 일별 기상 365행·1,460행. 합계·평균에 더해 표준편차·중앙값·최댓값·상관계수·Welch t-검정을 물었습니다. 규칙 추출 v0.4는 실행 전에 고정했습니다."/>
      <LargeSection large={domain} eyebrow="실험 v0.3 · 다른 분야" title="다른 분야에서도 그럴까? — 176개국 인구·경제·보건" intro="World Bank WDI 2023, 176개국의 총인구·실업률·1인당GDP·기대수명. 규칙 추출 v0.6은 실행 전에 고정했습니다."/>
      <h2 className="sg-results-divider">실험 v0.1 · 작은 표 (2~12행)</h2>
      <p className="sg-hint">NOAA·World Bank 공개 자료 4종과 합성 1종(2~12행), 본 세트 {m.questions}개 + 별도 검증 세트 {data.holdout.meta.questions}개.</p>
      <dl className="sg-data-meta sg-results-meta"><div><dt>모델</dt><dd>{data.usage.model}</dd></div><div><dt>이 실험 API 호출(반복 포함)</dt><dd>{data.usage.calls}회</dd></div><div><dt>토큰(입력/출력)</dt><dd>{data.usage.input_tokens.toLocaleString('ko-KR')} / {data.usage.output_tokens.toLocaleString('ko-KR')}</dd></div><div><dt>추정 비용</dt><dd>${data.usage.estimated_usd.toFixed(4)}</dd></div></dl>

      <section className="sg-card"><p className="sg-eyebrow">연구 질문 1</p><h2>조건별 정답률</h2>
        <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="조건별 정답률 표"><table><thead><tr><th scope="col">조건</th><th scope="col">전체</th><th scope="col">답변 가능</th><th scope="col">답변 불가(판단불가가 정답)</th><th scope="col">오답 유형</th></tr></thead>
          <tbody>{Object.entries(data.conditions).map(([c, v]) => <tr key={c}><th scope="row">{CONDITION[c] ?? c}</th>
            {['all', 'answerable', 'unanswerable'].map(k => <td key={k}>{v.accuracy[k] ? `${v.accuracy[k].correct}/${v.accuracy[k].n} (${pct(v.accuracy[k].rate)})` : '—'}</td>)}
            <td>{Object.entries(v.error_kinds).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}</td></tr>)}</tbody></table></div>
        <p className="sg-hint">정답 기준: ‘최종값’이 기대값과 답변 자릿수 기준 반올림 범위 안. 답변 불가 질문은 ‘판단불가’라고 답해야 정답.</p></section>

      <section className="sg-card"><p className="sg-eyebrow">연구 질문 2·3</p><h2>StatGuard가 LLM 답변의 오류를 찾았는가</h2>
        <DetectionTable rows={data.statguard} label="본 세트 오류 탐지 표"/>
        <h3 className="sg-results-sub">별도 검증 세트 ({data.holdout.meta.questions}문항, 추출기 수정 후 새로 작성 · A 정답 {data.holdout.accuracy.correct}/{data.holdout.accuracy.n})</h3>
        <DetectionTable rows={data.holdout.statguard} label="별도 검증 세트 오류 탐지 표"/>
        <p className="sg-hint">답변 단위 판정: 주장 중 하나라도 ‘계산 불일치’면 오류 표시, 불일치 없이 ‘계산 일치’가 있으면 통과, 그 외는 보류. 정밀도·재현율은 오류 표시·통과로 결정한 답변만으로 계산합니다(보류 제외).</p></section>

      <section className="sg-card"><h2>LLM이 틀린 답변과 StatGuard 판정</h2>
        <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="오답 목록 표"><table><thead><tr><th scope="col">문항</th><th scope="col">조건</th><th scope="col">답변 최종값</th><th scope="col">오답 유형</th><th scope="col">StatGuard</th></tr></thead>
          <tbody>{data.wrong_answers.map(w => <tr key={w.id + w.condition}><th scope="row">{w.id} · {w.question}</th><td>{w.condition}</td><td>{w.final}</td><td>{w.kind}</td><td>{Object.entries(w.decisions).map(([k, d]) => `${EXTRACTOR[k]?.split(' (')[0] ?? k}: ${DECISION[d] ?? d}`).join(' · ')}</td></tr>)}</tbody></table></div>
        <p className="sg-hint">K02(A)는 수치는 맞지만 ‘% %’로 적어 사전 기준에 따라 단위 오류로 처리했습니다. C06은 해석 질문에 회귀분석 p값으로 단정한 사례입니다.</p></section>

      {data.perturbation && <section className="sg-card"><h2>알고 있는 오류를 넣었을 때</h2>
        <p className="sg-hint">답변 가능·지원 질문마다 정답 문장과 오류 문장(수치 10% 왜곡, 증감률 기준 시점 뒤바꿈)을 만들어 문장 단위로 판정했습니다.</p>
        <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="오류 주입 표"><table><thead><tr><th scope="col">추출 방식</th><th scope="col">판정 비율</th><th scope="col">정밀도</th><th scope="col">재현율</th><th scope="col">F1</th><th scope="col">유형별 판정 (오류 표시/통과/보류)</th></tr></thead>
          <tbody>{Object.entries(data.perturbation).map(([k, v]) => <tr key={k}><th scope="row">{EXTRACTOR[k] ?? k}</th><td>{pct(v.coverage)} ({v.decided}/{v.n})</td><td>{num(v.precision)}</td><td>{num(v.recall)}</td><td>{num(v.f1)}</td>
            <td>{Object.entries(v.by_kind).map(([kind, d]) => `${KIND[kind] ?? kind}: ${d.FLAG ?? 0}/${d.PASS ?? 0}/${d.HOLD ?? 0}`).join(' · ')}</td></tr>)}</tbody></table></div></section>}

      <section className="sg-card"><h2>해석할 때 주의할 점</h2><ul className="sg-limits">
        <li>전체 질문 {TOTALS.questions}개·자료 {TOTALS.datasets}종·모델 1종({TOTALS.model})의 소규모 실험입니다. A·C 조건은 3회, 나머지는 1회 실행했으며 통계적 유의성을 주장하지 않습니다. 도메인별 차이(RQ4)는 경향으로만 봅니다.</li>
        <li>규칙 추출기는 결과를 보고 고친 버전(v0.2·v0.3·v0.5·v0.7)이 있습니다. 실행 전에 고정한 버전과 나란히 보고하고, v0.3·v0.5는 수정 후 새로 만든 별도 검증 세트로 다시 확인했습니다. v0.7은 별도 검증 세트로 확인하지 않았습니다.</li>
        <li>실제 LLM 답변에 대한 판정 비율은 규칙 추출 42~77%, LLM 추출 36~83%입니다(실험·조건별). 열·기간이 문장에 드러나지 않거나 해석이 필요한 문장, 끝까지 쓰이지 않은 답변은 보류되므로, 실제 답변에서 놓친 오답도 있습니다(각 표의 ‘보류 중 오답’).</li>
        <li>LLM 추출기는 판정 범위가 넓은 경우도 있지만 별도 검증 세트에서 오탐이 있었고, 국가별 자료에서는 없는 ‘연도’ 열을 지어내 보류가 많았습니다.</li>
        <li>출력 한도(2,500토큰)에 걸려 끝나지 않은 답변은 사전 규칙대로 재시도 없이 형식 오류로 채점했습니다.</li>
        <li>‘계산 일치’는 연결된 계산 하나가 맞다는 뜻이며, 답변 전체의 사실·인과관계·자료의 진실성을 보증하지 않습니다.</li>
        <li>비용은 사전 고정 단가(입력 $0.10/1M, 출력 $0.50/1M)로 추정한 값이며 실제 청구액이 아닙니다.</li>
        <li>재현: 저장소 experiments/ 폴더의 각 벤치마크(build_expected.py → evaluate.py → make_report.py)와 stability.py. 각 실험에 쓴 추출기 사본은 frozen/ 폴더에 있습니다.</li></ul></section>
      <footer className="sg-footer">{SITE_NAME} {STATGUARD_VERSION} · 실험 조건은 각 벤치마크의 PROTOCOL.md에 실행 전 기록했습니다.</footer>
    </main></div>;
}
