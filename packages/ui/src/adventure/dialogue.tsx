import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import type { InputDeviceKind } from '@tuner/input';
import type { DialogueChoice, DialogueState } from '@tuner/game-core';
import { Panel } from '../components.js';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **The conversation view.**
 *
 * Three rules shaped this, and all three are visible in the layout.
 *
 * 1. **Text is the primary channel, not a caption.** There is no recorded voice
 *    in TUNER, and the critical path has to be completable muted, so the beat's
 *    line is set at body size in the middle of the panel rather than shrunk into
 *    a subtitle strip.
 * 2. **It must never sit on the subtitle lane.** The HUD owns the bottom centre
 *    for its own subtitles, and a dialogue panel that covered it would hide the
 *    one channel a deaf player depends on. The panel is anchored *above* that
 *    lane by `SUBTITLE_LANE_REM`, which the HUD's geometry is measured against.
 * 3. **Always skippable, on every device.** Skip is a real focusable control, not
 *    a hidden key, and the advance prompt shows the glyph for the device the
 *    player is actually holding — a keyboard hint on a phone is a dead end.
 *
 * Portraits are inline SVG built from shapes keyed by the beat's emote. Nobody is
 * drawn as a face: a speaker is a ring, a brow, an eye pair and a mouth arc, with
 * their own geometry derived from their name. It reads as a person without
 * pretending to be a photograph, and it costs no image assets.
 */

/**
 * Height reserved at the bottom of the screen for the HUD's subtitle lane.
 * Exported because the host may need to reserve the same band for other overlays.
 */
