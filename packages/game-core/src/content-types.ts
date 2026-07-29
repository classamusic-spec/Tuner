import type {
  CollectibleKind,
  DamageKind,
  EnemyRole,
  ResonanceFormId,
  StageId,
  Vec3,
} from '@tuner/shared';
import type { ColliderShape, LayerMask } from '@tuner/physics';

/**
 * The stage authoring format.
 *
 * Stages are data, not code. `@tuner/game-content` exports objects matching
 * these types; `@tuner/game-core` instantiates them; `@tuner/rendering` reads
 * the same data to build the visual scene. One source of truth means the
 * collision the player feels always matches the geometry they see.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Visual treatment applied to a piece of level geometry. */
export type SurfaceStyle =
  | 'stone'
  | 'stone-carved'
  | 'root'
  | 'crystal'
  | 'glass'
  | 'metal'
  | 'water'
  | 'sand'
  | 'ember'
  | 'infected'
  | 'restored'
  | 'gold-trim'
  | 'invisible';

export interface GeometryDef {
  readonly id: string;
  readonly shape: ColliderShape;
  readonly position: Vec3;
  readonly yaw?: number;
  readonly layer?: LayerMask;
  readonly style?: SurfaceStyle;
  readonly friction?: number;
  readonly bounce?: number;
  /** Hidden until the player uses Resonance Sight or a specific form. */
  readonly revealedBy?: ResonanceFormId;
  /** Removed from the world once this restoration flag is set. */
  readonly hiddenWhenRestored?: boolean;
  /** Only present after restoration — the regrown bridges and reconnected roots. */
  readonly onlyWhenRestored?: boolean;
}

export type PlatformMotion =
  | { readonly kind: 'linear'; readonly to: Vec3; readonly seconds: number; readonly pause?: number }
  | { readonly kind: 'orbit'; readonly centre: Vec3; readonly radius: number; readonly seconds: number }
  | { readonly kind: 'vertical'; readonly amplitude: number; readonly seconds: number }
  /** Advances one step each time the region's beat lands. */
  | { readonly kind: 'rhythm'; readonly to: Vec3; readonly beats: number }
  /** Falls away shortly after the player stands on it. */
  | { readonly kind: 'collapse'; readonly delaySeconds: number; readonly respawnSeconds: number };

export interface MovingPlatformDef extends GeometryDef {
  readonly motion: PlatformMotion;
  /** Phase offset in [0, 1] so a row of platforms can be staggered. */
  readonly phase?: number;
}

/** A grindable resonance line. */
export interface RailDef {
  readonly id: string;
  /** Ordered control points; the runtime walks the polyline. */
  readonly points: readonly Vec3[];
  /** Metres per second while grinding. */
  readonly speed?: number;
  /** Grinding this rail requires the given form. */
  readonly requiresForm?: ResonanceFormId;
  readonly style?: SurfaceStyle;
}

export interface HazardDef {
  readonly id: string;
  readonly shape: ColliderShape;
  readonly position: Vec3;
  readonly damage: number;
  readonly damageKind: DamageKind;
  /** Hazards that pulse on the region's beat. */
  readonly rhythm?: { readonly beats: number; readonly activeBeats: number; readonly offset?: number };
  /** Cleared permanently by the given form — Tidal quenches lava, Ember burns growth. */
  readonly clearedBy?: ResonanceFormId;
  readonly style?: SurfaceStyle;
  /** Instead of damaging, teleports the player to the last checkpoint. */
  readonly isPit?: boolean;
}

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

export interface EnemySpawnDef {
  readonly id: string;
  /** Key into the enemy archetype table. */
  readonly archetype: string;
  readonly position: Vec3;
  readonly yaw?: number;
  /** Patrol route for ground and flying units. */
  readonly patrol?: readonly Vec3[];
  /** Spawns only once the player crosses this trigger. */
  readonly triggerId?: string;
  /** Present only at or above this difficulty. */
  readonly minDifficulty?: 'story' | 'explorer' | 'standard' | 'resonance-master';
  /** Guards a secret; cleansing it opens something. */
  readonly guardsSecret?: string;
}

export interface PickupDef {
  readonly id: string;
  readonly kind: CollectibleKind | 'coherence';
  readonly position: Vec3;
  readonly amount?: number;
  /** Reachable only with this form — the basis of stage revisits. */
  readonly requiresForm?: ResonanceFormId;
  /** Counts toward the stage's secret total. */
  readonly isSecret?: boolean;
}

