// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, Command, Project } from '../model';
import { addPad, addSample, addTrim, copyHits, createMatrix, createProject, ownMatrix, sliceSample } from '../model';
import { encodeWav } from '../engine';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';
import { subjectOf } from './subject';

afterEach(cleanup);

/** A player that knows whether it plays, so the header follows it. */
function fakePlayer(): Player {
  let playing = false;
  return {
    play: vi.fn(() => {
      playing = true;
    }),
    replace: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    stop: vi.fn(() => {
      playing = false;
    }),
    isPlaying: () => playing,
    currentTrigger: () => null,
    currentPosition: () => 0,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  };
}

const makeServices = (player: Player = fakePlayer()): Services => ({
  storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
  player,
  renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
  renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
  exportWav: vi.fn(),
  exportMidi: vi.fn(),
  exportRex: vi.fn(),
  download: vi.fn(),
  rng: () => () => 0,
});

function build(...commands: ((p: Project) => Command)[]): Project {
  const ctx = sequentialIds();
  return commands.reduce((p, c) => {
    const r = c(p)(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

async function setup(project: Project, services: Services = makeServices()): Promise<Store> {
  const store = createStore({ ...initialState(project), view: 'samples' });
  render(<App store={store} services={services} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const samples = (store: Store) => Object.values(present(store).samples);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const pressed = (name: string | RegExp) => within(screen.getByRole('group', { name: 'Slice by' })).getByRole('button', { name }).getAttribute('aria-pressed');
const first = (p: Project) => Object.values(p.samples)[0]!;
const named = (p: Project, name: string) => Object.values(p.samples).find((s) => s.name === name)!;

/** Short bursts at `times` seconds in silence: something for Transients to find. */
function clicks(times: readonly number[], seconds = 2, sampleRate = 8000): AudioData {
  const channel = new Float32Array(seconds * sampleRate);
  for (const t of times) for (let i = 0; i < 400; i++) channel[Math.round(t * sampleRate) + i] = 0.9 * Math.exp(-i / 60);
  return { sampleRate, channels: [channel, channel.slice()] };
}

describe('Samples: one page', () => {
  it('importing and slicing Amen happens in one tab', async () => {
    const store = await setup(createProject());
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Samples']);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const wav = new File([new Uint8Array(encodeWav(constantAudio(2)))], 'amen.wav');
    fireEvent.drop(document.querySelector('.dropzone')!, { dataTransfer: { files: [wav] } });
    await waitFor(() => expect(samples(store)).toHaveLength(1));
    fireEvent.click(button('Slice'));
    expect(screen.getByText(/Not sliced yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Bars in the sample'), { target: { value: '1' } });
    fireEvent.click(button('1/16'));
    expect(samples(store)[0]).toMatchObject({ bars: 1 });
    expect(samples(store)[0]!.markers).toHaveLength(16);
    expect(store.getState().view).toBe('samples');
    // The table and the slicing, both on the page.
    expect(button('Slice ↓')).toBeTruthy();
    expect(button('Play slice 16')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it("the trim's waveform shows its slices numbered", async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)));
    const lines = ['01', '02', '03', '04'].map((n) => button(`Play slice ${n}`));
    expect(lines.map((l) => l.textContent)).toEqual(['01', '02', '03', '04']);
    expect(lines.map((l) => l.style.left)).toEqual(['0%', '25%', '50%', '75%']);
  });

  it('Pads → sets the focus to the trim’s matrix and opens Pads', async () => {
    const project = build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4));
    const own = ownMatrix(project, first(project).id)!;
    const store = await setup(project);
    const row = button('Loops →').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Pads →' }));
    expect(store.getState()).toMatchObject({ view: 'pads', focus: { matrix: own.id } });
  });
});

describe('U1: Enter in Bars', () => {
  /** A 2 s sample sliced in four, and a matrix Snares with a copy of slice 02: changing the bars renumbers a used slice. */
  const amenAndSnares = () =>
    build(
      () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
      (p) => sliceSample(first(p).id, 1, 4),
      () => createMatrix('Snares'),
      (p) => {
        const amen = ownMatrix(p, first(p).id)!;
        const snares = Object.values(p.matrices).find((m) => m.name === 'Snares')!;
        return copyHits([p.pads[amen.pads[1]!]!.members[0]!], snares.pads[0]!);
      },
    );

  it('shows the dialog, which takes no button focus, and a blur after it does nothing', async () => {
    const store = await setup(amenAndSnares());
    const before = present(store);
    const bars = screen.getByLabelText('Bars in the sample');
    bars.focus();
    fireEvent.change(bars, { target: { value: '2' } });
    const enter = fireEvent.keyDown(bars, { key: 'Enter' });
    expect(enter).toBe(false);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(present(store)).toBe(before);
    // No button in the dialog has focus, so a key or click meant for the field cannot answer it.
    expect(screen.getByRole('alertdialog').contains(document.activeElement) && document.activeElement?.tagName === 'BUTTON').toBe(false);
    fireEvent.blur(bars);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(present(store)).toBe(before);
    fireEvent.click(button('Renumber'));
    expect(samples(store)).toHaveLength(1);
    expect(samples(store)[0]).toMatchObject({ bars: 2 });
  });
});

describe('U5: every trim is listed', () => {
  it('trims not sliced say so, and a click shows one below', async () => {
    const project = build(
      () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
      (p) => sliceSample(first(p).id, 1, 4),
      (p) => addTrim(first(p).id),
      () => addSample({ name: 'snare.wav', audio: constantAudio(0.3) }),
    );
    const store = await setup(project);
    const rows = [...document.querySelectorAll('table.sources tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent?.includes('not sliced'))).toEqual([false, true, true]);
    fireEvent.click(button('Select snare trim 1'));
    expect(store.getState().sliceTarget).toBe(named(present(store), 'snare.wav').id);
    expect(screen.getByRole('heading', { name: 'snare 1' })).toBeTruthy();
    expect(screen.getByText(/Not sliced yet/)).toBeTruthy();
  });
});

describe('U6: how it is sliced follows the markers', () => {
  it('Transients is chosen while its markers are, and says so; undo goes back to the grid', async () => {
    const store = await setup(
      build(
        () => addSample({ name: 'amen.wav', audio: clicks([0, 0.3, 0.9, 1.4]) }),
        (p) => sliceSample(first(p).id, 1, 16),
      ),
    );
    expect(pressed('1/16')).toBe('true');
    expect(screen.getByText(/16 slices · equal 1\/16$/)).toBeTruthy();
    fireEvent.click(button('Transients'));
    expect(pressed('Transients')).toBe('true');
    expect(pressed('1/16')).toBe('false');
    expect(screen.queryByText(/own markers/)).toBeNull();
    expect(screen.getByText(/slices · transients$/)).toBeTruthy();
    act(() => void store.dispatch({ type: 'undo' }));
    expect(pressed('Transients')).toBe('false');
    expect(pressed('1/16')).toBe('true');
    expect(screen.getByText(/16 slices · equal 1\/16$/)).toBeTruthy();
    act(() => void store.dispatch({ type: 'redo' }));
    expect(pressed('Transients')).toBe('true');
  });
});

describe("U7: the trim's ▶ is the header's Play", () => {
  it('one stops the other', async () => {
    const player = fakePlayer();
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) })), makeServices(player));
    fireEvent.click(button('Trim amen trim 1'));
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Play trim'));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.audition).not.toHaveBeenCalled();
    expect(button('Stop')).toBeTruthy();
    fireEvent.click(button('Stop'));
    expect(button('Play trim')).toBeTruthy();
    fireEvent.click(button('Play'));
    expect(button('Stop trim')).toBeTruthy();
    fireEvent.click(button('Stop trim'));
    expect(button('Play')).toBeTruthy();
    expect(player.stop).toHaveBeenCalledTimes(2);
  });
});

describe('one thing plays at a time in Samples', () => {
  it("the trim's ▶ waits for its own render: before it, Play would start what was shown before", async () => {
    const player = fakePlayer();
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) })), makeServices(player));
    fireEvent.click(button('Trim amen trim 1'));
    expect((button('Play trim') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((button('Play trim') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Play trim'));
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('a click on a slice to hear it stops Play in the header first', async () => {
    const player = fakePlayer();
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)), makeServices(player));
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Play'));
    expect(button('Stop')).toBeTruthy();
    fireEvent.click(button('Play slice 02'));
    expect(player.stop).toHaveBeenCalledTimes(1);
    expect(player.audition).toHaveBeenCalledTimes(1);
    expect(button('Play')).toBeTruthy();
  });
});

