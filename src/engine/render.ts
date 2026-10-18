import type { AudioData, DelayPlay, Direction, Hit, Project, Sample } from '../model';
import { effectiveHit, hitColour, hitSound, hitSpace, hitStretch, sampleAudio, songDuration, stepDuration } from '../model';
import { panGains } from './colour';
import { distort, filterSettings, levelMatch, rms } from './colour';
import type { Take, Trigger } from './generate';
import { playedStretch } from './generate';
import { grainCurve, grainPlan } from './stretch';
import type { Tape } from './tape';
import { speedCurve, tapePasses } from './tape';

/** Seconds a choked voice takes to fade out when the next trigger starts. */
export const CHOKE_FADE = 0.003;

const dbToGain = (db: number) => 10 ** (db / 20);

/** The sample's own audio as a buffer, reversed for 'reverse'. */
function sampleBuffer(context: BaseAudioContext, sample: Sample, audio: AudioData, direction: Direction): AudioBuffer {
  // Both ends are rounded, so neighbouring slices share their boundary frame exactly.
  const from = Math.round(sample.offset * audio.sampleRate);
  const length = Math.max(1, Math.round((sample.offset + sample.duration) * audio.sampleRate) - from);
  const buffer = context.createBuffer(audio.channels.length, length, audio.sampleRate);
  audio.channels.forEach((channel, i) => {
    const data = channel.slice(from, from + length);
    if (direction === 'reverse') data.reverse();
    buffer.copyToChannel(data, i);
  });
  return buffer;
}

/** What one voice plays: a hit with its final settings, as a trigger carries them. */
export type HitPlay = Pick<Trigger, 'hitId' | 'pitch' | 'volume' | 'pan' | 'direction' | 'region' | 'stretch' | 'dist' | 'filter' | 'reverb' | 'delay'>;

/** A voice that has been scheduled: stop() silences it at once. */
export interface Voice {
  readonly stop: () => void;
}

/** Sample buffers made on one context, per sample and direction. */
export type BufferCache = Map<string, AudioBuffer>;

/** A hit played as it is, with no mods: its own settings plus those of its pad and matrix layers. */
export function hitPlay(project: Project, hit: Hit): HitPlay {
  const own = effectiveHit(project, hit);
  return {
    hitId: own.id,
    pitch: own.pitch,
    volume: own.volume,
    pan: Math.max(-1, Math.min(1, own.pan)),
    direction: own.direction,
    region: hitSound(project, hit)?.region ?? { start: 0, end: 0 },
    stretch: playedStretch(hitStretch(project, hit), null),
    ...hitColour(project, hit),
    ...hitSpace(project, hit),
  };
}

/**
 * Where a voice goes: `dry` hears it as it is (null: not at all), and `space`
 * takes what it sends to the reverb and delay (null: nothing is sent).
 */
export interface Route {
  readonly dry: AudioNode | null;
  readonly space: Space | null;
}

/**
 * Schedules one voice on any context, offline or live: region, direction,
 * pitch as playback rate, stretch as grains, volume and fade out. If `chokeAt`
 * comes before the voice ends, it fades out from there over CHOKE_FADE. What it
 * sends to the reverb and delay is the voice as heard, cut where it is cut; the
 * reverb and delay ring on.
 */
