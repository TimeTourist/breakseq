import type { BufferCache, Tape, Trigger, Voice } from '../engine';
import { hitPlay, scheduleHit } from '../engine';
import type { AudioData, Id, Project } from '../model';

/** A rendered take: the audio and the triggers it was made from. */
export interface Take {
  /** Exactly as long as what it plays, ready to loop: reverb and delay ringing past the end come in at the start. */
  readonly buffer: AudioBuffer;
  /** As long as it rings, for playing once and for export; missing when nothing rings past the end. */
  readonly full?: AudioBuffer;
  readonly triggers: readonly Trigger[];
  /** Tape segments heard instead of triggers. */
  readonly tapes: readonly Tape[];
}

/** Lead time so a scheduled start is never in the past. */
const MIN_LEAD = 0.02;

/** A stretch of a take, in seconds: what plays over and over. */
export interface LoopRange {
  readonly start: number;
  readonly end: number;
}

/** A take started at `startTime` from `offset` seconds into it, which then loops `loop`. */
export interface Run {
  readonly startTime: number;
  readonly offset: number;
  readonly loop: LoopRange;
}

/** The loop within a take of `duration` seconds: `range` cut to fit, or the whole take. */
export function fitLoop(range: LoopRange | null, duration: number): LoopRange {
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(duration, range?.end ?? duration);
  return end - start > 1e-6 ? { start, end } : { start: 0, end: duration };
}

/** Where a run starts: at `from`, unless that is at or past the loop's end, then at the loop's start. */
export const startOffset = (from: number, loop: LoopRange): number => (from >= 0 && from < loop.end ? from : loop.start);

/** Seconds into the take at time `now`: on from the offset, then round the loop. Null before it starts. */
export function runPosition(now: number, run: Run): number | null {
  const elapsed = now - run.startTime;
  if (elapsed < 0) return null;
  const at = run.offset + elapsed;
  const length = run.loop.end - run.loop.start;
  if (at < run.loop.end || length <= 0) return at;
  return run.loop.start + ((at - run.loop.end) % length);
}

/** When a run next reaches the end of its loop, or the time after if that is too close to `now`. */
export function nextRunBoundary(now: number, run: Run): number {
  const length = run.loop.end - run.loop.start;
  const first = run.startTime + (run.loop.end - run.offset);
  if (now < first) return first - now < MIN_LEAD ? first + length : first;
  const boundary = first + (Math.floor((now - first) / length) + 1) * length;
  return boundary - now < MIN_LEAD ? boundary + length : boundary;
}

/**
 * When a new take should start while `duration`-long loops have played since
 * `startTime`: the end of the current loop, or the one after if that is too close.
 */
export function nextLoopBoundary(now: number, startTime: number, duration: number): number {
  if (now < startTime) return startTime;
  return nextRunBoundary(now, { startTime, offset: 0, loop: { start: 0, end: duration } });
}

/** Where an audition is, in seconds of its audio: looped within its region, or null once a single play is over. */
export function auditionPosition(
  now: number,
  audition: { readonly startTime: number; readonly offset: number; readonly duration: number; readonly loop: boolean },
): number | null {
  const elapsed = now - audition.startTime;
  if (elapsed < 0 || audition.duration <= 0) return audition.offset;
  if (!audition.loop) return elapsed > audition.duration ? null : audition.offset + elapsed;
  return audition.offset + (elapsed % audition.duration);
}

/** The trigger most recently passed at `position` seconds into a take, or null before the first. */
export function playheadTrigger(triggers: readonly Trigger[], position: number): Trigger | null {
  let last: Trigger | null = null;
  for (const trigger of triggers) {
    if (trigger.time > position) break;
    last = trigger;
  }
  return last;
}

interface Segment extends Run {
  readonly take: Take;
  readonly source: AudioBufferSourceNode;
  /** Plays to the end and stops, rather than looping. */
  readonly once: boolean;
}

export interface Player {
  /**
   * Plays a take from `from` seconds into it (0 if left out), looping the loop
   * set with setLoop; with `once`, to its end and then it stops by itself.
   */
  readonly play: (take: Take, from?: number, once?: boolean) => void;
  /** Swaps in a new take at the end of the current loop; starts nothing if stopped or playing once. */
  readonly replace: (take: Take) => void;
  /** Jumps to `seconds` into what is playing; nothing if stopped. */
  readonly seek: (seconds: number) => void;
  /** The part of each take that loops, in seconds, or null for the whole take. Takes effect at once. */
  readonly setLoop: (range: LoopRange | null) => void;
  readonly stop: () => void;
  readonly isPlaying: () => boolean;
  /** The trigger under the playhead now, or null when stopped. */
  readonly currentTrigger: () => Trigger | null;
  /** Seconds into the take that is playing, or null when stopped. */
  readonly currentPosition: () => number | null;
  /**
   * Plays part of some audio directly, outside the song: once, or looped. Times in seconds.
   * One voice: a new audition cuts the previous one. `onEnded` runs when it stops either way.
   */
  readonly audition: (audio: AudioData, offset: number, duration: number, onEnded?: () => void, loop?: boolean) => void;
  /** Moves a looping audition's region while it plays, without restarting it. */
  readonly setAuditionRegion: (offset: number, duration: number) => void;
  /** Where the audition is now, in seconds of its audio, or null when nothing plays. */
  readonly auditionPosition: () => number | null;
  readonly stopAudition: () => void;
  /** Plays a hit with its own settings straight away, sounding as it does in a song. Cuts any audition. */
  readonly playHit: (project: Project, hitId: Id) => void;
}

