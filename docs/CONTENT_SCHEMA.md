# Content schema

The authoring reference. Content in TUNER is **data, not code** — a region is a set of exported
objects, and the runtime plays whatever it is handed. This document is what you would need to author
a new region without reading the runtime.

Types live in `packages/game-core/src/content-types.ts` (the playable space) and
`adventure-types.ts` (the adventure layer). Where this document and those files disagree, the files
are right.

## The two layers

`StageDef` is the **playable space**: geometry, platforms, rails, hazards, enemies, pickups,
resonators, puzzles, doors, triggers, checkpoints, cutscenes, tutorials.

`ZoneDef` is a region: a `StageDef` **plus its inhabitants** — NPCs, dialogue, quests, temples,
shrines, map markers, codex entries and motif cards.

The split is deliberate and additive. Adding the adventure layer did not invalidate a single
authored stage.

## The rule that makes this safe

> **The mesh is the collider.**

`@tuner/game-core` and `@tuner/rendering` read the *same* `StageDef`. Every drawn piece takes its
shape, position, yaw and half-extents from the exact record the solver reads — including the wedge
for `ramp` colliders, which the renderer builds by clipping against the same `y = slope * z` plane
the physics separates against.

There is no separate visual authoring path and no fudge factors, because a renderer that "roughly"
matches the collision produces invisible walls and phantom ledges, which is the worst bug class a
3D game can ship.

## Movement numbers — author against these

Every gap must be crossable with the abilities available **at that point** in the region.

| | |
| --- | --- |
| Player capsule | 0.36 m radius, 1.6 m tall |
| Run / sprint | 8.6 / 12.4 m/s |
| Jump height | 3.05 m |
| Double jump | adds ~2.5 m |
| Dash | 24 m/s for 0.17 s ≈ 4 m of travel; one air dash |
| Step height | 0.42 m (walked over without jumping) |
| Max walkable slope | 52° |

Which gives the two numbers a designer actually uses:

- **A running jump clears roughly 6–7 m horizontally.**
- **A jump plus air dash clears roughly 10–11 m.**

Comment your reasoning on any gap over 6 m. A gap authored before the tutorial that teaches double
jump must be single-jump crossable, and the tests check declared traversal pairs against these
numbers — so an unreachable gap fails a test rather than a play-through.

## StageDef

| Field | Meaning |
| --- | --- |
| `id` | a `StageId` from the fixed union in `@tuner/shared` |
| `infection` | starting infection, 0–1. Drives materials, lighting, sky, audio tuning and HUD |
| `bpm` | the region's rhythm. Rhythmic hazards and platforms sync to it |
| `spawnPoint`, `spawnYaw` | where the player begins |
| `killPlaneY` | below this, the player is returned to the active checkpoint |
| `ambience` | sky, fog, sun and ambient colours, plus a `restored` variant |
| `parSeconds` | target completion time, used to grade results |
| `secretTotal` | must equal the count of `isSecret` pickups — asserted |

### Geometry

`GeometryDef` — `shape` (`box`, `sphere`, `capsule`, `ramp`), `position`, `yaw`, `layer`, `style`
(a `SurfaceStyle`), `friction`, `bounce`. Plus three visibility gates that make restoration real:

- `revealedBy` — hidden until an ability is equipped
- `onlyWhenRestored` — appears when the region is restored
- `hiddenWhenRestored` — disappears when it is

Those last two are how restoration opens routes that were genuinely not there before, rather than
recolouring the old ones.

### Moving platforms

`MovingPlatformDef` adds `motion` and an optional `phase` (0–1) for staggering a row. Five kinds:

- `linear` — to a point and back, with an optional `pause` at each end
- `orbit` — around a `centre` at a `radius`
- `vertical` — a sine of `amplitude`
- `rhythm` — steps one position **on the beat**, so it reads as part of the region's rhythm
- `collapse` — falls `delaySeconds` after the player stands on it, returns after `respawnSeconds`

### Rails, hazards, doors, triggers

`RailDef` — an ordered polyline, a grind `speed`, an optional `requiresForm`.

`HazardDef` — `damage`, `damageKind`, an optional `rhythm` block (`beats`, `activeBeats`, `offset`)
so it pulses with the region, an optional `clearedBy` ability that removes it permanently, and
`isPit` for non-damaging respawns.

`DoorDef` — solid until `openedByFlag` is set.

`TriggerDef` — fires on player overlap, `once` by default. Actions: `spawnWave`, `objective`,
`cutscene`, `phase`, `vista`, `tutorial`, `setFlag`.

### Resonators and puzzles

