// Read stored MR acquisitions (classic or enhanced multi-frame DICOM, or NIfTI) into volumes for MPR.
// Identifying attributes are only checked for presence and reported; their values are never kept.
import * as dicomParser from 'dicom-parser';
import type { DataSet, Element } from 'dicom-parser';
import type { Vec3, Volume } from '../core/types';
import { cross, dot3, norm } from '../core/util';
import { PHI_TAGS } from '../importer/dicom';
import { parseNifti } from '../importer/nifti';
import { decodeFrame, isNative, isSupported, TS_NAME, viewSamples, type PixelInfo, type Samples } from './codecs';

export type VoxelData = Int16Array | Uint16Array | Float32Array;

/** Acquisition parameters worth showing next to the images. None of them identify the patient. */
export interface AcqInfo {
  desc: string;
  protocol?: string;
  TR?: number;
  TE?: number;
  TI?: number;
  FA?: number;
  B0?: number;
  maker?: string;
  seq?: string;
  /** diffusion b-value, s/mm² */
  b?: number;
  ts: string;
}

export interface MprVolume extends Volume<VoxelData> {
  id: string;
  info: AcqInfo;
  warnings: string[];
  /** true when slices are close enough together for clean reformats */
  volumetric: boolean;
}

interface Frame {
  key: string;
  ipp: Vec3;
  iop: number[];
  ps: [number, number];
  thick: number;
  rows: number;
  cols: number;
  px: Samples;
  slope: number;
  icpt: number;
  order: number;
  info: AcqInfo;
}

export interface LoadReport {
  files: number;
  read: number;
  skipped: number;
  unsupported: Map<string, number>;
  phi: Set<string>;
  priv: number;
}

function scanPhi(ds: DataSet, rep: LoadReport) {
  for (const tag of Object.keys(ds.elements)) {
    const el = ds.elements[tag], group = parseInt(tag.slice(1, 5), 16);
    if (group % 2 === 1) rep.priv++;
    else if (PHI_TAGS[tag]) rep.phi.add(PHI_TAGS[tag]);
    else if (group === 0x0010) rep.phi.add('Otros datos del paciente (grupo 0010)');
    if (el.items) for (const it of el.items) if (it.dataSet) scanPhi(it.dataSet, rep);
  }
}

const nums = (ds: DataSet | undefined, tag: string): number[] => {
  if (!ds || !ds.elements[tag]) return [];
  const n = ds.numStringValues(tag) || 0, out: number[] = [];
  for (let i = 0; i < n; i++) out.push(ds.floatString(tag, i) ?? NaN);
  return out;
};
const item = (ds: DataSet | undefined, tag: string, i = 0): DataSet | undefined => ds?.elements[tag]?.items?.[i]?.dataSet;
/** First dataset among per-frame and shared functional groups that contains a macro. */
const fg = (perFrame: DataSet | undefined, shared: DataSet | undefined, seq: string) => item(perFrame, seq) ?? item(shared, seq);

function acqInfo(ds: DataSet, ts: string): AcqInfo {
  const f = (t: string) => ds.floatString(t);
  const mrSeq = item(item(ds, 'x52009229'), 'x00189112'); // enhanced: MR Timing and Related Parameters
  return {
    desc: ds.string('x0008103e') || ds.string('x00181030') || '(sin descripción)',
    protocol: ds.string('x00181030'),
    TR: f('x00180080') ?? mrSeq?.floatString('x00180080'),
    TE: f('x00180081') ?? item(item(ds, 'x52009230'), 'x00189114')?.double('x00189082'),
    TI: f('x00180082'),
    FA: f('x00181314') ?? mrSeq?.double('x00181314'),
    B0: f('x00180087'),
    maker: [ds.string('x00080070'), ds.string('x00081090')].filter(Boolean).join(' '),
    seq: ds.string('x00180024') || ds.string('x00189005'),
    ts: TS_NAME[ts] || ts,
  };
}

function frameBytes(ds: DataSet, el: Element, i: number, n: number, frameLen: number, native: boolean): Uint8Array {
  if (native) return new Uint8Array(ds.byteArray.buffer, ds.byteArray.byteOffset + el.dataOffset + i * frameLen, frameLen);
  if (n === 1) return dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, 0, el.fragments!.length) as Uint8Array;
  if (el.basicOffsetTable && el.basicOffsetTable.length) return dicomParser.readEncapsulatedImageFrame(ds, el, i) as Uint8Array;
  if (el.fragments && el.fragments.length === n) return dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, i, 1) as Uint8Array;
  return dicomParser.readEncapsulatedImageFrame(ds, el, i, dicomParser.createJPEGBasicOffsetTable(ds, el)) as Uint8Array;
}

