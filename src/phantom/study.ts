// Turn an imported study into something the console can scan:
// - replay: the stored series themselves, chosen per protocol by weighting (real anatomy, real pathology)
// - synthetic: a tissue map classified from T1 (+ T2, FLAIR, ADC), so any TR/TE/TI changes the contrast
import type { PhantomData, ReplaySource, Vec3, Volume, Weighting } from '../core/types';
import { T } from '../physics/tissues';
import { makeInterp } from './volume';

type Vox = Int16Array | Uint16Array | Float32Array;
export interface StudySeries { vol: Volume<Vox>; weighting: Weighting; desc: string; volumetric: boolean; b?: number }

const center = (V: Volume): Vec3 =>
  [0, 1, 2].map((a) => V.O[a] + ((V.nx - 1) / 2) * V.sx * V.R[a] + ((V.ny - 1) / 2) * V.sy * V.Cd[a] + ((V.nz - 1) / 2) * V.sz * V.N[a]) as Vec3;

/** The series that sets the frame: a volumetric T1 if there is one, else the largest volumetric series. */
export function referenceSeries(series: StudySeries[]): StudySeries {
  const vol = series.filter((s) => s.volumetric);
  return vol.find((s) => s.weighting === 'T1') ?? vol.sort((a, b) => b.vol.nx * b.vol.ny * b.vol.nz - a.vol.nx * a.vol.ny * a.vol.nz)[0] ?? series[0];
}

/** One shift for every series, so co-registered series stay co-registered: the reference's centre goes to the isocentre (+10 mm toward the head, as for BrainWeb). */
export function studyShift(series: StudySeries[]): Vec3 {
  const c = center(referenceSeries(series).vol);
  return [-c[0], -c[1], 10 - c[2]];
}

/** Robust bright level of a volume: 99th percentile of the voxels above background. */
export function brightLevel(data: ArrayLike<number>): number {
  const step = Math.max(1, Math.floor(data.length / 150000)), s: number[] = [];
  for (let i = 0; i < data.length; i += step) { const v = data[i]; if (v === v) s.push(v); }
  s.sort((a, b) => a - b);
  const p999 = s[Math.floor((s.length - 1) * 0.999)] || 1;
  const fg = s.filter((v) => v > p999 * 0.05);
  return fg.length ? fg[Math.floor((fg.length - 1) * 0.99)] || p999 : p999;
}

export function buildReplay(series: StudySeries[]): PhantomData {
  const shift = studyShift(series);
  const sources: ReplaySource[] = series
    .filter((s) => s.weighting !== 'ADC')
    .map((s) => ({ vol: { ...s.vol, shift }, weighting: s.weighting, desc: s.desc, b: s.b, scale: 0.55 / brightLevel(s.vol.data) }));
  return { type: 'replay', sources };
}

/* ---------- synthetic contrast ---------- */

export interface SynthStats { voxels: number; mm: number; frac: Record<string, number>; lesionMl: number; infarctMl: number; channels: string[] }
const tick = () => new Promise((r) => setTimeout(r));

/** k-means on 1–2 features with fixed initial centroids, so cluster k keeps meaning tissue k. */
function kmeans(feat: Float32Array[], idx: Int32Array, init: number[][], iters = 6): number[][] {
  const K = init.length, D = feat.length, C = init.map((c) => c.slice());
  for (let it = 0; it < iters; it++) {
    const sum = C.map(() => new Float64Array(D)), cnt = new Float64Array(K);
    for (const v of idx) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { let d = 0; for (let f = 0; f < D; f++) { const q = feat[f][v] - C[k][f]; d += q * q; } if (d < bd) { bd = d; best = k; } }
      cnt[best]++;
      for (let f = 0; f < D; f++) sum[best][f] += feat[f][v];
    }
    for (let k = 0; k < K; k++) if (cnt[k] > 20) for (let f = 0; f < D; f++) C[k][f] = sum[k][f] / cnt[k];
  }
  return C;
}

/**
 * Tissue classification on the reference grid.
 * Needs a T1 series; a T2 separates fat from white matter and CSF far better; FLAIR adds white-matter
 * lesions; ADC (or DWI) adds restricted diffusion. Pathology outside these classes is not modelled.
 */
