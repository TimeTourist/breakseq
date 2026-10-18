import { describe, expect, it } from 'vitest';
import type { Command, Id, PadChoice, Project } from '../model';
import { addSample, createLoop, createMod, copyHits, createMatrix, createProject, setBpm, setPadChoice, setSongBars, setSongCell, setStep } from '../model';
import { constantAudio, seededRng, sequenceRng, sequentialIds } from '../test/fixtures';
import { generateTriggers } from './generate';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const newest = (before: Project, after: Project, key: 'hits' | 'pads' | 'loops' | 'mods'): Id =>
  Object.keys(after[key]).find((k) => !(k in before[key]))!;

/** A hi-hat pad of four hits h1–h4, and a one-bar loop playing it on every beat, in a song of `bars` bars. */
function hats(choice: PadChoice, bars = 2) {
  let project = run(createProject(), setBpm(120));
  const sources: Id[] = [];
  for (const name of ['h1', 'h2', 'h3', 'h4']) {
    const next = run(project, addSample({ name, audio: constantAudio(0.05) }));
    sources.push(newest(project, next, 'hits'));
    project = next;
  }
  // The pad 'hat' holds copies of the four hits.
  let next = run(project, createMatrix('hat'));
  const pad = newest(project, next, 'pads');
  next = run(next, copyHits(sources, pad));
  const hits = next.pads[pad]!.members.slice(-sources.length);
  project = run(next, setPadChoice(pad, choice), setSongBars(bars));
  next = run(project, createLoop('M1', 'main', 1));
  const loop = newest(project, next, 'loops');
  project = run(next, ...[0, 4, 8, 12].map((s) => setStep(loop, s, { padId: pad })));
  project = run(project, ...Array.from({ length: bars }, (_, bar) => setSongCell('main', bar, loop)));
  return { project, pad, loop, hits };
}

const names = (project: Project, rng = sequenceRng([0])) => generateTriggers(project, rng).map((t) => project.hits[t.hitId]!.name.replace(/ 1$/, ''));

describe("the pad's choice", () => {
  it('Top plays member 1, as before', () => {
    expect(names(hats('top').project)).toEqual(Array.from({ length: 8 }, () => 'h1'));
  });

  // TODO(fas-22 Task 6): a pad from an older project plays Top; upgradeProject is migrated there.
  it('a new pad plays Top', () => {
    const fresh = run(createProject(), createMatrix('p'));
    expect(Object.values(fresh.pads)[0]!.choice).toBe('top');
  });

  it('Round robin plays the next member each time, on over the whole song', () => {
    expect(names(hats('roundRobin').project)).toEqual(['h1', 'h2', 'h3', 'h4', 'h1', 'h2', 'h3', 'h4']);
  });

  it('Round robin counts per pad in time order, whatever loop the pad is in', () => {
    let { project, pad, loop } = hats('roundRobin', 2);
    // A second loop with the pad on two steps only, in bar 2.
    const next = run(project, createLoop('M2', 'main', 1));
    const other = newest(project, next, 'loops');
    project = run(next, setStep(other, 0, { padId: pad }), setStep(other, 8, { padId: pad }), setSongCell('main', 1, other));
    expect(loop).not.toBe(other);
    expect(names(project)).toEqual(['h1', 'h2', 'h3', 'h4', 'h1', 'h2']);
  });

  it('Random takes the member the random number points at', () => {
    const { project } = hats('random', 1);
    expect(names(project, sequenceRng([0.9, 0.1, 0.5, 0.3]))).toEqual(['h4', 'h1', 'h3', 'h2']);
  });

  it('Random without repeats never plays the same member twice in a row', () => {
    const { project } = hats('noRepeat', 16);
    const played = names(project, seededRng(7));
    expect(played).toHaveLength(64);
    expect(played.some((n, i) => i > 0 && n === played[i - 1])).toBe(false);
    expect(new Set(played).size).toBe(4);
    // With every roll 0 it can only go back and forth.
    expect(names(hats('noRepeat', 1).project, sequenceRng([0]))).toEqual(['h1', 'h2', 'h1', 'h2']);
  });

  it('a step lock goes before the pad', () => {
    let { project, loop, hits } = hats('roundRobin', 1);
    project = run(project, setStep(loop, 4, { memberId: hits[0]! }));
    // The locked step does not take a turn from the pad.
    expect(names(project)).toEqual(['h1', 'h1', 'h2', 'h3']);
  });

  it('a Pad member mod goes before the pad, also under Ignore mods the pad still picks', () => {
    let { project, loop } = hats('roundRobin', 1);
    const next = run(project, createMod('m', [{ target: 'padMember', rate: 'step', shape: { kind: 'list', values: [4] } }]));
    const mod = newest(project, next, 'mods');
    project = run(next, setSongCell('modA', 0, mod), setStep(loop, 8, { ignoreMods: true }));
    expect(names(project)).toEqual(['h4', 'h4', 'h1', 'h4']);
  });
});
