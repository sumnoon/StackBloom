// Minimal types for the parts of gifenc (MIT, https://github.com/mattdesl/gifenc) that the exporter uses.
declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number,
      options?: {palette?: number[][]; delay?: number; repeat?: number}): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: {format?: string}): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
