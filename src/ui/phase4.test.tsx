// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { parseValues } from './modText';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    audition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [] } satisfies Take),
    exportWav: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function apply(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const build = (...commands: Command[]) => apply(createProject(ctx), ...commands);

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Mods', () => {
  /** A snare on every beat of a one-bar main loop, placed in the song. */
  function snareLoop(): Project {
    const project = build(addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!.id;
    const loop = Object.values(project.loops)[0]!.id;
    return apply(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), setSongCell('main', 0, loop));
  }

  it('a new mod with typed values, placed in Mod A, changes the triggers', async () => {
    const store = await setup(snareLoop(), 'mods');

    fireEvent.click(button('+ New mod'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Target' })).getByRole('button', { name: 'Pitch' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Shape' })).getByRole('button', { name: 'List' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Rate' })).getByRole('button', { name: 'beat' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Values' }), { target: { value: '0 3 5 7' } });
    const mod = Object.values(present(store).mods)[0]!;
    expect(mod).toMatchObject({ target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } });

    fireEvent.keyDown(window, { key: '8' });
    fireEvent.click(button(mod.name));
    fireEvent.click(button(/^Mod A bar 1:/));

    // The mod is in bar 1 only.
    const pitches = generateTriggers(present(store), () => 0).map((t) => t.pitch);
    expect(pitches.slice(0, 4)).toEqual([0, 3, 5, 7]);
    expect(pitches.slice(4, 8)).toEqual([0, 0, 0, 0]);
  });
});

describe('parseValues', () => {
  const project = build(createLoop(null, 'fill', 1), createLoop(null, 'fill', 1));

  it('reads numbers, fractions, F/R and loop names per target', () => {
    expect(parseValues('pitch', '0 +3 -5', project)).toEqual({ ok: true, values: [0, 3, -5], sources: [] });
    expect(parseValues('tempo', '1/3, 2', project)).toMatchObject({ ok: true, values: [1 / 3, 2] });
    expect(parseValues('direction', 'F R r', project)).toMatchObject({ ok: true, values: [0, 1, 1] });
    const [f1, f2] = Object.keys(project.loops);
    expect(parseValues('sourceLoop', 'F2 F1 F2', project)).toEqual({ ok: true, values: [0, 1, 0], sources: [f2, f1] });
  });

  it('says what is wrong', () => {
    expect(parseValues('ratchet', '9', project)).toEqual({ ok: false, error: 'Ratchet is a whole number from 1 to 8' });
    expect(parseValues('tempo', '0', project).ok).toBe(false);
    expect(parseValues('sourceLoop', 'M9', project)).toEqual({ ok: false, error: 'No loop called M9' });
    expect(parseValues('pitch', 'x', project)).toEqual({ ok: false, error: 'x is not a number' });
  });
});
