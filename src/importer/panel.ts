// "Fantoma · Datos propios" panel. Files are read in this browser only; nothing is uploaded.
import type { PhantomData, Volume } from '../core/types';
import { $, esc } from '../ui/dom';
import { buildFromLabels, buildFromMaps, guessRole, type Role } from './build';
import { DicomError, dicomVolume, parseDicom, type Slice } from './dicom';
import { parseNifti } from './nifti';

interface Series { desc: string; kind: 'dicom' | 'nifti'; slices: Slice[] | null; vol: Volume<Float32Array> | null; dims: string; role: Role }
interface Report { files: number; ok: number; fail: number; compressed: number; phi: Set<string>; priv: number }

let series: Series[] = [];
let report: Report | null = null;
let count = 0;

export type OnPhantom = (id: string, name: string, phantom: PhantomData) => void;

export async function readImport(fileList: FileList | File[]): Promise<void> {
  const files = [...fileList];
  if (!files.length) return;
  const out = $('#impOut');
  const groups = new Map<string, Series>();
  const rep: Report = { files: files.length, ok: 0, fail: 0, compressed: 0, phi: new Set(), priv: 0 };
  for (let i = 0; i < files.length; i++) {
    if (i % 10 === 0) { out.innerHTML = `<p>Leyendo ${i + 1} de ${files.length} archivos…</p>`; await new Promise((r) => setTimeout(r)); }
    const f = files[i];
    try {
      const buf = await f.arrayBuffer();
      if (/\.nii(\.gz)?$/i.test(f.name)) {
        const n = await parseNifti(buf, f.name);
        n.phi.forEach((x) => rep.phi.add(x));
        groups.set(`nii:${i}`, { desc: n.desc, kind: 'nifti', slices: null, vol: n.vol, dims: `${n.vol.nx}×${n.vol.ny}×${n.vol.nz}`, role: guessRole(f.name) });
        rep.ok++;
        continue;
      }
      const d = parseDicom(buf);
      d.phi.forEach((x) => rep.phi.add(x));
      rep.priv += d.priv;
      rep.ok++;
      let g = groups.get(d.slice.series);
      if (!g) { g = { desc: d.slice.desc, kind: 'dicom', slices: [], vol: null, dims: '', role: guessRole(d.slice.desc + ' ' + d.slice.type) }; groups.set(d.slice.series, g); }
      g.slices!.push(d.slice);
    } catch (e) {
      rep.fail++;
      if (e instanceof DicomError && e.reason === 'compressed') rep.compressed++;
    }
  }
  series = [];
  for (const g of groups.values()) {
    try {
      if (g.kind === 'dicom') { g.vol = dicomVolume(g.slices!); g.dims = `${g.vol.nx}×${g.vol.ny}×${g.vol.nz}`; g.slices = null; }
      series.push(g);
    } catch { rep.fail++; }
  }
  report = rep;
  renderImport();
}

function renderImport(): void {
  const rep = report!, phi = [...rep.phi];
  let h = `<div class="anon"><b>Anonimización local:</b> se leyeron ${rep.ok} de ${rep.files} archivos${rep.fail ? ` (${rep.fail} omitidos${rep.compressed ? `, ${rep.compressed} con compresión no soportada: expórtalos sin compresión o conviértelos a NIfTI con dcm2niix` : ''})` : ''}. `;
  h += phi.length
    ? `Datos identificatorios encontrados y descartados, sin guardarse ni mostrarse:<ul>${phi.map((x) => `<li>${x}</li>`).join('')}${rep.priv ? `<li>${rep.priv} tags privados del fabricante</li>` : ''}</ul>`
    : `No se encontraron datos identificatorios en los encabezados.${rep.priv ? ` Se descartaron ${rep.priv} tags privados.` : ''}`;
  h += 'Solo se conservan la matriz de píxeles, la geometría (posición, orientación, espaciado) y la descripción de la serie.</div>';
  if (series.length) {
    const opts: [Role, string][] = [['none', 'Ignorar'], ['t1', 'Mapa T1'], ['t2', 'Mapa T2'], ['pd', 'Mapa PD'], ['labels', 'Segmentación']];
    h += `<table class="sertab"><thead><tr><th>Serie</th><th>Matriz</th><th>Uso</th></tr></thead><tbody>${series.map((g, i) => `<tr><td>${esc(g.desc)}</td><td>${g.dims}</td><td><select data-i="${i}" aria-label="Uso de la serie ${i + 1}">${opts.map(([v, t]) => `<option value="${v}" ${g.role === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>
    <div class="row"><button class="btn go" type="button" id="impBuild">Crear fantoma</button><span class="lbl" id="impHint">Asigna T1 + T2 + PD, o una segmentación.</span></div>`;
  }
  $('#impOut').innerHTML = h;
}

function build(onPhantom: OnPhantom): void {
  const pick = (r: Role) => series.find((g) => g.role === r)?.vol ?? null;
  const t1 = pick('t1'), t2 = pick('t2'), pd = pick('pd'), lab = pick('labels');
  const doDeface = ($('#impDeface') as HTMLInputElement).checked;
  let built;
  try {
    if (t1 && t2 && pd) built = buildFromMaps(t1, t2, pd, doDeface);
    else if (lab) built = buildFromLabels(lab, doDeface);
    else { $('#impHint').textContent = 'Falta asignar T1, T2 y PD, o una segmentación.'; return; }
  } catch (e) {
    $('#impHint').textContent = (e as Error).message;
    return;
  }
  count++;
  const id = 'imp' + count, name = `Importado ${count} · ${built.desc}`;
  series = [];
  $('#impOut').innerHTML = `<div class="anon"><b>Fantoma creado:</b> ${esc(name)}. Ya está seleccionado; los datos de origen se liberaron de la memoria.</div>`;
  $('#impState').textContent = `${count} importado${count > 1 ? 's' : ''}`;
  onPhantom(id, name, built.phantom);
}

export function initImportPanel(onPhantom: OnPhantom): void {
  for (const id of ['#impFiles', '#impDir']) {
    const el = $(id) as HTMLInputElement;
    el.addEventListener('change', () => { void readImport(el.files ? [...el.files] : []); el.value = ''; });
  }
  $('#impOut').addEventListener('change', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-i]');
    if (s) series[Number(s.dataset.i)].role = s.value as Role;
  });
  $('#impOut').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 'impBuild') build(onPhantom); });
}
