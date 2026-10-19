// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, markUnsliced, ownMatrix, setSlicing } from '../model';
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
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    currentPosition: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={fakeServices()} />);
  await act(async () => {});
  return store;
}

const project = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const pressed = (name: string | RegExp) => button(name).getAttribute('aria-pressed');

/** A 2 s file, not sliced, marked Slice in Import or not. */
function oneShot(name: string, marked: boolean, cues?: readonly number[]): Command[] {
  const add = addSample({ name, audio: constantAudio(2), ...(cues === undefined ? {} : { cues }) });
  return [add, (p, c) => (marked ? markUnsliced(Object.values(p.samples).find((s) => s.name === name)!.id)(p, c) : { ok: true, project: p })];
}

const sample = (store: Store, i = 0) => Object.values(project(store).samples)[i]!;
const own = (store: Store, i = 0) => ownMatrix(project(store), sample(store, i).id)!;

describe('a sample is sliced in Slice, not in Import', () => {
  it('Slice in the table makes nothing: it shows Create Slices ↓, which selects it for slicing below', async () => {
    const store = await setup(build(...oneShot('amen.wav', false)), 'samples');
    expect(pressed('Slice amen 1')).toBe('false');
    fireEvent.click(button('Slice amen 1'));
    expect(sample(store)).toMatchObject({ bars: null, unsliced: true });
    expect(own(store)).toMatchObject({ loop: null });
    expect(own(store).pads).toHaveLength(1);
    expect(pressed('Slice amen 1')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Slice ↓' })).toBeNull();
    // Only the length: no bars or BPM before it is sliced.
    expect(screen.getByText('2000 ms')).toBeTruthy();
    fireEvent.click(button('Create Slices ↓'));
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: sample(store).id });
    expect(screen.getByText(/Not sliced yet/)).toBeTruthy();
  });

  it('Slice and Don\'t slice are one toggle, Slice: off again on a sample marked Slice is just as before', async () => {
    const store = await setup(build(...oneShot('amen.wav', true)), 'samples');
    expect(screen.queryByRole('button', { name: "Don't slice" })).toBeNull();
    expect(pressed('Slice amen 1')).toBe('true');
    fireEvent.click(button('Slice amen 1'));
    expect(pressed('Slice amen 1')).toBe('false');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect('unsliced' in sample(store)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Create Slices ↓' })).toBeNull();
  });

  it('the Trim column has no "not sliced"; a click selects a trim for slicing below', async () => {
    const store = await setup(build(...oneShot('amen.wav', true), ...oneShot('think.wav', false)), 'samples');
    expect(screen.queryByText('not sliced')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select think trim 1' }));
    expect(screen.getByRole('heading', { name: 'think 1' })).toBeTruthy();
    expect(store.getState().sliceTarget).toBe(sample(store, 1).id);
  });

  it('nothing is made until both bars and how are chosen, then all of it in one undo step', async () => {
    const store = await setup(build(...oneShot('amen.wav', true)), 'samples');
    // No cues in the file: no Cue markers, nothing chosen.
    expect(screen.queryByRole('button', { name: 'Cue markers' })).toBeNull();
    expect(pressed('1/16')).toBe('false');
    fireEvent.click(button('1/8'));
    expect(sample(store).bars).toBeNull();
    fireEvent.change(screen.getByLabelText('Bars in the sample'), { target: { value: '2' } });
    expect(sample(store)).toMatchObject({ bars: 2 });
    expect(sample(store).markers).toHaveLength(16);
    expect(own(store).pads).toHaveLength(16);
    expect(own(store).loop).not.toBeNull();
    expect('unsliced' in sample(store)).toBe(false);
    // Now the sample as sliced, its grid chosen.
    expect(pressed('1/8')).toBe('true');
    expect(screen.queryByText(/Not sliced yet/)).toBeNull();
    act(() => store.dispatch({ type: 'undo' }));
    expect(sample(store)).toMatchObject({ bars: null, unsliced: true });
    expect(own(store)).toMatchObject({ loop: null });
    expect(own(store).pads).toHaveLength(1);
  });

  it('a file with cue markers has Cue markers chosen to start with: the bars slice it at them', async () => {
    const store = await setup(build(...oneShot('cued.wav', false, [0.4, 1, 1.5])), 'samples');
    expect(sample(store)).toMatchObject({ bars: null, unsliced: true });
    expect(pressed('Cue markers')).toBe('true');
    fireEvent.change(screen.getByLabelText('Bars in the sample'), { target: { value: '1' } });
    expect(sample(store).markers.map((m) => m * 2)).toEqual([0, 0.4, 1, 1.5]);
    expect(pressed('Cue markers')).toBe('true');
    // The other ways stay to pick from, and the cues to go back to.
    fireEvent.click(button('1/4'));
    expect(sample(store).markers).toHaveLength(4);
    expect(pressed('Cue markers')).toBe('false');
  });
});

describe("Don't slice on a sliced sample", () => {
  const sliced = () => build(...oneShot('amen.wav', true), (p, c) => setSlicing(Object.keys(p.samples)[0]!, 1)(p, c));

  it('asks first, listing what goes; Cancel leaves it sliced', async () => {
    const store = await setup(sliced(), 'samples');
    fireEvent.click(button('Slice amen 1'));
    const dialog = screen.getByRole('alertdialog', { name: "Don't slice amen 1?" });
    expect(dialog.textContent).toContain('15 pads');
    expect(dialog.textContent).toContain('loop amen 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sample(store).bars).toBe(1);
    expect(pressed('Slice amen 1')).toBe('true');
  });

  it("Don't slice leaves a matrix of 1 pad with 1 hit", async () => {
    const store = await setup(sliced(), 'samples');
    fireEvent.click(button('Slice amen 1'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: "Don't slice" }));
    expect(sample(store)).toMatchObject({ bars: null });
    expect(own(store)).toMatchObject({ loop: null });
    expect(own(store).pads).toHaveLength(1);
    expect(screen.getByText(/^1 pad, 1 hit/)).toBeTruthy();
  });
});
