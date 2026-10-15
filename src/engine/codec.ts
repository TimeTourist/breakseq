import type { AudioData } from '../model';

export class AudioFileError extends Error {
  override name = 'AudioFileError';
}

const ascii = (view: DataView, at: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)));

interface Chunk {
  readonly id: string;
  readonly start: number;
  readonly size: number;
}

/** The chunks of a RIFF or IFF file after its 12-byte header. Chunks are padded to even sizes. */
function chunks(view: DataView, littleEndian: boolean): Chunk[] {
  const found: Chunk[] = [];
  let at = 12;
  while (at + 8 <= view.byteLength) {
    const size = view.getUint32(at + 4, littleEndian);
    const start = at + 8;
    found.push({ id: ascii(view, at, 4), start, size: Math.min(size, view.byteLength - start) });
    at = start + size + (size % 2);
  }
  return found;
}

type SampleFormat = { readonly kind: 'int' | 'float'; readonly bits: number; readonly littleEndian: boolean };

function readSamples(
  view: DataView,
  start: number,
  byteLength: number,
  channelCount: number,
  format: SampleFormat,
): Float32Array[] {
  const bytes = format.bits / 8;
  const frames = Math.floor(byteLength / (bytes * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  const { littleEndian } = format;
  const read = (at: number): number => {
    if (format.kind === 'float') return format.bits === 32 ? view.getFloat32(at, littleEndian) : view.getFloat64(at, littleEndian);
    switch (format.bits) {
      case 8:
        // 8-bit WAV is unsigned; 8-bit AIFF is signed.
        return littleEndian ? (view.getUint8(at) - 128) / 128 : view.getInt8(at) / 128;
      case 16:
        return view.getInt16(at, littleEndian) / 32768;
      case 24: {
        const [b0, b1, b2] = littleEndian
          ? [view.getUint8(at), view.getUint8(at + 1), view.getInt8(at + 2)]
          : [view.getUint8(at + 2), view.getUint8(at + 1), view.getInt8(at)];
        return ((b2 << 16) | (b1 << 8) | b0) / 8388608;
      }
      case 32:
        return view.getInt32(at, littleEndian) / 2147483648;
    }
    throw new AudioFileError(`Unsupported bit depth: ${format.bits}`);
  };
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channelCount; c++) {
      channels[c]![frame] = read(start + (frame * channelCount + c) * bytes);
    }
  }
  return channels;
}

function decodeWav(view: DataView): AudioData {
  const all = chunks(view, true);
  const fmt = all.find((c) => c.id === 'fmt ');
  const data = all.find((c) => c.id === 'data');
  if (fmt === undefined || data === undefined || fmt.size < 16) throw new AudioFileError('The WAV file has no fmt or data chunk');

  let tag = view.getUint16(fmt.start, true);
  const channelCount = view.getUint16(fmt.start + 2, true);
  const sampleRate = view.getUint32(fmt.start + 4, true);
  const bits = view.getUint16(fmt.start + 14, true);
  // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its sub-format GUID.
  if (tag === 0xfffe && fmt.size >= 26) tag = view.getUint16(fmt.start + 24, true);

  const kind = tag === 1 ? 'int' : tag === 3 ? 'float' : null;
  if (kind === null) throw new AudioFileError(`Unsupported WAV format ${tag}; use PCM or float`);
  if (kind === 'int' && ![8, 16, 24, 32].includes(bits)) throw new AudioFileError(`Unsupported bit depth: ${bits}`);
  if (kind === 'float' && ![32, 64].includes(bits)) throw new AudioFileError(`Unsupported float bit depth: ${bits}`);
  if (channelCount < 1 || sampleRate < 1) throw new AudioFileError('The WAV file has no channels or sample rate');

  return { sampleRate, channels: readSamples(view, data.start, data.size, channelCount, { kind, bits, littleEndian: true }) };
}

/** An 80-bit IEEE 754 extended float, as AIFF stores its sample rate. */
function extended(view: DataView, at: number): number {
  const exponent = view.getUint16(at) & 0x7fff;
  const sign = view.getUint16(at) & 0x8000 ? -1 : 1;
  const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6);
  return mantissa === 0 && exponent === 0 ? 0 : sign * mantissa * 2 ** (exponent - 16383 - 63);
}

