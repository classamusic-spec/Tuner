import type { ResonanceFormId } from '@tuner/shared';
import type { QuestDef, QuestProgress, QuestStep, QuestStepCondition } from '../adventure-types.js';
import type { SimContext } from '../internal/context.js';

/**
 * The quest runtime.
 *
 * A quest is a list of steps with one condition each, and the whole design of
 * this file is that those conditions are *pure predicates over a snapshot of
 * the world* rather than callbacks scattered through the other systems. The
 * stage runtime already records everything needed — flags, fired triggers,
 * solved puzzles, collected pickups — so the quest layer reads that record
 * instead of asking every system to remember to notify it. Nothing can fall out
 * of sync with a quest it never knew about, and each predicate is testable on
 * its own with a hand-built snapshot.
 *
 * Two ordering rules, both deliberate:
 *
 * - **Main quests advance in order.** Only the first incomplete required step
 *   of a `main` quest is evaluated, so a player who trips a later condition
 *   early does not skip the story between them. Side quests are order-free,
 *   because a side quest that insists on its own sequence is just a main quest
 *   with worse pacing.
 * - **Optional steps never block.** They are always evaluated and never gate
 *   completion. That is what makes them optional rather than hidden required
 *   work.
 *
 * **Accessibility contract.** Every step completion emits a `ui:notification`
 * *and* pushes the next objective through `services.setObjective`, which emits
 * `stage:objectiveChanged`. Progress is never announced by sound alone, and the
 * HUD always knows what to do next.
 */

// ---------------------------------------------------------------------------
// The world snapshot the conditions read
// ---------------------------------------------------------------------------

/**
 * Everything a quest condition may look at.
 *
 * Deliberately narrow: a condition cannot reach into the world, so it cannot
 * accidentally depend on frame-local state and become non-deterministic.
 */
export interface QuestWorldView {
  readonly flags: ReadonlySet<string>;
  /** Ids of stage triggers that have fired. */
  readonly firedTriggers: ReadonlySet<string>;
  readonly solvedPuzzles: ReadonlySet<string>;
  /** Boss definition ids that have been freed. */
  readonly defeatedBosses: ReadonlySet<string>;
  readonly talkedTo: ReadonlySet<string>;
  /** Content ids of pickups taken. */
  readonly collectedContent: ReadonlySet<string>;
  /** Cleansed count per enemy archetype. */
  readonly cleansedByArchetype: ReadonlyMap<string, number>;
}

