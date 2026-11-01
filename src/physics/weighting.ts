// Which weighting a protocol produces, which weighting a stored series has, and which stored series
// stands in for a protocol when the exam is played back on real anatomy.
import type { ProtocolParams, Weighting } from '../core/types';

/** What the protocol's parameters produce. */
export function protWeighting(p: ProtocolParams): Weighting {
  if (p.seq === 'epi') return p.b > 0 ? 'DWI' : 'T2';
  if (p.prep === 'ir') return p.TI >= 1200 ? 'FLAIR' : p.TI <= 400 ? 'STIR' : 'T1';
  if (p.seq === 'gre') return p.TE >= 15 ? 'T2*' : p.FA <= 12 && p.TR > 100 ? 'PD' : 'T1';
  if (p.TE >= 60) return 'T2';
  if (p.TR <= 1000) return 'T1';
  return 'PD';
}

export interface SeriesFacts { desc?: string; protocol?: string; seq?: string; TR?: number; TE?: number; TI?: number; FA?: number; b?: number }

/** Best guess of a stored series' weighting from its name and acquisition parameters. */
export function guessWeighting(f: SeriesFacts): Weighting {
  const t = [f.desc, f.protocol, f.seq].filter(Boolean).join(' ').toLowerCase();
  const TR = f.TR ?? 0, TE = f.TE ?? 0, TI = f.TI ?? 0;
  if (/\badc\b|apparent|_adc/.test(t)) return 'ADC';
  if (/diff|dwi|trace|ep_b|ep2d_d|\bb ?\d{3,4}\b|tracew/.test(t) || (f.b ?? 0) > 0) return 'DWI';
  if (/flair|dark.?fluid|da-?fl|tirm.*dark|spcir|t2.?fl\b/.test(t) || TI >= 1200) return 'FLAIR';
  if (/stir|tirm|\bfs.?ir\b/.test(t) || (TI > 0 && TI <= 300)) return 'STIR';
  if (/swi|swan|t2\*|t2star|medic|hemo|\bgre\b|fl2d|fl3d.*t2|merge|suscept/.test(t)) return 'T2*';
  if (/\bt1|mprage|bravo|spgr|vibe|tfl|mp2rage|fspgr|ir.?fspgr|\bt1w/.test(t)) return 'T1';
  if (/\bpd|proton/.test(t)) return 'PD';
  if (/\bt2|space|\bspc|cube|tse|frfse|haste|\bt2w/.test(t)) return 'T2';
  if (TI >= 600) return 'T1'; // MPRAGE-like
  if (TE >= 60) return 'T2';
  if (TR > 0 && TR <= 800 && TE < 30) return 'T1';
  if (TR >= 1500 && TE < 40) return 'PD';
  return 'otro';
}

/** Which stored weightings can stand in, best first. ADC maps are never shown as anatomy. */
const FALLBACK: Record<Weighting, Weighting[]> = {
  T1: ['T1', 'PD', 'T2*', 'T2', 'FLAIR', 'STIR', 'DWI', 'otro'],
  T2: ['T2', 'STIR', 'FLAIR', 'PD', 'T2*', 'T1', 'DWI', 'otro'],
  PD: ['PD', 'T2', 'T1', 'STIR', 'FLAIR', 'T2*', 'otro'],
  FLAIR: ['FLAIR', 'T2', 'PD', 'STIR', 'T1', 'otro'],
  STIR: ['STIR', 'T2', 'FLAIR', 'PD', 'T1', 'otro'],
  'T2*': ['T2*', 'T2', 'PD', 'T1', 'FLAIR', 'otro'],
  DWI: ['DWI', 'T2', 'FLAIR', 'STIR', 'T1', 'otro'],
  ADC: ['T2', 'T1', 'otro'],
  otro: ['otro', 'T1', 'T2', 'PD', 'FLAIR'],
};

export interface Pick { index: number; want: Weighting; got: Weighting; exact: boolean }

/** The stored series to play back for a protocol. Among equals, the first listed wins (the user's order). */
export function pickSource(p: ProtocolParams, sources: { weighting: Weighting; b?: number }[]): Pick {
  const want = protWeighting(p);
  for (const w of FALLBACK[want]) {
    const cands = sources.map((s, i) => ({ s, i })).filter((x) => x.s.weighting === w);
    if (!cands.length) continue;
    // for diffusion take the highest b-value
    const best = w === 'DWI' ? cands.sort((a, b) => (b.s.b ?? 0) - (a.s.b ?? 0))[0] : cands[0];
    return { index: best.i, want, got: w, exact: w === want };
  }
  return { index: 0, want, got: sources[0]?.weighting ?? 'otro', exact: false };
}
