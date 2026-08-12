import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';
import { ErrorBoundary } from './components/status';

getPlatform().init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter: BrightSign loads via file:// — BrowserRouter breaks and yields a black screen */}
    <HashRouter>
      <ErrorBoundary>
        <DeviceProvider>
          <RuntimeProvider>
            <App />
          </RuntimeProvider>
        </DeviceProvider>
      </ErrorBoundary>
    </HashRouter>
  </StrictMode>,
);
