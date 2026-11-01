// Procedural head built from ellipsoids and sine-modulated sulci. Coarse, but needs no data file.
import type { Pathology } from '../core/types';
import { clamp } from '../core/util';

export const G = 480, RES = 0.5, HALF = 120;

const inE = (x: number, y: number, cx: number, cy: number, a: number, b: number) => {
  const dx = (x - cx) / a, dy = (y - cy) / b;
  return dx * dx + dy * dy <= 1;
};
const in3 = (x: number, y: number, z: number, cx: number, cy: number, cz: number, a: number, b: number, c: number) => {
  const dx = (x - cx) / a, dy = (y - cy) / b, dz = (z - cz) / c;
  return dx * dx + dy * dy + dz * dz <= 1;
};
// [x, y, z, rx, ry, rz] MS lesions
const MS = [[12, -24, 18, 3, 6, 4], [-13, -22, 16, 3, 5, 4], [15, 12, 22, 3, 6, 5], [-16, 16, 14, 4, 4, 4], [22, -6, 30, 3, 3, 3], [-40, 8, 34, 3, 3, 3], [7, -12, 40, 2.5, 2.5, 3], [-9, 22, 26, 3, 7, 4], [28, 30, 8, 3, 3, 3], [-26, -30, 44, 3, 3, 3], [18, -30, 4, 3, 4, 3]];

const sulcus = (th: number, phi: number, db: number) => Math.abs(Math.sin(th * 22 + phi * 16 + 2.2 * Math.sin(th * 4 + phi * 5) + db * 0.1));

function supra(x: number, y: number, z: number, db: number, th: number, rho: number): number {
  const ax = Math.abs(x);
  const cc = ((y + 2) / 36) ** 2 + ((z - 19) / 11) ** 2 <= 1; // corpus callosum / deep midline: no fissure
  if (ax < 1.3 && !cc) return 3;
  if (ax < 3.4 && !cc && db > 1) return 4;
  const depth = 10 + 5 * Math.sin(th * 7 + z * 0.05);
  if (db < depth) {
    const w = 1 - db / depth, sp = sulcus(th, Math.atan2(z - 5, rho * 0.8), db);
    if (sp < 0.2 * w) return 3;
    if (db < 2.6 || sp < 0.8 * Math.sqrt(w)) return 4;
  }
  if (in3(ax, y, z, 8, -4, 19, 6, 24, 10)) return 3; // lateral ventricle bodies
  if (in3(ax, y, z, 9, -20, 6, 5, 8, 8)) return 3; // frontal horns
  if (in3(ax, y, z, 16, 22, 6, 5, 9, 8)) return 3; // atria
  if (in3(x, y, z, 0, 0, -1, 1.8, 11, 8)) return 3; // third ventricle
  if (in3(ax, y, z, 15, -16, 6, 5.5, 8, 11)) return 4; // caudate head
  if (in3(ax, y, z, 10, 5, 1, 7.5, 10, 9)) return 4; // thalamus
  if (in3(ax, y, z, 24, -4, 1, 4.5, 13, 9)) return 4; // putamen
  if (in3(ax, y, z, 36, -4, 0, 1.4, 14, 12)) return 3; // sylvian fissure
  if (in3(ax, y, z, 33, -4, 0, 3, 15, 13)) return 4; // insula
  if (in3(x, y, z, 0, 8, -11, 17, 15, 9)) { // midbrain + cisterns
    if (in3(x, y, z, 0, 16, -11, 1.4, 1.4, 8)) return 3;
    return in3(x, y, z, 0, 8, -11, 12, 11, 7) ? 5 : 3;
  }
  return 5;
}
function cerebellum(x: number, y: number, z: number): number {
  if (Math.abs(x) < 1.2 && y > 56) return 3;
  const rr = Math.sqrt((x / 52) ** 2 + ((y - 40) / 34) ** 2 + ((z + 32) / 22) ** 2);
  const fol = Math.abs(Math.sin(rr * 30 + 2.5 * Math.sin(Math.atan2(z + 32, y - 40) * 5) + Math.sin(x * 0.12) * 1.5));
  if (rr < 0.45 && fol > 0.3) return 5;
  if (fol < 0.12) return 3;
  return 4;
}
function infra(x: number, y: number, z: number, db: number, th: number, rho: number): number {
  const ax = Math.abs(x);
  if (in3(x, y, z, 0, 26, -34, 6, 4, 6)) return 3; // fourth ventricle
  if (in3(x, y, z, 0, 10, -28, 13, 12, 15)) return 5; // pons
  if (in3(x, y, z, 0, 16, -50, 8, 8, 12)) return 5; // medulla
  if (in3(ax, y, z, 40, -10, -24, 24, 34, 17)) { // temporal lobes
    if (in3(ax, y, z, 30, -4, -20, 2, 8, 4)) return 3;
    if (!in3(ax, y, z, 40, -10, -24, 21, 31, 14)) return 4;
    const sp = sulcus(th, Math.atan2(z + 24, rho * 0.8), 0);
    if (sp < 0.18) return 3;
    if (sp < 0.6) return 4;
    return 5;
  }
  if (in3(x, y, z, 0, 12, -26, 22, 22, 24)) return 3; // basal cisterns
  if (z > -30 && y < 34) { const sp = sulcus(th, Math.atan2(z + 20, rho * 0.8), db); return sp < 0.18 ? 3 : sp < 0.6 ? 4 : 5; }
  if (y < -30 && ax < 24) return 0; // paranasal sinuses
  return 1; // skull base
}
function neck(x: number, y: number, z: number): number {
  const ax = Math.abs(x), disc = Math.sin(z * 0.36) > 0.82;
  if (inE(x, y, 0, 22, 7, 7)) return inE(x, y, 0, 22, 4.5, 4.5) ? 5 : 3; // canal + cord
  if (inE(x, y, 0, 4, 9, 8)) return disc ? 7 : 2; // vertebral body / disc
  if (inE(ax, y, 9, 31, 6, 7)) return 1; // posterior elements
  if (inE(x, y, 0, -14, 7, 5)) return 0; // pharynx
  if (y < -22) return Math.sin(x * 0.3) * Math.sin(y * 0.25) > 0.6 ? 2 : 7;
  return Math.sin(ax * 0.35 + y * 0.1) > 0.85 ? 2 : 7;
}