describe('U12: Creates counts the pads and hits of the matrix', () => {
  it('a trim not sliced whose matrix has 2 pads and 3 hits', async () => {
    const project = build(
      () => addSample({ name: 'snare_02.wav', audio: constantAudio(0.3) }),
      (p) => addPad(ownMatrix(p, first(p).id)!.id),
      (p) => {
        const own = ownMatrix(p, first(p).id)!;
        const hit = p.pads[own.pads[0]!]!.members[0]!;
        return copyHits([hit], own.pads[1]!);
      },
      (p) => {
        const own = ownMatrix(p, first(p).id)!;
        return copyHits([p.pads[own.pads[0]!]!.members[0]!], own.pads[1]!);
      },
    );
    await setup(project);
    // The whole cell: the matrix's count and the link, nothing about one hit.
    expect(button('Pads →').closest('.creates')!.textContent).toBe('2 pads, 3 hits Pads →');
  });
});

describe('U13: no object is named one-shot', () => {
  it('New matrix from slice makes a matrix of the slice, opened in Pads with focus', async () => {
    const store = await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)));
    expect(screen.queryByRole('button', { name: /one-shot/i })).toBeNull();
    fireEvent.click(button('New matrix from slice'));
    const made = Object.values(present(store).matrices).find((m) => m.name === 'amen 2')!;
    expect(made.pads).toHaveLength(1);
    expect(screen.queryByText(/one-shot/i)).toBeNull();
    fireEvent.click(within(button('New matrix from slice').closest('section')!).getByRole('button', { name: 'Pads →' }));
    expect(store.getState()).toMatchObject({ view: 'pads', focus: { matrix: made.id } });
  });
});

describe('U19: Delete trim on the last trim of a file', () => {
  it('says the file goes with it', async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) })));
    fireEvent.click(button(/^Delete trim/));
    expect(within(screen.getByRole('alertdialog')).getByText('file amen.wav')).toBeTruthy();
  });

  it('but not while the file has another trim', async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => addTrim(first(p).id)));
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete trim/ })[0]!);
    expect(within(screen.getByRole('alertdialog')).queryByText('file amen.wav')).toBeNull();
  });
});

describe('Play at the top in Samples', () => {
  it("plays the selected trim's matrix, also one not sliced", () => {
    const project = build(
      () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
      (p) => sliceSample(first(p).id, 1, 4),
      () => addSample({ name: 'snare.wav', audio: constantAudio(0.3) }),
    );
    const snare = named(project, 'snare.wav');
    const state = { ...initialState(project), view: 'samples' as const };
    expect(subjectOf(project, state)?.key).toBe(`matrix:${ownMatrix(project, first(project).id)!.id}`);
    expect(subjectOf(project, { ...state, sliceTarget: snare.id })?.key).toBe(`matrix:${ownMatrix(project, snare.id)!.id}`);
  });
});
