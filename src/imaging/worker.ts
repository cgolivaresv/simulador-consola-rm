/// <reference lib="webworker" />
// Image reconstruction off the main thread, so dragging the slice group never stalls the console.
import type { PhantomData, PlaneGeom, Scan } from '../core/types';
import { computePlane } from './render';

export type WorkerIn =
  | { type: 'register'; id: string; phantom: PhantomData }
  | { type: 'unregister'; id: string }
  | { type: 'compute'; req: number; pp: Scan; g: PlaneGeom; seed: number };
export type WorkerOut =
  | { type: 'image'; req: number; data: Float32Array; W: number; H: number; fovW: number; fovH: number }
  | { type: 'error'; req: number; message: string };

const phantoms = new Map<string, PhantomData>();

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'register') { phantoms.set(m.id, m.phantom); return; }
  if (m.type === 'unregister') { phantoms.delete(m.id); return; }
  try {
    const img = computePlane(m.pp, m.g, m.seed, phantoms.get(m.pp.phantom));
    const out: WorkerOut = { type: 'image', req: m.req, ...img };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(out, [img.data.buffer]);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ type: 'error', req: m.req, message: String(err) } satisfies WorkerOut);
  }
};
