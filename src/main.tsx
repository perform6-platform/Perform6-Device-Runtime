import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform, isBrightSignPlayer } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';
import { ErrorBoundary } from './components/status';

getPlatform().init();

const Router =
  isBrightSignPlayer() || window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <ErrorBoundary>
        <DeviceProvider>
          <RuntimeProvider>
            <App />
          </RuntimeProvider>
        </DeviceProvider>
      </ErrorBoundary>
    </Router>
  </StrictMode>,
);
