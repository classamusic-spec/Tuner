import { clamp, vec3, type Vec3 } from '@tuner/shared';
import type {
  CharacterMoveParams,
  ColliderDescriptor,
  ColliderHandle,
  ColliderShape,
  LayerMask,
  MoveResult,
  PhysicsWorld,
  RaycastHit,
  SweepHit,
} from './types.js';
import { probeCapsule, raycastShape, shapeHalfExtentsInto } from './shapes.js';

/**
 * The shipped `PhysicsWorld`: a deterministic kinematic solver.
 *
 * Character motion is resolved by conservative advancement (march forward by
 * the exact separation, never past it) followed by plane projection, which
 * gives predictable collide-and-slide with no impulse solver, no sleeping
 * bodies and no frame-order dependence. Broadphase is a uniform spatial hash;
 * candidate lists are sorted by collider id so a replayed input sequence
 * produces bit-identical output.
 */

/** Gap the solver leaves between the capsule and geometry, in metres. */
const SKIN = 1e-4;
/** How far below the feet a walkable surface still counts as ground. */
const GROUND_PROBE = 0.03;
/** Slide passes per move. Four is enough for a corner plus a floor. */
const MAX_SLIDE_ITERATIONS = 4;
/** Conservative-advancement steps per sweep. */
const MAX_ADVANCE_ITERATIONS = 32;
/** Normals below this Y count as a ceiling rather than a wall. */
const CEILING_DOT = -0.25;
/** Uniform spatial hash cell size, in metres. */
const CELL_SIZE = 4;
/** Cell indices are clamped to this range so keys pack into one integer. */
const CELL_LIMIT = 511;
/** Colliders spanning more cells than this are tested by every query instead. */
const MAX_CELLS_PER_COLLIDER = 512;

function cellIndex(v: number): number {
  const i = Math.floor(v / CELL_SIZE);
  return i < -CELL_LIMIT ? -CELL_LIMIT : i > CELL_LIMIT ? CELL_LIMIT : i;
}

function cellKey(ix: number, iy: number, iz: number): number {
  return ((ix + CELL_LIMIT) * 1024 + (iy + CELL_LIMIT)) * 1024 + (iz + CELL_LIMIT);
}

class Collider implements ColliderHandle {
  readonly id: number;
  readonly shape: ColliderShape;
  readonly position: Vec3;
  yaw: number;
  sin: number;
  cos: number;
  readonly layer: LayerMask;
  readonly isTrigger: boolean;
  descriptorRef: ColliderDescriptor;

  minX = 0;
  minY = 0;
  minZ = 0;
  maxX = 0;
  maxY = 0;
  maxZ = 0;

  readonly cells: number[] = [];
  oversized = false;
  stamp = -1;
  alive = true;

  constructor(id: number, descriptor: ColliderDescriptor) {
    this.id = id;
    this.shape = descriptor.shape;
    this.position = vec3(descriptor.position.x, descriptor.position.y, descriptor.position.z);
    this.yaw = descriptor.yaw ?? 0;
    this.sin = Math.sin(this.yaw);
    this.cos = Math.cos(this.yaw);
    this.layer = descriptor.layer;
    this.isTrigger = descriptor.isTrigger === true;
    this.descriptorRef = { ...descriptor, position: this.position, yaw: this.yaw };
  }

  /** Always reflects the collider's current transform. */
  get descriptor(): ColliderDescriptor {
    return this.descriptorRef;
  }
}

const byId = (a: Collider, b: Collider): number => a.id - b.id;

const SCRATCH_EXTENTS = vec3();
const SCRATCH_NORMAL = vec3();
const SCRATCH_RAY_NORMAL = vec3();

class KinematicWorld implements PhysicsWorld {
  private readonly list: Collider[] = [];
  private readonly byHandleId = new Map<number, Collider>();
  private readonly cells = new Map<number, Collider[]>();
  private readonly oversized: Collider[] = [];
  private readonly candidates: Collider[] = [];
  private readonly queryScratch: Collider[] = [];
  private nextId = 1;
  private stamp = 0;
  private queryCount = 0;