/** All image frames of one DICOM file, with their geometry. */
async function readDicomFile(buf: ArrayBuffer, fileOrder: number, rep: LoadReport): Promise<Frame[]> {
  const ds = dicomParser.parseDicom(new Uint8Array(buf));
  const ts = ds.string('x00020010') || '1.2.840.10008.1.2';
  const el = ds.elements.x7fe00010;
  if (!el) return [];
  if (!isSupported(ts)) { rep.unsupported.set(TS_NAME[ts] || ts, (rep.unsupported.get(TS_NAME[ts] || ts) || 0) + 1); return []; }
  if ((ds.uint16('x00280002') ?? 1) !== 1) throw new Error('color');
  scanPhi(ds, rep);

  const rows = ds.uint16('x00280010') ?? 0, cols = ds.uint16('x00280011') ?? 0;
  const bits = ds.uint16('x00280100') ?? 16, signed = (ds.uint16('x00280103') ?? 0) === 1;
  const pinfo: PixelInfo = { rows, cols, bits, signed };
  const n = ds.intString('x00280008') ?? 1, native = isNative(ts);
  const frameLen = rows * cols * (bits <= 8 ? 1 : bits <= 16 ? 2 : 4);
  const info = acqInfo(ds, ts);
  const series = ds.string('x0020000e') || 'serie';
  const shared = item(ds, 'x52009229'), perSeq = ds.elements.x52009230?.items;
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const per = perSeq?.[i]?.dataSet;
    const ipp = (nums(fg(per, shared, 'x00209113'), 'x00200032').length ? nums(fg(per, shared, 'x00209113'), 'x00200032') : nums(ds, 'x00200032')) as Vec3;
    const iop = nums(fg(per, shared, 'x00209116'), 'x00200037').length ? nums(fg(per, shared, 'x00209116'), 'x00200037') : nums(ds, 'x00200037');
    const meas = fg(per, shared, 'x00289110');
    const ps = (nums(meas, 'x00280030').length ? nums(meas, 'x00280030') : nums(ds, 'x00280030')) as [number, number];
    const thick = meas?.floatString('x00180050') ?? ds.floatString('x00180050') ?? 0;
    const pvt = fg(per, shared, 'x00289145');
    const slope = pvt?.floatString('x00281053') ?? ds.floatString('x00281053') ?? 1;
    const icpt = pvt?.floatString('x00281052') ?? ds.floatString('x00281052') ?? 0;
    if (ipp.length !== 3 || iop.length !== 6 || ps.length !== 2) continue;
    // separate echoes, dynamics and stacks of the same series into their own volumes
    const echo = per ? item(per, 'x00189114')?.double('x00189082') ?? '' : ds.string('x00180086') ?? '';
    const temporal = per ? item(per, 'x00209111')?.uint32('x00209128') ?? '' : ds.string('x00200100') ?? '';
    const stack = per ? item(per, 'x00209111')?.string('x00209056') ?? '' : '';
    // b-value: standard attribute, enhanced per-frame macro, or the vendor field Siemens classic DWI uses
    const bval = (per ? item(per, 'x00189117')?.double('x00189087') : undefined) ?? ds.double('x00189087') ?? ds.intString('x0019100c');
    const key = [series, iop.map((v) => v.toFixed(3)).join(','), echo, temporal, stack, rows, cols, bval ?? ''].join('|');
    const bytes = frameBytes(ds, el, i, n, frameLen, native);
    const px = native ? viewSamples(bytes, pinfo) : await decodeFrame(ts, bytes, pinfo);
    frames.push({ key, ipp, iop, ps, thick, rows, cols, px, slope, icpt, order: fileOrder * 10000 + i, info: bval !== undefined ? { ...info, b: bval, desc: `${info.desc} b${bval}` } : info });
  }
  return frames;
}

