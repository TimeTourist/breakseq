// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command, Project, ScratchEffect } from '../model';
import { addSample, createLoop, createProject, newScratch, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store } from './store';
import { createStore, initialState } from './store';

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

/** A snare on every 1/8 of a one-bar main loop, placed in the song. */
function project(): Project {
  const p = apply(createProject(), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
  const pad = Object.values(p.pads)[0]!.id;
  const loop = Object.values(p.loops)[0]!.id;
  return apply(p, ...[0, 2, 4, 6, 8, 10, 12, 14].map((i) => setStep(loop, i, { padId: pad })), setSongCell('main', 0, loop));
}

async function setup(): Promise<Store> {
  const store = createStore({ ...initialState(project()), view: 'mods' });
  render(<App store={store} services={services()} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '+ New mod' }));
  return store;
}

const present = (store: Store) => store.getState().history.present;
const mod = (store: Store) => Object.values(present(store).mods)[0]!;
const effect = (store: Store, target: string) => mod(store).effects.find((e) => e.target === target) as Record<string, unknown> | undefined;
const add = (target: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Add effect' }), { target: { value: target } });
const card = (name: string) => screen.getByRole('article', { name });

const scratch = (store: Store) => effect(store, 'scratch') as unknown as ScratchEffect;
const sentence = () => within(card('Scratch')).getByText(/^Scratch · /).textContent;
const button = (name: string | RegExp) => within(card('Scratch')).getByRole('button', { name });
const undoButton = () => screen.getByRole('button', { name: /^Undo/ });

describe('Scratch in Mods', () => {
  it('+ Add effect gives a card with Baby on 1 bar, its sentence and its controls as the sketch', async () => {
    const store = await setup();
    add('scratch');
    expect(scratch(store)).toEqual(newScratch());
    const c = card('Scratch');
    expect(sentence()).toBe('Scratch · 1 bar recorded · 8 steps of 1/16, loops · 3 backward strokes · fader open');
    expect(within(c).getByText('needle + fader')).toBeTruthy();
    expect((within(c).getByRole('combobox', { name: 'Recorded length' }) as HTMLSelectElement).value).toBe('16');
    for (const name of ['Baby', 'Chirp', 'Transformer', 'Tear', '🎲 Randomize', 'Ramp ↗', 'Clear']) expect(button(name)).toBeTruthy();
    expect(within(c).getByRole('group', { name: 'Needle position' })).toBeTruthy();
    expect(within(within(c).getByRole('group', { name: 'Crossfader' })).getAllByRole('button')).toHaveLength(8);
    // The speed under each step: Baby is 2.4× back and forth.
    expect(within(c).getAllByText('▸2.4')).toHaveLength(5);
    expect(within(c).getAllByText('◂2.4')).toHaveLength(3);
  });

  it('Start from draws a preset; Chirp’s sentence counts its strokes and fader cuts', async () => {
    const store = await setup();
    add('scratch');
    fireEvent.click(button('Chirp'));
    expect(scratch(store).points).toEqual([0.1, 0.18, 0.26, 0.18, 0.1, 0.18, 0.26, 0.18]);
    expect(sentence()).toBe('Scratch · 1 bar recorded · 8 steps of 1/16, loops · 2 backward strokes · fader cuts 4');
    expect(within(within(card('Scratch')).getByRole('group', { name: 'Crossfader' })).getAllByRole('button')).toHaveLength(12);
    fireEvent.click(button('Tear'));
    expect(sentence()).toBe('Scratch · 1 bar recorded · 8 steps of 1/16, loops · 1 backward stroke · fader open');
  });

  it('Clear plays normally, and Ramp sweeps forward and then backward', async () => {
    const store = await setup();
    add('scratch');
    fireEvent.click(button('Chirp'));
    fireEvent.click(button('Clear'));
    // Clear sets Length: 1 bar recorded in steps of 1/16 is 16 steps, the recording once at 1×.
    expect(scratch(store).points).toEqual(Array.from({ length: 16 }, (_, k) => k / 16));
    expect(scratch(store).fader).toEqual(Array.from({ length: 16 }, () => [true]));
    expect(sentence()).toMatch(/16 steps of 1\/16, loops · 0 backward strokes · fader open$/);
    expect(within(card('Scratch')).getAllByText('▸1.0')).toHaveLength(16);
    // Clear is a line going forward already: Ramp turns it round.
    fireEvent.click(button('Ramp ↘'));
    expect(scratch(store).points[0]).toBeCloseTo(0.9375);
    expect(sentence()).toMatch(/1 backward stroke/);
    fireEvent.click(button('Ramp ↗'));
    expect(scratch(store).points.at(-1)).toBeCloseTo(0.9375);
  });

  it('Randomize draws a hand movement and a fader', async () => {
    const store = await setup();
    add('scratch');
    fireEvent.click(button('🎲 Randomize'));
    const drawn = scratch(store);
    expect(drawn.points).toHaveLength(8);
    expect(drawn.points.every((p) => p >= 0 && p <= 1 && Math.round(p * 32) === p * 32)).toBe(true);
  });

  it('a fader cell opens and closes on a click; Alt-click splits it, or joins its halves', async () => {
    const store = await setup();
    add('scratch');
    const fader = () => within(card('Scratch')).getByRole('group', { name: 'Crossfader' });
    fireEvent.click(within(fader()).getByRole('button', { name: /^Fader, step 3: open/ }));
    expect(scratch(store).fader[2]).toEqual([false]);
    expect(sentence()).toMatch(/fader cuts 1$/);
    fireEvent.click(within(fader()).getByRole('button', { name: /^Fader, step 3: closed/ }), { altKey: true });
    expect(scratch(store).fader[2]).toEqual([false, false]);
    fireEvent.click(within(fader()).getByRole('button', { name: /^Fader, step 3, second half/ }));
    expect(scratch(store).fader[2]).toEqual([false, true]);
    fireEvent.click(within(fader()).getByRole('button', { name: /^Fader, step 3, first half/ }), { altKey: true });
    expect(scratch(store).fader[2]).toEqual([true]);
  });

  it('Records the first, Step and Length (2 to 16 steps)', async () => {
    const store = await setup();
    add('scratch');
    fireEvent.change(within(card('Scratch')).getByRole('combobox', { name: 'Recorded length' }), { target: { value: '32' } });
    expect(scratch(store).record).toBe(32);
    expect(sentence()).toMatch(/^Scratch · 2 bars recorded/);
    fireEvent.click(within(within(card('Scratch')).getByRole('group', { name: 'Step size' })).getByRole('button', { name: 'beat' }));
    expect(scratch(store).step).toBe('beat');
    for (let i = 0; i < 6; i++) fireEvent.click(button('One step fewer'));
    expect(scratch(store).points).toHaveLength(2);
    expect((button('One step fewer') as HTMLButtonElement).disabled).toBe(true);
    expect(button('One step fewer').title).toMatch(/at least 2/);
    fireEvent.click(button('One step more'));
    expect(scratch(store).points).toEqual([0.1, 0.25, 0.25]);
  });

  it('dragging on the needle lane sets the points it passes, snapped, as one undo step', async () => {
    const store = await setup();
    add('scratch');
    const lane = within(card('Scratch')).getByRole('group', { name: 'Needle position' });
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 150, right: 1000, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
    // The lane shows 32 sixteenths: step 2 is at x 62.5; the needle at 0.5 is at y 75 (8 + 0.5 · 134).
    fireEvent.pointerDown(lane, { clientX: 62.5, clientY: 75, pointerId: 1, button: 0 });
    fireEvent.pointerMove(lane, { clientX: 125, clientY: 75, pointerId: 1 });
    fireEvent.pointerUp(lane, { pointerId: 1 });
    expect(scratch(store).points).toEqual([0.1, 0.25, 0.5, 0.5, 0.5, 0.25, 0.1, 0.25]);
    fireEvent.click(undoButton());
    expect(scratch(store).points).toEqual(newScratch().points);
  });

  it('the preview has a row for Scratch: forward, backward or held on each step', async () => {
    await setup();
    add('scratch');
    const grid = screen.getByRole('group', { name: /^What the mod does on/ });
    expect(within(grid).getByText('Scratch')).toBeTruthy();
    expect(within(grid).getAllByTitle(/Scratch step 2, −2\.4× backwards/)).toHaveLength(2);
  });
});
