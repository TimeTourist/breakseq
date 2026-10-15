import { describe, expect, it } from 'vitest';
import type { Command, Id, LoopKind, Mod, Project } from '../model';
import {
  addSample,
  createLoop,
  createMod,
  createPad,
  createProject,
  removePadMember,
  setBpm,
  setFillWindow,
  setSongBars,
  setSongCell,
  setStep,
  stepDuration,
  updateHit,
} from '../model';
import { constantAudio, seededRng, sequenceRng, sequentialIds } from '../test/fixtures';
import { generateTriggers } from './generate';

const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, command) => {
    const result = command(p, ctx);
    if (!result.ok) throw new Error(`Command failed: ${JSON.stringify(result.error)}`);
    return result.project;
  }, project);
}

/** Id of the object added by the last command, found by diffing a collection. */
function added<K extends 'hits' | 'pads' | 'loops' | 'mods'>(before: Project, after: Project, key: K): Id {
  const id = Object.keys(after[key]).find((k) => !(k in before[key]));
  if (id === undefined) throw new Error(`Nothing added to ${key}`);
  return id;
}

/** A project with one sample (and its hit and pad) per name. */
function withPads(names: readonly string[]): { project: Project; pad: Record<string, Id>; hit: Record<string, Id> } {
  let project = run(createProject(ctx), setBpm(120));
  const pad: Record<string, Id> = {};
  const hit: Record<string, Id> = {};
  for (const name of names) {
    const next = run(project, addSample({ name, audio: constantAudio(0.1) }));
    pad[name] = added(project, next, 'pads');
    hit[name] = added(project, next, 'hits');
    project = next;
  }
  return { project, pad, hit };
}

function addLoop(project: Project, name: string, kind: LoopKind, bars: number): [Project, Id] {
  const next = run(project, createLoop(name, kind, bars));
  return [next, added(project, next, 'loops')];
}

function addMod(project: Project, fields: Omit<Mod, 'id' | 'name'>): [Project, Id] {
  const next = run(project, createMod({ name: 'mod', ...fields }));
  return [next, added(project, next, 'mods')];
}

/**
 * Lays out a song row from notation like '1--- 1---': a character per bar,
 * where a key of `ids` places that loop or mod and anything else is empty.
 */
function row(row: 'main' | 'fill' | 'modA' | 'modB', notation: string, ids: Record<string, Id>): Command[] {
  return [...notation.replaceAll(' ', '')].flatMap((ch, bar) => {
    const id = ids[ch];
    return id === undefined ? [] : [setSongCell(row, bar, id)];
  });
}

/** Each bar's first trigger, as the name of the hit it plays. */
function firstHitPerBar(project: Project): (string | undefined)[] {
  const triggers = generateTriggers(project, () => 0);
  return Array.from({ length: project.song.bars }, (_, bar) => {
    const first = triggers.find((t) => t.bar === bar);
    return first === undefined ? undefined : project.hits[first.hitId]?.name;
  });
}

