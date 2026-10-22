import type { Take as Generated, PickState, Tape, Trigger, Voice } from '../engine';
import { CHOKE_FADE, hitPlay, scheduleHit } from '../engine';
import type { AudioData, Id, Project } from '../model';

/**
 * A rendered take: the audio and the triggers it was made from, and for a song
 * what the exports cut from it (what is heard, Scratch, the audio mods and
 * where their clips are).
 */
export interface Take extends Pick<Generated, 'heard' | 'scratches' | 'splices' | 'audioClips'> {
  /** Exactly as long as what it plays, ready to loop: reverb and delay ringing past the end come in at the start. */
  readonly buffer: AudioBuffer;
  /** As long as it rings, for playing once and for export; missing when nothing rings past the end. */
  readonly full?: AudioBuffer;
  readonly triggers: readonly Trigger[];
  /** Tape segments heard instead of triggers. */
  readonly tapes: readonly Tape[];
  /** Seconds per 1/16 step, the grid a new take takes over on; missing for audio without steps, as a sample. */
  readonly step?: number;
  /** Where the pads' choices stood at its end: the next pass of Play starts from it. */
  readonly end?: PickState;
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

/** How long the take that is taken over from fades out while the new one fades in, so the swap does not click. */
export const SWAP_FADE = CHOKE_FADE;

/** Where a new take takes over: when, and from how far into it. */
export interface SwapPoint {
  readonly at: number;
  readonly offset: number;
}

/** A position in seconds on a grid of `from` seconds per step, as the same step on a grid of `to`. */
const onGrid = (position: number, from: number | undefined, to: number | undefined): number =>
  from === undefined || to === undefined || from <= 0 ? position : (position / from) * to;

/**
 * Where a new take takes over from a run, as soon as it can (Magnus beslut):
 * at the next 1/16 step from `now`, at the same step in the new take, so the
 * music goes on in time (Claudes val). With no steps, as for a sample, at once
 * and at the same second. `oldStep` and `newStep` are the takes' seconds per
 * step: the step is the same when the tempo changes.
 *
 * Looped, a position past the new take's loop goes round it: as far into the
 * loop as the playhead is into its turn. Played once, a position past the new
 * take's end has played out: null. (Claudes val.)
 */
export function swapPoint(
  now: number,
  run: Run,
  oldStep: number | undefined,
  newStep: number | undefined,
  next: { readonly loop: LoopRange; readonly once: boolean },
): SwapPoint | null {
  const soonest = Math.max(now + MIN_LEAD, run.startTime);
  const position = runPosition(soonest, run) ?? run.offset;
  let at = soonest;
  let from = position;
  if (oldStep !== undefined && oldStep > 0) {
    const boundary = Math.ceil(position / oldStep - 1e-9) * oldStep;
    if (!next.once && boundary >= run.loop.end - 1e-9) {
      // The step after the last of the loop is its first.
      at = soonest + (run.loop.end - position);
      from = run.loop.start;
    } else {
      at = soonest + (boundary - position);
      from = boundary;
    }
  }
  let offset = onGrid(from, oldStep, newStep);
  const { loop } = next;
  if (next.once) return offset >= loop.end - 1e-9 ? null : { at, offset };
  const length = loop.end - loop.start;
  if (offset >= loop.end && length > 0) offset = loop.start + ((offset - loop.start) % length);
  return { at, offset };
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

/**
 * The first turn of block `next` as heard after block `previous` (see
 * Svansen and Varv i loop): its own frames without its tail, and what of
 * `previous` rings past its end added from its start, round and round as
 * folded does. Its own tail comes in when it loops, or with the block after
 * it. Null when that is just its buffer: nothing rings past either.
 */
export function afterTail(previous: Pick<Take, 'buffer' | 'full'>, next: Pick<Take, 'buffer' | 'full'>): Float32Array[] | null {
  if (previous.full === undefined && next.full === undefined) return null;
  const length = next.buffer.length;
  const own = next.full ?? next.buffer;
  return Array.from({ length: next.buffer.numberOfChannels }, (_, c) => {
    const out = own.getChannelData(c).slice(0, length);
    if (previous.full !== undefined && length > 0) {
      const tail = previous.full.getChannelData(Math.min(c, previous.full.numberOfChannels - 1));
      for (let i = previous.buffer.length; i < tail.length; i++) out[(i - previous.buffer.length) % length]! += tail[i]!;
    }
    return out;
  });
}

interface Segment extends Run {
  readonly take: Take;
  /** Its buffer, looped; after the first turn when it has a lead. Replaced when a queued block is taken away again (see cut). */
  source: AudioBufferSourceNode;
  /** A queued block's first turn, with the tail of the block before it (afterTail); null when it has none. */
  readonly lead: AudioBufferSourceNode | null;
  /** When `source` starts: after the lead's turn, or at once. */
  readonly loopFrom: number;
  /** Set when a block queued after this one's lead stopped `source` before it started: the time it would have started. */
  cut: number | null;
  /** Its level: faded in and out when one take takes over from another. */
  readonly gain: GainNode;
  /** Plays to the end and stops, rather than looping. */
  readonly once: boolean;
}

export interface Player {
  /**
   * Plays a take from `from` seconds into it (0 if left out), looping the loop
   * set with setLoop; with `once`, to its end and then it stops by itself.
   */
  readonly play: (take: Take, from?: number, once?: boolean) => void;
  /**
   * Swaps in a new take of what plays as soon as it can (see swapPoint), looped
   * or played once as before; starts nothing if stopped.
   */
  readonly replace: (take: Take) => void;
  /**
   * Queues the next block of passes (see Varv i loop): it takes over, from its
   * start, when the take playing reaches its end, instead of that looping
   * again; it then loops itself until another is queued. `onStart` runs once it
   * plays. Null takes a queued take away. Play, Stop, a seek, a new loop and
   * replace take it away too. Nothing is queued when stopped or played once.
   */
  readonly queue: (take: Take | null, onStart?: () => void) => void;
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
  /** The next block, and the segment it follows, which plays to its end rather than looping. */
  let queued: { segment: Segment; after: Segment; onStart: (() => void) | undefined } | null = null;
  const auditionBuffers = new WeakMap<AudioData, AudioBuffer>();
  let auditioning: AudioBufferSourceNode | null = null;
  let hitVoice: Voice | null = null;
  let region: { startTime: number; offset: number; duration: number; loop: boolean } | null = null;

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

  /** The part of a take a segment plays: played once, it rings out; looped, what rings past the end is already at the start. */
  const playedOf = (take: Take, once: boolean): { buffer: AudioBuffer; loop: LoopRange } => {
    const buffer = once ? (take.full ?? take.buffer) : take.buffer;
    return { buffer, loop: once ? { start: 0, end: buffer.duration } : fitLoop(range, buffer.duration) };
  };

  /** A source playing `buffer` into `gain`, looping `loop` unless `once`. */
  const sourceOf = (buffer: AudioBuffer, loop: LoopRange, once: boolean, gain: GainNode): AudioBufferSourceNode => {
    const source = ctx().createBufferSource();
    source.buffer = buffer;
    source.loop = !once;
    source.loopStart = loop.start;
    source.loopEnd = loop.end;
    source.connect(gain);
    return source;
  };

  /**
   * Starts a take at `at`, `from` seconds in; with `fadeIn`, from silence over
   * SWAP_FADE. A block that follows `before` from its start plays its first
   * turn with the tail of `before` instead of its own (afterTail), and then
   * loops its own buffer.
   */
  const start = (take: Take, at: number, from: number, once = false, fadeIn = false, before?: Take): Segment => {
    const c = ctx();
    const { buffer, loop } = playedOf(take, once);
    const offset = fadeIn ? from : startOffset(from, loop);
    const gain = c.createGain();
    if (fadeIn) {
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + SWAP_FADE);
    }
    gain.connect(c.destination);
    const source = sourceOf(buffer, loop, once, gain);
    const joined = before === undefined || once || offset !== 0 || loop.start > 1e-6 || loop.end < buffer.duration - 1e-6 ? null : afterTail(before, take);
    let lead: AudioBufferSourceNode | null = null;
    let loopFrom = at;
    if (joined !== null) {
      const first = c.createBuffer(joined.length, buffer.length, buffer.sampleRate);
      joined.forEach((data, ch) => first.copyToChannel(data as Float32Array<ArrayBuffer>, ch));
      lead = sourceOf(first, loop, true, gain);
      lead.start(at, 0);
      loopFrom = at + buffer.duration;
      source.start(loopFrom, 0);
    } else {
      source.start(at, offset);
    }
    const segment: Segment = { take, source, lead, loopFrom, cut: null, gain, startTime: at, offset, loop, once };
    if (once) {
      source.onended = () => {
        // Played out, or taken over from: the take after it, if any, is what plays.
        if (current?.source !== source) return;
        current = pending;
        pending = null;
      };
    }
    return segment;
  };

  /** Stops a segment's sources, at `at` or now. */
  const stopSegment = (segment: Segment, at?: number) => {
    for (const source of [segment.lead, segment.source]) {
      try {
        source?.stop(at);
      } catch {
        // Already stopped.
      }
    }
  };

  /** Fades a segment out from `at`, over SWAP_FADE, and stops it. */
  const fadeOut = (segment: Segment, at: number) => {
    segment.gain.gain.setValueAtTime(1, at);
    segment.gain.gain.linearRampToValueAtTime(0, at + SWAP_FADE);
    stopSegment(segment, at + SWAP_FADE);
  };

  /** Takes the queued take away: what it would have followed loops again. */
  const unqueue = () => {
    settle();
    if (queued === null) return;
    const { segment, after } = queued;
    queued = null;
    stopSegment(segment);
    if (after.cut === null) {
      after.source.loop = true;
      return;
    }
    // Its own buffer was stopped before it started: it gets a new one, from the same time.
    after.source = sourceOf(after.take.buffer, after.loop, false, after.gain);
    after.source.start(after.cut, 0);
    after.cut = null;
  };

  const stopAll = () => {
    unqueue();
    for (const segment of [current, pending]) if (segment !== null) stopSegment(segment);
    current = null;
    pending = null;
  };

  /** Promotes the pending take once its start time has come, and then the queued one. */
  function settle() {
    if (pending !== null && context !== null && context.currentTime >= pending.startTime) {
      current = pending;
      pending = null;
    }
    if (queued !== null && pending === null && context !== null && context.currentTime >= queued.segment.startTime) {
      const { segment, onStart } = queued;
      current = segment;
      queued = null;
      onStart?.();
    }
  }

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
    queue: (take, onStart) => {
      unqueue();
      const after = pending ?? current;
      // Only a take looped whole can play on to its end: a loop region within it would not.
      if (take === null || after === null || context === null || after.once || after.loop.start > 1e-6 || after.loop.end < (after.source.buffer?.duration ?? 0) - 1e-6) return;
      // The next time `after` reaches the end of its loop.
      const length = after.loop.end - after.loop.start;
      let at = after.startTime + (after.loop.end - after.offset);
      if (length > 0 && at < context.currentTime + MIN_LEAD) at += Math.ceil((context.currentTime + MIN_LEAD - at) / length) * length;
      if (after.lead !== null && at <= after.loopFrom + 1e-6) {
        // Still in its first turn: its own buffer never starts.
        after.source.stop(at);
        after.cut = at;
      } else {
        after.source.loop = false;
      }
      queued = { segment: start(take, at, 0, false, false, after.take), after, onStart };
      // Polling settles it too; this makes sure it is settled near the time.
      setTimeout(settle, Math.max(0, (at - context.currentTime) * 1000) + 5);
    },
    replace: (take) => {
      unqueue();
      settle();
      if (current === null || context === null) return;
      const { once } = current;
      const { loop } = playedOf(take, once);
      if (pending !== null) {
        // A newer take supersedes one that has not started yet: it takes over at the same time, from the same step.
        stopSegment(pending);
        const offset = onGrid(pending.offset, pending.take.step, take.step);
        const length = loop.end - loop.start;
        const fitted = once || offset < loop.end || length <= 0 ? offset : loop.start + ((offset - loop.start) % length);
        if (once && fitted >= loop.end) {
          pending = null;
          return;
        }
        pending = start(take, pending.startTime, fitted, once, true);
        return;
      }
      const swap = swapPoint(context.currentTime, current, current.take.step, take.step, { loop, once });
      if (swap === null) {
        // Played once, the new take is already over where the playhead is: it stops, as it would have.
        fadeOut(current, context.currentTime + MIN_LEAD);
        return;
      }
      fadeOut(current, swap.at);
      pending = start(take, swap.at, swap.offset, once, true);
    },
    seek: (seconds) => {
      if (current !== null) restart(seconds);
    },
    setLoop: (next) => {
      unqueue();
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
    isPlaying: () => {
      settle();
      return current !== null;
    },
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
      hitVoice = scheduleHit(c, project, hitPlay(project, hit), c.currentTime);
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
