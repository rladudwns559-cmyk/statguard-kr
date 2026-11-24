import coverage from './benchmarkCoverage.json';
import correction from './benchmarkCorrection.json';
import comparison from './benchmarkComparison.json';

/** Two charts for the results page: verify→correct accuracy bars, and coverage vs. risk of the verifier. Data from result files only. */

type Step = { correct: number };
type CorrGroup = { n: number; A: number; R1: Step; S1: Step; R2: Step; S2: Step };
export function CorrectionBars() {
  const g = (correction as unknown as { groups: Record<string, CorrGroup> }).groups['전체'];
  const bars = [
    { k: 'A', label: '원래 답변 (일반 LLM)', v: g.A, cls: 'a' },
    { k: 'R1', label: '“다시 확인해” 1회 (대조군)', v: g.R1.correct, cls: 'r' },
    { k: 'S1', label: 'StatGuard 근거 1회', v: g.S1.correct, cls: 's' },
    { k: 'S2', label: 'StatGuard 근거 2회', v: g.S2.correct, cls: 's2' },
  ];
  const min = 60, span = 100 - min;
  return <div className="sg-hbars" role="img" aria-label={'교정 실험 정답률: ' + bars.map(b => `${b.label} ${(b.v / g.n * 100).toFixed(1)}%`).join(', ')}>
    {bars.map(b => { const p = b.v / g.n * 100; return <div className="sg-hbar" key={b.k}>
      <span className="sg-hbar-label">{b.label}</span>
      <span className="sg-hbar-track"><span className={'sg-hbar-fill sg-hbar-' + b.cls} style={{ width: `${Math.max(2, (p - min) / span * 100)}%` }}/></span>
      <b className="sg-num">{p.toFixed(1)}%</b></div>; })}
    <small className="sg-hint">가로축은 60%부터 시작합니다. 문항 {g.n}개, 같은 답변에서 출발.</small>
  </div>;
}

type M = { decided: number; passed: number; flagged: number; held: number; n: number; wrong_total: number; wrong_passed: number; wrong_flagged: number; right_flagged: number; coverage: number; risk: number | null };
const COV = coverage as unknown as { scope: string; methods: Record<string, { label: string; all: M }> };
const ORDER = ['none', 'rule', 'llm', 'hybrid'];
const pct = (v: number | null) => v === null ? '-' : `${(v * 100).toFixed(1)}%`;