describe('layers', () => {
  /** Loops whose bar n plays the pad named `${prefix}${n}` on step 0, so the trigger shows which bar played. */
  function loopsSetup(loops: readonly { name: string; kind: LoopKind; bars: number }[]) {
    const names = loops.flatMap((l) => Array.from({ length: l.bars }, (_, n) => `${l.name}.${n + 1}`));
    let { project, pad } = withPads(names);
    const ids: Record<string, Id> = {};
    for (const l of loops) {
      const [next, id] = addLoop(project, l.name, l.kind, l.bars);
      project = run(
        next,
        ...Array.from({ length: l.bars }, (_, n) => setStep(id, n * 16, { padId: pad[`${l.name}.${n + 1}`]! })),
      );
      ids[l.name] = id;
    }
    return { project, ids };
  }

  it('M: 1--- 1---, F: ---1 ----: bar 4 plays F1 and bars 5–8 play M1 from its bar 1', () => {
    const { project, ids } = loopsSetup([
      { name: 'M1', kind: 'main', bars: 4 },
      { name: 'F1', kind: 'fill', bars: 1 },
    ]);
    const song = run(
      project,
      setSongBars(8),
      ...row('main', '1--- 1---', { '1': ids.M1! }),
      ...row('fill', '---1 ----', { '1': ids.F1! }),
    );
    expect(firstHitPerBar(song)).toEqual(['M1.1', 'M1.2', 'M1.3', 'F1.1', 'M1.1', 'M1.2', 'M1.3', 'M1.4']);
  });

  it('a main of 4 bars followed by four empty main cells and then M2: M1 loops until M2 starts', () => {
    const { project, ids } = loopsSetup([
      { name: 'M1', kind: 'main', bars: 4 },
      { name: 'M2', kind: 'main', bars: 1 },
    ]);
    const song = run(project, setSongBars(9), ...row('main', '1--- ---- 2', { '1': ids.M1!, '2': ids.M2! }));
    expect(firstHitPerBar(song)).toEqual(['M1.1', 'M1.2', 'M1.3', 'M1.4', 'M1.1', 'M1.2', 'M1.3', 'M1.4', 'M2.1']);
  });

  it('a fill of 2 bars covers two bars, and the main keeps counting under it', () => {
    const { project, ids } = loopsSetup([
      { name: 'M1', kind: 'main', bars: 4 },
      { name: 'F1', kind: 'fill', bars: 2 },
    ]);
    const song = run(
      project,
      setSongBars(4),
      ...row('main', '1---', { '1': ids.M1! }),
      ...row('fill', '-1--', { '1': ids.F1! }),
    );
    expect(firstHitPerBar(song)).toEqual(['M1.1', 'F1.1', 'F1.2', 'M1.4']);
  });

  it('is silent before the first main', () => {
    const { project, ids } = loopsSetup([{ name: 'M1', kind: 'main', bars: 1 }]);
    const song = run(project, setSongBars(3), ...row('main', '--1', { '1': ids.M1! }));
    expect(firstHitPerBar(song)).toEqual([undefined, undefined, 'M1.1']);
  });
});

describe('timing', () => {
  it('places each step on the timeline from the song tempo', () => {
    let { project, pad } = withPads(['K']);
    let loop: Id;
    [project, loop] = addLoop(project, 'M1', 'main', 1);
    project = run(project, setStep(loop, 5, { padId: pad.K! }), setSongBars(2), setSongCell('main', 0, loop));

    const triggers = generateTriggers(project, () => 0);

    expect(triggers.map((t) => [t.bar, t.step, t.time])).toEqual([
      [0, 5, 5 * stepDuration(120)],
      [1, 5, 21 * stepDuration(120)],
    ]);
  });
});

describe('pad members', () => {
  it('a step without a choice plays member 1, a step with one plays it, and a removed member gives member 1', () => {
    let { project, hit } = withPads(['S1', 'S2']);
    const before = project;
    project = run(project, createPad('Snares', [hit.S1!, hit.S2!]));
    const snares = added(before, project, 'pads');
    let loop: Id;
    [project, loop] = addLoop(project, 'M1', 'main', 1);
    project = run(
      project,
      setStep(loop, 0, { padId: snares }),
      setStep(loop, 4, { padId: snares, memberId: hit.S2! }),
      setSongBars(1),
      setSongCell('main', 0, loop),
    );

    expect(generateTriggers(project, () => 0).map((t) => t.hitId)).toEqual([hit.S1, hit.S2]);

    project = run(project, removePadMember(snares, hit.S2!));
    expect(generateTriggers(project, () => 0).map((t) => t.hitId)).toEqual([hit.S1, hit.S1]);
  });

  it('uses the hit settings', () => {
    let { project, pad, hit } = withPads(['K']);
    project = run(project, updateHit(hit.K!, { pitch: 2, volume: -6, direction: 'reverse', region: { start: 0.01, end: 0.05 } }));
    let loop: Id;
    [project, loop] = addLoop(project, 'M1', 'main', 1);
    project = run(project, setStep(loop, 0, { padId: pad.K! }), setSongBars(1), setSongCell('main', 0, loop));

    expect(generateTriggers(project, () => 0)).toEqual([
      {
        time: 0,
        bar: 0,
        step: 0,
        hitId: hit.K,
        pitch: 2,
        volume: -6,
        direction: 'reverse',
        region: { start: 0.01, end: 0.05 },
      },
    ]);
  });
});

