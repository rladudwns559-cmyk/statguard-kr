import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DeleteData } from '../auth/DeleteData';
import { apiRequest, setTokenProvider } from '../api/cloudClient';
import { JsonPreview } from '../components/ui';
import { Privacy, Security } from '../public/PolicyPages';

beforeEach(()=>{
  setTokenProvider(async()=>'synthetic-jwt');
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new Event('close'));};
});
afterEach(()=>{setTokenProvider(null);vi.useRealTimers();});

describe('release hardening',()=>{
  it('requires typed confirmation and does not delete on cancel',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'));
    const deleted=vi.fn();const user=userEvent.setup();
    render(<DeleteData projectId="p1" projectName="내 프로젝트" onProjectDeleted={deleted} onAccountDeleted={async()=>{}}/>);
    await user.click(screen.getByRole('button',{name:'현재 프로젝트 삭제'}));
    expect(screen.getByRole('button',{name:'영구 삭제 확인'})).toBeDisabled();
    await user.click(screen.getByRole('button',{name:'취소'}));expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'현재 프로젝트 삭제'}));
    await user.type(screen.getByRole('textbox'),'내 프로젝트');
    await user.click(screen.getByRole('button',{name:'영구 삭제 확인'}));
    await waitFor(()=>expect(deleted).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({confirmation:'내 프로젝트'}));
  });
  it('shows pending deletion without pretending success',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({error:{code:'DELETION_PENDING'}}),{status:503}));
    const deleted=vi.fn();const user=userEvent.setup();
    render(<DeleteData projectId="p1" projectName="one" onProjectDeleted={()=>{}} onAccountDeleted={deleted}/>);
    await user.click(screen.getByRole('button',{name:'내 계정 삭제'}));await user.type(screen.getByRole('textbox'),'DELETE');
    await user.click(screen.getByRole('button',{name:'영구 삭제 확인'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제가 대기 중');expect(deleted).not.toHaveBeenCalled();
  });
  it.each(['<script>alert(1)</script>','<img src=x onerror=alert(1)>','javascript:alert(1)','<svg onload=alert(1)>','&lt;script&gt;'])('escapes hostile JSON: %s',payload=>{
    const {container}=render(<JsonPreview label="외부 기록" value={{arguments:payload,observation:payload,metadata:payload}}/>);
    expect(container.querySelector('script,img,svg,a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toContain(payload);
  });
  it('displays safe request ID and rate-limit guidance',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:429,headers:{'X-Request-ID':'a'.repeat(32)}}));
    await expect(apiRequest('/api/v1/projects')).rejects.toThrow('1분 뒤');
  });
  it('bounds a hanging auth/token lookup',async()=>{
    vi.useFakeTimers();setTokenProvider(()=>new Promise(()=>{}));
    const pending=expect(apiRequest('/api/v1/projects')).rejects.toThrow('연결이 지연');
    await vi.advanceTimersByTimeAsync(20001);await pending;
  });
  it('renders privacy and security without certification claims',()=>{
    const page=render(<Privacy/>);expect(screen.getByRole('heading',{name:'보내는 데이터와 삭제'})).toBeVisible();page.unmount();
    render(<Security/>);expect(screen.getByRole('heading',{name:'보안 경계와 사용 범위'})).toBeVisible();
  });
});
