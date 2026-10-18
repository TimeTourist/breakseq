// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addPad, addSample, copyHits, createLoop, createMatrix, createProject, renamePad, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
import type { Focus, Selection } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

const services = (): Services => ({
  storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
  player: {
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
  },
  renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
  renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
  exportWav: vi.fn(),
  exportMidi: vi.fn(),
  exportRex: vi.fn(),
  download: vi.fn(),
  rng: () => () => 0,
});

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/**
 * Two one-shot hats, and a matrix Hats: pad "hat" with copies of both, and a
 * second pad with another copy of the first. A loop has "hat" on step 1.
 */
function hats() {
  const sampled = apply(createProject(), addSample({ name: 'h1.wav', audio: constantAudio(0.1) }), addSample({ name: 'h2.wav', audio: constantAudio(0.1) }));
  const hits = Object.values(sampled.hits).map((h) => h.id);
  const made = apply(sampled, createMatrix('Hats'));
  const matrix = Object.values(made.matrices).find((m) => m.name === 'Hats')!;
  const first = matrix.pads[0]!;
  const withPads = apply(made, copyHits(hits, first), renamePad(first, 'hat'), addPad(matrix.id));
  const built = apply(withPads, copyHits([hits[0]!], withPads.matrices[matrix.id]!.pads[1]!), createLoop('M1', 'main', 1));
  const pad = built.pads[first]!;
  const loop = Object.values(built.loops)[0]!;
  return { project: apply(built, setStep(loop.id, 0, { padId: pad.id })), pad, loop, hits, matrix };
}

