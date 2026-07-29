import type {
  CollectibleKind,
  DamageKind,
  DifficultyId,
  EntityId,
  ResonanceFormId,
  StageId,
  Vec3,
} from '@tuner/shared';
import type { ColliderHandle } from '@tuner/physics';
import type { EnemyPhase, MovementState, StagePhase } from '../state.js';

/**
 * The mutable simulation world.
 *
 * The public `WorldState` in `state.ts` is the read-only view handed to
 * renderers. This is the version the systems actually mutate. Keeping them
 * separate means a renderer cannot accidentally write into the simulation, and
 * it lets the systems work in place without allocating a fresh state object
 * sixty times a second.
 *
 * Every system in `systems/` receives this through `SimContext` and mutates it
 * directly. Ordering is fixed by `createGameCore`, not by the systems
 * themselves, so behaviour stays deterministic.
 */

export interface MutablePlayer {
  id: EntityId;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  /** Yaw the character is turning toward, set by the movement system. */
  targetYaw: number;
  movementState: MovementState;
  previousMovementState: MovementState;
  stateTime: number;

  grounded: boolean;
  wasGrounded: boolean;
  groundNormal: Vec3;
  groundCollider: ColliderHandle | null;
  /** Velocity inherited from the moving platform underfoot. */
  platformVelocity: Vec3;

  coyoteRemaining: number;
  jumpBufferRemaining: number;
  jumpsRemaining: number;
  /** True between leaving the ground and releasing the jump button. */
  jumpHeld: boolean;
  dashesRemaining: number;
  dashCooldown: number;
  dashTimeRemaining: number;
  dashDirection: Vec3;
  slideTimeRemaining: number;
  /** Blocks input from cancelling a wall jump's push-off. */
  inputLockRemaining: number;

  touchingWall: boolean;
  wallNormal: Vec3 | null;
  wallClingRemaining: number;
  ledgeTarget: Vec3 | null;
  mantleRemaining: number;

  railId: string | null;
  railProgress: number;
  railDirection: 1 | -1;
  railCooldown: number;

  inWater: boolean;
  waterSurfaceY: number;

  coherence: number;
  maxCoherence: number;
  invulnerableRemaining: number;
  /** Set for one step when the player is hurt, so systems can react. */
  hurtThisStep: boolean;

  form: ResonanceFormId;
  unlockedForms: ResonanceFormId[];

  fireCooldown: number;
  chargeHeldSeconds: number;
  chargeTier: number;
  isCharging: boolean;
  burstCooldown: number;

  counterActive: boolean;
  counterWindowRemaining: number;
  counterCooldownRemaining: number;
  counterSuccesses: number;
  counterAttempts: number;

  lockedTarget: EntityId | null;
  lockOnLostSeconds: number;
  resonanceSightActive: boolean;

  /** Aim direction, resolved from camera, lock-on and aim assist. */
  aimDirection: Vec3;

  /** Time spent moving at or above the flow threshold, in seconds. */
  flowSeconds: number;
}

export interface MutableEnemy {
  id: EntityId;
  /** Stable id from the stage's spawn list; blank for runtime-spawned units. */
  spawnId: string;
  archetype: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  armour: number;
  phase: EnemyPhase;
  phaseTime: number;
  attackCooldown: number;
  telegraphRemaining: number;
  telegraphTotal: number;
  targetId: EntityId | null;
  patrol: Vec3[];
  patrolIndex: number;
  homePosition: Vec3;
  grounded: boolean;
  mimickedForm: ResonanceFormId | null;
  rootedRemaining: number;
  silencedRemaining: number;
  staggerRemaining: number;
  cleanseRemaining: number;
  spawnerId: EntityId | null;
  spawnedCount: number;
  spawnTimer: number;
  guardsSecret: string | null;
  /** Marked for removal at the end of the step. */
  dead: boolean;
}

export interface MutableBoss {
  id: EntityId;
  definitionId: string;
  displayName: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  phaseIndex: number;
  phaseTime: number;
  currentAttack: string | null;
  attackTime: number;
  attackDuration: number;
  telegraphRemaining: number;
  telegraphTotal: number;
  recoveryRemaining: number;
  nextAttackIn: number;
  vulnerable: boolean;
  /** Arena flags set by phase transitions, read by the stage runtime. */
  arenaFlags: Set<string>;
  restoring: boolean;
  restorationProgress: number;
  /** Index into the retuning sequence during the restoration phase. */
  restorationStep: number;
  defeated: boolean;
  /** Scratch space for attack-specific state, keyed by attack id. */
  scratch: Map<string, number>;
}

