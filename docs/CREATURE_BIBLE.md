# Creature bible

The authoritative data is `packages/game-content/src/enemies.ts` (20 archetypes) and `bosses.ts`
(9 encounters). This document explains the design behind them; where the two disagree, the data is
right and this file needs updating.

## Implementation status

**Built:** all 20 archetypes and 9 guardian definitions, the nine-role behavioural framework, and
procedural models for the six Detuner families plus Oru and the Virus Bloom. 36 bestiary
assertions and 28 enemy-framework assertions pass. **Not built:** bespoke models for the six
guardians beyond Oru and the Virus Bloom — they use a readable generic commander form.

---

## What the Detuners are

An alien resonance virus given bodies. Angular obsidian-and-violet crystal, glowing violet cores,
single luminous eyes. They should read as **grown into** a place rather than built for it — wrong
against the world's warm stone and gold, and wrong in a way that is visible before it is dangerous.

They are not soldiers. There is no Detuner society. They are what the virus assembles when it has
enough matter to work with, which is why they repeat: the same shapes, the same angles, the same
insect economy of movement, everywhere the infection reaches.

## The six families

| Family | Reads as | Behavioural roles |
| --- | --- | --- |
| **Whisperers** | small, low, skittering shards | scout |
| **Drifters** | dart-shaped, bladed fins, airborne | flyer |
| **Fractures** | heavy, plated, exposed glowing core | shield, pursuer |
| **Amplifiers** | squat pylons, rotating emitter | turret |
| **Conductors** | robed, crystal-topped stave | elite, spawner |
| **Corrupted wildlife** | native creatures caught in it | pursuer, hazard, mimic |

That last row is the important one. Corrupted wildlife are **not Detuners** — they are the region's
own creatures, and they are `cleansable`.

## The roster

Drawn from `enemies.ts`. Numbers there are stated against the player's baseline: 100 Coherence, a
10-damage pulse every 0.14 s, charge tiers of 26 / 52 / 92.

**Whisperers** — `whisperer` (the first Detuner the player ever meets; a fist-sized shard body on
four folded legs, skitters in short arcs and stops to listen; three pulses kill it, and its whole
job is to teach that enemies wind up before they lunge), `whisperer-swarm`.

**Drifters** — `spore-drifter`, `glass-drifter`, `sanctum-moth`.

**Fractures** — `root-fracture`, `stone-fracture`. Plated brutes with the core visible on the
front, which is the point: the weak spot is legible and the plating is a prompt to use the charge
or the counter rather than a wall.

**Amplifiers** — `amplifier-pylon`, `twin-amplifier`, `mirror-pylon`. Stationary broadcasters. They
define where the player cannot stand still.

**Pursuers** — `thorn-pursuer`, `bramble-hound`. Relentless, but with a **capped turn rate** so they
can be out-manoeuvred. A pursuer the player cannot escape is a timer, not an enemy.

**Spawners** — `bloom-spawner`, `chorus-seed`. Emit children up to a cap; cleansing the spawner
stops production, which turns a fight into a priority decision.

**Hazard creatures** — `drifting-mine`, `dissonance-bloom`. Both threat and moving obstacle. They
do not chase.

**Mimics** — `frequency-mimic`, `false-shard`. Copy the player's equipped ability and fire it back,
turning the player's own loadout into the puzzle.

**Elites** — `conductor-elite`. Multi-phase, alternating ranged and closing patterns with a stagger
window after a heavy attack. A small guardian without a health bar.

**Corrupted guardians** — `infected-garden-guardian`. Cleansable. A protector of the region caught
in the infection, restored rather than destroyed.

## Framework rules the code enforces

These are not aspirations — the enemy framework applies them to every archetype, and the tests
assert them.

**Perception is honest.** Aggro requires a line-of-sight raycast. Enemies never see through walls,
and they hold a target for a short grace period after losing sight rather than snapping between
omniscience and amnesia.

**Every attack telegraphs**, never under **0.35 s**, and writes `telegraphRemaining` and
`telegraphTotal` so the renderer can draw a filling ground ring. An attack the player cannot read
is a bug, not a difficulty setting.

**`attackRadius` never exceeds `aggroRadius`.** Nothing shoots from outside the range at which it
visibly noticed you.

**Difficulty changes cadence, never health.** `enemyAggressionScale` shortens the gaps between
attacks. Enemy health is identical on Story and on Resonance Master, because a longer fight is not
a harder one — it is just longer, and a player who wants an easier game is badly served by one.

**Armour is a prompt, never a gate.** Every armoured unit yields to `charge` or `counter`, both
base-Auralith verbs. A player who has found no abilities at all can still break everything.

**Cleansing, not killing.** Corrupted wildlife and guardians pass through a visible restoration
beat at zero health — violet draining to green — and are restored. This is the story's central
claim and the code honours it rather than leaving it to dialogue.

**Status effects have counterplay.** `rootedRemaining` stops movement (Bloom Wave),
`silencedRemaining` stops attacks (Silence Field), `staggerRemaining` opens a punish window.

## Guardians

One data-driven runtime plays every `BossDef` — there is no per-guardian code, so a new guardian is
a data change and inherits every guarantee below.

**Three acts, because it teaches before it tests.** Phase 1 establishes a small attack vocabulary
with generous telegraphs. Phase 2 raises movement demands and changes the arena through
`arenaFlags`. Phase 3 is the full 440 Hz state — everything learned, at speed, plus what was held
back.

**Then restoration.** At zero health the guardian does not die. It enters a retuning sequence: the
player plays back its `restorationSequence` of harmonic degrees, the Amplifier is separated, and the
guardian is freed.

**Guaranteed variety.** Attack selection is weighted and seeded, and the same attack can never fire
three times in a row.

**Guaranteed punish windows.** Attacks flagged `opensVulnerability` leave the guardian open during
recovery. Every guardian has at least one, asserted in tests. A guardian without one is a war of
attrition rather than a fight.

**Advantage, never a gate.** `formAdvantages` multiplies damage for particular abilities, always at
or above 1. The test suite asserts a base-Auralith-only damage loop still reduces every guardian to
zero, so no encounter is a lock waiting for a key.

The roster: `sanctuary-guardian` and `virus-bloom` (mini-bosses, award nothing), then Oru, the
Prism Conductor, the Mnemonic Ray, the Red Amplifier, the Many-Mouthed Conductor, the Root Parasite
and the Sound Eater — seven guardians awarding seven distinct abilities, asserted so the
progression cannot silently break.

### Oru

The one to get right, because it sets the tone for all of them.

Oru held the Fractured Garden together for centuries by repeating one phrase. An alien Amplifier was
driven into its back and the phrase became a broadcast.

The **fusion must be visible**: warm stone and root forms strangled by violet crystal, with violet
running through the stone like a crack. The player should want to free it before any dialogue says
so. Ending the fight by playing a chord rather than landing a final blow is the difference between
the story the game tells and the story its verbs would otherwise tell.

## Designing a new creature

- One bold silhouette. If it does not read as a black shape, redesign it.
- State what it teaches. A creature that teaches nothing is decoration with a health bar.
- Telegraph in at least two channels — shape and timing at minimum, because sound is never
  load-bearing.
- Give it a counterplay the base Auralith can perform.
- Decide whether it is a Detuner or a victim. If it is native to the region, it is probably
  cleansable, and that changes how the player should feel about meeting it.
- Original throughout. No creature may echo an existing game's bestiary in design, name or role.
