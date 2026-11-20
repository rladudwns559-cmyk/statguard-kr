import { useState } from 'react';
const signals=[['OBSERVE','행동과 결과를 연결합니다.'],['DETECT','실행 중 관찰된 오류 근거를 확인합니다.'],['DECIDE','Agent가 검토할 개입 추천을 반환합니다.']];
/** Illustrative geometry only; never presented as live customer telemetry. */
export function SignalScene(){
  const [active,setActive]=useState(1);
  return <div className="signal-scene" aria-label="Agent 실행 경로 개념 시각화">
    <div className="signal-orbit orbit-one"/><div className="signal-orbit orbit-two"/>
    <div className="scene-grid" aria-hidden="true"/>
    <div className="scene-caption"><span className="live-mark"/>TRAJECTORY / CONCEPT VIEW</div>
    <svg className="trajectory-svg" viewBox="0 0 600 460" fill="none" aria-hidden="true">
      <defs><linearGradient id="trajectory-color"><stop stopColor="#3886c8"/><stop offset=".55" stopColor="#64e4e8"/><stop offset="1" stopColor="#b9f6e8"/></linearGradient></defs>
      <path className="ghost-path" d="M35 330C150 330 100 230 210 230S300 325 405 325 470 170 570 170"/>
      <path className="main-path path-halo" d="M35 290C150 290 105 190 210 190S300 285 405 285 465 130 570 130"/>
      <path className="main-path" d="M35 290C150 290 105 190 210 190S300 285 405 285 465 130 570 130"/>
      <path className="signal-travel" d="M35 290C150 290 105 190 210 190S300 285 405 285 465 130 570 130"/>
      <path className="deviation-path" d="M292 220Q320 115 420 105"/>
      {[[120,244],[292,220],[472,209],[570,130]].map(([cx,cy],i)=><g key={cx}><circle cx={cx} cy={cy} r={i===1?22:16} className={i===1?'node-ring attention':'node-ring'}/><circle cx={cx} cy={cy} r="5" fill={i===1?'#eab56a':'#9df1eb'}/></g>)}
    </svg>
    <div className="scene-float scene-input"><span>01 / TELEMETRY</span><strong>Observe the path.</strong><code>action → observation</code></div>
    <div className="scene-float scene-inspector"><span><i/> RUNTIME SIGNAL</span><div className="signal-copy" key={active}><strong>{signals[active][0]}</strong><p>{signals[active][1]}</p></div><div className="signal-meter" aria-hidden="true">{[16,24,18,34,46,24,18,30,22,15,20,13].map((h,i)=><i key={i} style={{height:h}}/>)}</div></div>
    <div className="scene-end"><span/>A clearer next step</div>
    <div className="scene-controls" aria-label="개념 시각화 단계">{signals.map(([name],i)=><button key={name} aria-pressed={active===i} onClick={()=>setActive(i)}>{name}</button>)}</div>
  </div>;
}
