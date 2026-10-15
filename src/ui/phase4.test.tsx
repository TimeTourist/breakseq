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
  it('a new mod with typed values, placed in Mod A, changes the triggers', async () => {
    const store = await setup(snareLoopProject(), 'mods');

    fireEvent.click(button('+ New mod'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Target' })).getByRole('button', { name: 'Pitch' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Shape' })).getByRole('button', { name: 'List' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Rate' })).getByRole('button', { name: 'beat' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Values' }), { target: { value: '0 3 5 7' } });
    const mod = Object.values(present(store).mods)[0]!;
    expect(mod.effects).toMatchObject([{ target: 'pitch', rate: 'beat', shape: { kind: 'list', values: [0, 3, 5, 7] } }]);

    fireEvent.keyDown(window, { key: '8' });
    fireEvent.click(button(mod.name));
    clickLane('Mod A', 0);

    expect(generateTriggers(present(store), () => 0).map((t) => t.pitch)).toEqual([0, 3, 5, 7]);
  });
});

describe('Effects', () => {
  it('a mod gets a second effect and a Tape, which can be set up and taken out again', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    const effects = () => Object.values(present(store).mods)[0]!.effects;

    fireEvent.change(screen.getByRole('combobox', { name: 'Add effect' }), { target: { value: 'pitch' } });
    expect(effects().map((e) => e.target)).toEqual(['ratchet', 'pitch']);
    // Ratchet is taken by this mod, so the pitch effect cannot become one.
    expect(within(screen.getByRole('group', { name: 'Target' })).getByRole('button', { name: 'Ratchet' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByRole('combobox', { name: 'Add effect' }), { target: { value: 'tape' } });
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0 } });

    const repeat = screen.getByRole('group', { name: 'Repeat' });
    fireEvent.change(within(repeat).getByLabelText('Beats'), { target: { value: '1' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Tape direction' })).getByRole('button', { name: 'Reverse' }));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '0.5' } });
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 6, direction: 'reverse', speed: { from: 1, to: 0.5 } });

    fireEvent.click(button('Remove Tape'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Effects' })).getByRole('button', { name: 'Pitch' }));
    fireEvent.click(button('Remove Pitch'));
    expect(effects().map((e) => e.target)).toEqual(['ratchet']);
    expect(button('Remove Ratchet')).toHaveProperty('disabled', true);
  });

  it("the Pad scope does not list a break's own pad", async () => {
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
    fireEvent.click(within(screen.getByRole('group', { name: 'Scope' })).getByRole('button', { name: 'Pad' }));
    const options = within(screen.getByRole('combobox', { name: 'Scope pad' })).getAllByRole('option').map((o) => o.textContent);
    const parent = Object.values(project.pads).find((p) => isParentPad(project, p))!;
    expect(options).not.toContain(parent.name);
    expect(options).toContain(Object.values(project.pads).find((p) => p.name !== parent.name)!.name);
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
      if (target === 'direction' || target === 'sourceLoop') expect(shape.kind).not.toBe('ramp');
      if (target === 'sourceLoop') expect(mod.sources.length).toBeGreaterThan(0);
      expect(mod.sources.every((id) => loops.includes(id))).toBe(true);
      const placed = apply(project, createMod('r', [mod]), setSongCell('main', 0, loops[0]!));
      const id = Object.keys(placed.mods)[0]!;
      expect(() => generateTriggers(apply(placed, setSongCell('modA', 0, id)), seededRng(seed))).not.toThrow();
    }
  });

  it('Randomize changes the mod in one undo step', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    const before = present(store);
    fireEvent.click(button('Randomize'));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(present(store)).toBe(before);
  });
});
