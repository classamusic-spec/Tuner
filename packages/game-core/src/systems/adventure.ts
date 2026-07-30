import { DEG2RAD, distanceXZ, moveTowardsAngle, set, vec3 } from '@tuner/shared';
import type { EventBus, ResonanceFormId, Unsubscribe, Vec3 } from '@tuner/shared';
import { SOLID_MASK } from '@tuner/physics';
import type {
  AdventureState,
  CodexEntryDef,
  DialogueTree,
  MapMarkerDef,
  MotifCardDef,
  NpcDef,
  NpcRoutine,
  QuestDef,
} from '../adventure-types.js';
import { ABILITY_NAMES } from '../adventure-types.js';
import type { GameEvents } from '../events.js';
import type { SimContext, System } from '../internal/context.js';
import type { MutableWorld } from '../internal/world.js';
import {
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
  completeQuest,
  createQuestRuntime,
  evaluateQuests,
  projectQuestProgress,
  refreshObjectives,
  registerQuests,
  startQuest,
  type QuestEffects,
  type QuestRuntime,
  type QuestWorldView,
} from './quests.js';

/**
 * The adventure layer: people, conversation, quests, and the record of what the
 * player has seen.
 *
 * ## Intended wiring
 *
 * `createGameCore` owns exactly one runtime, the same way it owns the world:
 *
 * ```ts
 * const adventure = createAdventureRuntime(zone);        // any AdventureContent
 * attachAdventureRuntime(world, adventure);              // binds it to this world
 * const detachAdventureEvents = attachAdventureEvents(adventure, events);
 *
 * const systems = [
 *   formSystem,
 *   stageSystem,      // triggers/puzzles/pickups update before quests read them
 *   movementSystem,
 *   combatSystem,
 *   projectileSystem,
 *   enemySystem,
 *   bossSystem,
 *   adventureSystem,  // after the world has settled, before the camera
 *   cameraSystem,     // so a cinematic tree's camera intent is resolved this step
 * ] as const;
 * ```
 *
 * `adventureSystem` finds its runtime through a `WeakMap` keyed on the world, so
 * it satisfies the plain `System` signature without `SimContext` having to grow
 * a field. Hosts that would rather be explicit can use
 * `createAdventureSystem(runtime)` instead; tests use both. Call
 * `detachAdventureEvents()` and `detachAdventureRuntime(world)` from
 * `core.dispose()`, and `projectAdventureState(adventure)` once per step beside
 * `projector.project(world)` so the UI reads the adventure exactly as it reads
 * `WorldState`. `unloadStage` should call `resetAdventureRuntime`.
 *
 * ## Why the ordering above matters
 *
 * The stage runtime is the system that fires triggers, solves puzzles and marks
 * pickups collected. Quest conditions are pure reads of that record, so the
 * adventure layer runs after it and never has to be told twice. Dialogue is
 * ticked *before* a new interaction is looked for, because `interact.pressed` is
 * a one-step edge: ticking first stops the press that opened a conversation from
 * also advancing its first beat, and stops the press that closed one from
 * immediately opening the next.
 *
 * ## Accessibility
 *
 * Every beat of dialogue is a `ui:subtitle`; every discovery, motif, codex
 * unlock, quest start and step completion is a `ui:notification`; every
 * objective change is `stage:objectiveChanged`. Nothing in this layer is
 * announced by audio alone, and the interaction prompt is world state rather
 * than a sound cue, so the whole adventure is readable muted.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** How close the player must stand to talk to somebody, in metres (XZ). */
export const INTERACT_REACH = 2.8;
/** Vertical tolerance on the same test — a balcony is not a conversation. */
export const INTERACT_HEIGHT = 2.4;

/** Body used when an NPC walks, so they collide like a person, not a point. */
export const NPC_BODY_RADIUS = 0.42;
export const NPC_BODY_HEIGHT = 1.7;
const NPC_MAX_SLOPE_RADIANS = 50 * DEG2RAD;
const NPC_STEP_HEIGHT = 0.4;
const NPC_GRAVITY = 18;
const NPC_TURN_SPEED = 7;
const NPC_IDLE_TURN_SPEED = 1.6;

/** Distance at which a patrol point counts as reached. */
const PATROL_ARRIVE_RADIUS = 0.5;
/** Seconds of being blocked before a patroller gives up and takes the next leg. */
const PATROL_BLOCKED_SECONDS = 1.1;
/** Speed a follower closes at when it has fallen behind. */
const FOLLOW_SPEED = 4.6;

