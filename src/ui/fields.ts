// Parameter definitions for the protocol card: label, unit, limits, step and visibility.
import type { ProtocolParams } from '../core/types';
import { derive, type Derived } from '../physics/protocol';
import { orientText } from '../imaging/geometry';

interface Base { l: string; show?: (p: ProtocolParams) => boolean }
export interface NumField extends Base { kind: 'num'; u?: string; min: number; max: number; st: number | ((p: ProtocolParams) => number); dec: number }
export interface SelField extends Base { kind: 'sel'; opts: [string | number, string][] }
export interface RoField extends Base { kind: 'ro'; ro: (p: ProtocolParams, d: Derived) => string | number }
export type Field = NumField | SelField | RoField;

const num = (l: string, min: number, max: number, st: NumField['st'], dec: number, u?: string, show?: Base['show']): NumField => ({ kind: 'num', l, min, max, st, dec, u, show });

export const F: Record<string, Field> = {
  slices: num('Slices', 1, 60, 1, 0),
  dist: num('Dist. factor', 0, 100, 5, 0, '%'),
  pos: num('Position F-H', -60, 90, 0.5, 1, 'mm'),
  offX: num('Position R-L', -60, 60, 0.5, 1, 'mm'),
  offY: num('Position A-P', -80, 80, 0.5, 1, 'mm'),
  tilt: num('Angulation T>C', -45, 45, 0.5, 1, 'deg'),
  tiltS: num('Angulation T>S', -45, 45, 0.5, 1, 'deg'),
  rot: num('Inplane rotation', -180, 180, 0.5, 1, 'deg'),
  orient: { kind: 'ro', l: 'Orientation', ro: (p) => orientText(p) },
  phaseDir: { kind: 'sel', l: 'Phase enc. dir.', opts: [['RL', 'R >> L'], ['AP', 'A >> P']] },
  fovRead: num('FoV read', 100, 300, 5, 0, 'mm'),
  fovPh: num('FoV phase', 50, 100, 3.125, 1, '%'),
  thick: num('Slice thickness', 1, 10, 0.5, 1, 'mm'),
  TR: num('TR', 2, 15000, (p) => (p.TR < 100 ? 0.1 : p.TR < 1000 ? 5 : 10), 1, 'ms'),
  TE: num('TE', 1, 300, (p) => (p.seq === 'tse' ? derive(p).ES : p.TE < 20 ? 0.1 : 1), 1, 'ms'),
  nex: num('Averages', 1, 8, 1, 0),
  concat: { kind: 'ro', l: 'Concatenations', ro: (_p, d) => d.concat },
  prep: { kind: 'sel', l: 'Magn. preparation', opts: [['none', 'None'], ['ir', 'Non-sel. IR']], show: (p) => p.seq === 'tse' || p.seq === 'se' },
  TI: num('TI', 20, 5000, 10, 0, 'ms', (p) => p.prep === 'ir'),
  FA: num('Flip angle', 1, 90, 1, 0, 'deg', (p) => p.seq === 'gre'),
  refFA: num('Flip angle', 90, 180, 5, 0, 'deg', (p) => p.seq === 'tse'),
  fat: { kind: 'sel', l: 'Fat suppr.', opts: [['none', 'None'], ['fs', 'Fat sat.']] },
  b: num('b-value', 0, 3000, 50, 0, 's/mm²', (p) => p.seq === 'epi'),
  base: num('Base resolution', 64, 512, 16, 0),
  phRes: num('Phase resolution', 50, 100, 1, 0, '%'),
  os: num('Phase oversampling', 0, 100, 10, 0, '%'),
  pat: { kind: 'sel', l: 'Accel. factor PE', opts: [[1, '1 (Off)'], [2, '2'], [3, '3']] },
  interp: { kind: 'sel', l: 'Interpolation', opts: [['on', 'On'], ['off', 'Off']] },
  voxel: { kind: 'ro', l: 'Voxel size', ro: (p, d) => `${d.dr.toFixed(1)}×${d.dp.toFixed(1)}×${p.thick.toFixed(1)} mm` },
  bw: num('Bandwidth', 80, 2500, 10, 0, 'Hz/Px'),
  ETL: num('Turbo factor', 1, 31, 1, 0, undefined, (p) => p.seq === 'tse'),
  ES: { kind: 'ro', l: 'Echo spacing', ro: (_p, d) => d.ES.toFixed(2) + ' ms', show: (p) => p.seq === 'tse' },
  trains: { kind: 'ro', l: 'Echo trains / slice', ro: (_p, d) => d.trains, show: (p) => p.seq === 'tse' },
  epiF: { kind: 'ro', l: 'EPI factor', ro: (_p, d) => d.epiF, show: (p) => p.seq === 'epi' },
  rf: { kind: 'sel', l: 'RF pulse type', opts: [['normal', 'Normal'], ['lowsar', 'Low SAR'], ['fast', 'Fast']] },
};

