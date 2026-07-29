/**
 * Re-exported vocabulary and defaults.
 *
 * Kept in its own module so the save schema does not have to import from
 * `@tuner/audio` — persistence should not depend on an audio engine just to know
 * what a level slider's default is.
 */

export type {
  DifficultyId,
  GraphicsTier,
  Rank,
  ResonanceFormId,
  StageId,
} from '@tuner/shared';

/** Mirrors `DEFAULT_AUDIO_LEVELS` in `@tuner/audio`, as plain data. */
export const DEFAULT_AUDIO_LEVELS_SNAPSHOT: Readonly<Record<string, number>> = Object.freeze({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  ui: 0.7,
  voice: 0.9,
  ambience: 0.5,
});
