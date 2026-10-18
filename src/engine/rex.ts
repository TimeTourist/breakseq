/**
 * Writes REX2 files (.rx2), the sliced loops Reason's Dr. Octo Rex plays: the
 * slices laid one after another in one stereo waveform, each a slice that MIDI
 * note C1 and up plays. A port of the writing half of VelociLoops
 * (https://github.com/kunitoki/VelociLoops, Unlicense), byte for byte: its
 * DWOP compressor and the chunks it writes, with its defaults.
 */

/** A REX file to write: 24-bit stereo, the slices in order, each [left, right]. */
export interface RexLoop {
  readonly sampleRate: number;
  readonly bpm: number;
  readonly slices: readonly (readonly [Float32Array, Float32Array])[];
}

/** Bits into big-endian 32-bit words, as DWOP reads them. */
class BitWriter {
  private readonly bytes: number[] = [];
  private word = 0;
  private count = 0;

  bit(on: boolean): void {
    if (on) this.word = (this.word | (1 << (31 - this.count))) >>> 0;
    if (++this.count === 32) this.flush();
  }

  bits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit(((value >>> i) & 1) !== 0);
  }

  finish(): number[] {
    if (this.count > 0) this.flush();
    return this.bytes;
  }

  private flush(): void {
    this.bytes.push((this.word >>> 24) & 0xff, (this.word >>> 16) & 0xff, (this.word >>> 8) & 0xff, this.word & 0xff);
    this.word = 0;
    this.count = 0;
  }
}

/** One channel's predictor state: deltas (int32), averages (uint32), and the Rice-like coder's j and rbits. */
interface Channel {
  readonly d: Int32Array;
  readonly a: Uint32Array;
  j: number;
  rbits: number;
}

const channel = (): Channel => ({ d: new Int32Array(5), a: new Uint32Array(5).fill(2560), j: 2, rbits: 0 });

const toCodeValue = (signed2x: number): number => (signed2x >= 0 ? signed2x : -signed2x - 1) >>> 0;

/** Shared with the reader (rex-read.ts). */
export function minAverageIndex(a: Uint32Array): number {
  let idx = 0;
  for (let i = 1; i < 5; i++) if (a[i]! < a[idx]!) idx = i;
  return idx;
}

function predictorResidual(idx: number, s: number, d: Int32Array): number {
  let r = s;
  for (let i = 0; i < idx; i++) r = (r - d[i]!) | 0;
  return r;
}

function applyPredictor(idx: number, s: number, d: Int32Array): void {
  const [d0, d1, d2, d3] = [d[0]!, d[1]!, d[2]!, d[3]!];
  switch (idx) {
    case 0: {
      const t0 = (s - d0) | 0;
      const t1 = (t0 - d1) | 0;
      const t2 = (t1 - d2) | 0;
      d.set([s, t0, t1, t2, (t2 - d3) | 0]);
      return;
    }
    case 1: {
      const t1 = (s - d1) | 0;
      const t2 = (t1 - d2) | 0;
      d.set([(d0 + s) | 0, s, t1, t2, (t2 - d3) | 0]);
      return;
    }
    case 2: {
      const nd1 = (d1 + s) | 0;
      const t = (s - d2) | 0;
      d.set([(d0 + nd1) | 0, nd1, s, t, (t - d3) | 0]);
      return;
    }
    case 3: {
      const nd2 = (d2 + s) | 0;
      const nd1 = (d1 + nd2) | 0;
      d.set([(d0 + nd1) | 0, nd1, nd2, s, (s - d3) | 0]);
      return;
    }
    default: {
      const nd3 = (d3 + s) | 0;
      const nd2 = (d2 + nd3) | 0;
      const nd1 = (d1 + nd2) | 0;
      d.set([(d0 + nd1) | 0, nd1, nd2, nd3, s]);
    }
  }
}

/** Shared with the reader (rex-read.ts). */
export function updateAverages(a: Uint32Array, d: Int32Array): void {
  for (let i = 0; i < 5; i++) {
    const v = d[i]!;
    a[i] = (a[i]! + ((v ^ (v >> 31)) >>> 0) - (a[i]! >>> 5)) >>> 0;
  }
}

