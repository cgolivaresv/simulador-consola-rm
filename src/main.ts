// Entry point: wires the console's controls to the actions and loads the BrainWeb phantom.
import './styles.css';
import type { Pathology } from './core/types';
import { derive, LIB, newProt, paramsOf, type Protocol, type Template } from './physics/protocol';
import { registerPhantom } from './imaging/engine';
import { loadBrainWeb } from './phantom/brainweb';
import { initImportPanel } from './importer/panel';
import { addPhantomOption, commit, go, refreshAll, select, setPhantom, step, stop } from './ui/actions';
import { renderCard } from './ui/card';
import { $, setMsg } from './ui/dom';
import { stepOf } from './ui/fields';
import { fillForm, register, renderWL, showView } from './ui/patient';
import { renderLib, renderQueue } from './ui/queue';
import { startSound, stopSound } from './ui/sound';
import { lastGeoSeries, locDone, phantoms, sel, state } from './ui/state';
import { drawLocs, initViewer, refreshPreview } from './ui/viewer';

const on = <K extends keyof HTMLElementEventMap>(sel: string, ev: K, fn: (e: HTMLElementEventMap[K]) => void) => $(sel).addEventListener(ev, fn);
const target = (e: Event) => e.target as HTMLElement;
const sarOver = (p: Protocol): boolean => derive(p, state.B0).sar > 100;

/* tasks and patient */
on('#tPatient', 'click', () => showView('patient'));
on('#tExam', 'click', () => { if (state.patient) showView('exam'); });
on('#wlBody', 'click', (e) => { const tr = target(e).closest('tr'); if (tr) fillForm(Number(tr.dataset.i)); });
on('#wlBody', 'keydown', (e) => { if (e.key === 'Enter') { const tr = target(e).closest('tr'); if (tr) fillForm(Number(tr.dataset.i)); } });
on('#regBtn', 'click', register);
on('#regForm', 'submit', (e) => { e.preventDefault(); register(); });

/* parameter card */
on('#tabs', 'click', (e) => { const b = target(e).closest<HTMLElement>('[data-tab]'); if (b) { state.tab = b.dataset.tab!; renderCard(); } });
on('#cbody', 'change', (e) => { const el = target(e) as HTMLInputElement; if (el.dataset.k) commit(el.dataset.k, el.value); });
on('#cbody', 'keydown', (e) => {
  const el = target(e) as HTMLInputElement, k = el.dataset.k, p = sel();
  if (!k || el.tagName !== 'INPUT' || !p) return;
  if (e.key === 'Enter') { e.preventDefault(); commit(k, el.value, el.id); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(k, e.key === 'ArrowUp' ? 1 : -1, stepOf(k, p), el.id); }
});
on('#cbody', 'click', (e) => {
  const b = target(e).closest<HTMLButtonElement>('.spin button'), p = sel();
  if (b && !b.disabled && p) step(b.dataset.k!, Number(b.dataset.d), stepOf(b.dataset.k!, p));
});
on('#info', 'click', (e) => { const id = target(e).id; if (id === 'goBtn') go(); if (id === 'stopBtn') stop(); });

/* queue and library */
const pickQi = (e: Event) => { const li = target(e).closest<HTMLElement>('.qi'); if (li) select(Number(li.dataset.id)); };
on('#queue', 'click', pickQi);
on('#queue', 'keydown', (e) => { if (e.key === 'Enter') pickQi(e); });
on('#lib', 'click', (e) => {
  const b = target(e).closest<HTMLElement>('.add');
  if (!b) return;
  const p = newProt(LIB[Number(b.dataset.i)]);
  state.queue.push(p);
  setMsg(`${p.name} agregado a la cola.`, 'ok');
  select(p.id);
});
on('#rep', 'click', () => {
  const p = sel();
  if (!p) return;
  const n = newProt(paramsOf(p.snap ?? p) as Template);
  state.queue.splice(state.queue.indexOf(p) + 1, 0, n);
  setMsg(`Copia de ${p.name} lista para editar.`, 'ok');
  select(n.id);
});
on('#cpy', 'click', () => {
  const p = sel(), s = p && lastGeoSeries(p);
  if (!p || !s?.snap || p.state !== 'pending') return;
  p.pos = s.snap.pos; p.offX = s.snap.offX; p.offY = s.snap.offY; p.tilt = s.snap.tilt;
  setMsg(`Posición copiada de ${s.name} (serie ${s.series}).`, 'ok');
  renderCard(); refreshPreview(); drawLocs();
});
on('#del', 'click', () => {
  const p = sel();
  if (!p || p.state !== 'pending') return;
  const i = state.queue.indexOf(p);
  state.queue.splice(i, 1);
  setMsg(`${p.name} eliminado.`);
  const n = state.queue[Math.min(i, state.queue.length - 1)];
  if (n) select(n.id);
  else { state.selId = null; refreshAll(); }
});

/* scanner conditions */
on('#b0', 'change', (e) => {
  state.B0 = Number((target(e) as HTMLSelectElement).value);
  const p = sel(), over = p ? sarOver(p) : false;
  setMsg(`Campo ${state.B0} T.${over ? ' El protocolo abierto supera el SAR: ajústalo antes de medir.' : ''}`, over ? 'err' : 'ok');
  renderQueue(); renderCard(); refreshPreview();
});
on('#path', 'change', (e) => {
  state.path = (target(e) as HTMLSelectElement).value as Pathology;
  setMsg('Patología cambiada. Las series ya medidas conservan la anatomía con que se adquirieron.', 'ok');
  refreshPreview();
});
on('#phantom', 'change', (e) => setPhantom((target(e) as HTMLSelectElement).value));
on('#snd', 'click', (e) => {
  state.sound = !state.sound;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(state.sound));
  if (!state.sound) stopSound();
  else if (state.running) startSound(state.running);
});

/* imported phantoms */
initImportPanel((id, name, phantom) => {
  registerPhantom(id, phantom);
  phantoms.set(id, { name, imported: true, ready: true });
  addPhantomOption(id);
  setPhantom(id);
});

/* BrainWeb ships next to the page; until it arrives the geometric phantom is used */
async function initBrainWeb() {
  phantoms.set('bw', { name: 'BrainWeb · anatomía real (cargando…)', imported: false, ready: false });
  addPhantomOption('bw');
  try {
    const ph = await loadBrainWeb(`${import.meta.env.BASE_URL}brainweb.gz.txt`);
    registerPhantom('bw', ph);
    phantoms.set('bw', { name: 'BrainWeb · anatomía real', imported: false, ready: true });
    addPhantomOption('bw');
    if (state.phantom === 'geo' && !locDone()) { state.phantom = 'bw'; ($('#phantom') as HTMLSelectElement).value = 'bw'; refreshPreview(); }
  } catch {
    phantoms.set('bw', { name: 'BrainWeb (no disponible)', imported: false, ready: false });
    addPhantomOption('bw');
    setMsg('No se pudo cargar BrainWeb; se usa el fantoma geométrico. Si abriste index.html directo desde el disco, usa `npm run dev` o la versión web.', 'warn');
  }
}

initViewer();
renderLib();
renderWL();
fillForm(0);
setMsg('Ejemplo cargado en el registro. Presiona Exam para registrar al paciente.');
void initBrainWeb();
