/** Scalar helpers shared by simulation, rendering and UI. */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (Math.abs(b - a) < 1e-9) return 0;
  return (value - a) / (b - a);
}

export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, clamp01(inverseLerp(inMin, inMax, value)));
}

/**
 * Framerate-independent exponential smoothing.
 *
 * `smoothing` is the fraction of the remaining distance left after one second,
 * so 0.01 means "close 99% of the gap per second" regardless of step size.
 */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  return lerp(target, current, Math.pow(clamp01(smoothing), dt));
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angular difference from `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDelta(from, to) * t);
}

export function dampAngle(
  current: number,
  target: number,
  smoothing: number,
  dt: number,
): number {
  return lerpAngle(target, current, Math.pow(clamp01(smoothing), dt));
}

export function moveTowardsAngle(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxDelta);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Applies a radial dead zone and rescales the remainder to the full 0..1 range. */
export function applyDeadzone(value: number, deadzone: number): number {
  const mag = Math.abs(value);
  if (mag <= deadzone) return 0;
  const scaled = (mag - deadzone) / (1 - deadzone);
  return Math.sign(value) * clamp01(scaled);
}

/**
 * Semitone offset between two frequencies. The game uses this to express how
 * far a region has drifted from the 432 Hz world rhythm.
 */
export function semitonesBetween(fromHz: number, toHz: number): number {
  if (fromHz <= 0 || toHz <= 0) return 0;
  return 12 * Math.log2(toHz / fromHz);
}

/** Cents (hundredths of a semitone) between two frequencies. */
export function centsBetween(fromHz: number, toHz: number): number {
  return semitonesBetween(fromHz, toHz) * 100;
}
