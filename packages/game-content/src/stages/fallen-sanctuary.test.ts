import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  COLLECTIBLE_KINDS,
  DAMAGE_KINDS,
  DIFFICULTY_IDS,
  HARMONIC_RATIOS,
  RESONANCE_FORM_IDS,
} from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import { Layer } from '@tuner/physics';
import type { ColliderShape } from '@tuner/physics';
import type { GeometryDef } from '@tuner/game-core';

import { FALLEN_SANCTUARY } from './fallen-sanctuary.js';

/**
 * Validation for the introductory stage.
 *
 * Two kinds of assertion live here. The first kind is structural: no dangling
 * references, no duplicate ids, no pickup counted twice. The second kind is
 * about whether the level can actually be *played* — the kill plane, the spawn
 * point, the checkpoint chain, and above all the gaps, which are measured
 * against the same movement budget the stage's comments quote.
 */

const STAGE = FALLEN_SANCTUARY;

// ---------------------------------------------------------------------------
// Movement budget, derived from DEFAULT_MOVEMENT_CONFIG. See the long comment
// at the head of fallen-sanctuary.ts for the arithmetic.
// ---------------------------------------------------------------------------

/** 0.800 s of airtime on a flat single jump at the 8.6 m/s run speed. */
const SINGLE_JUMP_REACH = 6.87;
/** ~1.25 s of airtime once the second jump is spent well. */
const DOUBLE_JUMP_REACH = 10.7;
/** Jump, then a flat 0.17 s air dash, then the second jump. */
const DASH_CHAIN_REACH = 14.7;

// ---------------------------------------------------------------------------
// Optional sibling content tables.
//
// `ENEMY_ARCHETYPES` and `BOSSES` are authored by other modules in this
// package, which may not have landed in the working tree yet. Resolve them
// opportunistically: when they exist the spawn ids are checked against the real
// table, and when they do not the stage is checked against the archetype
// contract it depends on, so the expectation is never vacuous.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));

async function loadTable(
  relativePaths: readonly string[],
  exportName: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  for (const relativePath of relativePaths) {
    const absolute = resolve(HERE, relativePath);
    if (!existsSync(absolute)) continue;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(/* @vite-ignore */ absolute)) as Record<string, unknown>;
    } catch {
      continue;
    }
    const table = mod[exportName];
    if (table !== null && typeof table === 'object') {
      return table as Readonly<Record<string, unknown>>;
    }
  }
  return null;
}

const ENEMY_ARCHETYPES = await loadTable(
  ['../enemies.ts', '../enemies/index.ts', '../enemies/archetypes.ts', '../index.ts'],
  'ENEMY_ARCHETYPES',
);

const BOSSES = await loadTable(
  ['../bosses.ts', '../bosses/index.ts', '../bosses/bosses.ts', '../index.ts'],
  'BOSSES',
);

/** The Detuner families this stage is built around. */
const REQUIRED_ARCHETYPE_IDS = ['amplifier', 'drifter', 'fracture', 'whisperer'];
const REQUIRED_MINI_BOSS_ID = 'sanctuary-guardian';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Half-size of a shape along X — enough to project any collider onto the run. */
function halfX(shape: ColliderShape): number {
  switch (shape.kind) {
    case 'box':
    case 'ramp':
      return shape.halfExtents.x;
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.radius;
  }
}

/** Lowest world-space point a collider occupies. */
function lowestY(shape: ColliderShape, position: Readonly<Vec3>): number {
  switch (shape.kind) {
    case 'box':
    case 'ramp':
      return position.y - shape.halfExtents.y;
    case 'sphere':
      return position.y - shape.radius;
    case 'capsule':
      return position.y - (shape.halfHeight + shape.radius);
  }
}

interface Footprint {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly topY: number;
}

/**
 * Axis-aligned top surface of a box, or null for anything that is not a plain
 * unrotated box. Every floor in this stage is a plain unrotated box precisely
 * so that "is there ground under this point?" is answerable by a test.
 */
