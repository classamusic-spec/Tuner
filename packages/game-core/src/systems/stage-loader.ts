import type { DifficultyId, IdAllocator, Vec3 } from '@tuner/shared';
import { DIFFICULTY_IDS, vec3 } from '@tuner/shared';
import { Layer, type ColliderHandle, type PhysicsWorld } from '@tuner/physics';
import type { AccessibilityConfig } from '../config.js';
import type {
  ContentBundle,
  EnemySpawnDef,
  GeometryDef,
  MovingPlatformDef,
  StageDef,
} from '../content-types.js';
import type { MutableEnemy, MutablePickup, MutableWorld } from '../internal/world.js';
import { createStageRuntime } from '../internal/create-world.js';

/**
 * Instantiates a `StageDef` into the world.
 *
 * Stages are data, and this is the only place that turns that data into live
 * colliders and entities. The important consequence is that `@tuner/rendering`
 * builds its meshes from the *same* descriptors — so the collider the player
 * hits and the surface they can see are guaranteed to agree, rather than
 * agreeing only as long as two authors stay in sync.
 */

export interface LoadStageOptions {
  readonly world: MutableWorld;
  readonly stageDef: StageDef;
  readonly physics: PhysicsWorld;
  readonly ids: IdAllocator;
  readonly content: ContentBundle;
  readonly difficulty: DifficultyId;
  /** Spawn at this checkpoint instead of the stage's entrance. */
  readonly checkpointId?: string | null;
  readonly accessibility: AccessibilityConfig;
  /** Pickups already taken, preserved across a respawn or reload. */
  readonly collectedPickups?: readonly string[];
}

/** Difficulty ordering, so `minDifficulty` can be compared rather than matched. */
function difficultyRank(id: DifficultyId): number {
  const index = DIFFICULTY_IDS.indexOf(id);
  return index < 0 ? 0 : index;
}

/** Layer a piece of authored geometry lands on when it does not name one. */
function layerFor(def: GeometryDef): number {
  if (def.layer !== undefined) return def.layer;
  let layer: number = Layer.Terrain | Layer.CameraBlocker;
  if (def.bounce !== undefined && def.bounce > 0) layer |= Layer.Bounce;
  return layer;
}

