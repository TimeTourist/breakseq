import { describe, expect, it } from 'vitest';
import { AudioFileError, decodeAudioFile, encodeWav } from './codec';

/** Builds a file from chunks: [id, bytes]. RIFF is little-endian, IFF (AIFF) big-endian. */
function container(kind: 'RIFF' | 'FORM', type: string, parts: readonly [string, Uint8Array][]): Uint8Array {
  const little = kind === 'RIFF';
  const body = parts.flatMap(([id, data]) => {
    const head = new Uint8Array(8);
    const view = new DataView(head.buffer);
    [...id].forEach((ch, i) => view.setUint8(i, ch.charCodeAt(0)));
    view.setUint32(4, data.length, little);
    return [head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0)];
  });
  const size = body.reduce((n, b) => n + b.length, 4);
  const out = new Uint8Array(8 + size);
  const view = new DataView(out.buffer);
  [...kind, ...type].forEach((ch, i) => view.setUint8(i < 4 ? i : i + 4, ch.charCodeAt(0)));
  view.setUint32(4, size, little);
  let at = 12;
  for (const b of body) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const bytes = (size: number, fill: (view: DataView) => void) => {
  const out = new Uint8Array(size);
  fill(new DataView(out.buffer));
  return out;
};

/** Interleaved frames of [left, right] (or [mono]) as integers or floats. */
function wav(format: 1 | 3, bits: number, sampleRate: number, frames: readonly (readonly number[])[]): Uint8Array {
  const channels = frames[0]!.length;
  const b = bits / 8;
  const fmt = bytes(16, (v) => {
    v.setUint16(0, format, true);
    v.setUint16(2, channels, true);
    v.setUint32(4, sampleRate, true);
    v.setUint32(8, sampleRate * channels * b, true);
    v.setUint16(12, channels * b, true);
    v.setUint16(14, bits, true);
  });
  const data = bytes(frames.length * channels * b, (v) => {
    frames.flat().forEach((x, i) => {
      const at = i * b;
      if (format === 3) v.setFloat32(at, x, true);
      else if (bits === 16) v.setInt16(at, x, true);
      else if (bits === 32) v.setInt32(at, x, true);
      else {
        v.setUint8(at, x & 0xff);
        v.setUint8(at + 1, (x >> 8) & 0xff);
        v.setInt8(at + 2, x >> 16);
      }
    });
  });
  return container('RIFF', 'WAVE', [['fmt ', fmt], ['data', data]]);
}

/** 44100 as an 80-bit extended float. */
const RATE_44100 = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];

function aiff(bits: 16 | 24, frames: readonly (readonly number[])[], compression?: 'NONE' | 'sowt'): Uint8Array {
  const channels = frames[0]!.length;
  const b = bits / 8;
  const little = compression === 'sowt';
  const comm = bytes(compression === undefined ? 18 : 22, (v) => {
    v.setUint16(0, channels);
    v.setUint32(2, frames.length);
    v.setUint16(6, bits);
    RATE_44100.forEach((x, i) => v.setUint8(8 + i, x));
    if (compression !== undefined) [...compression].forEach((ch, i) => v.setUint8(18 + i, ch.charCodeAt(0)));
  });
  const ssnd = bytes(8 + frames.length * channels * b, (v) => {
    frames.flat().forEach((x, i) => {
      const at = 8 + i * b;
      if (bits === 16) v.setInt16(at, x, little);
      else if (little) {
        v.setUint8(at, x & 0xff);
        v.setUint8(at + 1, (x >> 8) & 0xff);
        v.setInt8(at + 2, x >> 16);
      } else {
        v.setInt8(at, x >> 16);
        v.setUint8(at + 1, (x >> 8) & 0xff);
        v.setUint8(at + 2, x & 0xff);
      }
    });
  });
  return container('FORM', compression === undefined ? 'AIFF' : 'AIFC', [['COMM', comm], ['SSND', ssnd]]);
}

