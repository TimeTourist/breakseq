import type { Id, Project } from '../../model';
import { hitRun } from '../../engine';
import { browserFolders } from '../folders';
import { pluginFiles } from './plugin-files';
import type { Player } from '../playback';
import { createPlayer } from '../playback';
import type { ClipField, Frozen, Host, Services, SongTo } from '../services';
import { renderers } from '../services';
import type { Bridge } from './bridge';
import { bytesToBase64, floatsToBase64 } from './bridge';
import { pluginStorage } from './plugin-storage';
import type { RemoteAudio } from './remote-audio';
import { remoteAudio } from './remote-audio';

/** Reason as the page sees it, over the bridge to the plugin's C++ side. */
export function bridgeHost(bridge: Bridge): Host {
  return {
    onTempo: (listener) => {
      let live = true;
      void bridge.call('hostInfo').then((info) => {
        const bpm = (info as { bpm?: unknown } | null)?.bpm;
        if (live && typeof bpm === 'number' && bpm > 0) listener(bpm);
      });
      const stop = bridge.on('tempo', (bpm) => {
        if (typeof bpm === 'number' && bpm > 0) listener(bpm);
      });
      return () => {
        live = false;
        stop();
      };
    },
    onSongTo: (listener) =>
      bridge.on('songTo', (kind) => {
        if (kind === 'audio' || kind === 'midi' || kind === 'rex') listener(kind as SongTo);
      }),
    sampleRate: async () => {
      const rate = ((await bridge.call('hostInfo')) as { sampleRate?: unknown } | null)?.sampleRate;
      return typeof rate === 'number' && rate > 0 ? rate : 44100;
    },
    frozen: async () => {
      const frozen = ((await bridge.call('hostInfo')) as { frozen?: Frozen | null } | null)?.frozen;
      return frozen === undefined || frozen === null ? null : frozen;
    },
    freeze: async (pieces, rate, bpm, fingerprint) => {
      await bridge.call('freeze', { rate, bpm, fingerprint, pieces: pieces.map((piece) => piece.map(floatsToBase64)) });
    },
    clip: async (field: ClipField, file) => {
      await bridge.call('clip', file === null ? { field } : { field, name: file.name, label: file.label, data: bytesToBase64(file.bytes) });
    },
    status: (text, busy) => {
      void bridge.call('clipStatus', text, busy);
    },
  };
}

/**
 * The web app's player on the plugin's mixer. A click on a hit or pad (playHit)
 * renders the hit first, as Play renders, and then plays it as one buffer: the
 * mixer plays buffers, not the live graph the web app builds for a hit.
 * It sounds once, like an audition, and an audition or another hit cuts it.
 */
export function pluginPlayer(audio: RemoteAudio, renderPreview: Services['renderPreview']): Player {
  const base = createPlayer(() => audio.context);
  let hit: AudioBufferSourceNode | null = null;
  let latest = 0;
  const stopHit = () => {
    latest++;
    try {
      hit?.stop();
    } catch {
      // Already stopped.
    }
    hit = null;
  };
  const playHit = (project: Project, hitId: Id) => {
    base.stopAudition();
    stopHit();
    const mine = latest;
    void renderPreview({ kind: 'hits', project, run: hitRun(project, [hitId]) }).then((take) => {
      if (mine !== latest) return;
      const context = audio.context;
      const source = context.createBufferSource();
      source.buffer = take.full ?? take.buffer;
      source.connect(context.destination);
      source.start(context.currentTime);
      hit = source;
    });
  };
  return {
    ...base,
    playHit,
    audition: (...args) => {
      stopHit();
      base.audition(...args);
    },
    stopAudition: () => {
      stopHit();
      base.stopAudition();
    },
  };
}

/** Saves a file through a Windows save dialog, which the plugin opens. */
const download =
  (bridge: Bridge) =>
  (name: string, bytes: Uint8Array): void => {
    void bridge.call('saveFile', name, bytesToBase64(bytes));
  };

/**
 * Services in the plugin (docs/vst-spec.md): the project in the Reason song,
 * Play through the plugin's output, Reason's tempo, no exports and no backups.
 * Projects, where snapshots live, are .breakseq files the plugin reads and writes.
 */
export function pluginServices(bridge: Bridge): Services {
  const audio = remoteAudio(bridge);
  const render = renderers();
  return {
    storage: pluginStorage(bridge),
    folders: pluginFiles(bridge, browserFolders()),
    player: pluginPlayer(audio, render.renderPreview),
    ...render,
    download: download(bridge),
    rng: () => Math.random,
    host: bridgeHost(bridge),
  };
}
