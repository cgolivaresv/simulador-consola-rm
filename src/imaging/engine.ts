// Main-thread side of image reconstruction. Uses a Web Worker when the browser allows one
// and falls back to computing in place, so the console works either way.
import type { Img, PhantomData, PlaneGeom, Scan } from '../core/types';
import { computePlane } from './render';
import type { WorkerIn, WorkerOut } from './worker';

let worker: Worker | null = null;
const local = new Map<string, PhantomData>();
const pending = new Map<number, { resolve: (img: Img) => void; reject: (e: Error) => void }>();
let reqId = 0;

try {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data, p = pending.get(m.req);
    if (!p) return;
    pending.delete(m.req);
    if (m.type === 'image') p.resolve({ data: m.data, W: m.W, H: m.H, fovW: m.fovW, fovH: m.fovH });
    else p.reject(new Error(m.message));
  };
  worker.onerror = () => { useLocal('error del worker'); };
} catch {
  worker = null;
}

function useLocal(_why: string) {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const [, p] of pending) p.reject(new Error('worker detenido'));
  pending.clear();
}

/**
 * Hand a phantom to the reconstruction engine. The worker receives a copy; the main thread keeps
 * its own so reconstruction can continue in place if the worker ever stops.
 */
export function registerPhantom(id: string, phantom: PhantomData): void {
  local.set(id, phantom);
  worker?.postMessage({ type: 'register', id, phantom } satisfies WorkerIn);
}

/** Free a phantom's voxels in both threads. */
export function unregisterPhantom(id: string): void {
  local.delete(id);
  worker?.postMessage({ type: 'unregister', id } satisfies WorkerIn);
}

export function compute(pp: Scan, g: PlaneGeom, seed: number): Promise<Img> {
  if (!worker) return Promise.resolve(computePlane(pp, g, seed, local.get(pp.phantom)));
  const req = ++reqId;
  return new Promise<Img>((resolve, reject) => {
    pending.set(req, { resolve, reject });
    worker!.postMessage({ type: 'compute', req, pp, g, seed } satisfies WorkerIn);
  }).catch(() => computePlane(pp, g, seed, local.get(pp.phantom)));
}

export const usingWorker = (): boolean => worker !== null;