const channel = (data: { channels: readonly Float32Array[] }, c: number) => Array.from(data.channels[c]!);

describe('decodeAudioFile', () => {
  it('reads 16-bit stereo WAV', () => {
    const audio = decodeAudioFile(wav(1, 16, 48000, [[16384, -32768], [-16384, 32767]]));
    expect(audio.sampleRate).toBe(48000);
    expect(channel(audio, 0)).toEqual([0.5, -0.5]);
    expect(channel(audio, 1)[0]).toBe(-1);
    expect(channel(audio, 1)[1]).toBeCloseTo(1, 4);
  });

  it('reads 24-bit mono WAV', () => {
    const audio = decodeAudioFile(wav(1, 24, 44100, [[4194304], [-4194304], [-1]]));
    expect(audio.channels).toHaveLength(1);
    expect(channel(audio, 0)).toEqual([0.5, -0.5, -1 / 8388608]);
  });

  it('reads 32-bit integer and 32-bit float WAV', () => {
    expect(channel(decodeAudioFile(wav(1, 32, 44100, [[1073741824]])), 0)).toEqual([0.5]);
    expect(channel(decodeAudioFile(wav(3, 32, 44100, [[0.25, -0.75]])), 1)).toEqual([-0.75]);
  });

  it('reads 16- and 24-bit AIFF and AIFF-C sowt', () => {
    const a16 = decodeAudioFile(aiff(16, [[16384, -16384]]));
    expect(a16.sampleRate).toBe(44100);
    expect(channel(a16, 0)).toEqual([0.5]);
    expect(channel(a16, 1)).toEqual([-0.5]);
    expect(channel(decodeAudioFile(aiff(24, [[4194304], [-4194304]])), 0)).toEqual([0.5, -0.5]);
    expect(channel(decodeAudioFile(aiff(16, [[-16384]], 'sowt')), 0)).toEqual([-0.5]);
    expect(channel(decodeAudioFile(aiff(24, [[4194304]], 'sowt')), 0)).toEqual([0.5]);
  });

  it('gives an AudioFileError for broken and unknown files', () => {
    expect(() => decodeAudioFile(new Uint8Array(4))).toThrow(AudioFileError);
    expect(() => decodeAudioFile(new TextEncoder().encode('ID3 this is an mp3 file'))).toThrow(AudioFileError);
    expect(() => decodeAudioFile(container('RIFF', 'WAVE', [['data', new Uint8Array(4)]]))).toThrow(AudioFileError);
    const truncated = wav(1, 16, 44100, [[1, 2], [3, 4]]).slice(0, 40);
    expect(() => decodeAudioFile(truncated)).toThrow(AudioFileError);
  });
});

describe('encodeWav', () => {
  it('writes a 44.1 kHz, 24-bit stereo header and a normalized peak that decodes again', () => {
    const left = Float32Array.from([0, 0.25, -0.5]);
    const right = Float32Array.from([0.1, 0, 0]);
    const file = encodeWav({ sampleRate: 44100, channels: [left, right] });
    const view = new DataView(file.buffer);

    expect(String.fromCharCode(...file.slice(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(3 * 2 * 3);

    const back = decodeAudioFile(file);
    expect(back.sampleRate).toBe(44100);
    // Peak -0.5 becomes full scale; everything scales by 2.
    expect(channel(back, 0)[2]).toBeCloseTo(-1, 5);
    expect(channel(back, 0)[1]).toBeCloseTo(0.5, 5);
    expect(channel(back, 1)[0]).toBeCloseTo(0.2, 5);
  });

  it('writes mono as two equal channels and leaves silence silent', () => {
    const back = decodeAudioFile(encodeWav({ sampleRate: 44100, channels: [new Float32Array(4)] }));
    expect(back.channels).toHaveLength(2);
    expect(channel(back, 1)).toEqual([0, 0, 0, 0]);
  });
});
