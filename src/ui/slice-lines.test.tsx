// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, cueMarkers, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { focusOn } from '../test/focus';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
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

/** Pads with the matrix of the selection in focus. */
async function open(project: Project, selection: { matrix?: string; hit?: string }) {
  const start = initialState(project);
  const store = createStore({ ...start, view: 'pads', focus: focusOn(project, selection), selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('slice lines: the matrix’s trim in Samples (decision 14)', () => {
  const amen = () => {
    // Sliced at the file's cues.
    const added = apply(createProject(), addSample({ name: 'Amen', audio: constantAudio(1), cues: [0.25, 0.5, 0.75] }));
    const sample = Object.values(added.samples)[0]!;
    return apply(added, setSlicing(sample.id, 1, cueMarkers(sample)!));
  };
  const matrixOf = (project: Project) => Object.values(project.matrices)[0]!;

  it('← Samples in Pads shows the trim with a line where each slice starts', async () => {
    const project = amen();
    const store = await open(project, { matrix: matrixOf(project).id });
    fireEvent.click(screen.getByRole('button', { name: '← Samples' }));
    expect(store.getState().view).toBe('samples');
    const lines = ['01', '02', '03', '04'].map((n) => screen.getByRole('button', { name: `Play slice ${n}` }));
    expect(lines.map((l) => l.style.left)).toEqual(['0%', '25%', '50%', '75%']);
  });

  it('shows none in Pads', async () => {
    const project = amen();
    const slice = Object.values(project.hits).find((h) => h.slice === 1)!;
    await open(project, { hit: slice.id });
    expect(screen.queryByLabelText(/^Slice 01:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play slice 01' })).toBeNull();
  });

  it('a click on a slice there selects it, to edit its marker', async () => {
    const project = amen();
    const sample = Object.values(project.samples)[0]!;
    const store = await open(project, { matrix: matrixOf(project).id });
    fireEvent.click(screen.getByRole('button', { name: '← Samples' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play slice 03' }));
    await act(async () => {});
    expect(store.getState()).toMatchObject({ view: 'samples', sliceTarget: sample.id });
    expect(screen.getByRole('button', { name: /^Marker 03 at/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
