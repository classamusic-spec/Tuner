# Changelog

All notable changes to TUNER: Resonance Breaker are recorded here. Entries state what was
actually built and verified, and separate that from what was configured but could not be
verified in the build environment.

## [Unreleased]

### Milestone 0 — Repository and architecture contracts

- pnpm workspace with strict TypeScript project references across ten packages and three apps.
- `@tuner/shared`: dependency-free maths (allocation-conscious `*Into` vector variants,
  framerate-independent damping), deterministic Mulberry32 RNG, typed event bus, object pooling,
  fixed-step driver with backgrounded-tab clamping, and the 432 Hz domain vocabulary.
- `@tuner/physics`: `PhysicsWorld` contract — collide-and-slide character movement, raycast,
  sphere sweep, overlap — with no engine bound to it.
- `@tuner/input`: one `InputFrame` flattened from keyboard, mouse, gamepad and touch.
- `@tuner/audio`: `AudioEngine` contract plus a working null adapter, so the game stays playable
  when audio fails or is muted.
- `@tuner/game-core`: read-only `WorldState`, the `GameEvents` presentation bus, the tuning
  surface (`MovementConfig`, `CombatConfig`, `CameraConfig`, `AccessibilityConfig`), the
  `StageDef` authoring format, Resonance Form contracts, and the `GameCore` facade.
- Internal `MutableWorld` and `SimContext`: systems are plain `(context) => void` functions
  mutating a shared world in a fixed order, with cross-cutting rules routed through
  `SimServices` so armour, weaknesses, invulnerability and difficulty scaling live in one place.
- Two-buffer state projector, so rendering has a previous and current state to interpolate
  between without allocating per frame.
- Lint rule and a portability test that walk the import graph and fail on any renderer, UI
  framework, platform package, browser global, `Math.random` or wall-clock read inside the
  simulation. **9/9 portability guards passing.**

### Milestone 1 — Movement

- Third-person character controller: camera-relative movement with walk/run/sprint tiers,
  variable-height jump, double jump, coyote time, jump buffering, ground and air dash, slide,
  wall cling and wall jump with input lock, ledge grab and mantle, rail grinding, harmonic
  bounce, swimming, moving-platform inheritance, and optional landing assist that is exactly a
  no-op at zero. **51/51 movement tests passing**, including framerate-independence and
  determinism assertions.

### Content

- Detuner bestiary covering all nine enemy roles across six families, plus cleansable corrupted
  wildlife and guardians that are restored rather than destroyed.
- Boss definitions for the vertical slice (Sanctuary Guardian, Virus Bloom, Oru the Fractured
  Colossus) and the six remaining Commanders, each with descending phase thresholds, readable
  telegraphs and at least one guaranteed vulnerability window. **36/36 bestiary tests passing.**

### Hosts

- Web: Vite + React, PWA manifest and service worker, Three.js and React split into separate
  chunks, game-client CSS, error boundary that shows the failure instead of white-screening.
- Mobile: Expo host configured for the monorepo (Metro watch folders, pnpm symlink resolution),
  sharing simulation, physics, input, audio, platform, persistence and content.
- Desktop: Tauri 2 shell around the web build with a locked-down webview CSP.

### Documentation

- `ARCHITECTURE`, `GAMEPLAY_SYSTEMS`, `ACCESSIBILITY`, `PERFORMANCE_BUDGETS`, `TEST_PLAN`,
  `BUILD_AND_RELEASE`, and `README`.

### Not verified in this environment

Recorded plainly because the distinction matters:

- **No desktop binary.** This container has neither `webkit2gtk-4.1` nor `gtk+-3.0`, and
  Windows/macOS bundles cannot be cross-compiled from Linux. The Tauri configuration is written
  and reviewed; it has not been built.
- **No Android APK.** No Android SDK, no `ANDROID_HOME`.
- **No iOS build.** Requires macOS.
- **No frame-rate measurements on real hardware.** There is no GPU and no mobile device here, so
  no sustained frame rate is claimed. See `docs/PERFORMANCE_BUDGETS.md`, which separates targets
  from structural guarantees from measurements.
