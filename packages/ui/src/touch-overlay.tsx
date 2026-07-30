import type { ReactElement } from 'react';
import type { TouchVisualState } from '@tuner/input';
import { createTheme } from './theme.js';
import { useUIStore } from './store.js';

/**
 * The on-screen controls.
 *
 * This component only *draws*; `@tuner/input`'s touch source reads. Both use the
 * same `computeTouchLayout`, which is the point — a second copy of the geometry
 * in the renderer is exactly how the visible button and the live hit zone drift
 * apart, and that bug is invisible until a player complains that the jump button
 * "sometimes doesn't work".
 *
 * `pointerEvents` is off throughout: the touch source listens on the canvas, so
 * this overlay must never intercept anything.
 */

export interface TouchControlsProps {
  readonly visual: TouchVisualState;
  readonly opacity?: number;
}

export function TouchControls({ visual, opacity }: TouchControlsProps): ReactElement | null {
  const accessibility = useUIStore((s) => s.accessibility);
  const theme = createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
  });

  const layout = visual.layout;
  if (!layout) return null;

  const alpha = Math.max(0.15, Math.min(1, opacity ?? 0.7));

  return (
    <svg
      data-testid="touch-controls"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: alpha,
      }}
      aria-hidden
    >
      {/* The movement stick, drawn where the thumb actually landed. */}
      {visual.stickOrigin && (
        <>
          <circle
            cx={visual.stickOrigin.x}
            cy={visual.stickOrigin.y}
            r={layout.stickRadius}
            fill="none"
            stroke={theme.colour.outline}
            strokeWidth={2}
            opacity={0.6}
          />
          {visual.stickKnob && (
            <circle
              cx={visual.stickKnob.x}
              cy={visual.stickKnob.y}
              r={layout.stickRadius * 0.38}
              fill={theme.colour.resonance}
              opacity={0.55}
            />
          )}
        </>
      )}

      {/* Hint ring showing where the stick will appear, before first touch. */}
      {!visual.stickOrigin && (
        <circle
          // Kept off the bottom-left corner, which the Coherence ring owns.
          cx={layout.stickRegion.x + layout.stickRegion.width * 0.52}
          cy={layout.stickRegion.y + layout.stickRegion.height * 0.62}
          r={layout.stickRadius * 0.8}
          fill="none"
          stroke={theme.colour.textDim}
          strokeWidth={1.5}
          strokeDasharray="6 8"
          opacity={0.45}
        />
      )}

      {layout.buttons.map((rect) => {
        const pressed = visual.pressed.has(rect.id);
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const r = Math.min(rect.width, rect.height) / 2;
        return (
          <g key={rect.id}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={pressed ? theme.colour.resonance : 'rgba(19,26,68,0.55)'}
              stroke={theme.colour.outline}
              strokeWidth={pressed ? 3 : 1.5}
              opacity={pressed ? 0.9 : 0.75}
            />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize={Math.max(9, r * 0.42)}
              fill={pressed ? theme.colour.panel : theme.colour.text}
              style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {rect.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
