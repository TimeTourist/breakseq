// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, createLoop, createMod, createProject, setSongCell, setStep } from '../model';
import { constantAudio, seededRng, sequentialIds } from '../test/fixtures';
import { App } from './App';
import { parseValues, randomMod } from './modText';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';
import { clickLane } from '../test/timeline';

afterEach(cleanup);

const ctx = sequentialIds();

function services(): Services {
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
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take),
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
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

const build = (...commands: Command[]) => apply(createProject(), ...commands);

/** A snare on every beat of a one-bar main loop, placed in the song. */
function snareLoopProject(): Project {
  const project = build(addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
  const pad = Object.values(project.pads)[0]!.id;
  const loop = Object.values(project.loops)[0]!.id;
  return apply(project, ...[0, 4, 8, 12].map((i) => setStep(loop, i, { padId: pad })), setSongCell('main', 0, loop));
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Mods', () => {
  const pick = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

  it('a new mod, set up in its sentence and placed in Mod A, changes the triggers', async () => {
    const store = await setup(snareLoopProject(), 'mods');

    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'pitch');
    pick('Shape', 'list');
    pick('Rate', 'beat');
    fireEvent.change(screen.getByRole('textbox', { name: 'Values' }), { target: { value: '0 3 5 7' } });
    const mod = Object.values(present(store).mods)[0]!;
    expect(mod.effects).toMatchObject([{ target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } }]);
    // The graph draws a bar per step with a value, and writes each new value.
    expect(screen.getByRole('img', { name: 'What the effect does over one bar' }).querySelectorAll('.step-value')).toHaveLength(16);
    expect([...screen.getByRole('img', { name: 'What the effect does over one bar' }).querySelectorAll('text')].map((t) => t.textContent)).toEqual(['0', '+3', '+5', '+7']);

    fireEvent.keyDown(window, { key: '6' });
    fireEvent.click(button(mod.name));
    clickLane('Mod A', 0);

    expect(generateTriggers(present(store), () => 0).map((t) => t.pitch)).toEqual([0, 3, 5, 7]);
  });

  it('a random effect draws an example roll, whole values within its range, and can roll another', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'pitch');
    pick('Shape', 'random');
    pick('Rate', 'beat');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Min' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Max' }), { target: { value: '4' } });
    const graph = () => screen.getByRole('img', { name: 'What the effect does over one bar' });
    const drawn = () => [...graph().querySelectorAll('text')].map((t) => t.textContent);
    const examples = new Set<string>();
    for (let i = 0; i < 6; i++) {
      // Each beat either jumps to one value for all its steps, or does nothing.
      expect(graph().querySelectorAll('.step-value').length % 4).toBe(0);
      drawn().forEach((v) => expect(Number(v)).toBeGreaterThanOrEqual(1));
      drawn().forEach((v) => expect(Number(v)).toBeLessThanOrEqual(4));
      examples.add(drawn().join(','));
      fireEvent.click(button('Another example'));
    }
    expect(examples.size).toBeGreaterThan(1);

    // Pitch rolls semitones until set to freely.
    const mod = () => Object.values(store.getState().history.present.mods)[0]!;
    expect(mod().effects[0]).toMatchObject({ shape: { kind: 'random', whole: true } });
    pick('Pitch steps', 'free');
    expect(mod().effects[0]).toMatchObject({ shape: { kind: 'random', whole: false } });
  });

  it('a preset makes a ready mod and opens it', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(within(screen.getByRole('group', { name: 'Start from' })).getByRole('button', { name: 'Pitch stair' }));
    const mod = Object.values(present(store).mods)[0]!;
    expect(mod).toMatchObject({ name: 'Pitch stair', effects: [{ target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } }] });
    expect(screen.getByLabelText('Mod name')).toHaveProperty('value', 'Pitch stair');
  });
});

