import { useEffect, useRef } from 'react';
import daily from './seattleDaily.json';
import { reducedMotion } from './navigation';

/**
 * Four WebGL hero models built from the 365 real daily rainfall values (NOAA, Seattle 2023), raw WebGL, no library.
 * In each, a scan sweeps the days in date order, lighting them green while the running total counts up to 888.9 mm;
 * a red marker stays where the running total equals the model's answer (888.4 mm = through 30 December).
 *   helix   – the year as a rotating double helix (DNA)
 *   sphere  – the days as a spiky point sphere (galaxy), scanned by a ring
 *   terrain – 12 months x 31 days as a glowing wireframe mountain range, scanned by a laser plane
 *   cube    – the CSV rows as points inside a glass cube, read layer by layer by a laser
 */
export type DataMode = 'helix' | 'sphere' | 'terrain' | 'cube';
type Props = { mode: DataMode; onProgress: (sum: number, done: boolean) => void; onReady: (ok: boolean) => void };
type M = Float32Array;
const D = daily as unknown as { values: number[]; month: number[]; day: number[]; ai_index: number };

const persp = (fov: number, asp: number, n: number, f: number): M => { const t = 1 / Math.tan(fov / 2), r = 1 / (n - f); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]); };
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(e: number[], c: number[]): M { const z = norm(sub(e, c)), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); }
function mul(a: M, b: M): M { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const POINT_V = `attribute vec3 a_p;attribute float a_v;attribute float a_k;uniform mat4 u_vp;uniform float u_scan;uniform float u_px;uniform float u_in;uniform float u_time;
varying vec3 vC;varying float vA;
void main(){vec4 c=u_vp*vec4(a_p,1.);gl_Position=c;float lit=step(a_k,u_scan);float front=exp(-pow((a_k-u_scan)*90.,2.));
gl_PointSize=u_px*(4.5+a_v*11.+front*9.)*(10./c.w);
vC=mix(vec3(.25,.75,.85),vec3(.35,1.,.62),lit)+vec3(1.)*front*.8;
vA=(.75+a_v*.6+lit*.4)*u_in*(.8+.2*sin(u_time*2.+a_k*60.));}`;
const POINT_F = `precision mediump float;varying vec3 vC;varying float vA;void main(){vec2 p=gl_PointCoord-.5;float d=length(p);float a=(1.-smoothstep(.0,.5,d));gl_FragColor=vec4(vC*(.8+a*.9),a*vA);}`;
const LINE_V = `attribute vec3 a_p;attribute float a_k;uniform mat4 u_vp;uniform float u_scan;uniform vec3 u_off;uniform vec3 u_sc;varying float vLit;varying float vK;
void main(){vK=a_k;vLit=step(a_k,u_scan);gl_Position=u_vp*vec4(a_p*u_sc+u_off,1.);}`;
const LINE_F = `precision mediump float;varying float vLit;varying float vK;uniform vec3 u_col;uniform vec3 u_lit;uniform float u_alpha;
void main(){gl_FragColor=vec4(mix(u_col,u_lit,vLit),u_alpha);}`;

type Geo = { pts: number[]; lines: number[]; scanShape: number[]; scanAt: (k: number) => { off: number[]; sc: number[] }; cam: { dist: number; y: number; el: number }; floorY: number };

function circle(n = 96): number[] { const out: number[] = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2; out.push(Math.cos(a), 0, Math.sin(a), 0, Math.cos(b), 0, Math.sin(b), 0); } return out; }
function square(axis: 'x' | 'z'): number[] {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]], out: number[] = [];
  for (let i = 0; i < 4; i++) { const [a, b] = c[i], [e, f] = c[(i + 1) % 4]; if (axis === 'x') out.push(0, a, b, 0, 0, e, f, 0); else out.push(a, b, 0, 0, e, f, 0, 0); }
  return out;
}

