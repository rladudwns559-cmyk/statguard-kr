import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ProjectApiKeys } from '../auth/ProjectApiKeys';
import { setTokenProvider } from '../api/cloudClient';

const row={api_key_id:'public-id',name:'테스트 Agent',key_prefix:'w2w_beta_public-id',created_at:'2026-10-19',last_used_at:null,status:'active'};
const secret='w2w_beta_test_ONLY_SYNTHETIC_NOT_A_VALID_KEY';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
let rows:any[];
beforeEach(()=>{
  rows=[{...row}];setTokenProvider(async()=>'jwt-test');
  vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
    if(init?.method==='POST'){
      if(String(url).endsWith('/revoke')){rows=[{...row,status:'revoked'}];return json(rows[0]);}
      if(String(url).endsWith('/rotate')){rows=[{...row,status:'revoked'},{...row,api_key_id:'new-id'}];return json({...rows[1],api_key:secret},201);}
      rows.push({...row,api_key_id:'created'});return json({...rows[1],api_key:secret},201);
    }
    return json({api_keys:rows});
  });
});
afterEach(()=>setTokenProvider(null));

describe('project API keys',()=>{
  it('lists public fields without full secret',async()=>{
    render(<ProjectApiKeys projectId="p1"/>);expect(await screen.findByText(row.name)).toBeVisible();
    expect(screen.getByText(row.key_prefix)).toBeVisible();expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.getByText('사용 전')).toBeVisible();
  });
  it('creates and copies only ephemeral secret; never persists browser storage',async()=>{
    const user=userEvent.setup();const storage=vi.spyOn(Storage.prototype,'setItem');
    render(<ProjectApiKeys projectId="p1"/>);
    await user.type(screen.getByLabelText('API Key 이름'),'새 Agent');await user.click(screen.getByRole('button',{name:'API Key 생성'}));
    expect(await screen.findByLabelText('한 번만 표시되는 API Key')).toHaveTextContent(secret);
    expect(storage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'키 복사'}));
    expect(await screen.findByRole('button',{name:'복사됨'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'키 표시 닫기'}));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });
  it('refresh/remount cannot reveal a created secret',async()=>{
    const user=userEvent.setup();const view=render(<ProjectApiKeys projectId="p1"/>);
    await user.type(screen.getByLabelText('API Key 이름'),'새 Agent');await user.click(screen.getByRole('button',{name:'API Key 생성'}));
    await screen.findByText(secret);view.unmount();render(<ProjectApiKeys projectId="p1"/>);
    await screen.findAllByText(row.name);expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });
  it('revoke updates status and removes management controls',async()=>{
    const user=userEvent.setup();render(<ProjectApiKeys projectId="p1"/>);
    await user.click(await screen.findByRole('button',{name:'폐기'}));
    expect(await screen.findByText('폐기됨')).toBeVisible();expect(screen.queryByRole('button',{name:'폐기'})).not.toBeInTheDocument();
  });
  it('rotate shows new secret once and old row revoked',async()=>{
    const user=userEvent.setup();render(<ProjectApiKeys projectId="p1"/>);
    await user.click(await screen.findByRole('button',{name:'교체 · 기존 키 즉시 폐기'}));
    expect(await screen.findByText(secret)).toBeVisible();expect(await screen.findByText('폐기됨')).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/public-id/rotate'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer jwt-test'})}));
  });
  it('switching selected project discards previous secret',async()=>{
    const user=userEvent.setup();const view=render(<ProjectApiKeys key="p1" projectId="p1"/>);
    await user.type(screen.getByLabelText('API Key 이름'),'새 Agent');await user.click(screen.getByRole('button',{name:'API Key 생성'}));
    await screen.findByText(secret);
    view.rerender(<ProjectApiKeys key="p2" projectId="p2"/>);
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    await waitFor(()=>expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/p2/api-keys'),expect.anything()));
  });
  it('authorization failure does not display response internals',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(json({error:{secret}},403));
    render(<ProjectApiKeys projectId="p1"/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('목록을 불러오지 못했습니다');
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });
});
