// MPR geometry and reformatting. Patient coordinates are LPS mm (x → left, y → posterior, z → head).
import type { Vec3, Volume } from '../core/types';
import { add3, cross, dot3, norm } from '../core/util';

export type ViewId = 'tra' | 'sag' | 'cor';
export type SlabMode = 'mpr' | 'mip' | 'minip' | 'avg';

/** Rotation as three orthonormal columns. Identity = scanner axes. */
export type Mat3 = [Vec3, Vec3, Vec3];
export const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const mul = (M: Mat3, a: Vec3): Vec3 => [
  M[0][0] * a[0] + M[1][0] * a[1] + M[2][0] * a[2],
  M[0][1] * a[0] + M[1][1] * a[1] + M[2][1] * a[2],
  M[0][2] * a[0] + M[1][2] * a[1] + M[2][2] * a[2],
];

/** Display axes of each view in frame coordinates, radiological convention:
 *  transverse: patient left on image right, anterior up; sagittal: anterior left, head up; coronal: left on right, head up. */
const BASE: Record<ViewId, { u: Vec3; v: Vec3; n: Vec3 }> = {
  tra: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  sag: { u: [0, 1, 0], v: [0, 0, -1], n: [1, 0, 0] },
  cor: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
};

export interface Plane { u: Vec3; v: Vec3; n: Vec3 }

/**
 * The frame only decides each view's normal. The image keeps its anatomical "up" (the default v
 * projected onto the plane), so rotating the crosshair inside a view turns the other planes' lines
 * while that view's own image stays upright, as on the scanner.
 */
export function viewPlane(R: Mat3, view: ViewId): Plane {
  const b = BASE[view], n = mul(R, b.n);
  const vp = add3(b.v, n, -dot3(b.v, n));
  const v = Math.hypot(...vp) > 1e-3 ? norm(vp) : mul(R, b.v);
  const hand = dot3(cross(b.v, b.n), b.u); // +1 or −1: keeps each view's left-right convention
  const u0 = cross(v, n);
  return { u: [u0[0] * hand, u0[1] * hand, u0[2] * hand], v, n };
}

/** Rotate the frame by angle (rad) about a patient-space axis (Rodrigues). */
export function rotate(R: Mat3, axis: Vec3, angle: number): Mat3 {
  const k = norm(axis), c = Math.cos(angle), s = Math.sin(angle);
  const rot = (a: Vec3): Vec3 => {
    const kxa = cross(k, a), kda = dot3(k, a);
    return [a[0] * c + kxa[0] * s + k[0] * kda * (1 - c), a[1] * c + kxa[1] * s + k[1] * kda * (1 - c), a[2] * c + kxa[2] * s + k[2] * kda * (1 - c)];
  };
  // re-orthonormalise so repeated drags do not accumulate drift
  const e0 = norm(rot(R[0])), e1t = rot(R[1]);
  const e1 = norm(add3(e1t, e0, -dot3(e1t, e0)));
  return [e0, e1, cross(e0, e1)];
}

/** Orientation label for a direction, e.g. "L", "PH". Siemens convention uses H/F for head and feet. */
export function dirLabel(d: Vec3): string {
  const parts: [number, string][] = [
    [d[0], d[0] > 0 ? 'L' : 'R'],
    [d[1], d[1] > 0 ? 'P' : 'A'],
    [d[2], d[2] > 0 ? 'H' : 'F'],
  ];
  return parts.filter(([v]) => Math.abs(v) > 0.3).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2).map(([, l]) => l).join('');
}

/** Name of a plane by its normal: Tra, Sag, Cor, or the dominant one with ">" for obliques, e.g. "Tra>Cor". */
export function planeName(n: Vec3): string {
  const names = ['Sag', 'Cor', 'Tra'];
  const a = n.map(Math.abs);
  const order = [0, 1, 2].sort((i, j) => a[j] - a[i]);
  if (a[order[0]] > 0.9995) return names[order[0]];
  return `${names[order[0]]}>${names[order[1]]}`;
}

/** Patient point of voxel (i, j, k). */
export function voxelToPatient(V: Volume, i: number, j: number, k: number): Vec3 {
  return [0, 1, 2].map((a) => V.O[a] + i * V.sx * V.R[a] + j * V.sy * V.Cd[a] + k * V.sz * V.N[a]) as Vec3;
}
export function volumeCenter(V: Volume): Vec3 {
  return voxelToPatient(V, (V.nx - 1) / 2, (V.ny - 1) / 2, (V.nz - 1) / 2);
}
export function volumeDiagonal(V: Volume): number {
  return Math.hypot(V.nx * V.sx, V.ny * V.sy, V.nz * V.sz);
}

export interface Slab { thick: number; mode: SlabMode }

/**
 * Reformat a plane: W×H pixels covering fovW×fovH mm centred on D, with an optional slab along n.
 * Works in voxel index space, so each pixel costs one trilinear lookup per slab step.
 * Pixels outside the volume are NaN.
 */
