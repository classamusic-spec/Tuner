import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_PROFILES,
  createEventBus,
  createIdAllocator,
  createRng,
  distanceXZ,
  vec3,
} from '@tuner/shared';
import type {
  DifficultyProfile,
  EnemyRole,
  EntityId,
  EventBus,
  ResonanceFormId,
  Vec3,
} from '@tuner/shared';
import { createEmptyInputFrame } from '@tuner/input';
import { Layer } from '@tuner/physics';
import type { ColliderHandle, PhysicsWorld, RaycastHit, SweepHit } from '@tuner/physics';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import type { ContentBundle, EnemyArchetypeDef, StageDef } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { FormBehaviour } from '../forms.js';
import type { SimContext, SimServices } from '../internal/context.js';
import { createSimServices } from '../internal/services.js';
import type { MutableEnemy, MutablePlayer, MutableWorld } from '../internal/world.js';
import {
  CLEANSE_SECONDS,
  FLYER_HOVER_HEIGHT,
  SIGHT_MEMORY_SECONDS,
  attackCooldownSecondsFor,
  enemySystem,
  hasLineOfSight,
  telegraphSecondsFor,
  yawForDirection,
} from './enemies.js';

const DT = 1 / 60;
const START_COHERENCE = 1000;

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function archetype(
  partial: Partial<EnemyArchetypeDef> & { id: string; role: EnemyRole },
): EnemyArchetypeDef {
  return {
    displayName: partial.id,
    health: 100,
    contactDamage: 6,
    moveSpeed: 4,
    turnSpeed: 5,
    aggroRadius: 14,
    attackRadius: 2,
    telegraphSeconds: 0.4,
    attackCooldown: 1.2,
    bodyRadius: 0.4,
    bodyHeight: 1.2,
    ...partial,
  };
}

const TEST_ENEMIES: Readonly<Record<string, EnemyArchetypeDef>> = {
  scout: archetype({
    id: 'scout',
    role: 'scout',
    health: 24,
    moveSpeed: 6,
    turnSpeed: 8,
    aggroRadius: 14,
    attackRadius: 1.8,
    telegraphSeconds: 0.4,
    attackCooldown: 1.2,
    contactDamage: 6,
    bodyRadius: 0.34,
    bodyHeight: 0.7,
  }),
  turret: archetype({
    id: 'turret',
    role: 'turret',
    health: 60,
    moveSpeed: 0,
    turnSpeed: 2.4,
    aggroRadius: 22,
    attackRadius: 20,
    telegraphSeconds: 0.5,
    attackCooldown: 2,
    contactDamage: 0,
    projectile: {
      speed: 20,
      damage: 11,
      radius: 0.3,
      count: 3,
      spreadRadians: 0.3,
      counterable: true,
    },
    bodyRadius: 0.7,
    bodyHeight: 1.5,
  }),
  flyer: archetype({
    id: 'flyer',
    role: 'flyer',
    health: 30,
    moveSpeed: 7,
    turnSpeed: 4.2,
    aggroRadius: 18,
    attackRadius: 11,
    telegraphSeconds: 0.6,
    attackCooldown: 2.2,
    contactDamage: 7,
    bodyRadius: 0.42,
    bodyHeight: 0.6,
    flying: true,
  }),
  shield: archetype({
    id: 'shield',
    role: 'shield',
    health: 120,
    armour: 26,
    armourBreakers: ['charge', 'counter'],
    moveSpeed: 3,
    turnSpeed: 2.2,
    aggroRadius: 13,
    attackRadius: 2.4,
    telegraphSeconds: 0.7,
    attackCooldown: 2.1,
    contactDamage: 13,
    bodyRadius: 0.72,
    bodyHeight: 2,
  }),
  pursuer: archetype({
    id: 'pursuer',
    role: 'pursuer',
    health: 52,
    moveSpeed: 9,
    // Deliberately slow to turn: the cap is the counter-play.
    turnSpeed: 2,
    aggroRadius: 20,
    attackRadius: 2,
    telegraphSeconds: 0.5,
    attackCooldown: 1.6,
    contactDamage: 12,
    bodyRadius: 0.5,
    bodyHeight: 1.3,
  }),
  spawner: archetype({
    id: 'spawner',
    role: 'spawner',
    health: 40,
    moveSpeed: 0,
    turnSpeed: 1.2,
    aggroRadius: 24,
    attackRadius: 3,
    telegraphSeconds: 0.4,
    attackCooldown: 0.5,
    contactDamage: 0,
    spawns: { archetype: 'scout', interval: 1, max: 2 },
    bodyRadius: 0.9,
    bodyHeight: 2,
    cleansable: true,
  }),
  hazard: archetype({
    id: 'hazard',
    role: 'hazard',
    health: 14,
    moveSpeed: 2,
    turnSpeed: 0.8,
    aggroRadius: 30,
    attackRadius: 1.6,
    telegraphSeconds: 0.5,
    attackCooldown: 2,
    contactDamage: 18,
    bodyRadius: 0.45,
    bodyHeight: 0.9,
  }),
  mimic: archetype({
    id: 'mimic',
    role: 'mimic',
    health: 46,
    moveSpeed: 5,
    turnSpeed: 6,
    aggroRadius: 17,
    attackRadius: 14,
    telegraphSeconds: 0.5,
    attackCooldown: 1.9,
    contactDamage: 9,
    projectile: { speed: 24, damage: 9, radius: 0.3, count: 1, counterable: true },
    bodyRadius: 0.4,
    bodyHeight: 1.6,
  }),
  elite: archetype({
    id: 'elite',
    role: 'elite',
    health: 260,
    armour: 30,
    armourBreakers: ['charge', 'counter'],
    moveSpeed: 4,
    turnSpeed: 3.4,
    aggroRadius: 26,
    attackRadius: 16,
    telegraphSeconds: 0.5,
    attackCooldown: 1,
    contactDamage: 14,
    projectile: {
      speed: 16,
      damage: 12,
      radius: 0.4,
      count: 3,
      spreadRadians: 0.5,
      counterable: true,
    },
    bodyRadius: 0.75,
    bodyHeight: 2.6,
  }),
  moth: archetype({
    id: 'moth',
    role: 'flyer',
    health: 18,
    moveSpeed: 5.6,
    aggroRadius: 12,
    attackRadius: 2.2,
    contactDamage: 5,
    bodyRadius: 0.44,
    bodyHeight: 0.44,
    flying: true,
    cleansable: true,
  }),
};

