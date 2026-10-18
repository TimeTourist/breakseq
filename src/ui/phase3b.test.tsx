// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, ownMatrix, setSlicing } from '../model';
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
    fireEvent.click(button('Trim amen trim 1'));

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

  it('← Trim opens the sample’s Trim in the table', async () => {
    const store = await sliceSetup();
    fireEvent.click(screen.getByRole('button', { name: '← Trim' }));
    expect(store.getState()).toMatchObject({ view: 'samples', trimming: sample(store).id });
    expect(screen.getByRole('button', { name: 'Trim amen trim 1' }).getAttribute('aria-expanded')).toBe('true');
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

  it('Add marker splits the selected slice, and Delete marker takes it out again', async () => {
    const store = await sliceSetup();
    fireEvent.click(button('Play slice 04'));
    const [a, b] = [markers(store)[3]!, markers(store)[4]!];

    fireEvent.click(button('Add marker'));
    expect(markers(store)).toHaveLength(17);
    expect(markers(store)[4]).toBeCloseTo((a + b) / 2);
    expect(own(store).pads).toHaveLength(17);

    fireEvent.click(button('Delete marker'));
    expect(markers(store)).toHaveLength(16);
    // The 17th pad stays, silent.
    expect(own(store).pads).toHaveLength(17);
  });

  it('there is nothing to apply: the matrix has its pads and loop straight away, and markers move while the loop is in use', async () => {
    const store = await sliceSetup();
    expect(screen.queryByRole('button', { name: 'Apply slices' })).toBeNull();
    expect(own(store).pads).toHaveLength(16);
    expect(Object.values(store.getState().history.present.loops).map((l) => l.name)).toEqual(['amen 1']);

    fireEvent.click(button('Play slice 02'));
    fireEvent.click(button('Delete marker'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(markers(store)).toHaveLength(15);
  });
});

describe('Playing while trimming', () => {
  // U7: the Trim's ▶ is Play at the top, which plays the open Trim looped; there is no second playback.
  it("a sliced sample's ▶ plays the trim at the top, looped", async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const sliced = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!sliced.ok) throw new Error('setSlicing failed');
    await setup(sliced.project, 'samples');
    const player = fakeServices().player;
    fireEvent.click(button('Trim amen trim 1'));
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Play trim'));
    expect(vi.mocked(player.play).mock.calls.at(-1)?.[2]).toBe(false);
    expect(player.audition).not.toHaveBeenCalled();
    // Looped as Play at the top plays it: the Trim has no Loop of its own.
    expect(within(document.querySelector('.trim')!).queryByRole('button', { name: 'Loop' })).toBeNull();
  });

  it('a sample not sliced loops by default, as everything does', async () => {
    await setup(build(addSample({ name: 'snare.wav', audio: constantAudio(0.3) })), 'samples');
    fireEvent.click(button('Trim snare trim 1'));
    await waitFor(() => expect((button('Play') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button('Play trim'));
    expect(vi.mocked(fakeServices().player.play).mock.calls.at(-1)?.[2]).toBe(false);
  });
});

describe('files, trims and matrices in the GUI', () => {
  async function sliced() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const result = setSlicing(Object.keys(project.samples)[0]!, 1)(project, ctx);
    if (!result.ok) throw new Error('setSlicing failed');
    return result.project;
  }

  it('Samples makes a new trim of a file on a row of its own, with its Trim open', async () => {
    const store = await setup(await sliced(), 'samples');
    fireEvent.click(screen.getByRole('button', { name: 'New trim of amen.wav' }));
    expect(Object.values(store.getState().history.present.matrices).map((m) => m.name)).toEqual(['amen 1', 'amen 2']);
    expect(screen.getByRole('button', { name: 'Trim amen trim 2' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Hits renames the matrix, and shows its slice, trim and file as links', async () => {
    const project = await sliced();
    const matrix = Object.values(project.matrices)[0]!;
    const sample = Object.values(project.samples)[0]!;
    const store = createStore({ ...initialState(project), view: 'pads', selection: { ...initialState(project).selection, matrix: matrix.id } });
    render(<App store={store} services={fakeServices()} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Matrix name'), { target: { value: 'think' } });
    expect(store.getState().history.present.matrices[matrix.id]!.name).toBe('think');
    expect(store.getState().history.present.pads[matrix.pads[0]!]!.name).toBe('think 01');
    // Plays and Replace with file are gone (decision 11).
    expect(screen.queryByRole('combobox', { name: 'Trim under the break' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Replace with file/ })).toBeNull();
    // ← Trim ← Slice and the file, the full names in their titles.
    const origin = screen.getByRole('button', { name: '← Slice' }).closest('.origin')!;
    expect([...origin.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['← Trim', '← Slice', 'amen.wav']);
    expect(screen.getByRole('button', { name: '← Slice' }).title).toBe('Open amen slice 1 in Samples');
    fireEvent.click(screen.getByRole('button', { name: '← Slice' }));
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: sample.id });
  });

  it('Slicing has no Replace sample; Pads → opens the matrix in focus, and New matrix from slice makes a matrix of the slice', async () => {
    const store = await setup(await sliced(), 'samples');
    expect(screen.queryByRole('button', { name: 'Replace sample…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New matrix from slice' }));
    const matrices = Object.values(store.getState().history.present.matrices);
    expect(matrices.map((m) => m.name)).toEqual(['amen 1', 'amen 2']);
    expect(matrices[1]!.pads).toHaveLength(1);
    const slicing = screen.getByRole('region', { name: 'Slicing' });
    fireEvent.click(within(slicing).getAllByRole('button', { name: 'Pads →' })[0]!);
    expect(store.getState()).toMatchObject({ view: 'pads', focus: { matrix: matrices[0]!.id }, selection: { matrix: matrices[0]!.id, pad: null, hit: null } });
  });
});

describe('the open Trim in Samples', () => {
  it('opens and closes again and again, even where scrolling returns a promise', async () => {
    // Newer browsers' scroll methods return a promise; an effect that returned one crashed the app.
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => Promise.resolve() as unknown as void);
    const scrollIntoView = vi.fn(() => Promise.resolve());
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
    await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'samples');
    for (let i = 0; i < 4; i++) fireEvent.click(button('Trim amen trim 1'));
    expect(button('Trim amen trim 1').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button('Trim amen trim 1'));
    expect(button('Trim amen trim 1').getAttribute('aria-expanded')).toBe('true');
    scrollBy.mockRestore();
  });

  it('closes on a click outside it, but not on a click in it or in the header', async () => {
    const store = await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'samples');
    fireEvent.click(button('Trim amen trim 1'));
    fireEvent.pointerDown(screen.getByLabelText('Start ms'));
    fireEvent.pointerDown(document.querySelector('.header')!);
    expect(store.getState().trimming).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Samples' }));
    expect(store.getState().trimming).toBeNull();
  });
});

describe('Creates in Samples', () => {
  it('counts the slices, pads and the loops that play the matrix, own loop first', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const id = Object.keys(project.samples)[0]!;
    const sliced = setSlicing(id, 1)(project, ctx);
    if (!sliced.ok) throw new Error('setSlicing failed');
    const matrix = ownMatrix(sliced.project, id)!;
    const store = await setup(sliced.project, 'samples');
    const row = screen.getByRole('button', { name: 'Slice ↓' }).closest('tr')!;
    expect(row.textContent).toContain('16 Slice ↓');
    expect(row.textContent).toContain('16 pads, 16 hits Pads →');
    expect(row.textContent).toContain('1 Loops →');
    fireEvent.click(screen.getByRole('button', { name: 'Loops →' }));
    expect(store.getState()).toMatchObject({ view: 'loops', selection: { loop: matrix.loop } });
  });
});

describe('two trims and a file in Samples', () => {
  it('a press on another Trim opens that one, closing the first', async () => {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }));
    const store = await setup(project, 'samples');
    fireEvent.click(button('New trim of amen.wav'));
    fireEvent.click(button('Trim amen trim 1'));
    fireEvent.pointerDown(button('Trim amen trim 2'));
    fireEvent.click(button('Trim amen trim 2'));
    const second = Object.values(store.getState().history.present.samples).find((s) => s.trim === 2)!;
    expect(store.getState().trimming).toBe(second.id);
  });

  it('▶ on the file plays the whole file once, and ■ stops it', async () => {
    await setup(build(addSample({ name: 'amen.wav', audio: constantAudio(2) })), 'samples');
    const player = fakeServices().player;
    fireEvent.click(button('Play amen.wav'));
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.slice(1, 3)).toEqual([0, 2]);
    expect(vi.mocked(player.audition).mock.calls.at(-1)?.[4]).toBe(false);
    fireEvent.click(button('Stop amen.wav'));
    expect(player.stopAudition).toHaveBeenCalled();
    expect(button('Play amen.wav')).toBeTruthy();
  });
});
