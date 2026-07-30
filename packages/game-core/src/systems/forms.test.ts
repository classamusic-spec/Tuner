import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_PROFILES,
  RESONANCE_FORM_IDS,
  createEventBus,
  createIdAllocator,
  createRng,
  vec3,
} from '@tuner/shared';
import type { EntityId, EventBus, ResonanceFormId, Vec3 } from '@tuner/shared';
import { ACTIONS, createEmptyInputFrame } from '@tuner/input';
import type { Action, ButtonState, InputFrame } from '@tuner/input';
import type { PhysicsWorld } from '@tuner/physics';
import { ABILITY_NAMES, ABILITY_SOURCES } from '../adventure-types.js';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import type { ContentBundle } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type {
  FormAbilityDef,
  FormBurstContext,
  FormCategory,
  FormFireContext,
  FormProjectileEndContext,
} from '../forms.js';
import type { SimContext, SimServices } from '../internal/context.js';
import type {
  MutableConjured,
  MutableEnemy,
  MutablePlayer,
  MutableProjectile,
  MutableResonator,
  MutableWorld,
} from '../internal/world.js';
import {
  FORM_WHEEL_ORDER,
  RESONANCE_FORMS,
  RESONANCE_SIGHT_REVEALS,
  formAtIndex,
  formCount,
  formSystem,
  formTuningFor,
  getFormBehaviour,
  indexOfForm,
  nextUnlockedForm,
} from './forms.js';

const DT = 1 / 60;

/** Every ability except the untransformed Auralith. */
const EARNED: readonly ResonanceFormId[] = RESONANCE_FORM_IDS.filter((id) => id !== 'base');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function unsupported(name: string): never {
  throw new Error(`forms.test harness does not provide ${name}()`);
}

/** Only `restoreCoherence` is real; the ability system must need nothing else. */
function createServices(world: MutableWorld): SimServices {
  return {
    restoreCoherence(amount) {
      if (amount <= 0) return;
      const player = world.player;
      player.coherence = Math.min(player.maxCoherence, player.coherence + amount);
    },
    spawnProjectile: () => unsupported('spawnProjectile'),
    damageEnemy: () => unsupported('damageEnemy'),
    damagePlayer: () => unsupported('damagePlayer'),
    spawnConjuredPlatform: () => unsupported('spawnConjuredPlatform'),
    requestShake: () => unsupported('requestShake'),
    requestHitStop: () => unsupported('requestHitStop'),
    findEnemy: () => unsupported('findEnemy'),
    findNearestEnemy: () => unsupported('findNearestEnemy'),
    setStageFlag: () => unsupported('setStageFlag'),
    hasStageFlag: () => unsupported('hasStageFlag'),
    setObjective: () => unsupported('setObjective'),
    showSubtitle: () => unsupported('showSubtitle'),
  };
}

function createStubPhysics(): PhysicsWorld {
  return {
    addCollider: () => unsupported('addCollider'),
    removeCollider: () => unsupported('removeCollider'),
    setColliderTransform: () => unsupported('setColliderTransform'),
    clear: () => unsupported('clear'),
    moveCharacter: () => unsupported('moveCharacter'),
    raycast: () => null,
    sweepSphere: () => null,
    overlapSphere: () => [],
    colliders: [],
    stats: { colliderCount: 0, lastQueryCount: 0 },
  };
}