export function loadStageIntoWorld(options: LoadStageOptions): void {
  const { world, stageDef, physics, ids, content, difficulty, accessibility } = options;

  physics.clear();

  // Preserve what the run has already banked before the runtime is rebuilt.
  const previouslyCollected = new Set(
    options.collectedPickups ?? Array.from(world.stage.collectedPickups),
  );

  const stage = createStageRuntime();
  stage.stageId = stageDef.id;
  stage.phase = 'intro';
  stage.previousPhase = 'loading';
  stage.infection = stageDef.infection;
  stage.targetInfection = stageDef.infection;
  stage.secretsTotal = stageDef.secretTotal;
  stage.collectedPickups = previouslyCollected;
  world.stage = stage;

  world.enemies.length = 0;
  world.projectiles.length = 0;
  world.pickups.length = 0;
  world.conjured.length = 0;
  world.boss = null;
  world.cutsceneId = null;
  world.cutsceneRemaining = 0;
  world.hitStopRemaining = 0;

  const restored = false; // A freshly loaded stage always begins infected.

  // Static geometry ---------------------------------------------------------
  for (const def of stageDef.geometry) {
    if (def.onlyWhenRestored === true && !restored) continue;
    if (def.hiddenWhenRestored === true && restored) continue;
    physics.addCollider({
      id: def.id,
      shape: def.shape,
      position: def.position,
      yaw: def.yaw ?? 0,
      layer: layerFor(def),
      friction: def.friction ?? 1,
      bounce: def.bounce ?? 0,
      tag: def.style ?? 'stone',
    });
  }

  // Doors — solid until their flag is set -----------------------------------
  for (const def of stageDef.doors) {
    physics.addCollider({
      id: `door:${def.id}`,
      shape: def.shape,
      position: def.position,
      yaw: def.yaw ?? 0,
      layer: Layer.Terrain | Layer.CameraBlocker,
      tag: `door:${def.id}`,
    });
  }

  // Moving platforms --------------------------------------------------------
  for (const def of stageDef.movingPlatforms) {
    const collider = physics.addCollider({
      id: `platform:${def.id}`,
      shape: def.shape,
      position: def.position,
      yaw: def.yaw ?? 0,
      layer: Layer.MovingPlatform | Layer.CameraBlocker,
      friction: def.friction ?? 1,
      bounce: def.bounce ?? 0,
      tag: `platform:${def.id}`,
    });
    world.stage.platforms.set(def.id, {
      id: def.id,
      collider,
      origin: { ...def.position },
      position: { ...def.position },
      previousPosition: { ...def.position },
      velocity: vec3(),
      phase: def.phase ?? 0,
      collapseTimer: -1,
      respawnTimer: -1,
      active: true,
    });
  }

  // Hazards -----------------------------------------------------------------
  for (const def of stageDef.hazards) {
    physics.addCollider({
      id: `hazard:${def.id}`,
      shape: def.shape,
      position: def.position,
      layer: Layer.Hazard | Layer.Trigger,
      isTrigger: true,
      tag: `hazard:${def.id}`,
    });
  }

  // Triggers ----------------------------------------------------------------
  for (const def of stageDef.triggers) {
    const collider = physics.addCollider({
      id: `trigger:${def.id}`,
      shape: def.shape,
      position: def.position,
      layer: Layer.Trigger,
      isTrigger: true,
      tag: `trigger:${def.id}`,
    });
    world.stage.triggers.set(def.id, {
      id: def.id,
      collider,
      fired: false,
      once: def.once ?? true,
    });
  }

  // Checkpoints -------------------------------------------------------------
  for (const def of stageDef.checkpoints) {
    world.stage.checkpoints.push({
      id: def.id,
      position: { ...def.position },
      yaw: def.yaw ?? stageDef.spawnYaw ?? 0,
      order: def.order,
      activated: false,
    });
  }
  world.stage.checkpoints.sort((a, b) => a.order - b.order);

  // Resonators and puzzles --------------------------------------------------
  for (const def of stageDef.resonators) {
    world.stage.resonators.set(def.id, {
      id: def.id,
      puzzleId: def.puzzleId,
      position: { ...def.position },
      degree: def.degree,
      order: def.order ?? 0,
      litRemaining: 0,
      holdSeconds: def.holdSeconds ?? 1.5,
      requiresForm: def.requiresForm ?? null,
      locked: false,
    });
  }
  for (const def of stageDef.puzzles) {
    world.stage.puzzles.set(def.id, {
      id: def.id,
      kind: def.kind,
      resonatorIds: [...def.resonatorIds],
      progress: [],
      solved: false,
      idleSeconds: 0,
    });
  }

  // Enemies -----------------------------------------------------------------
  const rank = difficultyRank(difficulty);
  for (const spawn of stageDef.enemies) {
    if (spawn.minDifficulty !== undefined && difficultyRank(spawn.minDifficulty) > rank) {
      continue;
    }
    if (spawn.triggerId !== undefined) {
      // Held back until the player crosses the trigger that owns it.
      const pending = world.stage.pendingSpawns.get(spawn.triggerId) ?? [];
      pending.push(spawn.id);
      world.stage.pendingSpawns.set(spawn.triggerId, pending);
      continue;
    }
    const enemy = instantiateEnemy(spawn, content, ids);
    if (enemy) world.enemies.push(enemy);
  }

  // Pickups -----------------------------------------------------------------
  for (const def of stageDef.pickups) {
    if (previouslyCollected.has(def.id)) continue;
    const pickup: MutablePickup = {
      id: ids.next(),
      contentId: def.id,
      kind: def.kind,
      position: { ...def.position },
      amount: def.amount ?? 1,
      collected: false,
      hidden: false,
      isSecret: def.isSecret ?? false,
      requiresForm: def.requiresForm ?? null,
      bobPhase: 0,
    };
    world.pickups.push(pickup);
  }

  // Place the player --------------------------------------------------------
  const checkpoint =
    options.checkpointId != null
      ? world.stage.checkpoints.find((c) => c.id === options.checkpointId)
      : undefined;

  const spawnAt: Vec3 = checkpoint ? checkpoint.position : stageDef.spawnPoint;
  const spawnYaw = checkpoint ? checkpoint.yaw : (stageDef.spawnYaw ?? 0);

  if (checkpoint) {
    // Resuming from a checkpoint implies everything up to it was reached.
    for (const c of world.stage.checkpoints) {
      if (c.order <= checkpoint.order) c.activated = true;
    }
    world.stage.activeCheckpointId = checkpoint.id;
    world.stage.phase = 'exploration';
  }

  const player = world.player;
  player.position.x = spawnAt.x;
  player.position.y = spawnAt.y;
  player.position.z = spawnAt.z;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.yaw = spawnYaw;
  player.targetYaw = spawnYaw;
  player.movementState = 'idle';
  player.previousMovementState = 'idle';
  player.stateTime = 0;
  player.coherence = player.maxCoherence;
  player.invulnerableRemaining = 0;
  player.chargeHeldSeconds = 0;
  player.chargeTier = 0;
  player.isCharging = false;
  player.counterSuccesses = 0;
  player.counterAttempts = 0;
  player.lockedTarget = null;
  player.railId = null;
  player.flowSeconds = 0;
  player.jumpsRemaining = 2;
  player.dashesRemaining = 1;
  player.dashCooldown = 0;
  player.dashTimeRemaining = 0;

  world.stage.lowestCoherence = player.coherence;

  // Accessibility: generous checkpoints activates the stage's first checkpoint
  // immediately, so an early mistake never returns the player to the entrance.
  if (accessibility.generousCheckpoints && world.stage.activeCheckpointId === null) {
    const first = world.stage.checkpoints[0];
    if (first) {
      first.activated = true;
      world.stage.activeCheckpointId = first.id;
    }
  }

  world.camera.focus.x = spawnAt.x;
  world.camera.focus.y = spawnAt.y;
  world.camera.focus.z = spawnAt.z;
  world.camera.desiredYaw = spawnYaw;
}

