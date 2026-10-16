// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBpm, setBreak, setMarkers, sliceAtMarkers } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player } from './playback';
import type { Services } from './services';
import type { View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

function services(): Services {
  const player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    currentPosition: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  } satisfies Player;
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: vi.fn(),
    exportWav: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

/** One bar of 2 s at 120 BPM, split +-|+-|+-----------: slices of 2, 2 and 12 steps. */
function split(slice: boolean, markers: number[] = [0, 0.25, 0.5]): Project {
  const ctx = sequentialIds();
  const commands: Command[] = [addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120)];
  let project = commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
  const id = Object.keys(project.samples)[0]!;
  for (const c of [setBreak(id, 1), setMarkers(id, markers), ...(slice ? [sliceAtMarkers(id)] : [])]) {
    const r = c(project, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    project = r.project;
  }
  return project;
}

async function setup(project: Project, view: View) {
  render(<App store={createStore({ ...initialState(project), view })} services={services()} />);
  await act(async () => {});
}

/** The width of each cell's reach line, in percent, or 0 without one. */
const widths = (cells: HTMLElement[]) => cells.map((c) => parseFloat(c.querySelector<HTMLElement>('.reach')?.style.width ?? '0'));

describe('hit lengths', () => {
  it('Loops shows each slice of the laid out parent with its tail: 2, 2 and 12 steps', async () => {
    await setup(split(true), 'loops');
    const steps = screen.getAllByRole('button', { name: /^Bar 1, step \d+:/ });
    expect(steps).toHaveLength(16);
    expect(widths(steps)).toEqual(Array.from({ length: 16 }, () => 100));
    // Only the steps with a hit have a solid line; the rest are tails.
    expect(steps.map((s) => s.querySelector('.reach.tail') !== null)).toEqual(steps.map((_, i) => ![0, 2, 4].includes(i)));
  });

  it('Slice shows where each slice lands on the 1/16 grid, with its length', async () => {
    await setup(split(false), 'slice');
    const strip = screen.getByLabelText('Where the slices land on the 1/16 grid');
    const cells = within(strip).getAllByLabelText(/^Step /);
    expect(cells).toHaveLength(16);
    expect(cells.map((c) => c.textContent)).toEqual(['01', '', '02', '', '03', ...Array.from({ length: 11 }, () => '')]);
    expect(widths(cells)).toEqual(Array.from({ length: 16 }, () => 100));
  });

  it('Slice marks a step where two slices land, since the second is dropped', async () => {
    // A step is 0.125 s: 0.3 and 0.31 both land on step 3.
    await setup(split(false, [0, 0.3, 0.31, 1.06]), 'slice');
    const strip = screen.getByLabelText('Where the slices land on the 1/16 grid');
    const clashes = strip.querySelectorAll('.slice-step.clash');
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.getAttribute('aria-label')).toBe('Step 1.1.3: slice 2; 2 slices here, slice 3 dropped');
  });
});