/** Loops rendered takes on an AudioContext. The context is created on first use, inside a user gesture. */
export function createPlayer(makeContext: () => AudioContext = () => new AudioContext()): Player {
  let context: AudioContext | null = null;
  let current: Segment | null = null;
  let pending: Segment | null = null;
  const auditionBuffers = new WeakMap<AudioData, AudioBuffer>();
  let auditioning: AudioBufferSourceNode | null = null;
  let hitVoice: Voice | null = null;
  let region: { startTime: number; offset: number; duration: number; loop: boolean } | null = null;
  // Hit buffers are cached per project version, so edits to audio are never stale.
  let hitCache: { project: Project; cache: BufferCache } | null = null;

  const stopAudition = () => {
    try {
      auditioning?.stop();
    } catch {
      // Already stopped.
    }
    auditioning = null;
    hitVoice?.stop();
    hitVoice = null;
    region = null;
  };

  const ctx = () => {
    context ??= makeContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  };

  let range: LoopRange | null = null;

  const start = (take: Take, at: number, from: number, once = false): Segment => {
    const c = ctx();
    // Played once, it rings out; looped, what rings past the end is already at the start.
    const buffer = once ? (take.full ?? take.buffer) : take.buffer;
    const loop = once ? { start: 0, end: buffer.duration } : fitLoop(range, buffer.duration);
    const offset = startOffset(from, loop);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = !once;
    source.loopStart = loop.start;
    source.loopEnd = loop.end;
    source.connect(c.destination);
    source.start(at, offset);
    const segment: Segment = { take, source, startTime: at, offset, loop, once };
    if (once) {
      source.onended = () => {
        if (current?.source === source) current = null;
      };
    }
    return segment;
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

  const position = (): number | null => {
    settle();
    if (current === null || context === null) return null;
    const at = runPosition(context.currentTime, current);
    return current.once && at !== null && at >= current.loop.end ? null : at;
  };

  /** Starts the newest take again from `from`, straight away. */
  const restart = (from: number) => {
    const newest = pending ?? current;
    if (newest === null) return;
    stopAll();
    current = start(newest.take, ctx().currentTime + MIN_LEAD, from, newest.once);
  };

  return {
    play: (take, from = 0, once = false) => {
      stopAll();
      current = start(take, ctx().currentTime + MIN_LEAD, from, once);
    },
    replace: (take) => {
      settle();
      if (current === null || context === null || current.once) return;
      if (pending !== null) {
        // A newer take supersedes one that has not started yet; the current loop keeps its stop time.
        pending.source.stop();
        pending = start(take, pending.startTime, fitLoop(range, take.buffer.duration).start);
        return;
      }
      const at = nextRunBoundary(context.currentTime, current);
      current.source.stop(at);
      pending = start(take, at, fitLoop(range, take.buffer.duration).start);
    },
    seek: (seconds) => {
      if (current !== null) restart(seconds);
    },
    setLoop: (next) => {
      range = next;
      const at = position();
      if (current === null || context === null || at === null || current.once) return;
      const loop = fitLoop(range, current.take.buffer.duration);
      if (pending !== null || at >= loop.end) {
        restart(at);
        return;
      }
      // Inside the new loop or before it, the sound carries on: only where it wraps changes.
      current.source.loopStart = loop.start;
      current.source.loopEnd = loop.end;
      current = { ...current, startTime: context.currentTime, offset: at, loop };
    },
    stop: stopAll,
    isPlaying: () => current !== null,
    currentTrigger: () => {
      const at = position();
      return current === null || at === null ? null : playheadTrigger(current.take.triggers, at);
    },
    currentPosition: position,
    playHit: (project, hitId) => {
      stopAudition();
      const c = ctx();
      const hit = project.hits[hitId];
      if (hit === undefined) return;
      if (hitCache?.project.audio !== project.audio) hitCache = { project, cache: new Map() };
      hitVoice = scheduleHit(c, hitCache.cache, project, hitPlay(project, hit), c.currentTime);
    },
    audition: (audio, offset, duration, onEnded, loop = false) => {
      stopAudition();
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
      source.onended = () => {
        if (auditioning === source) {
          auditioning = null;
          region = null;
        }
        onEnded?.();
      };
      if (loop) {
        source.loop = true;
        source.loopStart = offset;
        source.loopEnd = offset + duration;
        source.start(c.currentTime, offset);
      } else {
        source.start(c.currentTime, offset, duration);
      }
      auditioning = source;
      region = { startTime: c.currentTime, offset, duration, loop };
    },
    setAuditionRegion: (offset, duration) => {
      if (auditioning === null || region === null || !region.loop || context === null) return;
      const now = context.currentTime;
      const at = auditionPosition(now, region) ?? offset;
      auditioning.loopStart = offset;
      auditioning.loopEnd = offset + duration;
      // Keep the playhead where the sound is: inside the new region it carries on, outside it wraps to the start.
      const into = at >= offset && at < offset + duration ? at - offset : 0;
      region = { startTime: now - into, offset, duration, loop: true };
    },
    auditionPosition: () => (region === null || context === null ? null : auditionPosition(context.currentTime, region)),
    stopAudition,
  };
}
