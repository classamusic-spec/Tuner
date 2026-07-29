# Architecture

TUNER: Resonance Breaker is a third-person 3D action-platformer that runs from one codebase on
web, mobile and desktop. This document explains how the pieces fit and, more importantly, why
the boundaries sit where they do.

## The central constraint

One rule drives the whole layout:

> **The simulation must not know what is drawing it.**

`@tuner/game-core` contains every rule of the game — how the Tuner moves, how the Auralith
fires, how a Commander escalates through its phases, how a region is restored. It imports no
renderer, no UI framework, no audio engine and no physics library. It talks to the outside
world through four interfaces and one event bus.

This is not architectural decoration. It buys three concrete things:

1. **The same gameplay runs everywhere.** A web build and a native mobile build differ in their
   adapters, not in their rules. There is no second implementation to keep in sync.
2. **Gameplay is testable without a browser.** Jump height, coyote time, boss phase thresholds
   and stage ranking are all asserted in plain Node tests, in milliseconds, with no canvas.
3. **The simulation is deterministic.** Given the same seed and the same input frames, it
   produces the same result. That makes replays, regression tests and reproducible bug reports
   possible.

Lint enforces the boundary rather than trusting anyone to remember it — `eslint.config.js`
forbids importing `three`, `react`, `react-dom`, `react-native`, `tone`, `@tuner/rendering` and
`@tuner/ui` from inside `game-core` and `shared`.

## Package map

```
apps/
  web/         Vite + React host. Owns the frame loop and wires adapters together.
  mobile/      Expo host. Same core, native adapters.
  desktop/     Tauri host. Wraps the web build.

packages/
  shared/      Dependency-free foundations. Maths, RNG, event bus, pooling,
               fixed-step driver, and the 432 Hz domain vocabulary.
  physics/     PhysicsWorld contract + the shipped kinematic solver.
  input/       One InputFrame flattened from keyboard, gamepad and touch.
  audio/       AudioEngine contract + Web Audio adapter + null adapter.
  game-core/   The simulation. Pure TypeScript. No platform dependencies.
  game-content/Stages, enemies, bosses, narrative — data, not code.
  platform/    Capability detection and graphics quality tiers.
  persistence/ Versioned save schema, storage adapters, save system.
  rendering/   Three.js / React Three Fiber presentation. Reads state, never writes.
  ui/          React interface. Screens, HUD, touch controls.
```

Dependencies flow strictly downward. `shared` depends on nothing. `game-core` depends on
`shared`, `physics`, `input` and `audio` — all of which are interfaces plus small pure
implementations. `rendering` and `ui` depend on `game-core` for its *types*, and are never
depended on in return.

## The four seams

### Physics — `PhysicsWorld`

`game-core` never touches a physics engine. It calls `moveCharacter`, `raycast`, `sweepSphere`
and `overlapSphere`. The shipped implementation is a deterministic kinematic solver, not a
rigid-body engine, and that is deliberate: precise platforming wants reproducible,
authored-feeling motion, not an impulse solver's emergent behaviour. Swapping in Rapier later
means implementing one interface.

### Input — `InputFrame`

Every device is flattened into a single struct of movement, look, buttons with edge detection,
and a requested form index. The simulation reads only that, so a replay can be driven by
synthesising frames and a cutscene can drive the player by injecting them.

### Audio — `AudioEngine`

Requested through an interface with a working null adapter. If audio fails to initialise, the
game stays fully playable. This is also the accessibility guarantee: the critical path must be
completable with sound off, so every gameplay-critical cue is *also* a `GameEvents` emission
carrying enough data for the renderer to draw a visual equivalent.

### Presentation — the `GameEvents` bus

The simulation announces what happened; it does not know who is listening. Rendering spawns
effects, audio plays cues, UI shows notifications, haptics fire. Adding a listener never
requires touching gameplay code.

## How a frame runs

The host owns the frame loop; the simulation owns time.

```
requestAnimationFrame
  └─ FixedStepDriver.advance(realDelta)
       ├─ step(1/60)  ← zero or more times
       │    └─ GameCore.step(fixedDelta, inputFrame)
       │         └─ systems run in a fixed order against MutableWorld
       └─ returns alpha ∈ [0, 1)
  └─ render(previousState, currentState, alpha)
```

Simulation always advances in equal 1/60 s slices, so a dash covers the same distance at 30,
60 or 144 fps. Rendering interpolates between the previous and current state by `alpha`, which
is what keeps motion smooth when the display rate is not a multiple of the simulation rate.

`FixedStepDriver` clamps a single frame to 0.25 s and caps steps per frame. A backgrounded tab
resumes; it does not try to catch up on thirty seconds of simulation at once.

## Two views of the world

There are deliberately two shapes for world state:

- **`MutableWorld`** (`internal/world.ts`) — what systems mutate in place, sixty times a second,
  without allocating.
- **`WorldState`** (`state.ts`) — the deeply read-only view handed to renderers and UI.

Separating them means a renderer *cannot* write into the simulation, and the hot path does not
allocate a fresh state object per step. The cost is one projection per step, which is cheap.

## Systems

A system is a plain function, `(context: SimContext) => void`. It receives everything it needs
and reaches for nothing else — no globals, no singletons, no constructing its own dependencies.
That is what makes each independently testable: a test builds a context with a stub physics
world and asserts on the resulting mutations.

Ordering is fixed by `createGameCore`, not by the systems themselves, so behaviour stays
deterministic. Cross-cutting operations — damage, spawning, shake, stage flags — are routed
through `SimServices` so the rules (armour, weaknesses, invulnerability, difficulty scaling,
event emission) live in exactly one place instead of drifting between callers.

## Content is data

Stages are `StageDef` objects, not code. Enemies are `EnemyArchetypeDef`. Bosses are `BossDef`
with declarative phases and attacks. The runtime plays whatever it is handed.

The important consequence: `game-core` and `rendering` read *the same* stage data. The mesh the
player sees is built from the same descriptor as the collider they hit. Invisible walls — the
worst class of platformer bug — become impossible by construction rather than by discipline.

## Determinism rules

Inside `game-core`:

- `ctx.rng` (seeded Mulberry32), never `Math.random`.
- `ctx.dt` (the fixed step), never wall-clock time.
- No `Date.now()`. Timestamps enter through save data, supplied by the caller.

## Performance posture

The decisions that matter are structural, not micro-optimisations:

- Fixed simulation rate decoupled from render rate.
- Pooled projectiles, particles and effects; no per-step allocation in hot loops.
- Instanced stage geometry, projectiles and pickups — a stage has hundreds of pieces.
- Simulation state reaches the renderer through refs and `useFrame`, never through React state.
  Gameplay must never trigger a React re-render.
- Quality tiers (`@tuner/platform`) scale shadows, draw distance, particle budget, pixel-ratio
  cap and post-processing; an adaptive controller reacts to *measured* frame times.

See `PERFORMANCE_BUDGETS.md` for the targets and for what has actually been measured — the
distinction matters, and this project does not claim a frame rate it has not observed.
