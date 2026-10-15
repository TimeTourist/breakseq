// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBreak } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function fakeServices(): Services {
  return services ?? (services = makeServices());
}

let services: Services | null = null;
afterEach(() => {
  services = null;
});

function makeServices(): Services {
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
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

function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject(ctx));
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={fakeServices()} />);
  await act(async () => {});
  return store;
}

const sample = (store: Store) => Object.values(store.getState().history.present.samples).find((s) => s.sliceOf === null)!;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Trim in Import', () => {
  it('the start and end fields set the window, and one edit is one undo step', async () => {
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'import');
    fireEvent.click(button('Trim amen.wav'));

    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '25' } });
    fireEvent.blur(screen.getByLabelText('Start ms'));
    fireEvent.change(screen.getByLabelText('End ms'), { target: { value: '1900' } });

    expect(sample(store).offset).toBeCloseTo(0.025);
    expect(sample(store).duration).toBeCloseTo(1.875);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(sample(store).duration).toBeCloseTo(1.975);
  });
});

describe('Markers in Slice', () => {
  /** A 2 s, one-bar break with markers on 1/16, open in Slice. */
  async function sliceSetup() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setBreak(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setBreak failed');
    return setup(result.project, 'slice');
  }

  it('←/→ nudges the selected marker by 1 ms, Shift by 10 ms', async () => {
    const store = await sliceSetup();
    const before = sample(store).break!.markers[2]!;
    const marker = button(/^Marker 3 at/);
    fireEvent.focus(marker);

    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    fireEvent.keyDown(marker, { key: 'ArrowLeft', shiftKey: true });

    expect(sample(store).break!.markers[2]).toBeCloseTo(before + 0.001 - 0.01, 6);
  });

  it('Add marker splits the selected slice, and Remove marker takes it out again', async () => {
    const store = await sliceSetup();
    fireEvent.click(button('Play slice 4'));
    const [a, b] = [sample(store).break!.markers[3]!, sample(store).break!.markers[4]!];

    fireEvent.click(button('Add marker'));
    expect(sample(store).break!.markers).toHaveLength(17);
    expect(sample(store).break!.markers[4]).toBeCloseTo((a + b) / 2);

    fireEvent.click(button('Remove marker'));
    expect(sample(store).break!.markers).toHaveLength(16);
  });

  it('Apply slices and Re-slice take turns', async () => {
    const store = await sliceSetup();
    fireEvent.click(button('Apply slices'));
    expect(sample(store).break!.sliced).toBe(true);
    expect(Object.keys(store.getState().history.present.loops)).toHaveLength(1);

    fireEvent.click(button('Re-slice'));
    expect(sample(store).break!.sliced).toBe(false);
    expect(Object.keys(store.getState().history.present.loops)).toHaveLength(0);
  });
});

describe('Playing while trimming', () => {
  it('a break plays looped by default, follows the trim while it plays, and Once restarts it once', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(project.samples)[0]!;
    const asBreak = setBreak(id, 1)(project, ctx);
    if (!asBreak.ok) throw new Error('setBreak failed');
    await setup(asBreak.project, 'import');
    const player = fakeServices().player;
    fireEvent.click(button('Trim amen.wav'));

    fireEvent.click(button('Play trimmed'));
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.[4]).toBe(true);

    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '100' } });
    expect(player.setAuditionRegion).toHaveBeenCalledWith(0.1, expect.closeTo(1.9, 6));

    fireEvent.click(button('Once'));
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.[4]).toBe(false);
  });

  it('a one-shot plays once by default', async () => {
    await setup(build(addSample({ name: 'snare.wav', audio: constantAudio(0.3) })), 'import');
    fireEvent.click(button('Trim snare.wav'));
    fireEvent.click(button('Play trimmed'));
    expect(vi.mocked(fakeServices().player.audition).mock.calls.at(-1)?.[4]).toBe(false);
  });
});
