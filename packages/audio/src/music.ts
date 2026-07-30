/**
 * The adaptive score.
 *
 * The central idea of TUNER is that the music *is* the restoration: as a
 * region's infection falls, the score literally retunes from the Detuners'
 * 440 Hz back to the universe's 432 Hz. {@link playbackHzForInfection} is that
 * idea reduced to arithmetic, and every pitch the scheduler emits is derived
 * from it, so the effect is structural rather than decorative.
 *
 * The director itself is a pure state machine: gameplay signals in, per-layer
 * target gains out, eased framerate-independently with {@link damp}. It makes
 * no Web Audio calls and reads no clock, which is what allows the layer rules
 * to be asserted in Node.
 */

import {
  DETUNED_HZ,
  WORLD_CHORD_HZ,
  clamp01,
  createRng,
  damp,
  hashSeed,
  remap,
  smoothstep,
  type StageId,
} from '@tuner/shared';
import type { MusicLayer, MusicState } from './types.js';
import { harmonicRatio, type FilterKind, type OscWave, type VoiceRhythm } from './synth.js';

// ---------------------------------------------------------------------------
// The retuning
// ---------------------------------------------------------------------------

/**
 * Playback root for a region at the given infection level.
 *
 * Infection 1 is exactly {@link DETUNED_HZ}; infection 0 is exactly
 * {@link WORLD_CHORD_HZ}; between them the mapping is geometric, which is to
 * say linear in cents and strictly monotonic. Both ends are exact by
 * construction rather than by luck, because the endpoints are what the player
 * is listening for.
 */
export function playbackHzForInfection(infection: number): number {
  const t = clamp01(infection);
  if (t <= 0) return WORLD_CHORD_HZ;
  if (t >= 1) return DETUNED_HZ;
  return WORLD_CHORD_HZ * Math.pow(DETUNED_HZ / WORLD_CHORD_HZ, t);
}

/** Frequency of a motif degree above a playback root. */
export function motifNoteHz(rootHz: number, degree: number, octaveShift = 0): number {
  return rootHz * harmonicRatio(degree) * Math.pow(2, octaveShift);
}

// ---------------------------------------------------------------------------
// Region motifs
// ---------------------------------------------------------------------------

/**
 * Mirrors `StagePhase` in `@tuner/game-core`. It is duplicated rather than
 * imported because audio must not depend on the simulation package; the string
 * union is structurally identical, so a `StagePhase` passes straight in.
 */
export type MusicPhase =
  | 'loading'
  | 'intro'
  | 'exploration'
  | 'miniboss'
  | 'commander'
  | 'restoration'
  | 'results'
  | 'failed';

/** A region is either one of the stages or the hub. */
export type MusicRegion = StageId | 'sanctuary';

export interface RegionMotif {
  readonly region: MusicRegion;
  /** Seed for {@link generatePhrase}. Distinct per region by construction. */
  readonly seed: number;
  /** Harmonic degrees the region's phrases may use. */
  readonly scale: readonly number[];
  readonly rootOctave: number;
  readonly tempoBpm: number;
  readonly stepsPerBar: number;
  readonly bars: number;
  /** Design note. Never shown to the player. */
  readonly character: string;
}

function motif(
  region: MusicRegion,
  scale: readonly number[],
  rootOctave: number,
  tempoBpm: number,
  stepsPerBar: number,
  bars: number,
  character: string,
): RegionMotif {
  return {
    region,
    seed: hashSeed(`tuner:motif:${region}`),
    scale,
    rootOctave,
    tempoBpm,
    stepsPerBar,
    bars,
    character,
  };
}

/**
 * A seed and a scale per region. Eight regions, a hub and the approach to the
 * Loom, each with its own theme and not one audio file between them.
 */
