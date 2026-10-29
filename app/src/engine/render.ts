import type { AudioData, DelayPlay, Direction, Hit, Project, Sample } from '../model';
import { effectiveHit, hitColour, hitSound, hitSpace, hitStretch, sampleAudio, songDuration, stepDuration } from '../model';
import { panGains } from './colour';
import { distort, filterSettings, levelMatch, rms } from './colour';
import type { Take, Trigger } from './generate';
import { playedStretch } from './generate';
import { grainCurve, grainPlan } from './stretch';
import type { Tape } from './tape';
import { speedCurve, tapePasses } from './tape';
import { finishHeard } from './render-heard';

/** Seconds a choked voice takes to fade out when the next trigger starts. */
export const CHOKE_FADE = 0.003;

const dbToGain = (db: number) => 10 ** (db / 20);

/** Numbers for audio objects, so a cache key can tell one file's audio from another's without reading it. */
const audioNumbers = new WeakMap<AudioData, number>();
let nextAudioNumber = 1;

/** A number that stands for this audio object: the same object always has the same one. */
export function audioKey(audio: AudioData): number {
  let key = audioNumbers.get(audio);
  if (key === undefined) {
    key = nextAudioNumber++;
    audioNumbers.set(audio, key);
  }
  return key;
}

/**
 * Sample buffers kept between renders, per file's audio: the clean one per
 * trim, channel and direction, and the distorted ones per dist. They go when the audio goes.
 */
const sampleBuffers = new WeakMap<AudioData, Map<string, AudioBuffer>>();

const buffersOf = (raw: AudioData): Map<string, AudioBuffer> => {
  let buffers = sampleBuffers.get(raw);
  if (buffers === undefined) {
    buffers = new Map();
    sampleBuffers.set(raw, buffers);
  }
  return buffers;
};

/** The frames of a sample within its audio. Both ends are rounded, so neighbouring slices share their boundary frame exactly. */
function sampleFrames(sample: Sample, sampleRate: number): { readonly from: number; readonly length: number } {
  const from = Math.round(sample.offset * sampleRate);
  return { from, length: Math.max(1, Math.round((sample.offset + sample.duration) * sampleRate) - from) };
}

/** The sample's own audio as a buffer, reversed for 'reverse'; made once and kept. */
function sampleBuffer(raw: AudioData, sample: Sample, audio: AudioData, direction: Direction): AudioBuffer {
  const buffers = buffersOf(raw);
  const key = `${sample.offset}:${sample.duration}:${sample.channel}:${direction}`;
  const kept = buffers.get(key);
  if (kept !== undefined) return kept;
  const { from, length } = sampleFrames(sample, audio.sampleRate);
  const buffer = new AudioBuffer({ numberOfChannels: Math.max(1, audio.channels.length), length, sampleRate: audio.sampleRate });
  audio.channels.forEach((channel, i) => {
    const data = channel.slice(from, from + length);
    if (direction === 'reverse') data.reverse();
    buffer.copyToChannel(data, i);
  });
  buffers.set(key, buffer);
  return buffer;
}

/** A clean sample buffer distorted, made once per dist and kept beside it. */
function distortedBuffer(raw: AudioData, cleanKey: string, clean: AudioBuffer, dist: NonNullable<HitPlay['dist']>): AudioBuffer {
  const buffers = buffersOf(raw);
  const key = `${cleanKey}:${dist.mode}:${dist.amount.toFixed(4)}`;
  const kept = buffers.get(key);
  if (kept !== undefined) return kept;
  const distorted = new AudioBuffer({ numberOfChannels: clean.numberOfChannels, length: clean.length, sampleRate: clean.sampleRate });
  for (let c = 0; c < clean.numberOfChannels; c++) distorted.copyToChannel(distort(clean.getChannelData(c), dist), c);
  buffers.set(key, distorted);
  return distorted;
}

/** What one voice plays: a hit with its final settings, as a trigger carries them. */
export type HitPlay = Pick<Trigger, 'hitId' | 'pitch' | 'volume' | 'pan' | 'direction' | 'region' | 'stretch' | 'dist' | 'filter' | 'reverb' | 'delay'>;

/** A voice that has been scheduled: stop() silences it at once. */
export interface Voice {
  readonly stop: () => void;
}


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

