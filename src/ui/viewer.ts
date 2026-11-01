// Image segments: three localizers with graphic slice positioning, the live preview and the measured series.
import type { Img, Plane, PlaneGeom, Scan, Vec3 } from '../core/types';
import { add3, clamp, cross, dot3, f1, fmtTA, norm } from '../core/util';
import { derive, normalize, type Protocol } from '../physics/protocol';
import { compute } from '../imaging/engine';
import { anglesOf, geomLoc, geomSlice, LOCG, ORI_NAMES, orientText, phaseLabels, sliceAxes, spLabel, type Axes } from '../imaging/geometry';
import { dirLabel } from '../mpr/mpr';
import { autoWL } from '../imaging/render';
import { refreshCardValues, renderCard } from './card';
import { $, setMsg } from './dom';
import { F, fmtVal, type NumField } from './fields';
import { renderQueue } from './queue';
import { locDone, previewScan, replaySource, sel, state } from './state';

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
  if (seg.kind === 'loc') {
    // a measured series chosen as planning image; falls back to the localizer if it disappeared
    if (seg.pid !== null) {
      const q = state.queue.find((x) => x.id === seg.pid && x.state === 'done' && !x.loc);
      if (q?.snap) return { p: q, pp: q.snap };
      seg.pid = null;
    }
    const p = locDone();
    return p?.snap ? { p, pp: p.snap } : null;
  }
  const p = state.queue.find((q) => q.id === seg.pid);
  return p?.snap ? { p, pp: p.snap } : null;
}

const ORI_WORD = { T: 'Tra', S: 'Sag', C: 'Cor' } as const;
/** Overlay orientation, e.g. "Sag>Cor(-8.0)>R>>L" style: main plane, angulations, phase direction. */
const orientTxt = (pp: Scan) => {
  const f = (v: number) => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(1), N = ORI_NAMES[pp.ori ?? 'tra'];
  return ORI_WORD[N.main as 'T'] + (pp.tilt ? `>${ORI_WORD[N.a as 'C']}(${f(pp.tilt)})` : '') + (pp.tiltS ? `>${ORI_WORD[N.b as 'S']}(${f(pp.tiltS)})` : '');
};
const phaseTxt = (pp: Scan) => phaseLabels(pp.ori ?? 'tra')[pp.phaseDir === 'RL' ? 0 : 1].replace(/ /g, '');