export const REGION_MOTIFS: Readonly<Record<MusicRegion, RegionMotif>> = Object.freeze({
  sanctuary: motif('sanctuary', [0, 2, 4, 7], 0, 58, 8, 4, 'already at 432 — open, unhurried'),
  'fallen-sanctuary': motif(
    'fallen-sanctuary',
    [0, 2, 4, 7, 9],
    0,
    62,
    8,
    4,
    'the hub as it was, half remembered',
  ),
  'fractured-garden': motif(
    'fractured-garden',
    [0, 1, 3, 4, 5],
    0,
    72,
    8,
    4,
    'growth interrupted mid-phrase',
  ),
  'glass-meridian': motif(
    'glass-meridian',
    [0, 2, 3, 6, 7],
    1,
    84,
    12,
    4,
    'bright, brittle, mirrored intervals',
  ),
  'tidal-archive': motif(
    'tidal-archive',
    [0, 3, 4, 5, 7],
    -1,
    54,
    8,
    6,
    'slow swells, everything submerged',
  ),
  'ember-observatory': motif(
    'ember-observatory',
    [0, 2, 4, 6],
    0,
    96,
    16,
    2,
    'sparks over a long drone',
  ),
  'hollow-choir': motif(
    'hollow-choir',
    [0, 1, 4, 5, 7],
    1,
    66,
    8,
    4,
    'voices answering across an empty nave',
  ),
  'verdant-machine': motif(
    'verdant-machine',
    [0, 2, 5, 7, 9],
    0,
    108,
    16,
    2,
    'mechanical pulse with something alive inside it',
  ),
  'desert-of-lost-notes': motif(
    'desert-of-lost-notes',
    [0, 1, 2, 5],
    -1,
    48,
    8,
    6,
    'sparse, wide silences, heat shimmer',
  ),
  'orbital-dissonance': motif(
    'orbital-dissonance',
    [0, 1, 5, 6],
    1,
    120,
    16,
    2,
    'nothing agrees with anything',
  ),
  'celestial-loom': motif(
    'celestial-loom',
    [0, 2, 4, 5, 7, 9, 11],
    0,
    76,
    12,
    4,
    'every region at once, finally in tune',
  ),
});

export function regionMotif(region: MusicRegion): RegionMotif {
  return REGION_MOTIFS[region];
}

// ---------------------------------------------------------------------------
// Deterministic phrase generation
// ---------------------------------------------------------------------------

export interface PhraseNote {
  /** Harmonic degree, always a member of the scale it was generated from. */
  readonly degree: number;
  /** Absolute step index from the start of the phrase. */
  readonly step: number;
  /** Length in steps, at least 1. */
  readonly duration: number;
  /** 0..1, used as a per-note gain scale. */
  readonly velocity: number;
}

/**
 * Grows a phrase from a seed.
 *
 * Deterministic: the same seed, scale and shape always produce the same notes,
 * on every platform, because it draws from {@link createRng} rather than
 * `Math.random`. Notes never overlap and never leave the scale.
 */
export function generatePhrase(
  seed: number | string,
  scaleDegrees: readonly number[],
  bars = 2,
  stepsPerBar = 8,
): readonly PhraseNote[] {
  if (scaleDegrees.length === 0) {
    throw new Error('generatePhrase needs at least one scale degree');
  }
  const barCount = Math.max(1, Math.floor(bars));
  const perBar = Math.max(1, Math.floor(stepsPerBar));
  const totalSteps = barCount * perBar;
  const rng = createRng(seed);
  const root = scaleDegrees[0] as number;
  const notes: PhraseNote[] = [];

  let step = 0;
  while (step < totalSteps) {
    const onBeat = step % perBar === 0;
    if (!onBeat && rng.chance(0.3)) {
      step += 1;
      continue;
    }
    const degree = step === 0 ? root : rng.pick(scaleDegrees);
    const longest = Math.min(onBeat ? 4 : 3, totalSteps - step);
    const duration = rng.int(1, Math.max(1, longest));
    const velocity = Math.round(rng.range(onBeat ? 0.68 : 0.42, 1) * 1000) / 1000;
    notes.push({ degree, step, duration, velocity });
    step += duration;
  }

  return notes;
}

/** The region's own phrase, at its own shape. */
export function phraseForRegion(region: MusicRegion, bars?: number): readonly PhraseNote[] {
  const m = regionMotif(region);
  return generatePhrase(m.seed, m.scale, bars ?? m.bars, m.stepsPerBar);
}

// ---------------------------------------------------------------------------
// Layer voices
// ---------------------------------------------------------------------------

/** How the renderer should voice a layer. Consumed by the audio adapter. */
export interface LayerVoiceSpec {
  readonly layer: MusicLayer;
  readonly wave: OscWave;
  /** Degrees sounded together, relative to the phrase note. */
  readonly degrees: readonly number[];
  readonly octave: number;
  readonly gain: number;
  readonly filter: FilterKind;
  readonly filterHz: number;
  readonly rhythm: VoiceRhythm;
  /**
   * How strongly this layer follows the Detuners rather than the World Chord.
   * 1 means it is voiced entirely on the infected grid.
   */
  readonly detunePull: number;
}