export function scheduleHit(
  context: BaseAudioContext,
  cache: BufferCache,
  project: Project,
  play: HitPlay,
  start: number,
  chokeAt = Infinity,
  route: Route = { dry: context.destination, space: null },
): Voice | null {
  const hit = project.hits[play.hitId];
  const sample = hit === undefined ? undefined : hitSound(project, hit)?.sample;
  // The sample's channel choice: always stereo.
  const audio = sample === undefined ? undefined : sampleAudio(project, sample);
  if (hit === undefined || sample === undefined || audio === undefined) return null;

  // Backwards buffers are worked out once per sample, and distorted ones once per dist.
  const key = `${sample.id}:${sample.channel}:${play.direction}`;
  let clean = cache.get(key);
  if (clean === undefined) {
    clean = sampleBuffer(context, sample, audio, play.direction);
    cache.set(key, clean);
  }
  let buffer = clean;
  if (play.dist !== null) {
    const distKey = `${key}:${play.dist.mode}:${play.dist.amount.toFixed(4)}`;
    let distorted = cache.get(distKey);
    if (distorted === undefined) {
      const source = clean;
      distorted = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
      for (let c = 0; c < source.numberOfChannels; c++) distorted.copyToChannel(distort(source.getChannelData(c), play.dist), c);
      cache.set(distKey, distorted);
    }
    buffer = distorted;
  }

  // In a reversed buffer the region is mirrored. It starts on a whole frame, so
  // slices of one sample played one after another give back the sample exactly.
  const region =
    play.direction === 'forward'
      ? play.region
      : { start: sample.duration - play.region.end, end: sample.duration - play.region.start };
  const onFrame = (t: number) => Math.round(t * buffer.sampleRate) / buffer.sampleRate;
  const offset = onFrame(region.start);
  const rate = 2 ** (play.pitch / 12);
  // A stretched voice is grains; the grid from the break starts at the sample's start (its end, backwards).
  const plan =
    play.stretch === null
      ? null
      : grainPlan({
          start: offset,
          end: onFrame(region.end),
          rate,
          factor: play.stretch.factor,
          grain: play.stretch.grain / 1000,
          origin: play.stretch.from === 'sample' ? 0 : offset,
          // From the hit, grains stay within it; from the sample, they may read on into the next slice.
          limit: play.stretch.from === 'sample' ? buffer.duration : onFrame(region.end),
        });
  // It ends on a whole frame too: the buffer goes on past the slice, into the next one.
  const naturalEnd = start + (plan === null ? Math.max(0, onFrame(region.end) - offset) / rate : plan.length);
  // A next trigger within a frame of the end is not a choke: the voice ends there, without a fade.
  const choked = chokeAt < naturalEnd - 1.5 / context.sampleRate;

  // Dist keeps the level: the region played has the same RMS after it as before.
  const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const frameOf = (t: number) => Math.round(t * buffer.sampleRate);
  const distGain =
    buffer === clean ? 1 : levelMatch(rms(channelsOf(clean), frameOf(offset), frameOf(region.end)), rms(channelsOf(buffer), frameOf(offset), frameOf(region.end)));
  const filter = play.filter === null ? null : filterSettings(play.filter, context.sampleRate);
  const level = dbToGain(play.volume) * distGain * (filter?.gain ?? 1);
  // The pad's or matrix's fade applies where the hit has none.
  const fadeOut = effectiveHit(project, hit).fadeOut / 1000;
  const fadeStart = fadeOut > 0 ? Math.max(start, naturalEnd - fadeOut) : naturalEnd;
  const levelAt = (t: number) => (t <= fadeStart ? level : (level * (naturalEnd - t)) / (naturalEnd - fadeStart));

  const gain = context.createGain();
  gain.gain.setValueAtTime(level, start);
  if (choked) {
    if (fadeStart < chokeAt) {
      gain.gain.setValueAtTime(level, fadeStart);
      gain.gain.linearRampToValueAtTime(levelAt(chokeAt), chokeAt);
    } else {
      gain.gain.setValueAtTime(level, chokeAt);
    }
    gain.gain.linearRampToValueAtTime(0, chokeAt + CHOKE_FADE);
  } else if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, fadeStart);
    gain.gain.linearRampToValueAtTime(0, naturalEnd);
  }

  // Pan is balance with equal power: the middle as without pan, and towards one
  // side the other channel fades to nothing while this one rises up to 3 dB.
  let out: AudioNode = gain;
  if (play.pan !== 0) {
    const { left, right } = panGains(play.pan);
    const split = context.createChannelSplitter(2);
    const merge = context.createChannelMerger(2);
    const l = context.createGain();
    const r = context.createGain();
    l.gain.value = left;
    r.gain.value = right;
    gain.connect(split);
    split.connect(l, 0).connect(merge, 0, 0);
    split.connect(r, 1).connect(merge, 0, 1);
    out = merge;
  }
  if (route.dry !== null) out.connect(route.dry);
  const send = (amount: number, into: AudioNode) => {
    const level = context.createGain();
    level.gain.value = amount;
    out.connect(level).connect(into);
  };
  if (route.space !== null && play.reverb !== null) send(play.reverb.amount, route.space.reverb(play.reverb.size));
  if (route.space !== null && play.delay !== null) send(play.delay.amount, route.space.delay(play.delay));
  // Dist is in the buffer; the filter comes after it, before the voice's level.
  let input: AudioNode = gain;
  if (filter !== null) {
    const biquad = context.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.value = filter.frequency;
    biquad.Q.value = filter.q;
    biquad.connect(gain);
    input = biquad;
  }
  // Half a frame early, so the frame where the next sound starts is not played as well.
  const stopAt = choked ? chokeAt + CHOKE_FADE : Math.min(naturalEnd, chokeAt) - 0.5 / context.sampleRate;
  const sources: AudioBufferSourceNode[] = [];
  const voice = (at: number, from: number, until: number, into: AudioNode) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(into);
    source.start(at, from);
    source.stop(until);
    sources.push(source);
  };

  if (plan === null) {
    voice(start, offset, stopAt, input);
  } else {
    for (const g of plan.grains) {
      // A grain under way when the voice starts, or reaching before the sample, plays from where it can.
      const skip = Math.max(0, -g.at, -g.from / rate);
      const at = start + g.at + skip;
      const until = Math.min(start + g.at + g.length, stopAt);
      if (skip >= g.length || at >= until) continue;
      const envelope = context.createGain();
      envelope.gain.setValueCurveAtTime(grainCurve(g.shape, skip / g.length), at, start + g.at + g.length - at);
      envelope.connect(input);
      voice(at, g.from + skip * rate, until, envelope);
    }
  }
  return {
    stop: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
    },
  };
}