/** What a voice plays and when it ends, worked out without audio: a render sizes its parts by it. */
interface VoicePlan {
  readonly hit: Hit;
  readonly sample: Sample;
  /** The file's audio, and the sample's channels of it. */
  readonly raw: AudioData;
  readonly audio: AudioData;
  /** The region within the sample's buffer as it is played (mirrored backwards). */
  readonly region: { readonly start: number; readonly end: number };
  /** Where it starts in the buffer, on a whole frame. */
  readonly offset: number;
  readonly rate: number;
  readonly plan: ReturnType<typeof grainPlan> | null;
  readonly naturalEnd: number;
  readonly choked: boolean;
  /** When its sources stop: at its end, or after the choke's fade. */
  readonly stopAt: number;
}

function planVoice(project: Project, play: HitPlay, start: number, chokeAt: number, sampleRate: number): VoicePlan | null {
  const hit = project.hits[play.hitId];
  const sample = hit === undefined ? undefined : hitSound(project, hit)?.sample;
  const raw = sample === undefined ? undefined : project.audio[sample.audioId];
  // The sample's channel choice: always stereo.
  const audio = sample === undefined ? undefined : sampleAudio(project, sample);
  if (hit === undefined || sample === undefined || raw === undefined || audio === undefined) return null;
  const bufferDuration = sampleFrames(sample, audio.sampleRate).length / audio.sampleRate;

  // In a reversed buffer the region is mirrored. It starts on a whole frame, so
  // slices of one sample played one after another give back the sample exactly.
  const region =
    play.direction === 'forward'
      ? play.region
      : { start: sample.duration - play.region.end, end: sample.duration - play.region.start };
  const onFrame = (t: number) => Math.round(t * audio.sampleRate) / audio.sampleRate;
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
          limit: play.stretch.from === 'sample' ? bufferDuration : onFrame(region.end),
        });
  // It ends on a whole frame too: the buffer goes on past the slice, into the next one.
  const naturalEnd = start + (plan === null ? Math.max(0, onFrame(region.end) - offset) / rate : plan.length);
  // A next trigger within a frame of the end is not a choke: the voice ends there, without a fade.
  const choked = chokeAt < naturalEnd - 1.5 / sampleRate;
  // A quarter of a frame early, so the frame where the next sound starts is not played as well. Not half:
  // halfway between frames, which frame it stops on would be up to rounding, and a part rendered on its own could differ.
  const stopAt = choked ? chokeAt + CHOKE_FADE : Math.min(naturalEnd, chokeAt) - 0.25 / sampleRate;
  return { hit, sample, raw, audio, region, offset, rate, plan, naturalEnd, choked, stopAt };
}

/** How long a voice's filter can ring after its sound stops: to about −60 dB, at most 2 s. */
function filterRing(play: HitPlay, sampleRate: number): number {
  if (play.filter === null) return 0;
  const { frequency, q } = filterSettings(play.filter, sampleRate);
  const resonance = Math.max(Math.SQRT1_2, 10 ** (q / 20));
  return Math.min(2, (7 * resonance) / (Math.PI * Math.max(1, frequency))) + 0.01;
}

/**
 * When a voice is over, with what its filter rings after it, or null when it
 * plays nothing. Without audio: a render sizes its parts by it.
 */
export function voiceEnd(project: Project, play: HitPlay, start: number, chokeAt: number, sampleRate: number): number | null {
  const plan = planVoice(project, play, start, chokeAt, sampleRate);
  return plan === null ? null : plan.stopAt + filterRing(play, sampleRate);
}

/**
 * Schedules one voice on any context, offline or live: region, direction,
 * pitch as playback rate, stretch as grains, volume and fade out. If `chokeAt`
 * comes before the voice ends, it fades out from there over CHOKE_FADE. What it
 * sends to the reverb and delay is the voice as heard, cut where it is cut; the
 * reverb and delay ring on. Sample buffers are made once and kept between renders.
 */
