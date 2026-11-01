// Pixel decoders for the transfer syntaxes MR exports actually use. WebAssembly codecs load on first use.

export const TS = {
  IMPLICIT: '1.2.840.10008.1.2',
  EXPLICIT: '1.2.840.10008.1.2.1',
  RLE: '1.2.840.10008.1.2.5',
  JPEG_LOSSLESS_14: '1.2.840.10008.1.2.4.57',
  JPEG_LOSSLESS_SV1: '1.2.840.10008.1.2.4.70',
  JLS_LOSSLESS: '1.2.840.10008.1.2.4.80',
  JLS_NEAR: '1.2.840.10008.1.2.4.81',
  J2K_LOSSLESS: '1.2.840.10008.1.2.4.90',
  J2K: '1.2.840.10008.1.2.4.91',
  HTJ2K_LOSSLESS: '1.2.840.10008.1.2.4.201',
  HTJ2K_RPCL: '1.2.840.10008.1.2.4.202',
  HTJ2K: '1.2.840.10008.1.2.4.203',
} as const;

export const TS_NAME: Record<string, string> = {
  [TS.IMPLICIT]: 'sin compresión', [TS.EXPLICIT]: 'sin compresión', [TS.RLE]: 'RLE',
  [TS.JPEG_LOSSLESS_14]: 'JPEG Lossless', [TS.JPEG_LOSSLESS_SV1]: 'JPEG Lossless',
  [TS.JLS_LOSSLESS]: 'JPEG-LS', [TS.JLS_NEAR]: 'JPEG-LS casi sin pérdida',
  [TS.J2K_LOSSLESS]: 'JPEG 2000 sin pérdida', [TS.J2K]: 'JPEG 2000',
  [TS.HTJ2K_LOSSLESS]: 'HTJ2K', [TS.HTJ2K_RPCL]: 'HTJ2K', [TS.HTJ2K]: 'HTJ2K',
  '1.2.840.10008.1.2.4.50': 'JPEG baseline (con pérdida)', '1.2.840.10008.1.2.4.51': 'JPEG extended (con pérdida)',
  '1.2.840.10008.1.2.1.99': 'Deflate', '1.2.840.10008.1.2.2': 'big endian',
};

export const isNative = (ts: string): boolean => ts === TS.IMPLICIT || ts === TS.EXPLICIT;
export const isSupported = (ts: string): boolean => isNative(ts) || Object.values(TS).includes(ts as never);

export interface PixelInfo { rows: number; cols: number; bits: number; signed: boolean }
export type Samples = Int16Array | Uint16Array | Uint8Array | Int8Array | Int32Array | Uint32Array;

/** Typed view of raw little-endian samples, copied so it no longer references the file buffer. */
export function viewSamples(bytes: Uint8Array, info: PixelInfo): Samples {
  const n = info.rows * info.cols;
  const copy = bytes.slice(0, n * (info.bits <= 8 ? 1 : info.bits <= 16 ? 2 : 4));
  if (info.bits <= 8) return info.signed ? new Int8Array(copy.buffer) : copy;
  if (info.bits <= 16) return info.signed ? new Int16Array(copy.buffer) : new Uint16Array(copy.buffer);
  return info.signed ? new Int32Array(copy.buffer) : new Uint32Array(copy.buffer);
}

/** DICOM RLE (PS3.5 Annex G): one PackBits segment per byte plane, most significant first. */
export function decodeRLE(frame: Uint8Array, info: PixelInfo): Samples {
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const nSeg = dv.getUint32(0, true), n = info.rows * info.cols;
  const bytesPer = info.bits <= 8 ? 1 : info.bits <= 16 ? 2 : 4;
  if (nSeg !== bytesPer) throw new Error(`RLE con ${nSeg} segmentos no soportado`);
  const out = new Uint8Array(n * bytesPer);
  for (let s = 0; s < nSeg; s++) {
    const start = dv.getUint32(4 + s * 4, true), end = s + 1 < nSeg ? dv.getUint32(8 + s * 4, true) : frame.byteLength;
    // segment s holds byte (bytesPer-1-s) of each little-endian sample
    let o = bytesPer - 1 - s, p = start, written = 0;
    while (p < end && written < n) {
      const c = (frame[p++] << 24) >> 24; // signed byte
      if (c >= 0) {
        for (let k = 0; k <= c && written < n; k++, written++, o += bytesPer) out[o] = frame[p++];
      } else if (c > -128) {
        const v = frame[p++];
        for (let k = 0; k < 1 - c && written < n; k++, written++, o += bytesPer) out[o] = v;
      }
    }
  }
  return viewSamples(out, info);
}

