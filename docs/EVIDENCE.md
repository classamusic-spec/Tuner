# Evidence

This file records what was actually **run**, and what was **not possible to run** in this
environment. It is deliberately separate from the design documents so that intentions and
observations never get confused with one another.

Nothing here is estimated. If a number is not in this file, it was not measured.

## Environment

Recorded at the start of the build:

| | |
| --- | --- |
| OS | Linux 6.18.5, x86-64 |
| CPU | 4 cores |
| Memory | 15 GiB |
| Node.js | 22.22.2 |
| pnpm | 10.33.0 |
| Python | 3.11.15 |
| Rust / Cargo | 1.94.1 |
| Git | 2.43.0 |
| GPU | none (no hardware acceleration available) |

## Pinned dependency versions

TypeScript 5.9.3 · Vite 7.3.6 · Vitest 3.2.7 · ESLint 9.39.5 · React 19.2.8 · Three.js 0.185.1 ·
@react-three/fiber 9.6.1 · @react-three/drei 10.7.7 · zustand 5.0.14 · Tone 15.1.22 ·
Playwright 1.62.0 · Expo 57.0.8 · React Native 0.86.2 · Tauri 2.

TypeScript 7.0.2, ESLint 10 and Vite 8 were available on the registry but deliberately not
taken: `typescript-eslint` 8.65 and `@vitejs/plugin-react` do not yet support them, and a
toolchain that half-works is worse than a slightly older one that fully works.

## Toolchains confirmed absent

Checked directly rather than assumed:

```
pkg-config --exists webkit2gtk-4.1   → NO
pkg-config --exists gtk+-3.0         → NO
cargo-tauri                          → not installed
ANDROID_HOME                         → unset
sdkmanager                           → not installed
uname -s                             → Linux (so no iOS)
```

**Consequences, stated plainly:**

- **No desktop binary was produced.** The Tauri 2 configuration, Rust shell and CSP are written
  and reviewed, but `tauri build` cannot run without the webview toolchain — and Windows/macOS
  bundles cannot be cross-compiled from Linux in any case.
- **No Android APK was produced.** No SDK, no `ANDROID_HOME`.
- **No iOS build is possible.** Requires macOS.
- **No frame-rate measurement on real hardware.** There is no GPU here and no mobile device, so
  no sustained frame rate is claimed anywhere in this repository. `PERFORMANCE_BUDGETS.md`
  separates targets from structural guarantees from measurements for exactly this reason.

## Test results

Run with `npx vitest run`. Numbers are copied from the runner, not summarised from memory.

### Verified passing

| Suite | Result |
| --- | --- |
| `tests/unit/portability.test.ts` | 9 / 9 |
| `packages/physics/src/kinematic-world.test.ts` | 29 / 29 |
| `packages/game-core/src/systems/movement.test.ts` | 51 / 51 |
| `packages/game-content/src/bestiary.test.ts` | 36 / 36 |
| `packages/game-content/src/stages/fallen-sanctuary.test.ts` | 41 / 41 |

### What the independent critics actually caught

Verification was not ceremony. Recorded because it is the honest measure of whether the
adversarial pass was worth running:

- **Fallen Sanctuary** — the author's own tests passed on their machine, but an independent run
  found two real defects: an enemy spawn referencing a non-existent `amplifier` archetype (the
  real id is `amplifier-pylon`), and a secret ledge missing its `revealedBy: 'echo'` gate. The
  first would have thrown at stage load; the second would have made a collectible unearnable.
  Both were fixed; the suite went from 38/40 to 41/41.
- **Physics** — the solver first landed with 6 of 29 tests failing, including `grounded`
  returning false while the capsule rested on a floor. That is a bug that would have broken
  every jump in the game. The specialist found and fixed all six before returning.

## Build results

*(To be completed at the end of the build with real command output — see the final report.)*

## What has not been verified

Stated so nobody has to infer it:

- **Game feel.** No amount of passing tests establishes that the movement is enjoyable, that the
  camera is comfortable, or that a stage is fun. That requires playing it.
- **Accessibility with assistive technology.** The options are implemented and asserted, but
  there has been no screen-reader pass and no testing with players who have the impairments
  these options exist to serve. Those are the checks that would actually validate the work.
- **Real-device performance.** See above.
- **Audio.** There is no audio output device in this container, so the synthesis has been tested
  for correctness of its data and its graceful degradation, not for how it sounds.