async function setup(project: Project, view: 'pads' | 'loops', selection: Partial<Selection>, focus: Focus = { matrix: null, takeFrom: [] }) {
  const start = initialState(project);
  const store = createStore({ ...start, view, focus, selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('the pad shelf in Loops follows the focus', () => {
  it('the shelf shows the focus and take from', async () => {
    const { project, loop, matrix } = hats();
    const h1 = Object.values(project.matrices).find((m) => m.name === 'h1 1')!;
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    const shelf = () => Array.from(document.querySelectorAll('.shelf-label')).map((e) => e.textContent!.trim());
    expect(shelf()).toEqual(['Hats']);
    expect(screen.getByRole('button', { name: 'Pad hat' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Choose what shows' })).toBeNull();

    fireEvent.click(within(screen.getByRole('group', { name: 'Take from' })).getByRole('button', { name: 'h1 1' }));
    expect(store.getState().focus.takeFrom).toEqual([h1.id]);
    expect(shelf()).toEqual(['Hats', 'h1 1']);
  });

  it('changing focus in Loops changes it in Pads', async () => {
    const { project, loop, matrix } = hats();
    const h1 = Object.values(project.matrices).find((m) => m.name === 'h1 1')!;
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    fireEvent.change(screen.getByRole('combobox', { name: 'Matrix in focus' }), { target: { value: h1.id } });
    expect(store.getState().focus.matrix).toBe(h1.id);
    store.dispatch({ type: 'view', view: 'pads' });
    await act(async () => {});
    expect((screen.getByRole('combobox', { name: 'Matrix in focus' }) as HTMLSelectElement).value).toBe(h1.id);
  });

  it('with no focus the shelf asks for one', async () => {
    const { project, loop } = hats();
    await setup(project, 'loops', { loop: loop.id });
    expect(screen.getByText(/Choose a matrix in focus/)).toBeTruthy();
  });

  it('an empty pad has no length label', async () => {
    const { project, loop, matrix } = hats();
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    expect(screen.getByRole('button', { name: 'Pad hat' }).textContent).toMatch(/·\d/);
    store.dispatch({ type: 'run', command: addPad(matrix.id) });
    await act(async () => {});
    const empty = store.getState().history.present.matrices[matrix.id]!.pads[2]!;
    const name = store.getState().history.present.pads[empty]!.name;
    expect(screen.getByRole('button', { name: `Pad ${name}` }).textContent).not.toMatch(/·/);
  });
});

describe('how long what is dragged from the shelf is', () => {
  it('shows a pad’s steps on its chip, and where it lands while dragged over a step', async () => {
    const { project, loop, matrix } = hats();
    const steps = Math.ceil(0.1 / (60 / project.song.bpm / 4) - 1e-9);
    await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    const chip = screen.getByRole('button', { name: 'Pad hat' });
    expect(chip.textContent).toBe(`hat ·${steps}`);

    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'copy' };
    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.dragOver(screen.getByRole('button', { name: 'Bar 1, step 3: empty' }), { dataTransfer });
    const landing = document.querySelector('.hold.landing') as HTMLElement;
    expect(landing.style.gridColumn).toBe(`4 / span ${steps}`);
    fireEvent.dragEnd(chip, { dataTransfer });
    expect(document.querySelector('.hold.landing')).toBeNull();
  });
});

describe('a click in the shelf', () => {
  it('plays the pad’s first hit, and selects it', async () => {
    const { project, loop, pad, matrix } = hats();
    const store = createStore({ ...initialState(project), view: 'loops', focus: { matrix: matrix.id, takeFrom: [] }, selection: { ...initialState(project).selection, loop: loop.id } });
    const s = services();
    render(<App store={store} services={s} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Pad hat' }));
    expect(s.player.playHit).toHaveBeenCalledWith(expect.anything(), pad.members[0]);
    expect(screen.getByRole('button', { name: 'Pad hat' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('from Loops to Pads', () => {
  it('a double-click on a pad in the shelf opens it in Pads', async () => {
    const { project, loop, pad, matrix } = hats();
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Pad hat' }));
    expect(store.getState().view).toBe('pads');
    expect(store.getState().selection).toMatchObject({ pad: pad.id, matrix: matrix.id });
  });
});

describe('a matrix in the shelf', () => {
  it('lays out its pads one after another when dropped on a step, and a double-click opens it in Pads', async () => {
    const { project, loop, matrix } = hats();
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    const chip = screen.getByRole('button', { name: 'Matrix Hats: lay out all its pads' });
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'copy' };
    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.drop(screen.getByRole('button', { name: 'Bar 1, step 5: empty' }), { dataTransfer });
    const steps = store.getState().history.present.loops[loop.id]!.steps;
    const pads = store.getState().history.present.matrices[matrix.id]!.pads;
    expect(steps[4]!.padId).toBe(pads[0]);
    expect(steps.filter((s) => s.padId === pads[1])).toHaveLength(1);

    fireEvent.doubleClick(chip);
    expect(store.getState().view).toBe('pads');
    expect(store.getState().selection).toMatchObject({ matrix: matrix.id, pad: null, hit: null });
  });
});

describe('matrices in the loop', () => {
  it('Matrix: Hats → swaps it for another matrix, row for row', async () => {
    const { project, loop, matrix } = hats();
    const store = await setup(project, 'loops', { loop: loop.id }, { matrix: matrix.id, takeFrom: [] });
    const h1 = Object.values(project.matrices).find((m) => m.name === 'h1 1')!;
    const swaps = within(screen.getByLabelText('Matrices in the loop'));
    expect(swaps.getByRole('button', { name: 'Hats' })).toBeTruthy();
    fireEvent.change(swaps.getByRole('combobox', { name: 'Swap Hats for' }), { target: { value: h1.id } });
    expect(store.getState().history.present.loops[loop.id]!.steps[0]!.padId).toBe(h1.pads[0]);
  });
});

describe('playing a matrix from Loops', () => {
  /** Services whose renders are 2 s of two channels, so a matrix played once can be heard as an audition. */
  function rendering() {
    const s = services();
    const buffer = { duration: 2, sampleRate: 100, numberOfChannels: 2, getChannelData: () => new Float32Array(200) } as unknown as AudioBuffer;
    const renderSong = vi.fn(() => Promise.resolve({ buffer, triggers: [], tapes: [] } satisfies Take));
    return { services: { ...s, renderSong } satisfies Services, renderSong };
  }

  async function open(project: Project, loopId: string, matrixId: string) {
    const { services: s, renderSong } = rendering();
    const store = createStore({ ...initialState(project), view: 'loops', focus: { matrix: matrixId, takeFrom: [] }, selection: { ...initialState(project).selection, loop: loopId } });
    render(<App store={store} services={s} />);
    await act(async () => {});
    renderSong.mockClear();
    return { s, renderSong };
  }

  /** The loop the render laid the matrix out in: its pads, step by step. */
  const laidOut = (renderSong: ReturnType<typeof vi.fn>) => {
    const rendered = renderSong.mock.calls[0]![0] as Project;
    return rendered.loops['preview-matrix']!.steps.flatMap((st) => (st.padId === null ? [] : [st.padId]));
  };

  it('a click on a matrix in the shelf selects it and plays it once, as laid out', async () => {
    const { project, loop, matrix } = hats();
    const { s, renderSong } = await open(project, loop.id, matrix.id);
    const chip = screen.getByRole('button', { name: 'Matrix Hats: lay out all its pads' });
    await act(async () => void fireEvent.click(chip));
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(laidOut(renderSong)).toEqual(project.matrices[matrix.id]!.pads);
    expect(s.player.audition).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 100 }), 0, 2);
  });
});
