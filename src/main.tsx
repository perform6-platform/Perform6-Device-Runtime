import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';

getPlatform().init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DeviceProvider>
        <RuntimeProvider>
          <App />
        </RuntimeProvider>
      </DeviceProvider>
    </BrowserRouter>
  </StrictMode>,
);
