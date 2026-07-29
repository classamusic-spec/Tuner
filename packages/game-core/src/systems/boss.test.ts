import { describe, expect, it } from 'vitest';
import {
  DETUNED_HZ,
  DIFFICULTY_PROFILES,
  clone,
  createEventBus,
  createIdAllocator,
  createRng,
  vec3,
} from '@tuner/shared';
import type { DifficultyProfile, EntityId, EventBus, Vec3 } from '@tuner/shared';
import { createEmptyInputFrame } from '@tuner/input';
import type { ColliderHandle, PhysicsWorld } from '@tuner/physics';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import type { BossAttackDef, BossDef, BossPhaseDef, ContentBundle } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { SimContext } from '../internal/context.js';
import { createWorld } from '../internal/create-world.js';
import { createSimServices, damageBoss } from '../internal/services.js';
import type { MutableBoss, MutableWorld } from '../internal/world.js';
import {
  BOSS_SHOT_INTERVAL_SECONDS,
  attackGapSeconds,
  bossSystem,
  bossYawForDirection,
  eligibleAttacks,
  pickWeighted,
  submitRestorationNote,
} from './boss.js';

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// Content — one hand-built three-phase Commander, plus a single-attack boss
// used wherever a test needs the lifecycle to be predictable.
// ---------------------------------------------------------------------------

/** Telegraph 0.5, live 0.4, recovery 0.6 — and a promised punish window. */
const SWEEP: BossAttackDef = {
  id: 'sweep',
  displayName: 'Sweep',
  telegraphSeconds: 0.5,
  durationSeconds: 0.4,
  recoverySeconds: 0.6,
  phases: [1, 2, 3],
  weight: 3,
  opensVulnerability: true,
};

/** No punish window at all. */
const RING: BossAttackDef = {
  id: 'ring',
  displayName: 'Ring',
  telegraphSeconds: 0.8,
  durationSeconds: 0.6,
  recoverySeconds: 0.4,
  phases: [1, 2],
  weight: 1,
};

const CHARGE: BossAttackDef = {
  id: 'charge',
  displayName: 'Charge',
  telegraphSeconds: 0.6,
  durationSeconds: 1,
  recoverySeconds: 0.8,
  phases: [2, 3],
  weight: 2,
  opensVulnerability: true,
};

const LAMENT: BossAttackDef = {
  id: 'lament',
  displayName: 'Lament',
  telegraphSeconds: 1,
  durationSeconds: 1.2,
  recoverySeconds: 1,
  phases: [3],
  weight: 2,
};

/** The optional layer difficulty toggles. */
const ADVANCED: BossAttackDef = {
  id: 'advanced',
  displayName: 'Advanced Layer',
  telegraphSeconds: 0.7,
  durationSeconds: 0.5,
  recoverySeconds: 0.5,
  phases: [2, 3],
  weight: 4,
  advancedOnly: true,
};

/**
 * Named by phase one but only listing phase three: authored drift the runtime
 * must refuse to play, however heavy its weight.
 */
const STRAY: BossAttackDef = {
  id: 'stray',
  displayName: 'Stray',
  telegraphSeconds: 0.5,
  durationSeconds: 0.5,
  recoverySeconds: 0.5,
  phases: [3],
  weight: 5,
};

const PHASE_ONE: BossPhaseDef = {
  index: 1,
  name: 'Vocabulary',
  healthThreshold: 1,
  arenaFlags: ['phase-one-flag'],
  attackIds: ['sweep', 'ring', 'stray'],
  attackInterval: 2,
};

const PHASE_TWO: BossPhaseDef = {
  index: 2,
  name: 'Pressure',
  healthThreshold: 0.6,
  arenaFlags: ['phase-two-flag', 'terraces-raised'],
  attackIds: ['sweep', 'ring', 'charge', 'advanced'],
  attackInterval: 1.5,
};

const PHASE_THREE: BossPhaseDef = {
  index: 3,
  name: 'Four-Forty',
  healthThreshold: 0.3,
  arenaFlags: ['phase-three-flag'],
  attackIds: ['sweep', 'charge', 'lament', 'advanced'],
  attackInterval: 1,
};

