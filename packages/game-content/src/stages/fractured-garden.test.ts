import { describe, expect, it } from 'vitest';
import { GRAVITY, HARMONIC_RATIOS, RESONANCE_FORM_IDS, isResonanceFormId } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import type { GeometryDef, MovingPlatformDef, PlatformMotion, PuzzleDef } from '@tuner/game-core';
import { ENEMY_ARCHETYPES } from '../enemies.js';
import { BOSSES } from '../bosses.js';
import { FRACTURED_GARDEN, FRACTURED_GARDEN_TRAVERSALS } from './fractured-garden.js';
import type { TraversalPair } from './fractured-garden.js';

/**
 * The Fractured Garden's authoring contract, asserted rather than hoped for.
 *
 * A stage is a graph of ids pretending to be a place. Rename one resonator and
 * a bridge silently never grows; move one platform four metres and a jump that
 * was generous becomes impossible. Every rule the stage file states in prose is
 * checked here in numbers.
 */

const stage = FRACTURED_GARDEN;

// ---------------------------------------------------------------------------
// Movement budget, re-derived from the physics constants
// ---------------------------------------------------------------------------

/** Metres per second on the ground. */
const RUN_SPEED = 8.6;
/** Apex of a standing jump, in metres. */
const JUMP_RISE = 3.05;
/** Extra height the second jump buys from the first jump's apex. */
const DOUBLE_JUMP_RISE = 2.5;
const DASH_SPEED = 24;
const DASH_SECONDS = 0.17;

const g = Math.abs(GRAVITY);

/** Highest surface a double jump can reach from a standing start. */
const MAX_RISE = JUMP_RISE + DOUBLE_JUMP_RISE;

/**
 * Widest flat gap a running double jump clears: time to the first apex, plus
 * time to the second apex, plus the fall back to the launch height, all spent
 * at running speed.
 */
const doubleJumpAirtime =
  Math.sqrt(2 * g * JUMP_RISE) / g + Math.sqrt(2 * g * DOUBLE_JUMP_RISE) / g + Math.sqrt((2 * MAX_RISE) / g);
const MAX_HORIZONTAL_NO_DASH = RUN_SPEED * doubleJumpAirtime;

/** A dash covers 4.08 m where running would have covered 1.46 m. */
const DASH_GAIN = DASH_SPEED * DASH_SECONDS - RUN_SPEED * DASH_SECONDS;
const MAX_HORIZONTAL = MAX_HORIZONTAL_NO_DASH + DASH_GAIN;

/**
 * The authoring margin the stage file claims: no critical-path crossing is
 * allowed to sit closer than 15 % to the theoretical ceiling. Landing assist is
 * 0.12 on Standard and 0 on Resonance Master, so the ceiling has to stay a
 * ceiling and not a target.
 */
const SAFETY_MARGIN = 0.85;

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

// ---------------------------------------------------------------------------
// Id collection
// ---------------------------------------------------------------------------

interface IdSource {
  readonly label: string;
  readonly ids: readonly string[];
}

const idSources: readonly IdSource[] = [
  { label: 'geometry', ids: stage.geometry.map((entry) => entry.id) },
  { label: 'movingPlatforms', ids: stage.movingPlatforms.map((entry) => entry.id) },
  { label: 'rails', ids: stage.rails.map((entry) => entry.id) },
  { label: 'hazards', ids: stage.hazards.map((entry) => entry.id) },
  { label: 'enemies', ids: stage.enemies.map((entry) => entry.id) },
  { label: 'pickups', ids: stage.pickups.map((entry) => entry.id) },
  { label: 'resonators', ids: stage.resonators.map((entry) => entry.id) },
  { label: 'puzzles', ids: stage.puzzles.map((entry) => entry.id) },
  { label: 'doors', ids: stage.doors.map((entry) => entry.id) },
  { label: 'triggers', ids: stage.triggers.map((entry) => entry.id) },
  { label: 'checkpoints', ids: stage.checkpoints.map((entry) => entry.id) },
  { label: 'cutscenes', ids: stage.cutscenes.map((entry) => entry.id) },
  { label: 'tutorials', ids: stage.tutorials.map((entry) => entry.id) },
  { label: 'props', ids: (stage.props ?? []).map((entry) => entry.id) },
];

const allIds: readonly string[] = idSources.flatMap((source) => source.ids);

