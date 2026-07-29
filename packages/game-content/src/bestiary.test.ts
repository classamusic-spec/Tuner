import { describe, expect, it } from 'vitest';
import {
  ENEMY_ROLES,
  HARMONIC_RATIOS,
  RESONANCE_FORM_IDS,
  isResonanceFormId,
  isStageId,
} from '@tuner/shared';
import type { DamageKind, EnemyRole, ResonanceFormId } from '@tuner/shared';
import type { BossAttackDef, BossDef, EnemyArchetypeDef } from '@tuner/game-core';
import { ENEMY_ARCHETYPES } from './enemies.js';
import { BOSSES } from './bosses.js';

/**
 * The bestiary's authoring contract, asserted rather than documented.
 *
 * These tests exist because enemy and boss data is the easiest place in the
 * project for a fair fight to quietly become an unfair one: a telegraph shaved
 * to nothing, a phase pointing at an attack that was renamed, a form advantage
 * that turns into a form requirement. Every rule stated in `enemies.ts` and
 * `bosses.ts` has a check here.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const archetypeEntries: readonly (readonly [string, EnemyArchetypeDef])[] =
  Object.entries(ENEMY_ARCHETYPES);
const bossEntries: readonly (readonly [string, BossDef])[] = Object.entries(BOSSES);

/** Base-Auralith damage channels. Armour must always yield to at least one. */
const BASE_KIT_BREAKERS: readonly DamageKind[] = ['charge', 'counter', 'burst', 'pulse'];

/** The strongest a form is ever allowed to be against a boss. */
const MAX_FORM_ADVANTAGE = 1.5;

/** Mini-bosses teach; commanders award forms. */
const commanders = bossEntries.filter(([, boss]) => boss.isMiniBoss !== true);
const miniBosses = bossEntries.filter(([, boss]) => boss.isMiniBoss === true);

function attackById(boss: BossDef, id: string): BossAttackDef | undefined {
  return boss.attacks.find((attack) => attack.id === id);
}

/**
 * The multiplier actually applied to a form against a boss. An unlisted form
 * resolves to 1 — plain, unmodified damage — which is what makes advantages
 * optional rather than mandatory.
 */
function advantageFor(boss: BossDef, form: ResonanceFormId): number {
  return boss.formAdvantages[form] ?? 1;
}

// ---------------------------------------------------------------------------
// Enemy archetypes
// ---------------------------------------------------------------------------

