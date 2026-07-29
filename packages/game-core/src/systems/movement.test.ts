import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_PROFILES,
  GRAVITY,
  createEventBus,
  createIdAllocator,
  createRng,
  vec3,
} from '@tuner/shared';
import type { DifficultyProfile, EventBus, Vec3 } from '@tuner/shared';
import { ACTIONS, createEmptyInputFrame } from '@tuner/input';
import type { Action, ButtonState, InputFrame } from '@tuner/input';
import type {
  CharacterMoveParams,
  ColliderDescriptor,
  ColliderHandle,
  MoveResult,
  PhysicsWorld,
  RaycastHit,
} from '@tuner/physics';
import { Layer } from '@tuner/physics';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import type { AccessibilityConfig, MovementConfig } from '../config.js';
import type { ContentBundle, StageDef } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { SimContext, SimServices } from '../internal/context.js';
import type { MutablePlayer, MutableWorld } from '../internal/world.js';
import {
  MAX_JUMPS,
  cameraRelativeMoveInto,
  jumpVelocityForHeight,
  movementSystem,
  sampleRail,
  targetSpeedFor,
} from './movement.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Stub physics world
// ---------------------------------------------------------------------------

interface StubOptions {
  floorEnabled?: boolean;
  floorY?: number;
  floorMinX?: number;
  floorMaxX?: number;
  floorBounce?: number;
  /** Vertical plane facing +X; solid material occupies x < wallX. */
  wallX?: number | null;
  /** Top of the wall block. Infinity means "wall with no reachable top". */
  wallTopY?: number;
}

interface StubPhysics extends PhysicsWorld {
  readonly state: Required<StubOptions>;
  raycastCount: number;
  moveCount: number;
}

function makeHandle(id: number, descriptor: ColliderDescriptor): ColliderHandle {
  return { id, descriptor };
}

