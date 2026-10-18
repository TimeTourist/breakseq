// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createProject, setBpm, setSlicing, setMarkers } from '../model';
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
  } satisfies Player;
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: vi.fn(() => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] })),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

/** One bar of 2 s at 120 BPM, split +-|+-|+-----------: slices of 2, 2 and 12 steps. */
function split(markers: number[] = [0, 0.25, 0.5]): Project {
  const ctx = sequentialIds();
  const commands: Command[] = [addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120)];
  let project = commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
  const id = Object.keys(project.samples)[0]!;
  for (const c of [setSlicing(id, 1), setMarkers(id, markers.map((m) => m / 2))]) {
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

/** Each hold box in a row as its grid column, e.g. "2 / span 2". */
const boxes = (row: Element) => [...row.querySelectorAll<HTMLElement>('.hold')].map((b) => b.style.gridColumn);

describe('hit lengths', () => {
  it('Loops boxes each slice of the laid out matrix up to the next: 2, 2 and 12 steps', async () => {
    await setup(split(), 'loops');
    const steps = screen.getAllByRole('button', { name: /^Bar 1, step \d+:/ });
    expect(steps).toHaveLength(16);
    // Column 1 is the row's T1 label, so step 1 is column 2.
    expect(boxes(steps[0]!.parentElement!)).toEqual(['2 / span 2', '4 / span 2', '6 / span 12']);
  });

  it('Slice boxes each slice up to the next on the 1/16 grid', async () => {
    await setup(split(), 'samples');
    const strip = screen.getByLabelText('Where the slices land on the 1/16 grid');
    const cells = within(strip).getAllByLabelText(/^Step /);
    expect(cells).toHaveLength(16);
    expect(cells.map((c) => c.textContent)).toEqual(['01', '', '02', '', '03', ...Array.from({ length: 11 }, () => '')]);
    expect(boxes(strip)).toEqual(['1 / span 2', '3 / span 2', '5 / span 12']);
  });

  it('Slice marks a step where two slices land, since the second is dropped', async () => {
    // A step is 0.125 s: 0.3 and 0.31 both land on step 3.
    await setup(split([0, 0.3, 0.31, 1.06]), 'samples');
    const strip = screen.getByLabelText('Where the slices land on the 1/16 grid');
    const clashes = strip.querySelectorAll('.slice-step.clash');
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.getAttribute('aria-label')).toBe('Step 1.1.3: slice 02; 2 slices here, slice 03 dropped');
  });
});
