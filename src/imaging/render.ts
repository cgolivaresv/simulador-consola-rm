import type { Img, PhantomData, PlaneGeom, Scan } from '../core/types';
import { clamp, cross, rng } from '../core/util';
import { derive } from '../physics/protocol';
import { signals } from '../physics/signal';
import { G, HALF, RES, getLabels } from '../phantom/geometric';
import { makeSampler } from '../phantom/volume';

/**
 * One reconstructed image: supersampled voxels, phase wrap-around (aliasing) from neighbouring
 * FoV periods, an N/2 ghost for EPI and Rician noise scaled by the protocol's SNR.
 */
export function computePlane(pp: Scan, g: PlaneGeom, seed: number, phantom: PhantomData | undefined): Img {
  const d = derive(pp, pp.B0);
  const { C, u, v, fovW, fovH, W, H, phaseH, period } = g;
  const dx = fovW / W, dy = fovH / H;
  const nsx = clamp(Math.ceil(dx / 0.6), 1, 4), nsy = clamp(Math.ceil(dy / 0.6), 1, 4);
  // straight transverse planes of the geometric phantom read a cached label slice
  const fast = (!phantom || phantom.type === 'geo') && u[0] === 1 && u[1] === 0 && u[2] === 0 && v[2] === 0 && v[0] === 0;
  const Lf = fast ? getLabels(C[2], pp.path) : null;
  const sig = fast ? signals(pp) : null;
  const S = fast ? null : makeSampler(pp, phantom);
  // through-plane: average across the slice thickness, so thick slices show real partial volume
  const nrm = g.n ?? cross(u, v);
  const nsz = fast ? 1 : clamp(Math.round(pp.thick / 1.25), 1, 5);
  const offs = Array.from({ length: nsz }, (_, s) => ((s + 0.5) / nsz - 0.5) * pp.thick);
  const samp = (a: number, b: number): number => {
    const x = C[0] + a * u[0] + b * v[0], y = C[1] + a * u[1] + b * v[1];
    if (Lf && sig) return x <= -HALF || x >= HALF || y <= -HALF || y >= HALF ? 0 : sig[Lf[(((y + HALF) / RES) | 0) * G + (((x + HALF) / RES) | 0)]];
    const z = C[2] + a * u[2] + b * v[2];
    if (nsz === 1) return S!(x, y, z);
    let acc = 0;
    for (const t of offs) acc += S!(x + t * nrm[0], y + t * nrm[1], z + t * nrm[2]);
    return acc / nsz;
  };
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let acc = 0;
      for (let sy = 0; sy < nsy; sy++) {
        const b = -fovH / 2 + (j + (sy + 0.5) / nsy) * dy;
        for (let sx = 0; sx < nsx; sx++) {
          const a = -fovW / 2 + (i + (sx + 0.5) / nsx) * dx;
          if (phaseH) for (let k = -2; k <= 2; k++) acc += samp(a + k * period, b);
          else for (let k = -2; k <= 2; k++) acc += samp(a, b + k * period);
        }
      }
      out[j * W + i] = acc / (nsx * nsy);
    }
  }
  if (pp.seq === 'epi') {
    const gh = out.slice();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) out[j * W + i] += 0.03 * (phaseH ? gh[j * W + ((i + (W >> 1)) % W)] : gh[((j + (H >> 1)) % H) * W + i]);
  }
  const sigma = 0.0042 / d.snr, r = rng(seed);
  const gauss = () => { const uu = r() || 1e-9, vv = r(); return Math.sqrt(-2 * Math.log(uu)) * Math.cos(6.2831853 * vv); };
  for (let k = 0; k < out.length; k++) {
    const s = out[k];
    out[k] = Math.hypot(s + gauss() * sigma, gauss() * sigma) * 3000;
  }
  return { data: out, W, H, fovW, fovH };
}

/** Window that puts the 99.5th percentile at white. */
export function autoWL(img: Img): { w: number; c: number } {
  const a: number[] = [];
  for (let k = 0; k < img.data.length; k += 3) a.push(img.data[k]);
  a.sort((x, y) => x - y);
  const p = a[Math.floor(a.length * 0.995)] || 1;
  return { w: Math.round(p), c: Math.round(p / 2) };
}
