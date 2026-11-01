// The protocol parameter card: tabs, fields and the info line with TA, SNR and SAR.
import type { ProtocolParams } from '../core/types';
import { fmtTA } from '../core/util';
import { derive, SEQLBL, type Derived, type Protocol } from '../physics/protocol';
import { $ } from './dom';
import { F, GEO, TABS, fmtVal, getP } from './fields';
import { sel, state } from './state';

function fieldHTML(tab: string, k: string, p: ProtocolParams, d: Derived, ro: boolean): string {
  const f = F[k];
  if (f.show && !f.show(p)) return '';
  if (p.loc && GEO.includes(k)) return '';
  const id = `f-${tab}-${k}`, dis = ro ? 'disabled' : '';
  if (f.kind === 'ro') return `<div class="fld"><span class="lbl">${f.l}</span><output class="val ro" id="${id}">${f.ro(p, d)}</output><span class="unit"></span></div>`;
  if (f.kind === 'sel') {
    const opts = f.opts.map(([v, t]) => `<option value="${v}" ${String(getP(p, k)) === String(v) ? 'selected' : ''}>${t}</option>`).join('');
    return `<div class="fld"><label class="lbl" for="${id}">${f.l}</label><select id="${id}" data-k="${k}" ${dis}>${opts}</select><span class="unit"></span></div>`;
  }
  return `<div class="fld"><label class="lbl" for="${id}">${f.l}</label><div class="num"><input id="${id}" data-k="${k}" value="${fmtVal(k, getP(p, k) as number)}" ${dis} inputmode="decimal" autocomplete="off" spellcheck="false"><span class="spin"><button type="button" data-k="${k}" data-d="1" ${dis} aria-label="Subir ${f.l}"></button><button type="button" data-k="${k}" data-d="-1" ${dis} aria-label="Bajar ${f.l}"></button></span></div><span class="unit">${f.u || ''}</span></div>`;
}

function infoHTML(p: Protocol, d: Derived): string {
  const rel = d.snr / p.snrRef, sarC = d.sar > 100 ? 'over' : d.sar > 80 ? 'hi' : '';
  const busy = !!state.running;
  return `<span>TA: <b>${fmtTA(d.TA)}</b></span><span>PAT: <b>${d.R > 1 ? d.R : 'Off'}</b></span><span>Voxel size: <b>${d.dr.toFixed(1)}×${d.dp.toFixed(1)}×${p.thick.toFixed(1)} mm</b></span><span>Rel. SNR: <b>${rel.toFixed(2)}</b></span><span>: <b>${SEQLBL[p.seq]}${p.seq === 'tse' ? p.ETL : ''}</b></span>
    <span class="sar ${sarC}" title="SAR estimado, % del límite modo normal${state.patient ? ` (${state.patient.w} kg)` : ''}">SAR <span class="m"><i style="width:${Math.min(100, d.sar)}%"></i></span><b>${Math.round(d.sar)}%</b></span>
    <span class="cact"><button class="btn stop" id="stopBtn" type="button" ${busy ? '' : 'disabled'}>Stop</button><button class="btn go" id="goBtn" type="button" ${p.state === 'pending' && !busy ? '' : 'disabled'}>Go</button></span>`;
}

export function renderCard(focusId?: string): void {
  const p = sel();
  $('#tabs').innerHTML = Object.keys(TABS).map((t) => `<button type="button" role="tab" aria-selected="${t === state.tab}" data-tab="${t}">${t}</button>`).join('');
  if (!p) {
    $('#cbody').innerHTML = '';
    $('#info').innerHTML = '';
    $('#pname').textContent = '—';
    $('#pbadge').textContent = '';
    return;
  }
  const d = derive(p, state.B0), ro = p.state !== 'pending';
  $('#pname').textContent = p.name;
  const b = $('#pbadge');
  b.className = 'badge ' + p.state;
  b.textContent = p.state === 'pending' ? 'abierto' : p.state === 'done' ? 'medido · solo lectura' : 'midiendo';
  const src: ProtocolParams = p.state === 'done' && p.snap ? p.snap : p;
  $('#cbody').innerHTML = TABS[state.tab].map((k) => fieldHTML(state.tab, k, src, d, ro)).join('') || '<span class="lbl">El localizer usa geometría fija en 3 planos.</span>';
  $('#info').innerHTML = infoHTML(p, d);
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) { el.focus(); el.select?.(); }
  }
}

/** Light refresh while dragging the slice group: values only, no rebuild. */
export function refreshCardValues(): void {
  const p = sel();
  if (!p) return;
  const d = derive(p, state.B0);
  for (const k of TABS[state.tab]) {
    const el = document.getElementById(`f-${state.tab}-${k}`);
    if (!el) continue;
    const f = F[k];
    if (f.kind === 'ro') el.textContent = String(f.ro(p, d));
    else if (el instanceof HTMLInputElement) el.value = fmtVal(k, getP(p, k) as number);
  }
  $('#info').innerHTML = infoHTML(p, d);
}
