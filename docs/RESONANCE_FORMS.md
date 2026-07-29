# Resonance Forms

The authoritative data lives in `packages/game-core/src/systems/forms-registry.ts`; the runtime
hooks are in `forms.ts`. This document explains the design rules those files must satisfy.

## What a form is

Every Detuner Commander has taken a Frequency Core and bent it to 440 Hz. Freeing the Commander
recovers the Core, and the Auralith learns to hold that frequency. A form is therefore a
*capability*, not a weapon skin — it changes how the Tuner moves, fights, solves and explores.

## The design rules, which are asserted rather than promised

`forms.test.ts` checks these programmatically over the whole registry:

1. Every non-base form serves at least **two distinct categories** from {combat, movement,
   platforming, puzzle, secret, environment}.
2. Every non-base form has at least one **platforming-or-movement** ability, at least one
   **combat** ability, and at least one **secret-or-puzzle** ability.
3. Every form has a **distinct** accent colour, icon, silhouette and sound family. No two forms
   may look, read or sound alike.
4. Switching is **instant** — no cooldown, no animation lock. A system that punishes
   experimentation does not get experimented with.

A rule stated in a document is a hope. A rule stated in a test is a guarantee, and these are the
guarantees that stop the roster from collapsing into eight recoloured guns.

## The roster

| Form | From | Does |
| --- | --- | --- |
| **Echo** | Oru, the Fractured Colossus | Pulses repeat after a delay; activates switch sequences one player cannot reach alone; builds temporary echo platforms; reveals invisible objects; strikes twice; records and repeats puzzle patterns |
| **Prism** | The Prism Conductor | Reflects projectiles; redirects beams; splits a shot into angled shots; creates reflective surfaces; steers light platforms; exposes invisible crystalline enemies |
| **Tidal** | The Mnemonic Ray | Flowing resonance streams; underwater movement; temporary water rails; pushes enemies and objects; conducts sound through water; quenches volcanic hazards |
| **Ember** | The Red Amplifier | Explosive charged note; powers thermal machinery; launches upward from heat vents; burns alien growth; melts barriers; raises short-lived air currents |
| **Choir** | The Many-Mouthed Conductor | Splits a signal into harmonised copies; decoy performers; activates several mechanisms at once; strikes from several angles; sustains multiple notes; reveals hidden voices |
| **Bloom** | The Root Parasite | Grows plant platforms; cleanses infected wildlife; vines for swinging; restores organic mechanisms; roots enemies; regenerates Coherence in the right conditions |
| **Silence** | The Sound Eater | A silence field; stops frequency projectiles; disables sound-sensitive enemies; reveals signals under interference; opens stealth routes; freezes rhythm hazards |
| **Celestial** | Late unlock | Combines restored World Chord fragments; short-range teleport through resonance points; low-gravity air control; advanced charge; the final celestial mechanisms |

Plus **base** — the untransformed Auralith, which is never inadequate. Every Commander is
beatable with it.

## How forms attach to the simulation

A form implements optional hooks (`FormBehaviour`) and nothing else:

- `onFire` — modify the shot just created. Echo sets repeats; Prism sets bounces; Choir spawns
  additional angled shots.
- `onStep` — passive effects while equipped. Bloom's conditional Coherence regeneration,
  Celestial's low-gravity air control, Silence's field.
- `onProjectileEnd` — react when a shot expires or lands. Echo spawns its platform here.
- `onBurst` — react to a Harmonic Burst. Bloom roots; Silence silences; Ember detonates.

Forms cannot reach outside these hooks. That constraint is what keeps eight sets of special
behaviour from turning the combat system into a switch statement.

## Advantage, never a gate

Bosses declare `formAdvantages` — damage multipliers, always at or above 1. A form can make a
fight shorter or open a different tactic. It can never be required.

There is no rigid stage order. After the introductory stage, several regions open at once, and
the "recommended forms" shown on the World Lattice are suggestions the player is free to ignore.
The reward for experimenting is finding a better answer, not being permitted to proceed.

## Why revisiting works

Roughly a third of each stage's secrets need a form the player cannot have on their first visit:
an Echo puzzle that needs two switches lit at once, a lava channel that only Tidal quenches, an
alien growth only Ember burns, a rhythm hazard only Silence freezes.

This is authored deliberately in the stage data (`requiresForm`, `clearedBy`, `revealedBy`), and
the stage tests assert the counts. Coming back to the Fractured Garden with Echo Form is not a
completionist chore — it is the stage revealing a layer that was visibly there the whole time.

## Upgrades

Resonance Shards buy per-form upgrades that change behaviour rather than adding percentages. An
upgrade that reads "+5% damage" is not worth the menu it sits in.
