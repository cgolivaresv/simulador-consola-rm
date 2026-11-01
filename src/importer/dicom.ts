// Read uncompressed DICOM slices, keep only pixels and geometry, and report what identifying data was dropped.
import * as dicomParser from 'dicom-parser';
import type { DataSet } from 'dicom-parser';
import type { Vec3, Volume } from '../core/types';
import { cross, dot3, norm } from '../core/util';

/** Attributes that identify a person, institution or encounter (DICOM PS3.15 Annex E, basic profile subset). */
export const PHI_TAGS: Record<string, string> = {
  x00100010: 'Nombre del paciente', x00100020: 'ID del paciente', x00100030: 'Fecha de nacimiento', x00100040: 'Sexo',
  x00101010: 'Edad', x00101020: 'Estatura', x00101030: 'Peso', x00101040: 'Dirección del paciente', x00102154: 'Teléfono',
  x00100050: 'Seguro del paciente', x00101000: 'Otros IDs del paciente', x00101001: 'Otros nombres del paciente', x00104000: 'Comentarios del paciente',
  x00080080: 'Institución', x00080081: 'Dirección de la institución', x00080090: 'Médico tratante', x00081050: 'Médico informante',
  x00081070: 'Operador', x00081010: 'Nombre de la estación', x00081040: 'Departamento', x00181000: 'N° de serie del equipo',
  x00080020: 'Fecha del estudio', x00080021: 'Fecha de la serie', x00080022: 'Fecha de adquisición', x00080023: 'Fecha de contenido',
  x00080030: 'Hora del estudio', x00080031: 'Hora de la serie', x00080032: 'Hora de adquisición', x00080050: 'Número de acceso',
  x00200010: 'ID del estudio', x0020000d: 'UID del estudio', x0020000e: 'UID de la serie', x00080018: 'UID de la instancia',
  x00321032: 'Médico solicitante', x00400254: 'Descripción del procedimiento', x00380010: 'N° de admisión',
};
const NATIVE_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);

export interface Slice {
  series: string;
  desc: string;
  type: string;
  inst: number;
  ipp: number[];
  iop: number[];
  ps: number[];
  thick: number;
  rows: number;
  cols: number;
  px: Float32Array;
}
export interface DicomResult {
  slice: Slice;
  phi: Set<string>;
  priv: number;
}

export class DicomError extends Error {
  constructor(public reason: 'compressed' | 'nopixels' | 'color' | 'invalid', msg?: string) { super(msg || reason); }
}

/** Walk every element, including inside sequences, and note identifying and private attributes. */
function scan(ds: DataSet, phi: Set<string>, counter: { priv: number }) {
  for (const tag of Object.keys(ds.elements)) {
    const el = ds.elements[tag];
    const group = parseInt(tag.slice(1, 5), 16);
    if (group % 2 === 1) counter.priv++;
    else if (PHI_TAGS[tag]) phi.add(PHI_TAGS[tag]);
    else if (group === 0x0010) phi.add('Otros datos del paciente (grupo 0010)');
    if (el.items) for (const item of el.items) if (item.dataSet) scan(item.dataSet, phi, counter);
  }
}

const nums = (ds: DataSet, tag: string): number[] => {
  const n = ds.numStringValues(tag) || 0, out: number[] = [];
  for (let i = 0; i < n; i++) out.push(ds.floatString(tag, i) ?? NaN);
  return out;
};

export function parseDicom(buf: ArrayBuffer): DicomResult {
  let ds: DataSet;
  try {
    ds = dicomParser.parseDicom(new Uint8Array(buf));
  } catch (e) {
    throw new DicomError('invalid', String(e));
  }
  const ts = ds.string('x00020010');
  const pxEl = ds.elements.x7fe00010;
  if (!pxEl) throw new DicomError('nopixels');
  if ((ts && !NATIVE_TS.has(ts)) || pxEl.encapsulatedPixelData) throw new DicomError('compressed');
  if ((ds.uint16('x00280002') ?? 1) !== 1) throw new DicomError('color');

  const phi = new Set<string>(), counter = { priv: 0 };
  scan(ds, phi, counter);

  const rows = ds.uint16('x00280010') ?? 0, cols = ds.uint16('x00280011') ?? 0;
  const bits = ds.uint16('x00280100') ?? 16, signed = (ds.uint16('x00280103') ?? 0) === 1;
  const slope = ds.floatString('x00281053') ?? 1, icpt = ds.floatString('x00281052') ?? 0;
  const np = rows * cols, bytes = ds.byteArray;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + pxEl.dataOffset, pxEl.length);
  const px = new Float32Array(np);
  for (let i = 0; i < np; i++) {
    const raw = bits === 8 ? dv.getUint8(i)
      : bits === 32 ? (signed ? dv.getInt32(i * 4, true) : dv.getUint32(i * 4, true))
      : signed ? dv.getInt16(i * 2, true) : dv.getUint16(i * 2, true);
    px[i] = raw * (slope || 1) + icpt;
  }
  const slice: Slice = {
    series: ds.string('x0020000e') || '?',
    desc: ds.string('x0008103e') || '(sin descripción)',
    type: ds.string('x00080008') || '',
    inst: ds.intString('x00200013') ?? 0,
    ipp: nums(ds, 'x00200032'), iop: nums(ds, 'x00200037'), ps: nums(ds, 'x00280030'),
    thick: ds.floatString('x00180050') ?? 0,
    rows, cols, px,
  };
  return { slice, phi, priv: counter.priv };
}

/** Stack slices of one series into a volume ordered along the slice normal. */
export function dicomVolume(sl: Slice[]): Volume<Float32Array> {
  const f = sl[0];
  if (f.iop.length !== 6 || f.ipp.length !== 3 || f.ps.length !== 2) throw new Error('sin geometría');
  const R = norm(f.iop.slice(0, 3)), Cd = norm(f.iop.slice(3, 6)), N = norm(cross(R, Cd));
  const ok = sl.filter((s) => s.rows === f.rows && s.cols === f.cols).sort((a, b) => dot3(a.ipp, N) - dot3(b.ipp, N));
  const pos = ok.map((s) => dot3(s.ipp, N));
  const gaps = pos.slice(1).map((p, i) => p - pos[i]).filter((g) => g > 1e-3).sort((a, b) => a - b);
  const sz = gaps.length ? gaps[gaps.length >> 1] : f.thick || 1;
  const uniq = [ok[0]];
  for (let i = 1; i < ok.length; i++) if (pos[i] - dot3(uniq[uniq.length - 1].ipp, N) > sz * 0.5) uniq.push(ok[i]);
  const nx = f.cols, ny = f.rows, nz = uniq.length, data = new Float32Array(nx * ny * nz);
  uniq.forEach((s, k) => data.set(s.px, k * nx * ny));
  return { nx, ny, nz, data, O: uniq[0].ipp.slice(0, 3) as Vec3, R, Cd, N, sx: f.ps[1], sy: f.ps[0], sz, shift: [0, 0, 0] };
}