export async function buildSynthetic(series: StudySeries[], progress?: (msg: string) => void): Promise<{ phantom: PhantomData; stats: SynthStats }> {
  const ref = referenceSeries(series);
  if (ref.weighting !== 'T1') throw new Error('El contraste sintético necesita una serie T1 volumétrica.');
  const pick = (w: Weighting) => series.filter((s) => s.weighting === w && s !== ref).sort((a, b) => Number(b.volumetric) - Number(a.volumetric))[0];
  const t2s = pick('T2') ?? pick('STIR'), flair = pick('FLAIR'), adc = pick('ADC');
  const dwi = series.filter((s) => s.weighting === 'DWI').sort((a, b) => (b.b ?? 0) - (a.b ?? 0))[0];
  const R = ref.vol, f = Math.max(1, Math.ceil(Math.cbrt((R.nx * R.ny * R.nz) / 12e6)));
  const nx = Math.ceil(R.nx / f), ny = Math.ceil(R.ny / f), nz = Math.ceil(R.nz / f), n = nx * ny * nz, nxy = nx * ny;
  const shift = studyShift(series);
  const pos = (i: number, j: number, k: number): Vec3 =>
    [0, 1, 2].map((a) => R.O[a] + i * f * R.sx * R.R[a] + j * f * R.sy * R.Cd[a] + k * f * R.sz * R.N[a]) as Vec3;

  progress?.('Remuestreando las series al volumen T1…');
  const sample = async (s: StudySeries | undefined): Promise<Float32Array | null> => {
    if (!s) return null;
    const out = new Float32Array(n);
    if (s === ref) {
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
        out[k * nxy + j * nx + i] = R.data[(k * f * R.ny + j * f) * R.nx + i * f];
      return out;
    }
    const it = makeInterp({ ...s.vol, shift: [0, 0, 0] }), I = it.idx, W = it.w, d = s.vol.data;
    for (let k = 0; k < nz; k++) {
      if (k % 16 === 0) await tick();
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const p = pos(i, j, k);
        let v = NaN;
        if (it(p[0], p[1], p[2])) { v = 0; for (let q = 0; q < 8; q++) v += d[I[q]] * W[q]; }
        out[k * nxy + j * nx + i] = v;
      }
    }
    return out;
  };
  const norm = (a: Float32Array | null) => { if (a) { const b = brightLevel(a); for (let i = 0; i < a.length; i++) a[i] = a[i] / b; } return a; };
  const t1 = norm(await sample(ref))!;
  const t2 = norm(await sample(t2s));
  const fl = norm(await sample(flair));
  const ad = await sample(adc);
  const dw = adc ? null : norm(await sample(dwi));

  progress?.('Delimitando la cabeza…');
  await tick();
  // head = everything not reachable from the slice border through background, slice by slice
  const fg = new Uint8Array(n);
  for (let v = 0; v < n; v++) fg[v] = t1[v] > 0.1 || (t2 !== null && t2[v] > 0.1) ? 1 : 0;
  const inside = new Uint8Array(n).fill(1), stack: number[] = [];
  for (let k = 0; k < nz; k++) {
    const o = k * nxy;
    const push = (i: number, j: number) => { const v = o + j * nx + i; if (!fg[v] && inside[v]) { inside[v] = 0; stack.push(i, j); } };
    for (let i = 0; i < nx; i++) { push(i, 0); push(i, ny - 1); }
    for (let j = 0; j < ny; j++) { push(0, j); push(nx - 1, j); }
    while (stack.length) { const j = stack.pop()!, i = stack.pop()!; if (i > 0) push(i - 1, j); if (i < nx - 1) push(i + 1, j); if (j > 0) push(i, j - 1); if (j < ny - 1) push(i, j + 1); }
  }
  // depth below the scalp in mm, by repeated 6-neighbour erosion (capped at 30 mm)
  const vox = Math.min(R.sx, R.sy, R.sz) * f, maxIt = Math.min(40, Math.ceil(30 / vox));
  const depth = new Uint8Array(n);
  let cur = inside.slice();
  for (let it = 1; it <= maxIt; it++) {
    if (it % 4 === 0) await tick();
    const nxt = new Uint8Array(n);
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) {
      let v = k * nxy + j * nx + 1;
      for (let i = 1; i < nx - 1; i++, v++) if (cur[v] && cur[v - 1] && cur[v + 1] && cur[v - nx] && cur[v + nx] && cur[v - nxy] && cur[v + nxy]) { nxt[v] = 1; depth[v] = it; }
    }
    cur = nxt;
  }
  const dmm = (v: number) => depth[v] * vox;

  progress?.('Clasificando tejidos…');
  await tick();
  const lab = new Uint8Array(n);
  const cand: number[] = [];
  for (let v = 0; v < n; v++) {
    if (!inside[v]) continue;
    if (t1[v] < 0.12 && (t2 === null || !(t2[v] > 0.25))) { lab[v] = T.BONE; continue; }
    cand.push(v);
  }
  const sub = Int32Array.from(cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 120000)) === 0));
  const CLS = [T.WM, T.GM, T.CSF, T.FAT, T.MUSCLE];
  const hasT2 = t2 !== null;
  const t2f = t2 ?? new Float32Array(0);
  const feats = hasT2 ? [t1, t2f] : [t1];
  const init = hasT2 ? [[0.8, 0.3], [0.58, 0.45], [0.15, 1.0], [0.95, 0.75], [0.4, 0.18]] : [[0.8], [0.55], [0.15]];
  const Cn = kmeans(feats, sub, init);
  const brainCls = [0, 1, 2];
  for (const v of cand) {
    const d = dmm(v);
    // tissue allowed by depth: scalp layers only near the surface, brain only below the skull
    const allowed = hasT2 ? (d < 6 ? [3, 4] : d > 22 ? brainCls : [0, 1, 2, 3, 4]) : null;
    let best = -1, bd = Infinity;
    const ks = allowed ?? [0, 1, 2];
    for (const k of ks) { let dd = 0; for (let q = 0; q < feats.length; q++) { const x = feats[q][v] - Cn[k][q]; dd += x * x; } if (dd < bd) { bd = dd; best = k; } }
    let L: number = CLS[best];
    if (!hasT2 && d < 9) L = t1[v] > 0.7 ? T.FAT : t1[v] > 0.28 ? T.MUSCLE : T.BONE; // T1 only: scalp shell
    lab[v] = L;
  }

  // FLAIR: white-matter lesions are bright against normal white matter
  let lesion = 0, infarct = 0;
  const median = (a: number[]) => { a.sort((x, y) => x - y); return a[a.length >> 1] ?? 0; };
  if (fl) {
    // grey matter is normally brighter than white matter on FLAIR, so each tissue gets its own threshold
    const thr: Record<number, { f: number; t2: number }> = {};
    for (const cls of [T.WM, T.GM]) {
      const fv: number[] = [], tv: number[] = [];
      for (let v = 0; v < n; v += 7) if (lab[v] === cls && fl[v] === fl[v]) { fv.push(fl[v]); if (hasT2) tv.push(t2f[v]); }
      const m = median(fv), mad = median(fv.map((x) => Math.abs(x - m))) * 1.48;
      thr[cls] = { f: m + Math.max(0.35 * m, 4 * mad), t2: hasT2 ? median(tv) * 1.15 : 0 };
    }
    // lesions are iso- or hypointense on T1; fat is bright on T1 and FLAIR alike
    const t1wm = (() => { const a: number[] = []; for (let v = 0; v < n; v += 7) if (lab[v] === T.WM) a.push(t1[v]); return median(a); })();
    for (const v of cand) {
      const t = thr[lab[v]];
      if (t && fl[v] > t.f && dmm(v) > 10 && t1[v] < t1wm * 1.05 && (!hasT2 || t2f[v] > t.t2)) { lab[v] = T.LESION; lesion++; }
    }
  }
  // restricted diffusion: low ADC (or, without ADC, bright high-b DWI) in brain tissue
  if (ad || dw) {
    const src = (ad ?? dw)!;
    const br: number[] = [];
    for (let v = 0; v < n; v += 7) if ((lab[v] === T.WM || lab[v] === T.GM) && src[v] === src[v]) br.push(src[v]);
    const m = median(br);
    for (const v of cand) {
      const L = lab[v];
      if (!(L === T.WM || L === T.GM || L === T.LESION) || dmm(v) < 8 || !(src[v] === src[v])) continue;
      if (ad ? src[v] < 0.62 * m && src[v] > 0.15 * m : src[v] > 1.9 * m) { lab[v] = T.INFARCT; infarct++; }
    }
  }

  progress?.('Limpiando la segmentación…');
  await tick();
  // one majority pass removes isolated voxels left by noise
  const out = lab.slice(), cnt = new Uint8Array(16);
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) {
    let v = k * nxy + j * nx + 1;
    for (let i = 1; i < nx - 1; i++, v++) {
      const L = lab[v];
      if (!inside[v] || L === T.LESION || L === T.INFARCT) continue;
      const nb = [lab[v - 1], lab[v + 1], lab[v - nx], lab[v + nx], lab[v - nxy], lab[v + nxy]];
      let same = 0;
      for (const x of nb) if (x === L) same++;
      if (same >= 2) continue;
      cnt.fill(0);
      let best = L, bc = 0;
      for (const x of nb) if (++cnt[x] > bc) { bc = cnt[x]; best = x; }
      out[v] = best;
    }
  }

  const frac: Record<string, number> = {};
  let tot = 0;
  const names: Record<number, string> = { [T.WM]: 'SB', [T.GM]: 'SG', [T.CSF]: 'LCR', [T.FAT]: 'grasa', [T.MUSCLE]: 'músculo', [T.BONE]: 'hueso/aire', [T.LESION]: 'lesión', [T.INFARCT]: 'restricción' };
  for (let v = 0; v < n; v++) if (inside[v]) { tot++; const nm = names[out[v]]; if (nm) frac[nm] = (frac[nm] || 0) + 1; }
  for (const k of Object.keys(frac)) frac[k] /= tot || 1;
  const ml = (c: number) => (c * vox * vox * vox) / 1000;
  const channels = ['T1', t2 ? (t2s!.weighting === 'STIR' ? 'STIR' : 'T2') : '', fl ? 'FLAIR' : '', ad ? 'ADC' : dw ? 'DWI' : ''].filter(Boolean);
  const vol: Volume<Uint8Array> = { nx, ny, nz, data: out, O: R.O.slice() as Vec3, R: R.R, Cd: R.Cd, N: R.N, sx: R.sx * f, sy: R.sy * f, sz: R.sz * f, shift };
  return { phantom: { type: 'labels', vol }, stats: { voxels: n, mm: vox, frac, lesionMl: ml(lesion), infarctMl: ml(infarct), channels } };
}
