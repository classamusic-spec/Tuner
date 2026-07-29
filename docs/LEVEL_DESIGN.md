# Level design

## Stages are data

A stage is a `StageDef` object — geometry, moving platforms, rails, hazards, enemies, pickups,
resonators, puzzles, doors, triggers, checkpoints, cutscenes and tutorials. There is no
per-stage code.

The consequence that matters most: `@tuner/game-core` and `@tuner/rendering` read *the same*
descriptor. The mesh the player sees is built from the same data as the collider they hit, so
invisible walls — the worst class of platformer bug — are impossible by construction rather than
by discipline.

## Authoring against real numbers

Every gap is authored against the actual controller, not by eye:

- Capsule: 0.36 m radius, 1.6 m tall
- Run 8.6 m/s, sprint 12.4 m/s
- Jump 3.05 m; double jump adds ~2.5 m
- Dash 24 m/s for 0.17 s ≈ 4 m of travel; one air dash

Which gives the two numbers a designer actually uses: **a running jump clears roughly 6–7 m; a
jump plus air dash clears roughly 10–11 m.**

Stage test files declare traversal pairs on the critical path and assert each is within range.
An unreachable gap fails a test, not a play-through. A gap placed *before* the tutorial that
teaches double jump must be single-jump crossable, and that is checked too.

## The stage skeleton

Every main stage runs the same sixteen beats, because the shape teaches, escalates and rests in
the right order:

1. Opening vista — show the destination
2. Safe movement introduction
3. First enemy encounter
4. The stage's signature environmental mechanic
5. Platforming escalation
6. Combat and platforming combined
7. Optional side route
8. Checkpoint
9. Mini-boss — the mechanic under pressure
10. A variation on the mechanic
11. High-intensity platforming
12. Commander approach — a corridor that builds tension
13. The Commander
14. Frequency Core recovery
15. Region restoration
16. Return to the Harmonic Sanctuary

Target: 15–30 minutes on a first clear.

## Checkpoints and failure

Checkpoints go after every major platforming section, before *and* after the mini-boss, and
before the Commander. Stage tests assert the mini-boss and Commander placements by position
ordering.

On failure: restart fast, no menus, cause made clear, collectibles preserved where sensible.
Instant-death hazards are avoided; pits return the player to the last checkpoint rather than
draining Coherence. With `fallRecovery` on, a fall costs nothing at all.

The rhythm of play is the thing being protected. A death that costs ninety seconds of re-walking
teaches the player to stop taking risks, which is the opposite of what a movement game wants.

## Enemy placement

Never scattered. Every cluster exists to pressure movement, teach timing, alter a route, guard a
secret, combine with a hazard, or encourage switching forms. The stage files comment the intent
behind each group, because a placement whose purpose cannot be stated is usually decoration.

## Secrets and the reason to return

Each stage carries at least five secrets, and **at least two need a form the player cannot have
on their first visit.**

This is authored explicitly — `requiresForm` on pickups, `clearedBy` on hazards, `revealedBy` on
geometry — and asserted in tests. The Fractured Garden contains an `echo` puzzle that cannot be
solved until Oru is freed, and the player can *see* it on the way past. Returning is not a
completionist chore; it is the stage revealing a layer that was visibly there the whole time.

Later stages layer this further: a lava channel only Tidal quenches, alien growth only Ember
burns, a rhythm hazard only Silence freezes.

## Mechanics available to a designer

**Platform motions** — linear (with pause), orbit, vertical, rhythm (steps on the region's beat),
collapse (falls after being stood on, returns later).

**Rails** — grindable resonance lines, optionally form-gated.

**Hazards** — with optional rhythm windows synced to the stage bpm, optional `clearedBy` forms,
and `isPit` for non-damaging respawns.

**Resonators and puzzles** — four kinds: `sequence` (degrees in order, wrong note resets),
`simultaneous` (all lit at once — what Choir solves directly and Echo solves differently),
`echo` (struck twice inside the hold window), `sustain` (all held for a duration). Rewards open
doors, spawn platforms, reveal secrets or set flags.

**Triggers** — spawn waves, set objectives, play cutscenes, change stage phase, frame a vista,
show a tutorial, set a flag.

## Restoration

Freeing a Commander drives the region's infection to zero. Because materials, lighting, sky and
the score all read that single value, the whole region transforms at once: alien vines dissolve,
water flows, roots reconnect, wildlife returns, the sky regains its constellations, and the
score retunes from 440 Hz to 432 Hz.

Geometry flagged `onlyWhenRestored` appears and `hiddenWhenRestored` disappears, so restoration
opens genuinely new routes rather than only recolouring the old ones.

## Ranking and replay

Completion scores time against par, Coherence retained, damage taken, secrets found, enemies
cleansed, counter accuracy, flow ratio and ability variety, mapped to D–S.

Replay is supported by faster routes, ability shortcuts, hidden collectibles, rank and
no-damage challenges, time trials, optional music fragments and secret encounter rooms.

Ranks never block progress. Nothing in the story is gated behind one.

## Validation

Every stage file ships a test asserting: full referential integrity (no dangling trigger,
puzzle, resonator, door, rail, checkpoint or archetype ids, no duplicates); `secretTotal`
matching the actual count; unique ascending checkpoint orders with the required mini-boss and
Commander placements; `killPlaneY` below all geometry; a spawn point above walkable ground; and
declared traversal pairs within reach.

This is not ceremony. The Fallen Sanctuary's independent validator caught a dangling
`amplifier` archetype reference (the real id is `amplifier-pylon`) and a secret ledge missing
its `revealedBy` gate — two defects that would have shipped as a crash and an unearnable
collectible.
