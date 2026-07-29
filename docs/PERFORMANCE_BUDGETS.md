# Performance budgets

## A note on honesty

This document separates three different claims, and never blurs them:

- **Target** — what the game is designed and budgeted for.
- **Structural guarantee** — a property of the architecture that holds by construction and is
  asserted in tests.
- **Measured** — an observed number, with the device and method stated.

Nothing in this project may claim a frame rate that has not been measured on the device in
question. Where a measurement is missing, this document says so rather than estimating.

## Targets

| Tier | Device class | Target | Shadows | Draw distance | Particles | Post | Pixel ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | Older phones, low-end tablets | 30 fps stable | off | reduced | reduced | off | capped ~1.5 |
| Medium | Modern phones, tablets | 60 fps where sustainable | small map | moderate | moderate | minimal | capped ~2 |
| High | Desktop, high-end tablets | 60 fps baseline, optional higher | full | long | full | on | up to 2 |

"Stable" means the frame budget is met consistently, not on average. A 60 fps average with
regular 40 ms spikes is a worse experience than a steady 30 fps, and the adaptive controller is
tuned accordingly.

## Structural guarantees

These hold because of how the code is built, and are covered by tests:

1. **Simulation is decoupled from rendering.** Fixed 60 Hz steps via `FixedStepDriver`; the
   renderer interpolates by `alpha`. A dropped frame changes smoothness, never physics. Tests
   assert that one second simulated at `dt = 1/60` and at `dt = 1/120` puts the player within
   0.05 m of the same position.
2. **A backgrounded tab cannot spiral.** A single frame is clamped to 0.25 s and steps per frame
   are capped; excess time is discarded rather than simulated.
3. **No per-step allocation on the hot path.** Projectiles, particles and effects are pooled;
   the state projector reuses two buffers and swaps them; vector maths uses `*Into` variants
   that write into caller-owned targets. `Pool` exposes `createdCount` so tests can assert that
   sustained emit/recycle cycles never grow the pool.
4. **Gameplay never triggers a React re-render.** Simulation state reaches Three.js objects
   through refs inside `useFrame`, not through component state. This is the single most
   important rendering rule in the project; violating it would turn every frame into a React
   reconciliation pass.
5. **Stage geometry is instanced.** A stage has hundreds of pieces; they are grouped by shape
   and style into `InstancedMesh`. Projectiles, pickups and particles are likewise instanced.
6. **Materials are cached and shared**, keyed by style and tier, with a `dispose()` that frees
   them. Leaked materials are a real memory bug on mobile, so the cache is tested.

## Budgets per frame

Design budgets for a main stage at the High tier:

| Resource | Budget |
| --- | --- |
| Draw calls | ≤ 150 |
| Triangles | ≤ 350 k |
| Simulation step | ≤ 2 ms |
| Live enemies | ≤ 24 |
| Live player projectiles | 48 (hard cap in `CombatConfig`) |
| Particles | 2 000 high / 800 medium / 300 low |
| Dynamic lights | 3 high / 2 medium / 1 low |
| Shadow map | 2048 high / 1024 medium / off low |

At Low the geometry budget roughly halves through draw-distance culling and LOD.

## Adaptive quality

`AdaptiveQualityController` (`@tuner/platform`) watches measured frame times and steps the
dynamic-resolution scale — then the tier — down when the budget is consistently missed, and
back up when there is sustained headroom. It uses hysteresis so it cannot oscillate, which is
asserted in its tests. It reacts only to measurements; it never predicts.

## Mobile lifecycle

On background: the simulation pauses, audio suspends, and `requestAnimationFrame` stops. On
resume, the fixed-step accumulator is reset rather than replayed.

## What has actually been measured

See `docs/EVIDENCE.md` for the measurements taken in this environment, the method used, and —
importantly — the list of measurements that were **not** possible here. This container has no
GPU, no mobile device and no browser profiling harness beyond headless Chromium, so any claim
about sustained frame rates on real hardware would be fabricated. It is not made.
