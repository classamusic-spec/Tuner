import type { DifficultyId, EventBus, ResonanceFormId, StageId } from '@tuner/shared';
import type { PhysicsWorld } from '@tuner/physics';
import type { InputFrame } from '@tuner/input';
import type { GameEvents } from './events.js';
import type { StageResult, WorldState } from './state.js';
import type { AccessibilityConfig, CameraConfig, CombatConfig, MovementConfig } from './config.js';
import type { ContentBundle, StageDef } from './content-types.js';

/**
 * The simulation facade.
 *
 * Hosts (web, mobile, desktop, tests) create one `GameCore`, feed it input at a
 * fixed rate and read `state` to draw. That is the whole surface — anything a
 * host needs beyond this belongs behind an event, not a new method.
 */

export interface GameCoreConfig {
  readonly content: ContentBundle;
  readonly physics: PhysicsWorld;
  readonly events: EventBus<GameEvents>;
  readonly difficulty?: DifficultyId;
  readonly movement?: Partial<MovementConfig>;
  readonly combat?: Partial<CombatConfig>;
  readonly camera?: Partial<CameraConfig>;
  readonly accessibility?: Partial<AccessibilityConfig>;
  /** Seeds every deterministic stream in the simulation. */
  readonly seed?: number | string;
  /** Forms the player already owns — set when loading a save. */
  readonly unlockedForms?: readonly ResonanceFormId[];
  readonly maxCoherenceBonus?: number;
}

/** Snapshot of the previous step, so rendering can interpolate. */
export interface InterpolationSource {
  readonly previous: WorldState;
  readonly current: WorldState;
  /** Blend factor in [0, 1). */
  readonly alpha: number;
}

export interface GameCore {
  /** Loads a stage and places the player at its spawn or a given checkpoint. */
  loadStage(stageId: StageId, options?: { checkpointId?: string }): void;
  unloadStage(): void;

  /** Advances exactly one fixed step. Never call with a variable delta. */
  step(fixedDelta: number, input: InputFrame): void;

  readonly state: WorldState;
  readonly previousState: WorldState;
  readonly stageDef: StageDef | null;

  setPaused(paused: boolean): void;
  setDifficulty(difficulty: DifficultyId): void;
  setAccessibility(config: Partial<AccessibilityConfig>): void;
  setMovementConfig(config: Partial<MovementConfig>): void;
  setCombatConfig(config: Partial<CombatConfig>): void;

  /** Live tuning read back by the debug overlay. */
  readonly movementConfig: Readonly<MovementConfig>;
  readonly combatConfig: Readonly<CombatConfig>;
  readonly cameraConfig: Readonly<CameraConfig>;
  readonly accessibilityConfig: Readonly<AccessibilityConfig>;

  equipForm(form: ResonanceFormId): boolean;
  unlockForm(form: ResonanceFormId): void;

  /** Sends the player back to the active checkpoint. */
  respawn(): void;

  /** Computes the results for the stage as it currently stands. */
  computeResult(): StageResult | null;

  /** Per-step timing, surfaced by the performance overlay. */
  readonly stats: {
    readonly lastStepMs: number;
    readonly entityCount: number;
    readonly projectileCount: number;
    readonly colliderCount: number;
  };

  dispose(): void;
}
