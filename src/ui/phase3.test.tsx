// @vitest-environment happy-dom
import { createEvent, act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, createLoop, createMod, createPad, createProject, resizeClip, setSongCell, setStep, sliceBreak } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';
import { clickLane, clip } from '../test/timeline';

afterEach(cleanup);

function fakeServices(): Services & { rendered: Project[] } {
  const rendered: Project[] = [];
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
    stopAudition: vi.fn(),
    setAuditionRegion: vi.fn(),
    auditionPosition: () => null,
    playHit: vi.fn(),
  };
  return {
    rendered,
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: (project) => {
      rendered.push(project);
      return Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take);
    },
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

// One id counter for the file, so projects built in steps never reuse an id.
const ctx = sequentialIds();

function build(...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject());
}

async function setup(project: Project, view: View): Promise<Store> {
  const store = createStore({ ...initialState(project), view });
  render(<App store={store} services={fakeServices()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Klart när: four snares become a pad, placed in a loop and heard in Song', () => {
  it('builds the pad in Hits, fills a loop and places it in the song', async () => {
    const snares = ['snare_01.wav', 'snare_02.wav', 'snare_03.wav', 'snare_04.wav'];
    const store = await setup(build(...snares.map((name) => addSample({ name, audio: constantAudio(0.2) }))), 'hits');

    // Hits: a new pad with all four.
    fireEvent.click(button('+ New pad'));
    for (const name of snares) fireEvent.click(button(`Add ${name.replace('.wav', '')} to pad`));
    const pad = Object.values(present(store).pads).find((p) => !p.auto)!;
    expect(pad.members).toHaveLength(4);

    // Loops: a new main with the pad on two steps.
    fireEvent.keyDown(window, { key: '4' });
    fireEvent.click(button('+ New loop'));
    fireEvent.click(button(`Pad ${pad.name}`));
    fireEvent.click(button(/^Bar 1, step 5:/));
    fireEvent.click(button(/^Bar 1, step 13:/));
    const loop = Object.values(present(store).loops)[0]!;
    expect(loop.steps.filter((s) => s.padId === pad.id)).toHaveLength(2);

    // Song: the loop in bar 1.
    fireEvent.keyDown(window, { key: '6' });
    fireEvent.click(button(loop.name));
    clickLane('Main', 0);

    const triggers = generateTriggers(present(store), () => 0);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.every((t) => t.hitId === pad.members[0])).toBe(true);
    expect(new Set(triggers.map((t) => t.step))).toEqual(new Set([4, 12]));
  });
});

describe('Hits', () => {
  it('the pitch slider changes the hit, and one whole drag is one undo step', async () => {
    const store = await setup(build(addSample({ name: 'kick.wav', audio: constantAudio(0.2) })), 'hits');
    const before = present(store);
    const pitch = screen.getByRole('slider', { name: /Pitch/ });

    fireEvent.change(pitch, { target: { value: '2' } });
    fireEvent.change(pitch, { target: { value: '5' } });
    fireEvent.change(pitch, { target: { value: '7' } });
    fireEvent.pointerUp(pitch);

    expect(Object.values(present(store).hits)[0]!.pitch).toBe(7);
    expect(store.getState().history.past).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(present(store)).toBe(before);
  });
});

/** Two one-shots a.wav and b.wav, and a pad Both with a then b. */
function twoHitPad(...more: Command[]) {
  const base = build(addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.1) }));
  const [a, b] = Object.keys(base.hits) as [string, string];
  const project = applyAll(base, createPad('Both', [a, b]), ...more);
  const pad = Object.values(project.pads).find((p) => p.name === 'Both')!;
  return { project, pad, a, b };
}

