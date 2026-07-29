import type { EntityId, Vec3 } from '@tuner/shared';

/**
 * The physics contract.
 *
 * `@tuner/game-core` talks only to this interface, never to a concrete engine.
 * The shipped implementation is a deterministic kinematic solver tuned for
 * precise platforming (see `kinematic-world.ts`); swapping in Rapier or Jolt
 * later means implementing `PhysicsWorld` and nothing else.
 */

/** Collision layers, as bit flags. */
export const Layer = {
  None: 0,
  /** Solid level geometry. */
  Terrain: 1 << 0,
  /** Platforms that translate or rotate. */
  MovingPlatform: 1 << 1,
  /** The player capsule. */
  Player: 1 << 2,
  /** Enemy bodies. */
  Enemy: 1 << 3,
  /** Player-fired resonance projectiles. */
  PlayerShot: 1 << 4,
  /** Enemy-fired frequency projectiles. */
  EnemyShot: 1 << 5,
  /** Damaging volumes: lava, spore clouds, crushers. */
  Hazard: 1 << 6,
  /** Non-solid trigger volumes: checkpoints, pickups, script triggers. */
  Trigger: 1 << 7,
  /** Climbable/clingable surfaces. */
  Wall: 1 << 8,
  /** Grindable resonance lines. */
  Rail: 1 << 9,
  /** Surfaces that bounce the player. */
  Bounce: 1 << 10,
  /** Blocks the camera from clipping through geometry. */
  CameraBlocker: 1 << 11,
} as const;

export type LayerMask = number;

export const SOLID_MASK: LayerMask = Layer.Terrain | Layer.MovingPlatform;
export const PLAYER_SHOT_MASK: LayerMask = Layer.Terrain | Layer.MovingPlatform | Layer.Enemy;
export const ENEMY_SHOT_MASK: LayerMask = Layer.Terrain | Layer.MovingPlatform | Layer.Player;

/** Shapes the solver understands. Kept small on purpose — more shapes means
 *  more collision cases to get right, and the stages are authored from these. */
export type ColliderShape =
  | { readonly kind: 'box'; readonly halfExtents: Vec3 }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'capsule'; readonly radius: number; readonly halfHeight: number }
  /** An axis-aligned box whose +Y face is tilted; the workhorse for slopes. */
  | {
      readonly kind: 'ramp';
      readonly halfExtents: Vec3;
      /** Rise over run along the collider's local +Z. */
      readonly slope: number;
    };

export interface ColliderDescriptor {
  readonly id?: string;
  readonly shape: ColliderShape;
  readonly position: Vec3;
  /** Yaw only. Stages are authored on a grid; full quaternions are not needed. */
  readonly yaw?: number;
  readonly layer: LayerMask;
  /** Zero-friction surfaces (ice) approach 0; default terrain is 1. */
  readonly friction?: number;
  /** Restitution used by harmonic bounce surfaces. */
  readonly bounce?: number;
  /** Non-solid volumes report overlaps but never block movement. */
  readonly isTrigger?: boolean;
  /** Gameplay entity that owns this collider, if any. */
  readonly owner?: EntityId;
  /** Free-form tag the stage runtime reads back on contact. */
  readonly tag?: string;
}

export interface ColliderHandle {
  readonly id: number;
  readonly descriptor: ColliderDescriptor;
}

export interface RaycastHit {
  readonly collider: ColliderHandle;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

export interface SweepHit {
  readonly collider: ColliderHandle;
  readonly normal: Vec3;
  /** Fraction of the requested motion completed before contact, in [0, 1]. */
  readonly time: number;
  readonly point: Vec3;
}

/** Result of a full collide-and-slide move. */
export interface MoveResult {
  /** Final position after sliding along every surface hit. */
  readonly position: Vec3;
  /** Velocity with blocked components removed. */
  readonly velocity: Vec3;
  readonly grounded: boolean;
  /** Upward normal of the ground the body is resting on, when grounded. */
  readonly groundNormal: Vec3;
  readonly groundCollider: ColliderHandle | null;
  /** True when a near-vertical surface blocked horizontal motion. */
  readonly touchingWall: boolean;
  readonly wallNormal: Vec3;
  readonly wallCollider: ColliderHandle | null;
  /** True when the body's head struck a ceiling. */
  readonly touchingCeiling: boolean;
  /** Triggers overlapped during the move. */
  readonly triggers: readonly ColliderHandle[];
}

export interface CharacterMoveParams {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
  /** Total capsule height including both hemispherical caps. */
  readonly height: number;
  readonly deltaSeconds: number;
  readonly mask: LayerMask;
  /** Surfaces steeper than this (in radians from vertical) are walls, not floors. */
  readonly maxSlopeRadians: number;
  /** Vertical lip the body walks over without jumping. */
  readonly stepHeight: number;
  /** Keeps the body glued to descending slopes instead of launching off them. */
  readonly snapToGround: boolean;
}

export interface PhysicsWorld {
  addCollider(descriptor: ColliderDescriptor): ColliderHandle;
  removeCollider(handle: ColliderHandle): void;
  /** Repositions a kinematic body; carries riders along with it. */
  setColliderTransform(handle: ColliderHandle, position: Vec3, yaw?: number): void;
  clear(): void;

  /** Collide-and-slide character move. The heart of the movement feel. */
  moveCharacter(params: CharacterMoveParams): MoveResult;

  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    mask: LayerMask,
    ignore?: ColliderHandle | null,
  ): RaycastHit | null;

  sweepSphere(
    origin: Vec3,
    direction: Vec3,
    radius: number,
    maxDistance: number,
    mask: LayerMask,
    ignore?: ColliderHandle | null,
  ): SweepHit | null;

  overlapSphere(center: Vec3, radius: number, mask: LayerMask): readonly ColliderHandle[];

  /** All colliders, for debug rendering and stage-authoring tools. */
  readonly colliders: readonly ColliderHandle[];

  /** Diagnostics surfaced by the in-game debug overlay. */
  readonly stats: {
    readonly colliderCount: number;
    readonly lastQueryCount: number;
  };
}