export function CoverageRiskSection() {
  const W = 560, H = 280, L = 58, R = 24, T = 18, B = 46, maxY = 0.3;
  const x = (c: number) => L + c * (W - L - R), y = (r: number) => T + (1 - r / maxY) * (H - T - B);
  const pts = ORDER.map(k => ({ k, ...COV.methods[k], m: COV.methods[k].all }));
  const hybrid = COV.methods.hybrid.all, rule = COV.methods.rule.all, none = COV.methods.none.all;
  return <section className="sg-card sg-large" aria-labelledby="coverage-heading"><p className="sg-eyebrow">판정 범위와 위험</p><h2 id="coverage-heading">얼마나 판정하고, 통과시킨 답은 얼마나 믿을 만한가</h2>
    <p className="sg-hint">{COV.scope} {none.n}개에 대해, 검증 방식마다 판정한 답변 비율(가로)과 ‘통과’시킨 답변 중 실제 오답 비율(세로)을 그렸습니다. 오른쪽 아래일수록 좋습니다. 규칙 추출기가 보류한 답변만 LLM 추출기로 다시 보는 결합 방식은 저장된 결과로 새로 계산했습니다(추가 API 호출 없음).</p>
    <svg className="sg-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={pts.map(p => `${p.label}: 판정 ${pct(p.m.coverage)}, 통과 답변 중 오답 ${pct(p.m.risk)}`).join('. ')}>
      {[0, 0.1, 0.2, 0.3].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="sg-grid"/><text x={L - 8} y={y(v) + 4} textAnchor="end">{v * 100}%</text></g>)}
      {[0, 0.25, 0.5, 0.75, 1].map(v => <text key={v} x={x(v)} y={H - B + 18} textAnchor="middle">{v * 100}%</text>)}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="sg-axis">판정한 답변 비율</text>
      <text x={14} y={(T + H - B) / 2} textAnchor="middle" className="sg-axis" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>통과 답변 중 오답</text>
      {pts.map(p => <g key={p.k} className={'sg-pt sg-pt-' + p.k}><circle cx={x(p.m.coverage)} cy={y(p.m.risk ?? 0)} r={9}/></g>)}
    </svg>
    <ul className="sg-legend" aria-hidden="true">{pts.map(p => <li key={p.k}><i className={'sg-dot sg-pt-' + p.k}/>{p.label} · 판정 {pct(p.m.coverage)} · 통과 중 오답 {pct(p.m.risk)}</li>)}</ul>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="검증 방식별 판정 범위와 위험 표"><table><thead><tr><th scope="col">방식</th><th scope="col">판정 비율</th><th scope="col">통과 답변 중 오답</th><th scope="col">오류 표시(그중 실제 오답)</th><th scope="col">잡아낸 실제 오답</th></tr></thead>
      <tbody>{pts.map(p => <tr key={p.k}><th scope="row">{p.label}</th><td>{pct(p.m.coverage)} ({p.m.decided}/{p.m.n})</td><td>{p.m.wrong_passed}/{p.m.passed} ({pct(p.m.risk)})</td><td>{p.m.flagged}({p.m.wrong_flagged})</td><td>{p.m.wrong_flagged}/{p.m.wrong_total}</td></tr>)}</tbody></table></div>
    <p className="sg-hint">검증하지 않으면 답변의 {pct(none.risk)}가 틀린 채로 쓰입니다. 실행 전 고정한 규칙 추출기는 판정 범위가 {pct(rule.coverage)}로 좁지만 통과 답변의 오답이 0건이었고, 결합 방식은 판정 범위를 {pct(hybrid.coverage)}까지 넓히고 실제 오답을 {hybrid.wrong_flagged}건 잡는 대신 통과 답변 중 오답 {hybrid.wrong_passed}건과 오탐 {hybrid.right_flagged}건이 생겼습니다. 웹은 결과가 매번 같은 규칙 추출기를 기본으로 씁니다.</p>
  </section>;
}

