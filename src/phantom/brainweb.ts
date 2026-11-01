import type { PhantomData } from '../core/types';
import { base64ToBytes, gunzipMaybe } from '../core/util';

/**
 * BrainWeb labels at 1 mm, stored [z][y][x] in LPS (x → left, y → posterior, z → head).
 * The origin puts the ventricles near the isocentre. Regenerate with tools/prep_brainweb.py.
 */
export const BW = { nx: 181, ny: 217, nz: 181, ox: -90.5, oy: -105.5, oz: -64.26 };

/** Decode the shipped file: gzip, then base64 so any static host serves it as plain text. */
export async function decodeBrainWeb(b64: string): Promise<PhantomData> {
  const data = new Uint8Array(await gunzipMaybe(base64ToBytes(b64).buffer as ArrayBuffer));
  if (data.length !== BW.nx * BW.ny * BW.nz) throw new Error('tamaño inesperado');
  return {
    type: 'labels',
    vol: { nx: BW.nx, ny: BW.ny, nz: BW.nz, data, O: [BW.ox, BW.oy, BW.oz], R: [1, 0, 0], Cd: [0, 1, 0], N: [0, 0, 1], sx: 1, sy: 1, sz: 1, shift: [0, 0, 0] },
  };
}

export async function loadBrainWeb(url: string): Promise<PhantomData> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return decodeBrainWeb(await r.text());
}