function build(mode: DataMode): Geo {
  const vals = D.values, n = vals.length, max = Math.max(...vals), pts: number[] = [], lines: number[] = [];
  const v = (i: number) => Math.sqrt(vals[i] / max);
  if (mode === 'helix') {
    const turns = 5.5, R = 2.1, H = 7;
    const at = (i: number, ph: number) => { const a = i / n * turns * Math.PI * 2 + ph, y = i / n * H - H / 2; return [Math.cos(a) * R, y, Math.sin(a) * R]; };
    for (let i = 0; i < n; i++) {
      const k = i / n, p = at(i, 0), q = at(i, Math.PI), bump = 1 + v(i) * .55;
      pts.push(p[0] * bump, p[1], p[2] * bump, v(i), k, q[0], q[1], q[2], .05, k);
      if (i % 3 === 0) lines.push(p[0], p[1], p[2], k, q[0], q[1], q[2], k);
      if (i > 0) { const a = at(i - 1, 0), b = at(i - 1, Math.PI); lines.push(a[0], a[1], a[2], k, p[0], p[1], p[2], k, b[0], b[1], b[2], k, q[0], q[1], q[2], k); }
    }
    return { pts, lines, scanShape: circle(), scanAt: k => ({ off: [0, k * H - H / 2, 0], sc: [R * 1.55, 1, R * 1.55] }), cam: { dist: 11.5, y: 0, el: .25 }, floorY: -H / 2 - .4 };
  }
  if (mode === 'sphere') {
    const R = 2.3, ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i, out = R * (1 + v(i) * .5);
      const p = [Math.cos(th) * r * out, y * out, Math.sin(th) * r * out];
      pts.push(p[0], p[1], p[2], v(i), i / n);
      lines.push(p[0] * R / out, p[1] * R / out, p[2] * R / out, i / n, p[0], p[1], p[2], i / n);
    }
    // a few faint latitude rings for structure
    for (let j = 1; j < 8; j++) { const y = 1 - j / 4, r = Math.sqrt(Math.max(0, 1 - y * y)), c = circle(72); for (let i = 0; i < c.length; i += 4) lines.push(c[i] * r * R, y * R, c[i + 2] * r * R, 2); }
    return { pts, lines, scanShape: circle(), scanAt: k => { const y = (1 - k * 2) * R * 1.05, r = Math.sqrt(Math.max(.02, (R * 1.25) ** 2 - y * y)); return { off: [0, y, 0], sc: [r, 1, r] }; }, cam: { dist: 9.5, y: 0, el: .3 }, floorY: -R * 1.6 };
  }
  if (mode === 'terrain') {
    const sx = .62, sz = .2, hgt = 3.2, grid: number[][][] = Array.from({ length: 12 }, () => []);
    for (let i = 0; i < n; i++) {
      const m = D.month[i] - 1, d = D.day[i] - 1, p = [(m - 5.5) * sx, v(i) * hgt, (d - 15) * sz];
      grid[m][d] = p; pts.push(p[0], p[1], p[2], v(i), i / n);
    }
    const kOf = (m: number, d: number) => { const idx = D.month.findIndex((mm, j) => mm === m + 1 && D.day[j] === d + 1); return idx < 0 ? 2 : idx / n; };
    for (let m = 0; m < 12; m++) for (let d = 0; d < 31; d++) {
      const p = grid[m][d]; if (!p) continue;
      const q = grid[m][d + 1]; if (q) lines.push(...p, kOf(m, d), ...q, kOf(m, d + 1));
      const r = m < 11 ? grid[m + 1][d] : undefined; if (r) lines.push(...p, kOf(m, d), ...r, kOf(m + 1, d));
    }
    return { pts, lines, scanShape: square('x'), scanAt: k => ({ off: [(k * 12 - 6) * sx, 1.3, 0], sc: [1, 1.7, 3.4] }), cam: { dist: 10.5, y: .9, el: .55 }, floorY: -.05 };
  }
  // cube: CSV rows as 7 x 7 x 8 points, layer by layer
  const S = .55, half = 3.5;
  for (let i = 0; i < n; i++) { const L = Math.floor(i / 49), r = Math.floor((i % 49) / 7), c = i % 7; pts.push((c - 3) * S, (r - 3) * S, (L - half) * S, v(i), i / n); }
  const e = 2.2, h = 2.6, cube = [[-e, -e, -h], [e, -e, -h], [e, e, -h], [-e, e, -h], [-e, -e, h], [e, -e, h], [e, e, h], [-e, e, h]];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) lines.push(...cube[a], 2, ...cube[b], 2);
  return { pts, lines, scanShape: square('z'), scanAt: k => ({ off: [0, 0, (k * 8 - half - .5) * S], sc: [e, e, 1] }), cam: { dist: 10, y: 0, el: .32 }, floorY: -e - .6 };
}

