import { render,screen,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,it,expect } from 'vitest';
import { SignalScene } from '../public/SignalScene';
import { ProductLoop,ArchitectureMap,LiveDemoPreview } from '../public/LandingSections';

describe('visual interactions preserve honest observable scope',()=>{
  it('concept scene switches by keyboard without presenting itself as live data',async()=>{
    const user=userEvent.setup();render(<SignalScene/>);
    const target=screen.getByRole('button',{name:'DECIDE'});target.focus();await user.keyboard('{Enter}');
    expect(target).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('Agent가 검토할 개입 추천을 반환합니다.')).toBeVisible();
    expect(screen.getByText(/CONCEPT VIEW/)).toBeVisible();
  });
  it('product flow has one selected step and keyboard-accessible controls',async()=>{
    const user=userEvent.setup();render(<ProductLoop/>);
    await user.click(screen.getByRole('button',{name:'이후 결과를 확인'}));
    expect(screen.getAllByRole('button',{pressed:true})).toHaveLength(1);
    expect(screen.getByRole('button',{name:'이후 결과를 확인'})).toHaveAttribute('aria-pressed','true');
  });
  it('architecture exposes descriptions on click and retains public endpoint limitation',async()=>{
    const user=userEvent.setup();render(<ArchitectureMap/>);
    await user.click(screen.getByRole('button',{name:/Verification/}));
    expect(screen.getByText(/별도로 기록된 실행과 검증 상태/)).toBeVisible();
    expect(screen.getByText(/공개 API는 telemetry와 decision/)).toBeVisible();
  });
  it('demo preview distinguishes recommendation and recorded verification',async()=>{
    const user=userEvent.setup();const {container}=render(<LiveDemoPreview/>);
    await user.click(screen.getByRole('button',{name:/03 DECISION/}));
    expect(within(container.querySelector('.preview-inspector') as HTMLElement).getByText('다음 행동을 click으로 바꾸도록 추천')).toBeVisible();
    await user.click(screen.getByRole('button',{name:/04 VERIFICATION/}));
    expect(screen.getByText('통제된 로컬 실행의 검증 결과')).toBeVisible();
    expect(screen.getByText(/실시간 cloud 실행이 아닌/)).toBeVisible();
  });
});
