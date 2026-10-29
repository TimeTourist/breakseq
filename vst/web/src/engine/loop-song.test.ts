import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addClip, addSample, createLoop, createProject, setBpm, setLoopLength, setSongBars, setSongCell, setStep, songDuration, stepDuration } from '../model';
import { constantAudio, sequentialIds, withRng } from '../test/fixtures';
import { generateTriggers, loopSong } from './generate';

// One id counter per file, so ids never repeat between calls.
const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

describe('loopSong', () => {
  it('plays one loop from its first bar and is exactly as long as the loop', () => {
    let project = run(createProject(), setBpm(120), addSample({ name: 'k', audio: constantAudio(0.1) }), createLoop(null, 'fill', 2));
    const pad = Object.values(project.pads)[0]!;
    const fill = Object.values(project.loops)[0]!;
    project = run(project, setStep(fill.id, 0, { padId: pad.id }), setStep(fill.id, 20, { padId: pad.id }), setSongBars(16), setSongCell('fill', 9, fill.id));

    const alone = loopSong(project, fill.id);

    expect(alone.song.bars).toBe(2);
    expect(songDuration(alone.song)).toBeCloseTo(2 * 16 * stepDuration(120));
    expect(generateTriggers(alone, withRng(() => 0)).map((t) => [t.bar, t.step])).toEqual([
      [0, 0],
      [1, 4],
    ]);
  });

  it('a loop of 6/16 is previewed as exactly 6/16, so it loops without a gap', () => {
    let project = run(createProject(), setBpm(120), addSample({ name: 'k', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!;
    const loop = Object.values(project.loops)[0]!;
    project = run(project, setLoopLength(loop.id, 6), setStep(loop.id, 0, { padId: pad.id }), setStep(loop.id, 5, { padId: pad.id }));

    const alone = loopSong(project, loop.id);

    expect(songDuration(alone.song)).toBeCloseTo(6 * stepDuration(120));
    expect(generateTriggers(alone, withRng(() => 0)).map((t) => t.step)).toEqual([0, 5]);
  });

  it('a loop of 6/16 in a clip of one bar starts over after six steps', () => {
    let project = run(createProject(), addSample({ name: 'k', audio: constantAudio(0.1) }), createLoop(null, 'main', 1));
    const pad = Object.values(project.pads)[0]!;
    const loop = Object.values(project.loops)[0]!;
    project = run(project, setLoopLength(loop.id, 6), setStep(loop.id, 0, { padId: pad.id }), setSongBars(1), addClip('main', loop.id, 0, 16));

    expect(generateTriggers(project, withRng(() => 0)).map((t) => t.step)).toEqual([0, 6, 12]);
  });
});