function createPlayer(): MutablePlayer {
  return {
    id: 1 as EntityId,
    position: vec3(),
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

function createWorld(): MutableWorld {
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

const EMPTY_CONTENT: ContentBundle = { stages: {}, enemies: {}, bosses: {} };

interface FrameSpec {
  readonly pressed?: readonly Action[];
  readonly requestedFormIndex?: number | null;
}

/** A one-step input frame: listed actions read as both held and freshly pressed. */
function makeFrame(spec: FrameSpec = {}): InputFrame {
  const buttons = {} as Record<Action, ButtonState>;
  const pressed = new Set(spec.pressed ?? []);
  for (const action of ACTIONS) {
    const down = pressed.has(action);
    buttons[action] = { down, pressed: down, released: false, heldSeconds: down ? DT : 0 };
  }
  return {
    ...createEmptyInputFrame(),
    buttons,
    requestedFormIndex: spec.requestedFormIndex ?? null,
  };
}

interface Harness {
  ctx: SimContext;
  world: MutableWorld;
  player: MutablePlayer;
  events: EventBus<GameEvents>;
  step(spec?: FrameSpec): void;
  switched(): GameEvents['form:switched'][];
  abilities(): GameEvents['form:abilityUsed'][];
}

function createHarness(): Harness {
  const world = createWorld();
  const events = createEventBus<GameEvents>();
  const switched: GameEvents['form:switched'][] = [];
  const abilities: GameEvents['form:abilityUsed'][] = [];
  events.on('form:switched', (payload) => switched.push(payload));
  events.on('form:abilityUsed', (payload) => abilities.push(payload));

  const backing = {
    world,
    physics: createStubPhysics(),
    events,
    input: makeFrame(),
    dt: DT,
    rawDt: DT,
    rng: createRng(31337),
    ids: createIdAllocator(500),
    content: EMPTY_CONTENT,
    stageDef: null,
    movement: { ...DEFAULT_MOVEMENT_CONFIG },
    combat: { ...DEFAULT_COMBAT_CONFIG },
    camera: { ...DEFAULT_CAMERA_CONFIG },
    accessibility: { ...DEFAULT_ACCESSIBILITY_CONFIG },
    difficultyProfile: { ...DIFFICULTY_PROFILES.standard },
    formBehaviour: null,
    cameraYaw: 0,
    cameraPitch: 0,
    services: createServices(world),
  };
  const ctx = backing as unknown as SimContext;

  return {
    ctx,
    world,
    player: world.player,
    events,
    step(spec = {}) {
      backing.input = makeFrame(spec);
      backing.formBehaviour = null;
      formSystem(ctx);
      world.tick++;
      world.elapsedSeconds += DT;
    },
    switched: () => switched,
    abilities: () => abilities,
  };
}

let nextEnemyId = 900;

function makeEnemy(position: Vec3, overrides: Partial<MutableEnemy> = {}): MutableEnemy {
  return {
    id: nextEnemyId++ as EntityId,
    spawnId: 'spawn-test',
    archetype: 'dummy',
    position: vec3(position.x, position.y, position.z),
    velocity: vec3(),
    yaw: 0,
    health: 100,
    maxHealth: 100,
    armour: 0,
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
}

let nextProjectileId = 2000;

function makeProjectile(
  owner: 'player' | 'enemy',
  position: Vec3,
  overrides: Partial<MutableProjectile> = {},
): MutableProjectile {
  return {
    id: nextProjectileId++ as EntityId,
    owner,
    ownerId: 1 as EntityId,
    position: vec3(position.x, position.y, position.z),
    velocity: vec3(0, 0, -20),
    radius: 0.3,
    damage: 10,
    damageKind: 'pulse',
    form: 'base',
    tier: 0,
    lifeRemaining: 2,
    echoesRemaining: 0,
    echoDelay: 0,
    bouncesRemaining: 0,
    reflected: false,
    counterable: true,
    hz: 432,
    gravityScale: 0,
    homingTarget: null,
    homingStrength: 0,
    dead: false,
    ...overrides,
  };
}

function makeResonator(id: string, position: Vec3, lit: number): MutableResonator {
  return {
    id,
    puzzleId: 'puzzle-test',
    position: vec3(position.x, position.y, position.z),
    degree: 2,
    order: 0,
    litRemaining: lit,
    holdSeconds: 2,
    requiresForm: null,
    locked: false,
  };
}

function makeConjured(position: Vec3): MutableConjured {
  return {
    id: nextProjectileId++ as EntityId,
    form: 'echo',
    position: vec3(position.x, position.y, position.z),
    radius: 1.2,
    lifeRemaining: 3,
    maxLife: 3,
    collider: null,
  };
}

/** Records everything an `onFire` hook does to a shot. */
interface FireRecord {
  echoes: number;
  bounces: number;
  damageScale: number;
  additional: { direction: Vec3; damageScale: number }[];
}

function runOnFire(form: ResonanceFormId, tier: number): FireRecord {
  const record: FireRecord = { echoes: 0, bounces: 0, damageScale: 1, additional: [] };
  const behaviour = getFormBehaviour(form);
  const context: FormFireContext = {
    projectileId: 1 as EntityId,
    tier,
    origin: vec3(),
    direction: vec3(0, 0, -1),
    setEchoes(count) {
      record.echoes = count;
    },
    setBounces(count) {
      record.bounces = count;
    },
    setDamageScale(scale) {
      record.damageScale *= scale;
    },
    spawnAdditional(direction, damageScale) {
      record.additional.push({ direction, damageScale });
    },
  };
  behaviour?.onFire?.(context);
  return record;
}

interface BurstRecord {
  rootSeconds: number;
  silenceSeconds: number;
  coherence: number;
}

function runOnBurst(form: ResonanceFormId): BurstRecord {
  const record: BurstRecord = { rootSeconds: 0, silenceSeconds: 0, coherence: 0 };
  const behaviour = getFormBehaviour(form);
  const context: FormBurstContext = {
    position: vec3(),
    radius: 5,
    rootEnemiesInRadius(seconds) {
      record.rootSeconds = seconds;
    },
    silenceEnemiesInRadius(seconds) {
      record.silenceSeconds = seconds;
    },
    restoreCoherence(amount) {
      record.coherence += amount;
    },
  };
  behaviour?.onBurst?.(context);
  return record;
}

function runOnProjectileEnd(
  form: ResonanceFormId,
  hitSomething: boolean,
): { platforms: number; echoes: number } {
  const out = { platforms: 0, echoes: 0 };
  const behaviour = getFormBehaviour(form);
  const context: FormProjectileEndContext = {
    position: vec3(1, 2, 3),
    direction: vec3(0, 0, -1),
    tier: 0,
    hitSomething,
    spawnEcho() {
      out.echoes++;
    },
    spawnPlatform() {
      out.platforms++;
    },
  };
  behaviour?.onProjectileEnd?.(context);
  return out;
}

function allAbilities(form: ResonanceFormId): readonly FormAbilityDef[] {
  return RESONANCE_FORMS[form].abilities;
}

function categoriesOf(form: ResonanceFormId): Set<FormCategory> {
  const out = new Set<FormCategory>();
  for (const ability of allAbilities(form)) {
    for (const category of ability.categories) out.add(category);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('the ability registry', () => {
  it('defines all nine ids, once each, with base first on the wheel', () => {
    expect(Object.keys(RESONANCE_FORMS).sort()).toEqual([...RESONANCE_FORM_IDS].sort());
    expect([...FORM_WHEEL_ORDER].sort()).toEqual([...RESONANCE_FORM_IDS].sort());
    expect(new Set(FORM_WHEEL_ORDER).size).toBe(RESONANCE_FORM_IDS.length);
    expect(FORM_WHEEL_ORDER[0]).toBe('base');
    for (const id of RESONANCE_FORM_IDS) {
      expect(RESONANCE_FORMS[id].id).toBe(id);
      expect(RESONANCE_FORMS[id].tuning.id).toBe(id);
    }
  });

  it('populates every field on every ability', () => {
    for (const id of RESONANCE_FORM_IDS) {
      const def = RESONANCE_FORMS[id];
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.tagline.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(40);
      expect(def.source.length).toBeGreaterThan(0);
      expect(def.silhouette.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.soundFamily.length).toBeGreaterThan(0);
      expect(def.abilities.length).toBeGreaterThanOrEqual(4);
      expect(def.upgrades.length).toBeGreaterThanOrEqual(2);
      expect(def.tuning.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.tuning.damageScale).toBeGreaterThan(0);
      expect(def.tuning.fireIntervalScale).toBeGreaterThan(0);
      expect(def.tuning.projectileSpeedScale).toBeGreaterThan(0);
      expect(Number.isInteger(def.tuning.harmonicDegree)).toBe(true);
      for (const ability of def.abilities) {
        expect(ability.id.startsWith(`${id}-`)).toBe(true);
        expect(ability.name.length).toBeGreaterThan(0);
        expect(ability.description.length).toBeGreaterThan(20);
        expect(ability.categories.length).toBeGreaterThan(0);
      }
      for (const upgrade of def.upgrades) {
        expect(upgrade.id.startsWith(`${id}-`)).toBe(true);
        expect(upgrade.name.length).toBeGreaterThan(0);
        expect(upgrade.description.length).toBeGreaterThan(10);
        expect(upgrade.shardCost).toBeGreaterThan(0);
      }
    }
  });

  it('shares no colour, icon, silhouette, sound family or harmonic degree', () => {
    const colours = new Set<string>();
    const icons = new Set<string>();
    const silhouettes = new Set<string>();
    const families = new Set<string>();
    const degrees = new Set<number>();
    for (const id of RESONANCE_FORM_IDS) {
      const def = RESONANCE_FORMS[id];
      colours.add(def.tuning.colour.toLowerCase());
      icons.add(def.icon);
      silhouettes.add(def.silhouette);
      families.add(def.soundFamily);
      degrees.add(def.tuning.harmonicDegree);
    }
    const expected = RESONANCE_FORM_IDS.length;
    expect(colours.size).toBe(expected);
    expect(icons.size).toBe(expected);
    expect(silhouettes.size).toBe(expected);
    expect(families.size).toBe(expected);
    expect(degrees.size).toBe(expected);
  });

  it('gives every capability across the whole registry a unique id', () => {
    const ids = new Set<string>();
    let total = 0;
    for (const id of RESONANCE_FORM_IDS) {
      for (const ability of allAbilities(id)) {
        ids.add(ability.id);
        total++;
      }
      for (const upgrade of RESONANCE_FORMS[id].upgrades) {
        ids.add(upgrade.id);
        total++;
      }
    }
    expect(ids.size).toBe(total);
  });

  it('has every earned ability serve at least two distinct categories', () => {
    for (const id of EARNED) {
      expect(categoriesOf(id).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('has every earned ability serve exploration, combat and secrets-or-puzzles', () => {
    for (const id of EARNED) {
      const categories = categoriesOf(id);
      const exploration = categories.has('movement') || categories.has('platforming');
      const combat = categories.has('combat');
      const discovery = categories.has('secret') || categories.has('puzzle');
      expect(exploration, `${id} serves exploration or movement`).toBe(true);
      expect(combat, `${id} serves combat`).toBe(true);
      expect(discovery, `${id} serves secrets or puzzles`).toBe(true);
    }
  });

  it('covers at least two design pillars per earned ability', () => {
    // The seven pillars, expressed through the category vocabulary the content
    // format actually has, so "serves two pillars" is checkable rather than
    // asserted in a comment.
    const PILLARS: Readonly<Record<string, readonly FormCategory[]>> = {
      exploration: ['movement', 'platforming'],
      backtracking: ['movement', 'platforming'],
      puzzles: ['puzzle'],
      combat: ['combat'],
      bosses: ['combat'],
      secrets: ['secret'],
      restoration: ['environment'],
    };
    for (const id of EARNED) {
      const categories = categoriesOf(id);
      const served = Object.entries(PILLARS).filter(([, needed]) =>
        needed.some((category) => categories.has(category)),
      );
      expect(served.length, `${id} serves ${served.length} pillars`).toBeGreaterThanOrEqual(2);
    }
  });

  it('takes every display name from ABILITY_NAMES', () => {
    for (const id of RESONANCE_FORM_IDS) {
      expect(RESONANCE_FORMS[id].name).toBe(ABILITY_NAMES[id]);
    }
    // And the mapping itself still says what the design says, so a rename in
    // adventure-types cannot quietly redefine what the player is told.
    expect(ABILITY_NAMES).toEqual({
      base: 'Open Chord',
      echo: 'Echo Pulse',
      prism: 'Mirror Tone',
      tidal: 'Resonance Thread',
      ember: 'Pulse Step',
      choir: 'Split Chord',
      bloom: 'Bloom Wave',
      silence: 'Silence Field',
      celestial: 'World Chord',
    });
  });

  it('credits every taught ability to a guardian that was freed, not killed', () => {
    for (const entry of ABILITY_SOURCES) {
      const def = RESONANCE_FORMS[entry.ability];
      expect(def.source.toLowerCase()).toContain('freed');
      expect(def.description.length).toBeGreaterThan(0);
    }
    // Open Chord is made, not taken; World Chord is assembled from the rest.
    expect(ABILITY_SOURCES.some((entry) => entry.ability === 'base')).toBe(false);
    expect(ABILITY_SOURCES.some((entry) => entry.ability === 'celestial')).toBe(false);
    expect(RESONANCE_FORMS.base.source.toLowerCase()).not.toContain('freed');
  });

  it('describes Open Chord as sufficient rather than provisional', () => {
    const base = RESONANCE_FORMS.base;
    expect(base.description).toContain('every guardian');
    expect(categoriesOf('base').has('combat')).toBe(true);
    expect(getFormBehaviour('base')).toBeNull();
  });

  it('re-specs Pulse Step as movement rather than fire', () => {
    const ember = RESONANCE_FORMS.ember;
    const categories = categoriesOf('ember');
    expect(ember.name).toBe('Pulse Step');
    expect(categories.has('movement')).toBe(true);
    expect(ember.abilities.some((a) => a.categories.includes('combat'))).toBe(true);
    // A movement ability is nimble, not heavy: it no longer trades cadence for
    // weight the way the old fire ability did.
    expect(ember.tuning.projectileSpeedScale).toBeGreaterThan(1);
    expect(ember.tuning.fireIntervalScale).toBeLessThanOrEqual(1);
    expect(getFormBehaviour('ember')?.onFire).toBeUndefined();
  });

  it('clamps tuning into a sane range for every ability', () => {
    for (const id of RESONANCE_FORM_IDS) {
      const tuning = formTuningFor(id);
      expect(tuning.damageScale).toBeGreaterThanOrEqual(0.1);
      expect(tuning.damageScale).toBeLessThanOrEqual(4);
      expect(tuning.fireIntervalScale).toBeGreaterThanOrEqual(0.25);
      expect(tuning.projectileSpeedScale).toBeGreaterThanOrEqual(0.25);
      expect(tuning.colour).toBe(RESONANCE_FORMS[id].tuning.colour);
      expect(tuning.harmonicDegree).toBe(RESONANCE_FORMS[id].tuning.harmonicDegree);
    }
  });
});

// ---------------------------------------------------------------------------
// Resonance Sight
// ---------------------------------------------------------------------------

describe('Resonance Sight', () => {
  it('publishes one shared list of what it reveals', () => {
    expect(RESONANCE_SIGHT_REVEALS.length).toBeGreaterThanOrEqual(9);
    for (const reveal of RESONANCE_SIGHT_REVEALS) {
      expect(reveal.id.length).toBeGreaterThan(0);
      expect(reveal.description.length).toBeGreaterThan(20);
      expect(reveal.label.length).toBeGreaterThan(0);
      expect(reveal.overlay.length).toBeGreaterThan(0);
      expect(reveal.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof reveal.criticalPath).toBe('boolean');
    }
  });

  it('keeps ids, overlays and colours distinct so nothing renders twice', () => {
    const ids = new Set(RESONANCE_SIGHT_REVEALS.map((r) => r.id));
    const overlays = new Set(RESONANCE_SIGHT_REVEALS.map((r) => r.overlay));
    const colours = new Set(RESONANCE_SIGHT_REVEALS.map((r) => r.colour.toLowerCase()));
    expect(ids.size).toBe(RESONANCE_SIGHT_REVEALS.length);
    expect(overlays.size).toBe(RESONANCE_SIGHT_REVEALS.length);
    expect(colours.size).toBe(RESONANCE_SIGHT_REVEALS.length);
  });

  it('covers everything the mode is specified to surface', () => {
    const ids = RESONANCE_SIGHT_REVEALS.map((r) => r.id);
    for (const required of [
      'hidden-frequencies',
      'broken-paths',
      'invisible-platforms',
      'alien-weak-points',
      'buried-melodies',
      'emotional-echoes',
      'secret-objects',
      'natural-anchors',
      'infection-sources',
    ]) {
      expect(ids).toContain(required);
    }
    // The muted critical path leans on these, so at least the load-bearing ones
    // must be marked as such rather than left optional.
    expect(RESONANCE_SIGHT_REVEALS.filter((r) => r.criticalPath).length).toBeGreaterThanOrEqual(5);
  });

  it('is not one of the eight abilities', () => {
    const ids: readonly string[] = RESONANCE_FORM_IDS;
    for (const reveal of RESONANCE_SIGHT_REVEALS) {
      expect(ids).not.toContain(reveal.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Wheel arithmetic
// ---------------------------------------------------------------------------

describe('wheel arithmetic', () => {
  it('counts the wheel and wraps indices in both directions', () => {
    expect(formCount()).toBe(RESONANCE_FORM_IDS.length);
    expect(formAtIndex(0)).toBe('base');
    expect(formAtIndex(formCount())).toBe('base');
    expect(formAtIndex(-1)).toBe(FORM_WHEEL_ORDER[formCount() - 1]);
    for (let i = 0; i < formCount(); i++) {
      expect(indexOfForm(formAtIndex(i))).toBe(i);
    }
  });

  it('steps through the unlocked set only, and never onto a locked ability', () => {
    const unlocked: readonly ResonanceFormId[] = ['base', 'tidal', 'silence'];
    expect(nextUnlockedForm('base', unlocked, 1)).toBe('tidal');
    expect(nextUnlockedForm('tidal', unlocked, 1)).toBe('silence');
    // Wraps over the owned set rather than walking into locked abilities.
    expect(nextUnlockedForm('silence', unlocked, 1)).toBe('base');
    expect(nextUnlockedForm('base', unlocked, -1)).toBe('silence');
    expect(nextUnlockedForm('silence', unlocked, -1)).toBe('tidal');

    for (const direction of [1, -1] as const) {
      let at: ResonanceFormId = 'base';
      for (let i = 0; i < 12; i++) {
        at = nextUnlockedForm(at, unlocked, direction);
        expect(unlocked).toContain(at);
      }
    }
  });

  it('degrades safely with one ability, or none', () => {
    expect(nextUnlockedForm('base', ['base'], 1)).toBe('base');
    expect(nextUnlockedForm('base', [], 1)).toBe('base');
    // Equipped something not owned: falls back to the first owned ability
    // rather than leaving the player on a slot they cannot use.
    expect(nextUnlockedForm('ember', ['base', 'echo'], 1)).toBe('base');
  });
});

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

describe('switching abilities', () => {
  it('selects an unlocked ability by index and announces it once', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'echo'];
    h.step({ requestedFormIndex: indexOfForm('echo') });

    expect(h.player.form).toBe('echo');
    expect(h.switched().length).toBe(1);
    expect(h.switched()[0]).toEqual({ from: 'base', to: 'echo' });
    expect(h.world.stage.formsUsed.has('echo')).toBe(true);
  });

  it('ignores an index the player has not earned', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'echo'];
    h.step({ requestedFormIndex: indexOfForm('celestial') });

    expect(h.player.form).toBe('base');
    expect(h.switched().length).toBe(0);
  });

  it('says nothing when the equipped ability is re-selected', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'echo'];
    h.player.form = 'echo';

    h.step({ requestedFormIndex: indexOfForm('echo') });
    expect(h.player.form).toBe('echo');
    expect(h.switched().length).toBe(0);

    // A real change still announces itself, so the silence above is about
    // re-selection rather than about the system being inert.
    h.step({ pressed: ['formNext'] });
    expect(h.player.form).toBe('base');
    expect(h.switched().length).toBe(1);
    expect(h.switched()[0]).toEqual({ from: 'echo', to: 'base' });
  });

  it('discards an in-progress charge, so a cheap charge cannot fire an expensive note', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'celestial'];
    h.player.isCharging = true;
    h.player.chargeHeldSeconds = 0.9;
    h.player.chargeTier = 2;

    h.step({ requestedFormIndex: indexOfForm('celestial') });

    expect(h.player.form).toBe('celestial');
    expect(h.player.isCharging).toBe(false);
    expect(h.player.chargeHeldSeconds).toBe(0);
    expect(h.player.chargeTier).toBe(0);
  });

  it('cycles forward and back across the unlocked set only', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'prism', 'bloom'];

    h.step({ pressed: ['formNext'] });
    expect(h.player.form).toBe('prism');
    h.step({ pressed: ['formNext'] });
    expect(h.player.form).toBe('bloom');
    h.step({ pressed: ['formNext'] });
    expect(h.player.form).toBe('base');
    h.step({ pressed: ['formPrev'] });
    expect(h.player.form).toBe('bloom');
    expect(h.switched().length).toBe(4);
    expect(h.switched().every((event) => event.from !== event.to)).toBe(true);
  });

  it('does not switch while paused or downed', () => {
    const h = createHarness();
    h.player.unlockedForms = ['base', 'echo'];
    h.world.paused = true;
    h.step({ requestedFormIndex: indexOfForm('echo') });
    expect(h.player.form).toBe('base');

    h.world.paused = false;
    h.player.movementState = 'downed';
    h.step({ requestedFormIndex: indexOfForm('echo') });
    expect(h.player.form).toBe('base');
    expect(h.switched().length).toBe(0);
  });

  it('records the equipped ability every step, switch or not', () => {
    const h = createHarness();
    h.player.form = 'silence';
    h.step();
    expect(h.world.stage.formsUsed.has('silence')).toBe(true);
    expect(h.world.stage.formsUsed.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Behaviour hooks
// ---------------------------------------------------------------------------

describe('behaviour hooks', () => {
  it('resolves for every ability without throwing', () => {
    for (const id of RESONANCE_FORM_IDS) {
      expect(() => getFormBehaviour(id)).not.toThrow();
      const behaviour = getFormBehaviour(id);
      if (behaviour !== null) expect(behaviour.id).toBe(id);
    }
    expect(getFormBehaviour('base')).toBeNull();
    for (const id of EARNED) {
      expect(getFormBehaviour(id), `${id} has behaviour`).not.toBeNull();
    }
  });

  it('has Echo Pulse arrive twice, and leave a standing wave only when it missed', () => {
    expect(runOnFire('echo', 0).echoes).toBeGreaterThan(0);
    expect(runOnProjectileEnd('echo', false).platforms).toBe(1);
    expect(runOnProjectileEnd('echo', true).platforms).toBe(0);
  });

  it('has Mirror Tone reflect, and mirror a charged note back down its own line', () => {
    const tap = runOnFire('prism', 0);
    expect(tap.bounces).toBeGreaterThan(0);
    expect(tap.additional.length).toBe(0);

    const charged = runOnFire('prism', 2);
    expect(charged.bounces).toBeGreaterThan(0);
    expect(charged.additional.length).toBe(1);
    // The copy is the mirror of the note that was aimed.
    expect(charged.additional[0]?.direction.z).toBeCloseTo(1, 9);
    expect(charged.additional[0]?.damageScale).toBeLessThan(1);
  });

  it('has Split Chord hold several voices at once', () => {
    const tap = runOnFire('choir', 0);
    const charged = runOnFire('choir', 2);
    expect(tap.additional.length).toBeGreaterThanOrEqual(2);
    expect(charged.additional.length).toBeGreaterThan(tap.additional.length);
    // Individually weak, so a fan never out-damages a single charged note.
    for (const extra of charged.additional) expect(extra.damageScale).toBeLessThan(1);
    // Fanned across an arc rather than stacked on one line.
    const headings = new Set(charged.additional.map((extra) => extra.direction.x.toFixed(4)));
    expect(headings.size).toBe(charged.additional.length);
  });

  it('has Bloom Wave root and mend on a burst, and grow ground from a spent wave', () => {
    const burst = runOnBurst('bloom');
    expect(burst.rootSeconds).toBeGreaterThan(0);
    expect(burst.coherence).toBeGreaterThan(0);
    expect(runOnProjectileEnd('bloom', false).platforms).toBe(1);
    expect(runOnProjectileEnd('bloom', true).platforms).toBe(0);
  });

  it('has Silence Field silence on a burst without dealing extra harm', () => {
    const burst = runOnBurst('silence');
    expect(burst.silenceSeconds).toBeGreaterThan(0);
    expect(burst.rootSeconds).toBe(0);
    expect(burst.coherence).toBe(0);
  });

  it('has Resonance Thread restrain briefly, well short of Bloom Wave rooting', () => {
    const thread = runOnBurst('tidal');
    expect(thread.rootSeconds).toBeGreaterThan(0);
    expect(thread.rootSeconds).toBeLessThan(runOnBurst('bloom').rootSeconds);
    expect(runOnProjectileEnd('tidal', false).platforms).toBe(1);
  });

  it('has Pulse Step hold briefly on landing rather than detonate', () => {
    const step = runOnBurst('ember');
    expect(step.rootSeconds).toBeGreaterThan(0);
    expect(step.rootSeconds).toBeLessThan(runOnBurst('tidal').rootSeconds);
  });

  it('has World Chord draw on the whole scale when charged', () => {
    expect(runOnFire('celestial', 0).damageScale).toBe(1);
    expect(runOnFire('celestial', 2).damageScale).toBeGreaterThan(1);
    expect(runOnBurst('celestial').coherence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------

describe('ability passives', () => {
  it('has a Silence Field mute what walks into it, announcing each creature once', () => {
    const h = createHarness();
    h.player.form = 'silence';
    const near = makeEnemy(vec3(0, 0, -4));
    const far = makeEnemy(vec3(0, 0, -40));
    h.world.enemies.push(near, far);

    h.step();
    expect(near.silencedRemaining).toBeGreaterThan(0);
    expect(far.silencedRemaining).toBe(0);

    // Refreshed rather than re-announced while it stays inside.
    h.step();
    const cues = h.abilities().filter((cue) => cue.ability === 'silence-stealth');
    expect(cues.length).toBe(1);
    expect(cues[0]?.form).toBe('silence');
    expect(cues[0]?.position.z).toBeCloseTo(-4, 9);
  });

  it('has a Silence Field stop frequency projectiles, and say where', () => {
    const h = createHarness();
    h.player.form = 'silence';
    const incoming = makeProjectile('enemy', vec3(0, 0, -3));
    const outgoing = makeProjectile('player', vec3(0, 0, -3));
    const distant = makeProjectile('enemy', vec3(0, 0, -50));
    h.world.projectiles.push(incoming, outgoing, distant);

    h.step();

    expect(incoming.dead).toBe(true);
    expect(distant.dead).toBe(false);
    // The player's own notes are not eaten by their own field.
    expect(outgoing.dead).toBe(false);
    const cues = h.abilities().filter((cue) => cue.ability === 'silence-stop');
    expect(cues.length).toBe(1);
    expect(cues[0]?.position.z).toBeCloseTo(-3, 9);
  });

  it('has Bloom Wave return Coherence only while grounded and unharmed', () => {
    const h = createHarness();
    h.player.form = 'bloom';
    h.player.coherence = 50;

    h.step();
    const afterGrounded = h.player.coherence;
    expect(afterGrounded).toBeGreaterThan(50);

    h.player.hurtThisStep = true;
    h.step();
    expect(h.player.coherence).toBe(afterGrounded);

    h.player.hurtThisStep = false;
    h.player.grounded = false;
    h.step();
    expect(h.player.coherence).toBe(afterGrounded);
  });

  it('has Resonance Thread sustain a lit resonator without exceeding its authored hold', () => {
    const h = createHarness();
    h.player.form = 'tidal';
    const lit = makeResonator('r-lit', vec3(2, 0, 0), 1);
    const dark = makeResonator('r-dark', vec3(4, 0, 0), 0);
    const full = makeResonator('r-full', vec3(6, 0, 0), 2);
    h.world.stage.resonators.set(lit.id, lit);
    h.world.stage.resonators.set(dark.id, dark);
    h.world.stage.resonators.set(full.id, full);

    h.step();

    expect(lit.litRemaining).toBeGreaterThan(1);
    // Half a step back, so the net drain is halved rather than cancelled.
    expect(lit.litRemaining).toBeLessThan(1 + DT);
    // An unlit resonator is not lit by conduction, and a full one cannot overflow.
    expect(dark.litRemaining).toBe(0);
    expect(full.litRemaining).toBe(full.holdSeconds);
  });

  it('has Pulse Step recover faster than an ordinary dash', () => {
    const h = createHarness();
    h.player.form = 'ember';
    h.player.dashCooldown = 0.4;
    h.step();
    const stepped = h.player.dashCooldown;
    expect(stepped).toBeLessThan(0.4);

    const plain = createHarness();
    plain.player.form = 'base';
    plain.player.dashCooldown = 0.4;
    plain.step();
    expect(plain.player.dashCooldown).toBe(0.4);
    expect(stepped).toBeLessThan(plain.player.dashCooldown);
  });

  it('has the Pulse Step itself be the dodge, announced once per step', () => {
    const h = createHarness();
    h.player.form = 'ember';
    h.player.dashTimeRemaining = 0.17;

    h.step();
    expect(h.player.invulnerableRemaining).toBeGreaterThan(0.17);
    const dodges = h.abilities().filter((cue) => cue.ability === 'ember-dodge');
    expect(dodges.length).toBe(1);

    // Still stepping, already untouchable: no second announcement.
    h.player.dashTimeRemaining = 0.1;
    h.step();
    expect(h.abilities().filter((cue) => cue.ability === 'ember-dodge').length).toBe(1);
  });

  it('has Pulse Step chain off a resonant anchor, and only off one', () => {
    const h = createHarness();
    h.player.form = 'ember';
    h.player.grounded = false;
    h.player.dashesRemaining = 0;
    h.player.dashCooldown = 0;

    // Empty space returns nothing.
    h.step();
    expect(h.player.dashesRemaining).toBe(0);
    expect(h.abilities().filter((cue) => cue.ability === 'ember-chain').length).toBe(0);

    h.world.conjured.push(makeConjured(vec3(0, 0, -3)));
    h.step();
    expect(h.player.dashesRemaining).toBe(1);
    expect(h.abilities().filter((cue) => cue.ability === 'ember-chain').length).toBe(1);
  });

  it('does not chain while grounded or mid-step', () => {
    const h = createHarness();
    h.player.form = 'ember';
    h.player.dashesRemaining = 0;
    h.world.enemies.push(makeEnemy(vec3(0, 0, -2)));

    h.step();
    expect(h.player.dashesRemaining).toBe(0);

    h.player.grounded = false;
    h.player.dashCooldown = 0.3;
    h.step();
    expect(h.player.dashesRemaining).toBe(0);
  });

  it('has World Chord carry the passives of abilities the player actually earned', () => {
    const h = createHarness();
    h.player.form = 'celestial';
    h.player.unlockedForms = ['base', 'celestial'];
    h.player.coherence = 50;
    const enemy = makeEnemy(vec3(0, 0, -3));
    h.world.enemies.push(enemy);

    h.step();
    // Neither Bloom Wave nor Silence Field earned: the finale inherits nothing.
    expect(h.player.coherence).toBe(50);
    expect(enemy.silencedRemaining).toBe(0);

    h.player.unlockedForms = ['base', 'bloom', 'silence', 'celestial'];
    h.step();
    expect(h.player.coherence).toBeGreaterThan(50);
    expect(enemy.silencedRemaining).toBeGreaterThan(0);
  });

  it('has World Chord carry a passive at a share of its own strength', () => {
    const whole = createHarness();
    whole.player.form = 'bloom';
    whole.player.unlockedForms = ['base', 'bloom'];
    whole.player.coherence = 50;
    whole.step();

    const shared = createHarness();
    shared.player.form = 'celestial';
    shared.player.unlockedForms = ['base', 'bloom', 'celestial'];
    shared.player.coherence = 50;
    shared.step();

    expect(shared.player.coherence).toBeGreaterThan(50);
    expect(shared.player.coherence).toBeLessThan(whole.player.coherence);
  });

  it('reaches a shorter distance when World Chord carries a Silence Field', () => {
    // Nine metres equipped directly; less than that as one fragment of the chord.
    const direct = createHarness();
    direct.player.form = 'silence';
    const farFromDirect = makeEnemy(vec3(0, 0, -8));
    direct.world.enemies.push(farFromDirect);
    direct.step();
    expect(farFromDirect.silencedRemaining).toBeGreaterThan(0);

    const carried = createHarness();
    carried.player.form = 'celestial';
    carried.player.unlockedForms = ['base', 'silence', 'celestial'];
    const farFromChord = makeEnemy(vec3(0, 0, -8));
    carried.world.enemies.push(farFromChord);
    carried.step();
    expect(farFromChord.silencedRemaining).toBe(0);
  });

  it('leaves an ability with no passive alone', () => {
    const h = createHarness();
    h.player.form = 'echo';
    h.player.coherence = 50;
    h.player.dashCooldown = 0.4;
    const enemy = makeEnemy(vec3(0, 0, -2));
    h.world.enemies.push(enemy);

    h.step();

    expect(h.player.coherence).toBe(50);
    expect(h.player.dashCooldown).toBe(0.4);
    expect(enemy.silencedRemaining).toBe(0);
    expect(h.abilities().length).toBe(0);
  });
});
