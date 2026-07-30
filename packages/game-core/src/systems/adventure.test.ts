import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_PROFILES,
  createEventBus,
  createIdAllocator,
  createRng,
  vec3,
} from '@tuner/shared';
import type { EntityId, EventBus, ResonanceFormId } from '@tuner/shared';
import { createEmptyInputFrame } from '@tuner/input';
import type { Action, ButtonState, InputFrame } from '@tuner/input';
import { Layer } from '@tuner/physics';
import type { ColliderHandle, MoveResult, PhysicsWorld } from '@tuner/physics';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
} from '../config.js';
import { ABILITY_NAMES } from '../adventure-types.js';
import type {
  CodexEntryDef,
  DialogueTree,
  MapMarkerDef,
  MotifCardDef,
  NpcDef,
  QuestDef,
  QuestStepCondition,
} from '../adventure-types.js';
import type { ContentBundle, StageDef } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { FormBehaviour } from '../forms.js';
import type { SimContext, SimServices } from '../internal/context.js';
import { createSimServices } from '../internal/services.js';
import type { MutablePlayer, MutableWorld } from '../internal/world.js';
import {
  INTERACT_REACH,
  yawTowards,
  addAdventureContent,
  adventureRuntimeFor,
  adventureSystem,
  attachAdventureEvents,
  attachAdventureRuntime,
  buildQuestView,
  createAdventureEffects,
  createAdventureRuntime,
  createAdventureSystem,
  projectAdventureState,
  projectNpcViews,
  resetAdventureRuntime,
  skipAdventureDialogue,
  type AdventureContent,
  type AdventureRuntime,
} from './adventure.js';
import {
  DEFAULT_BEAT_SECONDS,
  availableChoices,
  chooseDialogueOption,
  createDialogueRuntime,
  isDialogueActive,
  projectDialogueState,
  selectDialogueForNpc,
  skipDialogue,
  startDialogue,
  tickDialogue,
  type DialogueEffects,
  type DialogueRuntime,
} from './dialogue.js';
import {
  cleanseConditionMet,
  collectConditionMet,
  countCollected,
  createQuestWorldView,
  defeatBossConditionMet,
  flagConditionMet,
  isStepAvailable,
  isStepConditionMet,
  nextObjectiveOf,
  questProgressOf,
  reachAreaConditionMet,
  solvePuzzleConditionMet,
  startQuest,
  talkToConditionMet,
  type QuestWorldView,
} from './quests.js';

const DT = 1 / 60;
const START_COHERENCE = 200;

// ---------------------------------------------------------------------------
// Authored content
//
// Hand-built, so every test states its own premise. Names, places and lines are
// original to this project.
// ---------------------------------------------------------------------------

const GREETING: DialogueTree = {
  id: 'yenna-greeting',
  beats: [
    { speaker: 'Yenna', text: 'You carry the Auralith. I can hear it from here.', seconds: 1 },
    { speaker: 'Yenna', text: 'The garden has been a half-step sharp all season.', seconds: 1 },
    { speaker: 'Tuner', text: 'Then I will bring it back down.', seconds: 1 },
  ],
};

const HINT: DialogueTree = {
  id: 'yenna-hint',
  beats: [{ speaker: 'Yenna', text: 'The reeds answer in threes.', seconds: 0.5 }],
  consumedByFlag: 'heard-reed-hint',
};

const STORY: DialogueTree = {
  id: 'yenna-crash',
  beats: [{ speaker: 'Yenna', text: 'Something fell through the sky and it is still humming.', seconds: 0.5 }],
  requiresFlag: 'saw-the-fall',
};

const AMBIENT: DialogueTree = {
  id: 'yenna-ambient',
  beats: [{ speaker: 'Yenna', text: 'Mind the loose terrace stone.', seconds: 0.5 }],
};

const RESTORED_TALK: DialogueTree = {
  id: 'yenna-restored',
  beats: [{ speaker: 'Yenna', text: 'Listen. It sits right where it should.', seconds: 0.5 }],
};

const BRANCHING: DialogueTree = {
  id: 'ost-directions',
  beats: [
    { speaker: 'Ost', text: 'Two ways up from here.', seconds: 0.4 },
    { speaker: 'Ost', text: 'The terrace stair is slow and quiet.', seconds: 0.4 },
    { speaker: 'Ost', text: 'The reed bridge is quick and it will cost you.', seconds: 0.4 },
  ],
  choices: [
    { text: 'Tell me about the stair.', goTo: 1, setsFlag: 'asked-about-stair' },
    { text: 'Tell me about the bridge.', goTo: 2, setsFlag: 'asked-about-bridge' },
    { text: 'Nothing. Thank you.', goTo: null },
    { text: 'What fell from the sky?', goTo: 0, requiresFlag: 'saw-the-fall' },
  ],
};

const TEMPLE_GIFT: DialogueTree = {
  id: 'first-breath-gift',
  beats: [{ speaker: 'Oru', text: 'Take the pulse. It was always mine to lend.', seconds: 0.2 }],
  setsFlagOnComplete: 'echo-taught',
  grantsAbility: 'echo',
  startsQuest: 'restore-the-garden',
  completesQuest: 'reach-the-temple',
  cinematic: true,
};

const KEEPER: NpcDef = {
  id: 'keeper-yenna',
  displayName: 'Yenna',
  appearance: 'keeper-robes',
  position: vec3(0, 0, 10),
  dialogue: ['yenna-crash', 'yenna-hint', 'yenna-ambient'],
  restoredAppearance: 'keeper-robes-bright',
  restoredDialogue: ['yenna-restored'],
  routine: { kind: 'idle' },
};

const WALKER: NpcDef = {
  id: 'walker-ost',
  displayName: 'Ost',
  appearance: 'reed-cutter',
  position: vec3(0, 0, 0),
  dialogue: ['ost-directions'],
  routine: { kind: 'patrol', points: [vec3(0, 0, 12)], speed: 3 },
};

const REACH_TEMPLE: QuestDef = {
  id: 'reach-the-temple',
  title: 'Find the Temple of the First Breath',
  summary: 'The garden points inward. Follow it.',
  region: 'fractured-garden',
  main: true,
  steps: [
    { id: 'temple-1', objective: 'Speak with Yenna', condition: { kind: 'talkTo', npcId: 'keeper-yenna' } },
  ],
};

const MAIN_QUEST: QuestDef = {
  id: 'restore-the-garden',
  title: 'Return the garden to 432 Hz',
  summary: 'Free the guardian and let the region settle.',
  region: 'fractured-garden',
  main: true,
  steps: [
    { id: 'main-1', objective: 'Speak with Yenna', condition: { kind: 'talkTo', npcId: 'keeper-yenna' } },
    { id: 'main-2', objective: 'Climb to the upper terrace', condition: { kind: 'reachArea', triggerId: 'terrace-gate' } },
    {
      id: 'main-3',
      objective: 'Free Oru',
      condition: { kind: 'defeatBoss', bossId: 'oru-fractured-colossus' },
    },
  ],
  rewardsAbility: 'echo',
  setsFlagOnComplete: 'garden-restored',
};

const OPTIONAL_QUEST: QuestDef = {
  id: 'reeds-and-rust',
  title: 'Reeds and rust',
  summary: 'Yenna would like her shards back.',
  region: 'fractured-garden',
  main: true,
  steps: [
    {
      id: 'side-1',
      objective: 'Gather two tuning shards',
      condition: { kind: 'collect', contentId: 'garden-shard', count: 2 },
    },
    {
      id: 'side-2',
      objective: 'Sit with the reeds a while',
      condition: { kind: 'flag', flag: 'heard-the-reeds' },
      optional: true,
    },
  ],
};

