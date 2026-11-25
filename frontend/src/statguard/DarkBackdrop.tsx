import { useEffect, useRef } from 'react';
import { reducedMotion } from './navigation';

/**
 * Full-screen live background for the dark pages, written as one raw WebGL fragment shader (no library, no download):
 * a slow domain-warped light field and a glow that follows the pointer (the grid floor and blinking cells were removed
 * to keep the pages calm and readable). Renders at reduced resolution, stops while the tab is hidden, draws a single
 * still frame for reduced motion, and leaves only the CSS gradient behind if WebGL is unavailable.
 */
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;uniform float u_scroll;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;vec2 p=(gl_FragCoord.xy-.5*u_res)/u_res.y;
  float t=u_time*.045;
  vec2 q=vec2(fbm(p*1.3+t),fbm(p*1.3-t+3.1));
  float f=fbm(p*1.7+q*1.7+vec2(t*2.,-t)+u_scroll*.15);
  vec3 col=vec3(.012,.02,.045);
  col=mix(col,vec3(.02,.36,.42),smoothstep(.42,.92,f)*.9);
  col=mix(col,vec3(.16,.24,.68),smoothstep(.55,1.,q.y)*.45);
  col=mix(col,vec3(.08,.52,.36),smoothstep(.62,1.,q.x*f*1.4)*.45);
  vec2 mm=(u_mouse-.5*u_res)/u_res.y;
  col+=vec3(.16,.62,.66)*exp(-6.5*length(p-mm))*.55;
  col*=1.-.6*length(uv-vec2(.5,.45));
  gl_FragColor=vec4(col,1.);
}`;

export default function DarkBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null), glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || typeof window.WebGLRenderingContext === 'undefined') return;
    const gl = el.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'u_res'), uTime = gl.getUniformLocation(prog, 'u_time'), uMouse = gl.getUniformLocation(prog, 'u_mouse'), uScroll = gl.getUniformLocation(prog, 'u_scroll');
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    let w = 0, h = 0, mx = 0, my = 0, tx = 0, ty = 0, raf = 0;
    const resize = () => { w = Math.max(1, Math.round(window.innerWidth * scale)); h = Math.max(1, Math.round(window.innerHeight * scale)); el.width = w; el.height = h; gl.viewport(0, 0, w, h); tx = mx = w * .7; ty = my = h * .6; };
    const move = (e: PointerEvent) => { tx = e.clientX * scale; ty = h - e.clientY * scale; if (glow.current) glow.current.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`; };
    const start = performance.now(), still = reducedMotion();
    const frame = () => {
      mx += (tx - mx) * .06; my += (ty - my) * .06;
      gl.uniform2f(uRes, w, h); gl.uniform1f(uTime, still ? 12 : (performance.now() - start) / 1000); gl.uniform2f(uMouse, mx, my); gl.uniform1f(uScroll, window.scrollY / Math.max(1, window.innerHeight));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    resize(); frame();
    el.classList.add('is-live');
    window.addEventListener('resize', resize); window.addEventListener('pointermove', move, { passive: true }); document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <div className="sg-backdrop" aria-hidden="true"><canvas ref={canvas}/><div ref={glow} className="sg-cursor-glow"/></div>;
}