describe('mods', () => {
  /** One main loop of `bars` bars with pad K on every step, in a song of the same length. */
  function everyStep(bars = 1) {
    let { project, pad, hit } = withPads(['K']);
    let loop: Id;
    [project, loop] = addLoop(project, 'M1', 'main', bars);
    project = run(
      project,
      ...Array.from({ length: bars * 16 }, (_, i) => setStep(loop, i, { padId: pad.K! })),
      setSongBars(bars),
      setSongCell('main', 0, loop),
    );
    return { project, loop, pad, hit };
  }

  it('a pitch mod (List, per beat) holds the same value over four steps', () => {
    let { project } = everyStep();
    let mod: Id;
    [project, mod] = addMod(project, {
      target: 'pitch',
      scope: { kind: 'all' },
      rate: 'beat',
      shape: { kind: 'list', values: [3, 5, 7, 9] },
    });
    project = run(project, setSongCell('modA', 0, mod));

    expect(generateTriggers(project, () => 0).map((t) => t.pitch)).toEqual([
      3, 3, 3, 3, 5, 5, 5, 5, 7, 7, 7, 7, 9, 9, 9, 9,
    ]);
  });

  it('pitch from A and B adds, on top of the hit pitch', () => {
    let { project, hit } = everyStep();
    project = run(project, updateHit(hit.K!, { pitch: 1 }));
    let a: Id, b: Id;
    [project, a] = addMod(project, { target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [2] } });
    [project, b] = addMod(project, { target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [5] } });
    project = run(project, setSongCell('modA', 0, a), setSongCell('modB', 0, b));

    expect(new Set(generateTriggers(project, () => 0).map((t) => t.pitch))).toEqual(new Set([8]));
  });

  it('ratchet 4 gives four evenly spaced triggers within the step, all with the mod pitch', () => {
    let { project } = everyStep();
    let ratchet: Id, pitch: Id;
    [project, ratchet] = addMod(project, {
      target: 'ratchet',
      scope: { kind: 'range', from: 0, to: 0 },
      rate: 'step',
      shape: { kind: 'random', min: 4, max: 4, chance: 100 },
    });
    [project, pitch] = addMod(project, { target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [3] } });
    project = run(project, setSongCell('modA', 0, ratchet), setSongCell('modB', 0, pitch));

    const first = generateTriggers(project, sequenceRng([0, 0.5])).filter((t) => t.step === 0);

    const step = stepDuration(120);
    expect(first.map((t) => t.time)).toEqual([0, step / 4, step / 2, (3 * step) / 4]);
    expect(first.map((t) => t.pitch)).toEqual([3, 3, 3, 3]);
  });

  it('ignoreMods turns off every mod for the step', () => {
    let { project, loop } = everyStep();
    let ratchet: Id, pitch: Id;
    [project, ratchet] = addMod(project, { target: 'ratchet', scope: { kind: 'all' }, rate: 'step', shape: { kind: 'random', min: 2, max: 2, chance: 100 } });
    [project, pitch] = addMod(project, { target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [3] } });
    project = run(project, setStep(loop, 1, { ignoreMods: true }), setSongCell('modA', 0, ratchet), setSongCell('modB', 0, pitch));

    const triggers = generateTriggers(project, () => 0);

    expect(triggers.filter((t) => t.step === 1).map((t) => t.pitch)).toEqual([0]);
    expect(triggers.filter((t) => t.step === 0).map((t) => t.pitch)).toEqual([3, 3]);
  });

  it('a random value is held over its interval and applies only with its chance', () => {
    let { project } = everyStep();
    let ratchet: Id;
    [project, ratchet] = addMod(project, { target: 'ratchet', scope: { kind: 'all' }, rate: 'beat', shape: { kind: 'random', min: 1, max: 8, chance: 50 } });
    project = run(project, setSongCell('modA', 0, ratchet));

    // Beat 1: chance roll 0.1 hits, value roll 0.99 → 8. Beat 2: chance roll 0.9 misses.
    // Beat 3: hits, 0 → 1. Beat 4: hits, 0.5 → 5.
    const triggers = generateTriggers(project, sequenceRng([0.1, 0.99, 0.9, 0.2, 0, 0.3, 0.5]));
    const perStep = Array.from({ length: 16 }, (_, s) => triggers.filter((t) => t.step === s).length);
    expect(perStep).toEqual([8, 8, 8, 8, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5]);
  });

  it('only touches steps in scope', () => {
    let { project, pad: kPad } = everyStep();
    let pitch: Id;
    [project, pitch] = addMod(project, { target: 'pitch', scope: { kind: 'range', from: 4, to: 7 }, rate: 'bar', shape: { kind: 'list', values: [12] } });
    project = run(project, setSongCell('modA', 0, pitch));
    expect(generateTriggers(project, () => 0).map((t) => t.pitch)).toEqual([
      0, 0, 0, 0, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    let other: Id;
    [project, other] = addMod(project, { target: 'pitch', scope: { kind: 'pad', padId: kPad.K! }, rate: 'bar', shape: { kind: 'list', values: [1] } });
    project = run(project, setSongCell('modA', 0, other));
    expect(new Set(generateTriggers(project, () => 0).map((t) => t.pitch))).toEqual(new Set([1]));
  });

  it('the same mod in adjacent bars is one continuous modulation', () => {
    let { project } = everyStep(1);
    project = run(project, setSongBars(4), setSongCell('main', 0, Object.keys(project.loops)[0]!));
    let pitch: Id;
    [project, pitch] = addMod(project, { target: 'pitch', scope: { kind: 'all' }, rate: 'bar', shape: { kind: 'list', values: [1, 2, 3] } });
    project = run(project, ...row('modA', '11-1', { '1': pitch }));

    const perBar = (bar: number) => generateTriggers(project, () => 0).find((t) => t.bar === bar)?.pitch;
    // Bars 1–2 are one run (1, 2); bar 4 starts a new run (1).
    expect([0, 1, 2, 3].map(perBar)).toEqual([1, 2, 0, 1]);
  });
});

