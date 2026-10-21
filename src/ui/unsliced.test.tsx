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
    queue: vi.fn(),
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

/** A 2 s file, not sliced, marked Slice in Import or not. */
function oneShot(name: string, marked: boolean, cues?: readonly number[]): Command[] {
  const add = addSample({ name, audio: constantAudio(2), ...(cues === undefined ? {} : { cues }) });
  return [add, (p, c) => (marked ? markUnsliced(Object.values(p.samples).find((s) => s.name === name)!.id)(p, c) : { ok: true, project: p })];
}

const sample = (store: Store, i = 0) => Object.values(project(store).samples)[i]!;
const own = (store: Store, i = 0) => ownMatrix(project(store), sample(store, i).id)!;

const slicesPressed = (name: string) => within(screen.getByRole('group', { name: 'Slices' })).getByRole('button', { name }).getAttribute('aria-pressed');
const slices = (name: string) => within(screen.getByRole('group', { name: 'Slices' })).getByRole('button', { name });

describe('Slices: None, or how it is sliced (Magnus beslut)', () => {
  it('a one shot has None chosen; Transients slices it at once at guessed bars, in one undo step', async () => {
    const store = await setup(build(...oneShot('amen.wav', false)), 'samples');
    expect(slicesPressed('None')).toBe('true');
    fireEvent.click(slices('Transients'));
    // 2 s guesses 1 bar (120 BPM).
    expect(sample(store).bars).toBe(1);
    expect('unsliced' in sample(store)).toBe(false);
    expect(own(store).loop).not.toBeNull();
    expect(slicesPressed('None')).toBe('false');
    expect(slicesPressed('Transients')).toBe('true');
    expect(screen.getByText('= 120.00 BPM')).toBeTruthy();
    // One undo step back to the one shot.
    fireEvent.click(button(/^Undo/));
    expect(sample(store).bars).toBeNull();
    expect(slicesPressed('None')).toBe('true');
  });

  it('a grid slices at once too: 1/8 of a guessed bar', async () => {
    const store = await setup(build(...oneShot('amen.wav', false)), 'samples');
    fireEvent.click(slices('1/8'));
    expect(sample(store)).toMatchObject({ bars: 1 });
    expect(sample(store).markers).toHaveLength(8);
    expect(own(store).pads).toHaveLength(8);
    expect(slicesPressed('1/8')).toBe('true');
    // The bars change the grid with them.
    fireEvent.change(screen.getByLabelText('Bars in the sample'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Bars in the sample'));
    expect(sample(store).markers).toHaveLength(16);
  });

  it('a file with cue markers is a one shot that offers Cues: they slice it at its cues and guessed bars', async () => {
    const store = await setup(build(...oneShot('cued.wav', false, [0.4, 1, 1.5])), 'samples');
    expect(sample(store)).toMatchObject({ bars: null, unsliced: true });
    expect(slicesPressed('None')).toBe('true');
    fireEvent.click(slices('Cues'));
    expect(sample(store).markers.map((m) => m * 2)).toEqual([0, 0.4, 1, 1.5]);
    expect(slicesPressed('Cues')).toBe('true');
    // The other ways stay to pick from, and the cues to go back to.
    fireEvent.click(slices('1/4'));
    expect(sample(store).markers).toHaveLength(4);
    expect(slicesPressed('Cues')).toBe('false');
  });

  it('no Cues without cue markers in the sample', async () => {
    await setup(build(...oneShot('amen.wav', false)), 'samples');
    expect(within(screen.getByRole('group', { name: 'Slices' })).queryByRole('button', { name: 'Cues' })).toBeNull();
  });

  it('no Slice toggle, Type, Create Slices or Bars before it is sliced', async () => {
    await setup(build(...oneShot('amen.wav', true)), 'samples');
    expect(screen.queryByRole('button', { name: /^Slice amen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Slices ↓' })).toBeNull();
    expect(screen.queryByLabelText('Bars in the sample')).toBeNull();
    expect(screen.getByText('2000 ms', { selector: '.slices-row span' })).toBeTruthy();
  });
});

describe("None on a sliced sample", () => {
  const sliced = () => build(...oneShot('amen.wav', true), (p, c) => setSlicing(Object.keys(p.samples)[0]!, 1)(p, c));

  it('asks first, listing what goes; Cancel leaves it sliced', async () => {
    const store = await setup(sliced(), 'samples');
    fireEvent.click(slices('None'));
    const dialog = screen.getByRole('alertdialog', { name: "Don't slice amen 1?" });
    expect(dialog.textContent).toContain('15 pads');
    expect(dialog.textContent).toContain('loop amen 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sample(store).bars).toBe(1);
    expect(slicesPressed('None')).toBe('false');
  });

  it("Don't slice leaves a matrix of 1 pad with 1 hit, a one shot", async () => {
    const store = await setup(sliced(), 'samples');
    fireEvent.click(slices('None'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: "Don't slice" }));
    expect(sample(store)).toMatchObject({ bars: null });
    expect(own(store)).toMatchObject({ loop: null });
    expect(own(store).pads).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Files' })).getByText('one shot')).toBeTruthy();
  });
});
