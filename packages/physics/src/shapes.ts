import type { Vec3 } from '@tuner/shared';
import type { ColliderShape } from './types.js';

/**
 * Analytic shape maths for the kinematic solver.
 *
 * Everything here is written against a *vertical* query capsule, because the
 * character capsule is always upright and colliders only ever carry a yaw.
 * Rotating about Y leaves a Y-aligned segment Y-aligned, which collapses most
 * of the usual capsule-vs-convex work into scalar arithmetic.
 *
 * Every routine takes and returns primitives, writing normals into a
 * caller-owned `Vec3`, so the fixed-step simulation allocates nothing.
 *
 * Ramp convention: the solid is the collider's box clipped by the plane
 * `y = slope * z` in local space. When `slope === halfExtents.y / halfExtents.z`
 * the wedge runs corner to corner, which is how stages should author them.
 */

const EPS = 1e-9;
/** Squared threshold below which a horizontal offset counts as "on the axis". */
const EPS_SQ = 1e-12;

// ---------------------------------------------------------------------------
// Yaw helpers
// ---------------------------------------------------------------------------

/** World-space delta -> collider-local X. `sin`/`cos` are of the collider yaw. */
export function toLocalX(dx: number, dz: number, sin: number, cos: number): number {
  return cos * dx - sin * dz;
}

/** World-space delta -> collider-local Z. */
export function toLocalZ(dx: number, dz: number, sin: number, cos: number): number {
  return sin * dx + cos * dz;
}

/** Collider-local X/Z -> world X. */
export function toWorldX(lx: number, lz: number, sin: number, cos: number): number {
  return cos * lx + sin * lz;
}

/** Collider-local X/Z -> world Z. */
export function toWorldZ(lx: number, lz: number, sin: number, cos: number): number {
  return -sin * lx + cos * lz;
}