function footprint(geometry: GeometryDef): Footprint | null {
  if (geometry.shape.kind !== 'box') return null;
  if (geometry.yaw !== undefined && geometry.yaw !== 0) return null;
  const half = geometry.shape.halfExtents;
  return {
    id: geometry.id,
    minX: geometry.position.x - half.x,
    maxX: geometry.position.x + half.x,
    minZ: geometry.position.z - half.z,
    maxZ: geometry.position.z + half.z,
    topY: geometry.position.y + half.y,
  };
}

/** Highest surface directly beneath `point`, ignoring anything above it. */
function groundBeneath(point: Readonly<Vec3>, surfaces: readonly GeometryDef[]): Footprint | null {
  let best: Footprint | null = null;
  for (const surface of surfaces) {
    const box = footprint(surface);
    if (box === null) continue;
    if (point.x < box.minX || point.x > box.maxX) continue;
    if (point.z < box.minZ || point.z > box.maxZ) continue;
    if (box.topY > point.y) continue;
    if (best === null || box.topY > best.topY) best = box;
  }
  return best;
}

/** Everything solid on a first visit: no form-gated or restoration-only pieces. */
const FIRST_VISIT_SURFACES: readonly GeometryDef[] = [
  ...STAGE.geometry,
  ...STAGE.movingPlatforms,
].filter(
  (piece) =>
    piece.revealedBy === undefined &&
    piece.onlyWhenRestored !== true &&
    piece.layer !== Layer.Hazard,
);

interface Gap {
  readonly from: number;
  readonly to: number;
  readonly size: number;
}

/**
 * Projects every first-visit collider onto the X axis, merges the intervals,
 * and returns the holes. Coarse by construction — it does not know about Z — but
 * it is exactly the right instrument for "is any part of the run wider than the
 * abilities the player owns at that point?".
 */
function forwardGaps(): readonly Gap[] {
  const spans = FIRST_VISIT_SURFACES.map((piece) => ({
    min: piece.position.x - halfX(piece.shape),
    max: piece.position.x + halfX(piece.shape),
  })).sort((a, b) => a.min - b.min);

  const gaps: Gap[] = [];
  let reach = Number.NEGATIVE_INFINITY;
  for (const span of spans) {
    if (reach !== Number.NEGATIVE_INFINITY && span.min > reach) {
      gaps.push({ from: reach, to: span.min, size: span.min - reach });
    }
    if (span.max > reach) reach = span.max;
  }
  return gaps;
}

/** Eastern edge of the trigger that teaches `tutorialId`. */
function tutorialTaughtByX(tutorialId: string): number {
  const trigger = STAGE.triggers.find(
    (candidate) =>
      candidate.action.kind === 'tutorial' && candidate.action.tutorialId === tutorialId,
  );
  if (trigger === undefined) throw new Error(`no trigger teaches ${tutorialId}`);
  return trigger.position.x + halfX(trigger.shape);
}

/** Every authored id in the stage, in one flat list. */
function allIds(): readonly { readonly kind: string; readonly id: string }[] {
  const tag = (kind: string, ids: readonly { readonly id: string }[]) =>
    ids.map((entry) => ({ kind, id: entry.id }));
  return [
    ...tag('geometry', STAGE.geometry),
    ...tag('movingPlatform', STAGE.movingPlatforms),
    ...tag('rail', STAGE.rails),
    ...tag('hazard', STAGE.hazards),
    ...tag('enemy', STAGE.enemies),
    ...tag('pickup', STAGE.pickups),
    ...tag('resonator', STAGE.resonators),
    ...tag('puzzle', STAGE.puzzles),
    ...tag('door', STAGE.doors),
    ...tag('trigger', STAGE.triggers),
    ...tag('checkpoint', STAGE.checkpoints),
    ...tag('cutscene', STAGE.cutscenes),
    ...tag('tutorial', STAGE.tutorials),
    ...tag('prop', STAGE.props ?? []),
  ];
}

const ID_SET = new Set(allIds().map((entry) => entry.id));

// ---------------------------------------------------------------------------

