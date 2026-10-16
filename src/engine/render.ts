import type { AudioData, Direction, Hit, Project, Sample } from '../model';
import { effectiveHit, hitColour, hitSound, hitStretch, sampleAudio, songDuration } from '../model';
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
export type HitPlay = Pick<Trigger, 'hitId' | 'pitch' | 'volume' | 'pan' | 'direction' | 'region' | 'stretch' | 'dist' | 'filter'>;

/** A voice that has been scheduled: stop() silences it at once. */
export interface Voice {
  readonly stop: () => void;
}

/** Sample buffers made on one context, per sample and direction. */
export type BufferCache = Map<string, AudioBuffer>;

/** A hit played as it is, with no mods: its own settings plus its parent's. */
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
  };
}

/**
 * Schedules one voice on any context, offline or live: region, direction,
 * pitch as playback rate, stretch as grains, volume and fade out. If `chokeAt`
 * comes before the voice ends, it fades out from there over CHOKE_FADE.
 */
export function scheduleHit(
  context: BaseAudioContext,
  cache: BufferCache,
  project: Project,
  play: HitPlay,
  start: number,
  chokeAt = Infinity,
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
          origin: play.stretch.from === 'break' ? 0 : offset,
          // From the hit, grains stay within it; from the break, they may read on into the next slice.
          limit: play.stretch.from === 'break' ? buffer.duration : onFrame(region.end),
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
  // The parent's fade applies where the slice has none.
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
  if (play.pan === 0) {
    gain.connect(context.destination);
  } else {
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
    merge.connect(context.destination);
  }
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
function scheduleTriggers(context: BaseAudioContext, project: Project, triggers: readonly Trigger[], cuts: readonly number[], sampleRate: number) {
  const cache: BufferCache = new Map();
  const sorted = [...triggers].sort((a, b) => a.time - b.time);
  // Starts are placed on whole sample frames. Between frames Web Audio interpolates,
  // which dulls a slice by a varying amount; on a frame a slice plays back bit for bit.
  const onFrame = (time: number) => Math.round(time * sampleRate) / sampleRate;
  const starts = [...sorted.map((t) => onFrame(t.time)), ...cuts.map(onFrame)].sort((a, b) => a - b);
  sorted.forEach((trigger) => {
    const start = onFrame(trigger.time);
    const next = starts.find((s) => s > start);
    scheduleHit(context, cache, project, trigger, start, next ?? Infinity);
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

/**
 * Renders a take to audio offline. One voice: a new trigger or tape cuts the
 * sound before it with a short fade. The buffer is exactly as long as the song,
 * or `seconds` when given.
 */
export async function renderTake(take: Take, project: Project, sampleRate: number, seconds = songDuration(project.song)): Promise<AudioBuffer> {
  const recordings = await Promise.all(take.tapes.map((tape) => renderPart(tape.source, project, tape.length, sampleRate, tape.length)));
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  scheduleTriggers(context, project, take.triggers, take.tapes.map((t) => t.time), sampleRate);
  take.tapes.forEach((tape, i) => scheduleTape(context, tape, recordings[i]!));
  return context.startRendering();
}

/** Renders triggers to audio offline, with no tapes. */
export async function renderTriggers(triggers: readonly Trigger[], project: Project, sampleRate: number): Promise<AudioBuffer> {
  return renderTake({ triggers, tapes: [] }, project, sampleRate);
}
