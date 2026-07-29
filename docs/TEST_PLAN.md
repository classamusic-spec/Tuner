# Test plan

## What is worth testing here

This is a game, so most of what matters is *feel*, which a unit test cannot judge. The test
suite therefore targets the things that are objectively checkable and that break silently:

- **Numbers that define feel.** Jump apex, coyote window, jump buffer, dash distance, charge
  tier timings. If these drift, the game feels wrong in a way that is hard to trace by hand.
- **Framerate independence.** Any behaviour that differs at 30 vs 120 fps is a bug, and it is
  the bug most likely to escape manual play-testing on one machine.
- **Determinism.** Same seed plus same inputs must give the same result, or replays and
  regression tests are worthless.
- **Content integrity.** Broken ids, unreachable gaps and missing checkpoints are the failure
  mode of data-driven content, and they are cheap to catch automatically.
- **Accessibility guarantees.** An assist set to zero must be exactly a no-op; a contrast
  setting must actually change contrast. These are promises to players, so they get assertions.
- **The portability boundary.** `game-core` must not acquire a platform dependency.

## Layers

### Unit — Vitest, Node environment

Runs against TypeScript source through workspace aliases (`vitest.config.ts`), so there is no
build step between writing code and testing it.

| Area | Focus |
| --- | --- |
| `shared` | vector maths, damping, angle wrapping, RNG determinism, pooling, fixed-step clamping |
| `physics` | collide-and-slide, slope classification, step-up, ground snap, triggers, raycasts, determinism |
| `game-core/movement` | jump heights, coyote, buffering, dash, wall jump, framerate independence |
| `game-core/combat` | fire cadence, charge tiers, armour breaking, counter conversion, lock-on, aim assist |
| `game-core/enemies` | per-role behaviour, line of sight, telegraph timing, difficulty scaling |
| `game-core/boss` | phase thresholds, attack selection and variety, vulnerability windows, restoration |
| `game-core/stage` | platform motions, beat clock, puzzles, checkpoints, triggers, ranking |
| `game-core/forms` | registry completeness, category guarantees, switching rules, behaviour hooks |
| `game-core/camera` | follow settling, collision, landing look-ahead, recentre, reduced motion |
| `input` | edge detection, deadzone, diagonal clamping, rebinding, touch layout geometry |
| `game-content` | referential integrity, reachability, secret counts, bestiary coverage |

Planned but **not yet written** — the specialists assigned to them did not run before the session
hit its usage limit:

| Area | Would cover |
| --- | --- |
| `audio` | nothing to test yet; the engine itself is unbuilt |
| `platform` | quality presets, adaptive controller hysteresis |
| `persistence` | schema validation, migration, corruption isolation, best-result merging |
| `rendering` | material caching and disposal, particle pooling |
| `ui` | navigation stack, notification queue, contrast ratios |

The `platform`, `persistence` and `ui` code is written and typechecked; it is the tests that are
missing, which is worth being precise about — untested is not the same as absent.

### Integration

- A headless full-stage playthrough driven by synthesised `InputFrame`s, asserting the critical
  path completes and the stage result is produced.
- Save → load → resume round trip.
- Contract test: `game-core` imports nothing platform-specific (enforced by lint, and by a
  test that walks the import graph).

### End-to-end — Playwright

- Title screen renders and reaches gameplay.
- Canvas is present and the renderer produces frames.
- Keyboard input moves the player.
- Pause works and settings persist.
- Touch emulation drives the on-screen controls.

### What is deliberately not automated

Game feel, art quality, camera comfort, music, and whether a stage is *fun*. Those are judged by
play and by the critic passes described in `CHANGELOG.md`, not by assertions.

## Commands

```bash
pnpm test              # unit + integration
pnpm test:watch
pnpm test:coverage
pnpm test:e2e          # Playwright (requires a built or running web app)
pnpm typecheck         # tsc -b across the whole workspace
pnpm lint
pnpm verify            # typecheck + lint + test
```

## Standards

- A test must assert behaviour, not merely that a function returned without throwing.
- Framerate-independence and determinism tests are required for anything that integrates over
  time.
- Content tests must be programmatic assertions over the data, not hand-maintained lists that
  rot.
- A failing test is never disabled to make a run green. It is fixed, or the failure is reported.

## Current status

See `docs/EVIDENCE.md` for the actual counts from the most recent run, including any suites that
fail. That file records what was observed, not what was hoped for.
