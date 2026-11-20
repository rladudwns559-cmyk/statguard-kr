import { useEffect, useMemo, useRef, useState } from 'react';
import type { CsvTable } from './csv';
import { base64Bytes, CalculationError } from './calculationClient';
import { askLive, liveStatus, NOTES, OPERATION_LABEL, REASONS, STATUS_LABEL, STATUSES, verifyAnswer, type AnswerVerification as Result, type Claim, type LiveStatus } from './answerClient';
import { UsedRows } from './CalculationResult';
import type { SamplePreset } from './samples';
import { STATGUARD_VERSION } from './StatGuardChrome';

type Source = CsvTable & { name: string; sha256: string; previewSha256: string; rawBytes: ArrayBuffer; sample: boolean; preset?: SamplePreset };
export const SAMPLE_UNITS: Record<string, string> = { 방문자수: '명', 체류시간: '분' };
export const SAMPLE_ANSWER = 'A지역 방문자수는 2023년 1,000명에서 2024년 1,178명으로 23.0% 증가했습니다. 전체 방문자수 합계는 4,938명입니다. B지역의 2024년 체류시간 평균은 9분입니다. A지역은 2024년 전체 방문자의 약 44.7%를 차지합니다. C지역의 2025년 방문자수는 520명입니다. 방문자 증가는 체류시간이 늘었기 때문입니다.';
const numeric = (v: string) => /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v.trim());
/** Display only: long engine decimals are cut to 6 places; the full value stays in the evidence. */
const short = (v: string) => { const [i, f = ''] = v.split('.'); return f.length > 6 ? `${i}.${f.slice(0, 6)}…` : v; };
const describe =(f: Record<string, string> | null) => !f || !Object.keys(f).length ? '전체 행' : Object.entries(f).map(([k, v]) => `${k} = ${v}`).join(', ');

/** The answer as written, with each checked sentence tinted by its verdict. Unchecked text stays plain. */
function ReadBack({ answer, claims }: { answer: string; claims: Claim[] }) {
  const parts: { text: string; claim?: Claim }[] = [];
  let cursor = 0;
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.sentence)) continue;
    const at = answer.indexOf(claim.sentence, cursor);
    if (at < 0) continue;
    seen.add(claim.sentence);
    if (at > cursor) parts.push({ text: answer.slice(cursor, at) });
    parts.push({ text: claim.sentence, claim });
    cursor = at + claim.sentence.length;
  }
  if (cursor < answer.length) parts.push({ text: answer.slice(cursor) });
  const jump = (id: string) => { const el = document.getElementById('sg-claim-' + id); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 1200); };
  return <div className="sg-readback" aria-label="판정을 표시한 AI 답변"><h3>답변 원문 · 문장을 누르면 판정으로 이동</h3>
    {parts.map((p, i) => p.claim ? <button key={i} type="button" className={'sg-rb-' + p.claim.status.toLowerCase().replace('_', '-')} title={STATUS_LABEL[p.claim.status]} onClick={() => jump(p.claim!.claim_id)}>{p.text}</button> : <span key={i}>{p.text}</span>)}</div>;
}

