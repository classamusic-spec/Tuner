/**
 * Sound as data.
 *
 * TUNER ships no audio files. Every sound is described here as an `SfxRecipe`
 * — oscillator, frequency envelope, ADSR, filter sweep, noise bed, duration —
 * and rendered by whichever adapter is running (Web Audio today, a native mixer
 * later). Two consequences matter more than the download size:
 *
 * 1. A game about pitch can generate any pitch it needs. Player pitches are
 *    derived from {@link harmonicHz} — just intonation against the 432 Hz World
 *    Chord — and Detuner pitches from the same ratios rebuilt on 440 Hz. The
 *    dissonance the player hears around an infected creature is the *same
 *    number* the shader uses to tint it violet: see
 *    {@link detuneCentsForInfection}.
 * 2. Comfort is enforceable. This game's whole vocabulary is pure tones, and
 *    sustained pure tones fatigue quickly, so recipes are held under
 *    {@link MAX_PEAK_AMPLITUDE} and {@link MAX_PURE_TONE_SECONDS} by tests
 *    rather than by reviewer judgement.
 *
 * Nothing in this module touches Web Audio, the DOM or a clock; it is pure data
 * plus arithmetic, so it is testable in Node.
 */

import {
  DETUNED_HZ,
  HARMONIC_RATIOS,
  WORLD_CHORD_HZ,
  centsBetween,
  clamp01,
  harmonicHz,
  semitonesBetween,
  type PaletteKey,
  type ResonanceFormId,
} from '@tuner/shared';
import type { MixBus, SfxId } from './types.js';

// ---------------------------------------------------------------------------
// Recipe vocabulary
// ---------------------------------------------------------------------------

export type OscWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** How a frequency envelope travels from start to end. */
export type FrequencyCurve = 'linear' | 'exponential' | 'hold';

export type FilterKind = 'none' | 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export type NoiseColour = 'white' | 'pink';

/** Rhythmic character of a sustained voice, used by the music scheduler. */
export type VoiceRhythm = 'drone' | 'pad' | 'pulse' | 'arp';

export interface FrequencyEnvelope {
  readonly startHz: number;
  readonly endHz: number;
  readonly curve: FrequencyCurve;
  /** Fraction of the duration the glide occupies, in (0, 1]. */
  readonly glide: number;
}

/**
 * Amplitude envelope. `peak` is absolute (pre-bus) and `sustain` is a fraction
 * of it, so a recipe's loudness can be checked without rendering it.
 */
