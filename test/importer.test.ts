import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildFromLabels, buildFromMaps, guessRole } from '../src/importer/build';
import { DicomError, dicomVolume, parseDicom } from '../src/importer/dicom';
import { parseNifti } from '../src/importer/nifti';
import type { Volume } from '../src/core/types';

const fixture = (n: string) => { const b = readFileSync(new URL(`./fixtures/${n}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('DICOM import and anonymization', () => {
  const files = [0, 1, 2].map((k) => parseDicom(fixture(`fake_t1map_${k}.dcm`)));

  it('reports every identifying attribute, including inside sequences', () => {
    const phi = new Set(files.flatMap((f) => [...f.phi]));
    for (const x of ['Nombre del paciente', 'ID del paciente', 'Fecha de nacimiento', 'Institución', 'Médico tratante', 'Fecha del estudio'])
      expect(phi.has(x), x).toBe(true);
    expect(files[0].priv).toBeGreaterThanOrEqual(2);
  });

  it('keeps no identifying values in what it returns', () => {
    const json = JSON.stringify(files.map((f) => ({ ...f.slice, px: [] })));
    expect(json).not.toMatch(/FICTICIO|11111111|19700101|Clinica|DOCTOR|OTRO/);
  });

  it('reads explicit and implicit VR pixels with rescale slope', () => {
    expect(Array.from(files[0].slice.px.slice(0, 4))).toEqual([0, 2, 4, 6]);
    expect(Array.from(files[1].slice.px.slice(0, 4))).toEqual([0, 2, 4, 6]);
  });

  it('stacks slices by position along the normal', () => {
    const v = dicomVolume(files.map((f) => f.slice).reverse());
    expect([v.nx, v.ny, v.nz, v.sz]).toEqual([4, 4, 3, 5]);
    expect(v.O).toEqual([-100, -100, 0]);
  });

  it('refuses compressed transfer syntaxes with a clear reason', () => {
    expect(() => parseDicom(fixture('fake_jpeg.dcm'))).toThrowError(DicomError);
    try { parseDicom(fixture('fake_jpeg.dcm')); } catch (e) { expect((e as DicomError).reason).toBe('compressed'); }
  });
});

/** Tiny NIfTI-1 with an sform; i runs toward RAS -x (patient left). */
function nifti(arr: Float32Array, dims: [number, number, number], descrip = ''): Uint8Array {
  const h = new DataView(new ArrayBuffer(352));
  h.setInt32(0, 348, true);
  [3, ...dims, 1, 1, 1, 1].forEach((v, i) => h.setInt16(40 + i * 2, v, true));
  h.setInt16(70, 16, true); h.setInt16(72, 32, true);
  [1, 2, 2, 2].forEach((v, i) => h.setFloat32(76 + i * 4, v, true));
  h.setFloat32(108, 352, true); h.setFloat32(112, 1, true);
  for (let i = 0; i < descrip.length; i++) h.setUint8(148 + i, descrip.charCodeAt(i));
  h.setInt16(254, 1, true);
  [[-2, 0, 0, 10], [0, -2, 0, 20], [0, 0, 2, -30]].forEach((row, r) => row.forEach((v, c) => h.setFloat32(280 + r * 16 + c * 4, v, true)));
  const out = new Uint8Array(352 + arr.byteLength);
  out.set(new Uint8Array(h.buffer), 0);
  out.set(new Uint8Array(arr.buffer), 352);
  return out;
}

describe('NIfTI import', () => {
  it('converts RAS to LPS and flags free-text header fields', async () => {
    const raw = nifti(new Float32Array(8).fill(1), [2, 2, 2], 'APELLIDO NOMBRE');
    const gz = gzipSync(raw);
    const r = await parseNifti(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer, 'sujeto_T1map.nii.gz');
    expect(r.vol.R.map((v) => v + 0)).toEqual([1, 0, 0]); // RAS −x = LPS +x (patient left); +0 folds −0
    expect(r.vol.Cd.map((v) => v + 0)).toEqual([0, 1, 0]);
    expect(r.vol.O).toEqual([-10, -20, -30]);
    expect(r.vol.sx).toBe(2);
    expect(r.phi.has('Texto libre del encabezado (descrip)')).toBe(true);
    expect(r.desc).toBe('sujeto_T1map');
  });
});

describe('building phantoms', () => {
  const vol = (data: number[]): Volume<Float32Array> => ({ nx: data.length, ny: 1, nz: 1, data: Float32Array.from(data), O: [0, 0, 0], R: [1, 0, 0], Cd: [0, 1, 0], N: [0, 0, 1], sx: 1, sy: 1, sz: 1, shift: [0, 0, 0] });

  it('detects T1 maps in seconds and converts them to ms', () => {
    const b = buildFromMaps(vol([0.8, 1.0, 3.7, 0.65]), vol([75, 95, 1800, 70]), vol([700, 820, 1000, 690]), false);
    if (b.phantom.type !== 'maps') throw new Error();
    expect(b.phantom.t1[0]).toBeCloseTo(800);
    expect(b.desc).toContain('s → ms');
  });

  it('maps FSL FAST classes to CSF, GM and WM', () => {
    const b = buildFromLabels(vol([0, 1, 2, 3]), false);
    if (b.phantom.type !== 'labels') throw new Error();
    expect(Array.from(b.phantom.vol.data)).toEqual([0, 3, 4, 5]);
  });

  it('guesses the role of a series from its name', () => {
    expect(guessRole('MAGiC T1map')).toBe('t1');
    expect(guessRole('synthseg.nii.gz')).toBe('labels');
    expect(guessRole('PD map')).toBe('pd');
  });
});
