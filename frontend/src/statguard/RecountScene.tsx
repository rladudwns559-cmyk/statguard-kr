import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { reducedMotion } from './navigation';
import Scene3D from './Scene3D';
import DataScene3D, { type DataMode } from './DataScene3D';

/** NOAA NCEI GSOM, Seattle-Tacoma (USW00024233), 2023 monthly precipitation in mm — the same file as the demo preset. */
const RAIN = [78.5, 60.1, 65.3, 98.1, 23.8, 31.0, 2.3, 6.8, 87.3, 73.3, 147.0, 215.4];
const TOTAL = RAIN.reduce((a, b) => a + b, 0); // 888.9
const SIZE = 44, GAP = 12, MAX_H = 168;

type Mode = 'bars' | DataMode;
const MODES: { id: Mode; label: string; caption: string }[] = [
  { id: 'bars', label: '막대', caption: '막대 높이 = 시애틀 2023년 월별 강수량(NOAA) · 막대를 가리키면 그 달의 값이 보이고, 주기적으로 12개월이 한 탑으로 쌓여 다시 합산됩니다' },
  { id: 'helix', label: '데이터 나선', caption: '점 하나 = 하루(시애틀 2023년 일별 강수량 365일, NOAA) · 초록 고리가 날짜 순으로 지나가며 다시 합산하고, 빨간 고리는 누적 합계가 AI의 답 888.4mm를 처음 넘어서는 날(12월 30일)입니다' },
  { id: 'sphere', label: '데이터 구체', caption: '점 하나 = 하루(365일) · 비가 많은 날일수록 바깥으로 튀어나옵니다 · 고리가 훑으며 다시 합산하고, 빨간 고리는 누적 합계가 888.4mm를 처음 넘어서는 날입니다' },
  { id: 'terrain', label: '강수량 지형', caption: '가로 12개월 × 세로 31일 · 봉우리 높이 = 그날 강수량(NOAA) · 레이저 평면이 날짜 순으로 훑으며 다시 합산합니다' },
  { id: 'cube', label: '유리 큐브', caption: '점 하나 = CSV의 한 행(365행) · 레이저가 층별로 행을 읽으며 다시 합산하고, 빨간 면은 누적 합계가 888.4mm를 처음 넘어서는 행입니다' },
];
const initialMode = (): Mode => {
  if (typeof window === 'undefined') return 'helix';
  const m = new URLSearchParams(window.location.search).get('scene');
  return MODES.some(x => x.id === m) ? (m as Mode) : 'helix';
};

/**
 * Real data as a 3D model (WebGL; default: the 365-day data helix) with the real model sentence and the recount stamp.
 * Without WebGL (and in tests) the CSS isometric block of monthly bars is shown. `?compare` shows a switcher between
 * the candidate models; `?scene=` picks one.
 */
export default function RecountScene({ bare = false }: { bare?: boolean } = {}) {
  const scene = useRef<HTMLElement>(null), [month, setMonth] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const compare = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('compare');
  const [gl, setGl] = useState<'pending' | 'on' | 'off'>('pending'), [tower, setTower] = useState(false), [count, setCount] = useState<{ sum: number; done: boolean } | null>(null);
  const ready = useCallback((ok: boolean) => setGl(ok ? 'on' : 'off'), []);
  const towerChange = useCallback((on: boolean) => setTower(on), []);
  const hover = useCallback((i: number | null) => setMonth(m => (m === i ? m : i)), []);
  const progress = useCallback((sum: number, done: boolean) => setCount({ sum, done }), []);
  function lean(event: PointerEvent<HTMLElement>) {
    const el = scene.current; if (!el || gl === 'on' || event.pointerType === 'touch' || reducedMotion()) return;
    const r = el.getBoundingClientRect(), x = (event.clientX - r.left) / r.width - 0.5, y = (event.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--lean-x', `${(-y * 14).toFixed(2)}deg`); el.style.setProperty('--lean-z', `${(x * 22).toFixed(2)}deg`);
  }
  function settle() { scene.current?.style.removeProperty('--lean-x'); scene.current?.style.removeProperty('--lean-z'); setMonth(null); }
  function pick(m: Mode) { setMode(m); setCount(null); setTower(false); setMonth(null); }
  // Without WebGL the CSS block (monthly bars) is what people see, so its readout and caption are used.
  const shown: Mode = gl === 'off' ? 'bars' : mode;
  const data = shown !== 'bars';
  const glow = data ? !!count?.done : tower;
  const hud = data
    ? <><small>{count?.done ? '365일 다시 합산' : '365일 다시 합산 중'}</small><b>{(count?.sum ?? 0).toFixed(1)}mm</b></>
    : (month === null || tower)
      ? <><small>{tower ? '12개월을 쌓아 다시 합산' : '12개월 다시 합산'}</small><b>{TOTAL.toFixed(1)}mm</b></>
      : <><small>2023년 {month + 1}월</small><b>{RAIN[month].toFixed(1)}mm</b></>;
  return <figure ref={scene} className={'sg-scene' + (bare ? ' is-bare' : '') + (gl === 'on' ? ' is-3d' : '') + (glow ? ' is-tower' : '') + ' sg-scene-' + shown} onPointerMove={lean} onPointerLeave={settle} aria-label={`시애틀 2023년 강수량을 3D로 그린 그림. AI는 연간 합계를 888.4mm라고 했지만 다시 계산하면 ${TOTAL.toFixed(1)}mm입니다.`}>
    {data ? <DataScene3D key={mode} mode={mode as DataMode} onProgress={progress} onReady={ready}/>
      : <Scene3D values={RAIN} hot={tower ? null : month} onHover={hover} onTower={towerChange} onReady={ready}/>}
    {gl !== 'on' && <div className="sg-iso" aria-hidden="true" style={gl === 'pending' ? { visibility: 'hidden' } : undefined}>
      <div className="sg-iso-floor"/>
      {RAIN.map((v, i) => {
        const col = i % 4, row = Math.floor(i / 4);
        const style = { '--x': `${col * (SIZE + GAP) - 106}px`, '--y': `${row * (SIZE + GAP) - 78}px`, '--h': `${Math.max(4, (v / 215.4) * MAX_H)}px`, '--i': i } as CSSProperties;
        return <div key={i} className={'sg-bar' + (month === i ? ' is-on' : '')} style={style} onPointerEnter={() => setMonth(i)}><i className="t"/><i className="f"/><i className="s"/></div>;
      })}
    </div>}
    {compare && <div className="sg-scene-switch" role="group" aria-label="3D 모형 비교">{MODES.map(m => <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => pick(m.id)}>{m.label}</button>)}</div>}
    {!bare && <>
    <div className="sg-hud" aria-hidden="true">{hud}</div>
    <div className="sg-quote"><small>gpt-6-luna의 실제 답변</small><p>2023년 시애틀의 일별 강수량을 모두 합한 연간 강수량은 <mark>888.4mm</mark>입니다.</p></div>
    <div className="sg-stamp" aria-hidden="true"><strong>계산 불일치</strong><span>다시 계산하면 <b>{TOTAL.toFixed(1)}mm</b></span><span>답변과 차이 {(TOTAL - 888.4).toFixed(1)}mm</span></div>
    <figcaption className="sg-scene-label" style={{ left: 0, bottom: 0 }}>{MODES.find(m => m.id === shown)!.caption}</figcaption>
    </>}
  </figure>;
}
