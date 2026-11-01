// Image segments: three localizers with graphic slice positioning, the live preview and the measured series.
import type { Img, Plane, PlaneGeom, Scan, Vec3 } from '../core/types';
import { add3, clamp, dot3, f1, fmtTA } from '../core/util';
import { derive, normalize, type Protocol } from '../physics/protocol';
import { compute } from '../imaging/engine';
import { geomLoc, geomSlice, LOCG } from '../imaging/geometry';
import { autoWL } from '../imaging/render';
import { refreshCardValues, renderCard } from './card';
import { $, setMsg } from './dom';
import { F, fmtVal, type NumField } from './fields';
import { renderQueue } from './queue';
import { locDone, previewScan, sel, state } from './state';

type Kind = 'loc' | 'preview' | 'series';
interface Rect { ox: number; oy: number; sc: number; dpr: number }
export interface Seg {
  el: HTMLElement;
  kind: Kind;
  plane?: Plane;
  cv: HTMLCanvasElement;
  ov: HTMLElement[];
  off: HTMLCanvasElement;
  slice: number;
  wl: { w: number; c: number };
  userWL: boolean;
  img: Img | null;
  key: string;
  pid: number | null;
  geom: PlaneGeom | null;
  rect: Rect | null;
  busy: boolean;
  again: boolean;
}

function makeSeg(id: string, kind: Kind, plane?: Plane): Seg {
  const el = $(id);
  return {
    el, kind, plane, cv: el.querySelector('canvas')!, ov: [...el.querySelectorAll<HTMLElement>('.ov')], off: document.createElement('canvas'),
    slice: 0, wl: { w: 1, c: 0 }, userWL: false, img: null, key: '', pid: null, geom: null, rect: null, busy: false, again: false,
  };
}

export const segA = makeSeg('#segA', 'preview');
export const segB = makeSeg('#segB', 'series');
const locSegs = [makeSeg('#segSag', 'loc', 'sag'), makeSeg('#segCor', 'loc', 'cor'), makeSeg('#segTra', 'loc', 'tra')];
export const allSegs = [...locSegs, segA, segB];

const overlayPatient = (): string => {
  const P = state.patient;
  return P ? `${P.last}^${P.first}\n${P.id}\n${P.sex} ${P.age}Y ${P.w}kg` : '';
};

function segParams(seg: Seg): { p: Protocol; pp: Scan } | null {
  if (seg.kind === 'preview') { const p = sel(); return p ? { p, pp: previewScan(p) } : null; }
  if (seg.kind === 'loc') { const p = locDone(); return p?.snap ? { p, pp: p.snap } : null; }
  const p = state.queue.find((q) => q.id === seg.pid);
  return p?.snap ? { p, pp: p.snap } : null;
}

const orientTxt = (pp: Scan) => (pp.tilt ? `Tra>Cor(${pp.tilt > 0 ? '' : '-'}${Math.abs(pp.tilt).toFixed(1)})` : 'Tra');

/** Recompute a segment. Requests that arrive while one is running collapse into a single follow-up. */
export async function updateSeg(seg: Seg): Promise<void> {
  if (seg.busy) { seg.again = true; return; }
  seg.busy = true;
  try {
    do { seg.again = false; await updateOnce(seg); } while (seg.again);
  } finally {
    seg.busy = false;
  }
}

