// What the technologist does in the Exam task: open protocols, change parameters, measure.
import type { Plane } from '../core/types';
import { clamp, fmtTA } from '../core/util';
import { derive, normalize, paramsOf, type Protocol } from '../physics/protocol';
import { compute } from '../imaging/engine';
import { geomLoc, geomSlice } from '../imaging/geometry';
import { renderCard } from './card';
import { $, setMsg, setScanner } from './dom';
import { F, coerce, getP, labelOf, parseNum, setP } from './fields';
import { renderQueue } from './queue';
import { startSound, stopSound } from './sound';
import { envParams, locDone, phantoms, replaySource, sel, state } from './state';
import { drawLocs, refreshPreview, segA, showSeries, thumbOf } from './viewer';

export function select(id: number): void {
  state.selId = id;
  const p = sel();
  if (!p) return;
  segA.slice = Math.floor((p.slices - 1) / 2);
  segA.userWL = false;
  if (p.state === 'done') showSeries(p);
  refreshAll();
}

export function refreshAll(): void {
  renderQueue();
  renderCard();
  refreshPreview();
  drawLocs();
}

function afterChange(p: Protocol, msgs: string[], label: string): void {
  const d = derive(p, state.B0);
  let lvl: 'ok' | 'warn' | 'err' = msgs.length ? 'warn' : 'ok';
  if (d.concat > 1) msgs.push(`${d.concat} concatenaciones: caben ${d.maxSlices} cortes por TR.`);
  if (d.sar > 100) { msgs.push('SAR sobre el límite: reduce cortes, sube TR, baja el flip angle de refoco o usa RF Low SAR.'); lvl = 'err'; }
  setMsg(msgs.join(' ') || `${label} aplicado.`, lvl);
}

/** Apply a value typed or picked on the parameter card. */
export function commit(k: string, v: string | number, focusId?: string): void {
  const p = sel();
  if (!p || p.state !== 'pending') return;
  const f = F[k];
  if (f.kind === 'sel') {
    setP(p, k, k === 'pat' ? Number(v) : v);
    // a new main orientation starts square to the scanner axes
    if (k === 'ori') { p.tilt = 0; p.tiltS = 0; p.rot = 0; }
  }
  else if (f.kind === 'num') {
    const n = typeof v === 'number' ? v : parseNum(k, v);
    if (isNaN(n)) { setMsg(`Valor no válido para ${labelOf(f, p)}.`, 'err'); renderCard(); return; }
    setP(p, k, coerce(k, n));
  } else return;
  afterChange(p, normalize(p), labelOf(f, p));
  renderCard(focusId);
  renderQueue();
  refreshPreview();
  drawLocs();
}

export function step(k: string, dir: number, stepSize: number, focusId?: string): void {
  const p = sel();
  if (p) commit(k, (getP(p, k) as number) + dir * stepSize, focusId);
}

/* ---------- measurement ---------- */
export function go(): void {
  const p = sel();
  if (!p || p.state !== 'pending' || state.running) return;
  if (!p.loc && !locDone()) { setMsg('Primero mide el localizer: lo necesitas para planificar los cortes.', 'err'); return; }
  const d = derive(p, state.B0);
  if (d.sar > 100) { setMsg(`No se puede iniciar: SAR ${Math.round(d.sar)}% sobre el límite del modo normal. Ajusta el protocolo.`, 'err'); return; }
  p.state = 'running';
  p.t0 = performance.now();
  p.dur = clamp(d.TA / 1000 / 25, 2.5, 7) * 1000; // accelerated: a few seconds per series
  p.prog = 0;
  state.running = p;
  setScanner(true, 'Measuring');
  const src = replaySource(p);
  setMsg(`Midiendo ${p.name} — TA ${fmtTA(d.TA)} (simulación acelerada).${src ? ` Anatomía real: ${src.desc}${src.exact ? '' : ` (el estudio no tiene ${src.want}; se usa ${src.got})`}.` : ''}`, src && !src.exact ? 'warn' : '');
  if (state.sound) startSound(p);
  renderQueue();
  renderCard();
  drawLocs();
  requestAnimationFrame(tick);
}

