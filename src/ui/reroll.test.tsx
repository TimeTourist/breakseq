// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, createMod, createProject, rerollAll, rerollClip, rerollMatrix, rerollMod, rerollPad, setSlicing } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { describeChange } from './describeChange';
import type { Take } from './playback';
import type { Services } from './services';
import type { AppState, Store } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
  const buffer = { duration: 1, sampleRate: 100, numberOfChannels: 2, getChannelData: () => new Float32Array(100) } as unknown as AudioBuffer;
  const take = (): Promise<Take> => Promise.resolve({ buffer, triggers: [], tapes: [] });
  return {
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
    renderPreview: take,
    renderSong: take,
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
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

/** amen sliced in its own matrix and loop, the loop in Main, and a mod "Wobble" in Mod A. */
function project() {
  const p = apply(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), createMod('Wobble', []));
  const sample = Object.values(p.samples)[0]!;
  const sliced = apply(p, setSlicing(sample.id, 1));
  const matrix = Object.values(sliced.matrices)[0]!;
  const mod = Object.values(sliced.mods)[0]!;
  const q = apply(sliced, addClip('main', matrix.loop!, 0), addClip('modA', mod.id, 0));
  return { project: q, matrix: q.matrices[matrix.id]!, mod, clip: q.song.clips.find((c) => c.row === 'main')! };
}

async function setup(p: Project, patch: Partial<AppState> = {}) {
  const store: Store = createStore({ ...initialState(p), ...patch });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const undoButton = () => screen.getByRole('button', { name: /^Undo/ });

describe('🎲 Reroll', () => {
  it('in the header, between Redo and Load: new seeds for everything; it says what it does, and Undo brings them back', async () => {
    const { project: p, matrix, mod, clip } = project();
    const store = await setup(p);
    const dice = screen.getByRole('button', { name: 'Reroll everything' });
    expect(dice.title).toMatch(/Undo/);
    // Its place: right after Redo, before Load.
    const buttons = screen.getAllByRole('button');
    const at = buttons.indexOf(dice);
    expect(buttons[at - 1]!.getAttribute('aria-label')).toMatch(/redo/i);
    expect(buttons[at + 1]!.textContent).toBe('Load');
    fireEvent.click(dice);
    const after = present(store);
    expect(after.matrices[matrix.id]!.seed).not.toBe(matrix.seed);
    expect(after.mods[mod.id]!.seed).not.toBe(mod.seed);
    expect(after.song.clips.find((c) => c.id === clip.id)!.seed).not.toBe(clip.seed);
    expect(undoButton().getAttribute('aria-label')).toMatch(/reroll everything/);
    fireEvent.click(undoButton());
    expect(present(store)).toBe(p);
  });

  it('in Mods, beside the mod’s name: only that mod', async () => {
    const { project: p, mod } = project();
    const store = await setup(p, { view: 'mods', selection: { ...initialState(p).selection, mod: mod.id } });
    const dice = screen.getByRole('button', { name: 'Reroll this mod' });
    expect(dice.title).toMatch(/Wobble/);
    expect(dice.title).toMatch(/Undo/);
    fireEvent.click(dice);
    expect(present(store).mods[mod.id]!.seed).not.toBe(mod.seed);
    expect(present(store).matrices).toBe(p.matrices);
    fireEvent.click(undoButton());
    expect(present(store)).toBe(p);
  });

  it('in Matrices, on the matrix (its pads) and on the selected pad', async () => {
    const { project: p, matrix } = project();
    const focus = { matrix: matrix.id, loopPins: [] };
    const padId = matrix.pads[2]!;
    const store = await setup(p, { view: 'pads', focus, selection: { ...initialState(p).selection, pad: padId } });
    fireEvent.click(screen.getByRole('button', { name: 'Reroll this pad' }));
    expect(present(store).pads[padId]!.seed).not.toBe(p.pads[padId]!.seed);
    expect(present(store).pads[matrix.pads[0]!]).toBe(p.pads[matrix.pads[0]!]);
    fireEvent.click(undoButton());
    expect(present(store)).toBe(p);
    const dice = screen.getByRole('button', { name: 'Reroll this matrix' });
    expect(dice.title).toMatch(/Undo/);
    fireEvent.click(dice);
    const after = present(store);
    expect(after.matrices[matrix.id]!.seed).not.toBe(matrix.seed);
    expect(matrix.pads.every((id) => after.pads[id]!.seed !== p.pads[id]!.seed)).toBe(true);
  });

  it('in Song, on the selected clip: only that clip, and Undo brings it back', async () => {
    const { project: p, clip } = project();
    const store = await setup(p, { view: 'song', selection: { ...initialState(p).selection, clip: clip.id } });
    const dice = screen.getByRole('button', { name: 'Reroll this clip' });
    expect(dice.title).toMatch(/only this clip/);
    fireEvent.click(dice);
    const after = present(store);
    expect(after.song.clips.find((c) => c.id === clip.id)!.seed).not.toBe(clip.seed);
    expect(after.song.clips.filter((c) => c.id !== clip.id)).toEqual(p.song.clips.filter((c) => c.id !== clip.id));
    expect(store.getState().selection.clip).toBe(clip.id);
    fireEvent.click(undoButton());
    expect(present(store)).toBe(p);
  });

  it('Undo names what a reroll changed', () => {
    const { project: p, matrix, mod, clip } = project();
    const said = (c: Command) => describeChange(p, apply(p, c));
    expect(said(rerollAll())).toBe('reroll everything');
    expect(said(rerollMod(mod.id))).toBe('reroll mod Wobble');
    expect(said(rerollMatrix(matrix.id))).toBe(`reroll matrix ${matrix.name}`);
    expect(said(rerollPad(matrix.pads[0]!))).toMatch(/^reroll pad /);
    expect(said(rerollClip(clip.id))).toMatch(/^reroll clip /);
  });
});
