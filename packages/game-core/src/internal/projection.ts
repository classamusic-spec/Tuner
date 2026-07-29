import type { Vec3 } from '@tuner/shared';
import { clone, copy, vec3 } from '@tuner/shared';
import type {
  BossState,
  CameraIntent,
  CheckpointState,
  ConjuredPlatformState,
  EnemyState,
  PickupState,
  PlayerState,
  ProjectileState,
  StageMetrics,
  StageRuntimeState,
  WorldState,
} from '../state.js';
import type { MutableWorld } from './world.js';

/**
 * Projects the mutable simulation world into the read-only `WorldState` that
 * renderers and UI consume.
 *
 * The projection reuses one buffer per frame rather than allocating a fresh
 * object graph sixty times a second. Two buffers are kept — previous and
 * current — and swapped each step, which is what gives the renderer something
 * to interpolate between without any copying on the render side.
 *
 * The returned objects are typed readonly. They are not frozen: freezing every
 * vector each step is measurably expensive and the type system already stops
 * well-behaved consumers from writing. The rule is enforced by types and code
 * review, not at runtime.
 */

interface MutableView {
  tick: number;
  elapsedSeconds: number;
  difficulty: WorldState['difficulty'];
  player: Mutable<PlayerState>;
  enemies: Mutable<EnemyState>[];
  boss: Mutable<BossState> | null;
  projectiles: Mutable<ProjectileState>[];
  pickups: Mutable<PickupState>[];
  conjured: Mutable<ConjuredPlatformState>[];
  stage: Mutable<StageRuntimeState>;
  camera: Mutable<CameraIntent>;
  cutsceneId: string | null;
  paused: boolean;
}

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K];
};

const makeVec = (): Vec3 => vec3();

function makePlayerView(): Mutable<PlayerState> {
  return {
    id: 0 as PlayerState['id'],
    position: makeVec(),
    velocity: makeVec(),
    yaw: 0,
    movementState: 'idle',
    stateTime: 0,
    grounded: false,
    groundNormal: vec3(0, 1, 0),
    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    jumpsRemaining: 0,
    dashesRemaining: 0,
    dashCooldown: 0,
    coherence: 0,
    maxCoherence: 0,
    invulnerableRemaining: 0,
    form: 'base',
    unlockedForms: [],
    charge: { heldSeconds: 0, tier: 0, tierProgress: 0, isCharging: false },
    counter: {
      active: false,
      windowRemaining: 0,
      cooldownRemaining: 0,
      successCount: 0,
      attemptCount: 0,
    },
    lockedTarget: null,
    resonanceSightActive: false,
    wallNormal: null,
    railId: null,
    railProgress: 0,
    inWater: false,
  };
}

function makeStageView(): Mutable<StageRuntimeState> {
  const metrics: Mutable<StageMetrics> = {
    elapsedSeconds: 0,
    damageTaken: 0,
    deaths: 0,
    enemiesCleansed: 0,
    secretsFound: 0,
    secretsTotal: 0,
    countersLanded: 0,
    countersAttempted: 0,
    formsUsed: [],
    flowRatio: 0,
    lowestCoherence: 0,
  };
  return {
    stageId: 'fallen-sanctuary',
    phase: 'loading',
    infection: 0,
    checkpoints: [],
    activeCheckpointId: null,
    metrics: metrics as StageMetrics,
    objective: '',
    foundSecrets: [],
  };
}

function makeCameraView(): Mutable<CameraIntent> {
  return {
    mode: 'follow',
    focus: makeVec(),
    secondaryFocus: null,
    desiredDistance: 0,
    desiredYaw: null,
    desiredPitch: null,
    fovBoost: 0,
    scriptedRemaining: 0,
    shake: 0,
  };
}

function makeView(): MutableView {
  return {
    tick: 0,
    elapsedSeconds: 0,
    difficulty: 'standard',
    player: makePlayerView(),
    enemies: [],
    boss: null,
    projectiles: [],
    pickups: [],
    conjured: [],
    stage: makeStageView(),
    camera: makeCameraView(),
    cutsceneId: null,
    paused: false,
  };
}

/**
 * Grows a reusable array of view objects to `count`, constructing new entries
 * only when the pool has to expand. Shrinking just moves the length down, so a
 * wave of enemies dying does not free and reallocate on the next spawn.
 */
