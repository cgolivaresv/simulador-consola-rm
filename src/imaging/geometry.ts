import type { PlaneGeom, Plane, ProtocolParams, Vec3 } from '../core/types';
import { dot3 } from '../core/util';

const D2R = Math.PI / 180;
export interface Axes { u: Vec3; v: Vec3; n: Vec3 }
export type Ori = ProtocolParams['ori'];

/**
 * Base frame of each main orientation, in radiological display convention, as the images of the
 * transverse frame's x, y, z: transverse (left on the right, anterior up), sagittal (anterior on the
 * left, head up), coronal (left on the right, head up). All three are proper rotations.
 */
const MAIN: Record<Ori, [Vec3, Vec3, Vec3]> = {
  tra: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  sag: [[0, 1, 0], [0, 0, -1], [-1, 0, 0]],
  cor: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
};
/** Letters of each orientation and of its two angulations: the first tilts toward the second plane, the second toward the third. */
export const ORI_NAMES: Record<Ori, { main: string; a: string; b: string }> = {
  tra: { main: 'T', a: 'C', b: 'S' },
  sag: { main: 'S', a: 'T', b: 'C' },
  cor: { main: 'C', a: 'T', b: 'S' },
};
const toMain = (o: Ori, a: Vec3): Vec3 => {
  const M = MAIN[o];
  return [M[0][0] * a[0] + M[1][0] * a[1] + M[2][0] * a[2], M[0][1] * a[0] + M[1][1] * a[1] + M[2][1] * a[2], M[0][2] * a[0] + M[1][2] * a[1] + M[2][2] * a[2]];
};
const fromMain = (o: Ori, a: Vec3): Vec3 => { const M = MAIN[o]; return [dot3(M[0], a), dot3(M[1], a), dot3(M[2], a)]; };

/** Phase-encoding letters for the horizontal and vertical image axes of an orientation. */
export const phaseLabels = (o: Ori): [string, string] => (o === 'sag' ? ['A >> P', 'H >> F'] : o === 'cor' ? ['R >> L', 'H >> F'] : ['R >> L', 'A >> P']);

/**
 * Orientation of a transverse slice group: angulation toward coronal (T>C, about the R-L axis),
 * then toward sagittal (T>S, about the A-P axis), then in-plane rotation of the field of view.
 * u = image columns, v = image rows, n = slice normal (u × v).
 */
export function sliceAxes(pp: Pick<ProtocolParams, 'tilt' | 'tiltS' | 'rot'> & { ori?: Ori }): Axes {
  const a = pp.tilt * D2R, b = (pp.tiltS ?? 0) * D2R, g = (pp.rot ?? 0) * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  const u1: Vec3 = [cb, 0, -sb], v1: Vec3 = [sa * sb, ca, sa * cb];
  const o = pp.ori ?? 'tra';
  return {
    u: toMain(o, [u1[0] * cg + v1[0] * sg, u1[1] * cg + v1[1] * sg, u1[2] * cg + v1[2] * sg]),
    v: toMain(o, [-u1[0] * sg + v1[0] * cg, -u1[1] * sg + v1[1] * cg, -u1[2] * sg + v1[2] * cg]),
    n: toMain(o, [ca * sb, -sa, ca * cb]),
  };
}

/** Inverse of sliceAxes: the three angles (degrees) of an orientation. */
export function anglesOf(axIn: Axes, o: Ori = 'tra'): { tilt: number; tiltS: number; rot: number } {
  const ax = { u: fromMain(o, axIn.u), v: fromMain(o, axIn.v), n: fromMain(o, axIn.n) };
  const a = Math.asin(Math.max(-1, Math.min(1, -ax.n[1]))), b = Math.atan2(ax.n[0], ax.n[2]);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const u1: Vec3 = [cb, 0, -sb], v1: Vec3 = [sa * sb, ca, sa * cb];
  const g = Math.atan2(dot3(ax.u, v1), dot3(ax.u, u1));
  return { tilt: a / D2R, tiltS: b / D2R, rot: g / D2R };
}

/** Siemens-style orientation text, e.g. "T > C -12.0 > S 4.5" or "Sagittal". */
export function orientText(pp: Pick<ProtocolParams, 'tilt' | 'tiltS'> & { ori?: Ori }): string {
  const o = pp.ori ?? 'tra', N = ORI_NAMES[o];
  const f = (v: number) => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(1);
  if (!pp.tilt && !pp.tiltS) return { tra: 'Transversal', sag: 'Sagittal', cor: 'Coronal' }[o];
  return N.main + (pp.tilt ? ` > ${N.a} ${f(pp.tilt)}` : '') + (pp.tiltS ? ` > ${N.b} ${f(pp.tiltS)}` : '');
}

/** Slice position along the dominant axis of the normal, as on the image overlay: "SP H12.0", "SP L3.5". */
export function spLabel(c: Vec3, n: Vec3): string {
  const a = [0, 1, 2].reduce((best, i) => (Math.abs(n[i]) > Math.abs(n[best]) ? i : best), 0);
  const L = [['L', 'R'], ['P', 'A'], ['H', 'F']][a];
  return `${c[a] >= 0 ? L[0] : L[1]}${Math.abs(c[a]).toFixed(1)}`;
}

/** Geometry of slice i of the slice group. */
export function geomSlice(pp: ProtocolParams, i: number): PlaneGeom {
  const { u, v, n } = sliceAxes(pp);
  const s = (i - (pp.slices - 1) / 2) * pp.thick * (1 + pp.dist / 100);
  const fovR = pp.fovRead, fovP = (fovR * pp.fovPh) / 100, ph = pp.phaseDir === 'RL';
  const Np = Math.max(8, Math.round((pp.base * pp.phRes) / 100));
  return {
    C: [pp.offX + s * n[0], pp.offY + s * n[1], pp.pos + s * n[2]],
    u, v, n,
    fovW: ph ? fovP : fovR, fovH: ph ? fovR : fovP, W: ph ? Np : pp.base, H: ph ? pp.base : Np,
    phaseH: ph, period: fovP * (1 + pp.os / 100),
  };
}

/** Fixed localizer planes, displayed in radiological convention. */
export const LOCG: Record<Plane, { C: Vec3; u: Vec3; v: Vec3; name: string }> = {
  sag: { C: [3, 0, 10], u: [0, 1, 0], v: [0, 0, -1], name: 'Sag' },
  cor: { C: [0, 0, 10], u: [1, 0, 0], v: [0, 0, -1], name: 'Cor' },
  tra: { C: [0, 0, 20], u: [1, 0, 0], v: [0, 1, 0], name: 'Tra' },
};

export function geomLoc(pp: ProtocolParams, plane: Plane): PlaneGeom {
  const g = LOCG[plane];
  return { C: g.C, u: g.u, v: g.v, n: null, fovW: pp.fovRead, fovH: pp.fovRead, W: pp.base, H: pp.base, phaseH: false, period: pp.fovRead * 4, name: g.name };
}
