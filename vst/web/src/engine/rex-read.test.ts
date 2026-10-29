import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeAudioFile } from './codec';
import { encodeRex } from './rex';
import { decodeRex } from './rex-read';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/rex/${name}`, import.meta.url)));

/** A level within `lsb` steps of 16-bit audio. */
const LSB16 = 1 / 32768;

/**
 * The WAV references are what the REX SDK renders at 120 BPM, slice by slice: each slice from 2 frames
 * after its start, at the file's processing gain (1000 is 0.8333), placed where it falls at 120 BPM,
 * with a tail after it. The first slice plays straight from the file until the next starts, so there
 * the decoded loop and the reference are the same samples; later slices start over the tail before them.
 */
const SDK_GAIN = 1000 * 0.000833333354;
const SDK_OFFSET = 2;

function expectFirstSliceMatches(rx2: string, wav: string, frames: number): void {
  const rex = decodeRex(fixture(rx2));
  const ref = decodeAudioFile(fixture(wav));
  for (let c = 0; c < 2; c++) {
    const decoded = rex.audio.channels[c]!;
    const reference = ref.channels[c] ?? ref.channels[0]!;
    let worst = 0;
    for (let f = 0; f < frames; f++) worst = Math.max(worst, Math.abs(decoded[f + SDK_OFFSET]! * SDK_GAIN - reference[f]!));
    // The reference was rounded to 16 bits after the gain: within two steps.
    expect(worst).toBeLessThanOrEqual(2 * LSB16);
  }
}

/** Frames of a quarter note at 120 BPM and 44.1 kHz, as the references are rendered. */
const QUARTER = 22050;
/** The SDK renders in blocks of 64 frames, so a slice may land up to a block off. */
const BLOCK = 64;

/**
 * Every slice is heard in the reference where its place in the loop falls at 120 BPM: its part of the
 * padded loop times its bars of four quarters. Its first 4000 frames correlate with the reference there,
 * within a block; a slice that starts silent is silent there too.
 */
function expectSlicesPlaced(name: string): void {
  const rex = decodeRex(fixture(`${name}.rx2`));
  const ref = decodeAudioFile(fixture(`${name}.wav`)).channels[0]!;
  const decoded = rex.audio.channels[0]!;
  const n = 4000;
  rex.slices.forEach((part, k) => {
    const src = Math.round(part * decoded.length) + SDK_OFFSET;
    const at = Math.round(part * rex.bars * 4 * QUARTER);
    const x = Array.from({ length: n }, (_, i) => decoded[src + i]! * SDK_GAIN);
    const xx = x.reduce((sum, v) => sum + v * v, 0);
    if (xx === 0) {
      const yy = Array.from({ length: n }, (_, i) => (ref[at + i] ?? 0) ** 2).reduce((a, b) => a + b, 0);
      expect(yy, `${name} slice ${k} silent`).toBeLessThan(1e-3);
      return;
    }
    let best = -1;
    for (let d = -BLOCK; d <= BLOCK; d++) {
      let xy = 0;
      let yy = 0;
      for (let i = 0; i < n; i++) {
        const y = ref[at + d + i] ?? 0;
        xy += x[i]! * y;
        yy += y * y;
      }
      best = Math.max(best, xy / Math.sqrt(xx * yy + 1e-20));
    }
    expect(best, `${name} slice ${k}`).toBeGreaterThan(0.99);
  });
}

describe('REX import', () => {
  it('reads 120Stereo.rx2: one bar at 120 BPM, its ten slices, the sound of its WAV', () => {
    const rex = decodeRex(fixture('120Stereo.rx2'));
    expect(rex.sampleRate).toBe(44100);
    expect(rex.previewBpm).toBe(120);
    expect(rex.bars).toBe(1);
    // From loop start 54 to loop end 88254: a bar at 120 BPM.
    expect(rex.audio.channels[0]!.length).toBe(88200);
    // Ten slices, the first a leading slice from the loop's start (as the REX SDK reports it), 10890 frames long.
    expect(rex.slices).toHaveLength(10);
    expect(rex.slices[0]).toBe(0);
    expect(rex.slices[1]).toBeCloseTo(10890 / 88200, 12);
    // The two channels differ.
    expect(rex.audio.channels[0]!.some((v, i) => v !== rex.audio.channels[1]![i])).toBe(true);
    expectFirstSliceMatches('120Stereo.rx2', '120Stereo.wav', 10000);
  });

  it('reads 120FourBeats.rx2: four beats are one bar, and it sounds as its WAV', () => {
    const rex = decodeRex(fixture('120FourBeats.rx2'));
    expect(rex.previewBpm).toBe(120);
    expect(rex.bars).toBe(1);
    expect(rex.audio.channels[0]!.length).toBe(113801 - 322);
    expect(rex.slices).toHaveLength(10);
    expectFirstSliceMatches('120FourBeats.rx2', '120FourBeats.wav', 10000);
  });

  it('reads 120Mono.rx2 from its first slice, before its loop start, as the REX SDK plays it', () => {
    const mono = decodeRex(fixture('120Mono.rx2'));
    const four = decodeRex(fixture('120FourBeats.rx2'));
    const [left, right] = mono.audio.channels;
    expect(left).toEqual(right);
    // Its loop start is 14363, but its first slice is at 322: the loop is played from there, so it is the
    // same loop as 120FourBeats (whose WAV reference is 120Mono's, byte for byte), four beats of ~93 BPM.
    expect(left!.length).toBe(113801 - 322);
    expect(left).toEqual(four.audio.channels[0]);
    expect(mono.slices).toEqual(four.slices);
    expect(mono.slices).toHaveLength(10);
    expectFirstSliceMatches('120Mono.rx2', '120Mono.wav', 10000);
  });

  it('reads 120Mono24Bits.rx2, 24-bit, as its WAV', () => {
    const rex = decodeRex(fixture('120Mono24Bits.rx2'));
    expect(rex.bars).toBe(1);
    expect(rex.slices).toHaveLength(10);
    expectFirstSliceMatches('120Mono24Bits.rx2', '120Mono24Bits.wav', 10000);
  });

  it('reads 120ThreeBeats.rx2 as one bar, the fourth beat silent', () => {
    const rex = decodeRex(fixture('120ThreeBeats.rx2'));
    expect(rex.bars).toBe(1);
    expect(rex.slices).toHaveLength(8);
    const audio = rex.audio.channels[0]!;
    // Three beats of the loop, then one more of silence at the loop's own tempo.
    const loop = Math.round((audio.length * 3) / 4);
    expect(audio.subarray(loop + 1).every((v) => v === 0)).toBe(true);
    expectFirstSliceMatches('120ThreeBeats.rx2', '120ThreeBeats.wav', 10000);
  });

  it.each(['120Stereo', '120Mono', '120FourBeats', '120ThreeBeats', '120Mono24Bits'])('places every slice of %s where the REX SDK plays it', (name) => {
    expectSlicesPlaced(name);
  });

  it('reads a file Breakseq exported with the same slices, tempo and sound', () => {
    const at = (k: number, i: number) => Math.sin(i * 0.01 * (k + 1)) * 0.8;
    const lengths = [5000, 7000, 11050];
    const slices = lengths.map((n, k): [Float32Array, Float32Array] => [
      Float32Array.from({ length: n }, (_, i) => at(k, i)),
      Float32Array.from({ length: n }, (_, i) => -at(k, i) / 2),
    ]);
    const rex = decodeRex(encodeRex({ sampleRate: 44100, bpm: 132, slices }));
    expect(rex.previewBpm).toBe(132);
    expect(rex.slices).toHaveLength(3);
    expect(rex.bars).toBe(1);
    // Padded to a bar at 132 BPM.
    const frames = rex.audio.channels[0]!.length;
    expect(frames).toBe(Math.round((4 * 60 * 44100) / 132));
    expect(rex.slices.map((s) => Math.round(s * frames))).toEqual([0, 5000, 12000]);
    let at0 = 0;
    slices.forEach(([l, r]) => {
      for (let i = 0; i < l.length; i++) {
        expect(Math.abs(rex.audio.channels[0]![at0 + i]! - l[i]!)).toBeLessThan(1 / 8388607);
        expect(Math.abs(rex.audio.channels[1]![at0 + i]! - r[i]!)).toBeLessThan(1 / 8388607);
      }
      at0 += l.length;
    });
    // Then silence.
    expect(rex.audio.channels[0]!.subarray(at0).every((v) => v === 0)).toBe(true);
  });

  it('reads a long export the same, past the blocks its decompressor works in', () => {
    // 1.2 million frames: past the first block of 2^20.
    const n = 1_200_000;
    const l = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.003) * 0.5);
    const r = Float32Array.from({ length: n }, (_, i) => Math.cos(i * 0.002) * 0.5);
    const rex = decodeRex(encodeRex({ sampleRate: 44100, bpm: 120, slices: [[l, r]] }));
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(rex.audio.channels[0]![i]! - l[i]!), Math.abs(rex.audio.channels[1]![i]! - r[i]!));
    expect(worst).toBeLessThan(1 / 8388607);
  });

  it('rounds a loop that is not whole bars up, padding it with silence at its own tempo', () => {
    // Six beats at 120 BPM: two bars, the second half silent.
    const beat = 22050;
    const one = (n: number): [Float32Array, Float32Array] => [new Float32Array(n).fill(0.25), new Float32Array(n).fill(0.25)];
    const rex = decodeRex(encodeRex({ sampleRate: 44100, bpm: 120, slices: [one(3 * beat), one(3 * beat)] }));
    expect(rex.bars).toBe(2);
    expect(rex.audio.channels[0]!.length).toBe(8 * beat);
    expect(rex.slices).toEqual([0, 3 / 8]);
    expect(rex.audio.channels[0]![6 * beat]).toBe(0);
  });

  it('keeps a slice muted in the file as a marker, even one its sensitivity would hide', () => {
    const bytes = fixture('120Stereo.rx2').slice();
    const view = new DataView(bytes.buffer);
    // The first SLCE: frame 1637, hidden at the file's sensitivity.
    const at = [...bytes].findIndex((_, i) => String.fromCharCode(...bytes.subarray(i, i + 4)) === 'SLCE');
    expect(view.getUint32(at + 4)).toBe(11);
    expect(view.getUint32(at + 8)).toBe(1637);
    expect(decodeRex(bytes).slices).toHaveLength(10);
    bytes[at + 8 + 10] = 0x01; // muted
    const rex = decodeRex(bytes);
    expect(rex.slices).toHaveLength(11);
    expect(rex.slices[1]).toBeCloseTo((1637 - 54) / 88200, 12);
  });

  it('says what is wrong with bytes that are not a REX2 file, or a damaged one', () => {
    expect(() => decodeRex(new Uint8Array([1, 2, 3]))).toThrow('Not a REX2 file');
    expect(() => decodeRex(fixture('120Stereo.wav'))).toThrow('Not a REX2 file');
    expect(() => decodeRex(fixture('ErrorCorrupt.rx2'))).toThrow('Damaged REX2 file');
    // Cut short: the audio ends before its frames do.
    const whole = fixture('120Stereo.rx2');
    expect(() => decodeRex(whole.subarray(0, whole.length - 20000))).toThrow('Damaged REX2 file');
  });
});