const TEST_CONTENT: ContentBundle = {
  stages: {},
  enemies: TEST_ENEMIES,
  bosses: {},
};

// ---------------------------------------------------------------------------
// Stub physics
// ---------------------------------------------------------------------------

interface StubOptions {
  /** Solid plane at this constant z, blocking sight and sweeps. Null = empty. */
  wallZ?: number | null;
  /** Floor height for ground units. */
  groundY?: number;
}

interface StubPhysics extends PhysicsWorld {
  state: Required<StubOptions>;
  raycastCount: number;
}

function createStubPhysics(options: StubOptions = {}): StubPhysics {
  const state: Required<StubOptions> = {
    wallZ: options.wallZ ?? null,
    groundY: options.groundY ?? 0,
  };
  const wallHandle: ColliderHandle = {
    id: 3,
    descriptor: {
      id: 'wall',
      shape: { kind: 'box', halfExtents: vec3(60, 60, 0.5) },
      position: vec3(0, 0, state.wallZ ?? 0),
      layer: Layer.Terrain,
    },
  };
  let nextId = 50;

  const physics: StubPhysics = {
    state,
    raycastCount: 0,

    addCollider(descriptor) {
      return { id: nextId++, descriptor };
    },
    removeCollider() {
      /* no-op */
    },
    setColliderTransform() {
      /* no-op */
    },
    clear() {
      /* no-op */
    },
    moveCharacter(params) {
      const nx = params.position.x + params.velocity.x * params.deltaSeconds;
      let ny = params.position.y + params.velocity.y * params.deltaSeconds;
      const nz = params.position.z + params.velocity.z * params.deltaSeconds;
      let vy = params.velocity.y;
      let grounded = false;
      if (ny <= state.groundY) {
        ny = state.groundY;
        vy = 0;
        grounded = true;
      }
      return {
        position: vec3(nx, ny, nz),
        velocity: vec3(params.velocity.x, vy, params.velocity.z),
        grounded,
        groundNormal: vec3(0, 1, 0),
        groundCollider: null,
        touchingWall: false,
        wallNormal: vec3(),
        wallCollider: null,
        touchingCeiling: false,
        triggers: [],
      };
    },
    raycast(origin, direction, maxDistance): RaycastHit | null {
      physics.raycastCount++;
      const wallZ = state.wallZ;
      if (wallZ === null || Math.abs(direction.z) < 1e-9) return null;
      const t = (wallZ - origin.z) / direction.z;
      if (t < 0 || t > maxDistance) return null;
      return {
        collider: wallHandle,
        point: vec3(origin.x + direction.x * t, origin.y + direction.y * t, wallZ),
        normal: vec3(0, 0, direction.z > 0 ? -1 : 1),
        distance: t,
      };
    },
    sweepSphere(origin, direction, radius, maxDistance): SweepHit | null {
      const wallZ = state.wallZ;
      if (wallZ === null || maxDistance <= 0 || Math.abs(direction.z) < 1e-9) return null;
      const surface = wallZ + (direction.z > 0 ? -radius : radius);
      const t = (surface - origin.z) / direction.z;
      if (t < 0 || t > maxDistance) return null;
      return {
        collider: wallHandle,
        normal: vec3(0, 0, direction.z > 0 ? -1 : 1),
        time: t / maxDistance,
        point: vec3(origin.x + direction.x * t, origin.y + direction.y * t, surface),
      };
    },
    overlapSphere() {
      return [];
    },
    colliders: [],
    stats: { colliderCount: 0, lastQueryCount: 0 },
  };

  return physics;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

function createPlayer(): MutablePlayer {
  return {
    id: 1 as EntityId,
    position: vec3(0, 0, 0),
    velocity: vec3(),
    yaw: 0,
    targetYaw: 0,
    movementState: 'idle',
    previousMovementState: 'idle',
    stateTime: 0,

    grounded: true,
    wasGrounded: true,
    groundNormal: vec3(0, 1, 0),
    groundCollider: null,
    platformVelocity: vec3(),

    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    jumpsRemaining: 2,
    jumpHeld: false,
    dashesRemaining: 1,
    dashCooldown: 0,
    dashTimeRemaining: 0,
    dashDirection: vec3(0, 0, -1),
    slideTimeRemaining: 0,
    inputLockRemaining: 0,

    touchingWall: false,
    wallNormal: null,
    wallClingRemaining: 0,
    ledgeTarget: null,
    mantleRemaining: 0,

    railId: null,
    railProgress: 0,
    railDirection: 1,
    railCooldown: 0,

    inWater: false,
    waterSurfaceY: 0,

    coherence: START_COHERENCE,
    maxCoherence: START_COHERENCE,
    invulnerableRemaining: 0,
    hurtThisStep: false,

    form: 'base',
    unlockedForms: ['base'],

    fireCooldown: 0,
    chargeHeldSeconds: 0,
    chargeTier: 0,
    isCharging: false,
    burstCooldown: 0,

    counterActive: false,
    counterWindowRemaining: 0,
    counterCooldownRemaining: 0,
    counterSuccesses: 0,
    counterAttempts: 0,

    lockedTarget: null,
    lockOnLostSeconds: 0,
    resonanceSightActive: false,

    aimDirection: vec3(0, 0, -1),
    flowSeconds: 0,
  };
}

function createTestWorld(): MutableWorld {
  return {
    tick: 0,
    elapsedSeconds: 0,
    difficulty: 'standard',
    player: createPlayer(),
    enemies: [],
    boss: null,
    projectiles: [],
    pickups: [],
    conjured: [],
    stage: {
      stageId: 'fallen-sanctuary',
      phase: 'exploration',
      previousPhase: 'exploration',
      infection: 0.5,
      targetInfection: 0.5,
      objective: '',
      flags: new Set(),
      checkpoints: [],
      activeCheckpointId: null,
      platforms: new Map(),
      resonators: new Map(),
      puzzles: new Map(),
      triggers: new Map(),
      beat: 0,
      beatPhase: 0,
      beatThisStep: false,
      elapsedSeconds: 0,
      damageTaken: 0,
      deaths: 0,
      enemiesCleansed: 0,
      foundSecrets: new Set(),
      secretsTotal: 0,
      formsUsed: new Set(),
      lowestCoherence: START_COHERENCE,
      flowSeconds: 0,
      pendingSpawns: new Map(),
      collectedPickups: new Set(),
      shownTutorials: new Set(),
    },
    camera: {
      mode: 'follow',
      focus: vec3(),
      secondaryFocus: null,
      desiredDistance: 7,
      desiredYaw: null,
      desiredPitch: null,
      fovBoost: 0,
      scriptedRemaining: 0,
      shake: 0,
    },
    cutsceneId: null,
    cutsceneRemaining: 0,
    paused: false,
    hitStopRemaining: 0,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface CapturedEvent {
  type: keyof GameEvents;
  payload: unknown;
}

const TRACKED_EVENTS: (keyof GameEvents)[] = [
  'combat:fired',
  'combat:hit',
  'combat:enemyCleansed',
  'combat:playerHurt',
  'fx:shake',
];

interface Harness {
  ctx: SimContext;
  world: MutableWorld;
  player: MutablePlayer;
  physics: StubPhysics;
  events: EventBus<GameEvents>;
  services: SimServices;
  addEnemy(archetypeId: string, position: Vec3, overrides?: Partial<MutableEnemy>): MutableEnemy;
  step(count?: number): void;
  eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][];
  enemyProjectiles(): MutableWorld['projectiles'];
}

interface HarnessOptions {
  physics?: StubOptions;
  difficulty?: Partial<DifficultyProfile>;
  seed?: number;
}

function createHarness(options: HarnessOptions = {}): Harness {
  // Per-harness, so two harnesses built the same way mint the same ids and a
  // determinism comparison is not defeated by a shared counter.
  let nextEnemyId = 500;
  const world = createTestWorld();
  const physics = createStubPhysics(options.physics);
  const events = createEventBus<GameEvents>();
  const captured: CapturedEvent[] = [];
  for (const type of TRACKED_EVENTS) {
    events.on(type, (payload: unknown) => {
      captured.push({ type, payload });
    });
  }

  const difficultyProfile: DifficultyProfile = {
    ...DIFFICULTY_PROFILES.standard,
    ...options.difficulty,
  };

  const backing = {
    world,
    physics,
    events,
    input: createEmptyInputFrame(),
    dt: DT,
    rawDt: DT,
    rng: createRng(options.seed ?? 1234),
    ids: createIdAllocator(9000),
    content: TEST_CONTENT,
    stageDef: null as StageDef | null,
    movement: { ...DEFAULT_MOVEMENT_CONFIG },
    combat: { ...DEFAULT_COMBAT_CONFIG },
    camera: { ...DEFAULT_CAMERA_CONFIG },
    accessibility: { ...DEFAULT_ACCESSIBILITY_CONFIG },
    difficultyProfile,
    formBehaviour: null as FormBehaviour | null,
    cameraYaw: 0,
    cameraPitch: 0,
    services: null as unknown as SimServices,
  };
  backing.services = createSimServices(backing);
  const ctx = backing as unknown as SimContext;

  return {
    ctx,
    world,
    player: world.player,
    physics,
    events,
    services: backing.services,

    addEnemy(archetypeId, position, overrides = {}) {
      const def = TEST_ENEMIES[archetypeId];
      const enemy: MutableEnemy = {
        id: nextEnemyId++ as EntityId,
        spawnId: `spawn-${archetypeId}`,
        archetype: archetypeId,
        position: vec3(position.x, position.y, position.z),
        velocity: vec3(),
        yaw: 0,
        health: def?.health ?? 100,
        maxHealth: def?.health ?? 100,
        armour: def?.armour ?? 0,
        phase: 'idle',
        phaseTime: 0,
        attackCooldown: 0,
        telegraphRemaining: 0,
        telegraphTotal: 0,
        targetId: null,
        patrol: [],
        patrolIndex: 0,
        homePosition: vec3(position.x, position.y, position.z),
        grounded: true,
        mimickedForm: null,
        rootedRemaining: 0,
        silencedRemaining: 0,
        staggerRemaining: 0,
        cleanseRemaining: 0,
        spawnerId: null,
        spawnedCount: 0,
        spawnTimer: 0,
        guardsSecret: null,
        dead: false,
        ...overrides,
      };
      world.enemies.push(enemy);
      return enemy;
    },

    step(count = 1) {
      for (let i = 0; i < count; i++) {
        world.player.hurtThisStep = false;
        // Mercy invulnerability is owned by the combat system, which is not in
        // this test's loop; ticking it here keeps contact damage realistic.
        world.player.invulnerableRemaining = Math.max(
          0,
          world.player.invulnerableRemaining - DT,
        );
        enemySystem(ctx);
        world.tick++;
        world.elapsedSeconds += DT;
      }
    },

    eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][] {
      const out: GameEvents[K][] = [];
      for (const entry of captured) {
        if (entry.type === type) out.push(entry.payload as GameEvents[K]);
      }
      return out;
    },

    enemyProjectiles() {
      return world.projectiles.filter((p) => p.owner === 'enemy');
    },
  };
}

function defOf(id: string): EnemyArchetypeDef {
  const def = TEST_ENEMIES[id];
  if (def === undefined) throw new Error(`missing test archetype ${id}`);
  return def;
}

/** Runs until `predicate` holds, returning the number of steps taken (-1 if never). */
function stepUntil(h: Harness, limit: number, predicate: () => boolean): number {
  for (let i = 0; i < limit; i++) {
    h.step();
    if (predicate()) return i + 1;
  }
  return -1;
}

function snapshot(world: MutableWorld): string {
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return JSON.stringify(
    world.enemies.map((e) => ({
      id: e.id,
      archetype: e.archetype,
      x: round(e.position.x),
      y: round(e.position.y),
      z: round(e.position.z),
      yaw: round(e.yaw),
      phase: e.phase,
      health: e.health,
      target: e.targetId,
      spawner: e.spawnerId,
      dead: e.dead,
    })),
  );
}

// ---------------------------------------------------------------------------
// Framework
// ---------------------------------------------------------------------------

describe('enemy framework: perception', () => {
  it('acquires the player inside the aggro radius', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 10));
    h.step();
    expect(scout.targetId).toBe(h.player.id);
    expect(scout.phase).toBe('alert');
  });

  it('does not aggro through a wall', () => {
    const h = createHarness({ physics: { wallZ: 5 } });
    const scout = h.addEnemy('scout', vec3(0, 0, 10));
    h.step(30);
    expect(scout.targetId).toBeNull();
    expect(scout.phase).toBe('idle');
    // And it stayed put rather than drifting toward a player it cannot see.
    expect(scout.position.z).toBeCloseTo(10, 5);
  });

  it('hasLineOfSight reports the blocking geometry', () => {
    const h = createHarness({ physics: { wallZ: 5 } });
    expect(hasLineOfSight(h.ctx, vec3(0, 1, 0), vec3(0, 1, 10))).toBe(false);
    expect(hasLineOfSight(h.ctx, vec3(0, 1, 0), vec3(0, 1, 4))).toBe(true);
  });

  it('keeps the target for a grace period after losing sight, then goes home', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 0));
    h.player.position.z = 8;
    h.step(30);
    expect(scout.targetId).toBe(h.player.id);

    // Player leaves the aggro radius entirely.
    h.player.position.z = 400;
    h.step(30);
    expect(scout.targetId).toBe(h.player.id);

    const graceSteps = Math.ceil(SIGHT_MEMORY_SECONDS / DT) + 5;
    h.step(graceSteps);
    expect(scout.targetId).toBeNull();

    h.step(400);
    expect(distanceXZ(scout.position, scout.homePosition)).toBeLessThan(1);
  });
});