/** Orientation letters on the four image edges, from the plane's axes. */
function setLetters(seg: Seg, g: PlaneGeom | null): void {
  const q = (c: string) => seg.el.querySelector<HTMLElement>(`.ori.${c}`);
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  const set = (c: string, d: Vec3 | null) => { const e = q(c); if (e) e.textContent = d ? dirLabel(d) : ''; };
  set('l', g ? neg(g.u) : null); set('r', g ? g.u : null); set('t', g ? neg(g.v) : null); set('b', g ? g.v : null);
}

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
  const tag = seg.el.querySelector<HTMLElement>('.tag');
  if (seg.kind === 'loc' && seg.pid !== null) {
    // planning on a measured series: scroll through its slices like on the scanner
    seg.slice = clamp(seg.slice, 0, pp.slices - 1);
    const g = geomSlice(pp, seg.slice), key = `plan|${p.id}|${seg.slice}`;
    if (key !== seg.key) {
      const img = await compute(pp, g, p.seed + seg.slice * 101);
      if (seg.again) return;
      if (!seg.key.startsWith(`plan|${p.id}|`)) seg.userWL = false;
      seg.img = img; seg.key = key;
      if (!seg.userWL) seg.wl = autoWL(img);
      mapWL(seg);
    }
    seg.geom = g;
    if (tag) tag.textContent = `SE ${p.series}`;
    setLetters(seg, g);
    seg.ov[0].textContent = `${overlayPatient()}\nSe: ${p.series}  ${p.name}\nIm: ${seg.slice + 1}/${pp.slices}  SP ${spLabel(g.C, g.n ?? cross(g.u, g.v))}`;
    seg.ov[1].textContent = `W ${seg.wl.w}\nC ${seg.wl.c}`;
    drawSeg(seg);
    return;
  }
  if (seg.kind === 'loc') {
    const plane = seg.plane!;
    if (tag) tag.textContent = plane.toUpperCase();
    seg.img = p.locImgs![plane];
    seg.geom = geomLoc(pp, plane);
    if (seg.key !== p.id + plane) { seg.key = p.id + plane; seg.userWL = false; }
    if (!seg.userWL) seg.wl = autoWL(seg.img);
    mapWL(seg);
    seg.ov[0].textContent = `${overlayPatient()}\nSe: ${p.series}  ${seg.geom.name}`;
    seg.ov[1].textContent = `W ${seg.wl.w}\nC ${seg.wl.c}`;
    setLetters(seg, seg.geom);
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
  const src = replaySource(pp, pp.phantom);
  setLetters(seg, g);
  seg.ov[0].textContent = `${overlayPatient()}\nHead^Brain`;
  seg.ov[1].textContent = `Resonador ${pp.B0} T\n${seg.kind === 'series' ? 'Se: ' + p.series : 'Protocolo abierto'}\nIm: ${seg.slice + 1}/${nS}\n${new Date().toLocaleDateString('es-CL')}`;
  seg.ov[2].textContent = `${src ? `Fuente: ${src.desc} (${src.got})\n` : ''}SP ${spLabel(g.C, g.n ?? cross(g.u, g.v))}\nSL ${pp.thick.toFixed(1)}\nFoV ${fovStr}\n${pp.loc ? 'Tra' : orientTxt(pp)}>${pp.loc ? 'A>>P' : phaseTxt(pp)}\nTR ${f1(pp.TR)}${pp.prep === 'ir' ? '  TI ' + pp.TI : ''}\nTE ${f1(pp.TE)}${pp.seq === 'gre' ? '  FA ' + pp.FA : ''}${pp.seq === 'epi' ? '  b ' + pp.b : ''}\nTA ${fmtTA(d.TA)}  BW ${pp.bw}\n${pp.name}`;
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
// Works the same in the three localizers: each slice is drawn where its plane cuts the localizer.
// Seen edge-on (sagittal, coronal) the group is a stack of lines; seen face-on (transverse) it is the FoV box.
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
interface Frame { C: Vec3; u: Vec3; v: Vec3; n: Vec3; fu: number; fv: number; step: number; count: number }
function groupFrame(pp: Scan | Protocol): Frame {
  const g = geomSlice(pp, (pp.slices - 1) / 2);
  return { C: [pp.offX, pp.offY, pp.pos], u: g.u, v: g.v, n: g.n!, fu: g.fovW, fv: g.fovH, step: pp.thick * (1 + pp.dist / 100), count: pp.slices };
}
const locNormal = (seg: Seg): Vec3 => cross(seg.geom!.u, seg.geom!.v);
const faceOn = (seg: Seg, fr: Frame) => Math.abs(dot3(fr.n, locNormal(seg))) > 0.5;
const sliceCenter = (fr: Frame, i: number) => add3(fr.C, fr.n, (i - (fr.count - 1) / 2) * fr.step);

/** Segment where a slice (centre c, axes u v, half sizes) cuts the localizer plane, clipped to the slice's FoV. */
function cutSegment(seg: Seg, fr: Frame, c: Vec3): [Vec3, Vec3] | null {
  const Ln = locNormal(seg), L0 = seg.geom!.C;
  const au = dot3(fr.u, Ln), av = dot3(fr.v, Ln), rhs = dot3([L0[0] - c[0], L0[1] - c[1], L0[2] - c[2]], Ln);
  const den = au * au + av * av;
  if (den < 1e-9) return null;
  // the line a·au + b·av = rhs in slice coordinates, clipped to the FoV rectangle (Liang–Barsky)
  const p0 = [(au * rhs) / den, (av * rhs) / den], d = [-av, au];
  let t0 = -1e9, t1 = 1e9;
  const lim = [fr.fu / 2, fr.fv / 2];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (Math.abs(p0[k]) > lim[k]) return null; continue; }
    let ta = (-lim[k] - p0[k]) / d[k], tb = (lim[k] - p0[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 >= t1) return null;
  const pt = (t: number): Vec3 => add3(add3(c, fr.u, p0[0] + t * d[0]), fr.v, p0[1] + t * d[1]);
  return [pt(t0), pt(t1)];
}

/** Outline of the group on the screen (convex quad) and the rotation handles. */
function planShape(seg: Seg, fr: Frame) {
  const dpr = seg.rect!.dpr, center = toCan(seg, fr.C);
  if (faceOn(seg, fr)) {
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toCan(seg, add3(add3(fr.C, fr.u, (a * fr.fu) / 2), fr.v, (b * fr.fv) / 2)));
    const top = toCan(seg, add3(fr.C, fr.v, -fr.fv / 2));
    const dx = top[0] - center[0], dy = top[1] - center[1], l = Math.hypot(dx, dy) || 1;
    const h: [number, number] = [top[0] + (dx / l) * 16 * dpr, top[1] + (dy / l) * 16 * dpr];
    return { quad, center, handles: [{ at: h, from: top }] };
  }
  const first = cutSegment(seg, fr, sliceCenter(fr, 0)), last = cutSegment(seg, fr, sliceCenter(fr, fr.count - 1)), mid = cutSegment(seg, fr, fr.C);
  if (!first || !last) return null;
  const quad = [toCan(seg, first[0]), toCan(seg, first[1]), toCan(seg, last[1]), toCan(seg, last[0])];
  const handles = [];
  if (mid) {
    const m0 = toCan(seg, mid[0]), m1 = toCan(seg, mid[1]), dx = m1[0] - m0[0], dy = m1[1] - m0[1], l = Math.hypot(dx, dy) || 1;
    handles.push({ at: [m1[0] + (dx / l) * 14 * dpr, m1[1] + (dy / l) * 14 * dpr] as [number, number], from: m1 });
    handles.push({ at: [m0[0] - (dx / l) * 14 * dpr, m0[1] - (dy / l) * 14 * dpr] as [number, number], from: m0 });
  }
  return { quad, center, handles };
}

