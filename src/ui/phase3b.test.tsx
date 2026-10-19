// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, addTrim, createProject, ownMatrix, setSlicing } from '../model';
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

const sample = (store: Store) => Object.values(store.getState().history.present.samples)[0]!;
/** The first sample's own matrix. */
const own = (store: Store) => ownMatrix(store.getState().history.present, sample(store).id)!;
/** The sample's markers in seconds: it is 2 s long. */
const markers = (store: Store) => sample(store).markers.map((m) => m * 2);
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Trim in Samples', () => {
  it('the start and end fields set the window, and one edit is one undo step', async () => {
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'samples');

    fireEvent.change(screen.getByLabelText('Start ms'), { target: { value: '25' } });
    fireEvent.blur(screen.getByLabelText('Start ms'));
    fireEvent.change(screen.getByLabelText('End ms'), { target: { value: '1900' } });

    expect(sample(store).offset).toBeCloseTo(0.025);
    expect(sample(store).duration).toBeCloseTo(1.875);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(sample(store).duration).toBeCloseTo(1.975);
  });
});

describe('Markers in Samples', () => {
  /** A 2 s, one-bar sample with markers on 1/16, selected in Samples. */
  async function sliceSetup() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setSlicing failed');
    return setup(result.project, 'samples');
  }

  it('Delete and Backspace delete the selected slice’s marker, but not while typing in a field', async () => {
    const store = await sliceSetup();
    fireEvent.click(button('Play slice 04'));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(markers(store)).toHaveLength(15);
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(markers(store)).toHaveLength(14);
    // In the Bars field, Backspace is the field's.
    fireEvent.keyDown(screen.getByLabelText('Bars in the sample'), { key: 'Backspace' });
    expect(markers(store)).toHaveLength(14);
    // The first marker, at the start, stays.
    fireEvent.click(button('Play slice 01'));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(markers(store)).toHaveLength(14);
  });

  it('←/→ nudges the selected marker by 1 ms, Shift by 10 ms', async () => {
    const store = await sliceSetup();
    const before = markers(store)[2]!;
    const marker = button(/^Marker 03 at/);
    fireEvent.focus(marker);

    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    fireEvent.keyDown(marker, { key: 'ArrowLeft', shiftKey: true });

    expect(markers(store)[2]).toBeCloseTo(before + 0.001 - 0.01, 6);
  });

  it('there is no row for the selected slice: no Add marker, Delete marker or Slice heading (Magnus beslut)', async () => {
    await sliceSetup();
    expect(screen.queryByRole('button', { name: 'Add marker' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete marker' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Slice / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New matrix from slice' })).toBeNull();
  });

  it('there is nothing to apply: the matrix has its pads and loop straight away, and markers move while the loop is in use', async () => {
    const store = await sliceSetup();
    expect(screen.queryByRole('button', { name: 'Apply slices' })).toBeNull();
    expect(own(store).pads).toHaveLength(16);
    expect(Object.values(store.getState().history.present.loops).map((l) => l.name)).toEqual(['amen 1']);

    fireEvent.click(button('Play slice 02'));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(markers(store)).toHaveLength(15);
  });
});

describe('Play in Samples (Magnus beslut)', () => {
  it('the header plays the whole selected sample, looped while Loop is on; the editor has no Play of its own', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const sliced = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!sliced.ok) throw new Error('setSlicing failed');
    const store = await setup(sliced.project, 'samples');
    const player = fakeServices().player;
    expect(within(screen.getByRole('region', { name: 'Sample' })).queryByRole('button', { name: /^((Play|Stop)( sample| trim)?|Loop)$/ })).toBeNull();
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    expect(button('Loop').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Play'));
    expect(vi.mocked(player.play).mock.calls.at(-1)?.[2]).toBe(false);
    expect(player.audition).not.toHaveBeenCalled();
    fireEvent.click(button('Stop'));
    // Loop off: it plays once.
    fireEvent.click(button('Loop'));
    expect(store.getState().loop).toBe(false);
    fireEvent.click(button('Play'));
    expect(vi.mocked(player.play).mock.calls.at(-1)?.[2]).toBe(true);
  });

  it('the header has BPM, Play, Loop, Undo, Redo, Save and New snapshot, in that order; Loop works in Song too', async () => {
    const store = await setup(build(addSample({ name: 'snare.wav', audio: constantAudio(0.3) })), 'samples');
    const transport = document.querySelector('.transport')!;
    const order = [...transport.querySelectorAll('input, button')].map((e) => e.getAttribute('aria-label') ?? e.textContent);
    expect(order).toEqual(['Tempo in BPM', 'Play', 'Loop', 'Nothing to undo', 'Nothing to redo', 'Save', 'New snapshot']);
    act(() => void store.dispatch({ type: 'view', view: 'song' }));
    expect((button('Loop') as HTMLButtonElement).disabled).toBe(false);
    // Off, the song plays from its start point to its end, once. (Magnus beslut)
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Loop'));
    fireEvent.click(button('Play'));
    expect(vi.mocked(fakeServices().player.play).mock.calls.at(-1)?.[2]).toBe(true);
    fireEvent.click(button('Stop'));
    fireEvent.click(button('Loop'));
    fireEvent.click(button('Play'));
    expect(vi.mocked(fakeServices().player.play).mock.calls.at(-1)?.[2]).toBe(false);
  });
});

