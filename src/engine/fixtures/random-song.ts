import type { Command, CommandContext, Id, ModEffect, Project } from '../../model';
import { addClip, addSample, copyHits, createLoop, createMod, createProject, setBpm, setPadChoice, setSongBars, setStep } from '../../model';
import { constantAudio, sequentialIds } from '../../test/fixtures';

function runWith(ctx: CommandContext, project: Project, ...commands: Command[]): Project {
  return commands.reduce((p, c) => {
    const r = c(p, ctx);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.project;
  }, project);
}
const added = (before: Project, after: Project, key: 'hits' | 'pads' | 'loops' | 'mods' | 'matrices'): Id => Object.keys(after[key]).find((k) => !(k in before[key]))!;

/**
 * Two pads of four hits each, Random and No repeat, laid out on every step of
 * a one-bar loop (A on even steps, B on odd), in Main on bars 0 and 1 as two
 * clips; and a mod with Random pitch, Stack and a tape with wow over bar 2.
 */
export function randomSong(ctx: CommandContext = sequentialIds()) {
  const run = (project: Project, ...commands: Command[]) => runWith(ctx, project, ...commands);
  let project = run(createProject(), setBpm(170));
  const hits: Id[] = [];
  const pads: Id[] = [];
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    const next = run(project, addSample({ name, audio: constantAudio(0.05, [0.1, 0.1]) }));
    hits.push(added(project, next, 'hits'));
    pads.push(added(project, next, 'pads'));
    project = next;
  }
  const [padA, padB, padC] = pads as [Id, Id, Id];
  project = run(project, copyHits(hits.slice(1, 4), padA), copyHits([hits[0]!, hits[2]!, hits[4]!], padB), setPadChoice(padA, 'random'), setPadChoice(padB, 'noRepeat'));
  const withLoop = run(project, createLoop('M1', 'main', 1));
  const loop = added(project, withLoop, 'loops');
  project = run(withLoop, ...Array.from({ length: 16 }, (_, i) => setStep(loop, i, { padId: i % 2 === 0 ? padA : padB })));
  const effects: ModEffect[] = [
    { target: 'pitch', rate: 'step', shape: { kind: 'random', min: -12, max: 12, chance: 100, whole: false } },
    { target: 'swap', rate: 'step', mode: { kind: 'stack', pick: 'random' } },
  ];
  const withMod = run(project, createMod('Chaos', effects));
  const mod = added(project, withMod, 'mods');
  const withTape = run(withMod, createMod('Wobble', [{ target: 'tape', length: 4, direction: 'forward', speed: { from: 1, to: 1 }, rampOver: null, curve: 'linear', wow: 1, flutter: 1 }]));
  const tape = added(withMod, withTape, 'mods');
  project = run(withTape, setSongBars(4), addClip('main', loop, 0, 16), addClip('main', loop, 16, 16), addClip('main', loop, 32, 32), addClip('modA', mod, 0, 32), addClip('modB', tape, 32, 16));
  return { project, loop, mod, tape, padA, padB, padC };
}

