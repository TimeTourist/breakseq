import { describe, expect, it } from 'vitest';
import type { Command, Id, ModEffect, ModRate, Project, ShufflePick, StackPick, SwapEffect } from '../model';
import { addClip, addSample, createLoop, createMod, createPad, createProject, setBpm, setSongBars, setStep } from '../model';
import { constantAudio, seededRng, sequentialIds } from '../test/fixtures';
import { generateTriggers } from './generate';
import { shuffleOrder, stackPick } from './swap';

const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

const newest = (before: Readonly<Record<Id, unknown>>, after: Readonly<Record<Id, unknown>>) => Object.keys(after).find((k) => !(k in before))!;

/**
 * One bar at 120 BPM. Hits M (main) and F (fill), each with its own pad, and
 * hits A, B, C, D, each with a pad, for a groove. A pad Alt holds F then A.
 */
function kit() {
  let project = run(createProject(), setBpm(120), setSongBars(1));
  const hit: Record<string, Id> = {};
  const pad: Record<string, Id> = {};
  for (const name of ['M', 'F', 'A', 'B', 'C', 'D']) {
    const before = project;
    project = run(project, addSample({ name, audio: constantAudio(0.05) }));
    hit[name] = newest(before.hits, project.hits);
    pad[name] = newest(before.pads, project.pads);
  }
  const before = project;
  project = run(project, createPad('Alt', [hit.F!, hit.A!]));
  pad.Alt = newest(before.pads, project.pads);
  const nameOf = (id: Id | undefined) => Object.keys(hit).find((k) => hit[k] === id) ?? '-';
  return { project, hit, pad, nameOf };
}

/** A loop of one bar with `pads` on steps 0, 1, 2, … in order (null leaves a step empty), placed in `row`. */
function loop(project: Project, row: 'main' | 'fill', pads: readonly (Id | null)[]): Project {
  const before = project;
  let next = run(project, createLoop(null, row, 1));
  const id = newest(before.loops, next.loops);
  next = run(next, ...pads.flatMap((padId, i) => (padId === null ? [] : [setStep(id, i, { padId })])));
  return run(next, addClip(row, id, 0, 16));
}

/** A mod with `effects` over the whole bar in Mod A. */
function mod(project: Project, effects: readonly ModEffect[]): Project {
  const before = project;
  const next = run(project, createMod('swap', effects));
  return run(next, addClip('modA', newest(before.mods, next.mods), 0, 16));
}

const stack = (pick: StackPick, rate: ModRate = 'step'): SwapEffect => ({ target: 'swap', rate, mode: { kind: 'stack', pick } });
const shuffle = (pick: ShufflePick): SwapEffect => ({ target: 'swap', rate: 'step', mode: { kind: 'shuffle', pick } });

/** The hit on each of the first `n` steps, by name, '-' where silent. */
const heard = (project: Project, nameOf: (id: Id | undefined) => string, n = 8, rng: () => number = () => 0) => {
  const triggers = generateTriggers(project, rng);
  return Array.from({ length: n }, (_, s) => nameOf(triggers.find((t) => t.step === s)?.hitId));
};

describe('Swap from the stack', () => {
  /** Main M on every step; Fill F on every step but 2. */
  function layered() {
    const { project: base, pad, nameOf } = kit();
    let project = loop(base, 'main', Array(16).fill(pad.M!));
    project = loop(project, 'fill', Array.from({ length: 16 }, (_, i) => (i === 2 ? null : pad.F!)));
    return { project, nameOf, pad };
  }

  it('without Swap the fill is heard, and its empty step is silent', () => {
    const { project, nameOf } = layered();
    expect(heard(project, nameOf)).toEqual(['F', 'F', '-', 'F', 'F', 'F', 'F', 'F']);
  });

  it('layer by layer, top down, alternates Fill and Main; a step with nothing heard stays silent', () => {
    const { project, nameOf } = layered();
    // Step 3 (index 2) is silent in the fill, which is heard: Swap keeps the rhythm.
    expect(heard(mod(project, [stack('topDown')]), nameOf)).toEqual(['F', 'M', '-', 'F', 'M', 'F', 'M', 'F']);
  });

  it('bottom up starts with Main; per beat it holds a layer for four steps', () => {
    const { project, nameOf } = layered();
    expect(heard(mod(project, [stack('bottomUp')]), nameOf)).toEqual(['M', 'F', '-', 'M', 'F', 'M', 'F', 'M']);
    expect(heard(mod(project, [stack('topDown', 'beat')]), nameOf)).toEqual(['F', 'F', '-', 'F', 'M', 'M', 'M', 'M']);
  });

  it("round robin goes through every candidate, the pads' alternatives too", () => {
    const { project: base, pad, nameOf } = kit();
    let project = loop(base, 'main', Array(16).fill(pad.M!));
    project = loop(project, 'fill', Array(16).fill(pad.Alt!));
    // The stack: Fill's pad Alt (F, then A), then Main's pad (M).
    expect(heard(mod(project, [stack('roundRobin')]), nameOf, 6)).toEqual(['F', 'A', 'M', 'F', 'A', 'M']);
  });

  it('at random picks only among the candidates; with one layer and one hit nothing changes', () => {
    const { project, nameOf } = layered();
    const picks = new Set(heard(mod(project, [stack('random')]), nameOf, 16, seededRng(4)));
    expect([...picks].every((p) => ['F', 'M', '-'].includes(p))).toBe(true);
    expect(picks.has('M')).toBe(true);

    const { project: base, pad, nameOf: names } = kit();
    const single = loop(base, 'main', Array(16).fill(pad.M!));
    expect(heard(mod(single, [stack('random')]), names, 16, seededRng(4))).toEqual(Array(16).fill('M'));
  });

  it('Swap comes before the other effects: a Pad member mod acts on the swapped pad', () => {
    const { project: base, pad, nameOf } = kit();
    let project = loop(base, 'main', Array(16).fill(pad.Alt!));
    project = loop(project, 'fill', Array(16).fill(pad.M!));
    // Bottom up takes Main's Alt on step 1; member 2 of Alt is A.
    project = mod(project, [stack('bottomUp'), { target: 'padMember', rate: 'step', shape: { kind: 'list', values: [2] } }]);
    expect(heard(project, nameOf, 2)).toEqual(['A', 'M']);
  });
});