describe('enemy framework: telegraphs', () => {
  it('publishes telegraphRemaining and telegraphTotal for the timing ring', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 1.5), { rootedRemaining: 999 });
    h.step();
    expect(scout.phase).toBe('attack');
    expect(scout.telegraphTotal).toBeCloseTo(defOf('scout').telegraphSeconds, 5);
    expect(scout.telegraphRemaining).toBeCloseTo(defOf('scout').telegraphSeconds, 5);

    h.step(5);
    expect(scout.telegraphRemaining).toBeGreaterThan(0);
    expect(scout.telegraphRemaining).toBeLessThan(scout.telegraphTotal);
  });

  it('deals no damage until the telegraph has fully elapsed', () => {
    const h = createHarness();
    // Rooted so it cannot close and deal contact damage instead.
    h.addEnemy('scout', vec3(0, 0, 1.5), { rootedRemaining: 999 });

    const steps = stepUntil(h, 300, () => h.player.coherence < START_COHERENCE);
    expect(steps).toBeGreaterThan(0);
    expect(steps * DT).toBeGreaterThanOrEqual(defOf('scout').telegraphSeconds - 1e-9);
    expect(h.eventsOfType('combat:playerHurt').length).toBe(1);
  });
});

describe('enemy framework: status effects', () => {
  it('rootedRemaining stops movement but not perception', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 10), { rootedRemaining: 999 });
    h.step(60);
    expect(scout.targetId).toBe(h.player.id);
    expect(scout.position.x).toBeCloseTo(0, 6);
    expect(scout.position.z).toBeCloseTo(10, 6);
  });

  it('silencedRemaining interrupts the wind-up and blocks attacks', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 1.5), { rootedRemaining: 999 });
    h.step();
    expect(scout.telegraphRemaining).toBeGreaterThan(0);

    scout.silencedRemaining = 5;
    h.step(200);
    expect(scout.telegraphRemaining).toBe(0);
    expect(h.player.coherence).toBe(START_COHERENCE);
  });
});