describe('randomness', () => {
  it('the same rng gives the same triggers; different rngs can differ', () => {
    let { project, pad } = withPads(['K']);
    let loop: Id;
    [project, loop] = addLoop(project, 'M1', 'main', 4);
    const before = project;
    project = run(
      project,
      ...Array.from({ length: 64 }, (_, i) => setStep(loop, i, { padId: pad.K! })),
      createMod({ name: 'roll', target: 'ratchet', scope: { kind: 'all' }, rate: 'step', shape: { kind: 'random', min: 1, max: 8, chance: 50 } }),
    );
    const mod = added(before, project, 'mods');
    project = run(project, setSongBars(4), setSongCell('main', 0, loop), ...row('modA', '1111', { '1': mod }));

    expect(generateTriggers(project, seededRng(1))).toEqual(generateTriggers(project, seededRng(1)));
    expect(generateTriggers(project, seededRng(1))).not.toEqual(generateTriggers(project, seededRng(2)));
  });
});

describe('fill window', () => {
  /** Main M1 has pad M on every step; fill F1 has pad F on every step. */
  function mainAndFill(fillBars: number) {
    let { project, pad, hit } = withPads(['M', 'F']);
    let m1: Id, f1: Id;
    [project, m1] = addLoop(project, 'M1', 'main', 1);
    [project, f1] = addLoop(project, 'F1', 'fill', fillBars);
    project = run(
      project,
      ...Array.from({ length: 16 }, (_, i) => setStep(m1, i, { padId: pad.M! })),
      ...Array.from({ length: fillBars * 16 }, (_, i) => setStep(f1, i, { padId: pad.F! })),
      setSongBars(4),
      setSongCell('main', 0, m1),
      setSongCell('fill', 1, f1),
    );
    return { project, f1, hit };
  }

  /** Which pad plays each step of a bar: 'M' or 'F'. */
  const layerOf = (project: Project, hit: Record<string, Id>, bar: number) =>
    generateTriggers(project, () => 0)
      .filter((t) => t.bar === bar)
      .map((t) => (t.hitId === hit.F ? 'F' : 'M'))
      .join('');

  it('a fill plays the whole bar by default', () => {
    const { project, hit } = mainAndFill(1);
    expect(layerOf(project, hit, 1)).toBe('F'.repeat(16));
  });

  it('the main shows through outside the window: the last half of a bar', () => {
    const { project: base, f1, hit } = mainAndFill(1);
    const project = run(base, setFillWindow(f1, 8, 16));
    expect(layerOf(project, hit, 1)).toBe('M'.repeat(8) + 'F'.repeat(8));
    expect(layerOf(project, hit, 2)).toBe('M'.repeat(16));
  });

  it('silent steps inside the window stay silent', () => {
    const { project: base, f1, hit } = mainAndFill(1);
    const project = run(base, setFillWindow(f1, 12, 16), setStep(f1, 13, { padId: null }));
    expect(layerOf(project, hit, 1)).toBe('M'.repeat(12) + 'F'.repeat(3));
    expect(generateTriggers(project, () => 0).some((t) => t.bar === 1 && t.step === 13)).toBe(false);
  });

  it('a window can span the bars of a longer fill', () => {
    const { project: base, f1, hit } = mainAndFill(2);
    const project = run(base, setFillWindow(f1, 12, 20));
    expect(layerOf(project, hit, 1)).toBe('M'.repeat(12) + 'F'.repeat(4));
    expect(layerOf(project, hit, 2)).toBe('F'.repeat(4) + 'M'.repeat(12));
  });
});
