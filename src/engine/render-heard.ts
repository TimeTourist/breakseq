import type { Take } from './generate';
import type { Mix } from './render';
import { CHOKE_FADE, scheduleTape } from './render';
import { applySplices } from './render-audio-mods';
import type { RenderCache } from './render-chunks';
import { keepChunk, remember } from './render-chunks';
import type { Tape } from './tape';

/**
 * What is heard, finished: what the triggers play with reverb and delay goes
 * in, then tapes play over it, then the audio mods (see Mods som samplar det
 * som hörs). A tape records what is heard in its segment, reverb and delay
 * too; the audio mods sample what is heard with the tapes. Neither ever hears
 * itself or an audio mod.
 */

/** A hash of audio: tapes are kept by what they recorded. */
function audioHash(channels: readonly Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const data of channels) {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i]!, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + channels.map((c) => c.length).join(',');
}

/** A tape played from the song's start, as long as it lasts: what it recorded from `heard`, round and round. */
async function playTape(tape: Tape, heard: readonly Float32Array[], sampleRate: number, total: number, cache: RenderCache | undefined): Promise<Float32Array[]> {
  const from = Math.max(0, Math.round(tape.start * sampleRate));
  const length = Math.max(1, Math.round(tape.length * sampleRate));
  const recorded = heard.map((data) => {
    const part = new Float32Array(length);
    part.set(data.subarray(from, Math.min(data.length, from + length)));
    return part;
  });
  // The tape's speed is automation sampled once per render quantum: from the song's start, it is sampled as in one long render.
  const frames = Math.max(1, Math.min(total, Math.ceil(tape.end * sampleRate) + 1));
  const key = `tape|${sampleRate}|${frames}|${JSON.stringify(tape)}|${audioHash(recorded)}`;
  const kept = cache === undefined ? undefined : remember(cache.chunks, key);
  if (kept !== undefined) return [...kept.dry];
  const recording = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  recorded.forEach((data, c) => recording.copyToChannel(data as Float32Array<ArrayBuffer>, Math.min(1, c)));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate });
  scheduleTape(context, tape, recording);
  const rendered = await context.startRendering();
  // Copies: in Node a view does not keep its buffer alive (see renderChunk).
  const dry = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  if (cache !== undefined) keepChunk(cache, key, { dry, sends: new Map(), size: 2 * frames });
  return dry;
}

/**
 * How much of what is heard is left over a tape: none under it, faded out over
 * CHOKE_FADE where it starts (the tape cuts the voice before it) and in again
 * over the tape's own fade out at its end.
 */
function tapeMask(tape: Tape, f: number, sampleRate: number): number {
  const t = f / sampleRate;
  if (t < tape.time || t >= tape.end) return 1;
  const down = Math.max(0, 1 - (t - tape.time) / CHOKE_FADE);
  const up = Math.max(0, 1 - (tape.end - t) / CHOKE_FADE);
  return Math.min(1, down + up);
}

/**
 * Plays the take's tapes and splices over `heard` (the triggers' sound with
 * reverb and delay, for the mix asked for). In the mix of only reverb and
 * delay a tape leaves silence: a MIDI export has the tape as a piece of its
 * own, cut from the song.
 */
export async function finishHeard(
  heard: readonly Float32Array[],
  take: Pick<Take, 'tapes' | 'splices'>,
  sampleRate: number,
  mix: Mix,
  cache?: RenderCache,
): Promise<Float32Array[]> {
  let out = heard.map((c) => c.slice());
  const total = out[0]?.length ?? 0;
  for (const tape of take.tapes) {
    const played = mix === 'space' ? null : await playTape(tape, heard, sampleRate, total, cache);
    const first = Math.max(0, Math.floor(tape.time * sampleRate));
    const last = Math.min(total, Math.ceil(tape.end * sampleRate) + 1);
    out = out.map((data, c) => {
      for (let f = first; f < last; f++) data[f] = data[f]! * tapeMask(tape, f, sampleRate) + (played?.[c]?.[f] ?? 0);
      return data;
    });
  }
  return take.splices === undefined || take.splices.length === 0 ? out : applySplices(out, take.splices, sampleRate);
}
