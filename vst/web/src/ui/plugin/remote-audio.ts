import type { Bridge } from './bridge';
import { floatsToBase64 } from './bridge';

/**
 * An AudioContext that plays through the plugin: the web app's player
 * (createPlayer) schedules buffers and gain ramps on it as on a real one, and
 * every call goes to the C++ mixer, which plays them on Reason's sample clock.
 * Only what the player uses is here: buffer sources, gains with setValueAtTime
 * and linearRampToValueAtTime, and the destination.
 *
 * Commands made in one task go to C++ together, in order. A buffer goes over
 * the first time a source with it starts, and is let go when the page drops it.
 */

/** A command for the C++ mixer (see vst/src/Mixer.h). Times are seconds on Reason's clock. */
export type MixerCommand =
  | { readonly op: 'buffer'; readonly id: number; readonly rate: number; readonly channels: readonly string[] }
  | { readonly op: 'release'; readonly id: number }
  | { readonly op: 'gain'; readonly id: number; readonly value: number }
  | { readonly op: 'gainValue'; readonly id: number; readonly value: number }
  | { readonly op: 'gainSet'; readonly id: number; readonly time: number; readonly value: number }
  | { readonly op: 'gainRamp'; readonly id: number; readonly time: number; readonly value: number }
  | {
      readonly op: 'start';
      readonly id: number;
      readonly buffer: number;
      /** 0 for straight to the output. */
      readonly gain: number;
      readonly when: number;
      readonly offset: number;
      /** Seconds to play, or -1 for until stopped or played out. */
      readonly duration: number;
      readonly loop: boolean;
      readonly loopStart: number;
      readonly loopEnd: number;
    }
  | { readonly op: 'loop'; readonly id: number; readonly loop: boolean; readonly loopStart: number; readonly loopEnd: number }
  | { readonly op: 'stop'; readonly id: number; readonly when: number }
  | { readonly op: 'stopAll' };

/** What the C++ side says of its clock: seconds since it started counting samples, and its sample rate. */
export interface Clock {
  readonly time: number;
  readonly rate: number;
}

/** A buffer made by the page (createBuffer): plain arrays, as the player only reads and fills them. */
export class FloatBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`No channel ${channel}`);
    return data;
  }

  copyToChannel(source: Float32Array, channel: number, start = 0): void {
    this.getChannelData(channel).set(source.subarray(0, this.length - start), start);
  }
}

/** The part of an AudioBuffer the mixer needs. */
type Buffer = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'duration' | 'getChannelData'>;

export interface RemoteAudio {
  /** The context to hand to createPlayer. */
  readonly context: AudioContext;
  /** Stops everything on the C++ side, as when the page goes away. */
  readonly stopAll: () => void;
}

/** Seconds on the clock now: the last report moved on by the time since, never backwards. */
export function clockNow(clock: Clock | null, receivedAt: number, now: number, last: number): number {
  if (clock === null) return last;
  return Math.max(last, clock.time + Math.max(0, now - receivedAt) / 1000);
}