/** Plays triggers on a context, one voice: each trigger is cut where the next sound starts. */
function scheduleTriggers(
  context: BaseAudioContext,
  project: Project,
  triggers: readonly Trigger[],
  cuts: readonly number[],
  sampleRate: number,
  route: Route = { dry: context.destination, space: null },
) {
  const cache: BufferCache = new Map();
  const sorted = [...triggers].sort((a, b) => a.time - b.time);
  // Starts are placed on whole sample frames. Between frames Web Audio interpolates,
  // which dulls a slice by a varying amount; on a frame a slice plays back bit for bit.
  const onFrame = (time: number) => Math.round(time * sampleRate) / sampleRate;
  const starts = [...sorted.map((t) => onFrame(t.time)), ...cuts.map(onFrame)].sort((a, b) => a - b);
  sorted.forEach((trigger) => {
    const start = onFrame(trigger.time);
    const next = starts.find((s) => s > start);
    scheduleHit(context, cache, project, trigger, start, next ?? Infinity, route);
  });
}

/** Renders triggers alone into a buffer of `duration` seconds. */
async function renderPart(triggers: readonly Trigger[], project: Project, duration: number, sampleRate: number, cutAt: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  // The recording ends at the segment's end: what still rings is cut there.
  scheduleTriggers(context, project, triggers, [cutAt], sampleRate);
  return context.startRendering();
}

const reversed = (context: BaseAudioContext, buffer: AudioBuffer): AudioBuffer => {
  const copy = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let i = 0; i < buffer.numberOfChannels; i++) copy.copyToChannel(buffer.getChannelData(i).slice().reverse(), i);
  return copy;
};

