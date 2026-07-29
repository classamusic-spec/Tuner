import { describe, expect, it } from 'vitest';
import {
  DEG2RAD,
  DIFFICULTY_PROFILES,
  createEventBus,
  createIdAllocator,
  createRng,
  vec3,
} from '@tuner/shared';
import type { DifficultyProfile, EntityId, EventBus, Vec3 } from '@tuner/shared';
import { ACTIONS, createEmptyInputFrame } from '@tuner/input';
import type { Action, ButtonState, InputFrame } from '@tuner/input';
import { Layer } from '@tuner/physics';
import type {
  ColliderDescriptor,
  ColliderHandle,
  PhysicsWorld,
  SweepHit,
} from '@tuner/physics';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import type { AccessibilityConfig, CombatConfig } from '../config.js';
import type {
  BossDef,
  ContentBundle,
  EnemyArchetypeDef,
  StageDef,
} from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { FormBehaviour } from '../forms.js';
import type { SimContext, SimServices } from '../internal/context.js';
import { createSimServices } from '../internal/services.js';
import type {
  MutableEnemy,
  MutablePlayer,
  MutableProjectile,
  MutableResonator,
  MutableWorld,
} from '../internal/world.js';
import {
  AIM_ASSIST_MAX_DEGREES,
  LOCK_ON_MAX_BEND_DEGREES,
  cameraDirectionInto,
  chargeTierFor,
  combatSystem,
  counterWindowSeconds,
  rotateTowardsInto,
} from './combat.js';
import { projectileSystem, sweepSphereAgainstSphere } from './projectiles.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function archetype(partial: Partial<EnemyArchetypeDef> & { id: string }): EnemyArchetypeDef {
  return {
    displayName: partial.id,
    role: 'scout',
    health: 100,
    contactDamage: 5,
    moveSpeed: 4,
    turnSpeed: 5,
    aggroRadius: 20,
    attackRadius: 6,
    telegraphSeconds: 0.5,
    attackCooldown: 1,
    bodyRadius: 0.5,
    bodyHeight: 1.6,
    ...partial,
  };
}

const TEST_ENEMIES: Readonly<Record<string, EnemyArchetypeDef>> = {
  dummy: archetype({ id: 'dummy', health: 100 }),
  plated: archetype({
    id: 'plated',
    health: 200,
    armour: 6,
    armourBreakers: ['charge', 'counter'],
  }),
  // Shares its key with a boss definition, so it inherits that definition's
  // form advantages — the mini-boss-as-enemy case.
  warden: archetype({ id: 'warden', health: 300 }),
};

function bossDef(partial: Partial<BossDef> & { id: string }): BossDef {
  return {
    displayName: partial.id,
    title: 'Test',
    stageId: 'fallen-sanctuary',
    health: 500,
    bodyRadius: 1.5,
    bodyHeight: 4,
    arenaCentre: vec3(),
    arenaRadius: 20,
    phases: [{ index: 1, name: 'One', healthThreshold: 1, attackIds: [], attackInterval: 2 }],
    attacks: [],
    formAdvantages: {},
    ...partial,
  };
}

const TEST_BOSSES: Readonly<Record<string, BossDef>> = {
  warden: bossDef({ id: 'warden', formAdvantages: { ember: 2 } }),
};

const TEST_CONTENT: ContentBundle = {
  stages: {},
  enemies: TEST_ENEMIES,
  bosses: TEST_BOSSES,
};

// ---------------------------------------------------------------------------
// Stub physics
// ---------------------------------------------------------------------------

interface StubOptions {
  /** Solid plane facing +Z; material occupies z < wallZ. Null means empty space. */
  wallZ?: number | null;
}

interface StubPhysics extends PhysicsWorld {
  state: Required<StubOptions>;
  added: ColliderDescriptor[];
  removed: ColliderHandle[];
  sweepCount: number;
}

function createStubPhysics(options: StubOptions = {}): StubPhysics {
  const state: Required<StubOptions> = { wallZ: options.wallZ ?? null };
  const wallHandle: ColliderHandle = {
    id: 7,
    descriptor: {
      id: 'wall',
      shape: { kind: 'box', halfExtents: vec3(50, 50, 1) },
      position: vec3(0, 0, -100),
      layer: Layer.Terrain,
    },
  };
  let nextId = 100;

  const world: StubPhysics = {
    state,
    added: [],
    removed: [],
    sweepCount: 0,

    addCollider(descriptor) {
      world.added.push(descriptor);
      return { id: nextId++, descriptor };
    },
    removeCollider(handle) {
      world.removed.push(handle);
    },
    setColliderTransform() {
      /* no-op */
    },
    clear() {
      /* no-op */
    },
    moveCharacter(params) {
      return {
        position: vec3(params.position.x, params.position.y, params.position.z),
        velocity: vec3(params.velocity.x, params.velocity.y, params.velocity.z),
        grounded: true,
        groundNormal: vec3(0, 1, 0),
        groundCollider: null,
        touchingWall: false,
        wallNormal: vec3(),
        wallCollider: null,
        touchingCeiling: false,
        triggers: [],
      };
    },
    raycast() {
      return null;
    },
    sweepSphere(origin, direction, radius, maxDistance): SweepHit | null {
      world.sweepCount++;
      const wallZ = state.wallZ;
      if (wallZ === null || maxDistance <= 0) return null;
      if (direction.z >= -1e-6) return null;
      const surface = wallZ + radius;
      if (origin.z <= surface) return null;
      const distance = (origin.z - surface) / -direction.z;
      if (distance < 0 || distance > maxDistance) return null;
      return {
        collider: wallHandle,
        normal: vec3(0, 0, 1),
        time: distance / maxDistance,
        point: vec3(
          origin.x + direction.x * distance,
          origin.y + direction.y * distance,
          wallZ,
        ),
      };
    },
    overlapSphere() {
      return [];
    },
    colliders: [],
    stats: { colliderCount: 0, lastQueryCount: 0 },
  };

  return world;
}

// ---------------------------------------------------------------------------
// Input driver
// ---------------------------------------------------------------------------

