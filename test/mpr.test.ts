import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { dot3 } from '../src/core/util';
import { autoWindow, dirLabel, IDENTITY, planeName, rangeCenters, reformat, rotate, viewPlane, type ViewId } from '../src/mpr/mpr';
import { loadVolumes, type MprVolume } from '../src/volume/series';

const nm = (p: string) => fileURLToPath(new URL(`../node_modules/${p}`, import.meta.url));
(globalThis as { __CODEC_WASM__?: Record<string, string> }).__CODEC_WASM__ = {
  openjpeg: nm('@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.wasm'),
  charls: nm('@cornerstonejs/codec-charls/dist/charlswasm_decode.wasm'),
};

const dir = (v: string) => new URL(`./fixtures/vol/${v}/`, import.meta.url);
const filesOf = (v: string) => readdirSync(dir(v)).map((f) => new File([readFileSync(new URL(f, dir(v)))], f));

/** Value at a patient point, via a 1×1 reformat (exercises the same code path as the viewer). */
const at = (V: MprVolume, p: Vec3) => reformat(V, p, viewPlane(IDENTITY, 'tra'), 1, 1, 1, 1, { thick: 1, mode: 'mpr' })[0];

// marker cube: x 9..15 (left), y −15..−9 (anterior), z 13..19 (head); background 100
const MARK: Vec3 = [12, -12, 16];

describe.each(['explicit', 'implicit', 'rle', 'jpeg-lossless', 'j2k', 'jpeg-ls', 'enhanced', 'enhanced-j2k'])('loading %s', (variant) => {
  it('builds one sagittal volume with the right geometry and values', async () => {
    const { volumes, report } = await loadVolumes(filesOf(variant));
    expect(report.unsupported.size).toBe(0);
    expect(volumes).toHaveLength(1);
    const V = volumes[0];
    expect([V.nx, V.ny, V.nz]).toEqual([22, 24, 20]);
    expect([V.sx, V.sy, V.sz]).toEqual([2, 2, 2]);
    expect(V.R.map((x) => x + 0)).toEqual([0, 1, 0]);
    expect(V.Cd.map((x) => x + 0)).toEqual([0, 0, -1]);
    expect(V.volumetric).toBe(true);
    expect(at(V, MARK)).toBeCloseTo(1000, 0);
    expect(at(V, [-12, -12, 16])).toBeCloseTo(100, 0); // same point mirrored to the right: background
    expect(at(V, [12, 12, 16])).toBeCloseTo(100, 0); // mirrored to posterior
    expect(V.info.TR).toBe(2300);
  });
});

describe('anonymization and grouping', () => {
  it('reports identifying data and private tags without keeping them', async () => {
    const { volumes, report } = await loadVolumes(filesOf('explicit'));
    for (const x of ['Nombre del paciente', 'ID del paciente', 'Fecha de nacimiento', 'Institución', 'Médico tratante']) expect(report.phi.has(x), x).toBe(true);
    expect(report.priv).toBeGreaterThan(0);
    const kept = JSON.stringify({ ...volumes[0], data: [] });
    expect(kept).not.toMatch(/FICTICIO|22222222|19800101|Centro Ejemplo|MEDICO/);
  });

  it('splits echoes of one series into separate volumes', async () => {
    const { volumes } = await loadVolumes(filesOf('dual-echo'));
    expect(volumes).toHaveLength(2);
    const bg = volumes.map((V) => at(V, [-12, 12, 0])).sort((a, b) => a - b);
    expect(bg[0]).toBeCloseTo(100, 0);
    expect(bg[1]).toBeCloseTo(200, 0);
  });
});