  // Sweep results, kept as fields so sweeps allocate nothing.
  private hitDistance = 0;
  private hitCollider: Collider | null = null;
  private readonly hitNormal = vec3(0, 1, 0);

  // Slide state.
  private pX = 0;
  private pY = 0;
  private pZ = 0;
  private mX = 0;
  private mY = 0;
  private mZ = 0;
  private vX = 0;
  private vY = 0;
  private vZ = 0;
  private grounded = false;
  private readonly groundNormal = vec3(0, 1, 0);
  private groundCollider: Collider | null = null;
  private touchingWall = false;
  private readonly wallNormal = vec3();
  private wallCollider: Collider | null = null;
  private touchingCeiling = false;

  readonly stats: { readonly colliderCount: number; readonly lastQueryCount: number };

  constructor() {
    const self = this;
    this.stats = {
      get colliderCount(): number {
        return self.list.length;
      },
      get lastQueryCount(): number {
        return self.queryCount;
      },
    };
  }

  get colliders(): readonly ColliderHandle[] {
    return this.list;
  }

  // -------------------------------------------------------------------------
  // Authoring
  // -------------------------------------------------------------------------

  addCollider(descriptor: ColliderDescriptor): ColliderHandle {
    const collider = new Collider(this.nextId++, descriptor);
    this.list.push(collider);
    this.byHandleId.set(collider.id, collider);
    this.refreshBounds(collider);
    this.insert(collider);
    return collider;
  }

  removeCollider(handle: ColliderHandle): void {
    const collider = this.byHandleId.get(handle.id);
    if (collider === undefined || collider !== handle) return;
    this.remove(collider);
    collider.alive = false;
    this.byHandleId.delete(collider.id);
    const index = this.list.indexOf(collider);
    if (index >= 0) this.list.splice(index, 1);
  }

  setColliderTransform(handle: ColliderHandle, position: Vec3, yaw?: number): void {
    const collider = this.byHandleId.get(handle.id);
    if (collider === undefined || collider !== handle) return;
    collider.position.x = position.x;
    collider.position.y = position.y;
    collider.position.z = position.z;
    if (yaw !== undefined && yaw !== collider.yaw) {
      collider.yaw = yaw;
      collider.sin = Math.sin(yaw);
      collider.cos = Math.cos(yaw);
      // The descriptor's position vector is shared and mutated in place; only a
      // yaw change needs a fresh object, so steady motion allocates nothing.
      collider.descriptorRef = { ...collider.descriptorRef, yaw };
    }
    this.remove(collider);
    this.refreshBounds(collider);
    this.insert(collider);
  }

  clear(): void {
    this.list.length = 0;
    this.byHandleId.clear();
    this.cells.clear();
    this.oversized.length = 0;
    this.candidates.length = 0;
    this.queryScratch.length = 0;
    this.queryCount = 0;
  }

  // -------------------------------------------------------------------------
  // Broadphase
  // -------------------------------------------------------------------------

  private refreshBounds(c: Collider): void {
    shapeHalfExtentsInto(SCRATCH_EXTENTS, c.shape, c.sin, c.cos);
    c.minX = c.position.x - SCRATCH_EXTENTS.x;
    c.maxX = c.position.x + SCRATCH_EXTENTS.x;
    c.minY = c.position.y - SCRATCH_EXTENTS.y;
    c.maxY = c.position.y + SCRATCH_EXTENTS.y;
    c.minZ = c.position.z - SCRATCH_EXTENTS.z;
    c.maxZ = c.position.z + SCRATCH_EXTENTS.z;
  }