const BLOCKING_QUEST: QuestDef = {
  id: 'two-required',
  title: 'Two locks',
  summary: 'Both, or neither.',
  region: 'fractured-garden',
  main: true,
  steps: [
    { id: 'lock-1', objective: 'Open the first lock', condition: { kind: 'flag', flag: 'lock-one' } },
    { id: 'lock-2', objective: 'Open the second lock', condition: { kind: 'flag', flag: 'lock-two' } },
  ],
};

const MARKER: MapMarkerDef = {
  id: 'temple-of-the-first-breath',
  kind: 'temple',
  region: 'fractured-garden',
  position: vec3(0, 0, 60),
  label: 'Temple of the First Breath',
  discoveredByTriggerId: 'temple-approach',
};

const NEAR_MARKER: MapMarkerDef = {
  id: 'reed-camp',
  kind: 'camp',
  region: 'fractured-garden',
  position: vec3(0, 0, 4),
  label: 'Reed cutters camp',
};

const CODEX: CodexEntryDef = {
  id: 'codex-oru',
  category: 'creatures',
  title: 'Oru, before the fusing',
  body: 'A protector of the garden, and no monster until something was welded into it.',
  unlockedByFlag: 'met-oru',
};

const MOTIF: MotifCardDef = {
  id: 'motif-reed-three',
  name: 'Reed Triplet',
  region: 'fractured-garden',
  layer: 'melody',
  steps: [1, 3, 5, null],
  stepsPerBar: 4,
  foundAt: 'garden-shard-1',
};

const ZONE_CONTENT: AdventureContent = {
  npcs: [KEEPER, WALKER],
  dialogue: [GREETING, HINT, STORY, AMBIENT, RESTORED_TALK, BRANCHING, TEMPLE_GIFT],
  quests: [REACH_TEMPLE, MAIN_QUEST, OPTIONAL_QUEST, BLOCKING_QUEST],
  markers: [MARKER, NEAR_MARKER],
  codex: [CODEX],
  motifs: [MOTIF],
};

// ---------------------------------------------------------------------------
// Stub physics: a floor, and optionally one wall the solver refuses to cross
// ---------------------------------------------------------------------------

interface StubOptions {
  /** Solid plane at this constant z. Null = nothing but floor. */
  wallZ?: number | null;
  groundY?: number;
}

function createStubPhysics(options: StubOptions = {}): PhysicsWorld {
  const wallZ = options.wallZ ?? null;
  const groundY = options.groundY ?? 0;
  let nextId = 1;

  return {
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
    moveCharacter(params): MoveResult {
      const nx = params.position.x + params.velocity.x * params.deltaSeconds;
      let ny = params.position.y + params.velocity.y * params.deltaSeconds;
      let nz = params.position.z + params.velocity.z * params.deltaSeconds;
      let vy = params.velocity.y;
      let vz = params.velocity.z;
      let grounded = false;
      let touchingWall = false;

      if (wallZ !== null) {
        const limit = wallZ - params.radius;
        if (nz > limit) {
          nz = Math.min(nz, limit);
          vz = 0;
          touchingWall = true;
        }
      }
      if (ny <= groundY) {
        ny = groundY;
        vy = 0;
        grounded = true;
      }

      return {
        position: vec3(nx, ny, nz),
        velocity: vec3(params.velocity.x, vy, vz),
        grounded,
        groundNormal: vec3(0, 1, 0),
        groundCollider: null,
        touchingWall,
        wallNormal: vec3(0, 0, -1),
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
    colliders: [],
    stats: { colliderCount: 0, lastQueryCount: 0 },
  };
}

function fakeHandle(id: string): ColliderHandle {
  return {
    id: 99,
    descriptor: {
      id,
      shape: { kind: 'box', halfExtents: vec3(1, 1, 1) },
      position: vec3(),
      layer: Layer.Trigger,
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
      stageId: 'fractured-garden',
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

const TEST_CONTENT: ContentBundle = { stages: {}, enemies: {}, bosses: {} };

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const TRACKED: (keyof GameEvents)[] = [
  'ui:subtitle',
  'ui:notification',
  'stage:objectiveChanged',
  'form:acquired',
];

function frameWith(actions: readonly Action[]): InputFrame {
  const base = createEmptyInputFrame();
  const buttons: Record<Action, ButtonState> = { ...base.buttons };
  for (const action of actions) {
    buttons[action] = { down: true, pressed: true, released: false, heldSeconds: 0 };
  }
  return { ...base, buttons };
}

interface Harness {
  ctx: SimContext;
  world: MutableWorld;
  runtime: AdventureRuntime;
  events: EventBus<GameEvents>;
  services: SimServices;
  effects: DialogueEffects;
  /** Runs the adventure system. `actions` are pressed on the first step only. */
  step(count?: number, actions?: readonly Action[]): void;
  /** Advances the dialogue runtime alone, without the rest of the system. */
  tick(count?: number, actions?: readonly Action[]): void;
  eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][];
  fireTrigger(id: string): void;
  solvePuzzle(id: string): void;
}

interface HarnessOptions {
  physics?: StubOptions;
  content?: AdventureContent;
  seed?: number;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const world = createTestWorld();
  const physics = createStubPhysics(options.physics);
  const events = createEventBus<GameEvents>();
  const captured: { type: keyof GameEvents; payload: unknown }[] = [];
  for (const type of TRACKED) {
    events.on(type, (payload: unknown) => {
      captured.push({ type, payload });
    });
  }

  const backing = {
    world,
    physics,
    events,
    input: createEmptyInputFrame(),
    dt: DT,
    rawDt: DT,
    rng: createRng(options.seed ?? 4321),
    ids: createIdAllocator(9000),
    content: TEST_CONTENT,
    stageDef: null as StageDef | null,
    movement: { ...DEFAULT_MOVEMENT_CONFIG },
    combat: { ...DEFAULT_COMBAT_CONFIG },
    camera: { ...DEFAULT_CAMERA_CONFIG },
    accessibility: { ...DEFAULT_ACCESSIBILITY_CONFIG },
    difficultyProfile: DIFFICULTY_PROFILES.standard,
    formBehaviour: null as FormBehaviour | null,
    cameraYaw: 0,
    cameraPitch: 0,
    services: null as unknown as SimServices,
  };
  backing.services = createSimServices(backing);
  const ctx = backing as unknown as SimContext;

  const runtime = createAdventureRuntime(options.content ?? {});
  attachAdventureRuntime(world, runtime);
  attachAdventureEvents(runtime, events);
  const effects = createAdventureEffects(ctx, runtime);

  const run = (system: (c: SimContext) => void, count: number, actions: readonly Action[]): void => {
    for (let i = 0; i < count; i++) {
      backing.input = i === 0 ? frameWith(actions) : createEmptyInputFrame();
      system(ctx);
      world.tick += 1;
      world.elapsedSeconds += DT;
    }
  };

  return {
    ctx,
    world,
    runtime,
    events,
    services: backing.services,
    effects,

    step(count = 1, actions: readonly Action[] = []) {
      run(adventureSystem, count, actions);
    },

    tick(count = 1, actions: readonly Action[] = []) {
      run(
        (c) => {
          tickDialogue(c, runtime.dialogue, effects);
        },
        count,
        actions,
      );
    },

    eventsOfType<K extends keyof GameEvents>(type: K): GameEvents[K][] {
      const out: GameEvents[K][] = [];
      for (const entry of captured) {
        if (entry.type === type) out.push(entry.payload as GameEvents[K]);
      }
      return out;
    },

    fireTrigger(id: string) {
      world.stage.triggers.set(id, { id, collider: fakeHandle(id), fired: true, once: true });
    },

    solvePuzzle(id: string) {
      world.stage.puzzles.set(id, {
        id,
        kind: 'sequence',
        resonatorIds: [],
        progress: [],
        solved: true,
        idleSeconds: 0,
      });
    },
  };
}

/** Records what a dialogue tree did on completion, with no world involved. */
interface Recorder {
  effects: DialogueEffects;
  flags: string[];
  abilities: ResonanceFormId[];
  started: string[];
  completed: string[];
}

function createRecorder(): Recorder {
  const recorder: Recorder = {
    effects: {
      setFlag: (flag) => {
        recorder.flags.push(flag);
      },
      grantAbility: (ability) => {
        recorder.abilities.push(ability);
      },
      startQuest: (questId) => {
        recorder.started.push(questId);
      },
      completeQuest: (questId) => {
        recorder.completed.push(questId);
      },
    },
    flags: [],
    abilities: [],
    started: [],
    completed: [],
  };
  return recorder;
}

function playToEnd(h: Harness, runtime: DialogueRuntime, effects: DialogueEffects): number {
  for (let i = 0; i < 4000; i++) {
    if (!isDialogueActive(runtime)) return i;
    tickDialogue(h.ctx, runtime, effects);
    h.world.elapsedSeconds += DT;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Dialogue playback
// ---------------------------------------------------------------------------

describe('dialogue: playback', () => {
  it('advances a beat on the interact input and on jump', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    expect(startDialogue(h.ctx, dialogue, GREETING)).toBe(true);
    expect(dialogue.beatIndex).toBe(0);

    // One step with nothing pressed is not enough — the beat holds a second.
    h.tick(1);
    expect(dialogue.beatIndex).toBe(0);

    h.tick(1, ['interact']);
    expect(dialogue.beatIndex).toBe(1);

    h.tick(1, ['jump']);
    expect(dialogue.beatIndex).toBe(2);
  });

  it('holds a beat for its authored seconds when the player does nothing', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, GREETING);

    // Each beat holds for one second, so 59 steps is not enough.
    h.tick(59);
    expect(dialogue.beatIndex).toBe(0);
    h.tick(2);
    expect(dialogue.beatIndex).toBe(1);
  });

  it('reaches the end unattended and emits one subtitle per beat', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, GREETING);

    const steps = playToEnd(h, dialogue, h.effects);
    expect(steps).toBeGreaterThan(0);
    expect(isDialogueActive(dialogue)).toBe(false);
    // Text-first: the beat count and the subtitle count are the same number.
    expect(h.eventsOfType('ui:subtitle').length).toBe(GREETING.beats.length);
    expect(dialogue.beatsShown).toBe(GREETING.beats.length);
  });

  it('falls back to the default hold when a beat does not state one', () => {
    const h = createHarness();
    const untimed: DialogueTree = {
      id: 'untimed',
      beats: [{ speaker: 'Ost', text: 'No clock on this one.' }, { speaker: 'Ost', text: 'Nor this.' }],
    };
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, untimed);

    h.tick(Math.floor(DEFAULT_BEAT_SECONDS / DT) - 2);
    expect(dialogue.beatIndex).toBe(0);
    h.tick(4);
    expect(dialogue.beatIndex).toBe(1);
    expect(h.eventsOfType('ui:subtitle')[0]?.seconds).toBeCloseTo(DEFAULT_BEAT_SECONDS, 5);
  });

  it('starts idle, and projects nothing until somebody speaks', () => {
    const fresh = createDialogueRuntime();
    expect(isDialogueActive(fresh)).toBe(false);
    expect(projectDialogueState(fresh)).toBeNull();
  });

  it('refuses to open an empty tree, so the camera cannot be trapped', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const empty: DialogueTree = { id: 'empty', beats: [], cinematic: true };
    expect(startDialogue(h.ctx, dialogue, empty)).toBe(false);
    expect(h.world.camera.mode).toBe('follow');
  });
});

