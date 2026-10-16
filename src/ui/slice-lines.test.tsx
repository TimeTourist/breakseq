// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
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

async function open(project: Project, hitId: string) {
  const start = initialState(project);
  const store = createStore({ ...start, view: 'hits', selection: { ...start.selection, hit: hitId } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('slice lines on the parent in Hits', () => {
  const amen = () => {
    // A file with cues is a break sliced at them.
    return apply(createProject(), addSample({ name: 'Amen', audio: constantAudio(1), cues: [0.25, 0.5, 0.75] }));
  };

  it('shows a line where each slice starts', async () => {
    const project = amen();
    const brk = Object.values(project.breaks)[0]!;
    await open(project, brk.parent!);
    const lines = ['01', '02', '03', '04'].map((n) => screen.getByLabelText(new RegExp(`^Slice ${n}:`)) as HTMLElement);
    expect(lines.map((l) => l.style.left)).toEqual(['0%', '25%', '50%', '75%']);
  });

  it('shows none on a slice', async () => {
    const project = amen();
    const slice = Object.values(project.hits).find((h) => h.slot === 1)!;
    await open(project, slice.id);
    expect(screen.queryByLabelText(/^Slice 01:/)).toBeNull();
  });

  it('a double-click on a line opens that slice in Slice', async () => {
    const project = amen();
    const brk = Object.values(project.breaks)[0]!;
    const store = await open(project, brk.parent!);
    fireEvent.doubleClick(screen.getByLabelText(/^Slice 03:/));
    await act(async () => {});
    expect(store.getState()).toMatchObject({ view: 'slice', sliceTarget: brk.id });
    expect(screen.getByRole('button', { name: /^Marker 3 at/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