/** Stack frames of one key into a volume ordered along the slice normal. */
function buildVolume(frames: Frame[], id: string): MprVolume {
  const f = frames[0];
  const R = norm(f.iop.slice(0, 3)), Cd = norm(f.iop.slice(3, 6)), N = norm(cross(R, Cd));
  frames.sort((a, b) => dot3(a.ipp, N) - dot3(b.ipp, N) || a.order - b.order);
  const pos = frames.map((s) => dot3(s.ipp, N));
  const warnings: string[] = [];
  // repeated positions mean several volumes share a key (e.g. no echo tag): keep the first of each
  const uniq: Frame[] = [frames[0]], up = [pos[0]];
  for (let i = 1; i < frames.length; i++) if (pos[i] - up[up.length - 1] > 1e-3) { uniq.push(frames[i]); up.push(pos[i]); }
  if (uniq.length < frames.length) warnings.push(`Había ${frames.length - uniq.length} imágenes en posiciones repetidas; se usó la primera de cada posición.`);
  const gaps = up.slice(1).map((p, i) => p - up[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const sz = sorted.length ? sorted[sorted.length >> 1] : f.thick || 1;
  if (gaps.some((g) => Math.abs(g - sz) > 0.1 * sz)) warnings.push('El espaciado entre cortes no es uniforme (faltan imágenes o hay cortes repetidos): las reformaciones pueden verse deformadas.');
  const inplane = Math.min(f.ps[0], f.ps[1]);
  const volumetric = uniq.length >= 16 && sz <= Math.max(2.5 * inplane, 1.6);
  if (!volumetric) warnings.push(uniq.length < 16
    ? 'Tiene muy pocos cortes para MPR.'
    : `No es una adquisición volumétrica (cortes cada ${sz.toFixed(1)} mm, píxel ${inplane.toFixed(2)} mm): los planos reformateados se verán escalonados.`);

  const nx = f.cols, ny = f.rows, nz = uniq.length, np = nx * ny;
  const identity = uniq.every((s) => s.slope === 1 && s.icpt === 0);
  const anyFloat = !identity || uniq.some((s) => s.px instanceof Int32Array || s.px instanceof Uint32Array);
  const unsignedBig = uniq.some((s) => s.px instanceof Uint16Array && s.px.some((v) => v > 32767));
  const data: VoxelData = anyFloat ? new Float32Array(np * nz) : unsignedBig ? new Uint16Array(np * nz) : new Int16Array(np * nz);
  uniq.forEach((s, k) => {
    const o = k * np;
    if (anyFloat) for (let i = 0; i < np; i++) data[o + i] = s.px[i] * s.slope + s.icpt;
    else data.set(s.px as ArrayLike<number>, o);
  });
  return {
    id, nx, ny, nz, data, O: uniq[0].ipp.slice() as Vec3, R, Cd, N, sx: f.ps[1], sy: f.ps[0], sz, shift: [0, 0, 0],
    info: f.info, warnings, volumetric,
  };
}

let vid = 0;

/** Read files (a folder or a selection) and return every volume found, with an anonymization report. */
export async function loadVolumes(files: File[], progress?: (done: number, total: number) => void): Promise<{ volumes: MprVolume[]; report: LoadReport }> {
  const rep: LoadReport = { files: files.length, read: 0, skipped: 0, unsupported: new Map(), phi: new Set(), priv: 0 };
  const groups = new Map<string, Frame[]>();
  const volumes: MprVolume[] = [];
  for (let i = 0; i < files.length; i++) {
    if (progress && i % 8 === 0) { progress(i, files.length); await new Promise((r) => setTimeout(r)); }
    const f = files[i];
    if (/^(dicomdir|\..*)$/i.test(f.name) || /\.(txt|xml|json|htm|html|exe|inf|ini|jpg|png|pdf)$/i.test(f.name)) { rep.skipped++; continue; }
    try {
      const buf = await f.arrayBuffer();
      if (/\.nii(\.gz)?$/i.test(f.name)) {
        const n = await parseNifti(buf, f.name);
        n.phi.forEach((x) => rep.phi.add(x));
        const v = n.vol;
        volumes.push({ ...v, id: 'v' + ++vid, info: { desc: n.desc, ts: 'NIfTI' }, warnings: [], volumetric: v.nz >= 16 });
        rep.read++;
        continue;
      }
      const frames = await readDicomFile(buf, i, rep);
      if (frames.length) rep.read++; else rep.skipped++;
      for (const fr of frames) { let g = groups.get(fr.key); if (!g) groups.set(fr.key, (g = [])); g.push(fr); }
    } catch {
      rep.skipped++;
    }
  }
  progress?.(files.length, files.length);
  for (const fr of groups.values()) {
    if (fr.length < 2) continue; // single images (localizer leftovers, reports) are not volumes
    try { volumes.push(buildVolume(fr, 'v' + ++vid)); } catch { rep.skipped += fr.length; }
  }
  volumes.sort((a, b) => Number(b.volumetric) - Number(a.volumetric) || b.nz - a.nz);
  return { volumes, report: rep };
}
