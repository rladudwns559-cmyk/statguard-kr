import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { api, ApiError, parseRuns, parseDecisions } from '../api/client';
import { RunList } from '../pages/RunList';
import { RunDetail } from '../pages/RunDetail';
import { DecisionBadge, EvidenceBadge, JsonPreview } from '../components/ui';
import { EventTimeline, DecisionTimeline } from '../components/Timelines';
import { InterventionCards, ProviderPanel } from '../components/Interventions';
import { run, bundle, decision } from './fixtures';

describe('Run screens',()=>{
  it('renders recorded runs from the API',async()=>{vi.spyOn(api,'runs').mockResolvedValue([run]);render(<RunList/>);expect(await screen.findByRole('link',{name:'검색 복구 확인'})).toHaveAttribute('href','/runs/run-test-01');expect(screen.getByText('tool-agent')).toBeVisible();});
  it('renders a truthful empty state without inserting fixtures',async()=>{vi.spyOn(api,'runs').mockResolvedValue([]);render(<RunList/>);expect(await screen.findByText('아직 기록된 Agent 실행이 없습니다')).toBeVisible();expect(screen.getByText(/대시보드는 데이터를 자동으로 생성하지 않습니다/)).toBeVisible();});
  it('handles backend unavailable',async()=>{vi.spyOn(api,'runs').mockRejectedValue(new ApiError('unavailable','로컬 API 연결 실패'));render(<RunList/>);expect(await screen.findByRole('alert')).toHaveTextContent('백엔드에 연결할 수 없습니다');expect(screen.getByRole('button',{name:'다시 시도'})).toBeEnabled();});
  it('has a loading state',()=>{vi.spyOn(api,'runs').mockReturnValue(new Promise(()=>{}));render(<RunList/>);expect(screen.getByRole('status')).toHaveAccessibleName('불러오는 중');});
  it('handles detail API error without a blank page',async()=>{vi.spyOn(api,'bundle').mockRejectedValue(new ApiError('not-found','요청한 실행 기록을 찾을 수 없습니다.'));render(<RunDetail id="missing"/>);expect(await screen.findByRole('alert')).toHaveTextContent('실행 기록을 찾을 수 없습니다');expect(screen.getByRole('link',{name:'실행 목록'})).toBeVisible();});
  it('shows real detail sections and recommendation semantics',async()=>{vi.spyOn(api,'bundle').mockResolvedValue(bundle);render(<RunDetail id="run-test-01"/>);expect(await screen.findByText('개입을 추천했습니다')).toBeVisible();expect(screen.getByRole('heading',{name:/실행 타임라인/})).toBeVisible();expect(screen.getByRole('heading',{name:/관찰된 근거/})).toBeVisible();expect(screen.getAllByText(/추천이며 실행 완료/).length).toBeGreaterThan(0);expect(screen.queryByText('Executed')).not.toBeInTheDocument();});
  it('filters runs on the client',async()=>{vi.spyOn(api,'runs').mockResolvedValue([run]);render(<RunList/>);await screen.findByRole('link',{name:'검색 복구 확인'});await userEvent.selectOptions(screen.getByLabelText('결정 필터'),'REVIEW');expect(screen.getByText('검색 조건에 맞는 실행이 없습니다')).toBeVisible();});
  it('handles malformed or partial response',async()=>{vi.spyOn(api,'runs').mockImplementation(async()=>parseRuns({runs:[{run_id:'partial'}]}));render(<RunList/>);expect(await screen.findByRole('alert')).toHaveTextContent('응답이 누락되었거나 형식이 올바르지 않습니다');});
});
describe('Status and detail components',()=>{
  it.each(['CONTINUE','REVIEW','INTERVENE'] as const)('renders %s as text and a symbol',value=>{render(<DecisionBadge value={value}/>);expect(screen.getByText(value)).toBeVisible();});
  it.each(['NONE','WEAK','STRONG','CRITICAL'] as const)('renders %s evidence',value=>{render(<EvidenceBadge value={value}/>);expect(screen.getByText(value)).toBeVisible();});
  it('orders events and links results to calls',()=>{const {container}=render(<EventTimeline events={[...bundle.events].reverse()}/>);expect([...container.querySelectorAll('.event-rail')].map(e=>e.textContent)).toEqual(['00','01','02']);expect(screen.getByRole('link',{name:'call-1'})).toHaveAttribute('href','#event-call-1');});
  it('orders decision history by decision boundary',()=>{const later={...decision,backend_decision_id:'later',decision_record:{...decision.decision_record,decision_event_index:5}};const {container}=render(<DecisionTimeline decisions={[later,decision]} active={null} onSelect={()=>{}}/>);expect([...container.querySelectorAll('.decision-timeline>li')].map(e=>e.textContent)).toEqual([expect.stringContaining('#3'),expect.stringContaining('#5')]);});
  it('labels scores as experimental/reference and preserves warnings',()=>{render(<ProviderPanel decision={decision}/>);expect(screen.getByText('SCOPE_TYPE_CONFOUNDING')).toBeVisible();expect(screen.getByText('약한 실패 위험 참고 점수')).toBeVisible();expect(screen.getByText(/실험적 회복 점수/)).toBeVisible();expect(screen.getByText('0.82')).toBeVisible();expect(screen.queryByText('82%')).not.toBeInTheDocument();});
  it('marks selected candidate as a recommendation',()=>{render(<InterventionCards decision={decision}/>);expect(screen.getByText('↗ 추천 후보')).toBeVisible();expect(screen.getByText(/추천 기록이며 실행 완료를 뜻하지 않습니다/)).toBeVisible();});
  it('expands raw JSON on request',async()=>{const {container}=render(<JsonPreview label="인자" value={{nested:{query:'example'}}}/>);const details=container.querySelector('details')!;expect(details.open).toBe(false);await userEvent.click(screen.getByText('펼치기'));expect(details.open).toBe(true);expect(container.querySelector('pre')).toHaveTextContent('nested');});
  it('rejects offline fields rather than expecting them in UI types',()=>{expect(()=>parseRuns({runs:[{...run,reward:1}]})).toThrow(ApiError);expect(()=>parseDecisions({decisions:[{...decision,repaired_outcome:'success'}]})).toThrow(ApiError);});
});