describe('enemy framework: difficulty', () => {
  it('shortens attack cadence with aggression but never touches health', () => {
    const relaxed = createHarness({ difficulty: DIFFICULTY_PROFILES.story });
    const brutal = createHarness({ difficulty: DIFFICULTY_PROFILES['resonance-master'] });
    const def = defOf('turret');

    expect(attackCooldownSecondsFor(def, brutal.ctx)).toBeLessThan(
      attackCooldownSecondsFor(def, relaxed.ctx),
    );
    expect(telegraphSecondsFor(def, brutal.ctx)).toBeLessThan(
      telegraphSecondsFor(def, relaxed.ctx),
    );

    const relaxedTurret = relaxed.addEnemy('turret', vec3(0, 0, 10));
    const brutalTurret = brutal.addEnemy('turret', vec3(0, 0, 10));

    const volley = def.projectile?.count ?? 1;
    const relaxedSteps = stepUntil(
      relaxed,
      2000,
      () => relaxed.enemyProjectiles().length >= volley * 2,
    );
    const brutalSteps = stepUntil(
      brutal,
      2000,
      () => brutal.enemyProjectiles().length >= volley * 2,
    );

    expect(relaxedSteps).toBeGreaterThan(0);
    expect(brutalSteps).toBeGreaterThan(0);
    expect(brutalSteps).toBeLessThan(relaxedSteps);

    // Difficulty changes the fight's density, never its length.
    expect(relaxedTurret.maxHealth).toBe(def.health);
    expect(brutalTurret.maxHealth).toBe(def.health);
    expect(brutalTurret.health).toBe(relaxedTurret.health);
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('role: scout', () => {
  it('closes the distance to the player', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 12));
    h.step(60);
    expect(scout.position.z).toBeLessThan(11);
    expect(scout.velocity.z).toBeLessThan(0);
  });

  it('raises the alarm, handing its target to nearby enemies', () => {
    const h = createHarness();
    // The shield is 8 m behind the scout: inside the alarm radius, and 13 m from
    // the player, which is outside its own 13 m aggro sphere once height is
    // taken into account.
    const shield = h.addEnemy('shield', vec3(0, 0, -8));
    const scout = h.addEnemy('scout', vec3(0, 0, 5));
    expect(shield.targetId).toBeNull();

    h.step();
    expect(scout.targetId).toBe(h.player.id);
    expect(shield.targetId).toBe(h.player.id);
    expect(shield.phase).toBe('alert');
  });
});

describe('role: turret', () => {
  it('stays bolted down, turns to face, and fires a spread volley', () => {
    const h = createHarness();
    const turret = h.addEnemy('turret', vec3(0, 0, 10));
    const startX = turret.position.x;
    const startZ = turret.position.z;

    const steps = stepUntil(h, 600, () => h.enemyProjectiles().length > 0);
    expect(steps).toBeGreaterThan(0);

    expect(turret.position.x).toBe(startX);
    expect(turret.position.z).toBe(startZ);
    expect(turret.yaw).toBeCloseTo(yawForDirection(0, -10), 1);

    const shots = h.enemyProjectiles();
    expect(shots.length).toBe(defOf('turret').projectile?.count);
    const angles = shots.map((s) => Math.atan2(s.velocity.x, s.velocity.z));
    expect(new Set(angles.map((a) => a.toFixed(4))).size).toBe(shots.length);
    expect(shots.every((s) => s.counterable)).toBe(true);
    // Accessibility: every shot is announced with a position and a direction.
    expect(h.eventsOfType('combat:fired').length).toBe(shots.length);
  });
});

describe('role: flyer', () => {
  it('hovers above the player and then dives', () => {
    const h = createHarness();
    const flyer = h.addEnemy('flyer', vec3(0, 0.5, 14));

    let maxY = flyer.position.y;
    let minVerticalSpeed = 0;
    for (let i = 0; i < 300; i++) {
      h.step();
      maxY = Math.max(maxY, flyer.position.y);
      minVerticalSpeed = Math.min(minVerticalSpeed, flyer.velocity.y);
    }

    expect(maxY).toBeGreaterThan(FLYER_HOVER_HEIGHT * 0.7);
    expect(minVerticalSpeed).toBeLessThan(-1);
  });

  it('is stopped by geometry rather than flying through it', () => {
    const h = createHarness({ physics: { wallZ: 4 } });
    // Patrols across the wall; the player is out of range, so this is pure
    // navigation.
    const flyer = h.addEnemy('flyer', vec3(0, 2, 0), {
      patrol: [vec3(0, 2, 10)],
    });
    h.player.position.z = -200;
    h.step(120);
    expect(flyer.position.z).toBeLessThan(4);
  });
});

describe('role: shield', () => {
  it('advances, smashes, then drops its plate and stops tracking', () => {
    const h = createHarness();
    const shield = h.addEnemy('shield', vec3(0, 0, 6));
    expect(shield.armour).toBe(defOf('shield').armour);

    h.step(30);
    expect(shield.position.z).toBeLessThan(6);

    const steps = stepUntil(h, 900, () => shield.armour === 0);
    expect(steps).toBeGreaterThan(0);
    expect(shield.phase).toBe('recover');
    expect(h.eventsOfType('fx:shake').length).toBeGreaterThan(0);

    // The opening closes again, so the window is a window and not a permanent
    // state the player can farm.
    const closed = stepUntil(h, 900, () => shield.armour > 0);
    expect(closed).toBeGreaterThan(0);
    expect(shield.armour).toBe(defOf('shield').armour);
  });
});

describe('role: pursuer', () => {
  it('turns no faster than its archetype allows', () => {
    const h = createHarness();
    // Player directly behind: the pursuer must arc around rather than snap.
    const pursuer = h.addEnemy('pursuer', vec3(0, 0, 0), { yaw: 0 });
    h.player.position.z = 10;

    h.step();
    const perStep = defOf('pursuer').turnSpeed * DT;
    expect(Math.abs(pursuer.yaw)).toBeLessThanOrEqual(perStep + 1e-9);
    // Still committed to its old heading, so it is running away this step.
    expect(pursuer.velocity.z).toBeLessThan(0);
  });

  it('still runs the player down once it has come around', () => {
    const h = createHarness();
    const pursuer = h.addEnemy('pursuer', vec3(0, 0, 0), { yaw: 0 });
    h.player.position.z = 10;

    let cameAround = false;
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 600; i++) {
      h.step();
      if (pursuer.velocity.z > 0) cameAround = true;
      closest = Math.min(closest, distanceXZ(pursuer.position, h.player.position));
    }
    expect(cameAround).toBe(true);
    expect(closest).toBeLessThan(defOf('pursuer').attackRadius + 1);
  });
});