/** j and rbits moved to suit `step`; returned rather than changed in place. */
export function adjustJRbits(step: number, j: number, rbits: number): [number, number] {
  if (step < j) {
    for (let jt = j >>> 1; step < jt; jt >>>= 1) {
      j = jt;
      rbits--;
    }
    return [j, rbits];
  }
  while (step >= j) {
    const prev = j;
    j = (j << 1) >>> 0;
    rbits++;
    if (j <= prev) {
      j = prev;
      break;
    }
  }
  return [j, rbits];
}

/** The remainder's bits, and an extra bit when the value is folded; null when it does not fit. */
function encodeRemainder(raw: number, step: number, j: number, rbits: number): { rem: number; extra: boolean | null } | null {
  if (rbits < 0 || rbits > 31) return null;
  const limit = rbits === 31 ? 0x80000000 : 2 ** rbits;
  const thresh = j - step;
  if (thresh < 0) return null;
  if (raw < thresh) return raw >= limit ? null : { rem: raw, extra: null };
  const folded = (raw + thresh) >>> 0;
  const rem = folded >>> 1;
  return rem >= thresh && rem < limit ? { rem, extra: (folded & 1) !== 0 } : null;
}

function writeCodeValue(code: number, baseStep: number, c: Channel, out: BitWriter): void {
  let prefixSum = 0;
  let step = baseStep;
  let zerosWin = 7;
  for (let zeros = 0; zeros < 0x100000; zeros++) {
    if (code >= prefixSum) {
      const [j, rbits] = adjustJRbits(step, c.j, c.rbits);
      const r = encodeRemainder(code - prefixSum, step, j, rbits);
      if (r !== null) {
        for (let i = 0; i < zeros; i++) out.bit(false);
        out.bit(true);
        if (rbits > 0) out.bits(r.rem, rbits);
        if (r.extra !== null) out.bit(r.extra);
        c.j = j;
        c.rbits = rbits;
        return;
      }
    }
    if (baseStep === 0) break;
    if (0xffffffff - prefixSum < step) break;
    prefixSum += step;
    if (prefixSum > code && step !== 0) break;
    if (--zerosWin === 0) {
      step = (step << 2) >>> 0;
      zerosWin = 7;
    }
  }
  out.bit(true);
}

function encodeSample(sample2x: number, c: Channel, out: BitWriter): void {
  const idx = minAverageIndex(c.a);
  const baseStep = ((c.a[idx]! * 3 + 36) >>> 0) >>> 7;
  const residual = predictorResidual(idx, sample2x, c.d);
  writeCodeValue(toCodeValue(residual), baseStep, c, out);
  applyPredictor(idx, residual, c.d);
  updateAverages(c.a, c.d);
}

/** DWOP, stereo: the left channel, then the right as its difference from the left. */
function compressStereo(left: Int32Array, right: Int32Array): number[] {
  const out = new BitWriter();
  const l = channel();
  const r = channel();
  for (let f = 0; f < left.length; f++) {
    const left2x = (left[f]! * 2) | 0;
    encodeSample(left2x, l, out);
    encodeSample((((right[f]! * 2) | 0) - left2x) | 0, r, out);
  }
  return out.finish();
}

/** A sample as 24-bit PCM, as VelociLoops rounds it (in 32-bit floats). */
function pcm24(s: number): number {
  const v = Math.fround(Math.min(1, Math.max(-1, Math.fround(s))));
  const scaled = Math.fround(v * (v >= 0 ? 8388607 : 8388608));
  // lround: halves away from zero.
  return scaled >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
}

/** IFF chunks, big-endian, padded to even sizes. */
class IffWriter {
  readonly data: number[] = [];