export const SUBTITLE_LANE_REM = 8;

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const SCOPE = 'tuner-dialogue';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:2px}`}</style>
  );
}

// ---------------------------------------------------------------------------
// Portraits
// ---------------------------------------------------------------------------

interface EmoteShape {
  /** 0 closed, 1 wide. */
  readonly eyeOpen: number;
  /** Radians; positive tilts the inner brow down. */
  readonly browTilt: number;
  /** Positive curves the mouth up, negative down. */
  readonly mouthCurve: number;
  /** Mouth width as a fraction of the head radius. */
  readonly mouthWidth: number;
  /** Which semantic colour the halo carries. */
  readonly halo: 'calm' | 'warm' | 'urgent' | 'dim';
}

/**
 * Every emote the authored dialogue uses, plus a neutral fallback.
 *
 * Kept as a table rather than a switch because the renderer and the accessibility
 * caption read the same row — the word under the portrait is never out of step
 * with the shapes above it.
 */
const EMOTES: Readonly<Record<string, EmoteShape>> = {
  flat: { eyeOpen: 0.55, browTilt: 0, mouthCurve: 0, mouthWidth: 0.5, halo: 'calm' },
  warm: { eyeOpen: 0.5, browTilt: -0.12, mouthCurve: 0.5, mouthWidth: 0.56, halo: 'warm' },
  bright: { eyeOpen: 0.85, browTilt: -0.2, mouthCurve: 0.7, mouthWidth: 0.6, halo: 'warm' },
  wry: { eyeOpen: 0.45, browTilt: -0.28, mouthCurve: 0.32, mouthWidth: 0.44, halo: 'calm' },
  dry: { eyeOpen: 0.38, browTilt: 0.1, mouthCurve: -0.12, mouthWidth: 0.46, halo: 'dim' },
  quiet: { eyeOpen: 0.32, browTilt: 0.05, mouthCurve: -0.08, mouthWidth: 0.4, halo: 'dim' },
  tired: { eyeOpen: 0.24, browTilt: 0.22, mouthCurve: -0.24, mouthWidth: 0.46, halo: 'dim' },
  absent: { eyeOpen: 0.2, browTilt: 0.02, mouthCurve: -0.05, mouthWidth: 0.36, halo: 'dim' },
  grave: { eyeOpen: 0.5, browTilt: 0.3, mouthCurve: -0.3, mouthWidth: 0.52, halo: 'calm' },
  guarded: { eyeOpen: 0.4, browTilt: 0.26, mouthCurve: -0.14, mouthWidth: 0.42, halo: 'calm' },
  resolved: { eyeOpen: 0.6, browTilt: 0.16, mouthCurve: 0.12, mouthWidth: 0.54, halo: 'warm' },
  awed: { eyeOpen: 0.95, browTilt: -0.34, mouthCurve: 0.18, mouthWidth: 0.4, halo: 'warm' },
  surprised: { eyeOpen: 1, browTilt: -0.4, mouthCurve: 0.1, mouthWidth: 0.34, halo: 'urgent' },
  dazed: { eyeOpen: 0.7, browTilt: -0.05, mouthCurve: -0.1, mouthWidth: 0.3, halo: 'urgent' },
  scan: { eyeOpen: 0.66, browTilt: 0.12, mouthCurve: 0, mouthWidth: 0.3, halo: 'calm' },
  urgent: { eyeOpen: 0.9, browTilt: 0.34, mouthCurve: -0.34, mouthWidth: 0.62, halo: 'urgent' },
  warning: { eyeOpen: 0.8, browTilt: 0.4, mouthCurve: -0.4, mouthWidth: 0.58, halo: 'urgent' },
};

export const EMOTE_KEYS: readonly string[] = Object.keys(EMOTES);

export function emoteShape(emote: string | undefined): EmoteShape {
  const fallback = EMOTES.flat as EmoteShape;
  if (!emote) return fallback;
  return EMOTES[emote] ?? fallback;
}

/** Stable 0–1 hash of a name. Deterministic, so a speaker always looks the same. */
function nameHash(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/**
 * A speaker, drawn.
 *
 * The emote sets the brow, eyes, mouth and halo; the *name* sets the number of
 * ring facets and the crest, so two people with the same expression are still
 * two different people.
 */
export function SpeakerPortrait({
  speaker,
  emote,
  size = 96,
  theme,
}: {
  speaker: string;
  emote?: string;
  size?: number;
  theme: Theme;
}): ReactElement {
  const shape = emoteShape(emote);
  const seed = nameHash(speaker);
  const facets = 5 + Math.floor(seed * 4); // 5–8
  const r = 34;
  const cx = 50;
  const cy = 50;

  const halo =
    shape.halo === 'urgent'
      ? theme.colour.alarm
      : shape.halo === 'warm'
        ? theme.colour.gold
        : shape.halo === 'dim'
          ? theme.colour.textDim
          : theme.colour.resonance;

  const facetPoints = Array.from({ length: facets }, (_, i) => {
    const angle = (i / facets) * Math.PI * 2 - Math.PI / 2 + seed;
    return `${(cx + Math.cos(angle) * (r + 8)).toFixed(2)},${(cy + Math.sin(angle) * (r + 8)).toFixed(2)}`;
  }).join(' ');

  const eyeY = cy - r * 0.12;
  const eyeDx = r * 0.42;
  const eyeR = 3.4 + shape.eyeOpen * 3.2;
  const browY = eyeY - r * 0.3;
  const browTilt = shape.browTilt * r * 0.5;
  const mouthHalf = (shape.mouthWidth * r) / 2;
  const mouthY = cy + r * 0.42;
  const mouthBend = shape.mouthCurve * r * 0.34;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${speaker}, ${emote ?? 'neutral'}`}
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      {/* Halo: the speaker's own resonance, and the emote's colour channel. */}
      <polygon points={facetPoints} fill="none" stroke={halo} strokeWidth={0.8} opacity={0.55} />
      <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={halo} strokeWidth={1} opacity={0.4} />
      <circle cx={cx} cy={cy} r={r} fill={theme.colour.panelRaised} stroke={theme.colour.outline} strokeWidth={1.6} />

      {/* Crest — name-derived, so identity survives a change of mood. */}
      <path
        d={`M ${cx - r * 0.6} ${cy - r * 0.62} Q ${cx} ${cy - r * (0.78 + seed * 0.4)} ${cx + r * 0.6} ${cy - r * 0.62}`}
        fill="none"
        stroke={theme.colour.gold}
        strokeWidth={1.4}
        opacity={0.8}
      />

      {/* Brows */}
      <line
        x1={cx - eyeDx - 6}
        y1={browY - browTilt}
        x2={cx - eyeDx + 6}
        y2={browY + browTilt}
        stroke={theme.colour.text}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <line
        x1={cx + eyeDx - 6}
        y1={browY + browTilt}
        x2={cx + eyeDx + 6}
        y2={browY - browTilt}
        stroke={theme.colour.text}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Eyes. Nearly-closed emotes become lines rather than tiny dots. */}
      {shape.eyeOpen < 0.3 ? (
        <>
          <line x1={cx - eyeDx - 5} y1={eyeY} x2={cx - eyeDx + 5} y2={eyeY} stroke={theme.colour.text} strokeWidth={2} strokeLinecap="round" />
          <line x1={cx + eyeDx - 5} y1={eyeY} x2={cx + eyeDx + 5} y2={eyeY} stroke={theme.colour.text} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={cx - eyeDx} cy={eyeY} r={eyeR} fill={theme.colour.resonance} opacity={0.9} />
          <circle cx={cx + eyeDx} cy={eyeY} r={eyeR} fill={theme.colour.resonance} opacity={0.9} />
        </>
      )}

      {/* Mouth */}
      <path
        d={`M ${cx - mouthHalf} ${mouthY} Q ${cx} ${mouthY + mouthBend} ${cx + mouthHalf} ${mouthY}`}
        fill="none"
        stroke={theme.colour.text}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Device prompts
