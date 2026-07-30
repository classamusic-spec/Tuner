import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { HARMONIC_DEGREE_NAMES, HARMONIC_RATIOS, harmonicHz } from '@tuner/shared';
import type { MotifCardDef } from '@tuner/game-core';
import { Button, Panel } from '../components.js';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **Composition Mode.**
 *
 * The world spends the whole game teaching the player its phrases: a bridge that
 * grows to Root–Fifth–Octave, the rhythm Oru walks to, whatever it is Sava hums
 * while she carries water. Those phrases are handed over as `MotifCardDef` cards.
 * This is where the player answers back with them.
 *
 * Two decisions shape everything below.
 *
 * 1. **The grid logic is pure and lives above React.** Placement, the reverse and
 *    mirror transforms, tempo and the playhead are exported functions over an
 *    immutable `CompositionState`, tested in Node with no DOM. A sequencer whose
 *    timing lives inside component state is a sequencer you cannot test, and
 *    "the playhead drifts on a 144 Hz monitor" is not a bug anyone finds by
 *    looking at the code.
 * 2. **This module makes no sound.** It emits `NoteEvent`s through `onNote` and
 *    the host sounds them. The interface layer never owns an audio graph — and
 *    because every note is also drawn on the grid and named in text, a player
 *    with the sound off can still see exactly what they have written.
 *
 * Motifs are *found*, never authored from nothing, so `placeMotif` refuses any
 * card the player has not collected. That is the design, not a safety check.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const LAYER_IDS = ['rhythm', 'bass', 'harmony', 'melody'] as const;
export type CompositionLayerId = (typeof LAYER_IDS)[number];

/** Timbres the Auralith can be voiced through. Original to this world. */
export const TIMBRE_IDS = ['glass', 'rootwood', 'struck-stone', 'breath', 'filament'] as const;
export type TimbreId = (typeof TIMBRE_IDS)[number];

export const TIMBRE_LABELS: Readonly<Record<TimbreId, string>> = {
  glass: 'Glass',
  rootwood: 'Rootwood',
  'struck-stone': 'Struck Stone',
  breath: 'Breath',
  filament: 'Filament',
};

/** Degrees of the World Chord a motif may name. */
export const SCALE_DEGREES = HARMONIC_RATIOS.length;

/**
 * The pitch mirroring reflects about. With eight degrees this is 3.5, so
 * mirroring maps Root to Octave and Fourth to Fifth — an involution on every
 * degree in range, which is what makes the transform safe to offer as a toggle.
 */
export const SCALE_CENTRE = (SCALE_DEGREES - 1) / 2;

/** A bar is four beats at every grid resolution, so tempo means one thing. */
export const BEATS_PER_BAR = 4;

/** Grid resolutions, each a whole number of steps per beat. */
export const GRID_SIZES = [8, 12, 16, 24] as const;

export const MIN_TEMPO = 50;
export const MAX_TEMPO = 190;
export const DEFAULT_TEMPO = 96;
export const DEFAULT_GRID_SIZE = 16;

export interface LayerMeta {
  readonly id: CompositionLayerId;
  readonly label: string;
  /** One line, for the player, explaining what the layer is for. */
  readonly hint: string;
  /** Octaves away from the World Chord this layer sounds at. */
  readonly octave: number;
  readonly baseVelocity: number;
  readonly timbre: TimbreId;
  /** Shape drawn in the cell, so a layer is legible without colour. */
  readonly shape: 'circle' | 'square' | 'diamond' | 'triangle';
}

export const LAYER_META: Readonly<Record<CompositionLayerId, LayerMeta>> = {
  rhythm: {
    id: 'rhythm',
    label: 'Rhythm',
    hint: 'The pulse everything else is measured against.',
    octave: 0,
    baseVelocity: 0.82,
    timbre: 'struck-stone',
    shape: 'square',
  },
  bass: {
    id: 'bass',
    label: 'Bass',
    hint: 'The floor the phrase stands on.',
    octave: -1,
    baseVelocity: 0.78,
    timbre: 'rootwood',
    shape: 'circle',
  },
  harmony: {
    id: 'harmony',
    label: 'Harmony',
    hint: 'Held degrees. Two or three are plenty.',
    octave: 0,
    baseVelocity: 0.58,
    timbre: 'glass',
    shape: 'diamond',
  },
  melody: {
    id: 'melody',
    label: 'Melody',
    hint: 'The line someone could hum back to you.',
    octave: 1,
    baseVelocity: 0.74,
    timbre: 'filament',
    shape: 'triangle',
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** A card placed on a layer, with its transforms. */
export interface MotifPlacement {
  /** Stable and derived: one motif can sit on one offset of one layer. */
  readonly id: string;
  readonly motifId: string;
  /** Grid step the motif starts on. */
  readonly offset: number;
  readonly reversed: boolean;
  readonly mirrored: boolean;
}

/** One filled step of the grid. */
export interface GridCell {
  readonly degree: number;
  readonly velocity: number;
  readonly motifId: string;
  readonly placementId: string;
  /** True on a beat boundary — drawn and sounded a little stronger. */
  readonly accent: boolean;
}

export interface LayerState {
  readonly id: CompositionLayerId;
  readonly placements: readonly MotifPlacement[];
  readonly timbre: TimbreId;
  readonly muted: boolean;
  /** Rendered grid. Always derived from `placements`, never edited directly. */
  readonly steps: readonly (GridCell | null)[];
}

export interface CompositionState {
  readonly stepsPerBar: number;
  readonly tempoBpm: number;
  readonly layers: Readonly<Record<CompositionLayerId, LayerState>>;
}

/** What the player has, and what of it they have actually found. */
export interface MotifLibrary {
  readonly cards: readonly MotifCardDef[];
  readonly collected: readonly string[];
}

export interface NoteEvent {
  readonly layer: CompositionLayerId;
  readonly motifId: string;
  readonly step: number;
  /** Harmonic degree, always in [0, SCALE_DEGREES). */
  readonly degree: number;
  readonly degreeName: string;
  readonly octave: number;
  readonly hz: number;
  /** In (0, 1]. */
  readonly velocity: number;
  readonly timbre: TimbreId;
  readonly accent: boolean;
  readonly durationSeconds: number;
}

export type PlacementRejection =
  | 'unknown-motif'
  | 'not-collected'
  | 'wrong-layer'
  | 'out-of-range';

export interface PlaceOutcome {
  readonly state: CompositionState;
  /** Null when the placement was accepted. */
  readonly rejected: PlacementRejection | null;
  readonly placementId: string | null;
}

export interface PlaybackTick {
  readonly playhead: number;
  readonly notes: readonly NoteEvent[];
  /** True when this tick crossed the bar line. */
  readonly wrapped: boolean;
  readonly stepsAdvanced: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_TEMPO;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm)));
}

