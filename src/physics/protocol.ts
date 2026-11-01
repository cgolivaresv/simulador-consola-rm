import type { ProtocolParams, Scan, Seq, Img, Plane } from '../core/types';
import { clamp, f1 } from '../core/util';

export interface Derived {
  R: number;
  readout: number;
  ES: number;
  minTE: number;
  maxTE: number;
  TEeff: number;
  sliceT: number;
  minTR: number;
  maxSlices: number;
  concat: number;
  TA: number;
  dr: number;
  dp: number;
  snr: number;
  sar: number;
  lines: number;
  linesNom: number;
  acq: number;
  train: number;
  epiF: number;
  trains: number;
}

const RF_DUR = { normal: 4.5, lowsar: 6, fast: 3.4 } as const;
const RF_SAR = { normal: 1, lowsar: 0.6, fast: 1.35 } as const;

/** Timing, resolution, SNR and SAR that follow from the parameters (ms, mm, % of normal-mode SAR). */
export function derive(p: ProtocolParams, B0 = 1.5): Derived {
  const R = p.pat, readout = 1000 / p.bw, rfDur = RF_DUR[p.rf];
  const linesNom = Math.max(8, Math.round((p.base * p.phRes) / 100));
  const lines = Math.round(linesNom * (1 + p.os / 100));
  const acq = R > 1 ? Math.ceil(lines / R) + Math.round(24 * (1 - 1 / R)) : lines;
  let ES = 0, minTE: number, maxTE = 300, TEeff = p.TE, sliceT: number, train = 0;
  if (p.seq === 'tse') {
    ES = Math.round((readout + rfDur) * 100) / 100;
    minTE = ES;
    maxTE = Math.round(ES * p.ETL * 10) / 10;
    TEeff = Math.round(clamp(Math.round(p.TE / ES), 1, p.ETL) * ES * 10) / 10;
    sliceT = p.ETL * ES + 8;
  } else if (p.seq === 'se') {
    minTE = Math.round((readout + 3 + (p.rf === 'lowsar' ? 1 : 0)) * 10) / 10;
    TEeff = Math.max(p.TE, minTE);
    sliceT = TEeff + readout / 2 + 5;
  } else if (p.seq === 'gre') {
    minTE = Math.round((0.5 * readout + 1.5) * 100) / 100;
    maxTE = 100;
    TEeff = Math.max(p.TE, minTE);
    sliceT = TEeff + readout / 2 + 2;
  } else {
    train = (R > 1 ? Math.ceil(lines / R) : lines) * readout;
    minTE = Math.round((25 + (25 * p.b) / 1000 + train / 2) * 10) / 10;
    TEeff = Math.max(p.TE, minTE);
    sliceT = TEeff + train / 2 + 10;
  }
  if (p.fat === 'fs') sliceT += 10;
  if (p.prep === 'ir') sliceT += 6;
  const minTR = sliceT + (p.prep === 'ir' ? p.TI : 0);
  const TR = Math.max(p.TR, minTR);
  const maxSlices = Math.max(1, Math.floor(TR / sliceT));
  const concat = Math.ceil(p.slices / maxSlices);
  let TA: number;
  if (p.loc) TA = TR * acq * p.nex * 3;
  else if (p.seq === 'tse') TA = TR * Math.ceil(acq / p.ETL) * p.nex * concat;
  else if (p.seq === 'epi') TA = TR * p.nex * (p.b > 0 ? 4 : 1) * concat + TR;
  else TA = TR * acq * p.nex * concat;
  const dr = p.fovRead / p.base, dp = (p.fovRead * p.fovPh) / 100 / linesNom;
  const g = R === 1 ? 1 : R === 2 ? 1.1 : 1.35;
  const snr = ((dr * dp * p.thick) / 5) * Math.sqrt(((lines / 256) * p.nex * 200) / p.bw) / (g * Math.sqrt(R)) * (B0 === 3 ? 1.9 : 1);
  const exc = p.seq === 'gre' ? (p.FA / 90) ** 2 : 1;
  const ref = p.seq === 'se' ? 4 : p.seq === 'tse' ? p.ETL * (p.refFA / 90) ** 2 : p.seq === 'epi' ? 4 : 0;
  const units = exc + ref + (p.prep === 'ir' ? 4 : 0) + (p.fat === 'fs' ? 1.5 : 0);
  const sar = ((units * Math.min(p.slices, maxSlices)) / (TR / 1000)) * RF_SAR[p.rf] * (B0 / 1.5) ** 2 * 0.16;
  return {
    R, readout, ES, minTE, maxTE, TEeff, sliceT, minTR, maxSlices, concat, TA, dr, dp, snr, sar, lines, linesNom, acq, train,
    epiF: R > 1 ? Math.ceil(lines / R) : lines,
    trains: p.seq === 'tse' ? Math.ceil(acq / p.ETL) : 0,
  };
}