async function updateOnce(seg: Seg): Promise<void> {
  const sp = segParams(seg);
  const empty = seg.el.querySelector<HTMLElement>('.empty');
  if (empty) empty.hidden = !!sp;
  if (!sp) {
    seg.img = null; seg.geom = null; seg.key = '';
    seg.ov.forEach((o) => (o.textContent = ''));
    drawSeg(seg);
    return;
  }
  const { p, pp } = sp;
  if (seg.kind === 'loc') {
    const plane = seg.plane!;
    seg.img = p.locImgs![plane];
    seg.geom = geomLoc(pp, plane);
    if (seg.key !== p.id + plane) { seg.key = p.id + plane; seg.userWL = false; }
    if (!seg.userWL) seg.wl = autoWL(seg.img);
    mapWL(seg);
    seg.ov[0].textContent = `${overlayPatient()}\nSe: ${p.series}  ${seg.geom.name}`;
    seg.ov[1].textContent = `W ${seg.wl.w}\nC ${seg.wl.c}`;
    drawSeg(seg);
    return;
  }
  const nS = pp.loc ? 1 : pp.slices;
  seg.slice = clamp(seg.slice, 0, nS - 1);
  const g = pp.loc ? geomLoc(pp, 'tra') : geomSlice(pp, seg.slice);
  const key = JSON.stringify(pp) + '|' + seg.slice;
  if (key !== seg.key) {
    const img = await compute(pp, g, p.seed + seg.slice * 101);
    if (seg.again) return; // a newer request is waiting; skip drawing a stale image
    seg.img = img; seg.key = key;
    if (!seg.userWL) seg.wl = autoWL(img);
    mapWL(seg);
  }
  seg.geom = g;
  const d = derive(pp, pp.B0);
  const fovP = (pp.fovRead * pp.fovPh) / 100;
  const fovStr = pp.phaseDir === 'RL' ? `${Math.round(fovP)}*${pp.fovRead}` : `${pp.fovRead}*${Math.round(fovP)}`;
  const z = g.C[2];
  seg.ov[0].textContent = `${overlayPatient()}\nHead^Brain`;
  seg.ov[1].textContent = `Resonador ${pp.B0} T\n${seg.kind === 'series' ? 'Se: ' + p.series : 'Protocolo abierto'}\nIm: ${seg.slice + 1}/${nS}\n${new Date().toLocaleDateString('es-CL')}`;
  seg.ov[2].textContent = `SP ${z >= 0 ? 'H' : 'F'}${Math.abs(z).toFixed(1)}\nSL ${pp.thick.toFixed(1)}\nFoV ${fovStr}\n${pp.loc ? 'Tra' : orientTxt(pp)}>${pp.phaseDir === 'RL' ? 'R>>L' : 'A>>P'}\nTR ${f1(pp.TR)}${pp.prep === 'ir' ? '  TI ' + pp.TI : ''}\nTE ${f1(pp.TE)}${pp.seq === 'gre' ? '  FA ' + pp.FA : ''}${pp.seq === 'epi' ? '  b ' + pp.b : ''}\nTA ${fmtTA(d.TA)}  BW ${pp.bw}\n${pp.name}`;
  seg.ov[3].textContent = `W ${seg.wl.w}\nC ${seg.wl.c}`;
  drawSeg(seg);
}

