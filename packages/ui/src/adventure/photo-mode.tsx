import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Button, Panel } from '../components.js';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **Photo mode.**
 *
 * A region that has just been retuned from 440 back to 432 looks different from
 * the one the player walked into, and there should be a way to keep that. So:
 * HUD off, camera freed, a few framing aids, and a shutter.
 *
 * This component does not touch pixels. Capture belongs to whoever owns the
 * renderer's canvas, so the shutter calls `onCapture` with the framing it was
 * fired at and nothing else. Same for the camera: photo mode publishes a
 * `PhotoCameraState` through `onCameraChange` and the host drives the real camera
 * with it. That keeps the interface layer free of Three.js, which is the boundary
 * the whole package is built on.
 */

export interface PhotoCameraState {
  /** Yaw around the subject, in radians. */
  readonly orbit: number;
  /** Pitch, in radians. Clamped short of straight up or down. */
  readonly pitch: number;
  /** Metres from the subject. */
  readonly distance: number;
  /** Metres above the subject's feet. */
  readonly height: number;
  /** Dutch tilt, in radians. */
  readonly roll: number;
  /** Vertical field of view, in degrees. */
  readonly fov: number;
}

export const DEFAULT_PHOTO_CAMERA: PhotoCameraState = {
  orbit: 0,
  pitch: -0.12,
  distance: 6,
  height: 1.7,
  roll: 0,
  fov: 55,
};

