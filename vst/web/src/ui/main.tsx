import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserServices } from './services';
import { newProject } from '../model';
import { createStore, initialState } from './store';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <App store={createStore(initialState(newProject()))} services={browserServices()} />
  </StrictMode>,
);