/** Snaps to the nearest supported grid resolution. */
export function normaliseGridSize(stepsPerBar: number): number {
  let best: number = DEFAULT_GRID_SIZE;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const size of GRID_SIZES) {
    const distance = Math.abs(size - stepsPerBar);
    if (distance < bestDistance) {
      best = size;
      bestDistance = distance;
    }
  }
  return best;
}

export function stepsPerBeat(stepsPerBar: number): number {
  return Math.max(1, stepsPerBar / BEATS_PER_BAR);
}

/** Seconds one grid step lasts. Tempo's only job. */
export function stepDurationSeconds(tempoBpm: number, stepsPerBar: number): number {
  const beats = stepsPerBeat(stepsPerBar);
  return 60 / (clampTempo(tempoBpm) * beats);
}

export function stepsPerSecond(tempoBpm: number, stepsPerBar: number): number {
  return 1 / stepDurationSeconds(tempoBpm, stepsPerBar);
}

export function barDurationSeconds(tempoBpm: number, stepsPerBar: number): number {
  return stepDurationSeconds(tempoBpm, stepsPerBar) * stepsPerBar;
}

/** Keeps a degree inside the World Chord's eight, the way `harmonicHz` does. */
export function wrapDegree(degree: number): number {
  const rounded = Math.round(degree);
  return ((rounded % SCALE_DEGREES) + SCALE_DEGREES) % SCALE_DEGREES;
}

/** Reverses a motif in time. Its own inverse. */
export function reverseSteps(
  steps: readonly (number | null)[],
): readonly (number | null)[] {
  return [...steps].reverse();
}

/**
 * Reflects a motif's degrees about the scale centre: Root becomes Octave, the
 * Fourth becomes the Fifth. Rests stay rests, and applying it twice returns the
 * original, so it is safe as a toggle rather than a destructive edit.
 */
export function mirrorSteps(
  steps: readonly (number | null)[],
): readonly (number | null)[] {
  return steps.map((degree) => (degree === null ? null : 2 * SCALE_CENTRE - degree));
}

export function applyTransforms(
  steps: readonly (number | null)[],
  transforms: { readonly reversed: boolean; readonly mirrored: boolean },
): readonly (number | null)[] {
  let next = steps;
  if (transforms.reversed) next = reverseSteps(next);
  if (transforms.mirrored) next = mirrorSteps(next);
  return next;
}

export function createMotifLibrary(
  cards: readonly MotifCardDef[],
  collected: readonly string[],
): MotifLibrary {
  return { cards, collected };
}

export function findCard(library: MotifLibrary, motifId: string): MotifCardDef | null {
  return library.cards.find((card) => card.id === motifId) ?? null;
}

export function isCollected(library: MotifLibrary, motifId: string): boolean {
  return library.collected.includes(motifId);
}

/** Cards the player has actually found, optionally for one layer. */
export function collectedCards(
  library: MotifLibrary,
  layer?: CompositionLayerId,
): readonly MotifCardDef[] {
  return library.cards.filter(
    (card) => isCollected(library, card.id) && (layer === undefined || card.layer === layer),
  );
}

/**
 * Where a motif's notes land on the grid.
 *
 * A motif is written against its own `stepsPerBar`, so it is mapped
 * proportionally: an eight-step phrase on a sixteen-step grid plays on every
 * other step rather than being crammed into the first half. Anything that falls
 * past the end of the bar is **clipped**, never wrapped — a phrase that
 * reappeared at the start of the bar would be a different phrase.
 */
export function motifStepIndices(
  card: MotifCardDef,
  stepsPerBar: number,
  placement: { readonly offset: number; readonly reversed: boolean; readonly mirrored: boolean },
): readonly { readonly index: number; readonly degree: number }[] {
  const written = applyTransforms(card.steps, placement);
  const sourceSteps = Math.max(1, card.stepsPerBar);
  const ratio = stepsPerBar / sourceSteps;
  const out: { index: number; degree: number }[] = [];

  for (let i = 0; i < written.length; i += 1) {
    const degree = written[i];
    if (degree === undefined || degree === null) continue;
    const index = placement.offset + Math.round(i * ratio);
    if (index < 0 || index >= stepsPerBar) continue; // Clipped, not wrapped.
    out.push({ index, degree: wrapDegree(degree) });
  }
  return out;
}

/** How many grid steps a motif occupies at this resolution. */
export function motifGridSpan(card: MotifCardDef, stepsPerBar: number): number {
  const ratio = stepsPerBar / Math.max(1, card.stepsPerBar);
  return Math.max(1, Math.round(card.steps.length * ratio));
}

