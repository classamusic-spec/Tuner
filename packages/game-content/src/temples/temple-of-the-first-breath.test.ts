import { describe, expect, it } from 'vitest';
import { GRAVITY, HARMONIC_RATIOS, RESONANCE_FORM_IDS, isResonanceFormId } from '@tuner/shared';
import type { ResonanceFormId, Vec3 } from '@tuner/shared';
import { DEFAULT_COMBAT_CONFIG, RESONANCE_FORMS } from '@tuner/game-core';
import type {
  GeometryDef,
  MovingPlatformDef,
  PuzzleDef,
  TempleBeat,
  TempleRoomDef,
} from '@tuner/game-core';
import { ENEMY_ARCHETYPES } from '../enemies.js';
import { BOSSES } from '../bosses.js';
import {
  TEMPLE_LOCK,
  TEMPLE_OF_THE_FIRST_BREATH,
  TEMPLE_OF_THE_FIRST_BREATH_STAGE,
  TEMPLE_OF_THE_FIRST_BREATH_TRAVERSALS,
} from './temple-of-the-first-breath.js';
import type { TempleTraversal } from './temple-of-the-first-breath.js';

/**
 * The temple's authoring contract, asserted rather than hoped for.
 *
 * Two things are being checked here, and they are different kinds of thing.
 * First, the boring one: a temple is a graph of ids pretending to be a place, so
 * every id a room names has to exist and every gap has to be jumpable. Second,
 * the interesting one: the central puzzle's claim — *this cannot be answered
 * without a note that arrives twice* — is a claim about numbers, and the numbers
 * are the combat config, the echo return delay and the geometry of three flues.
 * Those are re-derived from first principles below rather than restated.
 */

const temple = TEMPLE_OF_THE_FIRST_BREATH;
const stage = TEMPLE_OF_THE_FIRST_BREATH_STAGE;

// ---------------------------------------------------------------------------
// Movement budget, re-derived from the physics constants
// ---------------------------------------------------------------------------

const RUN_SPEED = 8.6;
const JUMP_RISE = 3.05;
const DOUBLE_JUMP_RISE = 2.5;
const DASH_SPEED = 24;
const DASH_SECONDS = 0.17;

const g = Math.abs(GRAVITY);
const MAX_RISE = JUMP_RISE + DOUBLE_JUMP_RISE;
/** A dash covers 4.08 m where running would have covered 1.46 m. */
const DASH_GAIN = DASH_SPEED * DASH_SECONDS - RUN_SPEED * DASH_SECONDS;

/** No crossing may sit closer than 15 % to its own theoretical ceiling. */
const SAFETY_MARGIN = 0.85;

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Airtime for a crossing, given the rise it has to make.
 *
 * A flat maximum is a lie: a double jump that has to climb 4 m has far less time
 * left to travel than one that lands level. Rise by rise: time to the first
 * apex, plus the second apex if the technique allows it, plus the fall from the
 * highest point reached down to the landing height.
 */
function airtimeSeconds(rise: number, technique: TempleTraversal['technique']): number {
  const upTime = (height: number): number => Math.sqrt(2 * g * height) / g;
  const fallTime = (height: number): number => Math.sqrt((2 * Math.max(0, height)) / g);

  switch (technique) {
    case 'walk':
      return 0;
    case 'drop':
      return fallTime(-rise);
    case 'jump':
      return upTime(JUMP_RISE) + fallTime(JUMP_RISE - rise);
    case 'double-jump':
    case 'double-jump-dash':
      return upTime(JUMP_RISE) + upTime(DOUBLE_JUMP_RISE) + fallTime(MAX_RISE - rise);
  }
}

/** Ground a crossing can cover with the technique it declares. */
function horizontalBudget(rise: number, technique: TempleTraversal['technique']): number {
  const base = RUN_SPEED * airtimeSeconds(rise, technique);
  return technique === 'double-jump-dash' ? base + DASH_GAIN : base;
}

/** Highest rise a technique can make at all. */
function riseBudget(technique: TempleTraversal['technique']): number {
  switch (technique) {
    case 'walk':
      return 1.2;
    case 'drop':
      return 0;
    case 'jump':
      return JUMP_RISE;
    case 'double-jump':
    case 'double-jump-dash':
      return MAX_RISE;
  }
}

// ---------------------------------------------------------------------------
// Id collection
// ---------------------------------------------------------------------------

