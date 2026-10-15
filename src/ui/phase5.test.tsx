// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, Command, Project } from '../model';
import { addSample, createLoop, createProject, setBreak, setSongCell } from '../model';
import { sequentialIds } from '../test/fixtures';
import { App } from './App';
import { CELL_MIME } from './dnd';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    audition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [] } satisfies Take),
    exportWav: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/** Two seconds with sharp hits at 0.25, 0.8 and 1.4 s. */
function hits(): AudioData {
  const sr = 44100;
  const x = new Float32Array(2 * sr);
  for (const at of [0.25, 0.8, 1.4]) {
    for (let i = 0; i < 0.1 * sr; i++) x[Math.round(at * sr) + i] = Math.sin(i * 1.3) * Math.exp(-i / 800) * 0.8;
  }
  return { sampleRate: sr, channels: [x] };
}

describe('Transients in Slice', () => {
  it('puts markers on the hits', async () => {
    const project = apply(createProject(ctx), addSample({ name: 'break.wav', audio: hits() }));
    const store = await setup(apply(project, setBreak(Object.keys(project.samples)[0]!, 1)), 'slice');

    fireEvent.click(button('Transients'));

    const markers = Object.values(present(store).samples)[0]!.break!.markers;
    expect(markers.map((m) => Math.round(m * 100) / 100)).toEqual([0, 0.25, 0.8, 1.4]);
  });
});

describe('Dragging in Song', () => {
  function placed() {
    const project = apply(createProject(ctx), createLoop(null, 'main', 1));
    const loop = Object.values(project.loops)[0]!;
    return { project: apply(project, setSongCell('main', 1, loop.id)), loop };
  }
  /** Drops a dragged cell; happy-dom leaves altKey off drag events, so it is set on the event itself. */
  const drag = (from: number, to: number, altKey: boolean, loopId: string) => {
    const target = button(new RegExp(`^Bar ${to}:`));
    const event = createEvent.drop(target, {
      dataTransfer: {
        types: [CELL_MIME],
        getData: (t: string) => (t === CELL_MIME ? JSON.stringify({ row: 'main', bar: from - 1, id: loopId }) : ''),
      },
    });
    Object.defineProperty(event, 'altKey', { value: altKey });
    fireEvent(target, event);
  };

  it('dragging a placed loop moves it; one undo puts it back', async () => {
    const { project, loop } = placed();
    const store = await setup(project, 'song');

    drag(2, 5, false, loop.id);

    expect(present(store).song.rows.main.slice(0, 6)).toEqual([null, null, null, null, loop.id, null]);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(present(store).song.rows.main[1]).toBe(loop.id);
  });

  it('with Alt it copies', async () => {
    const { project, loop } = placed();
    const store = await setup(project, 'song');

    drag(2, 5, true, loop.id);

    expect(present(store).song.rows.main[1]).toBe(loop.id);
    expect(present(store).song.rows.main[4]).toBe(loop.id);
  });
});

describe('Tag guesses', () => {
  it('Guess tags marks guesses auto, and Confirm all auto confirms them', async () => {
    const project = apply(createProject(ctx), addSample({ name: 'hit.wav', audio: hits() }));
    const store = await setup(project, 'tag');

    fireEvent.click(button('Guess tags'));
    const sample = Object.values(present(store).samples)[0]!;
    expect(sample.mainTag).not.toBeNull();
    expect(sample.tagGuessed).toBe(true);
    expect(screen.getByText('auto')).toBeTruthy();

    fireEvent.click(button('Confirm all auto'));
    expect(Object.values(present(store).samples)[0]!.tagGuessed).toBe(false);
  });
});
