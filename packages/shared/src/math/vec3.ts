/**
 * Plain-object 3D vector maths.
 *
 * Every function here is allocation-conscious: the `*Into` variants write into a
 * caller-owned target so the fixed-step simulation can run without producing
 * garbage each frame. The non-`Into` variants are conveniences for setup code
 * and tests, where a fresh object is cheaper than the ceremony.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const ZERO3: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const UP3: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });

export function copy(target: Vec3, source: Readonly<Vec3>): Vec3 {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  return target;
}

export function set(target: Vec3, x: number, y: number, z: number): Vec3 {
  target.x = x;
  target.y = y;
  target.z = z;
  return target;
}

export function clone(source: Readonly<Vec3>): Vec3 {
  return { x: source.x, y: source.y, z: source.z };
}

export function addInto(target: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  target.x = a.x + b.x;
  target.y = a.y + b.y;
  target.z = a.z + b.z;
  return target;
}

export function subInto(target: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  target.x = a.x - b.x;
  target.y = a.y - b.y;
  target.z = a.z - b.z;
  return target;
}

export function scaleInto(target: Vec3, a: Readonly<Vec3>, s: number): Vec3 {
  target.x = a.x * s;
  target.y = a.y * s;
  target.z = a.z * s;
  return target;
}

export function addScaledInto(
  target: Vec3,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  s: number,
): Vec3 {
  target.x = a.x + b.x * s;
  target.y = a.y + b.y * s;
  target.z = a.z + b.z * s;
  return target;
}

export function lerpInto(
  target: Vec3,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  t: number,
): Vec3 {
  target.x = a.x + (b.x - a.x) * t;
  target.y = a.y + (b.y - a.y) * t;
  target.z = a.z + (b.z - a.z) * t;
  return target;
}

export function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function crossInto(target: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  target.x = x;
  target.y = y;
  target.z = z;
  return target;
}

export function lengthSq(a: Readonly<Vec3>): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Readonly<Vec3>): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Horizontal (XZ-plane) distance — used constantly by ground movement code. */
export function distanceXZ(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function normalizeInto(target: Vec3, a: Readonly<Vec3>): Vec3 {
  const len = length(a);
  if (len < 1e-9) {
    return set(target, 0, 0, 0);
  }
  return scaleInto(target, a, 1 / len);
}

/** Clamps a vector's magnitude, leaving direction untouched. */
export function clampLengthInto(target: Vec3, a: Readonly<Vec3>, max: number): Vec3 {
  const len = length(a);
  if (len <= max || len < 1e-9) {
    return copy(target, a);
  }
  return scaleInto(target, a, max / len);
}

/** Removes the component of `v` that points along `normal` (an unit vector). */
export function projectOnPlaneInto(
  target: Vec3,
  v: Readonly<Vec3>,
  normal: Readonly<Vec3>,
): Vec3 {
  const d = dot(v, normal);
  target.x = v.x - normal.x * d;
  target.y = v.y - normal.y * d;
  target.z = v.z - normal.z * d;
  return target;
}

/** Reflects `v` about `normal` (an unit vector), as a mirror would. */
export function reflectInto(
  target: Vec3,
  v: Readonly<Vec3>,
  normal: Readonly<Vec3>,
): Vec3 {
  const d = 2 * dot(v, normal);
  target.x = v.x - normal.x * d;
  target.y = v.y - normal.y * d;
  target.z = v.z - normal.z * d;
  return target;
}

export function equalsApprox(
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  epsilon = 1e-6,
): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

export function isFinite3(a: Readonly<Vec3>): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}