function ClaimCard({ claim, table }: { claim: Claim; table: CsvTable }) {
  const tone = claim.status.toLowerCase().replace('_', '-');
  return <article id={'sg-claim-' + claim.claim_id} className={'sg-claim sg-claim-' + tone} aria-label={`${claim.claim_id} ${STATUS_LABEL[claim.status]}`}>
    <header><span className="sg-claim-status">{STATUS_LABEL[claim.status]}</span>{claim.operation && <span className="sg-claim-op">{OPERATION_LABEL[claim.operation] ?? claim.operation}</span>}{claim.column && <span className="sg-claim-op">{claim.column}</span>}</header>
    <blockquote>{claim.sentence}</blockquote>
    {claim.claimed && claim.computed ? <dl className="sg-claim-values">
      <div><dt>답변의 수치</dt><dd>{claim.claimed.text}{claim.claimed.approximate && ' (약)'}{!!claim.claimed.value?.startsWith('-') && !claim.claimed.text.includes('-') && ` → 감소로 읽음 ${claim.claimed.value}${claim.claimed.unit ?? ''}`}</dd></div>
      <div><dt>CSV 재계산</dt><dd>{claim.operation === 't_test' ? `t = ${short(claim.computed.value)}, p = ${short(String(claim.computed.extra?.p_value ?? ''))}` : `${short(claim.computed.value)} ${claim.computed.unit}`}</dd></div>
      {claim.difference && claim.claimed.target !== 'significance' && <div><dt>차이</dt><dd>{claim.difference.signed.startsWith('-') ? '' : '+'}{short(claim.difference.signed)} {claim.difference.unit}{claim.difference.relative_percent && claim.status === 'CONTRADICTED' ? ` (${claim.difference.relative_percent}%)` : ''}</dd></div>}
    </dl> : claim.claimed && <p className="sg-hint">답변의 수치: {claim.claimed.text} · 재계산하지 않음</p>}
    <p className="sg-claim-reason">{REASONS[claim.reason_code] ?? claim.reason_code}</p>
    {claim.notes.filter(n => NOTES[n]).map(n => <p className="sg-hint" key={n}>※ {NOTES[n]}</p>)}
    {claim.interpretive && claim.computed && <p className="sg-hint">※ 문장의 해석(원인·영향 등) 부분은 판정 범위 밖입니다.</p>}
    {claim.computed && claim.spec && <details><summary>계산 근거 보기</summary>
      <p className="sg-hint">전체 재계산 값(유효숫자 34자리): {claim.computed.value} {claim.computed.unit}</p>
      <p className="sg-hint">계산식: <code>{claim.computed.expression}</code> · 허용 차이 ±{claim.claimed?.tolerance} (답변 자릿수 기준 반올림)</p>
      <p className="sg-hint">선택 범위: {describe(claim.spec.filters)}{claim.spec.reference_filters && ` · 기준 범위: ${describe(claim.spec.reference_filters)}`}</p>
      <UsedRows table={table} usage={claim.computed.usage} title={claim.computed.reference_usage ? '선택 범위' : '계산 범위'}/>
      {claim.computed.reference_usage && <UsedRows table={table} usage={claim.computed.reference_usage} title="기준 범위"/>}
    </details>}
  </article>;
}

