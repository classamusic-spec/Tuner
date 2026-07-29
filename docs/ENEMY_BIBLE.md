# Enemy bible

The authoritative data lives in `packages/game-content/src/enemies.ts`. This document explains
the design behind it; where the two disagree, the data is right and this file needs updating.

## What the Detuners are

An alien resonance virus given bodies. Angular obsidian-and-violet crystal, glowing violet
cores, single luminous eyes. They should read as *grown into* a place rather than built for it —
wrong against the world's warm stone and gold.

Six families map onto the nine behavioural roles the framework instantiates.

| Family | Reads as | Roles |
| --- | --- | --- |
| Whisperers | small, low, skittering shards | scout |
| Drifters | dart-shaped, bladed fins, airborne | flyer |
| Fractures | heavy, plated, glowing core | shield |
| Amplifiers | squat pylons, rotating emitter | turret |
| Conductors | robed, crystal-topped stave | elite, spawner |
| Corrupted wildlife | native creatures caught in the infection | pursuer, hazard, mimic |

## The nine roles

Each role is a behaviour the framework provides; an archetype is data that selects and tunes it.

- **Scout** — patrols, closes distance on sight, and *alerts nearby units*. The scout is an
  information channel: killing it quietly is a real tactical choice.
- **Turret** — stationary, rotates to face, fires telegraphed volleys. Turrets define where the
  player cannot stand still.
- **Flyer** — hovers above, strafes, dives. Flyers pressure the *jumping* route specifically,
  which is what stops platforming sections from being safe havens.
- **Shield** — advances behind frontal armour that only yields to specific damage channels
  (usually `charge` and `counter`), and exposes an opening after its own attack. It exists to
  make the player use the whole kit rather than tapping fire.
- **Pursuer** — chases relentlessly through platforming, but with a *capped turn rate*, so it can
  be out-manoeuvred. A pursuer the player cannot escape is a timer, not an enemy.
- **Spawner** — emits children up to a cap; cleansing it stops production. It converts a fight
  into a priority decision.
- **Hazard creature** — moves along a route as both threat and moving platform obstacle. It does
  not chase.
- **Frequency Mimic** — copies the player's equipped Resonance Form and fires it back. It turns
  the player's own loadout into the puzzle.
- **Elite** — multi-phase, alternating ranged and closing patterns with a stagger window after a
  heavy attack. A small boss without a health bar.

## Rules the framework guarantees

**Perception is honest.** Aggro requires a line-of-sight raycast. Enemies never see through
walls, and they keep a target for a short grace period after losing sight rather than snapping
to omniscience or to amnesia.

**Every attack telegraphs**, never under 0.35 s, and writes `telegraphRemaining` /
`telegraphTotal` so the renderer can draw a ground-projected timing ring. An attack the player
cannot read is a bug, not a difficulty setting.

**Difficulty changes cadence, never health.** `enemyAggressionScale` shortens the gaps between
attacks. Enemy health is identical on Story and on Resonance Master — because a longer fight is
not a harder one, it is just a longer one.

**`attackRadius` never exceeds `aggroRadius`.** Nothing shoots at the player from outside the
range at which it visibly noticed them.

**Armour is a prompt, never a gate.** Every armoured unit yields to `charge` or `counter`, both
base Auralith verbs. A player who has found no Resonance Forms can still break everything.

**Cleansing, not killing.** Corrupted wildlife and guardians are `cleansable`: at zero health
they pass through a visible restoration beat and are *restored*. This is the story's central
claim — the world is sick, not evil — and the code honours it rather than leaving it to
dialogue.

**Status effects have counterplay.** `rootedRemaining` stops movement, `silencedRemaining` stops
attacks (this is how Silence Form works), `staggerRemaining` opens a punish window.

## Placement

Enemies are never scattered on platforms. Every cluster exists to do one of:

- **Pressure movement** — a flyer over a gap turns a jump into a decision.
- **Teach timing** — an isolated turret with a long telegraph is a lesson.
- **Alter routes** — a shield unit in a corridor makes the side route worth finding.
- **Guard secrets** — `guardsSecret` ties a reward to an encounter.
- **Combine with hazards** — an enemy that pushes the player toward a rhythmic hazard.
- **Encourage ability switching** — a mimic, or a group that punishes one answer.

## Verification

`bestiary.test.ts` asserts, over the whole table rather than by hand: all nine roles are
represented; every archetype has positive health, sane radii and `telegraphSeconds >= 0.35`;
every projectile archetype has positive speed and damage; every spawner's child archetype
actually exists; and no armoured unit lacks armour-breakers. **36/36 passing.**