export function scheduleHit(
  context: BaseAudioContext,
  project: Project,
  play: HitPlay,
  start: number,
  chokeAt = Infinity,
  route: Route = { dry: context.destination, space: null },
  origin = 0,
): Voice | null {
  const voicePlan = planVoice(project, play, start, chokeAt, context.sampleRate);
  // Times are worked out in the song and moved to the context's time last, through frames: a
  // part rendered on its own then starts and stops every sound on the frame one long render does.
  const sampleRate = context.sampleRate;
  const when = (t: number) => (origin === 0 ? t : (t * sampleRate - origin) / sampleRate);
  if (voicePlan === null) return null;
  const { hit, sample, raw, audio, region, offset, rate, plan, naturalEnd, choked, stopAt } = voicePlan;

  // Backwards buffers are worked out once per sample, and distorted ones once per dist.
  const clean = sampleBuffer(raw, sample, audio, play.direction);
  const buffer = play.dist === null ? clean : distortedBuffer(raw, `${sample.offset}:${sample.duration}:${sample.channel}:${play.direction}`, clean, play.dist);

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
  gain.gain.value = level;
  gain.gain.setValueAtTime(level, when(start));
  if (choked) {
    if (fadeStart < chokeAt) {
      gain.gain.setValueAtTime(level, when(fadeStart));
      gain.gain.linearRampToValueAtTime(levelAt(chokeAt), when(chokeAt));
    } else {
      gain.gain.setValueAtTime(level, when(chokeAt));
    }
    gain.gain.linearRampToValueAtTime(0, when(chokeAt + CHOKE_FADE));
  } else if (fadeOut > 0) {
    gain.gain.setValueAtTime(level, when(fadeStart));
    gain.gain.linearRampToValueAtTime(0, when(naturalEnd));
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
  const sources: AudioBufferSourceNode[] = [];
  const voice = (at: number, from: number, until: number, into: AudioNode) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(into);
    source.start(when(at), from);
    source.stop(when(until));
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
      const curve = grainCurve(g.shape, skip / g.length);
      // Until the curve starts, its first value: not 1, which a grain starting a hair before it would play for a frame.
      envelope.gain.value = curve[0] ?? 0;
      envelope.gain.setValueCurveAtTime(curve, when(at), start + g.at + g.length - at);
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

/** A trigger placed on a whole frame, with where the next sound cuts it. */
export interface PlacedVoice {
  readonly trigger: Trigger;
  /** The frame it starts on. */
  readonly frame: number;
  /** The frame where the next trigger or tape starts and cuts it, or Infinity. */
  readonly chokeFrame: number;
}

/**
 * Triggers in time order, each on a whole frame and cut where the next sound
 * starts: the next trigger, or a cut such as a tape. One voice.
 */
export function placeVoices(triggers: readonly Trigger[], cuts: readonly number[], sampleRate: number): PlacedVoice[] {
  const sorted = [...triggers].sort((a, b) => a.time - b.time);
  // Starts are placed on whole sample frames. Between frames Web Audio interpolates,
  // which dulls a slice by a varying amount; on a frame a slice plays back bit for bit.
  const frameOf = (time: number) => Math.round(time * sampleRate);
  const starts = [...sorted.map((t) => frameOf(t.time)), ...cuts.map(frameOf)].sort((a, b) => a - b);
  let next = 0;
  return sorted.map((trigger) => {
    const frame = frameOf(trigger.time);
    while (next < starts.length && starts[next]! <= frame) next++;
    return { trigger, frame, chokeFrame: starts[next] ?? Infinity };
  });
}

/** Plays placed voices on a context whose time 0 is frame `origin` of the song. */
export function scheduleVoices(context: BaseAudioContext, project: Project, voices: readonly PlacedVoice[], route: Route, origin = 0): void {
  const sampleRate = context.sampleRate;
  for (const v of voices) scheduleHit(context, project, v.trigger, v.frame / sampleRate, v.chokeFrame / sampleRate, route, origin);
}

const reversed = (buffer: AudioBuffer): AudioBuffer => {
  const copy = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: buffer.length, sampleRate: buffer.sampleRate });
  for (let i = 0; i < buffer.numberOfChannels; i++) copy.copyToChannel(buffer.getChannelData(i).slice().reverse(), i);
  return copy;
};

/**
 * Plays a tape: its recording round and round as its passes say, with the
 * speed ramping as playback rate, so pitch and length follow like tape. It
 * fades out over CHOKE_FADE at its end. The context's time 0 is the song's start.
 */
