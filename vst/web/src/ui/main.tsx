import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserServices } from './services';
import { newProject } from '../model';
import { createStore, initialState } from './store';
import { juceBridge } from './plugin/bridge';
import { pluginServices } from './plugin/plugin-services';
// The fonts are in the plugin, not fetched: the page works offline in Reason.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('No #root element');

// Inside the plugin JUCE's backend is there: the plugin's services; in a browser, the web app's.
const bridge = juceBridge();

createRoot(root).render(
  <StrictMode>
    <App store={createStore(initialState(newProject()))} services={bridge === null ? browserServices() : pluginServices(bridge)} />
  </StrictMode>,
);
