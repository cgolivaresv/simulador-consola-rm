/** Tissue labels used by every phantom. */
export const T = {
  AIR: 0,
  BONE: 1,
  FAT: 2,
  CSF: 3,
  GM: 4,
  WM: 5,
  LESION: 6,
  MUSCLE: 7,
  VITREOUS: 8,
  INFARCT: 9,
  BLOOD: 10,
} as const;
export const N_TISSUES = 11;

/** [PD, T1 ms, T2 ms, T2* ms, ADC ×10⁻³ mm²/s] at 1.5 T, indexed by label. */
const TIS: number[][] = [
  [0, 1, 1, 1, 0],
  [0.04, 500, 2, 1, 0.1],
  [0.95, 260, 80, 50, 0.01],
  [1, 4200, 1800, 1200, 3.0], // CSF: T1 ≈ 4.2 s at 1.5 T, so FLAIR with TR 9000 nulls it near TI 2450
  [0.82, 1000, 95, 55, 0.85],
  [0.7, 640, 75, 45, 0.72],
  [0.86, 1150, 170, 110, 1.15],
  [0.72, 870, 45, 28, 1.5],
  [0.98, 3200, 900, 600, 2.6],
  [0.84, 1080, 120, 70, 0.38],
  [0.8, 1350, 50, 40, 2.0],
];
const T1_AT_3T = [1, 1, 1.42, 1.03, 1.33, 1.3, 1.3, 1.6, 1.08, 1.32, 1.25];

/** Relaxation table for a field strength: T1 lengthens and T2* shortens at 3 T. */
export function tissues(B0: number): number[][] {
  const t = TIS.map((r) => r.slice());
  if (B0 === 3) t.forEach((r, i) => { r[1] *= T1_AT_3T[i]; r[2] *= 0.92; r[3] *= 0.6; });
  return t;
}
