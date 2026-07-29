# Gameplay systems

## Shape of a system

Every gameplay system is a plain function:

```ts
type System = (context: SimContext) => void;
```

It receives everything it needs through `SimContext` and reaches for nothing else — no globals,
no singletons, no constructing its own dependencies. That is what makes each one independently
testable: a test builds a context with a stub `PhysicsWorld` and asserts on the resulting
mutations to `MutableWorld`.

Ordering is decided by `createGameCore`, not by the systems themselves. A system never calls
another system.

## Step order, and why

```
1. forms         switch the equipped form first, so everything downstream sees the right one
2. stage         beat clock, moving platforms, rails, triggers, hazards, pickups, checkpoints
3. movement      resolve player motion against the world the stage system just updated
4. combat        firing, charging, burst, lock-on, aim, counter
5. projectiles   integrate and resolve every shot
6. enemies       perception, telegraphs, attacks, movement
7. boss          phases, attack selection, vulnerability, restoration
8. camera        write the camera intent from the settled world
```

The one ordering decision worth explaining: **the stage system runs before movement.** Moving
platforms must have advanced and written `player.platformVelocity` before the player is moved,
or the player drifts off a platform by however far it travelled that frame — at 3 m/s that is
5 cm per frame, which is visible and infuriating. The cost is that overlap checks (pickups,
triggers) use the previous frame's player position, a 16 ms latency nobody can perceive.

## Cross-cutting rules live in one place

Damage, spawning, shake, hit-stop and stage flags all route through `SimServices`. That is
deliberate: armour and armour-breakers, form advantages, invulnerability windows, difficulty
scaling and event emission are rules, and rules duplicated across callers drift. One
implementation means a change to how armour works changes it everywhere at once.

## Coherence, not health

The player has Coherence: how well they are still holding the World Chord against interference.

- Alien attacks reduce it. Difficulty scales incoming damage, never enemy health.
- Below `lowCoherenceThreshold` the presentation degrades — visual interference, audio detuning
  toward 440 Hz, unstable sacred geometry. The **controls never degrade**. Low Coherence must
  feel urgent, but a player must always be able to recover.
- It is restored by pickups, safe resonance zones, successful counters, cleansing enemies,
  certain forms, and checkpoints.
- At zero the player is downed and respawns at the active checkpoint.

## The Auralith

Base actions, all available from the first stage and all usable while moving and airborne:

- **Resonance Pulse** — fast, accurate, low recovery. Never gated on being grounded or on an
  animation finishing.
- **Charged Chord** — held fire crosses three readable tiers, each announced by sound *and* by a
  ring closing on the Auralith. Charged shots break armour that pulses cannot.
- **Harmonic Burst** — short-range radial push that interrupts, knocks back, and strikes nearby
  resonators.
- **Lock-On** — optional. It biases aim; it never takes it. Releases after the target is gone.
- **Resonance Counter** — a timed window that converts an incoming counterable shot into a
  player shot heading back at its sender, and restores Coherence. Communicated by sound, shape,
  rhythm and animation, and readable with sound off.

## Resonance Forms

Eight forms, each earned from a Commander's Frequency Core. The design rule is asserted in
tests, not merely documented:

> Every non-base form serves at least two distinct categories from {combat, movement,
> platforming, puzzle, secret, environment}, and must have at least one platforming-or-movement
> ability, one combat ability, and one secret-or-puzzle ability.

Forms are advantages, never gates. Every Commander can be beaten with the base Auralith — the
boss test suite asserts a base-form damage loop still reaches zero health. A form's advantage
changes *how* a fight goes, not whether it can be won.

Switching is instant: no cooldown, no animation lock. A system that punishes experimentation
does not get experimented with.

## Enemies

Nine roles, all driven from `EnemyArchetypeDef` data rather than bespoke code: scout, turret,
flyer, shield, pursuer, spawner, hazard, mimic, elite.

Framework rules that apply to all of them:

- **Perception is honest.** Aggro requires line of sight through a real raycast. Enemies do not
  see through walls.
- **Every attack telegraphs**, never below 0.35 s, and the telegraph writes
  `telegraphRemaining`/`telegraphTotal` so the renderer can draw a timing ring. An attack the
  player cannot read is a bug, not a difficulty setting.
- **Difficulty changes cadence, not health.** `enemyAggressionScale` shortens gaps between
  attacks. Inflating health makes a fight longer, not different.
- **Cleansing, not killing.** Infected wildlife and guardians are `cleansable`: they pass
  through a restoration beat and are returned, not destroyed. This is a story point, and the
  code honours it.
- Enemies are placed to pressure movement, teach timing, alter routes and guard secrets —
  never scattered on platforms at random.

## Bosses

A data-driven runtime plays any `BossDef`. Structure:

- **Phase 1** teaches the attack language.
- **Phase 2** adds movement pressure and changes the arena via `arenaFlags`.
- **Phase 3** is the full 440 Hz corruption state.
- **Restoration** — at zero health the Commander does not die. It enters a retuning sequence:
  the player plays back a series of harmonic degrees, and the Commander is freed.

Attack selection is weighted, seeded, and guaranteed varied — the same attack never fires three
times running. Attacks marked `advancedOnly` appear from Standard difficulty upward. Attacks
with `opensVulnerability` give a guaranteed punish window during recovery, which is what makes
the fights fair rather than merely hard.

## Stages

Stages are `StageDef` data. The runtime provides:

- A **beat clock** from `bpm`. Rhythmic hazards and platforms sync to it, and the accessibility
  layer draws it.
- **Five platform motions**: linear (with pause), orbit, vertical, rhythm (steps on the beat),
  and collapse (falls after being stood on, returns later).
- **Rails** — grindable resonance lines, some requiring a specific form.
- **Hazards** with optional rhythm windows and optional `clearedBy` forms, so returning with a
  new power permanently opens a route.
- **Four puzzle kinds**: sequence, simultaneous, echo, sustain. Several are unsolvable on a
  first visit by design — the reason to come back.
- **Checkpoints** after major platforming, before and after mini-bosses, and before Commanders.
  Failure never costs more than a short retry.
- **Restoration** — defeating a Commander drives the region's infection to zero, and every
  surface, light and layer of music transforms at once.

## Ranking

Stage completion scores time against par, Coherence retained, damage taken, secrets found,
enemies cleansed, counter accuracy, flow ratio (time spent above the flow speed threshold) and
ability variety, then maps the total to D–S.

Ranks encourage replay. They never block progress, and nothing in the story is gated behind one.