// ---------------------------------------------------------------------------

const DEVICE_LABEL: Readonly<Record<InputDeviceKind, string>> = {
  keyboard: 'E',
  gamepad: 'Confirm',
  touch: 'Tap',
};

/**
 * The advance prompt, drawn for the device in the player's hands.
 *
 * Deliberately generic rather than any console's glyph set: a key cap for a
 * keyboard, a face-button ring with a chevron for a pad, a tap ripple for touch.
 */
export function DevicePrompt({
  device,
  theme,
  label,
}: {
  device: InputDeviceKind;
  theme: Theme;
  label?: string;
}): ReactElement {
  const text = label ?? DEVICE_LABEL[device];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        fontSize: theme.font.tiny,
        letterSpacing: '0.14em',
        color: theme.colour.textDim,
      }}
    >
      <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden focusable="false">
        {device === 'keyboard' && (
          <>
            <rect x={2.5} y={3.5} width={21} height={19} rx={4} fill="none" stroke={theme.colour.gold} strokeWidth={1.6} />
            <text x={13} y={17} textAnchor="middle" fontSize={11} fill={theme.colour.gold}>
              {text}
            </text>
          </>
        )}
        {device === 'gamepad' && (
          <>
            <circle cx={13} cy={13} r={9.5} fill="none" stroke={theme.colour.gold} strokeWidth={1.6} />
            <path d="M 8.5 11 L 13 16 L 17.5 11" fill="none" stroke={theme.colour.gold} strokeWidth={2} strokeLinecap="round" />
          </>
        )}
        {device === 'touch' && (
          <>
            <circle cx={13} cy={13} r={4} fill={theme.colour.gold} opacity={0.9} />
            <circle cx={13} cy={13} r={8} fill="none" stroke={theme.colour.gold} strokeWidth={1.2} opacity={0.6} />
            <circle cx={13} cy={13} r={11.5} fill="none" stroke={theme.colour.gold} strokeWidth={0.8} opacity={0.3} />
          </>
        )}
      </svg>
      {device === 'keyboard' ? 'CONTINUE' : text.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * Focus arbitration for the window-level shortcuts.
 *
 * A shortcut that fires regardless of focus fights every control on the screen,
 * and `preventDefault` makes the shortcut win — which is how a Skip button stops
 * skipping. But blocking *every* key whenever a control has focus is just as
 * wrong: the branch list auto-focuses its first choice, so a blanket guard would
 * kill the number-key shortcuts exactly when the player needs them.
 *
 * So the guard is per key. Activation keys yield to whatever is focused; keys the
 * focused control has no use for do not.
 */
function matches(target: EventTarget | null, selector: string): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(selector) !== null;
}