function createStubPhysics(options: StubOptions = {}): StubPhysics {
  const state: Required<StubOptions> = {
    floorEnabled: options.floorEnabled ?? true,
    floorY: options.floorY ?? 0,
    floorMinX: options.floorMinX ?? -1e6,
    floorMaxX: options.floorMaxX ?? 1e6,
    floorBounce: options.floorBounce ?? 0,
    wallX: options.wallX ?? null,
    wallTopY: options.wallTopY ?? Number.POSITIVE_INFINITY,
  };

  const wallHandle = makeHandle(2, {
    id: 'wall',
    shape: { kind: 'box', halfExtents: vec3(10, 10, 10) },
    position: vec3(),
    layer: Layer.Terrain,
  });

  const floorHandle = (): ColliderHandle =>
    makeHandle(1, {
      id: 'floor',
      shape: { kind: 'box', halfExtents: vec3(1000, 1, 1000) },
      position: vec3(0, state.floorY - 1, 0),
      layer: Layer.Terrain,
      bounce: state.floorBounce,
    });

  const world: StubPhysics = {
    state,
    raycastCount: 0,
    moveCount: 0,

    addCollider(descriptor) {
      return makeHandle(99, descriptor);
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

    moveCharacter(params: CharacterMoveParams): MoveResult {
      world.moveCount++;
      const dt = params.deltaSeconds;
      let vx = params.velocity.x;
      let vy = params.velocity.y;
      const vz = params.velocity.z;
      let px = params.position.x + vx * dt;
      let py = params.position.y + vy * dt;
      const pz = params.position.z + vz * dt;

      let touchingWall = false;
      const wallNormal = vec3();
      let wallCollider: ColliderHandle | null = null;

      if (state.wallX !== null) {
        const limit = state.wallX + params.radius;
        if (px < limit && py < state.wallTopY) {
          px = limit;
          if (vx < 0) vx = 0;
          touchingWall = true;
          wallNormal.x = 1;
          wallCollider = wallHandle;
        } else if (px <= limit + 0.02 && vx <= 0.001 && py < state.wallTopY) {
          // Resting contact: the capsule is still touching the skin.
          touchingWall = true;
          wallNormal.x = 1;
          wallCollider = wallHandle;
        }
      }

      let grounded = false;
      let groundCollider: ColliderHandle | null = null;

      // The top face of the wall block is walkable, which is what a mantle
      // lands on.
      if (
        state.wallX !== null &&
        Number.isFinite(state.wallTopY) &&
        px < state.wallX &&
        py <= state.wallTopY &&
        vy <= 0
      ) {
        py = state.wallTopY;
        vy = 0;
        grounded = true;
        groundCollider = wallHandle;
      } else if (
        state.floorEnabled &&
        px >= state.floorMinX &&
        px <= state.floorMaxX &&
        py <= state.floorY &&
        vy <= 0
      ) {
        py = state.floorY;
        vy = 0;
        grounded = true;
        groundCollider = floorHandle();
      }

      return {
        position: vec3(px, py, pz),
        velocity: vec3(vx, vy, vz),
        grounded,
        groundNormal: vec3(0, 1, 0),
        groundCollider,
        touchingWall,
        wallNormal,
        wallCollider,
        touchingCeiling: false,
        triggers: [],
      };
    },

    raycast(origin: Vec3, direction: Vec3, maxDistance: number): RaycastHit | null {
      world.raycastCount++;
      if (direction.y > -0.5) return null;

      if (state.wallX !== null && Number.isFinite(state.wallTopY) && origin.x < state.wallX) {
        const distance = origin.y - state.wallTopY;
        if (distance >= 0 && distance <= maxDistance) {
          return {
            collider: wallHandle,
            point: vec3(origin.x, state.wallTopY, origin.z),
            normal: vec3(0, 1, 0),
            distance,
          };
        }
      }

      if (state.floorEnabled && origin.x >= state.floorMinX && origin.x <= state.floorMaxX) {
        const distance = origin.y - state.floorY;
        if (distance >= 0 && distance <= maxDistance) {
          return {
            collider: floorHandle(),
            point: vec3(origin.x, state.floorY, origin.z),
            normal: vec3(0, 1, 0),
            distance,
          };
        }
      }
      return null;
    },

    sweepSphere() {
      return null;
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
  moveX: number;
  moveY: number;
  press(action: Action): void;
  release(action: Action): void;
  next(dt: number): InputFrame;
}

function createInputDriver(): InputDriver {
  let held = new Set<Action>();
  let previous = new Set<Action>();
  const heldSeconds = new Map<Action, number>();
  let frame = 0;

  const driver: InputDriver = {
    moveX: 0,
    moveY: 0,
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
        moveX: driver.moveX,
        moveY: driver.moveY,
        lookX: 0,
        lookY: 0,
        buttons,
        requestedFormIndex: null,
        lastDevice: 'gamepad',
        frame,
      };
    },
  };
  return driver;
}

// ---------------------------------------------------------------------------
// World / context harness
// ---------------------------------------------------------------------------

function createPlayer(movement: MovementConfig): MutablePlayer {
  return {
    id: 1 as MutablePlayer['id'],
    position: vec3(0, 0, 0),
    velocity: vec3(0, 0, 0),
    yaw: 0,
    targetYaw: 0,
    movementState: 'idle',
    previousMovementState: 'idle',
    stateTime: 0,

    grounded: true,
    wasGrounded: true,
    groundNormal: vec3(0, 1, 0),
    groundCollider: null,
    platformVelocity: vec3(0, 0, 0),

    coyoteRemaining: movement.coyoteSeconds,
    jumpBufferRemaining: 0,
    jumpsRemaining: MAX_JUMPS,
    jumpHeld: false,
    dashesRemaining: movement.airDashCount,
    dashCooldown: 0,
    dashTimeRemaining: 0,
    dashDirection: vec3(0, 0, -1),
    slideTimeRemaining: 0,
    inputLockRemaining: 0,

    touchingWall: false,
    wallNormal: null,
    wallClingRemaining: movement.wallClingSeconds,
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

function createWorld(movement: MovementConfig): MutableWorld {
  return {
    tick: 0,
    elapsedSeconds: 0,
    difficulty: 'standard',
    player: createPlayer(movement),
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

const EMPTY_CONTENT: ContentBundle = { stages: {}, enemies: {}, bosses: {} };

function makeStageDef(partial: Partial<StageDef>): StageDef {
  return {
    id: 'fallen-sanctuary',
    displayName: 'Test Stage',
    subtitle: '',
    description: '',
    infection: 0.5,
    bpm: 120,
    spawnPoint: vec3(),
    killPlaneY: -100,
    ambience: {
      skyTop: '#000',
      skyBottom: '#000',
      fogColour: '#000',
      fogNear: 1,
      fogFar: 100,
      sunColour: '#fff',
      sunDirection: vec3(0, -1, 0),
      ambientColour: '#222',
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
    cutscenes: [],
    tutorials: [],
    parSeconds: 300,
    secretTotal: 0,
    ...partial,
  };
}

interface CapturedEvent {
  type: keyof GameEvents;
  payload: unknown;
}

interface Harness {
  ctx: SimContext;
  world: MutableWorld;
  player: MutablePlayer;
  physics: StubPhysics;
  events: EventBus<GameEvents>;
  captured: CapturedEvent[];
  input: InputDriver;
  movement: MovementConfig;
  setCameraYaw(yaw: number): void;
  setStageDef(def: StageDef | null): void;
  setAccessibility(patch: Partial<AccessibilityConfig>): void;
  setDifficultyProfile(patch: Partial<DifficultyProfile>): void;
  step(count?: number, dt?: number): void;
  eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][];
}

interface HarnessOptions {
  physics?: StubOptions;
  movement?: Partial<MovementConfig>;
  accessibility?: Partial<AccessibilityConfig>;
  difficulty?: Partial<DifficultyProfile>;
}

const TRACKED_EVENTS: (keyof GameEvents)[] = [
  'player:stateChanged',
  'player:jumped',
  'player:dashed',
  'player:landed',
  'player:wallCling',
  'player:ledgeGrabbed',
  'player:bounced',
  'player:railDetached',
];

function createHarness(options: HarnessOptions = {}): Harness {
  const movement: MovementConfig = { ...DEFAULT_MOVEMENT_CONFIG, ...options.movement };
  const accessibility: AccessibilityConfig = {
    ...DEFAULT_ACCESSIBILITY_CONFIG,
    ...options.accessibility,
  };
  // Tests default to no difficulty-driven assists so each assist can be
  // switched on deliberately.
  const difficultyProfile: DifficultyProfile = {
    ...DIFFICULTY_PROFILES.standard,
    coyoteBonus: 0,
    landingAssist: 0,
    ...options.difficulty,
  };

  const world = createWorld(movement);
  const physics = createStubPhysics(options.physics);
  const events = createEventBus<GameEvents>();
  const captured: CapturedEvent[] = [];
  for (const type of TRACKED_EVENTS) {
    events.on(type, (payload: unknown) => {
      captured.push({ type, payload });
    });
  }
  const input = createInputDriver();

  const backing = {
    world,
    physics,
    events,
    input: createEmptyInputFrame(),
    dt: DT,
    rawDt: DT,
    rng: createRng(1234),
    ids: createIdAllocator(100),
    content: EMPTY_CONTENT,
    stageDef: null as StageDef | null,
    movement,
    combat: { ...DEFAULT_COMBAT_CONFIG },
    camera: { ...DEFAULT_CAMERA_CONFIG },
    accessibility,
    difficultyProfile,
    formBehaviour: null,
    cameraYaw: 0,
    cameraPitch: 0,
    services: {} as unknown as SimServices,
  };

  const ctx = backing as unknown as SimContext;

  return {
    ctx,
    world,
    player: world.player,
    physics,
    events,
    captured,
    input,
    movement,
    setCameraYaw(yaw) {
      backing.cameraYaw = yaw;
    },
    setStageDef(def) {
      backing.stageDef = def;
    },
    setAccessibility(patch) {
      Object.assign(backing.accessibility, patch);
    },
    setDifficultyProfile(patch) {
      Object.assign(backing.difficultyProfile, patch);
    },
    step(count = 1, dt = DT) {
      for (let i = 0; i < count; i++) {
        backing.dt = dt;
        backing.rawDt = dt;
        backing.input = input.next(dt);
        movementSystem(ctx);
        world.tick++;
        world.elapsedSeconds += dt;
      }
    },
    eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][] {
      const out: GameEvents[K][] = [];
      for (const entry of captured) {
        if (entry.type === type) out.push(entry.payload as GameEvents[K]);
      }
      return out;
    },
  };
}

function horizontalSpeed(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

/** Puts the player in a clean airborne state at the given height. */
function makeAirborne(h: Harness, y: number, jumps = MAX_JUMPS): void {
  h.player.position.y = y;
  h.player.grounded = false;
  h.player.wasGrounded = false;
  h.player.coyoteRemaining = 0;
  h.player.jumpsRemaining = jumps;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('movement helpers', () => {
  it('derives jump velocity from height and gravity', () => {
    const v = jumpVelocityForHeight(3.05);
    expect(v).toBeCloseTo(Math.sqrt(2 * Math.abs(GRAVITY) * 3.05), 6);
    // Round trip: v^2 / 2g must return the height.
    expect((v * v) / (2 * Math.abs(GRAVITY))).toBeCloseTo(3.05, 6);
  });

  it('maps stick input into camera space so forward is away from the camera', () => {
    const out = vec3();
    cameraRelativeMoveInto(out, 0, 1, 0);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-1, 6);

    cameraRelativeMoveInto(out, 0, 1, Math.PI / 2);
    expect(out.x).toBeCloseTo(-1, 6);
    expect(out.z).toBeCloseTo(0, 6);

    cameraRelativeMoveInto(out, 1, 0, 0);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('picks walk / run / sprint tiers from the analogue magnitude', () => {
    const cfg = DEFAULT_MOVEMENT_CONFIG;
    expect(targetSpeedFor(cfg, 0, false)).toBe(0);
    expect(targetSpeedFor(cfg, 0.55, false)).toBeCloseTo(cfg.walkSpeed, 6);
    expect(targetSpeedFor(cfg, 1, false)).toBeCloseTo(cfg.runSpeed, 6);
    expect(targetSpeedFor(cfg, 1, true)).toBeCloseTo(cfg.sprintSpeed, 6);
    expect(targetSpeedFor(cfg, 0.3, false)).toBeLessThan(cfg.walkSpeed);
  });

  it('samples a rail polyline by arc length', () => {
    const points = [vec3(0, 0, 0), vec3(10, 0, 0), vec3(10, 0, 10)];
    const pos = vec3();
    const tan = vec3();
    const total = sampleRail(points, 0.5, pos, tan);
    expect(total).toBeCloseTo(20, 6);
    expect(pos.x).toBeCloseTo(10, 6);
    expect(pos.z).toBeCloseTo(0, 6);
    sampleRail(points, 0.75, pos, tan);
    expect(pos.x).toBeCloseTo(10, 6);
    expect(pos.z).toBeCloseTo(5, 6);
    expect(tan.z).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// Ground movement
// ---------------------------------------------------------------------------

describe('ground movement', () => {
  it('moves away from the camera when the stick pushes forward', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.step(60);
    expect(h.player.position.z).toBeLessThan(-6);
    expect(Math.abs(h.player.position.x)).toBeLessThan(1e-6);
  });

  it('is camera-relative: rotating the camera rotates the movement', () => {
    const h = createHarness();
    h.setCameraYaw(Math.PI / 2);
    h.input.moveY = 1;
    h.step(60);
    expect(h.player.position.x).toBeLessThan(-6);
    expect(Math.abs(h.player.position.z)).toBeLessThan(1e-6);
  });

  it('reaches walk speed on a light stick and run speed on a full stick', () => {
    const walk = createHarness();
    walk.input.moveY = 0.3;
    walk.step(90);
    const expectedWalk = targetSpeedFor(walk.movement, 0.3, false);
    expect(horizontalSpeed(walk.player.velocity)).toBeCloseTo(expectedWalk, 3);
    expect(walk.player.movementState).toBe('walk');

    const run = createHarness();
    run.input.moveY = 1;
    run.step(90);
    expect(horizontalSpeed(run.player.velocity)).toBeCloseTo(run.movement.runSpeed, 3);
    expect(run.player.movementState).toBe('run');
  });

  it('sprints while the dash button is held past the sprint threshold', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.input.press('dash');
    h.step(90);
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(h.movement.sprintSpeed, 2);
    expect(h.player.movementState).toBe('sprint');
  });

  it('turns the character toward the movement direction', () => {
    const h = createHarness();
    h.input.moveX = 1;
    h.step(30);
    // right = +X, and yaw is measured from -Z, so facing +X is -PI/2.
    expect(h.player.yaw).toBeCloseTo(-Math.PI / 2, 3);
  });

  it('decelerates to a stop when the stick is released', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.step(60);
    h.input.moveY = 0;
    h.step(60);
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(0, 6);
    expect(h.player.movementState).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Jumping
// ---------------------------------------------------------------------------

describe('jumping', () => {
  it('reaches roughly movement.jumpHeight when the button is held', () => {
    const h = createHarness();
    h.input.press('jump');
    let apex = 0;
    for (let i = 0; i < 120; i++) {
      h.step();
      apex = Math.max(apex, h.player.position.y);
    }
    const error = Math.abs(apex - h.movement.jumpHeight) / h.movement.jumpHeight;
    expect(error).toBeLessThan(0.1);
  });

  it('produces a measurably lower apex when the button is released early', () => {
    const measure = (holdSteps: number): number => {
      const h = createHarness();
      h.input.press('jump');
      let apex = 0;
      for (let i = 0; i < 120; i++) {
        if (i === holdSteps) h.input.release('jump');
        h.step();
        apex = Math.max(apex, h.player.position.y);
      }
      return apex;
    };
    const held = measure(1000);
    const cut = measure(4);
    expect(cut).toBeLessThan(held * 0.8);
    expect(cut).toBeGreaterThan(0.2);
  });

  it('falls faster than it rises because of fallGravityScale', () => {
    const h = createHarness();
    h.input.press('jump');
    h.step();
    h.input.release('jump');
    // Keep the button held so the jump cut does not muddy the comparison.
    const h2 = createHarness();
    h2.input.press('jump');
    let riseSteps = 0;
    let fallSteps = 0;
    let rising = true;
    for (let i = 0; i < 200; i++) {
      h2.step();
      if (rising) {
        riseSteps++;
        if (h2.player.velocity.y <= 0) rising = false;
      } else {
        fallSteps++;
        if (h2.player.grounded) break;
      }
    }
    expect(fallSteps).toBeGreaterThan(0);
    expect(fallSteps).toBeLessThan(riseSteps);
  });

  it('clamps descent to maxFallSpeed', () => {
    const h = createHarness({ physics: { floorEnabled: false } });
    makeAirborne(h, 500);
    h.step(180);
    expect(h.player.velocity.y).toBeCloseTo(-h.movement.maxFallSpeed, 6);
  });

  it('honours coyote time: a jump inside the window is still a ground jump', () => {
    const h = createHarness();
    h.step(2); // settle, grounded
    h.physics.state.floorEnabled = false;
    h.step(1); // now airborne, coyote running
    h.step(2);
    h.input.press('jump');
    h.step();
    const jumps = h.eventsOfType('player:jumped');
    expect(jumps.length).toBe(1);
    expect(jumps[0]?.doubleJump).toBe(false);
    expect(h.player.velocity.y).toBeGreaterThan(jumpVelocityForHeight(h.movement.jumpHeight) - 0.6);
  });

  it('honours coyote time: past the window the ground jump is gone', () => {
    const h = createHarness();
    h.step(2);
    h.physics.state.floorEnabled = false;
    h.step(1);
    // Simulate a player who has no air jump left, so only coyote could save them.
    h.player.jumpsRemaining = 1;
    const window = h.movement.coyoteSeconds;
    h.step(Math.ceil(window / DT) + 3);
    expect(h.player.jumpsRemaining).toBe(0);
    h.input.press('jump');
    h.step(3);
    expect(h.eventsOfType('player:jumped').length).toBe(0);
  });

  it('buffers a jump pressed shortly before landing', () => {
    const h = createHarness();
    makeAirborne(h, 0.4, 0);
    h.player.velocity.y = -6;
    h.input.press('jump');
    h.step();
    h.input.release('jump');
    expect(h.eventsOfType('player:jumped').length).toBe(0);
    h.step(6);
    const jumps = h.eventsOfType('player:jumped');
    expect(jumps.length).toBe(1);
    expect(jumps[0]?.doubleJump).toBe(false);
    expect(h.eventsOfType('player:landed').length).toBe(1);
  });

  it('drops a buffered jump once jumpBufferSeconds elapses', () => {
    const h = createHarness();
    makeAirborne(h, 4, 0);
    h.input.press('jump');
    h.step();
    h.input.release('jump');
    h.step(120);
    expect(h.eventsOfType('player:landed').length).toBe(1);
    expect(h.eventsOfType('player:jumped').length).toBe(0);
  });

  it('spends the double jump once and refreshes it on landing', () => {
    const h = createHarness();
    makeAirborne(h, 30, 1);
    h.input.press('jump');
    h.step();
    h.input.release('jump');
    let jumps = h.eventsOfType('player:jumped');
    expect(jumps.length).toBe(1);
    expect(jumps[0]?.doubleJump).toBe(true);
    expect(h.player.jumpsRemaining).toBe(0);

    // A second air press does nothing.
    h.step(10);
    h.input.press('jump');
    h.step();
    h.input.release('jump');
    expect(h.eventsOfType('player:jumped').length).toBe(1);

    // Land, and the ground jump is back.
    h.step(240);
    expect(h.player.grounded).toBe(true);
    expect(h.player.jumpsRemaining).toBe(MAX_JUMPS);
    h.input.press('jump');
    h.step();
    jumps = h.eventsOfType('player:jumped');
    expect(jumps.length).toBe(2);
    expect(jumps[1]?.doubleJump).toBe(false);
  });

  it('emits landed with the impact speed', () => {
    const h = createHarness();
    makeAirborne(h, 5, 0);
    h.step(120);
    const landings = h.eventsOfType('player:landed');
    expect(landings.length).toBe(1);
    expect(landings[0]?.impactSpeed ?? 0).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Dash
// ---------------------------------------------------------------------------

describe('dash', () => {
  it('bursts at dashSpeed for dashSeconds', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.step(30); // build up a run first
    h.input.press('dash');
    h.step();
    h.input.release('dash');
    expect(h.player.movementState).toBe('dash');
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(h.movement.dashSpeed, 6);

    const stepsInDash = Math.floor(h.movement.dashSeconds / DT) - 1;
    h.step(stepsInDash);
    expect(h.player.dashTimeRemaining).toBeGreaterThan(0);
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(h.movement.dashSpeed, 6);

    h.step(3);
    expect(h.player.dashTimeRemaining).toBe(0);
    expect(h.player.movementState).not.toBe('dash');
  });

  it('respects dashCooldownSeconds between dashes', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.input.press('dash');
    h.step();
    h.input.release('dash');
    expect(h.eventsOfType('player:dashed').length).toBe(1);

    // Immediately after the burst ends the cooldown is still running.
    h.step(Math.ceil(h.movement.dashSeconds / DT) + 1);
    h.input.press('dash');
    h.step();
    h.input.release('dash');
    expect(h.eventsOfType('player:dashed').length).toBe(1);

    // Once the cooldown drains, it fires again.
    h.step(Math.ceil(h.movement.dashCooldownSeconds / DT) + 2);
    h.input.press('dash');
    h.step();
    expect(h.eventsOfType('player:dashed').length).toBe(2);
  });

  it('refreshes the air dash count on landing', () => {
    const h = createHarness({ movement: { airDashCount: 1 } });
    makeAirborne(h, 40, 0);
    h.player.dashesRemaining = 1;
    h.input.moveY = 1;
    h.input.press('dash');
    h.step();
    h.input.release('dash');
    expect(h.player.dashesRemaining).toBe(0);
    expect(h.eventsOfType('player:dashed')[0]?.airborne).toBe(true);
    expect(h.player.movementState).toBe('airDash');

    // No air dash left: a second press is ignored even after the cooldown.
    h.step(60);
    h.input.press('dash');
    h.step();
    h.input.release('dash');
    expect(h.eventsOfType('player:dashed').length).toBe(1);

    h.step(300);
    expect(h.player.grounded).toBe(true);
    expect(h.player.dashesRemaining).toBe(1);
  });

  it('dashes along the facing direction when the stick is centred', () => {
    const h = createHarness();
    h.player.yaw = 0;
    h.player.targetYaw = 0;
    h.input.press('dash');
    h.step();
    expect(h.player.dashDirection.z).toBeCloseTo(-1, 6);
    expect(h.player.velocity.z).toBeCloseTo(-h.movement.dashSpeed, 6);
  });
});

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

describe('wall cling and wall jump', () => {
  function wallHarness(): Harness {
    const h = createHarness({ physics: { wallX: 0, floorEnabled: false } });
    h.player.position.x = DEFAULT_MOVEMENT_CONFIG.bodyRadius;
    makeAirborne(h, 10, 1);
    h.player.velocity.x = -3;
    h.input.moveX = -1;
    return h;
  }

  it('clings to a near-vertical wall and slides at wallSlideSpeed', () => {
    const h = wallHarness();
    h.step(4);
    expect(h.player.movementState).toBe('wallCling');
    expect(h.player.velocity.y).toBeCloseTo(-h.movement.wallSlideSpeed, 6);
    const clings = h.eventsOfType('player:wallCling');
    expect(clings.length).toBe(1);
    expect(clings[0]?.normal.x).toBeCloseTo(1, 6);
  });

  it('refreshes the double jump and air dash on wall contact', () => {
    const h = wallHarness();
    h.player.jumpsRemaining = 0;
    h.player.dashesRemaining = 0;
    h.step(4);
    expect(h.player.movementState).toBe('wallCling');
    expect(h.player.jumpsRemaining).toBe(MAX_JUMPS);
    expect(h.player.dashesRemaining).toBe(h.movement.airDashCount);
  });

  it('times out after wallClingSeconds', () => {
    const h = wallHarness();
    h.step(4);
    expect(h.player.movementState).toBe('wallCling');
    h.step(Math.ceil(h.movement.wallClingSeconds / DT) + 4);
    expect(h.player.movementState).not.toBe('wallCling');
    expect(h.player.wallClingRemaining).toBe(0);
  });

  it('wall jumps with the configured velocity and locks input', () => {
    const h = wallHarness();
    h.step(4);
    expect(h.player.movementState).toBe('wallCling');
    h.input.press('jump');
    h.step();
    h.input.release('jump');

    expect(h.player.velocity.x).toBeCloseTo(h.movement.wallJumpHorizontal, 6);
    expect(h.player.velocity.y).toBeCloseTo(h.movement.wallJumpVertical, 6);
    expect(h.player.inputLockRemaining).toBeCloseTo(h.movement.wallJumpLockSeconds, 6);
    expect(h.player.movementState).toBe('wallJump');
    const jumps = h.eventsOfType('player:jumped');
    expect(jumps.length).toBe(1);
    expect(jumps[0]?.wallJump).toBe(true);

    // Pushing back into the wall must not cancel the push-off while locked.
    const lockSteps = Math.floor(h.movement.wallJumpLockSeconds / DT) - 1;
    h.step(Math.max(1, lockSteps));
    expect(h.player.velocity.x).toBeCloseTo(h.movement.wallJumpHorizontal, 6);

    // Once the lock expires the player can steer again.
    h.step(20);
    expect(h.player.velocity.x).toBeLessThan(h.movement.wallJumpHorizontal - 0.5);
  });
});

// ---------------------------------------------------------------------------
// Ledge grab / mantle
// ---------------------------------------------------------------------------

describe('ledge grab and mantle', () => {
  it('latches a reachable ledge and mantles onto the top', () => {
    const topY = 2;
    const h = createHarness({ physics: { wallX: 0, wallTopY: topY, floorEnabled: true } });
    h.player.position.x = h.movement.bodyRadius;
    makeAirborne(h, 1, 1);
    h.player.velocity.x = -3;
    h.player.velocity.y = 6;
    h.input.moveX = -1;

    h.step(3);
    expect(h.eventsOfType('player:ledgeGrabbed').length).toBe(1);
    expect(h.player.movementState).toBe('ledgeGrab');
    expect(h.player.ledgeTarget).not.toBeNull();

    h.step(Math.ceil((h.movement.mantleSeconds + 0.1) / DT) + 2);
    expect(h.player.position.y).toBeCloseTo(topY, 3);
    expect(h.player.position.x).toBeLessThan(0);
    expect(h.player.grounded).toBe(true);
    expect(h.player.ledgeTarget).toBeNull();
  });

  it('does not grab a wall with no reachable top', () => {
    const h = createHarness({
      physics: { wallX: 0, wallTopY: Number.POSITIVE_INFINITY, floorEnabled: false },
    });
    h.player.position.x = h.movement.bodyRadius;
    makeAirborne(h, 10, 1);
    h.player.velocity.x = -3;
    h.player.velocity.y = 4;
    h.input.moveX = -1;
    h.step(6);
    expect(h.eventsOfType('player:ledgeGrabbed').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rails
// ---------------------------------------------------------------------------

describe('rail grinding', () => {
  function railHarness(): Harness {
    const h = createHarness({ physics: { floorEnabled: false } });
    h.setStageDef(
      makeStageDef({
        rails: [{ id: 'r1', points: [vec3(0, 5, 0), vec3(20, 5, 0)] }],
      }),
    );
    h.player.railId = 'r1';
    h.player.railProgress = 0;
    h.player.railDirection = 1;
    h.player.position.y = 5;
    h.player.grounded = false;
    return h;
  }

  it('advances along the rail at grind speed', () => {
    const h = railHarness();
    h.step(30);
    expect(h.player.movementState).toBe('grind');
    expect(h.player.railProgress).toBeGreaterThan(0.2);
    expect(h.player.position.x).toBeCloseTo(h.player.railProgress * 20, 4);
    expect(h.player.velocity.x).toBeGreaterThan(10);
  });

  it('detaches with a jump and starts the rail cooldown', () => {
    const h = railHarness();
    h.step(10);
    h.input.press('jump');
    h.step();
    expect(h.player.railId).toBeNull();
    expect(h.player.railCooldown).toBeGreaterThan(0);
    expect(h.player.velocity.y).toBeCloseTo(jumpVelocityForHeight(h.movement.jumpHeight), 6);
    expect(h.eventsOfType('player:railDetached').length).toBe(1);
    expect(h.eventsOfType('player:jumped').length).toBe(1);
  });

  it('detaches at the end of the rail', () => {
    const h = railHarness();
    h.step(120);
    expect(h.player.railId).toBeNull();
    expect(h.eventsOfType('player:railDetached').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Harmonic bounce, water, platforms
// ---------------------------------------------------------------------------

describe('surfaces and volumes', () => {
  it('bounces off a collider with a bounce value', () => {
    const h = createHarness({ physics: { floorBounce: 1 } });
    makeAirborne(h, 6, 0);
    h.step(120);
    const bounces = h.eventsOfType('player:bounced');
    expect(bounces.length).toBeGreaterThanOrEqual(1);
    expect(bounces[0]?.strength).toBeCloseTo(h.movement.bounceStrength, 6);
  });

  it('does not bounce on an ordinary floor', () => {
    const h = createHarness({ physics: { floorBounce: 0 } });
    makeAirborne(h, 6, 0);
    h.step(120);
    expect(h.eventsOfType('player:bounced').length).toBe(0);
    expect(h.eventsOfType('player:landed').length).toBe(1);
  });

  it('swims using the swim speeds while in water', () => {
    const h = createHarness({ physics: { floorEnabled: false } });
    makeAirborne(h, 20, 0);
    h.player.inWater = true;
    h.input.moveY = 1;
    h.step(60);
    expect(h.player.movementState).toBe('swim');
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(h.movement.swimSpeed, 3);
    // Buoyancy alone lifts the player.
    expect(h.player.velocity.y).toBeGreaterThan(0);

    h.input.press('jump');
    h.step(60);
    expect(h.player.velocity.y).toBeCloseTo(h.movement.swimVerticalSpeed, 4);
  });

  it('rides a moving platform without sliding off', () => {
    const h = createHarness();
    h.player.platformVelocity.x = 3;
    h.step(30);
    expect(h.player.velocity.x).toBeCloseTo(3, 4);
    expect(h.player.position.x).toBeGreaterThan(1);
    expect(h.player.movementState).toBe('idle');
  });

  it('slides from a grounded sprint and decays the speed', () => {
    const h = createHarness();
    h.player.velocity.x = 12;
    h.input.press('slide');
    h.step();
    h.input.release('slide');
    expect(h.player.movementState).toBe('slide');
    const initial = horizontalSpeed(h.player.velocity);
    expect(initial).toBeGreaterThan(h.movement.runSpeed);
    h.step(20);
    expect(horizontalSpeed(h.player.velocity)).toBeLessThan(initial);
    h.step(Math.ceil(h.movement.slideSeconds / DT) + 5);
    expect(h.player.slideTimeRemaining).toBe(0);
    expect(h.player.movementState).not.toBe('slide');
  });
});

// ---------------------------------------------------------------------------
// Landing assist
// ---------------------------------------------------------------------------

describe('landing assist', () => {
  it('is exactly a no-op at zero strength', () => {
    const h = createHarness({ physics: { floorMaxX: 6 } });
    h.setAccessibility({ landingAssist: 0 });
    h.setDifficultyProfile({ landingAssist: 0 });
    makeAirborne(h, 3, 0);
    h.player.position.x = 5;
    h.player.velocity.x = 8;
    h.player.velocity.y = -5;
    h.step(10);
    expect(h.physics.raycastCount).toBe(0);

    // And the resulting motion matches a run with the assist path removed.
    const control = createHarness({ physics: { floorMaxX: 6 } });
    control.setAccessibility({ landingAssist: 0 });
    control.setDifficultyProfile({ landingAssist: 0 });
    makeAirborne(control, 3, 0);
    control.player.position.x = 5;
    control.player.velocity.x = 8;
    control.player.velocity.y = -5;
    control.step(10);
    expect(control.player.position.x).toBe(h.player.position.x);
    expect(control.player.velocity.x).toBe(h.player.velocity.x);
  });

  it('nudges the player back toward ground they would otherwise miss', () => {
    const build = (assist: number): Harness => {
      const h = createHarness({ physics: { floorMaxX: 6 } });
      h.setAccessibility({ landingAssist: assist });
      h.setDifficultyProfile({ landingAssist: 0 });
      makeAirborne(h, 3, 0);
      h.player.position.x = 5;
      h.player.velocity.x = 8;
      h.player.velocity.y = -5;
      return h;
    };
    const off = build(0);
    const on = build(0.8);
    off.step(5);
    on.step(5);
    expect(on.physics.raycastCount).toBeGreaterThan(0);
    expect(on.player.velocity.x).toBeLessThan(off.player.velocity.x - 0.2);
  });

  it('never runs while grounded', () => {
    const h = createHarness();
    h.setAccessibility({ landingAssist: 1 });
    h.input.moveY = 1;
    h.step(30);
    expect(h.physics.raycastCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism and framerate independence
// ---------------------------------------------------------------------------

describe('determinism and framerate independence', () => {
  it('lands within 5cm of the same place at 60Hz and 120Hz', () => {
    const runAt = (dt: number): Vec3 => {
      const h = createHarness();
      h.input.moveY = 1;
      const steps = Math.round(1 / dt);
      h.step(steps, dt);
      return { x: h.player.position.x, y: h.player.position.y, z: h.player.position.z };
    };
    const a = runAt(1 / 60);
    const b = runAt(1 / 120);
    const delta = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    expect(delta).toBeLessThan(0.05);
    // Sanity: the player actually travelled.
    expect(Math.abs(a.z)).toBeGreaterThan(5);
  });

  it('produces identical results from identical inputs', () => {
    const run = (): Vec3 => {
      const h = createHarness();
      h.input.moveY = 1;
      h.input.moveX = 0.5;
      for (let i = 0; i < 200; i++) {
        if (i === 10 || i === 60) h.input.press('jump');
        if (i === 14 || i === 66) h.input.release('jump');
        if (i === 30) h.input.press('dash');
        if (i === 34) h.input.release('dash');
        h.step();
      }
      return {
        x: h.player.position.x,
        y: h.player.position.y,
        z: h.player.position.z,
      };
    };
    const a = run();
    const b = run();
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });
});

// ---------------------------------------------------------------------------
// State machine, flow, and control gating
// ---------------------------------------------------------------------------

describe('state machine and gating', () => {
  it('emits stateChanged on every transition and resets stateTime', () => {
    const h = createHarness();
    h.step(2);
    expect(h.player.movementState).toBe('idle');
    expect(h.player.stateTime).toBeCloseTo(2 * DT, 6);

    h.input.moveY = 1;
    h.step(40);
    const changes = h.eventsOfType('player:stateChanged');
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.some((c) => c.to === 'walk')).toBe(true);
    expect(changes.some((c) => c.to === 'run')).toBe(true);
    const last = changes[changes.length - 1];
    expect(last?.from).not.toBe(last?.to);
  });

  it('reports fall while descending and jump while rising', () => {
    const h = createHarness();
    h.input.press('jump');
    h.step(3);
    expect(h.player.movementState).toBe('jump');

    // Keep rising, then sample the first airborne step after the apex.
    let sawFall = false;
    for (let i = 0; i < 120; i++) {
      h.step();
      if (!h.player.grounded && h.player.velocity.y < 0) {
        expect(h.player.movementState).toBe('fall');
        sawFall = true;
        break;
      }
    }
    expect(sawFall).toBe(true);
    expect(h.player.movementState).toBe('fall');

    // And it settles back to idle once it lands.
    h.step(120);
    expect(h.player.grounded).toBe(true);
    expect(h.player.movementState).toBe('idle');
  });

  it('accumulates flowSeconds only above the flow threshold', () => {
    const slow = createHarness();
    slow.input.moveY = 0.3;
    slow.step(120);
    expect(slow.player.flowSeconds).toBe(0);

    const fast = createHarness();
    fast.input.moveY = 1;
    fast.input.press('dash');
    fast.step(120);
    expect(fast.player.flowSeconds).toBeGreaterThan(1);
  });

  it('does nothing at all while the world is paused', () => {
    const h = createHarness();
    h.input.moveY = 1;
    h.world.paused = true;
    h.step(30);
    expect(h.player.position.x).toBe(0);
    expect(h.player.position.z).toBe(0);
    expect(h.player.velocity.x).toBe(0);
    expect(h.physics.moveCount).toBe(0);
    expect(h.player.stateTime).toBe(0);
  });

  it('ignores input while downed', () => {
    const h = createHarness();
    h.player.movementState = 'downed';
    h.input.moveY = 1;
    h.input.press('jump');
    h.step(30);
    expect(h.player.movementState).toBe('downed');
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(0, 6);
    expect(h.eventsOfType('player:jumped').length).toBe(0);
  });

  it('ignores input during a cutscene the player does not control', () => {
    const h = createHarness();
    h.setStageDef(
      makeStageDef({
        cutscenes: [{ id: 'intro', lines: [], playerControlled: false }],
      }),
    );
    h.world.cutsceneId = 'intro';
    h.input.moveY = 1;
    h.input.press('jump');
    h.step(30);
    expect(horizontalSpeed(h.player.velocity)).toBeCloseTo(0, 6);
    expect(h.eventsOfType('player:jumped').length).toBe(0);
    expect(h.player.movementState).toBe('cutscene');
  });

  it('keeps control during a player-controlled cutscene', () => {
    const h = createHarness();
    h.setStageDef(
      makeStageDef({
        cutscenes: [{ id: 'ambient', lines: [], playerControlled: true }],
      }),
    );
    h.world.cutsceneId = 'ambient';
    h.input.moveY = 1;
    h.step(30);
    expect(horizontalSpeed(h.player.velocity)).toBeGreaterThan(1);
  });

  it('respects an externally set inputLockRemaining', () => {
    const h = createHarness();
    h.player.velocity.x = 6;
    h.player.inputLockRemaining = 0.2;
    h.input.moveX = -1;
    h.step(6);
    expect(h.player.velocity.x).toBeCloseTo(6, 6);
    h.step(30);
    expect(h.player.velocity.x).toBeLessThan(0);
  });
});
