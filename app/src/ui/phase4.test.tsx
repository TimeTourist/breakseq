// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, copyHits, createLoop, createProject, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
import { App } from './App';
import { parseTempo } from './ModSentence';
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
    queue: vi.fn(),
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
  const card = (name: string) => screen.getByRole('article', { name });
  const mod = (store: Store) => Object.values(present(store).mods)[0]!;
  const lane = (store: Store, target: string) => (mod(store).effects.find((e) => e.target === target) as { lane: unknown[] } | undefined)?.lane;

  it('a new mod gets a Pitch card; Ramp draws a line over the whole range, and placed in Mod A it changes the triggers', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    expect(screen.getByText('No effects yet: the mod does nothing. Add one below.')).toBeTruthy();
    pick('Add effect', 'pitch');
    expect(mod(store).effects).toEqual([{ target: 'pitch', step: 'beat', lane: [{ v: 0 }, { v: 0 }, { v: 0 }, { v: 0 }], pitch: { values: 'semitones' } }]);
    expect(within(card('Pitch')).getByText('Pitch · 4 steps of 1 beat (1 bar), loops · at 0 st')).toBeTruthy();

    fireEvent.click(within(card('Pitch')).getByRole('button', { name: 'Ramp ↗' }));
    expect(lane(store, 'pitch')).toEqual([{ v: -24 }, { v: -8 }, { v: 8 }, { v: 24 }]);
    // Each press turns round, and the button says what the next one does.
    expect(within(card('Pitch')).getByRole('button', { name: 'Ramp ↘' })).toBeTruthy();

    fireEvent.keyDown(window, { key: '5' });
    fireEvent.click(button(mod(store).name));
    clickLane('Mod A', 0);
    expect(generateTriggers(present(store), withRng(() => 0)).map((t) => t.pitch)).toEqual([-24, -8, 8, 24]);
  });

  it('Step and Length change the lane, and the sentence says so', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'volume');
    const volume = card('Volume');
    fireEvent.click(within(within(volume).getByRole('group', { name: 'Step size' })).getByRole('button', { name: '1/16' }));
    fireEvent.click(within(volume).getByRole('button', { name: 'One step fewer' }));
    expect(lane(store, 'volume')).toHaveLength(3);
    expect(within(volume).getByText('Volume · 3 steps of 1/16 (3/16), loops · at 0 dB')).toBeTruthy();
    fireEvent.click(within(volume).getByRole('button', { name: 'One step more' }));
    expect(lane(store, 'volume')).toHaveLength(4);
  });

  it('🎲 makes a step a dice step and back; a click on its chance steps 100, 75, 50, 25', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'pitch');
    const pitch = card('Pitch');
    fireEvent.click(within(pitch).getByRole('button', { name: 'Make step 2 a dice step' }));
    expect(lane(store, 'pitch')![1]).toEqual({ lo: -7, hi: 7, chance: 100 });
    expect(within(pitch).getByText(/1 dice step$/)).toBeTruthy();
    fireEvent.click(within(pitch).getByRole('button', { name: 'Step 2 chance 100%' }));
    fireEvent.click(within(pitch).getByRole('button', { name: 'Step 2 chance 75%' }));
    expect(lane(store, 'pitch')![1]).toMatchObject({ chance: 50 });
    // The preview shows the band on the steps the dice step is on.
    expect(document.querySelectorAll('.pass-band').length).toBe(4);
    fireEvent.click(within(pitch).getByRole('button', { name: 'Fix step 2' }));
    expect(lane(store, 'pitch')![1]).toEqual({ v: 0 });
  });

  it('Randomize draws fixed values in one undo step; Shift: dice fills dice steps; Clear sets the zero value', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'filter');
    const filter = card('Filter cutoff');
    const before = present(store);
    fireEvent.click(within(filter).getByRole('button', { name: 'Randomize' }));
    expect(present(store)).not.toBe(before);
    expect((lane(store, 'filter') as object[]).every((s) => 'v' in s)).toBe(true);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(present(store)).toBe(before);
    fireEvent.click(within(filter).getByRole('button', { name: 'Shift: dice' }));
    expect((lane(store, 'filter') as object[]).every((s) => 'lo' in s)).toBe(true);
    fireEvent.click(within(filter).getByRole('button', { name: 'Randomize' }), { shiftKey: true });
    expect((lane(store, 'filter') as object[]).every((s) => 'lo' in s)).toBe(true);
    fireEvent.click(within(filter).getByRole('button', { name: 'Clear' }));
    expect(lane(store, 'filter')).toEqual([{ v: 18000 }, { v: 18000 }, { v: 18000 }, { v: 18000 }]);
  });

  it('controls that do nothing are greyed with why: Ramp on an on/off lane, Multiply/Replace when no hit has its own stretch', async () => {
    await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'direction');
    const ramp = within(card('Direction')).getByRole('button', { name: /Ramp/ });
    expect(ramp).toHaveProperty('disabled', true);
    expect(ramp.getAttribute('title')).toBe('An on/off lane has no slope');
    expect(within(card('Direction')).getByText('An on/off lane has no slope')).toBeTruthy();
    pick('Add effect', 'stretch');
    expect(within(card('Stretch')).getByText(/has its own stretch: Multiply and Replace sound the same/)).toBeTruthy();
  });

  it('Pad member: In turn draws 1, 2, 3 … up to the most members a pad in the loop has', async () => {
    const base = snareLoopProject();
    const pad = Object.values(base.pads)[0]!;
    const project = apply(base, copyHits([pad.members[0]!, pad.members[0]!], pad.id));
    const store = await setup(project, 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'padMember');
    fireEvent.click(within(card('Pad member')).getByRole('button', { name: 'In turn' }));
    expect(lane(store, 'padMember')).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });

  it('Clone makes "<name> copy" and selects it; Rename renames', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(within(screen.getByRole('group', { name: 'Start from' })).getByRole('button', { name: 'Pitch stair' }));
    fireEvent.click(button('Clone'));
    const names = Object.values(present(store).mods).map((m) => m.name);
    expect(names).toEqual(['Pitch stair', 'Pitch stair copy']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pitch stair copy');
    fireEvent.click(button('Rename Pitch stair copy'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mod name' }), { target: { value: 'Stairs' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Mod name' }), { key: 'Enter' });
    expect(Object.values(present(store).mods).map((m) => m.name)).toEqual(['Pitch stair', 'Stairs']);
  });

  it('a preset makes a ready mod and opens it', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(within(screen.getByRole('group', { name: 'Start from' })).getByRole('button', { name: 'Pitch stair' }));
    expect(mod(store)).toMatchObject({ name: 'Pitch stair', effects: [{ target: 'pitch', step: 'beat', lane: [{ v: 0 }, { v: 3 }, { v: 5 }, { v: 7 }] }] });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pitch stair');
  });

  it('the preview has a row per effect over the loop under Plays on', async () => {
    const base = apply(snareLoopProject(), createLoop('Other', 'main', 2));
    const store = await setup(base, 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'volume');
    pick('Add effect', 'tape');
    const grid = screen.getByRole('group', { name: /What the mod does on/ });
    expect(within(grid).getByText('Volume')).toBeTruthy();
    expect(within(grid).getByText('Tape')).toBeTruthy();
    expect(grid.querySelectorAll('.pass-cell.hit')).toHaveLength(16);
    const other = Object.values(present(store).loops).find((l) => l.name === 'Other')!;
    pick('Plays on', other.id);
    expect(screen.getByRole('group', { name: /What the mod does on Other/ }).querySelectorAll('.pass-cell.hit')).toHaveLength(32);
  });
});