function tick(): void {
  const p = state.running;
  if (!p || p.state !== 'running') return;
  p.prog = Math.min(1, (performance.now() - (p.t0 ?? 0)) / (p.dur ?? 1));
  const li = document.querySelector(`.qi[data-id="${p.id}"]`);
  if (li) {
    (li.querySelector('.qbar i') as HTMLElement).style.width = p.prog * 100 + '%';
    const r = li.querySelector('[data-rem]');
    if (r) r.textContent = fmtTA(derive(p, state.B0).TA * (1 - p.prog));
  }
  $('#qnow').textContent = `Midiendo ${Math.round(p.prog * 100)}%`;
  if (p.prog >= 1) void finish(p);
  else requestAnimationFrame(tick);
}

/** Freeze the protocol with the current scanner conditions and reconstruct its images. */
async function acquire(p: Protocol): Promise<void> {
  const snap = { ...paramsOf(p), ...envParams() };
  if (p.loc) {
    const planes: Plane[] = ['sag', 'cor', 'tra'];
    const imgs = await Promise.all(planes.map((pl) => compute(snap, geomLoc(snap, pl), p.seed + pl.length * 977)));
    p.locImgs = { sag: imgs[0], cor: imgs[1], tra: imgs[2] };
    p.thumb = thumbOf(imgs[0]);
  } else {
    const mid = Math.floor((snap.slices - 1) / 2);
    const img = await compute(snap, geomSlice(snap, mid), p.seed + mid * 101);
    p.thumb = thumbOf(img);
  }
  p.snap = snap;
  p.series = ++state.series;
  p.state = 'done';
  p.prog = 0;
}

async function finish(p: Protocol): Promise<void> {
  stopSound();
  $('#qnow').textContent = 'Reconstruyendo…';
  await acquire(p);
  if (state.running !== p) return; // stopped or patient changed meanwhile
  state.running = null;
  setScanner(false, 'Ready');
  $('#qnow').textContent = '';
  if (p.loc) setMsg(`Localizer medido (serie ${p.series}). Paso 2: abre un protocolo y planifica el slice group sobre los localizers.`, 'ok');
  else { showSeries(p); setMsg(`${p.name} medido: serie ${p.series}.`, 'ok'); }
  if (state.selId === p.id) {
    const next = state.queue.find((q) => q.state === 'pending');
    if (next) { select(next.id); return; }
  }
  refreshAll();
}

export function stop(): void {
  const p = state.running;
  if (!p) return;
  stopSound();
  state.running = null;
  if (p.state === 'running') { p.state = 'pending'; p.prog = 0; }
  setScanner(false, 'Ready');
  $('#qnow').textContent = '';
  setMsg(`Medición de ${p.name} detenida.`, 'warn');
  renderQueue();
  renderCard();
  drawLocs();
}

export function resetScanner(): void {
  stopSound();
  state.running = null;
  setScanner(false, 'Ready');
  $('#qnow').textContent = '';
}

/* ---------- phantom selection ---------- */
export function setPhantom(id: string): void {
  const info = phantoms.get(id);
  if (!info || !info.ready) return;
  state.phantom = id;
  ($('#phantom') as HTMLSelectElement).value = id;
  ($('#path') as HTMLSelectElement).disabled = info.imported;
  setMsg(`Fantoma: ${info.name}.${info.imported ? ' Los datos importados traen su propia anatomía: la patología simulada queda desactivada.' : ''} El localizer y las series nuevas usarán esta anatomía.`, 'ok');
  refreshPreview();
}

export function addPhantomOption(id: string): void {
  const info = phantoms.get(id)!;
  const sel = $('#phantom') as HTMLSelectElement;
  let o = sel.querySelector<HTMLOptionElement>(`option[value="${id}"]`);
  if (!o) { o = document.createElement('option'); o.value = id; sel.appendChild(o); }
  o.textContent = info.name;
  o.disabled = !info.ready;
}
