import type { PlaneGeom, Plane, ProtocolParams, Vec3 } from '../core/types';

/** Geometry of slice i of a transverse slice group, tilted toward coronal (T>C) about the R-L axis. */
export function geomSlice(pp: ProtocolParams, i: number): PlaneGeom {
  const al = (pp.tilt * Math.PI) / 180, ca = Math.cos(al), sa = Math.sin(al);
  const s = (i - (pp.slices - 1) / 2) * pp.thick * (1 + pp.dist / 100);
  const fovR = pp.fovRead, fovP = (fovR * pp.fovPh) / 100, ph = pp.phaseDir === 'RL';
  const Np = Math.max(8, Math.round((pp.base * pp.phRes) / 100));
  return {
    C: [pp.offX, pp.offY - s * sa, pp.pos + s * ca],
    u: [1, 0, 0], v: [0, ca, sa], n: [0, -sa, ca],
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
