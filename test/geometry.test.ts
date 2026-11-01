import { describe, expect, it } from 'vitest';
import { anglesOf, geomSlice, geomLoc, orientText, sliceAxes } from '../src/imaging/geometry';
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

  it('double oblique: T>C, T>S and in-plane rotation give an orthonormal right-handed frame', () => {
    const ax = sliceAxes({ tilt: 15, tiltS: -10, rot: 30 });
    const d = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(d(ax.u, ax.v)).toBeCloseTo(0, 9);
    expect(d(ax.u, ax.n)).toBeCloseTo(0, 9);
    const c = [ax.u[1] * ax.v[2] - ax.u[2] * ax.v[1], ax.u[2] * ax.v[0] - ax.u[0] * ax.v[2], ax.u[0] * ax.v[1] - ax.u[1] * ax.v[0]];
    expect(d(c, ax.n)).toBeCloseTo(1, 9);
  });

  it('T>S tilts the normal toward the patient left for positive angles, T>C toward anterior', () => {
    expect(sliceAxes({ tilt: 0, tiltS: 20, rot: 0 }).n[0]).toBeGreaterThan(0);
    expect(sliceAxes({ tilt: 20, tiltS: 0, rot: 0 }).n[1]).toBeLessThan(0);
  });

  it('recovers the angles from an orientation', () => {
    for (const a of [{ tilt: 0, tiltS: 0, rot: 0 }, { tilt: 12, tiltS: -7.5, rot: 25 }, { tilt: -30, tiltS: 40, rot: -120 }]) {
      const back = anglesOf(sliceAxes(a));
      expect(back.tilt).toBeCloseTo(a.tilt, 6);
      expect(back.tiltS).toBeCloseTo(a.tiltS, 6);
      expect(back.rot).toBeCloseTo(a.rot, 6);
    }
  });

  it('writes the orientation the way the console does', () => {
    expect(orientText({ tilt: 0, tiltS: 0 })).toBe('Transversal');
    expect(orientText({ tilt: -12, tiltS: 4.5 })).toBe('T > C -12.0 > S 4.5');
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
