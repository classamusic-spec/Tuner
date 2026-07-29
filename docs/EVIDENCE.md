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

Full suite, `npx vitest run` — **415 passing, 12 files, 0 failing**:

| Suite | Result |
| --- | --- |
| `tests/unit/portability.test.ts` | 9 / 9 |
| `tests/integration/headless-simulation.test.ts` | 12 / 12 |
| `packages/physics/src/kinematic-world.test.ts` | 31 / 31 |
| `packages/game-core/src/systems/movement.test.ts` | 51 / 51 |
| `packages/game-core/src/systems/combat.test.ts` | 51 / 51 |
| `packages/game-core/src/systems/enemies.test.ts` | 28 / 28 |
| `packages/game-core/src/systems/boss.test.ts` | 31 / 31 |
| `packages/input/src/touch.test.ts` | 21 / 21 |
| `packages/game-content/src/bestiary.test.ts` | 36 / 36 |
| `packages/game-content/src/lattice.test.ts` | 44 / 44 |
| `packages/game-content/src/stages/fallen-sanctuary.test.ts` | 41 / 41 |
| `packages/game-content/src/stages/fractured-garden.test.ts` | 58 / 58 |

`npx tsc -b tsconfig.build.json` — **0 errors** across all ten packages and three apps.

`npx eslint .` — **0 errors, 0 warnings.**

### End-to-end, in a real browser

`npx playwright test` against the production build — **26 passing, 1 skipped, 0 failing**, across
three device profiles (desktop 1280x720, tablet-touch, phone-touch):

- The title screen renders and offers a new journey.
- No uncaught errors during boot.
- A WebGL canvas is present and producing frames.
- The simulation advances at roughly the fixed rate (15–120 steps per wall second; the band is
  wide because this container has no GPU).
- Keyboard input moves the player.
- Pause is reachable mid-play, halts the tick exactly, and resumes.
- The HUD shows Coherence and the equipped form.
- Accessibility settings survive a page reload.
- On touch profiles: the on-screen controls appear, and a real CDP touch drag on the floating
  stick moves the player.

Two environment quirks had to be worked around, and are recorded because they are *not* game
defects: the pre-installed Chromium's build number does not match what Playwright 1.62 would
download (so `executablePath` is pointed at the real binary), and Playwright's iPad device
profiles default to WebKit, which is not installed here (so the tablet project forces Chromium
and renders at 1x, since 2x asks software rendering for a framebuffer this container cannot
allocate).

### Web build

`pnpm --filter @tuner/web build` — **succeeds.**

```
dist/index.html                  1.20 kB │ gzip:   0.59 kB
dist/assets/index-*.css          1.76 kB │ gzip:   0.86 kB
dist/assets/react-*.js          11.37 kB │ gzip:   4.10 kB
dist/assets/index-*.js         692.33 kB │ gzip: 207.72 kB
dist/assets/three-*.js         733.49 kB │ gzip: 189.70 kB
PWA precache: 9 entries, 1407.10 KiB
```

Roughly 400 kB gzipped in total, for a complete 3D game with no downloaded art or audio assets —
every model, material, effect, icon and sound is generated in code.

### What the independent critics caught

Verification was not ceremony. Recorded because it is the honest measure of whether the
adversarial passes were worth running:

- **Fallen Sanctuary** — the author's own tests passed, but an independent run found two real
  defects: an enemy spawn referencing a non-existent `amplifier` archetype (the real id is
  `amplifier-pylon`), and a secret ledge missing its `revealedBy: 'echo'` gate. The first would
  have thrown at stage load; the second would have made a collectible unearnable. 38/40 → 41/41.
- **Physics** — the solver first landed with 6 of 29 tests failing, including `grounded`
  returning false while the capsule rested on a floor. That would have broken every jump in the
  game. All six were fixed before it returned.
- **Enemy framework** — landed with 4 failures, including a determinism break where two identical
  seeded runs allocated different entity counts. Its verifier fixed all four.
- **Touch layout** — a test written *before* the fix caught the lock-on button dropping to 42 px
  when a player scales controls down to 0.75, below the 46 px minimum the design promises. The
  minimum is now a hard floor.

### Bugs found by writing the tests

Two gaps surfaced only because something tried to play the game end to end:

- **Cutscenes could not be skipped.** The opening scene correctly held control, but nothing could
  end it — the brief requires every scene be skippable. `skipCutscene()` was added to the core and
  wired to the confirm inputs.
- **Settings were not persisted.** The docs claimed they were. They are now, through
  `@tuner/persistence`, restored before the title screen paints so a player who needs reduced
  motion or larger text never sees a frame without it.

## What has not been verified

Stated so nobody has to infer it:

- **Game feel.** No number of passing tests establishes that the movement is enjoyable, that the
  camera is comfortable, or that a stage is fun. That requires playing it, and nobody has.
- **Audio.** There is no audio device in this container, and — more importantly — the audio
  engine was never written. `@tuner/audio` ships its contract and a working null adapter; the
  Web Audio implementation, the synthesis recipes and the adaptive music director do not exist.
  The game is silent. Because the visual-pairing rule is structural, it remains fully playable.
- **Accessibility with assistive technology.** The options are implemented and asserted, but
  there has been no screen-reader pass and no testing with players who have the impairments
  these options exist to serve. Those are the checks that would actually validate the work.
- **Real-device performance.** No GPU, no phone. No frame rate is claimed anywhere.
- **Desktop, Android and iOS binaries.** Configuration only — see above.
