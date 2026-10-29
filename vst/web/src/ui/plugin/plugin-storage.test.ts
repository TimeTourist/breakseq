import { describe, expect, it } from 'vitest';
import type { Command, Project } from '../../model';
import { addSample, newProject } from '../../model';
import { sequentialIds } from '../../test/fixtures';
import type { Bridge } from './bridge';
import { pluginStorage } from './plugin-storage';

const ctx = sequentialIds();
const run = (project: Project, command: Command): Project => {
  const r = command(project, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
};

/** The C++ side as far as storage goes: it keeps the last string it was given. */
function fakeHost(initial: string | null = null): Bridge {
  let kept = initial;
  return {
    call: (name, ...params) => {
      if (name === 'saveProject') kept = params[0] as string;
      return Promise.resolve(name === 'loadProject' ? kept : null);
    },
    on: () => () => {},
  };
}

describe('pluginStorage', () => {
  it('has nothing to load in a new instance', async () => {
    expect(await pluginStorage(fakeHost()).load()).toBeNull();
    expect(await pluginStorage(fakeHost('')).load()).toBeNull();
  });

  it('gives back the project it saved, audio and all', async () => {
    const storage = pluginStorage(fakeHost());
    const project = run(newProject(ctx), addSample({ name: 'amen.wav', audio: { sampleRate: 44100, channels: [Float32Array.from([0.5, -0.25, 0.125])] } }));
    await storage.save(project);
    const back = await storage.load();
    expect(back?.samples).toEqual(project.samples);
    const audio = Object.values(back!.audio)[0]!;
    expect(Array.from(audio.channels[0]!)).toEqual([0.5, -0.25, 0.125]);
  });
});
