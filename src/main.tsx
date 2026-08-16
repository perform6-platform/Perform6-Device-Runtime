import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform, isBrightSignPlayer } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';
import { ErrorBoundary } from './components/status';
import { initXtOutputBridge } from './platform/xtOutputBridge';
import { initXcOutputBridge } from './platform/xcOutputBridge';

/** Older BrightSign Chromium builds may lack rAF. */
function afterFirstPaint(cb: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(cb));
    return;
  }
  window.setTimeout(cb, 0);
}

/**
 * BrightSign Chromium sometimes ignores the HTML `hidden` attribute alone.
 * Force-hide with inline display + remove so React pairing UI is visible.
 * Safe: shell lives outside #root; mount never depends on it.
 */
function hideBootShell() {
  window.__perform6AppMounted = true;
  const shell = document.getElementById('boot-status');
  if (!shell) return;
  try {
    shell.hidden = true;
    shell.setAttribute('aria-hidden', 'true');
    shell.style.setProperty('display', 'none', 'important');
    shell.style.setProperty('visibility', 'hidden', 'important');
    shell.style.setProperty('pointer-events', 'none', 'important');
    shell.remove();
  } catch (e) {
    console.warn('[Perform6] hideBootShell fallback', e);
    try {
      shell.style.display = 'none';
    } catch {
      /* ignore */
    }
  }
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

  // XT/XC MULTI: secondary HDMI outputs use native roVideoPlayer in autorun.brs
  // (BrightAuthor-style — one Chromium on HDMI-1 only).
  initXtOutputBridge();
  initXcOutputBridge();

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