function mapWL(seg: Seg): void {
  const im = seg.img;
  if (!im) return;
  seg.off.width = im.W;
  seg.off.height = im.H;
  const ctx = seg.off.getContext('2d')!, id = ctx.createImageData(im.W, im.H);
  const lo = seg.wl.c - seg.wl.w / 2, sc = 255 / Math.max(1, seg.wl.w);
  for (let k = 0; k < im.data.length; k++) {
    const v = clamp((im.data[k] - lo) * sc, 0, 255);
    id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v;
    id.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

export function drawSeg(seg: Seg): void {
  const cv = seg.cv, r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width) return;
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const im = seg.img;
  if (!im) { seg.rect = null; return; }
  const sp = segParams(seg);
  const s = Math.min(cv.width / im.fovW, cv.height / im.fovH) * 0.94, dw = im.fovW * s, dh = im.fovH * s;
  seg.rect = { ox: (cv.width - dw) / 2, oy: (cv.height - dh) / 2, sc: s, dpr };
  ctx.imageSmoothingEnabled = seg.kind === 'loc' || !sp || sp.pp.interp === 'on';
  ctx.drawImage(seg.off, seg.rect.ox, seg.rect.oy, dw, dh);
  if (seg.kind === 'loc') drawPlan(seg, ctx);
}

/* ---------- graphic slice positioning ---------- */
function planProt() {
  const p = sel();
  if (!p || p.loc) return null;
  return { p, pp: p.state === 'done' && p.snap ? p.snap : p, edit: p.state === 'pending' };
}
function toCan(seg: Seg, P: Vec3): [number, number] {
  const g = seg.geom!, r = seg.rect!, d = [P[0] - g.C[0], P[1] - g.C[1], P[2] - g.C[2]];
  return [r.ox + (dot3(d, g.u) + g.fovW / 2) * r.sc, r.oy + (dot3(d, g.v) + g.fovH / 2) * r.sc];
}
function toPat(seg: Seg, X: number, Y: number): Vec3 {
  const g = seg.geom!, r = seg.rect!, a = (X - r.ox) / r.sc - g.fovW / 2, b = (Y - r.oy) / r.sc - g.fovH / 2;
  return [g.C[0] + a * g.u[0] + b * g.v[0], g.C[1] + a * g.u[1] + b * g.v[1], g.C[2] + a * g.u[2] + b * g.v[2]];
}
interface Frame { C: Vec3; u: Vec3; v: Vec3; n: Vec3; fu: number; fv: number; half: number; step: number }
function groupFrame(pp: Scan | Protocol): Frame {
  const g = geomSlice(pp, (pp.slices - 1) / 2);
  const step = pp.thick * (1 + pp.dist / 100);
  return { C: [pp.offX, pp.offY, pp.pos], u: g.u, v: g.v, n: g.n!, fu: g.fovW, fv: g.fovH, half: ((pp.slices - 1) / 2) * step + pp.thick / 2, step };
}
const handlePos = (fr: Frame): Vec3 => add3(fr.C, fr.v, -(fr.fv / 2 + 12));

function drawPlan(seg: Seg, ctx: CanvasRenderingContext2D): void {
  const pr = planProt();
  if (!pr || !seg.rect || !seg.geom) return;
  const { pp, edit } = pr, fr = groupFrame(pp), dpr = seg.rect.dpr;
  const col = edit ? '#ef8f2f' : '#9aa3aa', colC = edit ? '#ffd27a' : '#c8ced3';
  ctx.save();
  const line = (A: Vec3, B: Vec3, c: string, w: number, dash?: number[]) => {
    const a = toCan(seg, A), b = toCan(seg, B);
    ctx.strokeStyle = c; ctx.lineWidth = w * dpr; ctx.setLineDash(dash ? dash.map((x) => x * dpr) : []);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  const mid = (pp.slices - 1) / 2;
  const ci = (i: number) => add3(fr.C, fr.n, (i - mid) * fr.step);
  if (seg.plane === 'sag') {
    for (let i = 0; i < pp.slices; i++) {
      const c = ci(i), cen = Math.abs(i - mid) < 0.6;
      line(add3(c, fr.v, -fr.fv / 2), add3(c, fr.v, fr.fv / 2), cen ? colC : col, cen ? 1.6 : 1);
    }
    const A = add3(fr.C, fr.n, -fr.half), B = add3(fr.C, fr.n, fr.half);
    const corners = [add3(A, fr.v, -fr.fv / 2), add3(B, fr.v, -fr.fv / 2), add3(B, fr.v, fr.fv / 2), add3(A, fr.v, fr.fv / 2)];
    for (let k = 0; k < 4; k++) line(corners[k], corners[(k + 1) % 4], col, 1, [4, 3]);
    if (edit) {
      const h = toCan(seg, handlePos(fr)), e = toCan(seg, add3(fr.C, fr.v, -fr.fv / 2));
      ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(h[0], h[1]); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(h[0], h[1], 4.5 * dpr, 0, 7); ctx.fill();
    }
  } else if (seg.plane === 'cor') {
    const yl = LOCG.cor.C[1], ca = fr.v[1];
    for (let i = 0; i < pp.slices; i++) {
      const c = ci(i), bq = (yl - c[1]) / ca;
      if (Math.abs(bq) > fr.fv / 2) continue;
      const q = add3(c, fr.v, bq), cen = Math.abs(i - mid) < 0.6;
      line(add3(q, fr.u, -fr.fu / 2), add3(q, fr.u, fr.fu / 2), cen ? colC : col, cen ? 1.6 : 1);
    }
  } else {
    const box = (ku: number, kv: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add3(add3(fr.C, fr.u, (a * fr.fu * ku) / 2), fr.v, (b * fr.fv * kv) / 2));
    const corners = box(1, 1);
    for (let k = 0; k < 4; k++) line(corners[k], corners[(k + 1) % 4], col, 1.3);
    const ph = pp.phaseDir === 'RL';
    if (pp.os > 0) { // phase oversampling region, dotted, along the phase axis
      const osk = 1 + pp.os / 100, oc = box(ph ? osk : 1, ph ? 1 : osk);
      for (let k = 0; k < 4; k++) line(oc[k], oc[(k + 1) % 4], col, 1, [2, 3]);
    }
    const ax = ph ? fr.u : fr.v, len = (ph ? fr.fu : fr.fv) / 2;
    const a = toCan(seg, add3(fr.C, ax, -len * 0.25)), b = toCan(seg, add3(fr.C, ax, len * 0.25));
    ctx.setLineDash([]); ctx.strokeStyle = colC; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.fillStyle = colC; ctx.font = `${10 * dpr}px "IBM Plex Mono",monospace`; ctx.fillText('ph', b[0] + 3 * dpr, b[1] - 3 * dpr);
  }
  const lab = toCan(seg, seg.plane === 'tra' ? add3(add3(fr.C, fr.u, -fr.fu / 2), fr.v, -fr.fv / 2) : add3(add3(fr.C, fr.n, fr.half), fr.v, -fr.fv / 2));
  ctx.fillStyle = col; ctx.font = `600 ${11 * dpr}px "IBM Plex Mono",monospace`; ctx.fillText('1', lab[0] + 3 * dpr, lab[1] - 4 * dpr);
  ctx.restore();
}

function hitPlan(seg: Seg, X: number, Y: number): 'move' | 'rot' | null {
  const pr = planProt();
  if (!pr || !pr.edit || !seg.rect || !seg.geom) return null;
  const fr = groupFrame(pr.pp);
  if (seg.plane === 'sag') { const h = toCan(seg, handlePos(fr)); if (Math.hypot(X - h[0], Y - h[1]) < 10 * seg.rect.dpr) return 'rot'; }
  const P = toPat(seg, X, Y), d = [P[0] - fr.C[0], P[1] - fr.C[1], P[2] - fr.C[2]];
  const du = dot3(d, fr.u), dv = dot3(d, fr.v), dn = dot3(d, fr.n), m = 4;
  if (seg.plane === 'sag') return Math.abs(dn) <= fr.half + m && Math.abs(dv) <= fr.fv / 2 + m ? 'move' : null;
  if (seg.plane === 'cor') return Math.abs(dn) <= fr.half + m && Math.abs(du) <= fr.fu / 2 + m ? 'move' : null;
  return Math.abs(du) <= fr.fu / 2 + m && Math.abs(dv) <= fr.fv / 2 + m ? 'move' : null;
}

let planRaf = 0;
function planChanged(): void {
  cancelAnimationFrame(planRaf);
  planRaf = requestAnimationFrame(() => {
    const p = sel();
    if (p) normalize(p);
    refreshCardValues();
    locSegs.forEach(drawSeg);
    void updateSeg(segA);
    renderQueue();
  });
}

export function drawLocs(): void { locSegs.forEach((s) => void updateSeg(s)); }

let rafA = 0;
export function refreshPreview(): void {
  cancelAnimationFrame(rafA);
  rafA = requestAnimationFrame(() => void updateSeg(segA));
}

export function showSeries(p: Protocol): void {
  segB.pid = p.id;
  segB.slice = p.loc || !p.snap ? 0 : Math.floor((p.snap.slices - 1) / 2);
  segB.userWL = false;
  segB.key = '';
  void updateSeg(segB);
}

export function clearSeries(): void { segB.pid = null; segB.key = ''; segB.img = null; void updateSeg(segB); }

const lim = (k: string) => F[k] as NumField;

function bindSeg(seg: Seg): void {
  seg.cv.addEventListener('wheel', (e) => {
    if (seg.kind === 'loc') return;
    e.preventDefault();
    seg.slice += e.deltaY > 0 ? 1 : -1;
    void updateSeg(seg);
  }, { passive: false });
  seg.el.querySelectorAll<HTMLButtonElement>('.snav button').forEach((b) => b.addEventListener('click', () => { seg.slice += Number(b.dataset.s); void updateSeg(seg); }));
  type Drag = { mode: 'wl'; x: number; y: number; w: number; c: number } | { mode: 'move' | 'rot'; P0: Vec3; C0: Vec3 };
  let drag: Drag | null = null;
  const xy = (e: PointerEvent): [number, number] => {
    const r = seg.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  };
  seg.cv.addEventListener('pointerdown', (e) => {
    if (!seg.img) return;
    document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('act', s === seg.el));
    seg.cv.setPointerCapture(e.pointerId);
    const [X, Y] = xy(e);
    const mode = seg.kind === 'loc' ? hitPlan(seg, X, Y) : null;
    const p = sel();
    if (mode && p) { drag = { mode, P0: toPat(seg, X, Y), C0: [p.offX, p.offY, p.pos] }; return; }
    drag = { mode: 'wl', x: e.clientX, y: e.clientY, w: seg.wl.w, c: seg.wl.c };
  });
  seg.cv.addEventListener('pointermove', (e) => {
    const [X, Y] = xy(e);
    if (!drag) {
      if (seg.kind === 'loc') {
        const m = hitPlan(seg, X, Y);
        seg.cv.classList.toggle('grab', m === 'move');
        seg.cv.classList.toggle('rot', m === 'rot');
      }
      return;
    }
    if (drag.mode === 'wl') {
      const k = Math.max(2, drag.w / 250);
      seg.wl = { w: Math.max(1, Math.round(drag.w + (e.clientX - drag.x) * k)), c: Math.round(drag.c + (e.clientY - drag.y) * k) };
      seg.userWL = true;
      mapWL(seg);
      seg.ov[seg.kind === 'loc' ? 1 : 3].textContent = `W ${seg.wl.w}\nC ${seg.wl.c}`;
      drawSeg(seg);
      return;
    }
    const p = sel();
    if (!p) return;
    const P = toPat(seg, X, Y);
    if (drag.mode === 'move') {
      p.offX = Math.round(clamp(drag.C0[0] + P[0] - drag.P0[0], lim('offX').min, lim('offX').max) * 10) / 10;
      p.offY = Math.round(clamp(drag.C0[1] + P[1] - drag.P0[1], lim('offY').min, lim('offY').max) * 10) / 10;
      p.pos = Math.round(clamp(drag.C0[2] + P[2] - drag.P0[2], lim('pos').min, lim('pos').max) * 10) / 10;
    } else {
      const dy = drag.C0[1] - P[1], dz = drag.C0[2] - P[2];
      p.tilt = Math.round(clamp((Math.atan2(dz, dy) * 180) / Math.PI, -45, 45) * 2) / 2;
    }
    planChanged();
  });
  const end = () => {
    if (drag && drag.mode !== 'wl') {
      const p = sel();
      if (p) setMsg(`Slice group: ${fmtVal('offX', p.offX)} ${fmtVal('offY', p.offY)} ${fmtVal('pos', p.pos)} · ${p.tilt ? 'T > C ' + p.tilt.toFixed(1) + '°' : 'Transversal'}`, 'ok');
      renderCard();
    }
    drag = null;
  };
  seg.cv.addEventListener('pointerup', end);
  seg.cv.addEventListener('pointercancel', end);
  seg.cv.addEventListener('dblclick', () => {
    if (!seg.img) return;
    seg.userWL = false;
    seg.wl = autoWL(seg.img);
    mapWL(seg);
    void updateSeg(seg); // same key: no recompute, only the window overlay and redraw
  });
}

export function initViewer(): void {
  allSegs.forEach(bindSeg);
  new ResizeObserver(() => allSegs.forEach(drawSeg)).observe($('#viewer'));
}

/** 68 px queue thumbnail of an image, auto-windowed. */
export function thumbOf(img: Img): string {
  const wl = autoWL(img), c = document.createElement('canvas');
  c.width = img.W; c.height = img.H;
  const ctx = c.getContext('2d')!, id = ctx.createImageData(img.W, img.H), lo = wl.c - wl.w / 2;
  for (let k = 0; k < img.data.length; k++) {
    const v = clamp(((img.data[k] - lo) * 255) / wl.w, 0, 255);
    id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v;
    id.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const t = document.createElement('canvas');
  t.width = t.height = 68;
  const tc = t.getContext('2d')!;
  tc.fillStyle = '#000'; tc.fillRect(0, 0, 68, 68);
  const s = Math.min(68 / img.fovW, 68 / img.fovH);
  tc.drawImage(c, (68 - img.fovW * s) / 2, (68 - img.fovH * s) / 2, img.fovW * s, img.fovH * s);
  return t.toDataURL();
}