/**
 * Plays a tape: its recording round and round as its passes say, with the
 * speed ramping as playback rate, so pitch and length follow like tape. It
 * fades out over CHOKE_FADE at its end.
 */
function scheduleTape(context: BaseAudioContext, tape: Tape, recording: AudioBuffer) {
  const backwards = reversed(context, recording);
  const gain = context.createGain();
  gain.gain.setValueAtTime(1, tape.time);
  gain.gain.setValueAtTime(1, Math.max(tape.time, tape.end - CHOKE_FADE));
  gain.gain.linearRampToValueAtTime(0, tape.end);
  gain.connect(context.destination);
  // Like tape, it gets quieter as it slows below 1×, so at 0× it is silent: a
  // stopped buffer would otherwise hold its last sample.
  const level = context.createGain();
  level.gain.setValueCurveAtTime(speedCurve(tape, tape.time, tape.end).map((s) => Math.min(1, s)), tape.time, tape.end - tape.time);
  level.connect(gain);
  for (const pass of tapePasses(tape)) {
    if (pass.end - pass.time <= 0) continue;
    const source = context.createBufferSource();
    source.buffer = pass.direction === 'forward' ? recording : backwards;
    source.playbackRate.setValueCurveAtTime(speedCurve(tape, pass.time, pass.end), pass.time, pass.end - pass.time);
    source.connect(level);
    // A backwards pass plays the reversed recording, so both start `from` into their buffer.
    source.start(pass.time, pass.from);
    source.stop(pass.end);
  }
}

/** What a render has in it: everything, the hits alone, or only the reverb and delay. */
export type Mix = 'all' | 'dry' | 'space';

/** A take as audio: `full` as long as it rings, and `buffer` exactly as long as asked, what rings past the end added from its start. */
export interface Rendered {
  /** Ready to loop: what rings past the end comes in at the start, as it would on the next time round. */
  readonly buffer: AudioBuffer;
  /** From the start for as long as anything rings: the song and then its reverb and delay dying away. */
  readonly full: AudioBuffer;
}

/**
 * Renders a take to audio offline. One voice: a new trigger or tape cuts the
 * sound before it with a short fade. Beside it the reverb and delay ring out.
 * Tapes record the hits alone.
 */
export async function renderTakeWithTail(
  take: Take,
  project: Project,
  sampleRate: number,
  seconds = songDuration(project.song),
  mix: Mix = 'all',
): Promise<Rendered> {
  const recordings = await Promise.all(take.tapes.map((tape) => renderPart(tape.source, project, tape.length, sampleRate, tape.length)));
  const ring = mix === 'dry' ? 0 : spaceRing(take.triggers, project.song.bpm);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: length + Math.round(ring * sampleRate), sampleRate });
  const route: Route = { dry: mix === 'space' ? null : context.destination, space: mix === 'dry' ? null : createSpace(context, context.destination, project.song.bpm) };
  scheduleTriggers(context, project, take.triggers, take.tapes.map((t) => t.time), sampleRate, route);
  if (mix !== 'space') take.tapes.forEach((tape, i) => scheduleTape(context, tape, recordings[i]!));
  const full = await context.startRendering();
  return { full, buffer: full.length === length ? full : folded(context, full, length) };
}

/** Renders a take to audio offline, exactly as long as the song or `seconds`: ready to loop. */
export async function renderTake(take: Take, project: Project, sampleRate: number, seconds = songDuration(project.song)): Promise<AudioBuffer> {
  return (await renderTakeWithTail(take, project, sampleRate, seconds)).buffer;
}

/** The first `length` frames of `full`, with the frames after them added from the start, round and round. */
function folded(context: BaseAudioContext, full: AudioBuffer, length: number): AudioBuffer {
  const out = context.createBuffer(full.numberOfChannels, length, full.sampleRate);
  for (let c = 0; c < full.numberOfChannels; c++) {
    const from = full.getChannelData(c);
    const to = new Float32Array(length);
    for (let i = 0; i < from.length; i++) to[i % length]! += from[i]!;
    out.copyToChannel(to, c);
  }
  return out;
}

