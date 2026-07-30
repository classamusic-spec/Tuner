import type { ContentBundle } from '@tuner/game-core';
import { FALLEN_SANCTUARY } from './stages/fallen-sanctuary.js';
import { FRACTURED_GARDEN } from './stages/fractured-garden.js';
import { ENEMY_ARCHETYPES } from './enemies.js';
import { BOSSES } from './bosses.js';
import { FRACTURED_GARDEN_ZONE } from './zones/fractured-garden-zone.js';
import {
  TEMPLE_OF_THE_FIRST_BREATH,
  TEMPLE_OF_THE_FIRST_BREATH_STAGE,
} from './temples/temple-of-the-first-breath.js';

/**
 * `@tuner/game-content` — the game, as data.
 *
 * Nothing in this package executes gameplay. It exports objects matching the
 * authoring types in `@tuner/game-core`, and `game-core` instantiates them:
 * one source of truth for the collision the player feels, the geometry the
 * renderer draws, the cues the audio engine plays and the text the HUD shows.
 *
 * Four things live here:
 *
 * - **Regions** (`./stages/*`) — `StageDef` objects: geometry, hazards,
 *   spawns, puzzles, checkpoints, cutscenes, tutorials.
 * - **Population** (`./enemies.js`, `./bosses.js`) — the Detuner bestiary and
 *   the Commander fights.
 * - **The World Lattice** (`./lattice.js`) — the stage-select map and the
 *   progression rule, which is deliberately the only place that rule exists.
 * - **The story and the hub** (`./narrative.js`, `./sanctuary.js`) — premise,
 *   characters, per-region beats, collectible history and playable motifs, plus
 *   the Harmonic Sanctuary that all of it is carried back to.
 */

export * from './lattice.js';
export * from './narrative.js';
export * from './sanctuary.js';
export * from './enemies.js';
export * from './bosses.js';
export * from './stages/fallen-sanctuary.js';
export * from './stages/fractured-garden.js';
export * from './zones/fractured-garden-zone.js';
export * from './temples/temple-of-the-first-breath.js';

/**
 * Everything the runtime needs to build a session.
 *
 * `stages` is a partial record by design: `StageId` enumerates all ten regions,
 * and the bundle carries whichever of them are authored. A region that is not
 * present is not selectable — the lattice reads this map, so a half-built
 * content set degrades into a shorter game rather than a crash.
 */
export const CONTENT: ContentBundle = {
  stages: {
    'fallen-sanctuary': FALLEN_SANCTUARY,
    'fractured-garden': FRACTURED_GARDEN,
  },
  enemies: ENEMY_ARCHETYPES,
  bosses: BOSSES,
  zones: {
    'fractured-garden': FRACTURED_GARDEN_ZONE,
  },
  templeStages: {
    [TEMPLE_OF_THE_FIRST_BREATH.id]: TEMPLE_OF_THE_FIRST_BREATH_STAGE,
  },
};