function drawPlan(seg: Seg, ctx: CanvasRenderingContext2D): void {
  const pr = planProt();
  if (!pr || !seg.rect || !seg.geom) return;
  const { pp, edit } = pr, fr = groupFrame(pp), dpr = seg.rect.dpr;
  const col = edit ? '#ef8f2f' : '#9aa3aa', colC = edit ? '#ffd27a' : '#c8ced3';
  ctx.save();
  const line = (a: [number, number], b: [number, number], c: string, w: number, dash?: number[]) => {
    ctx.strokeStyle = c; ctx.lineWidth = w * dpr; ctx.setLineDash(dash ? dash.map((x) => x * dpr) : []);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  const shape = planShape(seg, fr);
  if (faceOn(seg, fr)) {
    const q = shape!.quad;
    for (let k = 0; k < 4; k++) line(q[k], q[(k + 1) % 4], col, 1.3);
    const ph = pp.phaseDir === 'RL';
    if (pp.os > 0) { // phase oversampling region, dotted, along the phase axis
      const osk = 1 + pp.os / 100, ku = ph ? osk : 1, kv = ph ? 1 : osk;
      const oc = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toCan(seg, add3(add3(fr.C, fr.u, (a * fr.fu * ku) / 2), fr.v, (b * fr.fv * kv) / 2)));
      for (let k = 0; k < 4; k++) line(oc[k], oc[(k + 1) % 4], col, 1, [2, 3]);
    }
    const ax = ph ? fr.u : fr.v, len = (ph ? fr.fu : fr.fv) / 2;
    const a = toCan(seg, add3(fr.C, ax, -len * 0.25)), b = toCan(seg, add3(fr.C, ax, len * 0.25));
    line(a, b, colC, 1);
    ctx.fillStyle = colC; ctx.font = `${10 * dpr}px "IBM Plex Mono",monospace`; ctx.fillText('ph', b[0] + 3 * dpr, b[1] - 3 * dpr);
  } else {
    const mid = (fr.count - 1) / 2;
    for (let i = 0; i < fr.count; i++) {
      const sgm = cutSegment(seg, fr, sliceCenter(fr, i));
      if (!sgm) continue;
      const cen = Math.abs(i - mid) < 0.6;
      line(toCan(seg, sgm[0]), toCan(seg, sgm[1]), cen ? colC : col, cen ? 1.6 : 1);
    }
    if (shape) for (let k = 0; k < 4; k++) if (k % 2 === 1) line(shape.quad[k], shape.quad[(k + 1) % 4], col, 1, [4, 3]);
  }
  if (shape && edit) {
    for (const h of shape.handles) {
      line(h.from, h.at, col, 1);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(h.at[0], h.at[1], 4.5 * dpr, 0, 7); ctx.fill();
    }
  }
  if (shape) { ctx.fillStyle = col; ctx.font = `600 ${11 * dpr}px "IBM Plex Mono",monospace`; ctx.fillText('1', shape.quad[0][0] + 3 * dpr, shape.quad[0][1] - 4 * dpr); }
  ctx.restore();
}