function velocityFor(layer: CompositionLayerId, accent: boolean): number {
  const base = LAYER_META[layer].baseVelocity;
  return Math.min(1, Math.max(0.15, base + (accent ? 0.12 : 0)));
}

/** Rebuilds a layer's grid from its placements. The only writer of `steps`. */
export function renderLayerSteps(
  layer: CompositionLayerId,
  placements: readonly MotifPlacement[],
  library: MotifLibrary,
  stepsPerBar: number,
): readonly (GridCell | null)[] {
  const steps = new Array<GridCell | null>(stepsPerBar).fill(null);
  const beat = stepsPerBeat(stepsPerBar);

  // In placement order, so a later card deliberately laid over an earlier one
  // wins — that is how a player edits without having to delete first.
  for (const placement of placements) {
    const card = findCard(library, placement.motifId);
    if (!card) continue;
    for (const { index, degree } of motifStepIndices(card, stepsPerBar, placement)) {
      const accent = index % beat === 0;
      steps[index] = {
        degree,
        velocity: velocityFor(layer, accent),
        motifId: placement.motifId,
        placementId: placement.id,
        accent,
      };
    }
  }
  return steps;
}

function emptyLayer(layer: CompositionLayerId, stepsPerBar: number): LayerState {
  return {
    id: layer,
    placements: [],
    timbre: LAYER_META[layer].timbre,
    muted: false,
    steps: new Array<GridCell | null>(stepsPerBar).fill(null),
  };
}

export function createComposition(options?: {
  readonly stepsPerBar?: number;
  readonly tempoBpm?: number;
}): CompositionState {
  const stepsPerBar = normaliseGridSize(options?.stepsPerBar ?? DEFAULT_GRID_SIZE);
  return {
    stepsPerBar,
    tempoBpm: clampTempo(options?.tempoBpm ?? DEFAULT_TEMPO),
    layers: {
      rhythm: emptyLayer('rhythm', stepsPerBar),
      bass: emptyLayer('bass', stepsPerBar),
      harmony: emptyLayer('harmony', stepsPerBar),
      melody: emptyLayer('melody', stepsPerBar),
    },
  };
}

function withLayer(
  state: CompositionState,
  layer: CompositionLayerId,
  next: LayerState,
): CompositionState {
  const layers = { ...state.layers };
  layers[layer] = next;
  return { ...state, layers };
}

function reflow(
  state: CompositionState,
  layer: CompositionLayerId,
  placements: readonly MotifPlacement[],
  library: MotifLibrary,
): CompositionState {
  const current = state.layers[layer];
  return withLayer(state, layer, {
    ...current,
    placements,
    steps: renderLayerSteps(layer, placements, library, state.stepsPerBar),
  });
}

export function placementIdFor(
  layer: CompositionLayerId,
  motifId: string,
  offset: number,
): string {
  return `${layer}:${motifId}:${offset}`;
}

/**
 * Places a card.
 *
 * Rejections are returned rather than thrown so the interface can say *why* —
 * "you have not found that phrase yet" is a different sentence from "that is a
 * bass phrase".
 */
export function placeMotif(
  state: CompositionState,
  request: {
    readonly motifId: string;
    readonly layer: CompositionLayerId;
    readonly offset: number;
    readonly reversed?: boolean;
    readonly mirrored?: boolean;
  },
  library: MotifLibrary,
): PlaceOutcome {
  const card = findCard(library, request.motifId);
  if (!card) return { state, rejected: 'unknown-motif', placementId: null };
  if (!isCollected(library, card.id)) {
    return { state, rejected: 'not-collected', placementId: null };
  }
  if (card.layer !== request.layer) {
    return { state, rejected: 'wrong-layer', placementId: null };
  }
  const offset = Math.round(request.offset);
  if (!Number.isFinite(offset) || offset < 0 || offset >= state.stepsPerBar) {
    return { state, rejected: 'out-of-range', placementId: null };
  }

  const id = placementIdFor(request.layer, card.id, offset);
  const placement: MotifPlacement = {
    id,
    motifId: card.id,
    offset,
    reversed: request.reversed === true,
    mirrored: request.mirrored === true,
  };
  const existing = state.layers[request.layer].placements;
  const placements = [...existing.filter((p) => p.id !== id), placement];

  return { state: reflow(state, request.layer, placements, library), rejected: null, placementId: id };
}

export function removePlacement(
  state: CompositionState,
  layer: CompositionLayerId,
  placementId: string,
  library: MotifLibrary,
): CompositionState {
  const placements = state.layers[layer].placements.filter((p) => p.id !== placementId);
  if (placements.length === state.layers[layer].placements.length) return state;
  return reflow(state, layer, placements, library);
}

/** Flips one transform on one placed card. Applying it twice is a no-op. */
export function transformPlacement(
  state: CompositionState,
  layer: CompositionLayerId,
  placementId: string,
  transform: 'reverse' | 'mirror',
  library: MotifLibrary,
): CompositionState {
  const placements = state.layers[layer].placements.map((p) =>
    p.id === placementId
      ? {
          ...p,
          reversed: transform === 'reverse' ? !p.reversed : p.reversed,
          mirrored: transform === 'mirror' ? !p.mirrored : p.mirrored,
        }
      : p,
  );
  return reflow(state, layer, placements, library);
}

/** Empties one layer. Every other layer is left byte-identical. */
export function clearLayer(state: CompositionState, layer: CompositionLayerId): CompositionState {
  return withLayer(state, layer, {
    ...state.layers[layer],
    placements: [],
    steps: new Array<GridCell | null>(state.stepsPerBar).fill(null),
  });
}