  chunk(id: string, body: () => void): void {
    const start = this.data.length;
    this.ascii(id);
    this.u32(0);
    body();
    const size = this.data.length - start - 8;
    this.data.splice(start + 4, 4, (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff);
    if (this.data.length & 1) this.data.push(0);
  }

  cat(type: string, body: () => void): void {
    this.chunk('CAT ', () => {
      this.ascii(type);
      body();
    });
  }

  ascii(s: string): void {
    for (const ch of s) this.data.push(ch.charCodeAt(0));
  }

  u8(v: number): void {
    this.data.push(v & 0xff);
  }

  u16(v: number): void {
    this.data.push((v >>> 8) & 0xff, v & 0xff);
  }

  u32(v: number): void {
    this.data.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  bytes(b: readonly number[]): void {
    for (const x of b) this.data.push(x);
  }
}

/**
 * A REX2 file of the slices, 24-bit stereo, at `bpm`. REX keeps a loop's length
 * in whole beats, so the last slice is padded with silence to the next beat;
 * every slice then starts in the loop where its audio starts.
 */
export function encodeRex({ sampleRate, bpm, slices }: RexLoop): Uint8Array {
  if (slices.length === 0) throw new Error('A REX file needs a slice');
  const framesPerBeat = (60 * sampleRate) / bpm;
  const sound = slices.reduce((n, [l]) => n + l.length, 0);
  const beats = Math.max(1, Math.ceil(sound / framesPerBeat - 1e-9));
  const total = Math.round(beats * framesPerBeat);
  const left = new Int32Array(total);
  const right = new Int32Array(total);
  const starts: number[] = [];
  let at = 0;
  for (const [l, r] of slices) {
    starts.push(at);
    for (let f = 0; f < l.length; f++) {
      left[at + f] = pcm24(l[f]!);
      right[at + f] = pcm24(r[f]!);
    }
    at += l.length;
  }
  const lengths = slices.map(([l], i) => (i === slices.length - 1 ? total - starts[i]! : l.length));
  const tempo = Math.round(bpm * 1000);
  const sdat = compressStereo(left, right);

  const w = new IffWriter();
  w.cat('REX2', () => {
    w.chunk('HEAD', () => w.bytes([0x49, 0x0c, 0xf1, 0x8d, 0xbc, 0x02, ...new Array<number>(23).fill(0)]));
    w.chunk('GLOB', () => {
      w.u32(slices.length);
      w.u16(Math.floor(beats / 4));
      w.u8(beats % 4);
      w.u8(4);
      w.u8(4);
      w.u8(99); // analysis sensitivity
      w.u16(1); // gate sensitivity
      w.u16(1000); // processing gain
      w.u16(1);
      w.u32(tempo);
      w.u8(1);
      w.u8(0); // silence selected
    });
    w.chunk('RECY', () => {
      w.bytes([0xbc, 0x02, 0, 0, 0, 1, 0]);
      w.u32(total * 2 * 3);
      w.u32(slices.length);
    });
    w.cat('DEVL', () => {
      w.chunk('TRSH', () => {
        w.u8(1); // transients on
        w.u16(0); // attack
        w.u16(1023); // decay
        w.u16(0); // stretch
      });
      w.chunk('EQ  ', () => w.bytes([0x00, 0x00, 0x0f, 0x00, 0x64, 0x00, 0x00, 0x03, 0xe8, 0x09, 0xc4, 0x00, 0x00, 0x03, 0xe8, 0x4e, 0x20]));
      w.chunk('COMP', () => w.bytes([0x00, 0x00, 0x4d, 0x00, 0x27, 0x00, 0x42, 0x00, 0x38]));
    });
    w.cat('SLCL', () => {
      starts.forEach((start, i) =>
        w.chunk('SLCE', () => {
          w.u32(start);
          w.u32(Math.max(1, lengths[i]!));
          w.u16(0x7fff); // analysis points
          w.u8(0); // flags
        }),
      );
    });
    w.chunk('SINF', () => {
      w.u8(2);
      w.u8(5); // 24-bit
      w.u32(sampleRate);
      w.u32(total);
      w.u32(0);
      w.u32(total);
    });
    w.chunk('SDAT', () => w.bytes(sdat));
  });
  return Uint8Array.from(w.data);
}
