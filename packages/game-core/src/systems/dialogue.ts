import type { ResonanceFormId, Vec3 } from '@tuner/shared';
import type { DialogueBeat, DialogueChoice, DialogueState, DialogueTree } from '../adventure-types.js';
import type { SimContext } from '../internal/context.js';
import type { MutableCamera } from '../internal/world.js';

/**
 * The dialogue runtime.
 *
 * Conversation is **text first**. There is no recorded voice in this game, and
 * the critical path must be completable with the sound off, so every beat is
 * published as a `ui:subtitle` the moment it starts rather than as a caption
 * layered over audio. The subtitle count for a tree is therefore exactly its
 * beat count, which the tests assert.
 *
 * Three rules shape the rest of it:
 *
 * 1. **Nothing traps the player.** A beat advances on `interact` *or* `jump`,
 *    and holds for `DialogueBeat.seconds` if the player does nothing, so a
 *    conversation plays itself for someone who cannot or does not want to
 *    press a button. Every tree is skippable — `skipDialogue` ends it at once
 *    and still applies the completion effects, because a skipped temple
 *    conversation must not cost the player the ability it was handing over.
 * 2. **Only cinematic trees take the camera.** Ambient chatter leaves the
 *    player in control of the view; a story beat sets the camera intent mode to
 *    `cinematic` and hands the previous mode back when it ends.
 * 3. **The runtime never reaches into quests.** Completion effects go through
 *    `DialogueEffects`, which the adventure layer implements. That keeps this
 *    file testable on its own and stops dialogue and quests from becoming one
 *    tangled system.
 *
 * Step-order note for whoever wires this up: tick the dialogue *before* looking
 * for a new interaction in the same step. `interact.pressed` is edge-triggered,
 * so ticking first means the press that started a conversation cannot also
 * advance its first beat, and the press that ended one cannot immediately open
 * the next.
 */

/** Seconds a beat holds when the author did not say. */
export const DEFAULT_BEAT_SECONDS = 3.4;

/**
 * What a completed tree is allowed to change in the wider world.
 *
 * Implemented by the adventure layer. Kept as an interface rather than a direct
 * dependency so a test can hand in a recorder and assert exactly what a tree
 * did on completion.
 */
export interface DialogueEffects {
  setFlag(flag: string): void;
  grantAbility(ability: ResonanceFormId): void;
  startQuest(questId: string): void;
  completeQuest(questId: string): void;
}

export type DialogueEndReason = 'completed' | 'skipped';

/** Mutable state of one conversation. One of these per world. */
export interface DialogueRuntime {
  tree: DialogueTree | null;
  /** NPC the player is talking to, when the tree came from one. */
  npcId: string | null;
  beatIndex: number;
  /** Seconds spent on the current beat, unaffected by hit-stop. */
  beatElapsed: number;
  awaitingChoice: boolean;
  /** Choices offered right now, already filtered by `requiresFlag`. */
  choices: DialogueChoice[];
  /** True once a branch has been taken, so a loop cannot re-offer it forever. */
  branched: boolean;
  /** Beats subtitled during this tree — the accessibility count. */
  beatsShown: number;
  /** Camera mode to give back when a cinematic tree lets go. */
  restoreCameraMode: MutableCamera['mode'] | null;
  /** The tree that ended most recently, for the adventure layer to react to. */
  lastEnded: { treeId: string; npcId: string | null; reason: DialogueEndReason } | null;
}

export interface StartDialogueOptions {
  readonly npcId?: string | null;
  /** Point a cinematic tree frames — usually the speaker. */
  readonly focus?: Vec3 | null;
}

export function createDialogueRuntime(): DialogueRuntime {
  return {
    tree: null,
    npcId: null,
    beatIndex: 0,
    beatElapsed: 0,
    awaitingChoice: false,
    choices: [],
    branched: false,
    beatsShown: 0,
    restoreCameraMode: null,
    lastEnded: null,
  };
}

export function isDialogueActive(runtime: DialogueRuntime): boolean {
  return runtime.tree !== null;
}

/** The beat currently on screen, or null when nothing is playing. */
export function currentBeat(runtime: DialogueRuntime): DialogueBeat | null {
  const tree = runtime.tree;
  if (!tree) return null;
  return tree.beats[runtime.beatIndex] ?? null;
}

export function beatSecondsOf(beat: DialogueBeat): number {
  const seconds = beat.seconds;
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_BEAT_SECONDS;
  }
  return seconds;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Anything that carries an ordered list of tree ids — `NpcDef` satisfies it. */
export interface DialogueOwner {
  readonly dialogue: readonly string[];
}

