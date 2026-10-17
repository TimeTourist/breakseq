import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeRex } from './rex';

// The same samples as src/test/rex-golden.cpp, which wrote the golden file with VelociLoops.
const leftAt = (slice: number, i: number) => (((i * 7919 + slice * 31) % 2001) - 1000) / 1024;
const rightAt = (slice: number, i: number) => (((i * 104729 + slice * 17) % 1999) - 999) / 2048;
const slice = (k: number, length: number): [Float32Array, Float32Array] => [
  Float32Array.from({ length }, (_, i) => leftAt(k, i)),
  Float32Array.from({ length }, (_, i) => rightAt(k, i)),
];

describe('REX export', () => {
  it('writes the file VelociLoops writes, byte for byte', () => {
    const rex = encodeRex({ sampleRate: 44100, bpm: 120, slices: [slice(0, 300), slice(1, 500), slice(2, 700)] });
    const golden = new Uint8Array(readFileSync(new URL('../test/rex-golden.rx2', import.meta.url)));
    expect(rex.length).toBe(golden.length);
    const first = rex.findIndex((b, i) => b !== golden[i]);
    expect(first).toBe(-1);
  });

  it('pads the loop to whole beats: a beat and a bit becomes two', () => {
    // At 120 BPM a beat is 22050 frames.
    const rex = encodeRex({ sampleRate: 44100, bpm: 120, slices: [slice(0, 22050), slice(1, 10)] });
    const view = new DataView(rex.buffer);
    const at = (id: string) => [...rex].findIndex((_, i) => String.fromCharCode(...rex.slice(i, i + 4)) === id);
    const sinf = at('SINF') + 8;
    // Rate, then the frames: two beats.
    expect(view.getUint32(sinf + 2)).toBe(44100);
    expect(view.getUint32(sinf + 6)).toBe(44100);
    const glob = at('GLOB') + 8;
    // 0 bars and 2 beats.
    expect([view.getUint16(glob + 4), view.getUint8(glob + 6)]).toEqual([0, 2]);
  });
});
