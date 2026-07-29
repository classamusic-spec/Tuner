/**
 * Constants that describe the world's tuning.
 *
 * These are not decoration: `WORLD_CHORD_HZ` and `DETUNED_HZ` drive audio
 * synthesis, the infection shader tint, HUD readouts and the restoration
 * scoring, so they live in one place shared by every package.
 */

/** The natural rhythm of the universe, and the target of every restoration. */
export const WORLD_CHORD_HZ = 432;

/** The artificial frequency the Detuners force onto infected regions. */
export const DETUNED_HZ = 440;

/** Fixed simulation rate. Rendering interpolates between these steps. */
export const SIM_HZ = 60;
export const SIM_STEP_SECONDS = 1 / SIM_HZ;

/**
 * Largest wall-clock slice a single frame may consume. Beyond this the loop
 * drops time rather than spiralling: a backgrounded tab must not resume by
 * simulating thirty seconds at once.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** Downward acceleration in metres per second squared. */
export const GRAVITY = -32;

/** Just-intonation ratios of the World Chord, used for form and puzzle tones. */
export const HARMONIC_RATIOS = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8, 2] as const;

/** Solfège-style names shown by the accessibility pitch visualiser. */
export const HARMONIC_DEGREE_NAMES = [
  'Root',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Octave',
] as const;

/** Frequency of a harmonic degree relative to the World Chord. */
export function harmonicHz(degree: number, octave = 0): number {
  const index = ((degree % HARMONIC_RATIOS.length) + HARMONIC_RATIOS.length) % HARMONIC_RATIOS.length;
  const ratio = HARMONIC_RATIOS[index] ?? 1;
  return WORLD_CHORD_HZ * ratio * Math.pow(2, octave);
}

/** Canonical palette. UI, VFX and world art all sample from these. */
export const PALETTE = {
  /** Deep navy panel ground used across the interface. */
  abyss: '#0b1030',
  panel: '#131a44',
  panelRaised: '#1c2559',
  /** Gold outlines and sacred geometry. */
  gold: '#f5c451',
  goldDim: '#a8823a',
  /** Cyan — natural, healthy 432 Hz resonance. */
  resonance: '#4fe3ff',
  resonanceDeep: '#1d8fb8',
  /** Violet — the 440 Hz infection. */
  infection: '#8b4fd6',
  infectionDeep: '#4a1f7a',
  /** Green — restoration and returning life. */
  restore: '#5ce89b',
  restoreDeep: '#248f5a',
  /** Warm accent for damage and urgency. */
  alarm: '#ff6b5c',
  ink: '#f2f5ff',
  inkDim: '#9aa4d4',
} as const;

export type PaletteKey = keyof typeof PALETTE;
