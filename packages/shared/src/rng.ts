/**
 * Deterministic pseudo-random numbers.
 *
 * The simulation must replay identically from the same seed so that stage
 * layouts, enemy variation and boss pattern shuffles are reproducible in tests
 * and across platforms. `Math.random` is deliberately never used inside
 * `@tuner/game-core`.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniformly picks one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Returns a shuffled copy, leaving the input untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Current internal state, for save/restore. */
  getState(): number;
  setState(state: number): void;
  /** A new independent stream derived from this one. */
  fork(): Rng;
}

/** Hashes an arbitrary string into a 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, and good enough for gameplay variation. */
export function createRng(seed: number | string = 0x5eed): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('Rng.pick called with an empty list');
      }
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    getState: () => state,
    setState: (s) => {
      state = s >>> 0;
    },
    fork: () => createRng(Math.floor(next() * 0xffffffff)),
  };

  return rng;
}
