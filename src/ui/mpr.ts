// 3D task: multiplanar reformatting of stored volumetric acquisitions.
import type { PhantomData, Vec3, Weighting } from '../core/types';
import { buildReplay, buildSynthetic, referenceSeries, type StudySeries } from '../phantom/study';
import { guessWeighting } from '../physics/weighting';
import { add3, clamp, cross, dot3, rng } from '../core/util';
import { autoWindow, dirLabel, IDENTITY, planeName, rangeCenters, reformat, rotate, viewPlane, volumeCenter, volumeDiagonal, type Mat3, type Plane, type SlabMode, type ViewId } from '../mpr/mpr';
import { signals } from '../physics/signal';
import { loadVolumes, type LoadReport, type MprVolume } from '../volume/series';
import { $, esc, setMsg } from './dom';

type Tool = 'cross' | 'wl' | 'zoom' | 'pan' | 'measure';
interface Measure { a: Vec3; b: Vec3; n: Vec3; d: number }
interface Result { name: string; P: Plane; D: Vec3[]; fovW: number; fovH: number; W: number; H: number; imgs: Float32Array[]; wl: { w: number; c: number } }

const COLORS: Record<ViewId, string> = { tra: '#5aa9ff', sag: '#f2c94c', cor: '#6fcf97' };
const NAMES: Record<ViewId, string> = { tra: 'Tra', sag: 'Sag', cor: 'Cor' };
const VIEWS: ViewId[] = ['tra', 'sag', 'cor'];

const M = {
  vols: [] as MprVolume[],
  vol: null as MprVolume | null,
  R: IDENTITY as Mat3,
  c: [0, 0, 0] as Vec3,
  wl: { w: 1, c: 0 },
  tool: 'cross' as Tool,
  slab: { thick: 1, mode: 'mpr' as SlabMode },
  view: { tra: { zoom: 1, pan: [0, 0] }, sag: { zoom: 1, pan: [0, 0] }, cor: { zoom: 1, pan: [0, 0] } } as Record<ViewId, { zoom: number; pan: [number, number] }>,
  meas: [] as Measure[],
  range: { base: 'cor' as ViewId, count: 25, thick: 3, spacing: 3.5, show: true },
  results: [] as Result[],
  res: -1,
  resSlice: 0,
  demo: null as PhantomData | null,
};

interface Seg {
  id: ViewId | 'res';
  el: HTMLElement;
  cv: HTMLCanvasElement;
  off: HTMLCanvasElement;
  ov: HTMLElement[];
  ori: Record<'l' | 'r' | 't' | 'b', HTMLElement>;
  /** mapping of the last render: display centre, plane and field of view */
  map: { D: Vec3; P: Plane; fovW: number; fovH: number } | null;
}

function makeSeg(id: Seg['id'], sel: string): Seg {
  const el = $(sel);
  const q = (c: string) => el.querySelector<HTMLElement>(c)!;
  return { id, el, cv: el.querySelector('canvas')!, off: document.createElement('canvas'), ov: [...el.querySelectorAll<HTMLElement>('.ov')], ori: { l: q('.ori.l'), r: q('.ori.r'), t: q('.ori.t'), b: q('.ori.b') }, map: null };
}
let segs: Record<ViewId | 'res', Seg>;

const minSp = () => (M.vol ? Math.min(M.vol.sx, M.vol.sy, M.vol.sz) : 1);

/* ---------- rendering ---------- */
function canvasSize(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return { cw: r.width, ch: r.height, dpr };
}

function viewMap(id: ViewId, cw: number, ch: number) {
  const V = M.vol!, P = viewPlane(M.R, id), vw = M.view[id];
  const base = volumeDiagonal(V) * 0.82 / vw.zoom, m = Math.min(cw, ch) || 1;
  const fovW = (base * cw) / m, fovH = (base * ch) / m;
  const Vc = volumeCenter(V), dc: Vec3 = [Vc[0] - M.c[0], Vc[1] - M.c[1], Vc[2] - M.c[2]];
  // the image stays put while the crosshair moves: centre on the volume, not on the crosshair
  const D = add3(add3(M.c, P.u, dot3(dc, P.u) + vw.pan[0]), P.v, dot3(dc, P.v) + vw.pan[1]);
  return { D, P, fovW, fovH };
}

