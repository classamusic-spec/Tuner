/**
 * The particle substrate: pooled, instanced, allocation-free after construction.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS NO THREE.JS IN IT
 * ---------------------------------------------------------------------------
 * Everything here is typed arrays and arithmetic. `effects.tsx` owns the
 * `InstancedMesh` objects and simply *reads* the buffers this module writes.
 * That split buys three things:
 *
 * 1. The simulation of an effect is unit-testable in Node, so the budget, the
 *    recycling policy and the accessibility reductions are covered by tests
 *    rather than by eyeballing a running build.
 * 2. There is exactly one place where per-frame allocation could creep in, and
 *    it is small enough to audit.
 * 3. A second renderer (a native shell, a canvas fallback) can drive the same
 *    buffers without reimplementing the behaviour.
 *
 * ---------------------------------------------------------------------------
 * THE THREE INVARIANTS
 * ---------------------------------------------------------------------------
 * **Allocate once.** Every buffer is created in `createParticleSystem` and never
 * grown, replaced or reallocated. `stats.bufferAllocations` is the proof, and a
 * test asserts it stays at 1 across many thousands of emissions.
 *
 * **Never drop the newest.** When emission would exceed the budget the *oldest*
 * live particle is recycled. A hit spark the player caused must never be the
 * thing that gets thrown away because an ambient emitter filled the pool.
 *
 * **Accessibility is a reduction, never a removal.** `reducedParticles` cuts
 * counts hard but never to zero: an effect that carries information (a cleanse,
 * a struck note) must still be visible. `reducedFlashing` removes brightness
 * *oscillation* entirely, leaving a monotonic curve, because a strobing cue is
 * unusable for photosensitive players — it is not merely dimmed.
 */

import { TAU, clamp, clamp01, createRng } from '@tuner/shared';
import type { GraphicsTier, Rng, Vec3 } from '@tuner/shared';
import { QUALITY_PRESETS } from '@tuner/platform';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Straight sRGB in 0..1. The renderer converts to the working colour space. */
export type Rgb = readonly [number, number, number];
export type ColourInput = string | Rgb;

const WHITE: Rgb = [1, 1, 1];
const HEX_CACHE = new Map<string, Rgb>();

/**
 * Parses `#rrggbb` (or `#rgb`) into sRGB components.
 *
 * Memoised because the effect layer passes `PALETTE` strings straight through,
 * and the same dozen strings are parsed for the life of the process.
 */
export function rgbFromHex(hex: string): Rgb {
  const cached = HEX_CACHE.get(hex);
  if (cached !== undefined) return cached;

  let text = hex.trim();
  if (text.charAt(0) === '#') text = text.slice(1);
  if (text.length === 3) {
    text = text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) + text.charAt(2) + text.charAt(2);
  }

  let parsed: Rgb = WHITE;
  if (text.length === 6) {
    const value = Number.parseInt(text, 16);
    if (Number.isFinite(value)) {
      parsed = [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }
  }

  HEX_CACHE.set(hex, parsed);
  return parsed;
}

function resolveColour(input: ColourInput | undefined, fallback: Rgb): Rgb {
  if (input === undefined) return fallback;
  if (typeof input === 'string') return rgbFromHex(input);
  return input;
}

// ---------------------------------------------------------------------------
// Shapes and emission patterns
// ---------------------------------------------------------------------------

/**
 * The four instanced shapes.
 *
 * All four are *geometric*: a mote is an octahedron, a shard a tetrahedron, a
 * fleck a thin sliver aligned to its own velocity, a glyph a small polygonal
 * annulus. There are deliberately no soft round sprites — the visual language
 * of this game is sacred geometry, and a billboarded puff of smoke reads as a
 * different game.
 */
export const PARTICLE_SHAPES = ['mote', 'shard', 'fleck', 'glyph'] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

const SHAPE_INDEX: Readonly<Record<ParticleShape, number>> = {
  mote: 0,
  shard: 1,
  fleck: 2,
  glyph: 3,
};

/**
 * How a batch is distributed in space.
 *
 * `ring` and `polygon` place particles at *even* angular intervals rather than
 * randomly — that is what makes a burst read as a harmonic figure instead of an
 * explosion, and it lets the note-strike effect encode a harmonic degree as a
 * countable number of vertices.
 */
export const EMISSION_PATTERNS = [
  'point',
  'cone',
  'sphere',
  'ring',
  'disc',
  'polygon',
  'line',
] as const;
export type EmissionPattern = (typeof EMISSION_PATTERNS)[number];

// ---------------------------------------------------------------------------
// Emission specs
// ---------------------------------------------------------------------------

export interface NumberRange {
  readonly min: number;
  readonly max: number;
}

/** A fixed value, or a range sampled from the system's deterministic RNG. */
export type Scalar = number | NumberRange;

/** `[from, to]` endpoints of a curve sampled over the particle's lifetime. */
export type Curve2 = readonly [number, number];

export interface ParticleEmitSpec {
  readonly position: Readonly<Vec3>;
  /** Requested particle count. Accessibility and budget may reduce it. */
  readonly count?: number;
  readonly shape?: ParticleShape;
  readonly pattern?: EmissionPattern;
  /** Cone axis / ring normal / line direction. Defaults to world up. */
  readonly direction?: Readonly<Vec3>;
  /** Cone half-angle in radians. */
  readonly spread?: number;
  /** Vertex count for the `polygon` pattern. */
  readonly polygonSides?: number;
  /** Distance from the origin at which `ring`/`disc`/`polygon` spawn. */
  readonly spawnRadius?: number;
  /** Length of the `line` pattern, laid back along `direction`. */
  readonly length?: number;
  /** Outward (or, for cone/point, forward) speed. Negative means inward. */
  readonly speed?: Scalar;
  /** Speed along `direction`, independent of the outward component. */
  readonly axialSpeed?: Scalar;
  readonly inheritVelocity?: Readonly<Vec3>;
  readonly lifetime?: Scalar;
  /** Size in metres: a constant, or `[from, to]` over the lifetime. */
  readonly size?: number | Curve2;
  readonly colour?: ColourInput;
  /** Optional mid-life colour. Omit for a straight two-stop ramp. */
  readonly colourMid?: ColourInput;
  readonly colourTo?: ColourInput;
  /** Peak opacity in 0..1. */
  readonly opacity?: number;
  /** Fraction of the lifetime spent fading in. */
  readonly fadeIn?: number;
  /** Exponent of the fade-out. Above 1 lingers, below 1 leaves early. */
  readonly fadePower?: number;
  /** Emissive multiplier: a constant, or `[from, to]`. */
  readonly brightness?: number | Curve2;
  /** Brightness oscillation. Removed entirely when `reducedFlashing` is set. */
  readonly flickerHz?: number;
  readonly flickerAmount?: number;
  /** Downward acceleration. Negative falls. */
  readonly gravity?: number;
  /** Exponential velocity damping, per second. */
  readonly drag?: number;
  /** Spin rate in radians per second. */
  readonly spin?: Scalar;
}