export interface AmplitudeEnvelope {
  readonly peak: number;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

export interface FilterEnvelope {
  readonly kind: FilterKind;
  readonly startHz: number;
  readonly endHz: number;
  readonly q: number;
}

/**
 * Optional stack of just-intonation partials layered over the root, which is
 * how a blip becomes a bell and a bell becomes a chord. Gains are relative
 * weights; the renderer normalises them so the stack never adds loudness.
 */
export interface HarmonicStack {
  readonly degrees: readonly number[];
  readonly gains: readonly number[];
  /** Cents of spread applied across partials, widening the timbre. */
  readonly detuneCents: number;
}

export interface SfxRecipe {
  readonly id: SfxId;
  readonly bus: MixBus;
  readonly wave: OscWave;
  readonly frequency: FrequencyEnvelope;
  readonly amplitude: AmplitudeEnvelope;
  readonly filter: FilterEnvelope;
  /** Noise bed mixed in parallel with the tone, in [0, 1]. */
  readonly noise: number;
  readonly noiseColour: NoiseColour;
  readonly duration: number;
  /** Whole-voice detune. Positive pushes toward the Detuners' 440 Hz. */
  readonly detuneCents: number;
  /** Amplitude modulation rate in Hz. 0 means none. */
  readonly tremoloHz: number;
  readonly loop: boolean;
  readonly harmonics?: HarmonicStack;
  /**
   * Palette key of this cue's visual twin. Audio never carries a cue alone —
   * the simulation emits a `GameEvents` entry and the renderer draws it in this
   * colour — so the key lives beside the sound to keep the pairing honest.
   */
  readonly cue: PaletteKey;
}

// ---------------------------------------------------------------------------
// Comfort ceilings
// ---------------------------------------------------------------------------

/** No single voice may ask for more than this, leaving mix headroom. */
export const MAX_PEAK_AMPLITUDE = 0.9;

/** Longest a bare sine may be held. Pure tones fatigue fast. */
export const MAX_PURE_TONE_SECONDS = 1.6;

/** At or below this noise level a voice still counts as a pure tone. */
export const PURE_TONE_NOISE_CEILING = 0.06;

/** Fraction of the envelope peak the parallel noise bed may reach. */
export const NOISE_PEAK_RATIO = 0.6;

/** Cents between the World Chord and the Detuners' imposed frequency. */
export const FULL_INFECTION_CENTS = centsBetween(WORLD_CHORD_HZ, DETUNED_HZ);

/**
 * How far a sound is dragged off true, for a given infection level in [0, 1].
 *
 * This is the audio half of the infection number the shader tints with, which
 * is the point: the violet you see and the sourness you hear are one value.
 */
export function detuneCentsForInfection(infection: number): number {
  return clamp01(infection) * FULL_INFECTION_CENTS;
}

/** Just-intonation ratio for a harmonic degree, octaves included. */
export function harmonicRatio(degree: number): number {
  const span = HARMONIC_RATIOS.length;
  const wrapped = ((degree % span) + span) % span;
  const octave = Math.floor(degree / span);
  return (HARMONIC_RATIOS[wrapped] ?? 1) * Math.pow(2, octave);
}

/** The 432 Hz just-intonation grid. */
export function trueHz(degree: number, octave = 0): number {
  return harmonicHz(degree, octave);
}

/** The same ratios rebuilt on 440 Hz — the Detuners' grid. */
export function detunedHarmonicHz(degree: number, octave = 0): number {
  return harmonicHz(degree, octave) * (DETUNED_HZ / WORLD_CHORD_HZ);
}

/** Applies a cents offset to a frequency. */
export function shiftCents(hz: number, cents: number): number {
  return hz * Math.pow(2, cents / 1200);
}

/** Worst-case instantaneous amplitude: the tone plus its parallel noise bed. */
export function recipePeakAmplitude(recipe: SfxRecipe): number {
  return recipe.amplitude.peak * (1 + NOISE_PEAK_RATIO * clamp01(recipe.noise));
}

/** True when the recipe is essentially a bare sine: one partial, no grit. */
export function isPureTone(recipe: SfxRecipe): boolean {
  if (recipe.wave !== 'sine') return false;
  if (recipe.noise > PURE_TONE_NOISE_CEILING) return false;
  const partials = recipe.harmonics?.degrees.length ?? 1;
  return partials <= 1;
}

/** How long the recipe holds a continuous tone. Loops hold forever. */
export function recipeSustainSeconds(recipe: SfxRecipe): number {
  return recipe.loop ? Number.POSITIVE_INFINITY : recipe.duration;
}

/** Seconds spent at the sustain level, after attack/decay and before release. */
export function sustainHoldSeconds(recipe: SfxRecipe): number {
  const { attack, decay, release } = recipe.amplitude;
  return Math.max(0, recipe.duration - attack - decay - release);
}

// ---------------------------------------------------------------------------
// Recipe authoring helpers
// ---------------------------------------------------------------------------

interface RecipeDraft {
  readonly bus?: MixBus;
  readonly wave?: OscWave;
  readonly startHz: number;
  readonly endHz?: number;
  readonly curve?: FrequencyCurve;
  readonly glide?: number;
  readonly peak: number;
  readonly attack?: number;
  readonly decay?: number;
  readonly sustain?: number;
  readonly release?: number;
  readonly filter?: FilterKind;
  readonly filterStartHz?: number;
  readonly filterEndHz?: number;
  readonly q?: number;
  readonly noise?: number;
  readonly noiseColour?: NoiseColour;
  readonly duration: number;
  readonly detuneCents?: number;
  readonly tremoloHz?: number;
  readonly loop?: boolean;
  readonly harmonics?: HarmonicStack;
  readonly cue: PaletteKey;
}

function def(id: SfxId, draft: RecipeDraft): SfxRecipe {
  const endHz = draft.endHz ?? draft.startHz;
  const filter = draft.filter ?? 'lowpass';
  const filterStartHz = draft.filterStartHz ?? Math.max(draft.startHz, endHz) * 4;
  return {
    id,
    bus: draft.bus ?? 'sfx',
    wave: draft.wave ?? 'sine',
    frequency: {
      startHz: draft.startHz,
      endHz,
      curve: draft.curve ?? (endHz === draft.startHz ? 'hold' : 'exponential'),
      glide: draft.glide ?? 1,
    },
    amplitude: {
      peak: draft.peak,
      attack: draft.attack ?? 0.005,
      decay: draft.decay ?? draft.duration * 0.3,
      sustain: draft.sustain ?? 0.35,
      release: draft.release ?? draft.duration * 0.35,
    },
    filter: {
      kind: filter,
      startHz: filterStartHz,
      endHz: draft.filterEndHz ?? filterStartHz,
      q: draft.q ?? 0.9,
    },
    noise: draft.noise ?? 0.02,
    noiseColour: draft.noiseColour ?? 'white',
    duration: draft.duration,
    detuneCents: draft.detuneCents ?? 0,
    tremoloHz: draft.tremoloHz ?? 0,
    loop: draft.loop ?? false,
    ...(draft.harmonics ? { harmonics: draft.harmonics } : {}),
    cue: draft.cue,
  };
}

/** A just chord: root, third, fifth, octave, quietening upward. */
const JUST_CHORD: HarmonicStack = {
  degrees: [0, 2, 4, 7],
  gains: [1, 0.6, 0.45, 0.3],
  detuneCents: 3,
};

/** Two partials a whole tone apart — deliberately unresolved. */
const SOUR_PAIR: HarmonicStack = {
  degrees: [0, 1],
  gains: [1, 0.85],
  detuneCents: 14,
};

const BELL_STACK: HarmonicStack = {
  degrees: [0, 4, 7],
  gains: [1, 0.5, 0.34],
  detuneCents: 2,
};

// ---------------------------------------------------------------------------
// The recipe book
// ---------------------------------------------------------------------------

/**
 * Every {@link SfxId} has an entry — the `Record` type makes that a compile
 * error rather than a silent gap.
 *
 * Player actions ring in just intonation against 432 Hz. Detuner sounds are
 * built on 440 Hz, detuned by {@link FULL_INFECTION_CENTS}, and use harsher
 * waves plus noise, so "infected" is a thing you hear before you read it.
 */
export const SFX_RECIPES: Readonly<Record<SfxId, SfxRecipe>> = Object.freeze({
  // --- Offence, tuned true -------------------------------------------------
  'pulse-fire': def('pulse-fire', {
    wave: 'triangle',
    startHz: trueHz(4, 1),
    endHz: trueHz(0, 1),
    peak: 0.32,
    attack: 0.004,
    decay: 0.035,
    sustain: 0.2,
    release: 0.07,
    duration: 0.13,
    filterStartHz: 5200,
    filterEndHz: 2100,
    noise: 0.03,
    cue: 'resonance',
  }),
  'charge-start': def('charge-start', {
    startHz: trueHz(0, -1),
    endHz: trueHz(0, 0),
    curve: 'exponential',
    peak: 0.2,
    attack: 0.08,
    decay: 0.1,
    sustain: 0.7,
    release: 0.16,
    duration: 0.5,
    filterStartHz: 1400,
    filterEndHz: 2600,
    noise: 0.02,
    cue: 'resonance',
  }),
  'charge-tier': def('charge-tier', {
    wave: 'triangle',
    startHz: trueHz(2, 1),
    peak: 0.28,
    attack: 0.003,
    decay: 0.06,
    sustain: 0.15,
    release: 0.1,
    duration: 0.19,
    harmonics: BELL_STACK,
    filterStartHz: 6200,
    noise: 0.02,
    cue: 'gold',
  }),
  'charge-release': def('charge-release', {
    wave: 'sawtooth',
    startHz: trueHz(2, 1),
    endHz: trueHz(2, 0),
    peak: 0.4,
    attack: 0.004,
    decay: 0.1,
    sustain: 0.3,
    release: 0.24,
    duration: 0.46,
    harmonics: JUST_CHORD,
    filterStartHz: 5400,
    filterEndHz: 900,
    noise: 0.12,
    cue: 'resonance',
  }),
  burst: def('burst', {
    startHz: trueHz(0, 0),
    endHz: trueHz(0, -2),
    peak: 0.42,
    attack: 0.006,
    decay: 0.12,
    sustain: 0.25,
    release: 0.3,
    duration: 0.52,
    filterStartHz: 2400,
    filterEndHz: 300,
    noise: 0.34,
    noiseColour: 'pink',
    cue: 'resonance',
  }),
  'counter-success': def('counter-success', {
    wave: 'triangle',
    startHz: trueHz(4, 1),
    peak: 0.38,
    attack: 0.003,
    decay: 0.09,
    sustain: 0.3,
    release: 0.26,
    duration: 0.42,
    harmonics: JUST_CHORD,
    filterStartHz: 7200,
    noise: 0.03,
    cue: 'gold',
  }),
  'counter-fail': def('counter-fail', {
    wave: 'square',
    startHz: detunedHarmonicHz(1, 0),
    endHz: detunedHarmonicHz(0, -1),
    peak: 0.3,
    attack: 0.004,
    decay: 0.06,
    sustain: 0.2,
    release: 0.12,
    duration: 0.24,
    detuneCents: FULL_INFECTION_CENTS,
    filter: 'bandpass',
    filterStartHz: 900,
    filterEndHz: 420,
    q: 1.6,
    noise: 0.3,
    cue: 'alarm',
  }),

  // --- Impacts -------------------------------------------------------------
  'hit-enemy': def('hit-enemy', {
    wave: 'square',
    startHz: detunedHarmonicHz(3, 1),
    endHz: detunedHarmonicHz(3, 0),
    peak: 0.3,
    attack: 0.002,
    decay: 0.03,
    sustain: 0.15,
    release: 0.06,
    duration: 0.11,
    detuneCents: FULL_INFECTION_CENTS,
    filterStartHz: 4200,
    filterEndHz: 1500,
    noise: 0.26,
    cue: 'infection',
  }),
  'hit-armour': def('hit-armour', {
    wave: 'square',
    startHz: detunedHarmonicHz(6, 1),
    endHz: detunedHarmonicHz(6, 0),
    peak: 0.3,
    attack: 0.002,
    decay: 0.04,
    sustain: 0.1,
    release: 0.09,
    duration: 0.15,
    detuneCents: FULL_INFECTION_CENTS,
    filter: 'bandpass',
    filterStartHz: 2600,
    filterEndHz: 1800,
    q: 3.2,
    noise: 0.4,
    cue: 'infection',
  }),
  'hit-player': def('hit-player', {
    wave: 'sawtooth',
    startHz: detunedHarmonicHz(0, 0),
    endHz: detunedHarmonicHz(0, -2),
    peak: 0.42,
    attack: 0.003,
    decay: 0.08,
    sustain: 0.25,
    release: 0.2,
    duration: 0.36,
    detuneCents: FULL_INFECTION_CENTS,
    filterStartHz: 3200,
    filterEndHz: 520,
    noise: 0.3,
    cue: 'alarm',
  }),
  /**
   * The payoff sound of the whole game in miniature: it starts on the
   * Detuners' grid and glides onto the true one. Freed, not killed.
   */
  'enemy-cleansed': def('enemy-cleansed', {
    wave: 'triangle',
    startHz: detunedHarmonicHz(2, 1),
    endHz: trueHz(2, 1),
    curve: 'exponential',
    glide: 0.7,
    peak: 0.38,
    attack: 0.01,
    decay: 0.14,
    sustain: 0.45,
    release: 0.4,
    duration: 0.72,
    harmonics: BELL_STACK,
    filterStartHz: 6400,
    filterEndHz: 3600,
    noise: 0.05,
    cue: 'restore',
  }),

  // --- Movement ------------------------------------------------------------
  jump: def('jump', {
    startHz: trueHz(0, 0),
    endHz: trueHz(4, 0),
    peak: 0.24,
    attack: 0.004,
    decay: 0.05,
    sustain: 0.25,
    release: 0.08,
    duration: 0.16,
    filterStartHz: 3200,
    noise: 0.03,
    cue: 'resonance',
  }),
  'double-jump': def('double-jump', {
    startHz: trueHz(4, 0),
    endHz: trueHz(0, 1),
    peak: 0.26,
    attack: 0.004,
    decay: 0.05,
    sustain: 0.25,
    release: 0.08,
    duration: 0.16,
    filterStartHz: 4600,
    noise: 0.04,
    cue: 'resonance',
  }),
  dash: def('dash', {
    wave: 'triangle',
    startHz: trueHz(3, 0),
    endHz: trueHz(3, 1),
    peak: 0.3,
    attack: 0.006,
    decay: 0.07,
    sustain: 0.3,
    release: 0.13,
    duration: 0.24,
    filter: 'bandpass',
    filterStartHz: 420,
    filterEndHz: 2700,
    q: 1.1,
    noise: 0.55,
    noiseColour: 'pink',
    cue: 'resonance',
  }),
  land: def('land', {
    startHz: trueHz(0, -2),
    endHz: trueHz(0, -3),
    peak: 0.32,
    attack: 0.003,
    decay: 0.05,
    sustain: 0.2,
    release: 0.1,
    duration: 0.18,
    filterStartHz: 900,
    filterEndHz: 180,
    noise: 0.28,
    noiseColour: 'pink',
    cue: 'ink',
  }),
  'wall-cling': def('wall-cling', {
    wave: 'triangle',
    startHz: trueHz(5, 0),
    peak: 0.2,
    attack: 0.02,
    decay: 0.08,
    sustain: 0.4,
    release: 0.16,
    duration: 0.3,
    filter: 'highpass',
    filterStartHz: 1200,
    filterEndHz: 2400,
    noise: 0.6,
    cue: 'ink',
  }),
  'rail-attach': def('rail-attach', {
    wave: 'triangle',
    startHz: trueHz(5, 1),
    endHz: trueHz(7, 1),
    peak: 0.28,
    attack: 0.003,
    decay: 0.06,
    sustain: 0.3,
    release: 0.1,
    duration: 0.21,
    harmonics: BELL_STACK,
    filterStartHz: 7600,
    noise: 0.05,
    cue: 'resonance',
  }),
  bounce: def('bounce', {
    startHz: trueHz(1, 0),
    endHz: trueHz(5, 0),
    peak: 0.3,
    attack: 0.003,
    decay: 0.05,
    sustain: 0.25,
    release: 0.1,
    duration: 0.19,
    filterStartHz: 3600,
    noise: 0.04,
    cue: 'restore',
  }),

  // --- Rewards -------------------------------------------------------------
  'pickup-shard': def('pickup-shard', {
    wave: 'triangle',
    startHz: trueHz(6, 1),
    peak: 0.26,
    attack: 0.002,
    decay: 0.07,
    sustain: 0.2,
    release: 0.12,
    duration: 0.23,
    harmonics: { degrees: [0, 4], gains: [1, 0.42], detuneCents: 2 },
    filterStartHz: 8200,
    noise: 0.03,
    cue: 'resonance',
  }),
  'pickup-major': def('pickup-major', {
    wave: 'triangle',
    startHz: trueHz(0, 1),
    endHz: trueHz(4, 1),
    curve: 'exponential',
    glide: 0.5,
    peak: 0.34,
    attack: 0.006,
    decay: 0.18,
    sustain: 0.4,
    release: 0.5,
    duration: 0.92,
    harmonics: JUST_CHORD,
    filterStartHz: 7400,
    noise: 0.03,
    cue: 'gold',
  }),
  checkpoint: def('checkpoint', {
    wave: 'triangle',
    startHz: trueHz(0, 0),
    peak: 0.28,
    attack: 0.05,
    decay: 0.25,
    sustain: 0.5,
    release: 0.6,
    duration: 1.1,
    harmonics: BELL_STACK,
    filterStartHz: 4200,
    filterEndHz: 3000,
    noise: 0.02,
    cue: 'restore',
  }),

  // --- Forms ---------------------------------------------------------------
  'form-switch': def('form-switch', {
    wave: 'triangle',
    startHz: trueHz(0, 1),
    endHz: trueHz(4, 1),
    peak: 0.28,
    attack: 0.006,
    decay: 0.08,
    sustain: 0.3,
    release: 0.14,
    duration: 0.28,
    filter: 'bandpass',
    filterStartHz: 1600,
    filterEndHz: 5200,
    q: 1.4,
    noise: 0.05,
    cue: 'gold',
  }),
  'form-acquire': def('form-acquire', {
    wave: 'triangle',
    startHz: trueHz(0, 0),
    endHz: trueHz(0, 1),
    curve: 'exponential',
    glide: 0.65,
    peak: 0.36,
    attack: 0.12,
    decay: 0.3,
    sustain: 0.55,
    release: 0.7,
    duration: 1.45,
    harmonics: JUST_CHORD,
    filterStartHz: 5600,
    filterEndHz: 7800,
    noise: 0.02,
    cue: 'gold',
  }),

  // --- Puzzles -------------------------------------------------------------
  /** The resonator tone. Callers override `hz` with the pillar's own degree. */
  'puzzle-note': def('puzzle-note', {
    startHz: trueHz(0, 0),
    peak: 0.28,
    attack: 0.02,
    decay: 0.12,
    sustain: 0.55,
    release: 0.28,
    duration: 0.62,
    filterStartHz: 2600,
    noise: 0.01,
    cue: 'resonance',
  }),
  'puzzle-solve': def('puzzle-solve', {
    wave: 'triangle',
    startHz: trueHz(0, 0),
    endHz: trueHz(7, 0),
    curve: 'exponential',
    glide: 0.6,
    peak: 0.34,
    attack: 0.04,
    decay: 0.3,
    sustain: 0.5,
    release: 0.6,
    duration: 1.3,
    harmonics: JUST_CHORD,
    filterStartHz: 4800,
    filterEndHz: 6800,
    noise: 0.02,
    cue: 'restore',
  }),
  'puzzle-fail': def('puzzle-fail', {
    wave: 'square',
    startHz: detunedHarmonicHz(0, 0),
    endHz: detunedHarmonicHz(0, -1),
    peak: 0.28,
    attack: 0.006,
    decay: 0.1,
    sustain: 0.3,
    release: 0.2,
    duration: 0.4,
    detuneCents: FULL_INFECTION_CENTS,
    harmonics: SOUR_PAIR,
    filterStartHz: 1600,
    filterEndHz: 700,
    noise: 0.16,
    cue: 'infection',
  }),

  // --- Bosses --------------------------------------------------------------
  'boss-phase': def('boss-phase', {
    wave: 'sawtooth',
    startHz: detunedHarmonicHz(0, -1),
    endHz: detunedHarmonicHz(0, 0),
    curve: 'exponential',
    glide: 0.8,
    peak: 0.44,
    attack: 0.25,
    decay: 0.35,
    sustain: 0.6,
    release: 0.7,
    duration: 1.6,
    detuneCents: FULL_INFECTION_CENTS,
    harmonics: SOUR_PAIR,
    filterStartHz: 1800,
    filterEndHz: 3400,
    noise: 0.2,
    cue: 'infection',
  }),
  /** Paired with the telegraph ring the renderer already draws. */
  'boss-telegraph': def('boss-telegraph', {
    wave: 'square',
    startHz: detunedHarmonicHz(1, 0),
    peak: 0.34,
    attack: 0.02,
    decay: 0.12,
    sustain: 0.6,
    release: 0.2,
    duration: 0.7,
    detuneCents: FULL_INFECTION_CENTS,
    tremoloHz: 9,
    filter: 'bandpass',
    filterStartHz: 1200,
    filterEndHz: 1800,
    q: 2.4,
    noise: 0.14,
    cue: 'alarm',
  }),

  // --- Restoration ---------------------------------------------------------
  /**
   * A region coming back into agreement with itself, heard as one glide from
   * 440 Hz to 432 Hz. Same arithmetic as the score's tuning.
   */
  restoration: def('restoration', {
    wave: 'triangle',
    startHz: DETUNED_HZ,
    endHz: WORLD_CHORD_HZ,
    curve: 'exponential',
    glide: 0.85,
    peak: 0.4,
    attack: 0.3,
    decay: 0.5,
    sustain: 0.7,
    release: 1,
    duration: 2.4,
    harmonics: JUST_CHORD,
    filterStartHz: 3200,
    filterEndHz: 6400,
    noise: 0.03,
    cue: 'restore',
  }),

  // --- Interface -----------------------------------------------------------
  'ui-move': def('ui-move', {
    bus: 'ui',
    wave: 'triangle',
    startHz: trueHz(4, 1),
    peak: 0.16,
    attack: 0.002,
    decay: 0.02,
    sustain: 0.1,
    release: 0.035,
    duration: 0.06,
    filterStartHz: 6400,
    noise: 0.02,
    cue: 'ink',
  }),
  'ui-confirm': def('ui-confirm', {
    bus: 'ui',
    wave: 'triangle',
    startHz: trueHz(4, 1),
    endHz: trueHz(7, 1),
    peak: 0.22,
    attack: 0.003,
    decay: 0.05,
    sustain: 0.25,
    release: 0.09,
    duration: 0.17,
    harmonics: { degrees: [0, 4], gains: [1, 0.4], detuneCents: 1 },
    filterStartHz: 7200,
    noise: 0.02,
    cue: 'gold',
  }),
  'ui-cancel': def('ui-cancel', {
    bus: 'ui',
    wave: 'triangle',
    startHz: trueHz(2, 1),
    endHz: trueHz(0, 0),
    peak: 0.2,
    attack: 0.003,
    decay: 0.05,
    sustain: 0.2,
    release: 0.09,
    duration: 0.17,
    filterStartHz: 2600,
    filterEndHz: 1100,
    noise: 0.03,
    cue: 'inkDim',
  }),

  // --- Ambience ------------------------------------------------------------
  /**
   * Low-Coherence warning. It loops, so it is deliberately *not* a pure tone:
   * a slow tremolo over two detuned partials, which the ear can sit inside.
   * Its visual twin is the Coherence ring desaturating.
   */
  'low-coherence': def('low-coherence', {
    bus: 'ambience',
    wave: 'triangle',
    startHz: detunedHarmonicHz(0, -1),
    peak: 0.22,
    attack: 0.6,
    decay: 0.5,
    sustain: 0.8,
    release: 0.8,
    duration: 2.4,
    detuneCents: FULL_INFECTION_CENTS * 0.75,
    tremoloHz: 1.6,
    loop: true,
    harmonics: SOUR_PAIR,
    filterStartHz: 900,
    filterEndHz: 620,
    noise: 0.1,
    cue: 'alarm',
  }),
});

/** Runtime list of every sound id, derived from the recipe book itself. */
export const SFX_IDS: readonly SfxId[] = Object.freeze(
  Object.keys(SFX_RECIPES) as SfxId[],
) as readonly SfxId[];

export function getSfxRecipe(id: SfxId): SfxRecipe {
  return SFX_RECIPES[id];
}

// ---------------------------------------------------------------------------
// Per-form sound families
// ---------------------------------------------------------------------------

/**
 * Each Resonance Form has its own corner of the spectrum, so the equipped form
 * is audible without looking at the HUD. Pitches are just-intonation degrees of
 * the World Chord; no two families share a pitch, a waveform/filter pairing or
 * a brightness.
 *
 * `degree` is **not** a free choice. `@tuner/game-core` already publishes one
 * canonical pitch per form as `RESONANCE_FORMS[id].tuning.harmonicDegree`, and
 * these values mirror it exactly. Audio cannot import that table — game-core
 * depends on this package, so reading it back would be a cycle — hence the
 * mirror plus {@link FORM_HARMONIC_DEGREES}, which the tests pin so a future
 * divergence fails loudly instead of quietly making a form sound like the wrong
 * note. Only `octave` is ours to pick, and it is what separates the dark forms
 * from the brilliant ones.
 */
export interface FormSoundFamily {
  readonly form: ResonanceFormId;
  /** Harmonic degree of the family's root. */
  readonly degree: number;
  readonly octave: number;
  readonly rootHz: number;
  /** Signed semitone offset from the 432 Hz root. */
  readonly pitchOffsetSemitones: number;
  readonly wave: OscWave;
  readonly filter: FilterKind;
  readonly filterHz: number;
  readonly filterQ: number;
  /** 0 is dark and hollow, 1 is brilliant. */
  readonly brightness: number;
  readonly noise: number;
  /** Timbre note for designers. Never shown to the player. */
  readonly character: string;
}

interface FamilyDraft {
  readonly degree: number;
  readonly octave: number;
  readonly wave: OscWave;
  readonly filter: FilterKind;
  readonly filterHz: number;
  readonly filterQ: number;
  readonly brightness: number;
  readonly noise: number;
  readonly character: string;
}

/**
 * The canonical harmonic degree of every form, mirrored from
 * `RESONANCE_FORMS[id].tuning.harmonicDegree` in `@tuner/game-core`.
 *
 * Exported so the mirror is assertable rather than buried in a table.
 */
export const FORM_HARMONIC_DEGREES: Readonly<Record<ResonanceFormId, number>> = Object.freeze({
  base: 0,
  echo: 4,
  prism: 2,
  tidal: 3,
  ember: 6,
  choir: 5,
  bloom: 1,
  silence: 7,
  celestial: 8,
});

function family(form: ResonanceFormId, draft: FamilyDraft): FormSoundFamily {
  // `harmonicRatio` rather than `trueHz`: `celestial` sits on degree 8 — the
  // octave wrap — and `trueHz` mirrors shared's `harmonicHz`, which folds
  // degree 8 back onto the root without raising the octave. The two agree for
  // every degree below the octave, which is all the recipes use.
  const rootHz = WORLD_CHORD_HZ * harmonicRatio(draft.degree) * Math.pow(2, draft.octave);
  return {
    form,
    degree: draft.degree,
    octave: draft.octave,
    rootHz,
    pitchOffsetSemitones: semitonesBetween(WORLD_CHORD_HZ, rootHz),
    wave: draft.wave,
    filter: draft.filter,
    filterHz: draft.filterHz,
    filterQ: draft.filterQ,
    brightness: draft.brightness,
    noise: draft.noise,
    character: draft.character,
  };
}

export const FORM_SOUND_FAMILIES: Readonly<Record<ResonanceFormId, FormSoundFamily>> = Object.freeze(
  {
    base: family('base', {
      degree: FORM_HARMONIC_DEGREES.base,
      octave: 0,
      wave: 'sine',
      filter: 'lowpass',
      filterHz: 2600,
      filterQ: 0.7,
      brightness: 0.4,
      noise: 0.02,
      character: 'plain, centred, unadorned',
    }),
    echo: family('echo', {
      degree: FORM_HARMONIC_DEGREES.echo,
      octave: 0,
      wave: 'triangle',
      filter: 'lowpass',
      filterHz: 3400,
      filterQ: 1.1,
      brightness: 0.5,
      noise: 0.04,
      character: 'soft repeats, rounded attack',
    }),
    prism: family('prism', {
      degree: FORM_HARMONIC_DEGREES.prism,
      octave: 1,
      wave: 'square',
      filter: 'highpass',
      filterHz: 1500,
      filterQ: 0.8,
      brightness: 0.85,
      noise: 0.03,
      character: 'glassy, splitting, edge-lit',
    }),
    tidal: family('tidal', {
      degree: FORM_HARMONIC_DEGREES.tidal,
      octave: 0,
      wave: 'sine',
      filter: 'bandpass',
      filterHz: 900,
      filterQ: 2.2,
      brightness: 0.3,
      noise: 0.18,
      character: 'liquid, sustaining, undertow',
    }),
    ember: family('ember', {
      degree: FORM_HARMONIC_DEGREES.ember,
      octave: 0,
      wave: 'sawtooth',
      filter: 'lowpass',
      filterHz: 2000,
      filterQ: 1.5,
      brightness: 0.65,
      noise: 0.22,
      character: 'crackling, sudden, forward',
    }),
    choir: family('choir', {
      degree: FORM_HARMONIC_DEGREES.choir,
      octave: 1,
      wave: 'triangle',
      filter: 'bandpass',
      filterHz: 2400,
      filterQ: 1.8,
      brightness: 0.72,
      noise: 0.05,
      character: 'stacked voices, breathy body',
    }),
    bloom: family('bloom', {
      degree: FORM_HARMONIC_DEGREES.bloom,
      octave: 0,
      wave: 'triangle',
      filter: 'notch',
      filterHz: 1200,
      filterQ: 1.2,
      brightness: 0.58,
      noise: 0.09,
      character: 'opening, wide, growing',
    }),
    silence: family('silence', {
      degree: FORM_HARMONIC_DEGREES.silence,
      // Two octaves down, so the canonical degree still lands at 216 Hz — an
      // octave below the World Chord, where "felt more than heard" lives.
      octave: -2,
      wave: 'sine',
      filter: 'lowpass',
      filterHz: 480,
      filterQ: 0.5,
      brightness: 0.06,
      noise: 0.01,
      character: 'subtractive, felt more than heard',
    }),
    celestial: family('celestial', {
      // Degree 8 is the octave wrap, so one octave of lift puts the full chord
      // two octaves above the root — the brightest thing in the game.
      degree: FORM_HARMONIC_DEGREES.celestial,
      octave: 1,
      wave: 'sawtooth',
      filter: 'highpass',
      filterHz: 2800,
      filterQ: 0.6,
      brightness: 1,
      noise: 0.02,
      character: 'the full chord, everything at once',
    }),
  },
);

export function formSoundFamily(ability: ResonanceFormId): FormSoundFamily {
  return FORM_SOUND_FAMILIES[ability];
}

/**
 * Stable identity of a family's timbre. Two families sharing this string would
 * be indistinguishable by ear, which the tests forbid.
 */
export function formSoundSignature(ability: ResonanceFormId): string {
  const f = formSoundFamily(ability);
  return `${f.wave}:${f.filter}:${f.degree}:${f.octave}:${f.brightness.toFixed(2)}`;
}

/**
 * Re-voices a recipe in a form's family: transposed to the family's root,
 * with its waveform, filter character and brightness applied.
 */
export function applyFormToRecipe(recipe: SfxRecipe, ability: ResonanceFormId): SfxRecipe {
  const f = formSoundFamily(ability);
  const ratio = f.rootHz / WORLD_CHORD_HZ;
  const brightnessScale = 0.6 + f.brightness * 0.9;
  const noise = clamp01(Math.max(recipe.noise, f.noise));
  const peak = Math.min(
    recipe.amplitude.peak,
    MAX_PEAK_AMPLITUDE / (1 + NOISE_PEAK_RATIO * noise),
  );
  return {
    ...recipe,
    wave: f.wave,
    frequency: {
      ...recipe.frequency,
      startHz: recipe.frequency.startHz * ratio,
      endHz: recipe.frequency.endHz * ratio,
    },
    amplitude: { ...recipe.amplitude, peak },
    filter: {
      kind: f.filter === 'none' ? recipe.filter.kind : f.filter,
      startHz: recipe.filter.startHz * brightnessScale,
      endHz: recipe.filter.endHz * brightnessScale,
      q: f.filterQ,
    },
    noise,
  };
}