describe('FALLEN_SANCTUARY — identity and tuning', () => {
  it('is the fallen-sanctuary stage', () => {
    expect(STAGE.id).toBe('fallen-sanctuary');
    expect(STAGE.displayName.length).toBeGreaterThan(0);
    expect(STAGE.subtitle.length).toBeGreaterThan(0);
    expect(STAGE.description.length).toBeGreaterThan(40);
  });

  it('has a ceremonial tempo and a realistic first-clear target', () => {
    expect(STAGE.bpm).toBeGreaterThanOrEqual(96);
    expect(STAGE.bpm).toBeLessThanOrEqual(112);
    expect(STAGE.parSeconds).toBeGreaterThan(120);
    expect(STAGE.parSeconds).toBeLessThan(900);
  });

  it('starts partly infected but not lost', () => {
    expect(STAGE.infection).toBeGreaterThan(0);
    expect(STAGE.infection).toBeLessThan(1);
  });

  it('sets an infected-dawn ambience and a restored variant', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    const { ambience } = STAGE;
    for (const colour of [
      ambience.skyTop,
      ambience.skyBottom,
      ambience.fogColour,
      ambience.sunColour,
      ambience.ambientColour,
    ]) {
      expect(colour).toMatch(hex);
    }
    expect(ambience.fogNear).toBeLessThan(ambience.fogFar);
    expect(ambience.sunDirection.y).toBeLessThan(0);

    const restored = ambience.restored;
    expect(restored).toBeDefined();
    if (restored === undefined) return;
    for (const colour of [
      restored.skyTop,
      restored.skyBottom,
      restored.fogColour,
      restored.sunColour,
      restored.ambientColour,
    ]) {
      expect(colour).toMatch(hex);
    }
    // The restoration palette must actually differ from the infected one.
    expect(restored.ambientColour).not.toBe(ambience.ambientColour);
  });
});

