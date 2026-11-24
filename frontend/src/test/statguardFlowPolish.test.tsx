import {render,screen,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import StatGuardWorkspace from '../statguard/StatGuardWorkspace';
import {parseCsv} from '../statguard/csv';
import {emptyDraft,inspectConditions} from '../statguard/conditions';
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);window.history.replaceState(null,'','/statguard');});
afterEach(()=>vi.unstubAllGlobals());
const file=(text:string,name='수정본.csv')=>new File([text],name,{type:'text/csv'});
it('shows the actual current source and resets a stale native filename after sample selection',async()=>{
 render(<StatGuardWorkspace initialMode="calculate"/>);const picker=screen.getByLabelText('CSV·엑셀 파일 선택');await userEvent.upload(picker,file('항목,값\nA,10','매출.csv'));await screen.findByText('현재 자료: 매출.csv');
 expect(picker).toHaveValue('');await userEvent.click(screen.getByRole('button',{name:'예제 CSV로 시작'}));expect(await screen.findByText('현재 자료: 방문자_합성예제.csv')).toBeVisible();expect(picker).toHaveValue('');
});
it('allows the same upload filename again after a CSV-format error and clears the error',async()=>{
 render(<StatGuardWorkspace initialMode="calculate"/>);const picker=screen.getByLabelText('CSV·엑셀 파일 선택');await userEvent.upload(picker,file('값,값\n1,2'));expect(await screen.findByRole('alert')).toHaveTextContent('중복된 열 이름');expect(picker).toHaveValue('');
 await userEvent.upload(picker,file('값\n10'));expect(await screen.findByText('현재 자료: 수정본.csv')).toBeVisible();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('table')).toHaveTextContent('10');
});
it('locates an invalid number in an original data row outside the preview',async()=>{
 render(<StatGuardWorkspace initialMode="calculate"/>);await userEvent.upload(screen.getByLabelText('CSV·엑셀 파일 선택'),file('값\n'+'1\n'.repeat(10)+'11원'));
 await screen.findByRole('table');await userEvent.selectOptions(screen.getByLabelText('계산할 숫자 열'),'값');await userEvent.type(screen.getByLabelText('열의 원래 단위'),'원');
 expect(screen.getByLabelText('확인이 필요한 조건')).toHaveTextContent('해당 데이터 행: 11');expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(10);
});
it('locates missing values and requires explicit omission',()=>{
 const table=parseCsv('값\n1\n""\n2');const draft={...emptyDraft(),column:'값',unit:'원'};
 const inspection=inspectConditions(table,draft);expect(inspection.current.missingRows).toEqual([2]);expect(inspection.issues.join(' ')).toContain('해당 데이터 행: 2');expect(inspectConditions(table,{...draft,missing:'omit'}).issues).toEqual([]);
});
it('bounds the error locator while preserving full diagnostic row indices',()=>{
 const table=parseCsv('값\n'+'bad\n'.repeat(8));const inspection=inspectConditions(table,{...emptyDraft(),column:'값',unit:'원'});
 expect(inspection.current.invalidRows).toEqual([1,2,3,4,5,6,7,8]);expect(inspection.issues.join(' ')).toContain('1, 2, 3, 4, 5 외 3행');
});
it('collapses only completed-condition review and reopens it when a condition changes',async()=>{
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const p=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,bridge_version:'statguard-local-calculation-v0.1',request_id:p.request_id,preview_sha256:p.preview_sha256,result:{contract_version:'statguard-calculation-v0.1',dataset_id:'local-upload',dataset_version:'a'.repeat(64),source_sha256:p.source_sha256,calculation_id:'b'.repeat(64),spec:p.spec,value:'10',unit:'원',expression:'sum(값) = 10',groups:[],usage:{selected_rows:[1],used_rows:[1],omitted_rows:[],filtered_out_count:0},reference_usage:null,warnings:[],precision:34,rounding:'ROUND_HALF_EVEN',unit_provenance:'CALLER_ASSERTED_NOT_INFERRED'}}),{status:200});
 });
 render(<StatGuardWorkspace initialMode="calculate"/>);await userEvent.upload(screen.getByLabelText('CSV·엑셀 파일 선택'),file('값\n10'));await screen.findByRole('table');await userEvent.selectOptions(screen.getByLabelText('계산할 숫자 열'),'값');await userEvent.type(screen.getByLabelText('열의 원래 단위'),'원');await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'이 조건으로 확인'}));await userEvent.click(screen.getByRole('button',{name:'계산 실행'}));await screen.findByRole('region',{name:'계산 결과와 사용 근거'});
 expect(screen.getByText('사용한 계산 조건 다시 보기')).toBeVisible();expect(screen.getByRole('heading',{name:'조건 확인',hidden:true})).not.toBeVisible();expect(screen.getByRole('button',{name:'계산 완료'})).toBeDisabled();
 await userEvent.click(screen.getByText('사용한 계산 조건 다시 보기'));expect(screen.getByRole('heading',{name:'조건 확인'})).toBeVisible();
 fireEvent.change(screen.getByLabelText('열의 원래 단위'),{target:{value:'건'}});expect(screen.getByRole('heading',{name:'조건 확인'})).toBeVisible();expect(screen.queryByRole('region',{name:'계산 결과와 사용 근거'})).toBeNull();
});

