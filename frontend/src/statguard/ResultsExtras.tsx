import coverage from './benchmarkCoverage.json';
import correction from './benchmarkCorrection.json';

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
      <b>{p.toFixed(1)}%</b></div>; })}
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
