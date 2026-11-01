import { describe, expect, it } from 'vitest';
import { geomSlice, geomLoc } from '../src/imaging/geometry';
import { LIB, newProt } from '../src/physics/protocol';
import { age } from '../src/ui/age';

describe('slice group geometry', () => {
  const p = newProt(LIB.find((t) => t.name === 't2_tse_tra')!);

  it('centres the group on Position F-H with slice spacing thickness × (1 + gap)', () => {
    const mid = geomSlice(p, (p.slices - 1) / 2), next = geomSlice(p, (p.slices - 1) / 2 + 1);
    expect(mid.C[2]).toBeCloseTo(p.pos);
    expect(next.C[2] - mid.C[2]).toBeCloseTo(p.thick * (1 + p.dist / 100));
  });

  it('tilting T>C moves the upper slices forward and keeps the normal unit length', () => {
    const q = { ...p, tilt: 20 };
    const top = geomSlice(q, q.slices - 1);
    expect(top.C[1]).toBeLessThan(0); // anterior
    expect(Math.hypot(...top.n!)).toBeCloseTo(1);
  });

  it('puts phase on the horizontal axis for R>>L', () => {
    expect(geomSlice({ ...p, phaseDir: 'RL' }, 0).phaseH).toBe(true);
    expect(geomSlice({ ...p, phaseDir: 'AP' }, 0).phaseH).toBe(false);
  });

  it('displays localizers in radiological convention', () => {
    expect(geomLoc(p, 'tra').u).toEqual([1, 0, 0]); // patient left on the image right
    expect(geomLoc(p, 'sag').v).toEqual([0, 0, -1]); // head at the top
  });
});

describe('patient age', () => {
  it('counts whole years', () => {
    expect(age('1978-03-12', new Date(2026, 2, 11))).toBe(47);
    expect(age('1978-03-12', new Date(2026, 2, 12))).toBe(48);
    expect(age('1978-03-12', new Date(2026, 2, 11, 23, 30))).toBe(47); // late evening the day before, Chile time
  });
});
