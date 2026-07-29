import { MAX_FRAME_SECONDS, SIM_STEP_SECONDS } from './constants.js';

/**
 * Fixed-timestep accumulator.
 *
 * Simulation always advances in equal slices so movement, dashes and boss
 * timings behave identically at 30, 60 or 144 fps. Rendering receives `alpha`
 * and interpolates between the previous and current simulation state, which is
 * what keeps motion smooth when the display rate is not a multiple of `SIM_HZ`.
 */

export interface FixedStepDriver {
  /**
   * Feeds real elapsed time in and runs zero or more fixed steps.
   * Returns the interpolation factor in [0, 1) for the render pass.
   */
  advance(deltaSeconds: number, step: (fixedDelta: number) => void): number;
  /** Steps actually run during the most recent `advance`. */
  readonly lastStepCount: number;
  /** True when the accumulator hit its ceiling and time was discarded. */
  readonly lastFrameClamped: boolean;
  reset(): void;
}

export function createFixedStepDriver(options?: {
  stepSeconds?: number;
  maxFrameSeconds?: number;
  /** Safety valve: never run more than this many steps in one frame. */
  maxStepsPerFrame?: number;
}): FixedStepDriver {
  const stepSeconds = options?.stepSeconds ?? SIM_STEP_SECONDS;
  const maxFrameSeconds = options?.maxFrameSeconds ?? MAX_FRAME_SECONDS;
  const maxStepsPerFrame = options?.maxStepsPerFrame ?? 8;

  let accumulator = 0;
  let lastStepCount = 0;
  let lastFrameClamped = false;

  return {
    advance(deltaSeconds, step) {
      lastFrameClamped = false;

      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        deltaSeconds = 0;
      }
      if (deltaSeconds > maxFrameSeconds) {
        // A backgrounded tab must resume, not catch up on thirty seconds.
        deltaSeconds = maxFrameSeconds;
        lastFrameClamped = true;
      }

      accumulator += deltaSeconds;

      let steps = 0;
      while (accumulator >= stepSeconds && steps < maxStepsPerFrame) {
        step(stepSeconds);
        accumulator -= stepSeconds;
        steps++;
      }

      if (steps >= maxStepsPerFrame && accumulator >= stepSeconds) {
        // Machine cannot keep up; shed the backlog instead of spiralling.
        accumulator = 0;
        lastFrameClamped = true;
      }

      lastStepCount = steps;
      return accumulator / stepSeconds;
    },

    get lastStepCount() {
      return lastStepCount;
    },

    get lastFrameClamped() {
      return lastFrameClamped;
    },

    reset() {
      accumulator = 0;
      lastStepCount = 0;
      lastFrameClamped = false;
    },
  };
}
