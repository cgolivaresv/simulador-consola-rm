// Coordinates are patient LPS in millimetres, like DICOM:
// x → patient left, y → posterior, z → head.
export type Vec3 = [number, number, number];

export type Seq = 'tse' | 'se' | 'gre' | 'epi';
export type Pathology = 'normal' | 'ms' | 'stroke';
export type Plane = 'sag' | 'cor' | 'tra';

/** Everything the technologist can set on a protocol. */
export interface ProtocolParams {
  name: string;
  seq: Seq;
  loc: boolean;
  TR: number;
  TE: number;
  TI: number;
  FA: number;
  refFA: number;
  ETL: number;
  bw: number;
  nex: number;
  slices: number;
  thick: number;
  dist: number;
  pos: number;
  offX: number;
  offY: number;
  tilt: number;
  fovRead: number;
  fovPh: number;
  base: number;
  phRes: number;
  os: number;
  phaseDir: 'RL' | 'AP';
  pat: number;
  prep: 'none' | 'ir';
  fat: 'none' | 'fs';
  b: number;
  rf: 'normal' | 'lowsar' | 'fast';
  interp: 'on' | 'off';
}

/** Scanner and phantom conditions at acquisition time. */
export interface Env {
  B0: number;
  phantom: string;
  path: Pathology;
}

/** A protocol frozen together with the conditions it was measured under. */
export type Scan = ProtocolParams & Env;

export type NumKey = { [K in keyof ProtocolParams]: ProtocolParams[K] extends number ? K : never }[keyof ProtocolParams];

export interface Img {
  data: Float32Array;
  W: number;
  H: number;
  fovW: number;
  fovH: number;
}

/** Image plane: centre C, in-plane unit vectors u (columns) and v (rows). */
export interface PlaneGeom {
  C: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3 | null;
  fovW: number;
  fovH: number;
  W: number;
  H: number;
  /** true when phase encoding runs along the image columns (horizontal). */
  phaseH: boolean;
  period: number;
  name?: string;
}

/** A voxel grid with DICOM-style orientation: R = row direction, Cd = column direction, N = slice normal. */
export interface Volume<T extends ArrayLike<number> = ArrayLike<number>> {
  nx: number;
  ny: number;
  nz: number;
  data: T;
  O: Vec3;
  R: Vec3;
  Cd: Vec3;
  N: Vec3;
  sx: number;
  sy: number;
  sz: number;
  /** Added to every voxel position, used to centre imported data on the isocentre. */
  shift: Vec3;
}

export type PhantomData =
  | { type: 'geo' }
  | { type: 'labels'; vol: Volume<Uint8Array> }
  | { type: 'maps'; vol: Volume<Float32Array>; t1: Float32Array; t2: Float32Array; pd: Float32Array };
