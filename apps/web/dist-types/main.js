import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { StrictMode, Component } from 'react';
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
class GameErrorBoundary extends Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error('[tuner] unrecoverable error', error, info.componentStack);
    }
    render() {
        const { error } = this.state;
        if (!error)
            return this.props.children;
        return (_jsx("div", { className: "tuner-boot", children: _jsxs("div", { className: "tuner-error", children: [_jsx("h1", { className: "tuner-boot__title", style: { letterSpacing: '0.1em', textIndent: 0 }, children: "The signal broke" }), _jsx("p", { className: "tuner-boot__status", children: "TUNER hit an error it could not recover from. The details below help diagnose it." }), _jsx("pre", { children: error.stack ?? error.message }), _jsx("button", { type: "button", onClick: () => window.location.reload(), style: {
                            marginTop: '1rem',
                            padding: '0.6rem 1.4rem',
                            background: '#1c2559',
                            color: '#f5c451',
                            border: '1px solid #f5c451',
                            borderRadius: 8,
                            font: 'inherit',
                            cursor: 'pointer',
                        }, children: "Retune" })] }) }));
    }
}
const container = document.getElementById('root');
if (!container) {
    throw new Error('TUNER could not find its mount point (#root).');
}
createRoot(container).render(_jsx(StrictMode, { children: _jsx(GameErrorBoundary, { children: _jsx(App, {}) }) }));
//# sourceMappingURL=main.js.map