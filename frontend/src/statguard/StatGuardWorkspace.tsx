import { useEffect, useMemo, useRef, useState } from 'react';
import { ArithmeticOnly } from './ArithmeticCheck';
import { STATGUARD_VERSION, SITE_NAME, StatGuardHeader, usePageTitle } from './StatGuardChrome';
import { LEAVE_EVENT, withTransition } from './navigation';
import { CsvError, decodeCsv, LIMITS, type CsvTable, type Encoding } from './csv';
import { calculationSpec, emptyDraft, inspectConditions, OPERATIONS, type Draft, type Filter } from './conditions';
import { base64Bytes, calculateLocal, cloudCalculation, CalculationError, localCalculationAvailable, previewHash, type EngineResult, type CalculationRequest } from './calculationClient';
import CalculationResult from './CalculationResult';
import AnswerVerification from './AnswerVerification';
import { PRESETS, type SamplePreset } from './samples';
import './statguard.css';
import './statguard-theme.css';

type Loaded = CsvTable & { name: string; bytes: number; sha256: string; sample: boolean; rawBytes: ArrayBuffer; previewSha256: string; preset?: SamplePreset };
export const SAMPLE = '지역,연도,방문자수,체류시간\nA,2023,1000,10\nA,2024,1178,12\nB,2023,800,8\nB,2024,960,9\nC,2023,500,5\nC,2024,500,6\n';
function readBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error());
    reader.onerror = () => reject(new Error()); reader.onabort = () => reject(new Error()); reader.readAsArrayBuffer(file);
  });
}
function FilterEditor({ title, table, filters, change }: { title: string; table: CsvTable; filters: Filter[]; change: (f: Filter[]) => void }) {
  return <fieldset className="sg-filter"><legend>{title}</legend>
    {!filters.length && <p className="sg-muted">{title === '선택 범위' ? '전체 행을 사용합니다.' : '비교할 기준 조건을 추가하세요.'}</p>}
    {filters.map((f, i) => <div className="sg-filter-row" key={i}>
      <label>{title} {i + 1} 열<select value={f.column} onChange={e => change(filters.map((v, j) => j === i ? { column: e.target.value, value: '' } : v))}><option value="">열 선택</option>{table.columns.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>{title} {i + 1} 값<input maxLength={512} value={f.value} placeholder="예: 2024" list={`sg-${title}-${i}`} disabled={!f.column} onChange={e => change(filters.map((v, j) => j === i ? { ...v, value: e.target.value } : v))}/><datalist id={`sg-${title}-${i}`}>{[...new Set(table.rows.map(r => r[table.columns.indexOf(f.column)] ?? ''))].slice(0, 200).map(v => <option value={v} key={v}/>)}</datalist></label>
      <button type="button" className="sg-text-button" aria-label={`${title} ${i + 1} 삭제`} onClick={() => change(filters.filter((_, j) => i !== j))}>삭제</button>
    </div>)}
    {filters.length < 4 && <button type="button" className="sg-add" onClick={() => change([...filters, { column: '', value: '' }])}>+ {title} 조건 추가</button>}
    <p className="sg-hint">모든 조건을 동시에 만족하는 행 · 대소문자·공백·앞자리 0을 그대로 비교 · 빈 값 입력은 빈 셀 선택</p>
  </fieldset>;
}

/** initialMode lets a link or test open the direct-calculation tab; the default is AI answer verification. */
export default function StatGuardWorkspace({ initialMode = 'answer' }: { initialMode?: 'answer' | 'calculate' } = {}) {
  const [table, setTable] = useState<Loaded | null>(null), [draft, setDraft] = useState<Draft>(emptyDraft);
  const [encoding, setEncoding] = useState<Encoding>('auto'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null), [computing, setComputing] = useState(false), [calculationError, setCalculationError] = useState('');
  const [calculationSnapshot, setCalculationSnapshot] = useState<CalculationRequest | null>(null);
  const [mode, setMode] = useState<'answer' | 'calculate'>(initialMode);
  const [verified, setVerified] = useState(false);
  usePageTitle(`검증하기 · ${SITE_NAME}`);
  const calcGeneration = useRef(0), calcAbort = useRef<AbortController | null>(null);
  const generation = useRef(0), fileInput = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLElement>(null);
  const inspection = useMemo(() => table ? inspectConditions(table, draft) : null, [table, draft]);
  useEffect(() => () => { generation.current++; calcGeneration.current++; calcAbort.current?.abort(); }, []);
  useEffect(() => { if (result) document.getElementById('sg-calculated')?.focus(); }, [result]);
  useEffect(() => {
    if (!table) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const stay = (event: Event) => event.preventDefault();
    window.addEventListener('beforeunload', warn); window.addEventListener(LEAVE_EVENT, stay);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener(LEAVE_EVENT, stay); };
  }, [table]);
  function invalidateCalculation() { calcGeneration.current++; calcAbort.current?.abort(); calcAbort.current = null; setResult(null); setCalculationSnapshot(null); setComputing(false); setCalculationError(''); }
  function reset() { setVerified(false); invalidateCalculation(); generation.current++; setTable(null); setDraft(emptyDraft()); setAgreed(false); setConfirmed(false); setBusy(false); setError(''); if (fileInput.current) fileInput.current.value = ''; }
  function update(next: Draft) { invalidateCalculation(); setDraft(next); setAgreed(false); setConfirmed(false); }
  async function loadPreset(id: string) {
    const preset = PRESETS.find(p => p.id === id); if (!preset) return;
    setError('');
    try {
      const response = await fetch('/statguard-samples/' + preset.file, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error();
      await load(new File([await response.arrayBuffer()], preset.name, { type: 'text/csv' }), false, preset);
      setMode('answer');
    } catch { setError('예시 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); }
  }
  async function load(file: File, sample = false, preset?: SamplePreset) {
    if (fileInput.current) fileInput.current.value = '';
    invalidateCalculation(); const run = ++generation.current; setTable(null); setDraft(emptyDraft()); setAgreed(false); setConfirmed(false); setError(''); setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new CsvError('CSV 파일 한 개를 선택해 주세요. Excel 파일은 CSV로 저장한 뒤 선택하세요.');
      if (file.size > LIMITS.bytes) throw new CsvError('파일은 최대 1 MiB까지 지원합니다.');
      const bytes = await readBytes(file), parsed = decodeCsv(bytes, encoding);
      const [digest, previewSha256] = await Promise.all([crypto.subtle.digest('SHA-256', bytes), previewHash(parsed)]);
      if (generation.current !== run) return;
      setTable({ ...parsed, name: file.name, bytes: file.size, rawBytes: bytes, previewSha256, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''), sample, preset });
    } catch (e) { if (generation.current === run) setError(e instanceof CsvError ? e.message : '파일을 읽지 못했습니다. 파일을 다시 선택하거나 최신 브라우저에서 열어 주세요.'); }
    finally { if (generation.current === run) setBusy(false); }
  }
  function confirm() { if (!inspection || inspection.issues.length || !agreed) return; setConfirmed(true); requestAnimationFrame(() => confirmation.current?.focus()); }
  async function runCalculation() {
    if (!table || !confirmed || !agreed || inspection?.issues.length || calcAbort.current) return;
    const epoch = ++calcGeneration.current, controller = new AbortController(); calcAbort.current = controller;
    setComputing(true); setCalculationError(''); setResult(null); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    try {
      const request: CalculationRequest = { mode: 'calculate', request_id: crypto.randomUUID(), csv_base64: base64Bytes(table.rawBytes), source_sha256: table.sha256, preview_sha256: table.previewSha256, encoding: table.encoding === 'UTF-8' ? 'utf-8-sig' : 'cp949', units: { [draft.column]: draft.unit }, spec: calculationSpec(draft) };
      const next = await calculateLocal(request, table.rows.length, controller.signal);
      if (calcGeneration.current === epoch && !controller.signal.aborted) { setResult(next); setCalculationSnapshot(request); }
    } catch (e) {
      if (calcGeneration.current === epoch) setCalculationError(timedOut ? '계산 시간이 초과되었습니다. 자동으로 다시 실행하지 않았습니다.' : e instanceof CalculationError ? e.message : (cloudCalculation() ? '계산 서버에 연결하지 못했습니다. 잠시 뒤 직접 다시 시도해 주세요.' : '로컬 계산 엔진에 연결하지 못했습니다. 실행기를 확인한 뒤 직접 다시 시도해 주세요.'));
    } finally {
      clearTimeout(timer); if (calcAbort.current === controller) calcAbort.current = null;
      if (calcGeneration.current === epoch) setComputing(false);
    }
  }
  const enabled = !!inspection && !inspection.issues.length && agreed && !busy;
  return <div className="sg-shell">
    <StatGuardHeader current="workspace" extra={<span className="sg-local-chip">{cloudCalculation()?"온라인 계산":"내 PC 계산"}</span>}/>
    <main className="sg-main"><div className="sg-intro"><div><h1>AI가 말한 숫자, CSV로 다시 계산해 확인하세요.</h1><p>CSV를 고르고 AI 답변을 붙여 넣으면 숫자 주장을 다시 계산해 일치·불일치·보류로 판정합니다. 직접 계산과 수치 비교도 할 수 있습니다.</p></div></div>
      <ol className="sg-steps" aria-label="작업 단계"><li aria-current={!table ? 'step' : undefined}><b>01</b> CSV 선택 {table && <span>완료</span>}</li><li aria-current={table && !(mode === 'answer' ? verified : result) ? 'step' : undefined}><b>02</b> {mode === 'answer' ? 'AI 답변·단위 입력' : '미리보기·조건 확인'}</li><li aria-current={(mode === 'answer' ? verified : result) ? 'step' : undefined}><b>03</b> 판정·근거 확인 {(mode === 'answer' ? verified : result) && <span>완료</span>}</li></ol>
      <div className="sg-privacy"><span aria-hidden="true">▣</span><p><strong>{cloudCalculation()?"검증·계산할 때 CSV가 계산 서버로 전송됩니다.":"CSV는 이 PC에서만 처리합니다."}</strong> {cloudCalculation()?"Vercel 서버 메모리에서 계산하며 파일·DB에 보관하지 않습니다. 검증과 계산에는 GPT를 쓰지 않습니다(시연 비밀번호로 ‘AI에게 직접 질문’을 쓸 때만 질문과 CSV가 OpenAI로 전송). 민감한 개인정보는 올리지 마세요.":"검증·계산은 이 PC의 계산 엔진에서만 하며 파일로 저장하지 않습니다. 검증과 계산에는 GPT를 쓰지 않습니다(시연용 ‘AI에게 직접 질문’을 누를 때만 질문과 CSV가 OpenAI로 전송)."} 새로고침·페이지 이동 시 입력이 사라집니다.</p></div>
      <section className="sg-card sg-upload" aria-labelledby="upload-heading"><div><h2 id="upload-heading">CSV 업로드</h2><p>파일 한 개 · 최대 1 MiB · 10,000행 · 64열 · UTF-8 / CP949 호환</p></div><div className="sg-upload-controls"><label className="sg-file-label">CSV 파일 선택<input ref={fileInput} type="file" accept=".csv,text/csv" aria-label="CSV 파일 선택" disabled={busy} onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void load(file); }}/></label><label>문자 인코딩<select value={encoding} disabled={busy} onChange={e => { reset(); setEncoding(e.target.value as Encoding); }}><option value="auto">자동 감지</option><option value="utf-8">UTF-8</option><option value="euc-kr">CP949 호환</option></select></label><button className="sg-secondary" disabled={busy} onClick={() => void load(new File([SAMPLE], '방문자_합성예제.csv', { type: 'text/csv' }), true)}>예제 CSV로 시작</button><label className="sg-preset">실제 공개 자료 예시<select value="" disabled={busy} onChange={e => void loadPreset(e.target.value)}><option value="">선택해서 바로 체험</option>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>{table && <button className="sg-text-button" onClick={reset}>자료 비우기</button>}</div>
        {table && <p className="sg-current-file" aria-live="polite">{'현재 자료: ' + table.name}</p>}
        {busy && <p role="status">파일을 읽는 중…</p>}{error && <p role="alert" className="sg-error">{error}</p>}
      </section>
      {!table && !busy && <section className="sg-empty"><div aria-hidden="true">▤</div><h2>CSV 하나로 시작하세요.</h2><p>파일을 고르거나 ‘실제 공개 자료 예시’를 선택하면 AI 답변 검증 화면이 열립니다.</p><p>AI 답변 검증: 합계·평균·증감률·비율·값 조회, 표준편차·분산·중앙값·최댓값·최솟값·상관계수·t-검정 주장을 판정합니다. 직접 계산: 합계·평균·증감률을 조건을 정해 계산합니다.</p></section>}
      {!table && !busy && <ArithmeticOnly/>}
      {table && <div className="sg-mode-tabs" role="tablist" aria-label="작업 방식"><button role="tab" aria-selected={mode === 'answer'} onClick={() => withTransition(() => setMode('answer'))}>AI 답변 검증</button><button role="tab" aria-selected={mode === 'calculate'} onClick={() => withTransition(() => setMode('calculate'))}>직접 계산·수치 비교</button></div>}
      {table && <div hidden={mode !== 'answer'}><AnswerVerification key={table.sha256 + table.name} table={table} onVerified={setVerified} active={mode === 'answer'}/></div>}
      {table && mode === 'calculate' && <p className="sg-hint sg-calc-note">직접 계산은 합계·평균·증감률을 지원합니다. 표준편차·상관계수·t-검정 같은 통계 주장은 ‘AI 답변 검증’ 탭에서 확인하세요.</p>}
      {table && <div hidden={mode !== 'calculate'} className={'sg-grid' + (result ? ' sg-has-result' : '')}><div className="sg-left"><section className="sg-card" aria-labelledby="preview-heading"><div className="sg-card-heading"><div><h2 id="preview-heading">자료 미리보기</h2></div>{table.sample && <span className="sg-badge">합성 예제 · 실측 자료 아님</span>}</div><p className="sg-filename">{table.name}</p><dl className="sg-data-meta"><div><dt>데이터 행</dt><dd>{table.rows.length.toLocaleString('ko-KR')}개</dd></div><div><dt>열</dt><dd>{table.columns.length}개</dd></div><div><dt>인코딩</dt><dd>{table.encoding}</dd></div><div><dt>크기</dt><dd>{table.bytes.toLocaleString('ko-KR')} bytes</dd></div></dl>
          <div className="sg-table-scroll" tabIndex={0} role="region" aria-label="CSV 미리보기 표 가로 스크롤"><table><caption>상위 {Math.min(table.rows.length, 10)}행 미리보기 · 조건 검사는 전체 {table.rows.length}행에 적용</caption><thead><tr><th scope="col">행</th>{table.columns.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(0, 10).map((r, i) => <tr key={i}><th scope="row">{i + 1}</th>{r.map((c, j) => <td key={j}>{c === '' ? <span className="sg-muted">빈 값</span> : c}</td>)}</tr>)}</tbody></table></div><p className="sg-hint">셀은 원문 그대로 표시합니다. 수식·HTML은 실행하지 않습니다. 행 번호는 열 이름을 제외한 데이터 순서입니다.</p><details><summary>원본 파일 식별 정보</summary><p className="sg-hash">SHA-256: {table.sha256}</p><p className="sg-hint">같은 원본 파일인지 구분하는 값입니다. 자료의 진실성이나 단위를 인증하지 않습니다.</p></details></section>
        <section className="sg-card" aria-labelledby="conditions-heading"><h2 id="conditions-heading">어떻게 계산할까요?</h2><div className="sg-fields"><label>계산 종류<select value={draft.operation} onChange={e => update({ ...draft, operation: e.target.value as Draft['operation'] })}>{Object.entries(OPERATIONS).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label><label>계산할 숫자 열<select value={draft.column} onChange={e => update({ ...draft, column: e.target.value })}><option value="">직접 선택해 주세요</option>{table.columns.map(c => <option key={c}>{c}</option>)}</select></label><label>열의 원래 단위<input maxLength={32} value={draft.unit} placeholder="예: 명, 원, 건" onChange={e => update({ ...draft, unit: e.target.value })}/></label><label>빈 숫자 값 처리<select value={draft.missing} onChange={e => update({ ...draft, missing: e.target.value as Draft['missing'] })}><option value="reject">빈 값이 있으면 중단</option><option value="omit">빈 값인 행을 명시적으로 제외</option></select></label></div><p className="sg-hint">단위는 자동 추정하지 않습니다. 자료의 설명을 확인해 직접 입력하세요. 빈 값 외의 잘못된 숫자는 제외하지 않고 중단합니다.</p>
          <FilterEditor title="선택 범위" table={table} filters={draft.filters} change={filters => update({ ...draft, filters })}/>{draft.operation === 'percent_change' && <FilterEditor title="기준 범위" table={table} filters={draft.reference} change={reference => update({ ...draft, reference })}/>}</section></div>
        <aside className="sg-right">{result && <CalculationResult key={result.calculation_id} result={result} table={table} calculation={calculationSnapshot}/>}<details className={'sg-review-details' + (result ? ' is-complete' : '')} open={!result}><summary hidden={!result}>사용한 계산 조건 다시 보기</summary><section className="sg-card sg-review" aria-labelledby="review-heading"><h2 id="review-heading">조건 확인</h2><dl className="sg-review-list"><div><dt>계산</dt><dd>{OPERATIONS[draft.operation]}</dd></div><div><dt>대상 열</dt><dd>{draft.column || '선택 전'}</dd></div><div><dt>입력 단위</dt><dd>{draft.unit.trim() || '확인 전'}{draft.operation === 'percent_change' && ' → 결과 단위 %'}</dd></div><div><dt>선택 조건</dt><dd>{draft.filters.length ? draft.filters.map(f => `${f.column || '열 미선택'} = ${f.value === '' ? '(빈 값)' : f.value}`).join(' 그리고 ') : '전체 행'}</dd></div>{draft.operation === 'percent_change' && <div><dt>기준 조건</dt><dd>{draft.reference.map(f => `${f.column || '열 미선택'} = ${f.value === '' ? '(빈 값)' : f.value}`).join(' 그리고 ') || '지정 전'}</dd></div>}</dl>
          <div className="sg-row-count"><strong>{inspection?.current.selected ?? 0}</strong><span>선택된 행 / 전체 {table.rows.length}행</span></div><p className="sg-hint">숫자 사용 가능 {inspection?.current.used ?? 0}행 · 빈 값 {inspection?.current.missing ?? 0}개 · 잘못된 숫자 {inspection?.current.invalid ?? 0}개</p>{inspection?.base && <p className="sg-hint">기준 범위 {inspection.base.selected}행 · 숫자 사용 가능 {inspection.base.used}행 · 빈 값 {inspection.base.missing}개 · 잘못된 숫자 {inspection.base.invalid}개</p>}
          <div className="sg-formula"><span>예정 계산식</span><p>{draft.operation === 'percent_change' ? '(선택 범위 합계 − 기준 범위 합계) ÷ 기준 범위 합계 × 100' : draft.operation === 'mean' ? '선택 범위의 숫자 합계 ÷ 사용한 숫자 행 수' : '선택 범위의 숫자 합계'}</p></div>
          {!!inspection?.issues.length && <div className="sg-checks" aria-label="확인이 필요한 조건"><strong>아래 조건을 확인해 주세요</strong><ul>{inspection.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
          {inspection && !inspection.issues.length && <p className="sg-ready" role="status">입력 조건 검사를 통과했습니다. 아래 내용을 확인해 주세요.</p>}
          <label className="sg-consent"><input type="checkbox" checked={agreed} disabled={!!inspection?.issues.length} onChange={e => { invalidateCalculation(); setAgreed(e.target.checked); setConfirmed(false); }}/><span>열·단위·선택 범위·빈 값 처리 방식이 의도와 일치함을 확인했습니다.</span></label><button className="sg-primary" disabled={!enabled || confirmed} onClick={confirm}>{confirmed ? '조건 확인 완료' : '이 조건으로 확인'}</button><p className="sg-hint">이 버튼은 조건만 확정합니다. 수치 계산·GPT 호출·자료 전송은 하지 않습니다.</p>
        </section></details>{confirmed && <section ref={confirmation} tabIndex={-1} className="sg-card sg-confirmed" aria-label="확정된 계산 조건"><span className="sg-badge">조건 확인 완료</span><h2>{result ? '계산이 완료됐습니다.' : '계산할 준비가 됐습니다.'}</h2><p>{result ? '확정한 조건으로 계산했습니다. 결과와 사용한 행을 확인하세요.' : '확정한 조건을 다음 계산 단계에 사용할 수 있습니다. 아직 계산 결과나 검증 판정은 생성하지 않았습니다.'}</p><p>조건을 바꾸면 확인과 결과가 해제됩니다.</p><button className="sg-primary" disabled={computing || !!result || !localCalculationAvailable()} aria-busy={computing} onClick={() => void runCalculation()}>{computing ? '계산 중…' : result ? '계산 완료' : '계산 실행'}</button>{computing && <p role="status">기존 계산 엔진이 원본 CSV와 조건을 다시 확인하고 있습니다.</p>}{calculationError && <p className="sg-error" role="alert">{calculationError}</p>}{!localCalculationAvailable() && <p className="sg-hint">계산은 StatGuard 로컬 실행기로 연 이 PC의 화면에서 사용할 수 있습니다.</p>}<details><summary>계산 조건 명세 보기</summary><pre>{JSON.stringify({ source_sha256: table.sha256, units: { [draft.column]: draft.unit }, spec: calculationSpec(draft) }, null, 2)}</pre></details></section>}</aside>
      </div>}
      <footer className="sg-footer">{SITE_NAME} {STATGUARD_VERSION} · 단위와 자료 의미는 사용자가 확인합니다. ‘계산 일치’는 연결된 계산이 맞다는 뜻이며 답변 전체의 사실·인과관계를 보증하지 않습니다. 회귀·추세·원인 해석은 판정하지 않습니다.</footer>
    </main>
  </div>;
}