function paint(seg: Seg, img: Float32Array, W: number, H: number, wl: { w: number; c: number }) {
  seg.off.width = W; seg.off.height = H;
  const ctx = seg.off.getContext('2d')!, id = ctx.createImageData(W, H);
  const lo = wl.c - wl.w / 2, sc = 255 / Math.max(1, wl.w);
  for (let k = 0; k < img.length; k++) {
    const v = img[k], g = v === v ? clamp((v - lo) * sc, 0, 255) : 0;
    id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = g;
    id.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

function toCan(seg: Seg, p: Vec3): [number, number] {
  const m = seg.map!, { cw, ch, dpr } = canvasSize(seg.cv), d: Vec3 = [p[0] - m.D[0], p[1] - m.D[1], p[2] - m.D[2]];
  return [((dot3(d, m.P.u) / m.fovW + 0.5) * cw) * dpr, ((dot3(d, m.P.v) / m.fovH + 0.5) * ch) * dpr];
}
function toPat(seg: Seg, X: number, Y: number): Vec3 {
  const m = seg.map!, { cw, ch, dpr } = canvasSize(seg.cv);
  const a = (X / dpr / cw - 0.5) * m.fovW, b = (Y / dpr / ch - 0.5) * m.fovH;
  return add3(add3(m.D, m.P.u, a), m.P.v, b);
}

const posLabel = (c: Vec3, n: Vec3) => {
  const a = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0);
  const L = [['L', 'R'], ['P', 'A'], ['H', 'F']][a];
  return `${c[a] >= 0 ? L[0] : L[1]}${Math.abs(c[a]).toFixed(1)}`;
};

function setLetters(seg: Seg, P: Plane | null) {
  const s = (d: Vec3) => (P ? dirLabel(d) : '');
  seg.ori.l.textContent = P ? s([-P.u[0], -P.u[1], -P.u[2]]) : '';
  seg.ori.r.textContent = P ? s(P.u) : '';
  seg.ori.t.textContent = P ? s([-P.v[0], -P.v[1], -P.v[2]]) : '';
  seg.ori.b.textContent = P ? s(P.v) : '';
}

function renderView(id: ViewId, low: boolean) {
  const seg = segs[id], V = M.vol;
  const { cw, ch, dpr } = canvasSize(seg.cv);
  if (!cw) return;
  seg.cv.width = Math.round(cw * dpr); seg.cv.height = Math.round(ch * dpr);
  const ctx = seg.cv.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, seg.cv.width, seg.cv.height);
  if (!V) { seg.map = null; setLetters(seg, null); seg.ov.forEach((o) => (o.textContent = '')); return; }
  const map = viewMap(id, cw, ch);
  seg.map = map;
  const cap = low ? 320 : 768, k = Math.min(1, cap / Math.max(cw * dpr, ch * dpr));
  const W = Math.max(8, Math.round(cw * dpr * k)), H = Math.max(8, Math.round(ch * dpr * k));
  const img = reformat(V, map.D, map.P, map.fovW, map.fovH, W, H, M.slab);
  paint(seg, img, W, H, M.wl);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(seg.off, 0, 0, seg.cv.width, seg.cv.height);
  drawCross(seg, ctx);
  drawRange(seg, ctx);
  drawMeasures(seg, ctx);
  setLetters(seg, map.P);
  const i = V.info;
  seg.ov[0].textContent = `ANONIMIZADO\n${i.desc}${i.maker ? '\n' + i.maker : ''}${i.B0 ? '  ' + i.B0 + ' T' : ''}${i.TR ? `\nTR ${i.TR}  TE ${i.TE ?? '—'}${i.TI ? '  TI ' + i.TI : ''}${i.FA ? '  FA ' + i.FA : ''}` : ''}`;
  seg.ov[1].textContent = `${NAMES[id]}  ${planeName(map.P.n)}\nSP ${posLabel(M.c, map.P.n)}`;
  const sl = M.slab.mode === 'mpr' ? `MPR ${minSp().toFixed(1)} mm` : `${{ mip: 'MIP', minip: 'MinIP', avg: 'Prom.' }[M.slab.mode]} ${M.slab.thick.toFixed(1)} mm`;
  seg.ov[2].textContent = `${sl}\nZoom ${M.view[id].zoom.toFixed(2)}`;
  seg.ov[3].textContent = `W ${M.wl.w}\nC ${M.wl.c}`;
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, L: number, gap = 0) {
  ctx.beginPath();
  ctx.moveTo(x - dx * L, y - dy * L); ctx.lineTo(x - dx * gap, y - dy * gap);
  ctx.moveTo(x + dx * gap, y + dy * gap); ctx.lineTo(x + dx * L, y + dy * L);
  ctx.stroke();
}

/** Screen direction of the line where view B cuts view A. */
function lineDir(seg: Seg, nB: Vec3): [number, number] | null {
  const m = seg.map!, d = cross(m.P.n, nB);
  if (Math.hypot(...d) < 1e-6) return null;
  const { cw, ch } = canvasSize(seg.cv);
  const x = (dot3(d, m.P.u) / m.fovW) * cw, y = (dot3(d, m.P.v) / m.fovH) * ch, l = Math.hypot(x, y);
  return [x / l, y / l];
}

function handles(seg: Seg, B: ViewId) {
  const nB = viewPlane(M.R, B).n, dir = lineDir(seg, nB);
  if (!dir) return null;
  const [cx, cy] = toCan(seg, M.c), r = Math.min(seg.cv.width, seg.cv.height) * 0.36;
  return { cx, cy, dir, h1: [cx + dir[0] * r, cy + dir[1] * r] as [number, number], h2: [cx - dir[0] * r, cy - dir[1] * r] as [number, number] };
}