describe('Swap, Tempo and Tape keep their controls on a card', () => {
  const pick = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });

  it('Tape is set up in its sentence and taken out again', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    const effects = () => Object.values(present(store).mods)[0]!.effects;
    pick('Add effect', 'ratchet');
    pick('Add effect', 'tape');
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 2, direction: 'pingpong', speed: { from: 1, to: 0.25 }, rampOver: null, curve: 'linear', wow: 0, flutter: 0 });
    // A target the mod has is not offered again.
    expect(within(screen.getByRole('combobox', { name: 'Add effect' })).queryByRole('option', { name: 'Ratchet' })).toBeNull();

    pick('Repeat', '6');
    pick('Tape direction', 'reverse');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'To' }), { target: { value: '0.5' } });
    pick('Ramp over', '4');
    pick('Curve', 'softEnd');
    fireEvent.change(screen.getByRole('slider', { name: /Wow/ }), { target: { value: '0.3' } });
    expect(effects().at(-1)).toEqual({ target: 'tape', length: 6, direction: 'reverse', speed: { from: 1, to: 0.5 }, rampOver: 4, curve: 'softEnd', wow: 0.3, flutter: 0 });

    fireEvent.click(button('Remove Tape'));
    fireEvent.click(button('Remove Ratchet'));
    expect(effects()).toEqual([]);
  });

  it('Swap starts from the stack at random; switched to Shuffle in reverse, the grid shows the groove dealt backwards', async () => {
    const base = build(...['a', 'b', 'c', 'd'].map((name) => addSample({ name: `${name}.wav`, audio: constantAudio(0.1) })), createLoop(null, 'main', 1));
    const pads = Object.values(base.pads);
    const loop = Object.values(base.loops)[0]!.id;
    const store = await setup(apply(base, ...pads.map((p, i) => setStep(loop, i * 4, { padId: p.id }))), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'swap');
    const effect = () => Object.values(present(store).mods)[0]!.effects[0]!;
    expect(effect()).toEqual({ target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } });
    pick('Swap mode', 'shuffle');
    pick('Shuffle pick', 'reverse');
    expect(effect()).toEqual({ target: 'swap', rate: 'step', mode: { kind: 'shuffle', pick: { kind: 'reverse' } } });
    const cells = [...document.querySelectorAll('.pass-cell.swapped')].map((c) => c.getAttribute('title'));
    expect(cells).toEqual(['Step 1: Swap plays d 1', 'Step 5: Swap plays c 1', 'Step 9: Swap plays b 1', 'Step 13: Swap plays a 1']);
    pick('Shuffle pick', 'rotate');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Rotate by' }), { target: { value: '2' } });
    expect(effect()).toMatchObject({ mode: { kind: 'shuffle', pick: { kind: 'rotate', by: 2 } } });
  });

  it('Tempo (slip) keeps its sentence: Every bar, Tempo goes through 1/3 in turn', async () => {
    const store = await setup(snareLoopProject(), 'mods');
    fireEvent.click(button('+ New mod'));
    pick('Add effect', 'tempo');
    expect(Object.values(present(store).mods)[0]!.effects[0]).toEqual({ target: 'tempo', rate: 'bar', shape: { kind: 'list', values: [1 / 3] } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Values' }), { target: { value: '1/2 2' } });
    expect(Object.values(present(store).mods)[0]!.effects[0]).toMatchObject({ shape: { kind: 'list', values: [0.5, 2] } });
  });
});

describe('parseTempo', () => {
  it('reads numbers and fractions, and says what is wrong', () => {
    expect(parseTempo('1/3, 2')).toMatchObject({ ok: true, values: [1 / 3, 2] });
    expect(parseTempo('0').ok).toBe(false);
    expect(parseTempo('x')).toEqual({ ok: false, error: 'x is not a number' });
  });
});