describe('ENEMY_ARCHETYPES', () => {
  it('is a non-empty table whose keys match the archetype ids', () => {
    expect(archetypeEntries.length).toBeGreaterThan(0);
    for (const [key, archetype] of archetypeEntries) {
      expect(archetype.id).toBe(key);
      expect(archetype.displayName.length).toBeGreaterThan(0);
    }
  });

  it('represents every EnemyRole with at least one archetype', () => {
    const covered = new Set<EnemyRole>(archetypeEntries.map(([, a]) => a.role));
    for (const role of ENEMY_ROLES) {
      expect(covered.has(role), `no archetype fills the '${role}' role`).toBe(true);
    }
    // And nothing invented a role outside the shared vocabulary.
    for (const role of covered) {
      expect(ENEMY_ROLES).toContain(role);
    }
  });

  it('gives every archetype positive health and sane body dimensions', () => {
    for (const [key, archetype] of archetypeEntries) {
      expect(archetype.health, key).toBeGreaterThan(0);
      expect(Number.isFinite(archetype.health), key).toBe(true);

      expect(archetype.bodyRadius, key).toBeGreaterThan(0);
      expect(archetype.bodyRadius, key).toBeLessThanOrEqual(4);
      expect(archetype.bodyHeight, key).toBeGreaterThan(0);
      expect(archetype.bodyHeight, key).toBeLessThanOrEqual(8);
    }
  });

  it('never telegraphs an attack in under 0.35s', () => {
    for (const [key, archetype] of archetypeEntries) {
      expect(archetype.telegraphSeconds, key).toBeGreaterThanOrEqual(0.35);
      expect(archetype.telegraphSeconds, key).toBeLessThanOrEqual(3);
    }
  });

  it('keeps movement, aggression and cadence numbers coherent', () => {
    for (const [key, archetype] of archetypeEntries) {
      expect(archetype.contactDamage, key).toBeGreaterThanOrEqual(0);
      // Nothing one-shots a full-Coherence player.
      expect(archetype.contactDamage, key).toBeLessThan(100);

      expect(archetype.moveSpeed, key).toBeGreaterThanOrEqual(0);
      expect(archetype.turnSpeed, key).toBeGreaterThan(0);

      expect(archetype.aggroRadius, key).toBeGreaterThan(0);
      expect(archetype.attackRadius, key).toBeGreaterThan(0);
      // Nothing attacks from beyond the range at which it visibly notices you.
      expect(archetype.attackRadius, key).toBeLessThanOrEqual(archetype.aggroRadius);

      expect(archetype.attackCooldown, key).toBeGreaterThan(0);
      // The cooldown must leave room for the wind-up to read as a wind-up.
      expect(archetype.attackCooldown, key).toBeGreaterThan(archetype.telegraphSeconds * 0.5);
    }
  });

  it('gives every projectile a positive speed, damage and radius', () => {
    const withProjectiles = archetypeEntries.filter(([, a]) => a.projectile !== undefined);
    expect(withProjectiles.length).toBeGreaterThan(0);

    for (const [key, archetype] of withProjectiles) {
      const projectile = archetype.projectile;
      if (projectile === undefined) continue;

      expect(projectile.speed, key).toBeGreaterThan(0);
      expect(projectile.damage, key).toBeGreaterThan(0);
      expect(projectile.radius, key).toBeGreaterThan(0);

      if (projectile.count !== undefined) {
        expect(projectile.count, key).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(projectile.count), key).toBe(true);
      }
      if (projectile.spreadRadians !== undefined) {
        expect(projectile.spreadRadians, key).toBeGreaterThanOrEqual(0);
        expect(projectile.spreadRadians, key).toBeLessThan(Math.PI);
      }
    }
  });

  it('resolves every spawner to an archetype that actually exists', () => {
    const spawners = archetypeEntries.filter(([, a]) => a.spawns !== undefined);
    expect(spawners.length).toBeGreaterThan(0);

    for (const [key, archetype] of spawners) {
      const spawns = archetype.spawns;
      if (spawns === undefined) continue;

      expect(Object.keys(ENEMY_ARCHETYPES), key).toContain(spawns.archetype);
      expect(ENEMY_ARCHETYPES[spawns.archetype], key).toBeDefined();
      // A spawner that spawns itself is an infinite fight.
      expect(spawns.archetype, key).not.toBe(archetype.id);
      expect(spawns.interval, key).toBeGreaterThan(0);
      expect(spawns.max, key).toBeGreaterThanOrEqual(1);
    }
  });

  it('has at least one spawner whose role is "spawner" and which emits Whisperers', () => {
    const spawnerRole = archetypeEntries.filter(([, a]) => a.role === 'spawner');
    expect(spawnerRole.length).toBeGreaterThan(0);

    const emitsWhisperers = spawnerRole.some(([, a]) =>
      (a.spawns?.archetype ?? '').startsWith('whisperer'),
    );
    expect(emitsWhisperers).toBe(true);
  });

  it('always gives armour a way through from the base kit', () => {
    const armoured = archetypeEntries.filter(([, a]) => (a.armour ?? 0) > 0);
    expect(armoured.length).toBeGreaterThan(0);

    for (const [key, archetype] of armoured) {
      const breakers = archetype.armourBreakers ?? [];
      expect(breakers.length, key).toBeGreaterThan(0);
      // Armour is a prompt to use the whole kit, never a form gate: every
      // armoured unit yields to a channel the untransformed Auralith produces.
      const reachable = breakers.some((kind) => BASE_KIT_BREAKERS.includes(kind));
      expect(reachable, `${key} armour cannot be broken by the base kit`).toBe(true);
    }
  });

  it('lets charge and counter be the common answers to armour', () => {
    const armoured = archetypeEntries.filter(([, a]) => (a.armour ?? 0) > 0);
    const chargeOrCounter = armoured.filter(([, a]) =>
      (a.armourBreakers ?? []).some((kind) => kind === 'charge' || kind === 'counter'),
    );
    expect(chargeOrCounter.length).toBe(armoured.length);
  });

  it('never lists armourBreakers on an unarmoured unit', () => {
    for (const [key, archetype] of archetypeEntries) {
      if ((archetype.armour ?? 0) === 0) {
        expect(archetype.armourBreakers ?? [], key).toHaveLength(0);
      }
    }
  });

  it('marks infected wildlife and guardians as cleansable, and only them', () => {
    const cleansable = archetypeEntries.filter(([, a]) => a.cleansable === true);
    expect(cleansable.length).toBeGreaterThanOrEqual(3);

    // The garden guardian is restored, not killed.
    expect(ENEMY_ARCHETYPES['infected-garden-guardian']?.cleansable).toBe(true);
    expect(ENEMY_ARCHETYPES['infected-garden-guardian']?.role).toBe('elite');

    // Detuner command units are invaders; they are never "restored".
    expect(ENEMY_ARCHETYPES['conductor-elite']?.cleansable).toBeUndefined();
    expect(ENEMY_ARCHETYPES['whisperer']?.cleansable).toBeUndefined();
  });

  it('gives every archetype a bestiary signal sample', () => {
    const samples = new Set<string>();
    for (const [key, archetype] of archetypeEntries) {
      expect(archetype.signalSampleId, key).toBeDefined();
      const sample = archetype.signalSampleId ?? '';
      expect(sample.length, key).toBeGreaterThan(0);
      expect(samples.has(sample), `duplicate signal sample '${sample}'`).toBe(false);
      samples.add(sample);
    }
  });

  it('includes the named units the vertical slice is authored against', () => {
    const required = [
      'whisperer',
      'whisperer-swarm',
      'spore-drifter',
      'glass-drifter',
      'root-fracture',
      'stone-fracture',
      'amplifier-pylon',
      'twin-amplifier',
      'thorn-pursuer',
      'bloom-spawner',
      'drifting-mine',
      'frequency-mimic',
      'conductor-elite',
      'infected-garden-guardian',
    ] as const;

    for (const id of required) {
      expect(ENEMY_ARCHETYPES[id], `missing archetype '${id}'`).toBeDefined();
    }
  });

  it('makes the drifting mine work as a moving obstacle as well as a creature', () => {
    const mine = ENEMY_ARCHETYPES['drifting-mine'];
    expect(mine).toBeDefined();
    expect(mine?.role).toBe('hazard');
    // It moves, and it is fragile enough to be cleared from range.
    expect(mine?.moveSpeed ?? 0).toBeGreaterThan(0);
    expect(mine?.health ?? Infinity).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

describe('BOSSES', () => {
  it('is a non-empty table whose keys match the boss ids and real stages', () => {
    expect(bossEntries.length).toBeGreaterThan(0);
    for (const [key, boss] of bossEntries) {
      expect(boss.id).toBe(key);
      expect(boss.displayName.length, key).toBeGreaterThan(0);
      expect(boss.title.length, key).toBeGreaterThan(0);
      expect(isStageId(boss.stageId), `${key} has an unknown stage`).toBe(true);
    }
  });

  it('gives every boss a positive health pool and a usable arena', () => {
    for (const [key, boss] of bossEntries) {
      expect(boss.health, key).toBeGreaterThan(0);
      expect(boss.bodyRadius, key).toBeGreaterThan(0);
      expect(boss.bodyHeight, key).toBeGreaterThan(0);
      expect(boss.arenaRadius, key).toBeGreaterThan(boss.bodyRadius * 2);
      expect(Number.isFinite(boss.arenaCentre.x), key).toBe(true);
      expect(Number.isFinite(boss.arenaCentre.y), key).toBe(true);
      expect(Number.isFinite(boss.arenaCentre.z), key).toBe(true);
    }
  });

  it('has descending healthThresholds starting at 1.0', () => {
    for (const [key, boss] of bossEntries) {
      expect(boss.phases.length, key).toBeGreaterThanOrEqual(2);

      const first = boss.phases[0];
      expect(first, key).toBeDefined();
      expect(first?.healthThreshold, `${key} phase 1 must start at full health`).toBe(1);

      for (let i = 1; i < boss.phases.length; i += 1) {
        const previous = boss.phases[i - 1];
        const current = boss.phases[i];
        if (previous === undefined || current === undefined) continue;

        expect(
          current.healthThreshold,
          `${key} phase ${current.index} does not descend`,
        ).toBeLessThan(previous.healthThreshold);
        expect(current.healthThreshold, key).toBeGreaterThan(0);
        expect(current.index, key).toBeGreaterThan(previous.index);
      }
    }
  });

  it('references only attack ids that exist on that boss, from every phase', () => {
    for (const [key, boss] of bossEntries) {
      const ids = new Set(boss.attacks.map((attack) => attack.id));
      expect(ids.size, `${key} has duplicate attack ids`).toBe(boss.attacks.length);

      for (const phase of boss.phases) {
        expect(phase.attackIds.length, `${key} phase ${phase.index} has no attacks`).toBeGreaterThan(
          0,
        );
        expect(phase.attackInterval, key).toBeGreaterThan(0);

        for (const attackId of phase.attackIds) {
          expect(
            ids.has(attackId),
            `${key} phase ${phase.index} references unknown attack '${attackId}'`,
          ).toBe(true);
        }
      }
    }
  });

  it('keeps every attack and its phase list mutually consistent', () => {
    for (const [key, boss] of bossEntries) {
      const phaseIndices = new Set(boss.phases.map((phase) => phase.index));

      for (const attack of boss.attacks) {
        expect(attack.phases.length, `${key}/${attack.id} belongs to no phase`).toBeGreaterThan(0);

        for (const index of attack.phases) {
          expect(
            phaseIndices.has(index),
            `${key}/${attack.id} claims a phase ${index} that does not exist`,
          ).toBe(true);

          const phase = boss.phases.find((candidate) => candidate.index === index);
          expect(
            phase?.attackIds.includes(attack.id),
            `${key} phase ${index} omits '${attack.id}' which claims that phase`,
          ).toBe(true);
        }
      }
    }
  });

  it('never telegraphs a boss attack in under 0.4s and always leaves a recovery window', () => {
    for (const [key, boss] of bossEntries) {
      for (const attack of boss.attacks) {
        const label = `${key}/${attack.id}`;
        expect(attack.displayName.length, label).toBeGreaterThan(0);
        expect(attack.telegraphSeconds, label).toBeGreaterThanOrEqual(0.4);
        expect(attack.telegraphSeconds, label).toBeLessThanOrEqual(3);
        expect(attack.durationSeconds, label).toBeGreaterThan(0);
        // A punishable recovery is what makes the loop telegraph/dodge/punish.
        expect(attack.recoverySeconds, label).toBeGreaterThanOrEqual(0.5);
        if (attack.weight !== undefined) {
          expect(attack.weight, label).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every boss at least one attack that opens a vulnerability window', () => {
    for (const [key, boss] of bossEntries) {
      const openers = boss.attacks.filter((attack) => attack.opensVulnerability === true);
      expect(openers.length, `${key} never opens up`).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every phase a punish window and a pattern that survives Story difficulty', () => {
    for (const [key, boss] of bossEntries) {
      for (const phase of boss.phases) {
        const attacks = phase.attackIds
          .map((id) => attackById(boss, id))
          .filter((attack): attack is BossAttackDef => attack !== undefined);

        // Story and Explorer disable `advancedOnly` layers; a phase must still
        // have a pattern, and must still hand the player a punish window.
        const basic = attacks.filter((attack) => attack.advancedOnly !== true);
        expect(basic.length, `${key} phase ${phase.index} is advanced-only`).toBeGreaterThan(0);

        const openers = basic.filter((attack) => attack.opensVulnerability === true);
        expect(
          openers.length,
          `${key} phase ${phase.index} offers no punish window on Story`,
        ).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('awards a valid form from each of the seven commanders, all distinct', () => {
    expect(commanders.length).toBe(7);

    const awarded: ResonanceFormId[] = [];
    for (const [key, boss] of commanders) {
      const form = boss.awardsForm;
      expect(form, `${key} awards no form`).toBeDefined();
      if (form === undefined) continue;

      expect(isResonanceFormId(form), `${key} awards an unknown form '${form}'`).toBe(true);
      expect(form, `${key} must not award the untransformed state`).not.toBe('base');
      awarded.push(form);
    }

    expect(new Set(awarded).size).toBe(awarded.length);
    expect(awarded.length).toBe(7);
  });

  it('maps each commander to a distinct stage', () => {
    const stages = commanders.map(([, boss]) => boss.stageId);
    expect(new Set(stages).size).toBe(stages.length);
  });

  it('awards nothing from a mini-boss', () => {
    expect(miniBosses.length).toBeGreaterThanOrEqual(2);
    for (const [key, boss] of miniBosses) {
      expect(boss.awardsForm, `${key} is a mini-boss and must award no form`).toBeUndefined();
    }
  });

  it('keeps restoration sequences inside the harmonic scale', () => {
    for (const [key, boss] of bossEntries) {
      const sequence = boss.restorationSequence;
      if (sequence === undefined) continue;

      expect(sequence.length, key).toBeGreaterThanOrEqual(3);
      for (const degree of sequence) {
        expect(Number.isInteger(degree), key).toBe(true);
        expect(degree, key).toBeGreaterThanOrEqual(0);
        expect(degree, key).toBeLessThan(HARMONIC_RATIOS.length);
      }
      // A retuning starts from the root: that is what "back to 432" means.
      expect(sequence[0], `${key} restoration must open on the root`).toBe(0);
    }
  });

  it('gives every commander a closing retuning sequence', () => {
    for (const [key, boss] of commanders) {
      expect(boss.restorationSequence, `${key} has no retuning`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Form advantages are advantages, never requirements
// ---------------------------------------------------------------------------

describe('BOSSES form advantages', () => {
  it('only ever lists finite multipliers at or above 1', () => {
    for (const [key, boss] of bossEntries) {
      const entries = Object.entries(boss.formAdvantages);
      for (const [form, multiplier] of entries) {
        const label = `${key}/${form}`;
        expect(isResonanceFormId(form), `${label} is not a real form`).toBe(true);
        expect(multiplier, label).toBeDefined();
        if (multiplier === undefined) continue;

        expect(Number.isFinite(multiplier), label).toBe(true);
        expect(multiplier, label).toBeGreaterThan(0);
        // At or above 1: a listed form is a bonus, never a penalty on the rest.
        expect(multiplier, label).toBeGreaterThanOrEqual(1);
        // And bounded, so no form ever trivialises a fight into a requirement.
        expect(multiplier, label).toBeLessThanOrEqual(MAX_FORM_ADVANTAGE);
      }
    }
  });

  it('never zeroes or penalises base-form damage', () => {
    for (const [key, boss] of bossEntries) {
      // The untransformed Auralith always deals its full, unmodified damage:
      // an unlisted form resolves to exactly 1, and `base` is never listed low.
      const base = advantageFor(boss, 'base');
      expect(base, `${key} modifies base damage`).toBe(1);

      for (const form of RESONANCE_FORM_IDS) {
        const multiplier = advantageFor(boss, form);
        expect(Number.isFinite(multiplier), `${key}/${form}`).toBe(true);
        expect(multiplier, `${key}/${form} is not a viable strategy`).toBeGreaterThan(0);
      }
    }
  });

  it('never advantages every form, so the advantage set is never the whole strategy space', () => {
    for (const [key, boss] of bossEntries) {
      const listed = Object.keys(boss.formAdvantages);
      expect(listed.length, `${key} advantages every form`).toBeLessThan(
        RESONANCE_FORM_IDS.length,
      );

      const unlisted = RESONANCE_FORM_IDS.filter((form) => boss.formAdvantages[form] === undefined);
      // At least two forms — always including `base` — win the fight with no
      // bonus whatsoever, which is the definition of "no form is required".
      expect(unlisted.length, `${key} leaves too few unaided strategies`).toBeGreaterThanOrEqual(2);
      expect(unlisted, `${key} must leave base unaided`).toContain('base');
    }
  });

  it('keeps the best form worth bringing without making it the only answer', () => {
    for (const [key, boss] of bossEntries) {
      const multipliers = RESONANCE_FORM_IDS.map((form) => advantageFor(boss, form));
      const best = Math.max(...multipliers);
      // The gap between the best form and no form at all stays inside a single
      // extra damage step: a good pick shortens the fight, it does not gate it.
      expect(best / advantageFor(boss, 'base'), key).toBeLessThanOrEqual(MAX_FORM_ADVANTAGE);
    }
  });
});

// ---------------------------------------------------------------------------
// The vertical slice
// ---------------------------------------------------------------------------

describe('vertical slice bosses', () => {
  it('opens the game with a two-phase Sanctuary mini-boss', () => {
    const boss = BOSSES['sanctuary-guardian'];
    expect(boss).toBeDefined();
    if (boss === undefined) return;

    expect(boss.stageId).toBe('fallen-sanctuary');
    expect(boss.isMiniBoss).toBe(true);
    expect(boss.phases).toHaveLength(2);
    expect(boss.awardsForm).toBeUndefined();
    // A grammar lesson: it must be readable, so nothing here is fast.
    for (const attack of boss.attacks) {
      expect(attack.telegraphSeconds, attack.id).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('gives the Fractured Garden a two-phase, four-plus-attack mini-boss', () => {
    const boss = BOSSES['virus-bloom'];
    expect(boss).toBeDefined();
    if (boss === undefined) return;

    expect(boss.stageId).toBe('fractured-garden');
    expect(boss.isMiniBoss).toBe(true);
    expect(boss.phases).toHaveLength(2);
    expect(boss.attacks.length).toBeGreaterThanOrEqual(4);
    expect(boss.awardsForm).toBeUndefined();
  });

  it('builds Oru as a three-phase commander that frees a friend', () => {
    const boss = BOSSES['oru-fractured-colossus'];
    expect(boss).toBeDefined();
    if (boss === undefined) return;

    expect(boss.stageId).toBe('fractured-garden');
    expect(boss.isMiniBoss).toBeUndefined();
    expect(boss.phases).toHaveLength(3);
    expect(boss.attacks.length).toBeGreaterThanOrEqual(6);
    expect(boss.awardsForm).toBe('echo');

    // Phase 1 teaches the language; phase 2 changes the arena; phase 3 is the
    // full 440 Hz state.
    const [first, second, third] = boss.phases;
    expect(first?.attackIds.length).toBeGreaterThanOrEqual(3);
    expect((second?.arenaFlags ?? []).length, 'phase 2 must change the arena').toBeGreaterThan(0);
    expect((third?.arenaFlags ?? []).length, 'phase 3 must change the arena').toBeGreaterThan(0);
    expect(third?.arenaFlags ?? []).toContain('arena-detuned');
    expect(second?.attackIds.length ?? 0).toBeGreaterThan(first?.attackIds.length ?? 0);
    expect(third?.attackIds.length ?? 0).toBeGreaterThan(first?.attackIds.length ?? 0);

    // At least two attacks hand the player a window.
    const openers = boss.attacks.filter((attack) => attack.opensVulnerability === true);
    expect(openers.length).toBeGreaterThanOrEqual(2);

    // The fight closes on a retuning, not a kill.
    expect(boss.restorationSequence?.length ?? 0).toBeGreaterThanOrEqual(4);

    // Several forms have a real edge; none is required.
    const advantaged = Object.keys(boss.formAdvantages);
    expect(advantaged.length).toBeGreaterThanOrEqual(3);
    expect(advantaged).not.toContain('base');
  });

  it('authors all seven World Lattice commanders, not placeholders', () => {
    const expected: readonly (readonly [string, ResonanceFormId])[] = [
      ['oru-fractured-colossus', 'echo'],
      ['the-prism-conductor', 'prism'],
      ['the-mnemonic-ray', 'tidal'],
      ['the-red-amplifier', 'ember'],
      ['the-many-mouthed-conductor', 'choir'],
      ['the-root-parasite', 'bloom'],
      ['the-sound-eater', 'silence'],
    ];

    for (const [id, form] of expected) {
      const boss = BOSSES[id];
      expect(boss, `missing commander '${id}'`).toBeDefined();
      if (boss === undefined) continue;

      expect(boss.awardsForm, id).toBe(form);
      expect(boss.phases.length, `${id} needs at least three phases`).toBeGreaterThanOrEqual(3);
      expect(boss.attacks.length, `${id} needs at least four attacks`).toBeGreaterThanOrEqual(4);
    }
  });
});
