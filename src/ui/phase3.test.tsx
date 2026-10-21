// @vitest-environment happy-dom
import { createEvent, act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, copyHits, createLoop, createMatrix, createMod, createProject, effectiveHit, resizeClip, setSongCell, setStep, sliceSample } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
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
  };
  return {
    rendered,
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderPreview: () => Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] }),
    renderSong: (project) => {
      rendered.push(project);
      return Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [], tapes: [] } satisfies Take);
    },
    exportWav: vi.fn(),
    exportMidi: vi.fn(),
    exportRex: vi.fn(),
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

/** The app on `view`, with the matrix named `focus` (else the first) pinned in Matrices, and those named `pins` pinned in Loops. */
async function setup(project: Project, view: View, focus?: string, pins: readonly string[] = []): Promise<Store> {
  const matrices = Object.values(project.matrices);
  const focused = (focus === undefined ? matrices[0] : matrices.find((m) => m.name === focus))?.id ?? null;
  const pinned = pins.map((name) => matrices.find((m) => m.name === name)!.id);
  const store = createStore({ ...initialState(project), view, focus: { matrix: focused, loopPins: pinned } });
  render(<App store={store} services={fakeServices()} />);
  await act(async () => {});
  return store;
}

const present = (store: Store) => store.getState().history.present;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('Klart när: four snares become a pad, placed in a loop and heard in Song', () => {
  it('builds the pad in Pads, fills a loop and places it in the song', async () => {
    const snares = ['snare_01.wav', 'snare_02.wav', 'snare_03.wav', 'snare_04.wav'];
    const store = await setup(build(...snares.map((name) => addSample({ name, audio: constantAudio(0.2) }))), 'pads');

    // Matrices: the first snare's pad gets copies of the other three, dragged from the list.
    const matrix = Object.values(present(store).matrices)[0]!;
    const tile = within(screen.getByRole('region', { name: 'Pads of the matrix' })).getByRole('button', { name: /^Pad / }).parentElement!;
    for (const m of Object.values(present(store).matrices).slice(1)) {
      fireEvent.click(button(`Show the pads of ${m.name}`));
      drag(button(`Pad ${present(store).pads[m.pads[0]!]!.name}`), tile);
    }
    const pad = present(store).pads[matrix.pads[0]!]!;
    expect(pad.members).toHaveLength(4);

    // Loops: a new main with the pad on two steps.
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.click(button('+ New loop'));
    fireEvent.click(button(`Pin ${matrix.name}`));
    fireEvent.click(button(`Pad ${pad.name}`));
    fireEvent.click(button(/^Bar 1, step 5:/));
    fireEvent.click(button(/^Bar 1, step 13:/));
    const loop = Object.values(present(store).loops)[0]!;
    expect(loop.steps.filter((s) => s.padId === pad.id)).toHaveLength(2);

    // Song: the loop in bar 1.
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.click(button(loop.name));
    clickLane('Main', 0);

    const triggers = generateTriggers(present(store), withRng(() => 0));
    expect(triggers.length).toBeGreaterThan(0);
    // The pad turned Round robin as it got more than one hit: its hits take turns.
    expect(triggers.every((t) => pad.members.includes(t.hitId))).toBe(true);
    expect(new Set(triggers.map((t) => t.step))).toEqual(new Set([4, 12]));
  });
});

