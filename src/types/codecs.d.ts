// Emscripten codec factories ship without type definitions.
interface EmscriptenDecoder {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getDecodedBuffer(): Uint8Array;
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean };
}
interface CodecModule {
  J2KDecoder: new () => EmscriptenDecoder;
  JpegLSDecoder: new () => EmscriptenDecoder;
}
type CodecFactory = (opts: { locateFile: (f: string) => string }) => Promise<CodecModule>;

declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' { const f: CodecFactory; export default f; }
declare module '@cornerstonejs/codec-charls/decodewasmjs' { const f: CodecFactory; export default f; }
declare module 'jpeg-lossless-decoder-js' {
  export class Decoder { decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer }
}