function insideQuad(q: [number, number][], X: number, Y: number, pad: number): boolean {
  // convex quad, either winding: inside when all edge cross products share a sign (with a small margin)
  let pos = 0, neg = 0;
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = q[k], [x1, y1] = q[(k + 1) % 4], ex = x1 - x0, ey = y1 - y0, l = Math.hypot(ex, ey) || 1;
    const c = (ex * (Y - y0) - ey * (X - x0)) / l;
    if (c > -pad) pos++;
    if (c < pad) neg++;
  }
  return pos === 4 || neg === 4;
}

function hitPlan(seg: Seg, X: number, Y: number): { mode: 'move' } | { mode: 'rot'; cx: number; cy: number } | null {
  const pr = planProt();
  if (!pr || !pr.edit || !seg.rect || !seg.geom) return null;
  const fr = groupFrame(pr.pp), shape = planShape(seg, fr), dpr = seg.rect.dpr;
  if (!shape) return null;
  for (const h of shape.handles) if (Math.hypot(X - h.at[0], Y - h.at[1]) < 10 * dpr) return { mode: 'rot', cx: shape.center[0], cy: shape.center[1] };
  return insideQuad(shape.quad, X, Y, 5 * dpr) ? { mode: 'move' } : null;
}

/**
 * Seen edge-on, the group turns about the localizer's normal (T>C on the sagittal, T>S on the coronal).
 * Seen face-on, it turns about its own normal: an in-plane rotation of the FoV that keeps the angulations.
 */
function rotAxis(seg: Seg, p: Protocol): Vec3 {
  const fr = groupFrame(p), Ln = locNormal(seg);
  if (!faceOn(seg, fr)) return Ln;
  const sgn = Math.sign(dot3(fr.n, Ln)) || 1;
  return [fr.n[0] * sgn, fr.n[1] * sgn, fr.n[2] * sgn];
}