let jpegLossless: Promise<typeof import('jpeg-lossless-decoder-js')> | null = null;
let openjpeg: Promise<CodecModule> | null = null;
let charls: Promise<CodecModule> | null = null;

/** In Node tests the .wasm files are read from disk; set this to node_modules' codec dist folders. */
const wasmDir = (): Record<string, string> | undefined => (globalThis as { __CODEC_WASM__?: Record<string, string> }).__CODEC_WASM__;

async function loadOpenJpeg(): Promise<CodecModule> {
  const [{ default: factory }, wasm] = await Promise.all([
    import('@cornerstonejs/codec-openjpeg/decodewasmjs'),
    wasmDir() ? Promise.resolve({ default: wasmDir()!.openjpeg }) : import('@cornerstonejs/codec-openjpeg/decodewasm?url'),
  ]);
  return factory({ locateFile: (f) => (f.endsWith('.wasm') ? wasm.default : f) });
}
async function loadCharls(): Promise<CodecModule> {
  const [{ default: factory }, wasm] = await Promise.all([
    import('@cornerstonejs/codec-charls/decodewasmjs'),
    wasmDir() ? Promise.resolve({ default: wasmDir()!.charls }) : import('@cornerstonejs/codec-charls/decodewasm?url'),
  ]);
  return factory({ locateFile: (f) => (f.endsWith('.wasm') ? wasm.default : f) });
}

function runEmscripten(mod: CodecModule, kind: 'J2KDecoder' | 'JpegLSDecoder', frame: Uint8Array, info: PixelInfo): Samples {
  const dec = new mod[kind]();
  dec.getEncodedBuffer(frame.length).set(frame);
  dec.decode();
  const fi = dec.getFrameInfo();
  if (fi.componentCount !== 1) throw new Error('imagen a color');
  const raw = dec.getDecodedBuffer(); // view into wasm memory: copy before the next decode
  return viewSamples(raw, { ...info, bits: fi.bitsPerSample > 8 ? 16 : 8, signed: fi.isSigned || info.signed });
}

/** Decode one compressed frame to typed samples. */
export async function decodeFrame(ts: string, frame: Uint8Array, info: PixelInfo): Promise<Samples> {
  switch (ts) {
    case TS.RLE:
      return decodeRLE(frame, info);
    case TS.JPEG_LOSSLESS_14:
    case TS.JPEG_LOSSLESS_SV1: {
      jpegLossless ??= import('jpeg-lossless-decoder-js');
      const { Decoder } = await jpegLossless;
      const copy = frame.slice();
      const out = new Decoder().decompress(copy.buffer, 0, copy.byteLength);
      return viewSamples(new Uint8Array(out), info);
    }
    case TS.J2K_LOSSLESS:
    case TS.J2K:
    case TS.HTJ2K_LOSSLESS:
    case TS.HTJ2K_RPCL:
    case TS.HTJ2K:
      openjpeg ??= loadOpenJpeg();
      return runEmscripten(await openjpeg, 'J2KDecoder', frame, info);
    case TS.JLS_LOSSLESS:
    case TS.JLS_NEAR:
      charls ??= loadCharls();
      return runEmscripten(await charls, 'JpegLSDecoder', frame, info);
    default:
      throw new Error(`compresión no soportada (${TS_NAME[ts] || ts})`);
  }
}
