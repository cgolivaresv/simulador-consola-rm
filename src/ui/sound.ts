// Gradient noise: a rough acoustic signature per sequence family, played only after the user turns it on.
import { clamp } from '../core/util';
import { derive, type Protocol } from '../physics/protocol';

let actx: AudioContext | null = null;
let snd: { o: OscillatorNode; iv: number } | null = null;

export function startSound(p: Protocol): void {
  try {
    actx = actx || new AudioContext();
    void actx.resume();
    const ctx = actx, d = derive(p), g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.type = p.seq === 'epi' ? 'sawtooth' : 'square';
    o.frequency.value = { epi: 1050, tse: 2000 / (d.ES || 10), se: 180, gre: 320 }[p.seq];
    o.connect(g);
    o.start();
    const per = { epi: 640, tse: 360, se: 500, gre: clamp(p.TR, 70, 400) }[p.seq];
    const on = { epi: 520, tse: 230, se: 80, gre: 35 }[p.seq];
    const iv = window.setInterval(() => {
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.05, t);
      g.gain.setValueAtTime(0, t + on / 1000);
    }, per);
    snd = { o, iv };
  } catch {
    snd = null;
  }
}

export function stopSound(): void {
  if (!snd) return;
  clearInterval(snd.iv);
  try { snd.o.stop(); } catch { /* already stopped */ }
  snd = null;
}