describe('Effects', () => {
  const pick = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

  it('a mod gets a second effect and a Tape, which is set up in its sentence and taken out again', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    const effects = () => Object.values(present(store).mods)[0]!.effects;
    // A new mod starts with no effect: only + Effect.
    expect(effects()).toEqual([]);
    expect(screen.queryByRole('combobox', { name: 'Target' })).toBeNull();

    pick('Add effect', 'ratchet');
    pick('Add effect', 'pitch');
    expect(effects().map((e) => e.target)).toEqual(['ratchet', 'pitch']);
    // Ratchet is taken by this mod, so the pitch effect cannot become one.
    expect(within(screen.getByRole('combobox', { name: 'Target' })).queryByRole('option', { name: 'Ratchet' })).toBeNull();

    pick('Add effect', 'tape');
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0.25 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 });

    pick('Repeat', '6');
    pick('Tape direction', 'reverse');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'To' }), { target: { value: '0.5' } });
    pick('Ramp over', '4');
    pick('Curve', 'softEnd');
    fireEvent.change(screen.getByRole('slider', { name: /Wow/ }), { target: { value: '0.3' } });
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 6, direction: 'reverse', speed: { from: 1, to: 0.5 }, rampOver: 4, curve: 'softEnd', wow: 0.3, flutter: 0 });
    expect(screen.getByRole('img', { name: 'Tape speed over the clip' }).querySelectorAll('.pass').length).toBeGreaterThan(1);

    fireEvent.click(button('Remove Tape'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Effects' })).getByRole('button', { name: 'Pitch' }));
    fireEvent.click(button('Remove Pitch'));
    expect(effects().map((e) => e.target)).toEqual(['ratchet']);
    fireEvent.click(button('Remove Ratchet'));
    expect(effects()).toEqual([]);
  });

  it('Swap starts from the stack at random; switched to Shuffle in reverse, the graph shows the groove dealt backwards', async () => {
    const base = build(...['a', 'b', 'c', 'd'].map((name) => addSample({ name: `${name}.wav`, audio: constantAudio(0.1) })), createLoop(null, 'main', 1));
    const pads = Object.values(base.pads);
    const loop = Object.values(base.loops)[0]!.id;
    const store = await setup(apply(base, ...pads.map((p, i) => setStep(loop, i * 4, { padId: p.id }))), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'swap');
    const effect = () => Object.values(present(store).mods)[0]!.effects[0]!;
    expect(effect()).toEqual({ target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } });
    expect(screen.getByRole('combobox', { name: 'Swap mode' })).toHaveProperty('value', 'stack');
    expect(screen.getByRole('combobox', { name: 'Stack pick' })).toHaveProperty('value', 'random');

    pick('Swap mode', 'shuffle');
    pick('Shuffle pick', 'reverse');
    expect(effect()).toEqual({ target: 'swap', rate: 'step', mode: { kind: 'shuffle', pick: { kind: 'reverse' } } });
    const boxes = [...screen.getByRole('img', { name: 'What Swap does to each step' }).querySelectorAll('text')].map((t) => t.textContent);
    expect([boxes[0], boxes[4], boxes[8], boxes[12]]).toEqual(['d', 'c', 'b', 'a']);
    expect(boxes[1]).toBe('');

    pick('Shuffle pick', 'rotate');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rotate by' }), { target: { value: '2' } });
    expect(effect()).toMatchObject({ mode: { kind: 'shuffle', pick: { kind: 'rotate', by: 2 } } });
  });

  it('the target word swaps the effect in place, to Tape and back', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    const effects = () => Object.values(present(store).mods)[0]!.effects.map((e) => e.target);

    pick('Add effect', 'ratchet');
    pick('Target', 'tape');
    expect(effects()).toEqual(['tape']);
    pick('Target', 'pitch');
    expect(effects()).toEqual(['pitch']);
  });

  it('a sentence has no "acts on": a mod acts on everything under its clip', async () => {
    await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'pitch');
    expect(screen.queryByRole('combobox', { name: 'Scope' })).toBeNull();
    expect(document.querySelector('.sentence')!.textContent).toMatch(/^Every .*: /);
  });
});

describe('parseValues', () => {

  it('reads numbers, fractions and F/R per target', () => {
    expect(parseValues('pitch', '0 +3 -5')).toEqual({ ok: true, values: [0, 3, -5] });
    expect(parseValues('tempo', '1/3, 2')).toMatchObject({ ok: true, values: [1 / 3, 2] });
    expect(parseValues('direction', 'F R r')).toMatchObject({ ok: true, values: [0, 1, 1] });
  });

  it('says what is wrong', () => {
    expect(parseValues('ratchet', '9')).toEqual({ ok: false, error: 'Ratchet is a whole number from 1 to 8' });
    expect(parseValues('tempo', '0').ok).toBe(false);
    expect(parseValues('pitch', 'x')).toEqual({ ok: false, error: 'x is not a number' });
  });
});

describe('randomMod', () => {
  it('always makes a mod the engine can play, within sensible ranges', () => {
    const project = build(addSample({ name: 's.wav', audio: constantAudio(0.1) }), createLoop(null, 'main', 1), createLoop(null, 'fill', 1));
    const loops = Object.keys(project.loops);
    for (let seed = 1; seed <= 300; seed++) {
      const mod = randomMod(seededRng(seed));
      const { shape, target } = mod;
      const values = shape.kind === 'list' || shape.kind === 'cycle' ? shape.values : shape.kind === 'ramp' ? [shape.from, shape.to] : [shape.min, shape.max];
      if (target === 'ratchet') expect(values.every((v) => v >= 1 && v <= 8)).toBe(true);
      if (target === 'tempo') expect(values.every((v) => v > 0)).toBe(true);
      if (target === 'direction') expect(shape.kind).not.toBe('ramp');
      const placed = apply(project, createMod('r', [mod]), setSongCell('main', 0, loops[0]!));
      const id = Object.keys(placed.mods)[0]!;
      expect(() => generateTriggers(apply(placed, setSongCell('modA', 0, id)), seededRng(seed))).not.toThrow();
    }
  });

  it('Randomize changes the mod in one undo step', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    // Nothing to randomize until the mod has an effect.
    expect(button('Randomize')).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Add effect' }), { target: { value: 'ratchet' } });
    const before = present(store);
    fireEvent.click(button('Randomize'));
    expect(present(store)).not.toBe(before);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(present(store)).toBe(before);
  });
});
