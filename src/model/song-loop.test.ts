import { describe, expect, it } from 'vitest';
import type { Command, Project } from './index';
import { addClip, addSample, createProject, pasteClip, removeClip, setSlicing, setSongBars, setSongLoop, setSongLoopOn } from './index';
import { constantAudio, sequentialIds } from '../test/fixtures';

const ctx = sequentialIds();

function run(project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}

/** A song of 8 bars with one break, so it has a loop M1. */
function song(): Project {
  const project = run(createProject(), addSample({ name: 'amen.wav', audio: constantAudio(2) }));
  return run(project, setSlicing(Object.keys(project.samples)[0]!, 1));
}

describe('the song loop', () => {
  it('marks steps and turns on; off keeps where it is', () => {
    const marked = run(song(), setSongLoop(16, 48));
    expect(marked.song.loop).toEqual({ start: 16, end: 48, on: true });
    expect(run(marked, setSongLoopOn(false)).song.loop).toEqual({ start: 16, end: 48, on: false });
  });

  it('is at least a step, inside the song', () => {
    const project = song();
    expect(setSongLoop(8, 8)(project, ctx).ok).toBe(false);
    expect(setSongLoop(-1, 8)(project, ctx).ok).toBe(false);
    expect(setSongLoop(0, project.song.bars * 16 + 1)(project, ctx).ok).toBe(false);
  });

  it('with none marked, on loops the whole song and off changes nothing', () => {
    const project = song();
    expect(run(project, setSongLoopOn(true)).song.loop).toEqual({ start: 0, end: project.song.bars * 16, on: true });
    expect(run(project, setSongLoopOn(false))).toBe(project);
  });

  it('is cut with the song, and goes when the song ends before it', () => {
    const marked = run(song(), setSongBars(8), setSongLoop(16, 64));
    expect(run(marked, setSongBars(3)).song.loop).toEqual({ start: 16, end: 48, on: true });
    expect(run(marked, setSongBars(1)).song.loop).toBeNull();
  });
});

describe('pasteClip', () => {
  it('lays a copy of a clip at a step, even after the clip is removed', () => {
    const project = song();
    const loop = Object.keys(project.loops)[0]!;
    const laid = run(project, addClip('main', loop, 0, 16));
    const clip = laid.song.clips[0]!;
    const pasted = run(laid, removeClip(clip.id), pasteClip(clip, 'main', 32));
    expect(pasted.song.clips.map((c) => [c.start, c.length])).toEqual([[32, 16]]);
    expect(pasted.song.clips[0]!.id).not.toBe(clip.id);
  });

  it('keeps loops out of the mod rows', () => {
    const project = song();
    const laid = run(project, addClip('main', Object.keys(project.loops)[0]!, 0, 16));
    expect(pasteClip(laid.song.clips[0]!, 'modA', 0)(laid, ctx).ok).toBe(false);
  });
});
