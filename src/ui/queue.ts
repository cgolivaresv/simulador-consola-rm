import { fmtTA } from '../core/util';
import { derive, LIB } from '../physics/protocol';
import { $, esc } from './dom';
import { lastGeoSeries, sel, state } from './state';

export function renderLib(): void {
  $('#lib').innerHTML = LIB.map((t, i) => `<li><span>${t.name}</span><span class="sq">${t.seq}</span><button class="add" type="button" data-i="${i}" aria-label="Agregar ${t.name} a la cola">+</button></li>`).join('');
}

export function renderQueue(): void {
  $('#queue').innerHTML = state.queue.map((p) => {
    const d = derive(p, state.B0);
    const right = p.state === 'done' ? `Se ${p.series}` : p.state === 'running' ? `<span data-rem>${fmtTA(d.TA * (1 - p.prog))}</span>` : fmtTA(d.TA);
    const thumb = p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="qth"></span>';
    return `<li class="qi ${p.state} ${p.id === state.selId ? 'sel' : ''}" data-id="${p.id}" tabindex="0"><span class="dot"></span>${thumb}<span class="qn">${esc(p.name)}</span><span class="qt">${right}</span><span class="qbar"><i style="width:${p.state === 'running' ? p.prog * 100 : 0}%"></i></span></li>`;
  }).join('');
  const pend = state.queue.filter((p) => p.state !== 'done');
  $('#qcount').textContent = `${state.queue.length - pend.length}/${state.queue.length}`;
  $('#qtime').textContent = 'Tiempo restante ' + fmtTA(pend.reduce((s, p) => s + derive(p, state.B0).TA * (1 - p.prog), 0));
  const p = sel();
  ($('#rep') as HTMLButtonElement).disabled = !p;
  ($('#del') as HTMLButtonElement).disabled = !p || p.state !== 'pending';
  ($('#cpy') as HTMLButtonElement).disabled = !p || p.state !== 'pending' || p.loc || !lastGeoSeries(p);
}
