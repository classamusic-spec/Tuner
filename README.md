# TUNER: Resonance Breaker

A third-person 3D action-platformer about restoring a world to its natural rhythm.

The universe resonates at 432 Hz. An alien resonance virus is dragging it toward an artificial
440 Hz, spreading through sound, architecture, geometry, technology, biology, memory and dream.
Creatures called the Detuners are doing it on purpose, and each of their Commanders has seized a
planetary resonance node and is turning its region into a 440 Hz amplifier.

You are the Tuner. You can still hear the World Chord underneath the interference, and you carry
the Auralith — a sacred instrument that fires resonance, copies frequencies, builds platforms out
of sound, and takes a new form from every Commander you free.

---

## Prerequisites

| Tool | Version | Required for |
| --- | --- | --- |
| Node.js | ≥ 20.11 (developed on 22.22.2) | everything |
| pnpm | 10.33.0 | everything — `workspace:*` will not resolve under npm or yarn |
| Rust / Cargo | ≥ 1.77 (developed on 1.94.1) | desktop build only |
| Android SDK + JDK 17 | platform 34+ | Android build only |
| macOS + Xcode | — | iOS build only |

Desktop builds additionally need the platform's webview toolchain: on Linux `webkit2gtk-4.1`,
`gtk+-3.0`, `libayatana-appindicator3` and `librsvg2`; on Windows the MSVC build tools and
WebView2; on macOS the Xcode command line tools.

## Install

```bash
pnpm install
```

## Develop

```bash
pnpm dev              # web dev server → http://localhost:5173
pnpm typecheck        # tsc -b across every package
pnpm lint
pnpm test             # unit + integration (Vitest)
pnpm test:watch
pnpm test:coverage
pnpm verify           # typecheck + lint + test
```

## Web

```bash
pnpm build:web        # production build → apps/web/dist
pnpm preview          # serve it on :4173
pnpm test:e2e         # Playwright, against the production build
```

The web build is an installable PWA: fullscreen, landscape, offline-capable.

## Mobile

```bash
pnpm --filter @tuner/mobile start       # Metro dev server
pnpm --filter @tuner/mobile prebuild    # generate native projects
pnpm --filter @tuner/mobile android     # requires the Android SDK
pnpm --filter @tuner/mobile ios         # requires macOS + Xcode
```

## Desktop

```bash
pnpm --filter @tuner/desktop tauri dev
pnpm --filter @tuner/desktop tauri build
```

A Tauri bundle can only be produced on the OS it targets; there is no supported cross-compile
from Linux to Windows or macOS.

---

## Controls

**Keyboard and mouse** — WASD move, mouse look, Space jump, Shift dash, left click fire (hold to
charge), right click / F counter, Tab lock-on, Q Resonance Sight, C slide, E interact, R recentre
camera, 1–9 or mouse wheel switch forms, Escape pause. All rebindable.

**Controller** — left stick move, right stick camera, face buttons jump and dash, triggers fire
and charge, shoulder buttons switch forms, click for lock-on. Fully remappable.

**Touch** — floating left stick that appears where your thumb lands, right-half drag for camera,
and buttons for jump, dash, fire, counter and quick form switch. Movable, resizable, adjustable
opacity, and a left-handed layout that mirrors everything.

---

## Repository layout

```
apps/web        Vite + React host. Owns the frame loop.
apps/mobile     Expo host, native adapters, same simulation.
apps/desktop    Tauri 2 shell around the web build.

packages/shared        Maths, deterministic RNG, event bus, pooling, fixed step, domain types.
packages/physics       PhysicsWorld contract + the kinematic solver.
packages/input         One InputFrame from keyboard, gamepad and touch.
packages/audio         AudioEngine contract, Web Audio adapter, null adapter.
packages/game-core     The simulation. No React, no Three.js, no DOM.
packages/game-content   Stages, enemies, bosses, narrative — data, not code.
packages/platform      Capability detection and graphics quality tiers.
packages/persistence   Versioned saves, storage adapters.
packages/rendering     Three.js / React Three Fiber presentation.
packages/ui            Screens, HUD, touch controls.
```

The architectural rule, and the reason for the split: **the simulation does not know what is
drawing it.** `@tuner/game-core` imports no renderer, UI framework, DOM API or engine, which is
what lets one set of rules run on web, mobile and desktop, and lets gameplay be tested in
milliseconds without a browser. Lint forbids the imports, and `tests/unit/portability.test.ts`
walks the import graph and fails on any that slip through.

See `docs/ARCHITECTURE.md` for the full reasoning.

## Documentation

| Document | Covers |
| --- | --- |
| `docs/ARCHITECTURE.md` | package boundaries, the four seams, frame flow |
| `docs/GAMEPLAY_SYSTEMS.md` | system order, Coherence, the Auralith, forms, enemies, bosses, stages |
| `docs/ACCESSIBILITY.md` | the paired-cue rule and every option |
| `docs/PERFORMANCE_BUDGETS.md` | targets vs structural guarantees vs measurements |
| `docs/TEST_PLAN.md` | what is tested, what deliberately is not |
| `docs/BUILD_AND_RELEASE.md` | per-platform build steps and the release checklist |
| `docs/EVIDENCE.md` | what was actually run in this environment, and what was not |

## Status

See `docs/EVIDENCE.md` for what is playable, what is verified, and what is not. That file records
observations rather than intentions, and it is the honest answer to "does this work yet".

## Originality

Every character, creature, ability, region, mechanic, sound, interface element and line of story
in TUNER is original to this project.