function drawCross(seg: Seg, ctx: CanvasRenderingContext2D) {
  const dpr = window.devicePixelRatio || 1, L = Math.hypot(seg.cv.width, seg.cv.height);
  for (const B of VIEWS) {
    if (B === seg.id) continue;
    const h = handles(seg, B);
    if (!h) continue;
    ctx.strokeStyle = COLORS[B]; ctx.lineWidth = 1.2 * dpr; ctx.globalAlpha = 0.9;
    line(ctx, h.cx, h.cy, h.dir[0], h.dir[1], L, 14 * dpr);
    if (M.tool === 'cross') {
      ctx.fillStyle = COLORS[B];
      for (const p of [h.h1, h.h2]) { ctx.beginPath(); ctx.arc(p[0], p[1], 4 * dpr, 0, 7); ctx.fill(); }
    }
  }
  ctx.globalAlpha = 1;
}

function rangePlanes() {
  const B = M.range.base, P = viewPlane(M.R, B);
  return { P, centers: rangeCenters(M.c, P.n, M.range.count, M.range.spacing) };
}

function drawRange(seg: Seg, ctx: CanvasRenderingContext2D) {
  if (!M.range.show || seg.id === M.range.base || seg.id === 'res') return;
  const { P, centers } = rangePlanes(), m = seg.map!, dir = lineDir(seg, P.n);
  if (!dir) return;
  const dpr = window.devicePixelRatio || 1, L = Math.hypot(seg.cv.width, seg.cv.height);
  // in-plane direction across the range lines
  const w0 = add3(P.n, m.P.n, -dot3(P.n, m.P.n)), wl = Math.hypot(...w0);
  if (wl < 1e-6) return;
  const w: Vec3 = [w0[0] / wl, w0[1] / wl, w0[2] / wl], wn = dot3(w, P.n);
  ctx.strokeStyle = COLORS[M.range.base];
  centers.forEach((C, i) => {
    const t = dot3([C[0] - M.c[0], C[1] - M.c[1], C[2] - M.c[2]], P.n) / wn;
    const [x, y] = toCan(seg, add3(M.c, w, t));
    const edge = i === 0 || i === centers.length - 1;
    ctx.globalAlpha = edge ? 0.9 : 0.22;
    ctx.lineWidth = (edge ? 1.4 : 1) * dpr;
    ctx.setLineDash(edge ? [] : [2 * dpr, 6 * dpr]);
    line(ctx, x, y, dir[0], dir[1], L);
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function measVisible(seg: Seg, ms: Measure) {
  const n = seg.map!.P.n;
  return Math.abs(dot3(n, ms.n)) > 0.999 && Math.abs(dot3(n, M.c) - ms.d * Math.sign(dot3(n, ms.n))) < Math.max(0.6 * minSp(), M.slab.thick / 2);
}

function drawMeasures(seg: Seg, ctx: CanvasRenderingContext2D, extra?: Measure) {
  const dpr = window.devicePixelRatio || 1;
  for (const ms of extra ? [...M.meas, extra] : M.meas) {
    if (!measVisible(seg, ms)) continue;
    const a = toCan(seg, ms.a), b = toCan(seg, ms.b), len = Math.hypot(ms.b[0] - ms.a[0], ms.b[1] - ms.a[1], ms.b[2] - ms.a[2]);
    ctx.strokeStyle = '#ffb347'; ctx.fillStyle = '#ffb347'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.5 * dpr, 0, 7); ctx.fill(); }
    ctx.font = `600 ${12 * dpr}px "IBM Plex Mono",monospace`;
    ctx.fillText(`${len.toFixed(1)} mm`, b[0] + 6 * dpr, b[1] - 6 * dpr);
  }
}

function renderResult() {
  const seg = segs.res, { cw, ch, dpr } = canvasSize(seg.cv);
  if (!cw) return;
  seg.cv.width = Math.round(cw * dpr); seg.cv.height = Math.round(ch * dpr);
  const ctx = seg.cv.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, seg.cv.width, seg.cv.height);
  const r = M.results[M.res];
  ($('#mEmptyRes') as HTMLElement).hidden = !!r;
  if (!r) { seg.map = null; setLetters(seg, null); seg.ov.forEach((o) => (o.textContent = '')); return; }
  M.resSlice = clamp(M.resSlice, 0, r.imgs.length - 1);
  paint(seg, r.imgs[M.resSlice], r.W, r.H, r.wl);
  const s = Math.min(seg.cv.width / r.fovW, seg.cv.height / r.fovH), dw = r.fovW * s, dh = r.fovH * s;
  ctx.drawImage(seg.off, (seg.cv.width - dw) / 2, (seg.cv.height - dh) / 2, dw, dh);
  seg.map = { D: r.D[M.resSlice], P: r.P, fovW: seg.cv.width / s, fovH: seg.cv.height / s };
  setLetters(seg, r.P);
  seg.ov[0].textContent = `ANONIMIZADO\n${M.vol?.info.desc ?? ''}`;
  seg.ov[1].textContent = `${r.name}\nIm: ${M.resSlice + 1}/${r.imgs.length}\nSP ${posLabel(r.D[M.resSlice], r.P.n)}`;
  seg.ov[2].textContent = `${planeName(r.P.n)}  ${M.range.thick.toFixed(1)} mm`;
  seg.ov[3].textContent = `W ${r.wl.w}\nC ${r.wl.c}`;
}