/** Enter and Space belong to a focused button or link. */
function ownsActivation(target: EventTarget | null): boolean {
  return matches(target, 'button,a,input,select,textarea');
}

/** Only a real text or value control consumes stray characters and digits. */
function ownsTyping(target: EventTarget | null): boolean {
  return matches(target, 'input,select,textarea');
}

export interface DialogueViewProps {
  /** The live beat, straight from `AdventureState.activeDialogue`. */
  readonly state: DialogueState;
  /** Portrait key for this beat — the host reads it off the `DialogueBeat`. */
  readonly emote?: string;
  /** Total beats in the tree, for the progress pips. */
  readonly beatCount?: number;
  /** Which device last produced input, so the prompt shows the right glyph. */
  readonly device?: InputDeviceKind;
  readonly onAdvance: () => void;
  readonly onChoose: (choice: DialogueChoice, index: number) => void;
  readonly onSkip: () => void;
  /** Set while a flag is unmet, so a branch can be shown as unavailable. */
  readonly isChoiceAvailable?: (choice: DialogueChoice) => boolean;
}

export function DialogueView({
  state,
  emote,
  beatCount,
  device = 'keyboard',
  onAdvance,
  onChoose,
  onSkip,
  isChoiceAvailable,
}: DialogueViewProps): ReactElement {
  const theme = useTheme();
  const choices = useMemo(
    () => state.choices.filter((choice) => isChoiceAvailable?.(choice) ?? true),
    [state.choices, isChoiceAvailable],
  );
  const awaitingChoice = state.awaitingChoice && choices.length > 0;
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  // Moving focus onto the branch list the moment it appears is what makes the
  // whole conversation playable from a keyboard or a stick without a pointer.
  useEffect(() => {
    if (awaitingChoice) firstChoiceRef.current?.focus();
  }, [awaitingChoice, state.beatIndex]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      // Escape always skips, wherever focus is.
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
        return;
      }
      if (awaitingChoice) {
        // Number keys pick a branch. They keep working while the branch list has
        // focus, because a button does nothing with a digit.
        if (ownsTyping(event.target)) return;
        const digit = Number.parseInt(event.key, 10);
        if (Number.isInteger(digit) && digit >= 1 && digit <= choices.length) {
          const choice = choices[digit - 1];
          if (choice) {
            event.preventDefault();
            onChoose(choice, state.choices.indexOf(choice));
          }
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        // Activation belongs to a focused control: Enter on Skip must skip.
        if (ownsActivation(event.target)) return;
        event.preventDefault();
        onAdvance();
        return;
      }
      if (event.key === 'e' || event.key === 'E') {
        if (ownsTyping(event.target)) return;
        event.preventDefault();
        onAdvance();
      }
    },
    [awaitingChoice, choices, onAdvance, onChoose, onSkip, state.choices],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const shape = emoteShape(emote);

  return (
    <div
      className={SCOPE}
      data-testid="dialogue-view"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        // Anchored clear of the HUD's subtitle lane. This is the rule.
        bottom: `${SUBTITLE_LANE_REM}rem`,
        display: 'flex',
        justifyContent: 'center',
        padding: `0 ${theme.space(3)}`,
        pointerEvents: 'none',
      }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />
      <Panel
        theme={theme}
        style={{
          width: 'min(46rem, 100%)',
          pointerEvents: 'auto',
          background: 'rgba(11,16,48,0.94)',
        }}
      >
        <div style={{ display: 'flex', gap: theme.space(2.5), alignItems: 'flex-start' }}>
          <div style={{ textAlign: 'center' }}>
            <SpeakerPortrait speaker={state.speaker} emote={emote} size={92} theme={theme} />
            {/* The mood in words as well as shapes — the audio-free channel. */}
            <span
              data-testid="dialogue-emote"
              style={{
                display: 'block',
                marginTop: theme.space(0.5),
                fontSize: theme.font.tiny,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: shape.halo === 'urgent' ? theme.colour.alarm : theme.colour.textDim,
              }}
            >
              {emote ?? 'even'}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: theme.space(2),
              }}
            >
              <span
                data-testid="dialogue-speaker"
                style={{
                  fontSize: theme.font.small,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: theme.colour.gold,
                }}
              >
                {state.speaker}
              </span>
              <button
                type="button"
                data-testid="dialogue-skip"
                onClick={onSkip}
                aria-label="Skip this conversation"
                style={{
                  font: 'inherit',
                  fontSize: theme.font.tiny,
                  letterSpacing: '0.14em',
                  minHeight: 34,
                  padding: `0 ${theme.space(1.5)}`,
                  background: 'transparent',
                  color: theme.colour.textDim,
                  border: '1px solid rgba(245,196,81,0.3)',
                  borderRadius: theme.radius.sm,
                  cursor: 'pointer',
                }}
              >
                SKIP
              </button>
            </div>

            <p
              data-testid="dialogue-text"
              aria-live="polite"
              style={{
                margin: `${theme.space(1)} 0 0`,
                fontSize: theme.font.body,
                lineHeight: 1.6,
                color: theme.colour.text,
              }}
            >
              {state.text}
            </p>

            {awaitingChoice ? (
              <ul
                data-testid="dialogue-choices"
                style={{ listStyle: 'none', margin: `${theme.space(2)} 0 0`, padding: 0 }}
              >
                {choices.map((choice, index) => (
                  <li key={`${choice.text}-${index}`}>
                    <button
                      ref={index === 0 ? firstChoiceRef : undefined}
                      type="button"
                      data-testid={`dialogue-choice-${index}`}
                      onClick={() => onChoose(choice, state.choices.indexOf(choice))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: theme.space(1.5),
                        width: '100%',
                        minHeight: 44,
                        font: 'inherit',
                        fontSize: theme.font.body,
                        textAlign: 'left',
                        padding: `${theme.space(1)} ${theme.space(1.5)}`,
                        marginBottom: theme.space(0.75),
                        background: 'transparent',
                        color: theme.colour.text,
                        border: `1px solid ${theme.colour.outline}`,
                        borderRadius: theme.radius.md,
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          flex: '0 0 auto',
                          width: 22,
                          height: 22,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 11,
                          border: `1px solid ${theme.colour.gold}`,
                          fontSize: theme.font.tiny,
                          color: theme.colour.gold,
                        }}
                      >
                        {index + 1}
                      </span>
                      {choice.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: theme.space(2),
                  marginTop: theme.space(1.5),
                }}
              >
                {/* Progress pips: how much of this conversation is left. */}
                <span aria-hidden style={{ display: 'flex', gap: 4 }}>
                  {beatCount !== undefined &&
                    beatCount > 1 &&
                    Array.from({ length: Math.min(beatCount, 12) }, (_, i) => (
                      <span
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          background:
                            i <= Math.min(state.beatIndex, 11) ? theme.colour.gold : 'transparent',
                          border: `1px solid ${theme.colour.gold}`,
                          opacity: i <= Math.min(state.beatIndex, 11) ? 1 : 0.4,
                        }}
                      />
                    ))}
                </span>
                <button
                  type="button"
                  data-testid="dialogue-advance"
                  onClick={onAdvance}
                  aria-label="Continue"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 40,
                    padding: `0 ${theme.space(1.5)}`,
                    font: 'inherit',
                    background: 'transparent',
                    border: '1px solid transparent',
                    borderRadius: theme.radius.sm,
                    cursor: 'pointer',
                  }}
                >
                  <DevicePrompt device={device} theme={theme} />
                </button>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
