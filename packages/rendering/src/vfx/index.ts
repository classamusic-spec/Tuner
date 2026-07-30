/**
 * `@tuner/rendering/vfx` — the effects library.
 *
 * Two layers, deliberately separable:
 *
 * - **`particles.ts`** is the substrate: two pooled, typed-array systems (motes
 *   and shards; rings, polygons and arcs) with no Three.js and no React in them,
 *   so their budget, recycling and accessibility behaviour is unit-tested in
 *   Node rather than eyeballed in a build.
 * - **`effects.tsx`** is the mapping: it subscribes to the `GameEvents` bus and
 *   turns each event into sacred geometry, then draws both pools in nine
 *   instanced calls.
 *
 * The scene composes this by dropping `<ResonanceEffects bus={events} world={world} />`
 * in alongside `TunerScene`. Everything else here is exposed for hosts that want
 * to own the pools themselves, or to audit which cues are covered
 * (`director.handledEvents`).
 */

export {
  // Particles
  createParticleSystem,
  rgbFromHex,
  PARTICLE_SHAPES,
  EMISSION_PATTERNS,
  REDUCED_PARTICLE_SCALE,
  type ParticleSystem,
  type ParticleSystemOptions,
  type ParticleBuffers,
  type ParticleStats,
  type ParticleAccessibility,
  type ParticleEmitSpec,
  type ParticleEmitterSpec,
  type ParticleShape,
  type EmissionPattern,
  type NumberRange,
  type Scalar,
  type Curve2,
  type Rgb,
  type ColourInput,
  // Geometry echoes
  createGeometryEchoes,
  ECHO_FORMS,
  ECHO_ORIENTATIONS,
  ECHO_RING_RATIO,
  ECHO_GROUND_LIFT,
  MAX_ECHO_RADIUS,
  MAX_ECHO_OPACITY,
  MAX_ECHO_LIFETIME,
  type GeometryEchoField,
  type GeometryEchoOptions,
  type EchoBuffers,
  type EchoSpec,
  type EchoStats,
  type EchoForm,
  type EchoOrientation,
} from './particles.js';

export {
  ResonanceEffects,
  ParticleField,
  EchoField,
  createEffectDirector,
  createResonanceEffects,
  effectAccessibilityFrom,
  EFFECT_COLOURS,
  type ResonanceEffectsProps,
  type ResonanceEffectsHandle,
  type CreateResonanceEffectsOptions,
  type EffectDirector,
  type EffectDirectorOptions,
  type ParticleFieldProps,
  type EchoFieldProps,
} from './effects.js';
