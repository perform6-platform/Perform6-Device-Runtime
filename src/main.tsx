import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { getPlatform, isBrightSignPlayer } from './platform';
import { DeviceProvider, RuntimeProvider } from './contexts';
import { ErrorBoundary } from './components/status';

declare global {
  interface Window {
    __perform6ScriptStarted?: boolean;
    __perform6Mounted?: boolean;
    __perform6ShowBootError?: (title: string, detail: string) => void;
  }
}

/** Prefer HashRouter on BrightSign / file:// (path routing breaks under file URLs). */
const useHashRouter =
  isBrightSignPlayer() ||
  (typeof window !== 'undefined' && window.location.protocol === 'file:');

function showBootError(title: string, detail: string): void {
  try {
    if (typeof window.__perform6ShowBootError === 'function') {
      window.__perform6ShowBootError(title, detail);
      return;
    }
  } catch {
    /* fall through */
  }

  const msg = document.getElementById('boot-msg');
  const hint = document.getElementById('boot-hint');
  if (msg) msg.textContent = title;
  if (hint) hint.textContent = detail;
}

function markScriptStarted(): void {
  try {
    window.__perform6ScriptStarted = true;
  } catch {
    /* ignore */
  }
}

function markMounted(): void {
  try {
    window.__perform6Mounted = true;
  } catch {
    /* ignore */
  }
}

function mountApp(): void {
  markScriptStarted();

  try {
    getPlatform().init();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[Perform6] platform init failed', e);
    showBootError('Platform init failed', detail);
    return;
  }

  const el = document.getElementById('root');
  if (!el) {
    showBootError('Missing #root', 'index.html must contain <div id="root">. Re-copy the package to the SD root.');
    return;
  }

  const Router = useHashRouter ? HashRouter : BrowserRouter;
  // StrictMode double-invokes effects on BrightSign and can race pairing boot refs.
  const tree: ReactNode = (
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

  try {
    const root = createRoot(el);
    root.render(useHashRouter ? tree : <StrictMode>{tree}</StrictMode>);
    markMounted();
    console.info('[Perform6] React root mounted', {
      router: useHashRouter ? 'hash' : 'browser',
      href: window.location.href,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[Perform6] React mount failed', e);
    showBootError('React UI failed to mount', detail);
  }
}

window.addEventListener('error', (ev) => {
  if (window.__perform6Mounted) return;
  const detail = ev.message || String(ev.error || 'Unknown script error');
  console.error('[Perform6] uncaught error before mount', ev.error || ev.message);
  showBootError('Script error before UI mount', detail);
});

window.addEventListener('unhandledrejection', (ev) => {
  if (window.__perform6Mounted) return;
  const reason = ev.reason;
  const detail =
    reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? 'Unhandled rejection');
  console.error('[Perform6] unhandled rejection before mount', reason);
  showBootError('Startup promise failed', detail);
});

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountApp(), { once: true });
  } else {
    mountApp();
  }
} catch (e) {
  const detail = e instanceof Error ? e.message : String(e);
  console.error('[Perform6] bootstrap failed', e);
  showBootError('App bootstrap failed', detail);
}