describe('Hits: breaks, pads and their hits', () => {
  /** A one-bar break amen.wav sliced in four, and a one-shot snare.wav. */
  function breakAndOneShot() {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const amen = Object.values(project.breaks).find((s) => s.name === 'amen.wav')!;
    return applyAll(project, sliceBreak(amen.id, 1, 4));
  }

  it('lists each break with its parent, its pads in order, then one-shots', async () => {
    await setup(breakAndOneShot(), 'hits');
    const side = screen.getByRole('complementary', { name: 'Breaks and pads' });
    expect(within(side).getByRole('button', { name: /amen\.wav.*parent/ })).toBeTruthy();
    const pads = within(side).getAllByRole('button', { name: /^Pad / }).map((b) => b.getAttribute('aria-label'));
    expect(pads).toEqual(['Pad amen 01', 'Pad amen 02', 'Pad amen 03', 'Pad amen 04', 'Pad snare']);
    expect(within(side).getByRole('heading', { name: 'One-shots' })).toBeTruthy();
  });

  it('the parent opens on its own, as the macro for every slice', async () => {
    const store = await setup(breakAndOneShot(), 'hits');
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Breaks and pads' })).getByRole('button', { name: /amen\.wav.*parent/ }));
    expect(screen.queryByRole('region', { name: 'Pad' })).toBeNull();
    expect(screen.getByText(/parent: its pitch, volume and direction apply to all 4 slices/)).toBeTruthy();
    expect(present(store).hits[store.getState().selection.hit!]!.breakId).toBe(Object.values(present(store).breaks).find((s) => s.name === 'amen.wav')!.id);
  });

  it('a one-shot dragged onto a pad of the break becomes its second hit, and Pad member 2 plays it', async () => {
    const store = await setup(breakAndOneShot(), 'hits');
    const side = screen.getByRole('complementary', { name: 'Breaks and pads' });
    fireEvent.click(within(side).getByRole('button', { name: 'Pad amen 02' }));
    const snare = Object.values(present(store).hits).find((h) => h.name.startsWith('snare'))!;
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'copy' };
    const chip = within(side).getAllByRole('button').find((b) => b.className.includes('hit-chip') && b.textContent === 'snare')!;
    fireEvent.dragStart(chip, { dataTransfer });
    const list = screen.getByRole('list', { name: 'Hits in this pad' });
    fireEvent.dragOver(list, { dataTransfer });
    fireEvent.drop(list, { dataTransfer });

    const pad = Object.values(present(store).pads).find((p) => p.name === 'amen 02')!;
    expect(pad.members[1]).toBe(snare.id);

    // In a loop with Pad member 2, the step plays the snare.
    const withLoop = applyAll(
      present(store),
      createLoop('L', 'main', 1),
      createMod('Second', [{ target: 'padMember', rate: 'step', shape: { kind: 'list', values: [2] } }]),
    );
    const loop = Object.values(withLoop.loops).find((l) => l.name === 'L')!;
    const mod = Object.values(withLoop.mods)[0]!;
    const playing = applyAll(withLoop, setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id), setSongCell('modA', 0, mod.id));
    expect(generateTriggers(playing, () => 0).filter((t) => t.bar === 0 && t.step === 0).map((t) => t.hitId)).toEqual([snare.id]);
  });
});

describe('Pads in Hits', () => {
  it('moving a member up makes it member 1', async () => {
    const { project, pad, a, b } = twoHitPad();
    const store = await setup(project, 'hits');
    fireEvent.click(button('Pad Both'));

    fireEvent.click(button('Move b up'));

    expect(present(store).pads[pad.id]!.members).toEqual([b, a]);
  });
});