describe('MPR views', async () => {
  const V = (await loadVolumes(filesOf('explicit'))).volumes[0];
  /** Where the marker lands in a 2-pixel-wide view: which half (columns) and which half (rows). */
  const halves = (view: ViewId, center: Vec3) => {
    const P = viewPlane(IDENTITY, view), N = 40, img = reformat(V, center, P, 40, 40, N, N, { thick: 1, mode: 'mpr' });
    let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (img[j * N + i] > 500) { sx += i; sy += j; n++; }
    return { n, right: sx / n > N / 2, bottom: sy / n > N / 2 };
  };

  it('transverse: patient left on the image right, anterior at the top', () => {
    const h = halves('tra', [0, 0, 16]);
    expect(h.n).toBeGreaterThan(0);
    expect(h).toMatchObject({ right: true, bottom: false });
  });
  it('sagittal: anterior on the left, head at the top', () => {
    const h = halves('sag', [12, 0, 0]);
    expect(h).toMatchObject({ right: false, bottom: false });
  });
  it('coronal: patient left on the right, head at the top', () => {
    const h = halves('cor', [0, -12, 0]);
    expect(h).toMatchObject({ right: true, bottom: false });
  });

  it('MIP shows the marker from a thick slab that misses it at its centre', () => {
    const P = viewPlane(IDENTITY, 'tra'), c: Vec3 = [12, -12, 6]; // 7 mm below the cube
    expect(reformat(V, c, P, 2, 2, 1, 1, { thick: 1, mode: 'mpr' })[0]).toBeCloseTo(100, 0);
    expect(reformat(V, c, P, 2, 2, 1, 1, { thick: 20, mode: 'mip' })[0]).toBeGreaterThan(900);
    const avg = reformat(V, c, P, 2, 2, 1, 1, { thick: 20, mode: 'avg' })[0];
    expect(avg).toBeGreaterThan(100);
    expect(avg).toBeLessThan(900);
  });

  it('marks pixels outside the volume as empty', () => {
    expect(Number.isNaN(at(V, [0, 0, 200]))).toBe(true);
  });

  it('auto window covers the bright tissue', () => {
    const wl = autoWindow(V.data);
    expect(wl.c + wl.w / 2).toBeGreaterThanOrEqual(100);
  });
});

describe('oblique geometry', () => {
  it('rotations keep the frame orthonormal', () => {
    let R = IDENTITY;
    for (let i = 0; i < 200; i++) R = rotate(R, [0.3, 1, 0.2], 0.07);
    for (let a = 0; a < 3; a++) {
      expect(Math.hypot(...R[a])).toBeCloseTo(1, 6);
      for (let b = a + 1; b < 3; b++) expect(dot3(R[a], R[b])).toBeCloseTo(0, 6);
    }
  });
  it('rotating inside a view keeps that view upright and tilts the other two', () => {
    const before = viewPlane(IDENTITY, 'sag');
    const R = rotate(IDENTITY, before.n, 0.3);
    const after = viewPlane(R, 'sag');
    expect(after.u.map((x) => +x.toFixed(9))).toEqual(before.u.map((x) => +x.toFixed(9)));
    expect(after.v.map((x) => +x.toFixed(9))).toEqual(before.v.map((x) => +x.toFixed(9)));
    expect(Math.abs(viewPlane(R, 'tra').n[2])).toBeLessThan(0.99);
    expect(Math.abs(viewPlane(R, 'cor').n[1])).toBeLessThan(0.99);
  });

  it('names and labels oblique planes', () => {
    const R = rotate(IDENTITY, [1, 0, 0], (20 * Math.PI) / 180);
    expect(planeName(viewPlane(R, 'tra').n)).toBe('Tra>Cor');
    expect(planeName(viewPlane(IDENTITY, 'sag').n)).toBe('Sag');
    expect(dirLabel([0.7, 0, 0.71])).toBe('HL');
    expect(dirLabel([-1, 0, 0])).toBe('R');
  });
  it('spaces a parallel range evenly around the centre', () => {
    const c = rangeCenters([0, 0, 0], [0, 1, 0], 5, 3.5);
    expect(c.map((p) => p[1])).toEqual([-7, -3.5, 0, 3.5, 7]);
  });
});
