// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createPad, createProject, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Take } from './playback';
import type { Services } from './services';
import type { Selection } from './store';
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

/** Two hats in a pad of their own, and a loop with the pad on step 1. */
function hats() {
  const sampled = apply(createProject(), addSample({ name: 'h1.wav', audio: constantAudio(0.1) }), addSample({ name: 'h2.wav', audio: constantAudio(0.1) }));
  const hits = Object.values(sampled.hits).map((h) => h.id);
  const built = apply(sampled, createPad('hat', hits), createLoop('M1', 'main', 1));
  const pad = Object.values(built.pads).find((p) => p.name === 'hat')!;
  const loop = Object.values(built.loops)[0]!;
  return { project: apply(built, setStep(loop.id, 0, { padId: pad.id })), pad, loop, hits };
}

async function setup(project: Project, view: 'hits' | 'loops', selection: Partial<Selection>) {
  const start = initialState(project);
  const store = createStore({ ...start, view, selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe('choosing what the pad shelf in Loops shows', () => {
  it('lists each group folded, with a tick that hides it from the shelf', async () => {
    const { project, loop } = hats();
    const store = await setup(project, 'loops', { loop: loop.id });
    const chooser = within(screen.getByRole('region', { name: 'Choose what shows' }));
    expect(chooser.getAllByRole('button', { name: /^Show the pads of/ })).toHaveLength(2);
    expect(chooser.queryByText('hat')).toBeNull();

    expect(screen.getByRole('button', { name: 'Pad hat' })).toBeTruthy();
    fireEvent.click(chooser.getByRole('checkbox', { name: /Built/ }));
    expect(screen.queryByRole('button', { name: 'Pad hat' })).toBeNull();
    expect(store.getState().shelfHidden).toEqual(['Built']);
    fireEvent.click(chooser.getByRole('checkbox', { name: /Built/ }));
    expect(screen.getByRole('button', { name: 'Pad hat' })).toBeTruthy();
  });

  it('expands and collapses every group at once', async () => {
    const { project, loop } = hats();
    await setup(project, 'loops', { loop: loop.id });
    const chooser = within(screen.getByRole('region', { name: 'Choose what shows' }));
    fireEvent.click(chooser.getByRole('button', { name: 'Expand all' }));
    expect(chooser.getAllByRole('button', { name: /^Hide the pads of/ })).toHaveLength(2);
    expect(chooser.getByText('hat')).toBeTruthy();
    fireEvent.click(chooser.getByRole('button', { name: 'Collapse all' }));
    expect(chooser.queryByText('hat')).toBeNull();
  });
});

describe('how long what is dragged from the shelf is', () => {
  it('shows a pad’s steps on its chip, and where it lands while dragged over a step', async () => {
    const { project, loop } = hats();
    const steps = Math.ceil(0.1 / (60 / project.song.bpm / 4) - 1e-9);
    await setup(project, 'loops', { loop: loop.id });
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
