/**
 * Object pooling.
 *
 * Projectiles, hit sparks and enemy instances churn hard during combat. Pooling
 * them keeps the fixed step free of per-frame allocation, which is what stops
 * garbage-collection pauses from showing up as stutter on mobile.
 */

export interface Pool<T> {
  acquire(): T;
  release(item: T): void;
  /** Number of live (acquired) objects. */
  readonly activeCount: number;
  /** Number of pooled (available) objects. */
  readonly freeCount: number;
  /** Total objects ever constructed — a useful budget assertion in tests. */
  readonly createdCount: number;
  releaseAll(): void;
}

export function createPool<T>(options: {
  create: () => T;
  reset: (item: T) => void;
  initialSize?: number;
  /** Hard ceiling; `acquire` past it reuses the oldest live object. */
  maxSize?: number;
}): Pool<T> {
  const { create, reset, initialSize = 0, maxSize = Number.POSITIVE_INFINITY } = options;

  const free: T[] = [];
  const active = new Set<T>();
  // Insertion order lets us evict the oldest object when the cap is hit.
  const activeOrder: T[] = [];
  let createdCount = 0;

  for (let i = 0; i < initialSize; i++) {
    free.push(create());
    createdCount++;
  }

  const markActive = (item: T): T => {
    active.add(item);
    activeOrder.push(item);
    return item;
  };

  const unmarkActive = (item: T): void => {
    active.delete(item);
    const index = activeOrder.indexOf(item);
    if (index >= 0) activeOrder.splice(index, 1);
  };

  return {
    acquire() {
      const pooled = free.pop();
      if (pooled !== undefined) {
        reset(pooled);
        return markActive(pooled);
      }

      if (createdCount >= maxSize) {
        // At capacity: recycle the oldest live object rather than growing.
        const oldest = activeOrder.shift();
        if (oldest !== undefined) {
          active.delete(oldest);
          reset(oldest);
          return markActive(oldest);
        }
      }

      const created = create();
      createdCount++;
      reset(created);
      return markActive(created);
    },

    release(item) {
      if (!active.has(item)) return;
      unmarkActive(item);
      free.push(item);
    },

    get activeCount() {
      return active.size;
    },

    get freeCount() {
      return free.length;
    },

    get createdCount() {
      return createdCount;
    },

    releaseAll() {
      for (const item of activeOrder) free.push(item);
      active.clear();
      activeOrder.length = 0;
    },
  };
}