let raf = 0, lowPending = false;
function schedule(low = false) {
  lowPending = low;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { for (const v of VIEWS) renderView(v, lowPending); });
}

/* ---------- interaction ---------- */
function pxy(seg: Seg, e: PointerEvent | WheelEvent): [number, number] {
  const r = seg.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
}

type Drag =
  | { kind: 'rot'; axis: Vec3; a0: number; R0: Mat3; cx: number; cy: number }
  | { kind: 'center' }
  | { kind: 'line'; n: Vec3; c0: Vec3; p0: Vec3 }
  | { kind: 'wl'; x: number; y: number; w: number; c: number }
  | { kind: 'zoom'; y: number; z: number }
  | { kind: 'pan'; x: number; y: number; pan: [number, number] }
  | { kind: 'measure'; a: Vec3; b: Vec3; n: Vec3; d: number };

function hitCross(seg: Seg, X: number, Y: number): Drag | null {
  const dpr = window.devicePixelRatio || 1, id = seg.id as ViewId;
  for (const B of VIEWS) {
    if (B === id) continue;
    const h = handles(seg, B);
    if (!h) continue;
    for (const p of [h.h1, h.h2]) if (Math.hypot(X - p[0], Y - p[1]) < 10 * dpr) {
      const m = seg.map!;
      return { kind: 'rot', axis: cross(m.P.u, m.P.v), a0: Math.atan2(Y - h.cy, X - h.cx), R0: M.R, cx: h.cx, cy: h.cy };
    }
  }
  const [cx, cy] = toCan(seg, M.c);
  if (Math.hypot(X - cx, Y - cy) < 14 * dpr) return { kind: 'center' };
  for (const B of VIEWS) {
    if (B === id) continue;
    const h = handles(seg, B);
    if (!h) continue;
    const dist = Math.abs((X - h.cx) * h.dir[1] - (Y - h.cy) * h.dir[0]);
    if (dist < 6 * dpr) return { kind: 'line', n: viewPlane(M.R, B).n, c0: M.c.slice() as Vec3, p0: toPat(seg, X, Y) };
  }
  return null;
}

function bindView(seg: Seg) {
  const id = seg.id as ViewId;
  let drag: Drag | null = null;
  seg.cv.addEventListener('contextmenu', (e) => e.preventDefault());
  seg.cv.addEventListener('pointerdown', (e) => {
    if (!M.vol || !seg.map) return;
    seg.cv.setPointerCapture(e.pointerId);
    const [X, Y] = pxy(seg, e);
    const tool: Tool = e.button === 2 ? 'wl' : e.button === 1 ? 'pan' : M.tool;
    if (tool === 'cross') {
      drag = hitCross(seg, X, Y);
      if (!drag) { M.c = toPat(seg, X, Y); drag = { kind: 'center' }; schedule(true); }
    } else if (tool === 'wl') drag = { kind: 'wl', x: e.clientX, y: e.clientY, w: M.wl.w, c: M.wl.c };
    else if (tool === 'zoom') drag = { kind: 'zoom', y: e.clientY, z: M.view[id].zoom };
    else if (tool === 'pan') drag = { kind: 'pan', x: e.clientX, y: e.clientY, pan: [...M.view[id].pan] as [number, number] };
    else { const p = toPat(seg, X, Y), n = seg.map.P.n; drag = { kind: 'measure', a: p, b: p, n, d: dot3(n, M.c) }; }
  });
  seg.cv.addEventListener('pointermove', (e) => {
    const [X, Y] = pxy(seg, e);
    if (!drag) {
      if (M.tool === 'cross' && seg.map) {
        const h = hitCross(seg, X, Y);
        seg.cv.style.cursor = !h ? 'crosshair' : h.kind === 'rot' ? 'alias' : h.kind === 'center' ? 'move' : 'grab';
      }
      return;
    }
    const m = seg.map!;
    switch (drag.kind) {
      case 'rot': M.R = rotate(drag.R0, drag.axis, Math.atan2(Y - drag.cy, X - drag.cx) - drag.a0); break;
      case 'center': M.c = toPat(seg, X, Y); break;
      case 'line': { const p = toPat(seg, X, Y); M.c = add3(drag.c0, drag.n, dot3([p[0] - drag.p0[0], p[1] - drag.p0[1], p[2] - drag.p0[2]], drag.n)); break; }
      case 'wl': { const k = Math.max(1, drag.w / 300); M.wl = { w: Math.max(1, Math.round(drag.w + (e.clientX - drag.x) * k)), c: Math.round(drag.c + (e.clientY - drag.y) * k) }; break; }
      case 'zoom': M.view[id].zoom = clamp(drag.z * Math.exp((drag.y - e.clientY) / 150), 0.3, 12); break;
      case 'pan': { const { cw, ch } = canvasSize(seg.cv); M.view[id].pan = [drag.pan[0] - ((e.clientX - drag.x) / cw) * m.fovW, drag.pan[1] - ((e.clientY - drag.y) / ch) * m.fovH]; break; }
      case 'measure': drag.b = toPat(seg, X, Y); renderView(id, true); drawMeasures(seg, seg.cv.getContext('2d')!, drag); return;
    }
    schedule(true);
  });
  const end = () => {
    if (drag?.kind === 'measure') {
      const len = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1], drag.b[2] - drag.a[2]);
      if (len > 1) { M.meas.push({ a: drag.a, b: drag.b, n: drag.n, d: drag.d }); setMsg(`Distancia: ${len.toFixed(1)} mm.`, 'ok'); }
    }
    if (drag?.kind === 'rot') setMsg(`Plano oblicuo: ${VIEWS.map((v) => `${NAMES[v]} → ${planeName(viewPlane(M.R, v).n)}`).join(' · ')}`, 'ok');
    drag = null;
    schedule(false);
  };
  seg.cv.addEventListener('pointerup', end);
  seg.cv.addEventListener('pointercancel', end);
  seg.cv.addEventListener('wheel', (e) => {
    if (!M.vol || !seg.map) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) M.view[id].zoom = clamp(M.view[id].zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.3, 12);
    else M.c = add3(M.c, seg.map.P.n, (e.deltaY > 0 ? 1 : -1) * minSp());
    schedule(true);
    clearTimeout(wheelT);
    wheelT = window.setTimeout(() => schedule(false), 160);
  }, { passive: false });
  seg.cv.addEventListener('dblclick', () => { M.view[id] = { zoom: 1, pan: [0, 0] }; schedule(false); });
}
let wheelT = 0;