// ---------------------------------------------------------------------------
// Dialogue choices
// ---------------------------------------------------------------------------

describe('dialogue: choices', () => {
  it('offers the ungated choices after the last beat', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, BRANCHING);
    h.tick(200);

    expect(dialogue.awaitingChoice).toBe(true);
    expect(dialogue.choices.length).toBe(3);
    expect(projectDialogueState(dialogue)?.choices.length).toBe(3);
    // The fourth needs a flag the player has not earned.
    expect(availableChoices(BRANCHING, new Set(['saw-the-fall'])).length).toBe(4);
  });

  it('branches to the chosen beat and applies that choice flag', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const recorder = createRecorder();
    startDialogue(h.ctx, dialogue, BRANCHING);
    h.tick(200);

    expect(chooseDialogueOption(h.ctx, dialogue, 1, recorder.effects)).toBe(true);
    expect(dialogue.beatIndex).toBe(2);
    expect(recorder.flags).toContain('asked-about-bridge');
    expect(dialogue.awaitingChoice).toBe(false);
  });

  it('does not re-offer the branch, so a backward jump cannot loop forever', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const recorder = createRecorder();
    startDialogue(h.ctx, dialogue, BRANCHING);
    h.tick(200);
    chooseDialogueOption(h.ctx, dialogue, 0, recorder.effects);

    const steps = playToEnd(h, dialogue, recorder.effects);
    expect(steps).toBeGreaterThan(0);
    expect(isDialogueActive(dialogue)).toBe(false);
  });

  it('ends the conversation on a choice that goes nowhere', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const recorder = createRecorder();
    startDialogue(h.ctx, dialogue, BRANCHING);
    h.tick(200);

    chooseDialogueOption(h.ctx, dialogue, 2, recorder.effects);
    expect(isDialogueActive(dialogue)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dialogue selection
// ---------------------------------------------------------------------------

describe('dialogue: selectDialogueForNpc', () => {
  const library = [STORY, HINT, AMBIENT];

  it('gates a tree behind requiresFlag', () => {
    expect(selectDialogueForNpc(KEEPER, library, new Set())?.id).toBe('yenna-hint');
    expect(selectDialogueForNpc(KEEPER, library, new Set(['saw-the-fall']))?.id).toBe('yenna-crash');
  });

  it('retires a tree once consumedByFlag is set, so a hint stops repeating', () => {
    expect(selectDialogueForNpc(KEEPER, library, new Set())?.id).toBe('yenna-hint');
    expect(selectDialogueForNpc(KEEPER, library, new Set(['heard-reed-hint']))?.id).toBe(
      'yenna-ambient',
    );
  });

  it('accepts a map as well as a list, and ignores unknown or empty trees', () => {
    const map = new Map([
      [STORY.id, STORY],
      [HINT.id, HINT],
      [AMBIENT.id, AMBIENT],
    ]);
    expect(selectDialogueForNpc(KEEPER, map, new Set())?.id).toBe('yenna-hint');
    expect(selectDialogueForNpc({ dialogue: ['nobody-wrote-this'] }, library, new Set())).toBeNull();
    expect(
      selectDialogueForNpc({ dialogue: ['silent'] }, [{ id: 'silent', beats: [] }], new Set()),
    ).toBeNull();
  });

  it('completing a tree sets its own consumedByFlag', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, HINT);
    playToEnd(h, dialogue, h.effects);

    expect(h.world.stage.flags.has('heard-reed-hint')).toBe(true);
    expect(selectDialogueForNpc(KEEPER, library, h.world.stage.flags)?.id).toBe('yenna-ambient');
  });
});

