/**
 * A tiny typed publish/subscribe bus.
 *
 * The simulation emits presentation events (hits, pickups, boss phase changes)
 * without knowing whether anything is listening. Rendering, audio and UI each
 * subscribe to the slices they care about, which is what keeps `@tuner/game-core`
 * free of Three.js and React.
 */

/**
 * Any interface may serve as an event map. This is deliberately looser than
 * `Record<string, unknown>` so that a hand-written interface — which has no
 * index signature — can be used directly as the map.
 */
export type EventMap = object;
export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export interface EventBus<M extends EventMap> {
  on<K extends keyof M & string>(type: K, listener: Listener<M[K]>): Unsubscribe;
  once<K extends keyof M & string>(type: K, listener: Listener<M[K]>): Unsubscribe;
  off<K extends keyof M & string>(type: K, listener: Listener<M[K]>): void;
  emit<K extends keyof M & string>(type: K, payload: M[K]): void;
  /** Number of live listeners — used by tests to assert teardown. */
  listenerCount(type?: string): number;
  clear(): void;
}

export function createEventBus<M extends EventMap>(options?: {
  onListenerError?: (error: unknown, type: string) => void;
}): EventBus<M> {
  const listeners = new Map<string, Set<Listener<never>>>();
  const onListenerError =
    options?.onListenerError ??
    ((error: unknown, type: string) => {
      // A misbehaving listener must never take down the simulation step.
      console.error(`[event-bus] listener for "${type}" threw`, error);
    });

  const off = (type: string, listener: Listener<never>): void => {
    const set = listeners.get(type);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) listeners.delete(type);
  };

  return {
    on(type, listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener as Listener<never>);
      return () => off(type, listener as Listener<never>);
    },

    once(type, listener) {
      const wrapper = ((payload: never) => {
        off(type, wrapper);
        (listener as Listener<never>)(payload);
      }) as Listener<never>;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(wrapper);
      return () => off(type, wrapper);
    },

    off(type, listener) {
      off(type, listener as Listener<never>);
    },

    emit(type, payload) {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      // Copy so a listener may unsubscribe (or subscribe) during dispatch.
      for (const listener of Array.from(set)) {
        try {
          (listener as Listener<unknown>)(payload);
        } catch (error) {
          onListenerError(error, type);
        }
      }
    },

    listenerCount(type) {
      if (type !== undefined) return listeners.get(type)?.size ?? 0;
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },

    clear() {
      listeners.clear();
    },
  };
}
