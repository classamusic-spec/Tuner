# Boss bible

The authoritative data lives in `packages/game-content/src/bosses.ts`; the runtime that plays it
is `packages/game-core/src/systems/boss.ts`. This document explains the design.

## One runtime, many bosses

There is no per-boss code. A `BossDef` declares phases, attacks, thresholds, arena flags, form
advantages and a restoration sequence; the runtime plays whatever it is handed. That means a new
Commander is a data change, and every boss automatically inherits the guarantees below.

## Structure

Every Commander follows the same three-act shape, because it teaches before it tests:

- **Phase 1 — the language.** A small vocabulary of attacks with generous telegraphs. The player
  is being taught to read this specific creature.
- **Phase 2 — pressure.** Movement demands rise and the arena itself changes via `arenaFlags`
  (platforms collapse, the floor floods, the geometry folds). The vocabulary from Phase 1 is
  reused under harder conditions.
- **Phase 3 — full corruption.** The 440 Hz state. Everything the player learned, at speed, plus
  the attacks held back for this moment.
- **Restoration.** At zero health the Commander does not die.

## Restoration

This is the part that makes the fights *this game's* fights.

When a Commander's health reaches zero it enters `restoring`, and the player must play back its
`restorationSequence` — a series of harmonic degrees — on the Auralith. Each correct degree
advances `restorationStep`; a wrong one does not. Completing the sequence frees the Commander,
recovers its Frequency Core, and transforms the region.

Oru, the Fractured Colossus, was a protector of the Fractured Garden before an alien Amplifier
was fused into it. The fight should read as freeing a friend. Ending it by playing a chord
rather than landing a final blow is the difference between the story the game tells and the
story its verbs would otherwise tell.

## Guarantees the runtime enforces

**Telegraphs are readable.** `telegraphSeconds` is at least 0.4 s on every boss attack, and
`telegraphRemaining` / `telegraphTotal` are written every step so the renderer draws a filling
timing ring and an attack-shape preview. Boss fights must be winnable with the sound off.

**Recovery windows are real.** Attacks flagged `opensVulnerability` leave the boss open during
recovery. Every boss has at least one, asserted in tests. A boss with no punish window is a
war of attrition, not a fight.

**Variety is guaranteed, not hoped for.** Attack selection is weighted and seeded, and the same
attack can never fire three times in a row. Determinism means a given seed replays exactly,
which is what makes the fights testable.

**Difficulty changes cadence, not health.** `enemyAggressionScale` tightens the gaps.
`advancedOnly` attacks appear from Standard upward. Boss health is identical on every setting.

**Form advantages are advantages.** `formAdvantages` multiplies damage for particular forms, and
the multiplier is always at or above 1 — a form can make a fight shorter or open a different
tactic, but it never opens a door that was otherwise shut. The test suite asserts that a
base-Auralith-only damage loop still reduces every Commander to zero. There is no required
order, and no boss is a lock waiting for a key.

**Bosses stay in their arena.** Movement is clamped to `arenaRadius` around `arenaCentre`, and
the camera's boss mode frames the whole arena so both combatants stay visible.

## The roster

| Encounter | Region | Awards |
| --- | --- | --- |
| Sanctuary Guardian *(mini)* | Fallen Sanctuary | — teaches the attack language |
| The Virus Bloom *(mini)* | Fractured Garden | — seed-mines and infected walls |
| **Oru, the Fractured Colossus** | Fractured Garden | Echo Form |
| **The Prism Conductor** | Glass Meridian | Prism Form |
| **The Mnemonic Ray** | Tidal Archive | Tidal Form |
| **The Red Amplifier** | Ember Observatory | Ember Form |
| **The Many-Mouthed Conductor** | Hollow Choir | Choir Form |
| **The Root Parasite** | Verdant Machine | Bloom Form |
| **The Sound Eater** | Desert of Lost Notes | Silence Form |

Seven Commanders award seven distinct forms — asserted, so the progression cannot silently break.

## Mini-bosses

Mini-bosses use the same runtime with `isMiniBoss` set and award no form. They exist to test the
stage's mechanic under pressure before the Commander tests everything at once.

## Verification

`bestiary.test.ts` asserts across the whole table: descending health thresholds starting at 1.0;
every phase referencing only attacks that exist on that boss; at least one vulnerability-opening
attack per boss; valid, distinct awarded forms across the seven Commanders; and finite form
advantages that never zero out base-form damage. **36/36 passing.**

The boss runtime's own suite covers phase transitions at the configured thresholds, arena flags
applied on entry, weighted selection with the no-three-in-a-row rule, `advancedOnly` exclusion,
exact telegraph/active/recovery timing, vulnerability windows opening and closing, aggression
scaling leaving health untouched, form advantage multiplying damage while base form still wins,
the restoration sequence accepting correct degrees and rejecting wrong ones, and determinism
under a fixed seed.
