// Entry point: wires the console's controls to the actions and loads the BrainWeb phantom.
import './styles.css';
import type { Pathology } from './core/types';
import { derive, LIB, newProt, paramsOf, type Protocol, type Template } from './physics/protocol';
import { registerPhantom, unregisterPhantom } from './imaging/engine';
import { loadBrainWeb } from './phantom/brainweb';
import { initImportPanel } from './importer/panel';
import { addPhantomOption, commit, go, refreshAll, select, setPhantom, step, stop } from './ui/actions';
import { renderCard } from './ui/card';
import { $, setMsg } from './ui/dom';
import { stepOf } from './ui/fields';
import { addWorklistEntry, closeExam, examSummary, fillForm, register, renderWL, showView } from './ui/patient';
import { renderLib, renderQueue } from './ui/queue';
import { startSound, stopSound } from './ui/sound';
import { lastGeoSeries, locDone, phantoms, sel, state } from './ui/state';
import { drawLocs, initViewer, refreshPreview } from './ui/viewer';
import { clearMpr, initMpr, mprCounts, onUseStudy, setDemoSource } from './ui/mpr';

const on = <K extends keyof HTMLElementEventMap>(sel: string, ev: K, fn: (e: HTMLElementEventMap[K]) => void) => $(sel).addEventListener(ev, fn);
const target = (e: Event) => e.target as HTMLElement;
const sarOver = (p: Protocol): boolean => derive(p, state.B0).sar > 100;

/* tasks and patient */
on('#tPatient', 'click', () => showView('patient'));
on('#tExam', 'click', () => { if (state.patient) showView('exam'); });
on('#t3D', 'click', () => showView('3d'));
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
  p.pos = s.snap.pos; p.offX = s.snap.offX; p.offY = s.snap.offY; p.tilt = s.snap.tilt; p.tiltS = s.snap.tiltS ?? 0; p.rot = s.snap.rot ?? 0;
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

/* an imported study becomes a worklist patient with its own phantom */
let studyN = 0;
onUseStudy((r) => {
  studyN++;
  const id = `study${studyN}`;
  registerPhantom(id, r.phantom);
  phantoms.set(id, { name: r.name, imported: true, ready: true, replay: r.replay });
  addPhantomOption(id);
  const now = new Date();
  const selected = addWorklistEntry({
    last: 'ESTUDIO', first: `IMPORTADO ${studyN}`, id: `ANON-${studyN}`, sex: 'O', dob: '1980-01-01', h: 1.7, w: 70, ref: '—',
    proc: r.mode === 'replay' ? 'Estudio importado · anatomía real' : 'Estudio importado · contraste sintético',
    t: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, path: 'normal', phantom: id,
  });
  showView('patient');
  if (selected) setMsg(`${r.name} listo en la worklist. Nombre, fecha de nacimiento, peso y estatura son de referencia (el estudio se anonimizó): corrige peso y estatura si los conoces, porque definen el SAR. Luego presiona Exam.`, 'ok');
  else setMsg(`${r.name} quedó en la worklist como ESTUDIO^IMPORTADO ${studyN}. Para examinarlo, cierra el examen en curso con Cerrar examen.`, 'warn');
});