/** Radius at which an unmarked point of interest is noticed. */
export const MARKER_DISCOVER_RADIUS = 16;

/** Infection at or below which a region counts as restored to 432 Hz. */
export const RESTORED_INFECTION = 0.001;

const IDLE_ROUTINE: NpcRoutine = { kind: 'idle' };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** An NPC's live state. `def` stays the authored truth; the rest changes. */
export interface MutableNpc {
  readonly def: NpcDef;
  readonly id: string;
  readonly displayName: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  /** Procedural model key. Swapped for `restoredAppearance` after restoration. */
  appearance: string;
  /** Dialogue tree ids offered now. Swapped for `restoredDialogue`. */
  dialogue: string[];
  routine: NpcRoutine;
  patrolIndex: number;
  grounded: boolean;
  /** False while a `requiresFlag` gate is unmet or `hiddenByFlag` is set. */
  present: boolean;
  restored: boolean;
  spokenTo: boolean;
  /** Seconds until the next idle glance. Driven by `ctx.rng`, never wall time. */
  idleTimer: number;
  idleYaw: number;
  blockedSeconds: number;
}

/** Authored input. A `ZoneDef` satisfies this structurally. */
export interface AdventureContent {
  readonly npcs?: readonly NpcDef[];
  readonly dialogue?: readonly DialogueTree[];
  readonly quests?: readonly QuestDef[];
  readonly markers?: readonly MapMarkerDef[];
  readonly codex?: readonly CodexEntryDef[];
  readonly motifs?: readonly MotifCardDef[];
}

export interface AdventureRuntime {
  npcs: MutableNpc[];
  npcById: Map<string, MutableNpc>;
  trees: Map<string, DialogueTree>;
  dialogue: DialogueRuntime;
  quests: QuestRuntime;

  markers: MapMarkerDef[];
  discoveredMarkers: Set<string>;
  codex: CodexEntryDef[];
  unlockedCodex: Set<string>;
  motifs: MotifCardDef[];
  collectedMotifs: Set<string>;

  /** NPC ids the player has spoken to — the `talkTo` condition reads this. */
  talkedTo: Set<string>;
  /** Cleansed count per archetype, fed by `combat:enemyCleansed`. */
  cleansedByArchetype: Map<string, number>;
  /** Boss definition ids freed, fed by `boss:defeated`. */
  defeatedBosses: Set<string>;

  interactionTarget: { npcId: string; prompt: string } | null;
  /** True once the region has been announced as restored, so it happens once. */
  restorationAnnounced: boolean;

  /** Reused snapshot buffers, so a step allocates nothing. */
  readonly firedTriggers: Set<string>;
  readonly solvedPuzzles: Set<string>;
}

function npcFrom(def: NpcDef): MutableNpc {
  return {
    def,
    id: def.id,
    displayName: def.displayName,
    position: vec3(def.position.x, def.position.y, def.position.z),
    velocity: vec3(),
    yaw: def.yaw ?? 0,
    appearance: def.appearance,
    dialogue: def.dialogue.slice(),
    routine: def.routine ?? IDLE_ROUTINE,
    patrolIndex: 0,
    grounded: false,
    present: def.requiresFlag === undefined,
    restored: false,
    spokenTo: false,
    idleTimer: 0,
    idleYaw: def.yaw ?? 0,
    blockedSeconds: 0,
  };
}

export function createAdventureRuntime(content: AdventureContent = {}): AdventureRuntime {
  const runtime: AdventureRuntime = {
    npcs: [],
    npcById: new Map(),
    trees: new Map(),
    dialogue: createDialogueRuntime(),
    quests: createQuestRuntime(content.quests ?? []),
    markers: (content.markers ?? []).slice(),
    discoveredMarkers: new Set(),
    codex: (content.codex ?? []).slice(),
    unlockedCodex: new Set(),
    motifs: (content.motifs ?? []).slice(),
    collectedMotifs: new Set(),
    talkedTo: new Set(),
    cleansedByArchetype: new Map(),
    defeatedBosses: new Set(),
    interactionTarget: null,
    restorationAnnounced: false,
    firedTriggers: new Set(),
    solvedPuzzles: new Set(),
  };
  addAdventureContent(runtime, content);
  return runtime;
}