export default function AnswerVerification({ table, onVerified, active = true }: { table: Source; onVerified?: (done: boolean) => void; active?: boolean }) {
  const numericColumns = useMemo(() => table.columns.filter((_, i) => table.rows.every(r => !r[i].trim() || numeric(r[i])) && table.rows.some(r => r[i].trim())), [table]);
  const example = table.sample ? { units: SAMPLE_UNITS, answer: SAMPLE_ANSWER } : table.preset ? { units: table.preset.units, answer: table.preset.answer } : null;
  const [units, setUnits] = useState<Record<string, string>>(() => example ? { ...example.units } : {});
  const [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const abort = useRef<AbortController | null>(null), output = useRef<HTMLElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { if (result) output.current?.focus(); onVerified?.(!!result); }, [result, onVerified]);
  const confirmed = Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  function change(next: () => void) { abort.current?.abort(); abort.current = null; setBusy(false); setResult(null); setError(''); next(); }
  const [live, setLive] = useState<LiveStatus | null>(null), [question, setQuestion] = useState(''), [asking, setAsking] = useState(false), [askedModel, setAskedModel] = useState('');
  // Live-demo status is only asked for while this panel is visible (kept mounted when another tab is shown).
  useEffect(() => { if (!active || live) return; let alive = true; void liveStatus().then(s => { if (alive) setLive(s); }); return () => { alive = false; }; }, [active, live]);
  async function askAndVerify() {
    if (asking || busy) return;
    if (!question.trim()) { setError('AI에게 할 질문을 입력해 주세요.'); return; }
    if (!Object.keys(confirmed).length) { setError('숫자 열 하나 이상의 단위를 먼저 입력해 주세요.'); return; }
    const controller = new AbortController(); abort.current = controller; setAsking(true); setError(''); setResult(null); setAskedModel('');
    const timer = setTimeout(() => controller.abort(), 100000);
    try {
      const reply = await askLive({ csv_base64: base64Bytes(table.rawBytes), encoding: table.encoding === 'UTF-8' ? 'utf-8-sig' : 'cp949', question }, controller.signal);
      if (abort.current !== controller) return;
      setAnswer(reply.answer); setAskedModel(reply.model); setLive(l => l && { ...l, remaining: Math.max(0, l.remaining - 1) });
      abort.current = null; setAsking(false);
      await run(reply.answer);
    } catch (e) {
      if (abort.current === controller) setError(controller.signal.aborted ? 'AI 답변 시간이 초과되었습니다.' : e instanceof CalculationError ? e.message : 'AI 답변을 받지 못했습니다.');
    } finally { clearTimeout(timer); if (abort.current === controller) { abort.current = null; setAsking(false); } }
  }
  async function run(text = answer) {
    if (busy) return;
    if (!Object.keys(confirmed).length) { setError('숫자 열 하나 이상의 단위를 입력해 주세요.'); return; }
    if (!text.trim()) { setError('검증할 AI 답변을 입력해 주세요.'); return; }
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(''); setResult(null);
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const next = await verifyAnswer({ mode: 'verify_answer', request_id: crypto.randomUUID(), csv_base64: base64Bytes(table.rawBytes), source_sha256: table.sha256, preview_sha256: table.previewSha256, encoding: table.encoding === 'UTF-8' ? 'utf-8-sig' : 'cp949', units: confirmed, answer_text: text }, controller.signal);
      if (abort.current === controller) setResult(next);
    } catch (e) {
      if (abort.current === controller) setError(controller.signal.aborted ? '검증 시간이 초과되었습니다. 자동으로 다시 실행하지 않았습니다.' : e instanceof CalculationError ? e.message : '검증 엔진에 연결하지 못했습니다.');
    } finally { clearTimeout(timer); if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  return <section className="sg-card sg-answer" aria-labelledby="answer-heading">
    <h2 id="answer-heading">AI 답변 속 숫자 검증</h2>
    <p className="sg-hint">AI가 이 CSV에 대해 쓴 답변을 붙여 넣으면, 문장에서 수치 주장을 찾아 CSV로 다시 계산하고 4가지 상태로 판정합니다. 열·범위를 문장에서 확정할 수 없으면 계산을 강행하지 않고 보류합니다.</p>
    {table.preset && <p className="sg-hint">실제 공개 자료 · 출처: {table.preset.source} · 숫자는 원본과 같고 열 이름만 한국어로 정리했습니다. ‘예시 답변’은 설명용으로 작성한 문장이며 맞는 주장과 틀린 주장이 섞여 있습니다.</p>}
    <details className="sg-answer-preview" open><summary>자료 미리보기 · {table.name} ({table.rows.length.toLocaleString('ko-KR')}행)</summary>
      <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="답변 검증용 CSV 미리보기"><table><caption>상위 {Math.min(table.rows.length, 10)}행</caption><thead><tr><th scope="col">행</th>{table.columns.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(0, 10).map((r, i) => <tr key={i}><th scope="row">{i + 1}</th>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
    </details>
    <fieldset className="sg-unit-grid"><legend>1. 숫자 열의 단위 확인</legend>
      {numericColumns.length ? numericColumns.map(c => <label key={c}>{c}<input maxLength={32} value={units[c] ?? ''} placeholder={/(연도|년도|연월|월|일자|날짜|코드|번호|id)$/i.test(c) ? '구분용 열이면 비워 두세요' : '예: 명 · 비워 두면 계산 제외'} onChange={e => change(() => setUnits({ ...units, [c]: e.target.value }))}/></label>) : <p className="sg-hint">숫자로만 된 열이 없습니다.</p>}
      <p className="sg-hint">연도·월처럼 구분용 숫자 열은 비워 두세요. 단위는 자동 추정하지 않으며, 단위를 입력한 열만 계산 대상이 됩니다.</p>
    </fieldset>
    {live?.enabled && <fieldset className="sg-live" aria-label="AI에게 질문하기"><legend>시연 · AI에게 직접 질문 <span className="sg-new">LIVE</span></legend>
      <p className="sg-hint">이 PC에서만 켜진 시연 기능입니다. 질문과 CSV를 {live.model}에 보내 받은 답변을 아래에 넣고 바로 검증합니다. 남은 질문 {live.remaining}회.</p>
      <div className="sg-live-row"><input aria-label="AI에게 할 질문" maxLength={500} value={question} placeholder="예: 2023년 7월 일 최고기온의 평균은 몇 ℃인가요?" onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void askAndVerify(); }}/>
        <button type="button" className="sg-primary" disabled={asking || busy || live.remaining <= 0} aria-busy={asking} onClick={() => void askAndVerify()}>{asking ? 'AI 답변 기다리는 중…' : '질문하고 검증'}</button></div>
    </fieldset>}
    <label className="sg-answer-input">2. AI 답변{askedModel && <span className="sg-badge"> {askedModel}가 방금 작성한 답변</span>}<textarea value={answer} maxLength={6000} rows={6} placeholder="예: 2023년 강수량 합계는 1,000mm입니다." onChange={e => { setAskedModel(''); change(() => setAnswer(e.target.value)); }}/></label>
    <div className="sg-answer-actions">
      {example && <button type="button" className="sg-secondary" onClick={() => change(() => { setUnits({ ...example.units }); setAnswer(example.answer); })}>예시 답변 넣기</button>}
      <span className="sg-hint">{answer.length.toLocaleString('ko-KR')} / 6,000자</span>
      <button type="button" className="sg-primary" disabled={busy} aria-busy={busy} onClick={() => void run()}>{busy ? '검증 중…' : '답변 검증'}</button>
    </div>
    <p className="sg-hint">검증 단계에서는 답변 문장과 CSV를 계산 엔진에만 전달하며 GPT로 보내지 않습니다. 규칙 기반 추출기({STATGUARD_VERSION})가 합계·평균·증감률·비율·값 조회와 표준편차·분산·중앙값·최댓값·최솟값·상관계수·t-검정(유의성·p값) 주장을 인식합니다.</p>
    {error && <p className="sg-error" role="alert">{error}</p>}
    {result && <section ref={output} tabIndex={-1} className="sg-answer-result" aria-label="답변 검증 결과">
      <div className="sg-summary">{STATUSES.map(s => <div key={s} className={'sg-summary-' + s.toLowerCase().replace('_', '-')}><strong>{result.summary[s]}</strong><span>{STATUS_LABEL[s]}</span></div>)}</div>
      {!result.claims.length && <p className="sg-hint">답변에서 검증할 수치 주장을 찾지 못했습니다. 숫자와 단위, 열 이름이 들어간 문장인지 확인해 주세요.</p>}
      {!!result.claims.length && <ReadBack answer={answer} claims={result.claims}/>}
      {result.claims.map(c => <ClaimCard key={c.claim_id} claim={c} table={table}/>)}
      <p className="sg-hint">‘계산 일치’는 연결된 계산 하나가 맞는다는 뜻이며, 답변 전체의 사실·인과관계·자료의 진실성을 보증하지 않습니다.</p>
    </section>}
  </section>;
}
