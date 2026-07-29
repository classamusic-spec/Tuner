import type {
  DifficultyProfile,
  EntityId,
  EventBus,
  IdAllocator,
  ResonanceFormId,
  Rng,
  Vec3,
} from '@tuner/shared';
import type { PhysicsWorld } from '@tuner/physics';
import type { InputFrame } from '@tuner/input';
import type { GameEvents } from '../events.js';
import type { DamageKind } from '@tuner/shared';
import type {
  AccessibilityConfig,
  CameraConfig,
  CombatConfig,
  MovementConfig,
} from '../config.js';
import type { ContentBundle, StageDef } from '../content-types.js';
import type { MutableEnemy, MutableProjectile, MutableWorld } from './world.js';
import type { FormBehaviour } from '../forms.js';

/**
 * What every system receives each step.
 *
 * Systems are plain functions of `(context) => void`. They never construct
 * their own dependencies and never reach outside this object, which is what
 * makes each one independently testable: a test builds a context with a stub
 * physics world and asserts on the resulting `world` mutations.
 */
export interface SimContext {
  readonly world: MutableWorld;
  readonly physics: PhysicsWorld;
  readonly events: EventBus<GameEvents>;
  readonly input: InputFrame;
  /** Fixed step, already scaled by hit-stop. Always use this, never wall time. */
  readonly dt: number;
  /** Unscaled fixed step, for timers that must ignore hit-stop. */
  readonly rawDt: number;
  readonly rng: Rng;
  readonly ids: IdAllocator;

  readonly content: ContentBundle;
  readonly stageDef: StageDef | null;

  readonly movement: MovementConfig;
  readonly combat: CombatConfig;
  readonly camera: CameraConfig;
  readonly accessibility: AccessibilityConfig;
  readonly difficultyProfile: DifficultyProfile;

  /** Behaviour hooks for the currently equipped form. */
  readonly formBehaviour: FormBehaviour | null;

  /** Camera basis, supplied by the host so aiming matches what the player sees. */
  readonly cameraYaw: number;
  readonly cameraPitch: number;

  readonly services: SimServices;
}

/**
 * Cross-system operations.
 *
 * Damage, spawning and scoring are needed by several systems at once. Routing
 * them through one implementation keeps the rules (armour, weaknesses,
 * invulnerability, difficulty scaling, event emission) in a single place rather
 * than duplicated and drifting.
 */
export interface SimServices {
  spawnProjectile(spec: ProjectileSpec): MutableProjectile;

  /** Applies damage to an enemy, honouring armour and form advantages. */
  damageEnemy(
    enemy: MutableEnemy,
    amount: number,
    kind: DamageKind,
    form: ResonanceFormId,
    hitPoint: Vec3,
    hitNormal: Vec3,
  ): void;

  /** Applies damage to the player, honouring invulnerability and difficulty. */
  damagePlayer(amount: number, source: string, sourcePosition: Vec3 | null): void;

  restoreCoherence(amount: number): void;

  /** Spawns a temporary platform (Echo, Bloom, Prism) with a real collider. */
  spawnConjuredPlatform(
    position: Vec3,
    radius: number,
    lifeSeconds: number,
    form: ResonanceFormId,
  ): void;

  /** Requests screen shake, before the accessibility scale is applied. */
  requestShake(magnitude: number, seconds: number): void;
  requestHitStop(seconds: number): void;

  findEnemy(id: EntityId): MutableEnemy | null;
  /** Nearest enemy inside a cone, used by lock-on and aim assist. */
  findNearestEnemy(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    coneDegrees: number,
  ): MutableEnemy | null;

  setStageFlag(flag: string): void;
  hasStageFlag(flag: string): boolean;

  setObjective(text: string): void;
  showSubtitle(speaker: string, text: string, seconds: number): void;
}

export interface ProjectileSpec {
  readonly owner: 'player' | 'enemy';
  readonly ownerId: EntityId;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly speed: number;
  readonly damage: number;
  readonly damageKind: DamageKind;
  readonly form: ResonanceFormId;
  readonly radius: number;
  readonly lifeSeconds: number;
  readonly tier?: number;
  readonly hz?: number;
  readonly counterable?: boolean;
  readonly gravityScale?: number;
  readonly homingTarget?: EntityId | null;
  readonly homingStrength?: number;
  readonly echoes?: number;
  readonly bounces?: number;
}

/** A simulation system. Ordering is decided by `createGameCore`. */
export type System = (context: SimContext) => void;
