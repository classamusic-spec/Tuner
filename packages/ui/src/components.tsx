import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createTheme, SEMANTIC_TOKENS, type SemanticToken, type Theme } from './theme.js';

/**
 * Interface building blocks.
 *
 * Everything is inline SVG or plain style objects — no image assets and no CSS
 * pipeline, so the package drops into any host unchanged.
 *
 * Every interactive element is reachable by keyboard, gamepad and touch, and
 * carries a visible focus ring. A menu that needs a mouse is a broken menu on
 * three of the four platforms this game ships on.
 */

export interface WithTheme {
  readonly theme?: Theme;
}

const fallbackTheme = createTheme();

export function Panel({
  children,
  theme = fallbackTheme,
  style,
  testId,
}: {
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
} & WithTheme): ReactElement {
  return (
    <div
      data-testid={testId}
      style={{
        background: theme.colour.panel,
        border: `1px solid ${theme.colour.outline}`,
        borderRadius: theme.radius.lg,
        padding: theme.space(3),
        color: theme.colour.text,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  theme = fallbackTheme,
  testId,
  variant = 'default',
  autoFocus,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
  variant?: 'default' | 'primary' | 'ghost';
  autoFocus?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
} & WithTheme): ReactElement {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const primary = variant === 'primary';
  const ghost = variant === 'ghost';

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        font: 'inherit',
        fontSize: theme.font.body,
        letterSpacing: '0.08em',
        padding: `${theme.space(1.6)} ${theme.space(3)}`,
        marginBottom: theme.space(1.2),
        background: ghost ? 'transparent' : primary ? theme.colour.panelRaised : theme.colour.panel,
        color: disabled ? theme.colour.textDim : primary ? theme.colour.gold : theme.colour.text,
        border: `1px solid ${primary ? theme.colour.outline : 'rgba(245,196,81,0.35)'}`,
        borderRadius: theme.radius.md,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: theme.reducedMotion ? 'none' : 'background 120ms, border-color 120ms',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
  theme = fallbackTheme,
  testId,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
} & WithTheme): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={value}
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space(2),
        font: 'inherit',
        fontSize: theme.font.body,
        textAlign: 'left',
        padding: theme.space(1.5),
        marginBottom: theme.space(1),
        background: 'transparent',
        color: theme.colour.text,
        border: '1px solid rgba(245,196,81,0.2)',
        borderRadius: theme.radius.md,
        cursor: 'pointer',
      }}
    >
      <span>
        {label}
        {description && (
          <span
            style={{
              display: 'block',
              fontSize: theme.font.tiny,
              color: theme.colour.textDim,
              marginTop: theme.space(0.5),
            }}
          >
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 44,
          height: 24,
          borderRadius: 12,
          border: `1px solid ${theme.colour.outline}`,
          background: value ? theme.colour.resonance : 'transparent',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 22 : 3,
            width: 16,
            height: 16,
            borderRadius: 8,
            background: value ? theme.colour.panel : theme.colour.textDim,
            transition: theme.reducedMotion ? 'none' : 'left 120ms',
          }}
        />
      </span>
    </button>
  );
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
  theme = fallbackTheme,
  testId,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  testId?: string;
} & WithTheme): ReactElement {
  return (
    <label
      data-testid={testId}
      style={{
        display: 'block',
        fontSize: theme.font.small,
        color: theme.colour.text,
        marginBottom: theme.space(1.5),
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: theme.colour.textDim }}>{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        style={{ width: '100%', accentColor: theme.colour.resonance }}
      />
    </label>
  );
}

/**
 * The interface's signature shape.
 *
 * Coherence and charge are rings rather than bars because the game is about
 * frequency, and because a ring's fill reads at a glance without being parsed.
 */
export function TuningRing({
  progress,
  size = 84,
  thickness = 7,
  colour,
  trackColour = 'rgba(255,255,255,0.14)',
  label,
  sublabel,
  token,
  theme = fallbackTheme,
  testId,
}: {
  progress: number;
  size?: number;
  thickness?: number;
  colour: string;
  trackColour?: string;
  label?: string;
  sublabel?: string;
  token?: SemanticToken;
  testId?: string;
} & WithTheme): ReactElement {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      data-testid={testId}
      style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColour}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Colour-blind-safe mode adds the token's shape inside the ring, so the
            meaning survives without any hue being distinguishable. */}
        {theme.showShapes && token && (
          <SemanticShape token={token} cx={size / 2} cy={size / 2} r={radius * 0.32} />
        )}
      </svg>
      {(label || sublabel) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {label && (
            <span style={{ fontSize: theme.font.small, color: theme.colour.text }}>{label}</span>
          )}
          {sublabel && (
            <span style={{ fontSize: theme.font.tiny, color: theme.colour.textDim }}>
              {sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The shape half of a semantic token. */
export function SemanticShape({
  token,
  cx,
  cy,
  r,
}: {
  token: SemanticToken;
  cx: number;
  cy: number;
  r: number;
}): ReactElement {
  const { colour, shape } = SEMANTIC_TOKENS[token];
  switch (shape) {
    case 'diamond':
      return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={colour} />;
    case 'triangle':
      return <polygon points={`${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`} fill={colour} />;
    case 'square':
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill={colour} />;
    case 'hexagon': {
      const points = Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
        return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
      }).join(' ');
      return <polygon points={points} fill={colour} />;
    }
    case 'leaf':
      return (
        <path
          d={`M ${cx} ${cy - r} Q ${cx + r} ${cy} ${cx} ${cy + r} Q ${cx - r} ${cy} ${cx} ${cy - r} Z`}
          fill={colour}
        />
      );
    default:
      return <circle cx={cx} cy={cy} r={r} fill={colour} />;
  }
}

/** The Tuner's emblem: two interlocking rings over a resonance circle. */
export function TunerEmblem({ size = 96, theme = fallbackTheme }: { size?: number } & WithTheme): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="TUNER">
      <circle cx="32" cy="32" r="29" fill="none" stroke={theme.colour.infection} strokeWidth="0.8" opacity="0.5" />
      <circle cx="32" cy="32" r="22" fill="none" stroke={theme.colour.resonance} strokeWidth="1.2" opacity="0.5" />
      <circle cx="26" cy="32" r="11" fill="none" stroke={theme.colour.gold} strokeWidth="3" />
      <circle cx="38" cy="32" r="11" fill="none" stroke={theme.colour.gold} strokeWidth="3" />
    </svg>
  );
}