// ---------------------------------------------------------------------------
// Interactive mechanisms
// ---------------------------------------------------------------------------

/** A resonator that responds to a specific harmonic degree. */
export interface ResonatorDef {
  readonly id: string;
  readonly position: Vec3;
  /** Index into `HARMONIC_RATIOS`. */
  readonly degree: number;
  /** Grouping key; a puzzle is solved when its whole group is satisfied. */
  readonly puzzleId: string;
  /** Ordering within the puzzle, when the sequence matters. */
  readonly order?: number;
  /** Seconds a struck resonator stays lit — Echo Form exists to beat this. */
  readonly holdSeconds?: number;
  readonly requiresForm?: ResonanceFormId;
}

export interface PuzzleDef {
  readonly id: string;
  readonly kind: 'sequence' | 'simultaneous' | 'echo' | 'sustain';
  readonly resonatorIds: readonly string[];
  /** What solving it does. */
  readonly reward:
    | { readonly kind: 'openDoor'; readonly doorId: string }
    | { readonly kind: 'spawnPlatforms'; readonly platformIds: readonly string[] }
    | { readonly kind: 'revealSecret'; readonly contentId: string }
    | { readonly kind: 'setFlag'; readonly flag: string };
  /** Shown as a subtitle and as an on-screen diagram — never audio alone. */
  readonly hint: string;
}

export interface DoorDef {
  readonly id: string;
  readonly position: Vec3;
  readonly shape: ColliderShape;
  readonly yaw?: number;
  readonly openedByFlag?: string;
  readonly style?: SurfaceStyle;
}

export interface TriggerDef {
  readonly id: string;
  readonly position: Vec3;
  readonly shape: ColliderShape;
  readonly once?: boolean;
  readonly action:
    | { readonly kind: 'spawnWave'; readonly spawnIds: readonly string[] }
    | { readonly kind: 'objective'; readonly text: string }
    | { readonly kind: 'cutscene'; readonly cutsceneId: string }
    | { readonly kind: 'phase'; readonly phase: 'miniboss' | 'commander' | 'restoration' }
    | { readonly kind: 'vista'; readonly look: Vec3; readonly seconds: number }
    | { readonly kind: 'tutorial'; readonly tutorialId: string }
    | { readonly kind: 'setFlag'; readonly flag: string };
}

export interface CheckpointDef {
  readonly id: string;
  readonly position: Vec3;
  readonly order: number;
  /** Faces the player this way on respawn. */
  readonly yaw?: number;
}

// ---------------------------------------------------------------------------
// Enemies and bosses
// ---------------------------------------------------------------------------

export interface EnemyArchetypeDef {
  readonly id: string;
  readonly displayName: string;
  readonly role: EnemyRole;
  readonly health: number;
  readonly armour?: number;
  readonly armourBreakers?: readonly DamageKind[];
  readonly contactDamage: number;
  readonly moveSpeed: number;
  readonly turnSpeed: number;
  /** Distance at which the enemy notices the player. */
  readonly aggroRadius: number;
  readonly attackRadius: number;
  /** Seconds of wind-up before the attack lands. Always visualised. */
  readonly telegraphSeconds: number;
  readonly attackCooldown: number;
  readonly projectile?: {
    readonly speed: number;
    readonly damage: number;
    readonly radius: number;
    readonly count?: number;
    readonly spreadRadians?: number;
    /** Can be reflected by a well-timed Resonance Counter. */
    readonly counterable?: boolean;
  };
  /** Spawner archetypes emit these. */
  readonly spawns?: { readonly archetype: string; readonly interval: number; readonly max: number };
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  readonly flying?: boolean;
  /** Cleansing rather than destroying: infected wildlife is restored, not killed. */
  readonly cleansable?: boolean;
  readonly signalSampleId?: string;
}

export interface BossAttackDef {
  readonly id: string;
  readonly displayName: string;
  readonly telegraphSeconds: number;
  readonly durationSeconds: number;
  readonly recoverySeconds: number;
  /** Phases in which this attack can be selected. */
  readonly phases: readonly number[];
  /** Weight for random selection within a phase. */
  readonly weight?: number;
  /** Leaves the boss open to damage during recovery. */
  readonly opensVulnerability?: boolean;
  /** Only used on Standard and above. */
  readonly advancedOnly?: boolean;
}