export function clearAll(state: CompositionState): CompositionState {
  return LAYER_IDS.reduce<CompositionState>((acc, layer) => clearLayer(acc, layer), state);
}

/** Tempo changes step duration and nothing else. The notes are untouched. */
export function setTempo(state: CompositionState, tempoBpm: number): CompositionState {
  return { ...state, tempoBpm: clampTempo(tempoBpm) };
}

export function setTimbre(
  state: CompositionState,
  layer: CompositionLayerId,
  timbre: TimbreId,
): CompositionState {
  return withLayer(state, layer, { ...state.layers[layer], timbre });
}

export function cycleTimbre(
  state: CompositionState,
  layer: CompositionLayerId,
  direction = 1,
): CompositionState {
  const current = TIMBRE_IDS.indexOf(state.layers[layer].timbre);
  const index = (current + direction + TIMBRE_IDS.length) % TIMBRE_IDS.length;
  return setTimbre(state, layer, TIMBRE_IDS[index] ?? 'glass');
}

export function toggleLayerMuted(
  state: CompositionState,
  layer: CompositionLayerId,
): CompositionState {
  const current = state.layers[layer];
  return withLayer(state, layer, { ...current, muted: !current.muted });
}

/** Changing resolution re-lays every placement rather than discarding them. */
export function setGridSize(
  state: CompositionState,
  stepsPerBar: number,
  library: MotifLibrary,
): CompositionState {
  const next = normaliseGridSize(stepsPerBar);
  if (next === state.stepsPerBar) return state;
  let out: CompositionState = { ...state, stepsPerBar: next };
  for (const layer of LAYER_IDS) {
    const placements = state.layers[layer].placements.filter((p) => p.offset < next);
    out = reflow(out, layer, placements, library);
  }
  return out;
}

/**
 * A first arrangement, for a player who has just been handed four cards and a
 * blank grid. One collected card per empty layer, at the top of the bar. It is
 * not clever; it is a floor to stand on.
 */