/* closing the exam: next patient, or the whole simulator back to its first state */
const dlg = $('#closeDlg');
const importedPhantoms = () => [...phantoms].filter(([, i]) => i.imported).map(([id]) => id);
let lastFocus: HTMLElement | null = null;
function openClose() {
  const s = examSummary(), m = mprCounts(), imp = importedPhantoms().length;
  const who = s.patient ? `${s.patient.last}^${s.patient.first}` : '';
  const parts: string[] = [];
  if (s.patient) parts.push(`${who}: ${s.done} serie${s.done === 1 ? '' : 's'} medida${s.done === 1 ? '' : 's'} y ${s.pending} protocolo${s.pending === 1 ? '' : 's'} sin medir.`);
  else parts.push('No hay un examen en curso.');
  if (s.running) parts.push('Hay una medición en curso: se detendrá.');
  $('#closeInfo').textContent = parts.join(' ');
  $('#closeNextWrap').hidden = !s.patient;
  $('#closeAllInfo').textContent = `Borra el examen${imp ? `, ${imp} estudio${imp === 1 ? '' : 's'} importado${imp === 1 ? '' : 's'}` : ''}${m.volumes ? ` y ${m.volumes} serie${m.volumes === 1 ? '' : 's'} cargada${m.volumes === 1 ? '' : 's'} en 3D` : ''}. El simulador queda como recién abierto.`;
  lastFocus = document.activeElement as HTMLElement | null;
  dlg.hidden = false;
  ($(s.patient ? '#closeNext' : '#closeAll') as HTMLButtonElement).focus();
}
const hideClose = () => { dlg.hidden = true; lastFocus?.focus(); };
on('#closeExam', 'click', openClose);
on('#closeCancel', 'click', hideClose);
dlg.addEventListener('click', (e) => { if (e.target === dlg) hideClose(); });
dlg.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideClose();
  if (e.key === 'Tab') { // keep focus inside the dialog
    const f = [...dlg.querySelectorAll<HTMLElement>('button')].filter((b) => b.offsetParent);
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
on('#closeNext', 'click', () => {
  const who = state.patient ? `${state.patient.last}^${state.patient.first}` : '';
  hideClose();
  closeExam(false);
  setMsg(`Examen de ${who} cerrado. Elige el siguiente paciente de la worklist.`, 'ok');
});
on('#closeAll', 'click', () => {
  hideClose();
  for (const id of importedPhantoms()) {
    unregisterPhantom(id);
    phantoms.delete(id);
    $('#phantom').querySelector(`option[value="${id}"]`)?.remove();
  }
  clearMpr();
  $('#impOut').innerHTML = '';
  $('#impState').textContent = 'local';
  state.B0 = 1.5; ($('#b0') as HTMLSelectElement).value = '1.5';
  state.sound = false; $('#snd').setAttribute('aria-pressed', 'false'); stopSound();
  state.tab = 'Routine';
  state.phantom = phantoms.get('bw')?.ready ? 'bw' : 'geo';
  ($('#phantom') as HTMLSelectElement).value = state.phantom;
  ($('#path') as HTMLSelectElement).disabled = false;
  closeExam(true);
  setMsg('Simulador reiniciado desde cero. Elige un paciente de la worklist o carga un estudio en 3D.', 'ok');
});

/* BrainWeb ships next to the page; until it arrives the geometric phantom is used */
async function initBrainWeb() {
  phantoms.set('bw', { name: 'BrainWeb · anatomía real (cargando…)', imported: false, ready: false });
  addPhantomOption('bw');
  try {
    const ph = await loadBrainWeb(`${import.meta.env.BASE_URL}brainweb.gz.txt`);
    registerPhantom('bw', ph);
    setDemoSource(ph);
    phantoms.set('bw', { name: 'BrainWeb · anatomía real', imported: false, ready: true });
    addPhantomOption('bw');
    if (state.phantom === 'geo' && !locDone()) { state.phantom = 'bw'; ($('#phantom') as HTMLSelectElement).value = 'bw'; refreshPreview(); }
  } catch {
    phantoms.set('bw', { name: 'BrainWeb (no disponible)', imported: false, ready: false });
    addPhantomOption('bw');
    setMsg('No se pudo cargar BrainWeb; se usa el fantoma geométrico. Si abriste index.html directo desde el disco, usa `npm run dev` o la versión web.', 'warn');
  }
}

const ver = $('#appVer');
ver.textContent = `v${__APP_VERSION__}`;
ver.title = `Versión ${__APP_VERSION__}${__APP_COMMIT__ ? ` · commit ${__APP_COMMIT__}` : ''} · compilada el ${__APP_DATE__}`;

initViewer();
initMpr();
renderLib();
renderWL();
fillForm(0);
setMsg('Ejemplo cargado en el registro. Presiona Exam para registrar al paciente.');
void initBrainWeb();
