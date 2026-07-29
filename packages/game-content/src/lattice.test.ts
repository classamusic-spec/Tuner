import { describe, expect, it } from 'vitest';
import { HARMONIC_RATIOS, STAGE_IDS, isResonanceFormId, isStageId } from '@tuner/shared';
import type { ResonanceFormId, StageId } from '@tuner/shared';
import {
  FINALE_STAGE_IDS,
  INTRODUCTORY_STAGE_ID,
  PLANETARY_STAGE_IDS,
  WORLD_LATTICE,
  countRestoredNodes,
  getAvailableStages,
  getAwardedForms,
  getLatticeNode,
  getNewlyUnlockedStages,
  getPlanetaryCommanderNodes,
  isStageUnlocked,
} from './lattice.js';
import type { LatticeNode } from './lattice.js';
import {
  BESTIARY_ENTRIES,
  CHARACTERS,
  CODEX_ENTRIES,
  KEEPER_MEMORIES,
  LOST_MOTIFS,
  STAGE_NARRATIVES,
} from './narrative.js';
import { SANCTUARY_EVOLUTION, SANCTUARY_ROOMS, SANCTUARY_UPGRADES } from './sanctuary.js';
import { ENEMY_ARCHETYPES } from './enemies.js';
import { BOSSES } from './bosses.js';

/**
 * The lattice's contract, asserted rather than documented.
 *
 * Two things in this project are easy to break silently and expensive to
 * discover late: a progression rule that quietly becomes a rigid order, and a
 * collectible that points at a region that does not exist. Both are structural
 * and both are caught here.
 *
 * The load-bearing test in this file is `flexible order`. TUNER's whole premise
 * is that after the introduction the player chooses; a change that makes one
 * main region a prerequisite for another must fail loudly, not read as a tuning
 * tweak in a diff.
 */

const ALL_STAGE_IDS: readonly StageId[] = STAGE_IDS;
const MAX_DEGREE = HARMONIC_RATIOS.length - 1;

function nodeFor(stageId: StageId): LatticeNode {
  const node = getLatticeNode(stageId);
  if (node === undefined) throw new Error(`no lattice node for ${stageId}`);
  return node;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('WORLD_LATTICE coverage', () => {
  it('names a real stage on every node', () => {
    for (const node of WORLD_LATTICE) {
      expect(isStageId(node.stageId)).toBe(true);
    }
  });

  it('covers all ten stages exactly once', () => {
    const seen = WORLD_LATTICE.map((node) => node.stageId);
    expect(seen).toHaveLength(ALL_STAGE_IDS.length);
    expect(new Set(seen).size).toBe(ALL_STAGE_IDS.length);
    for (const stageId of ALL_STAGE_IDS) {
      expect(seen).toContain(stageId);
    }
  });

  it('groups the stages into one introduction, seven planetary nodes and two finale nodes', () => {
    expect(PLANETARY_STAGE_IDS).toHaveLength(7);
    expect(FINALE_STAGE_IDS).toEqual(['orbital-dissonance', 'celestial-loom']);

    const grouped = new Set<StageId>([
      INTRODUCTORY_STAGE_ID,
      ...PLANETARY_STAGE_IDS,
      ...FINALE_STAGE_IDS,
    ]);
    expect(grouped.size).toBe(ALL_STAGE_IDS.length);

    expect(nodeFor(INTRODUCTORY_STAGE_ID).kind).toBe('origin');
    for (const stageId of PLANETARY_STAGE_IDS) {
      expect(nodeFor(stageId).kind).toBe('planetary');
    }
  });

  it('gives every node the presentation data the map needs', () => {
    for (const node of WORLD_LATTICE) {
      expect(node.displayName.length).toBeGreaterThan(0);
      expect(node.subtitle.length).toBeGreaterThan(0);
      expect(node.description.length).toBeGreaterThan(0);
      expect(node.constellation.length).toBeGreaterThan(0);
      expect(node.glyph.length).toBeGreaterThan(0);
      expect(node.fragment.length).toBeGreaterThan(0);
      expect(node.infection).toBeGreaterThanOrEqual(0);
      expect(node.infection).toBeLessThanOrEqual(1);
      expect(node.harmonicDegree).toBeGreaterThanOrEqual(0);
      expect(node.harmonicDegree).toBeLessThanOrEqual(MAX_DEGREE);
      expect(node.recoveredFrequency).toMatch(/^\d+\.\d{2} Hz · \w+$/);
    }
  });

  it('places every node somewhere distinct on the diagram', () => {
    const keys = WORLD_LATTICE.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(keys).size).toBe(WORLD_LATTICE.length);
  });
});