describe('role: spawner', () => {
  it('emits tagged children up to its max and no further', () => {
    const h = createHarness();
    const spawner = h.addEnemy('spawner', vec3(0, 0, 0));
    h.player.position.z = 6;

    h.step(900);
    const children = h.world.enemies.filter((e) => e.spawnerId === spawner.id);
    expect(children.length).toBe(defOf('spawner').spawns?.max);
    expect(children.every((c) => c.archetype === 'scout')).toBe(true);
    expect(children.every((c) => c.spawnId === '')).toBe(true);
    expect(spawner.spawnedCount).toBe(children.length);
  });

  it('stops producing once it is being cleansed', () => {
    const h = createHarness();
    const spawner = h.addEnemy('spawner', vec3(0, 0, 0));
    h.player.position.z = 6;
    h.step(120);

    const before = h.world.enemies.filter((e) => e.spawnerId === spawner.id).length;
    expect(before).toBeGreaterThan(0);

    spawner.health = 0;
    h.step();
    expect(spawner.phase).toBe('cleansing');
    expect(spawner.dead).toBe(false);

    h.step(600);
    const after = h.world.enemies.filter((e) => e.spawnerId === spawner.id).length;
    expect(after).toBe(before);
    expect(spawner.dead).toBe(true);
  });
});

