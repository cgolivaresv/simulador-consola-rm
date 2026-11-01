// Minimal NIfTI-1 reader: header, sform/qform orientation and voxel data. Converts RAS to the console's LPS.
import type { Vec3, Volume } from '../core/types';
import { gunzipMaybe, norm } from '../core/util';

export interface NiftiResult {
  desc: string;
  vol: Volume<Float32Array>;
  phi: Set<string>;
}

export async function parseNifti(input: ArrayBuffer, name: string): Promise<NiftiResult> {
  const buf = await gunzipMaybe(input);
  const dv = new DataView(buf);
  let le = true;
  if (dv.getInt32(0, true) !== 348) {
    if (dv.getInt32(0, false) === 348) le = false;
    else throw new Error('no es NIfTI-1');
  }
  const i16 = (o: number) => dv.getInt16(o, le), f32 = (o: number) => dv.getFloat32(o, le);
  const str = (o: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (c) s += String.fromCharCode(c); } return s.trim(); };
  const nx = i16(42), ny = i16(44), nz = Math.max(1, i16(46)), dt = i16(70);
  const pix = [0, 1, 2, 3].map((i) => f32(76 + i * 4));
  const vo = Math.max(352, Math.round(f32(108))), slope = f32(112) || 1, icpt = f32(116) || 0;
  // free-text fields can hold names or IDs written by the converter
  const phi = new Set<string>();
  if (str(148, 80)) phi.add('Texto libre del encabezado (descrip)');
  if (str(228, 24)) phi.add('Archivo auxiliar (aux_file)');

  let M: number[][];
  if (i16(254) > 0) M = [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => f32(280 + r * 16 + c * 4)));
  else if (i16(252) > 0) {
    const b = f32(256), c = f32(260), d = f32(264), a = Math.sqrt(Math.max(0, 1 - b * b - c * c - d * d)), qf = pix[0] < 0 ? -1 : 1;
    const Rm = [
      [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
      [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
      [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - c * c - b * b],
    ];
    M = [0, 1, 2].map((r) => [Rm[r][0] * pix[1], Rm[r][1] * pix[2], Rm[r][2] * pix[3] * qf, f32(268 + r * 4)]);
  } else M = [[pix[1], 0, 0, 0], [0, pix[2], 0, 0], [0, 0, pix[3], 0]];
  // NIfTI world space is RAS; the console works in DICOM LPS
  M[0] = M[0].map((v) => -v);
  M[1] = M[1].map((v) => -v);
  const col = (j: number): Vec3 => [M[0][j], M[1][j], M[2][j]];

  const readers: Record<number, [number, (o: number) => number]> = {
    2: [1, (o) => dv.getUint8(o)], 4: [2, (o) => dv.getInt16(o, le)], 8: [4, (o) => dv.getInt32(o, le)],
    16: [4, (o) => dv.getFloat32(o, le)], 64: [8, (o) => dv.getFloat64(o, le)], 256: [1, (o) => dv.getInt8(o)],
    512: [2, (o) => dv.getUint16(o, le)], 768: [4, (o) => dv.getUint32(o, le)],
  };
  const rd = readers[dt];
  if (!rd) throw new Error('tipo de dato NIfTI no soportado');
  const n = nx * ny * nz, data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = rd[1](vo + i * rd[0]) * slope + icpt;
  const sp = [0, 1, 2].map((j) => Math.hypot(...col(j)));
  return {
    desc: name.replace(/\.nii(\.gz)?$/i, ''),
    phi,
    vol: { nx, ny, nz, data, O: col(3), R: norm(col(0)), Cd: norm(col(1)), N: norm(col(2)), sx: sp[0], sy: sp[1], sz: sp[2], shift: [0, 0, 0] },
  };
}