export function reformat(V: Volume, D: Vec3, P: Plane, fovW: number, fovH: number, W: number, H: number, slab: Slab, out?: Float32Array): Float32Array {
  const res = out && out.length === W * H ? out : new Float32Array(W * H);
  const { nx, ny, nz, data } = V;
  const toIdx = (d: Vec3): Vec3 => [dot3(d, V.R) / V.sx, dot3(d, V.Cd) / V.sy, dot3(d, V.N) / V.sz];
  const dx = fovW / W, dy = fovH / H;
  const du = toIdx([P.u[0] * dx, P.u[1] * dx, P.u[2] * dx]);
  const dv = toIdx([P.v[0] * dy, P.v[1] * dy, P.v[2] * dy]);
  const minSp = Math.min(V.sx, V.sy, V.sz);
  const ns = slab.mode === 'mpr' || slab.thick <= minSp ? 1 : Math.max(2, Math.round(slab.thick / minSp));
  const step = ns > 1 ? slab.thick / ns : 0;
  const dn = toIdx([P.n[0] * step, P.n[1] * step, P.n[2] * step]);
  const corner: Vec3 = [
    D[0] - P.u[0] * (fovW / 2 - dx / 2) - P.v[0] * (fovH / 2 - dy / 2) - V.O[0] - V.shift[0],
    D[1] - P.u[1] * (fovW / 2 - dx / 2) - P.v[1] * (fovH / 2 - dy / 2) - V.O[1] - V.shift[1],
    D[2] - P.u[2] * (fovW / 2 - dx / 2) - P.v[2] * (fovH / 2 - dy / 2) - V.O[2] - V.shift[2],
  ];
  const s0 = toIdx(corner), half = (ns - 1) / 2;
  const nxy = nx * ny, mode = ns > 1 ? slab.mode : 'mpr';

  for (let j = 0; j < H; j++) {
    let bi = s0[0] + j * dv[0], bj = s0[1] + j * dv[1], bk = s0[2] + j * dv[2];
    for (let i = 0; i < W; i++, bi += du[0], bj += du[1], bk += du[2]) {
      let acc = mode === 'mip' ? -Infinity : mode === 'minip' ? Infinity : 0, cnt = 0;
      for (let s = 0; s < ns; s++) {
        const o = s - half;
        let fi = bi + o * dn[0], fj = bj + o * dn[1], fk = bk + o * dn[2];
        if (fi < -0.5 || fj < -0.5 || fk < -0.5 || fi > nx - 0.5 || fj > ny - 0.5 || fk > nz - 0.5) continue;
        if (fi < 0) fi = 0; else if (fi > nx - 1) fi = nx - 1;
        if (fj < 0) fj = 0; else if (fj > ny - 1) fj = ny - 1;
        if (fk < 0) fk = 0; else if (fk > nz - 1) fk = nz - 1;
        const i0 = fi | 0, j0 = fj | 0, k0 = fk | 0;
        const i1 = i0 + 1 < nx ? 1 : 0, j1 = j0 + 1 < ny ? nx : 0, k1 = k0 + 1 < nz ? nxy : 0;
        const tx = fi - i0, ty = fj - j0, tz = fk - k0;
        const b = k0 * nxy + j0 * nx + i0;
        const c00 = data[b] + (data[b + i1] - data[b]) * tx;
        const c01 = data[b + j1] + (data[b + j1 + i1] - data[b + j1]) * tx;
        const c10 = data[b + k1] + (data[b + k1 + i1] - data[b + k1]) * tx;
        const c11 = data[b + k1 + j1] + (data[b + k1 + j1 + i1] - data[b + k1 + j1]) * tx;
        const c0 = c00 + (c01 - c00) * ty, c1 = c10 + (c11 - c10) * ty;
        const val = c0 + (c1 - c0) * tz;
        if (mode === 'mip') { if (val > acc) acc = val; }
        else if (mode === 'minip') { if (val < acc) acc = val; }
        else acc += val;
        cnt++;
      }
      res[j * W + i] = cnt === 0 ? NaN : mode === 'avg' || mode === 'mpr' ? acc / cnt : acc;
    }
  }
  return res;
}

/**
 * Display window from the volume histogram: from zero (or the minimum, if negative) to the 99.5th
 * percentile of the voxels brighter than background, so air does not drag the window down.
 */
export function autoWindow(data: ArrayLike<number>): { w: number; c: number } {
  const step = Math.max(1, Math.floor(data.length / 200000)), s: number[] = [];
  for (let i = 0; i < data.length; i += step) { const v = data[i]; if (v === v) s.push(v); }
  if (!s.length) return { w: 1, c: 0 };
  s.sort((a, b) => a - b);
  const p999 = s[Math.floor((s.length - 1) * 0.999)];
  const fg = s.filter((v) => v > p999 * 0.05);
  const hi = fg.length ? fg[Math.floor((fg.length - 1) * 0.995)] : p999;
  const lo = Math.min(0, s[0]);
  const w = Math.max(1, hi - lo);
  return { w: Math.round(w), c: Math.round(lo + w / 2) };
}

/** Centres of a parallel range: count slices, spacing mm, centred on C along n. */
export function rangeCenters(C: Vec3, n: Vec3, count: number, spacing: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => add3(C, n, (i - (count - 1) / 2) * spacing));
}
