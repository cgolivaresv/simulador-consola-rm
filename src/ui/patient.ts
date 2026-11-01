// Patient task: example worklist and registration. All names in the worklist are fictitious.
import type { Pathology } from '../core/types';
import { DEFAULT_EXAM, LIB, newProt } from '../physics/protocol';
import { resetScanner, select } from './actions';
import { age } from './age';
import { $, esc, setMsg } from './dom';
import { state } from './state';
import { allSegs, clearSeries, drawSeg } from './viewer';
import { showMpr } from './mpr';

interface WlEntry { last: string; first: string; id: string; sex: string; dob: string; h: number; w: number; ref: string; proc: string; t: string; path: Pathology }

const WL: WlEntry[] = [
  { last: 'GONZÁLEZ', first: 'MARÍA', id: '20451', sex: 'F', dob: '1978-03-12', h: 1.62, w: 64, ref: 'Dra. Soto', proc: 'RM cerebro sin contraste', t: '09:00', path: 'normal' },
  { last: 'MUÑOZ', first: 'PEDRO', id: '20452', sex: 'M', dob: '1961-11-02', h: 1.75, w: 80, ref: 'Dr. Riquelme', proc: 'RM cerebro · sospecha ACV', t: '09:40', path: 'stroke' },
  { last: 'ROJAS', first: 'CAMILA', id: '20453', sex: 'F', dob: '1990-07-21', h: 1.68, w: 58, ref: 'Dra. Fuentes', proc: 'RM cerebro · control EM', t: '10:20', path: 'ms' },
];
let wlSel = 0;

const input = (id: string) => $(id) as HTMLInputElement;

export function renderWL(): void {
  $('#wlDate').textContent = new Date().toLocaleDateString('es-CL');
  $('#wlBody').innerHTML = WL.map((w, i) => `<tr class="${i === wlSel ? 'sel' : ''}" data-i="${i}" tabindex="0"><td>${w.last}^${w.first}</td><td>${w.id}</td><td>${w.sex}</td><td>${w.dob}</td><td>${w.proc}</td><td>${w.t}</td></tr>`).join('');
}

export function fillForm(i: number): void {
  wlSel = i;
  const w = WL[i];
  input('#rLast').value = w.last; input('#rFirst').value = w.first; input('#rId').value = w.id; input('#rDob').value = w.dob;
  ($('#rSex') as HTMLSelectElement).value = w.sex;
  input('#rHeight').value = w.h.toFixed(2); input('#rWeight').value = String(w.w); input('#rRef').value = w.ref; input('#rProc').value = w.proc;
  state.path = w.path;
  ($('#path') as HTMLSelectElement).value = w.path;
  renderWL();
}

export function register(): void {
  const v = (id: string) => input(id).value.trim();
  const h = parseFloat(v('#rHeight').replace(',', '.')), w = parseFloat(v('#rWeight').replace(',', '.'));
  const checks: [string, boolean][] = [
    ['#rLast', !!v('#rLast')], ['#rId', !!v('#rId')], ['#rDob', !!v('#rDob') && !isNaN(age(v('#rDob')))],
    ['#rHeight', h >= 0.4 && h <= 2.5], ['#rWeight', w >= 2 && w <= 250],
  ];
  const bad: string[] = [];
  for (const [id, ok] of checks) {
    input(id).setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok) bad.push($(`label[for="${id.slice(1)}"]`).textContent || id);
  }
  if (bad.length) { setMsg('Falta o es inválido: ' + bad.join(', ') + '.', 'err'); return; }
  const P = (state.patient = {
    last: v('#rLast').toUpperCase(), first: v('#rFirst').toUpperCase(), id: v('#rId'), sex: ($('#rSex') as HTMLSelectElement).value,
    dob: v('#rDob'), age: age(v('#rDob')), h, w, proc: v('#rProc'),
  });
  $('#patBar').innerHTML = `<span><b>${esc(P.last)}^${esc(P.first)}</b></span><span>ID ${esc(P.id)}</span><span>${P.sex} · ${P.age}a · ${P.w} kg · ${P.h.toFixed(2)} m</span><span>Head First-Supine</span><span>Head/Neck 20</span>`;
  resetScanner();
  state.series = 0;
  state.queue = DEFAULT_EXAM.map((n) => newProt(LIB.find((t) => t.name === n)!));
  clearSeries();
  ($('#tExam') as HTMLButtonElement).disabled = false;
  showView('exam');
  select(state.queue[0].id);
  setMsg(`Paciente ${P.last}^${P.first} registrado. Paso 1: mide el localizer con Go.`, 'ok');
}

export type View = 'patient' | 'exam' | '3d';
const HELP: Record<View, string> = {
  patient: 'Elige un paciente de la worklist o completa el registro y presiona Exam.',
  exam: 'Localizers: arrastra el slice group para moverlo, el punto para angular · Imágenes: arrastra ←→ ventana, ↑↓ centro · rueda o ‹ › corte · doble clic ventana automática',
  '3d': 'Cruz: arrastra el centro o una línea para mover planos, los puntos para rotar · rueda: avanzar · Ctrl+rueda: zoom · botón derecho: ventana · doble clic: restablecer vista',
};

export function showView(v: View): void {
  state.view = v;
  $('#viewPatient').hidden = v !== 'patient';
  $('#viewExam').hidden = v !== 'exam';
  $('#view3D').hidden = v !== '3d';
  $('#tPatient').setAttribute('aria-pressed', String(v === 'patient'));
  $('#tExam').setAttribute('aria-pressed', String(v === 'exam'));
  $('#t3D').setAttribute('aria-pressed', String(v === '3d'));
  $('#help').textContent = HELP[v];
  if (v === 'exam') requestAnimationFrame(() => allSegs.forEach(drawSeg));
  if (v === '3d') showMpr();
}