/** Fields that do not apply to the 3-plane localizer. */
export const GEO = ['slices', 'dist', 'pos', 'offX', 'offY', 'tilt', 'tiltS', 'rot', 'orient'];

export const TABS: Record<string, string[]> = {
  Routine: ['slices', 'dist', 'pos', 'phaseDir', 'fovRead', 'fovPh', 'thick', 'TR', 'TE', 'nex', 'concat'],
  Geometry: ['slices', 'dist', 'thick', 'pos', 'offX', 'offY', 'tilt', 'tiltS', 'rot', 'orient', 'phaseDir'],
  Contrast: ['TR', 'TE', 'prep', 'TI', 'FA', 'refFA', 'fat', 'b'],
  Resolution: ['base', 'phRes', 'os', 'pat', 'interp', 'voxel'],
  Sequence: ['bw', 'ETL', 'ES', 'trains', 'epiF', 'rf'],
};

/** Positions are shown with their direction letter, as on the console: H/F, L/R, P/A. */
const PREF: Record<string, [string, string]> = { pos: ['H', 'F'], offX: ['L', 'R'], offY: ['P', 'A'] };

export const getP = (p: ProtocolParams, k: string): unknown => (p as unknown as Record<string, unknown>)[k];
export const setP = (p: ProtocolParams, k: string, v: unknown): void => { (p as unknown as Record<string, unknown>)[k] = v; };

export function fmtVal(k: string, v: number): string {
  const pref = PREF[k];
  if (pref) return (v >= 0 ? pref[0] : pref[1]) + Math.abs(v).toFixed(1);
  const f = F[k];
  return Number(v).toFixed(f.kind === 'num' ? f.dec : 0);
}

export function parseNum(k: string, raw: string): number {
  raw = String(raw).trim().replace(',', '.');
  const pref = PREF[k];
  if (pref) {
    const m = raw.match(/^([A-Za-z])?\s*(-?[\d.]+)/);
    if (!m) return NaN;
    let v = parseFloat(m[2]);
    if (m[1] && m[1].toUpperCase() === pref[1]) v = -Math.abs(v);
    return v;
  }
  return parseFloat(raw);
}

export function stepOf(k: string, p: ProtocolParams): number {
  const f = F[k];
  if (f.kind !== 'num') return 0;
  return typeof f.st === 'function' ? f.st(p) : f.st;
}

/** Clamp and round a typed value the way the console's spin boxes do. */
export function coerce(k: string, n: number): number {
  const f = F[k] as NumField;
  n = Math.max(f.min, Math.min(f.max, n));
  if (k === 'fovPh') return Math.max(50, Math.min(100, Math.round(n / 3.125) * 3.125));
  if (k === 'base') n = Math.max(64, Math.min(512, Math.round(n / 16) * 16));
  return Math.round(n * 10 ** f.dec) / 10 ** f.dec;
}