describe('Loops', () => {
  it('choosing a member on a step sets memberId, and Delete clears the step', async () => {
    const { project: withPad, pad, b } = twoHitPad(createLoop(null, 'main', 1));
    const loop = Object.values(withPad.loops)[0]!;
    const store = await setup(applyAll(withPad, setStep(loop.id, 0, { padId: pad.id })), 'loops');

    fireEvent.click(button(/^Bar 1, step 1:/));
    const members = screen.getByRole('region', { name: 'Member on this step' });
    fireEvent.click(within(members).getByRole('button', { name: /^2\s*b/ }));
    expect(present(store).loops[loop.id]!.steps[0]!.memberId).toBe(b);
    expect(button(/^Bar 1, step 1:/).getAttribute('aria-label')).toBe('Bar 1, step 1: Both, member 2');

    fireEvent.keyDown(button(/^Bar 1, step 1:/), { key: 'Delete' });
    expect(present(store).loops[loop.id]!.steps[0]!.padId).toBeNull();
  });

  it('Shift-click selects a block of steps; a drag moves it, Alt copies it, Delete empties it', async () => {
    const { project: withPad, pad } = twoHitPad(createLoop(null, 'main', 1));
    const loop = Object.values(withPad.loops)[0]!;
    const store = await setup(applyAll(withPad, setStep(loop.id, 5, { padId: pad.id }), setStep(loop.id, 7, { padId: pad.id })), 'loops');
    const stepButton = (n: number) => button(new RegExp(`^Bar 1, step ${n}:`));
    const filled = () => present(store).loops[loop.id]!.steps.flatMap((s, i) => (s.padId === null ? [] : [i + 1]));
    /** Drags step `from` onto step `to`, as a browser does: the data set on drag start comes back on drop. */
    const drag = (from: number, to: number, altKey = false) => {
      const data = new Map<string, string>();
      const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'move' };
      fireEvent.dragStart(stepButton(from), { dataTransfer });
      fireEvent.dragOver(stepButton(to), { dataTransfer });
      // happy-dom leaves altKey off drag events, so it goes on the event itself.
      const drop = createEvent.drop(stepButton(to), { dataTransfer });
      Object.defineProperty(drop, 'altKey', { value: altKey });
      fireEvent(stepButton(to), drop);
    };

    fireEvent.click(stepButton(6));
    fireEvent.click(stepButton(8), { shiftKey: true });
    expect([6, 7, 8].every((n) => stepButton(n).className.includes('selected'))).toBe(true);

    // Grabbed at step 7, dropped on step 11: the block 6–8 lands on 10–12.
    drag(7, 11);
    expect(filled()).toEqual([10, 12]);
    expect([10, 11, 12].every((n) => stepButton(n).className.includes('selected'))).toBe(true);

    drag(10, 2, true);
    expect(filled()).toEqual([2, 4, 10, 12]);

    fireEvent.keyDown(stepButton(3), { key: 'Delete' });
    expect(filled()).toEqual([10, 12]);
  });

  it('the length is set in bars, beats and 1/16, saved on leaving the fields, and keeps the steps on the way', async () => {
    const { project: withPad, pad } = twoHitPad(createLoop(null, 'main', 4));
    const loop = Object.values(withPad.loops)[0]!;
    const store = await setup(applyAll(withPad, setStep(loop.id, 5, { padId: pad.id })), 'loops');
    const length = screen.getByRole('group', { name: 'Length' });
    const field = (name: string) => within(length).getByLabelText(name);

    fireEvent.change(field('Bars'), { target: { value: '0' } });
    fireEvent.change(field('Beats'), { target: { value: '1' } });
    fireEvent.change(field('1/16'), { target: { value: '2' } });
    expect(present(store).loops[loop.id]!.steps).toHaveLength(64);
    fireEvent.keyDown(field('1/16'), { key: 'Enter' });

    const steps = present(store).loops[loop.id]!.steps;
    expect(steps).toHaveLength(6);
    expect(steps[5]!.padId).toBe(pad.id);
    expect(screen.getAllByRole('button', { name: /^Bar 1, step / })).toHaveLength(6);
  });
});

describe('Song', () => {
  it('a fill clip on bar 3 takes over from the main there, and the main keeps time', async () => {
    const project = build(createLoop(null, 'main', 4), createLoop(null, 'fill', 1));
    const [main, fill] = Object.values(project.loops);
    await setup(applyAll(project, setSongCell('main', 0, main!.id), setSongCell('fill', 2, fill!.id)), 'song');

    expect(clip(/^F1, /).getAttribute('aria-label')).toBe('F1, 3.1.1, 1 bar');
    expect(clip(/^M1, /).getAttribute('aria-label')).toBe('M1, 1.1.1, 4 bars');
  });

  it('a fill trimmed from the left shows where its content starts', async () => {
    const project = build(createLoop(null, 'fill', 1));
    const fill = Object.values(project.loops)[0]!;
    const placed = applyAll(project, setSongCell('fill', 0, fill.id));
    const id = placed.song.clips[0]!.id;
    await setup(applyAll(placed, resizeClip(id, 'start', 12)), 'song');
    expect(clip(/^F1, /).getAttribute('aria-label')).toBe('F1, 1.4.1, 4/16, from 1.4.1');
  });
});

function applyAll(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