export type DialogueLibrary = readonly DialogueTree[] | ReadonlyMap<string, DialogueTree>;

function lookupTree(library: DialogueLibrary, id: string): DialogueTree | null {
  if (Array.isArray(library)) {
    for (const tree of library as readonly DialogueTree[]) {
      if (tree.id === id) return tree;
    }
    return null;
  }
  return (library as ReadonlyMap<string, DialogueTree>).get(id) ?? null;
}

/** True when a tree's own gates allow it to be offered right now. */
export function isTreeEligible(tree: DialogueTree, flags: ReadonlySet<string>): boolean {
  if (tree.requiresFlag !== undefined && !flags.has(tree.requiresFlag)) return false;
  if (tree.consumedByFlag !== undefined && flags.has(tree.consumedByFlag)) return false;
  return true;
}

/**
 * Picks the tree an NPC offers.
 *
 * The authored order is the priority order — most specific first — and the
 * first eligible tree wins. `requiresFlag` stops a story beat firing before its
 * setup, and `consumedByFlag` retires a tree once it has been heard, so a hint
 * does not repeat forever. Pure, and tested on its own.
 */
export function selectDialogueForNpc(
  npc: DialogueOwner,
  trees: DialogueLibrary,
  flags: ReadonlySet<string>,
): DialogueTree | null {
  for (const id of npc.dialogue) {
    const tree = lookupTree(trees, id);
    if (tree === null || tree.beats.length === 0) continue;
    if (!isTreeEligible(tree, flags)) continue;
    return tree;
  }
  return null;
}