interface InputDriver {
  press(action: Action): void;
  release(action: Action): void;
  next(dt: number): InputFrame;
}

function createInputDriver(): InputDriver {
  let held = new Set<Action>();
  let previous = new Set<Action>();
  const heldSeconds = new Map<Action, number>();
  let frame = 0;

  return {
    press(action) {
      held.add(action);
    },
    release(action) {
      held.delete(action);
    },
    next(dt) {
      const buttons = {} as Record<Action, ButtonState>;
      for (const action of ACTIONS) {
        const down = held.has(action);
        const wasDown = previous.has(action);
        const seconds = down ? (heldSeconds.get(action) ?? 0) + dt : 0;
        heldSeconds.set(action, seconds);
        buttons[action] = {
          down,
          pressed: down && !wasDown,
          released: !down && wasDown,
          heldSeconds: seconds,
        };
      }
      previous = new Set(held);
      held = new Set(held);
      frame++;
      return {
        moveX: 0,
        moveY: 0,
        lookX: 0,
        lookY: 0,
        buttons,
        requestedFormIndex: null,
        lastDevice: 'gamepad',
        frame,
      };
    },
  };
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

    coherence: 100,
    maxCoherence: 100,
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
      lowestCoherence: 100,
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

let nextEnemyId = 500;

function makeEnemy(
  archetypeId: string,
  position: Vec3,
  overrides: Partial<MutableEnemy> = {},
): MutableEnemy {
  const def = TEST_ENEMIES[archetypeId];
  return {
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
    guardsSecret: null,
    spawnTimer: 0,
    dead: false,
    ...overrides,
  };
}

function makeResonator(
  id: string,
  position: Vec3,
  overrides: Partial<MutableResonator> = {},
): MutableResonator {
  return {
    id,
    puzzleId: 'puzzle-1',
    position: vec3(position.x, position.y, position.z),
    degree: 2,
    order: 0,
    litRemaining: 0,
    holdSeconds: 2,
    requiresForm: null,
    locked: false,
    ...overrides,
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
  'combat:chargeTier',
  'combat:burst',
  'combat:counterWindow',
  'combat:countered',
  'combat:hit',
  'combat:enemyCleansed',
  'combat:playerHurt',
  'combat:playerDowned',
  'combat:lockOnChanged',
  'puzzle:noteStruck',
  'stage:objectiveChanged',
  'ui:subtitle',
  'fx:shake',
  'fx:hitStop',
];

interface Harness {
  ctx: SimContext;
  world: MutableWorld;
  player: MutablePlayer;
  physics: StubPhysics;
  events: EventBus<GameEvents>;
  services: SimServices;
  input: InputDriver;
  combat: CombatConfig;
  step(count?: number): void;
  stepCombatOnly(count?: number): void;
  setCamera(yaw: number, pitch: number): void;
  setAccessibility(patch: Partial<AccessibilityConfig>): void;
  setDifficultyProfile(patch: Partial<DifficultyProfile>): void;
  setFormBehaviour(behaviour: FormBehaviour | null): void;
  setStageDef(def: StageDef | null): void;
  eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][];
  livePlayerProjectiles(): MutableProjectile[];
}

interface HarnessOptions {
  physics?: StubOptions;
  combat?: Partial<CombatConfig>;
  accessibility?: Partial<AccessibilityConfig>;
  difficulty?: Partial<DifficultyProfile>;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const world = createTestWorld();
  const physics = createStubPhysics(options.physics);
  const events = createEventBus<GameEvents>();
  const captured: CapturedEvent[] = [];
  for (const type of TRACKED_EVENTS) {
    events.on(type, (payload: unknown) => {
      captured.push({ type, payload });
    });
  }
  const input = createInputDriver();

  const combat: CombatConfig = { ...DEFAULT_COMBAT_CONFIG, ...options.combat };
  // Assists default off so each one can be switched on deliberately.
  const accessibility: AccessibilityConfig = {
    ...DEFAULT_ACCESSIBILITY_CONFIG,
    aimAssist: 0,
    lockOnAssist: 0,
    ...options.accessibility,
  };
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
    rng: createRng(4242),
    ids: createIdAllocator(9000),
    content: TEST_CONTENT,
    stageDef: null as StageDef | null,
    movement: { ...DEFAULT_MOVEMENT_CONFIG },
    combat,
    camera: { ...DEFAULT_CAMERA_CONFIG },
    accessibility,
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
    input,
    combat,
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        backing.input = input.next(DT);
        combatSystem(ctx);
        projectileSystem(ctx);
        world.tick++;
        world.elapsedSeconds += DT;
      }
    },
    stepCombatOnly(count = 1) {
      for (let i = 0; i < count; i++) {
        backing.input = input.next(DT);
        combatSystem(ctx);
        world.tick++;
        world.elapsedSeconds += DT;
      }
    },
    setCamera(yaw, pitch) {
      backing.cameraYaw = yaw;
      backing.cameraPitch = pitch;
    },
    setAccessibility(patch) {
      Object.assign(backing.accessibility, patch);
    },
    setDifficultyProfile(patch) {
      Object.assign(backing.difficultyProfile, patch);
    },
    setFormBehaviour(behaviour) {
      backing.formBehaviour = behaviour;
    },
    setStageDef(def) {
      backing.stageDef = def;
    },
    eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][] {
      const out: GameEvents[K][] = [];
      for (const entry of captured) {
        if (entry.type === type) out.push(entry.payload as GameEvents[K]);
      }
      return out;
    },
    livePlayerProjectiles() {
      return world.projectiles.filter((p) => !p.dead && p.owner === 'player');
    },
  };
}

function angleBetween(a: Vec3, b: Vec3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.min(1, Math.max(-1, d)));
}