const TEST_BOSS: BossDef = {
  id: 'test-commander',
  displayName: 'Metron',
  title: 'The Metronome',
  stageId: 'fractured-garden',
  health: 1000,
  bodyRadius: 2,
  bodyHeight: 4,
  arenaCentre: vec3(0, 0, 0),
  arenaRadius: 20,
  phases: [PHASE_ONE, PHASE_TWO, PHASE_THREE],
  attacks: [SWEEP, RING, CHARGE, LAMENT, ADVANCED, STRAY],
  formAdvantages: { ember: 1.5, tidal: 1.2 },
  awardsForm: 'echo',
  restorationSequence: [0, 4, 2, 7],
};

const SOLO_PHASE: BossPhaseDef = {
  index: 1,
  name: 'Solo',
  healthThreshold: 1,
  arenaFlags: ['solo-flag'],
  attackIds: ['sweep'],
  attackInterval: 2,
};

/** One phase, one attack: every transition lands at a time we can name. */
const SOLO_BOSS: BossDef = {
  ...TEST_BOSS,
  id: 'solo-commander',
  phases: [SOLO_PHASE],
  attacks: [SWEEP],
};

/** Two phases, one attack: a transition with nothing else moving. */
const SOLO_TWO_PHASE_BOSS: BossDef = {
  ...SOLO_BOSS,
  id: 'solo-two-phase',
  phases: [
    SOLO_PHASE,
    {
      index: 2,
      name: 'Solo Two',
      healthThreshold: 0.6,
      arenaFlags: ['solo-two'],
      attackIds: ['sweep'],
      attackInterval: 1.5,
    },
  ],
};

/** Same shape, with an attack that promises no punish window. */
const QUIET_BOSS: BossDef = {
  ...SOLO_BOSS,
  id: 'quiet-commander',
  phases: [
    {
      index: 1,
      name: 'Solo',
      healthThreshold: 1,
      attackIds: ['ring'],
      attackInterval: 2,
    },
  ],
  attacks: [RING],
};

/** A mini-boss: no awarded form and no retuning sequence to play back. */
const MINI_BOSS: BossDef = {
  ...SOLO_BOSS,
  id: 'mini-warden',
  isMiniBoss: true,
  awardsForm: undefined,
  restorationSequence: undefined,
};

// ---------------------------------------------------------------------------
// Stub physics — the boss runtime never queries it; the services need one.
// ---------------------------------------------------------------------------