// ---------------------------------------------------------------------------
// Constellation edges
// ---------------------------------------------------------------------------

describe('constellation edges', () => {
  it('only ever points at real nodes, and never at itself', () => {
    for (const node of WORLD_LATTICE) {
      for (const edge of node.edges) {
        expect(isStageId(edge.to)).toBe(true);
        expect(getLatticeNode(edge.to)).toBeDefined();
        expect(edge.to).not.toBe(node.stageId);
      }
    }
  });

  it('is symmetric — a line drawn from one end is drawn from the other', () => {
    for (const node of WORLD_LATTICE) {
      for (const edge of node.edges) {
        const partner = nodeFor(edge.to);
        const back = partner.edges.find((candidate) => candidate.to === node.stageId);
        expect(
          back,
          `${partner.stageId} does not draw its line back to ${node.stageId}`,
        ).toBeDefined();
        expect(back?.kind).toBe(edge.kind);
      }
    }
  });

  it('leaves no node stranded off the diagram', () => {
    for (const node of WORLD_LATTICE) {
      expect(node.edges.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Unlock integrity
// ---------------------------------------------------------------------------

describe('unlock requirements', () => {
  it('only names real stages', () => {
    for (const node of WORLD_LATTICE) {
      for (const required of node.unlock.requiresStages) {
        expect(isStageId(required)).toBe(true);
        expect(getLatticeNode(required)).toBeDefined();
      }
      expect(node.unlock.requiresRestoredNodes).toBeGreaterThanOrEqual(0);
      expect(node.unlock.requiresRestoredNodes).toBeLessThanOrEqual(PLANETARY_STAGE_IDS.length);
    }
  });

  it('never requires a stage to unlock itself', () => {
    for (const node of WORLD_LATTICE) {
      expect(node.unlock.requiresStages).not.toContain(node.stageId);
    }
  });

  it('contains no cycles', () => {
    const visiting = new Set<StageId>();
    const settled = new Set<StageId>();

    const walk = (stageId: StageId, trail: readonly StageId[]): void => {
      if (settled.has(stageId)) return;
      expect(
        visiting.has(stageId),
        `cycle in unlock requirements: ${[...trail, stageId].join(' -> ')}`,
      ).toBe(false);
      visiting.add(stageId);
      for (const required of nodeFor(stageId).unlock.requiresStages) {
        walk(required, [...trail, stageId]);
      }
      visiting.delete(stageId);
      settled.add(stageId);
    };

    for (const node of WORLD_LATTICE) walk(node.stageId, []);
    expect(settled.size).toBe(WORLD_LATTICE.length);
  });

  it('gives every locked node a sentence rather than a padlock', () => {
    for (const node of WORLD_LATTICE) {
      if (node.stageId === INTRODUCTORY_STAGE_ID) continue;
      expect(node.unlock.hint.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

describe('getAvailableStages', () => {
  it('opens with the introductory stage and nothing else', () => {
    expect(getAvailableStages([])).toEqual([INTRODUCTORY_STAGE_ID]);
  });

  it('opens several main stages at once once the introduction is restored', () => {
    const available = getAvailableStages([INTRODUCTORY_STAGE_ID]);
    const mainAvailable = available.filter((id) => PLANETARY_STAGE_IDS.includes(id));

    expect(mainAvailable.length).toBeGreaterThan(1);
    expect(mainAvailable).toContain('fractured-garden');
    expect(mainAvailable).toContain('glass-meridian');
    expect(mainAvailable).toContain('tidal-archive');
    expect(mainAvailable).toContain('verdant-machine');
  });

  it('imposes no rigid order among the seven main stages', () => {
    // 1. No planetary node ever names another planetary node as a requirement.
    for (const stageId of PLANETARY_STAGE_IDS) {
      for (const required of nodeFor(stageId).unlock.requiresStages) {
        expect(PLANETARY_STAGE_IDS).not.toContain(required);
      }
    }

    // 2. Every planetary node is reachable as the very first main stage the
    //    player picks — including the outer ones, via any two of the inner.
    for (const stageId of PLANETARY_STAGE_IDS) {
      const openedFirst = getAvailableStages([INTRODUCTORY_STAGE_ID]);
      if (openedFirst.includes(stageId)) continue;

      const twoOthers = PLANETARY_STAGE_IDS.filter(
        (candidate) => candidate !== stageId && openedFirst.includes(candidate),
      ).slice(0, 2);
      expect(twoOthers).toHaveLength(2);
      expect(getAvailableStages([INTRODUCTORY_STAGE_ID, ...twoOthers])).toContain(stageId);
    }

    // 3. Every ordering of the inner constellation is legal: whichever the
    //    player takes first, the others stay available afterwards.
    const inner = getAvailableStages([INTRODUCTORY_STAGE_ID]).filter((id) =>
      PLANETARY_STAGE_IDS.includes(id),
    );
    for (const first of inner) {
      const after = getAvailableStages([INTRODUCTORY_STAGE_ID, first]);
      for (const other of inner) {
        expect(after).toContain(other);
      }
    }
  });

  it('keeps restored regions selectable so they can be revisited with new forms', () => {
    const available = getAvailableStages([INTRODUCTORY_STAGE_ID, 'fractured-garden']);
    expect(available).toContain(INTRODUCTORY_STAGE_ID);
    expect(available).toContain('fractured-garden');
  });

  it('holds the final two stages back until all seven planetary nodes are restored', () => {
    for (let restored = 0; restored < PLANETARY_STAGE_IDS.length; restored += 1) {
      const completed: StageId[] = [
        INTRODUCTORY_STAGE_ID,
        ...PLANETARY_STAGE_IDS.slice(0, restored),
      ];
      const available = getAvailableStages(completed);
      for (const finaleId of FINALE_STAGE_IDS) {
        expect(available, `${finaleId} opened after only ${restored} nodes`).not.toContain(
          finaleId,
        );
      }
    }
  });

  it('opens the ascent when the seven are restored, and the Loom after the ascent', () => {
    const sevenDone: StageId[] = [INTRODUCTORY_STAGE_ID, ...PLANETARY_STAGE_IDS];
    expect(countRestoredNodes(sevenDone)).toBe(7);

    const afterSeven = getAvailableStages(sevenDone);
    expect(afterSeven).toContain('orbital-dissonance');
    expect(afterSeven).not.toContain('celestial-loom');

    const afterAscent = getAvailableStages([...sevenDone, 'orbital-dissonance']);
    expect(afterAscent).toContain('celestial-loom');
    expect(afterAscent).toHaveLength(ALL_STAGE_IDS.length);
  });

  it('agrees with isStageUnlocked for every stage and every prefix of the run', () => {
    const completed: StageId[] = [];
    const run: readonly StageId[] = [
      INTRODUCTORY_STAGE_ID,
      ...PLANETARY_STAGE_IDS,
      ...FINALE_STAGE_IDS,
    ];
    for (const stageId of run) {
      const available = new Set(getAvailableStages(completed));
      for (const candidate of ALL_STAGE_IDS) {
        expect(isStageUnlocked(candidate, completed)).toBe(available.has(candidate));
      }
      completed.push(stageId);
    }
  });

  it('reports what each restoration opened', () => {
    expect(getNewlyUnlockedStages([], INTRODUCTORY_STAGE_ID).length).toBeGreaterThan(1);

    const beforeSeventh: StageId[] = [INTRODUCTORY_STAGE_ID, ...PLANETARY_STAGE_IDS.slice(0, 6)];
    const seventh = PLANETARY_STAGE_IDS[6];
    expect(seventh).toBeDefined();
    if (seventh !== undefined) {
      expect(getNewlyUnlockedStages(beforeSeventh, seventh)).toEqual(['orbital-dissonance']);
    }
  });
});

// ---------------------------------------------------------------------------
// Commanders and forms
// ---------------------------------------------------------------------------

describe('commanders and the forms they yield', () => {
  it('fields seven planetary commanders awarding seven distinct forms', () => {
    const commanders = getPlanetaryCommanderNodes();
    expect(commanders).toHaveLength(7);

    const forms = commanders.map((node) => node.awardsForm);
    for (const form of forms) {
      expect(form).not.toBeNull();
      expect(form === null || isResonanceFormId(form)).toBe(true);
    }
    expect(new Set(forms).size).toBe(7);

    for (const node of commanders) {
      expect(node.commanderName).not.toBeNull();
      expect(node.commanderTitle).not.toBeNull();
    }
  });

  it('has every non-base, non-celestial form awarded by exactly one commander', () => {
    const awardCounts = new Map<ResonanceFormId, number>();
    for (const node of WORLD_LATTICE) {
      const form = node.awardsForm;
      if (form === null) continue;
      awardCounts.set(form, (awardCounts.get(form) ?? 0) + 1);
    }

    const expected: readonly ResonanceFormId[] = [
      'echo',
      'prism',
      'tidal',
      'ember',
      'choir',
      'bloom',
      'silence',
    ];
    for (const form of expected) {
      expect(awardCounts.get(form), `${form} is not awarded exactly once`).toBe(1);
    }

    // `base` is never awarded — the player starts with it.
    expect(awardCounts.has('base')).toBe(false);
    // `celestial` comes from the Loom, which is not one of the seven.
    expect(awardCounts.get('celestial')).toBe(1);
    expect(nodeFor('celestial-loom').awardsForm).toBe('celestial');
  });

  it('agrees with the boss table on who awards what', () => {
    for (const node of getPlanetaryCommanderNodes()) {
      const boss = Object.values(BOSSES).find(
        (candidate) => candidate.stageId === node.stageId && candidate.awardsForm !== undefined,
      );
      expect(boss, `no form-awarding boss authored for ${node.stageId}`).toBeDefined();
      if (boss !== undefined) {
        expect(boss.awardsForm).toBe(node.awardsForm);
        expect(boss.displayName).toBe(node.commanderName);
        expect(boss.title).toBe(node.commanderTitle);
      }
    }
  });

  it('recommends forms without ever requiring them', () => {
    for (const node of WORLD_LATTICE) {
      expect(node.recommendationNote.length).toBeGreaterThan(0);
      for (const form of node.recommendedForms) {
        expect(isResonanceFormId(form)).toBe(true);
      }
      // A region never recommends the form it is about to hand out.
      if (node.awardsForm !== null) {
        expect(node.recommendedForms).not.toContain(node.awardsForm);
      }
    }
  });

  it('grants forms in step with the regions restored', () => {
    expect(getAwardedForms([])).toEqual(['base']);
    expect(getAwardedForms([INTRODUCTORY_STAGE_ID])).toEqual(['base']);

    const all = getAwardedForms([INTRODUCTORY_STAGE_ID, ...PLANETARY_STAGE_IDS]);
    expect(all).toHaveLength(8);
    expect(all).toContain('base');
    expect(all).not.toContain('celestial');
  });
});

// ---------------------------------------------------------------------------
// Narrative collectibles
// ---------------------------------------------------------------------------

describe('KEEPER_MEMORIES', () => {
  it('has a unique id, a title and real prose on every fragment', () => {
    const ids = new Set<string>();
    for (const memory of KEEPER_MEMORIES) {
      expect(memory.id.length).toBeGreaterThan(0);
      expect(ids.has(memory.id), `duplicate memory id ${memory.id}`).toBe(false);
      ids.add(memory.id);

      expect(memory.title.trim().length).toBeGreaterThan(0);
      expect(memory.prose.trim().length).toBeGreaterThan(40);
      expect(memory.attribution.trim().length).toBeGreaterThan(0);
    }
  });

  it('is filed against a real stage, and reaches every region', () => {
    const stages = new Set<StageId>();
    for (const memory of KEEPER_MEMORIES) {
      expect(isStageId(memory.stageId)).toBe(true);
      expect(getLatticeNode(memory.stageId)).toBeDefined();
      stages.add(memory.stageId);
    }
    expect(stages.size).toBe(ALL_STAGE_IDS.length);
  });
});

describe('LOST_MOTIFS', () => {
  it('has a unique id and a real name on every motif', () => {
    const ids = new Set<string>();
    for (const motif of LOST_MOTIFS) {
      expect(motif.id.length).toBeGreaterThan(0);
      expect(ids.has(motif.id), `duplicate motif id ${motif.id}`).toBe(false);
      ids.add(motif.id);

      expect(motif.name.trim().length).toBeGreaterThan(0);
      expect(motif.note.trim().length).toBeGreaterThan(0);
    }
  });

  it('is filed against a real stage, and reaches every region', () => {
    const stages = new Set<StageId>();
    for (const motif of LOST_MOTIFS) {
      expect(isStageId(motif.stageId)).toBe(true);
      expect(getLatticeNode(motif.stageId)).toBeDefined();
      stages.add(motif.stageId);
    }
    expect(stages.size).toBe(ALL_STAGE_IDS.length);
  });

  it('is playable: every degree is a real harmonic degree', () => {
    for (const motif of LOST_MOTIFS) {
      expect(motif.degrees.length).toBeGreaterThan(2);
      for (const degree of motif.degrees) {
        expect(Number.isInteger(degree)).toBe(true);
        expect(degree).toBeGreaterThanOrEqual(0);
        expect(degree).toBeLessThanOrEqual(MAX_DEGREE);
      }
      expect(motif.bpm).toBeGreaterThan(30);
      expect(motif.bpm).toBeLessThan(220);
    }
  });
});

// ---------------------------------------------------------------------------
// Codex and bestiary
// ---------------------------------------------------------------------------

describe('BESTIARY_ENTRIES', () => {
  it('keys only real enemy archetypes and real bosses', () => {
    for (const [key, entry] of Object.entries(BESTIARY_ENTRIES)) {
      const isEnemy = Object.prototype.hasOwnProperty.call(ENEMY_ARCHETYPES, key);
      const isBoss = Object.prototype.hasOwnProperty.call(BOSSES, key);
      expect(isEnemy || isBoss, `${key} is neither an enemy archetype nor a boss`).toBe(true);
      expect(entry.id).toBe(key);
    }
  });

  it('matches the display name the game actually uses', () => {
    for (const [key, entry] of Object.entries(BESTIARY_ENTRIES)) {
      const enemy = ENEMY_ARCHETYPES[key];
      const boss = BOSSES[key];
      if (enemy !== undefined) expect(entry.displayName).toBe(enemy.displayName);
      else if (boss !== undefined) expect(entry.displayName).toBe(boss.displayName);
    }
  });

  it('covers every enemy archetype and every boss', () => {
    for (const key of Object.keys(ENEMY_ARCHETYPES)) {
      expect(BESTIARY_ENTRIES[key], `no bestiary entry for enemy ${key}`).toBeDefined();
    }
    for (const key of Object.keys(BOSSES)) {
      expect(BESTIARY_ENTRIES[key], `no bestiary entry for boss ${key}`).toBeDefined();
    }
  });

  it('reads as a field observation, with a drawn tell and honest counterplay', () => {
    for (const entry of Object.values(BESTIARY_ENTRIES)) {
      expect(entry.observation.trim().length).toBeGreaterThan(40);
      expect(entry.tell.trim().length).toBeGreaterThan(20);
      expect(entry.counterplay.trim().length).toBeGreaterThan(10);
      expect(isStageId(entry.firstSeen)).toBe(true);
      expect(entry.threat).toBeGreaterThanOrEqual(1);
      expect(entry.threat).toBeLessThanOrEqual(5);
      for (const form of entry.notableForms) {
        expect(isResonanceFormId(form)).toBe(true);
      }
    }
  });

  it('cleanses natives rather than breaking them', () => {
    for (const [key, entry] of Object.entries(BESTIARY_ENTRIES)) {
      const enemy = ENEMY_ARCHETYPES[key];
      if (enemy?.cleansable === true) {
        expect(entry.classification, `${key} is cleansable but filed as a Detuner`).not.toBe(
          'detuner',
        );
      }
    }
  });
});

describe('CODEX_ENTRIES', () => {
  it('is self-consistent and cross-referenced', () => {
    for (const [key, entry] of Object.entries(CODEX_ENTRIES)) {
      expect(entry.id).toBe(key);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.body.trim().length).toBeGreaterThan(40);
      expect(entry.unlock.trim().length).toBeGreaterThan(0);
      for (const related of entry.related) {
        expect(
          CODEX_ENTRIES[related],
          `${key} points at missing codex entry ${related}`,
        ).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Narrative structure
// ---------------------------------------------------------------------------

describe('STAGE_NARRATIVES', () => {
  it('covers all ten stages with real beats', () => {
    for (const stageId of ALL_STAGE_IDS) {
      const narrative = STAGE_NARRATIVES[stageId];
      expect(narrative, `no narrative for ${stageId}`).toBeDefined();
      expect(narrative.stageId).toBe(stageId);
      expect(narrative.premise.trim().length).toBeGreaterThan(20);
      expect(narrative.beats.length).toBeGreaterThanOrEqual(5);
      expect(narrative.openingExchange.length).toBeGreaterThan(0);
      expect(narrative.restorationLine.text.trim().length).toBeGreaterThan(0);
      expect(narrative.lesson.trim().length).toBeGreaterThan(0);
    }
  });

  it('gives every beat a unique id and keeps them short', () => {
    const ids = new Set<string>();
    for (const narrative of Object.values(STAGE_NARRATIVES)) {
      for (const beat of narrative.beats) {
        expect(ids.has(beat.id), `duplicate beat id ${beat.id}`).toBe(false);
        ids.add(beat.id);
        expect(beat.text.trim().length).toBeGreaterThan(20);
        // No exposition dumps: a beat is one or two sentences.
        expect(beat.text.length).toBeLessThanOrEqual(220);
      }
    }
  });

  it('opens and closes every region: arrival first, departure last', () => {
    for (const narrative of Object.values(STAGE_NARRATIVES)) {
      const phases = narrative.beats.map((beat) => beat.phase);
      expect(phases[0]).toBe('arrival');
      expect(phases[phases.length - 1]).toBe('departure');
      expect(phases).toContain('restoration');
    }
  });
});

describe('CHARACTERS', () => {
  it('carries the five principals, each anchored to a real stage', () => {
    for (const id of [
      'the-tuner',
      'keeper-ovel',
      'oru',
      'the-first-conductor',
      'the-silent-choir',
    ]) {
      const character = CHARACTERS[id];
      expect(character, `missing character ${id}`).toBeDefined();
      if (character === undefined) continue;
      expect(character.id).toBe(id);
      expect(isStageId(character.firstAppearance)).toBe(true);
      expect(character.appearance.trim().length).toBeGreaterThan(40);
      expect(character.voice.trim().length).toBeGreaterThan(20);
      expect(character.want.trim().length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

describe('the Harmonic Sanctuary', () => {
  it('gives every hub feature a room', () => {
    const ids = SANCTUARY_ROOMS.map((room) => room.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      'lattice-vault',
      'resonance-forge',
      'composition-chamber',
      'practice-ring',
      'observation-gallery',
      'keepers-archive',
      'living-terrace',
      'hall-of-returns',
      'trial-gate',
      'atelier',
      'keepers-alcove',
      'seed-beds',
    ]) {
      expect(ids, `no Sanctuary room for ${required}`).toContain(required);
    }
  });

  it('explains every sealed door instead of showing a padlock', () => {
    for (const room of SANCTUARY_ROOMS) {
      if (room.unlock.kind === 'always') continue;
      expect(room.unlockHint.trim().length).toBeGreaterThan(0);
    }
  });

  it('pays for every upgrade with Seeds from a region that exists', () => {
    const ids = new Set<string>();
    const roomIds = new Set(SANCTUARY_ROOMS.map((room) => room.id));
    for (const upgrade of SANCTUARY_UPGRADES) {
      expect(ids.has(upgrade.id), `duplicate upgrade id ${upgrade.id}`).toBe(false);
      ids.add(upgrade.id);
      expect(isStageId(upgrade.sourceStageId)).toBe(true);
      expect(roomIds.has(upgrade.roomId), `${upgrade.id} targets unknown room`).toBe(true);
      expect(upgrade.seedCost).toBeGreaterThan(0);
      expect(upgrade.restores.trim().length).toBeGreaterThan(10);
      expect(upgrade.visibleChange.trim().length).toBeGreaterThan(10);
    }
    for (const upgrade of SANCTUARY_UPGRADES) {
      for (const prerequisite of upgrade.prerequisiteIds) {
        expect(ids.has(prerequisite), `${upgrade.id} needs missing ${prerequisite}`).toBe(true);
      }
    }
  });

  it('evolves once per Commander, from broken to restrung', () => {
    expect(SANCTUARY_EVOLUTION).toHaveLength(9);
    SANCTUARY_EVOLUTION.forEach((step, index) => {
      expect(step.commandersRestored).toBe(index);
      expect(step.name.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(40);
      expect(step.soundscape.trim().length).toBeGreaterThan(10);
    });
  });
});
