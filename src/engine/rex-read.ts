/**
 * Reads REX2 files (.rx2), the sliced loops ReCycle writes. A port of the
 * reading half of VelociLoops (https://github.com/kunitoki/VelociLoops,
 * Unlicense): its IFF chunk parser, the slice list as its finalizeSlices keeps
 * it, and its DWOP decompressor. Only the loop's waveform and where its slices
 * start are read; how a REX player renders a slice (gain, stretch) is not.
 * Older REX (.rex) and ReCycle (.rcy) files are other formats and are not read.
 */
import type { AudioData } from '../model';
import { adjustJRbits, minAverageIndex, updateAverages } from './rex';

/** A REX2 file read: the loop's waveform, its tempo and where its slices start. */
export interface RexFile {
  readonly sampleRate: number;
  /**
   * The tempo ReCycle auditions the file at (GLOB), which a REX player plays its slices at. Not the
   * loop's own tempo: that follows from the audio's length and `bars`.
   */
  readonly previewBpm: number;
  /** The loop's length in 4/4 bars, rounded up to whole bars. */
  readonly bars: number;
  /** The loop, padded with silence to `bars` whole bars; a mono file in both channels. */
  readonly audio: AudioData;
  /** Where the slices start, as parts 0–1 of `audio`: sorted, the first at 0. */
  readonly slices: readonly number[];
}

const NOT_REX = 'Not a REX2 file';
const DAMAGED = 'Damaged REX2 file';

/** VelociLoops reads at most this many SLCE chunks. */
const MAX_SLICES = 1024;
/** One hour at 192 kHz, VelociLoops' limit. */
const MAX_FRAMES = 3600 * 192000;

interface SliceEntry {
  readonly start: number;
  readonly length: number;
  readonly points: number;
  readonly selected: boolean;
  /** Locked or muted in ReCycle. */
  readonly special: boolean;
}

interface Parsed {
  headerSeen: boolean;
  channels: number;
  bitDepth: number;
  sampleRate: number;
  totalFrames: number;
  loopStart: number;
  loopEnd: number;
  tempo: number;
  bars: number;
  beats: number;
  timeSigNum: number;
  timeSigDen: number;
  sensitivity: number;
  slices: SliceEntry[];
  sdat: { offset: number; size: number } | null;
}

