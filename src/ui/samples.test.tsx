// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, Command, Project } from '../model';
import { addSample, addTrim, copyHits, createMatrix, createProject, ownMatrix, sliceSample } from '../model';
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
const pressed = (name: string | RegExp) => within(screen.getByRole('group', { name: 'Slices' })).getByRole('button', { name }).getAttribute('aria-pressed');
const first = (p: Project) => Object.values(p.samples)[0]!;
const named = (p: Project, name: string) => Object.values(p.samples).find((s) => s.name === name)!;

/** Short bursts at `times` seconds in silence: something for Transients to find. */
function clicks(times: readonly number[], seconds = 2, sampleRate = 8000): AudioData {
  const channel = new Float32Array(seconds * sampleRate);
  for (const t of times) for (let i = 0; i < 400; i++) channel[Math.round(t * sampleRate) + i] = 0.9 * Math.exp(-i / 60);
  return { sampleRate, channels: [channel, channel.slice()] };
}

describe('Samples: one page (Magnus beslut)', () => {
  it('a file dropped anywhere on the page is imported; while files are dragged over it, Drop to import covers it', async () => {
    const store = await setup(createProject());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const page = screen.getByRole('main');
    fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop to import')).toBeTruthy();
    fireEvent.dragLeave(page, { dataTransfer: { types: ['Files'] } });
    expect(screen.queryByText('Drop to import')).toBeNull();
    const wav = new File([new Uint8Array(encodeWav(constantAudio(2)))], 'amen.wav');
    fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(screen.getByRole('region', { name: 'Files' }), { dataTransfer: { files: [wav], types: ['Files'] } });
    await waitFor(() => expect(samples(store)).toHaveLength(1));
    expect(screen.queryByText('Drop to import')).toBeNull();
    // A one shot, then sliced at once by 1/16 of a guessed bar, in the same tab.
    expect(pressed('None')).toBe('true');
    fireEvent.click(button('1/16'));
    expect(samples(store)[0]).toMatchObject({ bars: 1 });
    expect(samples(store)[0]!.markers).toHaveLength(16);
    expect(store.getState().view).toBe('samples');
    expect(button('Play slice 16')).toBeTruthy();
  });

  it("the sample's waveform shows its slices numbered", async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)));
    const lines = ['01', '02', '03', '04'].map((n) => button(`Play slice ${n}`));
    expect(lines.map((l) => l.textContent)).toEqual(['01', '02', '03', '04']);
    expect(lines.map((l) => l.style.left)).toEqual(['0%', '25%', '50%', '75%']);
  });

  it('the row under the tabs: the file as text · the sample, larger, › 1 matrix → › 1 loop → (Magnus beslut)', async () => {
    const project = build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4));
    const own = ownMatrix(project, first(project).id)!;
    const store = await setup(project);
    const row = screen.getByRole('navigation', { name: 'Where you are' });
    expect(row.textContent).toBe('amen.wav·sample 1›1 matrix →›1 loop →');
    expect(row.querySelector('.crumb-current')!.textContent).toBe('sample 1');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['1 matrix →', '1 loop →']);
    const matrix = within(row).getByRole('button', { name: '1 matrix →' });
    expect(matrix.title).toBe('Matrix amen 1 (4 pads), in Matrices');
    fireEvent.click(matrix);
    expect(store.getState()).toMatchObject({ view: 'pads', focus: { matrix: own.id, shown: own.id } });
  });

  it('a one shot has the row too, with its matrix and no loop; the page has no links to other tabs', async () => {
    const project = build(() => addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    await setup(project);
    const row = screen.getByRole('navigation', { name: 'Where you are' });
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['1 matrix →']);
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /[←→]/ })).toBeNull();
  });
});

describe('New sample from slices (Magnus beslut)', () => {
  it('a click picks a slice, Shift-click picks a run of them; the button makes a sample of them and selects it', async () => {
    const store = await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 8)));
    expect(button('New sample from slice 01')).toBeTruthy();
    fireEvent.click(button('Play slice 05'));
    expect(button('New sample from slice 05')).toBeTruthy();
    fireEvent.click(button('Play slice 03'), { shiftKey: true });
    expect(['03', '04', '05'].map((n) => button(`Play slice ${n}`).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
    fireEvent.click(button('New sample from slices 03–05'));
    expect(samples(store)).toHaveLength(2);
    const made = samples(store).find((s) => s.trim === 2)!;
    expect(store.getState().sliceTarget).toBe(made.id);
    // In the tempo of the sample it came from: 3/8 of its one bar. (Magnus beslut)
    expect(made).toMatchObject({ offset: 0.5, duration: 0.75, bars: 0.375 });
    expect(made.markers).toHaveLength(3);
    expect((screen.getByLabelText('Bars in the sample') as HTMLInputElement).value).toBe('0.375');
    expect(screen.getByText('= 120.00 BPM')).toBeTruthy();
    // The sample it came from stays as it is.
    expect(first(present(store)).markers).toHaveLength(8);
  });

  it('one slice makes a one shot', async () => {
    const store = await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)));
    fireEvent.click(button('Play slice 02'));
    fireEvent.click(button('New sample from slice 02'));
    const made = samples(store).find((s) => s.trim === 2)!;
    expect(made).toMatchObject({ offset: 0.5, duration: 0.5, bars: null });
    expect(pressed('None')).toBe('true');
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

describe('bars in 1/16 steps (Claudes val.)', () => {
  it('Bars takes a part of a bar, to the nearest 1/16', async () => {
    const store = await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 16)));
    const bars = screen.getByLabelText('Bars in the sample');
    fireEvent.change(bars, { target: { value: '0.3' } });
    fireEvent.blur(bars);
    expect(first(present(store)).bars).toBe(0.3125);
    expect(first(present(store)).markers).toHaveLength(5);
    expect(within(screen.getByRole('region', { name: 'Files' })).getByText('0.3125 bars')).toBeTruthy();
  });
});

