import type { Project } from '../../model';
import { readProjectFile, writeProjectFile } from '../../engine';
import type { ProjectStorage } from '../persist';
import type { Bridge } from './bridge';
import { base64ToBytes, bytesToBase64 } from './bridge';

/**
 * The project kept in the plugin instance's state, so it is saved in the
 * Reason song (docs/vst-spec.md, Lagring). It goes over as a project file,
 * audio and all, in base64; the C++ side keeps it as it is.
 */
export function pluginStorage(bridge: Bridge): ProjectStorage {
  return {
    load: async () => {
      const saved = await bridge.call('loadProject');
      return typeof saved === 'string' && saved !== '' ? readProjectFile(base64ToBytes(saved)) : null;
    },
    save: async (project: Project) => {
      await bridge.call('saveProject', bytesToBase64(writeProjectFile(project)));
    },
  };
}
