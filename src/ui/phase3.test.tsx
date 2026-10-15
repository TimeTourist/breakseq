// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTriggers } from '../engine';
import type { Command, Project } from '../model';
import { addSample, createLoop, createPad, createProject, setSongCell, setStep } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { App } from './App';
import type { Player, Take } from './playback';
import type { Services } from './services';
import type { Store, View } from './store';
import { createStore, initialState } from './store';

afterEach(cleanup);

function fakeServices(): Services & { rendered: Project[] } {
  const rendered: Project[] = [];
  const player: Player = {
    play: vi.fn(),
    replace: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    currentTrigger: () => null,
    audition: vi.fn(),
    stopAudition: vi.fn(),
    playHit: vi.fn(),
  };
  return {
    rendered,
    storage: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    player,
    renderSong: (project) => {
      rendered.push(project);
      return Promise.resolve({ buffer: { duration: 1 } as AudioBuffer, triggers: [] } satisfies Take);
    },
    exportWav: vi.fn(),
    download: vi.fn(),
    rng: () => () => 0,
  };
}

function build(...commands: Command[]): Project {
  const ctx = sequentialIds();
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, createProject(ctx));
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
  it('tags, builds the pad, fills a loop and places it in the song', async () => {
    const snares = ['snare_01.wav', 'snare_02.wav', 'snare_03.wav', 'snare_04.wav'];
    const store = await setup(build(...snares.map((name) => addSample({ name, audio: constantAudio(0.2) }))), 'tag');

    // Tag: each snare gets S.
    for (const name of snares) fireEvent.click(button(`${name.replace('.wav', '')}: Snare`));
    const sTag = Object.values(present(store).tags).find((t) => t.name === 'S')!.id;
    expect(Object.values(present(store).samples).every((s) => s.mainTag === sTag)).toBe(true);

    // Pads: a new pad with all four.
    fireEvent.keyDown(window, { key: '5' });
    fireEvent.click(button('+ New pad'));
    for (const name of snares) fireEvent.click(button(`Add ${name.replace('.wav', '')} to pad`));
    const pad = Object.values(present(store).pads).find((p) => !p.auto)!;
    expect(pad.members).toHaveLength(4);

    // Loops: a new main with the pad on two steps.
    fireEvent.keyDown(window, { key: '6' });
    fireEvent.click(button('+ New main'));
    fireEvent.click(button(`Pad ${pad.name}`));
    fireEvent.click(button(/^Bar 1, step 5:/));
    fireEvent.click(button(/^Bar 1, step 13:/));
    const loop = Object.values(present(store).loops)[0]!;
    expect(loop.steps.filter((s) => s.padId === pad.id)).toHaveLength(2);

    // Song: the loop in bar 1.
    fireEvent.keyDown(window, { key: '8' });
    fireEvent.click(within(screen.getByText('Mains').parentElement!).getByRole('button', { name: loop.name }));
    fireEvent.click(button(/^Bar 1:/));

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

describe('Pads', () => {
  it('moving a member up makes it member 1', async () => {
    const { project, pad, a, b } = twoHitPad();
    const store = await setup(project, 'pads');
    fireEvent.click(button('Pad Both, 2 hits'));

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
});

describe('Song', () => {
  it('a fill in the Fill lane shows, and hides the main under it', async () => {
    const project = build(createLoop(null, 'main', 4), createLoop(null, 'fill', 1));
    const [main, fill] = Object.values(project.loops);
    await setup(applyAll(project, setSongCell('main', 0, main!.id), setSongCell('fill', 2, fill!.id)), 'song');

    expect(button(/^Fill bar 3:/).getAttribute('aria-label')).toBe('Fill bar 3: F1 bar 1');
    expect(button(/^Bar 3:/).getAttribute('aria-label')).toBe('Bar 3: M1 bar 3, hidden by fill');
    expect(button(/^Bar 4:/).getAttribute('aria-label')).toBe('Bar 4: M1 bar 4');
    expect(button(/^Fill bar 4:/).getAttribute('aria-label')).toBe('Fill bar 4: empty');
  });
});

function applyAll(project: Project, ...commands: Command[]): Project {
  const ctx = sequentialIds();
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
