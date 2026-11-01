import { describe, expect, it } from 'vitest';
import type { Scan } from '../src/core/types';
import { derive, LIB, newProt, normalize, paramsOf } from '../src/physics/protocol';
import { signals } from '../src/physics/signal';
import { T } from '../src/physics/tissues';

const tpl = (name: string) => LIB.find((t) => t.name === name)!;
const scan = (name: string, extra: Partial<Scan> = {}): Scan => ({ ...paramsOf(newProt(tpl(name))), B0: 1.5, phantom: 'geo', path: 'normal', ...extra });

describe('timing', () => {
  it('TSE effective TE is a whole number of echo spacings', () => {
    const p = newProt(tpl('t2_tse_tra'));
    const d = derive(p);
    expect(p.TE / d.ES).toBeCloseTo(Math.round(p.TE / d.ES), 1);
  });

  it('acquisition times are clinically plausible', () => {
    for (const name of ['t2_tse_tra', 't1_se_tra', 't2_tirm_tra_dark-fluid', 'ep2d_diff_tra_b1000', 't2_fl2d_tra_hemo']) {
      const ta = derive(newProt(tpl(name))).TA / 1000;
      expect(ta, name).toBeGreaterThan(20);
      expect(ta, name).toBeLessThan(8 * 60);
    }
  });

  it('raises TR when the inversion time no longer fits', () => {
    const p = newProt(tpl('t2_tirm_tra_dark-fluid'));
    p.TI = 4000;
    p.TR = 3000;
    const msgs = normalize(p);
    expect(p.TR).toBeGreaterThanOrEqual(derive(p).minTR);
    expect(msgs.some((m) => m.startsWith('TR aumentado'))).toBe(true);
  });

  it('halves the phase lines with parallel imaging factor 2', () => {
    const p = newProt(tpl('t1_se_tra'));
    const off = derive(p).TA;
    p.pat = 2;
    expect(derive(p).TA / off).toBeLessThan(0.65);
  });
});

describe('SAR', () => {
  it('scales with the square of the field strength', () => {
    const p = newProt(tpl('t2_tse_tra'));
    expect(derive(p, 3).sar / derive(p, 1.5).sar).toBeCloseTo(4, 5);
  });
  it('drops with low-SAR RF pulses', () => {
    const p = newProt(tpl('t2_tse_tra'));
    const n = derive(p).sar;
    p.rf = 'lowsar';
    expect(derive(p).sar).toBeLessThan(n);
  });
});

describe('contrast', () => {
  it('T2 TSE: CSF > GM > WM', () => {
    const s = signals(scan('t2_tse_tra'));
    expect(s[T.CSF]).toBeGreaterThan(s[T.GM]);
    expect(s[T.GM]).toBeGreaterThan(s[T.WM]);
  });
  it('T1 SE: WM > GM > CSF', () => {
    const s = signals(scan('t1_se_tra'));
    expect(s[T.WM]).toBeGreaterThan(s[T.GM]);
    expect(s[T.GM]).toBeGreaterThan(s[T.CSF]);
  });
  it('FLAIR nulls CSF and shows MS lesions brighter than white matter', () => {
    const s = signals(scan('t2_tirm_tra_dark-fluid'));
    expect(s[T.CSF]).toBeLessThan(0.2 * s[T.WM]);
    expect(s[T.LESION]).toBeGreaterThan(1.3 * s[T.WM]);
  });
  it('DWI b1000: acute infarct is bright (restricted diffusion)', () => {
    const s = signals(scan('ep2d_diff_tra_b1000'));
    expect(s[T.INFARCT]).toBeGreaterThan(1.5 * s[T.GM]);
    expect(s[T.CSF]).toBeLessThan(s[T.WM]);
  });
  it('fat saturation suppresses fat', () => {
    const on = signals(scan('t1_se_tra', { fat: 'fs' })), off = signals(scan('t1_se_tra'));
    expect(on[T.FAT]).toBeLessThan(0.1 * off[T.FAT]);
  });
  it('flowing blood: void in spin echo, bright in gradient echo', () => {
    expect(signals(scan('t2_tse_tra'))[T.BLOOD]).toBeLessThan(0.05);
    const g = signals(scan('t1_fl2d_tra'));
    expect(g[T.BLOOD]).toBeGreaterThan(g[T.WM]);
  });
});