export const MUSIC_LAYER_VOICES: Readonly<Record<MusicLayer, LayerVoiceSpec>> = Object.freeze({
  world: {
    layer: 'world',
    wave: 'sine',
    degrees: [0, 4],
    octave: -1,
    gain: 0.5,
    filter: 'lowpass',
    filterHz: 1800,
    rhythm: 'drone',
    detunePull: 1,
  },
  movement: {
    layer: 'movement',
    wave: 'triangle',
    degrees: [0, 2],
    octave: 0,
    gain: 0.4,
    filter: 'lowpass',
    filterHz: 3200,
    rhythm: 'arp',
    detunePull: 0.7,
  },
  combat: {
    layer: 'combat',
    wave: 'sawtooth',
    degrees: [0, 1],
    octave: 0,
    gain: 0.45,
    filter: 'bandpass',
    filterHz: 1400,
    rhythm: 'pulse',
    detunePull: 1,
  },
  miniboss: {
    layer: 'miniboss',
    wave: 'square',
    degrees: [0, 1, 5],
    octave: -1,
    gain: 0.5,
    filter: 'lowpass',
    filterHz: 1600,
    rhythm: 'pulse',
    detunePull: 1,
  },
  commander: {
    layer: 'commander',
    wave: 'sawtooth',
    degrees: [0, 1, 4, 6],
    octave: -1,
    gain: 0.55,
    filter: 'lowpass',
    filterHz: 2200,
    rhythm: 'pulse',
    detunePull: 1,
  },
  lowCoherence: {
    layer: 'lowCoherence',
    wave: 'triangle',
    degrees: [0, 1],
    octave: -2,
    gain: 0.35,
    filter: 'lowpass',
    filterHz: 700,
    rhythm: 'pad',
    detunePull: 1,
  },
  restoration: {
    layer: 'restoration',
    wave: 'triangle',
    degrees: [0, 2, 4, 7],
    octave: 0,
    gain: 0.5,
    filter: 'lowpass',
    filterHz: 5200,
    rhythm: 'pad',
    detunePull: 0.25,
  },
  sanctuary: {
    layer: 'sanctuary',
    wave: 'sine',
    degrees: [0, 4, 7],
    octave: 0,
    gain: 0.45,
    filter: 'lowpass',
    filterHz: 2600,
    rhythm: 'pad',
    /** The hub is already true; it never follows the infection. */
    detunePull: 0,
  },
  worldChord: {
    layer: 'worldChord',
    wave: 'triangle',
    degrees: [0, 2, 4, 7, 9],
    octave: 1,
    gain: 0.6,
    filter: 'highpass',
    filterHz: 240,
    rhythm: 'pad',
    detunePull: 0,
  },
});

export const MUSIC_LAYERS: readonly MusicLayer[] = Object.freeze(
  Object.keys(MUSIC_LAYER_VOICES) as MusicLayer[],
) as readonly MusicLayer[];

/**
 * Dominance tie-break order, most assertive first. Only consulted when two
 * layers sit at the same gain, which keeps `dominantLayer()` deterministic.
 */
const LAYER_PRIORITY: readonly MusicLayer[] = [
  'worldChord',
  'commander',
  'miniboss',
  'restoration',
  'sanctuary',
  'lowCoherence',
  'combat',
  'movement',
  'world',
];

const LAYER_PRIORITY_INDEX: Readonly<Record<MusicLayer, number>> = Object.freeze(
  LAYER_PRIORITY.reduce<Record<MusicLayer, number>>(
    (acc, layer, index) => {
      acc[layer] = index;
      return acc;
    },
    {} as Record<MusicLayer, number>,
  ),
);

/** Per-layer crossfade smoothing: the fraction of the gap left after a second. */
const LAYER_SMOOTHING: Readonly<Record<MusicLayer, number>> = Object.freeze({
  world: 0.02,
  movement: 0.004,
  combat: 0.006,
  miniboss: 0.01,
  commander: 0.01,
  lowCoherence: 0.03,
  restoration: 0.05,
  sanctuary: 0.05,
  worldChord: 0.08,
});

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

export interface MusicSignals {
  readonly region: MusicRegion;
  readonly phase: MusicPhase;
  /** Nearby active enemy pressure in [0, 1]. */
  readonly combatPressure: number;
  readonly bossPresent: boolean;
  /** Zero-based boss phase index. */
  readonly bossPhase: number;
  /** Coherence as a fraction of maximum, in [0, 1]. */
  readonly coherenceFraction: number;
  /** Restoration completion in [0, 1]. */
  readonly restorationProgress: number;
  /** Horizontal player speed in metres per second. */
  readonly playerSpeed: number;
  /** Region detune in [0, 1]; 1 is fully 440 Hz. */
  readonly infection: number;
  /** Forces the World Chord layer for the finale. */
  readonly finale: boolean;
}

