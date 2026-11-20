import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { reducedMotion } from './navigation';

/** NOAA NCEI GSOM, Seattle-Tacoma (USW00024233), 2023 monthly precipitation in mm — the same file as the demo preset. */
const RAIN = [78.5, 60.1, 65.3, 98.1, 23.8, 31.0, 2.3, 6.8, 87.3, 73.3, 147.0, 215.4];
const TOTAL = RAIN.reduce((a, b) => a + b, 0); // 888.9
const SIZE = 44, GAP = 12, MAX_H = 168;

/**
 * Real data as an isometric block (rows = quarters, columns = months), a real model sentence, and the recount stamp.
 * The block turns slowly on its own, leans toward the pointer, and reads out the month under the pointer.
 */
export default function RecountScene() {
  const scene = useRef<HTMLElement>(null), [month, setMonth] = useState<number | null>(null);
  function lean(event: PointerEvent<HTMLElement>) {
    const el = scene.current; if (!el || event.pointerType === 'touch' || reducedMotion()) return;
    const r = el.getBoundingClientRect(), x = (event.clientX - r.left) / r.width - 0.5, y = (event.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--lean-x', `${(-y * 14).toFixed(2)}deg`); el.style.setProperty('--lean-z', `${(x * 22).toFixed(2)}deg`);
  }
  function settle() { scene.current?.style.removeProperty('--lean-x'); scene.current?.style.removeProperty('--lean-z'); setMonth(null); }
  return <figure ref={scene} className="sg-scene" onPointerMove={lean} onPointerLeave={settle} aria-label={`시애틀 2023년 월별 강수량 12개를 쌓은 그림. AI는 연간 합계를 888.4mm라고 했지만 다시 계산하면 ${TOTAL.toFixed(1)}mm입니다.`}>
    <div className="sg-iso" aria-hidden="true">
      <div className="sg-iso-floor"/>
      {RAIN.map((v, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const style = { '--x': `${col * (SIZE + GAP) - 106}px`, '--y': `${row * (SIZE + GAP) - 78}px`, '--h': `${Math.max(4, (v / 215.4) * MAX_H)}px`, '--i': i } as CSSProperties;
        return <div key={i} className={'sg-bar' + (month === i ? ' is-on' : '')} style={style} onPointerEnter={() => setMonth(i)}><i className="t"/><i className="f"/><i className="s"/></div>;
      })}
    </div>
    <div className="sg-hud" aria-hidden="true">{month === null
      ? <><small>12개월 다시 합산</small><b>{TOTAL.toFixed(1)}mm</b></>
      : <><small>2023년 {month + 1}월</small><b>{RAIN[month].toFixed(1)}mm</b></>}</div>
    <div className="sg-quote"><small>gpt-6-luna의 실제 답변</small><p>2023년 시애틀의 일별 강수량을 모두 합한 연간 강수량은 <mark>888.4mm</mark>입니다.</p></div>
    <div className="sg-stamp" aria-hidden="true"><strong>계산 불일치</strong><span>다시 계산하면 <b>{TOTAL.toFixed(1)}mm</b></span><span>답변과 차이 {(TOTAL - 888.4).toFixed(1)}mm</span></div>
    <figcaption className="sg-scene-label" style={{ left: 0, bottom: 0 }}>막대 높이 = 시애틀 2023년 월별 강수량(NOAA) · 막대를 가리키면 그 달의 값이 보입니다</figcaption>
  </figure>;
}