/** Pull TE and TR back inside what the sequence can do. Returns the console messages for each correction. */
export function normalize(p: ProtocolParams): string[] {
  const msgs: string[] = [];
  if (p.prep === 'ir' && !(p.seq === 'tse' || p.seq === 'se')) p.prep = 'none';
  for (let it = 0; it < 3; it++) {
    const d = derive(p);
    if (p.seq === 'tse') {
      if (Math.abs(p.TE - d.TEeff) > 0.05) {
        p.TE = d.TEeff;
        msgs.push(`TE efectivo ${f1(d.TEeff)} ms (múltiplo del echo spacing ${d.ES.toFixed(2)} ms).`);
      }
    } else if (p.TE < d.minTE - 1e-9) {
      p.TE = d.minTE;
      msgs.push(`TE ajustado al mínimo posible: ${f1(d.minTE)} ms.`);
    }
    if (p.TE > d.maxTE + 1e-9) {
      p.TE = d.maxTE;
      msgs.push(`TE ajustado al máximo: ${f1(d.maxTE)} ms.`);
    }
    if (p.TR < d.minTR - 1e-9) {
      p.TR = Math.ceil(d.minTR * 10) / 10;
      msgs.push(`TR aumentado a ${f1(p.TR)} ms (mínimo para los parámetros actuales).`);
    }
  }
  return [...new Set(msgs)];
}

export const BASE: Omit<ProtocolParams, 'name' | 'seq' | 'TR' | 'TE'> = {
  prep: 'none', TI: 2500, FA: 90, refFA: 150, ETL: 1, bw: 200, nex: 1, slices: 20, thick: 5, dist: 30, pos: 12,
  offX: 0, offY: 0, tilt: 0, tiltS: 0, rot: 0, ori: 'tra', fovRead: 230, fovPh: 87.5, base: 256, phRes: 75, os: 0, phaseDir: 'RL', pat: 1,
  fat: 'none', b: 0, rf: 'normal', interp: 'on', loc: false,
};

export type Template = Partial<ProtocolParams> & { name: string; seq: Seq; TR: number; TE: number };

export const LIB: Template[] = [
  { name: 'localizer', loc: true, seq: 'gre', TR: 8.6, TE: 4, FA: 20, bw: 320, slices: 1, thick: 7, dist: 0, pos: 20, fovRead: 260, fovPh: 100, base: 256, phRes: 100, phaseDir: 'AP' },
  { name: 't2_tse_tra', seq: 'tse', TR: 4000, TE: 99, refFA: 150, ETL: 15, bw: 190, base: 384, phRes: 75, pat: 2 },
  { name: 't1_se_tra', seq: 'se', TR: 500, TE: 10, bw: 160 },
  { name: 't2_tirm_tra_dark-fluid', seq: 'tse', prep: 'ir', TR: 9000, TI: 2500, TE: 84, ETL: 16, bw: 260 },
  { name: 'ep2d_diff_tra_b1000', seq: 'epi', TR: 5000, TE: 94, bw: 1100, base: 192, phRes: 100, fovPh: 100, pat: 2, nex: 2, b: 1000, fat: 'fs', phaseDir: 'AP' },
  { name: 't2_fl2d_tra_hemo', seq: 'gre', TR: 650, TE: 20, FA: 20, bw: 120 },
  { name: 't1_fl2d_tra', seq: 'gre', TR: 250, TE: 4.8, FA: 70, bw: 260 },
  { name: 't2_tse_sag', ori: 'sag', seq: 'tse', TR: 4000, TE: 99, ETL: 15, bw: 190, slices: 19, thick: 4, dist: 20, pos: 10, fovRead: 230, fovPh: 100, base: 320, phRes: 75, pat: 2 },
  { name: 't1_se_sag', ori: 'sag', seq: 'se', TR: 500, TE: 10, bw: 160, slices: 19, thick: 4, dist: 20, pos: 10, fovRead: 230, fovPh: 100 },
  { name: 't2_tse_cor', ori: 'cor', seq: 'tse', TR: 4000, TE: 99, ETL: 15, bw: 190, slices: 24, thick: 4, dist: 20, pos: 10, fovRead: 230, fovPh: 100, base: 320, phRes: 75, pat: 2 },
  { name: 't2_tirm_cor_dark-fluid', ori: 'cor', seq: 'tse', prep: 'ir', TR: 9000, TI: 2500, TE: 84, ETL: 16, bw: 260, slices: 24, thick: 4, dist: 20, pos: 10, fovRead: 230, fovPh: 100 },
  { name: 't2_tse_cor_hippo', ori: 'cor', seq: 'tse', TR: 5000, TE: 100, ETL: 13, bw: 160, slices: 24, thick: 3, dist: 10, pos: -5, offY: 15, fovRead: 180, fovPh: 100, base: 384, phRes: 80 },
];
export const DEFAULT_EXAM = ['localizer', 't2_tse_tra', 't1_se_tra', 't2_tirm_tra_dark-fluid', 'ep2d_diff_tra_b1000', 't2_fl2d_tra_hemo'];

export const SEQLBL: Record<Seq, string> = { tse: 'tse', se: 'se', gre: 'fl', epi: 'ep_b' };

export type ProtState = 'pending' | 'running' | 'done';

/** A protocol in the exam queue. */
export interface Protocol extends ProtocolParams {
  id: number;
  state: ProtState;
  prog: number;
  seed: number;
  snrRef: number;
  snap?: Scan;
  series?: number;
  thumb?: string;
  locImgs?: Record<Plane, Img>;
  t0?: number;
  dur?: number;
}

let uid = 1;
export function newProt(t: Template): Protocol {
  const p = { ...BASE, ...t, id: uid++, state: 'pending', prog: 0, seed: (Math.random() * 1e9) | 0, snrRef: 1 } as Protocol;
  normalize(p);
  p.snrRef = derive(p).snr;
  return p;
}

/** Only the technologist-facing parameters, without queue state. */
export function paramsOf(p: ProtocolParams): ProtocolParams {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(BASE).concat(['name', 'seq', 'TR', 'TE'])) out[k] = (p as unknown as Record<string, unknown>)[k];
  return out as unknown as ProtocolParams;
}
