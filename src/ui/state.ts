import type { Env, Pathology, Scan } from '../core/types';
import { paramsOf, type Protocol } from '../physics/protocol';

export interface Patient {
  last: string;
  first: string;
  id: string;
  sex: string;
  dob: string;
  age: number;
  h: number;
  w: number;
  proc: string;
}

export interface PhantomInfo { name: string; imported: boolean; ready: boolean }

export const state = {
  B0: 1.5,
  path: 'normal' as Pathology,
  phantom: 'geo',
  sound: false,
  queue: [] as Protocol[],
  selId: null as number | null,
  series: 0,
  running: null as Protocol | null,
  tab: 'Routine',
  patient: null as Patient | null,
  view: 'patient' as 'patient' | 'exam',
};

/** Names of the phantoms the console can scan, by id. The voxel data lives in the imaging engine. */
export const phantoms = new Map<string, PhantomInfo>([['geo', { name: 'Geométrico', imported: false, ready: true }]]);

export const sel = (): Protocol | undefined => state.queue.find((p) => p.id === state.selId);
export const locDone = (): Protocol | undefined => state.queue.find((p) => p.loc && p.state === 'done');
export const lastGeoSeries = (except?: Protocol): Protocol | undefined =>
  state.queue.filter((q) => q.state === 'done' && !q.loc && q !== except).sort((a, b) => (b.series ?? 0) - (a.series ?? 0))[0];

export function envParams(): Env {
  const ph = phantoms.get(state.phantom);
  return { B0: state.B0, phantom: state.phantom, path: ph?.imported ? 'normal' : state.path };
}

/** The protocol as it would be measured right now. */
export const previewScan = (p: Protocol): Scan => ({ ...paramsOf(p), ...envParams() });