/** Related work checked by the team (venues verified). Differences are stated only against these papers. */
const WORK = [
  { name: 'PAL', ref: 'Gao 외, ICML 2023', url: 'https://proceedings.mlr.press/v202/gao23f.html', what: 'LLM이 코드를 쓰고 파이썬이 계산', diff: '답변을 만들 때 계산 도구를 쓰는 방식(우리 실험의 C 조건). StatGuard는 이미 나온 어떤 답변이든 나중에 다시 계산해 검증' },
  { name: 'CRITIC', ref: 'Gou 외, ICLR 2024', url: 'https://proceedings.iclr.cc/paper_files/paper/2024/hash/fef126561bbf9d4467dbb8d27334b8fe-Abstract-Conference.html', what: 'LLM이 외부 도구로 자기 답을 비평하고 고침', diff: '비평을 LLM이 만듦. StatGuard는 LLM 없이 결정적 재계산으로 판정하고, 확정할 수 없으면 사유와 함께 보류' },
  { name: 'LLM은 아직 스스로 추론을 고치지 못한다', ref: 'Huang 외, ICLR 2024', url: 'https://arxiv.org/abs/2310.01798', what: '외부 피드백 없는 자기 교정은 효과가 없거나 나빠짐', diff: '같은 결론을 한국어 표 데이터에서 대조군으로 다시 확인: “다시 확인해”만으로는 불일치 오답 0건, 재계산 근거로는 대부분 고쳐짐' },
  { name: 'Chain-of-Verification', ref: 'Dhuliawala 외, ACL Findings 2024', url: 'https://aclanthology.org/2024.findings-acl.212', what: '모델이 확인 질문을 만들어 스스로 검증', diff: '모델 내부 검증. StatGuard는 사용자의 CSV라는 외부 근거로 검증' },
  { name: 'QuanTemp', ref: 'Venktesh 외, SIGIR 2024', url: 'https://arxiv.org/abs/2403.17169', what: '실제 수치 주장을 웹 근거로 사실 확인', diff: '같은 ‘수치 주장 검증’이지만 웹 문서 대신 사용자가 준 표로 정확히 재계산' },
  { name: 'StatQA', ref: 'Zhu 외, NeurIPS 2024', url: 'https://arxiv.org/abs/2406.07815', what: 'LLM의 통계 능력 벤치마크(최고 GPT-4o 64.83%)', diff: 'LLM이 통계에 약하다는 근거. StatGuard는 그 답을 쓰기 전에 걸러내는 장치' },
  { name: 'TableBench', ref: 'Wu 외, AAAI 2025', url: 'https://ojs.aaai.org/index.php/AAAI/article/view/34739', what: '표 질의응답 벤치마크, GPT-4도 사람보다 크게 낮음', diff: '표가 커질수록 일반 LLM 정답률이 떨어진 우리 결과(RQ1)와 같은 방향' },
  { name: 'Know Your Limits (판정 보류 서베이)', ref: 'Wen 외, TACL 2025', url: 'https://aclanthology.org/2025.tacl-1.26', what: 'LLM이 답을 거절·보류하는 연구 정리', diff: '대부분 모델이 스스로 보류. StatGuard는 검증기가 판정을 보류하고 판정 범위(coverage)와 위험을 함께 보고' },
];
export function RelatedWorkSection() {
  return <section className="sg-card sg-large" aria-labelledby="related-heading"><p className="sg-eyebrow">선행연구</p><h2 id="related-heading">기존 연구와 무엇이 다른가</h2>
    <p className="sg-hint">팀이 확인한 연구 8편과의 비교입니다. ‘최초’를 주장하지 않으며, 아래 연구들과 비교한 차이만 적었습니다.</p>
    <div className="sg-related">{WORK.map(w => <article key={w.name} className="sg-related-card">
      <h3><a href={w.url} target="_blank" rel="noreferrer">{w.name}</a></h3><small>{w.ref}</small>
      <p><b>하는 일</b> {w.what}</p><p><b>StatGuard와 차이</b> {w.diff}</p></article>)}</div>
    <p className="sg-hint">요약하면 StatGuard-KR의 위치는 ① 검증에 LLM을 쓰지 않는 결정적 재계산, ② 어떤 AI의 답변이든 사후에 검증, ③ 확정할 수 없으면 사유와 함께 보류, ④ 한국어 수치 표현 처리, ⑤ 재계산 근거로 교정까지 잇는 흐름입니다.</p>
  </section>;
}