  private insert(c: Collider): void {
    const ix0 = cellIndex(c.minX);
    const ix1 = cellIndex(c.maxX);
    const iy0 = cellIndex(c.minY);
    const iy1 = cellIndex(c.maxY);
    const iz0 = cellIndex(c.minZ);
    const iz1 = cellIndex(c.maxZ);
    const span = (ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1);
    if (span > MAX_CELLS_PER_COLLIDER) {
      c.oversized = true;
      this.oversized.push(c);
      return;
    }
    c.oversized = false;
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const key = cellKey(ix, iy, iz);
          const bucket = this.cells.get(key);
          if (bucket === undefined) {
            this.cells.set(key, [c]);
          } else {
            bucket.push(c);
          }
          c.cells.push(key);
        }
      }
    }
  }

  private remove(c: Collider): void {
    if (c.oversized) {
      const i = this.oversized.indexOf(c);
      if (i >= 0) this.oversized.splice(i, 1);
      c.oversized = false;
      return;
    }
    for (const key of c.cells) {
      const bucket = this.cells.get(key);
      if (bucket === undefined) continue;
      const i = bucket.indexOf(c);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(key);
    }
    c.cells.length = 0;
  }

  private gather(
    out: Collider[],
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): void {
    out.length = 0;
    const s = ++this.stamp;
    const ix0 = cellIndex(minX);
    const ix1 = cellIndex(maxX);
    const iy0 = cellIndex(minY);
    const iy1 = cellIndex(maxY);
    const iz0 = cellIndex(minZ);
    const iz1 = cellIndex(maxZ);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const bucket = this.cells.get(cellKey(ix, iy, iz));
          if (bucket === undefined) continue;
          for (const c of bucket) {
            if (c.stamp === s) continue;
            c.stamp = s;
            if (c.maxX < minX || c.minX > maxX) continue;
            if (c.maxY < minY || c.minY > maxY) continue;
            if (c.maxZ < minZ || c.minZ > maxZ) continue;
            out.push(c);
          }
        }
      }
    }
    for (const c of this.oversized) {
      if (c.stamp === s) continue;
      c.stamp = s;
      if (c.maxX < minX || c.minX > maxX) continue;
      if (c.maxY < minY || c.minY > maxY) continue;
      if (c.maxZ < minZ || c.minZ > maxZ) continue;
      out.push(c);
    }
    out.sort(byId);
  }

  // -------------------------------------------------------------------------
  // Narrowphase helpers
  // -------------------------------------------------------------------------

  private probe(
    c: Collider,
    x: number,
    y: number,
    z: number,
    radius: number,
    halfSegment: number,
    out: Vec3,
  ): number {
    this.queryCount++;
    return probeCapsule(
      c.shape,
      c.position.x,
      c.position.y,
      c.position.z,
      c.sin,
      c.cos,
      x,
      y,
      z,
      radius,
      halfSegment,
      out,
    );
  }

  /**
   * Conservative advancement of an upright capsule through `this.candidates`.
   * Returns true when something blocks the sweep, leaving the contact in
   * `hitDistance` / `hitNormal` / `hitCollider`.
   */
  private sweepCapsule(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDistance: number,
    radius: number,
    halfSegment: number,
    mask: LayerMask,
  ): boolean {
    this.hitCollider = null;
    this.hitDistance = maxDistance;
    if (maxDistance <= 0) return false;

    let travelled = 0;
    let nearest: Collider | null = null;
    for (let iter = 0; iter < MAX_ADVANCE_ITERATIONS; iter++) {
      const px = ox + dx * travelled;
      const py = oy + dy * travelled;
      const pz = oz + dz * travelled;
      let minSep = Number.POSITIVE_INFINITY;
      nearest = null;
      for (const c of this.candidates) {
        if (c.isTrigger) continue;
        if ((c.layer & mask) === 0) continue;
        const sep = this.probe(c, px, py, pz, radius, halfSegment, SCRATCH_NORMAL);
        if (sep <= SKIN) {
          // Already touching. Only a surface we are moving *into* can block;
          // for a convex shape a tangential or receding contact can never
          // become an overlap later in this sweep.
          const approach = SCRATCH_NORMAL.x * dx + SCRATCH_NORMAL.y * dy + SCRATCH_NORMAL.z * dz;
          if (approach > -1e-6) continue;
          this.hitCollider = c;
          this.hitDistance = travelled;
          this.hitNormal.x = SCRATCH_NORMAL.x;
          this.hitNormal.y = SCRATCH_NORMAL.y;
          this.hitNormal.z = SCRATCH_NORMAL.z;
          return true;
        }
        if (sep < minSep) {
          minSep = sep;
          nearest = c;
        }
      }
      if (nearest === null) return false;
      travelled += minSep;
      if (travelled >= maxDistance) return false;
    }

    // Grazing contact that refused to converge. Stop short rather than risk
    // pushing through; the next slide pass picks the motion back up.
    if (nearest === null) return false;
    this.probe(
      nearest,
      ox + dx * travelled,
      oy + dy * travelled,
      oz + dz * travelled,
      radius,
      halfSegment,
      SCRATCH_NORMAL,
    );
    this.hitCollider = nearest;
    this.hitDistance = travelled;
    this.hitNormal.x = SCRATCH_NORMAL.x;
    this.hitNormal.y = SCRATCH_NORMAL.y;
    this.hitNormal.z = SCRATCH_NORMAL.z;
    return true;
  }

  /** Sweeps one collider only; used for non-blocking trigger overlap tests. */
  private sweepTrigger(
    c: Collider,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDistance: number,
    radius: number,
    halfSegment: number,
  ): boolean {
    let travelled = 0;
    for (let iter = 0; iter < MAX_ADVANCE_ITERATIONS; iter++) {
      const sep = this.probe(
        c,
        ox + dx * travelled,
        oy + dy * travelled,
        oz + dz * travelled,
        radius,
        halfSegment,
        SCRATCH_NORMAL,
      );
      if (sep <= SKIN) return true;
      travelled += sep;
      if (travelled > maxDistance) return false;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Character movement
  // -------------------------------------------------------------------------

  moveCharacter(params: CharacterMoveParams): MoveResult {
    this.queryCount = 0;

    const radius = Math.max(1e-3, params.radius);
    const halfSegment = Math.max(0, params.height * 0.5 - radius);
    const dt = Math.max(0, params.deltaSeconds);
    const mask = params.mask;
    const stepHeight = Math.max(0, params.stepHeight);
    const cosMax = Math.cos(clamp(params.maxSlopeRadians, 0, Math.PI * 0.5));
    const tanMax = Math.tan(clamp(params.maxSlopeRadians, 0, 1.4));

    this.pX = params.position.x;
    this.pY = params.position.y;
    this.pZ = params.position.z;
    this.vX = params.velocity.x;
    this.vY = params.velocity.y;
    this.vZ = params.velocity.z;
    this.mX = this.vX * dt;
    this.mY = this.vY * dt;
    this.mZ = this.vZ * dt;

    this.grounded = false;
    this.groundCollider = null;
    this.groundNormal.x = 0;
    this.groundNormal.y = 1;
    this.groundNormal.z = 0;
    this.touchingWall = false;
    this.wallCollider = null;
    this.wallNormal.x = 0;
    this.wallNormal.y = 0;
    this.wallNormal.z = 0;
    this.touchingCeiling = false;

    const horizontal = Math.sqrt(this.mX * this.mX + this.mZ * this.mZ);
    const snapDistance = params.snapToGround
      ? Math.min(1, Math.max(stepHeight, horizontal * tanMax + 0.05))
      : GROUND_PROBE;

    const pad = radius + stepHeight + snapDistance + 0.1;
    const endX = this.pX + this.mX;
    const endY = this.pY + this.mY;
    const endZ = this.pZ + this.mZ;
    const halfBody = halfSegment + radius;
    this.gather(
      this.candidates,
      Math.min(this.pX, endX) - pad,
      Math.min(this.pY, endY) - halfBody - pad,
      Math.min(this.pZ, endZ) - pad,
      Math.max(this.pX, endX) + pad,
      Math.max(this.pY, endY) + halfBody + pad,
      Math.max(this.pZ, endZ) + pad,
    );

    // 1. Never start a move inside geometry.
    for (let iter = 0; iter < 4; iter++) {
      let corrected = false;
      for (const c of this.candidates) {
        if (c.isTrigger) continue;
        if ((c.layer & mask) === 0) continue;
        const sep = this.probe(c, this.pX, this.pY, this.pZ, radius, halfSegment, SCRATCH_NORMAL);
        if (sep >= 0) continue;
        const push = -sep + 1e-6;
        this.pX += SCRATCH_NORMAL.x * push;
        this.pY += SCRATCH_NORMAL.y * push;
        this.pZ += SCRATCH_NORMAL.z * push;
        corrected = true;
      }
      if (!corrected) break;
    }

    const startX = this.pX;
    const startY = this.pY;
    const startZ = this.pZ;
    const startMx = this.mX;
    const startMz = this.mZ;
    const jumping = params.velocity.y > 1e-4;

    // 2. Was the body standing on something before the move? Step-up and
    //    ground snapping are only for characters that were already walking.
    const wasGrounded = this.probeGround(
      startX,
      startY,
      startZ,
      radius,
      halfSegment,
      mask,
      cosMax,
      GROUND_PROBE,
    );

    // 3. Collide and slide.
    this.runSlide(radius, halfSegment, mask, cosMax, true);
    const plainX = this.pX;
    const plainY = this.pY;
    const plainZ = this.pZ;
    const plainVx = this.vX;
    const plainVy = this.vY;
    const plainVz = this.vZ;
    const plainProgress =
      (plainX - startX) * (plainX - startX) + (plainZ - startZ) * (plainZ - startZ);

    // 4. Step up over lips when a wall stopped a grounded, moving body.
    if (
      this.touchingWall &&
      (wasGrounded || this.grounded) &&
      stepHeight > 0 &&
      (startMx !== 0 || startMz !== 0)
    ) {
      this.attemptStep(
        startX,
        startY,
        startZ,
        startMx,
        startMz,
        radius,
        halfSegment,
        mask,
        cosMax,
        stepHeight,
        plainProgress,
        plainX,
        plainY,
        plainZ,
        plainVx,
        plainVy,
        plainVz,
      );
    }

    // 5. Stay glued to the ground: descending slopes and shallow steps down.
    if (!this.grounded && !jumping) {
      const probeDistance = wasGrounded && params.snapToGround ? snapDistance : GROUND_PROBE;
      if (
        this.sweepCapsule(
          this.pX,
          this.pY,
          this.pZ,
          0,
          -1,
          0,
          probeDistance,
          radius,
          halfSegment,
          mask,
        ) &&
        this.hitNormal.y >= cosMax
      ) {
        this.pY -= this.hitDistance;
        this.grounded = true;
        this.groundCollider = this.hitCollider;
        this.groundNormal.x = this.hitNormal.x;
        this.groundNormal.y = this.hitNormal.y;
        this.groundNormal.z = this.hitNormal.z;
      }
    }

    // 6. Landing kills the velocity component pushing into the floor.
    if (this.grounded) {
      const into =
        this.vX * this.groundNormal.x + this.vY * this.groundNormal.y + this.vZ * this.groundNormal.z;
      if (into < 0) {
        this.vX -= this.groundNormal.x * into;
        this.vY -= this.groundNormal.y * into;
        this.vZ -= this.groundNormal.z * into;
      }
    }

    // 7. Triggers never block, but everything the swept capsule touched is
    //    reported so the stage runtime can fire checkpoints and pickups.
    const triggers: ColliderHandle[] = [];
    const sweepX = this.pX - startX;
    const sweepY = this.pY - startY;
    const sweepZ = this.pZ - startZ;
    const sweepLen = Math.sqrt(sweepX * sweepX + sweepY * sweepY + sweepZ * sweepZ);
    for (const c of this.candidates) {
      if (!c.isTrigger) continue;
      let overlapped: boolean;
      if (sweepLen > 1e-9) {
        overlapped = this.sweepTrigger(
          c,
          startX,
          startY,
          startZ,
          sweepX / sweepLen,
          sweepY / sweepLen,
          sweepZ / sweepLen,
          sweepLen,
          radius,
          halfSegment,
        );
      } else {
        overlapped =
          this.probe(c, startX, startY, startZ, radius, halfSegment, SCRATCH_NORMAL) <= SKIN;
      }
      if (overlapped) triggers.push(c);
    }

    return {
      position: vec3(this.pX, this.pY, this.pZ),
      velocity: vec3(this.vX, this.vY, this.vZ),
      grounded: this.grounded,
      groundNormal: vec3(this.groundNormal.x, this.groundNormal.y, this.groundNormal.z),
      groundCollider: this.groundCollider,
      touchingWall: this.touchingWall,
      wallNormal: vec3(this.wallNormal.x, this.wallNormal.y, this.wallNormal.z),
      wallCollider: this.wallCollider,
      touchingCeiling: this.touchingCeiling,
      triggers,
    };
  }

  /** Runs the slide loop over `this.mX/mY/mZ`, updating position and velocity. */
  private runSlide(
    radius: number,
    halfSegment: number,
    mask: LayerMask,
    cosMax: number,
    record: boolean,
  ): void {
    for (let iter = 0; iter < MAX_SLIDE_ITERATIONS; iter++) {
      const len = Math.sqrt(this.mX * this.mX + this.mY * this.mY + this.mZ * this.mZ);
      if (len < 1e-7) break;
      const dx = this.mX / len;
      const dy = this.mY / len;
      const dz = this.mZ / len;
      const blocked = this.sweepCapsule(
        this.pX,
        this.pY,
        this.pZ,
        dx,
        dy,
        dz,
        len,
        radius,
        halfSegment,
        mask,
      );
      if (!blocked) {
        this.pX += this.mX;
        this.pY += this.mY;
        this.pZ += this.mZ;
        this.mX = 0;
        this.mY = 0;
        this.mZ = 0;
        break;
      }
      const travel = this.hitDistance > 0 ? this.hitDistance : 0;
      this.pX += dx * travel;
      this.pY += dy * travel;
      this.pZ += dz * travel;

      const nx = this.hitNormal.x;
      const ny = this.hitNormal.y;
      const nz = this.hitNormal.z;
      const walkable = ny >= cosMax;
      if (record) {
        if (walkable) {
          this.grounded = true;
          this.groundCollider = this.hitCollider;
          this.groundNormal.x = nx;
          this.groundNormal.y = ny;
          this.groundNormal.z = nz;
        } else if (ny <= CEILING_DOT) {
          this.touchingCeiling = true;
        } else {
          this.touchingWall = true;
          this.wallCollider = this.hitCollider;
          this.wallNormal.x = nx;
          this.wallNormal.y = ny;
          this.wallNormal.z = nz;
        }
      }

      const remaining = len - travel;
      this.mX = dx * remaining;
      this.mY = dy * remaining;
      this.mZ = dz * remaining;
      this.project(nx, ny, nz, walkable);
    }
  }

  /**
   * Removes the into-surface component of the remaining motion and of the
   * velocity, keeping every bit of the tangential part so running along a wall
   * loses no speed. Steep surfaces are never allowed to convert a downward
   * push into an upward one — that is what stops bodies riding up cliffs.
   */
  private project(nx: number, ny: number, nz: number, walkable: boolean): void {
    const md = this.mX * nx + this.mY * ny + this.mZ * nz;
    if (md < 0) {
      const before = this.mY;
      this.mX -= nx * md;
      this.mY -= ny * md;
      this.mZ -= nz * md;
      if (!walkable && before <= 0 && this.mY > 0) this.mY = 0;
    }
    const vd = this.vX * nx + this.vY * ny + this.vZ * nz;
    if (vd < 0) {
      const before = this.vY;
      this.vX -= nx * vd;
      this.vY -= ny * vd;
      this.vZ -= nz * vd;
      if (!walkable && before <= 0 && this.vY > 0) this.vY = 0;
    }
  }

  private probeGround(
    x: number,
    y: number,
    z: number,
    radius: number,
    halfSegment: number,
    mask: LayerMask,
    cosMax: number,
    distance: number,
  ): boolean {
    if (!this.sweepCapsule(x, y, z, 0, -1, 0, distance, radius, halfSegment, mask)) return false;
    return this.hitNormal.y >= cosMax;
  }

  /**
   * Up / forward / down probe. Accepted only when it gains ground the plain
   * slide could not reach *and* lands on a walkable surface, which is what
   * keeps steep ramps from being climbed one step at a time.
   */
  private attemptStep(
    startX: number,
    startY: number,
    startZ: number,
    motionX: number,
    motionZ: number,
    radius: number,
    halfSegment: number,
    mask: LayerMask,
    cosMax: number,
    stepHeight: number,
    plainProgress: number,
    plainX: number,
    plainY: number,
    plainZ: number,
    plainVx: number,
    plainVy: number,
    plainVz: number,
  ): void {
    const rise = this.sweepCapsule(
      startX,
      startY,
      startZ,
      0,
      1,
      0,
      stepHeight,
      radius,
      halfSegment,
      mask,
    )
      ? Math.max(0, this.hitDistance - SKIN)
      : stepHeight;
    if (rise < 0.01) return;

    this.pX = startX;
    this.pY = startY + rise;
    this.pZ = startZ;
    this.mX = motionX;
    this.mY = 0;
    this.mZ = motionZ;
    this.vX = plainVx;
    this.vY = plainVy;
    this.vZ = plainVz;
    this.runSlide(radius, halfSegment, mask, cosMax, false);

    const gained = (this.pX - startX) * (this.pX - startX) + (this.pZ - startZ) * (this.pZ - startZ);
    if (gained <= plainProgress + 1e-6) {
      this.restorePlain(plainX, plainY, plainZ, plainVx, plainVy, plainVz);
      return;
    }

    const drop = rise + SKIN * 2;
    if (
      !this.sweepCapsule(this.pX, this.pY, this.pZ, 0, -1, 0, drop, radius, halfSegment, mask) ||
      this.hitNormal.y < cosMax
    ) {
      this.restorePlain(plainX, plainY, plainZ, plainVx, plainVy, plainVz);
      return;
    }

    this.pY -= this.hitDistance;
    if (this.pY < startY - 1e-4) {
      this.restorePlain(plainX, plainY, plainZ, plainVx, plainVy, plainVz);
      return;
    }
    this.grounded = true;
    this.groundCollider = this.hitCollider;
    this.groundNormal.x = this.hitNormal.x;
    this.groundNormal.y = this.hitNormal.y;
    this.groundNormal.z = this.hitNormal.z;
    this.touchingWall = false;
    this.wallCollider = null;
    this.wallNormal.x = 0;
    this.wallNormal.y = 0;
    this.wallNormal.z = 0;
  }

  private restorePlain(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    this.pX = x;
    this.pY = y;
    this.pZ = z;
    this.vX = vx;
    this.vY = vy;
    this.vZ = vz;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    mask: LayerMask,
    ignore?: ColliderHandle | null,
  ): RaycastHit | null {
    const len = Math.sqrt(
      direction.x * direction.x + direction.y * direction.y + direction.z * direction.z,
    );
    if (len < 1e-9 || maxDistance <= 0) return null;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;
    const ex = origin.x + dx * maxDistance;
    const ey = origin.y + dy * maxDistance;
    const ez = origin.z + dz * maxDistance;
    this.gather(
      this.queryScratch,
      Math.min(origin.x, ex),
      Math.min(origin.y, ey),
      Math.min(origin.z, ez),
      Math.max(origin.x, ex),
      Math.max(origin.y, ey),
      Math.max(origin.z, ez),
    );

    let best = -1;
    let bestCollider: Collider | null = null;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    for (const c of this.queryScratch) {
      if ((c.layer & mask) === 0) continue;
      if (ignore != null && c.id === ignore.id) continue;
      this.queryCount++;
      const d = raycastShape(
        c.shape,
        c.position.x,
        c.position.y,
        c.position.z,
        c.sin,
        c.cos,
        origin.x,
        origin.y,
        origin.z,
        dx,
        dy,
        dz,
        maxDistance,
        SCRATCH_RAY_NORMAL,
      );
      if (d < 0) continue;
      if (bestCollider !== null && d >= best) continue;
      best = d;
      bestCollider = c;
      bnx = SCRATCH_RAY_NORMAL.x;
      bny = SCRATCH_RAY_NORMAL.y;
      bnz = SCRATCH_RAY_NORMAL.z;
    }
    if (bestCollider === null) return null;
    return {
      collider: bestCollider,
      point: vec3(origin.x + dx * best, origin.y + dy * best, origin.z + dz * best),
      normal: vec3(bnx, bny, bnz),
      distance: best,
    };
  }

  sweepSphere(
    origin: Vec3,
    direction: Vec3,
    radius: number,
    maxDistance: number,
    mask: LayerMask,
    ignore?: ColliderHandle | null,
  ): SweepHit | null {
    const len = Math.sqrt(
      direction.x * direction.x + direction.y * direction.y + direction.z * direction.z,
    );
    if (len < 1e-9 || maxDistance <= 0) return null;
    const dx = direction.x / len;
    const dy = direction.y / len;
    const dz = direction.z / len;
    const ex = origin.x + dx * maxDistance;
    const ey = origin.y + dy * maxDistance;
    const ez = origin.z + dz * maxDistance;
    this.gather(
      this.queryScratch,
      Math.min(origin.x, ex) - radius,
      Math.min(origin.y, ey) - radius,
      Math.min(origin.z, ez) - radius,
      Math.max(origin.x, ex) + radius,
      Math.max(origin.y, ey) + radius,
      Math.max(origin.z, ez) + radius,
    );

    let travelled = 0;
    for (let iter = 0; iter < MAX_ADVANCE_ITERATIONS; iter++) {
      const px = origin.x + dx * travelled;
      const py = origin.y + dy * travelled;
      const pz = origin.z + dz * travelled;
      let minSep = Number.POSITIVE_INFINITY;
      let nearest: Collider | null = null;
      let nnx = 0;
      let nny = 0;
      let nnz = 0;
      for (const c of this.queryScratch) {
        if ((c.layer & mask) === 0) continue;
        if (ignore != null && c.id === ignore.id) continue;
        const sep = this.probe(c, px, py, pz, radius, 0, SCRATCH_NORMAL);
        if (sep < minSep) {
          minSep = sep;
          nearest = c;
          nnx = SCRATCH_NORMAL.x;
          nny = SCRATCH_NORMAL.y;
          nnz = SCRATCH_NORMAL.z;
        }
      }
      if (nearest === null) return null;
      if (minSep <= SKIN) {
        return {
          collider: nearest,
          normal: vec3(nnx, nny, nnz),
          time: clamp(travelled / maxDistance, 0, 1),
          point: vec3(px - nnx * radius, py - nny * radius, pz - nnz * radius),
        };
      }
      travelled += minSep;
      if (travelled >= maxDistance) return null;
    }
    return null;
  }

  overlapSphere(centre: Vec3, radius: number, mask: LayerMask): readonly ColliderHandle[] {
    this.gather(
      this.queryScratch,
      centre.x - radius,
      centre.y - radius,
      centre.z - radius,
      centre.x + radius,
      centre.y + radius,
      centre.z + radius,
    );
    const found: ColliderHandle[] = [];
    for (const c of this.queryScratch) {
      if ((c.layer & mask) === 0) continue;
      if (this.probe(c, centre.x, centre.y, centre.z, radius, 0, SCRATCH_NORMAL) < 0) {
        found.push(c);
      }
    }
    return found;
  }
}

/**
 * Creates the shipped kinematic physics world.
 *
 * Nothing in the simulation depends on this concrete class — swapping in a
 * different engine means implementing `PhysicsWorld` and changing this one
 * call site.
 */
export function createKinematicWorld(): PhysicsWorld {
  return new KinematicWorld();
}
