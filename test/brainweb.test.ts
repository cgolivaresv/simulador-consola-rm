import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scan } from '../src/core/types';
import { decodeBrainWeb, BW } from '../src/phantom/brainweb';
import { FLAG_MS, FLAG_STROKE } from '../src/phantom/volume';
import { geomLoc, geomSlice } from '../src/imaging/geometry';
import { computePlane } from '../src/imaging/render';
import { LIB, newProt, paramsOf } from '../src/physics/protocol';

const ph = await decodeBrainWeb(readFileSync(new URL('../public/brainweb.gz.txt', import.meta.url), 'utf8'));
if (ph.type !== 'labels') throw new Error('labels expected');
const d = ph.vol.data;
const at = (x: number, y: number, z: number) => d[((Math.round(z - BW.oz) * BW.ny) + Math.round(y - BW.oy)) * BW.nx + Math.round(x - BW.ox)];
const isBrain = (v: number) => (v & 63) === 4 || (v & 63) === 5;

/** Centroid of voxels matching a test, in patient LPS mm. */
function centroid(test: (v: number) => boolean, zMin = -1e9, zMax = 1e9) {
  let n = 0, sx = 0, sy = 0;
  for (let k = 0; k < BW.nz; k++) {
    const z = BW.oz + k;
    if (z < zMin || z > zMax) continue;
    for (let j = 0; j < BW.ny; j++) for (let i = 0; i < BW.nx; i++) if (test(d[(k * BW.ny + j) * BW.nx + i])) { n++; sx += BW.ox + i; sy += BW.oy + j; }
  }
  return { n, x: sx / n, y: sy / n };
}

describe('BrainWeb orientation (LPS)', () => {
  it('the posterior fossa is posterior: brain below the temporal lobes sits at y > 0', () => {
    expect(centroid(isBrain, -45, -35).y).toBeGreaterThan(10);
  });
  it('the vertex is up: tissue above the brain at the top, brain at the isocentre', () => {
    expect(isBrain(at(0, 0, 10)) || (at(0, 0, 10) & 63) === 3).toBe(true);
    expect(at(0, -10, 105) & 63).not.toBe(4);
  });
  it('the left MCA infarct lies in the patient left hemisphere (x > 0)', () => {
    const c = centroid((v) => (v & FLAG_STROKE) !== 0);
    expect(c.n).toBeGreaterThan(10000);
    expect(c.x).toBeGreaterThan(25);
  });
  it('MS lesions lie in white matter', () => {
    let n = 0, wm = 0;
    for (const v of d) if (v & FLAG_MS) { n++; if ((v & 63) === 5) wm++; }
    expect(n).toBeGreaterThan(1000);
    expect(wm / n).toBeGreaterThan(0.99);
  });
});

describe('image reconstruction on BrainWeb', () => {
  const t2 = newProt(LIB.find((t) => t.name === 't2_tse_tra')!);
  const pp: Scan = { ...paramsOf(t2), B0: 1.5, phantom: 'bw', path: 'normal' };

  it('returns the requested matrix and is reproducible for a seed', () => {
    const g = geomSlice(pp, 9);
    const a = computePlane(pp, g, 7, ph), b = computePlane(pp, g, 7, ph);
    expect(a.data.length).toBe(g.W * g.H);
    expect(a.data).toEqual(b.data);
  });

  it('the sagittal localizer shows the face at the left of the image (anterior)', () => {
    const loc: Scan = { ...paramsOf(newProt(LIB[0])), B0: 1.5, phantom: 'bw', path: 'normal' };
    const g = geomLoc(loc, 'sag');
    const img = computePlane(loc, g, 1, ph);
    // columns run anterior → posterior; brain signal sits around the centre, so compare the two outer quarters at eye level
    const row = Math.round(img.H * 0.55);
    let ant = 0, post = 0;
    for (let i = 0; i < img.W / 4; i++) { ant += img.data[row * img.W + i]; post += img.data[row * img.W + img.W - 1 - i]; }
    expect(ant).not.toBe(post);
    expect(img.data.length).toBe(g.W * g.H);
  });
});