describe('role: hazard', () => {
  it('walks its patrol and refuses to chase', () => {
    const h = createHarness();
    const hazard = h.addEnemy('hazard', vec3(0, 0, 0), {
      patrol: [vec3(6, 0, 0), vec3(0, 0, 0)],
    });
    h.player.position.z = 4;

    h.step(60);
    expect(hazard.targetId).toBe(h.player.id);
    expect(hazard.position.x).toBeGreaterThan(1);
    expect(hazard.position.z).toBeCloseTo(0, 6);
  });

  it('reverses at the end of its route so the pattern repeats', () => {
    const h = createHarness();
    const hazard = h.addEnemy('hazard', vec3(0, 0, 0), {
      patrol: [vec3(4, 0, 0), vec3(0, 0, 0)],
    });
    h.player.position.z = 400;

    let furthest = 0;
    for (let i = 0; i < 120; i++) {
      h.step();
      furthest = Math.max(furthest, hazard.position.x);
    }
    expect(furthest).toBeGreaterThan(3);

    h.step(60);
    expect(hazard.position.x).toBeLessThan(furthest - 0.5);
  });
});

describe('role: mimic', () => {
  it('copies the equipped form and re-copies when the player switches', () => {
    const h = createHarness();
    const mimic = h.addEnemy('mimic', vec3(0, 0, 10));

    h.step();
    expect(mimic.mimickedForm).toBe('base');

    h.player.form = 'ember' as ResonanceFormId;
    h.step();
    expect(mimic.mimickedForm).toBe('ember');
  });

  it('fires shots carrying the copied form', () => {
    const h = createHarness();
    h.player.form = 'tidal' as ResonanceFormId;
    h.addEnemy('mimic', vec3(0, 0, 10));

    const steps = stepUntil(h, 600, () => h.enemyProjectiles().length > 0);
    expect(steps).toBeGreaterThan(0);
    const shot = h.enemyProjectiles()[0];
    expect(shot?.form).toBe('tidal');
  });
});

