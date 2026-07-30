import { describe, expect, it } from 'vitest';
import { HARMONIC_RATIOS, STAGE_IDS } from '@tuner/shared';
import type { StageId, Vec3 } from '@tuner/shared';
import type {
  CodexEntryDef,
  DialogueTree,
  MapMarkerDef,
  MotifCardDef,
  NpcDef,
  QuestDef,
  QuestStep,
  ShrineDef,
} from '@tuner/game-core';
import { ENEMY_ARCHETYPES } from '../enemies.js';
import { BOSSES } from '../bosses.js';
import { FRACTURED_GARDEN } from '../stages/fractured-garden.js';
import { FRACTURED_GARDEN_ZONE } from './fractured-garden-zone.js';

/**
 * The Fractured Garden's adventure layer, asserted against the stage it sits on.
 *
 * A zone is almost entirely cross-references: quest steps into puzzles and
 * triggers, dialogue into flags, markers into triggers, motifs into pickups.
 * Every one of those is a string, and a string that points at nothing fails
 * silently at runtime — a quest that can never advance, a hint tree that never
 * fires, a motif card nobody can find. So nothing here trusts the content file's
 * prose: the flag universe, the pickup families, the enemy census and the route
 * order are all re-derived from `FRACTURED_GARDEN`, `BOSSES` and
 * `ENEMY_ARCHETYPES`, and the zone is checked against those.
 */

const zone = FRACTURED_GARDEN_ZONE;
const stage = FRACTURED_GARDEN;

// ---------------------------------------------------------------------------
// Indexes derived from the authored stage
// ---------------------------------------------------------------------------

const triggerIds = new Set(stage.triggers.map((trigger) => trigger.id));
const puzzleIds = new Set(stage.puzzles.map((puzzle) => puzzle.id));
const pickupIds = new Set(stage.pickups.map((pickup) => pickup.id));
const bossIds = new Set(Object.values(BOSSES).map((boss) => boss.id));
const archetypeIds = new Set(Object.values(ENEMY_ARCHETYPES).map((archetype) => archetype.id));
const checkpoints = stage.checkpoints;
const geometry = stage.geometry;

/** Content ids of pickups that cannot be taken without a given form. */
const formLockedPickups = new Map<string, string>();
for (const pickup of stage.pickups) {
  if (pickup.requiresForm !== undefined) formLockedPickups.set(pickup.id, pickup.requiresForm);
}

/**
 * Enemy spawns present at *every* difficulty.
 *
 * `minDifficulty` spawns are absent for an Explorer player, so a `cleanse`
 * objective that counted them would be uncompletable on the easiest setting.
 */
const ungatedSpawnsByArchetype = new Map<string, number>();
for (const spawn of stage.enemies) {
  if (spawn.minDifficulty !== undefined) continue;
  ungatedSpawnsByArchetype.set(
    spawn.archetype,
    (ungatedSpawnsByArchetype.get(spawn.archetype) ?? 0) + 1,
  );
}

/**
 * How many authored pickups a `collect` condition would count.
 *
 * Mirrors `countCollected` in the quest runtime: an exact id match counts, and
 * so does any id extending it with `-` or `:`, so one condition can name a
 * family of pickups.
 */
