import type { Trigger } from '../engine';
import type { AudioData } from '../model';

/** A rendered take: the audio and the triggers it was made from. */
export interface Take {
  readonly buffer: AudioBuffer;
  readonly triggers: readonly Trigger[];
}

/** Lead time so a scheduled start is never in the past. */
const MIN_LEAD = 0.02;

/**
 * When a new take should start while `duration`-long loops have played since
 * `startTime`: the end of the current loop, or the one after if that is too close.
 */
export function nextLoopBoundary(now: number, startTime: number, duration: number): number {
  if (now < startTime) return startTime;
  const loops = Math.floor((now - startTime) / duration) + 1;
  const boundary = startTime + loops * duration;
  return boundary - now < MIN_LEAD ? boundary + duration : boundary;
}

/** The bar of the trigger most recently passed at `position` seconds into a take, or null before the first. */
export function playheadBar(triggers: readonly Trigger[], position: number): number | null {
  let bar: number | null = null;
  for (const trigger of triggers) {
    if (trigger.time > position) break;
    bar = trigger.bar;
  }
  return bar;
}

interface Segment {
  readonly take: Take;
  readonly source: AudioBufferSourceNode;
  readonly startTime: number;
}

export interface Player {
  readonly play: (take: Take) => void;
  /** Swaps in a new take at the end of the current loop; starts nothing if stopped. */
  readonly replace: (take: Take) => void;
  readonly stop: () => void;
  readonly isPlaying: () => boolean;
  /** The bar under the playhead now, or null when stopped. */
  readonly currentBar: () => number | null;
  /** Plays part of some audio directly, outside the song. Times in seconds. */
  readonly audition: (audio: AudioData, offset: number, duration: number) => void;
}

/** Loops rendered takes on an AudioContext. The context is created on first use, inside a user gesture. */
export function createPlayer(makeContext: () => AudioContext = () => new AudioContext()): Player {
  let context: AudioContext | null = null;
  let current: Segment | null = null;
  let pending: Segment | null = null;
  const auditionBuffers = new WeakMap<AudioData, AudioBuffer>();

  const ctx = () => {
    context ??= makeContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  };

  const start = (take: Take, at: number): Segment => {
    const c = ctx();
    const source = c.createBufferSource();
    source.buffer = take.buffer;
    source.loop = true;
    source.connect(c.destination);
    source.start(at);
    return { take, source, startTime: at };
  };

  const stopAll = () => {
    for (const segment of [current, pending]) {
      try {
        segment?.source.stop();
      } catch {
        // Already stopped.
      }
    }
    current = null;
    pending = null;
  };

  /** Promotes the pending take once its start time has come. */
  const settle = () => {
    if (pending !== null && context !== null && context.currentTime >= pending.startTime) {
      current = pending;
      pending = null;
    }
  };

  return {
    play: (take) => {
      stopAll();
      current = start(take, ctx().currentTime + MIN_LEAD);
    },
    replace: (take) => {
      settle();
      if (current === null || context === null) return;
      if (pending !== null) {
        // A newer take supersedes one that has not started yet; the current loop keeps its stop time.
        pending.source.stop();
        pending = start(take, pending.startTime);
        return;
      }
      const at = nextLoopBoundary(context.currentTime, current.startTime, current.take.buffer.duration);
      current.source.stop(at);
      pending = start(take, at);
    },
    stop: stopAll,
    isPlaying: () => current !== null,
    currentBar: () => {
      settle();
      if (current === null || context === null) return null;
      const duration = current.take.buffer.duration;
      const elapsed = context.currentTime - current.startTime;
      if (elapsed < 0 || duration <= 0) return null;
      return playheadBar(current.take.triggers, elapsed % duration);
    },
    audition: (audio, offset, duration) => {
      const c = ctx();
      let buffer = auditionBuffers.get(audio);
      if (buffer === undefined) {
        buffer = c.createBuffer(audio.channels.length, audio.channels[0]?.length ?? 1, audio.sampleRate);
        audio.channels.forEach((channel, i) => buffer!.copyToChannel(Float32Array.from(channel), i));
        auditionBuffers.set(audio, buffer);
      }
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(c.destination);
      source.start(c.currentTime, offset, duration);
    },
  };
}
