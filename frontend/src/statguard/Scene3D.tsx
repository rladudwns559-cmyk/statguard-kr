import { useEffect, useRef } from 'react';
import { reducedMotion } from './navigation';

/**
 * Real 3D hero model in raw WebGL (no library): twelve glass-like bars (the real monthly rainfall), mirrored on a
 * glowing grid floor, rising light particles, a slowly orbiting camera that also follows the pointer, and a loop in
 * which the twelve bars fly up and stack into one tower — the "recount" of the annual total.
 * Calls onReady(false) when WebGL is unavailable so the CSS scene can be shown instead.
 */
type Props = { values: number[]; hot: number | null; onHover: (i: number | null) => void; onTower: (on: boolean) => void; onReady: (ok: boolean) => void };
type M = Float32Array;

const persp = (fov: number, asp: number, n: number, f: number): M => { const t = 1 / Math.tan(fov / 2), r = 1 / (n - f); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]); };
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function lookAt(e: number[], c: number[]): M {
  const z = norm(sub(e, c)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
function mul(a: M, b: M): M { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// unit box: x,z in [-.5,.5], y in [0,1]; position + normal
const BOX = (() => {
  const f = (n: number[], quad: number[][]) => [0, 1, 2, 0, 2, 3].flatMap(i => [...quad[i], ...n]);
  const p = (x: number, y: number, z: number) => [x - .5, y, z - .5];
  return new Float32Array([
    ...f([0, 0, 1], [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]), ...f([0, 0, -1], [p(1, 0, 0), p(0, 0, 0), p(0, 1, 0), p(1, 1, 0)]),
    ...f([1, 0, 0], [p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)]), ...f([-1, 0, 0], [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)]),
    ...f([0, 1, 0], [p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), p(0, 1, 0)]), ...f([0, -1, 0], [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)]),
  ]);
})();

const BAR_V = `attribute vec3 a_p;attribute vec3 a_n;uniform mat4 u_vp;uniform vec3 u_off;uniform vec3 u_scale;uniform float u_flip;
varying vec3 vN;varying vec3 vW;varying vec3 vL;
void main(){vL=a_p;vec3 w=a_p*u_scale+u_off;w.y*=u_flip;vW=w;vN=a_n*vec3(1.,u_flip,1.);gl_Position=u_vp*vec4(w,1.);}`;
const BAR_F = `precision mediump float;varying vec3 vN;varying vec3 vW;varying vec3 vL;
uniform highp vec3 u_eye;uniform vec3 u_base;uniform vec3 u_top;uniform float u_hl;uniform float u_alpha;uniform highp vec3 u_scale;
void main(){vec3 N=normalize(vN);vec3 V=normalize(u_eye-vW);vec3 L=normalize(vec3(.45,.9,.3));
float diff=max(dot(N,L),0.)*.55+.45;vec3 col=mix(u_base,u_top,clamp(vL.y,0.,1.));
if(N.y>.5)col=u_top*1.18;col*=diff;
float fres=pow(1.-max(dot(N,V),0.),2.5);col+=vec3(.35,.92,1.)*fres*.6;
vec3 q=vec3(abs(vL.x)*2.,abs(vL.y*2.-1.),abs(vL.z)*2.);
vec3 w=vec3(.05/u_scale.x,.05/u_scale.y,.05/u_scale.z)*2.;
float ex=smoothstep(1.-w.x,1.,q.x),ey=smoothstep(1.-w.y,1.,q.y),ez=smoothstep(1.-w.z,1.,q.z);
float edge=clamp(ex+ey+ez-1.,0.,1.);col+=vec3(.75,1.,1.)*edge*.9;
col=mix(col,vec3(1.,.82,.45)*diff+vec3(1.,.6,.3)*fres+edge*vec3(1.,.9,.7),u_hl*.75);
gl_FragColor=vec4(col,u_alpha);}`;
const FLOOR_V = `attribute vec3 a_p;uniform mat4 u_vp;varying vec3 vW;void main(){vec3 w=vec3(a_p.x*16.,0.,a_p.z*16.);vW=w;gl_Position=u_vp*vec4(w,1.);}`;
const FLOOR_F = `precision mediump float;varying vec3 vW;uniform float u_time;
void main(){float d=length(vW.xz);vec2 g=abs(fract(vW.xz*.9)-.5);float line=smoothstep(.465,.5,max(g.x,g.y));
float fade=(1.-smoothstep(.5,7.5,d));float ring=exp(-pow(d-3.6-sin(u_time*.6)*.15,2.)*6.);
vec3 col=vec3(.015,.04,.075)+vec3(.2,.75,.8)*line*.38*fade+vec3(.1,.5,.55)*exp(-d*.55)*.35+vec3(.3,.9,.95)*ring*.25*fade;
gl_FragColor=vec4(col,.72*fade);}`;
const PART_V = `attribute vec3 a_p;uniform mat4 u_vp;uniform float u_time;uniform float u_px;varying float vA;
void main(){float y=mod(a_p.y+u_time*(.25+fract(a_p.x*7.3)*.35),7.5);vec3 w=vec3(a_p.x+sin(u_time*.4+a_p.z)*.15,y,a_p.z);
vec4 c=u_vp*vec4(w,1.);gl_Position=c;gl_PointSize=u_px*(2.+fract(a_p.z*3.1)*3.)/c.w*6.;vA=smoothstep(0.,1.,y)*(1.-smoothstep(4.,7.5,y));}`;
const PART_F = `precision mediump float;varying float vA;void main(){vec2 p=gl_PointCoord-.5;float d=length(p);gl_FragColor=vec4(vec3(.55,.95,1.),(1.-smoothstep(0.,.5,d))*vA*.8);}`;