/** Public dataset built by experiments/export_dataset.py and served from /statguard-dataset/. */
const DATA_FILES = [
  { href: '/statguard-dataset/README.md', name: 'README.md', what: '데이터 설명서(구성·필드·채점 규칙·출처·라이선스·한계)' },
  { href: '/statguard-dataset/questions.jsonl', name: 'questions.jsonl', what: '질문 120개 · 기대값·단위 · 기대값을 정의한 계산' },
  { href: '/statguard-dataset/answers_gpt-6-luna_A.jsonl', name: 'answers_gpt-6-luna_A.jsonl', what: '일반 LLM 답변 120개 · 정답 여부 · StatGuard 판정 · 교정 결과' },
];
const TABLES = ['01_시애틀_2023_월별강수량', '02_마우나로아_2024_월별CO2', '03_대한민국_2022_2023_총인구', '04_대한민국_2014_2023_인구_실업률', '05_방문자_합성예제', '06_시애틀_2023_일별기상', '07_미국4개도시_2023_일별기상', '08_세계_국가별_2023_지표'];
export function DatasetSection({ questions, wrong }: { questions: number; wrong: number }) {
  return <section className="sg-card sg-large" aria-labelledby="dataset-heading"><p className="sg-eyebrow">데이터 공개</p><h2 id="dataset-heading">한국어 수치 주장 벤치마크 v0.1 내려받기</h2>
    <p className="sg-hint">다른 연구자가 같은 실험을 하거나 다른 모델·검증기를 비교할 수 있도록, 질문 {questions}개와 기대값, 일반 LLM 답변(오답 {wrong}개), StatGuard 판정, 교정 결과, 표 {TABLES.length}종을 그대로 공개합니다. 표의 숫자는 원본과 같으며 출처·라이선스는 설명서에 있습니다.</p>
    <ul className="sg-files">{DATA_FILES.map(f => <li key={f.name}><a href={f.href} download>{f.name}</a><span>{f.what}</span></li>)}
      <li><span className="sg-files-name">tables/</span><span>{TABLES.map((t, i) => <a key={t} href={`/statguard-dataset/tables/${encodeURIComponent(t)}.csv`} download>{t}.csv{i < TABLES.length - 1 ? ' · ' : ''}</a>)}</span></li></ul>
  </section>;
}

/* ---- statguard_comparison_v0.1: LLM judge vs StatGuard, three answer models; statguard_forensics_v0.1 ---- */
type V = { n: number; pass: number; passed_wrong: number; wrong: number; wrong_flagged: number; false_alarm: number; coverage: number; upper95: number };
type ModelRow = { n: number; A: number; R1: number; S1: number; S2: number; flagged: number; flagged_R1: number; flagged_S1: number; S1_broken: number; passed_wrong: Record<string, [number, number]> };
type Fx = { injected: Record<string, number>; random: { explained: number; n: number; high: number }; real_by_model: Record<string, { contradicted: number; explained: number; high?: number }>;
  injected_by_kind: Record<string, Record<string, number>>; examples: { model: string; question: string; sentence: string; diagnosis: { title: string; explanation: string } }[] };
const CMP = comparison as unknown as { verifiers: Record<'prereg' | 'final_rule' | 'judge' | 'hybrid', V>; main88: Record<string, V>; models: Record<string, ModelRow>;
  after_correction_prereg: Record<string, { R2: number; S2: number }>; judge5_partial: { done: number; of: number }; forensics: Fx;
  final_rule_validation: { answers: number; prereg: V; final_rule: V };
  extractor_v08: { adopted: boolean; table: Record<string, { pass: number; passed_wrong: number; false_alarm: number; wrong_flagged: number }> };
  arithmetic: { version: string; groups: Record<string, Ar>; total: Ar; before_fix_total: Ar; right_flagged: ArCase[]; examples: ArCase[] } };
type Ar = { answers: number; wrong: number; with_checks: number; flagged: number; flagged_wrong: number; flagged_right: number; added: number };
type ArCase = { source: string; question: string; expression: string; stated: string; recomputed: string; correct: boolean; statguard: string };
const rate = (a: number, n: number) => n ? `${(a / n * 100).toFixed(1)}%` : '-';
export const COMPARISON = CMP;