export interface BossPhaseDef {
  readonly index: number;
  readonly name: string;
  /** Phase begins when health drops to this fraction. */
  readonly healthThreshold: number;
  /** Arena changes triggered on entry. */
  readonly arenaFlags?: readonly string[];
  readonly attackIds: readonly string[];
  /** Seconds between attacks, before the difficulty scale. */
  readonly attackInterval: number;
}

export interface BossDef {
  readonly id: string;
  readonly displayName: string;
  readonly title: string;
  readonly stageId: StageId;
  readonly isMiniBoss?: boolean;
  readonly health: number;
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  readonly arenaCentre: Vec3;
  readonly arenaRadius: number;
  readonly phases: readonly BossPhaseDef[];
  readonly attacks: readonly BossAttackDef[];
  /**
   * Forms that are especially effective. Advantage, never a gate: the base
   * Auralith can win every fight, and different forms open different tactics.
   */
  readonly formAdvantages: Readonly<Partial<Record<ResonanceFormId, number>>>;
  /** Awarded on defeat. Mini-bosses award nothing. */
  readonly awardsForm?: ResonanceFormId;
  /** The closing retuning sequence: harmonic degrees to play back, in order. */
  readonly restorationSequence?: readonly number[];
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

export interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
  readonly seconds?: number;
  /** Portrait/emote key for the renderer. */
  readonly emote?: string;
}

export interface CutsceneDef {
  readonly id: string;
  readonly lines: readonly DialogueLine[];
  /** Camera framing during the scene. */
  readonly cameraFocus?: Vec3;
  readonly cameraDistance?: number;
  /** Player keeps control during ambient scenes. */
  readonly playerControlled?: boolean;
  readonly skippable?: boolean;
}

export interface TutorialDef {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Actions to display as prompts, resolved per input device. */
  readonly actions: readonly string[];
  /** Dismissed once the player performs this action. */
  readonly completesOn?: string;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface StageDef {
  readonly id: StageId;
  readonly displayName: string;
  readonly subtitle: string;
  readonly description: string;
  /** Starting infection, in [0, 1]. */
  readonly infection: number;
  /** Beats per minute of the region's rhythm; hazards and platforms follow it. */
  readonly bpm: number;
  readonly spawnPoint: Vec3;
  readonly spawnYaw?: number;
  /** Y below which the player is considered to have fallen out of the world. */
  readonly killPlaneY: number;
  /** Palette keys and fog for the renderer. */
  readonly ambience: {
    readonly skyTop: string;
    readonly skyBottom: string;
    readonly fogColour: string;
    readonly fogNear: number;
    readonly fogFar: number;
    readonly sunColour: string;
    readonly sunDirection: Vec3;
    readonly ambientColour: string;
    /** Alternate palette applied once the region is restored. */
    readonly restored?: {
      readonly skyTop: string;
      readonly skyBottom: string;
      readonly fogColour: string;
      readonly sunColour: string;
      readonly ambientColour: string;
    };
  };
  readonly geometry: readonly GeometryDef[];
  readonly movingPlatforms: readonly MovingPlatformDef[];
  readonly rails: readonly RailDef[];
  readonly hazards: readonly HazardDef[];
  readonly enemies: readonly EnemySpawnDef[];
  readonly pickups: readonly PickupDef[];
  readonly resonators: readonly ResonatorDef[];
  readonly puzzles: readonly PuzzleDef[];
  readonly doors: readonly DoorDef[];
  readonly triggers: readonly TriggerDef[];
  readonly checkpoints: readonly CheckpointDef[];
  readonly cutscenes: readonly CutsceneDef[];
  readonly tutorials: readonly TutorialDef[];
  readonly miniBossId?: string;
  readonly commanderId?: string;
  /** Target completion time in seconds, used to grade the results screen. */
  readonly parSeconds: number;
  readonly secretTotal: number;
  /** Decorative, non-colliding props. Rendering only. */
  readonly props?: readonly {
    readonly id: string;
    readonly kind: string;
    readonly position: Vec3;
    readonly yaw?: number;
    readonly scale?: number;
  }[];
}

/** The whole content bundle `@tuner/game-content` exports. */
export interface ContentBundle {
  readonly stages: Readonly<Partial<Record<StageId, StageDef>>>;
  readonly enemies: Readonly<Record<string, EnemyArchetypeDef>>;
  readonly bosses: Readonly<Record<string, BossDef>>;
}