function decodeAiff(view: DataView, isAifc: boolean): AudioData {
  const all = chunks(view, false);
  const comm = all.find((c) => c.id === 'COMM');
  const ssnd = all.find((c) => c.id === 'SSND');
  if (comm === undefined || ssnd === undefined || comm.size < 18) throw new AudioFileError('The AIFF file has no COMM or SSND chunk');

  const channelCount = view.getUint16(comm.start);
  const frames = view.getUint32(comm.start + 2);
  const bits = view.getUint16(comm.start + 6);
  const sampleRate = Math.round(extended(view, comm.start + 8));
  const compression = isAifc && comm.size >= 22 ? ascii(view, comm.start + 18, 4) : 'NONE';
  if (compression !== 'NONE' && compression !== 'sowt') throw new AudioFileError(`Unsupported AIFF-C compression: ${compression}`);
  if (![8, 16, 24, 32].includes(bits)) throw new AudioFileError(`Unsupported bit depth: ${bits}`);
  if (channelCount < 1 || sampleRate < 1) throw new AudioFileError('The AIFF file has no channels or sample rate');

  const offset = view.getUint32(ssnd.start);
  const start = ssnd.start + 8 + offset;
  const byteLength = Math.min(ssnd.size - 8 - offset, frames * channelCount * (bits / 8));
  const format = { kind: 'int' as const, bits, littleEndian: compression === 'sowt' };
  return { sampleRate, channels: readSamples(view, start, Math.max(0, byteLength), channelCount, format) };
}

/** Decodes a WAV or AIFF file. Throws AudioFileError for anything else. */
export function decodeAudioFile(bytes: ArrayBuffer | Uint8Array): AudioData {
  const view =
    bytes instanceof Uint8Array ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
  if (view.byteLength < 12) throw new AudioFileError('The file is too short to be audio');
  const container = ascii(view, 0, 4);
  const type = ascii(view, 8, 4);
  if (container === 'RIFF' && type === 'WAVE') return decodeWav(view);
  if (container === 'FORM' && (type === 'AIFF' || type === 'AIFC')) return decodeAiff(view, type === 'AIFC');
  throw new AudioFileError('Not a WAV or AIFF file');
}

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_BITS = 24;

/** Exports are normalized so the peak is at −0.3 dBFS. */
export const NORMALIZE_PEAK = 10 ** (-0.3 / 20);

/** Encodes stereo 24-bit PCM WAV, normalized so the peak is NORMALIZE_PEAK. Silence stays silent. */
export function encodeWav(audio: AudioData): Uint8Array {
  const channels = audio.channels.length === 1 ? [audio.channels[0]!, audio.channels[0]!] : audio.channels.slice(0, 2);
  if (channels.length !== 2) throw new AudioFileError('Nothing to export');
  const frames = channels[0]!.length;
  let peak = 0;
  for (const channel of channels) for (const v of channel) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? NORMALIZE_PEAK / peak : 1;

  const bytes = EXPORT_BITS / 8;
  const dataSize = frames * 2 * bytes;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true);
  view.setUint16(34, EXPORT_BITS, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);

  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const v = Math.max(-8388608, Math.min(8388607, Math.round(channel[frame]! * gain * 8388607)));
      view.setUint8(at, v & 0xff);
      view.setUint8(at + 1, (v >> 8) & 0xff);
      view.setUint8(at + 2, (v >> 16) & 0xff);
      at += 3;
    }
  }
  return out;
}

/** Encodes 32-bit float WAV with every channel as it is: lossless, for project files. */
export function encodeFloatWav(audio: AudioData): Uint8Array {
  const channelCount = audio.channels.length;
  const frames = audio.channels[0]?.length ?? 0;
  const dataSize = frames * channelCount * 4;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * 4, true);
  view.setUint16(32, channelCount * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of audio.channels) {
      view.setFloat32(at, channel[frame]!, true);
      at += 4;
    }
  }
  return out;
}

/**
 * Cue markers in a WAV file, in seconds from its start, sorted. An empty list for
 * files without a `cue ` chunk, and for AIFF.
 */
export function readCues(bytes: ArrayBuffer | Uint8Array): number[] {
  const view =
    bytes instanceof Uint8Array ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
  if (view.byteLength < 12 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return [];
  const all = chunks(view, true);
  const fmt = all.find((c) => c.id === 'fmt ');
  const cue = all.find((c) => c.id === 'cue ');
  if (fmt === undefined || cue === undefined || cue.size < 4) return [];
  const sampleRate = view.getUint32(fmt.start + 4, true);
  const count = view.getUint32(cue.start, true);
  const cues = new Set<number>();
  for (let i = 0; i < count && cue.start + 4 + (i + 1) * 24 <= cue.start + cue.size; i++) {
    // Each cue point: id, position, chunk id, chunk start, block start, sample offset.
    cues.add(view.getUint32(cue.start + 4 + i * 24 + 20, true) / sampleRate);
  }
  return [...cues].sort((a, b) => a - b);
}