export const DEFAULT_MUSIC_SIGNALS: MusicSignals = Object.freeze({
  region: 'sanctuary',
  phase: 'loading',
  combatPressure: 0,
  bossPresent: false,
  bossPhase: 0,
  coherenceFraction: 1,
  restorationProgress: 0,
  playerSpeed: 0,
  infection: 0,
  finale: false,
});

export interface MusicDirectorOptions {
  /** Coherence fraction below which the low-Coherence layer engages. */
  readonly lowCoherenceThreshold?: number;
  /** Speed at which the movement layer starts to lift, in m/s. */
  readonly movementSpeedFloor?: number;
  /** Speed at which the movement layer is fully in, in m/s. */
  readonly movementSpeedCeiling?: number;
  readonly signals?: Partial<MusicSignals>;
}

/** Matches `DEFAULT_COMBAT_CONFIG.lowCoherenceThreshold` in `@tuner/game-core`. */
export const DEFAULT_LOW_COHERENCE_THRESHOLD = 0.3;
export const DEFAULT_MOVEMENT_SPEED_FLOOR = 3.5;
export const DEFAULT_MOVEMENT_SPEED_CEILING = 12;

type LayerGains = Record<MusicLayer, number>;

function zeroLayers(): LayerGains {
  return {
    world: 0,
    movement: 0,
    combat: 0,
    miniboss: 0,
    commander: 0,
    lowCoherence: 0,
    restoration: 0,
    sanctuary: 0,
    worldChord: 0,
  };
}

function isHub(region: MusicRegion): boolean {
  return region === 'sanctuary' || region === 'fallen-sanctuary';
}

/** True when the finale layer should take over. */
export function isFinale(signals: MusicSignals): boolean {
  if (signals.finale) return true;
  return (
    signals.region === 'celestial-loom' &&
    (signals.phase === 'restoration' || signals.phase === 'results')
  );
}

/**
 * The layer rulebook, as a pure function so each situation can be asserted
 * directly without stepping time.
 *
 * - `world` is always present: it is the region's own resonance.
 * - `movement` rises with speed.
 * - `combat` rises with nearby active enemies, and yields entirely to
 *   `miniboss` / `commander` during those phases.
 * - `lowCoherence` engages below the Coherence threshold.
 * - `restoration` covers the restoration phase, `sanctuary` the hub, and
 *   `worldChord` the finale.
 */
export function computeLayerTargets(
  signals: MusicSignals,
  options: MusicDirectorOptions = {},
): Readonly<LayerGains> {
  const lowThreshold = options.lowCoherenceThreshold ?? DEFAULT_LOW_COHERENCE_THRESHOLD;
  const speedFloor = options.movementSpeedFloor ?? DEFAULT_MOVEMENT_SPEED_FLOOR;
  const speedCeiling = options.movementSpeedCeiling ?? DEFAULT_MOVEMENT_SPEED_CEILING;

  const targets = zeroLayers();
  const phase = signals.phase;
  const hub = isHub(signals.region);
  const finale = isFinale(signals);
  const pressure = clamp01(signals.combatPressure);
  const bossPhaseLift = clamp01(signals.bossPhase / 3);

  if (phase === 'loading' && signals.region !== 'sanctuary') {
    // Nothing but the region's bed while a stage streams in.
    targets.world = 0.28;
    return targets;
  }

  // The world layer is never absent, but it steps back when something louder
  // has the floor.
  targets.world =
    phase === 'commander' ? 0.3 : phase === 'miniboss' ? 0.4 : finale ? 0.32 : phase === 'restoration' ? 0.4 : 0.55;

  const speed = smoothstep(speedFloor, speedCeiling, Math.max(0, signals.playerSpeed));
  const inFight = phase === 'miniboss' || phase === 'commander';
  targets.movement = speed * (inFight ? 0.4 : 0.85);

  if (!hub && (phase === 'exploration' || phase === 'intro')) {
    targets.combat = pressure * 0.95;
  }

  if (phase === 'miniboss') {
    targets.miniboss = Math.min(1, 0.88 + 0.1 * bossPhaseLift);
  } else if (phase === 'commander') {
    targets.commander = Math.min(1, 0.9 + 0.1 * bossPhaseLift);
  } else if (signals.bossPresent) {
    // A commander on the field outside its own phase still colours the score.
    targets.commander = 0.3;
  }

  const coherenceLayerActive =
    phase === 'intro' || phase === 'exploration' || phase === 'miniboss' || phase === 'commander';
  if (coherenceLayerActive && signals.coherenceFraction < lowThreshold) {
    targets.lowCoherence = remap(signals.coherenceFraction, lowThreshold, 0, 0.3, 0.85);
  }

  if (phase === 'restoration') {
    targets.restoration = 0.75 + 0.2 * clamp01(signals.restorationProgress);
  }

  if (hub) {
    targets.sanctuary = 0.92;
    targets.combat = 0;
    targets.miniboss = 0;
    targets.commander = 0;
    targets.lowCoherence = 0;
    targets.world = 0.42;
  }

  if (finale) {
    targets.worldChord = 1;
  }

  if (phase === 'failed') {
    targets.combat = 0;
    targets.movement = 0;
    targets.miniboss = 0;
    targets.commander = 0;
    targets.world = 0.35;
    targets.lowCoherence = 0.5;
  }

  return targets;
}

