import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../model';
import { addSample, createLoop, createProject, setBpm, setSongBars, setSongCell, setStep, songDuration, stepDuration } from '../model';
import { constantAudio, sequentialIds } from '../test/fixtures';
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
    expect(generateTriggers(alone, () => 0).map((t) => [t.bar, t.step])).toEqual([
      [0, 0],
      [1, 4],
    ]);
  });
});
