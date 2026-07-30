/**
 * `@tuner/rendering` — the Three.js / React Three Fiber presentation layer.
 *
 * Everything here is pure presentation: components read the simulation's
 * read-only `WorldState` and paint it. Nothing in this package advances the
 * simulation or writes back into it.
 *
 * Two rules hold throughout:
 *
 * 1. **Drawn geometry is built from the same `StageDef` the physics uses**, so
 *    the surface a player can see and the collider they hit cannot disagree.
 *    Invisible walls become impossible by construction rather than by care.
 * 2. **Simulation state never becomes React state.** Per-frame changes are
 *    driven inside `useFrame` by mutating Three.js objects directly — a game
 *    that re-renders React sixty times a second spends its budget on
 *    reconciliation rather than on the game.
 */

export * from './materials.js';
export * from './sky.js';
export * from './lighting.js';
export * from './stage-geometry.js';
export * from './character/animation.js';
export { TunerCharacter, type TunerCharacterProps } from './character/tuner.js';
export { Auralith, type AuralithProps } from './character/auralith.js';
export * from './character/villager-appearance.js';
export { Villager, type VillagerProps } from './character/villager.js';
export * from './vfx/index.js';
export {
  BossModel,
  DetunerCreature,
  type BossModelProps,
  type DetunerCreatureProps,
} from './creatures/detuners.js';
export { TunerScene, type TunerSceneProps } from './scene.js';