export function remoteAudio(bridge: Bridge, now: () => number = () => performance.now()): RemoteAudio {
  let commands: MixerCommand[] = [];
  const send = (command: MixerCommand) => {
    if (commands.length === 0) queueMicrotask(flush);
    commands.push(command);
  };
  function flush() {
    const batch = commands;
    commands = [];
    if (batch.length > 0) void bridge.call('audio', batch);
  }

  let clock: Clock | null = null;
  let receivedAt = 0;
  let last = 0;
  bridge.on('clock', (payload) => {
    clock = payload as Clock;
    receivedAt = now();
  });
  const currentTime = () => (last = clockNow(clock, receivedAt, now(), last));

  let nextId = 1;
  const bufferIds = new WeakMap<object, number>();
  const released = typeof FinalizationRegistry === 'undefined' ? null : new FinalizationRegistry<number>((id) => send({ op: 'release', id }));
  const bufferId = (buffer: Buffer): number => {
    const known = bufferIds.get(buffer);
    if (known !== undefined) return known;
    const id = nextId++;
    bufferIds.set(buffer, id);
    released?.register(buffer, id);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => floatsToBase64(buffer.getChannelData(c)));
    send({ op: 'buffer', id, rate: buffer.sampleRate, channels });
    return id;
  };

  const ended = new Map<number, Source>();
  bridge.on('ended', (payload) => {
    for (const id of (payload as { ids: readonly number[] }).ids) {
      const source = ended.get(id);
      ended.delete(id);
      source?.onended?.call(source as unknown as AudioScheduledSourceNode, new Event('ended'));
    }
  });

  const destination = { kind: 'destination' } as const;

  class Param {
    private current: number;
    constructor(
      private readonly id: number,
      value: number,
    ) {
      this.current = value;
    }
    get value() {
      return this.current;
    }
    set value(value: number) {
      this.current = value;
      send({ op: 'gainValue', id: this.id, value });
    }
    setValueAtTime(value: number, time: number) {
      send({ op: 'gainSet', id: this.id, time, value });
      return this;
    }
    linearRampToValueAtTime(value: number, time: number) {
      send({ op: 'gainRamp', id: this.id, time, value });
      return this;
    }
  }

  class Gain {
    readonly id = nextId++;
    readonly gain: Param;
    constructor() {
      this.gain = new Param(this.id, 1);
      send({ op: 'gain', id: this.id, value: 1 });
    }
    // Every gain plays to the output: the player connects each to the destination.
    connect() {
      return destination;
    }
    disconnect() {}
  }

  class Source {
    readonly id = nextId++;
    buffer: Buffer | null = null;
    onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null = null;
    private target: Gain | null = null;
    private started = false;
    private stopped = false;
    private looped = false;
    private start_ = 0;
    private end_ = 0;

    get loop() {
      return this.looped;
    }
    set loop(value: boolean) {
      this.looped = value;
      this.update();
    }
    get loopStart() {
      return this.start_;
    }
    set loopStart(value: number) {
      this.start_ = value;
      this.update();
    }
    get loopEnd() {
      return this.end_;
    }
    set loopEnd(value: number) {
      this.end_ = value;
      this.update();
    }

    connect(node: unknown) {
      this.target = node instanceof Gain ? node : null;
      return node;
    }
    disconnect() {}

    start(when = 0, offset = 0, duration?: number) {
      if (this.started) throw new DOMException('start called twice', 'InvalidStateError');
      if (this.buffer === null) return;
      this.started = true;
      ended.set(this.id, this);
      send({
        op: 'start',
        id: this.id,
        buffer: bufferId(this.buffer),
        gain: this.target?.id ?? 0,
        when,
        offset,
        duration: duration ?? -1,
        loop: this.looped,
        loopStart: this.start_,
        loopEnd: this.end_,
      });
    }

    stop(when = 0) {
      if (!this.started) throw new DOMException('stop before start', 'InvalidStateError');
      if (this.stopped) return;
      this.stopped = true;
      send({ op: 'stop', id: this.id, when });
    }

    private update() {
      if (this.started && !this.stopped) send({ op: 'loop', id: this.id, loop: this.looped, loopStart: this.start_, loopEnd: this.end_ });
    }
  }

  const context = {
    get currentTime() {
      return currentTime();
    },
    get sampleRate() {
      return clock?.rate ?? 44100;
    },
    state: 'running',
    resume: () => Promise.resolve(),
    destination,
    createGain: () => new Gain(),
    createBufferSource: () => new Source(),
    createBuffer: (channels: number, length: number, rate: number) => new FloatBuffer(channels, length, rate),
  };

  return {
    // Only the part of AudioContext above exists: createPlayer uses no more.
    context: context as unknown as AudioContext,
    stopAll: () => send({ op: 'stopAll' }),
  };
}