function bindResult(seg: Seg) {
  let drag: { x: number; y: number; w: number; c: number } | null = null;
  seg.cv.addEventListener('contextmenu', (e) => e.preventDefault());
  seg.cv.addEventListener('wheel', (e) => { if (M.res < 0) return; e.preventDefault(); M.resSlice += e.deltaY > 0 ? 1 : -1; renderResult(); }, { passive: false });
  seg.el.querySelectorAll<HTMLButtonElement>('.snav button').forEach((b) => b.addEventListener('click', () => { M.resSlice += Number(b.dataset.s); renderResult(); }));
  seg.cv.addEventListener('pointerdown', (e) => { const r = M.results[M.res]; if (!r) return; seg.cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, w: r.wl.w, c: r.wl.c }; });
  seg.cv.addEventListener('pointermove', (e) => {
    const r = M.results[M.res];
    if (!drag || !r) return;
    const k = Math.max(1, drag.w / 300);
    r.wl = { w: Math.max(1, Math.round(drag.w + (e.clientX - drag.x) * k)), c: Math.round(drag.c + (e.clientY - drag.y) * k) };
    renderResult();
  });
  seg.cv.addEventListener('pointerup', () => (drag = null));
}

/* ---------- volumes ---------- */
function reset(keepWindow = false) {
  const V = M.vol;
  M.R = IDENTITY;
  M.view = { tra: { zoom: 1, pan: [0, 0] }, sag: { zoom: 1, pan: [0, 0] }, cor: { zoom: 1, pan: [0, 0] } };
  if (V) { M.c = volumeCenter(V); if (!keepWindow) M.wl = autoWindow(V.data); }
  schedule(false);
}

function selectVolume(i: number) {
  M.vol = M.vols[i] ?? null;
  M.meas = [];
  renderList();
  reset();
  const V = M.vol;
  if (V) {
    setMsg(`${V.info.desc}: ${V.nx}×${V.ny}×${V.nz}, vóxel ${V.sx.toFixed(2)}×${V.sy.toFixed(2)}×${V.sz.toFixed(2)} mm.${V.warnings.length ? ' ' + V.warnings[0] : ''}`, V.warnings.length ? 'warn' : 'ok');
  }
  document.querySelectorAll<HTMLElement>('#view3D .mempty').forEach((el) => (el.hidden = !!V));
}

/* ---------- use the loaded series as a console patient ---------- */
const WEIGHTINGS: Weighting[] = ['T1', 'T2', 'PD', 'FLAIR', 'STIR', 'T2*', 'DWI', 'ADC', 'otro'];
const use = new Map<string, { on: boolean; w: Weighting }>();
let studies = 0;

export interface StudyResult { name: string; mode: 'replay' | 'synthetic'; phantom: PhantomData; replay?: { weighting: Weighting; desc: string; b?: number }[]; summary: string }
let onStudy: ((r: StudyResult) => void) | null = null;
export function onUseStudy(cb: (r: StudyResult) => void): void { onStudy = cb; }