export function ComparisonSection() {
  const v = CMP.verifiers;
  const bars = [
    { k: 'judge', label: 'LLM에게 채점을 맡김 (gpt-6-luna 심판)', t: v.judge, cls: 'bad' },
    { k: 'hybrid', label: 'StatGuard 보류분만 LLM 심판 (결합·탐색)', t: v.hybrid, cls: 'mid' },
    { k: 'prereg', label: 'StatGuard (사전 등록 규칙)', t: v.prereg, cls: 'ok' },
    { k: 'final_rule', label: 'StatGuard 최종값 규칙 (탐색)', t: v.final_rule, cls: 'ok2' },
  ];
  const max = Math.max(...bars.map(b => b.t.passed_wrong), 1);
  const models = Object.entries(CMP.models);
  const m88 = CMP.main88;
  return <section className="sg-card sg-large" aria-labelledby="compare-heading"><p className="sg-eyebrow">검증 방식 비교 · 답변 모델 3종</p><h2 id="compare-heading">LLM에게 채점을 맡기면 어떻게 될까?</h2>
    <p className="sg-hint">같은 질문 120개에 대해 답변 모델 3종(gpt-6-luna·gpt-4o-mini·gpt-5-mini)이 쓴 답 360개를, ① CSV를 보고 맞는지 판정하라고 LLM(gpt-6-luna)에게 맡긴 경우와 ② StatGuard가 다시 계산한 경우로 비교했습니다. 정답은 채점에만 썼고, 조건은 실행 전에 PROTOCOL로 고정했습니다.</p>
    <div className="sg-cbars" role="img" aria-label={'통과시킨 답 중 오답 수: ' + bars.map(b => `${b.label} ${b.t.passed_wrong}개(통과 ${b.t.pass}개 중)`).join(', ')}>
      {bars.map(b => <div className="sg-cbar" key={b.k}>
        <span className="sg-hbar-label">{b.label}</span>
        <span className="sg-hbar-track"><span className={'sg-cbar-fill sg-cbar-' + b.cls} style={{ width: `${Math.max(1.5, b.t.passed_wrong / max * 100)}%` }}/></span>
        <b className="sg-num">{b.t.passed_wrong}<small>/{b.t.pass}</small></b></div>)}
      <small className="sg-hint">막대 = ‘맞다’고 통과시킨 답 중 실제로 틀린 답의 수(오른쪽: 통과시킨 답 수).</small>
    </div>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="검증 방식 비교 표"><table><thead><tr><th scope="col">방식</th><th scope="col">통과시킨 답</th><th scope="col">그중 오답 (95% 상한)</th><th scope="col">오답을 틀렸다고 지적</th><th scope="col">맞는 답을 틀렸다고 함</th></tr></thead>
      <tbody>{bars.map(b => <tr key={b.k}><th scope="row">{b.label}</th><td>{b.t.pass}/{b.t.n} ({rate(b.t.pass, b.t.n)})</td><td>{b.t.passed_wrong} ({rate(b.t.passed_wrong, b.t.pass)}, ≤{(b.t.upper95 * 100).toFixed(1)}%)</td><td>{b.t.wrong_flagged}/{b.t.wrong}</td><td>{b.t.false_alarm}</td></tr>)}</tbody></table></div>
    <p className="sg-hint"><strong>해석:</strong> LLM 심판은 더 많은 답을 판정하지만, ‘맞다’고 한 답 중 {v.judge.passed_wrong}개가 실제로는 틀렸습니다. StatGuard는 판정하는 답이 적은 대신(보류가 많음) 틀린 답을 통과시킨 경우가 {v.prereg.passed_wrong}개였습니다. 틀린 숫자를 ‘맞다’고 믿게 만드는 실수가 가장 위험하다는 것이 이 연구의 출발점입니다.</p>
    <p className="sg-hint"><strong>정직하게 밝히는 점:</strong> 사전 등록 규칙(불일치 없이 일치한 숫자가 하나라도 있으면 통과)은 긴 답변에서 중간 숫자만 맞고 최종값은 보류인 답 {v.prereg.passed_wrong}개를 통과시켰고, 교정 후 답변에서는 이런 경우가 {Object.entries(CMP.after_correction_prereg).map(([m, x]) => `${m} ${x.S2}개`).join(', ')}로 늘었습니다. 결과를 본 뒤 ‘최종값이 재계산과 일치할 때만 통과’로 바꾼 규칙(탐색 분석)에서는 통과 중 오답이 {v.final_rule.passed_wrong}개였습니다. 이 규칙을 만들 때 보지 않은 gpt-6-luna 답변 {CMP.final_rule_validation.answers}개(반복·조건 실행)로 다시 확인한 결과, 통과 {CMP.final_rule_validation.final_rule.pass}개 중 오답 {CMP.final_rule_validation.final_rule.passed_wrong}개로 유지됐습니다. 다만 이 답변들에서는 기존 규칙도 오답 {CMP.final_rule_validation.prereg.passed_wrong}개였기 때문에(짧은 답변이 많음), 두 규칙의 차이를 가르는 시험은 아니며 긴 답변을 쓰는 새 모델·문항으로 확인해야 합니다. 같은 질문을 세 번 물어 답이 같을 때만 믿는 ‘자기 일관성’도 gpt-6-luna 88문항에서 통과 {m88.self_consistency?.pass}개 중 오답 {m88.self_consistency?.passed_wrong}개로 좋았습니다(StatGuard {m88.statguard?.pass}개 중 {m88.statguard?.passed_wrong}개, LLM 심판 {m88['judge_gpt-6-luna']?.pass}개 중 {m88['judge_gpt-6-luna']?.passed_wrong}개). 추론 모델 gpt-5-mini를 심판으로 쓴 비교는 예산 한도로 {CMP.judge5_partial.done}/{CMP.judge5_partial.of}개만 실행해 결과에서 뺐습니다.</p>
    <h3 className="sg-subhead">다른 AI 모델에서도 근거 교정이 통할까?</h3>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="답변 모델별 정확도와 교정 표"><table><thead><tr><th scope="col">답변 모델</th><th scope="col">원래 정답률</th><th scope="col">“다시 확인해” 1회</th><th scope="col">StatGuard 근거 1회</th><th scope="col">불일치로 잡힌 오답 고침 (근거 / 재확인)</th><th scope="col">맞던 답이 틀려짐 (근거 1회)</th></tr></thead>
      <tbody>{models.map(([m, r]) => <tr key={m}><th scope="row">{m}</th><td>{rate(r.A, r.n)}</td><td>{rate(r.R1, r.n)}</td><td><strong>{rate(r.S1, r.n)}</strong></td><td>{r.flagged_S1}/{r.flagged} · {r.flagged_R1}/{r.flagged}</td><td>{r.S1_broken}</td></tr>)}</tbody></table></div>
    <p className="sg-hint">계산 불일치로 잡힌 오답은 세 모델 모두에서 재계산 근거를 받았을 때 더 많이 고쳐졌습니다. 효과는 원래 오답이 많던 gpt-4o-mini에서 가장 컸고(정답률 {rate(CMP.models['gpt-4o-mini'].A, 120)} → {rate(CMP.models['gpt-4o-mini'].S1, 120)}), 추론 모델 gpt-5-mini에서는 작았습니다. gpt-6-luna 행은 기존 교정 실험(statguard_correction_v0.1)의 결과입니다. 모델·문항이 적어 경향으로만 해석합니다.</p>
  </section>;
}

