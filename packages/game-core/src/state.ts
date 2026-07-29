import type {
  CollectibleKind,
  DamageKind,
  DifficultyId,
  EnemyRole,
  EntityId,
  Rank,
  ResonanceFormId,
  StageId,
  Vec3,
} from '@tuner/shared';

/**
 * The shape of the simulated world.
 *
 * Everything the renderer, HUD and audio mixer need to draw a frame is
 * reachable from `WorldState`. Nothing here references Three.js, React or the
 * DOM — the renderer reads this state, it does not own it.
 */

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/** The movement state machine. Animation follows this; it never drives it. */
export type MovementState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'doubleJump'
  | 'fall'
  | 'dash'
  | 'airDash'
  | 'slide'
  | 'wallCling'
  | 'wallJump'
  | 'ledgeGrab'
  | 'mantle'
  | 'grind'
  | 'bounce'
  | 'swim'
  | 'hurt'
  | 'downed'
  | 'cutscene';

export interface ChargeState {
  /** Seconds the fire input has been held. */
  readonly heldSeconds: number;
  /** Discrete tier reached: 0 = none, 1..3 = charge levels. */
  readonly tier: number;
  /** Progress toward the next tier, in [0, 1]. Drives the HUD ring. */
  readonly tierProgress: number;
  readonly isCharging: boolean;
}

export interface CounterState {
  /** True while the reflect window is open. */
  readonly active: boolean;
  /** Seconds remaining in the active window. */
  readonly windowRemaining: number;
  /** Seconds until the counter can be used again. */
  readonly cooldownRemaining: number;
  /** Successful counters this stage — feeds the results screen. */
  readonly successCount: number;
  readonly attemptCount: number;
}

export interface PlayerState {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Facing direction as a yaw angle in radians. */
  readonly yaw: number;
  readonly movementState: MovementState;
  /** Seconds spent in the current movement state. */
  readonly stateTime: number;

  readonly grounded: boolean;
  readonly groundNormal: Vec3;
  /** Remaining grace period during which a jump still counts as grounded. */
  readonly coyoteRemaining: number;
  /** Buffered jump press waiting for a valid moment to fire. */
  readonly jumpBufferRemaining: number;
  readonly jumpsRemaining: number;
  readonly dashesRemaining: number;
  readonly dashCooldown: number;

  readonly coherence: number;
  readonly maxCoherence: number;
  /** Post-hit mercy window, in seconds. */
  readonly invulnerableRemaining: number;

  readonly form: ResonanceFormId;
  readonly unlockedForms: readonly ResonanceFormId[];
  readonly charge: ChargeState;
  readonly counter: CounterState;
  readonly lockedTarget: EntityId | null;
  /** Resonance Sight highlights hidden geometry and enemy weak points. */
  readonly resonanceSightActive: boolean;

