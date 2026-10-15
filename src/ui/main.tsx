import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserServices } from './services';
import { createStore } from './store';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <App store={createStore()} services={browserServices()} />
  </StrictMode>,
);