function useState(v: MprVolume) {
  let u = use.get(v.id);
  if (!u) { u = { on: v.volumetric || v.info.b !== undefined || /adc/i.test(v.info.desc), w: v.id === 'demo' ? 'T1' : guessWeighting(v.info) }; use.set(v.id, u); }
  return u;
}
const mode = () => (($('#useSynth') as HTMLInputElement).checked ? 'synthetic' : 'replay');
const chosen = (): StudySeries[] => M.vols.filter((v) => useState(v).on).map((v) => ({ vol: v, weighting: useState(v).w, desc: v.info.desc, volumetric: v.volumetric, b: v.info.b }));

function renderUse() {
  const has = M.vols.length > 0;
  $('#useIntro').textContent = has ? 'Marca las series del estudio y revisa la potenciación detectada.' : 'Carga series para convertirlas en un paciente de la consola.';
  $('#useTable').hidden = !has;
  $('#useModes').hidden = !has;
  $('#useBody').innerHTML = M.vols.map((v, i) => {
    const u = useState(v);
    return `<tr><td><input type="checkbox" id="use-on-${i}" data-i="${i}" ${u.on ? 'checked' : ''} aria-label="Usar ${esc(v.info.desc)}"></td><td><label for="use-on-${i}">${esc(v.info.desc)}</label></td><td><select id="use-w-${i}" data-i="${i}" aria-label="Potenciación de ${esc(v.info.desc)}">${WEIGHTINGS.map((w) => `<option ${w === u.w ? 'selected' : ''}>${w}</option>`).join('')}</select></td></tr>`;
  }).join('');
  useHint();
}

function useHint() {
  const s = chosen(), hint = $('#useHint'), btn = $('#useCreate') as HTMLButtonElement;
  let txt = '', ok = s.length > 0, err = false;
  if (!s.length) txt = M.vols.length ? 'Marca al menos una serie.' : '';
  else if (mode() === 'replay') {
    const ws = [...new Set(s.map((x) => x.weighting))].join(', ');
    txt = `${s.length} serie${s.length > 1 ? 's' : ''} (${ws}). Cada protocolo usará la de potenciación más parecida.`;
    if (!s.some((x) => x.volumetric)) txt += ' Ninguna es volumétrica: los localizers y los planos oblicuos se verán escalonados.';
  } else {
    const ref = referenceSeries(s);
    const has = (w: Weighting) => s.some((x) => x.weighting === w);
    if (!ref || ref.weighting !== 'T1' || !ref.volumetric) { txt = 'Falta una serie T1 volumétrica.'; ok = false; err = true; }
    else txt = `T1 ✓ · T2 ${has('T2') || has('STIR') ? '✓' : '— (la grasa se confundirá con sustancia blanca)'} · FLAIR ${has('FLAIR') ? '✓' : '—'} · ADC/DWI ${has('ADC') || has('DWI') ? '✓' : '—'}`;
  }
  hint.textContent = txt;
  hint.classList.toggle('err', err);
  btn.disabled = !ok;
}

async function createStudy() {
  const s = chosen(), m = mode(), btn = $('#useCreate') as HTMLButtonElement, hint = $('#useHint');
  if (!s.length || !onStudy) return;
  btn.disabled = true;
  try {
    studies++;
    let res: StudyResult;
    if (m === 'replay') {
      const phantom = buildReplay(s);
      const replay = phantom.type === 'replay' ? phantom.sources.map((x) => ({ weighting: x.weighting, desc: x.desc, b: x.b })) : [];
      res = { name: `Estudio ${studies} · anatomía real`, mode: m, phantom, replay, summary: `${replay.length} series: ${replay.map((x) => `${x.desc} (${x.weighting})`).join(', ')}` };
    } else {
      const { phantom, stats } = await buildSynthetic(s, (msg) => (hint.textContent = msg));
      const pct = (k: string) => `${k} ${Math.round((stats.frac[k] ?? 0) * 100)}%`;
      res = {
        name: `Estudio ${studies} · contraste sintético`, mode: m, phantom,
        summary: `Canales ${stats.channels.join(' + ')}, vóxel ${stats.mm.toFixed(1)} mm: ${['SB', 'SG', 'LCR', 'grasa'].map(pct).join(', ')}${stats.lesionMl ? `, lesiones ${stats.lesionMl.toFixed(1)} ml` : ''}${stats.infarctMl ? `, restricción ${stats.infarctMl.toFixed(1)} ml` : ''}.`,
      };
    }
    onStudy(res);
    $('#useState').textContent = `${studies} creado${studies > 1 ? 's' : ''}`;
    hint.textContent = `${res.name} creado. ${res.summary}`;
  } catch (e) {
    studies--;
    hint.textContent = (e as Error).message;
    hint.classList.add('err');
  } finally {
    btn.disabled = false;
  }
}

function renderList() {
  renderUse();
  $('#mprList').innerHTML = M.vols.map((v, i) => `<li class="${v === M.vol ? 'sel' : ''}" data-i="${i}" tabindex="0">
      <span class="vn">${esc(v.info.desc)}</span>
      <span class="vm">${v.nx}×${v.ny}×${v.nz} · ${v.sx.toFixed(2)}×${v.sy.toFixed(2)}×${v.sz.toFixed(2)} mm · ${esc(v.info.ts)}</span>
      ${v.warnings.length ? `<span class="vw">${esc(v.warnings.join(' '))}</span>` : ''}
    </li>`).join('');
}