  /** Wall the player is clinging to, if any. */
  readonly wallNormal: Vec3 | null;
  /** Rail currently being ground, if any. */
  readonly railId: string | null;
  /** Progress along the current rail, in [0, 1]. */
  readonly railProgress: number;
  /** True while submerged. */
  readonly inWater: boolean;
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export type EnemyPhase = 'idle' | 'alert' | 'attack' | 'recover' | 'stagger' | 'cleansing' | 'dead';

export interface EnemyState {
  readonly id: EntityId;
  /** Archetype key from `@tuner/game-content`. */
  readonly archetype: string;
  readonly role: EnemyRole;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly phase: EnemyPhase;
  readonly phaseTime: number;
  /** Armour that only yields to specific damage channels. */
  readonly armour: number;
  readonly armourBreakers: readonly DamageKind[];
  /** True when the enemy is telegraphing an attack — always paired with a
   *  visual tell so the fight reads with sound off. */
  readonly telegraphing: boolean;
  readonly telegraphProgress: number;
  readonly targetId: EntityId | null;
  /** Set when a Frequency Mimic has copied the player's form. */
  readonly mimickedForm: ResonanceFormId | null;
  readonly rootedRemaining: number;
  readonly silencedRemaining: number;
  readonly spawnerId: EntityId | null;
}

// ---------------------------------------------------------------------------
// Boss
// ---------------------------------------------------------------------------

export interface BossPhaseState {
  readonly index: number;
  readonly name: string;
  /** Health fraction at which this phase begins. */
  readonly healthThreshold: number;
}

export interface BossState {
  readonly id: EntityId;
  /** Boss definition key from `@tuner/game-content`. */
  readonly definitionId: string;
  readonly displayName: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly phase: BossPhaseState;
  /** Identifier of the attack currently running, for renderer and audio. */
  readonly currentAttack: string | null;
  readonly attackTime: number;
  readonly telegraphing: boolean;
  readonly telegraphProgress: number;
  /** Open window during which the boss takes bonus damage. */
  readonly vulnerable: boolean;
  /** True during the final musical retuning sequence. */
  readonly restoring: boolean;
  /** Retuning progress, in [0, 1]. */
  readonly restorationProgress: number;
  readonly defeated: boolean;
}

// ---------------------------------------------------------------------------
// Projectiles, pickups, hazards
// ---------------------------------------------------------------------------

export type ProjectileOwner = 'player' | 'enemy';

export interface ProjectileState {
  readonly id: EntityId;
  readonly owner: ProjectileOwner;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
  readonly damage: number;
  readonly damageKind: DamageKind;
  readonly form: ResonanceFormId;
  /** Charge tier that produced this shot, 0 for an uncharged pulse. */
  readonly tier: number;
  readonly lifeRemaining: number;
  /** Echo Form shots repeat; this counts remaining repeats. */
  readonly echoesRemaining: number;
  /** Prism Form shots bounce; this counts remaining bounces. */
  readonly bouncesRemaining: number;
  /** Set once the projectile has been reflected back at its sender. */
  readonly reflected: boolean;
  /** Frequency in Hz, used by puzzle resonators and by audio. */
  readonly hz: number;
}

export interface PickupState {
  readonly id: EntityId;
  readonly kind: CollectibleKind | 'coherence';
  /** Stable content id, so collected items stay collected across reloads. */
  readonly contentId: string;
  readonly position: Vec3;
  readonly amount: number;
  readonly collected: boolean;
}

/** Temporary geometry the player creates: echo platforms, bloom vines, prisms. */
export interface ConjuredPlatformState {
  readonly id: EntityId;
  readonly form: ResonanceFormId;
  readonly position: Vec3;
  readonly radius: number;
  readonly lifeRemaining: number;
  readonly maxLife: number;
}

// ---------------------------------------------------------------------------
// Stage runtime
// ---------------------------------------------------------------------------

export type StagePhase =
  | 'loading'
  | 'intro'
  | 'exploration'
  | 'miniboss'
  | 'commander'
  | 'restoration'
  | 'results'
  | 'failed';

export interface CheckpointState {
  readonly id: string;
  readonly position: Vec3;
  readonly activated: boolean;
  readonly order: number;
}

/** Live scoring inputs for the results screen. */
export interface StageMetrics {
  readonly elapsedSeconds: number;
  readonly damageTaken: number;
  readonly deaths: number;
  readonly enemiesCleansed: number;
  readonly secretsFound: number;
  readonly secretsTotal: number;
  readonly countersLanded: number;
  readonly countersAttempted: number;
  readonly formsUsed: readonly ResonanceFormId[];
  /** Fraction of time spent above the "flowing" speed threshold, in [0, 1]. */
  readonly flowRatio: number;
  readonly lowestCoherence: number;
}

export interface StageRuntimeState {
  readonly stageId: StageId;
  readonly phase: StagePhase;
  /** How detuned the region is, in [0, 1]. Drives shaders, audio and HUD. */
  readonly infection: number;
  readonly checkpoints: readonly CheckpointState[];
  readonly activeCheckpointId: string | null;
  readonly metrics: StageMetrics;
  /** Objective text shown in the HUD; always mirrored as a subtitle. */
  readonly objective: string;
  /** Content ids of secrets found this run. */
  readonly foundSecrets: readonly string[];
}

// ---------------------------------------------------------------------------
// Camera intent
// ---------------------------------------------------------------------------

/**
 * The simulation decides *what* the camera should be looking at; the renderer
 * decides how to draw it. Keeping intent in core is what lets boss arenas and
 * discovery shots be authored as stage data rather than renderer special-cases.
 */
export interface CameraIntent {
  readonly mode: 'follow' | 'lockOn' | 'boss' | 'cinematic' | 'vista';
  readonly focus: Vec3;
  /** Secondary point to keep in frame — a lock-on target or boss. */
  readonly secondaryFocus: Vec3 | null;
  readonly desiredDistance: number;
  readonly desiredYaw: number | null;
  readonly desiredPitch: number | null;
  /** Extra field of view in degrees, added by speed and by boss framing. */
  readonly fovBoost: number;
  /** Seconds remaining on a scripted shot. */
  readonly scriptedRemaining: number;
  /** Impulse magnitude for screen shake, before the accessibility scale. */
  readonly shake: number;
}

// ---------------------------------------------------------------------------
// Whole-world state
// ---------------------------------------------------------------------------

export interface WorldState {
  /** Simulation steps elapsed since the stage began. */
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly difficulty: DifficultyId;
  readonly player: PlayerState;
  readonly enemies: readonly EnemyState[];
  readonly boss: BossState | null;
  readonly projectiles: readonly ProjectileState[];
  readonly pickups: readonly PickupState[];
  readonly conjured: readonly ConjuredPlatformState[];
  readonly stage: StageRuntimeState;
  readonly camera: CameraIntent;
  /** Set while a scripted sequence owns the player. */
  readonly cutsceneId: string | null;
  readonly paused: boolean;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface StageResult {
  readonly stageId: StageId;
  readonly completed: boolean;
  readonly rank: Rank;
  readonly score: number;
  readonly metrics: StageMetrics;
  /** Per-criterion breakdown shown on the results screen. */
  readonly breakdown: readonly {
    readonly label: string;
    readonly value: string;
    readonly points: number;
    readonly maxPoints: number;
  }[];
  readonly formAwarded: ResonanceFormId | null;
  readonly newBest: boolean;
}