export interface MutableProjectile {
  id: EntityId;
  owner: 'player' | 'enemy';
  ownerId: EntityId;
  position: Vec3;
  velocity: Vec3;
  radius: number;
  damage: number;
  damageKind: DamageKind;
  form: ResonanceFormId;
  tier: number;
  lifeRemaining: number;
  echoesRemaining: number;
  /** Seconds until the next echo detaches. */
  echoDelay: number;
  bouncesRemaining: number;
  reflected: boolean;
  counterable: boolean;
  hz: number;
  /** Gravity multiplier; most resonance shots travel straight. */
  gravityScale: number;
  /** Enemy this shot homes toward, if any. */
  homingTarget: EntityId | null;
  homingStrength: number;
  dead: boolean;
}

export interface MutablePickup {
  id: EntityId;
  contentId: string;
  kind: CollectibleKind | 'coherence';
  position: Vec3;
  amount: number;
  collected: boolean;
  /** Hidden until a condition is met; not drawn or collectible while hidden. */
  hidden: boolean;
  isSecret: boolean;
  requiresForm: ResonanceFormId | null;
  bobPhase: number;
}

export interface MutableConjured {
  id: EntityId;
  form: ResonanceFormId;
  position: Vec3;
  radius: number;
  lifeRemaining: number;
  maxLife: number;
  collider: ColliderHandle | null;
}

export interface MutableCheckpoint {
  id: string;
  position: Vec3;
  yaw: number;
  order: number;
  activated: boolean;
}

/** A moving platform's live state, driven by the stage runtime. */
export interface MutablePlatform {
  id: string;
  collider: ColliderHandle;
  origin: Vec3;
  position: Vec3;
  previousPosition: Vec3;
  /** Derived each step so riders inherit the platform's motion. */
  velocity: Vec3;
  phase: number;
  /** Collapse platforms count down once stepped on. */
  collapseTimer: number;
  respawnTimer: number;
  active: boolean;
}

export interface MutableResonator {
  id: string;
  puzzleId: string;
  position: Vec3;
  degree: number;
  order: number;
  /** Seconds the resonator stays lit after being struck. */
  litRemaining: number;
  holdSeconds: number;
  requiresForm: ResonanceFormId | null;
  /** Set once the puzzle it belongs to has been solved. */
  locked: boolean;
}

export interface MutablePuzzle {
  id: string;
  kind: 'sequence' | 'simultaneous' | 'echo' | 'sustain';
  resonatorIds: string[];
  /** Degrees struck so far, for sequence puzzles. */
  progress: number[];
  solved: boolean;
  /** Seconds since the last input, used to time out a partial sequence. */
  idleSeconds: number;
}

export interface MutableTrigger {
  id: string;
  collider: ColliderHandle;
  fired: boolean;
  once: boolean;
}

export interface MutableStage {
  stageId: StageId;
  phase: StagePhase;
  previousPhase: StagePhase;
  infection: number;
  targetInfection: number;
  objective: string;
  /** World-flag store written by triggers and puzzles, read by everything. */
  flags: Set<string>;
  checkpoints: MutableCheckpoint[];
  activeCheckpointId: string | null;
  platforms: Map<string, MutablePlatform>;
  resonators: Map<string, MutableResonator>;
  puzzles: Map<string, MutablePuzzle>;
  triggers: Map<string, MutableTrigger>;
  /** Beat counter derived from the stage's bpm; drives rhythmic hazards. */
  beat: number;
  beatPhase: number;
  /** Set for one step on each beat, so systems can sync without polling time. */
  beatThisStep: boolean;

  elapsedSeconds: number;
  damageTaken: number;
  deaths: number;
  enemiesCleansed: number;
  foundSecrets: Set<string>;
  secretsTotal: number;
  formsUsed: Set<ResonanceFormId>;
  lowestCoherence: number;
  /** Seconds spent above the flow speed threshold. */
  flowSeconds: number;
  /** Spawn definitions not yet instantiated, keyed by trigger id. */
  pendingSpawns: Map<string, string[]>;
  /** Content ids of pickups already taken this run. */
  collectedPickups: Set<string>;
  /** Tutorials already shown, so they do not repeat. */
  shownTutorials: Set<string>;
}

export interface MutableCamera {
  mode: 'follow' | 'lockOn' | 'boss' | 'cinematic' | 'vista';
  focus: Vec3;
  secondaryFocus: Vec3 | null;
  desiredDistance: number;
  desiredYaw: number | null;
  desiredPitch: number | null;
  fovBoost: number;
  scriptedRemaining: number;
  shake: number;
}

export interface MutableWorld {
  tick: number;
  elapsedSeconds: number;
  difficulty: DifficultyId;
  player: MutablePlayer;
  enemies: MutableEnemy[];
  boss: MutableBoss | null;
  projectiles: MutableProjectile[];
  pickups: MutablePickup[];
  conjured: MutableConjured[];
  stage: MutableStage;
  camera: MutableCamera;
  cutsceneId: string | null;
  cutsceneRemaining: number;
  paused: boolean;
  /**
   * Remaining hit-stop. While above zero the simulation runs at a reduced rate,
   * which is what gives impacts their weight without desynchronising physics.
   */
  hitStopRemaining: number;
}