/** Renders triggers to audio offline, with no tapes. */
export async function renderTriggers(triggers: readonly Trigger[], project: Project, sampleRate: number): Promise<AudioBuffer> {
  return renderTake({ triggers, tapes: [] }, project, sampleRate);
}

/** The shortest and longest reverb, in seconds, at size 0 and 1. */
export const REVERB_SECONDS = { min: 0.3, max: 4 } as const;
/** The longest anything rings after the song, in seconds. */
const MAX_RING = 10;

const reverbSeconds = (size: number) => REVERB_SECONDS.min + size * (REVERB_SECONDS.max - REVERB_SECONDS.min);
/** How long a delay's echoes take to die away to −60 dB. */
const delaySeconds = (delay: DelayPlay, bpm: number) => {
  const time = delay.steps * stepDuration(bpm);
  return delay.feedback <= 0 ? time : time * (1 + Math.log(0.001) / Math.log(delay.feedback));
};

/** How long the reverb and delay of these triggers can ring after the last one. */
export function spaceRing(triggers: readonly Trigger[], bpm: number): number {
  let ring = 0;
  for (const t of triggers) {
    if (t.reverb !== null) ring = Math.max(ring, reverbSeconds(t.reverb.size));
    if (t.delay !== null) ring = Math.max(ring, delaySeconds(t.delay, bpm));
  }
  return Math.min(MAX_RING, ring);
}

/** The song's reverb and delay: where voices send, by size and by delay. */
export interface Space {
  readonly reverb: (size: number) => AudioNode;
  readonly delay: (delay: DelayPlay) => AudioNode;
}

/**
 * Noise that is the same every time: a fixed room, not chance. (Randomness in
 * a take comes from its Rng; this is part of the sound, like a sample.)
 */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A room: stereo noise dying away to −60 dB over its length, with as much energy as a single click, so the reverb is about as loud as what is sent. */
export function reverbImpulse(size: number, sampleRate: number): Float32Array<ArrayBuffer>[] {
  const seconds = reverbSeconds(size);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  return [1, 2].map((seed) => {
    const next = noise(seed);
    const data = new Float32Array(length);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      data[i] = next() * Math.exp((-6.9 * i) / length);
      energy += data[i]! * data[i]!;
    }
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < length; i++) data[i]! *= scale;
    return data;
  });
}

/** The reverb and delay on a context, made as they are first sent to and shared by all voices after. */
export function createSpace(context: BaseAudioContext, out: AudioNode, bpm: number): Space {
  const reverbs = new Map<string, AudioNode>();
  const delays = new Map<string, AudioNode>();
  return {
    reverb: (size) => {
      const key = size.toFixed(2);
      let input = reverbs.get(key);
      if (input === undefined) {
        const convolver = context.createConvolver();
        convolver.normalize = false;
        const impulse = reverbImpulse(Number(key), context.sampleRate);
        const buffer = context.createBuffer(2, impulse[0]!.length, context.sampleRate);
        impulse.forEach((data, c) => buffer.copyToChannel(data, c));
        convolver.buffer = buffer;
        convolver.connect(out);
        input = convolver;
        reverbs.set(key, input);
      }
      return input;
    },
    delay: (delay) => {
      const key = `${delay.steps}:${delay.feedback.toFixed(3)}`;
      let input = delays.get(key);
      if (input === undefined) {
        const time = delay.steps * stepDuration(bpm);
        const line = context.createDelay(Math.max(1, time + 0.01));
        line.delayTime.value = time;
        const feedback = context.createGain();
        feedback.gain.value = delay.feedback;
        line.connect(feedback).connect(line);
        line.connect(out);
        input = line;
        delays.set(key, input);
      }
      return input;
    },
  };
}