export default function Scene3D({ values, hot, onHover, onTower, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), hotRef = useRef<number | null>(hot), tops = useRef<[number, number][]>([]);
  hotRef.current = hot;
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof window.WebGLRenderingContext === 'undefined') { onReady(false); return; }
    const gl = el.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { onReady(false); return; }
    const prog = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as [number, string][]) {
        const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); gl.attachShader(p, sh);
        if (import.meta.env.DEV && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn('[Scene3D] shader', gl.getShaderInfoLog(sh));
      }
      gl.linkProgram(p);
      if (import.meta.env.DEV && !gl.getProgramParameter(p, gl.LINK_STATUS)) console.warn('[Scene3D] link', gl.getProgramInfoLog(p));
      return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
    };
    const bar = prog(BAR_V, BAR_F), floor = prog(FLOOR_V, FLOOR_F), part = prog(PART_V, PART_F);
    if (!bar || !floor || !part) { onReady(false); return; }
    const box = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, box); gl.bufferData(gl.ARRAY_BUFFER, BOX, gl.STATIC_DRAW);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1]), gl.STATIC_DRAW);
    const N = 240, pts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const r = 1 + Math.random() * 5.5, a = Math.random() * Math.PI * 2; pts.set([Math.cos(a) * r, Math.random() * 7.5, Math.sin(a) * r], i * 3); }
    const dust = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dust); gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
    const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    const attr = (p: WebGLProgram, n: string, size: number, stride: number, off: number) => { const l = gl.getAttribLocation(p, n); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); };
    const reset = () => { for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i); };

    const max = Math.max(...values), H = values.map(v => Math.max(.08, v / max * 3.4));
    const K = .42, total = H.reduce((a, b) => a + b, 0) * K;
    const base = H.map((_, i) => H.slice(0, i).reduce((a, b) => a + b, 0) * K);
    const grid = values.map((_, i) => [((i % 4) - 1.5) * 1.3, (Math.floor(i / 4) - 1) * 1.3]);
    let redraw = () => {};
    let w = 1, h = 1, dpr = 1, px = 0, py = 0, sx = 0, sy = 0, raf = 0, wasTower = false;
    const resize = () => { const r = el.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); w = Math.max(1, r.width); h = Math.max(1, r.height); el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); gl.viewport(0, 0, el.width, el.height); ; redraw()};
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - .5; py = (e.clientY - r.top) / r.height - .5;
      let best: number | null = null, bd = 46;
      tops.current.forEach(([x, y], i) => { const d = Math.hypot(x - (e.clientX - r.left), y - (e.clientY - r.top)); if (d < bd) { bd = d; best = i; } });
      onHover(best);
    };
    const leave = () => { px = py = 0; onHover(null); };
    const figure = el.parentElement!;
    figure.addEventListener('pointermove', move); figure.addEventListener('pointerleave', leave);
    window.addEventListener('resize', resize); resize();
    // Re-measure when the box itself changes size (layout settling, breakpoints), not only on window resize.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; ro?.observe(el);
    const still = reducedMotion(), t0 = performance.now();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const frame = () => {
      const t = still ? 3 : (performance.now() - t0) / 1000, loop = t % 15;
      const rise = (i: number) => still ? 1 : smooth(i * .06, i * .06 + 1.2, t);
      const stack = still ? 0 : smooth(6, 8.2, loop) * (1 - smooth(11, 13, loop));
      const tower = stack > .98;
      if (tower !== wasTower) { wasTower = tower; onTower(tower); }
      sx += (px - sx) * .05; sy += (py - sy) * .05;
      const ang = .65 + (still ? 0 : t * .14) + sx * 1.1, el2 = .5 - sy * .35 - stack * .12;
      const tgt = [0, 1.0 + stack * (total * .55 - 1.0), 0], dist = 13.5 + stack * 4.5;
      const eye = [tgt[0] + Math.sin(ang) * Math.cos(el2) * dist, tgt[1] + Math.sin(el2) * dist, tgt[2] + Math.cos(ang) * Math.cos(el2) * dist];
      const vp = mul(persp(.62, w / h, .1, 80), lookAt(eye, tgt));
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const place = (i: number) => {
        const k = smooth(i * .05, .45 + i * .05, stack) ;
        const g = grid[i], sc = (1 - k) + k * K, lift = Math.sin(k * Math.PI) * 1.6;
        return { x: g[0] * (1 - k), z: g[1] * (1 - k), y: base[i] * k + lift * (1 - Math.abs(k * 2 - 1)) * .6, hgt: H[i] * sc * rise(i), wid: .95 - k * .05 };
      };
      const drawBars = (flip: number, alpha: number) => {
        reset(); gl.useProgram(bar); gl.bindBuffer(gl.ARRAY_BUFFER, box); attr(bar, 'a_p', 3, 24, 0); attr(bar, 'a_n', 3, 24, 12);
        gl.uniformMatrix4fv(U(bar, 'u_vp'), false, vp); gl.uniform3fv(U(bar, 'u_eye'), eye); gl.uniform1f(U(bar, 'u_flip'), flip); gl.uniform1f(U(bar, 'u_alpha'), alpha);
        for (let i = 0; i < H.length; i++) {
          const b = place(i), towerTint = stack;
          gl.uniform3f(U(bar, 'u_off'), b.x, b.y, b.z); gl.uniform3f(U(bar, 'u_scale'), b.wid, Math.max(.001, b.hgt), b.wid);
          gl.uniform3f(U(bar, 'u_base'), .03 + towerTint * .02, .32 + towerTint * .14, .38 - towerTint * .08);
          gl.uniform3f(U(bar, 'u_top'), .55 + towerTint * .05, .93, .95 - towerTint * .2);
          gl.uniform1f(U(bar, 'u_hl'), hotRef.current === i ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 36);
        }
      };
      gl.cullFace(gl.BACK);
      drawBars(-1, .28);
      reset(); gl.useProgram(floor); gl.bindBuffer(gl.ARRAY_BUFFER, quad); attr(floor, 'a_p', 3, 12, 0);
      gl.uniformMatrix4fv(U(floor, 'u_vp'), false, vp); gl.uniform1f(U(floor, 'u_time'), t);
      gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.depthMask(true);
      drawBars(1, 1);
      reset(); gl.useProgram(part); gl.bindBuffer(gl.ARRAY_BUFFER, dust); attr(part, 'a_p', 3, 12, 0);
      gl.uniformMatrix4fv(U(part, 'u_vp'), false, vp); gl.uniform1f(U(part, 'u_time'), t); gl.uniform1f(U(part, 'u_px'), dpr);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE); gl.depthMask(false); gl.drawArrays(gl.POINTS, 0, N); gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      tops.current = H.map((_, i) => { const b = place(i), p = [b.x, b.y + b.hgt, b.z, 1]; const c = [0, 1, 2, 3].map(r => vp[r] * p[0] + vp[4 + r] * p[1] + vp[8 + r] * p[2] + vp[12 + r] * p[3]); return [(c[0] / c[3] * .5 + .5) * w, (1 - (c[1] / c[3] * .5 + .5)) * h]; });
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };
    redraw = () => { cancelAnimationFrame(raf); frame(); };
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    document.addEventListener('visibilitychange', vis);
    frame(); onReady(true);
    return () => { ro?.disconnect(); cancelAnimationFrame(raf); figure.removeEventListener('pointermove', move); figure.removeEventListener('pointerleave', leave); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={canvas} className="sg-scene3d" aria-hidden="true"/>;
}
