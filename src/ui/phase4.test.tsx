// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, createLoop, createMod, createProject, isParentPad, setSongCell, setStep, sliceBreak } from '../model';
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

    fireEvent.keyDown(window, { key: '8' });
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

  it('Borrow picks its loops as chips, how it chooses, and what empty steps do; the graph names the loop per step', async () => {
    const project = apply(snareLoopProject(), createLoop(null, 'fill', 1));
    const store = await setup(project, 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'sourceLoop');
    const borrow = () => Object.values(present(store).mods)[0]!.effects[0]!;
    const fill = Object.values(present(store).loops).find((l) => l.kind === 'fill')!;
    // It starts borrowing from the first fill, half the time, keeping the own hit where the fill is empty.
    expect(borrow()).toEqual({ target: 'sourceLoop', scope: { kind: 'all' }, rate: 'step', sources: [fill.id], pick: { kind: 'random', chance: 50 }, skipEmpty: true });

    pick('Pick', 'every');
    pick('Every', '3');
    pick('Empty steps', 'silent');
    const chips = screen.getByRole('group', { name: 'Borrow from' });
    fireEvent.click(within(chips).getByRole('button', { name: 'M1' }));
    expect(borrow()).toMatchObject({ sources: [fill.id, Object.values(present(store).loops)[0]!.id], pick: { kind: 'every', n: 3 }, skipEmpty: false });

    fireEvent.click(within(chips).getByRole('button', { name: 'M1' }));
    const boxes = [...screen.getByRole('img', { name: 'Which loop each step plays from' }).querySelectorAll('text')].map((t) => t.textContent);
    expect(boxes.slice(0, 6)).toEqual(['M1', 'M1', 'F1', 'M1', 'M1', 'F1']);
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

  it("the scope does not list a break's own pad", async () => {
    let project = snareLoopProject();
    const ctx2 = sequentialIds();
    const added = addSample({ name: 'amen.wav', audio: constantAudio(0.5) })(project, ctx2);
    if (!added.ok) throw new Error('addSample failed');
    const id = Object.keys(added.project.samples).find((k) => !(k in project.samples))!;
    const sliced = sliceBreak(id, 1, 4)(added.project, ctx2);
    if (!sliced.ok) throw new Error('sliceBreak failed');
    project = sliced.project;
    await setup(project, 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'pitch');
    const options = within(screen.getByRole('combobox', { name: 'Scope' })).getAllByRole('option').map((o) => o.textContent);
    const parent = Object.values(project.pads).find((p) => isParentPad(project, p))!;
    expect(options).not.toContain(`pad ${parent.name}`);
    expect(options).toContain(`pad ${Object.values(project.pads).find((p) => p.name !== parent.name)!.name}`);
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
      const mod = randomMod(project, seededRng(seed));
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
