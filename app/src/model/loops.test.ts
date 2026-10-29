import { describe, expect, it } from 'vitest';
import { constantAudio, sequentialIds } from '../test/fixtures';
import type { Command } from './command';
import { addSample, ownMatrix, setSlicing } from './chain';
import { cloneLoop, createLoop, moveLoop, pasteSteps, setStep } from './commands';
import { apply, createHistory, undo } from './history';
import { createProject, emptyStep } from './project';
import type { Project } from './types';

const ctx = sequentialIds();
function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** Two main loops M1, M2 and a fill F1, one bar each, and a pad to put on steps. */
function threeLoops() {
  const start = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  const sample = Object.values(start.samples)[0]!;
  const project = run(start, setSlicing(sample.id, 1, [0, 0.25, 0.5, 0.75]), createLoop('M1', 'main', 1), createLoop('M2', 'main', 1), createLoop('F1', 'fill', 1));
  const byName = (name: string) => Object.values(project.loops).find((l) => l.name === name)!;
  const pads = ownMatrix(project, sample.id)!.pads;
  return { project, m1: byName('M1'), m2: byName('M2'), f1: byName('F1'), pads };
}
const names = (p: Project) => Object.values(p.loops).map((l) => `${l.name}:${l.kind}`);

describe('moving a loop in the list (Magnus beslut)', () => {
  it('reorders loops, and one dropped in the other group takes its tag; undo puts it back', () => {
    const { project, m2, f1 } = threeLoops();
    const own = names(project).filter((n) => !/^(M1|M2|F1):/.test(n));
    const at = (name: string, p: Project) => Object.values(p.loops).findIndex((l) => l.name === name);
    const moved = apply(createHistory(project), moveLoop(f1.id, at('M1', project), 'main'));
    if (!moved.ok) throw new Error('moveLoop failed');
    const after = moved.history.present;
    expect(names(after).filter((n) => !own.includes(n))).toEqual(['F1:main', 'M1:main', 'M2:main']);
    expect(after.loops[f1.id]!.steps).toBe(project.loops[f1.id]!.steps);
    expect(names(undo(moved.history).present)).toEqual(names(project));
    const toFill = run(project, moveLoop(m2.id, Object.keys(project.loops).length, 'fill'));
    expect(names(toFill).at(-1)).toBe('M2:fill');
    expect(moveLoop('nope', 0, 'main')(project, ctx).ok).toBe(false);
  });
});

describe('pasting steps (Magnus beslut)', () => {
  it('lays the steps out from a step over what is there, empty ones too, and drops what is past the end', () => {
    const { project, m1, pads } = threeLoops();
    const filled = run(project, setStep(m1.id, 4, { padId: pads[0]! }), setStep(m1.id, 5, { padId: pads[1]! }), setStep(m1.id, 15, { padId: pads[2]! }));
    const block = [{ ...emptyStep, padId: pads[3]! }, emptyStep];
    const pasted = run(filled, pasteSteps(m1.id, 4, block)).loops[m1.id]!.steps;
    expect(pasted[4]!.padId).toBe(pads[3]);
    expect(pasted[5]!.padId).toBeNull();
    const atEnd = run(filled, pasteSteps(m1.id, 15, block)).loops[m1.id]!.steps;
    expect(atEnd).toHaveLength(16);
    expect(atEnd[15]!.padId).toBe(pads[3]);
    expect(pasteSteps(m1.id, 16, block)(filled, ctx).ok).toBe(false);
    expect(pasteSteps('nope', 0, block)(filled, ctx).ok).toBe(false);
  });
});

describe('cloning a loop', () => {
  it('copies its tag and steps under "<name> copy", last, with a new id', () => {
    const { project, f1, pads } = threeLoops();
    const withStep = run(project, setStep(f1.id, 2, { padId: pads[0]! }));
    const after = run(withStep, cloneLoop(f1.id));
    const copy = Object.values(after.loops).at(-1)!;
    expect(copy).toMatchObject({ name: 'F1 copy', kind: 'fill' });
    expect(copy.id).not.toBe(f1.id);
    expect(copy.steps).toEqual(withStep.loops[f1.id]!.steps);
    expect(cloneLoop('nope')(project, ctx).ok).toBe(false);
  });
});
