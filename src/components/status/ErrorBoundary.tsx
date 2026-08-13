import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches React render/script errors and shows them on-screen
 * instead of leaving a blank black BrightSign display.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Perform6] ErrorBoundary', error, info.componentStack);
    try {
      window.__perform6Mounted = true;
    } catch {
      /* ignore */
    }
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex h-full flex-col items-center justify-center gap-6 bg-p6-bg p-10 text-center text-p6-text">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-400">
          App error
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold sm:text-4xl">
          Something went wrong in the Perform6 app
        </h1>
        <p className="max-w-2xl text-base text-p6-text-muted">{error.message || 'Unknown script error'}</p>
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-xl bg-p6-cyan px-8 py-3 text-sm font-semibold text-black"
        >
          Reload app
        </button>
      </main>
    );
  }
}
