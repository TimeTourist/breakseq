import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addPadMember, addSample, createProject, setBpm, setBreak, setHitSource, setMarkers, setPadChoice, sliceWindow } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
import { generateTake } from './generate';
import { breakSong, hitRun, padTurns } from './preview';

const ctx = sequentialIds();
const run = (project: Project, ...commands: Command[]) =>
  commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);

/** One bar of 2 s at 120 BPM in four slices of 0.5 s. */
function split(): Project {
  const project = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }), setBpm(120));
  const id = Object.keys(project.breaks)[0]!;
  return run(project, setBreak(id, 1), setMarkers(id, [0, 0.25, 0.5, 0.75]));
}

const brkOf = (p: Project) => Object.values(p.breaks)[0]!;
const memberOf = (p: Project, slot: number) => p.pads[brkOf(p).pads[slot]!]!.members[0]!;

describe('previews', () => {
  it('plays hits one after another, each as long as it sounds', () => {
    const p = split();
    const r = hitRun(p, [memberOf(p, 0), memberOf(p, 2)]);
    expect(r.triggers.map((t) => t.time)).toEqual([0, 0.5]);
    expect(r.seconds).toBeCloseTo(1, 6);
  });

  it('lets a pad pick each round when looped, a round robin going round whole', () => {
    const p0 = split();
    const padId = brkOf(p0).pads[0]!;
    const p = run(p0, addPadMember(padId, memberOf(p0, 1)), addPadMember(padId, memberOf(p0, 2)), setPadChoice(padId, 'roundRobin'));
    const pad = p.pads[padId]!;
    const turns = padTurns(pad, true, () => 0);
    expect(turns).toHaveLength(9);
    expect(turns.slice(0, 4)).toEqual([pad.members[0], pad.members[1], pad.members[2], pad.members[0]]);
    expect(padTurns(pad, false, () => 0)).toEqual([pad.members[0]]);
  });

  it('plays a break as laid out, so a replaced slice plays what replaced it', () => {
    const p0 = split();
    const brk = brkOf(p0);
    // Slot 4 plays slice 2 instead.
    const p = run(p0, setHitSource(memberOf(p0, 3), brk.id, 1));
    const take = generateTake(breakSong(p, brk.id), () => 0);
    expect(take.triggers.map((t) => t.step)).toEqual([0, 4, 8, 12]);
    expect(take.triggers[3]!.region).toEqual(take.triggers[1]!.region);
    expect(take.triggers[3]!.region).toEqual(sliceWindow(p, brk, 1));
  });
});