/** Overall musical intensity in [0, 1]. */
export function computeIntensity(signals: MusicSignals): number {
  const pressure = clamp01(signals.combatPressure);
  const boss =
    signals.phase === 'commander' ? 1 : signals.phase === 'miniboss' ? 0.8 : signals.bossPresent ? 0.5 : 0;
  const danger = clamp01(1 - signals.coherenceFraction) * 0.4;
  return clamp01(Math.max(pressure * 0.85, boss) * 0.85 + danger * 0.3);
}

export interface MusicDirector {
  /** Merges new gameplay signals. Unspecified fields keep their value. */
  setSignals(patch: Partial<MusicSignals>): void;
  readonly signals: Readonly<MusicSignals>;
  /** Eases current gains toward targets. Framerate independent. */
  update(dt: number): void;
  readonly targets: Readonly<LayerGains>;
  readonly gains: Readonly<LayerGains>;
  /** Loudest layer right now. */
  dominantLayer(): MusicLayer;
  /** Loudest layer once the current targets are reached. */
  dominantTargetLayer(): MusicLayer;
  /** Snapshot for {@link AudioEngine.setMusicState}. */
  state(): MusicState;
  /** The score's current tuning, in Hz. */
  playbackHz(): number;
  motif(): RegionMotif;
  /** Jumps gains straight to their targets, for scene transitions. */
  snapToTargets(): void;
  reset(patch?: Partial<MusicSignals>): void;
}

export function createMusicDirector(options: MusicDirectorOptions = {}): MusicDirector {
  let signals: MusicSignals = { ...DEFAULT_MUSIC_SIGNALS, ...options.signals };
  let targets = computeLayerTargets(signals, options);
  const gains = zeroLayers();
  let detune = clamp01(signals.infection);
  let intensity = computeIntensity(signals);

  const pickDominant = (source: Readonly<LayerGains>): MusicLayer => {
    let best: MusicLayer = 'world';
    let bestValue = -1;
    let bestPriority = LAYER_PRIORITY.length;
    for (const layer of MUSIC_LAYERS) {
      const value = source[layer];
      const priority = LAYER_PRIORITY_INDEX[layer];
      if (value > bestValue + 1e-9 || (Math.abs(value - bestValue) <= 1e-9 && priority < bestPriority)) {
        best = layer;
        bestValue = value;
        bestPriority = priority;
      }
    }
    return best;
  };

  const director: MusicDirector = {
    setSignals(patch) {
      signals = { ...signals, ...patch };
      targets = computeLayerTargets(signals, options);
    },
    get signals() {
      return signals;
    },
    update(dt) {
      if (!(dt > 0)) return;
      for (const layer of MUSIC_LAYERS) {
        const smoothing = LAYER_SMOOTHING[layer];
        gains[layer] = damp(gains[layer], targets[layer], smoothing, dt);
      }
      detune = damp(detune, clamp01(signals.infection), 0.05, dt);
      intensity = damp(intensity, computeIntensity(signals), 0.01, dt);
    },
    get targets() {
      return targets;
    },
    get gains() {
      return gains;
    },
    dominantLayer: () => pickDominant(gains),
    dominantTargetLayer: () => pickDominant(targets),
    state: () => ({
      stage: signals.region,
      layers: { ...gains },
      detune,
      intensity,
    }),
    playbackHz: () => playbackHzForInfection(detune),
    motif: () => regionMotif(signals.region),
    snapToTargets() {
      for (const layer of MUSIC_LAYERS) {
        gains[layer] = targets[layer];
      }
      detune = clamp01(signals.infection);
      intensity = computeIntensity(signals);
    },
    reset(patch) {
      signals = { ...DEFAULT_MUSIC_SIGNALS, ...options.signals, ...patch };
      targets = computeLayerTargets(signals, options);
      for (const layer of MUSIC_LAYERS) {
        gains[layer] = 0;
      }
      detune = clamp01(signals.infection);
      intensity = computeIntensity(signals);
    },
  };

  return director;
}