describe('U5: every sample is listed', () => {
  it('one shots do not say "not sliced", and a click shows one in the editor', async () => {
    const project = build(
      () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
      (p) => sliceSample(first(p).id, 1, 4),
      (p) => addTrim(first(p).id),
      () => addSample({ name: 'snare.wav', audio: constantAudio(0.3) }),
    );
    const store = await setup(project);
    const rows = [...document.querySelectorAll('.sample-row')];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent?.includes('not sliced'))).toEqual([false, false, false]);
    fireEvent.click(button('Select snare sample 1'));
    expect(store.getState().sliceTarget).toBe(named(present(store), 'snare.wav').id);
    expect(button('Play snare 1')).toBeTruthy();
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
    fireEvent.click(button('Transients'));
    expect(pressed('Transients')).toBe('true');
    expect(pressed('1/16')).toBe('false');
    act(() => void store.dispatch({ type: 'undo' }));
    expect(pressed('Transients')).toBe('false');
    expect(pressed('1/16')).toBe('true');
    act(() => void store.dispatch({ type: 'redo' }));
    expect(pressed('Transients')).toBe('true');
  });
});

describe('trimming keeps markers at transients in the file (Magnus beslut)', () => {
  it('they stay where the hits are, one near the new start goes, and Transients stays chosen', async () => {
    const store = await setup(
      build(
        () => addSample({ name: 'amen.wav', audio: clicks([0, 0.3, 0.9, 1.4]) }),
        (p) => sliceSample(first(p).id, 1, 16),
      ),
    );
    fireEvent.click(button('Transients'));
    const inFile = () => {
      const s = first(present(store));
      return s.markers.map((m) => Math.round((s.offset + m * s.duration) * 100) / 100);
    };
    expect(inFile()).toEqual([0, 0.3, 0.9, 1.4]);
    // 10 ms before the hit at 0.3 s: no tiny slice before it.
    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '290' } });
    fireEvent.blur(screen.getByLabelText('Start ms'));
    expect(inFile()).toEqual([0.29, 0.9, 1.4]);
    expect(pressed('Transients')).toBe('true');
    // Back to the start: the hits there are found again.
    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '0' } });
    fireEvent.blur(screen.getByLabelText('Start ms'));
    expect(inFile()).toEqual([0, 0.3, 0.9, 1.4]);
    expect(pressed('Transients')).toBe('true');
  });
});

describe('double clicks on the waveform (Magnus beslut)', () => {
  it('on a marker deletes it, but not the first', async () => {
    const store = await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => sliceSample(first(p).id, 1, 4)));
    expect(first(present(store)).markers).toEqual([0, 0.25, 0.5, 0.75]);
    fireEvent.doubleClick(screen.getByRole('button', { name: /^Marker 03/ }));
    expect(first(present(store)).markers).toEqual([0, 0.25, 0.75]);
    fireEvent.doubleClick(screen.getByRole('button', { name: /^Marker 01/ }));
    expect(first(present(store)).markers).toEqual([0, 0.25, 0.75]);
  });
});

describe('Snap to nearest slice (Magnus beslut)', () => {
  it('on, ←/→ take a handle from slice point to slice point in the file; off, 1 ms', async () => {
    const store = await setup(
      build(
        () => addSample({ name: 'amen.wav', audio: clicks([0, 0.3, 0.9, 1.4]) }),
        (p) => sliceSample(first(p).id, 1, 16),
      ),
    );
    fireEvent.click(button('Transients'));
    const startMs = () => Math.round(first(present(store)).offset * 1000);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Start at/ }), { key: 'ArrowRight' });
    expect(startMs()).toBe(1);
    fireEvent.click(button('Snap to nearest slice'));
    expect(button('Snap to nearest slice').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Start at/ }), { key: 'ArrowRight' });
    expect(startMs()).toBe(299);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Start at/ }), { key: 'ArrowRight' });
    expect(startMs()).toBe(899);
    // The hit at 0.3 s is no slice now, but still a point in the file to go back to.
    expect(first(present(store)).markers).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Start at/ }), { key: 'ArrowLeft' });
    expect(startMs()).toBe(299);
  });
});

describe('one thing plays at a time in Samples', () => {
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

describe('U19: Delete sample on the last sample of a file', () => {
  it('says the file goes with it', async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) })));
    fireEvent.click(button(/^Delete sample/));
    expect(within(screen.getByRole('alertdialog')).getByText('file amen.wav')).toBeTruthy();
  });

  it('but not while the file has another sample', async () => {
    await setup(build(() => addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p) => addTrim(first(p).id)));
    fireEvent.click(screen.getAllByRole('button', { name: /^Delete sample/ })[0]!);
    expect(within(screen.getByRole('alertdialog')).queryByText('file amen.wav')).toBeNull();
  });
});

describe('Play at the top in Samples', () => {
  it('plays the selected sample, sliced or not (Magnus beslut)', () => {
    const project = build(
      () => addSample({ name: 'amen.wav', audio: constantAudio(2) }),
      (p) => sliceSample(first(p).id, 1, 4),
      () => addSample({ name: 'snare.wav', audio: constantAudio(0.3) }),
    );
    const snare = named(project, 'snare.wav');
    const state = { ...initialState(project), view: 'samples' as const };
    expect(subjectOf(project, state)?.key).toBe(`sample:${first(project).id}`);
    expect(subjectOf(project, { ...state, sliceTarget: snare.id })?.key).toBe(`sample:${snare.id}`);
  });
});