describe('files and samples in the GUI', () => {
  async function sliced() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setSlicing failed');
    return result.project;
  }

  it('New sample makes a new sample of the whole file, last under it, and selects it', async () => {
    const store = await setup(await sliced(), 'samples');
    fireEvent.click(screen.getByRole('button', { name: 'New sample of amen.wav' }));
    expect(Object.values(store.getState().history.present.matrices).map((m) => m.name)).toEqual(['amen 1', 'amen 2']);
    const second = Object.values(store.getState().history.present.samples).find((s) => s.trim === 2)!;
    expect(store.getState().sliceTarget).toBe(second.id);
    expect(button('Select amen sample 2').getAttribute('aria-pressed')).toBe('true');
  });

  it('Matrices renames the matrix, and the row under the tabs links to its sample in Samples', async () => {
    const project = await sliced();
    const matrix = Object.values(project.matrices)[0]!;
    const sample = Object.values(project.samples)[0]!;
    const store = createStore({ ...initialState(project), view: 'pads', focus: { matrix: matrix.id, takeFrom: [] } });
    render(<App store={store} services={fakeServices()} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Matrix name'), { target: { value: 'think' } });
    expect(store.getState().history.present.matrices[matrix.id]!.name).toBe('think');
    expect(store.getState().history.present.pads[matrix.pads[0]!]!.name).toBe('think 01');
    const link = within(screen.getByRole('navigation', { name: 'Where you are' })).getByRole('button', { name: 'sample 1' });
    expect(link.title).toBe('amen sample 1, in Samples');
    fireEvent.click(link);
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: sample.id });
  });
});

describe('the file list (Magnus beslut)', () => {
  it('each sample has a row: its number, slices or one shot, and its length', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setSlicing failed');
    const two = addTrim(Object.keys(project.samples)[0]!, { offset: 0, duration: 0.25 })(result.project, ctx);
    if (!two.ok) throw new Error('addTrim failed');
    await setup(two.project, 'samples');
    const list = screen.getByRole('region', { name: 'Files' });
    expect([...list.querySelectorAll('.sample-pick')].map((r) => r.textContent)).toEqual(['116 slices1 bar', '2one shot250 ms']);
  });

  it('a file folds to how many samples it has; Collapse all and Expand all fold every file', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }), (p, c) => addTrim(Object.keys(p.samples)[0]!)(p, c), addSample({ name: 'snare.wav', audio: constantAudio(0.3) }));
    await setup(project, 'samples');
    const list = screen.getByRole('region', { name: 'Files' });
    const rows = () => list.querySelectorAll('.sample-row').length;
    expect(rows()).toBe(3);
    fireEvent.click(button('Hide the samples of amen.wav'));
    expect(rows()).toBe(1);
    expect(within(list).getByText('2 samples')).toBeTruthy();
    fireEvent.click(button('Show the samples of amen.wav'));
    expect(rows()).toBe(3);
    // A click on the file's row folds it too; its buttons keep their own. (Magnus beslut)
    fireEvent.click(within(list).getByText('amen.wav'));
    expect(rows()).toBe(1);
    fireEvent.click(within(list).getByText('amen.wav'));
    expect(rows()).toBe(3);
    fireEvent.click(button('New sample of amen.wav'));
    expect(rows()).toBe(4);
    fireEvent.click(button('Collapse all'));
    expect(rows()).toBe(0);
    fireEvent.click(button('Expand all'));
    expect(rows()).toBe(4);
  });

  it('the list starts with Browse files…, …or drag and drop and Collapse all, on one row', async () => {
    await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'samples');
    const head = document.querySelector('.file-list-head')!;
    expect([...head.children].filter((e) => e.tagName !== 'INPUT').map((e) => e.getAttribute('aria-label') ?? e.textContent)).toEqual(['Browse files…', '…or drag and drop', 'Collapse all']);
    // No drop area and no heading: the whole page takes files.
    expect(document.querySelector('.dropzone')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