A `ResonatorDef` has a harmonic `degree`, a `puzzleId`, an `order` for sequences, a `holdSeconds`
lit window, and an optional `requiresForm`.

`PuzzleDef.kind` is one of four:

- `sequence` — degrees struck in `order`; a wrong note resets and emits `puzzle:failed`
- `simultaneous` — every resonator lit at the same instant
- `echo` — a resonator struck twice inside its hold window (what Echo Pulse is for)
- `sustain` — all lit continuously for a duration

Rewards: `openDoor`, `spawnPlatforms`, `revealSecret`, `setFlag`.

**No mandatory puzzle may depend on hearing.** Every resonator's degree is drawn as a ring and every
rhythmic element is visualised. State in a comment how each puzzle reads muted.

## ZoneDef — the adventure layer

`NpcDef` — `appearance` (a procedural model key), a `routine` (`idle`, `patrol`, `work`, `follow`),
`dialogue` tree ids, `requiresFlag`/`hiddenByFlag` for arrivals and departures, and
`restoredAppearance`/`restoredDialogue` because **every NPC must change after their region is
restored**.

`DialogueTree` — ordered `beats` (speaker, text, emote, seconds), optional `choices`,
`requiresFlag`/`consumedByFlag` so a hint does not repeat forever, and effects on completion:
`setsFlagOnComplete`, `grantsAbility`, `startsQuest`, `completesQuest`. `cinematic` takes the camera;
ambient chatter does not. Every tree must be skippable.

`QuestDef` — ordered `steps`, each with an `objective` line and a `condition`. The seven condition
kinds: `flag`, `reachArea`, `collect`, `cleanse`, `solvePuzzle`, `defeatBoss`, `talkTo`. Optional
steps never block.

`TempleDef` — `teaches` an ability, and `rooms` each naming a `TempleBeat`. All ten beats
(`introduce`, `experiment`, `traversal`, `combat`, `pressure`, `central`, `secret`, `miniboss`,
`recontextualise`, `guardian`) must be present in curriculum order — asserted, so the teaching
structure is structural rather than aspirational. Plus a `restorationChord`.

`ShrineDef` — optional, never required. `acceptsComposition` marks a shrine that takes a
player-authored composition rather than a fixed answer.

`MapMarkerDef` — `discoveredByTriggerId` gates most markers, because the map is a **record of where
you have been**, not a guide to where to go.

`CodexEntryDef` — categorised (`world`, `people`, `creatures`, `resonance`, `memory`), gated by
`unlockedByFlag`. Locked entries display as unknown rather than being hidden, so the player can see
there is more to find.

`MotifCardDef` — a `layer` (rhythm/bass/harmony/melody) and `steps` of harmonic degrees (`null` is a
rest). Motifs are **found, not invented**: the world teaches you its phrases, and Composition Mode
is where you answer back with them.

## Ability ids are save keys

The eight ids — `echo`, `prism`, `tidal`, `ember`, `choir`, `bloom`, `silence`, `celestial` — appear
verbatim in save files and in authored content (`requiresForm`, `clearedBy`, `revealedBy`).
**Never rename one.** Player-facing names live in `ABILITY_NAMES` and can change freely.

## Invariants the tests enforce

Every region's test file asserts, programmatically over the data:

1. **Referential integrity** — no dangling trigger, puzzle, resonator, door, rail, checkpoint,
   archetype or boss id anywhere; no duplicate ids.
2. `secretTotal` equals the actual `isSecret` count.
3. Checkpoint orders unique and ascending, with one before and one after each mini-boss and one
   before each guardian.
4. `killPlaneY` below all geometry; the spawn point above walkable geometry.
5. Declared traversal pairs within reach of the movement numbers above.
6. At least two secrets requiring an ability unavailable on a first visit.
7. Every puzzle's resonators exist and every resonator's puzzle exists.

This is not ceremony. An independent validation pass on the Fallen Sanctuary caught a spawn
referencing a non-existent `amplifier` archetype (the real id is `amplifier-pylon`) and a secret
ledge missing its `revealedBy` gate — a crash at load and an unearnable collectible, both found by
assertions rather than by playing.

## Authoring a new region

1. Add its `StageId` if it is not already in the union.
2. Author the `StageDef`: geometry first, walk it mentally against the movement numbers, then
   hazards, then population.
3. Write the test file **before** finishing the content. The referential-integrity and traversal
   assertions will catch more than review will.
4. Author the `ZoneDef` on top: who lives here, what they want, what is worth finding.
5. Author the `TempleDef` with all ten beats.
6. Set both ambience variants. A region that does not visibly change when restored has missed the
   point of the game.