export default function DataScene3D({ mode, onProgress, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof window.WebGLRenderingContext === 'undefined') { onReady(false); return; }
    const gl = el.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: import.meta.env.DEV });
    if (!gl) { onReady(false); return; }
    const prog = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as [number, string][]) { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); gl.attachShader(p, sh); if (import.meta.env.DEV && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('[DataScene3D]', gl.getShaderInfoLog(sh)); }
      gl.linkProgram(p); if (import.meta.env.DEV && !gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn('[DataScene3D] link', gl.getProgramInfoLog(p));
      return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
    };
    const P = prog(POINT_V, POINT_F), L = prog(LINE_V, LINE_F);
    if (!P || !L) { onReady(false); return; }
    const g = build(mode);
    const buf = (data: number[]) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; };
    const ptsB = buf(g.pts), linesB = buf(g.lines), scanB = buf(g.scanShape), ringB = buf(circle());
    const floorLines: number[] = []; for (let i = -8; i <= 8; i++) floorLines.push(i * .8, g.floorY, -6.4, 2, i * .8, g.floorY, 6.4, 2, -6.4, g.floorY, i * .8, 2, 6.4, g.floorY, i * .8, 2);
    const floorB = buf(floorLines);
    const U = (p: WebGLProgram, s: string) => gl.getUniformLocation(p, s);
    const attr = (p: WebGLProgram, s: string, size: number, stride: number, off: number) => { const l = gl.getAttribLocation(p, s); if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); } };
    // Each draw enables only its own attributes; a stale enabled array from another program makes WebGL reject the draw.
    const reset = () => { for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i); };
    const prefix: number[] = []; D.values.reduce((a, x, i) => (prefix[i] = a + x, a + x), 0);
    const aiK = (D.ai_index + 1) / D.values.length;
    let redraw = () => {};
    let w = 1, h = 1, dpr = 1, px = 0, py = 0, sx = 0, sy = 0, raf = 0, lastSent = -1;
    const resize = () => { const r = el.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); w = Math.max(1, r.width); h = Math.max(1, r.height); el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); gl.viewport(0, 0, el.width, el.height); ; redraw()};
    const figure = el.parentElement!;
    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - .5; py = (e.clientY - r.top) / r.height - .5; };
    const leave = () => { px = py = 0; };
    figure.addEventListener('pointermove', move); figure.addEventListener('pointerleave', leave);
    window.addEventListener('resize', resize); resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; ro?.observe(el);
    // `?still` draws one finished frame (reduced motion does the same); used to compare models side by side.
    const still = reducedMotion() || new URLSearchParams(window.location.search).has('still'), t0 = performance.now();
    gl.enable(gl.BLEND);
    const drawLines = (b: WebGLBuffer | null, count: number, vp: M, scan: number, col: number[], lit: number[], alpha: number, off = [0, 0, 0], sc = [1, 1, 1]) => {
      reset(); gl.useProgram(L); gl.bindBuffer(gl.ARRAY_BUFFER, b); attr(L!, 'a_p', 3, 16, 0); attr(L!, 'a_k', 1, 16, 12);
      gl.uniformMatrix4fv(U(L!, 'u_vp'), false, vp); gl.uniform1f(U(L!, 'u_scan'), scan); gl.uniform3fv(U(L!, 'u_off'), off); gl.uniform3fv(U(L!, 'u_sc'), sc);
      gl.uniform3fv(U(L!, 'u_col'), col); gl.uniform3fv(U(L!, 'u_lit'), lit); gl.uniform1f(U(L!, 'u_alpha'), alpha);
      gl.drawArrays(gl.LINES, 0, count);
    };
    const frame = () => {
      const t = still ? 9 : (performance.now() - t0) / 1000, loop = t % 13;
      const intro = still ? 1 : smooth(0, 1.4, t), scan = still ? 1 : smooth(1.2, 8.2, loop) * (1 - smooth(11.6, 12.8, loop));
      const idx = Math.min(D.values.length - 1, Math.floor(scan * D.values.length) - 1), sum = idx < 0 ? 0 : prefix[idx], done = scan > .999;
      const sent = Math.round(sum * 10); if (sent !== lastSent) { lastSent = sent; onProgress(sum, done); }
      sx += (px - sx) * .05; sy += (py - sy) * .05;
      const ang = .6 + (still ? 0 : t * .16) + sx * 1.2, el2 = g.cam.el - sy * .4;
      const tgt = [0, g.cam.y, 0], eye = [Math.sin(ang) * Math.cos(el2) * g.cam.dist, g.cam.y + Math.sin(el2) * g.cam.dist, Math.cos(ang) * Math.cos(el2) * g.cam.dist];
      const vp = mul(persp(.62, w / h, .1, 80), lookAt(eye, tgt));
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      // On a transparent canvas the alpha channel must accumulate too, or additive glow composites as nearly invisible.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      drawLines(floorB, floorLines.length / 4, vp, -1, [.2, .7, .78], [.2, .7, .78], .12 * intro);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      drawLines(linesB, g.lines.length / 4, vp, scan, [.3, .78, .88], [.45, 1, .7], (mode === 'terrain' ? .9 : .65) * intro);
      reset(); gl.useProgram(P); gl.bindBuffer(gl.ARRAY_BUFFER, ptsB); attr(P!, 'a_p', 3, 20, 0); attr(P!, 'a_v', 1, 20, 12); attr(P!, 'a_k', 1, 20, 16);
      gl.uniformMatrix4fv(U(P!, 'u_vp'), false, vp); gl.uniform1f(U(P!, 'u_scan'), scan); gl.uniform1f(U(P!, 'u_px'), dpr); gl.uniform1f(U(P!, 'u_in'), intro); gl.uniform1f(U(P!, 'u_time'), t);
      gl.drawArrays(gl.POINTS, 0, g.pts.length / 5);
      // red marker where the running total equals the model's answer (888.4 mm), and the moving scan
      const ai = g.scanAt(aiK);
      drawLines(g.scanShape === g.scanShape ? scanB : ringB, g.scanShape.length / 4, vp, -1, [1, .35, .3], [1, .35, .3], .85 * intro, ai.off, ai.sc);
      if (scan > .001 && scan < .999) for (const grow of [1, 1.015, 1.03]) { const s = g.scanAt(scan); drawLines(scanB, g.scanShape.length / 4, vp, -1, [.6, 1, .85], [.6, 1, .85], .9 / grow, s.off, s.sc.map(x => x * grow)); }
      if (import.meta.env.DEV) (window as unknown as { __sgGl?: unknown }).__sgGl = { err: gl.getError(), pts: g.pts.length / 5, lines: g.lines.length / 4, scan, eye: eye.map(v => +v.toFixed(2)), gl, P, L, ptsB, vp, sample: g.pts.slice(0, 10), attrs: ['a_p', 'a_v', 'a_k'].map(a => gl.getAttribLocation(P!, a)), lattrs: ['a_p', 'a_k'].map(a => gl.getAttribLocation(L!, a)) };
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };
    redraw = () => { cancelAnimationFrame(raf); frame(); };
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    document.addEventListener('visibilitychange', vis);
    frame(); onReady(true);
    return () => { ro?.disconnect(); cancelAnimationFrame(raf); figure.removeEventListener('pointermove', move); figure.removeEventListener('pointerleave', leave); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvas} className="sg-scene3d" aria-hidden="true"/>;
}