describe('Shuffle', () => {
  /** A groove A B C D on steps 0, 2, 4, 6, silent in between. */
  function groove() {
    const { project: base, pad, nameOf } = kit();
    const pads = [pad.A!, null, pad.B!, null, pad.C!, null, pad.D!, null];
    return { project: loop(base, 'main', pads), nameOf };
  }

  it('in reverse and rotated keep the rhythm and deal the hits in an exact order', () => {
    const { project, nameOf } = groove();
    expect(heard(mod(project, [shuffle({ kind: 'reverse' })]), nameOf)).toEqual(['D', '-', 'C', '-', 'B', '-', 'A', '-']);
    expect(heard(mod(project, [shuffle({ kind: 'rotate', by: 1 })]), nameOf)).toEqual(['B', '-', 'C', '-', 'D', '-', 'A', '-']);
  });

  it('like a deck plays every hit once, in a new order, on the same steps', () => {
    const { project, nameOf } = groove();
    for (let seed = 1; seed <= 10; seed++) {
      const dealt = heard(mod(project, [shuffle({ kind: 'deck' })]), nameOf, 8, seededRng(seed));
      expect(dealt.filter((_, i) => i % 2 === 1)).toEqual(['-', '-', '-', '-']);
      expect(dealt.filter((_, i) => i % 2 === 0).sort()).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('freely can deal the same hit more than once', () => {
    const { project, nameOf } = groove();
    const repeats = Array.from({ length: 20 }, (_, seed) => heard(mod(project, [shuffle({ kind: 'random' })]), nameOf, 8, seededRng(seed + 1)))
      .map((d) => d.filter((h) => h !== '-'))
      .some((hits) => new Set(hits).size < hits.length);
    expect(repeats).toBe(true);
  });
});

describe('pure picks', () => {
  it('shuffleOrder: deck is a permutation, reverse and rotate are exact', () => {
    expect([...shuffleOrder({ kind: 'deck' }, 5, seededRng(2))].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(shuffleOrder({ kind: 'reverse' }, 4, () => 0)).toEqual([3, 2, 1, 0]);
    expect(shuffleOrder({ kind: 'rotate', by: 2 }, 4, () => 0)).toEqual([2, 3, 0, 1]);
  });

  it('stackPick: round robin counts round the candidates, layer picks the layers', () => {
    const cell = (padId: string) => ({ padId, memberId: null, ignoreMods: false, nudge: 0 });
    const candidates = [cell('a'), cell('b'), cell('c')];
    const layers = [cell('top'), cell('bottom')];
    expect([0, 1, 2, 3].map((n) => stackPick('roundRobin', candidates, layers, n, 0)?.padId)).toEqual(['a', 'b', 'c', 'a']);
    expect([0, 1, 2].map((n) => stackPick('topDown', candidates, layers, n, 0)?.padId)).toEqual(['top', 'bottom', 'top']);
    expect([0, 1, 2].map((n) => stackPick('bottomUp', candidates, layers, n, 0)?.padId)).toEqual(['bottom', 'top', 'bottom']);
    expect(stackPick('random', candidates, layers, 0, 0.99)?.padId).toBe('c');
    expect(stackPick('random', [], [], 0, 0.5)).toBeNull();
  });
});