const be32 = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const be16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const ascii = (b: Uint8Array, at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** The chunks from `start` up to `end`, CAT chunks entered, as VelociLoops' parseIFF walks them. */
function parseIff(b: Uint8Array, start: number, end: number, p: Parsed): void {
  let off = start;
  while (off + 8 < end && off + 8 < b.length) {
    const id = ascii(b, off);
    const size = be32(b, off + 4);
    off += 8;
    if (off + size > b.length) throw new Error(DAMAGED);
    if (id === 'HEAD') parseHead(b, off, size, p);
    else if (id === 'SINF') parseSinf(b, off, size, p);
    else if (id === 'GLOB') parseGlob(b, off, size, p);
    else if (id === 'SLCE') parseSlce(b, off, size, p);
    else if ((id === 'SDAT' || id === 'DWOP') && p.sdat === null) p.sdat = { offset: off, size };
    else if (id === 'CAT ' && size >= 4) parseIff(b, off + 4, off + size, p);
    off += size;
    if (off & 1) off++;
  }
}

function parseHead(b: Uint8Array, at: number, size: number, p: Parsed): void {
  // The magic, then 0xbc and a version VelociLoops reads up to 3.
  if (size < 6 || be32(b, at) !== 0x490cf18d || b[at + 4] !== 0xbc) throw new Error(DAMAGED);
  if (b[at + 5]! > 0x03) throw new Error('REX2 file too new');
  p.headerSeen = true;
}

function parseSinf(b: Uint8Array, at: number, size: number, p: Parsed): void {
  if (size < 18) return;
  p.channels = b[at] === 2 ? 2 : 1;
  p.bitDepth = b[at + 1] === 5 ? 24 : 16;
  p.sampleRate = be32(b, at + 2);
  p.totalFrames = be32(b, at + 6);
  p.loopStart = be32(b, at + 10);
  p.loopEnd = be32(b, at + 14);
}

function parseGlob(b: Uint8Array, at: number, size: number, p: Parsed): void {
  if (size < 22) throw new Error(DAMAGED);
  p.bars = be16(b, at + 4);
  p.beats = b[at + 6]!;
  p.timeSigNum = b[at + 7]!;
  p.timeSigDen = b[at + 8]!;
  p.sensitivity = b[at + 9]!;
  const tempo = be32(b, at + 16);
  if (tempo < 20000 || tempo > 450000) throw new Error(DAMAGED);
  p.tempo = tempo;
}

function parseSlce(b: Uint8Array, at: number, size: number, p: Parsed): void {
  if (p.slices.length >= MAX_SLICES || size < 10) return;
  const flags = size > 10 ? b[at + 10]! : 0;
  p.slices.push({
    start: be32(b, at),
    length: be32(b, at + 4),
    points: be16(b, at + 8),
    selected: (flags & 0x04) !== 0,
    special: (flags & 0x03) !== 0,
  });
}

/** Below this many analysis points a boundary is hidden at the file's sensitivity. */
function filterPoints(sensitivity: number): number {
  const sens = Math.min(sensitivity, 99);
  return 0x7fff - Math.floor((sens * 0x7fff + 98) / 99);
}

/**
 * The slices as VelociLoops' finalizeSlices keeps them: sorted, those hidden
 * at the file's sensitivity and those after the loop left out. Muted and
 * locked slices are kept.
 */
function visibleSlices(p: Parsed): SliceEntry[] {
  const hidden = filterPoints(p.sensitivity);
  return [...p.slices]
    .sort((a, b) => a.start - b.start)
    .filter((s) => !(p.loopEnd > p.loopStart && s.start < p.totalFrames && s.start >= p.loopEnd))
    .filter((s) => s.length > 1 || s.selected || s.special || s.points > hidden);
}

const clampInt32 = (v: number): number => (v > 0x7fffffff ? 0x7fffffff : v < -0x80000000 ? -0x80000000 : v);

/** VelociLoops' predictor on decoding: like the writer's, in saturating rather than wrapping arithmetic. Returns the sample, 2x. */
function predict(idx: number, s: number, d: Int32Array): number {
  const [d0, d1, d2, d3] = [d[0]!, d[1]!, d[2]!, d[3]!];
  switch (idx) {
    case 0: {
      const t0 = clampInt32(s - d0);
      const t1 = clampInt32(t0 - d1);
      const t2 = clampInt32(t1 - d2);
      d.set([s, t0, t1, t2, clampInt32(t2 - d3)]);
      return s;
    }
    case 1: {
      const t1 = clampInt32(s - d1);
      const t2 = clampInt32(t1 - d2);
      const nd0 = clampInt32(d0 + s);
      d.set([nd0, s, t1, t2, clampInt32(t2 - d3)]);
      return nd0;
    }
    case 2: {
      const nd1 = clampInt32(d1 + s);
      const nd0 = clampInt32(d0 + nd1);
      const t = clampInt32(s - d2);
      d.set([nd0, nd1, s, t, clampInt32(t - d3)]);
      return nd0;
    }
    case 3: {
      const nd2 = clampInt32(d2 + s);
      const nd1 = clampInt32(d1 + nd2);
      const nd0 = clampInt32(d0 + nd1);
      d.set([nd0, nd1, nd2, s, clampInt32(s - d3)]);
      return nd0;
    }
    default: {
      const nd3 = clampInt32(d3 + s);
      const nd2 = clampInt32(d2 + nd3);
      const nd1 = clampInt32(d1 + nd2);
      const nd0 = clampInt32(d0 + nd1);
      d.set([nd0, nd1, nd2, nd3, s]);
      return nd0;
    }
  }
}

/** Big-endian 32-bit words, read a bit at a time, as VelociLoops' readBit and readBits do. */
class BitReader {
  private readonly words: Uint32Array;
  private at = 0;
  private word = 0;
  private left = 0;

  constructor(bytes: Uint8Array) {
    this.words = new Uint32Array(Math.floor(bytes.length / 4));
    for (let i = 0; i < this.words.length; i++) this.words[i] = be32(bytes, i * 4);
  }

  private next(): number {
    if (this.at >= this.words.length) throw new Error(DAMAGED);
    return this.words[this.at++]!;
  }

  bit(): boolean {
    if (--this.left < 0) {
      this.word = this.next();
      this.left = 31;
    }
    const bit = (this.word & 0x80000000) !== 0;
    this.word = (this.word << 1) >>> 0;
    return bit;
  }

  bits(n: number): number {
    if (n <= 0 || n > 31) throw new Error(DAMAGED);
    let result = this.word >>> (32 - n);
    this.word = (this.word << n) >>> 0;
    const before = this.left;
    this.left -= n;
    if (before - n < 0) {
      const next = this.next();
      this.left += 32;
      result = (result | (next >>> this.left)) >>> 0;
      this.word = (next << (32 - this.left)) >>> 0;
    }
    return result;
  }
}

/** One channel's decoder state: deltas, averages, and the Rice-like coder's j and rbits. */
interface Channel {
  readonly d: Int32Array;
  readonly a: Uint32Array;
  j: number;
  rbits: number;
}

const channel = (): Channel => ({ d: new Int32Array(5), a: new Uint32Array(5).fill(2560), j: 2, rbits: 0 });

/** One sample of one channel, 2x, as VelociLoops' decompressMono and decompressStereo read it. */
function decodeSample(c: Channel, input: BitReader): number {
  const idx = minAverageIndex(c.a);
  let step = ((c.a[idx]! * 3 + 36) >>> 0) >>> 7;
  let prefixSum = 0;
  let zerosWin = 7;
  while (!input.bit()) {
    if (step > 0 && prefixSum > 0xffffffff - step) throw new Error(DAMAGED);
    prefixSum += step;
    if (--zerosWin === 0) {
      step = (step << 2) >>> 0;
      zerosWin = 7;
    }
  }
  [c.j, c.rbits] = adjustJRbits(step, c.j, c.rbits);
  let rem = c.rbits > 0 ? input.bits(c.rbits) : 0;
  const thresh = c.j - step;
  if (rem - thresh >= 0) rem = (rem * 2 - thresh + input.bits(1)) >>> 0;
  const code = (rem + prefixSum) >>> 0;
  // Zig-zag: odd codes are negative.
  const signed2x = -(code & 1) ^ (code | 0);
  const sample2x = predict(idx, signed2x, c.d);
  updateAverages(c.a, c.d);
  return sample2x;
}

/** Frames per block VelociLoops decompresses at a time. */
const CHUNK = 0x100000;

function restartBlock(c: Channel): void {
  for (let i = 0; i < 5; i++) c.d[i] = (c.d[i]! >> 1) * 2;
  c.j = 2;
  c.rbits = 0;
}

/** The whole waveform, as integers, channels interleaved; the right channel is stored as its difference from the left. */
function decompress(bytes: Uint8Array, frames: number, channels: number, bitDepth: number): Int32Array {
  const max = bitDepth === 24 ? 8388607 : 32767;
  const clamp = (v: number): number => Math.min(max, Math.max(-max - 1, v));
  const input = new BitReader(bytes);
  const out = new Int32Array(frames * channels);
  const left = channel();
  const right = channel();
  for (let f = 0; f < frames; f++) {
    // VelociLoops decompresses in blocks of CHUNK frames, and each block starts its coder's j and rbits
    // afresh and keeps the deltas at half resolution in between.
    if (f > 0 && f % CHUNK === 0) for (const c of [left, right]) restartBlock(c);
    const l2x = decodeSample(left, input);
    if (channels === 1) {
      out[f] = clamp(l2x >> 1);
      continue;
    }
    const r2x = decodeSample(right, input);
    out[f * 2] = clamp(l2x >> 1);
    out[f * 2 + 1] = clamp(Math.floor((l2x + r2x) / 2));
  }
  return out;
}

/** Whether the bytes are a REX2 file, by their header (an IFF CAT of type REX2), whatever the file is called. */
export function isRexFile(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0) === 'CAT ' && ascii(bytes, 8) === 'REX2';
}