/** Taps fire once: a press edge followed by a release edge. */
function tapFire(h: Harness): void {
  h.input.press('fire');
  h.step();
  h.input.release('fire');
  h.step();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('combat helpers', () => {
  it('derives the camera direction using the movement yaw convention', () => {
    const out = vec3();
    cameraDirectionInto(out, 0, 0);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-1, 9);

    cameraDirectionInto(out, Math.PI / 2, 0);
    expect(out.x).toBeCloseTo(-1, 9);
    expect(out.z).toBeCloseTo(0, 9);

    // Positive pitch looks up, and the result stays a unit vector.
    cameraDirectionInto(out, 0, 0.5);
    expect(out.y).toBeCloseTo(Math.sin(0.5), 9);
    expect(Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z)).toBeCloseTo(1, 9);
  });

  it('maps hold time onto charge tiers at the configured thresholds', () => {
    const thresholds = DEFAULT_COMBAT_CONFIG.chargeTierSeconds;
    expect(chargeTierFor(thresholds, 0)).toBe(0);
    expect(chargeTierFor(thresholds, 0.33)).toBe(0);
    expect(chargeTierFor(thresholds, 0.34)).toBe(1);
    expect(chargeTierFor(thresholds, 0.79)).toBe(2);
    expect(chargeTierFor(thresholds, 5)).toBe(3);
  });

  it('rotates toward a target by at most the given angle', () => {
    const from = vec3(0, 0, -1);
    const to = vec3(1, 0, 0);
    const out = vec3();
    rotateTowardsInto(out, from, to, 10 * DEG2RAD);
    expect(angleBetween(from, out)).toBeCloseTo(10 * DEG2RAD, 6);
    expect(Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z)).toBeCloseTo(1, 9);

    // A generous budget snaps all the way onto the target.
    rotateTowardsInto(out, from, to, Math.PI);
    expect(out.x).toBeCloseTo(1, 9);
  });

  it('sweeps a sphere against a sphere and reports the contact distance', () => {
    const origin = vec3(0, 0, 0);
    const direction = vec3(0, 0, -1);
    const centre = vec3(0, 0, -10);
    expect(sweepSphereAgainstSphere(origin, direction, 20, 0.5, centre, 1)).toBeCloseTo(8.5, 6);
    // Out of reach, and pointing away.
    expect(sweepSphereAgainstSphere(origin, direction, 5, 0.5, centre, 1)).toBe(-1);
    expect(sweepSphereAgainstSphere(origin, vec3(0, 0, 1), 20, 0.5, centre, 1)).toBe(-1);
    // Already overlapping.
    expect(sweepSphereAgainstSphere(origin, direction, 20, 0.5, vec3(0, 0, -0.5), 1)).toBe(0);
  });

  it('widens the counter window with the difficulty bonus', () => {
    const h = createHarness();
    expect(counterWindowSeconds(h.ctx)).toBeCloseTo(h.combat.counterWindowSeconds, 9);
    h.setDifficultyProfile({ counterWindowBonus: 0.12 });
    expect(counterWindowSeconds(h.ctx)).toBeCloseTo(h.combat.counterWindowSeconds + 0.12, 9);
  });
});

// ---------------------------------------------------------------------------
// Resonance Pulse
// ---------------------------------------------------------------------------