/** Adds a zone's inhabitants to a live runtime. Safe to call per region load. */
export function addAdventureContent(runtime: AdventureRuntime, content: AdventureContent): void {
  for (const def of content.npcs ?? []) {
    const npc = npcFrom(def);
    runtime.npcs.push(npc);
    runtime.npcById.set(npc.id, npc);
  }
  for (const tree of content.dialogue ?? []) runtime.trees.set(tree.id, tree);
  registerQuests(runtime.quests, content.quests ?? []);
  for (const marker of content.markers ?? []) {
    if (!runtime.markers.includes(marker)) runtime.markers.push(marker);
  }
  for (const entry of content.codex ?? []) {
    if (!runtime.codex.includes(entry)) runtime.codex.push(entry);
  }
  for (const motif of content.motifs ?? []) {
    if (!runtime.motifs.includes(motif)) runtime.motifs.push(motif);
  }
}

/** Clears live state on stage unload, keeping the authored content registered. */
export function resetAdventureRuntime(runtime: AdventureRuntime): void {
  for (const npc of runtime.npcs) {
    const def = npc.def;
    set(npc.position, def.position.x, def.position.y, def.position.z);
    set(npc.velocity, 0, 0, 0);
    npc.yaw = def.yaw ?? 0;
    npc.appearance = def.appearance;
    npc.dialogue = def.dialogue.slice();
    npc.routine = def.routine ?? IDLE_ROUTINE;
    npc.patrolIndex = 0;
    npc.grounded = false;
    npc.present = def.requiresFlag === undefined;
    npc.restored = false;
    npc.spokenTo = false;
    npc.idleTimer = 0;
    npc.idleYaw = def.yaw ?? 0;
    npc.blockedSeconds = 0;
  }
  runtime.dialogue = createDialogueRuntime();
  runtime.quests.progress.clear();
  runtime.quests.order.length = 0;
  runtime.quests.objectives.length = 0;
  runtime.quests.published = null;
  runtime.discoveredMarkers.clear();
  runtime.unlockedCodex.clear();
  runtime.collectedMotifs.clear();
  runtime.talkedTo.clear();
  runtime.cleansedByArchetype.clear();
  runtime.defeatedBosses.clear();
  runtime.interactionTarget = null;
  runtime.restorationAnnounced = false;
}

// ---------------------------------------------------------------------------
// Binding a runtime to a world
// ---------------------------------------------------------------------------

/**
 * World → runtime, so `adventureSystem` can stay a plain `System`.
 *
 * A `WeakMap` rather than a module-level variable: two worlds (a running game
 * and a test harness, or two harnesses in one file) must not share one
 * adventure, and the entry disappears with the world it belongs to.
 */
const RUNTIMES = new WeakMap<MutableWorld, AdventureRuntime>();

export function attachAdventureRuntime(world: MutableWorld, runtime: AdventureRuntime): void {
  RUNTIMES.set(world, runtime);
}

export function detachAdventureRuntime(world: MutableWorld): void {
  RUNTIMES.delete(world);
}

export function adventureRuntimeFor(world: MutableWorld): AdventureRuntime | null {
  return RUNTIMES.get(world) ?? null;
}

/**
 * Records the two facts quests need that the world does not keep: how many of
 * each archetype have been cleansed, and which Commanders have been freed.
 * Everything else a condition reads is already in `world.stage`.
 */