describe('FALLEN_SANCTUARY — referential integrity', () => {
  it('has no duplicate ids anywhere in the stage', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const entry of allIds()) {
      const previous = seen.get(entry.id);
      if (previous !== undefined) {
        duplicates.push(`${entry.id} (${previous} and ${entry.kind})`);
      } else {
        seen.set(entry.id, entry.kind);
      }
    }
    expect(duplicates).toEqual([]);
    expect(seen.size).toBe(allIds().length);
  });

  it('resolves every id a trigger refers to', () => {
    const tutorialIds = new Set(STAGE.tutorials.map((entry) => entry.id));
    const cutsceneIds = new Set(STAGE.cutscenes.map((entry) => entry.id));
    const spawnIds = new Set(STAGE.enemies.map((entry) => entry.id));

    let checked = 0;
    for (const trigger of STAGE.triggers) {
      const action = trigger.action;
      switch (action.kind) {
        case 'tutorial':
          expect(tutorialIds).toContain(action.tutorialId);
          checked += 1;
          break;
        case 'cutscene':
          expect(cutsceneIds).toContain(action.cutsceneId);
          checked += 1;
          break;
        case 'spawnWave':
          expect(action.spawnIds.length).toBeGreaterThan(0);
          for (const spawnId of action.spawnIds) {
            expect(spawnIds).toContain(spawnId);
            checked += 1;
          }
          break;
        case 'objective':
          expect(action.text.length).toBeGreaterThan(0);
          break;
        case 'vista':
          expect(action.seconds).toBeGreaterThan(0);
          break;
        case 'phase':
        case 'setFlag':
          break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('resolves every id a puzzle or resonator refers to', () => {
    const puzzleIds = new Set(STAGE.puzzles.map((entry) => entry.id));
    const resonatorIds = new Set(STAGE.resonators.map((entry) => entry.id));
    const doorIds = new Set(STAGE.doors.map((entry) => entry.id));
    const pickupIds = new Set(STAGE.pickups.map((entry) => entry.id));

    expect(STAGE.puzzles.length).toBeGreaterThan(0);

    for (const resonator of STAGE.resonators) {
      expect(puzzleIds).toContain(resonator.puzzleId);
      expect(resonator.degree).toBeGreaterThanOrEqual(0);
      expect(resonator.degree).toBeLessThan(HARMONIC_RATIOS.length);
    }

    for (const puzzle of STAGE.puzzles) {
      expect(puzzle.resonatorIds.length).toBeGreaterThan(0);
      expect(puzzle.hint.length).toBeGreaterThan(0);
      for (const id of puzzle.resonatorIds) expect(resonatorIds).toContain(id);
      // Every resonator named by the puzzle must name the puzzle back.
      for (const id of puzzle.resonatorIds) {
        const resonator = STAGE.resonators.find((entry) => entry.id === id);
        expect(resonator?.puzzleId).toBe(puzzle.id);
      }
      const reward = puzzle.reward;
      switch (reward.kind) {
        case 'openDoor':
          expect(doorIds).toContain(reward.doorId);
          break;
        case 'spawnPlatforms': {
          const platformIds = new Set(
            [...STAGE.geometry, ...STAGE.movingPlatforms].map((entry) => entry.id),
          );
          expect(reward.platformIds.length).toBeGreaterThan(0);
          for (const id of reward.platformIds) expect(platformIds).toContain(id);
          break;
        }
        case 'revealSecret':
          expect(pickupIds).toContain(reward.contentId);
          break;
        case 'setFlag':
          expect(reward.flag.length).toBeGreaterThan(0);
          break;
      }
    }
  });

  it('gives every flag-gated door a flag that something in the stage sets', () => {
    const produced = new Set<string>();
    for (const trigger of STAGE.triggers) {
      if (trigger.action.kind === 'setFlag') produced.add(trigger.action.flag);
    }
    for (const puzzle of STAGE.puzzles) {
      if (puzzle.reward.kind === 'setFlag') produced.add(puzzle.reward.flag);
    }

    const gated = STAGE.doors.filter((door) => door.openedByFlag !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    for (const door of gated) {
      expect(produced).toContain(door.openedByFlag);
    }
  });

  it('resolves every id an enemy spawn refers to', () => {
    const triggerIds = new Set(STAGE.triggers.map((entry) => entry.id));
    const pickupIds = new Set(STAGE.pickups.map((entry) => entry.id));
    for (const spawn of STAGE.enemies) {
      if (spawn.triggerId !== undefined) expect(triggerIds).toContain(spawn.triggerId);
      if (spawn.guardsSecret !== undefined) expect(pickupIds).toContain(spawn.guardsSecret);
      if (spawn.minDifficulty !== undefined) {
        expect(DIFFICULTY_IDS as readonly string[]).toContain(spawn.minDifficulty);
      }
    }
  });

  it('uses only known form ids, collectible kinds and damage kinds', () => {
    const forms: readonly string[] = RESONANCE_FORM_IDS;
    const kinds: readonly string[] = COLLECTIBLE_KINDS;
    const damage: readonly string[] = DAMAGE_KINDS;

    for (const piece of [...STAGE.geometry, ...STAGE.movingPlatforms]) {
      if (piece.revealedBy !== undefined) expect(forms).toContain(piece.revealedBy);
    }
    for (const hazard of STAGE.hazards) {
      expect(damage).toContain(hazard.damageKind);
      if (hazard.clearedBy !== undefined) expect(forms).toContain(hazard.clearedBy);
    }
    for (const pickup of STAGE.pickups) {
      expect(pickup.kind === 'coherence' || kinds.includes(pickup.kind)).toBe(true);
      if (pickup.requiresForm !== undefined) expect(forms).toContain(pickup.requiresForm);
    }
    for (const rail of STAGE.rails) {
      expect(rail.points.length).toBeGreaterThanOrEqual(2);
      if (rail.requiresForm !== undefined) expect(forms).toContain(rail.requiresForm);
    }
    expect(ID_SET.size).toBeGreaterThan(0);
  });
});

describe('FALLEN_SANCTUARY — secrets', () => {
  it('declares a secretTotal equal to the number of secret pickups', () => {
    const secrets = STAGE.pickups.filter((pickup) => pickup.isSecret === true);
    expect(STAGE.secretTotal).toBe(secrets.length);
  });

  it('hides at least two secrets, one of them behind Echo Form', () => {
    const secrets = STAGE.pickups.filter((pickup) => pickup.isSecret === true);
    expect(secrets.length).toBeGreaterThanOrEqual(2);

    const echoSecrets = secrets.filter((pickup) => pickup.requiresForm === 'echo');
    expect(echoSecrets.length).toBeGreaterThanOrEqual(1);
  });

  it('places the Echo secret out of reach of a first-visit double jump', () => {
    const echoSecret = STAGE.pickups.find(
      (pickup) => pickup.isSecret === true && pickup.requiresForm === 'echo',
    );
    expect(echoSecret).toBeDefined();
    if (echoSecret === undefined) return;

    // The ledge under it must itself be form-gated, otherwise the "revisit"
    // framing is a lie: the player could simply walk up and look at it.
    const ledge = STAGE.geometry.find((piece) => {
      const box = footprint(piece);
      if (box === null) return false;
      return (
        echoSecret.position.x >= box.minX &&
        echoSecret.position.x <= box.maxX &&
        echoSecret.position.z >= box.minZ &&
        echoSecret.position.z <= box.maxZ &&
        box.topY <= echoSecret.position.y
      );
    });
    expect(ledge?.revealedBy).toBe('echo');
  });
});

describe('FALLEN_SANCTUARY — playable space', () => {
  it('puts the kill plane well below every piece of geometry', () => {
    const pieces = [...STAGE.geometry, ...STAGE.movingPlatforms];
    expect(pieces.length).toBeGreaterThan(0);

    let lowest = Number.POSITIVE_INFINITY;
    for (const piece of pieces) {
      const bottom = lowestY(piece.shape, piece.position);
      expect(STAGE.killPlaneY).toBeLessThan(bottom);
      if (bottom < lowest) lowest = bottom;
    }
    // "Well below": at least five metres of clear air under the lowest collider,
    // so brushing the underside of a platform is never a kill.
    expect(STAGE.killPlaneY).toBeLessThan(lowest - 5);
  });

  it('spawns the player standing above walkable geometry', () => {
    const ground = groundBeneath(STAGE.spawnPoint, STAGE.geometry);
    expect(ground).not.toBeNull();
    if (ground === null) return;
    const drop = STAGE.spawnPoint.y - ground.topY;
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThanOrEqual(4);
  });

  it('puts every checkpoint above walkable geometry', () => {
    for (const checkpoint of STAGE.checkpoints) {
      const ground = groundBeneath(checkpoint.position, STAGE.geometry);
      expect(ground, `no ground under ${checkpoint.id}`).not.toBeNull();
      if (ground === null) continue;
      const drop = checkpoint.position.y - ground.topY;
      expect(drop, `${checkpoint.id} floats ${drop} m`).toBeLessThanOrEqual(4);
    }
  });

  it('orders checkpoints uniquely and ascending', () => {
    const orders = STAGE.checkpoints.map((checkpoint) => checkpoint.order);
    expect(new Set(orders).size).toBe(orders.length);
    for (let i = 1; i < orders.length; i += 1) {
      const previous = orders[i - 1];
      const current = orders[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous === undefined || current === undefined) continue;
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('spaces checkpoints across the run with geometry between each pair', () => {
    // Enough that a failure never costs more than a short retry, and placed on
    // both sides of the mini-boss.
    expect(STAGE.checkpoints.length).toBeGreaterThanOrEqual(5);

    const ordered = [...STAGE.checkpoints].sort((a, b) => a.order - b.order);
    const surfaces = [...STAGE.geometry, ...STAGE.movingPlatforms];

    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous === undefined || current === undefined) continue;

      const dx = current.position.x - previous.position.x;
      const dz = current.position.z - previous.position.z;
      const horizontal = Math.hypot(dx, dz);
      expect(horizontal, `${previous.id} -> ${current.id}`).toBeGreaterThan(0);

      const minX = Math.min(previous.position.x, current.position.x);
      const maxX = Math.max(previous.position.x, current.position.x);
      const between = surfaces.filter(
        (piece) =>
          piece.position.x > minX &&
          piece.position.x < maxX &&
          piece.onlyWhenRestored !== true &&
          piece.revealedBy === undefined &&
          piece.layer !== Layer.Hazard,
      );
      expect(
        between.length,
        `nothing to stand on between ${previous.id} and ${current.id}`,
      ).toBeGreaterThan(0);
    }
  });

  it('brackets the mini-boss with a checkpoint on each side', () => {
    const encounter = STAGE.triggers.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'miniboss',
    );
    expect(encounter).toBeDefined();
    if (encounter === undefined) return;

    const before = STAGE.checkpoints.filter((cp) => cp.position.x < encounter.position.x);
    const after = STAGE.checkpoints.filter((cp) => cp.position.x > encounter.position.x);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);

    // The checkpoint before the fight must be close enough that a loss is a
    // short walk back, not a replay of the escape run.
    const nearest = before.reduce((best, cp) =>
      cp.position.x > best.position.x ? cp : best,
    );
    expect(encounter.position.x - nearest.position.x).toBeLessThan(20);
  });
});

describe('FALLEN_SANCTUARY — gaps against the movement budget', () => {
  const gaps = forwardGaps();

  it('has real holes in the run', () => {
    expect(gaps.length).toBeGreaterThanOrEqual(4);
  });

  it('never asks for more than a jump, an air dash and a second jump', () => {
    for (const gap of gaps) {
      expect(gap.size, `gap at x ${gap.from} is ${gap.size} m`).toBeLessThanOrEqual(
        DASH_CHAIN_REACH,
      );
    }
  });

  it('puts every gap wider than a single jump after the double-jump tutorial', () => {
    const taughtAt = tutorialTaughtByX('tut-double-jump');
    const wide = gaps.filter((gap) => gap.size > SINGLE_JUMP_REACH);
    expect(wide.length).toBeGreaterThan(0);
    for (const gap of wide) {
      expect(gap.from, `${gap.size} m gap at x ${gap.from}`).toBeGreaterThanOrEqual(taughtAt);
    }
  });

  it('puts every gap wider than a double jump after the dash tutorial', () => {
    const taughtAt = tutorialTaughtByX('tut-dash');
    const veryWide = gaps.filter((gap) => gap.size > DOUBLE_JUMP_REACH);
    expect(veryWide.length).toBeGreaterThan(0);
    for (const gap of veryWide) {
      expect(gap.from, `${gap.size} m gap at x ${gap.from}`).toBeGreaterThanOrEqual(taughtAt);
    }
  });

  it('keeps every gap before the double-jump tutorial single-jump crossable', () => {
    const taughtAt = tutorialTaughtByX('tut-double-jump');
    const early = gaps.filter((gap) => gap.from < taughtAt);
    expect(early.length).toBeGreaterThan(0);
    for (const gap of early) {
      // 80% of the single-jump budget: a first-time player must not need a
      // frame-perfect run-up to leave the opening terrace.
      expect(gap.size, `early gap at x ${gap.from}`).toBeLessThanOrEqual(
        SINGLE_JUMP_REACH * 0.8,
      );
    }
  });
});

describe('FALLEN_SANCTUARY — teaching beats', () => {
  const tutorialIds = new Set(STAGE.tutorials.map((entry) => entry.id));

  it('teaches movement, camera, jumping, firing, charging, dashing and sight', () => {
    for (const required of [
      'tut-move',
      'tut-camera',
      'tut-jump',
      'tut-double-jump',
      'tut-fire',
      'tut-charge',
      'tut-dash',
      'tut-resonance-sight',
    ]) {
      expect(tutorialIds).toContain(required);
    }
  });

  it('gives every tutorial a title, a body and at least one action prompt', () => {
    for (const tutorial of STAGE.tutorials) {
      expect(tutorial.title.length, tutorial.id).toBeGreaterThan(0);
      expect(tutorial.body.length, tutorial.id).toBeGreaterThan(20);
      expect(tutorial.actions.length, tutorial.id).toBeGreaterThan(0);
      for (const action of tutorial.actions) expect(action.length).toBeGreaterThan(0);
    }
  });

  it('reaches every tutorial and every cutscene from a trigger', () => {
    const reachedTutorials = new Set<string>();
    const reachedCutscenes = new Set<string>();
    for (const trigger of STAGE.triggers) {
      if (trigger.action.kind === 'tutorial') reachedTutorials.add(trigger.action.tutorialId);
      if (trigger.action.kind === 'cutscene') reachedCutscenes.add(trigger.action.cutsceneId);
    }
    for (const tutorial of STAGE.tutorials) {
      expect(reachedTutorials, `${tutorial.id} is unreachable`).toContain(tutorial.id);
    }
    for (const cutscene of STAGE.cutscenes) {
      expect(reachedCutscenes, `${cutscene.id} is unreachable`).toContain(cutscene.id);
    }
  });

  it('teaches each ability before the place that needs it', () => {
    const order = [
      'tut-move',
      'tut-camera',
      'tut-jump',
      'tut-double-jump',
      'tut-fire',
      'tut-resonance-sight',
      'tut-charge',
      'tut-dash',
    ];
    const positions = order.map((id) => tutorialTaughtByX(id));
    for (let i = 1; i < positions.length; i += 1) {
      const previous = positions[i - 1];
      const current = positions[i];
      if (previous === undefined || current === undefined) continue;
      expect(current, `${order[i]} is taught before ${order[i - 1]}`).toBeGreaterThan(previous);
    }
  });

  it('opens on a vista over the collapsing Sanctuary', () => {
    const vistas = STAGE.triggers.filter((trigger) => trigger.action.kind === 'vista');
    expect(vistas.length).toBeGreaterThanOrEqual(1);

    const opening = vistas.reduce((best, trigger) =>
      trigger.position.x < best.position.x ? trigger : best,
    );
    // Early, and looking somewhere other than the player's own feet.
    expect(opening.position.x).toBeLessThan(20);
    if (opening.action.kind !== 'vista') return;
    const look = opening.action.look;
    const away = Math.hypot(look.x - opening.position.x, look.z - opening.position.z);
    expect(away).toBeGreaterThan(20);
    expect(opening.action.seconds).toBeGreaterThan(1);
  });

  it('teaches the pulse on a breakable infected growth that gates progress', () => {
    const growth = STAGE.puzzles.find((puzzle) => puzzle.reward.kind === 'openDoor');
    expect(growth).toBeDefined();
    if (growth === undefined || growth.reward.kind !== 'openDoor') return;

    const door = STAGE.doors.find((entry) => entry.id === growth.reward.doorId);
    expect(door).toBeDefined();
    expect(door?.style).toBe('infected');

    // It must sit after the fire tutorial, or the lesson has no target.
    const fireAt = tutorialTaughtByX('tut-fire');
    expect(door?.position.x ?? 0).toBeGreaterThan(fireAt);
  });

  it('crosses the chasm on collapsing platforms', () => {
    const collapsing = STAGE.movingPlatforms.filter(
      (platform) => platform.motion.kind === 'collapse',
    );
    expect(collapsing.length).toBeGreaterThanOrEqual(3);
    for (const platform of collapsing) {
      if (platform.motion.kind !== 'collapse') continue;
      expect(platform.motion.delaySeconds).toBeGreaterThan(0);
      expect(platform.motion.respawnSeconds).toBeGreaterThan(platform.motion.delaySeconds);
    }
  });

  it('chases the player with a moving hazard during the escape', () => {
    const moving = STAGE.movingPlatforms.filter((platform) => platform.layer === Layer.Hazard);
    expect(moving.length).toBeGreaterThanOrEqual(1);
    for (const wave of moving) {
      expect(wave.motion.kind).toBe('linear');
      if (wave.motion.kind !== 'linear') continue;
      const travel = Math.abs(wave.motion.to.x - wave.position.x);
      const speed = travel / wave.motion.seconds;
      // Slower than the 8.6 m/s run, or the escape is not an escape.
      expect(speed).toBeGreaterThan(0);
      expect(speed).toBeLessThan(8.6);
    }
  });

  it('names the mini-boss and reveals the World Lattice at the end', () => {
    expect(STAGE.miniBossId).toBe(REQUIRED_MINI_BOSS_ID);

    const phases = STAGE.triggers
      .map((trigger) => (trigger.action.kind === 'phase' ? trigger : null))
      .filter((trigger): trigger is NonNullable<typeof trigger> => trigger !== null);
    const kinds = phases.map((trigger) =>
      trigger.action.kind === 'phase' ? trigger.action.phase : '',
    );
    expect(kinds).toContain('miniboss');
    expect(kinds).toContain('restoration');

    const miniboss = phases.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'miniboss',
    );
    const restoration = phases.find(
      (trigger) => trigger.action.kind === 'phase' && trigger.action.phase === 'restoration',
    );
    expect(miniboss?.position.x ?? 0).toBeLessThan(restoration?.position.x ?? 0);
  });
});

describe('FALLEN_SANCTUARY — narrative', () => {
  const script = STAGE.cutscenes
    .flatMap((cutscene) => cutscene.lines.map((line) => line.text))
    .join('\n');

  it('gives every cutscene speakers and non-empty lines', () => {
    expect(STAGE.cutscenes.length).toBeGreaterThanOrEqual(4);
    for (const cutscene of STAGE.cutscenes) {
      expect(cutscene.lines.length, cutscene.id).toBeGreaterThan(0);
      // Brief by design: a few lines a scene, never an exposition dump.
      expect(cutscene.lines.length, cutscene.id).toBeLessThanOrEqual(8);
      for (const line of cutscene.lines) {
        expect(line.speaker.length, cutscene.id).toBeGreaterThan(0);
        expect(line.text.length, cutscene.id).toBeGreaterThan(0);
      }
    }
  });

  it('establishes the premise: 432, 440, the Detuners and the true chord', () => {
    expect(script).toMatch(/four hundred and thirty-two/i);
    expect(script).toMatch(/four hundred and forty/i);
    expect(script).toMatch(/detuner/i);
    expect(script).toMatch(/true chord/i);
  });

  it('reveals the World Lattice, the Commanders and the next destination', () => {
    expect(script).toMatch(/world lattice/i);
    expect(script).toMatch(/commanders/i);
    expect(script).toMatch(/frequency core/i);
    expect(script).toMatch(/fractured garden/i);
  });

  it('sets an objective the player can read at every major beat', () => {
    const objectives = STAGE.triggers.filter((trigger) => trigger.action.kind === 'objective');
    expect(objectives.length).toBeGreaterThanOrEqual(4);
  });

  it('decorates the stage with landmark props', () => {
    const props = STAGE.props ?? [];
    expect(props.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(props.map((prop) => prop.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });
});

describe('FALLEN_SANCTUARY — content tables', () => {
  it('spawns only enemies that exist in ENEMY_ARCHETYPES', () => {
    const used = [...new Set(STAGE.enemies.map((spawn) => spawn.archetype))].sort();
    expect(used.length).toBeGreaterThan(0);

    if (ENEMY_ARCHETYPES === null) {
      // The archetype table is not in this working tree yet. Assert the
      // contract the stage was authored against instead.
      expect(used).toEqual([...REQUIRED_ARCHETYPE_IDS].sort());
      return;
    }
    const known = Object.keys(ENEMY_ARCHETYPES);
    expect(known.length).toBeGreaterThan(0);
    for (const archetype of used) {
      expect(known, `unknown archetype ${archetype}`).toContain(archetype);
    }
  });

  it('names a mini-boss that exists in BOSSES', () => {
    const miniBossId = STAGE.miniBossId;
    expect(miniBossId).toBeDefined();
    if (miniBossId === undefined) return;

    if (BOSSES === null) {
      expect(miniBossId).toBe(REQUIRED_MINI_BOSS_ID);
      return;
    }
    expect(Object.keys(BOSSES)).toContain(miniBossId);
    const boss = BOSSES[miniBossId];
    expect(boss).toBeDefined();
    if (boss !== null && typeof boss === 'object' && 'stageId' in boss) {
      expect((boss as { stageId: unknown }).stageId).toBe(STAGE.id);
    }
  });
});