describe('resonance pulse', () => {
  it('fires at most one shot per pulseInterval however fast the player taps', () => {
    const h = createHarness();
    const times: number[] = [];
    h.events.on('combat:fired', () => {
      times.push(h.world.tick * DT);
    });

    // Tap as fast as the frame rate allows: one press edge every other step.
    for (let i = 0; i < 120; i++) {
      if (i % 2 === 0) h.input.press('fire');
      else h.input.release('fire');
      h.step();
    }

    const seconds = 120 * DT;
    const maximum = Math.floor(seconds / h.combat.pulseInterval) + 1;
    expect(times.length).toBeGreaterThan(4);
    expect(times.length).toBeLessThanOrEqual(maximum);
    for (let i = 1; i < times.length; i++) {
      const previous = times[i - 1] ?? 0;
      const current = times[i] ?? 0;
      expect(current - previous).toBeGreaterThanOrEqual(h.combat.pulseInterval - 1e-9);
    }
  });

  it('spawns a pulse with the configured damage, speed and channel', () => {
    const h = createHarness();
    tapFire(h);
    const shot = h.world.projectiles[0];
    expect(shot).toBeDefined();
    expect(shot?.damage).toBe(h.combat.pulseDamage);
    expect(shot?.damageKind).toBe('pulse');
    expect(shot?.tier).toBe(0);
    expect(shot?.owner).toBe('player');
    const velocity = shot?.velocity ?? vec3();
    const speed = Math.sqrt(
      velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z,
    );
    // One step of travel has already happened, but speed is constant.
    expect(speed).toBeCloseTo(h.combat.pulseSpeed, 6);
    expect(h.eventsOfType('combat:fired').length).toBe(1);
  });

  it('fires while airborne and while moving — never gated on being grounded', () => {
    const h = createHarness();
    h.player.grounded = false;
    h.player.movementState = 'fall';
    h.player.velocity.x = 9;
    tapFire(h);
    expect(h.eventsOfType('combat:fired').length).toBe(1);
  });

  it('does not fire during a cutscene that takes control away', () => {
    const h = createHarness();
    h.setStageDef({
      id: 'fallen-sanctuary',
      displayName: 'Test',
      subtitle: '',
      description: '',
      infection: 0,
      bpm: 120,
      spawnPoint: vec3(),
      killPlaneY: -100,
      ambience: {
        skyTop: '#000',
        skyBottom: '#000',
        fogColour: '#000',
        fogNear: 1,
        fogFar: 10,
        sunColour: '#fff',
        sunDirection: vec3(0, -1, 0),
        ambientColour: '#111',
      },
      geometry: [],
      movingPlatforms: [],
      rails: [],
      hazards: [],
      enemies: [],
      pickups: [],
      resonators: [],
      puzzles: [],
      doors: [],
      triggers: [],
      checkpoints: [],
      cutscenes: [{ id: 'intro', lines: [], playerControlled: false }],
      tutorials: [],
      parSeconds: 100,
      secretTotal: 0,
    });
    h.world.cutsceneId = 'intro';
    tapFire(h);
    expect(h.eventsOfType('combat:fired').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Charged Chord
// ---------------------------------------------------------------------------

describe('charged chord', () => {
  it('reaches each tier at the configured hold time and announces it', () => {
    const h = createHarness();
    h.input.press('fire');

    h.stepCombatOnly(20); // 0.333 s
    expect(h.player.chargeTier).toBe(0);
    h.stepCombatOnly(1); // 0.35 s
    expect(h.player.chargeTier).toBe(1);
    expect(h.player.isCharging).toBe(true);

    h.stepCombatOnly(27); // 0.80 s
    expect(h.player.chargeTier).toBe(2);

    h.stepCombatOnly(35); // 1.383 s
    expect(h.player.chargeTier).toBe(3);

    const tiers = h.eventsOfType('combat:chargeTier');
    expect(tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
    // Every tier cue carries a position, so the ring can be drawn silently.
    expect(tiers[0]?.position).toBeDefined();
    expect(tiers[0]?.hz).toBeGreaterThan(0);
  });

  it('releases a charged shot using the reached tier numbers', () => {
    const h = createHarness();
    h.input.press('fire');
    h.stepCombatOnly(48); // past tier 2, short of tier 3
    expect(h.player.chargeTier).toBe(2);

    h.input.release('fire');
    h.stepCombatOnly(1);

    const shot = h.world.projectiles[h.world.projectiles.length - 1];
    expect(shot).toBeDefined();
    expect(shot?.damageKind).toBe('charge');
    expect(shot?.tier).toBe(2);
    expect(shot?.damage).toBe(h.combat.chargeTierDamage[1]);
    expect(shot?.radius).toBe(h.combat.chargeTierRadius[1]);
    const velocity = shot?.velocity ?? vec3();
    expect(
      Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z),
    ).toBeCloseTo(h.combat.chargeTierSpeed[1] ?? 0, 6);

    // Charge state is cleared for the next shot.
    expect(h.player.chargeTier).toBe(0);
    expect(h.player.chargeHeldSeconds).toBe(0);
    expect(h.player.isCharging).toBe(false);
  });

  it('releasing below the first tier produces no charged shot', () => {
    const h = createHarness();
    h.input.press('fire');
    h.stepCombatOnly(5);
    h.input.release('fire');
    h.stepCombatOnly(1);
    // Only the tap's pulse.
    expect(h.world.projectiles.length).toBe(1);
    expect(h.world.projectiles[0]?.damageKind).toBe('pulse');
  });

  it('a charged shot breaks armour that a pulse cannot', () => {
    const h = createHarness();
    const enemy = makeEnemy('plated', vec3(0, 0, -5));
    h.world.enemies.push(enemy);

    tapFire(h);
    h.step(12);
    const blockedHits = h.eventsOfType('combat:hit').filter((hit) => hit.blocked);
    expect(blockedHits.length).toBe(1);
    expect(blockedHits[0]?.damage).toBe(0);
    expect(blockedHits[0]?.kind).toBe('pulse');
    expect(enemy.health).toBe(enemy.maxHealth);

    // Now the Charged Chord, which is in the archetype's armourBreakers.
    h.input.press('fire');
    h.step(25);
    h.input.release('fire');
    h.step(20);

    const landed = h.eventsOfType('combat:hit').filter((hit) => !hit.blocked);
    expect(landed.length).toBe(1);
    expect(landed[0]?.kind).toBe('charge');
    expect(enemy.health).toBeCloseTo(enemy.maxHealth - (h.combat.chargeTierDamage[0] ?? 0), 6);
  });
});

// ---------------------------------------------------------------------------
// Harmonic Burst
// ---------------------------------------------------------------------------

describe('harmonic burst', () => {
  it('damages every enemy inside the radius and none outside it', () => {
    const h = createHarness();
    const near = makeEnemy('dummy', vec3(0, 0, -2));
    const alsoNear = makeEnemy('dummy', vec3(1.5, 0, 0.5));
    const far = makeEnemy('dummy', vec3(0, 0, -10));
    h.world.enemies.push(near, alsoNear, far);

    h.input.press('fire');
    h.stepCombatOnly(1);

    expect(h.eventsOfType('combat:burst').length).toBe(1);
    expect(h.eventsOfType('combat:burst')[0]?.radius).toBe(h.combat.burstRadius);
    expect(near.health).toBe(near.maxHealth - h.combat.burstDamage);
    expect(alsoNear.health).toBe(alsoNear.maxHealth - h.combat.burstDamage);
    expect(far.health).toBe(far.maxHealth);
    // The press became a burst rather than a pulse.
    expect(h.world.projectiles.length).toBe(0);
  });

  it('knocks enemies away from the player', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -2));
    h.world.enemies.push(enemy);
    h.input.press('fire');
    h.stepCombatOnly(1);
    expect(enemy.velocity.z).toBeLessThan(-1);
    expect(enemy.velocity.y).toBeGreaterThan(0);
  });

  it('strikes resonators in radius and leaves distant ones alone', () => {
    const h = createHarness();
    h.world.stage.resonators.set('r-near', makeResonator('r-near', vec3(0, 0.5, -2)));
    h.world.stage.resonators.set('r-far', makeResonator('r-far', vec3(0, 0.5, -20)));

    h.input.press('fire');
    h.stepCombatOnly(1);

    const struck = h.eventsOfType('puzzle:noteStruck');
    expect(struck.length).toBe(1);
    expect(struck[0]?.puzzleId).toBe('puzzle-1');
    expect(struck[0]?.degree).toBe(2);
    expect(struck[0]?.hz).toBeGreaterThan(0);
  });

  it('respects burstCooldown, falling back to the pulse', () => {
    const h = createHarness();
    h.world.enemies.push(makeEnemy('dummy', vec3(0, 0, -2)));

    h.input.press('fire');
    h.stepCombatOnly(1);
    h.input.release('fire');
    h.stepCombatOnly(1);
    expect(h.eventsOfType('combat:burst').length).toBe(1);

    // Still inside the cooldown: the second press is an ordinary pulse.
    h.input.press('fire');
    h.stepCombatOnly(1);
    expect(h.eventsOfType('combat:burst').length).toBe(1);
    expect(h.eventsOfType('combat:fired').length).toBe(1);

    // Once the cooldown drains it bursts again.
    h.input.release('fire');
    h.stepCombatOnly(Math.ceil(h.combat.burstCooldown / DT) + 2);
    h.input.press('fire');
    h.stepCombatOnly(1);
    expect(h.eventsOfType('combat:burst').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Lock-on and aim
// ---------------------------------------------------------------------------

describe('lock-on', () => {
  it('selects the nearest enemy inside the cone and ignores nearer ones outside it', () => {
    const h = createHarness();
    const inCone = makeEnemy('dummy', vec3(0, 0, -6));
    const nearerButBehind = makeEnemy('dummy', vec3(2, 0, 1.5));
    h.world.enemies.push(nearerButBehind, inCone);

    h.input.press('lockOn');
    h.stepCombatOnly(1);

    expect(h.player.lockedTarget).toBe(inCone.id);
    const changes = h.eventsOfType('combat:lockOnChanged');
    expect(changes.length).toBe(1);
    expect(changes[0]?.targetId).toBe(inCone.id);
  });

  it('prefers the closer of two in-cone enemies', () => {
    const h = createHarness();
    const far = makeEnemy('dummy', vec3(0, 0, -20));
    const near = makeEnemy('dummy', vec3(0, 0, -6));
    h.world.enemies.push(far, near);
    h.input.press('lockOn');
    h.stepCombatOnly(1);
    expect(h.player.lockedTarget).toBe(near.id);
  });

  it('acquires nothing beyond lockOnRange', () => {
    const h = createHarness();
    h.world.enemies.push(makeEnemy('dummy', vec3(0, 0, -(h.combat.lockOnRange + 5))));
    h.input.press('lockOn');
    h.stepCombatOnly(1);
    expect(h.player.lockedTarget).toBeNull();
    expect(h.eventsOfType('combat:lockOnChanged').length).toBe(0);
  });

  it('releases after lockOnBreakSeconds once the target is gone, not before', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -6));
    h.world.enemies.push(enemy);
    h.input.press('lockOn');
    h.stepCombatOnly(1);
    h.input.release('lockOn');
    expect(h.player.lockedTarget).toBe(enemy.id);

    enemy.dead = true;
    const breakSteps = Math.ceil(h.combat.lockOnBreakSeconds / DT);
    h.stepCombatOnly(breakSteps - 3);
    expect(h.player.lockedTarget).toBe(enemy.id);
    expect(h.player.lockOnLostSeconds).toBeGreaterThan(0);

    h.stepCombatOnly(5);
    expect(h.player.lockedTarget).toBeNull();
    const changes = h.eventsOfType('combat:lockOnChanged');
    expect(changes[changes.length - 1]?.targetId).toBeNull();
  });

  it('toggles off on a second press', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -6));
    h.world.enemies.push(enemy);
    h.input.press('lockOn');
    h.stepCombatOnly(1);
    expect(h.player.lockedTarget).toBe(enemy.id);

    h.input.release('lockOn');
    h.stepCombatOnly(1);
    h.input.press('lockOn');
    h.stepCombatOnly(1);
    expect(h.player.lockedTarget).toBeNull();
    expect(h.eventsOfType('combat:lockOnChanged').length).toBe(2);
  });
});

describe('aim resolution', () => {
  it('is exactly the camera direction with no lock and no aim assist', () => {
    const h = createHarness();
    h.setAccessibility({ aimAssist: 0 });
    h.setCamera(0.7, -0.3);
    // An enemy sits right on the axis: with the assist off it must change nothing.
    h.world.enemies.push(makeEnemy('dummy', vec3(-3, 0, -3)));

    h.stepCombatOnly(1);

    const expected = cameraDirectionInto(vec3(), 0.7, -0.3);
    expect(h.player.aimDirection.x).toBe(expected.x);
    expect(h.player.aimDirection.y).toBe(expected.y);
    expect(h.player.aimDirection.z).toBe(expected.z);
  });

  it('bends toward a nearby enemy by at most aimAssist * the maximum angle', () => {
    const h = createHarness();
    h.setAccessibility({ aimAssist: 0.5 });
    // Ten degrees off the camera axis, at the muzzle's height.
    const offset = 10 * DEG2RAD;
    h.world.enemies.push(
      makeEnemy(
        'dummy',
        vec3(8 * Math.sin(offset), DEFAULT_MOVEMENT_CONFIG.bodyHeight * 0.7 - 0.8, -8 * Math.cos(offset)),
      ),
    );

    h.stepCombatOnly(1);

    const camera = cameraDirectionInto(vec3(), 0, 0);
    const bend = angleBetween(camera, h.player.aimDirection);
    expect(bend).toBeCloseTo(0.5 * AIM_ASSIST_MAX_DEGREES * DEG2RAD, 5);
    expect(bend).toBeLessThan(offset);
  });

  it('puts the aim on a locked target', () => {
    const h = createHarness();
    const offset = 20 * DEG2RAD;
    const enemy = makeEnemy(
      'dummy',
      vec3(10 * Math.sin(offset), DEFAULT_MOVEMENT_CONFIG.bodyHeight * 0.7 - 0.8, -10 * Math.cos(offset)),
    );
    h.world.enemies.push(enemy);
    h.input.press('lockOn');
    h.stepCombatOnly(1);

    expect(h.player.lockedTarget).toBe(enemy.id);
    const camera = cameraDirectionInto(vec3(), 0, 0);
    const bend = angleBetween(camera, h.player.aimDirection);
    expect(bend).toBeCloseTo(offset, 5);
    expect(offset).toBeLessThan(LOCK_ON_MAX_BEND_DEGREES * DEG2RAD);
  });
});

// ---------------------------------------------------------------------------
// Resonance Counter
// ---------------------------------------------------------------------------

function spawnIncomingShot(h: Harness, senderId: EntityId, z: number): MutableProjectile {
  return h.services.spawnProjectile({
    owner: 'enemy',
    ownerId: senderId,
    position: vec3(0, 1.1, z),
    direction: vec3(0, 0, 1),
    speed: 10,
    damage: 12,
    damageKind: 'pulse',
    form: 'base',
    radius: 0.2,
    lifeSeconds: 3,
    counterable: true,
  });
}

describe('resonance counter', () => {
  it('converts a counterable shot inside the window and sends it home', () => {
    const h = createHarness();
    const sender = makeEnemy('dummy', vec3(0, 0, -8));
    h.world.enemies.push(sender);
    h.player.coherence = 50;
    const shot = spawnIncomingShot(h, sender.id, -1.5);

    h.input.press('counter');
    h.stepCombatOnly(1);

    expect(shot.owner).toBe('player');
    expect(shot.reflected).toBe(true);
    expect(shot.damageKind).toBe('counter');
    expect(shot.ownerId).toBe(h.player.id);
    // Heading back at the enemy that fired it.
    expect(shot.velocity.z).toBeLessThan(0);
    expect(h.player.coherence).toBe(50 + h.combat.counterCoherenceReward);
    expect(h.player.counterSuccesses).toBe(1);
    expect(h.player.counterAttempts).toBe(1);

    const countered = h.eventsOfType('combat:countered');
    expect(countered.length).toBe(1);
    expect(countered[0]?.success).toBe(true);
    expect(countered[0]?.converted).toBe(true);

    const windows = h.eventsOfType('combat:counterWindow');
    expect(windows.map((w) => w.opening)).toEqual([true, false]);
  });

  it('does not convert a shot that arrives outside the window', () => {
    const h = createHarness();
    const sender = makeEnemy('dummy', vec3(0, 0, -8));
    h.world.enemies.push(sender);

    // Open and let the window lapse with nothing in reach.
    h.input.press('counter');
    h.stepCombatOnly(1);
    h.input.release('counter');
    h.stepCombatOnly(Math.ceil(counterWindowSeconds(h.ctx) / DT) + 2);
    expect(h.player.counterActive).toBe(false);

    const shot = spawnIncomingShot(h, sender.id, -1.5);
    h.stepCombatOnly(2);

    expect(shot.owner).toBe('enemy');
    expect(shot.reflected).toBe(false);
    expect(h.player.counterSuccesses).toBe(0);
    // The lapsed attempt was still counted.
    expect(h.player.counterAttempts).toBe(1);
  });

  it('never converts a shot the enemy never made counterable', () => {
    const h = createHarness();
    const sender = makeEnemy('dummy', vec3(0, 0, -8));
    h.world.enemies.push(sender);
    const shot = h.services.spawnProjectile({
      owner: 'enemy',
      ownerId: sender.id,
      position: vec3(0, 1.1, -1.5),
      direction: vec3(0, 0, 1),
      speed: 10,
      damage: 12,
      damageKind: 'pulse',
      form: 'base',
      radius: 0.2,
      lifeSeconds: 3,
      counterable: false,
    });

    h.input.press('counter');
    h.stepCombatOnly(1);
    expect(shot.owner).toBe('enemy');
    expect(h.player.counterSuccesses).toBe(0);
  });

  it('enforces counterCooldownSeconds between windows', () => {
    const h = createHarness();
    h.input.press('counter');
    h.stepCombatOnly(1);
    h.input.release('counter');
    h.stepCombatOnly(Math.ceil(counterWindowSeconds(h.ctx) / DT) + 2);
    expect(h.player.counterCooldownRemaining).toBeGreaterThan(0);

    h.input.press('counter');
    h.stepCombatOnly(1);
    h.input.release('counter');
    expect(h.eventsOfType('combat:counterWindow').filter((w) => w.opening).length).toBe(1);
    expect(h.player.counterAttempts).toBe(1);

    h.stepCombatOnly(Math.ceil(h.combat.counterCooldownSeconds / DT) + 2);
    h.input.press('counter');
    h.stepCombatOnly(1);
    expect(h.eventsOfType('combat:counterWindow').filter((w) => w.opening).length).toBe(2);
    expect(h.player.counterAttempts).toBe(2);
  });

  it('widens the window on a forgiving difficulty', () => {
    const h = createHarness({ difficulty: { counterWindowBonus: 0.2 } });
    h.input.press('counter');
    h.stepCombatOnly(1);
    expect(h.player.counterWindowRemaining).toBeGreaterThan(h.combat.counterWindowSeconds);
  });
});

// ---------------------------------------------------------------------------
// Damage rules
// ---------------------------------------------------------------------------

describe('damagePlayer', () => {
  it('applies damage, starts the mercy window and reports it', () => {
    const h = createHarness();
    h.services.damagePlayer(10, 'test', null);
    expect(h.player.coherence).toBe(90);
    expect(h.player.invulnerableRemaining).toBe(h.combat.invulnerableSeconds);
    expect(h.world.stage.damageTaken).toBe(10);
    expect(h.world.stage.lowestCoherence).toBe(90);
    expect(h.player.hurtThisStep).toBe(true);

    const hurt = h.eventsOfType('combat:playerHurt');
    expect(hurt.length).toBe(1);
    expect(hurt[0]?.damage).toBe(10);
    expect(hurt[0]?.coherence).toBe(90);
    expect(hurt[0]?.source).toBe('test');
  });

  it('is a no-op while invulnerable, and works again once it lapses', () => {
    const h = createHarness();
    h.services.damagePlayer(10, 'first', null);
    h.services.damagePlayer(25, 'second', null);
    expect(h.player.coherence).toBe(90);
    expect(h.eventsOfType('combat:playerHurt').length).toBe(1);

    h.stepCombatOnly(Math.ceil(h.combat.invulnerableSeconds / DT) + 1);
    expect(h.player.invulnerableRemaining).toBe(0);
    h.services.damagePlayer(25, 'third', null);
    expect(h.player.coherence).toBe(65);
  });

  it('scales with the difficulty profile', () => {
    const story = createHarness({ difficulty: DIFFICULTY_PROFILES.story });
    story.services.damagePlayer(10, 'test', null);
    expect(story.player.coherence).toBeCloseTo(100 - 10 * 0.4, 6);

    const master = createHarness({ difficulty: DIFFICULTY_PROFILES['resonance-master'] });
    master.services.damagePlayer(10, 'test', null);
    expect(master.player.coherence).toBeCloseTo(100 - 10 * 1.5, 6);
  });

  it('downs the player at zero coherence', () => {
    const h = createHarness();
    h.player.coherence = 5;
    h.services.damagePlayer(20, 'lethal', null);
    expect(h.player.coherence).toBe(0);
    expect(h.player.movementState).toBe('downed');
    expect(h.eventsOfType('combat:playerDowned').length).toBe(1);

    // A downed player takes no further damage.
    h.player.invulnerableRemaining = 0;
    h.services.damagePlayer(20, 'again', null);
    expect(h.eventsOfType('combat:playerHurt').length).toBe(1);
  });
});

describe('damageEnemy', () => {
  it('always emits a hit so the renderer has somewhere to draw', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -5));
    h.world.enemies.push(enemy);
    h.services.damageEnemy(enemy, 15, 'pulse', 'base', vec3(0, 1, -5), vec3(0, 0, 1));
    const hits = h.eventsOfType('combat:hit');
    expect(hits.length).toBe(1);
    expect(hits[0]?.targetId).toBe(enemy.id);
    expect(hits[0]?.position.z).toBe(-5);
    expect(hits[0]?.normal.z).toBe(1);
    expect(hits[0]?.blocked).toBe(false);
    expect(enemy.health).toBe(85);
  });

  it('multiplies damage and flags a weakness on a form advantage', () => {
    const h = createHarness();
    const enemy = makeEnemy('warden', vec3(0, 0, -5));
    h.world.enemies.push(enemy);

    h.player.form = 'ember';
    h.services.damageEnemy(enemy, 20, 'pulse', 'ember', vec3(), vec3(0, 1, 0));
    expect(enemy.health).toBe(enemy.maxHealth - 40);
    expect(h.eventsOfType('combat:hit')[0]?.weakness).toBe(true);

    h.services.damageEnemy(enemy, 20, 'pulse', 'base', vec3(), vec3(0, 1, 0));
    expect(enemy.health).toBe(enemy.maxHealth - 60);
    expect(h.eventsOfType('combat:hit')[1]?.weakness).toBe(false);
  });

  it('cleanses on lethal damage and counts it once', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -5));
    h.world.enemies.push(enemy);
    h.services.damageEnemy(enemy, 500, 'burst', 'base', vec3(), vec3(0, 1, 0));

    expect(enemy.dead).toBe(true);
    expect(enemy.health).toBe(0);
    expect(h.world.stage.enemiesCleansed).toBe(1);
    const cleansed = h.eventsOfType('combat:enemyCleansed');
    expect(cleansed.length).toBe(1);
    expect(cleansed[0]?.archetype).toBe('dummy');

    // A dead enemy absorbs nothing further.
    h.services.damageEnemy(enemy, 100, 'pulse', 'base', vec3(), vec3(0, 1, 0));
    expect(h.world.stage.enemiesCleansed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

describe('projectiles', () => {
  it('despawns a shot when its life expires', () => {
    const h = createHarness();
    h.services.spawnProjectile({
      owner: 'player',
      ownerId: h.player.id,
      position: vec3(0, 1, 0),
      direction: vec3(0, 0, -1),
      speed: 10,
      damage: 5,
      damageKind: 'pulse',
      form: 'base',
      radius: 0.2,
      lifeSeconds: 0.1,
    });
    expect(h.world.projectiles.length).toBe(1);
    h.step(5);
    expect(h.world.projectiles.length).toBe(1);
    h.step(3);
    expect(h.world.projectiles.length).toBe(0);
  });

  it('caps live player shots by retiring the oldest, never the newest', () => {
    const h = createHarness({ combat: { maxPlayerProjectiles: 3 } });
    const ids: EntityId[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        h.services.spawnProjectile({
          owner: 'player',
          ownerId: h.player.id,
          position: vec3(0, 1, 0),
          direction: vec3(0, 0, -1),
          speed: 10,
          damage: 5,
          damageKind: 'pulse',
          form: 'base',
          radius: 0.2,
          lifeSeconds: 5,
        }).id,
      );
    }

    const live = h.livePlayerProjectiles();
    expect(live.length).toBe(3);
    expect(live.map((p) => p.id)).toEqual(ids.slice(2));
    h.step(1);
    expect(h.world.projectiles.length).toBe(3);
  });

  it('a player shot damages an enemy and cleanses it', () => {
    const h = createHarness();
    const enemy = makeEnemy('dummy', vec3(0, 0, -5), { health: 12, maxHealth: 12 });
    h.world.enemies.push(enemy);

    tapFire(h);
    h.step(12);
    expect(enemy.health).toBe(2);
    expect(h.world.projectiles.length).toBe(0);

    tapFire(h);
    h.step(12);
    expect(enemy.dead).toBe(true);
    expect(h.eventsOfType('combat:enemyCleansed').length).toBe(1);
  });

  it('an enemy shot damages the player', () => {
    const h = createHarness();
    const sender = makeEnemy('dummy', vec3(0, 0, -8));
    h.world.enemies.push(sender);
    h.services.spawnProjectile({
      owner: 'enemy',
      ownerId: sender.id,
      position: vec3(0, 0.8, -1),
      direction: vec3(0, 0, 1),
      speed: 10,
      damage: 12,
      damageKind: 'pulse',
      form: 'base',
      radius: 0.2,
      lifeSeconds: 3,
    });

    h.step(10);
    expect(h.player.coherence).toBe(88);
    expect(h.eventsOfType('combat:playerHurt').length).toBe(1);
    expect(h.world.projectiles.length).toBe(0);
  });

  it('bounces off a surface while bounces remain, then stops', () => {
    const h = createHarness({ physics: { wallZ: -3 } });
    const shot = h.services.spawnProjectile({
      owner: 'player',
      ownerId: h.player.id,
      position: vec3(0, 1, 0),
      direction: vec3(0, 0, -1),
      speed: 20,
      damage: 5,
      damageKind: 'pulse',
      form: 'prism',
      radius: 0.2,
      lifeSeconds: 5,
      bounces: 1,
    });

    h.step(12);
    expect(shot.dead).toBe(false);
    expect(shot.bouncesRemaining).toBe(0);
    expect(shot.velocity.z).toBeGreaterThan(0);

    // With no bounces left the next surface contact retires it.
    shot.velocity.z = -20;
    h.step(30);
    expect(h.world.projectiles.length).toBe(0);
  });

  it('detaches echo repeats from the shooter on the echo delay', () => {
    const h = createHarness();
    h.services.spawnProjectile({
      owner: 'player',
      ownerId: h.player.id,
      position: vec3(0, 1.12, 0),
      direction: vec3(0, 0, -1),
      speed: 20,
      damage: 8,
      damageKind: 'pulse',
      form: 'echo',
      radius: 0.2,
      lifeSeconds: 5,
      echoes: 2,
    });

    h.step(10);
    expect(h.world.projectiles.length).toBe(2);
    h.step(10);
    expect(h.world.projectiles.length).toBe(3);
    h.step(30);
    // The chain is linear: two repeats and no more.
    expect(h.world.projectiles.length).toBe(3);
    expect(h.world.projectiles[0]?.echoesRemaining).toBe(0);
  });

  it('runs the equipped form hook when a shot ends, and only for that form', () => {
    const h = createHarness();
    let ends = 0;
    const behaviour: FormBehaviour = {
      id: 'bloom',
      onProjectileEnd(context) {
        ends++;
        context.spawnPlatform(context.position, 1, 4);
      },
    };
    h.setFormBehaviour(behaviour);

    h.services.spawnProjectile({
      owner: 'player',
      ownerId: h.player.id,
      position: vec3(0, 1, 0),
      direction: vec3(0, 0, -1),
      speed: 10,
      damage: 5,
      damageKind: 'pulse',
      form: 'base',
      radius: 0.2,
      lifeSeconds: 0.1,
    });
    h.step(10);
    expect(ends).toBe(0);

    h.services.spawnProjectile({
      owner: 'player',
      ownerId: h.player.id,
      position: vec3(0, 1, 0),
      direction: vec3(0, 0, -1),
      speed: 10,
      damage: 5,
      damageKind: 'pulse',
      form: 'bloom',
      radius: 0.2,
      lifeSeconds: 0.1,
    });
    h.step(10);
    expect(ends).toBe(1);
    expect(h.world.conjured.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Services odds and ends
// ---------------------------------------------------------------------------

describe('sim services', () => {
  it('gives a conjured platform a real collider and takes it back on expiry', () => {
    const h = createHarness();
    h.services.spawnConjuredPlatform(vec3(1, 2, 3), 1.2, 0.5, 'echo');

    expect(h.world.conjured.length).toBe(1);
    expect(h.physics.added.length).toBe(1);
    expect(h.physics.added[0]?.layer).toBe(Layer.MovingPlatform);
    expect(h.world.conjured[0]?.collider).not.toBeNull();

    h.step(Math.ceil(0.5 / DT) + 2);
    expect(h.world.conjured.length).toBe(0);
    expect(h.physics.removed.length).toBe(1);
  });

  it('clamps restored coherence to the maximum', () => {
    const h = createHarness();
    h.player.coherence = 95;
    h.services.restoreCoherence(20);
    expect(h.player.coherence).toBe(100);
    h.player.coherence = 40;
    h.services.restoreCoherence(15);
    expect(h.player.coherence).toBe(55);
  });

  it('scales shake by the accessibility setting and suppresses it at zero', () => {
    const h = createHarness();
    h.setAccessibility({ screenShakeScale: 0.5 });
    h.services.requestShake(1, 0.2);
    expect(h.eventsOfType('fx:shake')[0]?.magnitude).toBeCloseTo(0.5, 9);
    expect(h.world.camera.shake).toBeCloseTo(0.5, 9);

    h.setAccessibility({ screenShakeScale: 0 });
    h.services.requestShake(1, 0.2);
    expect(h.eventsOfType('fx:shake').length).toBe(1);
  });

  it('finds the nearest enemy inside a cone and nothing outside it', () => {
    const h = createHarness();
    const ahead = makeEnemy('dummy', vec3(0, 0, -5));
    const behind = makeEnemy('dummy', vec3(0, 0, 3));
    h.world.enemies.push(ahead, behind);

    const origin = vec3(0, 0.8, 0);
    expect(h.services.findNearestEnemy(origin, vec3(0, 0, -1), 20, 45)?.id).toBe(ahead.id);
    expect(h.services.findNearestEnemy(origin, vec3(0, 0, -1), 3, 45)).toBeNull();
    expect(h.services.findNearestEnemy(origin, vec3(1, 0, 0), 20, 20)).toBeNull();

    ahead.dead = true;
    expect(h.services.findNearestEnemy(origin, vec3(0, 0, -1), 20, 45)).toBeNull();
  });

  it('tracks stage flags, objectives and subtitles', () => {
    const h = createHarness();
    expect(h.services.hasStageFlag('door-open')).toBe(false);
    h.services.setStageFlag('door-open');
    expect(h.services.hasStageFlag('door-open')).toBe(true);

    h.services.setObjective('Reach the vault');
    h.services.setObjective('Reach the vault');
    const objectives = h.eventsOfType('stage:objectiveChanged');
    expect(objectives.length).toBe(1);
    expect(objectives[0]?.objective).toBe('Reach the vault');
    expect(h.world.stage.objective).toBe('Reach the vault');

    h.services.showSubtitle('Keeper', 'The chord is broken.', 3);
    const subtitles = h.eventsOfType('ui:subtitle');
    expect(subtitles.length).toBe(1);
    expect(subtitles[0]?.speaker).toBe('Keeper');
  });

  it('holds resonance sight while the action is held', () => {
    const h = createHarness();
    h.input.press('resonanceSight');
    h.stepCombatOnly(1);
    expect(h.player.resonanceSightActive).toBe(true);
    h.input.release('resonanceSight');
    h.stepCombatOnly(1);
    expect(h.player.resonanceSightActive).toBe(false);
  });

  it('does nothing at all while the world is paused', () => {
    const h = createHarness();
    h.world.paused = true;
    h.input.press('fire');
    h.step(20);
    expect(h.world.projectiles.length).toBe(0);
    expect(h.player.chargeTier).toBe(0);
    expect(h.eventsOfType('combat:fired').length).toBe(0);
  });
});
