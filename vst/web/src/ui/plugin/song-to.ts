import type { Project } from '../../model';
import { FIRST_NOTE, MidiExportError, songToAudio, songToMidi } from '../../engine';
import type { Host } from '../services';
import { exportBase, timestamp } from '../services';

/**
 * Song to Audio and Song to MIDI (docs/vst-spec.md): render, then hand the
 * files to the plugin's bar to drag to Reason. Song to MIDI freezes its pieces
 * in the instance; when that would change the keys of clips already in Reason
 * it asks first, and a no leaves everything as it was (Magnus beslut).
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note's name as Reason shows it: 36 is C1. */
export const noteName = (note: number): string => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 2}`;

const bars = (project: Project) => `${project.song.bars} bar${project.song.bars === 1 ? '' : 's'}`;

export async function runSongToAudio(project: Project, host: Host): Promise<void> {
  host.status('Rendering the song…', true);
  try {
    const bytes = await songToAudio(project, await host.sampleRate());
    await host.clip('audio', { name: `${exportBase(project.song.bpm, timestamp())}.wav`, bytes, label: `Audio · ${bars(project)}` });
    host.status('Drag Audio to an audio track in Reason.', false);
  } catch {
    host.status('Could not render the song.', false);
  }
}

/** `ask`: whether to rebuild the keys, asked only when frozen pieces would change. */
export async function runSongToMidi(project: Project, host: Host, ask: () => Promise<boolean>): Promise<void> {
  host.status('Rendering the sounds…', true);
  try {
    const rate = await host.sampleRate();
    const result = await songToMidi(project, rate);
    const frozen = await host.frozen();
    const changes = frozen === null || frozen.fingerprint !== result.fingerprint;
    if (frozen !== null && changes && !(await ask())) {
      host.status('The keys are as they were: nothing changed.', false);
      return;
    }
    if (frozen === null || changes || frozen.bpm !== project.song.bpm) await host.freeze(result.pieces, rate, project.song.bpm, result.fingerprint);
    const base = exportBase(project.song.bpm, timestamp());
    const count = result.pieces.length;
    const keys = count === 0 ? 'no keys' : `${noteName(FIRST_NOTE)}–${noteName(FIRST_NOTE + count - 1)}`;
    await host.clip('midi', { name: `${base}.mid`, bytes: result.midi, label: `MIDI · ${bars(project)} · ${count} sound${count === 1 ? '' : 's'} · ${keys}` });
    await host.clip('space', result.space === null ? null : { name: `${base}-reverb-delay.wav`, bytes: result.space, label: `Reverb/delay · ${bars(project)}` });
    host.status(result.space === null ? 'Drag MIDI to this instrument’s track in Reason.' : 'Drag MIDI to this instrument’s track, and Reverb/delay to an audio track from the same bar.', false);
  } catch (error) {
    host.status(error instanceof MidiExportError ? error.message : 'Could not render the sounds.', false);
  }
}
