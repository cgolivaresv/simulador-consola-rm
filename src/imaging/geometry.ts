import type { PlaneGeom, Plane, ProtocolParams, Vec3 } from '../core/types';
import { dot3 } from '../core/util';

const D2R = Math.PI / 180;
export interface Axes { u: Vec3; v: Vec3; n: Vec3 }

/**
 * Orientation of a transverse slice group: angulation toward coronal (T>C, about the R-L axis),
 * then toward sagittal (T>S, about the A-P axis), then in-plane rotation of the field of view.
 * u = image columns, v = image rows, n = slice normal (u × v).
 */
export function sliceAxes(pp: Pick<ProtocolParams, 'tilt' | 'tiltS' | 'rot'>): Axes {
  const a = pp.tilt * D2R, b = (pp.tiltS ?? 0) * D2R, g = (pp.rot ?? 0) * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  const u1: Vec3 = [cb, 0, -sb], v1: Vec3 = [sa * sb, ca, sa * cb];
  return {
    u: [u1[0] * cg + v1[0] * sg, u1[1] * cg + v1[1] * sg, u1[2] * cg + v1[2] * sg],
    v: [-u1[0] * sg + v1[0] * cg, -u1[1] * sg + v1[1] * cg, -u1[2] * sg + v1[2] * cg],
    n: [ca * sb, -sa, ca * cb],
  };
}

/** Inverse of sliceAxes: the three angles (degrees) of an orientation. */
export function anglesOf(ax: Axes): { tilt: number; tiltS: number; rot: number } {
  const a = Math.asin(Math.max(-1, Math.min(1, -ax.n[1]))), b = Math.atan2(ax.n[0], ax.n[2]);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const u1: Vec3 = [cb, 0, -sb], v1: Vec3 = [sa * sb, ca, sa * cb];
  const g = Math.atan2(dot3(ax.u, v1), dot3(ax.u, u1));
  return { tilt: a / D2R, tiltS: b / D2R, rot: g / D2R };
}

/** Siemens-style orientation text, e.g. "T > C -12.0 > S 4.5". */
export function orientText(pp: Pick<ProtocolParams, 'tilt' | 'tiltS'>): string {
  const f = (v: number) => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(1);
  if (!pp.tilt && !pp.tiltS) return 'Transversal';
  return 'T' + (pp.tilt ? ` > C ${f(pp.tilt)}` : '') + (pp.tiltS ? ` > S ${f(pp.tiltS)}` : '');
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
