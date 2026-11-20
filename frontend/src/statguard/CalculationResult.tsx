import { useState } from 'react';
import type { CsvTable } from './csv';
import type { CalculationRequest, EngineResult, Usage } from './calculationClient';
import ManualComparison from './ManualComparison';

export function UsedRows({table,usage,title}:{table:CsvTable;usage:Usage;title:string}) {
  const [kind,setKind]=useState<'used'|'omitted'>('used'),[page,setPage]=useState(0);
  const rows=kind==='used'?usage.used_rows:usage.omitted_rows, start=page*20, pages=Math.max(1,Math.ceil(rows.length/20));
  return <section className="sg-used-rows" aria-label={title+' 사용 근거'}><h3>{title}</h3>
    <p className="sg-hint">선택 {usage.selected_rows.length}행 · 실제 사용 {usage.used_rows.length}행 · 빈 값 제외 {usage.omitted_rows.length}행 · 조건 밖 {usage.filtered_out_count}행</p>
    <div className="sg-result-tabs" aria-label={title+' 행 보기'}><button aria-pressed={kind==='used'} onClick={()=>{setKind('used');setPage(0);}}>사용한 행 ({usage.used_rows.length})</button><button aria-pressed={kind==='omitted'} onClick={()=>{setKind('omitted');setPage(0);}}>제외된 빈 값 행 ({usage.omitted_rows.length})</button></div>
    {!rows.length?<p className="sg-hint">해당하는 행이 없습니다.</p>:<><div className="sg-table-scroll" tabIndex={0} role="region" aria-label={title+' '+(kind==='used'?'사용한 행':'제외된 빈 값 행')+' 표'}><table><caption>{title} · 원본 데이터 행 번호 · {start+1}–{Math.min(start+20,rows.length)} / {rows.length}행</caption><thead><tr><th scope="col">원본 행</th>{table.columns.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(start,start+20).map(index=><tr key={index}><th scope="row">{index}</th>{table.rows[index-1].map((value,i)=><td key={i}>{value===''?<span className="sg-muted">빈 값</span>:value}</td>)}</tr>)}</tbody></table></div>
    {pages>1&&<div className="sg-pagination"><button className="sg-secondary" disabled={!page} aria-label={title+' 이전 행'} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {pages} 페이지</span><button className="sg-secondary" disabled={page+1>=pages} aria-label={title+' 다음 행'} onClick={()=>setPage(p=>p+1)}>다음</button></div>}</>}
  </section>;
}
export default function CalculationResult({result,table,calculation}:{result:EngineResult;table:CsvTable;calculation?:CalculationRequest|null}) {
  return <section id="sg-calculated" className="sg-card sg-calculated" aria-label="계산 결과와 사용 근거" tabIndex={-1}>
    <div className="sg-card-heading"><div><h2>계산 결과</h2></div><span className="sg-badge">기존 계산 엔진 실행 완료</span></div>
    <p className="sg-result-value"><strong>{result.value}</strong><span>{result.unit}</span></p>
    <p className="sg-hint">입력한 자료와 명시한 조건 안의 계산 결과입니다. 단위는 사용자가 지정했으며 자료의 사실성·인과관계를 검증한 결과가 아닙니다.</p>
    <div className="sg-formula"><span>실제 계산식</span><p className="sg-actual-expression">{result.expression}</p></div>
    {!!result.warnings.length&&<p className="sg-checks">확인한 제외 정책에 따라 빈 숫자 행을 계산에서 제외했습니다. 아래의 제외된 행을 확인하세요.</p>}
    {calculation&&<ManualComparison calculation={calculation} result={result}/>}
    <UsedRows table={table} usage={result.usage} title="선택 범위"/>
    {result.reference_usage&&<UsedRows table={table} usage={result.reference_usage} title="기준 범위"/>}
    <p className="sg-hint">행 번호는 열 이름을 제외한 CSV 데이터 순서입니다. 따옴표 안에 개행이 있어도 하나의 데이터 행으로 셉니다.</p>
    <details className="sg-result-identifiers"><summary>데이터·계산 식별 정보</summary><dl><dt>데이터 버전</dt><dd>{result.dataset_version}</dd><dt>계산 ID</dt><dd>{result.calculation_id}</dd><dt>원본 SHA-256</dt><dd>{result.source_sha256}</dd><dt>정밀도·반올림</dt><dd>유효숫자 {result.precision}자리 · {result.rounding}</dd></dl></details>
  </section>;
}