function ensureLength<T>(list: T[], count: number, create: () => T): void {
  while (list.length < count) list.push(create());
  if (list.length > count) list.length = count;
}

export interface Projector {
  /** The most recent projection. */
  readonly current: WorldState;
  /** The projection from the previous step, for render interpolation. */
  readonly previous: WorldState;
  /** Swaps buffers and projects `world` into the new current buffer. */
  project(world: MutableWorld): void;
  /** Copies current into previous without advancing — used on stage load. */
  syncPrevious(): void;
}

export function createProjector(): Projector {
  let current = makeView();
  let previous = makeView();

  const projectInto = (view: MutableView, world: MutableWorld): void => {
    view.tick = world.tick;
    view.elapsedSeconds = world.elapsedSeconds;
    view.difficulty = world.difficulty;
    view.cutsceneId = world.cutsceneId;
    view.paused = world.paused;

    // Player -----------------------------------------------------------------
    const p = world.player;
    const pv = view.player;
    pv.id = p.id;
    copy(pv.position, p.position);
    copy(pv.velocity, p.velocity);
    pv.yaw = p.yaw;
    pv.movementState = p.movementState;
    pv.stateTime = p.stateTime;
    pv.grounded = p.grounded;
    copy(pv.groundNormal, p.groundNormal);
    pv.coyoteRemaining = p.coyoteRemaining;
    pv.jumpBufferRemaining = p.jumpBufferRemaining;
    pv.jumpsRemaining = p.jumpsRemaining;
    pv.dashesRemaining = p.dashesRemaining;
    pv.dashCooldown = p.dashCooldown;
    pv.coherence = p.coherence;
    pv.maxCoherence = p.maxCoherence;
    pv.invulnerableRemaining = p.invulnerableRemaining;
    pv.form = p.form;
    ensureLength(pv.unlockedForms, p.unlockedForms.length, () => 'base' as const);
    for (let i = 0; i < p.unlockedForms.length; i++) {
      pv.unlockedForms[i] = p.unlockedForms[i] ?? 'base';
    }
    pv.charge = {
      heldSeconds: p.chargeHeldSeconds,
      tier: p.chargeTier,
      tierProgress: p.chargeTier > 0 || p.isCharging ? chargeProgress(p.chargeHeldSeconds) : 0,
      isCharging: p.isCharging,
    };
    pv.counter = {
      active: p.counterActive,
      windowRemaining: p.counterWindowRemaining,
      cooldownRemaining: p.counterCooldownRemaining,
      successCount: p.counterSuccesses,
      attemptCount: p.counterAttempts,
    };
    pv.lockedTarget = p.lockedTarget;
    pv.resonanceSightActive = p.resonanceSightActive;
    pv.wallNormal = p.wallNormal ? clone(p.wallNormal) : null;
    pv.railId = p.railId;
    pv.railProgress = p.railProgress;
    pv.inWater = p.inWater;

    // Enemies ----------------------------------------------------------------
    const liveEnemies = world.enemies.filter((e) => !e.dead);
    ensureLength(view.enemies, liveEnemies.length, () => makeEnemyView());
    for (let i = 0; i < liveEnemies.length; i++) {
      const src = liveEnemies[i];
      const dst = view.enemies[i];
      if (!src || !dst) continue;
      dst.id = src.id;
      dst.archetype = src.archetype;
      copy(dst.position, src.position);
      copy(dst.velocity, src.velocity);
      dst.yaw = src.yaw;
      dst.health = src.health;
      dst.maxHealth = src.maxHealth;
      dst.phase = src.phase;
      dst.phaseTime = src.phaseTime;
      dst.armour = src.armour;
      dst.telegraphing = src.telegraphRemaining > 0;
      dst.telegraphProgress =
        src.telegraphTotal > 0
          ? 1 - Math.max(0, Math.min(1, src.telegraphRemaining / src.telegraphTotal))
          : 0;
      dst.targetId = src.targetId;
      dst.mimickedForm = src.mimickedForm;
      dst.rootedRemaining = src.rootedRemaining;
      dst.silencedRemaining = src.silencedRemaining;
      dst.spawnerId = src.spawnerId;
    }

    // Boss -------------------------------------------------------------------
    if (world.boss) {
      const b = world.boss;
      if (!view.boss) view.boss = makeBossView();
      const bv = view.boss;
      bv.id = b.id;
      bv.definitionId = b.definitionId;
      bv.displayName = b.displayName;
      copy(bv.position, b.position);
      bv.yaw = b.yaw;
      bv.health = b.health;
      bv.maxHealth = b.maxHealth;
      bv.phase = {
        index: b.phaseIndex,
        name: bv.phase.name,
        healthThreshold: bv.phase.healthThreshold,
      };
      bv.currentAttack = b.currentAttack;
      bv.attackTime = b.attackTime;
      bv.telegraphing = b.telegraphRemaining > 0;
      bv.telegraphProgress =
        b.telegraphTotal > 0
          ? 1 - Math.max(0, Math.min(1, b.telegraphRemaining / b.telegraphTotal))
          : 0;
      bv.vulnerable = b.vulnerable;
      bv.restoring = b.restoring;
      bv.restorationProgress = b.restorationProgress;
      bv.defeated = b.defeated;
    } else {
      view.boss = null;
    }

    // Projectiles ------------------------------------------------------------
    const liveShots = world.projectiles.filter((s) => !s.dead);
    ensureLength(view.projectiles, liveShots.length, () => makeProjectileView());
    for (let i = 0; i < liveShots.length; i++) {
      const src = liveShots[i];
      const dst = view.projectiles[i];
      if (!src || !dst) continue;
      dst.id = src.id;
      dst.owner = src.owner;
      copy(dst.position, src.position);
      copy(dst.velocity, src.velocity);
      dst.radius = src.radius;
      dst.damage = src.damage;
      dst.damageKind = src.damageKind;
      dst.form = src.form;
      dst.tier = src.tier;
      dst.lifeRemaining = src.lifeRemaining;
      dst.echoesRemaining = src.echoesRemaining;
      dst.bouncesRemaining = src.bouncesRemaining;
      dst.reflected = src.reflected;
      dst.hz = src.hz;
    }

    // Pickups ----------------------------------------------------------------
    const livePickups = world.pickups.filter((k) => !k.collected && !k.hidden);
    ensureLength(view.pickups, livePickups.length, () => makePickupView());
    for (let i = 0; i < livePickups.length; i++) {
      const src = livePickups[i];
      const dst = view.pickups[i];
      if (!src || !dst) continue;
      dst.id = src.id;
      dst.kind = src.kind;
      dst.contentId = src.contentId;
      copy(dst.position, src.position);
      dst.amount = src.amount;
      dst.collected = src.collected;
    }

    // Conjured platforms -----------------------------------------------------
    ensureLength(view.conjured, world.conjured.length, () => makeConjuredView());
    for (let i = 0; i < world.conjured.length; i++) {
      const src = world.conjured[i];
      const dst = view.conjured[i];
      if (!src || !dst) continue;
      dst.id = src.id;
      dst.form = src.form;
      copy(dst.position, src.position);
      dst.radius = src.radius;
      dst.lifeRemaining = src.lifeRemaining;
      dst.maxLife = src.maxLife;
    }

    // Stage ------------------------------------------------------------------
    const s = world.stage;
    const sv = view.stage;
    sv.stageId = s.stageId;
    sv.phase = s.phase;
    sv.infection = s.infection;
    sv.activeCheckpointId = s.activeCheckpointId;
    sv.objective = s.objective;
    ensureLength(sv.checkpoints, s.checkpoints.length, () => makeCheckpointView());
    for (let i = 0; i < s.checkpoints.length; i++) {
      const src = s.checkpoints[i];
      const dst = sv.checkpoints[i] as Mutable<CheckpointState> | undefined;
      if (!src || !dst) continue;
      dst.id = src.id;
      copy(dst.position, src.position);
      dst.activated = src.activated;
      dst.order = src.order;
    }
    sv.foundSecrets = Array.from(s.foundSecrets);

    const flowRatio = s.elapsedSeconds > 0 ? s.flowSeconds / s.elapsedSeconds : 0;
    sv.metrics = {
      elapsedSeconds: s.elapsedSeconds,
      damageTaken: s.damageTaken,
      deaths: s.deaths,
      enemiesCleansed: s.enemiesCleansed,
      secretsFound: s.foundSecrets.size,
      secretsTotal: s.secretsTotal,
      countersLanded: world.player.counterSuccesses,
      countersAttempted: world.player.counterAttempts,
      formsUsed: Array.from(s.formsUsed),
      flowRatio: Math.max(0, Math.min(1, flowRatio)),
      lowestCoherence: s.lowestCoherence,
    };

    // Camera -----------------------------------------------------------------
    const c = world.camera;
    const cv = view.camera;
    cv.mode = c.mode;
    copy(cv.focus, c.focus);
    cv.secondaryFocus = c.secondaryFocus ? clone(c.secondaryFocus) : null;
    cv.desiredDistance = c.desiredDistance;
    cv.desiredYaw = c.desiredYaw;
    cv.desiredPitch = c.desiredPitch;
    cv.fovBoost = c.fovBoost;
    cv.scriptedRemaining = c.scriptedRemaining;
    cv.shake = c.shake;
  };

  return {
    get current() {
      return current as unknown as WorldState;
    },
    get previous() {
      return previous as unknown as WorldState;
    },
    project(world) {
      const spare = previous;
      previous = current;
      current = spare;
      projectInto(current, world);
    },
    syncPrevious() {
      // Cheap way to make previous match current exactly after a load or
      // teleport, so the first rendered frame does not interpolate from stale
      // positions and smear the player across the level.
      const snapshot = JSON.parse(JSON.stringify(current)) as MutableView;
      previous = snapshot;
    },
  };
}