function writeNormal(
  out: Vec3,
  lx: number,
  ly: number,
  lz: number,
  sin: number,
  cos: number,
): void {
  out.x = toWorldX(lx, lz, sin, cos);
  out.y = ly;
  out.z = toWorldZ(lx, lz, sin, cos);
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Half-extents of the world-space AABB of `shape` under a yaw rotation.
 * Ramps report their full box, which is conservative and cheap.
 */
export function shapeHalfExtentsInto(
  out: Vec3,
  shape: ColliderShape,
  sin: number,
  cos: number,
): Vec3 {
  const as = Math.abs(sin);
  const ac = Math.abs(cos);
  switch (shape.kind) {
    case 'box':
    case 'ramp': {
      const h = shape.halfExtents;
      out.x = ac * h.x + as * h.z;
      out.y = h.y;
      out.z = as * h.x + ac * h.z;
      return out;
    }
    case 'sphere': {
      out.x = shape.radius;
      out.y = shape.radius;
      out.z = shape.radius;
      return out;
    }
    case 'capsule': {
      out.x = shape.radius;
      out.y = shape.halfHeight + shape.radius;
      out.z = shape.radius;
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Capsule probe
// ---------------------------------------------------------------------------

/**
 * Separation between an upright capsule and a collider.
 *
 * Returns the signed gap: positive means separated by that many metres,
 * negative means overlapping by that depth. `outNormal` is a unit vector
 * pointing *away* from the collider (the direction that resolves the overlap).
 *
 * The capsule is described by its centre plus `radius` and `halfSegment`
 * (half the distance between the two cap centres, i.e. `height / 2 - radius`).
 *
 * Boxes, spheres and capsules are exact. Ramps use face-plane separation,
 * which is exact whenever the closest feature is a face and a conservative
 * under-estimate near an edge — never an over-estimate, so the solver can rely
 * on it to advance without tunnelling.
 */
export function probeCapsule(
  shape: ColliderShape,
  colliderX: number,
  colliderY: number,
  colliderZ: number,
  sin: number,
  cos: number,
  centreX: number,
  centreY: number,
  centreZ: number,
  radius: number,
  halfSegment: number,
  outNormal: Vec3,
): number {
  const dx = centreX - colliderX;
  const dy = centreY - colliderY;
  const dz = centreZ - colliderZ;
  const lx = toLocalX(dx, dz, sin, cos);
  const lz = toLocalZ(dx, dz, sin, cos);
  const ly = dy;
  const ay = ly - halfSegment;
  const by = ly + halfSegment;

  switch (shape.kind) {
    case 'box': {
      const h = shape.halfExtents;
      const hx = h.x;
      const hy = h.y;
      const hz = h.z;
      const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
      const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
      const ox = lx - qx;
      const oz = lz - qz;

      if (by < -hy || ay > hy) {
        // No vertical overlap: the closest feature is the top or bottom face,
        // one of its edges, or a corner.
        const below = by < -hy;
        const faceY = below ? -hy : hy;
        const segY = below ? by : ay;
        const oy = segY - faceY;
        const d = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (d > EPS) {
          writeNormal(outNormal, ox / d, oy / d, oz / d, sin, cos);
          return d - radius;
        }
        writeNormal(outNormal, 0, below ? -1 : 1, 0, sin, cos);
        return -radius;
      }

      const dh2 = ox * ox + oz * oz;
      if (dh2 > EPS_SQ) {
        // Vertical ranges overlap, so the closest points are purely horizontal.
        const dh = Math.sqrt(dh2);
        writeNormal(outNormal, ox / dh, 0, oz / dh, sin, cos);
        return dh - radius;
      }

      // The capsule axis runs through the box: pick the cheapest way out.
      let best = hx + radius - lx;
      let nx = 1;
      let ny = 0;
      let nz = 0;
      const negX = hx + radius + lx;
      if (negX < best) {
        best = negX;
        nx = -1;
      }
      const posZ = hz + radius - lz;
      if (posZ < best) {
        best = posZ;
        nx = 0;
        nz = 1;
      }
      const negZ = hz + radius + lz;
      if (negZ < best) {
        best = negZ;
        nx = 0;
        nz = -1;
      }
      const posY = hy + radius - ay;
      if (posY < best) {
        best = posY;
        nx = 0;
        nz = 0;
        ny = 1;
      }
      const negY = hy + radius + by;
      if (negY < best) {
        best = negY;
        nx = 0;
        nz = 0;
        ny = -1;
      }
      writeNormal(outNormal, nx, ny, nz, sin, cos);
      return -best;
    }

    case 'sphere': {
      // Closest point on the capsule segment to the sphere centre (the origin).
      const sy = ay > 0 ? ay : by < 0 ? by : 0;
      const d = Math.sqrt(lx * lx + sy * sy + lz * lz);
      if (d > EPS) {
        writeNormal(outNormal, lx / d, sy / d, lz / d, sin, cos);
        return d - shape.radius - radius;
      }
      writeNormal(outNormal, 0, 1, 0, sin, cos);
      return -(shape.radius + radius);
    }

    case 'capsule': {
      const hh = shape.halfHeight;
      const dh2 = lx * lx + lz * lz;
      const gap = by < -hh ? by + hh : ay > hh ? ay - hh : 0;
      const d = Math.sqrt(dh2 + gap * gap);
      if (d > EPS) {
        writeNormal(outNormal, lx / d, gap / d, lz / d, sin, cos);
        return d - shape.radius - radius;
      }
      // Concentric: escape horizontally or vertically, whichever is shorter.
      const reach = shape.radius + radius;
      let best = reach;
      let nx = 1;
      let ny = 0;
      const up = hh + reach - ay;
      if (up < best) {
        best = up;
        nx = 0;
        ny = 1;
      }
      const down = hh + reach + by;
      if (down < best) {
        best = down;
        nx = 0;
        ny = -1;
      }
      writeNormal(outNormal, nx, ny, 0, sin, cos);
      return -best;
    }

    case 'ramp': {
      const h = shape.halfExtents;
      const s = shape.slope;
      const inv = 1 / Math.sqrt(1 + s * s);
      // Face-plane separation (SAT over faces). The support point of an upright
      // capsule against plane n is whichever cap centre minimises dot(n, p).
      let best = -Number.MAX_VALUE;
      let nx = 0;
      let ny = 0;
      let nz = 0;

      // +X / -X
      let sep = lx - h.x - radius;
      if (sep > best) {
        best = sep;
        nx = 1;
        ny = 0;
        nz = 0;
      }
      sep = -lx - h.x - radius;
      if (sep > best) {
        best = sep;
        nx = -1;
        ny = 0;
        nz = 0;
      }
      // +Z / -Z
      sep = lz - h.z - radius;
      if (sep > best) {
        best = sep;
        nx = 0;
        ny = 0;
        nz = 1;
      }
      sep = -lz - h.z - radius;
      if (sep > best) {
        best = sep;
        nx = 0;
        ny = 0;
        nz = -1;
      }
      // +Y / -Y
      sep = ay - h.y - radius;
      if (sep > best) {
        best = sep;
        nx = 0;
        ny = 1;
        nz = 0;
      }
      sep = -by - h.y - radius;
      if (sep > best) {
        best = sep;
        nx = 0;
        ny = -1;
        nz = 0;
      }
      // The tilted top face: n = normalize(0, 1, -slope), through the origin.
      sep = (ay - s * lz) * inv - radius;
      if (sep > best) {
        best = sep;
        nx = 0;
        ny = inv;
        nz = -s * inv;
      }

      writeNormal(outNormal, nx, ny, nz, sin, cos);
      return best;
    }
  }
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------

let clipEnter = 0;
let clipExit = 0;
let clipNx = 0;
let clipNy = 0;
let clipNz = 0;
let clipHit = false;
let clipValid = false;

function clipBegin(maxDistance: number): void {
  clipEnter = 0;
  clipExit = maxDistance;
  clipNx = 0;
  clipNy = 0;
  clipNz = 0;
  clipHit = false;
  clipValid = true;
}

function clipPlane(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  if (!clipValid) return;
  const denom = nx * dx + ny * dy + nz * dz;
  const dist = nx * ox + ny * oy + nz * oz - d;
  if (denom > -EPS && denom < EPS) {
    if (dist > 0) clipValid = false;
    return;
  }
  const t = -dist / denom;
  if (denom < 0) {
    if (t > clipEnter) {
      clipEnter = t;
      clipNx = nx;
      clipNy = ny;
      clipNz = nz;
      clipHit = true;
    }
  } else if (t < clipExit) {
    clipExit = t;
  }
  if (clipEnter > clipExit) clipValid = false;
}

function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  radius: number,
  maxDistance: number,
): number {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c < 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDistance) return -1;
  return t;
}

/**
 * Ray against a single collider, in world space.
 *
 * Returns the distance along `direction` (which must be unit length) or `-1`
 * when the ray misses. A ray starting inside the shape reports distance 0 with
 * the normal facing back along the ray.
 */
export function raycastShape(
  shape: ColliderShape,
  colliderX: number,
  colliderY: number,
  colliderZ: number,
  sin: number,
  cos: number,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number,
  outNormal: Vec3,
): number {
  const rx = originX - colliderX;
  const rz = originZ - colliderZ;
  const ox = toLocalX(rx, rz, sin, cos);
  const oy = originY - colliderY;
  const oz = toLocalZ(rx, rz, sin, cos);
  const dx = toLocalX(dirX, dirZ, sin, cos);
  const dy = dirY;
  const dz = toLocalZ(dirX, dirZ, sin, cos);

  switch (shape.kind) {
    case 'box':
    case 'ramp': {
      const h = shape.halfExtents;
      clipBegin(maxDistance);
      clipPlane(1, 0, 0, h.x, ox, oy, oz, dx, dy, dz);
      clipPlane(-1, 0, 0, h.x, ox, oy, oz, dx, dy, dz);
      clipPlane(0, 1, 0, h.y, ox, oy, oz, dx, dy, dz);
      clipPlane(0, -1, 0, h.y, ox, oy, oz, dx, dy, dz);
      clipPlane(0, 0, 1, h.z, ox, oy, oz, dx, dy, dz);
      clipPlane(0, 0, -1, h.z, ox, oy, oz, dx, dy, dz);
      if (shape.kind === 'ramp') {
        const s = shape.slope;
        const inv = 1 / Math.sqrt(1 + s * s);
        clipPlane(0, inv, -s * inv, 0, ox, oy, oz, dx, dy, dz);
      }
      if (!clipValid || clipEnter > maxDistance) return -1;
      if (!clipHit) {
        outNormal.x = -dirX;
        outNormal.y = -dirY;
        outNormal.z = -dirZ;
        return 0;
      }
      writeNormal(outNormal, clipNx, clipNy, clipNz, sin, cos);
      return clipEnter;
    }

    case 'sphere': {
      const t = raySphere(ox, oy, oz, dx, dy, dz, shape.radius, maxDistance);
      if (t < 0) return -1;
      if (t === 0) {
        outNormal.x = -dirX;
        outNormal.y = -dirY;
        outNormal.z = -dirZ;
        return 0;
      }
      const hx = ox + dx * t;
      const hy = oy + dy * t;
      const hz = oz + dz * t;
      const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      writeNormal(outNormal, hx / len, hy / len, hz / len, sin, cos);
      return t;
    }

    case 'capsule': {
      const r = shape.radius;
      const hh = shape.halfHeight;
      // Inside test first: distance from the origin to the axis segment.
      const clampedY = oy > hh ? hh : oy < -hh ? -hh : oy;
      const iy = oy - clampedY;
      if (ox * ox + iy * iy + oz * oz < r * r) {
        outNormal.x = -dirX;
        outNormal.y = -dirY;
        outNormal.z = -dirZ;
        return 0;
      }
      let bestT = -1;
      let bnx = 0;
      let bny = 0;
      let bnz = 0;
      const a = dx * dx + dz * dz;
      if (a > EPS) {
        const b = ox * dx + oz * dz;
        const c = ox * ox + oz * oz - r * r;
        const disc = b * b - a * c;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / a;
          if (t >= 0 && t <= maxDistance) {
            const y = oy + dy * t;
            if (y >= -hh && y <= hh) {
              bestT = t;
              bnx = (ox + dx * t) / r;
              bny = 0;
              bnz = (oz + dz * t) / r;
            }
          }
        }
      }
      for (let i = 0; i < 2; i++) {
        const capY = i === 0 ? hh : -hh;
        const t = raySphere(ox, oy - capY, oz, dx, dy, dz, r, maxDistance);
        if (t < 0) continue;
        if (bestT >= 0 && t >= bestT) continue;
        bestT = t;
        bnx = (ox + dx * t) / r;
        bny = (oy - capY + dy * t) / r;
        bnz = (oz + dz * t) / r;
      }
      if (bestT < 0) return -1;
      writeNormal(outNormal, bnx, bny, bnz, sin, cos);
      return bestT;
    }
  }
}
