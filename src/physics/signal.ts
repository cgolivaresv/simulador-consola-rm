import type { Scan } from '../core/types';
import { tissues, N_TISSUES, T } from './tissues';

/**
 * Steady-state signal of one tissue.
 * SE/TSE: PD·(1−e^(−TR/T1))·e^(−TE/T2), with a non-selective inversion when prep = 'ir'.
 * GRE (spoiled FLASH): Ernst equation with T2*. EPI diffusion adds e^(−b·ADC).
 */
export function tissueSig(pp: Scan, pd: number, t1: number, t2: number, t2s: number, adc: number, fat: boolean): number {
  if (pp.fat === 'fs' && fat) pd *= 0.06;
  // J-coupling breaks up in a fast spin echo train: fat stays bright on TSE
  if (pp.seq === 'tse' && fat) t2 *= 2.2;
  const E1 = Math.exp(-pp.TR / t1);
  if (pp.seq === 'gre') {
    const a = (pp.FA * Math.PI) / 180;
    return (pd * Math.sin(a) * (1 - E1)) / (1 - Math.cos(a) * E1) * Math.exp(-pp.TE / t2s);
  }
  const lon = pp.prep === 'ir' ? Math.abs(1 - 2 * Math.exp(-pp.TI / t1) + E1) : 1 - E1;
  let s = pd * lon * Math.exp(-pp.TE / t2);
  if (pp.seq === 'epi' && pp.b > 0) s *= Math.exp((-pp.b * adc) / 1000);
  return s;
}

/** Signal per tissue label for a scan. */
export function signals(pp: Scan): Float32Array {
  const tab = tissues(pp.B0), out = new Float32Array(N_TISSUES);
  for (let i = 1; i < T.BLOOD; i++) {
    const [pd, t1, t2, t2s, adc] = tab[i];
    out[i] = tissueSig(pp, pd, t1, t2, t2s, adc, i === T.FAT);
  }
  // flowing blood: flow void in spin echo and EPI, inflow enhancement in gradient echo
  out[T.BLOOD] = pp.seq === 'gre' ? 0.55 * Math.sin((pp.FA * Math.PI) / 180) * Math.exp(-pp.TE / 40) : 0.02;
  return out;
}