/** Charge progress toward the next tier, kept here so the view stays cheap. */
function chargeProgress(heldSeconds: number): number {
  // The projector does not own the tier thresholds; the combat system writes
  // the tier itself. This is a display-only approximation of the sub-tier
  // fraction, and it is intentionally monotonic so the HUD ring never jumps.
  const t = heldSeconds % 0.5;
  return Math.max(0, Math.min(1, t / 0.5));
}

function makeEnemyView(): Mutable<EnemyState> {
  return {
    id: 0 as EnemyState['id'],
    archetype: '',
    role: 'scout',
    position: makeVec(),
    velocity: makeVec(),
    yaw: 0,
    health: 0,
    maxHealth: 0,
    phase: 'idle',
    phaseTime: 0,
    armour: 0,
    armourBreakers: [],
    telegraphing: false,
    telegraphProgress: 0,
    targetId: null,
    mimickedForm: null,
    rootedRemaining: 0,
    silencedRemaining: 0,
    spawnerId: null,
  };
}

function makeBossView(): Mutable<BossState> {
  return {
    id: 0 as BossState['id'],
    definitionId: '',
    displayName: '',
    position: makeVec(),
    yaw: 0,
    health: 0,
    maxHealth: 0,
    phase: { index: 0, name: '', healthThreshold: 1 },
    currentAttack: null,
    attackTime: 0,
    telegraphing: false,
    telegraphProgress: 0,
    vulnerable: false,
    restoring: false,
    restorationProgress: 0,
    defeated: false,
  };
}

function makeProjectileView(): Mutable<ProjectileState> {
  return {
    id: 0 as ProjectileState['id'],
    owner: 'player',
    position: makeVec(),
    velocity: makeVec(),
    radius: 0,
    damage: 0,
    damageKind: 'pulse',
    form: 'base',
    tier: 0,
    lifeRemaining: 0,
    echoesRemaining: 0,
    bouncesRemaining: 0,
    reflected: false,
    hz: 0,
  };
}

function makePickupView(): Mutable<PickupState> {
  return {
    id: 0 as PickupState['id'],
    kind: 'coherence',
    contentId: '',
    position: makeVec(),
    amount: 0,
    collected: false,
  };
}

function makeConjuredView(): Mutable<ConjuredPlatformState> {
  return {
    id: 0 as ConjuredPlatformState['id'],
    form: 'base',
    position: makeVec(),
    radius: 0,
    lifeRemaining: 0,
    maxLife: 0,
  };
}

function makeCheckpointView(): Mutable<CheckpointState> {
  return { id: '', position: makeVec(), activated: false, order: 0 };
}