function renderReport(rep: LoadReport, found: number) {
  const phi = [...rep.phi], uns = [...rep.unsupported];
  $('#mprReport').innerHTML = `<div class="anon"><b>Anonimización local:</b> ${rep.read} de ${rep.files} archivos leídos${rep.skipped ? `, ${rep.skipped} omitidos` : ''}; ${found} volumen${found === 1 ? '' : 'es'}.
    ${uns.length ? `<br>Sin soporte: ${uns.map(([n, c]) => `${c} en ${esc(n)}`).join(', ')}. Expórtalos sin compresión o conviértelos con dcm2niix.` : ''}
    ${phi.length ? `<details><summary>${phi.length} datos identificatorios${rep.priv ? ` y ${rep.priv} tags privados` : ''} descartados</summary><ul>${phi.map((x) => `<li>${x}</li>`).join('')}</ul></details>` : ''}
    Se conservan solo los píxeles, la geometría y los parámetros de adquisición. Nada sale de este navegador.</div>`;
}

async function onFiles(list: FileList | null) {
  const files = list ? [...list] : [];
  if (!files.length) return;
  $('#mprReport').innerHTML = '<p>Leyendo…</p>';
  const { volumes, report } = await loadVolumes(files, (d, t) => { $('#mprReport').innerHTML = `<p>Leyendo ${d} de ${t} archivos…</p>`; });
  renderReport(report, volumes.length);
  if (!volumes.length) { setMsg('No se encontró ninguna serie con varias imágenes y geometría DICOM.', 'err'); return; }
  M.vols.push(...volumes);
  selectVolume(M.vols.indexOf(volumes[0]));
  $('#mprState').textContent = `${M.vols.length} cargada${M.vols.length === 1 ? '' : 's'}`;
}

/** Example volume: a synthetic 3D T1 gradient echo computed from BrainWeb, so the task works without data. */
function demoVolume(ph: PhantomData): MprVolume | null {
  if (ph.type !== 'labels') return null;
  const sig = signals({ name: 'demo', seq: 'gre', loc: false, TR: 11, TE: 4.2, TI: 0, FA: 15, refFA: 0, ETL: 1, bw: 200, nex: 1, slices: 1, thick: 1, dist: 0, pos: 0, offX: 0, offY: 0, tilt: 0, tiltS: 0, rot: 0, fovRead: 256, fovPh: 100, base: 256, phRes: 100, os: 0, phaseDir: 'AP', pat: 1, prep: 'none', fat: 'none', b: 0, rf: 'normal', interp: 'on', B0: 1.5, phantom: 'bw', path: 'normal' });
  sig[3] *= 0.6; // MPRAGE-like dark CSF
  const src = ph.vol.data, data = new Int16Array(src.length), r = rng(3);
  for (let i = 0; i < src.length; i++) data[i] = Math.max(0, Math.round(sig[src[i] & 63] * 9000 + (r() - 0.5) * 60));
  return { ...ph.vol, data, id: 'demo', info: { desc: 'Ejemplo · T1 3D sintético (BrainWeb)', TR: 11, TE: 4.2, FA: 15, B0: 1.5, ts: 'ejemplo' }, warnings: [], volumetric: true };
}

export function setDemoSource(ph: PhantomData): void {
  M.demo = ph;
  ($('#mprDemo') as HTMLButtonElement).disabled = false;
}

/* ---------- parallel range ---------- */
function createRange() {
  const V = M.vol;
  if (!V) return;
  const B = M.range.base, seg = segs[B];
  const { cw, ch } = canvasSize(seg.cv);
  const map = viewMap(B, cw, ch), P = map.P;
  const sp = Math.min(V.sx, V.sy, V.sz);
  const W = Math.min(512, Math.round(map.fovW / sp)), H = Math.min(512, Math.round(map.fovH / sp));
  const centers = rangeCenters(M.c, P.n, M.range.count, M.range.spacing);
  const D = centers.map((C) => add3(map.D, P.n, dot3([C[0] - map.D[0], C[1] - map.D[1], C[2] - map.D[2]], P.n)));
  const slab = { thick: M.range.thick, mode: (M.range.thick > sp ? 'avg' : 'mpr') as SlabMode };
  const imgs = D.map((d) => reformat(V, d, P, map.fovW, map.fovH, W, H, slab));
  const name = `MPR ${planeName(P.n)} ${M.range.thick.toFixed(1)}/${M.range.spacing.toFixed(1)} ×${M.range.count}`;
  M.results.push({ name, P, D, fovW: map.fovW, fovH: map.fovH, W, H, imgs, wl: { ...M.wl } });
  M.res = M.results.length - 1;
  M.resSlice = Math.floor(imgs.length / 2);
  renderResults();
  renderResult();
  setMsg(`Serie creada: ${name}.`, 'ok');
}

