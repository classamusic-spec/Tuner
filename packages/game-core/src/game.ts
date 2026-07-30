import type { DifficultyId, EventBus, ResonanceFormId, StageId } from '@tuner/shared';
import type { PhysicsWorld } from '@tuner/physics';
import type { InputFrame } from '@tuner/input';
import type { GameEvents } from './events.js';
import type { StageResult, WorldState } from './state.js';
import type { AccessibilityConfig, CameraConfig, CombatConfig, MovementConfig } from './config.js';
import type { ContentBundle, StageDef } from './content-types.js';
import type { AdventureState } from './adventure-types.js';
import type { NpcView } from './systems/adventure.js';

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
  /**
   * Optional millisecond clock, supplied by the host purely so the debug
   * overlay can report step cost. The simulation never reads wall-clock time
   * itself — behaviour must depend only on the fixed step — so leaving this
   * out simply means `stats.lastStepMs` stays zero.
   */
  readonly clock?: () => number;
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

  /**
   * Enters a temple interior, keyed by `TempleDef.id`.
   *
   * Not a `StageId`: that union enumerates the ten regions, and a temple is a
   * room inside one rather than a region of its own. The region's adventure
   * state — quests, codex, motifs, conversations already had — survives the
   * transition, because the player has not left the region by going indoors.
   */
  loadTemple(templeId: string, options?: { checkpointId?: string }): void;

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

  /**
   * Ends the running cutscene. Returns false when nothing was playing, or when
   * the scene is explicitly marked unskippable. Every scene in the shipped
   * content is skippable — a player on a second run must never be held in a
   * scene they have already watched.
   */
  skipCutscene(): boolean;

  /**
   * The adventure slice: the running conversation, quest progress, objectives,
   * discovered markers, unlocked codex entries, collected motifs and the NPC
   * within reach.
   *
   * Recomputed at most once per simulation step and cached, so the renderer may
   * read it every frame and the HUD as often as it likes.
   */
  readonly adventure: AdventureState;

  /** The region's people, as the renderer needs them. Cached like `adventure`. */
  readonly npcs: readonly NpcView[];

  /**
   * Ends the running conversation. Returns false when nobody was talking.
   *
   * Unlike a cutscene a conversation can always be skipped, so this never
   * refuses on content grounds.
   */
  skipDialogue(): boolean;

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