export function attachAdventureEvents(
  runtime: AdventureRuntime,
  events: EventBus<GameEvents>,
): Unsubscribe {
  const offCleansed = events.on('combat:enemyCleansed', (payload) => {
    const seen = runtime.cleansedByArchetype.get(payload.archetype) ?? 0;
    runtime.cleansedByArchetype.set(payload.archetype, seen + 1);
  });
  const offBoss = events.on('boss:defeated', (payload) => {
    runtime.defeatedBosses.add(payload.definitionId);
  });
  return () => {
    offCleansed();
    offBoss();
  };
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * The one place the adventure layer writes back into the world.
 *
 * An ability grant unlocks the form, announces it with the *player-facing* name
 * from `ABILITY_NAMES` — the ids are save keys and are never shown — and emits
 * `form:acquired` so the renderer and audio can celebrate it.
 *
 * The grant is idempotent, and that matters: a tree without `consumedByFlag` can
 * be heard twice, and a quest may reward the ability the conversation that
 * started it already handed over. Celebrating a second time would tell the
 * player they had just gained something they were already carrying.
 */
export function createAdventureEffects(
  ctx: SimContext,
  runtime: AdventureRuntime,
): DialogueEffects & QuestEffects {
  const effects: DialogueEffects & QuestEffects = {
    setFlag(flag: string): void {
      ctx.services.setStageFlag(flag);
    },
    grantAbility(ability: ResonanceFormId): void {
      const player = ctx.world.player;
      // The flag is set either way, so a save that unlocked the form by another
      // route still satisfies an `ability:` condition.
      ctx.services.setStageFlag(`ability:${ability}`);
      if (player.unlockedForms.includes(ability)) return;

      player.unlockedForms.push(ability);
      const name = ABILITY_NAMES[ability];
      ctx.events.emit('form:acquired', { form: ability, commanderName: name });
      ctx.events.emit('ui:notification', { text: `${name} attuned`, seconds: 5 });
    },
    startQuest(questId: string): void {
      startQuest(ctx, runtime.quests, questId);
    },
    completeQuest(questId: string): void {
      completeQuest(ctx, runtime.quests, questId, effects);
    },
  };
  return effects;
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export const adventureSystem: System = (ctx): void => {
  const runtime = RUNTIMES.get(ctx.world);
  if (!runtime) return;
  runAdventureStep(ctx, runtime);
};

/** Explicit alternative to the world binding, for hosts and tests. */
export function createAdventureSystem(runtime: AdventureRuntime): System {
  return (ctx: SimContext): void => {
    runAdventureStep(ctx, runtime);
  };
}

export function runAdventureStep(ctx: SimContext, runtime: AdventureRuntime): void {
  if (ctx.world.paused) return;

  const effects = createAdventureEffects(ctx, runtime);

  updatePresence(ctx, runtime);
  updateRestoration(ctx, runtime);
  updateRoutines(ctx, runtime);

  // Dialogue first: `interact.pressed` lasts one step, and ticking before the
  // interaction search keeps one press from doing two jobs.
  const wasTalking = isDialogueActive(runtime.dialogue);
  if (wasTalking) tickDialogue(ctx, runtime.dialogue, effects);

  updateInteraction(ctx, runtime, wasTalking);
  if (!wasTalking && !isDialogueActive(runtime.dialogue)) {
    tryStartConversation(ctx, runtime);
  }

  discoverMarkers(ctx, runtime);
  unlockCodex(ctx, runtime);
  collectMotifs(ctx, runtime);

  evaluateQuests(ctx, runtime.quests, buildQuestView(ctx, runtime), effects);
  refreshObjectives(runtime.quests);
}

/** Ends the running conversation. Exposed so a host can bind it to a skip key. */
export function skipAdventureDialogue(ctx: SimContext, runtime: AdventureRuntime): boolean {
  return skipDialogue(ctx, runtime.dialogue, createAdventureEffects(ctx, runtime));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function updatePresence(ctx: SimContext, runtime: AdventureRuntime): void {
  const flags = ctx.world.stage.flags;
  for (const npc of runtime.npcs) {
    const def = npc.def;
    const arrived = def.requiresFlag === undefined || flags.has(def.requiresFlag);
    const left = def.hiddenByFlag !== undefined && flags.has(def.hiddenByFlag);
    npc.present = arrived && !left;
  }
}

/**
 * NPCs visibly change once their region holds 432 Hz again.
 *
 * The swap is deliberately not audio-gated: the model key and the dialogue both
 * change, so a muted player sees the region recover in the people who live in
 * it. One notification for the region, not one per person.
 */
function updateRestoration(ctx: SimContext, runtime: AdventureRuntime): void {
  const restored = ctx.world.stage.infection <= RESTORED_INFECTION;
  if (!restored) return;

  for (const npc of runtime.npcs) {
    if (npc.restored) continue;
    npc.restored = true;
    const def = npc.def;
    if (def.restoredAppearance !== undefined) npc.appearance = def.restoredAppearance;
    if (def.restoredDialogue !== undefined) npc.dialogue = def.restoredDialogue.slice();
  }

  if (!runtime.restorationAnnounced) {
    runtime.restorationAnnounced = true;
    ctx.events.emit('ui:notification', {
      text: 'The region holds 432 Hz again.',
      seconds: 5,
    });
  }
}

function updateRoutines(ctx: SimContext, runtime: AdventureRuntime): void {
  for (const npc of runtime.npcs) {
    if (!npc.present) continue;
    // Somebody mid-conversation stands still and faces the player rather than
    // walking off in the middle of their own line.
    if (runtime.dialogue.npcId === npc.id && isDialogueActive(runtime.dialogue)) {
      faceTowards(ctx, npc, ctx.world.player.position);
      settle(ctx, npc);
      continue;
    }

    const routine = npc.routine;
    switch (routine.kind) {
      case 'patrol':
        patrol(ctx, npc, routine.points, routine.speed);
        break;
      case 'follow':
        follow(ctx, npc, routine.distance);
        break;
      case 'work':
        npc.yaw = moveTowardsAngle(npc.yaw, routine.facing, NPC_TURN_SPEED * ctx.rawDt);
        settle(ctx, npc);
        break;
      default:
        idle(ctx, npc);
        break;
    }
  }
}

/** Gravity-only move, so a standing NPC still rests on the floor. */
function settle(ctx: SimContext, npc: MutableNpc): void {
  moveNpc(ctx, npc, 0, 0);
}

function idle(ctx: SimContext, npc: MutableNpc): void {
  npc.idleTimer -= ctx.rawDt;
  if (npc.idleTimer <= 0) {
    // Deterministic: variation comes from `ctx.rng`, never from wall time.
    npc.idleTimer = ctx.rng.range(2.5, 5.5);
    npc.idleYaw = ctx.rng.range(-Math.PI, Math.PI);
  }
  npc.yaw = moveTowardsAngle(npc.yaw, npc.idleYaw, NPC_IDLE_TURN_SPEED * ctx.rawDt);
  settle(ctx, npc);
}

function patrol(
  ctx: SimContext,
  npc: MutableNpc,
  points: readonly Vec3[],
  speed: number,
): void {
  if (points.length === 0 || speed <= 0) {
    idle(ctx, npc);
    return;
  }
  const index = npc.patrolIndex % points.length;
  const target = points[index];
  if (!target) {
    npc.patrolIndex = 0;
    idle(ctx, npc);
    return;
  }

  if (distanceXZ(npc.position, target) <= PATROL_ARRIVE_RADIUS) {
    npc.patrolIndex = (index + 1) % points.length;
    npc.blockedSeconds = 0;
    settle(ctx, npc);
    return;
  }

  const blocked = walkTowards(ctx, npc, target, speed);
  // Rather than grinding into a wall forever, a blocked patroller takes the next
  // leg of its route. Geometry still wins: the move itself never passes through.
  if (blocked) {
    npc.blockedSeconds += ctx.rawDt;
    if (npc.blockedSeconds >= PATROL_BLOCKED_SECONDS) {
      npc.patrolIndex = (index + 1) % points.length;
      npc.blockedSeconds = 0;
    }
  } else {
    npc.blockedSeconds = 0;
  }
}

function follow(ctx: SimContext, npc: MutableNpc, distance: number): void {
  const player = ctx.world.player.position;
  const gap = Math.max(0.6, distance);
  if (distanceXZ(npc.position, player) > gap) {
    walkTowards(ctx, npc, player, FOLLOW_SPEED);
    return;
  }
  faceTowards(ctx, npc, player);
  settle(ctx, npc);
}

function faceTowards(ctx: SimContext, npc: MutableNpc, target: Vec3): void {
  const dx = target.x - npc.position.x;
  const dz = target.z - npc.position.z;
  if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return;
  npc.yaw = moveTowardsAngle(npc.yaw, Math.atan2(dx, dz), NPC_TURN_SPEED * ctx.rawDt);
}

/** Walks toward a point. Returns true when geometry blocked the move. */
function walkTowards(ctx: SimContext, npc: MutableNpc, target: Vec3, speed: number): boolean {
  const dx = target.x - npc.position.x;
  const dz = target.z - npc.position.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) {
    settle(ctx, npc);
    return false;
  }
  npc.yaw = moveTowardsAngle(npc.yaw, Math.atan2(dx, dz), NPC_TURN_SPEED * ctx.rawDt);
  return moveNpc(ctx, npc, (dx / length) * speed, (dz / length) * speed);
}

/**
 * Moves an NPC through the same collide-and-slide solver the player uses.
 *
 * This is the whole reason an NPC has a body: a villager who walks through a
 * wall tells the player the world is not real. Returns true when a wall stopped
 * the move.
 */
function moveNpc(ctx: SimContext, npc: MutableNpc, vx: number, vz: number): boolean {
  const dt = ctx.rawDt;
  npc.velocity.x = vx;
  npc.velocity.z = vz;
  npc.velocity.y = npc.grounded ? -0.1 : npc.velocity.y - NPC_GRAVITY * dt;

  const result = ctx.physics.moveCharacter({
    position: npc.position,
    velocity: npc.velocity,
    radius: NPC_BODY_RADIUS,
    height: NPC_BODY_HEIGHT,
    deltaSeconds: dt,
    mask: SOLID_MASK,
    maxSlopeRadians: NPC_MAX_SLOPE_RADIANS,
    stepHeight: NPC_STEP_HEIGHT,
    snapToGround: true,
  });

  set(npc.position, result.position.x, result.position.y, result.position.z);
  set(npc.velocity, result.velocity.x, result.velocity.y, result.velocity.z);
  npc.grounded = result.grounded;
  return result.touchingWall;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/** True when this NPC has something to say right now. */
export function npcHasDialogue(
  runtime: AdventureRuntime,
  npc: MutableNpc,
  flags: ReadonlySet<string>,
): boolean {
  return selectDialogueForNpc(npc, runtime.trees, flags) !== null;
}

/**
 * Finds the nearest person the player could speak to and writes the prompt.
 *
 * Reach is measured on the horizontal plane with a height window, so standing on
 * a roof above somebody does not offer a conversation.
 */
function updateInteraction(
  ctx: SimContext,
  runtime: AdventureRuntime,
  talking: boolean,
): void {
  if (talking || isDialogueActive(runtime.dialogue) || ctx.world.cutsceneId !== null) {
    runtime.interactionTarget = null;
    return;
  }

  const player = ctx.world.player.position;
  const flags = ctx.world.stage.flags;
  let best: MutableNpc | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const npc of runtime.npcs) {
    if (!npc.present) continue;
    if (Math.abs(npc.position.y - player.y) > INTERACT_HEIGHT) continue;
    const distance = distanceXZ(npc.position, player);
    if (distance > INTERACT_REACH) continue;
    if (!npcHasDialogue(runtime, npc, flags)) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = npc;
    }
  }

  runtime.interactionTarget =
    best === null ? null : { npcId: best.id, prompt: `Speak with ${best.displayName}` };
}

function tryStartConversation(ctx: SimContext, runtime: AdventureRuntime): void {
  const target = runtime.interactionTarget;
  if (target === null) return;
  if (!ctx.input.buttons.interact.pressed) return;

  const npc = runtime.npcById.get(target.npcId);
  if (!npc) return;
  const tree = selectDialogueForNpc(npc, runtime.trees, ctx.world.stage.flags);
  if (tree === null) return;

  const started = startDialogue(ctx, runtime.dialogue, tree, {
    npcId: npc.id,
    focus: npc.position,
  });
  if (!started) return;

  // Talking to somebody is the act itself, not finishing the words — a `talkTo`
  // quest step must not depend on the player sitting through every beat.
  npc.spokenTo = true;
  runtime.talkedTo.add(npc.id);
  runtime.interactionTarget = null;
}

// ---------------------------------------------------------------------------
// The record: map, codex, motifs
// ---------------------------------------------------------------------------

function discoverMarkers(ctx: SimContext, runtime: AdventureRuntime): void {
  const player = ctx.world.player.position;
  for (const marker of runtime.markers) {
    if (runtime.discoveredMarkers.has(marker.id)) continue;

    const triggerId = marker.discoveredByTriggerId;
    const discovered =
      triggerId === undefined
        ? distanceXZ(marker.position, player) <= MARKER_DISCOVER_RADIUS
        : ctx.world.stage.triggers.get(triggerId)?.fired === true;
    if (!discovered) continue;

    runtime.discoveredMarkers.add(marker.id);
    ctx.services.setStageFlag(`marker:${marker.id}`);
    ctx.events.emit('ui:notification', {
      text: `Marked on your map — ${marker.label}`,
      icon: marker.kind,
      seconds: 3.5,
    });
  }
}

function unlockCodex(ctx: SimContext, runtime: AdventureRuntime): void {
  const flags = ctx.world.stage.flags;
  for (const entry of runtime.codex) {
    if (runtime.unlockedCodex.has(entry.id)) continue;
    if (entry.unlockedByFlag !== undefined && !flags.has(entry.unlockedByFlag)) continue;
    runtime.unlockedCodex.add(entry.id);
    ctx.events.emit('ui:notification', {
      text: `Recorded — ${entry.title}`,
      icon: entry.category,
      seconds: 3.5,
    });
  }
}

/**
 * Picks up motif cards.
 *
 * `MotifCardDef.foundAt` names wherever the card lives: a pickup's content id, a
 * trigger the player walked through, or a plain flag. Accepting all three means
 * a motif can be hidden behind whatever the region already has, instead of
 * needing its own bespoke placement format.
 */
function collectMotifs(ctx: SimContext, runtime: AdventureRuntime): void {
  const stage = ctx.world.stage;
  for (const motif of runtime.motifs) {
    if (runtime.collectedMotifs.has(motif.id)) continue;
    const found = motif.foundAt;
    if (found === undefined) continue;
    const taken =
      stage.collectedPickups.has(found) ||
      stage.flags.has(found) ||
      stage.triggers.get(found)?.fired === true;
    if (!taken) continue;

    runtime.collectedMotifs.add(motif.id);
    ctx.services.setStageFlag(`motif:${motif.id}`);
    ctx.events.emit('ui:notification', {
      text: `Motif learned — ${motif.name}`,
      icon: motif.layer,
      seconds: 4,
    });
  }
}

// ---------------------------------------------------------------------------
// The quest snapshot
// ---------------------------------------------------------------------------

/**
 * Builds the read-only view the quest predicates evaluate against.
 *
 * The trigger and puzzle sets are refilled in place rather than reallocated, so
 * a step of the adventure layer allocates nothing per frame.
 */
export function buildQuestView(ctx: SimContext, runtime: AdventureRuntime): QuestWorldView {
  const stage = ctx.world.stage;

  runtime.firedTriggers.clear();
  for (const trigger of stage.triggers.values()) {
    if (trigger.fired) runtime.firedTriggers.add(trigger.id);
  }

  runtime.solvedPuzzles.clear();
  for (const puzzle of stage.puzzles.values()) {
    if (puzzle.solved) runtime.solvedPuzzles.add(puzzle.id);
  }

  return {
    flags: stage.flags,
    firedTriggers: runtime.firedTriggers,
    solvedPuzzles: runtime.solvedPuzzles,
    defeatedBosses: runtime.defeatedBosses,
    talkedTo: runtime.talkedTo,
    collectedContent: stage.collectedPickups,
    cleansedByArchetype: runtime.cleansedByArchetype,
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** How the renderer draws the people. Not part of `AdventureState`. */
export interface NpcView {
  readonly id: string;
  readonly displayName: string;
  readonly appearance: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly routine: NpcRoutine['kind'];
  readonly present: boolean;
  readonly restored: boolean;
  /** True while this NPC is the one talking. */
  readonly speaking: boolean;
}

export function projectNpcViews(runtime: AdventureRuntime): NpcView[] {
  const speakingId = isDialogueActive(runtime.dialogue) ? runtime.dialogue.npcId : null;
  const out: NpcView[] = [];
  for (const npc of runtime.npcs) {
    out.push({
      id: npc.id,
      displayName: npc.displayName,
      appearance: npc.appearance,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      yaw: npc.yaw,
      routine: npc.routine.kind,
      present: npc.present,
      restored: npc.restored,
      speaking: speakingId === npc.id,
    });
  }
  return out;
}

/**
 * The read-only adventure slice, shaped exactly like `AdventureState` so the UI
 * consumes it the way it consumes `WorldState`. Call once per step.
 */
export function projectAdventureState(runtime: AdventureRuntime): AdventureState {
  const target = runtime.interactionTarget;
  return {
    activeDialogue: projectDialogueState(runtime.dialogue),
    quests: projectQuestProgress(runtime.quests),
    activeObjectives: runtime.quests.objectives.slice(),
    discoveredMarkers: Array.from(runtime.discoveredMarkers),
    unlockedCodex: Array.from(runtime.unlockedCodex),
    collectedMotifs: Array.from(runtime.collectedMotifs),
    interactionTarget: target === null ? null : { npcId: target.npcId, prompt: target.prompt },
  };
}