// ---------------------------------------------------------------------------
// Dialogue completion effects
// ---------------------------------------------------------------------------

describe('dialogue: completion effects', () => {
  it('applies the flag, ability, quest start and quest completion', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const recorder = createRecorder();
    startDialogue(h.ctx, dialogue, TEMPLE_GIFT);
    playToEnd(h, dialogue, recorder.effects);

    expect(recorder.flags).toContain('echo-taught');
    expect(recorder.abilities).toEqual(['echo']);
    expect(recorder.started).toEqual(['restore-the-garden']);
    expect(recorder.completed).toEqual(['reach-the-temple']);
  });

  it('grants the ability through the adventure effects and announces its player-facing name', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, TEMPLE_GIFT);
    playToEnd(h, dialogue, h.effects);

    expect(h.world.player.unlockedForms).toContain('echo');
    const acquired = h.eventsOfType('form:acquired');
    expect(acquired.length).toBe(1);
    expect(acquired[0]?.form).toBe('echo');
    // The id is a save key; the player reads "Echo Pulse".
    expect(acquired[0]?.commanderName).toBe(ABILITY_NAMES.echo);
    expect(questProgressOf(h.runtime.quests, 'restore-the-garden')?.started).toBe(true);
    expect(questProgressOf(h.runtime.quests, 'reach-the-temple')?.complete).toBe(true);
  });

  it('takes the camera for a cinematic tree and gives it back', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, TEMPLE_GIFT, { focus: vec3(1, 2, 3) });
    expect(h.world.camera.mode).toBe('cinematic');
    expect(h.world.camera.secondaryFocus?.z).toBe(3);

    playToEnd(h, dialogue, h.effects);
    expect(h.world.camera.mode).toBe('follow');
    expect(h.world.camera.scriptedRemaining).toBe(0);
  });

  it('leaves the camera alone for ambient chatter', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    startDialogue(h.ctx, dialogue, GREETING);
    expect(h.world.camera.mode).toBe('follow');
    playToEnd(h, dialogue, h.effects);
    expect(h.world.camera.mode).toBe('follow');
  });
});

// ---------------------------------------------------------------------------
// Skipping
// ---------------------------------------------------------------------------