describe('role: elite', () => {
  it('alternates ranged and closing patterns and staggers after a heavy blow', () => {
    const h = createHarness();
    const elite = h.addEnemy('elite', vec3(0, 0, 10));

    let sawStagger = false;
    let sawUnarmoured = false;
    for (let i = 0; i < 1200; i++) {
      h.step();
      if (elite.staggerRemaining > 0) sawStagger = true;
      if (elite.armour === 0) sawUnarmoured = true;
    }

    expect(h.enemyProjectiles().length).toBeGreaterThan(0);
    expect(sawStagger).toBe(true);
    expect(sawUnarmoured).toBe(true);
    expect(h.eventsOfType('combat:playerHurt').length).toBeGreaterThan(0);
    // Health is never touched by the pattern machinery.
    expect(elite.maxHealth).toBe(defOf('elite').health);
  });
});

// ---------------------------------------------------------------------------
// Shared rules
// ---------------------------------------------------------------------------

describe('enemy framework: contact and cleansing', () => {
  it('damages the player on overlap', () => {
    const h = createHarness();
    h.addEnemy('scout', vec3(0, 0, 0.3), { rootedRemaining: 999 });
    h.step();
    expect(h.player.coherence).toBeLessThan(START_COHERENCE);
    const hurt = h.eventsOfType('combat:playerHurt')[0];
    expect(hurt?.source).toContain('scout');
    expect(hurt?.position).toBeDefined();
  });

  it('restores a cleansable unit through a cleansing beat before removing it', () => {
    const h = createHarness();
    const moth = h.addEnemy('moth', vec3(0, 1, 3));
    moth.health = 0;

    h.step();
    expect(moth.phase).toBe('cleansing');
    expect(moth.dead).toBe(false);
    expect(moth.cleanseRemaining).toBeGreaterThan(0);

    h.step(Math.ceil(CLEANSE_SECONDS / DT) + 2);
    expect(moth.phase).toBe('dead');
    expect(moth.dead).toBe(true);
  });

  it('retires a non-cleansable unit immediately', () => {
    const h = createHarness();
    const scout = h.addEnemy('scout', vec3(0, 0, 3));
    scout.health = 0;
    h.step();
    expect(scout.phase).toBe('dead');
    expect(scout.dead).toBe(true);
  });
});

describe('enemy framework: determinism', () => {
  it('replays identically from the same seed', () => {
    const build = (seed: number): Harness => {
      const h = createHarness({ seed });
      h.addEnemy('spawner', vec3(0, 0, 0));
      h.addEnemy('scout', vec3(3, 0, 6));
      h.addEnemy('flyer', vec3(-4, 1, 8));
      h.addEnemy('pursuer', vec3(2, 0, -6));
      h.player.position.z = 5;
      return h;
    };

    const a = build(2024);
    const b = build(2024);
    a.step(400);
    b.step(400);
    expect(snapshot(a.world)).toBe(snapshot(b.world));

    const c = build(777);
    c.step(400);
    // A different seed changes where children are shed, so the worlds diverge.
    expect(snapshot(c.world)).not.toBe(snapshot(a.world));
  });
});