export function ArithmeticSection() {
  const a = CMP.arithmetic, t = a.total, b = a.before_fix_total, g1 = a.groups.G1, g2 = a.groups.G2;
  return <section className="sg-card sg-large" aria-labelledby="arith-results-heading"><p className="sg-eyebrow">CSV 없이 검산</p><h2 id="arith-results-heading">자료가 없어도, 답변이 쓴 계산은 다시 계산할 수 있다</h2>
    <p className="sg-hint">답변 안에 적힌 계산식(“a + b + c = d”, “(a / b) × 100 ≈ c%”)만 찾아 LLM 없이 다시 계산합니다. 결과의 마지막 자릿수로 반올림해 다르면 ‘계산 틀림’입니다. 저장된 답변 {t.answers.toLocaleString('ko-KR')}개(원래 답변과 교정된 답변, 모델 3종)에 적용했습니다.</p>
    <dl className="sg-data-meta sg-results-meta" aria-label="검산 결과">
      <div><dt>계산 틀림으로 잡은 답 중 실제 오답</dt><dd>{t.flagged_wrong}/{t.flagged} ({rate(t.flagged_wrong, t.flagged)})</dd></div>
      <div><dt>전체 오답 중 검산으로 잡은 비율</dt><dd>{t.flagged_wrong}/{t.wrong} ({rate(t.flagged_wrong, t.wrong)})</dd></div>
      <div><dt>CSV 재계산이 ‘불일치’로 잡지 못한 오답 추가</dt><dd>{t.added}개</dd></div>
    </dl>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="검산 평가 표"><table><thead><tr><th scope="col">답변 묶음</th><th scope="col">답변</th><th scope="col">계산식을 쓴 답</th><th scope="col">계산 틀림</th><th scope="col">그중 실제 오답</th></tr></thead>
      <tbody><tr><th scope="row">모듈을 만들기 전 훑어본 답변</th><td>{g1.answers}</td><td>{g1.with_checks}</td><td>{g1.flagged}</td><td>{g1.flagged_wrong}</td></tr><tr><th scope="row">처음 적용한 답변</th><td>{g2.answers}</td><td>{g2.with_checks}</td><td>{g2.flagged}</td><td>{g2.flagged_wrong}</td></tr></tbody></table></div>
    <ul className="sg-fx-examples">{a.examples.map((e, i) => <li key={i}><small>{e.source} · {e.question} · CSV 판정 {({ HOLD: '보류', PASS: '통과', FLAG: '불일치' } as Record<string, string>)[e.statguard] ?? e.statguard}</small><q>{e.expression.length > 80 ? e.expression.slice(0, 80) + '…' : e.expression} = {e.stated}</q><b>다시 계산하면 {Number(e.recomputed).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}</b></li>)}</ul>
    <p className="sg-hint"><strong>정직하게 밝히는 점:</strong> 첫 실행(계산 틀림 {b.flagged}개 중 오답 {b.flagged_wrong}개)에서 긴 식의 일부만 잘라 읽는 버그 두 가지를 찾아 고쳤고, 위 숫자는 고친 뒤 같은 데이터로 다시 낸 결과입니다. 맞는 답인데 ‘계산 틀림’으로 잡힌 {t.flagged_right}개는 대부분 반올림 대신 버림(예: 7.666…을 ‘7.666’)이었고, 1개는 최종값은 맞지만 중간 덧셈이 실제로 틀린 경우였습니다. 계산식을 적지 않는 모델(gpt-6-luna 원래 답변)에서는 거의 작동하지 않고, 자료에서 숫자를 잘못 옮겨 적은 경우는 CSV 검증으로만 찾을 수 있습니다(experiments/statguard_arithmetic_v0.1).</p>
  </section>;
}