export function createQuestWorldView(): QuestWorldView {
  return {
    flags: new Set(),
    firedTriggers: new Set(),
    solvedPuzzles: new Set(),
    defeatedBosses: new Set(),
    talkedTo: new Set(),
    collectedContent: new Set(),
    cleansedByArchetype: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Pure predicates, one per condition kind
// ---------------------------------------------------------------------------

export function flagConditionMet(flag: string, flags: ReadonlySet<string>): boolean {
  return flags.has(flag);
}

export function reachAreaConditionMet(
  triggerId: string,
  firedTriggers: ReadonlySet<string>,
): boolean {
  return firedTriggers.has(triggerId);
}

/**
 * Counts collected pickups belonging to a content family.
 *
 * A `collect` condition asks for `count` of a `contentId`, but authored pickup
 * ids are unique — there is only ever one `garden-shard-1`. So the id names a
 * family: an exact match counts, and so does any id extending it with `-` or
 * `:`. That lets "collect three resonance shards" be authored once against
 * `garden-shard` without inventing a separate inventory format.
 */
export function countCollected(contentId: string, collected: ReadonlySet<string>): number {
  let total = 0;
  for (const id of collected) {
    if (id === contentId || id.startsWith(`${contentId}-`) || id.startsWith(`${contentId}:`)) {
      total += 1;
    }
  }
  return total;
}

export function collectConditionMet(
  contentId: string,
  count: number,
  collected: ReadonlySet<string>,
): boolean {
  return countCollected(contentId, collected) >= Math.max(1, count);
}

export function cleanseConditionMet(
  archetype: string,
  count: number,
  cleansedByArchetype: ReadonlyMap<string, number>,
): boolean {
  return (cleansedByArchetype.get(archetype) ?? 0) >= Math.max(1, count);
}

export function solvePuzzleConditionMet(
  puzzleId: string,
  solvedPuzzles: ReadonlySet<string>,
): boolean {
  return solvedPuzzles.has(puzzleId);
}

export function defeatBossConditionMet(
  bossId: string,
  defeatedBosses: ReadonlySet<string>,
): boolean {
  return defeatedBosses.has(bossId);
}

export function talkToConditionMet(npcId: string, talkedTo: ReadonlySet<string>): boolean {
  return talkedTo.has(npcId);
}

/** Dispatches one condition against the snapshot. Exhaustive by construction. */
export function isStepConditionMet(
  condition: QuestStepCondition,
  view: QuestWorldView,
): boolean {
  switch (condition.kind) {
    case 'flag':
      return flagConditionMet(condition.flag, view.flags);
    case 'reachArea':
      return reachAreaConditionMet(condition.triggerId, view.firedTriggers);
    case 'collect':
      return collectConditionMet(condition.contentId, condition.count, view.collectedContent);
    case 'cleanse':
      return cleanseConditionMet(
        condition.archetype,
        condition.count,
        view.cleansedByArchetype,
      );
    case 'solvePuzzle':
      return solvePuzzleConditionMet(condition.puzzleId, view.solvedPuzzles);
    case 'defeatBoss':
      return defeatBossConditionMet(condition.bossId, view.defeatedBosses);
    case 'talkTo':
      return talkToConditionMet(condition.npcId, view.talkedTo);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface MutableQuestProgress {
  readonly questId: string;
  readonly def: QuestDef;
  started: boolean;
  /** Completed step ids, in the order they were completed. */
  completedSteps: string[];
  complete: boolean;
}

export interface QuestRuntime {
  defs: Map<string, QuestDef>;
  progress: Map<string, MutableQuestProgress>;
  /** Quest ids, most recently advanced first. Drives the HUD ordering. */
  order: string[];
  /** Current objective of every started, incomplete quest — most recent first. */
  objectives: string[];
  /**
   * The last text this layer pushed into `stage.objective`.
   *
   * Kept so the quest layer can retract exactly its own line when nothing is
   * left to point at, without ever clearing an objective a stage trigger set.
   */
  published: string | null;
}

/** What a quest may change in the wider world when it completes. */
export interface QuestEffects {
  setFlag(flag: string): void;
  grantAbility(ability: ResonanceFormId): void;
}

export function createQuestRuntime(defs: readonly QuestDef[] = []): QuestRuntime {
  const runtime: QuestRuntime = {
    defs: new Map(),
    progress: new Map(),
    order: [],
    objectives: [],
    published: null,
  };
  registerQuests(runtime, defs);
  return runtime;
}

export function registerQuests(runtime: QuestRuntime, defs: readonly QuestDef[]): void {
  for (const def of defs) runtime.defs.set(def.id, def);
}

export function questProgressOf(
  runtime: QuestRuntime,
  questId: string,
): MutableQuestProgress | null {
  return runtime.progress.get(questId) ?? null;
}

// ---------------------------------------------------------------------------
// Step availability and objectives
// ---------------------------------------------------------------------------

/**
 * True when a step may be evaluated now.
 *
 * Optional steps are always available. Main-quest required steps wait for every
 * earlier required step; side-quest steps do not.
 */
export function isStepAvailable(
  def: QuestDef,
  progress: MutableQuestProgress,
  index: number,
): boolean {
  const step = def.steps[index];
  if (!step) return false;
  if (step.optional === true) return true;
  if (def.main !== true) return true;
  for (let i = 0; i < index; i++) {
    const earlier = def.steps[i];
    if (!earlier || earlier.optional === true) continue;
    if (!progress.completedSteps.includes(earlier.id)) return false;
  }
  return true;
}

/** The step whose objective the HUD should show, or null when there is none. */
export function nextStepOf(
  def: QuestDef,
  progress: MutableQuestProgress,
): QuestStep | null {
  for (const step of def.steps) {
    if (progress.completedSteps.includes(step.id)) continue;
    if (step.optional === true) continue;
    return step;
  }
  // Only optional work left: point at it rather than showing nothing.
  for (const step of def.steps) {
    if (!progress.completedSteps.includes(step.id)) return step;
  }
  return null;
}

export function nextObjectiveOf(def: QuestDef, progress: MutableQuestProgress): string | null {
  if (progress.complete) return null;
  return nextStepOf(def, progress)?.objective ?? null;
}

function requiredStepsComplete(def: QuestDef, progress: MutableQuestProgress): boolean {
  for (const step of def.steps) {
    if (step.optional === true) continue;
    if (!progress.completedSteps.includes(step.id)) return false;
  }
  return true;
}

function promote(runtime: QuestRuntime, questId: string): void {
  const at = runtime.order.indexOf(questId);
  if (at >= 0) runtime.order.splice(at, 1);
  runtime.order.unshift(questId);
}

/** Recomputes the HUD objective list, most recently advanced quest first. */
export function refreshObjectives(runtime: QuestRuntime): void {
  const objectives: string[] = [];
  for (const questId of runtime.order) {
    const progress = runtime.progress.get(questId);
    if (!progress || !progress.started || progress.complete) continue;
    const objective = nextObjectiveOf(progress.def, progress);
    if (objective !== null && objective.length > 0) objectives.push(objective);
  }
  runtime.objectives = objectives;
}

/**
 * Pushes the leading objective into the stage runtime.
 *
 * `services.setObjective` de-duplicates, so this only emits
 * `stage:objectiveChanged` when the text actually changes — exactly once per
 * step transition, which is what the HUD wants and what the test asserts.
 *
 * When the last quest finishes there is nothing to point at, and leaving a
 * completed step on the HUD reads as a task the player has failed to notice. So
 * the layer retracts its own line — and *only* its own line: a stage trigger's
 * `objective` action writes the same field, and stomping that would replace a
 * live instruction with nothing.
 */
function publishObjective(ctx: SimContext, runtime: QuestRuntime): void {
  refreshObjectives(runtime);
  const leading = runtime.objectives[0];
  if (leading !== undefined) {
    runtime.published = leading;
    ctx.services.setObjective(leading);
    return;
  }
  if (runtime.published !== null && ctx.world.stage.objective === runtime.published) {
    runtime.published = null;
    ctx.services.setObjective('');
  }
}

// ---------------------------------------------------------------------------
// Starting, advancing and completing
// ---------------------------------------------------------------------------

export function startQuest(
  ctx: SimContext,
  runtime: QuestRuntime,
  questId: string,
): boolean {
  const def = runtime.defs.get(questId);
  if (!def) return false;
  const existing = runtime.progress.get(questId);
  if (existing && existing.started) return false;

  const progress: MutableQuestProgress = existing ?? {
    questId,
    def,
    started: false,
    completedSteps: [],
    complete: false,
  };
  progress.started = true;
  runtime.progress.set(questId, progress);
  promote(runtime, questId);

  ctx.events.emit('ui:notification', { text: `New task — ${def.title}`, seconds: 4 });
  publishObjective(ctx, runtime);
  return true;
}

function completeStep(
  ctx: SimContext,
  runtime: QuestRuntime,
  progress: MutableQuestProgress,
  step: QuestStep,
): void {
  progress.completedSteps.push(step.id);
  promote(runtime, progress.questId);
  ctx.events.emit('ui:notification', { text: `Done — ${step.objective}`, seconds: 3 });
}

/**
 * Marks a quest complete, applying its reward.
 *
 * Used both by the evaluator and by a dialogue tree's `completesQuest`, so a
 * conversation that resolves a quest hands out the same reward the conditions
 * would have.
 */
export function completeQuest(
  ctx: SimContext,
  runtime: QuestRuntime,
  questId: string,
  effects: QuestEffects,
): boolean {
  const def = runtime.defs.get(questId);
  if (!def) return false;
  let progress = runtime.progress.get(questId);
  if (!progress) {
    progress = { questId, def, started: true, completedSteps: [], complete: false };
    runtime.progress.set(questId, progress);
    promote(runtime, questId);
  }
  if (progress.complete) return false;

  progress.started = true;
  progress.complete = true;

  if (def.rewardsAbility !== undefined) effects.grantAbility(def.rewardsAbility);
  if (def.setsFlagOnComplete !== undefined) effects.setFlag(def.setsFlagOnComplete);

  ctx.events.emit('ui:notification', { text: `Complete — ${def.title}`, seconds: 4.5 });
  publishObjective(ctx, runtime);
  return true;
}

/**
 * Evaluates every started quest against the snapshot.
 *
 * Steps are visited in authored order, so a main quest can complete two steps
 * in one pass when the second condition was already satisfied — each still
 * emits its own notification and objective change.
 */
export function evaluateQuests(
  ctx: SimContext,
  runtime: QuestRuntime,
  view: QuestWorldView,
  effects: QuestEffects,
): void {
  for (const progress of runtime.progress.values()) {
    if (!progress.started || progress.complete) continue;
    const def = progress.def;

    let advanced = false;
    let finished = false;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (!step) continue;
      if (progress.completedSteps.includes(step.id)) continue;
      if (!isStepAvailable(def, progress, i)) continue;
      if (!isStepConditionMet(step.condition, view)) continue;

      completeStep(ctx, runtime, progress, step);
      advanced = true;
      // The required work is done, so the quest is finished — but keep sweeping
      // the rest of the list. Once no required step is outstanding the only
      // thing left to find is an *optional* step that was already satisfied,
      // and stopping here would silently deny the player credit for it. The
      // objective is left to `completeQuest`, which moves the HUD on to
      // whatever is still open.
      if (requiredStepsComplete(def, progress)) {
        finished = true;
        continue;
      }
      publishObjective(ctx, runtime);
    }

    if (!advanced) continue;
    if (finished) {
      completeQuest(ctx, runtime, progress.questId, effects);
    } else {
      // A no-op when the loop already published this objective — `setObjective`
      // de-duplicates, so no second `stage:objectiveChanged` is emitted.
      publishObjective(ctx, runtime);
    }
  }
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export function projectQuestProgress(runtime: QuestRuntime): QuestProgress[] {
  const out: QuestProgress[] = [];
  for (const progress of runtime.progress.values()) {
    if (!progress.started) continue;
    out.push({
      questId: progress.questId,
      completedSteps: progress.completedSteps.slice(),
      complete: progress.complete,
    });
  }
  return out;
}