interface Head { s: number; a: number; b: number; cy: number; gcY: number; gz: number }
let hzZ = NaN, hz: Head | null = null;
function headAt(z: number): Head {
  if (z === hzZ && hz) return hz;
  const s = z < 5 ? Math.sqrt(Math.max(0, 1 - ((z - 5) / 112) ** 2)) : Math.sqrt(Math.max(0, 1 - ((z - 5) / 92) ** 2));
  const t = clamp((-40 - z) / 20, 0, 1);
  const a = 72 * s * (1 - t) + 52 * t, b = 92 * s * (1 - t) + 60 * t, cy = 6 * t;
  hzZ = z;
  hz = { s: z < -150 ? 0 : z < 5 ? Math.max(s, t) : s, a, b, cy, gcY: -(92 * s - 16), gz: 1 - ((z + 33) / 13) ** 2 };
  return hz;
}

export function labelPoint(x: number, y: number, z: number, path: Pathology): number {
  const h = headAt(z);
  if (h.s < 0.03) return 0;
  const a = h.a, b = h.b, yy = y - h.cy;
  const rho = Math.hypot(x, yy);
  if (rho > b + 1 && rho > a + 1) return 0;
  const th = Math.atan2(yy, x), c = Math.cos(th), sn = Math.sin(th);
  const d = (a * b) / Math.sqrt((b * c) ** 2 + (a * sn) ** 2) - rho;
  if (d < 0) return 0;
  if (z < -18 && z > -50) { // orbits
    for (const sx of [-30, 30]) {
      if (h.gz > 0 && inE(x, y, sx, h.gcY, 12 * Math.sqrt(h.gz), 12 * Math.sqrt(h.gz))) return d < 1.6 ? 7 : 8;
      if (inE(x, y, sx * 0.85, h.gcY + 14, 15, 22)) return Math.abs(x - sx * 0.85) < 2 && y > h.gcY + 10 ? 5 : 2;
    }
    if (inE(x, y, 0, h.gcY + 6, 10, 20)) return 0;
  }
  if (d < 1.6) return 7;
  if (d < 4.6) return 2;
  const skull = z > (y > 15 ? -56 : -44);
  if (!skull) return neck(x, y, z);
  if (d < 6.2) return 1;
  if (d < 7.4) return 2;
  if (d < 8.8) return 1;
  if (d < 10.6) return 3;
  const db = d - 10.6;
  let lab: number;
  if (in3(x, y, z, 0, 40, -32, 52, 34, 22) && !(z > -14 && y < 20)) lab = cerebellum(x, y, z);
  else lab = z >= -14 ? supra(x, y, z, db, th, rho) : infra(x, y, z, db, th, rho);
  if (path === 'ms' && lab === 5) {
    for (const e of MS) {
      const ex = (x - e[0]) / e[3], ey = (y - e[1]) / e[4], ez = (z - e[2]) / e[5];
      if (ex * ex + ey * ey + ez * ez <= 1) { lab = 6; break; }
    }
  }
  if (path === 'stroke' && (lab === 4 || lab === 5) && x > 0 && th > -0.8 && th < 0.55 && rho > 20 && z > -6 && z < 34 && db < 38) lab = 9;
  return lab;
}

function buildLabels(z: number, path: Pathology): Uint8Array {
  const L = new Uint8Array(G * G);
  for (let j = 0; j < G; j++) {
    const y = -HALF + (j + 0.5) * RES;
    for (let i = 0; i < G; i++) L[j * G + i] = labelPoint(-HALF + (i + 0.5) * RES, y, z, path);
  }
  return L;
}

const labelCache = new Map<string, Uint8Array>();
/** Cached axial label slice at 0.5 mm, for the fast path of straight transverse images. */
export function getLabels(z: number, path: Pathology): Uint8Array {
  const zq = Math.round(z * 2) / 2, key = path + '|' + zq;
  let L = labelCache.get(key);
  if (!L) {
    if (labelCache.size > 90) labelCache.delete(labelCache.keys().next().value as string);
    L = buildLabels(zq, path);
    labelCache.set(key, L);
  }
  return L;
}