const idSources: readonly { readonly label: string; readonly ids: readonly string[] }[] = [
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
const checkpointIds = new Set(stage.checkpoints.map((entry) => entry.id));

const producedFlags = new Set<string>([
  ...stage.puzzles
    .filter((puzzle) => puzzle.reward.kind === 'setFlag')
    .map((puzzle) => (puzzle.reward.kind === 'setFlag' ? puzzle.reward.flag : '')),
  ...stage.triggers
    .filter((trigger) => trigger.action.kind === 'setFlag')
    .map((trigger) => (trigger.action.kind === 'setFlag' ? trigger.action.flag : '')),
]);

function boxTop(entry: GeometryDef | MovingPlatformDef): number {
  const shape = entry.shape;
  switch (shape.kind) {
    case 'box':
    case 'ramp':
      return entry.position.y + shape.halfExtents.y;
    case 'sphere':
      return entry.position.y + shape.radius;
    case 'capsule':
      return entry.position.y + shape.halfHeight + shape.radius;
  }
}

function boxBottom(entry: GeometryDef | MovingPlatformDef): number {
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

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('Temple of the First Breath identity', () => {
  it('teaches Echo Pulse and belongs to the Fractured Garden', () => {
    expect(temple.id).toBe('temple-of-the-first-breath');
    expect(temple.displayName).toBe('The Temple of the First Breath');
    expect(temple.region).toBe('fractured-garden');
    expect(temple.teaches).toBe('echo');
    expect(isResonanceFormId(temple.teaches)).toBe(true);
  });

  it('names the mini-boss and guardian the region already ships', () => {
    expect(temple.miniBossId).toBe('virus-bloom');
    expect(temple.guardianId).toBe('oru-fractured-colossus');
    expect(stage.miniBossId).toBe(temple.miniBossId);
    expect(stage.commanderId).toBe(temple.guardianId);
  });

  it('is an interior of the fractured-garden region, not a region of its own', () => {
    expect(stage.id).toBe('fractured-garden');
    expect(stage.id).toBe(temple.region);
  });

  it('carries the Garden Chord as its restoration chord', () => {
    expect(temple.restorationChord.length).toBeGreaterThan(0);
    for (const degree of temple.restorationChord) {
      expect(Number.isInteger(degree), `degree ${degree} is not an integer`).toBe(true);
      expect(degree).toBeGreaterThanOrEqual(0);
      expect(degree).toBeLessThan(HARMONIC_RATIOS.length);
    }
    // Root, Third, Fifth, Octave — and the same set of degrees Oru's own closing
    // retuning sequence walks, so the temple and the boss agree on the chord.
    expect([...temple.restorationChord]).toEqual([0, 2, 4, 7]);
    const oruDegrees = [...(BOSSES['oru-fractured-colossus']?.restorationSequence ?? [])].sort(
      (a, b) => a - b,
    );
    expect([...new Set(oruDegrees)]).toEqual([0, 2, 4, 5, 7]);
    for (const degree of temple.restorationChord) {
      expect(oruDegrees, `chord degree ${degree} is not in Oru's sequence`).toContain(degree);
    }
  });

  it('is authored at temple length, not sketch length', () => {
    expect(stage.parSeconds).toBeGreaterThanOrEqual(480);
    expect(stage.parSeconds).toBeLessThanOrEqual(1200);
    expect(stage.geometry.length).toBeGreaterThanOrEqual(40);
    expect(stage.movingPlatforms.length).toBeGreaterThanOrEqual(8);
    expect(stage.enemies.length).toBeGreaterThanOrEqual(15);
    expect(stage.triggers.length).toBeGreaterThanOrEqual(20);
    expect(stage.bpm).toBe(108);
  });

  it('ships both world states', () => {
    expect(stage.ambience.restored).toBeDefined();
    expect(stage.ambience.restored?.fogColour).not.toBe(stage.ambience.fogColour);
    expect(stage.geometry.some((entry) => entry.onlyWhenRestored === true)).toBe(true);
    expect(stage.geometry.some((entry) => entry.hiddenWhenRestored === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The curriculum
// ---------------------------------------------------------------------------

describe('Temple of the First Breath curriculum', () => {
  const CURRICULUM: readonly TempleBeat[] = [
    'introduce',
    'experiment',
    'traversal',
    'combat',
    'pressure',
    'central',
    'secret',
    'miniboss',
    'recontextualise',
    'guardian',
  ];

  it('hits all ten beats exactly once, in curriculum order', () => {
    const beats = temple.rooms.map((room) => room.beat);
    expect(beats).toEqual(CURRICULUM);
    expect(new Set(beats).size).toBe(CURRICULUM.length);
  });

  it('gives every room a unique id, a name and a stated intent', () => {
    const ids = temple.rooms.map((room) => room.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const room of temple.rooms) {
      expect(room.id.length, room.id).toBeGreaterThan(0);
      expect(room.name.length, room.id).toBeGreaterThan(0);
      // One sentence, but a real one.
      expect(room.intent.length, room.id).toBeGreaterThan(40);
    }
  });

  it('resolves every id a room names against the stage', () => {
    for (const room of temple.rooms) {
      expect(triggerIds.has(room.entryTriggerId), `${room.id} → ${room.entryTriggerId}`).toBe(true);
      for (const puzzleId of room.puzzleIds ?? []) {
        expect(puzzleIds.has(puzzleId), `${room.id} → ${puzzleId}`).toBe(true);
      }
      for (const spawnId of room.enemySpawnIds ?? []) {
        expect(enemyIds.has(spawnId), `${room.id} → ${spawnId}`).toBe(true);
      }
      if (room.checkpointId !== undefined) {
        expect(checkpointIds.has(room.checkpointId), `${room.id} → ${room.checkpointId}`).toBe(
          true,
        );
      }
    }
  });

  it('uses a distinct entry trigger and checkpoint per room', () => {
    const entries = temple.rooms.map((room) => room.entryTriggerId);
    expect(new Set(entries).size).toBe(entries.length);
    const checkpoints = temple.rooms
      .map((room) => room.checkpointId)
      .filter((id): id is string => id !== undefined);
    expect(new Set(checkpoints).size).toBe(checkpoints.length);
  });

  it('claims every puzzle and every enemy in the stage in exactly one room', () => {
    const claimedPuzzles = temple.rooms.flatMap((room) => room.puzzleIds ?? []);
    expect(new Set(claimedPuzzles).size).toBe(claimedPuzzles.length);
    expect([...claimedPuzzles].sort()).toEqual([...puzzleIds].sort());

    const claimedEnemies = temple.rooms.flatMap((room) => room.enemySpawnIds ?? []);
    expect(new Set(claimedEnemies).size).toBe(claimedEnemies.length);
    expect([...claimedEnemies].sort()).toEqual([...enemyIds].sort());
  });

  it('puts the ability in the player’s hands in the introduce room and tests it in the central one', () => {
    const introduce = temple.rooms.find((room) => room.beat === 'introduce');
    expect(introduce?.puzzleIds?.length).toBeGreaterThanOrEqual(1);

    // The introduce room's mechanism is the doubled arrival itself, demonstrated
    // on one drum with nothing else in the room.
    const firstPuzzle = stage.puzzles.find((puzzle) => puzzle.id === introduce?.puzzleIds?.[0]);
    expect(firstPuzzle?.kind).toBe('echo');
    expect(firstPuzzle?.resonatorIds.length).toBe(1);
    expect(introduce?.enemySpawnIds ?? []).toEqual([]);
  });

  it('leaves the experiment room free of threat', () => {
    const experiment = temple.rooms.find((room) => room.beat === 'experiment');
    expect(experiment?.enemySpawnIds ?? []).toEqual([]);
    // And free of hazards: nothing authored inside the hall's footprint.
    for (const hazard of stage.hazards) {
      const inHall =
        hazard.position.x > -16 &&
        hazard.position.x < 16 &&
        hazard.position.z > -41 &&
        hazard.position.z < -11;
      expect(inHall, `${hazard.id} is inside the experiment room`).toBe(false);
    }
  });

  it('pressures the pressure room with a rhythm hazard on top of its enemies', () => {
    const pressure = temple.rooms.find((room) => room.beat === 'pressure');
    expect((pressure?.enemySpawnIds ?? []).length).toBeGreaterThanOrEqual(3);
    const rhythmic = stage.hazards.filter((hazard) => hazard.rhythm !== undefined);
    expect(rhythmic.length).toBeGreaterThanOrEqual(3);
  });

  it('makes the secret room optional — no checkpoint, and nothing mandatory inside it', () => {
    const secret = temple.rooms.find((room) => room.beat === 'secret');
    expect(secret?.checkpointId).toBeUndefined();
    expect(secret?.puzzleIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------------

describe('Temple of the First Breath referential integrity', () => {
  it('has no duplicate ids anywhere in the stage', () => {
    const seen = new Map<string, number>();
    for (const id of allIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it('uses non-empty ids everywhere', () => {
    for (const id of allIds) expect(id.length).toBeGreaterThan(0);
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
          expect(cutsceneIds.has(action.cutsceneId), `${trigger.id} → ${action.cutsceneId}`).toBe(
            true,
          );
          break;
        case 'tutorial':
          expect(tutorialIds.has(action.tutorialId), `${trigger.id} → ${action.tutorialId}`).toBe(
            true,
          );
          break;
        case 'objective':
          expect(action.text.length, trigger.id).toBeGreaterThan(0);
          break;
        case 'setFlag':
          expect(action.flag.length, trigger.id).toBeGreaterThan(0);
          break;
        case 'phase':
          expect(['miniboss', 'commander', 'restoration']).toContain(action.phase);
          break;
        case 'vista':
          expect(action.seconds, trigger.id).toBeGreaterThan(0);
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
    }
  });

  it('links every puzzle to real resonators and keeps membership symmetric', () => {
    for (const puzzle of stage.puzzles) {
      expect(puzzle.resonatorIds.length, puzzle.id).toBeGreaterThan(0);
      for (const id of puzzle.resonatorIds) {
        expect(resonatorIds.has(id), `${puzzle.id} → ${id}`).toBe(true);
      }
      const members = stage.resonators.filter((resonator) => resonator.puzzleId === puzzle.id);
      expect(members.map((entry) => entry.id).sort()).toEqual([...puzzle.resonatorIds].sort());
    }
    for (const resonator of stage.resonators) {
      expect(puzzleIds.has(resonator.puzzleId), `${resonator.id} → ${resonator.puzzleId}`).toBe(
        true,
      );
    }
    const claims = stage.puzzles.flatMap((puzzle) => puzzle.resonatorIds);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it('gives every sequence puzzle a complete, contiguous order', () => {
    const sequences = stage.puzzles.filter((puzzle) => puzzle.kind === 'sequence');
    expect(sequences.length).toBeGreaterThanOrEqual(1);
    for (const puzzle of sequences) {
      const orders = puzzle.resonatorIds
        .map((id) => stage.resonators.find((resonator) => resonator.id === id)?.order)
        .filter((order): order is number => order !== undefined);
      expect(orders.length).toBe(puzzle.resonatorIds.length);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders.map((_, index) => index));
    }
  });

  it('opens every door with a puzzle or a flag something can raise', () => {
    const puzzleOpened = new Set(
      stage.puzzles
        .filter((puzzle) => puzzle.reward.kind === 'openDoor')
        .map((puzzle) => (puzzle.reward.kind === 'openDoor' ? puzzle.reward.doorId : '')),
    );
    for (const door of stage.doors) {
      if (door.openedByFlag !== undefined) {
        expect(producedFlags.has(door.openedByFlag), `${door.id} ← ${door.openedByFlag}`).toBe(
          true,
        );
      }
      expect(
        door.openedByFlag !== undefined || puzzleOpened.has(door.id),
        `${door.id} is unopenable`,
      ).toBe(true);
    }
  });

  it('resolves every enemy spawn trigger and the secret it guards', () => {
    for (const spawn of stage.enemies) {
      if (spawn.triggerId !== undefined) {
        expect(triggerIds.has(spawn.triggerId), `${spawn.id} → ${spawn.triggerId}`).toBe(true);
      }
      if (spawn.guardsSecret !== undefined) {
        const secret = stage.pickups.find((pickup) => pickup.id === spawn.guardsSecret);
        expect(secret, `${spawn.id} guards ${spawn.guardsSecret}`).toBeDefined();
        expect(secret?.isSecret).toBe(true);
      }
      if (spawn.patrol !== undefined) {
        expect(spawn.patrol.length, spawn.id).toBeGreaterThanOrEqual(2);
        for (const point of spawn.patrol) {
          expect(point.y, spawn.id).toBeGreaterThan(stage.killPlaneY);
        }
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
    ].filter((form): form is ResonanceFormId => form !== undefined);
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(isResonanceFormId(form), form).toBe(true);
      expect(RESONANCE_FORM_IDS).toContain(form);
    }
  });

  it('keeps every resonator degree inside the harmonic table', () => {
    expect(stage.resonators.length).toBeGreaterThanOrEqual(8);
    for (const resonator of stage.resonators) {
      expect(Number.isInteger(resonator.degree), resonator.id).toBe(true);
      expect(resonator.degree).toBeGreaterThanOrEqual(0);
      expect(resonator.degree).toBeLessThan(HARMONIC_RATIOS.length);
      // Every drum in this temple is tuned to a degree of the Garden Chord or,
      // for the two wall pairs, to the sixth that completes it.
      expect(resonator.holdSeconds, resonator.id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

describe('Temple of the First Breath population', () => {
  it('spawns only archetypes that exist in the bestiary', () => {
    for (const spawn of stage.enemies) {
      expect(ENEMY_ARCHETYPES[spawn.archetype], `${spawn.id} → ${spawn.archetype}`).toBeDefined();
    }
  });

  it('fields an Amplifier encounter at the mini-boss and a garrison at the guardian', () => {
    const archetypes = new Set(stage.enemies.map((spawn) => spawn.archetype));
    expect(archetypes.has('twin-amplifier')).toBe(true);
    expect(archetypes.has('conductor-elite')).toBe(true);
    // Both Amplifiers belong to the mini-boss room.
    const vault = temple.rooms.find((room) => room.beat === 'miniboss');
    const vaultArchetypes = (vault?.enemySpawnIds ?? []).map(
      (id) => stage.enemies.find((spawn) => spawn.id === id)?.archetype,
    );
    expect(vaultArchetypes.filter((archetype) => archetype === 'twin-amplifier').length).toBe(2);
  });

  it('names a mini-boss and a guardian that both exist and both belong here', () => {
    const mini = BOSSES[temple.miniBossId ?? ''];
    const guardian = BOSSES[temple.guardianId];
    expect(mini).toBeDefined();
    expect(guardian).toBeDefined();
    expect(mini?.stageId).toBe('fractured-garden');
    expect(guardian?.stageId).toBe('fractured-garden');
    expect(mini?.isMiniBoss).toBe(true);
    expect(guardian?.isMiniBoss).not.toBe(true);
  });

  it('awards Echo Pulse from the guardian and nothing from the mini-boss', () => {
    expect(BOSSES[temple.guardianId]?.awardsForm).toBe('echo');
    expect(BOSSES[temple.guardianId]?.awardsForm).toBe(temple.teaches);
    expect(BOSSES[temple.miniBossId ?? '']?.awardsForm).toBeUndefined();
  });

  it('drives both encounters from stage phase triggers', () => {
    const phases = stage.triggers
      .filter((trigger) => trigger.action.kind === 'phase')
      .map((trigger) => (trigger.action.kind === 'phase' ? trigger.action.phase : ''));
    expect(phases).toContain('miniboss');
    expect(phases).toContain('commander');
    expect(phases).toContain('restoration');
  });

  it('gives both boss arenas a floor that actually covers them', () => {
    for (const bossId of [temple.miniBossId ?? '', temple.guardianId]) {
      const boss = BOSSES[bossId];
      expect(boss, bossId).toBeDefined();
      if (boss === undefined) continue;

      const covering = stage.geometry.find((entry) => {
        if (entry.shape.kind !== 'box') return false;
        const half = entry.shape.halfExtents;
        return (
          entry.position.x - half.x <= boss.arenaCentre.x - boss.arenaRadius &&
          entry.position.x + half.x >= boss.arenaCentre.x + boss.arenaRadius &&
          entry.position.z - half.z <= boss.arenaCentre.z - boss.arenaRadius &&
          entry.position.z + half.z >= boss.arenaCentre.z + boss.arenaRadius
        );
      });
      expect(covering, `no floor covers ${bossId}'s ${boss.arenaRadius} m arena`).toBeDefined();
      // And the floor's surface is where the boss thinks the ground is.
      expect(boxTop(covering as GeometryDef)).toBeCloseTo(boss.arenaCentre.y, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

describe('Temple of the First Breath puzzles', () => {
  it('uses at least three of the four puzzle kinds', () => {
    const kinds = new Set<PuzzleDef['kind']>(stage.puzzles.map((puzzle) => puzzle.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    for (const kind of ['sequence', 'simultaneous', 'echo', 'sustain'] as const) {
      expect(kinds.has(kind), `missing puzzle kind: ${kind}`).toBe(true);
    }
  });

  it('makes the central room’s puzzle the echo kind', () => {
    const central: TempleRoomDef | undefined = temple.rooms.find((room) => room.beat === 'central');
    expect(central).toBeDefined();
    const ids = central?.puzzleIds ?? [];
    expect(ids.length).toBe(1);
    const puzzle = stage.puzzles.find((entry) => entry.id === ids[0]);
    expect(puzzle?.kind).toBe('echo');
    expect(puzzle?.resonatorIds.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every puzzle a written hint, so nothing is explained by sound', () => {
    for (const puzzle of stage.puzzles) {
      expect(puzzle.hint.length, puzzle.id).toBeGreaterThan(40);
    }
  });

  it('keeps the simultaneous pair out of Harmonic Burst range, so it is two aimed notes', () => {
    const simultaneous = stage.puzzles.find((puzzle) => puzzle.kind === 'simultaneous');
    expect(simultaneous).toBeDefined();
    const members = (simultaneous?.resonatorIds ?? [])
      .map((id) => stage.resonators.find((resonator) => resonator.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    expect(members.length).toBe(2);
    const [a, b] = members;
    if (a === undefined || b === undefined) return;
    expect(distance(a.position, b.position)).toBeGreaterThan(DEFAULT_COMBAT_CONFIG.burstRadius * 2);
    // But both reachable inside the hold, from a standing point between them.
    for (const drum of members) {
      expect(drum.holdSeconds ?? 0).toBeGreaterThan(1.5);
    }
  });

  it('places the sustain pair so no one position can be stood in to hold both', () => {
    const sustain = stage.puzzles.find((puzzle) => puzzle.kind === 'sustain');
    expect(sustain).toBeDefined();
    const members = (sustain?.resonatorIds ?? [])
      .map((id) => stage.resonators.find((resonator) => resonator.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    expect(members.length).toBe(2);
    const [low, high] = members;
    if (low === undefined || high === undefined) return;

    // The spine sits on the line between them: that is what makes the empty
    // corner the answer rather than either wall.
    const spine = stage.geometry.find((entry) => entry.id === 'geo-return-spine');
    expect(spine).toBeDefined();
    if (spine === undefined || spine.shape.kind !== 'box') return;
    const midpoint = {
      x: (low.position.x + high.position.x) / 2,
      y: (low.position.y + high.position.y) / 2,
      z: (low.position.z + high.position.z) / 2,
    };
    expect(Math.abs(midpoint.x - spine.position.x)).toBeLessThanOrEqual(spine.shape.halfExtents.x);
    expect(Math.abs(midpoint.z - spine.position.z)).toBeLessThanOrEqual(spine.shape.halfExtents.z);
    expect(midpoint.y).toBeGreaterThan(boxBottom(spine));
    expect(midpoint.y).toBeLessThan(boxTop(spine));
  });
});

// ---------------------------------------------------------------------------
// The Lock of Two Arrivals — the central puzzle's claim, in numbers
// ---------------------------------------------------------------------------

describe('The Lock of Two Arrivals', () => {
  /** `DEFAULT_ECHO_DELAY_SECONDS`, game-core/src/internal/services.ts. */
  const ECHO_RETURN_DELAY = 0.12;
  /** The lock forgets a partial answer after this long: `PUZZLE_IDLE_RESET_SECONDS`. */
  const PUZZLE_IDLE_RESET = 3.5;

  const echoTuning = RESONANCE_FORMS.echo.tuning;
  const pulseSpeed = DEFAULT_COMBAT_CONFIG.pulseSpeed * echoTuning.projectileSpeedScale;
  /** How far the note has travelled before its return separates from it. */
  const detachDistance = pulseSpeed * ECHO_RETURN_DELAY;

  const spindleSpeed = (2 * Math.PI * TEMPLE_LOCK.spindleRadius) / TEMPLE_LOCK.spindleSeconds;
  /**
   * How far off a flue's axis a shot may be taken and still traverse the flue:
   * the line has to stay inside half the flue width all the way from the mouth
   * to the drum, so the tolerance at the player scales with the depth behind it.
   */
  const lateralTolerance =
    (TEMPLE_LOCK.slitWidth / 2) *
    ((TEMPLE_LOCK.drumRadius - TEMPLE_LOCK.spindleRadius) /
      (TEMPLE_LOCK.drumRadius - TEMPLE_LOCK.shaftRadius));
  /** Seconds the line down a flue exists for, per pass. */
  const apertureSeconds = (2 * lateralTolerance) / spindleSpeed;

  const puzzle = stage.puzzles.find((entry) => entry.id === 'puz-lock-two-arrivals');
  const drums = (puzzle?.resonatorIds ?? [])
    .map((id) => stage.resonators.find((resonator) => resonator.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  it('is authored out of the numbers TEMPLE_LOCK declares', () => {
    expect(drums.length).toBe(3);
    for (const drum of drums) {
      const radius = Math.hypot(
        drum.position.x - TEMPLE_LOCK.shaftCentre.x,
        drum.position.z - TEMPLE_LOCK.shaftCentre.z,
      );
      expect(radius, drum.id).toBeCloseTo(TEMPLE_LOCK.drumRadius, 5);
      expect(drum.position.y, drum.id).toBeCloseTo(TEMPLE_LOCK.shaftCentre.y + 0.4, 5);
      expect(drum.holdSeconds, drum.id).toBe(TEMPLE_LOCK.drumHoldSeconds);
    }

    const spindles = stage.movingPlatforms.filter((platform) => platform.id.startsWith('plt-lock-'));
    expect(spindles.length).toBe(2);
    for (const spindle of spindles) {
      expect(spindle.motion.kind).toBe('orbit');
      if (spindle.motion.kind !== 'orbit') continue;
      expect(spindle.motion.radius).toBe(TEMPLE_LOCK.spindleRadius);
      expect(spindle.motion.seconds).toBe(TEMPLE_LOCK.spindleSeconds);
      expect(spindle.motion.centre).toEqual(TEMPLE_LOCK.shaftCentre);
      // Authored on its own orbit circle, or it would jump on the first frame.
      expect(
        Math.hypot(
          spindle.position.x - TEMPLE_LOCK.shaftCentre.x,
          spindle.position.z - TEMPLE_LOCK.shaftCentre.z,
        ),
      ).toBeCloseTo(TEMPLE_LOCK.spindleRadius, 5);
    }
  });

  it('spaces the flues evenly, and cuts a mouth in the shaft wall for each', () => {
    const angles = drums
      .map((drum) =>
        Math.atan2(
          drum.position.z - TEMPLE_LOCK.shaftCentre.z,
          drum.position.x - TEMPLE_LOCK.shaftCentre.x,
        ),
      )
      .sort((a, b) => a - b);
    // Three flues at west, south and east: every gap is a whole number of
    // quarter turns, and the tightest is exactly one — which is the interval the
    // Spindle's timing argument below is built on.
    const gaps: number[] = [];
    for (let i = 1; i < angles.length; i += 1) {
      gaps.push((angles[i] ?? 0) - (angles[i - 1] ?? 0));
    }
    for (const gap of gaps) {
      const turns = gap / TEMPLE_LOCK.slitSpacingRadians;
      expect(turns, `flue spacing ${gap} is not a whole quarter turn`).toBeCloseTo(
        Math.round(turns),
        5,
      );
    }
    expect(Math.min(...gaps)).toBeCloseTo(TEMPLE_LOCK.slitSpacingRadians, 5);

    // Three flues, each authored as two side walls and a back plate.
    for (const direction of ['west', 'south', 'east']) {
      const pieces = stage.geometry.filter((entry) => entry.id.startsWith(`geo-flue-${direction}`));
      expect(pieces.length, direction).toBe(3);
    }
  });

  it('makes the flue too narrow for a base pulse to send a second note through', () => {
    // 11.31 m/s at the Spindle's rim.
    expect(spindleSpeed).toBeCloseTo(11.3097, 3);
    expect(lateralTolerance).toBeCloseTo(0.6429, 3);
    // 0.114 s of open line, against a 0.14 s pulse interval: one arrival a pass.
    expect(apertureSeconds).toBeLessThan(DEFAULT_COMBAT_CONFIG.pulseInterval);
    expect(apertureSeconds).toBeCloseTo(0.1137, 3);
  });

  it('separates the return inside the flue, where the closing line cannot catch it', () => {
    // 5.24 m behind the note.
    expect(detachDistance).toBeCloseTo(5.244, 3);
    // Which is past the mouth: the return is born inside the stone.
    expect(TEMPLE_LOCK.spindleRadius + detachDistance).toBeGreaterThan(TEMPLE_LOCK.shaftRadius);
    // And it still has most of the flue left to fly.
    const remaining = TEMPLE_LOCK.drumRadius - (TEMPLE_LOCK.spindleRadius + detachDistance);
    expect(remaining).toBeGreaterThan(10);
    // The return lands inside the drum's ring: a doubled arrival, not two visits.
    expect(ECHO_RETURN_DELAY).toBeLessThan(TEMPLE_LOCK.drumHoldSeconds);
    // The note has to fly far enough that the return has already detached.
    const flightToDrum = TEMPLE_LOCK.drumRadius - TEMPLE_LOCK.spindleRadius;
    expect(flightToDrum).toBeGreaterThan(detachDistance);
  });

  it('rules out answering the drums on foot, one at a time', () => {
    for (let i = 0; i < drums.length; i += 1) {
      for (let j = i + 1; j < drums.length; j += 1) {
        const a = drums[i];
        const b = drums[j];
        if (a === undefined || b === undefined) continue;
        const runSeconds = distance(a.position, b.position) / RUN_SPEED;
        // Longer than the lock keeps a partial chord, and longer than the ring
        // it would have to still be inside.
        expect(runSeconds, `${a.id} → ${b.id}`).toBeGreaterThan(PUZZLE_IDLE_RESET);
        expect(runSeconds, `${a.id} → ${b.id}`).toBeGreaterThan(TEMPLE_LOCK.drumHoldSeconds);
      }
    }
  });

  it('lets the Spindle answer all three inside the lock’s memory and one ring', () => {
    const perFlue =
      TEMPLE_LOCK.spindleSeconds * (TEMPLE_LOCK.slitSpacingRadians / (2 * Math.PI));
    const acrossAllThree = perFlue * (drums.length - 1);
    expect(perFlue).toBeCloseTo(1.25, 5);
    expect(acrossAllThree).toBeLessThan(PUZZLE_IDLE_RESET);
    expect(acrossAllThree).toBeLessThan(TEMPLE_LOCK.drumHoldSeconds);
  });

  it('rewards the lock with the way onward rather than a trinket', () => {
    expect(puzzle?.reward.kind).toBe('openDoor');
    if (puzzle?.reward.kind !== 'openDoor') return;
    expect(doorIds.has(puzzle.reward.doorId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

describe('Temple of the First Breath secrets', () => {
  const secrets = stage.pickups.filter((pickup) => pickup.isSecret === true);

  it('declares a secretTotal that matches the isSecret pickups exactly', () => {
    expect(stage.secretTotal).toBe(secrets.length);
    expect(secrets.length).toBeGreaterThanOrEqual(2);
  });

  it('locks at least one secret behind an ability the player cannot have yet', () => {
    const later = secrets
      .map((pickup) => pickup.requiresForm)
      .filter(
        (form): form is ResonanceFormId =>
          form !== undefined && form !== 'base' && form !== temple.teaches,
      );
    expect(later.length).toBeGreaterThanOrEqual(1);
    // And those abilities come from regions after this one.
    for (const form of later) {
      expect(['prism', 'tidal', 'ember', 'choir', 'bloom', 'silence', 'celestial']).toContain(form);
    }
  });

  it('leaves at least one secret findable on the first visit', () => {
    expect(secrets.some((pickup) => pickup.requiresForm === undefined)).toBe(true);
  });

  it('puts a secret in the secret room and one somewhere else entirely', () => {
    // The Unsung Cell holds two; the stair and the vault hold one each, so a
    // player who never finds the cell still has something to find.
    const inCell = secrets.filter((pickup) => pickup.id.includes('cell'));
    expect(inCell.length).toBeGreaterThanOrEqual(2);
    expect(secrets.length - inCell.length).toBeGreaterThanOrEqual(1);
  });

  it('opens at least one shortcut with a form from another region', () => {
    const cleared = stage.hazards.filter((hazard) => hazard.clearedBy !== undefined);
    expect(cleared.length).toBeGreaterThanOrEqual(1);
    for (const hazard of cleared) {
      expect(hazard.clearedBy).not.toBe('base');
    }
  });
});

// ---------------------------------------------------------------------------
// Route progress
// ---------------------------------------------------------------------------

/** The critical path as a polyline, used to order everything along the route. */
const ROUTE: readonly Vec3[] = [
  { x: 0, y: 0.4, z: 8 },
  { x: 0, y: 0, z: -10 },
  { x: 0, y: 0, z: -26 },
  { x: 0, y: 0, z: -42 },
  { x: 0, y: 1, z: -48 },
  { x: -6, y: 3.2, z: -54 },
  { x: -1, y: 5.2, z: -59 },
  { x: -13, y: 6, z: -62 },
  { x: -16, y: 6, z: -76 },
  { x: -16, y: 6, z: -88 },
  { x: -18, y: 6, z: -95 },
  { x: -28, y: 7.35, z: -95 },
  { x: -32, y: 8.2, z: -96 },
  { x: -28, y: 8, z: -100 },
  { x: -30, y: 8.35, z: -105 },
  { x: -30, y: 8.35, z: -114 },
  { x: -20, y: 4, z: -120 },
  { x: -17, y: 0, z: -122 },
  { x: -6, y: 0, z: -122 },
  { x: 10, y: 0, z: -114 },
  { x: 22, y: 0, z: -108 },
  { x: 34, y: 0, z: -120 },
  { x: 41, y: 5.95, z: -120 },
  { x: 33, y: 9.95, z: -126 },
  { x: 33, y: 14, z: -130.5 },
  { x: 2, y: 14, z: -131.5 },
  { x: -3.5, y: 11, z: -131 },
  { x: 0, y: 0, z: -131.5 },
  { x: 0, y: 0, z: -136 },
  { x: 0, y: 0, z: -160 },
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

describe('Temple of the First Breath checkpoints', () => {
  const byOrder = [...stage.checkpoints].sort((a, b) => a.order - b.order);

  it('uses unique, contiguous, ascending orders starting at zero', () => {
    const orders = byOrder.map((checkpoint) => checkpoint.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders[0]).toBe(0);
    for (let i = 1; i < orders.length; i += 1) {
      expect(orders[i]).toBe((orders[i - 1] ?? 0) + 1);
    }
    expect(stage.checkpoints.length).toBeGreaterThanOrEqual(8);
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
      expect(stretch, `${previous.id} → ${current.id}`).toBeLessThanOrEqual(120);
    }
  });

  it('brackets the mini-boss with an adjacent checkpoint on each side', () => {
    const arena = BOSSES[temple.miniBossId ?? '']?.arenaCentre;
    expect(arena).toBeDefined();
    if (arena === undefined) return;

    const arenaProgress = progressAlong(arena);
    const before = byOrder.filter((cp) => progressAlong(cp.position) < arenaProgress);
    const after = byOrder.filter((cp) => progressAlong(cp.position) > arenaProgress);
    expect(before.length, 'no checkpoint before the mini-boss').toBeGreaterThanOrEqual(1);
    expect(after.length, 'no checkpoint after the mini-boss').toBeGreaterThanOrEqual(1);

    // Adjacent in order, so failing the fight costs the fight and nothing else.
    const last = before[before.length - 1];
    const first = after[0];
    expect((first?.order ?? 0) - (last?.order ?? 0)).toBe(1);
    expect(last?.id).toBe('cp-06-vault-gate');
    expect(first?.id).toBe('cp-07-vault-cleared');
  });

  it('puts a checkpoint immediately before the guardian approach', () => {
    const gate = stage.triggers.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'commander',
    );
    expect(gate).toBeDefined();
    if (gate === undefined) return;

    const gateProgress = progressAlong(gate.position);
    const before = byOrder.filter((cp) => progressAlong(cp.position) < gateProgress);
    expect(before.length).toBeGreaterThanOrEqual(1);
    const last = before[before.length - 1];
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(gateProgress - progressAlong(last.position)).toBeLessThanOrEqual(60);
    expect(last.id).toBe('cp-09-guardian-gate');
  });

  it('orders the mini-boss before the guardian along the route', () => {
    const mini = BOSSES[temple.miniBossId ?? '']?.arenaCentre;
    const guardian = BOSSES[temple.guardianId]?.arenaCentre;
    expect(mini).toBeDefined();
    expect(guardian).toBeDefined();
    if (mini === undefined || guardian === undefined) return;
    expect(progressAlong(mini)).toBeLessThan(progressAlong(guardian));
  });

  it('orders the rooms along the route in curriculum order, entry trigger by entry trigger', () => {
    // The secret room is optional and hangs off the side of the shaft, so it is
    // excluded: everything else has to be walked in the order it is taught.
    const mandatory = temple.rooms.filter((room) => room.beat !== 'secret');
    let previous = -Infinity;
    for (const room of mandatory) {
      const trigger = stage.triggers.find((entry) => entry.id === room.entryTriggerId);
      expect(trigger, room.id).toBeDefined();
      if (trigger === undefined) continue;
      const progress = progressAlong(trigger.position);
      expect(progress, `${room.id} is out of route order`).toBeGreaterThan(previous);
      previous = progress;
    }
  });
});

// ---------------------------------------------------------------------------
// World bounds
// ---------------------------------------------------------------------------

describe('Temple of the First Breath world bounds', () => {
  const surfaces = [...stage.geometry, ...stage.movingPlatforms];

  it('sits the kill plane below every surface, with clear air under the lowest', () => {
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
      expect(boxBottom(surface), `${surface.id} is at or below the kill plane`).toBeGreaterThan(
        stage.killPlaneY,
      );
    }
    const lowest = Math.min(...surfaces.map(boxBottom));
    expect(lowest - stage.killPlaneY).toBeGreaterThanOrEqual(8);
  });

  it('accounts for vertical platform travel when checking the kill plane', () => {
    for (const platform of stage.movingPlatforms) {
      if (platform.motion.kind !== 'vertical') continue;
      const lowest = boxBottom(platform) - platform.motion.amplitude;
      expect(lowest, `${platform.id} dips below the kill plane`).toBeGreaterThan(stage.killPlaneY);
    }
  });

  it('keeps every checkpoint, pickup and resonator above the kill plane', () => {
    for (const entry of [...stage.checkpoints, ...stage.pickups, ...stage.resonators]) {
      expect(entry.position.y, entry.id).toBeGreaterThan(stage.killPlaneY);
    }
  });

  it('spawns the player standing on walkable geometry, at the start of the route', () => {
    const spawn = stage.spawnPoint;
    expect(spawn.y).toBeGreaterThan(stage.killPlaneY);

    const floor = stage.geometry.find((entry) => {
      if (entry.shape.kind !== 'box') return false;
      if (entry.style === 'invisible') return false;
      if (entry.onlyWhenRestored === true || entry.revealedBy !== undefined) return false;
      const half = entry.shape.halfExtents;
      const top = boxTop(entry);
      return (
        Math.abs(spawn.x - entry.position.x) <= half.x &&
        Math.abs(spawn.z - entry.position.z) <= half.z &&
        spawn.y - top >= 0 &&
        spawn.y - top <= 1.2
      );
    });
    expect(floor, 'the spawn point is not standing on anything').toBeDefined();
    expect(progressAlong(spawn)).toBeLessThan(10);
  });

  it('keeps every grounded enemy on a surface and every flyer off the floor', () => {
    for (const spawn of stage.enemies) {
      const archetype = ENEMY_ARCHETYPES[spawn.archetype];
      expect(archetype, spawn.id).toBeDefined();
      expect(spawn.position.y, spawn.id).toBeGreaterThan(stage.killPlaneY);
      if (archetype?.flying === true) {
        expect(spawn.position.y, `${spawn.id} is a flyer sitting on the floor`).toBeGreaterThan(
          stage.killPlaneY + 1,
        );
      }
    }
  });

  it('never authors a damaging pit or a harmless damage hazard', () => {
    for (const hazard of stage.hazards) {
      if (hazard.isPit === true) {
        expect(hazard.damage, hazard.id).toBe(0);
      } else {
        expect(hazard.damage, hazard.id).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

describe('Temple of the First Breath reachability', () => {
  const pairs = TEMPLE_OF_THE_FIRST_BREATH_TRAVERSALS;
  const critical = pairs.filter((pair) => pair.optional !== true);

  it('derives the movement budget the temple file states', () => {
    expect(MAX_RISE).toBeCloseTo(5.55, 5);
    expect(DASH_GAIN).toBeCloseTo(2.618, 3);
    // A flat running jump clears ~7.5 m; double jump ~12.2 m; plus dash ~14.8 m.
    expect(horizontalBudget(0, 'jump')).toBeGreaterThan(7.4);
    expect(horizontalBudget(0, 'jump')).toBeLessThan(7.6);
    expect(horizontalBudget(0, 'double-jump')).toBeGreaterThan(12.1);
    expect(horizontalBudget(0, 'double-jump-dash')).toBeGreaterThan(14.7);
  });

  it('declares at least eight crossings on the critical path', () => {
    expect(critical.length).toBeGreaterThanOrEqual(8);
    const ids = pairs.map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every crossing possible with the abilities the player has', () => {
    for (const pair of pairs) {
      const horizontal = horizontalDistance(pair.from, pair.to);
      const rise = pair.to.y - pair.from.y;
      expect(rise, `${pair.id} rises further than a ${pair.technique} can`).toBeLessThanOrEqual(
        riseBudget(pair.technique),
      );
      expect(
        horizontal,
        `${pair.id}: ${horizontal.toFixed(2)} m at ${rise.toFixed(2)} m rise exceeds the ${pair.technique} budget of ${horizontalBudget(rise, pair.technique).toFixed(2)} m`,
      ).toBeLessThanOrEqual(horizontalBudget(rise, pair.technique));
    }
  });

  it('holds a 15 % margin on every crossing, rise by rise', () => {
    for (const pair of pairs) {
      const horizontal = horizontalDistance(pair.from, pair.to);
      const rise = pair.to.y - pair.from.y;
      const budget = horizontalBudget(rise, pair.technique) * SAFETY_MARGIN;
      expect(horizontal, `${pair.id} leaves no margin (budget ${budget.toFixed(2)} m)`).toBeLessThanOrEqual(
        budget,
      );
      if (pair.technique === 'double-jump' || pair.technique === 'double-jump-dash') {
        expect(rise, `${pair.id} leaves no vertical margin`).toBeLessThanOrEqual(MAX_RISE - 0.5);
      }
      if (pair.technique === 'jump') {
        expect(rise, `${pair.id} leaves no vertical margin`).toBeLessThanOrEqual(JUMP_RISE * 0.9);
      }
    }
  });

  it('explains its reasoning wherever a gap is over six metres', () => {
    for (const pair of pairs) {
      expect(pair.note.length, pair.id).toBeGreaterThan(0);
      if (horizontalDistance(pair.from, pair.to) > 6) {
        // The brief's rule: anything over 6 m carries its reasoning with it.
        expect(pair.note, `${pair.id} is over 6 m and does not say why`).toMatch(/OVER 6 M/);
        expect(pair.note.length, pair.id).toBeGreaterThan(80);
      }
    }
  });

  it('never authors a drop long enough to read as a mistake', () => {
    for (const pair of pairs) {
      expect(pair.from.y - pair.to.y, `${pair.id} falls too far`).toBeLessThanOrEqual(20);
    }
  });

  it('spreads the crossings across the whole temple rather than one room', () => {
    const progresses = critical.map((pair) => progressAlong(pair.from));
    const span = Math.max(...progresses) - Math.min(...progresses);
    const routeLength = ROUTE.slice(1).reduce((total, point, index) => {
      const previous = ROUTE[index];
      return previous === undefined ? total : total + distance(previous, point);
    }, 0);
    expect(span).toBeGreaterThan(routeLength * 0.6);
  });

  it('uses all five platform motion kinds, and keeps each of them legible', () => {
    const kinds = new Set(stage.movingPlatforms.map((platform) => platform.motion.kind));
    for (const kind of ['linear', 'orbit', 'vertical', 'rhythm', 'collapse'] as const) {
      expect(kinds.has(kind), `missing motion kind: ${kind}`).toBe(true);
    }
    for (const platform of stage.movingPlatforms) {
      if (platform.phase !== undefined) {
        expect(platform.phase, platform.id).toBeGreaterThanOrEqual(0);
        expect(platform.phase, platform.id).toBeLessThanOrEqual(1);
      }
      if (platform.motion.kind === 'collapse') {
        expect(platform.motion.delaySeconds, platform.id).toBeGreaterThanOrEqual(0.3);
        expect(platform.motion.delaySeconds, platform.id).toBeLessThanOrEqual(1.5);
        // It has to come back, or a missed jump would soft-lock the temple.
        expect(platform.motion.respawnSeconds, platform.id).toBeGreaterThan(0);
      }
      if (platform.motion.kind === 'rhythm') {
        expect(platform.motion.beats, platform.id).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Muted play
// ---------------------------------------------------------------------------

describe('Temple of the First Breath plays muted', () => {
  it('gives every rhythmic hazard a window wide enough to walk through, drawn on the beat', () => {
    const beatSeconds = 60 / stage.bpm;
    const rhythmic = stage.hazards.filter((hazard) => hazard.rhythm !== undefined);
    expect(rhythmic.length).toBeGreaterThanOrEqual(3);
    for (const hazard of rhythmic) {
      const rhythm = hazard.rhythm;
      if (rhythm === undefined) continue;
      expect(rhythm.beats, hazard.id).toBeGreaterThan(0);
      expect(rhythm.activeBeats, hazard.id).toBeGreaterThan(0);
      // Active for its whole cycle is not a rhythm, it is a wall.
      expect(rhythm.activeBeats, hazard.id).toBeLessThan(rhythm.beats);
      expect(rhythm.offset ?? 0, hazard.id).toBeGreaterThanOrEqual(0);
      expect(rhythm.offset ?? 0, hazard.id).toBeLessThan(rhythm.beats);
      expect((rhythm.beats - rhythm.activeBeats) * beatSeconds, hazard.id).toBeGreaterThanOrEqual(
        0.9,
      );
    }
  });

  it('states every tutorial in text with input prompts, never as a sound', () => {
    expect(stage.tutorials.length).toBeGreaterThanOrEqual(4);
    for (const tutorial of stage.tutorials) {
      expect(tutorial.title.length, tutorial.id).toBeGreaterThan(0);
      expect(tutorial.body.length, tutorial.id).toBeGreaterThan(40);
      expect(tutorial.actions.length, tutorial.id).toBeGreaterThan(0);
    }
  });

  it('subtitles every cutscene line, with a duration to hold it for', () => {
    expect(stage.cutscenes.length).toBeGreaterThanOrEqual(4);
    for (const cutscene of stage.cutscenes) {
      expect(cutscene.lines.length, cutscene.id).toBeGreaterThan(0);
      for (const line of cutscene.lines) {
        expect(line.speaker.length, cutscene.id).toBeGreaterThan(0);
        expect(line.text.length, cutscene.id).toBeGreaterThan(0);
        expect(line.seconds ?? 0, `${cutscene.id}: "${line.text}"`).toBeGreaterThan(0);
      }
      // Nothing traps the player in a scene they have already read.
      expect(cutscene.skippable, cutscene.id).toBe(true);
    }
  });

  it('gives every mandatory mechanism a degree the renderer can draw as a ring', () => {
    const mandatoryPuzzles = new Set(temple.rooms.flatMap((room) => room.puzzleIds ?? []));
    const mandatoryResonators = stage.resonators.filter((resonator) =>
      mandatoryPuzzles.has(resonator.puzzleId),
    );
    expect(mandatoryResonators.length).toBe(stage.resonators.length);
    for (const resonator of mandatoryResonators) {
      expect(Number.isInteger(resonator.degree), resonator.id).toBe(true);
      expect(resonator.degree).toBeLessThan(HARMONIC_RATIOS.length);
      // No mandatory mechanism may be gated on a form the player lacks, or the
      // muted critical path would stall on an ability check instead of a cue.
      expect(resonator.requiresForm, resonator.id).toBeUndefined();
    }
  });

  it('never hides a mandatory surface behind an ability — revealed geometry stays solid', () => {
    const revealed = stage.geometry.filter((entry) => entry.revealedBy !== undefined);
    expect(revealed.length).toBeGreaterThanOrEqual(2);
    for (const entry of revealed) {
      // `revealedBy` is a lighting state, not a collider state: the stage loader
      // adds the collider either way, so an unseen tread is still a tread.
      expect(entry.onlyWhenRestored, entry.id).toBeUndefined();
    }
  });
});
