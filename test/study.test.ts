import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scan, Volume, Weighting } from '../src/core/types';
import { decodeBrainWeb } from '../src/phantom/brainweb';
import { buildReplay, buildSynthetic, type StudySeries } from '../src/phantom/study';
import { makeSampler, FLAG_MS } from '../src/phantom/volume';
import { LIB, newProt, paramsOf } from '../src/physics/protocol';
import { T } from '../src/physics/tissues';
import { guessWeighting, pickSource, protWeighting } from '../src/physics/weighting';
import { rng } from '../src/core/util';

const tpl = (name: string) => newProt(LIB.find((t) => t.name === name)!);

describe('weighting', () => {
  it('reads each library protocol', () => {
    expect(protWeighting(tpl('t2_tse_tra'))).toBe('T2');
    expect(protWeighting(tpl('t1_se_tra'))).toBe('T1');
    expect(protWeighting(tpl('t2_tirm_tra_dark-fluid'))).toBe('FLAIR');
    expect(protWeighting(tpl('ep2d_diff_tra_b1000'))).toBe('DWI');
    expect(protWeighting(tpl('t2_fl2d_tra_hemo'))).toBe('T2*');
    expect(protWeighting(tpl('t1_fl2d_tra'))).toBe('T1');
    expect(protWeighting(tpl('localizer'))).toBe('T1');
  });
  it('recognises stored series by name or parameters', () => {
    expect(guessWeighting({ desc: 't1_mprage_sag_p2_iso' })).toBe('T1');
    expect(guessWeighting({ desc: 'Sag CUBE T2' })).toBe('T2');
    expect(guessWeighting({ desc: 't2_spc_da-fl_sag_p2_iso' })).toBe('FLAIR');
    expect(guessWeighting({ desc: 'ep2d_diff_3scan_trace_p2 b1000', b: 1000 })).toBe('DWI');
    expect(guessWeighting({ desc: 'ep2d_diff_3scan_trace_p2_ADC' })).toBe('ADC');
    expect(guessWeighting({ desc: 'SWI_Images' })).toBe('T2*');
    expect(guessWeighting({ desc: 'serie 5', TR: 2300, TE: 2.9, TI: 900 })).toBe('T1');
    expect(guessWeighting({ desc: 'serie 7', TR: 5000, TE: 100 })).toBe('T2');
  });
  it('falls back to the closest weighting and prefers the highest b-value', () => {
    const src = [{ weighting: 'T1' as Weighting }, { weighting: 'T2' as Weighting }, { weighting: 'DWI' as Weighting, b: 0 }, { weighting: 'DWI' as Weighting, b: 1000 }];
    expect(pickSource(tpl('t2_tirm_tra_dark-fluid'), src)).toMatchObject({ index: 1, got: 'T2', exact: false });
    expect(pickSource(tpl('ep2d_diff_tra_b1000'), src)).toMatchObject({ index: 3, exact: true });
    expect(pickSource(tpl('t1_se_tra'), src)).toMatchObject({ index: 0, exact: true });
  });
});

/* A synthetic study from BrainWeb at 2 mm: T1, T2 and FLAIR with MS lesions and noise, so the right answer is known. */
const bw = await decodeBrainWeb(readFileSync(new URL('../public/brainweb.gz.txt', import.meta.url), 'utf8'));
if (bw.type !== 'labels') throw new Error();
const V0 = bw.vol, f = 2;
const nx = Math.ceil(V0.nx / f), ny = Math.ceil(V0.ny / f), nz = Math.ceil(V0.nz / f);
const truth = new Uint8Array(nx * ny * nz);
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const v = V0.data[(k * f * V0.ny + j * f) * V0.nx + i * f];
  truth[(k * ny + j) * nx + i] = v & FLAG_MS && (v & 63) === T.WM ? T.LESION : v & 63;
}
const INT: Record<string, number[]> = {
  //       air bone fat  csf  gm   wm  lesion muscle vit  inf  blood
  T1:    [0, 30, 950, 150, 520, 780, 600, 380, 140, 500, 700],
  T2:    [0, 30, 620, 1000, 480, 320, 720, 200, 950, 600, 50],
  FLAIR: [0, 30, 700, 80, 560, 420, 950, 250, 100, 700, 60],
};
function series(w: 'T1' | 'T2' | 'FLAIR', seed: number): StudySeries {
  const r = rng(seed), data = new Int16Array(truth.length);
  for (let v = 0; v < data.length; v++) data[v] = Math.max(0, Math.round(INT[w][truth[v]] + (r() - 0.5) * 70));
  const vol: Volume<Int16Array> = { ...V0, nx, ny, nz, data, sx: f, sy: f, sz: f, shift: [0, 0, 0] };
  return { vol, weighting: w, desc: w, volumetric: true };
}
const t1 = series('T1', 1), t2 = series('T2', 2), fl = series('FLAIR', 3);

describe('synthetic contrast from an imported study', () => {
  it('needs a T1', async () => {
    await expect(buildSynthetic([t2])).rejects.toThrow(/T1/);
  });

  it('classifies brain tissue from T1 + T2 + FLAIR and finds the lesions', async () => {
    const { phantom, stats } = await buildSynthetic([t1, t2, fl]);
    if (phantom.type !== 'labels') throw new Error();
    const got = phantom.vol.data;
    const acc = (cls: number) => {
      let n = 0, ok = 0;
      for (let v = 0; v < truth.length; v++) if (truth[v] === cls) { n++; if (got[v] === cls) ok++; }
      return ok / n;
    };
    expect(acc(T.WM)).toBeGreaterThan(0.85);
    expect(acc(T.GM)).toBeGreaterThan(0.75);
    expect(acc(T.CSF)).toBeGreaterThan(0.75);
    expect(acc(T.LESION)).toBeGreaterThan(0.5);
    // few false lesions in normal white matter
    let fp = 0, wm = 0;
    for (let v = 0; v < truth.length; v++) if (truth[v] === T.WM) { wm++; if (got[v] === T.LESION) fp++; }
    expect(fp / wm).toBeLessThan(0.01);
    expect(stats.channels).toEqual(['T1', 'T2', 'FLAIR']);
  }, 30000);
});

describe('replay of an imported study', () => {
  const ph = buildReplay([t1, t2, fl]);
  if (ph.type !== 'replay') throw new Error();
  // a point in the lateral ventricle (CSF) of the shifted study
  const scan = (name: string): Scan => ({ ...paramsOf(tpl(name)), B0: 1.5, phantom: 'x', path: 'normal' });
  const find = (cls: number) => {
    for (let k = nz >> 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      if (truth[(k * ny + j) * nx + i] === cls) {
        const V = t1.vol, s = ph.sources[0].vol.shift;
        return [0, 1, 2].map((a) => V.O[a] + s[a] + i * f * V.R[a] + j * f * V.Cd[a] + k * f * V.N[a]) as [number, number, number];
      }
    throw new Error();
  };
  const csf = find(T.CSF);
  it('shows CSF bright for a T2 protocol and dark for a T1 protocol', () => {
    const onT2 = makeSampler(scan('t2_tse_tra'), ph)(...csf), onT1 = makeSampler(scan('t1_se_tra'), ph)(...csf);
    expect(onT2).toBeGreaterThan(3 * onT1);
  });
  it('brings every series to the simulator signal scale', () => {
    for (const s of ph.sources) expect(s.scale).toBeGreaterThan(0);
  });
  it('keeps co-registration: one shift for all series', () => {
    expect(new Set(ph.sources.map((s) => s.vol.shift.join(','))).size).toBe(1);
  });
});