function collectableCount(contentId: string): number {
  let total = 0;
  for (const id of pickupIds) {
    if (id === contentId || id.startsWith(`${contentId}-`) || id.startsWith(`${contentId}:`)) {
      total += 1;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// The flag universe
// ---------------------------------------------------------------------------

/**
 * Every flag anything can set, derived rather than listed.
 *
 * Five producers, matching the runtime exactly:
 *
 * - a stage trigger with a `setFlag` action;
 * - a stage puzzle reward — `setFlag` directly, plus the implicit
 *   `door-open:<doorId>`, `platforms:<puzzleId>` and `revealed:<contentId>`
 *   flags the stage runtime sets for the other three reward kinds;
 * - the adventure runtime's `marker:<id>`, `motif:<id>` and `ability:<id>`;
 * - a dialogue tree's `setsFlagOnComplete` and a choice's `setsFlag`;
 * - a quest's `setsFlagOnComplete`.
 */
function producedFlags(): Set<string> {
  const flags = new Set<string>();

  for (const trigger of stage.triggers) {
    if (trigger.action.kind === 'setFlag') flags.add(trigger.action.flag);
  }
  for (const puzzle of stage.puzzles) {
    const reward = puzzle.reward;
    switch (reward.kind) {
      case 'setFlag':
        flags.add(reward.flag);
        break;
      case 'openDoor':
        flags.add(`door-open:${reward.doorId}`);
        break;
      case 'spawnPlatforms':
        flags.add(`platforms:${puzzle.id}`);
        break;
      case 'revealSecret':
        flags.add(`revealed:${reward.contentId}`);
        break;
    }
  }

  for (const marker of zone.markers) flags.add(`marker:${marker.id}`);
  for (const motif of zone.motifs) flags.add(`motif:${motif.id}`);

  for (const tree of zone.dialogue) {
    if (tree.setsFlagOnComplete !== undefined) flags.add(tree.setsFlagOnComplete);
    if (tree.grantsAbility !== undefined) flags.add(`ability:${tree.grantsAbility}`);
    for (const choice of tree.choices ?? []) {
      if (choice.setsFlag !== undefined) flags.add(choice.setsFlag);
    }
  }
  for (const quest of zone.quests) {
    if (quest.setsFlagOnComplete !== undefined) flags.add(quest.setsFlagOnComplete);
    if (quest.rewardsAbility !== undefined) flags.add(`ability:${quest.rewardsAbility}`);
  }

  return flags;
}

const flagUniverse = producedFlags();

/** Every flag the zone waits on, with a label naming who is waiting. */
function referencedFlags(): readonly { readonly by: string; readonly flag: string }[] {
  const out: { by: string; flag: string }[] = [];

  for (const npc of zone.npcs) {
    if (npc.requiresFlag !== undefined)
      out.push({ by: `${npc.id}.requiresFlag`, flag: npc.requiresFlag });
    if (npc.hiddenByFlag !== undefined)
      out.push({ by: `${npc.id}.hiddenByFlag`, flag: npc.hiddenByFlag });
  }
  for (const tree of zone.dialogue) {
    if (tree.requiresFlag !== undefined)
      out.push({ by: `${tree.id}.requiresFlag`, flag: tree.requiresFlag });
    if (tree.consumedByFlag !== undefined) {
      out.push({ by: `${tree.id}.consumedByFlag`, flag: tree.consumedByFlag });
    }
    for (const choice of tree.choices ?? []) {
      if (choice.requiresFlag !== undefined) {
        out.push({ by: `${tree.id}.choice.requiresFlag`, flag: choice.requiresFlag });
      }
    }
  }
  for (const quest of zone.quests) {
    for (const step of quest.steps) {
      if (step.condition.kind === 'flag') {
        out.push({ by: `${quest.id}/${step.id}`, flag: step.condition.flag });
      }
    }
  }
  for (const entry of zone.codex) {
    if (entry.unlockedByFlag !== undefined) {
      out.push({ by: `${entry.id}.unlockedByFlag`, flag: entry.unlockedByFlag });
    }
  }
  for (const motif of zone.motifs) {
    // `foundAt` accepts a pickup id, a trigger id or a flag; only the flag case
    // belongs to the flag universe.
    const found = motif.foundAt;
    if (found === undefined) continue;
    if (pickupIds.has(found) || triggerIds.has(found)) continue;
    out.push({ by: `${motif.id}.foundAt`, flag: found });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers — is an authored position actually standing on something?
// ---------------------------------------------------------------------------

interface Surface {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly topY: number;
}

const surfaces: readonly Surface[] = geometry
  .filter((entry) => entry.shape.kind === 'box')
  .map((entry) => {
    const shape = entry.shape;
    /* c8 ignore next */
    if (shape.kind !== 'box') throw new Error('filtered above');
    return {
      id: entry.id,
      minX: entry.position.x - shape.halfExtents.x,
      maxX: entry.position.x + shape.halfExtents.x,
      minZ: entry.position.z - shape.halfExtents.z,
      maxZ: entry.position.z + shape.halfExtents.z,
      topY: entry.position.y + shape.halfExtents.y,
    };
  });

/** The surface a point stands on, within a vertical tolerance. */
function surfaceUnder(point: Vec3, below: number, above: number): Surface | null {
  for (const surface of surfaces) {
    if (point.x < surface.minX || point.x > surface.maxX) continue;
    if (point.z < surface.minZ || point.z > surface.maxZ) continue;
    const gap = point.y - surface.topY;
    if (gap >= -below && gap <= above) return surface;
  }
  return null;
}

const worldBounds = surfaces.reduce(
  (acc, surface) => ({
    minX: Math.min(acc.minX, surface.minX),
    maxX: Math.max(acc.maxX, surface.maxX),
    minZ: Math.min(acc.minZ, surface.minZ),
    maxZ: Math.max(acc.maxZ, surface.maxZ),
  }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);

/** Route position of a point: the `order` of the checkpoint nearest to it. */
function routeOrderOf(point: Vec3): number {
  let bestOrder = -1;
  let bestDistance = Infinity;
  for (const checkpoint of checkpoints) {
    const distance = Math.hypot(
      checkpoint.position.x - point.x,
      checkpoint.position.y - point.y,
      checkpoint.position.z - point.z,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOrder = checkpoint.order;
    }
  }
  return bestOrder;
}

// ---------------------------------------------------------------------------
// Zone-local indexes
// ---------------------------------------------------------------------------

const npcById = new Map<string, NpcDef>(zone.npcs.map((npc) => [npc.id, npc]));
const treeById = new Map<string, DialogueTree>(zone.dialogue.map((tree) => [tree.id, tree]));
const questById = new Map<string, QuestDef>(zone.quests.map((quest) => [quest.id, quest]));
const motifIds = new Set(zone.motifs.map((motif) => motif.id));

const mainQuests = zone.quests.filter((quest) => quest.main === true);
const mainQuest = mainQuests[0];
const requiredMainSteps = (mainQuest?.steps ?? []).filter((step) => step.optional !== true);

const sava = npcById.get('npc-sava');

// ---------------------------------------------------------------------------
// Shape and identity
// ---------------------------------------------------------------------------

describe('the zone matches its type and its region', () => {
  it('is the Fractured Garden and points at the authored stage', () => {
    expect(zone.id).toBe('fractured-garden');
    expect(zone.stageId).toBe(stage.id);
    expect(zone.displayName.length).toBeGreaterThan(0);
  });

  it('carries every collection the format defines, non-empty', () => {
    const collections: readonly (readonly unknown[])[] = [
      zone.npcs,
      zone.dialogue,
      zone.quests,
      zone.temples,
      zone.shrines,
      zone.markers,
      zone.codex,
      zone.motifs,
      zone.connections,
    ];
    for (const collection of collections) {
      expect(Array.isArray(collection)).toBe(true);
      expect(collection.length).toBeGreaterThan(0);
    }
  });

  it('connects only to real regions, and never to itself', () => {
    const known = new Set<StageId>(STAGE_IDS);
    for (const connection of zone.connections) {
      expect(known.has(connection)).toBe(true);
      expect(connection).not.toBe(zone.id);
    }
    expect(new Set(zone.connections).size).toBe(zone.connections.length);
  });

  it('has no duplicate ids across npcs, dialogue, quests, shrines, markers, codex and motifs', () => {
    const seen = new Map<string, string>();
    const sources: readonly { readonly label: string; readonly ids: readonly string[] }[] = [
      { label: 'npcs', ids: zone.npcs.map((npc) => npc.id) },
      { label: 'dialogue', ids: zone.dialogue.map((tree) => tree.id) },
      { label: 'quests', ids: zone.quests.map((quest) => quest.id) },
      { label: 'temples', ids: zone.temples.map((temple) => temple.id) },
      { label: 'shrines', ids: zone.shrines.map((shrine) => shrine.id) },
      { label: 'markers', ids: zone.markers.map((marker) => marker.id) },
      { label: 'codex', ids: zone.codex.map((entry) => entry.id) },
      { label: 'motifs', ids: zone.motifs.map((motif) => motif.id) },
      {
        label: 'quest-steps',
        ids: zone.quests.flatMap((quest) => quest.steps.map((step) => step.id)),
      },
    ];
    const collisions: string[] = [];
    for (const source of sources) {
      for (const id of source.ids) {
        const previous = seen.get(id);
        if (previous !== undefined) collisions.push(`${id} in ${previous} and ${source.label}`);
        else seen.set(id, source.label);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('uses kebab-case ids everywhere', () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const ids = [
      ...zone.npcs.map((npc) => npc.id),
      ...zone.dialogue.map((tree) => tree.id),
      ...zone.quests.map((quest) => quest.id),
      ...zone.quests.flatMap((quest) => quest.steps.map((step) => step.id)),
      ...zone.shrines.map((shrine) => shrine.id),
      ...zone.markers.map((marker) => marker.id),
      ...zone.codex.map((entry) => entry.id),
      ...zone.motifs.map((motif) => motif.id),
    ];
    expect(ids.filter((id) => !pattern.test(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

describe('the people who live here', () => {
  it('gives every NPC a name, a model key, dialogue and a routine', () => {
    expect(zone.npcs.length).toBeGreaterThanOrEqual(3);
    for (const npc of zone.npcs) {
      expect(npc.displayName.length).toBeGreaterThan(0);
      expect(npc.appearance.length).toBeGreaterThan(0);
      expect(npc.dialogue.length).toBeGreaterThan(0);
      expect(npc.routine).toBeDefined();
    }
  });

  it('stands every NPC on an authored surface', () => {
    for (const npc of zone.npcs) {
      const surface = surfaceUnder(npc.position, 0.2, 1.2);
      expect(surface, `${npc.id} is standing on nothing`).not.toBeNull();
    }
  });

  it('keeps every patrol point on an authored surface', () => {
    for (const npc of zone.npcs) {
      const routine = npc.routine;
      if (routine === undefined || routine.kind !== 'patrol') continue;
      expect(routine.points.length).toBeGreaterThanOrEqual(2);
      expect(routine.speed).toBeGreaterThan(0);
      for (const point of routine.points) {
        const surface = surfaceUnder(point, 0.2, 1.2);
        expect(surface, `${npc.id} patrols through nothing at z ${point.z}`).not.toBeNull();
      }
    }
  });

  it('resolves every dialogue tree an NPC offers', () => {
    const missing: string[] = [];
    for (const npc of zone.npcs) {
      for (const id of [...npc.dialogue, ...(npc.restoredDialogue ?? [])]) {
        if (!treeById.has(id)) missing.push(`${npc.id} -> ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('leaves no dialogue tree unreachable', () => {
    const referenced = new Set<string>();
    for (const npc of zone.npcs) {
      for (const id of [...npc.dialogue, ...(npc.restoredDialogue ?? [])]) referenced.add(id);
    }
    const orphans = zone.dialogue.filter((tree) => !referenced.has(tree.id)).map((tree) => tree.id);
    expect(orphans).toEqual([]);
  });

  it('always leaves every NPC something to say', () => {
    // An NPC whose every tree is gated or consumed eventually offers nothing at
    // all, and the interaction prompt silently stops appearing.
    for (const npc of zone.npcs) {
      const lists: readonly (readonly string[])[] = [
        npc.dialogue,
        ...(npc.restoredDialogue === undefined ? [] : [npc.restoredDialogue]),
      ];
      for (const list of lists) {
        const fallbacks = list
          .map((id) => treeById.get(id))
          .filter(
            (tree): tree is DialogueTree =>
              tree !== undefined &&
              tree.requiresFlag === undefined &&
              tree.consumedByFlag === undefined,
          );
        expect(fallbacks.length, `${npc.id} can run out of dialogue`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('resolves every NPC a quest step talks to', () => {
    const missing: string[] = [];
    for (const quest of zone.quests) {
      for (const step of quest.steps) {
        if (step.condition.kind !== 'talkTo') continue;
        if (!npcById.has(step.condition.npcId)) missing.push(`${quest.id}/${step.id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives Sava a routine, a restored appearance and restored dialogue', () => {
    expect(sava).toBeDefined();
    if (!sava) return;
    expect(sava.displayName).toBe('Sava');
    expect(sava.routine).toBeDefined();
    expect(sava.restoredAppearance).toBeDefined();
    expect(sava.restoredAppearance).not.toBe(sava.appearance);
    expect((sava.restoredDialogue ?? []).length).toBeGreaterThan(0);
    for (const id of sava.restoredDialogue ?? []) expect(treeById.has(id)).toBe(true);
  });

  it('gives Sava at least four trees: meeting, seal hint, first-seal reaction, restored', () => {
    if (!sava) throw new Error('Sava is missing');
    const trees = [...sava.dialogue, ...(sava.restoredDialogue ?? [])]
      .map((id) => treeById.get(id))
      .filter((tree): tree is DialogueTree => tree !== undefined);
    expect(trees.length).toBeGreaterThanOrEqual(4);

    // The first meeting is ungated by story flags and closes itself.
    const meeting = treeById.get('dlg-sava-first-meeting');
    expect(meeting).toBeDefined();
    expect(meeting?.requiresFlag).toBeUndefined();
    expect(meeting?.setsFlagOnComplete).toBeDefined();
    expect(meeting?.consumedByFlag).toBe(meeting?.setsFlagOnComplete);

    // The seal hint waits for the meeting.
    const seals = treeById.get('dlg-sava-seals');
    expect(seals?.requiresFlag).toBe(meeting?.setsFlagOnComplete);

    // The first-seal reaction waits on the flag the stage sets when the root
    // bridge actually grows, not on a bookkeeping flag invented for dialogue.
    const firstSeal = treeById.get('dlg-sava-first-seal');
    expect(firstSeal?.requiresFlag).toBe('platforms:puz-root-bridge-sequence');
    expect(flagUniverse.has('platforms:puz-root-bridge-sequence')).toBe(true);

    // And she reacts to the region being restored.
    expect(sava.restoredDialogue).toContain('dlg-sava-restored');
  });

  it('has a camp survivor and a survivor who can be cleansed', () => {
    // Somebody living at a camp: an NPC standing within a few metres of a marker
    // authored as a camp.
    const camps = zone.markers.filter((marker) => marker.kind === 'camp');
    expect(camps.length).toBeGreaterThanOrEqual(1);
    const campers = zone.npcs.filter((npc) =>
      camps.some(
        (camp) =>
          Math.hypot(camp.position.x - npc.position.x, camp.position.z - npc.position.z) <= 4,
      ),
    );
    expect(campers.length).toBeGreaterThanOrEqual(1);
    expect(campers.some((npc) => npc.id !== sava?.id)).toBe(true);

    // Somebody the infection has quieted, swapped for a cleansed version of
    // themselves by one flag: hidden by exactly the flag the other requires.
    const pairs = zone.npcs.flatMap((quiet) =>
      quiet.hiddenByFlag === undefined
        ? []
        : zone.npcs
            .filter((woken) => woken.requiresFlag === quiet.hiddenByFlag)
            .map((woken) => ({ quiet, woken })),
    );
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (const pair of pairs) {
      expect(pair.quiet.appearance).not.toBe(pair.woken.appearance);
      expect(pair.quiet.dialogue.length).toBeGreaterThan(0);
      expect(pair.woken.dialogue.length).toBeGreaterThan(0);
      // The flag that wakes them has to be set by something.
      expect(flagUniverse.has(pair.woken.requiresFlag ?? '')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

describe('conversation', () => {
  it('gives every beat a speaker and readable text', () => {
    for (const tree of zone.dialogue) {
      expect(tree.beats.length, `${tree.id} has no beats`).toBeGreaterThan(0);
      for (const beat of tree.beats) {
        expect(beat.speaker.length).toBeGreaterThan(0);
        expect(beat.text.trim().length).toBeGreaterThan(0);
        expect(beat.text.includes('\n')).toBe(false);
        if (beat.seconds !== undefined) {
          expect(beat.seconds).toBeGreaterThan(0);
          expect(beat.seconds).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('never leaves a text-free cue: dialogue is the primary channel', () => {
    // Muted-completable contract. Every beat is subtitled text, so there is no
    // beat whose content lives only in audio.
    const beats = zone.dialogue.flatMap((tree) => tree.beats);
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((beat) => beat.text.trim().length > 0)).toBe(true);
  });

  it('resolves every quest a tree starts or completes', () => {
    for (const tree of zone.dialogue) {
      if (tree.startsQuest !== undefined) {
        expect(questById.has(tree.startsQuest), `${tree.id} starts ${tree.startsQuest}`).toBe(true);
      }
      if (tree.completesQuest !== undefined) {
        expect(questById.has(tree.completesQuest)).toBe(true);
      }
    }
  });

  it('gives every quest an in-world way to start', () => {
    const started = new Set<string>();
    for (const tree of zone.dialogue) {
      if (tree.startsQuest !== undefined) started.add(tree.startsQuest);
    }
    const unstartable = zone.quests.filter((quest) => !started.has(quest.id)).map((q) => q.id);
    expect(unstartable).toEqual([]);
  });

  it('keeps every choice destination inside its own tree', () => {
    for (const tree of zone.dialogue) {
      for (const choice of tree.choices ?? []) {
        expect(choice.text.trim().length).toBeGreaterThan(0);
        if (choice.goTo === null) continue;
        expect(choice.goTo).toBeGreaterThanOrEqual(0);
        expect(choice.goTo).toBeLessThan(tree.beats.length);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

describe('quests', () => {
  it('authors at least four, exactly one of them main', () => {
    expect(zone.quests.length).toBeGreaterThanOrEqual(4);
    expect(mainQuests.length).toBe(1);
    for (const quest of zone.quests) {
      expect(quest.title.length).toBeGreaterThan(0);
      expect(quest.summary.length).toBeGreaterThan(20);
      expect(quest.region).toBe(zone.id);
      expect(quest.steps.length).toBeGreaterThan(0);
    }
  });

  it('gives every step a single-line objective', () => {
    for (const quest of zone.quests) {
      for (const step of quest.steps) {
        expect(step.objective.trim().length, `${quest.id}/${step.id}`).toBeGreaterThan(0);
        expect(step.objective.includes('\n')).toBe(false);
        expect(step.objective.length).toBeLessThanOrEqual(110);
      }
    }
  });

  it('points every condition at something that exists in the stage', () => {
    const problems: string[] = [];
    for (const quest of zone.quests) {
      for (const step of quest.steps) {
        const where = `${quest.id}/${step.id}`;
        const condition = step.condition;
        switch (condition.kind) {
          case 'reachArea':
            if (!triggerIds.has(condition.triggerId)) {
              problems.push(`${where}: no trigger ${condition.triggerId}`);
            }
            break;
          case 'solvePuzzle':
            if (!puzzleIds.has(condition.puzzleId)) {
              problems.push(`${where}: no puzzle ${condition.puzzleId}`);
            }
            break;
          case 'defeatBoss':
            if (!bossIds.has(condition.bossId)) {
              problems.push(`${where}: no boss ${condition.bossId}`);
            }
            break;
          case 'cleanse':
            if (!archetypeIds.has(condition.archetype)) {
              problems.push(`${where}: no archetype ${condition.archetype}`);
            }
            break;
          case 'collect':
            if (collectableCount(condition.contentId) < condition.count) {
              problems.push(
                `${where}: ${condition.contentId} matches ${collectableCount(
                  condition.contentId,
                )} pickups, needs ${condition.count}`,
              );
            }
            break;
          case 'talkTo':
            if (!npcById.has(condition.npcId)) problems.push(`${where}: no npc ${condition.npcId}`);
            break;
          case 'flag':
            if (!flagUniverse.has(condition.flag)) {
              problems.push(`${where}: nothing sets ${condition.flag}`);
            }
            break;
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('never asks for more enemies than the easiest difficulty spawns', () => {
    const problems: string[] = [];
    for (const quest of zone.quests) {
      for (const step of quest.steps) {
        if (step.condition.kind !== 'cleanse') continue;
        const available = ungatedSpawnsByArchetype.get(step.condition.archetype) ?? 0;
        if (available < step.condition.count) {
          problems.push(
            `${quest.id}/${step.id}: wants ${step.condition.count} ${step.condition.archetype}, ` +
              `${available} spawn on every difficulty`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('runs the main quest in route order and finishes by restoring the region', () => {
    if (!mainQuest) throw new Error('no main quest');

    // The stage's checkpoints are ordered along the route, so the checkpoint
    // nearest each required step's hint is a route position. Those must never
    // go backwards.
    const orders = requiredMainSteps.map((step) => {
      expect(step.hintPosition, `${step.id} has no hint position`).toBeDefined();
      return routeOrderOf(step.hintPosition ?? { x: 0, y: 0, z: 0 });
    });
    expect(orders.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < orders.length; i++) {
      const previous = orders[i - 1] ?? -1;
      const current = orders[i] ?? -1;
      expect(current, `step ${requiredMainSteps[i]?.id} runs backwards`).toBeGreaterThanOrEqual(
        previous,
      );
    }

    // It starts at the overlook and ends with the region's own restoration flag.
    const first = requiredMainSteps[0];
    expect(first?.condition).toEqual({ kind: 'reachArea', triggerId: 'trg-opening-vista' });

    const last = requiredMainSteps[requiredMainSteps.length - 1];
    expect(last?.condition.kind).toBe('flag');
    const finalFlag = last?.condition.kind === 'flag' ? last.condition.flag : '';
    expect(finalFlag).toBe('garden-core-recovered');

    // …and that flag is the one the restoration trigger sets, in the same place
    // the stage switches to its restoration phase.
    const setter = stage.triggers.find(
      (trigger) => trigger.action.kind === 'setFlag' && trigger.action.flag === finalFlag,
    );
    expect(setter).toBeDefined();
    const restorationPhase = stage.triggers.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'restoration',
    );
    expect(restorationPhase).toBeDefined();

    expect(mainQuest.setsFlagOnComplete).toBeDefined();
    expect(mainQuest.rewardsAbility).toBe('echo');

    // The three seals and the guardian are all on it, in that order.
    const kinds = requiredMainSteps.map((step) => step.condition.kind);
    expect(kinds.filter((kind) => kind === 'solvePuzzle').length).toBeGreaterThanOrEqual(3);
    expect(
      requiredMainSteps.some(
        (step) =>
          step.condition.kind === 'defeatBoss' &&
          step.condition.bossId === 'oru-fractured-colossus',
      ),
    ).toBe(true);
  });

  it('never blocks the main quest behind an optional conversation', () => {
    // A required `talkTo` would strand the whole region behind an NPC a player
    // can simply run past.
    for (const step of requiredMainSteps) {
      expect(step.condition.kind, `${step.id} is a required conversation`).not.toBe('talkTo');
    }
    const optional = (mainQuest?.steps ?? []).filter((step) => step.optional === true);
    expect(optional.some((step) => step.condition.kind === 'talkTo')).toBe(true);
  });

  it('has a side quest that Sava herself hands out', () => {
    if (!sava) throw new Error('Sava is missing');
    const savasTrees = new Set(sava.dialogue);
    const started = zone.dialogue
      .filter((tree) => savasTrees.has(tree.id) && tree.startsQuest !== undefined)
      .map((tree) => tree.startsQuest);
    const sideFromSava = zone.quests.filter(
      (quest) => quest.main !== true && started.includes(quest.id),
    );
    expect(sideFromSava.length).toBeGreaterThanOrEqual(1);
    for (const quest of sideFromSava) expect(quest.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('has a quest that needs Echo Pulse, so it cannot be finished on a first visit', () => {
    /** Steps whose target is locked behind a form in the authored stage. */
    function echoLocked(step: QuestStep): boolean {
      const condition = step.condition;
      if (condition.kind === 'flag') return condition.flag === 'ability:echo';
      if (condition.kind === 'collect') {
        return formLockedPickups.get(condition.contentId) === 'echo';
      }
      if (condition.kind === 'solvePuzzle') {
        const puzzle = stage.puzzles.find((entry) => entry.id === condition.puzzleId);
        return puzzle?.kind === 'echo';
      }
      return false;
    }

    const gated = zone.quests.filter(
      (quest) => quest.main !== true && quest.steps.some((step) => echoLocked(step)),
    );
    expect(gated.length).toBeGreaterThanOrEqual(1);

    for (const quest of gated) {
      // The gate is explicit: the ability flag the grant itself sets.
      expect(
        quest.steps.some(
          (step) => step.condition.kind === 'flag' && step.condition.flag === 'ability:echo',
        ),
        `${quest.id} does not wait for the ability`,
      ).toBe(true);
      // And more than one of its steps is genuinely form-locked content.
      expect(quest.steps.filter((step) => echoLocked(step)).length).toBeGreaterThanOrEqual(3);
    }

    // The only source of `echo` in this region is the main quest's reward, which
    // is the last thing that happens in it — so nothing above is reachable on a
    // first run.
    expect(mainQuest?.rewardsAbility).toBe('echo');
    expect(gated.every((quest) => quest.id !== mainQuest?.id)).toBe(true);
  });

  it('has an optional collection quest for motif cards', () => {
    const collections = zone.quests.filter((quest) => {
      if (quest.main === true) return false;
      const motifSteps = quest.steps.filter(
        (step) => step.condition.kind === 'flag' && step.condition.flag.startsWith('motif:'),
      );
      return motifSteps.length >= 3;
    });
    expect(collections.length).toBeGreaterThanOrEqual(1);

    for (const quest of collections) {
      for (const step of quest.steps) {
        if (step.condition.kind !== 'flag') continue;
        const id = step.condition.flag.replace(/^motif:/, '');
        expect(motifIds.has(id), `${quest.id}/${step.id} wants unknown motif ${id}`).toBe(true);
      }
      // Optional means optional: it is not the main quest, and it never gates it.
      expect(quest.main).not.toBe(true);
    }
  });

  it('awards Echo Pulse exactly once, and nothing else', () => {
    const awards = [
      ...zone.quests.flatMap((quest) => (quest.rewardsAbility ? [quest.rewardsAbility] : [])),
      ...zone.dialogue.flatMap((tree) => (tree.grantsAbility ? [tree.grantsAbility] : [])),
    ];
    expect(awards).toEqual(['echo']);
  });
});

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

describe('flags', () => {
  it('waits only on flags something actually sets', () => {
    const dangling = referencedFlags()
      .filter((entry) => !flagUniverse.has(entry.flag))
      .map((entry) => `${entry.by} waits on ${entry.flag}`);
    expect(dangling).toEqual([]);
  });

  it('sets no flag twice from two different places', () => {
    const setters = new Map<string, string[]>();
    for (const tree of zone.dialogue) {
      if (tree.setsFlagOnComplete === undefined) continue;
      const list = setters.get(tree.setsFlagOnComplete) ?? [];
      list.push(tree.id);
      setters.set(tree.setsFlagOnComplete, list);
    }
    for (const quest of zone.quests) {
      if (quest.setsFlagOnComplete === undefined) continue;
      const list = setters.get(quest.setsFlagOnComplete) ?? [];
      list.push(quest.id);
      setters.set(quest.setsFlagOnComplete, list);
    }
    const shared = [...setters.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([flag, owners]) => `${flag}: ${owners.join(', ')}`);
    expect(shared).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Temple
// ---------------------------------------------------------------------------

describe('the temple reference', () => {
  it('names the temple of this region, its ability and its guardian', () => {
    const temple = zone.temples.find((entry) => entry.id === 'temple-of-the-first-breath');
    expect(temple).toBeDefined();
    if (!temple) return;
    expect(temple.region).toBe(zone.id);
    expect(temple.teaches).toBe('echo');
    expect(temple.guardianId).toBe('oru-fractured-colossus');
    expect(bossIds.has(temple.guardianId)).toBe(true);
    if (temple.miniBossId !== undefined) expect(bossIds.has(temple.miniBossId)).toBe(true);
    expect(temple.displayName.length).toBeGreaterThan(0);

    // The restoration chord is playable harmony, not decoration.
    expect(temple.restorationChord.length).toBeGreaterThanOrEqual(3);
    for (const degree of temple.restorationChord) {
      expect(Number.isInteger(degree)).toBe(true);
      expect(degree).toBeGreaterThanOrEqual(0);
      expect(degree).toBeLessThan(HARMONIC_RATIOS.length);
    }

    // The rooms are authored in the temples module. Whatever it merges in has to
    // be well-formed, but this zone does not invent them.
    expect(Array.isArray(temple.rooms)).toBe(true);
    for (const room of temple.rooms) {
      expect(room.id.length).toBeGreaterThan(0);
      expect(room.name.length).toBeGreaterThan(0);
      expect(room.intent.length).toBeGreaterThan(0);
      expect(room.entryTriggerId.length).toBeGreaterThan(0);
    }
  });

  it('matches the guardian the stage fights and the ability the region awards', () => {
    const temple = zone.temples[0];
    expect(temple?.guardianId).toBe(stage.commanderId);
    expect(temple?.teaches).toBe(mainQuest?.rewardsAbility);
  });
});

// ---------------------------------------------------------------------------
// Shrines
// ---------------------------------------------------------------------------

describe('shrines', () => {
  it('authors at least three, all optional and all in this region', () => {
    expect(zone.shrines.length).toBeGreaterThanOrEqual(3);
    const requiredContentIds = new Set<string>();
    for (const quest of zone.quests) {
      if (quest.main !== true) continue;
      for (const step of quest.steps) {
        if (step.condition.kind === 'collect') requiredContentIds.add(step.condition.contentId);
      }
    }
    for (const shrine of zone.shrines) {
      expect(shrine.region).toBe(zone.id);
      expect(shrine.displayName.length).toBeGreaterThan(0);
      // No shrine reward is on the critical path.
      if (shrine.rewardContentId !== undefined) {
        expect(requiredContentIds.has(shrine.rewardContentId)).toBe(false);
      }
    }
  });

  it('exposes exactly one shrine that accepts a player composition', () => {
    const composing = zone.shrines.filter((shrine) => shrine.acceptsComposition === true);
    expect(composing.length).toBe(1);
    // A composition shrine has no fixed puzzle to solve — that is the point.
    expect(composing[0]?.puzzleId).toBeUndefined();
  });

  it('points every shrine puzzle and reward at something real', () => {
    for (const shrine of zone.shrines) {
      if (shrine.puzzleId !== undefined) {
        expect(puzzleIds.has(shrine.puzzleId), `${shrine.id} -> ${shrine.puzzleId}`).toBe(true);
      }
      const reward = shrine.rewardContentId;
      if (reward === undefined) continue;
      expect(
        pickupIds.has(reward) || motifIds.has(reward),
        `${shrine.id} rewards unknown ${reward}`,
      ).toBe(true);
    }
  });

  it('stands every shrine on authored ground', () => {
    for (const shrine of zone.shrines) {
      const surface = surfaceUnder(shrine.position, 0.1, 1.5);
      expect(surface, `${shrine.id} floats`).not.toBeNull();
    }
  });

  it('marks every shrine on the map', () => {
    for (const shrine of zone.shrines) {
      const marker = zone.markers.find(
        (entry) =>
          entry.kind === 'shrine' &&
          Math.hypot(entry.position.x - shrine.position.x, entry.position.z - shrine.position.z) <=
            1,
      );
      expect(marker, `${shrine.id} has no map marker`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Map markers
// ---------------------------------------------------------------------------

describe('the map', () => {
  it('labels every marker and puts it in this region, inside the stage', () => {
    for (const marker of zone.markers) {
      expect(marker.region).toBe(zone.id);
      expect(marker.label.trim().length).toBeGreaterThan(0);
      expect(marker.position.x).toBeGreaterThanOrEqual(worldBounds.minX - 4);
      expect(marker.position.x).toBeLessThanOrEqual(worldBounds.maxX + 4);
      expect(marker.position.z).toBeGreaterThanOrEqual(worldBounds.minZ - 4);
      expect(marker.position.z).toBeLessThanOrEqual(worldBounds.maxZ + 4);
    }
  });

  it('covers the temple, shrines, a camp, a village, a cave, a mast, the crash site, the guardian and the way home', () => {
    const kinds = new Set<MapMarkerDef['kind']>(zone.markers.map((marker) => marker.kind));
    for (const kind of [
      'temple',
      'shrine',
      'village',
      'camp',
      'cave',
      'tower',
      'crash-site',
      'guardian',
      'sanctuary',
    ] as const) {
      expect(kinds.has(kind), `no ${kind} marker`).toBe(true);
    }
  });

  it('is mostly a record of where the player has been', () => {
    const gated = zone.markers.filter((marker) => marker.discoveredByTriggerId !== undefined);
    expect(gated.length * 2).toBeGreaterThan(zone.markers.length);
    for (const marker of gated) {
      expect(
        triggerIds.has(marker.discoveredByTriggerId ?? ''),
        `${marker.id} -> ${marker.discoveredByTriggerId}`,
      ).toBe(true);
    }
    // The exceptions are the shrines: found by standing at them.
    const proximity = zone.markers.filter((marker) => marker.discoveredByTriggerId === undefined);
    expect(proximity.every((marker) => marker.kind === 'shrine')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

describe('the codex', () => {
  it('authors at least eight short entries', () => {
    expect(zone.codex.length).toBeGreaterThanOrEqual(8);
    for (const entry of zone.codex) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.body.trim().length).toBeGreaterThan(60);
      // Short: a paragraph read standing up, not a lore dump.
      expect(entry.body.length).toBeLessThanOrEqual(600);
    }
  });

  it('covers at least four of the five categories', () => {
    const categories = new Set<CodexEntryDef['category']>(
      zone.codex.map((entry) => entry.category),
    );
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  it('records what the garden was, who Oru was, and how a Detuner behaves', () => {
    const byCategory = (category: CodexEntryDef['category']): readonly CodexEntryDef[] =>
      zone.codex.filter((entry) => entry.category === category);

    expect(byCategory('world').length).toBeGreaterThanOrEqual(1);
    expect(byCategory('people').length).toBeGreaterThanOrEqual(2);
    expect(byCategory('creatures').length).toBeGreaterThanOrEqual(1);

    // Oru before the Amplifier: a people entry that names the Amplifier and is
    // not about the fight.
    const oru = byCategory('people').find((entry) => /oru/i.test(entry.title));
    expect(oru).toBeDefined();
    expect(/amplifier/i.test(oru?.body ?? '')).toBe(true);

    // A field observation of a Detuner: a creatures entry naming an archetype
    // the stage actually spawns.
    const spawned = new Set(stage.enemies.map((spawn) => spawn.archetype));
    const observed = byCategory('creatures').filter((entry) =>
      [...spawned].some((archetype) => {
        const displayName = ENEMY_ARCHETYPES[archetype]?.displayName ?? '';
        return (
          displayName.length > 0 &&
          (entry.title.toLowerCase().includes(displayName.toLowerCase()) ||
            entry.body.toLowerCase().includes(displayName.toLowerCase()))
        );
      }),
    );
    expect(observed.length).toBeGreaterThanOrEqual(1);
  });

  it('unlocks every gated entry from a flag something sets', () => {
    const dangling = zone.codex
      .filter(
        (entry) => entry.unlockedByFlag !== undefined && !flagUniverse.has(entry.unlockedByFlag),
      )
      .map((entry) => `${entry.id} -> ${entry.unlockedByFlag ?? ''}`);
    expect(dangling).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Motif cards
// ---------------------------------------------------------------------------

describe('motif cards', () => {
  it('authors at least six, and covers every layer', () => {
    expect(zone.motifs.length).toBeGreaterThanOrEqual(6);
    const layers = new Set<MotifCardDef['layer']>(zone.motifs.map((motif) => motif.layer));
    for (const layer of ['rhythm', 'bass', 'harmony', 'melody'] as const) {
      expect(layers.has(layer), `no ${layer} motif`).toBe(true);
    }
  });

  it('writes every step as a playable harmonic degree or a rest', () => {
    for (const motif of zone.motifs) {
      expect(motif.region).toBe(zone.id);
      expect(motif.name.trim().length).toBeGreaterThan(0);
      expect(motif.stepsPerBar).toBeGreaterThan(0);
      expect(motif.steps.length).toBeGreaterThan(0);
      expect(motif.steps.length).toBeLessThanOrEqual(motif.stepsPerBar * 2);

      let sounded = 0;
      for (const step of motif.steps) {
        if (step === null) continue;
        sounded += 1;
        expect(Number.isInteger(step), `${motif.id} has a non-integer degree`).toBe(true);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThan(HARMONIC_RATIOS.length);
      }
      // A card of nothing but rests is not material.
      expect(sounded, `${motif.id} is silent`).toBeGreaterThanOrEqual(2);
    }
  });

  it('hides every card behind a pickup, a trigger or a flag that exists', () => {
    const dangling: string[] = [];
    for (const motif of zone.motifs) {
      const found = motif.foundAt;
      if (found === undefined) {
        dangling.push(`${motif.id} has no source`);
        continue;
      }
      if (pickupIds.has(found) || triggerIds.has(found) || flagUniverse.has(found)) continue;
      dangling.push(`${motif.id} -> ${found}`);
    }
    expect(dangling).toEqual([]);
  });

  it('spreads the collectable cards across the region rather than stacking them', () => {
    const sources = zone.motifs.map((motif) => motif.foundAt ?? '');
    expect(new Set(sources).size).toBe(sources.length);
  });
});

// ---------------------------------------------------------------------------
// Accessibility contract
// ---------------------------------------------------------------------------

describe('the region is completable muted', () => {
  it('carries the whole critical path on conditions with visual state', () => {
    // Every required main-quest condition is a place, a puzzle, a boss or a
    // flag — all of which the HUD, the map and the quest log show as text.
    // Nothing on the spine is an audio-only cue.
    const allowed = new Set(['reachArea', 'solvePuzzle', 'defeatBoss', 'flag']);
    for (const step of requiredMainSteps) {
      expect(allowed.has(step.condition.kind), `${step.id}: ${step.condition.kind}`).toBe(true);
      expect(step.objective.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives the player a written objective for every step of every quest', () => {
    const stepsWithoutText = zone.quests
      .flatMap((quest) => quest.steps.map((step: QuestStep) => ({ quest, step })))
      .filter(({ step }) => step.objective.trim().length === 0)
      .map(({ quest, step }) => `${quest.id}/${step.id}`);
    expect(stepsWithoutText).toEqual([]);
  });

  it('names the visual tell wherever a conversation teaches a mechanic', () => {
    // The pylon warning is the one piece of combat instruction delivered by an
    // NPC. It has to name what the player can *see*, not what they can hear.
    const pylons = zone.dialogue.find((tree) => tree.id === 'dlg-renn-pylons');
    expect(pylons).toBeDefined();
    const text = (pylons?.beats ?? []).map((beat) => beat.text).join(' ');
    expect(/gold/i.test(text)).toBe(true);
  });

  it('describes the detuned survivor in text rather than in pitch alone', () => {
    const quiet = zone.dialogue.find((tree) => tree.id === 'dlg-tarn-quiet');
    expect(quiet).toBeDefined();
    const text = (quiet?.beats ?? []).map((beat) => beat.text).join(' ');
    expect(/hum/i.test(text)).toBe(true);
    expect(/flat|four hundred and forty/i.test(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A last sanity pass on the shape of the thing
// ---------------------------------------------------------------------------

describe('the zone as a whole', () => {
  it('adds people, reasons and a record without touching the stage', () => {
    // The stage is unchanged: the zone references it by id and nothing else.
    expect(zone.stageId).toBe(stage.id);
    expect(zone.npcs.length).toBeGreaterThanOrEqual(3);
    expect(zone.quests.length).toBeGreaterThanOrEqual(4);
    expect(zone.shrines.length).toBeGreaterThanOrEqual(3);
    expect(zone.markers.length).toBeGreaterThanOrEqual(9);
    expect(zone.codex.length).toBeGreaterThanOrEqual(8);
    expect(zone.motifs.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every shrine, marker and motif of this region tagged to it', () => {
    const regions = new Set<StageId>([
      ...zone.shrines.map((shrine: ShrineDef) => shrine.region),
      ...zone.markers.map((marker) => marker.region),
      ...zone.motifs.map((motif) => motif.region),
      ...zone.quests.map((quest) => quest.region),
      ...zone.temples.map((temple) => temple.region),
    ]);
    expect([...regions]).toEqual([zone.id]);
  });
});