describe('Pads: a hit', () => {
  it('the pitch slider changes the hit, and one whole drag is one undo step', async () => {
    const store = await setup(build(addSample({ name: 'kick.wav', audio: constantAudio(0.2) })), 'pads');
    const before = present(store);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.pad-hits button')!);
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

/** Two one-shots a.wav and b.wav, and a matrix Both whose pad has copies of a then b. */
function twoHitPad(...more: Command[]) {
  const base = build(addSample({ name: 'a.wav', audio: constantAudio(0.1) }), addSample({ name: 'b.wav', audio: constantAudio(0.1) }), createMatrix('Both'));
  const pad = Object.values(base.pads).find((p) => p.name === 'Both 01')!;
  const project = applyAll(base, copyHits(Object.keys(base.hits), pad.id), ...more);
  const [a, b] = project.pads[pad.id]!.members as [string, string];
  return { project, pad, a, b };
}

/** A drag as a browser does it, at the event level: the data set on drag start comes back on drop. */
function drag(from: HTMLElement, to: HTMLElement) {
  const data = new Map<string, string>();
  const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all', dropEffect: 'copy' };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
}

describe('Pads: matrices, pads and their hits', () => {
  /** A one-bar break amen.wav sliced in four, and a one-shot snare.wav. */
  function breakAndOneShot(...more: Command[]) {
    const project = build(addSample({ name: 'amen.wav', audio: constantAudio(2) }), addSample({ name: 'snare.wav', audio: constantAudio(0.1) }));
    const amen = Object.values(project.samples).find((s) => s.name === 'amen.wav')!;
    return applyAll(project, sliceSample(amen.id, 1, 4), ...more);
  }
  const timeline = () => screen.getByRole('region', { name: 'Pads of the matrix' });
  const rowOf = () => screen.getByRole('region', { name: 'Matrix' });
  const amenOf = (project: Project) => Object.values(project.matrices).find((m) => m.name === 'amen 1')!;

  it('lists each matrix, and the shown one’s pads in order', async () => {
    await setup(breakAndOneShot(), 'pads');
    const list = screen.getByRole('region', { name: 'Matrices' });
    expect(within(list).getAllByRole('button', { name: /^Matrix / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Matrix amen 1', 'Matrix snare 1']);
    const pads = within(timeline()).getAllByRole('button', { name: /^Pad / }).map((b) => b.getAttribute('aria-label'));
    expect(pads).toEqual(['Pad amen 1 01', 'Pad amen 1 02', 'Pad amen 1 03', 'Pad amen 1 04']);
  });

  it('a matrix shows a break icon with more than one pad', async () => {
    const store = await setup(breakAndOneShot(createMatrix('Snares')), 'pads', 'Snares');
    const listed = (name: string) => within(button(`Matrix ${name}`)).getByRole('img').getAttribute('aria-label');
    const icon = () => within(rowOf()).getAllByRole('img')[0]!.getAttribute('aria-label');
    expect([listed('amen 1'), listed('snare 1'), icon()]).toEqual(['break', 'one-shot', 'one-shot']);
    fireEvent.click(button('+ Pad'));
    expect(icon()).toBe('break');
    const snares = Object.values(present(store).matrices).find((m) => m.name === 'Snares')!;
    expect(store.getState().selection.pad).toBe(snares.pads[1]);
  });

  it('the matrix opens on its own, with its config over every pad', async () => {
    const store = await setup(breakAndOneShot(), 'pads');
    fireEvent.click(within(timeline()).getByRole('button', { name: 'Pad amen 1 02' }));
    fireEvent.click(button('Matrix amen 1'));
    expect(screen.queryByRole('region', { name: 'Pad controls' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Matrix controls' })).toBeTruthy();
    const amen = amenOf(present(store));
    expect(store.getState().selection.matrix).toBe(amen.id);
    fireEvent.change(screen.getByRole('slider', { name: /Volume/ }), { target: { value: '-6' } });
    expect(present(store).matrices[amen.id]!.config.volume).toBe(-6);
    const hits = amen.pads.slice(0, 4).flatMap((p) => present(store).pads[p]!.members).map((h) => present(store).hits[h]!);
    expect(hits.map((h) => effectiveHit(present(store), h).volume)).toEqual([-6, -6, -6, -6]);
  });

  it("the pad's sound sliders change every hit of the pad", async () => {
    const store = await setup(breakAndOneShot(), 'pads');
    const pad = present(store).pads[amenOf(present(store)).pads[1]!]!;
    const project = applyAll(present(store), copyHits(Object.values(present(store).hits).filter((h) => h.name.startsWith('snare')).map((h) => h.id), pad.id));
    cleanup();
    const reopened = await setup(project, 'pads');
    fireEvent.click(within(timeline()).getByRole('button', { name: 'Pad amen 1 02' }));
    // Pad sound shows at once: nothing to unfold.
    fireEvent.change(within(screen.getByRole('group', { name: 'Pad sound' })).getByRole('slider', { name: /Volume/ }), { target: { value: '-6' } });
    const after = present(reopened);
    expect(after.pads[pad.id]!.config.volume).toBe(-6);
    expect(after.pads[pad.id]!.members.map((h) => effectiveHit(after, after.hits[h]!).volume)).toEqual([-6, -6]);
    // The hit's own volume is untouched, as are the pad's other rows.
    expect(after.pads[pad.id]!.members.map((h) => after.hits[h]!.volume)).toEqual([0, 0]);
    expect(after.pads[amenOf(after).pads[0]!]!.config.volume).toBe(0);
  });

  const column = (name: string) => within(timeline()).getByRole('button', { name }).parentElement!;

  it('a pad dragged from the list onto a pad adds copies of its hits', async () => {
    const snareFiles = ['snare_01.wav', 'snare_02.wav', 'snare_03.wav', 'snare_04.wav'].map((name) => addSample({ name, audio: constantAudio(0.1) }));
    const base = breakAndOneShot(...snareFiles, createMatrix('Snares'));
    const snaresPad = Object.values(base.pads).find((p) => p.name === 'Snares 01')!;
    const originals = Object.values(base.hits).filter((h) => h.name.startsWith('snare_')).map((h) => h.id);
    const store = await setup(applyAll(base, copyHits(originals, snaresPad.id)), 'pads', 'amen 1');
    const inSnares = present(store).pads[snaresPad.id]!.members;

    fireEvent.click(button('Show the pads of Snares'));
    drag(button('Pad Snares 01'), column('Pad amen 1 02'));

    const after = present(store);
    const row = after.pads[amenOf(after).pads[1]!]!;
    expect(row.members).toHaveLength(5);
    const copies = row.members.slice(1).map((h) => after.hits[h]!);
    // New hits on the same samples, not the hits of Snares.
    expect(copies.map((h) => h.sampleId)).toEqual(inSnares.map((h) => after.hits[h]!.sampleId));
    expect(copies.some((h) => inSnares.includes(h.id))).toBe(false);
    expect(after.pads[snaresPad.id]!.members).toEqual(inSnares);
    expect(screen.getByRole('button', { name: /^Undo: copy 4 hits/ })).toBeTruthy();
  });

  it('a hit dragged from another pad of the matrix shown becomes a copy there, last', async () => {
    const store = await setup(breakAndOneShot(), 'pads');
    const amen = amenOf(present(store));
    const from = present(store).pads[amen.pads[2]!]!.members[0]!;
    drag(within(column('Pad amen 1 03')).getByRole('button', { name: /^1 03/ }), column('Pad amen 1 01'));
    const after = present(store);
    expect(after.pads[amen.pads[2]!]!.members).toEqual([from]);
    const copy = after.hits[after.pads[amen.pads[0]!]!.members[1]!]!;
    expect(copy).toMatchObject({ sampleId: after.hits[from]!.sampleId, slice: 2 });
    expect(copy.id).not.toBe(from);
  });

  it('a one-shot dragged onto a pad of the break becomes a copy there, and Pad member 2 plays it', async () => {
    const store = await setup(breakAndOneShot(), 'pads', 'amen 1');
    const snare = Object.values(present(store).hits).find((h) => h.name.startsWith('snare'))!;
    fireEvent.click(button('Show the pads of snare 1'));
    drag(within(screen.getByRole('region', { name: 'Matrices' })).getByRole('button', { name: /^Pad snare/ }), column('Pad amen 1 02'));

    const pad = Object.values(present(store).pads).find((p) => p.name === 'amen 1 02')!;
    const copy = present(store).hits[pad.members[1]!]!;
    expect(copy).toMatchObject({ sampleId: snare.sampleId, slice: snare.slice, name: snare.name });
    expect(copy.id).not.toBe(snare.id);

    // In a loop with Pad member 2, the step plays the snare.
    const withLoop = applyAll(
      present(store),
      createLoop('L', 'main', 1),
      createMod('Second', [{ target: 'padMember', rate: 'step', shape: { kind: 'list', values: [2] } }]),
    );
    const loop = Object.values(withLoop.loops).find((l) => l.name === 'L')!;
    const mod = Object.values(withLoop.mods)[0]!;
    const playing = applyAll(withLoop, setStep(loop.id, 0, { padId: pad.id }), setSongCell('main', 0, loop.id), setSongCell('modA', 0, mod.id));
    expect(generateTriggers(playing, withRng(() => 0)).filter((t) => t.bar === 0 && t.step === 0).map((t) => t.hitId)).toEqual([copy.id]);
  });
});

describe('a pad in Matrices', () => {
  it('dragging a hit above the first in its pad makes it member 1', async () => {
    const { project, pad, a, b } = twoHitPad();
    const store = await setup(project, 'pads', 'Both');
    const [first, second] = Array.from(document.querySelectorAll<HTMLButtonElement>('.pad-hits button'));

    drag(second!, first!);

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
    expect(button(/^Bar 1, step 1:/).getAttribute('aria-label')).toBe('Bar 1, step 1: Both 01, member 2');

    fireEvent.keyDown(button(/^Bar 1, step 1:/), { key: 'Delete' });
    expect(present(store).loops[loop.id]!.steps[0]!.padId).toBeNull();
  });

  it('Shift-click selects a block of steps; a drag moves it, also with Alt, and Delete empties it', async () => {
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

    // Each pad is one tile over its own two steps (6–7, 8–9).
    fireEvent.click(stepButton(6));
    fireEvent.click(stepButton(8), { shiftKey: true });
    expect([6, 8].every((n) => stepButton(n).className.includes('selected'))).toBe(true);

    // Grabbed at step 8, dropped on step 12: the block 6–8 lands on 10–12.
    drag(8, 12);
    expect(filled()).toEqual([10, 12]);
    expect([10, 12].every((n) => stepButton(n).className.includes('selected'))).toBe(true);

    // Alt copies no more: a drag always moves (Magnus beslut).
    drag(10, 2, true);
    expect(filled()).toEqual([2, 4]);

    fireEvent.keyDown(stepButton(2), { key: 'Delete' });
    expect(filled()).toEqual([]);
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