export function scheduleTape(context: BaseAudioContext, tape: Tape, recording: AudioBuffer, out: AudioNode = context.destination): void {
  const backwards = reversed(recording);
  const gain = context.createGain();
  gain.gain.setValueAtTime(1, tape.time);
  gain.gain.setValueAtTime(1, Math.max(tape.time, tape.end - CHOKE_FADE));
  gain.gain.linearRampToValueAtTime(0, tape.end);
  gain.connect(out);
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
 * Renders a take to audio offline, what is heard all of it on one context: one
 * voice, a new trigger cutting the sound before it with a short fade, and
 * beside it the reverb and delay ringing out. Then tapes and audio mods play
 * over what is heard (finishHeard). renderTakeWithTail renders the same in
 * parts, which is faster for anything long; this is what it is checked against.
 */
export async function renderTakeWhole(
  take: Take,
  project: Project,
  sampleRate: number,
  seconds = songDuration(project.song),
  mix: Mix = 'all',
): Promise<Rendered> {
  const heard = take.heard ?? take.triggers;
  const ring = mix === 'dry' ? 0 : spaceRing(heard, project.song.bpm);
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: length + Math.round(ring * sampleRate), sampleRate });
  const route: Route = { dry: mix === 'space' ? null : context.destination, space: mix === 'dry' ? null : createSpace(context, context.destination, project.song.bpm) };
  scheduleVoices(context, project, placeVoices(heard, [], sampleRate), route);
  const rendered = await context.startRendering();
  const channels = await finishHeard([rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()], take, sampleRate, mix);
  const full = new AudioBuffer({ numberOfChannels: 2, length: rendered.length, sampleRate });
  channels.forEach((data, c) => full.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  return { full, buffer: full.length === length ? full : folded(full, length) };
}

/** The first `length` frames of `full`, with the frames after them added from the start, round and round. */
export function folded(full: AudioBuffer, length: number): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: full.numberOfChannels, length, sampleRate: full.sampleRate });
  for (let c = 0; c < full.numberOfChannels; c++) {
    const from = full.getChannelData(c);
    const to = new Float32Array(length);
    for (let i = 0; i < from.length; i++) to[i % length]! += from[i]!;
    out.copyToChannel(to, c);
  }
  return out;
}

export { CHUNK_BARS, createRenderCache, isRenderCancelled, renderTake, renderTakeWithTail, renderTriggers } from './render-chunks';
export type { RenderCache, RenderOptions } from './render-chunks';

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

/** Rooms as buffers, per size and sample rate: worked out once and kept between renders. */
const impulses = new Map<string, AudioBuffer>();

function impulseBuffer(size: number, sampleRate: number): AudioBuffer {
  const key = `${size}:${sampleRate}`;
  let buffer = impulses.get(key);
  if (buffer === undefined) {
    const impulse = reverbImpulse(size, sampleRate);
    buffer = new AudioBuffer({ numberOfChannels: 2, length: impulse[0]!.length, sampleRate });
    impulse.forEach((data, c) => buffer!.copyToChannel(data, c));
    impulses.set(key, buffer);
  }
  return buffer;
}

/** The key a reverb is shared by: voices that send to the same size send to one room. */
export const reverbKey = (size: number): string => size.toFixed(2);
/** The key a delay is shared by. */
export const delayKey = (delay: DelayPlay): string => `${delay.steps}:${delay.feedback.toFixed(3)}`;

/** The reverb and delay on a context, made as they are first sent to and shared by all voices after. */
export function createSpace(context: BaseAudioContext, out: AudioNode, bpm: number): Space {
  const reverbs = new Map<string, AudioNode>();
  const delays = new Map<string, AudioNode>();
  return {
    reverb: (size) => {
      const key = reverbKey(size);
      let input = reverbs.get(key);
      if (input === undefined) {
        const convolver = context.createConvolver();
        convolver.normalize = false;
        convolver.buffer = impulseBuffer(Number(key), context.sampleRate);
        convolver.connect(out);
        input = convolver;
        reverbs.set(key, input);
      }
      return input;
    },
    delay: (delay) => {
      const key = delayKey(delay);
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