/**
 * Reads a REX2 file: the loop's waveform from its loop start (or its first
 * slice, if that is earlier) to its loop end, padded with silence to whole 4/4
 * bars, and where its slices start. Throws "Not a REX2 file" when the bytes
 * are not one, and "Damaged REX2 file" when they are but cannot be read.
 */
export function decodeRex(bytes: Uint8Array): RexFile {
  if (!isRexFile(bytes)) throw new Error(NOT_REX);
  const p: Parsed = {
    headerSeen: false,
    channels: 1,
    bitDepth: 16,
    sampleRate: 44100,
    totalFrames: 0,
    loopStart: 0,
    loopEnd: 0,
    tempo: 120000,
    bars: 1,
    beats: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    sensitivity: 0,
    slices: [],
    sdat: null,
  };
  parseIff(bytes, 12, bytes.length, p);
  if (!p.headerSeen || p.sdat === null || p.sdat.size === 0) throw new Error(DAMAGED);
  if (p.totalFrames === 0 || p.totalFrames > MAX_FRAMES || p.sampleRate <= 0) throw new Error(DAMAGED);

  const pcm = decompress(bytes.subarray(p.sdat.offset, p.sdat.offset + p.sdat.size), p.totalFrames, p.channels, p.bitDepth);

  const hasLoop = p.loopEnd > p.loopStart && p.loopEnd <= p.totalFrames;
  const visible = visibleSlices(p);
  // The REX SDK plays the loop from its first slice when that starts before the loop start
  // (120Mono.rx2: loop start 14363, first slice 322), and from the loop start when it starts after.
  const loopStart = hasLoop ? Math.min(p.loopStart, visible[0]?.start ?? p.loopStart) : 0;
  const loopFrames = (hasLoop ? p.loopEnd : p.totalFrames) - loopStart;
  // Where the slices start, from the loop's start; a slice at its start when the first starts later.
  const starts = visible.map((s) => Math.max(0, s.start - loopStart)).filter((rel) => rel < loopFrames);
  if (starts[0] !== 0) starts.unshift(0);
  // The loop's length in quarter notes, from its bars and beats in its time signature.
  const num = p.timeSigNum > 0 ? p.timeSigNum : 4;
  const den = p.timeSigDen > 0 ? p.timeSigDen : 4;
  const beats = p.bars * num + p.beats > 0 ? p.bars * num + p.beats : 4;
  const quarters = (beats * 4) / den;
  const bars = Math.max(1, Math.ceil(quarters / 4 - 1e-9));
  // Padded at the loop's own tempo, so its bars keep the tempo it plays at.
  const frames = Math.max(loopFrames, Math.round((loopFrames * bars * 4) / quarters));

  const scale = p.bitDepth === 24 ? 8388608 : 32768;
  const channels = [new Float32Array(frames), new Float32Array(frames)] as const;
  for (let f = 0; f < loopFrames; f++) {
    const src = (loopStart + f) * p.channels;
    const l = pcm[src]! / scale;
    channels[0][f] = l;
    channels[1][f] = p.channels === 2 ? pcm[src + 1]! / scale : l;
  }

  return {
    sampleRate: p.sampleRate,
    previewBpm: p.tempo / 1000,
    bars,
    audio: { sampleRate: p.sampleRate, channels: [channels[0], channels[1]] },
    slices: starts.map((start) => start / frames),
  };
}