const fmtDeg = (v: number) => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(1);
/** Rotate the group about the localizer's normal and write the angles back to the protocol. */
function rotateGroup(p: Protocol, axes0: Axes, axis: Vec3, angle: number): boolean {
  const c = Math.cos(angle), s = Math.sin(angle), k = norm(axis);
  const rot = (a: Vec3): Vec3 => { const kx = cross(k, a), kd = dot3(k, a); return [0, 1, 2].map((i) => a[i] * c + kx[i] * s + k[i] * kd * (1 - c)) as Vec3; };
  const ang = anglesOf({ u: rot(axes0.u), v: rot(axes0.v), n: rot(axes0.n) }, p.ori);
  if (Math.abs(ang.tilt) > 45 || Math.abs(ang.tiltS) > 45) return false; // a transverse group stays transverse
  const r2 = (v: number) => Math.round(v * 2) / 2 + 0;
  p.tilt = r2(ang.tilt); p.tiltS = r2(ang.tiltS);
  p.rot = r2(ang.rot);
  return true;
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

export function drawLocs(): void {
  renderSegSources();
  locSegs.forEach((s) => void updateSeg(s));
}

/** Fill each planning segment's chooser: its localizer plane, or any measured series. */
function renderSegSources(): void {
  const done = state.queue.filter((q) => q.state === 'done' && !q.loc && q.snap).sort((a, b) => (a.series ?? 0) - (b.series ?? 0));
  const has = !!locDone();
  for (const seg of locSegs) {
    const selEl = seg.el.querySelector<HTMLSelectElement>('.segsrc');
    if (!selEl) continue;
    if (seg.pid !== null && !done.some((q) => q.id === seg.pid)) { seg.pid = null; seg.key = ''; }
    const opts: [string, string][] = [['loc', `Localizer · ${LOCG[seg.plane!].name}`], ...done.map((q) => [String(q.id), `Se ${q.series} · ${q.name}`] as [string, string])];
    const sig = opts.map((o) => o.join('=')).join('|');
    if (selEl.dataset.sig !== sig) {
      selEl.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      selEl.dataset.sig = sig;
    }
    selEl.value = seg.pid === null ? 'loc' : String(seg.pid);
    selEl.hidden = !has || done.length === 0;
  }
}

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
    if (seg.kind === 'loc' && seg.pid === null) return;
    e.preventDefault();
    seg.slice += e.deltaY > 0 ? 1 : -1;
    void updateSeg(seg);
  }, { passive: false });
  seg.el.querySelectorAll<HTMLButtonElement>('.snav button').forEach((b) => b.addEventListener('click', () => { seg.slice += Number(b.dataset.s); void updateSeg(seg); }));
  type Drag = { mode: 'wl'; x: number; y: number; w: number; c: number } | { mode: 'move'; P0: Vec3; C0: Vec3 } | { mode: 'rot'; axis: Vec3; axes0: Axes; a0: number; cx: number; cy: number };
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
    const hit = seg.kind === 'loc' ? hitPlan(seg, X, Y) : null;
    const p = sel();
    if (hit && p) {
      drag = hit.mode === 'move'
        ? { mode: 'move', P0: toPat(seg, X, Y), C0: [p.offX, p.offY, p.pos] }
        : { mode: 'rot', axis: rotAxis(seg, p), axes0: sliceAxes(p), a0: Math.atan2(Y - hit.cy, X - hit.cx), cx: hit.cx, cy: hit.cy };
      return;
    }
    drag = { mode: 'wl', x: e.clientX, y: e.clientY, w: seg.wl.w, c: seg.wl.c };
  });
  seg.cv.addEventListener('pointermove', (e) => {
    const [X, Y] = xy(e);
    if (!drag) {
      if (seg.kind === 'loc') {
        const m = hitPlan(seg, X, Y)?.mode;
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
    if (drag.mode === 'rot') {
      if (rotateGroup(p, drag.axes0, drag.axis, Math.atan2(Y - drag.cy, X - drag.cx) - drag.a0)) planChanged();
      return;
    }
    const P = toPat(seg, X, Y);
    {
      p.offX = Math.round(clamp(drag.C0[0] + P[0] - drag.P0[0], lim('offX').min, lim('offX').max) * 10) / 10;
      p.offY = Math.round(clamp(drag.C0[1] + P[1] - drag.P0[1], lim('offY').min, lim('offY').max) * 10) / 10;
      p.pos = Math.round(clamp(drag.C0[2] + P[2] - drag.P0[2], lim('pos').min, lim('pos').max) * 10) / 10;
    }
    planChanged();
  });
  const end = () => {
    if (drag && drag.mode !== 'wl') {
      const p = sel();
      if (p) setMsg(`Slice group: ${fmtVal('offX', p.offX)} ${fmtVal('offY', p.offY)} ${fmtVal('pos', p.pos)} · ${orientText(p)}${p.rot ? ` · rotación ${fmtDeg(p.rot)}°` : ''}`, 'ok');
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
  for (const seg of locSegs) {
    const selEl = seg.el.querySelector<HTMLSelectElement>('.segsrc');
    selEl?.addEventListener('change', () => {
      seg.pid = selEl.value === 'loc' ? null : Number(selEl.value);
      const q = state.queue.find((x) => x.id === seg.pid);
      seg.slice = q?.snap ? Math.floor((q.snap.slices - 1) / 2) : 0;
      seg.key = ''; seg.userWL = false;
      void updateSeg(seg);
      setMsg(seg.pid === null ? `Segmento con el localizer ${LOCG[seg.plane!].name}.` : `Planificando sobre ${q?.name} (serie ${q?.series}). Rueda: cambiar de corte.`, 'ok');
    });
  }
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
