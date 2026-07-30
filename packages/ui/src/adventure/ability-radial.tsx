import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { STAGE_IDS, type ResonanceFormId, type StageId } from '@tuner/shared';
import { ABILITY_NAMES, ABILITY_SOURCES, FORM_WHEEL_ORDER, RESONANCE_FORMS } from '@tuner/game-core';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **The quick-switch ring.**
 *
 * Nine slots: the Auralith as it was made, and the seven abilities taken from
 * freed guardians, and the World Chord. They sit on a circle because the game's
 * whole visual language is circular — Coherence is a ring, a shrine is a ring,
 * a guardian's arena is a ring — and because a ring is the one arrangement a
 * thumb, a stick and a number key can all reach the same way.
 *
 * Every label comes from `ABILITY_NAMES`. The ids (`echo`, `prism`, `tidal`, …)
 * are save keys and appear verbatim in authored content, so they are never shown
 * to the player and never renamed; the player reads Echo Pulse and Mirror Tone.
 *
 * Locked abilities are drawn, dimmed, with the region they are waiting in. A gap
 * where an ability will be is information; a missing slot is a smaller game.
 */

/** Fallback region names, title-cased from the stage id. Overridable by prop. */
function titleCase(id: string): string {
  return id
    .split('-')
    .map((word) => (word.length > 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

const DEFAULT_REGION_LABELS: Readonly<Record<StageId, string>> = Object.freeze(
  STAGE_IDS.reduce<Record<StageId, string>>(
    (acc, id) => {
      acc[id] = titleCase(id);
      return acc;
    },
    {} as Record<StageId, string>,
  ),
);

/** Which region teaches an ability, for the locked-slot hint. */
export function abilityRegion(ability: ResonanceFormId): StageId | null {
  return ABILITY_SOURCES.find((source) => source.ability === ability)?.region ?? null;
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

const SCOPE = 'tuner-radial';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:3px}`}</style>
  );
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/**
 * One glyph per ability, drawn from the same geometric vocabulary as the rest of
 * the interface: rings, chords, reflections. Each is a distinct silhouette, so
 * the ring is usable with no colour vision at all.
 */
export function AbilityGlyph({
  ability,
  size = 34,
  colour,
  accent,
}: {
  ability: ResonanceFormId;
  size?: number;
  colour: string;
  accent: string;
}): ReactElement {
  const common = { fill: 'none', stroke: colour, strokeWidth: 1.8 } as const;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      {ability === 'base' && (
        <>
          <circle cx={16} cy={16} r={10} {...common} />
          <circle cx={16} cy={16} r={3} fill={accent} />
        </>
      )}
      {ability === 'echo' && (
        <>
          <circle cx={16} cy={16} r={4} fill={accent} />
          <circle cx={16} cy={16} r={8} {...common} strokeWidth={1.4} />
          <circle cx={16} cy={16} r={12} {...common} strokeWidth={0.9} />
        </>
      )}
      {ability === 'prism' && (
        <>
          <polygon points="16,4 27,24 5,24" {...common} />
          <line x1={2} y1={16} x2={16} y2={16} stroke={accent} strokeWidth={1.6} />
          <line x1={16} y1={16} x2={29} y2={10} stroke={accent} strokeWidth={1.2} />
          <line x1={16} y1={16} x2={29} y2={22} stroke={accent} strokeWidth={1.2} />
        </>
      )}
      {ability === 'tidal' && (
        <>
          <path d="M 3 20 Q 9 12 16 20 T 29 20" {...common} />
          <path d="M 3 12 Q 9 4 16 12 T 29 12" {...common} strokeWidth={1.2} stroke={accent} />
        </>
      )}
      {ability === 'ember' && (
        <>
          <path d="M 16 3 L 24 16 L 18 16 L 22 29 L 9 15 L 15 15 Z" {...common} />
          <circle cx={16} cy={16} r={13} {...common} strokeWidth={0.7} stroke={accent} />
        </>
      )}
      {ability === 'choir' && (
        <>
          <line x1={7} y1={26} x2={7} y2={9} {...common} />
          <line x1={16} y1={26} x2={16} y2={5} {...common} />
          <line x1={25} y1={26} x2={25} y2={9} {...common} />
          <path d="M 7 9 Q 16 2 25 9" {...common} strokeWidth={1.2} stroke={accent} />
        </>
      )}
      {ability === 'bloom' && (
        <>
          {Array.from({ length: 6 }, (_, i) => {
            const angle = (i / 6) * Math.PI * 2;
            return (
              <ellipse
                key={i}
                cx={16 + Math.cos(angle) * 6}
                cy={16 + Math.sin(angle) * 6}
                rx={5.5}
                ry={3}
                fill="none"
                stroke={colour}
                strokeWidth={1.1}
                transform={`rotate(${(angle * 180) / Math.PI} ${16 + Math.cos(angle) * 6} ${16 + Math.sin(angle) * 6})`}
              />
            );
          })}
          <circle cx={16} cy={16} r={2.6} fill={accent} />
        </>
      )}
      {ability === 'silence' && (
        <>
          <circle cx={16} cy={16} r={11} {...common} strokeDasharray="3 3" />
          <line x1={9} y1={16} x2={23} y2={16} stroke={accent} strokeWidth={2} />
        </>
      )}
      {ability === 'celestial' && (
        <>
          <circle cx={16} cy={16} r={11.5} {...common} strokeWidth={1.2} />
          <polygon points="16,4.5 25.5,10.5 25.5,21.5 16,27.5 6.5,21.5 6.5,10.5" {...common} strokeWidth={1.2} />
          <circle cx={16} cy={16} r={4} fill={accent} />
        </>
      )}
    </svg>
  );
}

/** A padlock, for slots the player has not earned yet. */
function LockGlyph({ size = 14, colour }: { size?: number; colour: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M 5 7 L 5 5 A 3 3 0 0 1 11 5 L 11 7" fill="none" stroke={colour} strokeWidth={1.5} />
      <rect x={3.5} y={7} width={9} height={6.5} rx={1.5} fill="none" stroke={colour} strokeWidth={1.5} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface RadialSlot {
  readonly ability: ResonanceFormId;
  readonly index: number;
  /** Fractions of the ring's box, in [0, 1]. */
  readonly x: number;
  readonly y: number;
}

/**
 * Nine evenly-spaced slots starting at the top and running clockwise, so slot
 * order matches the number keys and the wheel order the simulation uses.
 */
export function radialSlots(
  abilities: readonly ResonanceFormId[] = FORM_WHEEL_ORDER,
  radius = 0.38,
): readonly RadialSlot[] {
  const count = Math.max(1, abilities.length);
  return abilities.map((ability, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      ability,
      index,
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    };
  });
}

export interface AbilityRadialControls {
  /** Moves the highlight, wrapping. Shoulder buttons call this. */
  step(delta: number): void;
  /** Selects whatever is highlighted. */
  confirm(): void;
  /** Highlights a slot directly, 0-based. */
  focusSlot(index: number): void;
}

export interface AbilityRadialProps {
  readonly equipped: ResonanceFormId;
  /** `player.unlockedForms`. Everything else draws as locked. */
  readonly unlocked: readonly ResonanceFormId[];
  readonly onSelect: (ability: ResonanceFormId) => void;
  readonly onClose?: () => void;
  /** Lets the host drive the ring from shoulder buttons or a stick. */
  readonly onRegisterControls?: (controls: AbilityRadialControls | null) => void;
  readonly regionLabels?: Readonly<Partial<Record<StageId, string>>>;
  /** Compact ring for the in-play overlay; full size for the pause menu. */
  readonly size?: number;
}

export function AbilityRadial({
  equipped,
  unlocked,
  onSelect,
  onClose,
  onRegisterControls,
  regionLabels,
  size = 380,
}: AbilityRadialProps): ReactElement {
  const theme = useTheme();
  const slots = useMemo(() => radialSlots(), []);
  const [cursor, setCursor] = useState(() => {
    const found = FORM_WHEEL_ORDER.indexOf(equipped);
    return found >= 0 ? found : 0;
  });
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const isUnlocked = useCallback(
    (ability: ResonanceFormId) => ability === 'base' || unlocked.includes(ability),
    [unlocked],
  );

  const focusSlot = useCallback((index: number) => {
    const count = FORM_WHEEL_ORDER.length;
    const wrapped = ((index % count) + count) % count;
    cursorRef.current = wrapped;
    setCursor(wrapped);
    buttons.current.get(wrapped)?.focus();
  }, []);

  const step = useCallback(
    (delta: number) => {
      focusSlot(cursorRef.current + delta);
    },
    [focusSlot],
  );

  const confirm = useCallback(() => {
    const ability = FORM_WHEEL_ORDER[cursorRef.current];
    if (ability && isUnlocked(ability)) onSelect(ability);
  }, [isUnlocked, onSelect]);

  const controls = useMemo<AbilityRadialControls>(
    () => ({ step, confirm, focusSlot }),
    [step, confirm, focusSlot],
  );

  // Ref-held, so an inline callback from the host does not re-register per render.
  const registerRef = useRef(onRegisterControls);
  registerRef.current = onRegisterControls;
  useEffect(() => {
    const register = registerRef.current;
    register?.(controls);
    return () => register?.(null);
  }, [controls]);

  // The ring takes focus on the equipped slot when it opens, so a stick or a
  // keyboard can drive it immediately and a screen reader announces where it is.
  useEffect(() => {
    buttons.current.get(cursorRef.current)?.focus();
  }, []);

  // Number keys 1–9 select directly; the arrows and shoulder buttons walk the ring.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent): void => {
      const digit = Number.parseInt(event.key, 10);
      if (Number.isInteger(digit) && digit >= 1 && digit <= FORM_WHEEL_ORDER.length) {
        const ability = FORM_WHEEL_ORDER[digit - 1];
        event.preventDefault();
        focusSlot(digit - 1);
        if (ability && isUnlocked(ability)) onSelect(ability);
        return;
      }
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault();
          step(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault();
          step(-1);
          break;
        case 'Escape':
          if (onClose) {
            event.preventDefault();
            onClose();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSlot, isUnlocked, onClose, onSelect, step]);

  const highlighted = FORM_WHEEL_ORDER[cursor] ?? 'base';
  const highlightedDef = RESONANCE_FORMS[highlighted];
  const highlightedUnlocked = isUnlocked(highlighted);
  const region = abilityRegion(highlighted);
  const regionLabel =
    region === null ? null : (regionLabels?.[region] ?? DEFAULT_REGION_LABELS[region]);

  return (
    <div
      className={SCOPE}
      data-testid="ability-radial"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(4,6,20,0.78)',
        padding: theme.space(2),
      }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />
      <div
        role="radiogroup"
        aria-label="Abilities"
        style={{ position: 'relative', width: size, height: size, maxWidth: '92vmin', maxHeight: '92vmin' }}
      >
        {/* The ring itself: sacred geometry, drawn once, behind the slots. */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          aria-hidden
          focusable="false"
          style={{ position: 'absolute', inset: 0 }}
        >
          <circle cx={50} cy={50} r={38} fill="none" stroke={theme.colour.outline} strokeWidth={0.5} opacity={0.55} />
          <circle cx={50} cy={50} r={22} fill="none" stroke={theme.colour.outline} strokeWidth={0.4} opacity={0.35} />
          <polygon
            points={slots
              .map((slot) => `${(slot.x * 100).toFixed(2)},${(slot.y * 100).toFixed(2)}`)
              .join(' ')}
            fill="none"
            stroke={theme.colour.resonance}
            strokeWidth={0.35}
            opacity={0.3}
          />
          {slots.map((slot) => (
            <line
              key={slot.ability}
              x1={50}
              y1={50}
              x2={slot.x * 100}
              y2={slot.y * 100}
              stroke={theme.colour.outline}
              strokeWidth={0.25}
              opacity={0.25}
            />
          ))}
        </svg>

        {/* Hub: what is highlighted, in the player's words. */}
        <div
          data-testid="radial-hub"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '42%',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: theme.font.small,
              color: highlightedUnlocked ? theme.colour.gold : theme.colour.textDim,
              letterSpacing: '0.12em',
            }}
          >
            {ABILITY_NAMES[highlighted]}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: theme.space(0.5),
              fontSize: theme.font.tiny,
              color: theme.colour.textDim,
              lineHeight: 1.4,
            }}
          >
            {highlightedUnlocked
              ? highlightedDef.tagline
              : regionLabel
                ? `Waiting in the ${regionLabel}.`
                : 'Not yet yours.'}
          </span>
        </div>

        {slots.map((slot) => {
          const open = isUnlocked(slot.ability);
          const active = slot.ability === equipped;
          const focused = slot.index === cursor;
          const accent = RESONANCE_FORMS[slot.ability].tuning.colour;
          const outline = active ? theme.colour.gold : focused ? theme.colour.resonance : 'rgba(245,196,81,0.3)';
          return (
            <button
              key={slot.ability}
              ref={(element) => {
                if (element) buttons.current.set(slot.index, element);
                else buttons.current.delete(slot.index);
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={!open}
              tabIndex={focused ? 0 : -1}
              data-testid={`radial-slot-${slot.ability}`}
              onFocus={() => setCursor(slot.index)}
              onClick={() => {
                setCursor(slot.index);
                if (open) onSelect(slot.ability);
              }}
              aria-label={
                open
                  ? `${ABILITY_NAMES[slot.ability]}${active ? ', equipped' : ''}, slot ${slot.index + 1}`
                  : `${ABILITY_NAMES[slot.ability]}, locked${regionLabelFor(slot.ability, regionLabels)}`
              }
              style={{
                position: 'absolute',
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: '22%',
                minWidth: 56,
                minHeight: 56,
                aspectRatio: '1 / 1',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: 2,
                borderRadius: '50%',
                background: active ? theme.colour.panelRaised : 'rgba(11,16,48,0.85)',
                border: `${active ? 3 : focused ? 2 : 1}px solid ${outline}`,
                color: theme.colour.text,
                font: 'inherit',
                cursor: open ? 'pointer' : 'not-allowed',
                opacity: open ? 1 : 0.5,
                transition: theme.reducedMotion ? 'none' : 'border-color 120ms, background 120ms',
              }}
            >
              <AbilityGlyph
                ability={slot.ability}
                size={30}
                colour={open ? theme.colour.text : theme.colour.textDim}
                accent={open ? accent : theme.colour.textDim}
              />
              <span
                style={{
                  fontSize: theme.font.tiny,
                  lineHeight: 1.1,
                  textAlign: 'center',
                  color: open ? theme.colour.text : theme.colour.textDim,
                }}
              >
                {ABILITY_NAMES[slot.ability]}
              </span>
              {!open &&
                (theme.showShapes ? (
                  // The lock said in words as well as drawn, for anyone who
                  // cannot rely on the dimming to read as "unavailable".
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: theme.font.tiny, color: theme.colour.textDim }}>
                    <LockGlyph size={11} colour={theme.colour.textDim} />
                    LOCKED
                  </span>
                ) : (
                  <LockGlyph colour={theme.colour.textDim} />
                ))}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 2,
                  left: 6,
                  fontSize: theme.font.tiny,
                  color: theme.colour.textDim,
                  opacity: 0.8,
                }}
              >
                {slot.index + 1}
              </span>
            </button>
          );
        })}
      </div>

      {onClose && (
        <button
          type="button"
          data-testid="radial-close"
          onClick={onClose}
          aria-label="Close the ability ring"
          style={{
            position: 'absolute',
            top: theme.space(2),
            right: theme.space(2),
            font: 'inherit',
            fontSize: theme.font.tiny,
            letterSpacing: '0.14em',
            minHeight: 44,
            padding: `0 ${theme.space(2)}`,
            background: 'transparent',
            color: theme.colour.textDim,
            border: `1px solid ${theme.colour.outline}`,
            borderRadius: theme.radius.sm,
            cursor: 'pointer',
          }}
        >
          CLOSE
        </button>
      )}
    </div>
  );
}

function regionLabelFor(
  ability: ResonanceFormId,
  regionLabels?: Readonly<Partial<Record<StageId, string>>>,
): string {
  const region = abilityRegion(ability);
  if (region === null) return '';
  return `, waiting in the ${regionLabels?.[region] ?? DEFAULT_REGION_LABELS[region]}`;
}
