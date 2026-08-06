import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform } from './platform';
import { runtimeConfig } from './config/runtime';
import { DeviceProvider, RuntimeProvider } from './contexts';

getPlatform().init();

/**
 * BrightSign loads file:///index.html — BrowserRouter breaks path navigation.
 * HashRouter keeps routes in the hash (#/pairing) so the player stays on index.html.
 */
function useHashRouter(): boolean {
  if (runtimeConfig.runtimeMode === 'BRIGHTSIGN') return true;
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'file:';
}

const Router = useHashRouter() ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <DeviceProvider>
        <RuntimeProvider>
          <App />
        </RuntimeProvider>
      </DeviceProvider>
    </Router>
  </StrictMode>,
);