export interface ParticleEmitterSpec extends ParticleEmitSpec {
  readonly ratePerSecond: number;
  /** Auto-stops after this long. Zero or omitted runs until stopped. */
  readonly durationSeconds?: number;
  /**
   * Trail mode: a step's emissions are spread along the segment the emitter
   * travelled, so a fast-moving source leaves a continuous ribbon rather than
   * clumps at frame boundaries.
   */
  readonly trail?: boolean;
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

/**
 * The per-instance channels an `InstancedMesh` is driven from.
 *
 * `live` holds the indices of live particles in age order (oldest first), valid
 * for `[0, activeCount)` as of the last `step()`. Iterating it — rather than the
 * whole capacity — keeps a mostly-empty pool cheap to draw.
 */
export interface ParticleBuffers {
  readonly capacity: number;
  /** xyz per particle. */
  readonly position: Float32Array;
  /** xyz per particle. */
  readonly velocity: Float32Array;
  /** rgb per particle, straight sRGB in 0..1. */
  readonly colour: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly brightness: Float32Array;
  readonly rotation: Float32Array;
  /** Normalised age in 0..1. */
  readonly progress: Float32Array;
  readonly shape: Uint8Array;
  readonly alive: Uint8Array;
  readonly live: Uint32Array;
}

/** Live counters. The same object is returned every time — never a snapshot. */
export interface ParticleStats {
  /** Number of times buffers were allocated. Always 1 for a healthy system. */
  readonly bufferAllocations: number;
  readonly emitted: number;
  readonly recycled: number;
  readonly expired: number;
  readonly peakActive: number;
}

export interface ParticleAccessibility {
  readonly reducedParticles: boolean;
  readonly reducedFlashing: boolean;
  readonly reducedMotion: boolean;
}

export interface ParticleSystem {
  readonly buffers: ParticleBuffers;
  readonly capacity: number;
  readonly budget: number;
  readonly activeCount: number;
  readonly freeCount: number;
  readonly emitterCount: number;
  readonly stats: ParticleStats;
  readonly accessibility: ParticleAccessibility;
  /** Emits a burst. Returns how many particles were actually spawned. */
  emit(spec: ParticleEmitSpec): number;
  /** Starts a continuous (optionally trailing) emitter. Returns its handle. */
  addEmitter(spec: ParticleEmitterSpec): number;
  moveEmitter(handle: number, x: number, y: number, z: number): void;
  stopEmitter(handle: number): void;
  step(dt: number): void;
  /** Lowers (or raises, within capacity) the live-particle ceiling. */
  setBudget(budget: number): void;
  setTier(tier: GraphicsTier): void;
  setAccessibility(next: Partial<ParticleAccessibility>): void;
  /** Rebuilds `buffers.live`. `step()` already does this. */
  compact(): number;
  clear(): void;
}

export interface ParticleSystemOptions {
  readonly tier?: GraphicsTier;
  /** Overrides the tier's `particleBudget`. This fixes the allocation size. */
  readonly capacity?: number;
  readonly accessibility?: Partial<ParticleAccessibility>;
  readonly rng?: Rng;
  readonly seed?: number | string;
  readonly emitterCapacity?: number;
}

// ---------------------------------------------------------------------------
// Safety rails and defaults
// ---------------------------------------------------------------------------

/** Longest slice a single `step` integrates. Beyond this, effects slow down. */
const MAX_STEP_SECONDS = 0.1;
/** Defensive ceilings. Nothing in the game should approach either. */
const MAX_SPEED = 240;
const MAX_ABS_POSITION = 5000;
const MAX_LIFETIME = 12;
/** How hard `reducedParticles` cuts a requested count. */
export const REDUCED_PARTICLE_SCALE = 0.35;
/** Brightness ceiling once flashing is reduced. */
const REDUCED_FLASH_BRIGHTNESS = 1.25;
const DEFAULT_EMITTER_CAPACITY = 32;

const DEFAULTS = {
  lifetime: 0.6,
  speed: 3,
  size: 0.12,
  opacity: 0.9,
  fadeIn: 0.08,
  fadePower: 1.4,
  brightness: 1,
  spread: 0.35,
  polygonSides: 6,
} as const;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sampleScalar(value: Scalar | undefined, fallback: number, rng: Rng): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return finiteOr(value, fallback);
  const min = finiteOr(value.min, fallback);
  const max = finiteOr(value.max, min);
  return max > min ? rng.range(min, max) : min;
}