describe('dialogue: skipping', () => {
  it('ends the tree immediately and still applies its effects', () => {
    const h = createHarness();
    const dialogue = h.runtime.dialogue;
    const recorder = createRecorder();
    startDialogue(h.ctx, dialogue, TEMPLE_GIFT);

    expect(skipDialogue(h.ctx, dialogue, recorder.effects)).toBe(true);
    expect(isDialogueActive(dialogue)).toBe(false);
    expect(dialogue.lastEnded?.reason).toBe('skipped');
    // A skipped temple conversation must not cost the player the ability.
    expect(recorder.abilities).toEqual(['echo']);
    expect(h.world.camera.mode).toBe('follow');
    // Only the first beat was ever read aloud.
    expect(h.eventsOfType('ui:subtitle').length).toBe(1);
  });

  it('reports false when there is nothing to skip', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    expect(skipAdventureDialogue(h.ctx, h.runtime)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quest predicates
// ---------------------------------------------------------------------------

describe('quests: pure predicates', () => {
  it('flag', () => {
    expect(flagConditionMet('gate-open', new Set(['gate-open']))).toBe(true);
    expect(flagConditionMet('gate-open', new Set(['other']))).toBe(false);
  });

  it('reachArea', () => {
    expect(reachAreaConditionMet('terrace-gate', new Set(['terrace-gate']))).toBe(true);
    expect(reachAreaConditionMet('terrace-gate', new Set())).toBe(false);
  });

  it('collect counts a content family', () => {
    const two = new Set(['garden-shard-1', 'garden-shard-2', 'unrelated']);
    expect(countCollected('garden-shard', two)).toBe(2);
    expect(collectConditionMet('garden-shard', 2, two)).toBe(true);
    expect(collectConditionMet('garden-shard', 3, two)).toBe(false);
  });

  it('cleanse', () => {
    const counts = new Map([['drift-mote', 3]]);
    expect(cleanseConditionMet('drift-mote', 3, counts)).toBe(true);
    expect(cleanseConditionMet('drift-mote', 4, counts)).toBe(false);
  });

  it('solvePuzzle', () => {
    expect(solvePuzzleConditionMet('reed-chord', new Set(['reed-chord']))).toBe(true);
    expect(solvePuzzleConditionMet('reed-chord', new Set())).toBe(false);
  });

  it('defeatBoss', () => {
    expect(defeatBossConditionMet('oru-fractured-colossus', new Set(['oru-fractured-colossus']))).toBe(
      true,
    );
    expect(defeatBossConditionMet('oru-fractured-colossus', new Set())).toBe(false);
  });

  it('talkTo', () => {
    expect(talkToConditionMet('keeper-yenna', new Set(['keeper-yenna']))).toBe(true);
    expect(talkToConditionMet('keeper-yenna', new Set())).toBe(false);
  });

  it('dispatches every kind through isStepConditionMet', () => {
    const empty = createQuestWorldView();
    const conditions: QuestStepCondition[] = [
      { kind: 'flag', flag: 'a' },
      { kind: 'reachArea', triggerId: 'a' },
      { kind: 'collect', contentId: 'a', count: 1 },
      { kind: 'cleanse', archetype: 'a', count: 1 },
      { kind: 'solvePuzzle', puzzleId: 'a' },
      { kind: 'defeatBoss', bossId: 'a' },
      { kind: 'talkTo', npcId: 'a' },
    ];
    for (const condition of conditions) {
      expect(isStepConditionMet(condition, empty)).toBe(false);
    }

    const full: QuestWorldView = {
      flags: new Set(['a']),
      firedTriggers: new Set(['a']),
      solvedPuzzles: new Set(['a']),
      defeatedBosses: new Set(['a']),
      talkedTo: new Set(['a']),
      collectedContent: new Set(['a']),
      cleansedByArchetype: new Map([['a', 1]]),
    };
    for (const condition of conditions) {
      expect(isStepConditionMet(condition, full)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Quest runtime: every condition kind, met and unmet
// ---------------------------------------------------------------------------

type ConditionKind = QuestStepCondition['kind'];

const CONDITIONS: Readonly<Record<ConditionKind, QuestStepCondition>> = {
  flag: { kind: 'flag', flag: 'gate-open' },
  reachArea: { kind: 'reachArea', triggerId: 'terrace-gate' },
  collect: { kind: 'collect', contentId: 'garden-shard', count: 2 },
  cleanse: { kind: 'cleanse', archetype: 'drift-mote', count: 3 },
  solvePuzzle: { kind: 'solvePuzzle', puzzleId: 'reed-chord' },
  defeatBoss: { kind: 'defeatBoss', bossId: 'oru-fractured-colossus' },
  talkTo: { kind: 'talkTo', npcId: 'keeper-yenna' },
};

function questFor(kind: ConditionKind): QuestDef {
  const condition = CONDITIONS[kind];
  return {
    id: `probe-${kind}`,
    title: `Probe ${kind}`,
    summary: 'One step, one condition.',
    region: 'fractured-garden',
    main: true,
    steps: [{ id: `${kind}-step`, objective: `Finish the ${kind} step`, condition }],
  };
}

function satisfy(h: Harness, kind: ConditionKind): void {
  switch (kind) {
    case 'flag':
      h.services.setStageFlag('gate-open');
      break;
    case 'reachArea':
      h.fireTrigger('terrace-gate');
      break;
    case 'collect':
      h.world.stage.collectedPickups.add('garden-shard-1');
      h.world.stage.collectedPickups.add('garden-shard-2');
      break;
    case 'cleanse':
      for (let i = 0; i < 3; i++) {
        h.events.emit('combat:enemyCleansed', {
          enemyId: (700 + i) as EntityId,
          position: vec3(),
          archetype: 'drift-mote',
        });
      }
      break;
    case 'solvePuzzle':
      h.solvePuzzle('reed-chord');
      break;
    case 'defeatBoss':
      h.events.emit('boss:defeated', {
        definitionId: 'oru-fractured-colossus',
        displayName: 'Oru',
        formAwarded: null,
      });
      break;
    case 'talkTo':
      h.runtime.talkedTo.add('keeper-yenna');
      break;
    default:
      break;
  }
}

const ALL_KINDS: ConditionKind[] = [
  'flag',
  'reachArea',
  'collect',
  'cleanse',
  'solvePuzzle',
  'defeatBoss',
  'talkTo',
];

describe('quests: every condition kind drives its step', () => {
  it.each(ALL_KINDS)('%s completes its step once satisfied', (kind) => {
    const h = createHarness({ content: { quests: [questFor(kind)] } });
    startQuest(h.ctx, h.runtime.quests, `probe-${kind}`);
    satisfy(h, kind);
    h.step(2);

    const progress = questProgressOf(h.runtime.quests, `probe-${kind}`);
    expect(progress?.completedSteps).toEqual([`${kind}-step`]);
    expect(progress?.complete).toBe(true);
  });

  it.each(ALL_KINDS)('%s does not complete its step while unmet', (kind) => {
    const h = createHarness({ content: { quests: [questFor(kind)] } });
    startQuest(h.ctx, h.runtime.quests, `probe-${kind}`);
    h.step(2);

    const progress = questProgressOf(h.runtime.quests, `probe-${kind}`);
    expect(progress?.completedSteps).toEqual([]);
    expect(progress?.complete).toBe(false);
  });

  it('a nearly-satisfied count is not enough', () => {
    const h = createHarness({ content: { quests: [questFor('collect')] } });
    startQuest(h.ctx, h.runtime.quests, 'probe-collect');
    h.world.stage.collectedPickups.add('garden-shard-1');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'probe-collect')?.complete).toBe(false);

    h.world.stage.collectedPickups.add('garden-shard-2');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'probe-collect')?.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Quest ordering, optionality and rewards
// ---------------------------------------------------------------------------

describe('quests: ordering and rewards', () => {
  it('holds a main quest to its authored order', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');

    // The later condition is met first; the story must not skip ahead.
    h.fireTrigger('terrace-gate');
    h.step(2);
    let progress = questProgressOf(h.runtime.quests, 'restore-the-garden');
    expect(progress?.completedSteps).toEqual([]);

    h.runtime.talkedTo.add('keeper-yenna');
    h.step(2);
    progress = questProgressOf(h.runtime.quests, 'restore-the-garden');
    // Both fall in one pass now that the first is unblocked, in authored order.
    expect(progress?.completedSteps).toEqual(['main-1', 'main-2']);
    expect(progress?.complete).toBe(false);
  });

  it('lets a side quest complete its steps in any order', () => {
    const anyOrder: QuestDef = {
      id: 'any-order',
      title: 'Any order',
      summary: 'A side task does not insist.',
      region: 'fractured-garden',
      steps: [
        { id: 'a', objective: 'First', condition: { kind: 'flag', flag: 'a-done' } },
        { id: 'b', objective: 'Second', condition: { kind: 'flag', flag: 'b-done' } },
      ],
    };
    const h = createHarness({ content: { quests: [anyOrder] } });
    startQuest(h.ctx, h.runtime.quests, 'any-order');
    h.services.setStageFlag('b-done');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'any-order')?.completedSteps).toEqual(['b']);
  });

  it('does not let an optional step block completion', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'reeds-and-rust');
    h.world.stage.collectedPickups.add('garden-shard-1');
    h.world.stage.collectedPickups.add('garden-shard-2');
    h.step(2);

    const progress = questProgressOf(h.runtime.quests, 'reeds-and-rust');
    expect(progress?.complete).toBe(true);
    expect(progress?.completedSteps).toEqual(['side-1']);
  });

  it('still credits an optional step satisfied in the same pass as the last required one', () => {
    // Regression: the evaluator used to stop the moment the required work was
    // done, so a player who had already satisfied the optional objective lost
    // the credit for it permanently — the quest was complete and never revisited.
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'reeds-and-rust');
    h.services.setStageFlag('heard-the-reeds');
    h.world.stage.collectedPickups.add('garden-shard-1');
    h.world.stage.collectedPickups.add('garden-shard-2');
    h.step(2);

    const progress = questProgressOf(h.runtime.quests, 'reeds-and-rust');
    expect(progress?.complete).toBe(true);
    expect(progress?.completedSteps).toEqual(['side-1', 'side-2']);
  });

  it('still collects an optional step that is satisfied later', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'reeds-and-rust');
    h.services.setStageFlag('heard-the-reeds');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'reeds-and-rust')?.completedSteps).toEqual(['side-2']);
    expect(questProgressOf(h.runtime.quests, 'reeds-and-rust')?.complete).toBe(false);
  });

  it('does let a required step block completion', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'two-required');
    h.services.setStageFlag('lock-one');
    h.step(2);

    let progress = questProgressOf(h.runtime.quests, 'two-required');
    expect(progress?.completedSteps).toEqual(['lock-1']);
    expect(progress?.complete).toBe(false);

    h.services.setStageFlag('lock-two');
    h.step(2);
    progress = questProgressOf(h.runtime.quests, 'two-required');
    expect(progress?.complete).toBe(true);
  });

  it('grants the reward ability and sets the flag on completion', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');
    h.runtime.talkedTo.add('keeper-yenna');
    h.fireTrigger('terrace-gate');
    h.events.emit('boss:defeated', {
      definitionId: 'oru-fractured-colossus',
      displayName: 'Oru',
      formAwarded: null,
    });
    h.step(2);

    expect(questProgressOf(h.runtime.quests, 'restore-the-garden')?.complete).toBe(true);
    expect(h.world.player.unlockedForms).toContain('echo');
    expect(h.world.stage.flags.has('garden-restored')).toBe(true);
    expect(h.eventsOfType('form:acquired').length).toBe(1);
  });

  it('emits stage:objectiveChanged exactly once per step transition', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');
    expect(h.eventsOfType('stage:objectiveChanged').length).toBe(1);
    expect(h.world.stage.objective).toBe('Speak with Yenna');

    h.runtime.talkedTo.add('keeper-yenna');
    h.step(4);
    expect(h.eventsOfType('stage:objectiveChanged').length).toBe(2);
    expect(h.world.stage.objective).toBe('Climb to the upper terrace');

    h.fireTrigger('terrace-gate');
    h.step(4);
    expect(h.eventsOfType('stage:objectiveChanged').length).toBe(3);
    expect(h.world.stage.objective).toBe('Free Oru');

    // Idling changes nothing, so the HUD is not re-announced.
    h.step(30);
    expect(h.eventsOfType('stage:objectiveChanged').length).toBe(3);
  });

  it('retracts its own objective once the last quest is finished', () => {
    // A completed step left on the HUD reads as work the player has missed.
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'two-required');
    expect(h.world.stage.objective).toBe('Open the first lock');

    h.services.setStageFlag('lock-one');
    h.services.setStageFlag('lock-two');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'two-required')?.complete).toBe(true);
    expect(h.world.stage.objective).toBe('');
  });

  it('never retracts an objective the stage itself set', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'two-required');
    h.services.setStageFlag('lock-one');
    h.step(2);

    // A stage trigger takes over the HUD line.
    h.services.setObjective('Cross the reed bridge');
    h.services.setStageFlag('lock-two');
    h.step(2);
    expect(questProgressOf(h.runtime.quests, 'two-required')?.complete).toBe(true);
    expect(h.world.stage.objective).toBe('Cross the reed bridge');
  });

  it('does not celebrate an ability the player is already carrying', () => {
    // A tree with no `consumedByFlag` can be heard twice, and a quest may reward
    // what the conversation that started it already handed over.
    const h = createHarness({ content: ZONE_CONTENT });
    startDialogue(h.ctx, h.runtime.dialogue, TEMPLE_GIFT);
    playToEnd(h, h.runtime.dialogue, h.effects);
    expect(h.eventsOfType('form:acquired').length).toBe(1);

    h.effects.grantAbility('echo');
    expect(h.eventsOfType('form:acquired').length).toBe(1);
    expect(h.eventsOfType('ui:notification').filter((n) => n.text.includes('attuned')).length).toBe(
      1,
    );
    // The flag is still asserted, so an `ability:` gate holds either way.
    expect(h.world.stage.flags.has('ability:echo')).toBe(true);
    expect(h.world.player.unlockedForms.filter((f) => f === 'echo').length).toBe(1);
  });

  it('notifies on every start and every step, so nothing is audio-only', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'two-required');
    h.services.setStageFlag('lock-one');
    h.step(2);
    const texts = h.eventsOfType('ui:notification').map((n) => n.text);
    expect(texts.some((t) => t.includes('Two locks'))).toBe(true);
    expect(texts.some((t) => t.includes('Open the first lock'))).toBe(true);
  });

  it('reports the next objective and step availability directly', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');
    const progress = questProgressOf(h.runtime.quests, 'restore-the-garden');
    expect(progress).not.toBeNull();
    if (!progress) return;

    expect(nextObjectiveOf(MAIN_QUEST, progress)).toBe('Speak with Yenna');
    expect(isStepAvailable(MAIN_QUEST, progress, 0)).toBe(true);
    expect(isStepAvailable(MAIN_QUEST, progress, 1)).toBe(false);
    progress.completedSteps.push('main-1');
    expect(isStepAvailable(MAIN_QUEST, progress, 1)).toBe(true);
    expect(nextObjectiveOf(MAIN_QUEST, progress)).toBe('Climb to the upper terrace');
  });

  it('will not start a quest it has never been given', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    expect(startQuest(h.ctx, h.runtime.quests, 'no-such-quest')).toBe(false);
    expect(startQuest(h.ctx, h.runtime.quests, 'restore-the-garden')).toBe(true);
    expect(startQuest(h.ctx, h.runtime.quests, 'restore-the-garden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NPCs and interaction
// ---------------------------------------------------------------------------

describe('adventure: interaction prompt', () => {
  it('offers nobody when the player is out of reach', () => {
    // Yenna stands ten metres away; nothing else is nearby.
    const h = createHarness({ content: { npcs: [KEEPER], dialogue: [HINT, AMBIENT] } });
    h.world.player.position.z = 0;
    h.step();
    expect(h.runtime.interactionTarget).toBeNull();
    expect(projectAdventureState(h.runtime).interactionTarget).toBeNull();

    // Half a metre outside the reach is still outside it.
    h.world.player.position.z = 10 - (INTERACT_REACH + 0.5);
    h.step();
    expect(h.runtime.interactionTarget).toBeNull();
  });

  it('offers the nearest speaker when the player is in reach', () => {
    const h = createHarness({ content: { npcs: [KEEPER], dialogue: [HINT, AMBIENT] } });
    h.world.player.position.z = 9;
    h.step();

    expect(h.runtime.interactionTarget?.npcId).toBe('keeper-yenna');
    expect(h.runtime.interactionTarget?.prompt).toBe('Speak with Yenna');
  });

  it('offers nobody standing far above or below', () => {
    const h = createHarness({ content: { npcs: [KEEPER], dialogue: [AMBIENT] } });
    h.world.player.position.z = 9;
    h.world.player.position.y = 6;
    h.step();
    expect(h.runtime.interactionTarget).toBeNull();
  });

  it('offers nobody who has nothing left to say', () => {
    const h = createHarness({ content: { npcs: [KEEPER], dialogue: [HINT] } });
    h.world.player.position.z = 9;
    h.step();
    expect(h.runtime.interactionTarget?.npcId).toBe('keeper-yenna');

    h.services.setStageFlag('heard-reed-hint');
    h.step();
    expect(h.runtime.interactionTarget).toBeNull();
  });

  it('starts the conversation on interact and records that they were spoken to', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    h.world.player.position.z = 9;
    h.step();
    expect(h.runtime.interactionTarget?.npcId).toBe('keeper-yenna');

    h.step(1, ['interact']);
    const state = projectAdventureState(h.runtime);
    expect(state.activeDialogue?.treeId).toBe('yenna-hint');
    expect(state.activeDialogue?.speaker).toBe('Yenna');
    expect(state.interactionTarget).toBeNull();
    expect(h.runtime.talkedTo.has('keeper-yenna')).toBe(true);
    expect(h.eventsOfType('ui:subtitle').length).toBe(1);
  });

  it('does not double-advance from the press that opened the conversation', () => {
    const near: NpcDef = { ...KEEPER, dialogue: ['yenna-greeting'] };
    const h = createHarness({ content: { npcs: [near], dialogue: [GREETING] } });
    h.world.player.position.z = 9;
    h.step();
    h.step(1, ['interact']);
    // The press that opened the tree must not also spend its first beat.
    expect(h.runtime.dialogue.beatIndex).toBe(0);
    h.step();
    expect(h.runtime.dialogue.beatIndex).toBe(0);
  });

  it('drives a whole conversation to its end through the system', () => {
    const near: NpcDef = { ...KEEPER, dialogue: ['yenna-greeting'] };
    const h = createHarness({ content: { npcs: [near], dialogue: [GREETING] } });
    h.world.player.position.z = 9;
    h.step();
    h.step(1, ['interact']);
    h.step(400);

    expect(h.runtime.dialogue.tree).toBeNull();
    expect(h.eventsOfType('ui:subtitle').length).toBe(GREETING.beats.length);
  });

  it('hides an NPC behind requiresFlag and removes one on hiddenByFlag', () => {
    const arrival: NpcDef = { ...KEEPER, id: 'late-arrival', requiresFlag: 'ship-landed' };
    const leaver: NpcDef = { ...WALKER, id: 'departing', routine: { kind: 'idle' }, hiddenByFlag: 'ost-left' };
    const h = createHarness({
      content: { npcs: [arrival, leaver], dialogue: [AMBIENT, BRANCHING] },
    });

    h.step();
    expect(h.runtime.npcById.get('late-arrival')?.present).toBe(false);
    expect(h.runtime.npcById.get('departing')?.present).toBe(true);

    h.services.setStageFlag('ship-landed');
    h.services.setStageFlag('ost-left');
    h.step();
    expect(h.runtime.npcById.get('late-arrival')?.present).toBe(true);
    expect(h.runtime.npcById.get('departing')?.present).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

describe('adventure: routines', () => {
  it('walks a patrol toward its point', () => {
    const h = createHarness({ content: { npcs: [WALKER], dialogue: [BRANCHING] } });
    const ost = h.runtime.npcById.get('walker-ost');
    expect(ost).toBeDefined();
    if (!ost) return;

    h.step(60);
    expect(ost.position.z).toBeGreaterThan(1);
    expect(ost.position.y).toBe(0);
  });

  it('never walks a patrol through geometry', () => {
    const h = createHarness({
      physics: { wallZ: 3 },
      content: { npcs: [WALKER], dialogue: [BRANCHING] },
    });
    const ost = h.runtime.npcById.get('walker-ost');
    if (!ost) throw new Error('missing NPC');

    let furthest = 0;
    for (let i = 0; i < 240; i++) {
      h.step();
      furthest = Math.max(furthest, ost.position.z);
    }
    expect(furthest).toBeLessThanOrEqual(3);
    expect(ost.position.z).toBeLessThan(3);
  });

  it('advances the patrol index on arrival and loops the route', () => {
    const looper: NpcDef = {
      ...WALKER,
      id: 'looper',
      position: vec3(0, 0, 0),
      routine: { kind: 'patrol', points: [vec3(0, 0, 1.2), vec3(0, 0, 0)], speed: 4 },
    };
    const h = createHarness({ content: { npcs: [looper], dialogue: [BRANCHING] } });
    const npc = h.runtime.npcById.get('looper');
    if (!npc) throw new Error('missing NPC');

    let sawSecondLeg = false;
    for (let i = 0; i < 300; i++) {
      h.step();
      if (npc.patrolIndex === 1) sawSecondLeg = true;
    }
    expect(sawSecondLeg).toBe(true);
  });

  it('leaves an NPC who has not arrived yet standing at their authored spot', () => {
    // Otherwise a patroller gated behind `requiresFlag` walks its whole route
    // while invisible, and turns up nowhere near where it was authored.
    const unarrived: NpcDef = { ...WALKER, id: 'not-yet', requiresFlag: 'ship-landed' };
    const h = createHarness({ content: { npcs: [unarrived], dialogue: [BRANCHING] } });
    const npc = h.runtime.npcById.get('not-yet');
    if (!npc) throw new Error('missing NPC');

    h.step(120);
    expect(npc.present).toBe(false);
    expect(npc.position.z).toBeCloseTo(0, 6);

    h.services.setStageFlag('ship-landed');
    h.step(60);
    expect(npc.present).toBe(true);
    expect(npc.position.z).toBeGreaterThan(1);
  });

  it('closes the gap when following, then holds its distance', () => {
    const companion: NpcDef = {
      id: 'companion',
      displayName: 'Rell',
      appearance: 'survivor',
      position: vec3(0, 0, 20),
      dialogue: [],
      routine: { kind: 'follow', distance: 3 },
    };
    const h = createHarness({ content: { npcs: [companion] } });
    const npc = h.runtime.npcById.get('companion');
    if (!npc) throw new Error('missing NPC');

    h.step(300);
    expect(npc.position.z).toBeLessThan(4);
    expect(npc.position.z).toBeGreaterThan(2);

    const settled = npc.position.z;
    h.step(60);
    expect(Math.abs(npc.position.z - settled)).toBeLessThan(0.35);
  });

  it('turns a working NPC to face their work and leaves them there', () => {
    const smith: NpcDef = {
      id: 'smith',
      displayName: 'Vey',
      appearance: 'reed-binder',
      position: vec3(2, 0, 2),
      dialogue: [],
      routine: { kind: 'work', facing: 1.2 },
    };
    const h = createHarness({ content: { npcs: [smith] } });
    const npc = h.runtime.npcById.get('smith');
    if (!npc) throw new Error('missing NPC');

    h.step(120);
    expect(npc.yaw).toBeCloseTo(1.2, 4);
    expect(npc.position.x).toBeCloseTo(2, 5);
    expect(npc.position.z).toBeCloseTo(2, 5);
  });
});

// ---------------------------------------------------------------------------
// Restoration
// ---------------------------------------------------------------------------

describe('adventure: restoration', () => {
  it('swaps appearance and dialogue once the region reaches 432 Hz', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    const yenna = h.runtime.npcById.get('keeper-yenna');
    if (!yenna) throw new Error('missing NPC');

    h.step();
    expect(yenna.appearance).toBe('keeper-robes');
    expect(yenna.restored).toBe(false);

    h.world.stage.infection = 0;
    h.step();
    expect(yenna.restored).toBe(true);
    expect(yenna.appearance).toBe('keeper-robes-bright');
    expect(yenna.dialogue).toEqual(['yenna-restored']);

    // And the renderer sees the change through the projection.
    const view = projectNpcViews(h.runtime).find((n) => n.id === 'keeper-yenna');
    expect(view?.appearance).toBe('keeper-robes-bright');

    // The restored tree is what she now offers.
    h.world.player.position.z = 9;
    h.step();
    h.step(1, ['interact']);
    expect(h.runtime.dialogue.tree?.id).toBe('yenna-restored');
  });

  it('announces the restoration once, visibly', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    h.world.stage.infection = 0;
    h.step(30);
    const announcements = h
      .eventsOfType('ui:notification')
      .filter((n) => n.text.includes('432 Hz'));
    expect(announcements.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The record: markers, codex, motifs
// ---------------------------------------------------------------------------

describe('adventure: the record', () => {
  it('discovers a marker when its trigger fires', () => {
    const h = createHarness({ content: { markers: [MARKER] } });
    h.step();
    expect(h.runtime.discoveredMarkers.has('temple-of-the-first-breath')).toBe(false);

    h.fireTrigger('temple-approach');
    h.step();
    expect(h.runtime.discoveredMarkers.has('temple-of-the-first-breath')).toBe(true);
    expect(h.world.stage.flags.has('marker:temple-of-the-first-breath')).toBe(true);
    expect(
      h.eventsOfType('ui:notification').some((n) => n.text.includes('Temple of the First Breath')),
    ).toBe(true);
    expect(projectAdventureState(h.runtime).discoveredMarkers).toContain(
      'temple-of-the-first-breath',
    );
  });

  it('discovers an untriggered marker by walking near it, once', () => {
    const h = createHarness({ content: { markers: [NEAR_MARKER] } });
    h.world.player.position.z = 100;
    h.step();
    expect(h.runtime.discoveredMarkers.size).toBe(0);

    h.world.player.position.z = 6;
    h.step(20);
    expect(h.runtime.discoveredMarkers.has('reed-camp')).toBe(true);
    expect(h.eventsOfType('ui:notification').filter((n) => n.text.includes('Reed cutters')).length).toBe(
      1,
    );
  });

  it('unlocks a codex entry when its flag is set', () => {
    const h = createHarness({ content: { codex: [CODEX] } });
    h.step();
    expect(h.runtime.unlockedCodex.size).toBe(0);

    h.services.setStageFlag('met-oru');
    h.step(5);
    expect(projectAdventureState(h.runtime).unlockedCodex).toEqual(['codex-oru']);
    expect(h.eventsOfType('ui:notification').filter((n) => n.text.includes('Oru')).length).toBe(1);
  });

  it('unlocks an ungated codex entry immediately', () => {
    const open: CodexEntryDef = { ...CODEX, id: 'codex-open', unlockedByFlag: undefined };
    const h = createHarness({ content: { codex: [open] } });
    h.step();
    expect(h.runtime.unlockedCodex.has('codex-open')).toBe(true);
  });

  it('collects a motif card from the pickup it was hidden in', () => {
    const h = createHarness({ content: { motifs: [MOTIF] } });
    h.step();
    expect(h.runtime.collectedMotifs.size).toBe(0);

    h.world.stage.collectedPickups.add('garden-shard-1');
    h.step();
    expect(projectAdventureState(h.runtime).collectedMotifs).toEqual(['motif-reed-three']);
    expect(h.world.stage.flags.has('motif:motif-reed-three')).toBe(true);
    expect(h.eventsOfType('ui:notification').some((n) => n.text.includes('Reed Triplet'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wiring, projection and determinism
// ---------------------------------------------------------------------------

describe('adventure: wiring and projection', () => {
  it('binds one runtime per world and can be detached', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    expect(adventureRuntimeFor(h.world)).toBe(h.runtime);

    const other = createHarness({ content: ZONE_CONTENT });
    expect(adventureRuntimeFor(other.world)).not.toBe(h.runtime);
  });

  it('runs through an explicitly constructed system too', () => {
    const h = createHarness({ content: { markers: [NEAR_MARKER] } });
    const system = createAdventureSystem(h.runtime);
    h.world.player.position.z = 5;
    system(h.ctx);
    expect(h.runtime.discoveredMarkers.has('reed-camp')).toBe(true);
  });

  it('does nothing while the world is paused', () => {
    const h = createHarness({ content: { markers: [NEAR_MARKER] } });
    h.world.player.position.z = 5;
    h.world.paused = true;
    h.step(10);
    expect(h.runtime.discoveredMarkers.size).toBe(0);
  });

  it('projects a state shaped like AdventureState', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');
    h.step();

    const state = projectAdventureState(h.runtime);
    expect(state.activeDialogue).toBeNull();
    expect(state.quests.length).toBe(1);
    expect(state.quests[0]?.questId).toBe('restore-the-garden');
    expect(state.activeObjectives).toEqual(['Speak with Yenna']);
    expect(Array.isArray(state.discoveredMarkers)).toBe(true);
  });

  it('lists objectives with the most recently advanced quest first', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'two-required');
    startQuest(h.ctx, h.runtime.quests, 'reeds-and-rust');
    h.step();
    expect(projectAdventureState(h.runtime).activeObjectives).toEqual([
      'Gather two tuning shards',
      'Open the first lock',
    ]);

    h.services.setStageFlag('lock-one');
    h.step(2);
    expect(projectAdventureState(h.runtime).activeObjectives[0]).toBe('Open the second lock');
  });

  it('builds the quest snapshot from the stage runtime', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    h.fireTrigger('terrace-gate');
    h.solvePuzzle('reed-chord');
    h.world.stage.collectedPickups.add('garden-shard-1');
    h.services.setStageFlag('gate-open');

    const view = buildQuestView(h.ctx, h.runtime);
    expect(view.firedTriggers.has('terrace-gate')).toBe(true);
    expect(view.solvedPuzzles.has('reed-chord')).toBe(true);
    expect(view.collectedContent.has('garden-shard-1')).toBe(true);
    expect(view.flags.has('gate-open')).toBe(true);
  });

  it('resets live state on unload while keeping the authored content', () => {
    const h = createHarness({ content: ZONE_CONTENT });
    startQuest(h.ctx, h.runtime.quests, 'restore-the-garden');
    h.runtime.talkedTo.add('keeper-yenna');
    h.fireTrigger('temple-approach');
    h.step(2);
    expect(h.runtime.discoveredMarkers.size).toBeGreaterThan(0);

    resetAdventureRuntime(h.runtime);
    expect(h.runtime.quests.progress.size).toBe(0);
    expect(h.runtime.discoveredMarkers.size).toBe(0);
    expect(h.runtime.talkedTo.size).toBe(0);
    expect(h.runtime.npcById.get('keeper-yenna')?.appearance).toBe('keeper-robes');
    // Content survives, so the region can be replayed.
    expect(h.runtime.quests.defs.has('restore-the-garden')).toBe(true);
    expect(h.runtime.trees.has('yenna-hint')).toBe(true);
  });

  it('accepts a second zone added to a live runtime', () => {
    const h = createHarness({ content: { npcs: [KEEPER], dialogue: [AMBIENT] } });
    addAdventureContent(h.runtime, { npcs: [WALKER], dialogue: [BRANCHING], quests: [MAIN_QUEST] });
    expect(h.runtime.npcs.length).toBe(2);
    expect(h.runtime.trees.has('ost-directions')).toBe(true);
    expect(h.runtime.quests.defs.has('restore-the-garden')).toBe(true);
  });
});

describe('adventure: determinism', () => {
  it('replays identically from the same seed and diverges from another', () => {
    const idlers: NpcDef[] = [
      { ...KEEPER, id: 'idler-a', position: vec3(1, 0, 1) },
      { ...KEEPER, id: 'idler-b', position: vec3(-2, 0, 3) },
      { ...WALKER, id: 'walker-c', position: vec3(0, 0, -2) },
    ];
    const content: AdventureContent = { npcs: idlers, dialogue: [AMBIENT, BRANCHING] };

    const snapshot = (runtime: AdventureRuntime): string => {
      const round = (value: number): number => Math.round(value * 1e6) / 1e6;
      return JSON.stringify(
        runtime.npcs.map((npc) => ({
          id: npc.id,
          x: round(npc.position.x),
          y: round(npc.position.y),
          z: round(npc.position.z),
          yaw: round(npc.yaw),
          leg: npc.patrolIndex,
        })),
      );
    };

    const a = createHarness({ content, seed: 2024 });
    const b = createHarness({ content, seed: 2024 });
    const c = createHarness({ content, seed: 99 });
    a.step(400);
    b.step(400);
    c.step(400);

    expect(snapshot(a.runtime)).toBe(snapshot(b.runtime));
    expect(snapshot(c.runtime)).not.toBe(snapshot(a.runtime));
  });
});

describe('which way a survivor faces', () => {
  /*
    This whole file passed with `faceTowards` turned exactly 180° out, because
    nothing here compared a yaw against the direction it is supposed to mean.
    Every survivor greeted the player with the back of her head, and the first
    screenshot of a conversation is what found it.

    `movement.ts` documents the convention: a yaw of zero faces −Z, so
    `forward(yaw) = (−sin yaw, −cos yaw)`. That formula is written out here
    rather than imported, so this asserts against the documented rule instead of
    against whatever the code happens to do.
  */
  const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

  it('points a body at what it is facing, on all four axes', () => {
    const cases = [
      { dx: 0, dz: -1, name: 'north (−Z), the zero-yaw direction' },
      { dx: 0, dz: 1, name: 'south (+Z)' },
      { dx: 1, dz: 0, name: 'east (+X)' },
      { dx: -1, dz: 0, name: 'west (−X)' },
      { dx: -5, dz: 12, name: 'an off-axis bearing' },
    ];
    for (const { dx, dz, name } of cases) {
      const f = forward(yawTowards(dx, dz));
      const span = Math.hypot(dx, dz);
      expect(f.x, name).toBeCloseTo(dx / span, 6);
      expect(f.z, name).toBeCloseTo(dz / span, 6);
    }
  });

  it('agrees with the renderer, which has its own copy of the same rule', () => {
    // `@tuner/rendering` cannot import this module's internals, so the two hold
    // the convention independently. If they ever disagree, a survivor's body and
    // her head look in opposite directions.
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
      [-3, 4],
      [7, -2],
    ] as const) {
      expect(yawTowards(dx, dz)).toBeCloseTo(Math.atan2(-dx, -dz), 9);
    }
  });
});
