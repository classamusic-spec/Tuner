/**
 * Entity identifiers.
 *
 * Ids are monotonic numbers rather than strings so lookups stay cheap and the
 * simulation stays deterministic — no timestamps, no randomness.
 */

export type EntityId = number & { readonly __brand: 'EntityId' };

export const NULL_ENTITY = 0 as EntityId;

export interface IdAllocator {
  next(): EntityId;
  /** Restores the counter when loading a save. */
  restore(value: number): void;
  peek(): number;
}

export function createIdAllocator(start = 1): IdAllocator {
  let counter = start;
  return {
    next: () => counter++ as EntityId,
    restore: (value) => {
      counter = Math.max(counter, value);
    },
    peek: () => counter,
  };
}
