import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform, isBrightSignPlayer } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';
import { ErrorBoundary } from './components/status';

/** Older BrightSign Chromium builds may lack rAF. */
function afterFirstPaint(cb: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(cb));
    return;
  }
  window.setTimeout(cb, 0);
}

function hideBootShell() {
  const shell = document.getElementById('boot-status');
  if (shell) {
    shell.hidden = true;
    shell.setAttribute('aria-hidden', 'true');
  }
  window.__perform6AppMounted = true;
}

function showMountFailure(err: unknown) {
  const detail =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown mount error';
  console.error('[Perform6] React mount failed', err);
  if (typeof window.__perform6MountFailed === 'function') {
    window.__perform6MountFailed(detail);
  }
}

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Missing #root element in index.html');
  }

  const onBrightSign =
    isBrightSignPlayer() || window.location.protocol === 'file:';

  // HashRouter required for file:// / BrightSign (no History API server).
  const Router = onBrightSign ? HashRouter : BrowserRouter;

  // StrictMode double-invokes effects — keep off on BrightSign for older Chromium stability.
  const tree = (
    <Router>
      <ErrorBoundary>
        <DeviceProvider>
          <RuntimeProvider>
            <App />
          </RuntimeProvider>
        </DeviceProvider>
      </ErrorBoundary>
    </Router>
  );

  createRoot(rootEl).render(onBrightSign ? tree : <StrictMode>{tree}</StrictMode>);

  afterFirstPaint(() => {
    hideBootShell();
    getPlatform().init();
    console.info('[Perform6] React mounted');
  });
} catch (err) {
  showMountFailure(err);
}