/** Choices whose own `requiresFlag` gate is satisfied. */
export function availableChoices(
  tree: DialogueTree,
  flags: ReadonlySet<string>,
): DialogueChoice[] {
  const choices = tree.choices;
  if (!choices || choices.length === 0) return [];
  const out: DialogueChoice[] = [];
  for (const choice of choices) {
    if (choice.requiresFlag !== undefined && !flags.has(choice.requiresFlag)) continue;
    out.push(choice);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function showBeat(ctx: SimContext, runtime: DialogueRuntime): void {
  const beat = currentBeat(runtime);
  if (!beat) return;
  runtime.beatsShown += 1;
  ctx.services.showSubtitle(beat.speaker, beat.text, beatSecondsOf(beat));
}

/**
 * Opens a conversation. Returns false when one is already running or the tree
 * has nothing to say — an empty tree would otherwise take the camera and never
 * give it back.
 */
export function startDialogue(
  ctx: SimContext,
  runtime: DialogueRuntime,
  tree: DialogueTree,
  options: StartDialogueOptions = {},
): boolean {
  if (runtime.tree !== null) return false;
  if (tree.beats.length === 0) return false;

  runtime.tree = tree;
  runtime.npcId = options.npcId ?? null;
  runtime.beatIndex = 0;
  runtime.beatElapsed = 0;
  runtime.awaitingChoice = false;
  runtime.choices = [];
  runtime.branched = false;
  runtime.beatsShown = 0;
  runtime.lastEnded = null;

  if (tree.cinematic === true) {
    const camera = ctx.world.camera;
    runtime.restoreCameraMode = camera.mode;
    camera.mode = 'cinematic';
    const focus = options.focus;
    if (focus) camera.secondaryFocus = { x: focus.x, y: focus.y, z: focus.z };
    // Enough scripted time for the whole tree; ending it clears the remainder.
    camera.scriptedRemaining = Math.max(
      camera.scriptedRemaining,
      tree.beats.reduce((total, beat) => total + beatSecondsOf(beat), 0),
    );
  } else {
    runtime.restoreCameraMode = null;
  }

  showBeat(ctx, runtime);
  return true;
}

/**
 * Advances one beat of the running tree.
 *
 * Input wins over the timer so an impatient player is never held, and the timer
 * exists so a player who presses nothing still hears the whole conversation.
 */
export function tickDialogue(
  ctx: SimContext,
  runtime: DialogueRuntime,
  effects: DialogueEffects,
): void {
  const tree = runtime.tree;
  if (!tree) return;

  const confirm = ctx.input.buttons.interact.pressed || ctx.input.buttons.jump.pressed;

  if (runtime.awaitingChoice) {
    // A branch is the player's to make. If the author left no reachable choice
    // the tree would stall here, so confirm falls through to completion.
    if (confirm && runtime.choices.length === 0) {
      endDialogue(ctx, runtime, effects, 'completed');
    }
    return;
  }

  runtime.beatElapsed += ctx.rawDt;
  const beat = currentBeat(runtime);
  const hold = beat ? beatSecondsOf(beat) : DEFAULT_BEAT_SECONDS;
  if (!confirm && runtime.beatElapsed < hold) return;

  advanceDialogue(ctx, runtime, effects);
}

/** Moves to the next beat, opens the choice list, or ends the tree. */
export function advanceDialogue(
  ctx: SimContext,
  runtime: DialogueRuntime,
  effects: DialogueEffects,
): void {
  const tree = runtime.tree;
  if (!tree) return;

  if (runtime.beatIndex + 1 < tree.beats.length) {
    runtime.beatIndex += 1;
    runtime.beatElapsed = 0;
    showBeat(ctx, runtime);
    return;
  }

  // Past the last beat. Offer a branch once — never twice, or a choice that
  // jumps backwards would loop the conversation forever.
  if (!runtime.branched) {
    const choices = availableChoices(tree, ctx.world.stage.flags);
    if (choices.length > 0) {
      runtime.awaitingChoice = true;
      runtime.choices = choices;
      return;
    }
  }

  endDialogue(ctx, runtime, effects, 'completed');
}

/**
 * Takes a branch. `index` addresses the *offered* list, which is already
 * filtered by `requiresFlag`, so the UI can pass back the row the player
 * pressed without re-deriving the gates.
 */
export function chooseDialogueOption(
  ctx: SimContext,
  runtime: DialogueRuntime,
  index: number,
  effects: DialogueEffects,
): boolean {
  const tree = runtime.tree;
  if (!tree || !runtime.awaitingChoice) return false;
  const choice = runtime.choices[index];
  if (!choice) return false;

  if (choice.setsFlag !== undefined) effects.setFlag(choice.setsFlag);

  runtime.awaitingChoice = false;
  runtime.choices = [];
  runtime.branched = true;

  const goTo = choice.goTo;
  if (goTo === null || goTo < 0 || goTo >= tree.beats.length) {
    endDialogue(ctx, runtime, effects, 'completed');
    return true;
  }

  runtime.beatIndex = goTo;
  runtime.beatElapsed = 0;
  showBeat(ctx, runtime);
  return true;
}

/**
 * Ends the running tree at once.
 *
 * Completion effects still apply. Skipping is a shortcut through the words, not
 * a way to lose the ability, quest or flag the conversation was carrying — a
 * player on a second run must not be punished for having read it already.
 */
export function skipDialogue(
  ctx: SimContext,
  runtime: DialogueRuntime,
  effects: DialogueEffects,
): boolean {
  if (runtime.tree === null) return false;
  endDialogue(ctx, runtime, effects, 'skipped');
  return true;
}

function endDialogue(
  ctx: SimContext,
  runtime: DialogueRuntime,
  effects: DialogueEffects,
  reason: DialogueEndReason,
): void {
  const tree = runtime.tree;
  if (!tree) return;

  if (tree.setsFlagOnComplete !== undefined) effects.setFlag(tree.setsFlagOnComplete);
  // Retiring the tree is part of finishing it: without this a hint declaring
  // `consumedByFlag` would be eligible again the moment it ended.
  if (tree.consumedByFlag !== undefined) effects.setFlag(tree.consumedByFlag);
  if (tree.grantsAbility !== undefined) effects.grantAbility(tree.grantsAbility);
  if (tree.startsQuest !== undefined) effects.startQuest(tree.startsQuest);
  if (tree.completesQuest !== undefined) effects.completeQuest(tree.completesQuest);

  if (runtime.restoreCameraMode !== null) {
    const camera = ctx.world.camera;
    if (camera.mode === 'cinematic') camera.mode = runtime.restoreCameraMode;
    camera.scriptedRemaining = 0;
    camera.secondaryFocus = null;
  }

  runtime.lastEnded = { treeId: tree.id, npcId: runtime.npcId, reason };
  runtime.tree = null;
  runtime.npcId = null;
  runtime.beatIndex = 0;
  runtime.beatElapsed = 0;
  runtime.awaitingChoice = false;
  runtime.choices = [];
  runtime.branched = false;
  runtime.restoreCameraMode = null;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** The read-only view the HUD consumes. Null while nobody is talking. */
export function projectDialogueState(runtime: DialogueRuntime): DialogueState | null {
  const tree = runtime.tree;
  if (!tree) return null;
  const beat = tree.beats[runtime.beatIndex];
  return {
    treeId: tree.id,
    beatIndex: runtime.beatIndex,
    awaitingChoice: runtime.awaitingChoice,
    speaker: beat?.speaker ?? '',
    text: beat?.text ?? '',
    choices: runtime.awaitingChoice ? runtime.choices.slice() : [],
  };
}
