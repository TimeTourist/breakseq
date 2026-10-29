import { describe, expect, it } from 'vitest';
import { newProject, setBpm } from '../../model';
import { sequentialIds } from '../../test/fixtures';
import { createStore, initialState } from '../store';
import type { Bridge } from './bridge';
import { bridgeHost, pluginPlayer } from './plugin-services';
import type { MixerCommand } from './remote-audio';
import { FloatBuffer, remoteAudio } from './remote-audio';
import type { Services } from '../services';

const ctx = sequentialIds();

function fakeBridge(info: unknown = null) {
  const sent: MixerCommand[] = [];
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const bridge: Bridge = {
    call: (name, ...params) => {
      if (name === 'audio') sent.push(...(params[0] as MixerCommand[]));
      return Promise.resolve(name === 'hostInfo' ? info : null);
    },
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== listener));
    },
  };
  return { bridge, sent, emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((l) => l(payload)) };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('bridgeHost', () => {
  it("gives Reason's tempo now and then each change, until told to stop", async () => {
    const { bridge, emit } = fakeBridge({ bpm: 172, sampleRate: 48000 });
    const heard: number[] = [];
    const stop = bridgeHost(bridge).onTempo((bpm) => heard.push(bpm));
    await settle();
    emit('tempo', 174);
    stop();
    emit('tempo', 90);
    expect(heard).toEqual([172, 174]);
  });
});

describe('hostTempo in the store', () => {
  it('sets the tempo in every state of the history, so it is no undo step and Undo keeps it', () => {
    const store = createStore(initialState(newProject(ctx)));
    store.dispatch({ type: 'run', command: setBpm(140) });
    store.dispatch({ type: 'hostTempo', bpm: 172 });
    expect(store.getState().history.present.song.bpm).toBe(172);
    expect(store.getState().history.past).toHaveLength(1);
    store.dispatch({ type: 'undo' });
    expect(store.getState().history.present.song.bpm).toBe(172);
  });
});

describe('pluginPlayer', () => {
  it('renders a clicked hit and plays it as one buffer; another click before it is ready wins', async () => {
    const { bridge, sent } = fakeBridge();
    const audio = remoteAudio(bridge);
    const rendered: number[] = [];
    const renderPreview: Services['renderPreview'] = () => {
      const n = rendered.push(rendered.length);
      return Promise.resolve({ buffer: new FloatBuffer(1, 10 * n, 100) as unknown as AudioBuffer, triggers: [], tapes: [] });
    };
    const player = pluginPlayer(audio, renderPreview);
    const project = newProject(ctx);
    player.playHit(project, 'a');
    player.playHit(project, 'b');
    await settle();
    expect(sent.filter((c) => c.op === 'start')).toHaveLength(1);
    expect(sent.find((c) => c.op === 'start')).toMatchObject({ gain: 0 });
  });
});
