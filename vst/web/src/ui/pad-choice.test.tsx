// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, copyHits, createLoop, createMatrix, createProject, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { focusOn } from '../test/focus';
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
    queue: vi.fn(),
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

/** Copies of two hats in the pad of a matrix of their own, and a loop with the pad on step 1. */
function hats() {
  const sampled = apply(createProject(), addSample({ name: 'h1.wav', audio: constantAudio(0.1) }), addSample({ name: 'h2.wav', audio: constantAudio(0.1) }), createMatrix('hat'));
  const pad = Object.values(sampled.pads).find((p) => p.name === 'hat 01')!;
  const built = apply(sampled, copyHits(Object.keys(sampled.hits), pad.id), createLoop('M1', 'main', 1));
  const hits = built.pads[pad.id]!.members;
  const loop = Object.values(built.loops)[0]!;
  return { project: apply(built, setStep(loop.id, 0, { padId: pad.id })), pad, loop, hits };
}

async function setup(project: Project, view: 'pads' | 'loops', selection: Partial<Selection>) {
  const start = initialState(project);
  const store = createStore({ ...start, view, focus: focusOn(project, selection), selection: { ...start.selection, ...selection } });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

describe("the pad's choice in the GUI", () => {
  it('Pads sets how the pad picks', async () => {
    const { project, pad } = hats();
    const store = await setup(project, 'pads', { pad: pad.id });
    const group = screen.getByRole('group', { name: 'Pad plays' });
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe('Top');
    fireEvent.click(screen.getByRole('button', { name: 'Round robin' }));
    expect(store.getState().history.present.pads[pad.id]!.choice).toBe('roundRobin');
  });

  it('a step lets the pad pick, or locks a member, member 1 too', async () => {
    const { project, loop, hits } = hats();
    const store = await setup(project, 'loops', { loop: loop.id, step: 0 });
    const picks = screen.getByRole('region', { name: 'Member on this step' }).querySelectorAll('button');
    expect(picks[0]!.textContent).toContain('The pad picks');
    expect(picks[0]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(picks[1]!);
    expect(store.getState().history.present.loops[loop.id]!.steps[0]!.memberId).toBe(hits[0]);
    expect(picks[1]!.getAttribute('aria-pressed')).toBe('true');
  });
});