const FX_KIND: Record<string, string> = { OMITTED_ROW: '행 하나 누락', WRONG_STATISTIC: '다른 통계량(평균↔중앙값 등)', WRONG_COUNT: '개수 잘못 셈', SCALE: '자릿수(단위) 오류', WRONG_COLUMN: '다른 열 계산' };
export function ForensicsSection() {
  const f = CMP.forensics, inj = f.injected, nInj = (inj.correct ?? 0) + (inj.other ?? 0) + (inj.missed ?? 0);
  const real = Object.entries(f.real_by_model);
  return <section className="sg-card sg-large" aria-labelledby="forensics-heading"><p className="sg-eyebrow">오류 역추적</p><h2 id="forensics-heading">틀렸다는 것에서 끝나지 않고, 왜 틀렸는지 계산으로 재현합니다</h2>
    <p className="sg-hint">‘계산 불일치’로 잡힌 숫자마다, 흔한 계산 실수(행 누락, 평균·중앙값 혼동, 개수 잘못 셈, 다른 열·범위, 자릿수, 앞 문장의 틀린 숫자 재사용)를 정해진 목록에서 하나씩 다시 계산해 AI의 숫자와 똑같이 나오는 실수를 찾습니다. LLM은 쓰지 않습니다. 우연히 맞을 확률을 함께 계산해, 그 확률이 크면 설명을 내지 않습니다.</p>
    <dl className="sg-data-meta sg-results-meta" aria-label="역추적 검증 결과">
      <div><dt>일부러 넣은 계산 실수의 원인을 맞게 찾음</dt><dd>{inj.correct}/{nInj} ({rate(inj.correct, nInj)})</dd></div>
      <div><dt>이유 없이 틀린 숫자에 설명을 붙임</dt><dd>{f.random.explained}/{f.random.n} ({rate(f.random.explained, f.random.n)})</dd></div>
      <div><dt>그중 ‘확신 높음’</dt><dd>{f.random.high}/{f.random.n} ({rate(f.random.high, f.random.n)})</dd></div>
    </dl>
    <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="실수 종류별 역추적 결과"><table><thead><tr><th scope="col">넣은 실수</th><th scope="col">맞게 찾음</th><th scope="col">다른 설명</th><th scope="col">못 찾음</th></tr></thead>
      <tbody>{Object.entries(f.injected_by_kind).map(([k, c]) => { const n = (c.correct ?? 0) + (c.other ?? 0) + (c.missed ?? 0); return <tr key={k}><th scope="row">{FX_KIND[k] ?? k}</th><td>{c.correct ?? 0}/{n}</td><td>{c.other ?? 0}</td><td>{c.missed ?? 0}</td></tr>; })}</tbody></table></div>
    <p className="sg-hint">실제 LLM 오답에 적용하면, 계산 불일치로 잡힌 숫자 중 {real.map(([m, c]) => `${m} ${c.contradicted}개 중 ${c.explained}개`).join(', ')}의 원인을 재현했습니다. 이 중에는 AI의 실수가 아니라 <strong>한 문장에 숫자가 여러 개라 StatGuard가 범위를 잘못 연결한 경우</strong>도 있었고, 역추적은 이를 ‘다른 범위의 값과 일치’로 따로 표시합니다. 검증기 자신의 오독을 드러내는 장치이기도 합니다.</p>
    {(() => { const x = CMP.extractor_v08.table; return <p className="sg-hint"><strong>찾은 오독을 고쳐 보았지만, 적용하지 않았습니다.</strong> 숫자가 여러 개인 문장을 절로 나눠 읽는 추출기 v0.8을 만들어 저장된 답변 1,492개로 시험했습니다. 맞는 답을 틀렸다고 한 경우는 {x['v0.7|prereg|all'].false_alarm}개 → {x['v0.8|prereg|all'].false_alarm}개로 줄고 최종값 규칙의 통과 중 오답도 {x['v0.7|final_rule|all'].passed_wrong}개 → {x['v0.8|final_rule|all'].passed_wrong}개였지만, 실행 전에 정한 채택 기준(어느 판정 규칙에서도 통과 중 오답이 늘지 않을 것)에서 사전 등록 규칙의 통과 중 오답이 {x['v0.7|prereg|all'].passed_wrong}개 → {x['v0.8|prereg|all'].passed_wrong}개로 늘어 기준을 넘지 못했습니다. 기준은 결과를 보고 바꾸지 않으므로 사이트는 v0.7을 그대로 씁니다(experiments/statguard_extractor_v0.8).</p>; })()}
    <ul className="sg-fx-examples">{f.examples.slice(0, 5).map((e, i) => <li key={i}><small>{e.model} · {e.question}</small><q>{e.sentence.length > 70 ? e.sentence.slice(0, 70) + '…' : e.sentence}</q><b>{e.diagnosis.title}</b><span>{e.diagnosis.explanation}</span></li>)}</ul>
    <p className="sg-hint">기준값(설명을 내지 않는 우연 확률 0.25)은 첫 시험에서 정했고, 위 숫자는 기준을 고정한 뒤 새 무작위 시드로 다시 시험한 결과입니다(experiments/statguard_forensics_v0.1). 같은 숫자를 만드는 실수가 여럿일 수 있어, 재현은 ‘가능성이 높은 원인’이지 증명이 아닙니다.</p>
  </section>;
}