function createStubPhysics(): PhysicsWorld {
  let nextId = 1;
  const handles: ColliderHandle[] = [];
  return {
    addCollider(descriptor) {
      const handle: ColliderHandle = { id: nextId++, descriptor };
      handles.push(handle);
      return handle;
    },
    removeCollider() {
      /* no-op */
    },
    setColliderTransform() {
      /* no-op */
    },
    clear() {
      handles.length = 0;
    },
    moveCharacter(params) {
      return {
        position: clone(params.position),
        velocity: clone(params.velocity),
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
    sweepSphere() {
      return null;
    },
    overlapSphere() {
      return [];
    },
    colliders: handles,
    stats: { colliderCount: 0, lastQueryCount: 0 },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Recorded<T> {
  readonly tick: number;
  readonly payload: T;
}

interface Captured {
  phaseChanged: Recorded<GameEvents['boss:phaseChanged']>[];
  telegraph: Recorded<GameEvents['boss:telegraph']>[];
  attackStarted: Recorded<GameEvents['boss:attackStarted']>[];
  vulnerable: Recorded<GameEvents['boss:vulnerable']>[];
  restorationStarted: Recorded<GameEvents['boss:restorationStarted']>[];
  restorationStep: Recorded<GameEvents['world:restorationStep']>[];
  defeated: Recorded<GameEvents['boss:defeated']>[];
  fired: Recorded<GameEvents['combat:fired']>[];
  shake: Recorded<GameEvents['fx:shake']>[];
}

interface Harness {
  readonly ctx: SimContext;
  readonly world: MutableWorld;
  readonly boss: MutableBoss;
  readonly events: EventBus<GameEvents>;
  readonly captured: Captured;
  /** Steps elapsed. */
  readonly tick: () => number;
  step(count?: number): void;
}

function makeBoss(def: BossDef, position: Vec3): MutableBoss {
  return {
    id: 900 as EntityId,
    definitionId: def.id,
    displayName: def.displayName,
    position: clone(position),
    velocity: vec3(),
    yaw: 0,
    health: def.health,
    maxHealth: def.health,
    phaseIndex: 1,
    phaseTime: 0,
    currentAttack: null,
    attackTime: 0,
    attackDuration: 0,
    telegraphRemaining: 0,
    telegraphTotal: 0,
    recoveryRemaining: 0,
    nextAttackIn: 0,
    vulnerable: false,
    arenaFlags: new Set<string>(),
    restoring: false,
    restorationProgress: 0,
    restorationStep: 0,
    defeated: false,
    scratch: new Map<string, number>(),
  };
}

function makeProfile(partial: Partial<DifficultyProfile> = {}): DifficultyProfile {
  return { ...DIFFICULTY_PROFILES.standard, ...partial };
}

interface HarnessOptions {
  def?: BossDef;
  difficulty?: DifficultyProfile;
  seed?: number | string;
  dt?: number;
  playerPosition?: Vec3;
  bossPosition?: Vec3;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const def = options.def ?? TEST_BOSS;
  const difficultyProfile = options.difficulty ?? makeProfile();
  const dt = options.dt ?? STEP;

  const events = createEventBus<GameEvents>();
  const physics = createStubPhysics();
  const ids = createIdAllocator(1);
  const rng = createRng(options.seed ?? 'boss-test');
  const content: ContentBundle = {
    stages: {},
    enemies: {},
    bosses: { [def.id]: def },
  };

  const world = createWorld({
    playerId: ids.next(),
    maxCoherence: DEFAULT_COMBAT_CONFIG.maxCoherence,
    difficulty: difficultyProfile.id,
  });
  if (options.playerPosition) {
    world.player.position.x = options.playerPosition.x;
    world.player.position.y = options.playerPosition.y;
    world.player.position.z = options.playerPosition.z;
  }
  const boss = makeBoss(def, options.bossPosition ?? vec3(0, 0, -8));
  boss.id = ids.next();
  world.boss = boss;

  const services = createSimServices({
    world,
    physics,
    events,
    ids,
    rng,
    combat: DEFAULT_COMBAT_CONFIG,
    accessibility: DEFAULT_ACCESSIBILITY_CONFIG,
    difficultyProfile,
    content,
    stageDef: null,
    formBehaviour: null,
  });

  const ctx: SimContext = {
    world,
    physics,
    events,
    input: createEmptyInputFrame(),
    dt,
    rawDt: dt,
    rng,
    ids,
    content,
    stageDef: null,
    movement: DEFAULT_MOVEMENT_CONFIG,
    combat: DEFAULT_COMBAT_CONFIG,
    camera: DEFAULT_CAMERA_CONFIG,
    accessibility: DEFAULT_ACCESSIBILITY_CONFIG,
    difficultyProfile,
    formBehaviour: null,
    cameraYaw: 0,
    cameraPitch: 0,
    services,
  };

  let tick = 0;
  const captured: Captured = {
    phaseChanged: [],
    telegraph: [],
    attackStarted: [],
    vulnerable: [],
    restorationStarted: [],
    restorationStep: [],
    defeated: [],
    fired: [],
    shake: [],
  };

  function record<K extends keyof GameEvents & string>(
    type: K,
    into: Recorded<GameEvents[K]>[],
  ): void {
    events.on(type, (payload) => {
      into.push({ tick, payload });
    });
  }

  record('boss:phaseChanged', captured.phaseChanged);
  record('boss:telegraph', captured.telegraph);
  record('boss:attackStarted', captured.attackStarted);
  record('boss:vulnerable', captured.vulnerable);
  record('boss:restorationStarted', captured.restorationStarted);
  record('world:restorationStep', captured.restorationStep);
  record('boss:defeated', captured.defeated);
  record('combat:fired', captured.fired);
  record('fx:shake', captured.shake);

  return {
    ctx,
    world,
    boss,
    events,
    captured,
    tick: () => tick,
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        tick += 1;
        bossSystem(ctx);
      }
    },
  };
}

/** Runs until `predicate` holds, returning the number of steps taken. */
function runUntil(harness: Harness, predicate: () => boolean, maxSteps = 20000): number {
  for (let i = 1; i <= maxSteps; i++) {
    harness.step();
    if (predicate()) return i;
  }
  return -1;
}

function attackOrder(harness: Harness): string[] {
  return harness.captured.telegraph.map((entry) => entry.payload.attack);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

describe('bossSystem — phases', () => {
  it('applies the opening phase flags and announces it exactly once', () => {
    const h = createHarness();
    h.step(120);

    expect(h.captured.phaseChanged).toHaveLength(1);
    expect(h.captured.phaseChanged[0]?.payload.phaseIndex).toBe(1);
    expect(h.captured.phaseChanged[0]?.payload.phaseName).toBe('Vocabulary');
    expect(h.world.stage.flags.has('phase-one-flag')).toBe(true);
    // Mirrored onto the boss so the stage runtime can see what this fight set.
    expect(h.boss.arenaFlags.has('phase-one-flag')).toBe(true);
  });

  it('advances at the configured health thresholds, once per phase', () => {
    const h = createHarness();
    h.step(1);
    expect(h.boss.phaseIndex).toBe(1);

    // Just above the phase-two threshold: still phase one.
    h.boss.health = 601;
    h.step(30);
    expect(h.boss.phaseIndex).toBe(1);

    h.boss.health = 600;
    h.step(1);
    expect(h.boss.phaseIndex).toBe(2);

    // Sitting at the threshold must not re-announce the phase.
    h.step(120);
    expect(h.boss.phaseIndex).toBe(2);

    h.boss.health = 299;
    h.step(1);
    expect(h.boss.phaseIndex).toBe(3);
    h.step(120);

    const indices = h.captured.phaseChanged.map((entry) => entry.payload.phaseIndex);
    expect(indices).toEqual([1, 2, 3]);
  });

  it('applies each phase’s arenaFlags to world.stage.flags on entry', () => {
    const h = createHarness();
    h.step(1);
    expect([...h.world.stage.flags]).toEqual(['phase-one-flag']);

    h.boss.health = 550;
    h.step(1);
    expect(h.world.stage.flags.has('phase-two-flag')).toBe(true);
    expect(h.world.stage.flags.has('terraces-raised')).toBe(true);
    expect(h.world.stage.flags.has('phase-three-flag')).toBe(false);

    h.boss.health = 100;
    h.step(1);
    expect(h.world.stage.flags.has('phase-three-flag')).toBe(true);
  });

  it('walks through every threshold a single burst crossed', () => {
    const h = createHarness();
    h.step(1);
    h.boss.health = 50; // 5% — past both remaining thresholds at once.
    h.step(1);

    expect(h.boss.phaseIndex).toBe(3);
    expect(h.captured.phaseChanged.map((e) => e.payload.phaseIndex)).toEqual([1, 2, 3]);
    expect(h.world.stage.flags.has('terraces-raised')).toBe(true);
    expect(h.world.stage.flags.has('phase-three-flag')).toBe(true);
  });

  it('cancels the running attack and resets the interval on a phase change', () => {
    const h = createHarness({ def: SOLO_TWO_PHASE_BOSS });
    // A wind-up is under way...
    const steps = runUntil(h, () => h.boss.telegraphRemaining > 0);
    expect(steps).toBeGreaterThan(0);
    expect(h.boss.currentAttack).toBe('sweep');

    // ...and the arena changes under it.
    h.boss.health = 500;
    h.step(1);

    expect(h.boss.phaseIndex).toBe(2);
    expect(h.boss.currentAttack).toBeNull();
    expect(h.boss.telegraphRemaining).toBe(0);
    expect(h.boss.telegraphTotal).toBe(0);
    // The new phase's interval, less the remainder of the step it began on.
    expect(h.boss.nextAttackIn).toBeCloseTo(1.5 - STEP, 6);
    expect(h.world.stage.flags.has('solo-two')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Attack selection
// ---------------------------------------------------------------------------

describe('bossSystem — attack selection', () => {
  it('only plays attacks the phase names and that name the phase back', () => {
    const h = createHarness();
    h.step(4000);
    const played = new Set(attackOrder(h));
    expect(played.size).toBeGreaterThan(1);
    for (const id of played) expect(['sweep', 'ring']).toContain(id);
    // `stray` is listed by phase one but only lists phase three.
    expect(played.has('stray')).toBe(false);
  });

  it('respects weights', () => {
    const rng = createRng('weights');
    const pool = eligibleAttacks(TEST_BOSS, PHASE_ONE, true, null);
    expect(pool.map((a) => a.id)).toEqual(['sweep', 'ring']);

    const counts = new Map<string, number>();
    for (let i = 0; i < 8000; i++) {
      const picked = pickWeighted(pool, rng);
      expect(picked).not.toBeNull();
      const id = picked?.id ?? '';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const sweep = counts.get('sweep') ?? 0;
    const ring = counts.get('ring') ?? 0;
    expect(sweep + ring).toBe(8000);
    // Weights 3 : 1.
    expect(sweep / 8000).toBeGreaterThan(0.72);
    expect(sweep / 8000).toBeLessThan(0.78);
  });

  it('never selects the same attack three times in a row', () => {
    const h = createHarness();
    h.step(9000);
    const order = attackOrder(h);
    expect(order.length).toBeGreaterThan(20);
    for (let i = 2; i < order.length; i++) {
      const run = order[i] === order[i - 1] && order[i] === order[i - 2];
      expect(run).toBe(false);
    }
    // The guard must not collapse the fight into a strict alternation either.
    let repeats = 0;
    for (let i = 1; i < order.length; i++) if (order[i] === order[i - 1]) repeats++;
    expect(repeats).toBeGreaterThan(0);
  });

  it('excludes advancedOnly attacks unless the profile enables them', () => {
    const assisted = createHarness({ difficulty: makeProfile({ advancedPatterns: false }) });
    assisted.step(1);
    assisted.boss.health = 500; // phase two, where `advanced` lives
    assisted.step(6000);
    expect(attackOrder(assisted).length).toBeGreaterThan(20);
    expect(attackOrder(assisted)).not.toContain('advanced');

    const full = createHarness({ difficulty: makeProfile({ advancedPatterns: true }) });
    full.step(1);
    full.boss.health = 500;
    full.step(6000);
    expect(attackOrder(full)).toContain('advanced');
  });

  it('keeps attacking when a phase has only one legal attack', () => {
    const h = createHarness({ def: SOLO_BOSS });
    h.step(2000);
    const order = attackOrder(h);
    expect(order.length).toBeGreaterThan(4);
    for (const id of order) expect(id).toBe('sweep');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('bossSystem — attack lifecycle', () => {
  it('runs telegraph → active → recovery on exactly the authored timings', () => {
    // 0.1 s steps: interval 2 s, telegraph 0.5 s, duration 0.4 s, recovery 0.6 s.
    const h = createHarness({ def: SOLO_BOSS, dt: 0.1 });

    h.step(19);
    expect(h.boss.currentAttack).toBeNull();
    expect(h.boss.nextAttackIn).toBeCloseTo(0.1, 6);

    h.step(1); // t = 2.0 — the wind-up begins
    expect(h.boss.currentAttack).toBe('sweep');
    expect(h.boss.telegraphRemaining).toBeCloseTo(0.5, 6);
    expect(h.boss.telegraphTotal).toBeCloseTo(0.5, 6);
    expect(h.captured.telegraph).toHaveLength(1);
    expect(h.captured.telegraph[0]?.payload.seconds).toBeCloseTo(0.5, 6);
    expect(h.captured.attackStarted).toHaveLength(0);

    h.step(4); // t = 2.4 — still winding up
    expect(h.boss.telegraphRemaining).toBeCloseTo(0.1, 6);
    expect(h.captured.attackStarted).toHaveLength(0);

    h.step(1); // t = 2.5 — live
    expect(h.boss.telegraphRemaining).toBe(0);
    expect(h.boss.telegraphTotal).toBeCloseTo(0.5, 6);
    expect(h.boss.attackTime).toBeCloseTo(0, 6);
    expect(h.captured.attackStarted).toHaveLength(1);
    expect(h.captured.attackStarted[0]?.payload.attack).toBe('sweep');
    expect(h.boss.recoveryRemaining).toBe(0);

    h.step(3); // t = 2.8
    expect(h.boss.attackTime).toBeCloseTo(0.3, 6);
    expect(h.boss.recoveryRemaining).toBe(0);

    h.step(1); // t = 2.9 — recovery
    expect(h.boss.attackTime).toBeCloseTo(0.4, 6);
    expect(h.boss.recoveryRemaining).toBeCloseTo(0.6, 6);

    h.step(5); // t = 3.4
    expect(h.boss.recoveryRemaining).toBeCloseTo(0.1, 6);
    expect(h.boss.currentAttack).toBe('sweep');

    h.step(1); // t = 3.5 — back to waiting
    expect(h.boss.currentAttack).toBeNull();
    expect(h.boss.recoveryRemaining).toBe(0);
    expect(h.boss.nextAttackIn).toBeCloseTo(2, 6);
    expect(h.boss.telegraphTotal).toBe(0);
  });

  it('writes the telegraph ring fields every step of the wind-up', () => {
    const h = createHarness({ def: SOLO_BOSS, dt: 0.1 });
    h.step(20);

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(h.boss.telegraphRemaining);
      expect(h.boss.telegraphTotal).toBeCloseTo(0.5, 6);
      h.step(1);
    }
    expect(samples).toHaveLength(5);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] as number).toBeLessThan(samples[i - 1] as number);
    }
    expect(h.boss.telegraphRemaining).toBe(0);
  });

  it('opens a punish window during recovery and closes it afterwards', () => {
    const h = createHarness({ def: SOLO_BOSS, dt: 0.1 });
    h.step(20 + 5); // through the wind-up, attack live
    expect(h.boss.vulnerable).toBe(false);

    h.step(4); // recovery
    expect(h.boss.vulnerable).toBe(true);
    expect(h.captured.vulnerable.map((e) => e.payload.open)).toEqual([true]);

    h.step(6); // recovery over
    expect(h.boss.vulnerable).toBe(false);
    expect(h.captured.vulnerable.map((e) => e.payload.open)).toEqual([true, false]);
  });

  it('never opens a window for an attack that does not promise one', () => {
    const h = createHarness({ def: QUIET_BOSS, dt: 0.1 });
    for (let i = 0; i < 120; i++) {
      h.step(1);
      expect(h.boss.vulnerable).toBe(false);
    }
    expect(h.captured.vulnerable).toHaveLength(0);
    expect(h.captured.attackStarted.length).toBeGreaterThan(1);
  });

  it('throws counterable 440 Hz shots and shakes the screen while live', () => {
    const h = createHarness({ def: SOLO_BOSS, dt: 0.1, playerPosition: vec3(0, 0, 4) });
    h.step(25); // wind-up complete, nothing thrown yet
    expect(h.world.projectiles).toHaveLength(0);

    h.step(1); // first live step
    expect(h.world.projectiles.length).toBeGreaterThan(0);

    const shot = h.world.projectiles[0];
    expect(shot?.owner).toBe('enemy');
    expect(shot?.ownerId).toBe(h.boss.id);
    expect(shot?.counterable).toBe(true);
    expect(shot?.hz).toBe(DETUNED_HZ);
    expect(h.captured.fired.length).toBeGreaterThan(0);
    expect(h.captured.shake.length).toBeGreaterThan(0);

    // The cadence is bounded by the attack's own duration.
    h.step(3);
    const expectedMax = Math.ceil(0.4 / BOSS_SHOT_INTERVAL_SECONDS) + 1;
    expect(h.world.projectiles.length).toBeLessThanOrEqual(expectedMax);
  });

  it('keeps attack-local state in boss.scratch and clears it when the attack ends', () => {
    const h = createHarness({ def: SOLO_BOSS, dt: 0.1 });
    h.step(20 + 6);
    expect(h.boss.scratch.has('sweep:shotTimer')).toBe(true);
    expect(h.boss.scratch.has('sweep:shotCount')).toBe(true);

    h.step(10); // through recovery
    expect(h.boss.currentAttack).toBeNull();
    expect(h.boss.scratch.has('sweep:shotTimer')).toBe(false);
    expect(h.boss.scratch.has('sweep:shotCount')).toBe(false);
  });

  it('holds still while a cutscene owns the arena', () => {
    const h = createHarness({ def: SOLO_BOSS });
    h.world.cutsceneId = 'oru-kneels';
    h.step(600);
    expect(h.captured.telegraph).toHaveLength(0);

    h.world.cutsceneId = null;
    h.step(600);
    expect(h.captured.telegraph.length).toBeGreaterThan(0);
  });

  it('does nothing at all while the world is paused', () => {
    const h = createHarness({ def: SOLO_BOSS });
    h.world.paused = true;
    h.step(600);
    expect(h.captured.phaseChanged).toHaveLength(0);
    expect(h.captured.telegraph).toHaveLength(0);
    expect(h.boss.phaseTime).toBe(0);
    expect(h.world.stage.flags.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

describe('bossSystem — difficulty', () => {
  it('scales the interval between attacks by enemyAggressionScale', () => {
    const standard = createHarness({ def: SOLO_BOSS, dt: 0.1 });
    const relaxed = createHarness({
      def: SOLO_BOSS,
      dt: 0.1,
      difficulty: makeProfile({ enemyAggressionScale: 0.5 }),
    });

    expect(attackGapSeconds(standard.ctx, SOLO_PHASE)).toBeCloseTo(2, 6);
    expect(attackGapSeconds(relaxed.ctx, SOLO_PHASE)).toBeCloseTo(4, 6);

    standard.step(400);
    relaxed.step(400);

    // Cycle = gap + 0.5 + 0.4 + 0.6. Standard: 3.5 s. Relaxed: 5.5 s.
    expect(standard.captured.attackStarted.length).toBeGreaterThan(
      relaxed.captured.attackStarted.length,
    );
    const firstStandard = standard.captured.telegraph[1]?.tick ?? 0;
    const secondStandard = standard.captured.telegraph[2]?.tick ?? 0;
    expect(secondStandard - firstStandard).toBe(35);

    const firstRelaxed = relaxed.captured.telegraph[1]?.tick ?? 0;
    const secondRelaxed = relaxed.captured.telegraph[2]?.tick ?? 0;
    expect(secondRelaxed - firstRelaxed).toBe(55);
  });

  it('never changes boss health', () => {
    const brutal = createHarness({
      def: SOLO_BOSS,
      difficulty: makeProfile({ enemyAggressionScale: 1.25, incomingDamageScale: 1.5 }),
    });
    const gentle = createHarness({
      def: SOLO_BOSS,
      difficulty: makeProfile({ enemyAggressionScale: 0.7, incomingDamageScale: 0.4 }),
    });
    brutal.step(600);
    gentle.step(600);

    expect(brutal.boss.maxHealth).toBe(SOLO_BOSS.health);
    expect(gentle.boss.maxHealth).toBe(SOLO_BOSS.health);
    expect(brutal.boss.health).toBe(gentle.boss.health);
  });
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

describe('bossSystem — form advantage', () => {
  it('multiplies damage for an advantaged form', () => {
    const h = createHarness();
    h.step(1);
    const point = vec3(0, 1, -8);
    const normal = vec3(0, 0, 1);

    damageBoss(h.ctx, h.boss, 100, 'pulse', 'base', point, normal);
    const afterBase = h.boss.health;
    expect(TEST_BOSS.health - afterBase).toBeCloseTo(100, 6);

    damageBoss(h.ctx, h.boss, 100, 'pulse', 'ember', point, normal);
    expect(afterBase - h.boss.health).toBeCloseTo(150, 6);
  });

  it('lets the base Auralith alone take the fight to zero and finish it', () => {
    const h = createHarness({ playerPosition: vec3(0, 0, 6) });
    const point = vec3(0, 1, -8);
    const normal = vec3(0, 0, 1);

    let guard = 0;
    while (h.boss.health > 0 && guard < 5000) {
      damageBoss(h.ctx, h.boss, 25, 'pulse', 'base', point, normal);
      h.step(1);
      guard++;
    }
    expect(h.boss.health).toBe(0);
    expect(guard).toBeLessThan(5000);

    // Reaching zero opens the retuning, not a death.
    expect(h.boss.restoring).toBe(true);
    expect(h.boss.defeated).toBe(false);
    expect(h.captured.restorationStarted).toHaveLength(1);

    for (const degree of TEST_BOSS.restorationSequence ?? []) {
      expect(submitRestorationNote(h.world, degree)).toBe(true);
      h.step(1);
    }
    expect(h.boss.defeated).toBe(true);
    expect(h.captured.defeated[0]?.payload.formAwarded).toBe('echo');
  });
});

// ---------------------------------------------------------------------------
// Restoration
// ---------------------------------------------------------------------------

describe('bossSystem — restoration', () => {
  function drive(h: Harness): void {
    h.step(1);
    h.boss.health = 0;
    h.step(1);
  }

  it('enters the retuning phase instead of dying', () => {
    const h = createHarness();
    // Get an attack under way first, so the interruption is visible.
    runUntil(h, () => h.boss.currentAttack !== null);
    h.boss.health = 0;
    h.step(1);

    expect(h.boss.restoring).toBe(true);
    expect(h.boss.defeated).toBe(false);
    expect(h.boss.currentAttack).toBeNull();
    expect(h.boss.telegraphRemaining).toBe(0);
    expect(h.boss.vulnerable).toBe(false);
    expect(h.captured.restorationStarted.map((e) => e.payload.definitionId)).toEqual([
      'test-commander',
    ]);
  });

  it('advances only on the correct degree', () => {
    const h = createHarness();
    drive(h);

    expect(submitRestorationNote(h.world, 0)).toBe(true);
    expect(h.boss.restorationStep).toBe(1);
    expect(h.boss.restorationProgress).toBeCloseTo(0.25, 6);

    // Wrong note: no progress, and no punishment either.
    expect(submitRestorationNote(h.world, 5)).toBe(false);
    expect(h.boss.restorationStep).toBe(1);
    expect(h.boss.restorationProgress).toBeCloseTo(0.25, 6);

    expect(submitRestorationNote(h.world, 4)).toBe(true);
    expect(h.boss.restorationStep).toBe(2);
    expect(h.boss.restorationProgress).toBeCloseTo(0.5, 6);
  });

  it('announces each accepted note exactly once', () => {
    const h = createHarness();
    drive(h);
    submitRestorationNote(h.world, 0);
    h.step(5);
    submitRestorationNote(h.world, 4);
    h.step(5);

    expect(h.captured.restorationStep.map((e) => e.payload.progress)).toEqual([0.25, 0.5]);
    expect(h.captured.restorationStep[0]?.payload.region).toBe('fractured-garden');
  });

  it('completes the sequence, defeats the boss and awards its form', () => {
    const h = createHarness();
    drive(h);

    for (const degree of [0, 4, 2, 7]) {
      expect(submitRestorationNote(h.world, degree)).toBe(true);
    }
    expect(h.boss.restorationProgress).toBe(1);
    expect(h.boss.defeated).toBe(false);

    h.step(1);
    expect(h.boss.defeated).toBe(true);
    expect(h.boss.restoring).toBe(false);
    expect(h.captured.defeated).toHaveLength(1);
    expect(h.captured.defeated[0]?.payload.definitionId).toBe('test-commander');
    expect(h.captured.defeated[0]?.payload.displayName).toBe('Metron');
    expect(h.captured.defeated[0]?.payload.formAwarded).toBe('echo');

    // A defeated boss stays defeated and stops attacking.
    const telegraphs = h.captured.telegraph.length;
    h.step(600);
    expect(h.captured.defeated).toHaveLength(1);
    expect(h.captured.telegraph).toHaveLength(telegraphs);
  });

  it('refuses notes outside the retuning', () => {
    const h = createHarness();
    h.step(1);
    expect(submitRestorationNote(h.world, 0)).toBe(false);

    drive(h);
    for (const degree of [0, 4, 2, 7]) submitRestorationNote(h.world, degree);
    h.step(1);
    // Defeated: nothing left to play into.
    expect(submitRestorationNote(h.world, 0)).toBe(false);
  });

  it('resolves a boss that has no sequence to play back', () => {
    const h = createHarness({ def: MINI_BOSS });
    h.step(1);
    h.boss.health = 0;
    h.step(1);

    expect(h.captured.restorationStarted).toHaveLength(1);
    expect(h.boss.defeated).toBe(true);
    expect(h.captured.defeated[0]?.payload.formAwarded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('bossSystem — movement', () => {
  it('stays inside its arena', () => {
    const h = createHarness({
      def: SOLO_BOSS,
      playerPosition: vec3(400, 0, 400),
      bossPosition: vec3(60, 0, 60),
    });
    const limit = SOLO_BOSS.arenaRadius - SOLO_BOSS.bodyRadius;

    h.step(1);
    expect(Math.hypot(h.boss.position.x, h.boss.position.z)).toBeLessThanOrEqual(limit + 1e-6);

    for (let i = 0; i < 1200; i++) {
      h.step(1);
      expect(Math.hypot(h.boss.position.x, h.boss.position.z)).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it('turns to face the player', () => {
    const h = createHarness({
      def: SOLO_BOSS,
      playerPosition: vec3(12, 0, 0),
      bossPosition: vec3(0, 0, 0),
    });
    h.step(90); // 1.5 s of the pre-attack wait
    expect(h.boss.yaw).toBeCloseTo(bossYawForDirection(1, 0), 3);
    // ...and closes some of the distance while it does.
    expect(h.boss.position.x).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('bossSystem — determinism', () => {
  it('replays an identical attack sequence from the same seed', () => {
    function run(seed: string): { attacks: string[]; phases: number[] } {
      const h = createHarness({ seed });
      for (let i = 0; i < 8000; i++) {
        // A fixed damage schedule, so both runs walk all three phases at
        // exactly the same moments.
        h.boss.health = Math.max(0, h.boss.health - 0.1);
        h.step(1);
      }
      return {
        attacks: h.captured.telegraph.map((e) => `${String(e.tick)}:${e.payload.attack}`),
        phases: h.captured.phaseChanged.map((e) => e.payload.phaseIndex),
      };
    }

    const first = run('world-chord');
    const second = run('world-chord');
    expect(first.attacks.length).toBeGreaterThan(25);
    expect(first.phases).toEqual([1, 2, 3]);
    expect(first).toEqual(second);

    const other = run('four-forty');
    expect(other.attacks).not.toEqual(first.attacks);
  });
});