function renderResults() {
  $('#mprResults').innerHTML = M.results.map((r, i) => `<li class="${i === M.res ? 'sel' : ''}" data-i="${i}" tabindex="0">${esc(r.name)}</li>`).join('');
}

/* ---------- setup ---------- */
export function initMpr(): void {
  segs = { tra: makeSeg('tra', '#mTra'), sag: makeSeg('sag', '#mSag'), cor: makeSeg('cor', '#mCor'), res: makeSeg('res', '#mRes') };
  VIEWS.forEach((v) => bindView(segs[v]));
  bindResult(segs.res);
  new ResizeObserver(() => { schedule(false); renderResult(); }).observe($('#mprGrid'));

  for (const id of ['#mprFiles', '#mprDir']) {
    const el = $(id) as HTMLInputElement;
    el.addEventListener('change', () => { void onFiles(el.files); el.value = ''; });
  }
  $('#mprDemo').addEventListener('click', () => {
    if (!M.demo) return;
    let i = M.vols.findIndex((v) => v.id === 'demo');
    if (i < 0) { const d = demoVolume(M.demo); if (!d) return; M.vols.push(d); i = M.vols.length - 1; }
    selectVolume(i);
  });
  const pick = (e: Event) => { const li = (e.target as HTMLElement).closest<HTMLElement>('#mprList li'); if (li) selectVolume(Number(li.dataset.i)); };
  $('#mprList').addEventListener('click', pick);
  $('#mprList').addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(e); });

  $('#mprTools').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
    if (!b) return;
    M.tool = b.dataset.tool as Tool;
    document.querySelectorAll('#mprTools [data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    schedule(false);
  });
  const mode = $('#mprMode') as HTMLSelectElement, thick = $('#mprThick') as HTMLInputElement;
  const applySlab = () => {
    M.slab.mode = mode.value as SlabMode;
    M.slab.thick = clamp(parseFloat(thick.value.replace(',', '.')) || 1, 0.5, 100);
    thick.value = M.slab.thick.toFixed(1);
    thick.disabled = M.slab.mode === 'mpr';
    schedule(false);
  };
  mode.addEventListener('change', applySlab);
  thick.addEventListener('change', applySlab);
  $('#mprReset').addEventListener('click', () => { reset(); setMsg('Planos, zoom y ventana restablecidos.', 'ok'); });
  $('#mprClearMeas').addEventListener('click', () => { M.meas = []; schedule(false); });

  const rf = (id: string) => $(id) as HTMLInputElement;
  const applyRange = () => {
    M.range.base = ($('#rgBase') as HTMLSelectElement).value as ViewId;
    M.range.count = clamp(Math.round(Number(rf('#rgCount').value) || 1), 1, 200);
    M.range.thick = clamp(parseFloat(rf('#rgThick').value.replace(',', '.')) || 1, 0.5, 20);
    M.range.spacing = clamp(parseFloat(rf('#rgSpacing').value.replace(',', '.')) || M.range.thick, 0.5, 40);
    M.range.show = rf('#rgShow').checked;
    rf('#rgCount').value = String(M.range.count); rf('#rgThick').value = M.range.thick.toFixed(1); rf('#rgSpacing').value = M.range.spacing.toFixed(1);
    $('#rgCover').textContent = `Cubre ${((M.range.count - 1) * M.range.spacing + M.range.thick).toFixed(0)} mm`;
    schedule(false);
  };
  ['#rgBase', '#rgCount', '#rgThick', '#rgSpacing', '#rgShow'].forEach((s) => $(s).addEventListener('change', applyRange));
  applyRange();
  $('#rgCreate').addEventListener('click', createRange);
  $('#useBody').addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement, v = M.vols[Number(el.dataset.i)];
    if (!v) return;
    const u = useState(v);
    if (el instanceof HTMLInputElement) u.on = el.checked; else u.w = el.value as Weighting;
    useHint();
  });
  $('#useModes').addEventListener('change', useHint);
  $('#useCreate').addEventListener('click', () => void createStudy());
  $('#mprResults').addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li');
    if (!li) return;
    M.res = Number(li.dataset.i); M.resSlice = Math.floor(M.results[M.res].imgs.length / 2);
    renderResults(); renderResult();
  });
}

/** Forget every loaded volume, reformatted series, measurement and study. */
export function clearMpr(): void {
  M.vols = []; M.vol = null; M.results = []; M.res = -1; M.resSlice = 0; M.meas = [];
  use.clear();
  studies = 0;
  $('#mprReport').innerHTML = '';
  $('#mprState').textContent = 'local';
  $('#useState').textContent = '';
  renderList();
  renderResults();
  document.querySelectorAll<HTMLElement>('#view3D .mempty').forEach((el) => (el.hidden = false));
  schedule(false);
  renderResult();
}

export const mprCounts = () => ({ volumes: M.vols.filter((v) => v.id !== 'demo').length, studies });

export function showMpr(): void {
  requestAnimationFrame(() => { schedule(false); renderResult(); });
}

/** Exposed for the browser test. */
export const _mprState = M;