export function suggestArrangement(
  state: CompositionState,
  library: MotifLibrary,
): CompositionState {
  let out = state;
  for (const layer of LAYER_IDS) {
    if (out.layers[layer].placements.length > 0) continue;
    const card = collectedCards(library, layer)[0];
    if (!card) continue;
    out = placeMotif(out, { motifId: card.id, layer, offset: 0 }, library).state;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export function noteEventsAtStep(
  state: CompositionState,
  step: number,
): readonly NoteEvent[] {
  const notes: NoteEvent[] = [];
  const duration = stepDurationSeconds(state.tempoBpm, state.stepsPerBar);

  for (const layer of LAYER_IDS) {
    const lane = state.layers[layer];
    if (lane.muted) continue;
    const cell = lane.steps[step];
    if (!cell) continue;
    const meta = LAYER_META[layer];
    notes.push({
      layer,
      motifId: cell.motifId,
      step,
      degree: cell.degree,
      degreeName: HARMONIC_DEGREE_NAMES[cell.degree] ?? 'Root',
      octave: meta.octave,
      hz: harmonicHz(cell.degree, meta.octave),
      velocity: cell.velocity,
      timbre: lane.timbre,
      accent: cell.accent,
      durationSeconds: duration,
    });
  }
  return notes;
}

/**
 * Advances the playhead by a wall-clock slice and reports the notes crossed.
 *
 * The interval is half-open — a note fires when the playhead *reaches* its step —
 * so sixty calls at a sixtieth of a second produce exactly the same notes, in
 * the same order, as one call at a whole second. That is the whole reason this
 * is a function and not a `setInterval`.
 *
 * A single tick is capped at one bar so a backgrounded tab resumes rather than
 * dumping a thousand notes into the audio engine at once.
 */
export function advancePlayback(
  state: CompositionState,
  playhead: number,
  dtSeconds: number,
): PlaybackTick {
  const spb = state.stepsPerBar;
  const start = ((playhead % spb) + spb) % spb;
  const perSecond = stepsPerSecond(state.tempoBpm, spb);
  const delta = Math.min(spb, Math.max(0, dtSeconds) * perSecond);
  const end = start + delta;

  const notes: NoteEvent[] = [];
  for (let n = Math.ceil(start); n < end; n += 1) {
    notes.push(...noteEventsAtStep(state, ((n % spb) + spb) % spb));
  }

  return { playhead: end % spb, notes, wrapped: end >= spb, stepsAdvanced: delta };
}

/** How full a layer is, for the accessible summary and the layer header. */
export function layerFilledSteps(state: CompositionState, layer: CompositionLayerId): number {
  return state.layers[layer].steps.reduce((count, cell) => (cell ? count + 1 : count), 0);
}

/** Plain-text description of the arrangement. Read aloud, and used in tests. */
export function describeComposition(state: CompositionState): string {
  const parts = LAYER_IDS.map((layer) => {
    const filled = layerFilledSteps(state, layer);
    const muted = state.layers[layer].muted ? ', muted' : '';
    return `${LAYER_META[layer].label}: ${filled} of ${state.stepsPerBar} steps${muted}`;
  });
  return `${state.tempoBpm} beats per minute. ${parts.join('. ')}.`;
}

/** Stable summary a shrine can compare against, or a save can store. */
export function compositionSignature(state: CompositionState): string {
  const layers = LAYER_IDS.map((layer) => {
    const lane = state.layers[layer];
    const cells = lane.steps
      .map((cell, index) => (cell ? `${index}=${cell.degree}` : null))
      .filter((entry): entry is string => entry !== null)
      .join(',');
    return `${layer}[${lane.timbre}]{${cells}}`;
  });
  return `${state.stepsPerBar}@${state.tempoBpm}|${layers.join('|')}`;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const SCOPE = 'tuner-composition';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:2px}`}</style>
  );
}

function layerColour(layer: CompositionLayerId, theme: Theme): string {
  switch (layer) {
    case 'rhythm':
      return theme.colour.gold;
    case 'bass':
      return theme.colour.restore;
    case 'harmony':
      return theme.colour.resonance;
    default:
      return theme.colour.text;
  }
}

/** The cell mark: a shape per layer, so a lane is legible without colour. */
function CellMark({
  layer,
  size,
  colour,
}: {
  layer: CompositionLayerId;
  size: number;
  colour: string;
}): ReactElement {
  const r = size / 2;
  const shape = LAYER_META[layer].shape;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
      {shape === 'circle' && <circle cx={r} cy={r} r={r * 0.8} fill={colour} />}
      {shape === 'square' && (
        <rect x={r * 0.25} y={r * 0.25} width={r * 1.5} height={r * 1.5} fill={colour} />
      )}
      {shape === 'diamond' && (
        <polygon points={`${r},${r * 0.15} ${r * 1.85},${r} ${r},${r * 1.85} ${r * 0.15},${r}`} fill={colour} />
      )}
      {shape === 'triangle' && (
        <polygon points={`${r},${r * 0.18} ${r * 1.82},${r * 1.7} ${r * 0.18},${r * 1.7}`} fill={colour} />
      )}
    </svg>
  );
}

/** A card's steps at a glance, so the tray is readable without placing anything. */
function MotifPreview({
  card,
  colour,
  theme,
}: {
  card: MotifCardDef;
  colour: string;
  theme: Theme;
}): ReactElement {
  const width = 108;
  const height = 22;
  const count = Math.max(1, card.steps.length);
  const slot = width / count;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={theme.colour.textDim} strokeWidth={0.5} opacity={0.6} />
      {card.steps.map((degree, index) => {
        const x = index * slot + slot / 2;
        if (degree === null) {
          return <circle key={index} cx={x} cy={height - 4} r={1} fill={theme.colour.textDim} />;
        }
        const t = wrapDegree(degree) / (SCALE_DEGREES - 1);
        const y = height - 3 - t * (height - 7);
        return <rect key={index} x={x - slot * 0.3} y={y - 2} width={Math.max(2, slot * 0.6)} height={3} fill={colour} rx={1} />;
      })}
    </svg>
  );
}

export interface CompositionScreenProps {
  /** Every motif card the game knows about. */
  readonly cards: readonly MotifCardDef[];
  /** Ids the player has actually found. Nothing else can be placed. */
  readonly collectedMotifs: readonly string[];
  /** Sounded by the host. This module owns no audio graph. */
  readonly onNote: (note: NoteEvent) => void;
  readonly onClose?: () => void;
  /** Offered when a shrine is listening — "answer the shrine". */
  readonly onSubmit?: (state: CompositionState) => void;
  readonly submitLabel?: string;
  readonly initial?: CompositionState;
  readonly onChange?: (state: CompositionState) => void;
  /** Injectable clock, so a host or a test can drive playback itself. */
  readonly clock?: () => number;
}

export function CompositionScreen({
  cards,
  collectedMotifs,
  onNote,
  onClose,
  onSubmit,
  submitLabel = 'Answer',
  initial,
  onChange,
  clock,
}: CompositionScreenProps): ReactElement {
  const theme = useTheme();
  const reducedFlashing = useUIStore((s) => s.accessibility.reducedFlashing) === true;

  const library = useMemo(
    () => createMotifLibrary(cards, collectedMotifs),
    [cards, collectedMotifs],
  );

  const [state, setState] = useState<CompositionState>(() => initial ?? createComposition());
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState(-1);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPlacement, setSelectedPlacement] = useState<
    { readonly layer: CompositionLayerId; readonly placementId: string } | null
  >(null);
  const [cursor, setCursor] = useState<{ layer: CompositionLayerId; step: number }>({
    layer: 'melody',
    step: 0,
  });
  const [message, setMessage] = useState('Pick a phrase, then a step.');

  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const noteRef = useRef(onNote);
  noteRef.current = onNote;
  const playheadRef = useRef(0);

  const update = useCallback(
    (next: CompositionState) => {
      setState(next);
      onChange?.(next);
    },
    [onChange],
  );

  // Playback. The pure tick does the timing; this only supplies wall-clock
  // deltas and forwards notes to the host.
  useEffect(() => {
    if (!playing) return;
    if (typeof window === 'undefined') return;
    const now = clock ?? (() => performance.now() / 1000);
    let last = now();
    let frame = 0;
    let cancelled = false;

    const loop = (): void => {
      if (cancelled) return;
      const current = now();
      const dt = Math.min(0.25, Math.max(0, current - last));
      last = current;
      const tick = advancePlayback(stateRef.current, playheadRef.current, dt);
      playheadRef.current = tick.playhead;
      for (const note of tick.notes) noteRef.current(note);
      // Re-render on step changes only — a menu does not need sixty of them.
      const step = Math.floor(tick.playhead);
      setPlayStep((previous) => (previous === step ? previous : step));
      frame = window.requestAnimationFrame(loop);
    };

    frame = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [playing, clock]);

  const stop = useCallback(() => {
    setPlaying(false);
    playheadRef.current = 0;
    setPlayStep(-1);
  }, []);

  const place = useCallback(
    (layer: CompositionLayerId, step: number) => {
      const cell = state.layers[layer].steps[step];
      if (!selectedCardId) {
        // No card in hand: tapping a filled cell picks up what is there.
        if (cell) {
          setSelectedPlacement({ layer, placementId: cell.placementId });
          setMessage('Phrase selected. Reverse, mirror or remove it.');
        } else {
          setMessage('Choose a phrase from the tray first.');
        }
        return;
      }
      const outcome = placeMotif(
        state,
        { motifId: selectedCardId, layer, offset: step },
        library,
      );
      if (outcome.rejected === null) {
        update(outcome.state);
        if (outcome.placementId) setSelectedPlacement({ layer, placementId: outcome.placementId });
        const card = findCard(library, selectedCardId);
        setMessage(`${card?.name ?? 'Phrase'} placed on ${LAYER_META[layer].label} at step ${step + 1}.`);
        return;
      }
      setMessage(REJECTION_TEXT[outcome.rejected]);
    },
    [library, selectedCardId, state, update],
  );

  const trayCards = useMemo(() => collectedCards(library), [library]);

  /**
   * Roving tab stop: exactly one cell is tabbable, the arrows move it, and DOM
   * focus is moved with it. Highlighting a new cell while leaving the focus ring
   * on the old one is the classic broken grid — it looks navigable and reads as
   * two cursors.
   */
  const moveCursor = useCallback((layer: CompositionLayerId, step: number) => {
    setCursor({ layer, step });
    cellRefs.current.get(`${layer}:${step}`)?.focus();
  }, []);

  const onGridKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const laneIndex = LAYER_IDS.indexOf(cursor.layer);
      let handled = true;
      switch (event.key) {
        case 'ArrowRight':
          moveCursor(cursor.layer, Math.min(state.stepsPerBar - 1, cursor.step + 1));
          break;
        case 'ArrowLeft':
          moveCursor(cursor.layer, Math.max(0, cursor.step - 1));
          break;
        case 'ArrowDown':
          moveCursor(
            LAYER_IDS[Math.min(LAYER_IDS.length - 1, laneIndex + 1)] ?? cursor.layer,
            cursor.step,
          );
          break;
        case 'ArrowUp':
          moveCursor(LAYER_IDS[Math.max(0, laneIndex - 1)] ?? cursor.layer, cursor.step);
          break;
        case 'Home':
          moveCursor(cursor.layer, 0);
          break;
        case 'End':
          moveCursor(cursor.layer, state.stepsPerBar - 1);
          break;
        case 'Delete':
        case 'Backspace': {
          const cell = state.layers[cursor.layer].steps[cursor.step];
          if (cell) update(removePlacement(state, cursor.layer, cell.placementId, library));
          break;
        }
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    },
    [cursor, library, moveCursor, state, update],
  );

  // Sized for a thumb first. A sixteen-step bar is wider than a phone at this
  // size, so the grid scrolls inside its own container — which is the right
  // trade: a scrollable grid is usable, a grid of 20 px cells is not.
  const cellSize = 34;

  return (
    <div
      className={SCOPE}
      data-testid="composition-screen"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: theme.colour.background,
        padding: theme.space(2),
        color: theme.colour.text,
      }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />
      <Panel theme={theme} style={{ width: 'min(62rem, 100%)', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: theme.space(2),
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ margin: 0, fontSize: theme.font.title, color: theme.colour.gold, letterSpacing: '0.16em' }}>
            Composition
          </h2>
          <p style={{ margin: 0, fontSize: theme.font.tiny, color: theme.colour.textDim, maxWidth: '30rem' }}>
            Every phrase here was found somewhere. Lay them over each other and the world will hear
            it back.
          </p>
        </div>

        {/* Transport */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space(1.5),
            marginTop: theme.space(2),
            paddingBottom: theme.space(1.5),
            borderBottom: `1px solid rgba(245,196,81,0.25)`,
          }}
        >
          <Button
            theme={theme}
            variant="primary"
            testId="composition-play"
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => (playing ? stop() : setPlaying(true))}
          >
            {playing ? 'Stop' : 'Play'}
          </Button>

          <TempoControl
            theme={theme}
            tempo={state.tempoBpm}
            stepsPerBar={state.stepsPerBar}
            onChange={(bpm) => update(setTempo(state, bpm))}
          />

          <label style={{ fontSize: theme.font.tiny, color: theme.colour.textDim }}>
            <span style={{ display: 'block', letterSpacing: '0.14em' }}>STEPS</span>
            <select
              data-testid="composition-grid-size"
              value={state.stepsPerBar}
              onChange={(event) =>
                update(setGridSize(state, Number.parseInt(event.target.value, 10), library))
              }
              style={{
                font: 'inherit',
                fontSize: theme.font.small,
                background: theme.colour.panelRaised,
                color: theme.colour.text,
                border: `1px solid ${theme.colour.outline}`,
                borderRadius: theme.radius.sm,
                padding: theme.space(0.75),
                minHeight: 34,
              }}
            >
              {GRID_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <Button
            theme={theme}
            testId="composition-suggest"
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => {
              update(suggestArrangement(state, library));
              setMessage('A starting arrangement. Change anything you like.');
            }}
          >
            Suggest
          </Button>
          <Button
            theme={theme}
            variant="ghost"
            testId="composition-clear-all"
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => {
              update(clearAll(state));
              setMessage('Grid cleared.');
            }}
          >
            Clear all
          </Button>
          {onSubmit && (
            <Button
              theme={theme}
              variant="primary"
              testId="composition-submit"
              style={{ width: 'auto', marginBottom: 0 }}
              onClick={() => onSubmit(state)}
            >
              {submitLabel}
            </Button>
          )}
          {onClose && (
            <Button
              theme={theme}
              variant="ghost"
              testId="composition-close"
              style={{ width: 'auto', marginBottom: 0, marginLeft: 'auto' }}
              onClick={onClose}
            >
              Close
            </Button>
          )}
        </div>

        {/* Grid */}
        <div
          role="grid"
          aria-label="Composition grid"
          data-testid="composition-grid"
          onKeyDown={onGridKey}
          style={{ marginTop: theme.space(2), overflowX: 'auto' }}
        >
          <div style={{ display: 'flex', gap: theme.space(1), marginLeft: '9.5rem', minWidth: 'min-content' }}>
            {Array.from({ length: state.stepsPerBar }, (_, step) => (
              <span
                key={step}
                aria-hidden
                style={{
                  width: cellSize,
                  flex: '0 0 auto',
                  textAlign: 'center',
                  fontSize: theme.font.tiny,
                  color: step === playStep ? theme.colour.gold : theme.colour.textDim,
                  opacity: step % stepsPerBeat(state.stepsPerBar) === 0 ? 1 : 0.45,
                }}
              >
                {step % stepsPerBeat(state.stepsPerBar) === 0
                  ? String(step / stepsPerBeat(state.stepsPerBar) + 1)
                  : '·'}
              </span>
            ))}
          </div>

          {LAYER_IDS.map((layer) => {
            const lane = state.layers[layer];
            const colour = layerColour(layer, theme);
            return (
              <div
                key={layer}
                role="row"
                style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), marginTop: theme.space(1) }}
              >
                <div style={{ width: '9.5rem', flex: '0 0 auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(0.75) }}>
                    <CellMark layer={layer} size={12} colour={colour} />
                    <span style={{ fontSize: theme.font.small, color: colour, letterSpacing: '0.1em' }}>
                      {LAYER_META[layer].label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: theme.space(0.5), marginTop: theme.space(0.5) }}>
                    <MiniButton
                      theme={theme}
                      testId={`composition-timbre-${layer}`}
                      label={TIMBRE_LABELS[lane.timbre]}
                      title={`Change ${LAYER_META[layer].label} timbre`}
                      onClick={() => update(cycleTimbre(state, layer))}
                    />
                    <MiniButton
                      theme={theme}
                      testId={`composition-mute-${layer}`}
                      label={lane.muted ? 'Off' : 'On'}
                      pressed={!lane.muted}
                      title={`${lane.muted ? 'Unmute' : 'Mute'} ${LAYER_META[layer].label}`}
                      onClick={() => update(toggleLayerMuted(state, layer))}
                    />
                    <MiniButton
                      theme={theme}
                      testId={`composition-clear-${layer}`}
                      label="Clear"
                      title={`Clear ${LAYER_META[layer].label}`}
                      onClick={() => {
                        update(clearLayer(state, layer));
                        setMessage(`${LAYER_META[layer].label} cleared.`);
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: theme.space(1), minWidth: 'min-content' }}>
                  {Array.from({ length: state.stepsPerBar }, (_, step) => {
                    const cell = lane.steps[step];
                    const isCursor = cursor.layer === layer && cursor.step === step;
                    const onBeat = step % stepsPerBeat(state.stepsPerBar) === 0;
                    const underPlayhead = step === playStep;
                    const selected =
                      cell !== null &&
                      cell !== undefined &&
                      selectedPlacement?.layer === layer &&
                      selectedPlacement.placementId === cell.placementId;
                    return (
                      <button
                        key={step}
                        ref={(element) => {
                          const key = `${layer}:${step}`;
                          if (element) cellRefs.current.set(key, element);
                          else cellRefs.current.delete(key);
                        }}
                        type="button"
                        role="gridcell"
                        data-testid={`composition-cell-${layer}-${step}`}
                        tabIndex={isCursor ? 0 : -1}
                        aria-label={
                          cell
                            ? `${LAYER_META[layer].label} step ${step + 1}, ${HARMONIC_DEGREE_NAMES[cell.degree] ?? 'Root'}`
                            : `${LAYER_META[layer].label} step ${step + 1}, empty`
                        }
                        aria-selected={selected}
                        onFocus={() => setCursor({ layer, step })}
                        onClick={() => {
                          setCursor({ layer, step });
                          place(layer, step);
                        }}
                        style={{
                          width: cellSize,
                          height: cellSize + 6,
                          flex: '0 0 auto',
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          background: underPlayhead
                            ? reducedFlashing
                              ? 'rgba(245,196,81,0.12)'
                              : 'rgba(245,196,81,0.24)'
                            : onBeat
                              ? 'rgba(255,255,255,0.06)'
                              : 'transparent',
                          border: `${selected ? 2 : 1}px solid ${
                            selected
                              ? theme.colour.gold
                              : isCursor
                                ? theme.colour.resonance
                                : 'rgba(245,196,81,0.25)'
                          }`,
                          borderRadius: theme.radius.sm,
                          cursor: 'pointer',
                          transition: theme.reducedMotion ? 'none' : 'background 90ms',
                        }}
                      >
                        {cell && <CellMark layer={layer} size={cell.accent ? 16 : 13} colour={colour} />}
                        {cell && theme.showShapes && (
                          <span
                            style={{
                              position: 'absolute',
                              fontSize: '0.6rem',
                              color: theme.colour.background,
                              pointerEvents: 'none',
                            }}
                          >
                            {cell.degree}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected phrase controls */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space(1),
            marginTop: theme.space(2),
          }}
        >
          <span style={{ fontSize: theme.font.tiny, letterSpacing: '0.16em', color: theme.colour.textDim }}>
            SELECTED PHRASE
          </span>
          <Button
            theme={theme}
            testId="composition-reverse"
            disabled={!selectedPlacement}
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => {
              if (!selectedPlacement) return;
              update(
                transformPlacement(
                  state,
                  selectedPlacement.layer,
                  selectedPlacement.placementId,
                  'reverse',
                  library,
                ),
              );
              setMessage('Reversed. Do it again to put it back.');
            }}
          >
            Reverse
          </Button>
          <Button
            theme={theme}
            testId="composition-mirror"
            disabled={!selectedPlacement}
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => {
              if (!selectedPlacement) return;
              update(
                transformPlacement(
                  state,
                  selectedPlacement.layer,
                  selectedPlacement.placementId,
                  'mirror',
                  library,
                ),
              );
              setMessage('Mirrored about the middle of the chord.');
            }}
          >
            Mirror
          </Button>
          <Button
            theme={theme}
            variant="ghost"
            testId="composition-remove"
            disabled={!selectedPlacement}
            style={{ width: 'auto', marginBottom: 0 }}
            onClick={() => {
              if (!selectedPlacement) return;
              update(
                removePlacement(
                  state,
                  selectedPlacement.layer,
                  selectedPlacement.placementId,
                  library,
                ),
              );
              setSelectedPlacement(null);
            }}
          >
            Remove
          </Button>
        </div>

        {/* Tray */}
        <h3
          style={{
            fontSize: theme.font.small,
            color: theme.colour.textDim,
            letterSpacing: '0.2em',
            marginTop: theme.space(3),
            marginBottom: theme.space(1),
          }}
        >
          PHRASES YOU HAVE FOUND
        </h3>
        {trayCards.length === 0 ? (
          <p style={{ fontSize: theme.font.small, color: theme.colour.textDim }}>
            None yet. Phrases are written down where the world still makes them.
          </p>
        ) : (
          <div
            role="listbox"
            aria-label="Motif cards"
            style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(1) }}
          >
            {trayCards.map((card, index) => {
              const chosen = selectedCardId === card.id;
              const colour = layerColour(card.layer, theme);
              return (
                <button
                  key={card.id}
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  data-testid={`composition-card-${card.id}`}
                  onClick={() => {
                    setSelectedCardId(chosen ? null : card.id);
                    setCursor((c) => ({ layer: card.layer, step: c.step }));
                    setMessage(
                      chosen
                        ? 'Phrase put down.'
                        : `${card.name} in hand — choose a step on the ${LAYER_META[card.layer].label} lane.`,
                    );
                  }}
                  style={{
                    font: 'inherit',
                    textAlign: 'left',
                    minWidth: '11rem',
                    minHeight: 44,
                    padding: theme.space(1.25),
                    background: chosen ? theme.colour.panelRaised : 'transparent',
                    border: `${chosen ? 2 : 1}px solid ${chosen ? colour : 'rgba(245,196,81,0.25)'}`,
                    borderRadius: theme.radius.md,
                    color: theme.colour.text,
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: theme.space(0.75) }}>
                    <CellMark layer={card.layer} size={11} colour={colour} />
                    <span style={{ fontSize: theme.font.small }}>{card.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: theme.font.tiny, color: theme.colour.textDim }}>
                      {index + 1}
                    </span>
                  </span>
                  <MotifPreview card={card} colour={colour} theme={theme} />
                  <span style={{ display: 'block', fontSize: theme.font.tiny, color: theme.colour.textDim }}>
                    {LAYER_META[card.layer].label} · {card.steps.length} steps
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p
          aria-live="polite"
          data-testid="composition-message"
          style={{
            marginTop: theme.space(2),
            fontSize: theme.font.small,
            color: theme.colour.text,
            minHeight: '1.4em',
          }}
        >
          {message}
        </p>
        <p style={{ margin: 0, fontSize: theme.font.tiny, color: theme.colour.textDim }}>
          {describeComposition(state)}
        </p>
      </Panel>
    </div>
  );
}

const REJECTION_TEXT: Readonly<Record<PlacementRejection, string>> = {
  'unknown-motif': 'That phrase is not in your book.',
  'not-collected': 'You have not found that phrase yet.',
  'wrong-layer': 'That phrase belongs on another lane.',
  'out-of-range': 'That step is past the end of the bar.',
};

function MiniButton({
  theme,
  label,
  title,
  onClick,
  pressed,
  testId,
}: {
  theme: Theme;
  label: string;
  title: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      style={{
        font: 'inherit',
        fontSize: theme.font.tiny,
        minHeight: 28,
        padding: `2px ${theme.space(1)}`,
        background: pressed === true ? theme.colour.panelRaised : 'transparent',
        color: theme.colour.textDim,
        border: '1px solid rgba(245,196,81,0.25)',
        borderRadius: theme.radius.sm,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function TempoControl({
  theme,
  tempo,
  stepsPerBar,
  onChange,
}: {
  theme: Theme;
  tempo: number;
  stepsPerBar: number;
  onChange: (bpm: number) => void;
}): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(0.75) }}>
      <MiniButton theme={theme} testId="composition-tempo-down" label="−" title="Slower" onClick={() => onChange(tempo - 4)} />
      <label style={{ fontSize: theme.font.tiny, color: theme.colour.textDim, textAlign: 'center' }}>
        <span style={{ display: 'block', letterSpacing: '0.14em' }}>TEMPO</span>
        <input
          data-testid="composition-tempo"
          type="range"
          min={MIN_TEMPO}
          max={MAX_TEMPO}
          step={1}
          value={tempo}
          aria-label={`Tempo, ${tempo} beats per minute`}
          onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
          style={{ width: '8rem', accentColor: theme.colour.resonance }}
        />
        <span style={{ display: 'block', color: theme.colour.text }}>
          {tempo} bpm · {(stepDurationSeconds(tempo, stepsPerBar) * 1000).toFixed(0)} ms/step
        </span>
      </label>
      <MiniButton theme={theme} testId="composition-tempo-up" label="+" title="Faster" onClick={() => onChange(tempo + 4)} />
    </div>
  );
}