/** Builds a live enemy from a spawn definition and its archetype. */
export function instantiateEnemy(
  spawn: EnemySpawnDef,
  content: ContentBundle,
  ids: IdAllocator,
): MutableEnemy | null {
  const archetype = content.enemies[spawn.archetype];
  if (!archetype) {
    // A dangling archetype id is a content bug; dropping the spawn is better
    // than crashing a stage the player is standing in. Stage tests assert
    // referential integrity so this should never fire in shipped content.
    return null;
  }

  return {
    id: ids.next(),
    spawnId: spawn.id,
    archetype: spawn.archetype,
    position: { ...spawn.position },
    velocity: vec3(),
    yaw: spawn.yaw ?? 0,
    health: archetype.health,
    maxHealth: archetype.health,
    armour: archetype.armour ?? 0,
    phase: 'idle',
    phaseTime: 0,
    attackCooldown: 0,
    telegraphRemaining: 0,
    telegraphTotal: 0,
    targetId: null,
    patrol: (spawn.patrol ?? []).map((p) => ({ ...p })),
    patrolIndex: 0,
    homePosition: { ...spawn.position },
    grounded: false,
    mimickedForm: null,
    rootedRemaining: 0,
    silencedRemaining: 0,
    staggerRemaining: 0,
    cleanseRemaining: 0,
    spawnerId: null,
    spawnedCount: 0,
    spawnTimer: 0,
    guardsSecret: spawn.guardsSecret ?? null,
    dead: false,
  };
}

/** Handle lookup by tag, used when a puzzle needs to remove a door. */
export function findColliderByTag(
  physics: PhysicsWorld,
  tag: string,
): ColliderHandle | null {
  for (const handle of physics.colliders) {
    if (handle.descriptor.tag === tag) return handle;
  }
  return null;
}

/** Re-exported so the stage system and tests agree on platform layer flags. */
export function movingPlatformLayer(def: MovingPlatformDef): number {
  return def.layer ?? (Layer.MovingPlatform | Layer.CameraBlocker);
}
