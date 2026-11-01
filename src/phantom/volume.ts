import type { PhantomData, Scan, Volume } from '../core/types';
import { signals, tissueSig } from '../physics/signal';
import { pickSource } from '../physics/weighting';
import { T } from '../physics/tissues';
import { HALF, labelPoint } from './geometric';

/** Label byte layout for label volumes: bits 0–5 tissue, bit 6 MS lesion, bit 7 acute infarct. */
export const FLAG_MS = 64, FLAG_STROKE = 128;

export type Sampler = (x: number, y: number, z: number) => number;

interface Interp {
  (x: number, y: number, z: number): boolean;
  idx: Int32Array;
  w: Float32Array;
}

/** Trilinear neighbours and weights of a patient point inside an arbitrarily oriented voxel grid. */
export function makeInterp(V: Volume): Interp {
  const { nx, ny, nz } = V;
  const ox = V.O[0] + V.shift[0], oy = V.O[1] + V.shift[1], oz = V.O[2] + V.shift[2];
  const R = V.R, Cd = V.Cd, N = V.N, isx = 1 / V.sx, isy = 1 / V.sy, isz = 1 / V.sz;
  const idx = new Int32Array(8), w = new Float32Array(8);
  const f = ((x: number, y: number, z: number) => {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    let fc = (dx * R[0] + dy * R[1] + dz * R[2]) * isx;
    let fr = (dx * Cd[0] + dy * Cd[1] + dz * Cd[2]) * isy;
    let fk = (dx * N[0] + dy * N[1] + dz * N[2]) * isz;
    if (fc < -0.5 || fr < -0.5 || fk < -0.5 || fc > nx - 0.5 || fr > ny - 0.5 || fk > nz - 0.5) return false;
    if (fc < 0) fc = 0; else if (fc > nx - 1) fc = nx - 1;
    if (fr < 0) fr = 0; else if (fr > ny - 1) fr = ny - 1;
    if (fk < 0) fk = 0; else if (fk > nz - 1) fk = nz - 1;
    const c0 = fc | 0, r0 = fr | 0, k0 = fk | 0;
    const c1 = c0 + 1 < nx ? c0 + 1 : c0, r1 = r0 + 1 < ny ? r0 + 1 : r0, k1 = k0 + 1 < nz ? k0 + 1 : k0;
    const tx = fc - c0, ty = fr - r0, tz = fk - k0, ux = 1 - tx, uy = 1 - ty, uz = 1 - tz;
    const b00 = (k0 * ny + r0) * nx, b01 = (k0 * ny + r1) * nx, b10 = (k1 * ny + r0) * nx, b11 = (k1 * ny + r1) * nx;
    idx[0] = b00 + c0; w[0] = ux * uy * uz; idx[1] = b00 + c1; w[1] = tx * uy * uz;
    idx[2] = b01 + c0; w[2] = ux * ty * uz; idx[3] = b01 + c1; w[3] = tx * ty * uz;
    idx[4] = b10 + c0; w[4] = ux * uy * tz; idx[5] = b10 + c1; w[5] = tx * uy * tz;
    idx[6] = b11 + c0; w[6] = ux * ty * tz; idx[7] = b11 + c1; w[7] = tx * ty * tz;
    return true;
  }) as Interp;
  f.idx = idx;
  f.w = w;
  return f;
}

/** Signal at any patient point for the scan's phantom. */
export function makeSampler(pp: Scan, ph: PhantomData | undefined): Sampler {
  if (!ph || ph.type === 'geo') {
    const sig = signals(pp), path = pp.path;
    return (x, y, z) => (x <= -HALF || x >= HALF || y <= -HALF || y >= HALF ? 0 : sig[labelPoint(x, y, z, path)]);
  }
  if (ph.type === 'replay') {
    // real anatomy: the stored series closest to the protocol's weighting, at the simulator's signal scale
    const src = ph.sources[pickSource(pp, ph.sources).index];
    const it = makeInterp(src.vol), I = it.idx, Wt = it.w, d = src.vol.data, k = src.scale;
    return (x, y, z) => {
      if (!it(x, y, z)) return 0;
      let s = 0;
      for (let q = 0; q < 8; q++) s += d[I[q]] * Wt[q];
      return s > 0 ? s * k : 0;
    };
  }
  const it = makeInterp(ph.vol), I = it.idx, Wt = it.w;
  if (ph.type === 'labels') {
    const sig = signals(pp), tab = new Float32Array(256), d = ph.vol.data;
    for (let v = 0; v < 256; v++) {
      let l = v & 63;
      if (pp.path === 'ms' && v & FLAG_MS) l = T.LESION;
      else if (pp.path === 'stroke' && v & FLAG_STROKE) l = T.INFARCT;
      tab[v] = sig[l] || 0;
    }
    // interpolate signal, not labels, so edges are smooth
    return (x, y, z) => {
      if (!it(x, y, z)) return 0;
      let s = 0;
      for (let k = 0; k < 8; k++) s += tab[d[I[k]]] * Wt[k];
      return s;
    };
  }
  const { t1, t2, pd } = ph, t2sF = pp.B0 === 3 ? 0.4 : 0.6;
  return (x, y, z) => {
    if (!it(x, y, z)) return 0;
    // nearest voxel: interpolating T1/T2 across a boundary would invent tissue that does not exist
    let m = 0;
    for (let k = 1; k < 8; k++) if (Wt[k] > Wt[m]) m = k;
    const i = I[m], a = t1[i], b = t2[i], c = pd[i];
    if (c <= 0.01 || a <= 1 || b <= 1) return 0;
    // maps carry no fat or diffusion information: estimate them from T1/T2
    const fat = a < 420 && b > 35 && b < 160, adc = b > 400 ? 3.0 : b > 130 ? 1.2 : 0.8;
    return tissueSig(pp, c, a, b, b * t2sF, adc, fat);
  };
}
