// Turn imported volumes into phantoms: quantitative maps or tissue labels, centred and optionally defaced.
import type { PhantomData, Vec3, Volume } from '../core/types';

export type Role = 'none' | 't1' | 't2' | 'pd' | 'labels';

export function guessRole(text: string): Role {
  const t = text.toLowerCase();
  if (/seg|aseg|synthseg|label|fast|pve|tissue/.test(t)) return 'labels';
  if (/t1.?map|qt1|\bt1\b|r1/.test(t)) return 't1';
  if (/t2.?map|qt2|\bt2\b|r2/.test(t)) return 't2';
  if (/pd|m0|rho|proton/.test(t)) return 'pd';
  return 'none';
}

/** FreeSurfer / SynthSeg label → console tissue (5 WM, 4 GM, 3 CSF, 10 vessels). Cortical parcels (1000–2999) are GM. */
export const FSLUT: Record<number, number> = {
  2: 5, 41: 5, 7: 5, 46: 5, 16: 5, 28: 5, 60: 5, 77: 5, 85: 5, 192: 5, 251: 5, 252: 5, 253: 5, 254: 5, 255: 5,
  3: 4, 42: 4, 8: 4, 47: 4, 10: 4, 49: 4, 11: 4, 50: 4, 12: 4, 51: 4, 13: 4, 52: 4, 17: 4, 53: 4, 18: 4, 54: 4, 26: 4, 58: 4,
  4: 3, 5: 3, 43: 3, 44: 3, 14: 3, 15: 3, 24: 3, 31: 3, 63: 3, 72: 3, 30: 10, 62: 10,
};

export function pct(a: ArrayLike<number>, q: number): number {
  const s: number[] = [], step = Math.max(1, (a.length / 20000) | 0);
  for (let i = 0; i < a.length; i += step) if (a[i] > 0) s.push(a[i]);
  s.sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length * q)] : 0;
}

const voxelPos = (V: Volume, i: number): Vec3 => {
  const c = i % V.nx, r = ((i / V.nx) | 0) % V.ny, k = (i / (V.nx * V.ny)) | 0;
  return [0, 1, 2].map((a) => V.O[a] + V.shift[a] + c * V.sx * V.R[a] + r * V.sy * V.Cd[a] + k * V.sz * V.N[a]) as Vec3;
};

/** Put the centre of the volume at the isocentre, slightly toward the head like a real head setup. */
export function centerShift(V: Volume): void {
  const c = [0, 0, 0];
  for (const [k, r, cc] of [[0, 0, 0], [V.nz - 1, V.ny - 1, V.nx - 1]])
    for (let a = 0; a < 3; a++) c[a] += (V.O[a] + cc * V.sx * V.R[a] + r * V.sy * V.Cd[a] + k * V.sz * V.N[a]) / 2;
  V.shift = [-c[0], -c[1], 10 - c[2]];
}

/** Remove the face: voxels in front of the brain and below the frontal lobe. Returns how many were cleared. */
export function deface(V: Volume, isBrain: (i: number) => boolean, clear: (i: number) => void): number {
  const n = V.nx * V.ny * V.nz, step = Math.max(1, (n / 400000) | 0);
  let minY = 1e9;
  for (let i = 0; i < n; i += step) if (isBrain(i)) { const p = voxelPos(V, i); if (p[1] < minY) minY = p[1]; }
  if (minY > 1e8) return 0;
  let fz = 1e9;
  for (let i = 0; i < n; i += step) if (isBrain(i)) { const p = voxelPos(V, i); if (p[1] < minY + 30 && p[2] < fz) fz = p[2]; }
  let cnt = 0;
  for (let i = 0; i < n; i++) { const p = voxelPos(V, i); if (p[1] < minY + 12 && p[2] < fz + 8) { clear(i); cnt++; } }
  return cnt;
}

export interface Built { phantom: PhantomData; desc: string }

/** T1 and T2 in ms (seconds are detected and converted), PD scaled to 0–1. */
export function buildFromMaps(t1: Volume<Float32Array>, t2: Volume<Float32Array>, pd: Volume<Float32Array>, doDeface: boolean): Built {
  const same = (a: Volume, b: Volume) => a.nx === b.nx && a.ny === b.ny && a.nz === b.nz;
  if (!same(t1, t2) || !same(t1, pd)) throw new Error('Los tres mapas deben tener la misma matriz y número de cortes.');
  const A = t1.data, B = t2.data, C = pd.data;
  const k1 = pct(A, 0.5) < 10 ? 1000 : 1, k2 = pct(B, 0.5) < 1 ? 1000 : 1;
  if (k1 !== 1) for (let i = 0; i < A.length; i++) A[i] *= k1;
  if (k2 !== 1) for (let i = 0; i < B.length; i++) B[i] *= k2;
  const pmax = pct(C, 0.99) || 1;
  for (let i = 0; i < C.length; i++) C[i] = Math.max(0, C[i] / pmax);
  centerShift(t1);
  if (doDeface) deface(t1, (i) => A[i] > 500 && A[i] < 1700 && B[i] > 50 && B[i] < 130, (i) => { C[i] = 0; });
  return { phantom: { type: 'maps', vol: t1, t1: A, t2: B, pd: C }, desc: `mapas T1/T2/PD${k1 !== 1 ? ' (T1 en s → ms)' : ''}` };
}

/** FSL FAST (0–3) or FreeSurfer/SynthSeg labels → tissue labels. */
export function buildFromLabels(src: Volume<Float32Array>, doDeface: boolean): Built {
  const vals = new Set<number>();
  for (let i = 0; i < src.data.length; i += 97) vals.add(Math.round(src.data[i]));
  const fast = [...vals].every((v) => v >= 0 && v <= 3);
  const d = new Uint8Array(src.data.length);
  for (let i = 0; i < d.length; i++) {
    const v = Math.round(src.data[i]);
    d[i] = v <= 0 ? 0 : fast ? [0, 3, 4, 5][v] : FSLUT[v] ?? 4;
  }
  const vol: Volume<Uint8Array> = { ...src, data: d };
  centerShift(vol);
  if (doDeface) deface(vol, (i) => d[i] === 4 || d[i] === 5, (i) => { d[i] = 0; });
  return { phantom: { type: 'labels', vol }, desc: fast ? 'segmentación FSL FAST' : 'segmentación FreeSurfer/SynthSeg' };
}