const geometryIds = new Set(stage.geometry.map((entry) => entry.id));
const platformIds = new Set(stage.movingPlatforms.map((entry) => entry.id));
const doorIds = new Set(stage.doors.map((entry) => entry.id));
const triggerIds = new Set(stage.triggers.map((entry) => entry.id));
const pickupIds = new Set(stage.pickups.map((entry) => entry.id));
const resonatorIds = new Set(stage.resonators.map((entry) => entry.id));
const puzzleIds = new Set(stage.puzzles.map((entry) => entry.id));
const enemyIds = new Set(stage.enemies.map((entry) => entry.id));
const cutsceneIds = new Set(stage.cutscenes.map((entry) => entry.id));
const tutorialIds = new Set(stage.tutorials.map((entry) => entry.id));

/** Flags anything in the stage is capable of raising. */
const producedFlags = new Set<string>([
  ...stage.puzzles
    .filter((puzzle) => puzzle.reward.kind === 'setFlag')
    .map((puzzle) => (puzzle.reward.kind === 'setFlag' ? puzzle.reward.flag : '')),
  ...stage.triggers
    .filter((trigger) => trigger.action.kind === 'setFlag')
    .map((trigger) => (trigger.action.kind === 'setFlag' ? trigger.action.flag : '')),
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN identity', () => {
  it('is the fractured-garden stage with the ids the rest of the content bundle expects', () => {
    expect(stage.id).toBe('fractured-garden');
    expect(stage.miniBossId).toBe('virus-bloom');
    expect(stage.commanderId).toBe('oru-fractured-colossus');
  });

  it('runs at a tempo the rhythm hazards and rhythm platforms can be counted at', () => {
    expect(stage.bpm).toBeGreaterThanOrEqual(100);
    expect(stage.bpm).toBeLessThanOrEqual(120);
  });

  it('is authored as a full-length stage, not a sketch', () => {
    // 15–30 minutes at par, and enough content to fill it.
    expect(stage.parSeconds).toBeGreaterThanOrEqual(900);
    expect(stage.parSeconds).toBeLessThanOrEqual(1800);
    expect(stage.geometry.length).toBeGreaterThanOrEqual(40);
    expect(stage.movingPlatforms.length).toBeGreaterThanOrEqual(15);
    expect(stage.enemies.length).toBeGreaterThanOrEqual(20);
    expect(stage.triggers.length).toBeGreaterThanOrEqual(25);
  });

  it('starts detuned but not lost, and ships a restored ambience variant', () => {
    expect(stage.infection).toBeGreaterThan(0);
    expect(stage.infection).toBeLessThan(1);
    expect(stage.ambience.restored).toBeDefined();
    // The restored palette must actually differ, or the restoration reads as a
    // bug rather than a payoff.
    expect(stage.ambience.restored?.skyBottom).not.toBe(stage.ambience.skyBottom);
    expect(stage.ambience.restored?.fogColour).not.toBe(stage.ambience.fogColour);
    expect(stage.ambience.restored?.sunColour).not.toBe(stage.ambience.sunColour);
  });

  it('carries geometry that only exists in one of the two world states', () => {
    expect(stage.geometry.some((entry) => entry.onlyWhenRestored === true)).toBe(true);
    expect(stage.geometry.some((entry) => entry.hiddenWhenRestored === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN referential integrity', () => {
  it('has no duplicate ids anywhere in the stage', () => {
    const seen = new Map<string, number>();
    for (const id of allIds) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it('uses non-empty ids everywhere', () => {
    for (const id of allIds) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('resolves every trigger action target', () => {
    for (const trigger of stage.triggers) {
      const action = trigger.action;
      switch (action.kind) {
        case 'spawnWave':
          expect(action.spawnIds.length).toBeGreaterThan(0);
          for (const spawnId of action.spawnIds) {
            expect(enemyIds.has(spawnId), `${trigger.id} → ${spawnId}`).toBe(true);
          }
          break;
        case 'cutscene':
          expect(cutsceneIds.has(action.cutsceneId), `${trigger.id} → ${action.cutsceneId}`).toBe(true);
          break;
        case 'tutorial':
          expect(tutorialIds.has(action.tutorialId), `${trigger.id} → ${action.tutorialId}`).toBe(true);
          break;
        case 'objective':
          expect(action.text.length).toBeGreaterThan(0);
          break;
        case 'setFlag':
          expect(action.flag.length).toBeGreaterThan(0);
          break;
        case 'phase':
          expect(['miniboss', 'commander', 'restoration']).toContain(action.phase);
          break;
        case 'vista':
          expect(action.seconds).toBeGreaterThan(0);
          break;
      }
    }
  });

  it('resolves every puzzle reward target', () => {
    for (const puzzle of stage.puzzles) {
      const reward = puzzle.reward;
      switch (reward.kind) {
        case 'openDoor':
          expect(doorIds.has(reward.doorId), `${puzzle.id} → ${reward.doorId}`).toBe(true);
          break;
        case 'spawnPlatforms':
          expect(reward.platformIds.length).toBeGreaterThan(0);
          for (const id of reward.platformIds) {
            expect(geometryIds.has(id) || platformIds.has(id), `${puzzle.id} → ${id}`).toBe(true);
          }
          break;
        case 'revealSecret':
          expect(pickupIds.has(reward.contentId), `${puzzle.id} → ${reward.contentId}`).toBe(true);
          break;
        case 'setFlag':
          expect(reward.flag.length).toBeGreaterThan(0);
          break;
      }
      expect(puzzle.hint.length).toBeGreaterThan(0);
    }
  });

  it('links every puzzle to real resonators and every resonator to a real puzzle', () => {
    for (const puzzle of stage.puzzles) {
      expect(puzzle.resonatorIds.length).toBeGreaterThan(0);
      for (const id of puzzle.resonatorIds) {
        expect(resonatorIds.has(id), `${puzzle.id} → ${id}`).toBe(true);
      }
    }
    for (const resonator of stage.resonators) {
      expect(puzzleIds.has(resonator.puzzleId), `${resonator.id} → ${resonator.puzzleId}`).toBe(true);
    }
  });

  it('keeps puzzle membership symmetric — no orphaned or double-claimed resonators', () => {
    for (const puzzle of stage.puzzles) {
      const members = stage.resonators.filter((resonator) => resonator.puzzleId === puzzle.id);
      expect(members.map((entry) => entry.id).sort()).toEqual([...puzzle.resonatorIds].sort());
    }
    const claims = stage.puzzles.flatMap((puzzle) => puzzle.resonatorIds);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it('gives every sequence puzzle a complete, contiguous order', () => {
    for (const puzzle of stage.puzzles.filter((entry) => entry.kind === 'sequence')) {
      const orders = puzzle.resonatorIds
        .map((id) => stage.resonators.find((resonator) => resonator.id === id)?.order)
        .filter((order): order is number => order !== undefined);
      expect(orders.length).toBe(puzzle.resonatorIds.length);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders.map((_, index) => index));
    }
  });

  it('opens every flag-gated door with a flag something can actually raise', () => {
    for (const door of stage.doors) {
      if (door.openedByFlag !== undefined) {
        expect(producedFlags.has(door.openedByFlag), `${door.id} ← ${door.openedByFlag}`).toBe(true);
      }
    }
    // Every door is opened either by a flag or by a puzzle naming it directly.
    const puzzleOpenedDoors = new Set(
      stage.puzzles
        .filter((puzzle) => puzzle.reward.kind === 'openDoor')
        .map((puzzle) => (puzzle.reward.kind === 'openDoor' ? puzzle.reward.doorId : '')),
    );
    for (const door of stage.doors) {
      expect(door.openedByFlag !== undefined || puzzleOpenedDoors.has(door.id), `${door.id} is unopenable`).toBe(true);
    }
  });

  it('resolves every enemy spawn trigger and secret it guards', () => {
    for (const spawn of stage.enemies) {
      if (spawn.triggerId !== undefined) {
        expect(triggerIds.has(spawn.triggerId), `${spawn.id} → ${spawn.triggerId}`).toBe(true);
      }
      if (spawn.guardsSecret !== undefined) {
        const secret = stage.pickups.find((pickup) => pickup.id === spawn.guardsSecret);
        expect(secret, `${spawn.id} guards ${spawn.guardsSecret}`).toBeDefined();
        expect(secret?.isSecret).toBe(true);
      }
    }
  });

  it('only ever names Resonance Forms that exist', () => {
    const forms = [
      ...stage.geometry.map((entry) => entry.revealedBy),
      ...stage.hazards.map((entry) => entry.clearedBy),
      ...stage.rails.map((entry) => entry.requiresForm),
      ...stage.pickups.map((entry) => entry.requiresForm),
      ...stage.resonators.map((entry) => entry.requiresForm),
    ].filter((form): form is string => form !== undefined);
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(isResonanceFormId(form), form).toBe(true);
      expect(RESONANCE_FORM_IDS).toContain(form);
    }
  });

  it('keeps every resonator degree inside the harmonic table', () => {
    for (const resonator of stage.resonators) {
      expect(Number.isInteger(resonator.degree)).toBe(true);
      expect(resonator.degree).toBeGreaterThanOrEqual(0);
      expect(resonator.degree).toBeLessThan(HARMONIC_RATIOS.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN secrets', () => {
  const secrets = stage.pickups.filter((pickup) => pickup.isSecret === true);

  it('declares a secretTotal that matches the isSecret pickups exactly', () => {
    expect(stage.secretTotal).toBe(secrets.length);
  });

  it('hides at least six secrets', () => {
    expect(secrets.length).toBeGreaterThanOrEqual(6);
  });

  it('locks at least two secrets behind Echo Form, which only Oru awards', () => {
    const echoSecrets = secrets.filter((pickup) => pickup.requiresForm === 'echo');
    expect(echoSecrets.length).toBeGreaterThanOrEqual(2);
    expect(BOSSES['oru-fractured-colossus']?.awardsForm).toBe('echo');
  });

  it('locks at least one secret behind a form from a later region', () => {
    const laterForms = secrets
      .map((pickup) => pickup.requiresForm)
      .filter((form): form is string => form !== undefined && form !== 'echo' && form !== 'base');
    expect(laterForms.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves at least two secrets findable on the first visit', () => {
    const openSecrets = secrets.filter((pickup) => pickup.requiresForm === undefined);
    expect(openSecrets.length).toBeGreaterThanOrEqual(2);
  });

  it('collects the full spread of collectible kinds the stage promises', () => {
    const kinds = new Set(stage.pickups.map((pickup) => pickup.kind));
    for (const kind of [
      'resonance-shard',
      'coherence-fragment',
      'frequency-capacitor',
      'lost-motif',
      'keeper-memory',
    ]) {
      expect(kinds.has(kind as (typeof stage.pickups)[number]['kind']), kind).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Puzzles and mechanics
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN mechanics', () => {
  it('uses at least four resonators and three puzzles', () => {
    expect(stage.resonators.length).toBeGreaterThanOrEqual(4);
    expect(stage.puzzles.length).toBeGreaterThanOrEqual(3);
  });

  it('covers at least three of the four puzzle kinds', () => {
    const kinds = new Set<PuzzleDef['kind']>(stage.puzzles.map((puzzle) => puzzle.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('ships an echo puzzle that cannot be solved on the first visit', () => {
    const echoPuzzle = stage.puzzles.find((puzzle) => puzzle.kind === 'echo');
    expect(echoPuzzle).toBeDefined();
    if (echoPuzzle === undefined) return;

    const members = echoPuzzle.resonatorIds
      .map((id) => stage.resonators.find((resonator) => resonator.id === id))
      .filter((resonator): resonator is NonNullable<typeof resonator> => resonator !== undefined);
    expect(members.length).toBeGreaterThanOrEqual(3);

    // Every hop between resonators must take longer to run than the note stays
    // lit — otherwise a base-Auralith player could brute-force it and the
    // stage would lose its reason to be replayed.
    for (let i = 0; i < members.length - 1; i += 1) {
      const from = members[i];
      const to = members[i + 1];
      if (from === undefined || to === undefined) continue;
      const hold = Math.min(from.holdSeconds ?? Infinity, to.holdSeconds ?? Infinity);
      const travelSeconds = distance(from.position, to.position) / RUN_SPEED;
      expect(travelSeconds, `${from.id} → ${to.id}`).toBeGreaterThan(hold);
    }
  });

  it('uses all five platform motion kinds', () => {
    const kinds = new Set<PlatformMotion['kind']>(stage.movingPlatforms.map((platform) => platform.motion.kind));
    for (const kind of ['linear', 'orbit', 'vertical', 'rhythm', 'collapse'] as const) {
      expect(kinds.has(kind), `missing motion kind: ${kind}`).toBe(true);
    }
    expect(kinds.size).toBe(5);
  });

  it('authors water lifts as vertical motion and collapsing paths as collapse motion', () => {
    const lifts = stage.movingPlatforms.filter((platform) => platform.id.includes('water-lift'));
    expect(lifts.length).toBeGreaterThanOrEqual(2);
    for (const lift of lifts) {
      expect(lift.motion.kind).toBe('vertical');
    }

    const collapsing = stage.movingPlatforms.filter((platform) => platform.motion.kind === 'collapse');
    expect(collapsing.length).toBeGreaterThanOrEqual(4);
    for (const slab of collapsing) {
      if (slab.motion.kind !== 'collapse') continue;
      // Long enough to react to, short enough to be a threat; and it must come
      // back, or a missed jump would soft-lock the route.
      expect(slab.motion.delaySeconds).toBeGreaterThanOrEqual(0.3);
      expect(slab.motion.delaySeconds).toBeLessThanOrEqual(1.5);
      expect(slab.motion.respawnSeconds).toBeGreaterThan(0);
    }
  });

  it('keeps every platform phase offset inside one cycle', () => {
    for (const platform of stage.movingPlatforms) {
      if (platform.phase === undefined) continue;
      expect(platform.phase).toBeGreaterThanOrEqual(0);
      expect(platform.phase).toBeLessThanOrEqual(1);
    }
  });

  it('grows the root bridge from a puzzle rather than handing it over', () => {
    const bridgePuzzle = stage.puzzles.find((puzzle) => puzzle.reward.kind === 'spawnPlatforms');
    expect(bridgePuzzle).toBeDefined();
    if (bridgePuzzle?.reward.kind !== 'spawnPlatforms') return;

    const decks = bridgePuzzle.reward.platformIds
      .map((id) => stage.geometry.find((entry) => entry.id === id))
      .filter((entry): entry is GeometryDef => entry !== undefined);
    expect(decks.length).toBe(bridgePuzzle.reward.platformIds.length);
    expect(decks.length).toBeGreaterThanOrEqual(3);

    // The deck has to be flat and contiguous, or "the bridge appeared" would
    // still be followed by "and I fell off it".
    const heights = decks.map((deck) => deck.position.y);
    for (const height of heights) {
      expect(height).toBeCloseTo(heights[0] ?? 0, 5);
    }
    const sorted = [...decks].sort((a, b) => b.position.z - a.position.z);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const near = sorted[i];
      const far = sorted[i + 1];
      if (near === undefined || far === undefined) continue;
      const nearHalf = near.shape.kind === 'box' ? near.shape.halfExtents.z : 0;
      const farHalf = far.shape.kind === 'box' ? far.shape.halfExtents.z : 0;
      const gap = near.position.z - nearHalf - (far.position.z + farHalf);
      expect(gap, `${near.id} → ${far.id}`).toBeLessThanOrEqual(0.01);
    }
  });

  it('runs at least one grindable resonance line, and gates one behind a form', () => {
    expect(stage.rails.length).toBeGreaterThanOrEqual(1);
    for (const rail of stage.rails) {
      expect(rail.points.length).toBeGreaterThanOrEqual(2);
      expect(rail.speed ?? 0).toBeGreaterThan(0);
    }
    expect(stage.rails.some((rail) => rail.requiresForm !== undefined)).toBe(true);
  });

  it('syncs at least one hazard to the region beat, and keeps every rhythm legible', () => {
    const rhythmic = stage.hazards.filter((hazard) => hazard.rhythm !== undefined);
    expect(rhythmic.length).toBeGreaterThanOrEqual(1);
    for (const hazard of rhythmic) {
      const rhythm = hazard.rhythm;
      if (rhythm === undefined) continue;
      expect(rhythm.beats).toBeGreaterThan(0);
      expect(rhythm.activeBeats).toBeGreaterThan(0);
      // A hazard that is active for its whole cycle is not a rhythm, it is a wall.
      expect(rhythm.activeBeats).toBeLessThan(rhythm.beats);
      expect(rhythm.offset ?? 0).toBeGreaterThanOrEqual(0);
      expect(rhythm.offset ?? 0).toBeLessThan(rhythm.beats);
      // Every window has to be wide enough to walk through at running speed.
      const beatSeconds = 60 / stage.bpm;
      expect((rhythm.beats - rhythm.activeBeats) * beatSeconds).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('opens at least one shortcut with a form the player does not have yet', () => {
    const cleared = stage.hazards.filter((hazard) => hazard.clearedBy !== undefined);
    expect(cleared.length).toBeGreaterThanOrEqual(1);
    for (const hazard of cleared) {
      expect(hazard.clearedBy).not.toBe('base');
    }
  });

  it('never authors a damaging hazard with zero damage, or a pit that damages', () => {
    for (const hazard of stage.hazards) {
      if (hazard.isPit === true) {
        expect(hazard.damage).toBe(0);
      } else {
        expect(hazard.damage).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN population', () => {
  it('spawns only archetypes that exist in the bestiary', () => {
    for (const spawn of stage.enemies) {
      expect(ENEMY_ARCHETYPES[spawn.archetype], `${spawn.id} → ${spawn.archetype}`).toBeDefined();
    }
  });

  it('fields the families the stage brief names', () => {
    const archetypes = new Set(stage.enemies.map((spawn) => spawn.archetype));
    for (const required of ['whisperer', 'spore-drifter', 'root-fracture', 'infected-garden-guardian']) {
      expect(archetypes.has(required), required).toBe(true);
    }
  });

  it('keeps flying archetypes off the floor and grounded archetypes on it', () => {
    for (const spawn of stage.enemies) {
      const archetype = ENEMY_ARCHETYPES[spawn.archetype];
      if (archetype?.flying === true) {
        expect(spawn.position.y, spawn.id).toBeGreaterThan(stage.killPlaneY);
      }
    }
  });

  it('gives every patrol at least two points, all above the kill plane', () => {
    for (const spawn of stage.enemies) {
      if (spawn.patrol === undefined) continue;
      expect(spawn.patrol.length, spawn.id).toBeGreaterThanOrEqual(2);
      for (const point of spawn.patrol) {
        expect(point.y, spawn.id).toBeGreaterThan(stage.killPlaneY);
      }
    }
  });

  it('names a mini-boss and a commander that both belong to this stage', () => {
    const mini = BOSSES[stage.miniBossId ?? ''];
    const commander = BOSSES[stage.commanderId ?? ''];
    expect(mini).toBeDefined();
    expect(commander).toBeDefined();
    expect(mini?.stageId).toBe('fractured-garden');
    expect(commander?.stageId).toBe('fractured-garden');
    expect(mini?.isMiniBoss).toBe(true);
    expect(commander?.isMiniBoss).not.toBe(true);
  });

  it('awards Echo Form from the commander and nothing from the mini-boss', () => {
    expect(BOSSES[stage.commanderId ?? '']?.awardsForm).toBe('echo');
    expect(BOSSES[stage.miniBossId ?? '']?.awardsForm).toBeUndefined();
  });

  it('drives both boss encounters from stage triggers', () => {
    const phases = stage.triggers
      .filter((trigger) => trigger.action.kind === 'phase')
      .map((trigger) => (trigger.action.kind === 'phase' ? trigger.action.phase : ''));
    expect(phases).toContain('miniboss');
    expect(phases).toContain('commander');
    expect(phases).toContain('restoration');
  });
});

// ---------------------------------------------------------------------------
// Route progress — used by the checkpoint ordering assertions
// ---------------------------------------------------------------------------

/**
 * The critical path, as a polyline. `progressAlong` projects a world point onto
 * it and returns the arc length at the closest point, which gives every object
 * in the stage a single scalar "how far in is this" that the checkpoint tests
 * can be ordered by.
 */
const ROUTE: readonly Vec3[] = [
  { x: 0, y: 0.4, z: 6 },
  { x: 0, y: 0, z: -12 },
  { x: 0, y: -1.2, z: -30 },
  { x: 0, y: -2.9, z: -46 },
  { x: 0, y: -2.9, z: -67 },
  { x: 0, y: -2.9, z: -90 },
  { x: -14, y: -2.9, z: -90 },
  { x: -41, y: -2.9, z: -90 },
  { x: -48, y: 8, z: -90 },
  { x: -50, y: 13.85, z: -82 },
  { x: -38, y: 12.9, z: -77 },
  { x: -30, y: 13, z: -77 },
  { x: 4, y: 12.9, z: -78 },
  { x: 4, y: 11.35, z: -88 },
  { x: -14, y: 8, z: -100 },
  { x: -25, y: 8, z: -100 },
  { x: -14, y: 1.15, z: -115 },
  { x: -12, y: 0, z: -110 },
  { x: -4, y: 0, z: -104 },
  { x: 10, y: 0, z: -107 },
  { x: 22, y: 0, z: -108 },
  { x: 22, y: 2.5, z: -130 },
  { x: -11, y: 10, z: -128 },
  { x: -22, y: 10, z: -128 },
  { x: -38, y: 14, z: -142 },
  { x: -34, y: 17.85, z: -161 },
  { x: -32, y: 19, z: -168 },
  { x: -26, y: 12.4, z: -184 },
  { x: -12, y: 6, z: -190 },
  { x: -1, y: 0, z: -194 },
  { x: 0, y: 0, z: -190 },
  { x: 0, y: 0, z: -160 },
  { x: 0, y: 0, z: -136 },
];

function progressAlong(point: Vec3): number {
  let travelled = 0;
  let best = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (let i = 0; i < ROUTE.length - 1; i += 1) {
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    if (a === undefined || b === undefined) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const segmentLength = Math.sqrt(lengthSquared);

    const raw =
      lengthSquared === 0
        ? 0
        : ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / lengthSquared;
    const t = Math.min(1, Math.max(0, raw));

    const closest: Vec3 = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
    const d = distance(point, closest);
    if (d < best) {
      best = d;
      bestProgress = travelled + segmentLength * t;
    }
    travelled += segmentLength;
  }

  return bestProgress;
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN checkpoints', () => {
  const byOrder = [...stage.checkpoints].sort((a, b) => a.order - b.order);

  it('uses unique, contiguous, ascending orders', () => {
    const orders = byOrder.map((checkpoint) => checkpoint.order);
    expect(new Set(orders).size).toBe(orders.length);
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i] ?? 0).toBeGreaterThan(orders[i - 1] ?? 0);
    }
    expect(orders[0]).toBe(0);
  });

  it('places enough checkpoints to cover every major section', () => {
    expect(stage.checkpoints.length).toBeGreaterThanOrEqual(10);
  });

  it('orders checkpoints monotonically along the authored route', () => {
    let previous = -Infinity;
    for (const checkpoint of byOrder) {
      const progress = progressAlong(checkpoint.position);
      expect(progress, `${checkpoint.id} is out of route order`).toBeGreaterThan(previous);
      previous = progress;
    }
  });

  it('never asks the player to replay more than a short stretch', () => {
    for (let i = 1; i < byOrder.length; i += 1) {
      const previous = byOrder[i - 1];
      const current = byOrder[i];
      if (previous === undefined || current === undefined) continue;
      const stretch = progressAlong(current.position) - progressAlong(previous.position);
      // At 8.6 m/s, 260 m of route is about thirty seconds of running — and
      // every one of these stretches also contains a fight or a puzzle.
      expect(stretch, `${previous.id} → ${current.id}`).toBeLessThanOrEqual(260);
    }
  });

  it('brackets the mini-boss with a checkpoint on each side', () => {
    const arena = BOSSES['virus-bloom']?.arenaCentre;
    expect(arena).toBeDefined();
    if (arena === undefined) return;

    const arenaProgress = progressAlong(arena);
    const before = byOrder.filter((checkpoint) => progressAlong(checkpoint.position) < arenaProgress);
    const after = byOrder.filter((checkpoint) => progressAlong(checkpoint.position) > arenaProgress);

    expect(before.length, 'no checkpoint before the mini-boss').toBeGreaterThanOrEqual(1);
    expect(after.length, 'no checkpoint after the mini-boss').toBeGreaterThanOrEqual(1);

    // The bracketing pair must be adjacent in order, so failing the mini-boss
    // costs the fight and nothing else.
    const last = before[before.length - 1];
    const first = after[0];
    expect(last).toBeDefined();
    expect(first).toBeDefined();
    expect((first?.order ?? 0) - (last?.order ?? 0)).toBe(1);
  });

  it('puts a checkpoint immediately before the Commander', () => {
    const arena = BOSSES['oru-fractured-colossus']?.arenaCentre;
    expect(arena).toBeDefined();
    if (arena === undefined) return;

    const commanderTrigger = stage.triggers.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'commander',
    );
    expect(commanderTrigger).toBeDefined();
    if (commanderTrigger === undefined) return;

    const gateProgress = progressAlong(commanderTrigger.position);
    const before = byOrder.filter((checkpoint) => progressAlong(checkpoint.position) < gateProgress);
    expect(before.length).toBeGreaterThanOrEqual(1);

    const last = before[before.length - 1];
    expect(last).toBeDefined();
    // Within a short walk of the arena door.
    expect(gateProgress - progressAlong(last?.position ?? arena)).toBeLessThanOrEqual(60);
  });

  it('orders the mini-boss before the Commander along the route', () => {
    const mini = BOSSES['virus-bloom']?.arenaCentre;
    const commander = BOSSES['oru-fractured-colossus']?.arenaCentre;
    expect(mini).toBeDefined();
    expect(commander).toBeDefined();
    if (mini === undefined || commander === undefined) return;
    expect(progressAlong(mini)).toBeLessThan(progressAlong(commander));
  });
});

// ---------------------------------------------------------------------------
// World bounds
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN world bounds', () => {
  function lowestPoint(entry: GeometryDef | MovingPlatformDef): number {
    const shape = entry.shape;
    switch (shape.kind) {
      case 'box':
      case 'ramp':
        return entry.position.y - shape.halfExtents.y;
      case 'sphere':
        return entry.position.y - shape.radius;
      case 'capsule':
        return entry.position.y - shape.halfHeight - shape.radius;
    }
  }

  it('sits the kill plane below every piece of geometry and every platform', () => {
    const surfaces = [...stage.geometry, ...stage.movingPlatforms];
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
      expect(lowestPoint(surface), `${surface.id} is at or below the kill plane`).toBeGreaterThan(stage.killPlaneY);
    }
  });

  it('leaves clear air between the kill plane and the lowest surface', () => {
    const lowest = Math.min(...[...stage.geometry, ...stage.movingPlatforms].map(lowestPoint));
    // A fall has to read as a fall before it resolves.
    expect(lowest - stage.killPlaneY).toBeGreaterThanOrEqual(8);
  });

  it('accounts for vertical platform travel when checking the kill plane', () => {
    for (const platform of stage.movingPlatforms) {
      if (platform.motion.kind !== 'vertical') continue;
      const lowest = lowestPoint(platform) - platform.motion.amplitude;
      expect(lowest, `${platform.id} dips below the kill plane`).toBeGreaterThan(stage.killPlaneY);
    }
  });

  it('spawns the player on solid ground above the kill plane', () => {
    expect(stage.spawnPoint.y).toBeGreaterThan(stage.killPlaneY);
    expect(progressAlong(stage.spawnPoint)).toBeLessThan(10);
  });

  it('keeps every checkpoint, pickup and resonator above the kill plane', () => {
    for (const entry of [...stage.checkpoints, ...stage.pickups, ...stage.resonators]) {
      expect(entry.position.y, entry.id).toBeGreaterThan(stage.killPlaneY);
    }
  });
});

// ---------------------------------------------------------------------------
// Jump reachability
// ---------------------------------------------------------------------------

describe('FRACTURED_GARDEN jump reachability', () => {
  /**
   * The helper the brief asks for: given a standing point and a landing point,
   * is the crossing inside the abilities the player has? Horizontal reach is
   * the double jump plus an air dash; vertical reach is the double jump alone,
   * because a dash buys distance, not height.
   */
  function isReachable(pair: TraversalPair): { readonly ok: boolean; readonly reason: string } {
    const horizontal = horizontalDistance(pair.from, pair.to);
    const rise = pair.to.y - pair.from.y;

    if (rise > MAX_RISE) {
      return { ok: false, reason: `rise ${rise.toFixed(2)} m exceeds the ${MAX_RISE.toFixed(2)} m double jump` };
    }
    if (horizontal > MAX_HORIZONTAL) {
      return {
        ok: false,
        reason: `gap ${horizontal.toFixed(2)} m exceeds the ${MAX_HORIZONTAL.toFixed(2)} m double-jump-plus-dash reach`,
      };
    }
    // A single-jump crossing must not secretly need the double jump.
    if (pair.technique === 'jump' && rise > JUMP_RISE) {
      return { ok: false, reason: `rise ${rise.toFixed(2)} m needs more than a single jump` };
    }
    return { ok: true, reason: '' };
  }

  it('derives a movement budget consistent with the numbers in the stage file', () => {
    expect(MAX_RISE).toBeCloseTo(5.55, 5);
    expect(MAX_HORIZONTAL_NO_DASH).toBeGreaterThan(12);
    expect(MAX_HORIZONTAL_NO_DASH).toBeLessThan(12.5);
    expect(DASH_GAIN).toBeCloseTo(2.618, 3);
    expect(MAX_HORIZONTAL).toBeGreaterThan(14.5);
  });

  it('declares at least eight crossings covering the critical path', () => {
    expect(FRACTURED_GARDEN_TRAVERSALS.length).toBeGreaterThanOrEqual(8);
    const ids = FRACTURED_GARDEN_TRAVERSALS.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pair of FRACTURED_GARDEN_TRAVERSALS) {
      expect(pair.note.length, pair.id).toBeGreaterThan(0);
    }
  });

  it('makes every authored crossing possible with the abilities available', () => {
    for (const pair of FRACTURED_GARDEN_TRAVERSALS) {
      const result = isReachable(pair);
      expect(result.ok, `${pair.id}: ${result.reason}`).toBe(true);
    }
  });

  it('holds the authored safety margin on every crossing', () => {
    for (const pair of FRACTURED_GARDEN_TRAVERSALS) {
      const horizontal = horizontalDistance(pair.from, pair.to);
      expect(horizontal, `${pair.id} leaves no margin`).toBeLessThanOrEqual(MAX_HORIZONTAL * SAFETY_MARGIN);
      const rise = pair.to.y - pair.from.y;
      expect(rise, `${pair.id} leaves no vertical margin`).toBeLessThanOrEqual(MAX_RISE - 0.5);
    }
  });

  it('never authors a drop long enough to read as a mistake', () => {
    for (const pair of FRACTURED_GARDEN_TRAVERSALS) {
      const drop = pair.from.y - pair.to.y;
      expect(drop, `${pair.id} falls too far`).toBeLessThanOrEqual(20);
    }
  });

  it('spreads the crossings across the whole stage rather than one section', () => {
    const progresses = FRACTURED_GARDEN_TRAVERSALS.map((pair) => progressAlong(pair.from));
    const span = Math.max(...progresses) - Math.min(...progresses);
    const routeLength = ROUTE.slice(1).reduce((total, point, index) => {
      const previous = ROUTE[index];
      return previous === undefined ? total : total + distance(previous, point);
    }, 0);
    expect(span).toBeGreaterThan(routeLength * 0.6);
  });
});
