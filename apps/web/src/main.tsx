import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

/**
 * Web entry point.
 *
 * The host's job is narrow: mount React, catch anything that escapes, and hand
 * off to `App`, which owns the frame loop and the adapters. Everything else
 * lives in the packages.
 */

/**
 * A game that white-screens tells the player nothing. This boundary keeps the
 * failure on screen, with the actual error text, and offers a reload — which is
 * more useful than a console message they will never open.
 */
class GameErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[tuner] unrecoverable error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="tuner-boot">
        <div className="tuner-error">
          <h1 className="tuner-boot__title" style={{ letterSpacing: '0.1em', textIndent: 0 }}>
            The signal broke
          </h1>
          <p className="tuner-boot__status">
            TUNER hit an error it could not recover from. The details below help diagnose it.
          </p>
          <pre>{error.stack ?? error.message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.6rem 1.4rem',
              background: '#1c2559',
              color: '#f5c451',
              border: '1px solid #f5c451',
              borderRadius: 8,
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            Retune
          </button>
        </div>
      </div>
    );
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('TUNER could not find its mount point (#root).');
}

createRoot(container).render(
  <StrictMode>
    <GameErrorBoundary>
      <App />
    </GameErrorBoundary>
  </StrictMode>,
);