export const PHOTO_LIMITS = {
  pitch: { min: -1.3, max: 1.3 },
  distance: { min: 1.2, max: 22 },
  height: { min: -3, max: 14 },
  roll: { min: -0.6, max: 0.6 },
  fov: { min: 24, max: 96 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Keeps a free camera inside the limits, and wraps orbit rather than clamping it. */
export function clampPhotoCamera(camera: PhotoCameraState): PhotoCameraState {
  const tau = Math.PI * 2;
  return {
    orbit: ((camera.orbit % tau) + tau) % tau,
    pitch: clamp(camera.pitch, PHOTO_LIMITS.pitch.min, PHOTO_LIMITS.pitch.max),
    distance: clamp(camera.distance, PHOTO_LIMITS.distance.min, PHOTO_LIMITS.distance.max),
    height: clamp(camera.height, PHOTO_LIMITS.height.min, PHOTO_LIMITS.height.max),
    roll: clamp(camera.roll, PHOTO_LIMITS.roll.min, PHOTO_LIMITS.roll.max),
    fov: clamp(camera.fov, PHOTO_LIMITS.fov.min, PHOTO_LIMITS.fov.max),
  };
}

/** True when the horizon is close enough to level to call it level. */
export function isLevel(roll: number, toleranceRadians = 0.015): boolean {
  return Math.abs(roll) <= toleranceRadians;
}

export interface PhotoFraming {
  readonly camera: PhotoCameraState;
  readonly thirds: boolean;
  readonly horizon: boolean;
  readonly centreMark: boolean;
}

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const SCOPE = 'tuner-photo';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:2px}`}</style>
  );
}

/**
 * Focus arbitration, per key rather than wholesale.
 *
 * The framing shortcuts are bound to the window so they work while the player is
 * looking at the picture rather than at a control. That has to yield where the
 * focused element genuinely owns the key — a field-of-view slider lives on the
 * arrow keys, and a focused button owns Enter — but not everywhere, or the camera
 * would freeze the moment anyone touched a button.
 */
function matches(target: EventTarget | null, selector: string): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(selector) !== null;
}

/** Sliders, selects and text fields consume arrows, digits and characters. */
function ownsValueKeys(target: EventTarget | null): boolean {
  return matches(target, 'input,select,textarea');
}

/** Enter and Space belong to a focused button or link. */
function ownsActivation(target: EventTarget | null): boolean {
  return matches(target, 'button,a,input,select,textarea');
}

export interface PhotoModeProps {
  readonly onExit: () => void;
  /** Fired by the shutter. The host owns the actual pixel grab. */
  readonly onCapture: (framing: PhotoFraming) => void;
  /** Every camera change, for the host to apply to the real camera. */
  readonly onCameraChange?: (camera: PhotoCameraState) => void;
  /** Called with `false` on entry and `true` on exit, so the host can hide the HUD. */
  readonly onHudVisibilityChange?: (visible: boolean) => void;
  readonly initialCamera?: Partial<PhotoCameraState>;
  readonly regionName?: string;
}

export function PhotoMode({
  onExit,
  onCapture,
  onCameraChange,
  onHudVisibilityChange,
  initialCamera,
  regionName,
}: PhotoModeProps): ReactElement {
  const theme = useTheme();
  const reducedFlashing = useUIStore((s) => s.accessibility.reducedFlashing) === true;
  const [camera, setCamera] = useState<PhotoCameraState>(() =>
    clampPhotoCamera({ ...DEFAULT_PHOTO_CAMERA, ...initialCamera }),
  );
  const [thirds, setThirds] = useState(true);
  const [horizon, setHorizon] = useState(true);
  const [centreMark, setCentreMark] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [flash, setFlash] = useState(0);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const framingRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // The framing surface takes focus on entry, so the arrow keys move the camera
  // from the first keypress rather than after the player has hunted for
  // something to click.
  useEffect(() => {
    framingRef.current?.focus();
  }, []);

  const apply = useCallback(
    (next: Partial<PhotoCameraState>) => {
      const merged = clampPhotoCamera({ ...cameraRef.current, ...next });
      cameraRef.current = merged;
      setCamera(merged);
      onCameraChange?.(merged);
    },
    [onCameraChange],
  );

  // The HUD is the host's to hide; photo mode only says when. Ref-held so an
  // inline callback cannot turn this into a per-render hide/show flicker.
  const hudRef = useRef(onHudVisibilityChange);
  hudRef.current = onHudVisibilityChange;
  useEffect(() => {
    const notify = hudRef.current;
    notify?.(false);
    return () => notify?.(true);
  }, []);

  const shoot = useCallback(() => {
    onCapture({ camera: cameraRef.current, thirds, horizon, centreMark });
    setFlash((n) => n + 1);
    // Hand focus back to the framing surface so the next adjustment is one
    // keypress away, not a Tab away.
    framingRef.current?.focus();
  }, [centreMark, horizon, onCapture, thirds]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent): void => {
      const current = cameraRef.current;
      // Escape always exits. Everything else yields to a focused control —
      // otherwise the arrow keys would orbit the camera *and* be swallowed
      // before the field-of-view slider ever saw them.
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (ownsActivation(event.target)) return;
        event.preventDefault();
        shoot();
        return;
      }
      if (ownsValueKeys(event.target)) return;
      switch (event.key) {
        case 'ArrowLeft':
          apply({ orbit: current.orbit - 0.06 });
          break;
        case 'ArrowRight':
          apply({ orbit: current.orbit + 0.06 });
          break;
        case 'ArrowUp':
          apply({ pitch: current.pitch - 0.04 });
          break;
        case 'ArrowDown':
          apply({ pitch: current.pitch + 0.04 });
          break;
        case 'w':
        case 'W':
          apply({ height: current.height + 0.2 });
          break;
        case 's':
        case 'S':
          apply({ height: current.height - 0.2 });
          break;
        case '+':
        case '=':
          apply({ distance: current.distance - 0.5 });
          break;
        case '-':
        case '_':
          apply({ distance: current.distance + 0.5 });
          break;
        case 'q':
        case 'Q':
          apply({ roll: current.roll - 0.03 });
          break;
        case 'e':
        case 'E':
          apply({ roll: current.roll + 0.03 });
          break;
        case 'r':
        case 'R':
          apply(DEFAULT_PHOTO_CAMERA);
          break;
        case 'h':
        case 'H':
          setChromeHidden((hidden) => !hidden);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, onExit, shoot]);

  // Reset the shutter blink; a single frame of white, never a strobe.
  useEffect(() => {
    if (flash === 0) return;
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setFlash(0), 160);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const from = dragging.current;
      if (!from) return;
      dragging.current = { x: event.clientX, y: event.clientY };
      apply({
        orbit: cameraRef.current.orbit + (event.clientX - from.x) * 0.006,
        pitch: cameraRef.current.pitch + (event.clientY - from.y) * 0.004,
      });
    },
    [apply],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      apply({ distance: cameraRef.current.distance + Math.sign(event.deltaY) * 0.5 });
    },
    [apply],
  );

  const level = isLevel(camera.roll);
  const rollDegrees = (camera.roll * 180) / Math.PI;

  return (
    <div
      className={SCOPE}
      data-testid="photo-mode"
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />

      {/* Framing surface. Transparent — the world is the picture. */}
      <div
        ref={framingRef}
        role="application"
        tabIndex={0}
        aria-label="Photo framing. Drag or use the arrow keys to move the camera. Enter captures."
        data-testid="photo-framing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'grab' }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
          style={{ position: 'absolute', inset: 0 }}
        >
          {thirds && (
            <g stroke={theme.colour.text} strokeWidth={0.8} opacity={0.4}>
              <line x1={333.3} y1={0} x2={333.3} y2={600} />
              <line x1={666.6} y1={0} x2={666.6} y2={600} />
              <line x1={0} y1={200} x2={1000} y2={200} />
              <line x1={0} y1={400} x2={1000} y2={400} />
            </g>
          )}

          {centreMark && (
            <g stroke={theme.colour.gold} strokeWidth={1} opacity={0.65}>
              <line x1={480} y1={300} x2={520} y2={300} />
              <line x1={500} y1={280} x2={500} y2={320} />
            </g>
          )}

          {horizon && (
            <g>
              {/* The camera's own horizon, tilted by roll. Green when level. */}
              <line
                x1={150}
                y1={300}
                x2={850}
                y2={300}
                stroke={level ? theme.colour.restore : theme.colour.alarm}
                strokeWidth={1.6}
                opacity={0.85}
                transform={`rotate(${rollDegrees} 500 300)`}
              />
              <line x1={150} y1={300} x2={250} y2={300} stroke={theme.colour.text} strokeWidth={0.8} opacity={0.35} />
              <line x1={750} y1={300} x2={850} y2={300} stroke={theme.colour.text} strokeWidth={0.8} opacity={0.35} />
            </g>
          )}

          {/* Frame corners, so the shot's edges are unambiguous. */}
          <g stroke={theme.colour.gold} strokeWidth={2} opacity={0.8} fill="none">
            <path d="M 24 60 L 24 24 L 70 24" />
            <path d="M 930 24 L 976 24 L 976 60" />
            <path d="M 976 540 L 976 576 L 930 576" />
            <path d="M 70 576 L 24 576 L 24 540" />
          </g>
        </svg>
      </div>

      {/* Shutter blink. One short frame, and never at all under reduced flashing. */}
      {flash > 0 && !reducedFlashing && !theme.reducedMotion && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: theme.colour.text,
            opacity: 0.35,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Always reachable, even with the chrome hidden. */}
      <div
        style={{
          position: 'absolute',
          bottom: theme.space(3),
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: theme.space(1.5),
        }}
      >
        <button
          type="button"
          data-testid="photo-capture"
          onClick={shoot}
          aria-label="Capture this framing"
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            background: 'rgba(11,16,48,0.75)',
            border: `2px solid ${theme.colour.gold}`,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={38} height={38} viewBox="0 0 38 38" aria-hidden focusable="false">
            <circle cx={19} cy={19} r={13} fill="none" stroke={theme.colour.gold} strokeWidth={2} />
            <circle cx={19} cy={19} r={6.5} fill={theme.colour.resonance} />
            {Array.from({ length: 6 }, (_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1={19 + Math.cos(angle) * 7}
                  y1={19 + Math.sin(angle) * 7}
                  x2={19 + Math.cos(angle) * 13}
                  y2={19 + Math.sin(angle) * 13}
                  stroke={theme.colour.gold}
                  strokeWidth={1.2}
                />
              );
            })}
          </svg>
        </button>
        <button
          type="button"
          data-testid="photo-toggle-chrome"
          onClick={() => setChromeHidden((hidden) => !hidden)}
          aria-pressed={chromeHidden}
          aria-label={chromeHidden ? 'Show photo controls' : 'Hide photo controls'}
          style={{
            font: 'inherit',
            fontSize: theme.font.tiny,
            letterSpacing: '0.14em',
            minHeight: 40,
            padding: `0 ${theme.space(1.5)}`,
            background: 'rgba(11,16,48,0.75)',
            color: theme.colour.textDim,
            border: `1px solid ${theme.colour.outline}`,
            borderRadius: theme.radius.sm,
            cursor: 'pointer',
          }}
        >
          {chromeHidden ? 'CONTROLS' : 'CLEAN VIEW'}
        </button>
      </div>

      {!chromeHidden && (
        <Panel
          theme={theme}
          testId="photo-controls"
          style={{
            position: 'absolute',
            top: theme.space(2),
            right: theme.space(2),
            width: 'min(20rem, 46vw)',
            maxHeight: '78vh',
            overflowY: 'auto',
            background: 'rgba(11,16,48,0.9)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space(1) }}>
            <h2 style={{ margin: 0, fontSize: theme.font.title, color: theme.colour.gold, letterSpacing: '0.14em' }}>
              Photo
            </h2>
            <span style={{ fontSize: theme.font.tiny, color: theme.colour.textDim }}>{regionName ?? ''}</span>
          </div>

          <PhotoSlider
            theme={theme}
            testId="photo-fov"
            label="Field of view"
            value={camera.fov}
            min={PHOTO_LIMITS.fov.min}
            max={PHOTO_LIMITS.fov.max}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(fov) => apply({ fov })}
          />
          <PhotoSlider
            theme={theme}
            testId="photo-distance"
            label="Distance"
            value={camera.distance}
            min={PHOTO_LIMITS.distance.min}
            max={PHOTO_LIMITS.distance.max}
            step={0.1}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(distance) => apply({ distance })}
          />
          <PhotoSlider
            theme={theme}
            testId="photo-height"
            label="Height"
            value={camera.height}
            min={PHOTO_LIMITS.height.min}
            max={PHOTO_LIMITS.height.max}
            step={0.1}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(height) => apply({ height })}
          />
          <PhotoSlider
            theme={theme}
            testId="photo-roll"
            label="Tilt"
            value={camera.roll}
            min={PHOTO_LIMITS.roll.min}
            max={PHOTO_LIMITS.roll.max}
            step={0.005}
            format={(v) => `${((v * 180) / Math.PI).toFixed(1)}°`}
            onChange={(roll) => apply({ roll })}
          />
          <PhotoSlider
            theme={theme}
            testId="photo-orbit"
            label="Orbit"
            value={camera.orbit}
            min={0}
            max={Math.PI * 2}
            step={0.01}
            format={(v) => `${((v * 180) / Math.PI).toFixed(0)}°`}
            onChange={(orbit) => apply({ orbit })}
          />

          <div style={{ marginTop: theme.space(1.5) }}>
            <AidToggle theme={theme} testId="photo-aid-thirds" label="Rule of thirds" value={thirds} onChange={setThirds} />
            <AidToggle theme={theme} testId="photo-aid-horizon" label="Level horizon" value={horizon} onChange={setHorizon} />
            <AidToggle theme={theme} testId="photo-aid-centre" label="Centre mark" value={centreMark} onChange={setCentreMark} />
          </div>

          <p
            data-testid="photo-level-readout"
            aria-live="polite"
            style={{
              margin: `${theme.space(1.5)} 0 0`,
              fontSize: theme.font.tiny,
              color: level ? theme.colour.restore : theme.colour.alarm,
              letterSpacing: '0.12em',
            }}
          >
            {level ? 'HORIZON LEVEL' : `TILTED ${Math.abs(rollDegrees).toFixed(1)}°`}
          </p>

          <div style={{ display: 'flex', gap: theme.space(1), marginTop: theme.space(1.5) }}>
            <Button
              theme={theme}
              testId="photo-reset"
              style={{ width: 'auto', marginBottom: 0 }}
              onClick={() => apply(DEFAULT_PHOTO_CAMERA)}
            >
              Reset
            </Button>
            <Button
              theme={theme}
              variant="ghost"
              testId="photo-exit"
              style={{ width: 'auto', marginBottom: 0 }}
              onClick={onExit}
            >
              Exit
            </Button>
          </div>

          <p style={{ margin: `${theme.space(1.5)} 0 0`, fontSize: theme.font.tiny, color: theme.colour.textDim, lineHeight: 1.6 }}>
            Drag to orbit · scroll to move in · W and S raise and lower · Q and E tilt · H hides
            these controls · Enter captures.
          </p>
        </Panel>
      )}
    </div>
  );
}

function PhotoSlider({
  theme,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  testId,
}: {
  theme: Theme;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  testId?: string;
}): ReactElement {
  return (
    <label
      style={{
        display: 'block',
        marginTop: theme.space(1.25),
        fontSize: theme.font.small,
        color: theme.colour.text,
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: theme.colour.textDim }}>{format(value)}</span>
      </span>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label}, ${format(value)}`}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
        style={{ width: '100%', accentColor: theme.colour.resonance }}
      />
    </label>
  );
}

function AidToggle({
  theme,
  label,
  value,
  onChange,
  testId,
}: {
  theme: Theme;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={value}
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.space(1),
        width: '100%',
        minHeight: 40,
        font: 'inherit',
        fontSize: theme.font.small,
        textAlign: 'left',
        padding: theme.space(0.75),
        marginBottom: theme.space(0.5),
        background: 'transparent',
        color: theme.colour.text,
        border: '1px solid rgba(245,196,81,0.2)',
        borderRadius: theme.radius.sm,
        cursor: 'pointer',
      }}
    >
      <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden focusable="false">
        <rect x={1.5} y={1.5} width={15} height={15} rx={3} fill="none" stroke={theme.colour.outline} strokeWidth={1.4} />
        {value && <path d="M 4.5 9.4 L 7.6 12.5 L 13.5 5.6" fill="none" stroke={theme.colour.resonance} strokeWidth={2.2} strokeLinecap="round" />}
      </svg>
      {label}
    </button>
  );
}