function curveOf(value: number | Curve2 | undefined, fallback: number): Curve2 {
  if (value === undefined) return [fallback, fallback];
  if (typeof value === 'number') {
    const v = finiteOr(value, fallback);
    return [v, v];
  }
  const from = finiteOr(value[0], fallback);
  return [from, finiteOr(value[1], from)];
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export function createParticleSystem(options: ParticleSystemOptions = {}): ParticleSystem {
  const tier: GraphicsTier = options.tier ?? 'high';
  const capacity = Math.max(
    1,
    Math.floor(finiteOr(options.capacity, QUALITY_PRESETS[tier].particleBudget)),
  );
  let budget = capacity;

  const rng: Rng = options.rng ?? createRng(options.seed ?? 'tuner-vfx');

  const access: { reducedParticles: boolean; reducedFlashing: boolean; reducedMotion: boolean } = {
    reducedParticles: options.accessibility?.reducedParticles === true,
    reducedFlashing: options.accessibility?.reducedFlashing === true,
    reducedMotion: options.accessibility?.reducedMotion === true,
  };

  // -- Allocation. This block runs exactly once. ----------------------------
  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const colour = new Float32Array(capacity * 3);
  const colourFrom = new Float32Array(capacity * 3);
  const colourMid = new Float32Array(capacity * 3);
  const colourTo = new Float32Array(capacity * 3);

  const age = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const progress = new Float32Array(capacity);
  const sizeFrom = new Float32Array(capacity);
  const sizeTo = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const alphaPeak = new Float32Array(capacity);
  const fadeIn = new Float32Array(capacity);
  const fadePower = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const brightFrom = new Float32Array(capacity);
  const brightTo = new Float32Array(capacity);
  const brightness = new Float32Array(capacity);
  const flickerHz = new Float32Array(capacity);
  const flickerAmp = new Float32Array(capacity);
  const gravity = new Float32Array(capacity);
  const drag = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const rotation = new Float32Array(capacity);

  const shape = new Uint8Array(capacity);
  const alive = new Uint8Array(capacity);
  const live = new Uint32Array(capacity);

  // Age-ordered doubly linked list of live slots: O(1) append, O(1) removal,
  // and the oldest particle is always at the head — which is what makes
  // "recycle the oldest" cheap enough to do inside a burst loop.
  const nextLive = new Int32Array(capacity).fill(-1);
  const prevLive = new Int32Array(capacity).fill(-1);
  const freeStack = new Uint32Array(capacity);

  const emitterCapacity = Math.max(1, Math.floor(finiteOr(options.emitterCapacity, DEFAULT_EMITTER_CAPACITY)));
  const emitterSpec: (ParticleEmitterSpec | null)[] = new Array<ParticleEmitterSpec | null>(
    emitterCapacity,
  ).fill(null);
  const emitterX = new Float32Array(emitterCapacity);
  const emitterY = new Float32Array(emitterCapacity);
  const emitterZ = new Float32Array(emitterCapacity);
  const emitterPrevX = new Float32Array(emitterCapacity);
  const emitterPrevY = new Float32Array(emitterCapacity);
  const emitterPrevZ = new Float32Array(emitterCapacity);
  const emitterAccum = new Float32Array(emitterCapacity);
  const emitterElapsed = new Float32Array(emitterCapacity);
  const emitterGeneration = new Uint32Array(emitterCapacity);

  const stats = {
    bufferAllocations: 1,
    emitted: 0,
    recycled: 0,
    expired: 0,
    peakActive: 0,
  };

  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;
  let freeCount = capacity;
  let activeCount = 0;
  let liveHead = -1;
  let liveTail = -1;
  let liveDirty = true;
  let emitterCount = 0;

  // Scratch. Reused by every spawn so no emission allocates.
  const axis = { x: 0, y: 1, z: 0 };
  const tan1 = { x: 1, y: 0, z: 0 };
  const tan2 = { x: 0, y: 0, z: 1 };

  const buffers: ParticleBuffers = {
    capacity,
    position,
    velocity,
    colour,
    size,
    alpha,
    brightness,
    rotation,
    progress,
    shape,
    alive,
    live,
  };

  // -- Pool bookkeeping ----------------------------------------------------

  function detach(index: number): void {
    const p = prevLive[index] ?? -1;
    const n = nextLive[index] ?? -1;
    if (p >= 0) nextLive[p] = n;
    else liveHead = n;
    if (n >= 0) prevLive[n] = p;
    else liveTail = p;
    prevLive[index] = -1;
    nextLive[index] = -1;
    alive[index] = 0;
    activeCount -= 1;
    liveDirty = true;
  }

  function attach(index: number): number {
    alive[index] = 1;
    prevLive[index] = liveTail;
    nextLive[index] = -1;
    if (liveTail >= 0) nextLive[liveTail] = index;
    else liveHead = index;
    liveTail = index;
    activeCount += 1;
    if (activeCount > stats.peakActive) stats.peakActive = activeCount;
    liveDirty = true;
    return index;
  }

  function release(index: number): void {
    if (alive[index] !== 1) return;
    detach(index);
    if (freeCount < capacity) {
      freeStack[freeCount] = index;
      freeCount += 1;
    }
  }

  /**
   * Hands out a slot. At the budget it recycles the oldest live particle —
   * never allocates, never refuses the caller.
   */
  function allocate(): number {
    if (activeCount < budget && freeCount > 0) {
      freeCount -= 1;
      const index = freeStack[freeCount] ?? 0;
      return attach(index);
    }
    const oldest = liveHead;
    if (oldest >= 0) {
      stats.recycled += 1;
      detach(oldest);
      return attach(oldest);
    }
    // Only reachable with a zero budget.
    return -1;
  }

  // -- Geometry helpers ----------------------------------------------------

  function setAxis(direction: Readonly<Vec3> | undefined): void {
    const dx = direction === undefined ? 0 : finiteOr(direction.x, 0);
    const dy = direction === undefined ? 1 : finiteOr(direction.y, 0);
    const dz = direction === undefined ? 0 : finiteOr(direction.z, 0);
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) {
      axis.x = 0;
      axis.y = 1;
      axis.z = 0;
    } else {
      axis.x = dx / length;
      axis.y = dy / length;
      axis.z = dz / length;
    }

    // An orthonormal basis for the plane the ring patterns live in.
    const hx = Math.abs(axis.y) < 0.9 ? 0 : 1;
    const hy = Math.abs(axis.y) < 0.9 ? 1 : 0;
    let t1x = axis.y * 0 - axis.z * hy;
    let t1y = axis.z * hx - axis.x * 0;
    let t1z = axis.x * hy - axis.y * hx;
    const t1len = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
    if (t1len < 1e-6) {
      t1x = 1;
      t1y = 0;
      t1z = 0;
    } else {
      t1x /= t1len;
      t1y /= t1len;
      t1z /= t1len;
    }
    tan1.x = t1x;
    tan1.y = t1y;
    tan1.z = t1z;
    tan2.x = axis.y * t1z - axis.z * t1y;
    tan2.y = axis.z * t1x - axis.x * t1z;
    tan2.z = axis.x * t1y - axis.y * t1x;
  }

  // -- Spawning ------------------------------------------------------------

  function spawnOne(
    spec: ParticleEmitSpec,
    indexInBatch: number,
    batchCount: number,
    originX: number,
    originY: number,
    originZ: number,
  ): void {
    const slot = allocate();
    if (slot < 0) return;
    stats.emitted += 1;

    const pattern: EmissionPattern = spec.pattern ?? 'point';
    const motionScale = access.reducedMotion ? 0.62 : 1;

    const speed = sampleScalar(spec.speed, DEFAULTS.speed, rng) * motionScale;
    const axialSpeed = sampleScalar(spec.axialSpeed, 0, rng) * motionScale;
    const spawnRadius = finiteOr(spec.spawnRadius, 0);

    let px = originX;
    let py = originY;
    let pz = originZ;
    let vx = 0;
    let vy = 0;
    let vz = 0;

    if (pattern === 'ring' || pattern === 'disc' || pattern === 'polygon') {
      let angle: number;
      if (pattern === 'polygon') {
        const sides = Math.max(3, Math.floor(finiteOr(spec.polygonSides, DEFAULTS.polygonSides)));
        angle = ((indexInBatch % sides) / sides) * TAU;
      } else if (pattern === 'ring') {
        // Even angular spacing: a figure, not a scatter.
        angle = (indexInBatch / Math.max(1, batchCount)) * TAU;
      } else {
        angle = rng.next() * TAU;
      }
      const radial = pattern === 'disc' ? spawnRadius * Math.sqrt(rng.next()) : spawnRadius;
      const dirX = tan1.x * Math.cos(angle) + tan2.x * Math.sin(angle);
      const dirY = tan1.y * Math.cos(angle) + tan2.y * Math.sin(angle);
      const dirZ = tan1.z * Math.cos(angle) + tan2.z * Math.sin(angle);
      px += dirX * radial;
      py += dirY * radial;
      pz += dirZ * radial;
      vx = dirX * speed + axis.x * axialSpeed;
      vy = dirY * speed + axis.y * axialSpeed;
      vz = dirZ * speed + axis.z * axialSpeed;
    } else if (pattern === 'sphere') {
      const z = rng.range(-1, 1);
      const angle = rng.next() * TAU;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const dirX = Math.cos(angle) * r;
      const dirY = z;
      const dirZ = Math.sin(angle) * r;
      px += dirX * spawnRadius;
      py += dirY * spawnRadius;
      pz += dirZ * spawnRadius;
      vx = dirX * speed;
      vy = dirY * speed;
      vz = dirZ * speed;
    } else if (pattern === 'cone') {
      const spread = clamp(finiteOr(spec.spread, DEFAULTS.spread), 0, Math.PI);
      const angle = rng.next() * TAU;
      const tilt = spread * Math.sqrt(rng.next());
      const sin = Math.sin(tilt);
      const dirX = axis.x * Math.cos(tilt) + (tan1.x * Math.cos(angle) + tan2.x * Math.sin(angle)) * sin;
      const dirY = axis.y * Math.cos(tilt) + (tan1.y * Math.cos(angle) + tan2.y * Math.sin(angle)) * sin;
      const dirZ = axis.z * Math.cos(tilt) + (tan1.z * Math.cos(angle) + tan2.z * Math.sin(angle)) * sin;
      px += dirX * spawnRadius;
      py += dirY * spawnRadius;
      pz += dirZ * spawnRadius;
      vx = dirX * speed;
      vy = dirY * speed;
      vz = dirZ * speed;
    } else if (pattern === 'line') {
      const length = finiteOr(spec.length, 1);
      const t = batchCount <= 1 ? 0 : indexInBatch / (batchCount - 1);
      px -= axis.x * length * t;
      py -= axis.y * length * t;
      pz -= axis.z * length * t;
      vx = axis.x * speed;
      vy = axis.y * speed;
      vz = axis.z * speed;
    } else {
      vx = axis.x * speed;
      vy = axis.y * speed;
      vz = axis.z * speed;
    }

    if (spec.inheritVelocity !== undefined) {
      vx += finiteOr(spec.inheritVelocity.x, 0);
      vy += finiteOr(spec.inheritVelocity.y, 0);
      vz += finiteOr(spec.inheritVelocity.z, 0);
    }

    // Defensive clamp: a bad payload must not launch a particle to infinity.
    const speedMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speedMag > MAX_SPEED) {
      const k = MAX_SPEED / speedMag;
      vx *= k;
      vy *= k;
      vz *= k;
    }

    const i3 = slot * 3;
    position[i3] = clamp(px, -MAX_ABS_POSITION, MAX_ABS_POSITION);
    position[i3 + 1] = clamp(py, -MAX_ABS_POSITION, MAX_ABS_POSITION);
    position[i3 + 2] = clamp(pz, -MAX_ABS_POSITION, MAX_ABS_POSITION);
    velocity[i3] = vx;
    velocity[i3 + 1] = vy;
    velocity[i3 + 2] = vz;

    const from = resolveColour(spec.colour, WHITE);
    const to = resolveColour(spec.colourTo, from);
    const mid =
      spec.colourMid === undefined
        ? ([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2] as Rgb)
        : resolveColour(spec.colourMid, from);
    colourFrom[i3] = clamp01(from[0]);
    colourFrom[i3 + 1] = clamp01(from[1]);
    colourFrom[i3 + 2] = clamp01(from[2]);
    colourMid[i3] = clamp01(mid[0]);
    colourMid[i3 + 1] = clamp01(mid[1]);
    colourMid[i3 + 2] = clamp01(mid[2]);
    colourTo[i3] = clamp01(to[0]);
    colourTo[i3 + 1] = clamp01(to[1]);
    colourTo[i3 + 2] = clamp01(to[2]);
    colour[i3] = colourFrom[i3] ?? 1;
    colour[i3 + 1] = colourFrom[i3 + 1] ?? 1;
    colour[i3 + 2] = colourFrom[i3 + 2] ?? 1;

    const lifeSeconds = clamp(
      sampleScalar(spec.lifetime, DEFAULTS.lifetime, rng) * (access.reducedMotion ? 0.85 : 1),
      0.01,
      MAX_LIFETIME,
    );
    age[slot] = 0;
    life[slot] = lifeSeconds;
    progress[slot] = 0;

    const sizes = curveOf(spec.size, DEFAULTS.size);
    sizeFrom[slot] = Math.max(0, sizes[0]);
    sizeTo[slot] = Math.max(0, sizes[1]);
    size[slot] = sizeFrom[slot] ?? 0;

    alphaPeak[slot] = clamp01(finiteOr(spec.opacity, DEFAULTS.opacity));
    fadeIn[slot] = clamp01(finiteOr(spec.fadeIn, DEFAULTS.fadeIn));
    fadePower[slot] = clamp(finiteOr(spec.fadePower, DEFAULTS.fadePower), 0.1, 8);
    alpha[slot] = fadeIn[slot] === 0 ? (alphaPeak[slot] ?? 0) : 0;

    const brights = curveOf(spec.brightness, DEFAULTS.brightness);
    const brightCap = access.reducedFlashing ? REDUCED_FLASH_BRIGHTNESS : 6;
    brightFrom[slot] = clamp(brights[0], 0, brightCap);
    brightTo[slot] = clamp(brights[1], 0, brightCap);
    brightness[slot] = brightFrom[slot] ?? 1;
    // Reduced flashing removes oscillation outright rather than damping it: a
    // slow strobe is still a strobe.
    flickerHz[slot] = access.reducedFlashing ? 0 : Math.max(0, finiteOr(spec.flickerHz, 0));
    flickerAmp[slot] = access.reducedFlashing
      ? 0
      : clamp(finiteOr(spec.flickerAmount, 0), 0, 0.9);

    gravity[slot] = finiteOr(spec.gravity, 0);
    drag[slot] = clamp(finiteOr(spec.drag, 0), 0, 40);
    spin[slot] = sampleScalar(spec.spin, 0, rng) * (access.reducedMotion ? 0.35 : 1);
    rotation[slot] = rng.next() * TAU;
    shape[slot] = SHAPE_INDEX[spec.shape ?? 'mote'];
  }

  /** Applies the accessibility reduction to a requested count. */
  function scaleCount(requested: number): number {
    const count = Math.max(0, Math.floor(finiteOr(requested, 1)));
    if (count === 0) return 0;
    if (!access.reducedParticles) return count;
    // Never to zero: a reduced cue is still a cue.
    return Math.max(1, Math.round(count * REDUCED_PARTICLE_SCALE));
  }

  function emitBatch(
    spec: ParticleEmitSpec,
    total: number,
    originX: number,
    originY: number,
    originZ: number,
  ): number {
    if (total <= 0) return 0;
    setAxis(spec.direction);
    // A batch larger than the whole budget keeps its *last* particles: the
    // newest emission wins, the oldest is what gets left behind.
    const first = Math.max(0, total - budget);
    for (let i = first; i < total; i++) {
      spawnOne(spec, i, total, originX, originY, originZ);
    }
    return total - first;
  }

  // -- Emitters ------------------------------------------------------------

  function decodeSlot(handle: number): number {
    if (!Number.isFinite(handle) || handle < 0) return -1;
    const slot = Math.floor(handle) % emitterCapacity;
    const generation = Math.floor(Math.floor(handle) / emitterCapacity);
    if (emitterSpec[slot] === null) return -1;
    if (emitterGeneration[slot] !== generation) return -1;
    return slot;
  }

  function stopSlot(slot: number): void {
    if (emitterSpec[slot] === null) return;
    emitterSpec[slot] = null;
    emitterCount -= 1;
  }

  function setBudget(next: number): void {
    budget = clamp(Math.floor(finiteOr(next, capacity)), 0, capacity);
    // Shrinking the budget trims from the oldest end, never the newest.
    while (activeCount > budget && liveHead >= 0) {
      stats.recycled += 1;
      release(liveHead);
    }
  }

  // -- Public API ----------------------------------------------------------

  function compact(): number {
    if (liveDirty) {
      let count = 0;
      for (let index = liveHead; index >= 0 && count < capacity; index = nextLive[index] ?? -1) {
        live[count] = index;
        count += 1;
      }
      liveDirty = false;
    }
    return activeCount;
  }

  function step(dt: number): void {
    const delta = clamp(finiteOr(dt, 0), 0, MAX_STEP_SECONDS);
    if (delta <= 0) {
      compact();
      return;
    }

    // Emitters first, so a particle spawned this frame is integrated this frame
    // and a trail is continuous across the segment just travelled.
    for (let slot = 0; slot < emitterCapacity; slot++) {
      const spec = emitterSpec[slot];
      if (spec === null || spec === undefined) continue;

      emitterElapsed[slot] = (emitterElapsed[slot] ?? 0) + delta;
      const rate = Math.max(0, finiteOr(spec.ratePerSecond, 0));
      // Fractional emissions carry across steps, so the rate is honoured at any
      // frame rate instead of rounding down to zero on a fast frame.
      const scaledRate = access.reducedParticles ? rate * REDUCED_PARTICLE_SCALE : rate;
      emitterAccum[slot] = (emitterAccum[slot] ?? 0) + scaledRate * delta;

      const whole = Math.floor(emitterAccum[slot] ?? 0);
      if (whole > 0) {
        emitterAccum[slot] = (emitterAccum[slot] ?? 0) - whole;
        const cx = emitterX[slot] ?? 0;
        const cy = emitterY[slot] ?? 0;
        const cz = emitterZ[slot] ?? 0;
        if (spec.trail === true) {
          const ax = emitterPrevX[slot] ?? cx;
          const ay = emitterPrevY[slot] ?? cy;
          const az = emitterPrevZ[slot] ?? cz;
          setAxis(spec.direction);
          for (let i = 0; i < whole; i++) {
            // Oldest sample at the far end of the segment travelled.
            const t = whole <= 1 ? 1 : i / (whole - 1);
            spawnOne(spec, i, whole, ax + (cx - ax) * t, ay + (cy - ay) * t, az + (cz - az) * t);
          }
        } else {
          emitBatch(spec, whole, cx, cy, cz);
        }
      }

      emitterPrevX[slot] = emitterX[slot] ?? 0;
      emitterPrevY[slot] = emitterY[slot] ?? 0;
      emitterPrevZ[slot] = emitterZ[slot] ?? 0;

      const duration = finiteOr(spec.durationSeconds, 0);
      if (duration > 0 && (emitterElapsed[slot] ?? 0) >= duration) stopSlot(slot);
    }

    // Integrate. Walk the live list so an empty pool costs nothing.
    let index = liveHead;
    while (index >= 0) {
      const nextIndex = nextLive[index] ?? -1;
      const i3 = index * 3;

      const nextAge = (age[index] ?? 0) + delta;
      const maxLife = life[index] ?? 1;
      if (nextAge >= maxLife) {
        stats.expired += 1;
        release(index);
        index = nextIndex;
        continue;
      }
      age[index] = nextAge;
      const t = clamp01(nextAge / maxLife);
      progress[index] = t;

      const g = gravity[index] ?? 0;
      let vx = velocity[i3] ?? 0;
      let vy = velocity[i3 + 1] ?? 0;
      let vz = velocity[i3 + 2] ?? 0;
      let px = position[i3] ?? 0;
      let py = position[i3 + 1] ?? 0;
      let pz = position[i3 + 2] ?? 0;

      // Both branches are the *closed form* of the motion over the step, not an
      // Euler approximation of it. That is what makes an effect land in the same
      // place at 30 fps and at 240 — a fountain of sparks that reaches a
      // different height on a faster machine is a correctness bug, not a detail.
      const d = drag[index] ?? 0;
      if (d > 0) {
        // dv/dt = a - d*v  =>  v(t) = vT + (v0 - vT) e^(-d t)
        const decay = Math.exp(-d * delta);
        const travel = (1 - decay) / d;
        const terminalY = g / d;
        px += vx * travel;
        py += terminalY * delta + (vy - terminalY) * travel;
        pz += vz * travel;
        vx *= decay;
        vy = terminalY + (vy - terminalY) * decay;
        vz *= decay;
      } else {
        px += vx * delta;
        py += vy * delta + 0.5 * g * delta * delta;
        pz += vz * delta;
        vy += g * delta;
      }

      px = clamp(px, -MAX_ABS_POSITION, MAX_ABS_POSITION);
      py = clamp(py, -MAX_ABS_POSITION, MAX_ABS_POSITION);
      pz = clamp(pz, -MAX_ABS_POSITION, MAX_ABS_POSITION);
      position[i3] = px;
      position[i3 + 1] = py;
      position[i3 + 2] = pz;
      velocity[i3] = clamp(vx, -MAX_SPEED, MAX_SPEED);
      velocity[i3 + 1] = clamp(vy, -MAX_SPEED, MAX_SPEED);
      velocity[i3 + 2] = clamp(vz, -MAX_SPEED, MAX_SPEED);

      size[index] = (sizeFrom[index] ?? 0) + ((sizeTo[index] ?? 0) - (sizeFrom[index] ?? 0)) * t;

      // Three-stop colour ramp — violet through magenta into green is the
      // cleanse, and it needs the middle stop to read as a transformation.
      if (t < 0.5) {
        const k = t * 2;
        colour[i3] = (colourFrom[i3] ?? 0) + ((colourMid[i3] ?? 0) - (colourFrom[i3] ?? 0)) * k;
        colour[i3 + 1] =
          (colourFrom[i3 + 1] ?? 0) + ((colourMid[i3 + 1] ?? 0) - (colourFrom[i3 + 1] ?? 0)) * k;
        colour[i3 + 2] =
          (colourFrom[i3 + 2] ?? 0) + ((colourMid[i3 + 2] ?? 0) - (colourFrom[i3 + 2] ?? 0)) * k;
      } else {
        const k = t * 2 - 1;
        colour[i3] = (colourMid[i3] ?? 0) + ((colourTo[i3] ?? 0) - (colourMid[i3] ?? 0)) * k;
        colour[i3 + 1] =
          (colourMid[i3 + 1] ?? 0) + ((colourTo[i3 + 1] ?? 0) - (colourMid[i3 + 1] ?? 0)) * k;
        colour[i3 + 2] =
          (colourMid[i3 + 2] ?? 0) + ((colourTo[i3 + 2] ?? 0) - (colourMid[i3 + 2] ?? 0)) * k;
      }

      const fade = fadeIn[index] ?? 0;
      const rise = fade > 0 ? Math.min(1, t / fade) : 1;
      alpha[index] = (alphaPeak[index] ?? 0) * rise * Math.pow(1 - t, fadePower[index] ?? 1);

      let bright = (brightFrom[index] ?? 1) + ((brightTo[index] ?? 1) - (brightFrom[index] ?? 1)) * t;
      const amp = flickerAmp[index] ?? 0;
      if (amp > 0) {
        bright *= 1 + amp * Math.sin(TAU * (flickerHz[index] ?? 0) * nextAge);
      }
      brightness[index] = Math.max(0, bright);

      rotation[index] = ((rotation[index] ?? 0) + (spin[index] ?? 0) * delta) % TAU;

      index = nextIndex;
    }

    compact();
  }

  return {
    buffers,
    capacity,
    get budget() {
      return budget;
    },
    get activeCount() {
      return activeCount;
    },
    get freeCount() {
      return freeCount;
    },
    get emitterCount() {
      return emitterCount;
    },
    stats,
    get accessibility(): ParticleAccessibility {
      return access;
    },

    emit(spec) {
      return emitBatch(
        spec,
        scaleCount(spec.count ?? 1),
        finiteOr(spec.position?.x, 0),
        finiteOr(spec.position?.y, 0),
        finiteOr(spec.position?.z, 0),
      );
    },

    addEmitter(spec) {
      let slot = -1;
      for (let i = 0; i < emitterCapacity; i++) {
        if (emitterSpec[i] === null) {
          slot = i;
          break;
        }
      }
      // Full: replace slot zero rather than silently doing nothing. The count is
      // unchanged in that case because an existing emitter was displaced.
      if (slot < 0) slot = 0;
      else emitterCount += 1;

      emitterSpec[slot] = spec;
      emitterGeneration[slot] = ((emitterGeneration[slot] ?? 0) + 1) >>> 0;
      const x = finiteOr(spec.position?.x, 0);
      const y = finiteOr(spec.position?.y, 0);
      const z = finiteOr(spec.position?.z, 0);
      emitterX[slot] = x;
      emitterY[slot] = y;
      emitterZ[slot] = z;
      emitterPrevX[slot] = x;
      emitterPrevY[slot] = y;
      emitterPrevZ[slot] = z;
      emitterAccum[slot] = 0;
      emitterElapsed[slot] = 0;
      return slot + (emitterGeneration[slot] ?? 0) * emitterCapacity;
    },

    moveEmitter(handle, x, y, z) {
      const slot = decodeSlot(handle);
      if (slot < 0) return;
      emitterX[slot] = finiteOr(x, emitterX[slot] ?? 0);
      emitterY[slot] = finiteOr(y, emitterY[slot] ?? 0);
      emitterZ[slot] = finiteOr(z, emitterZ[slot] ?? 0);
    },

    stopEmitter(handle) {
      const slot = decodeSlot(handle);
      if (slot < 0) return;
      stopSlot(slot);
    },

    step,
    compact,
    setBudget,

    setTier(nextTier) {
      setBudget(QUALITY_PRESETS[nextTier].particleBudget);
    },

    setAccessibility(next) {
      if (next.reducedParticles !== undefined) access.reducedParticles = next.reducedParticles;
      if (next.reducedMotion !== undefined) access.reducedMotion = next.reducedMotion;
      if (next.reducedFlashing !== undefined) {
        access.reducedFlashing = next.reducedFlashing;
        if (access.reducedFlashing) {
          // Existing particles stop oscillating immediately — a player toggling
          // the setting mid-fight must not have to wait out the current burst.
          for (let i = 0; i < capacity; i++) {
            flickerAmp[i] = 0;
            flickerHz[i] = 0;
            brightFrom[i] = Math.min(brightFrom[i] ?? 0, REDUCED_FLASH_BRIGHTNESS);
            brightTo[i] = Math.min(brightTo[i] ?? 0, REDUCED_FLASH_BRIGHTNESS);
            brightness[i] = Math.min(brightness[i] ?? 0, REDUCED_FLASH_BRIGHTNESS);
          }
        }
      }
    },

    clear() {
      for (let i = 0; i < capacity; i++) {
        alive[i] = 0;
        prevLive[i] = -1;
        nextLive[i] = -1;
        freeStack[i] = capacity - 1 - i;
        alpha[i] = 0;
        size[i] = 0;
      }
      freeCount = capacity;
      activeCount = 0;
      liveHead = -1;
      liveTail = -1;
      liveDirty = true;
      for (let slot = 0; slot < emitterCapacity; slot++) emitterSpec[slot] = null;
      emitterCount = 0;
      compact();
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry echoes
// ---------------------------------------------------------------------------

/**
 * The other half of the visual language: rings, polygons and arcs.
 *
 * Concentric circles, interlocking arcs and regular polygons carry almost every
 * cue in this game — a struck note, a charge tier, a shockwave, a cleanse. They
 * are pooled exactly like particles, and for the same reason.
 *
 * ---------------------------------------------------------------------------
 * THE NO-OBSCURING RULE IS ENFORCED HERE, NOT LEFT TO TASTE
 * ---------------------------------------------------------------------------
 * An effect that hides the ledge a player is about to land on is a bug, so the
 * limits are structural: radius, opacity and lifetime are clamped on the way in,
 * the geometry is a thin annulus rather than a disc, and the renderer draws it
 * additively — additive blending can only *lighten* the ground behind it, so a
 * platform can never be blotted out by a ring, no matter how many overlap.
 */
export const ECHO_FORMS = ['circle', 'triangle', 'square', 'hexagon', 'arc'] as const;
export type EchoForm = (typeof ECHO_FORMS)[number];

const ECHO_FORM_INDEX: Readonly<Record<EchoForm, number>> = {
  circle: 0,
  triangle: 1,
  square: 2,
  hexagon: 3,
  arc: 4,
};

export const ECHO_ORIENTATIONS = ['ground', 'billboard', 'normal'] as const;
export type EchoOrientation = (typeof ECHO_ORIENTATIONS)[number];

const ECHO_ORIENTATION_INDEX: Readonly<Record<EchoOrientation, number>> = {
  ground: 0,
  billboard: 1,
  normal: 2,
};

/** Nothing may fill the screen. Twelve metres is a wide shockwave, not a wall. */
export const MAX_ECHO_RADIUS = 12;
/** Ground rings stay translucent so the surface underneath stays readable. */
export const MAX_ECHO_OPACITY = 0.6;
export const MAX_ECHO_LIFETIME = 3;
/** Inner/outer ratio of the annulus geometry. Thin by construction. */
export const ECHO_RING_RATIO = 0.86;
/** Lift applied to ground rings so they do not z-fight with the floor. */
export const ECHO_GROUND_LIFT = 0.06;

export interface EchoSpec {
  readonly position: Readonly<Vec3>;
  readonly form?: EchoForm;
  readonly orientation?: EchoOrientation;
  /** Facing direction for the `normal` orientation. */
  readonly normal?: Readonly<Vec3>;
  readonly radiusFrom?: number;
  /** Below `radiusFrom` the ring closes inward — the language of a wind-up. */
  readonly radiusTo?: number;
  readonly colour?: ColourInput;
  readonly colourTo?: ColourInput;
  readonly opacity?: number;
  readonly fadePower?: number;
  readonly lifetime?: number;
  readonly brightness?: number;
  readonly spin?: number;
  /** Held invisible for this long first, which is how a set reads as a chord. */
  readonly delay?: number;
}

export interface EchoBuffers {
  readonly capacity: number;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** rgb per echo, straight sRGB in 0..1. */
  readonly colour: Float32Array;
  readonly radius: Float32Array;
  readonly alpha: Float32Array;
  readonly brightness: Float32Array;
  readonly rotation: Float32Array;
  readonly form: Uint8Array;
  readonly orientation: Uint8Array;
  readonly alive: Uint8Array;
  readonly live: Uint32Array;
}

export interface EchoStats {
  readonly bufferAllocations: number;
  readonly spawned: number;
  readonly recycled: number;
  readonly expired: number;
}

export interface GeometryEchoField {
  readonly buffers: EchoBuffers;
  readonly capacity: number;
  readonly activeCount: number;
  readonly stats: EchoStats;
  /** Returns the slot used, or -1 when the field is disabled. */
  spawn(spec: EchoSpec): number;
  step(dt: number): void;
  compact(): number;
  setAccessibility(next: Partial<ParticleAccessibility>): void;
  clear(): void;
}

export interface GeometryEchoOptions {
  readonly capacity?: number;
  readonly accessibility?: Partial<ParticleAccessibility>;
}

const DEFAULT_ECHO_CAPACITY = 96;

export function createGeometryEchoes(options: GeometryEchoOptions = {}): GeometryEchoField {
  const capacity = Math.max(1, Math.floor(finiteOr(options.capacity, DEFAULT_ECHO_CAPACITY)));

  const access = {
    reducedParticles: options.accessibility?.reducedParticles === true,
    reducedFlashing: options.accessibility?.reducedFlashing === true,
    reducedMotion: options.accessibility?.reducedMotion === true,
  };

  const position = new Float32Array(capacity * 3);
  const normal = new Float32Array(capacity * 3);
  const colour = new Float32Array(capacity * 3);
  const colourFrom = new Float32Array(capacity * 3);
  const colourTo = new Float32Array(capacity * 3);
  const radius = new Float32Array(capacity);
  const radiusFrom = new Float32Array(capacity);
  const radiusTo = new Float32Array(capacity);
  const alpha = new Float32Array(capacity);
  const alphaPeak = new Float32Array(capacity);
  const fadePower = new Float32Array(capacity);
  const brightness = new Float32Array(capacity);
  const rotation = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const age = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const delay = new Float32Array(capacity);
  const form = new Uint8Array(capacity);
  const orientation = new Uint8Array(capacity);
  const alive = new Uint8Array(capacity);
  const live = new Uint32Array(capacity);
  const order = new Uint32Array(capacity);

  const stats = { bufferAllocations: 1, spawned: 0, recycled: 0, expired: 0 };

  let activeCount = 0;
  let sequence = 0;

  const buffers: EchoBuffers = {
    capacity,
    position,
    normal,
    colour,
    radius,
    alpha,
    brightness,
    rotation,
    form,
    orientation,
    alive,
    live,
  };

  /** Free slot, else the oldest live one. Never allocates. */
  function allocate(): number {
    for (let i = 0; i < capacity; i++) {
      if (alive[i] === 0) {
        alive[i] = 1;
        activeCount += 1;
        return i;
      }
    }
    let oldest = 0;
    let oldestOrder = Number.POSITIVE_INFINITY;
    for (let i = 0; i < capacity; i++) {
      const o = order[i] ?? 0;
      if (o < oldestOrder) {
        oldestOrder = o;
        oldest = i;
      }
    }
    stats.recycled += 1;
    return oldest;
  }

  function compact(): number {
    let count = 0;
    for (let i = 0; i < capacity; i++) {
      if (alive[i] === 1) {
        live[count] = i;
        count += 1;
      }
    }
    return count;
  }

  return {
    buffers,
    capacity,
    get activeCount() {
      return activeCount;
    },
    stats,

    spawn(spec) {
      const slot = allocate();
      if (slot < 0) return -1;
      stats.spawned += 1;
      order[slot] = sequence;
      sequence = (sequence + 1) >>> 0;

      const i3 = slot * 3;
      const isGround = (spec.orientation ?? 'ground') === 'ground';
      position[i3] = finiteOr(spec.position?.x, 0);
      position[i3 + 1] = finiteOr(spec.position?.y, 0) + (isGround ? ECHO_GROUND_LIFT : 0);
      position[i3 + 2] = finiteOr(spec.position?.z, 0);

      if (isGround) {
        normal[i3] = 0;
        normal[i3 + 1] = 1;
        normal[i3 + 2] = 0;
      } else {
        const nx = finiteOr(spec.normal?.x, 0);
        const ny = finiteOr(spec.normal?.y, 1);
        const nz = finiteOr(spec.normal?.z, 0);
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (length < 1e-6) {
          normal[i3] = 0;
          normal[i3 + 1] = 1;
          normal[i3 + 2] = 0;
        } else {
          normal[i3] = nx / length;
          normal[i3 + 1] = ny / length;
          normal[i3 + 2] = nz / length;
        }
      }

      const from = resolveColour(spec.colour, WHITE);
      const to = resolveColour(spec.colourTo, from);
      colourFrom[i3] = clamp01(from[0]);
      colourFrom[i3 + 1] = clamp01(from[1]);
      colourFrom[i3 + 2] = clamp01(from[2]);
      colourTo[i3] = clamp01(to[0]);
      colourTo[i3 + 1] = clamp01(to[1]);
      colourTo[i3 + 2] = clamp01(to[2]);
      colour[i3] = colourFrom[i3] ?? 1;
      colour[i3 + 1] = colourFrom[i3 + 1] ?? 1;
      colour[i3 + 2] = colourFrom[i3 + 2] ?? 1;

      radiusFrom[slot] = clamp(finiteOr(spec.radiusFrom, 0.2), 0, MAX_ECHO_RADIUS);
      radiusTo[slot] = clamp(finiteOr(spec.radiusTo, 1), 0, MAX_ECHO_RADIUS);
      radius[slot] = radiusFrom[slot] ?? 0;

      alphaPeak[slot] = clamp(finiteOr(spec.opacity, 0.45), 0, MAX_ECHO_OPACITY);
      fadePower[slot] = clamp(finiteOr(spec.fadePower, 1.5), 0.1, 8);
      alpha[slot] = 0;
      brightness[slot] = clamp(
        finiteOr(spec.brightness, 1),
        0,
        access.reducedFlashing ? REDUCED_FLASH_BRIGHTNESS : 4,
      );
      rotation[slot] = 0;
      spin[slot] = finiteOr(spec.spin, 0) * (access.reducedMotion ? 0.3 : 1);
      age[slot] = 0;
      life[slot] = clamp(
        finiteOr(spec.lifetime, 0.4) * (access.reducedMotion ? 0.8 : 1),
        0.05,
        MAX_ECHO_LIFETIME,
      );
      delay[slot] = clamp(finiteOr(spec.delay, 0), 0, MAX_ECHO_LIFETIME);
      form[slot] = ECHO_FORM_INDEX[spec.form ?? 'circle'];
      orientation[slot] = ECHO_ORIENTATION_INDEX[spec.orientation ?? 'ground'];
      return slot;
    },

    step(dt) {
      const delta = clamp(finiteOr(dt, 0), 0, MAX_STEP_SECONDS);
      if (delta <= 0) return;

      for (let i = 0; i < capacity; i++) {
        if (alive[i] !== 1) continue;

        // A staggered set of rings is how a chord reads visually, so the delay
        // consumes only as much of the step as it needs — the leftover advances
        // the echo in the same frame rather than costing it a whole one.
        let slice = delta;
        const held = delay[i] ?? 0;
        if (held > 0) {
          const used = Math.min(held, slice);
          delay[i] = held - used;
          slice -= used;
          if (slice <= 1e-8) {
            alpha[i] = 0;
            continue;
          }
        }

        const nextAge = (age[i] ?? 0) + slice;
        const maxLife = life[i] ?? 1;
        if (nextAge >= maxLife) {
          alive[i] = 0;
          alpha[i] = 0;
          activeCount -= 1;
          stats.expired += 1;
          continue;
        }
        age[i] = nextAge;
        const t = clamp01(nextAge / maxLife);
        // Ease out: a ring leaps and settles, which reads as a struck resonance.
        const eased = 1 - (1 - t) * (1 - t);

        radius[i] = (radiusFrom[i] ?? 0) + ((radiusTo[i] ?? 0) - (radiusFrom[i] ?? 0)) * eased;
        alpha[i] = (alphaPeak[i] ?? 0) * Math.pow(1 - t, fadePower[i] ?? 1);
        rotation[i] = ((rotation[i] ?? 0) + (spin[i] ?? 0) * slice) % TAU;

        const i3 = i * 3;
        colour[i3] = (colourFrom[i3] ?? 0) + ((colourTo[i3] ?? 0) - (colourFrom[i3] ?? 0)) * t;
        colour[i3 + 1] =
          (colourFrom[i3 + 1] ?? 0) + ((colourTo[i3 + 1] ?? 0) - (colourFrom[i3 + 1] ?? 0)) * t;
        colour[i3 + 2] =
          (colourFrom[i3 + 2] ?? 0) + ((colourTo[i3 + 2] ?? 0) - (colourFrom[i3 + 2] ?? 0)) * t;
      }

      compact();
    },

    compact,

    setAccessibility(next) {
      if (next.reducedParticles !== undefined) access.reducedParticles = next.reducedParticles;
      if (next.reducedMotion !== undefined) access.reducedMotion = next.reducedMotion;
      if (next.reducedFlashing !== undefined) {
        access.reducedFlashing = next.reducedFlashing;
        if (access.reducedFlashing) {
          for (let i = 0; i < capacity; i++) {
            brightness[i] = Math.min(brightness[i] ?? 0, REDUCED_FLASH_BRIGHTNESS);
          }
        }
      }
    },

    clear() {
      for (let i = 0; i < capacity; i++) {
        alive[i] = 0;
        alpha[i] = 0;
        radius[i] = 0;
      }
      activeCount = 0;
      compact();
    },
  };
}
