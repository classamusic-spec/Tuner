import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { GraphicsTier, ResonanceFormId, Vec3 } from '@tuner/shared';
import { PALETTE, RESONANCE_FORM_IDS, TAU, clamp01, smoothstep } from '@tuner/shared';
import type {
  DoorDef,
  GeometryDef,
  HazardDef,
  MovingPlatformDef,
  PlatformMotion,
  RailDef,
  StageDef,
  SurfaceStyle,
  WorldState,
} from '@tuner/game-core';
import type { ColliderShape } from '@tuner/physics';
import { Layer, SOLID_MASK } from '@tuner/physics';
import { surfaceMaterials } from './materials.js';
import type { MaterialRegistry } from './materials.js';
import { isRegionRestored } from './sky.js';

/**
 * The visible level, built from the same `StageDef` the physics world is built
 * from.
 *
 * The rule this file exists to enforce: **the mesh must be the collider.** Every
 * piece drawn here takes its shape, position, yaw and half-extents from the
 * exact same authored record the solver reads, including the wedge for `ramp`
 * colliders, which is built by clipping the collider's box against the same
 * `y = slope * z` plane `@tuner/physics` uses. A renderer that "roughly" matches
 * the collision produces invisible walls and phantom ledges, which is the worst
 * bug class a platformer can ship — so there is no separate visual authoring
 * path, and no fudge factors.
 *
 * The second concern is throughput. A stage here runs to several hundred pieces;
 * drawn one mesh at a time that is several hundred draw calls and no phone holds
 * 60 fps. So pieces are batched into `InstancedMesh` groups keyed by shape,
 * style and a spatial chunk, which gives both a small draw-call count *and*
 * meaningful frustum culling — one giant batch would never be culled at all.
 */

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export interface RenderQuality {
  /** Beyond this, a chunk stops being drawn entirely. */
  readonly drawDistance: number;
  /** Tighter cut for chunks made only of small pieces. */
  readonly detailDrawDistance: number;
  /** Draw distance for decorative props. */
  readonly propDrawDistance: number;
  /** Edge length of the spatial buckets static geometry is grouped into. */
  readonly chunkSize: number;
  readonly sphereSegments: number;
  readonly capsuleSegments: number;
  readonly railRadialSegments: number;
  /** Tube samples per metre of rail. */
  readonly railSegmentsPerMetre: number;
  readonly shadows: boolean;
}

export function renderQualityForTier(tier: GraphicsTier): RenderQuality {
  switch (tier) {
    case 'low':
      return {
        drawDistance: 115,
        detailDrawDistance: 46,
        propDrawDistance: 90,
        chunkSize: 36,
        sphereSegments: 8,
        capsuleSegments: 6,
        railRadialSegments: 4,
        railSegmentsPerMetre: 0.6,
        shadows: false,
      };
    case 'medium':
      return {
        drawDistance: 195,
        detailDrawDistance: 82,
        propDrawDistance: 150,
        chunkSize: 44,
        sphereSegments: 12,
        capsuleSegments: 8,
        railRadialSegments: 6,
        railSegmentsPerMetre: 1,
        shadows: true,
      };
    case 'high':
      return {
        drawDistance: 320,
        detailDrawDistance: 140,
        propDrawDistance: 260,
        chunkSize: 56,
        sphereSegments: 16,
        capsuleSegments: 10,
        railRadialSegments: 8,
        railSegmentsPerMetre: 1.6,
        shadows: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Runtime hooks
// ---------------------------------------------------------------------------

/**
 * Authoritative transforms for the parts of the level the simulation moves.
 *
 * `WorldState` deliberately does not carry a transform for every platform and
 * door — it carries what the renderer, HUD and audio need, and the stage's own
 * mechanisms are reconstructed here from the same authored motion the solver
 * integrates, driven by `world.elapsedSeconds`. That is exact for every motion
 * whose position is a closed-form function of time.
 *
 * `collapse` platforms and flag-driven doors are *not* such functions — they
 * depend on player contact and on puzzle flags. Supply this hook to feed the
 * simulation's own numbers in; without it collapse platforms hold their
 * authored position and doors stay shut.
 */
export interface StageDynamics {
  /** Live position of a moving platform, or null to use the derived motion. */
  platformPosition?(id: string): Readonly<Vec3> | null | undefined;
  /** 0 shut, 1 fully retracted. */
  doorOpenAmount?(id: string): number | undefined;
  /** Overrides the derived rhythm for a pulsing hazard. */
  hazardActive?(id: string): boolean | undefined;
  /** Overrides the infection-derived restoration test. */
  restored?(): boolean | undefined;
}

// ---------------------------------------------------------------------------
// Shape geometry
// ---------------------------------------------------------------------------

const q4 = (value: number): string => value.toFixed(4);

/**
 * Cross-section of a `ramp` collider, clipped in its local ZY plane.
 *
 * The solid is the collider's box intersected with the half-space
 * `y <= slope * z` — the identical definition `@tuner/physics` separates
 * against. Clipping the rectangle rather than special-casing "wedge" handles
 * every authored case in one path: the corner-to-corner wedge, a shallow ramp
 * that leaves a flat top, and negative slopes, which come out as the mirror.
 */
function clipRampSection(halfY: number, halfZ: number, slope: number): number[][] {
  const rect: number[][] = [
    [-halfZ, -halfY],
    [halfZ, -halfY],
    [halfZ, halfY],
    [-halfZ, halfY],
  ];
  const inside = (p: number[]): number => (p[1] ?? 0) - slope * (p[0] ?? 0);

  const out: number[][] = [];
  for (let i = 0; i < rect.length; i++) {
    const current = rect[i];
    const previous = rect[(i + rect.length - 1) % rect.length];
    if (!current || !previous) continue;
    const dc = inside(current);
    const dp = inside(previous);
    if (dc <= 0) {
      if (dp > 0) out.push(intersectSection(previous, current, dp, dc));
      out.push(current);
    } else if (dp <= 0) {
      out.push(intersectSection(previous, current, dp, dc));
    }
  }
  return out;
}

function intersectSection(a: number[], b: number[], da: number, db: number): number[] {
  const denominator = da - db;
  const t = Math.abs(denominator) < 1e-9 ? 0 : da / denominator;
  const az = a[0] ?? 0;
  const ay = a[1] ?? 0;
  const bz = b[0] ?? 0;
  const by = b[1] ?? 0;
  return [az + (bz - az) * t, ay + (by - ay) * t];
}

/**
 * Extrudes the clipped cross-section along X into the wedge the player walks on.
 *
 * Built non-indexed so `computeVertexNormals` yields hard facet normals, which
 * is the faceted low-poly read the art direction asks for and also means the
 * slope edge stays a crisp line rather than a smeared highlight.
 */
export function buildRampGeometry(
  halfExtents: Readonly<Vec3>,
  slope: number,
): THREE.BufferGeometry {
  const hx = halfExtents.x;
  const section = clipRampSection(halfExtents.y, halfExtents.z, slope);
  const positions: number[] = [];

  if (section.length >= 3) {
    const push = (x: number, zy: number[]): void => {
      positions.push(x, zy[1] ?? 0, zy[0] ?? 0);
    };

    // Side faces. Winding chosen so the outward normal of each edge points away
    // from the (counter-clockwise in Z/Y) section.
    for (let i = 0; i < section.length; i++) {
      const a = section[i];
      const b = section[(i + 1) % section.length];
      if (!a || !b) continue;
      push(-hx, a);
      push(hx, a);
      push(hx, b);

      push(-hx, a);
      push(hx, b);
      push(-hx, b);
    }

    // The +X cap, wound in reverse so it faces +X; the -X cap in section order.
    const first = section[0];
    if (first) {
      for (let i = 1; i < section.length - 1; i++) {
        const b = section[i];
        const c = section[i + 1];
        if (!b || !c) continue;
        push(hx, first);
        push(hx, c);
        push(hx, b);

        push(-hx, first);
        push(-hx, b);
        push(-hx, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Identifies a geometry that can be shared between instances. */
function shapeSignature(shape: ColliderShape, quality: RenderQuality): string {
  switch (shape.kind) {
    case 'box':
      return 'box';
    case 'sphere':
      return `sphere:${quality.sphereSegments}`;
    case 'capsule':
      return `capsule:${q4(shape.radius)}:${q4(shape.halfHeight)}:${quality.capsuleSegments}`;
    case 'ramp':
      return `ramp:${q4(shape.halfExtents.x)}:${q4(shape.halfExtents.y)}:${q4(
        shape.halfExtents.z,
      )}:${q4(shape.slope)}`;
  }
}

/**
 * The per-instance scale that turns a shared unit geometry into this collider.
 *
 * Boxes and spheres share one unit primitive and scale; capsules and ramps
 * cannot be produced by scaling (a non-uniformly scaled capsule is not a
 * capsule, and scaling a wedge changes its slope), so they get an exact
 * geometry per distinct shape and an identity scale.
 */
function shapeScaleInto(target: THREE.Vector3, shape: ColliderShape): THREE.Vector3 {
  switch (shape.kind) {
    case 'box':
      return target.set(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
    case 'sphere':
      return target.set(shape.radius, shape.radius, shape.radius);
    case 'capsule':
    case 'ramp':
      return target.set(1, 1, 1);
  }
}

function buildShapeGeometry(shape: ColliderShape, quality: RenderQuality): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(
        1,
        quality.sphereSegments,
        Math.max(4, quality.sphereSegments >> 1),
      );
    case 'capsule':
      return new THREE.CapsuleGeometry(
        shape.radius,
        shape.halfHeight * 2,
        Math.max(2, quality.capsuleSegments >> 1),
        quality.capsuleSegments,
      );
    case 'ramp':
      return buildRampGeometry(shape.halfExtents, shape.slope);
  }
}

/** Radius of a sphere that contains the collider — used for culling maths. */
function shapeBoundingRadius(shape: ColliderShape): number {
  switch (shape.kind) {
    case 'box':
    case 'ramp': {
      const h = shape.halfExtents;
      return Math.sqrt(h.x * h.x + h.y * h.y + h.z * h.z);
    }
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.halfHeight + shape.radius;
  }
}

function shapeHalfHeight(shape: ColliderShape): number {
  switch (shape.kind) {
    case 'box':
    case 'ramp':
      return shape.halfExtents.y;
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.halfHeight + shape.radius;
  }
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * Where an authored platform is at a given moment.
 *
 * A closed-form function of elapsed time, so the renderer and the solver agree
 * without any state being copied between them. `collapse` is the exception —
 * it depends on player contact — and falls back to the authored position.
 */
export function evaluatePlatformPosition(
  base: Readonly<Vec3>,
  motion: PlatformMotion,
  phase: number,
  elapsedSeconds: number,
  bpm: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  switch (motion.kind) {
    case 'linear': {
      const travel = Math.max(motion.seconds, 1e-3);
      const pause = Math.max(motion.pause ?? 0, 0);
      const period = (travel + pause) * 2;
      let u = (elapsedSeconds / period + phase) % 1;
      if (u < 0) u += 1;
      const t = u * period;
      let k: number;
      if (t < travel) k = t / travel;
      else if (t < travel + pause) k = 1;
      else if (t < travel * 2 + pause) k = 1 - (t - travel - pause) / travel;
      else k = 0;
      // Eased rather than linear: a platform that starts and stops abruptly is
      // far harder to land a jump on than one that settles.
      const eased = smoothstep(0, 1, k);
      target.set(
        base.x + (motion.to.x - base.x) * eased,
        base.y + (motion.to.y - base.y) * eased,
        base.z + (motion.to.z - base.z) * eased,
      );
      return target;
    }
    case 'vertical': {
      const period = Math.max(motion.seconds, 1e-3);
      const angle = TAU * (elapsedSeconds / period + phase);
      target.set(base.x, base.y + Math.sin(angle) * motion.amplitude, base.z);
      return target;
    }
    case 'orbit': {
      const period = Math.max(motion.seconds, 1e-3);
      const start = Math.atan2(base.z - motion.centre.z, base.x - motion.centre.x);
      const angle = start + TAU * (elapsedSeconds / period + phase);
      target.set(
        motion.centre.x + Math.cos(angle) * motion.radius,
        base.y,
        motion.centre.z + Math.sin(angle) * motion.radius,
      );
      return target;
    }
    case 'rhythm': {
      const beatSeconds = 60 / Math.max(bpm, 1);
      const window = Math.max(motion.beats, 1);
      const cycles = elapsedSeconds / (beatSeconds * window) + phase;
      const index = Math.floor(cycles);
      const fraction = cycles - index;
      // Held for most of the window, then snapping across so the arrival lands
      // on the beat the player can hear and see.
      const move = smoothstep(0.72, 1, fraction);
      const even = ((index % 2) + 2) % 2 === 0;
      const k = even ? move : 1 - move;
      target.set(
        base.x + (motion.to.x - base.x) * k,
        base.y + (motion.to.y - base.y) * k,
        base.z + (motion.to.z - base.z) * k,
      );
      return target;
    }
    case 'collapse':
      return target.set(base.x, base.y, base.z);
  }
}

/** Whether a rhythmic hazard is live this instant. */
export function evaluateHazardActive(
  // Accepts null as well as undefined: the instance source stores "no rhythm"
  // as null, and normalising here is cheaper than at every call site.
  rhythm: HazardDef['rhythm'] | null,
  elapsedSeconds: number,
  bpm: number,
): boolean {
  if (!rhythm) return true;
  const beatSeconds = 60 / Math.max(bpm, 1);
  const window = Math.max(rhythm.beats, 1);
  const beat = Math.floor(elapsedSeconds / beatSeconds + (rhythm.offset ?? 0));
  const position = ((beat % window) + window) % window;
  return position < Math.max(rhythm.activeBeats, 0);
}

// ---------------------------------------------------------------------------
// Build model
// ---------------------------------------------------------------------------

type EntryKind = 'static' | 'platform' | 'door' | 'hazard';

interface RenderableSource {
  readonly id: string;
  readonly kind: EntryKind;
  readonly shape: ColliderShape;
  readonly position: Readonly<Vec3>;
  readonly yaw: number;
  readonly style: SurfaceStyle;
  readonly revealedBy: ResonanceFormId | null;
  readonly onlyWhenRestored: boolean;
  readonly hiddenWhenRestored: boolean;
  readonly motion: PlatformMotion | null;
  readonly phase: number;
  readonly rhythm: HazardDef['rhythm'] | null;
  readonly clearedBy: ResonanceFormId | null;
}

interface Entry {
  readonly source: RenderableSource;
  readonly index: number;
  readonly base: THREE.Vector3;
  readonly scale: THREE.Vector3;
  readonly halfHeight: number;
  readonly conditional: boolean;
}

interface InstanceGroup {
  readonly mesh: THREE.InstancedMesh;
  readonly entries: Entry[];
  readonly kind: EntryKind;
  readonly centre: THREE.Vector3;
  /** Radius of the group's bounding sphere, for the distance cut. */
  readonly radius: number;
  /** True when every piece is small; these fade out much closer to the camera. */
  readonly detail: boolean;
  /** True when any entry has a visibility condition worth re-evaluating. */
  readonly conditional: boolean;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColour = new THREE.Color();
const scratchLive = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const HIDDEN_SCALE = new THREE.Vector3(0, 0, 0);
const RESTORE_TINT = new THREE.Color(PALETTE.restore);

/** Styles that must never write to the shadow map. */
const TRANSLUCENT_STYLES: ReadonlySet<SurfaceStyle> = new Set<SurfaceStyle>([
  'glass',
  'water',
  'invisible',
]);

function formIndex(form: ResonanceFormId): number {
  const index = RESONANCE_FORM_IDS.indexOf(form);
  return index < 0 ? 0 : index;
}

/** Non-solid volumes (script triggers, camera blockers) are never drawn. */
function isDrawableLayer(layer: number | undefined): boolean {
  if (layer === undefined) return true;
  if ((layer & SOLID_MASK) !== 0) return true;
  if ((layer & (Layer.Wall | Layer.Rail | Layer.Bounce)) !== 0) return true;
  return (layer & (Layer.Trigger | Layer.CameraBlocker)) === 0;
}

function geometrySource(def: GeometryDef): RenderableSource | null {
  const style = def.style ?? 'stone';
  if (style === 'invisible' || !isDrawableLayer(def.layer)) return null;
  return {
    id: def.id,
    kind: 'static',
    shape: def.shape,
    position: def.position,
    yaw: def.yaw ?? 0,
    style,
    revealedBy: def.revealedBy ?? null,
    onlyWhenRestored: def.onlyWhenRestored ?? false,
    hiddenWhenRestored: def.hiddenWhenRestored ?? false,
    motion: null,
    phase: 0,
    rhythm: null,
    clearedBy: null,
  };
}

function platformSource(def: MovingPlatformDef): RenderableSource | null {
  const style = def.style ?? 'metal';
  if (style === 'invisible') return null;
  return {
    id: def.id,
    kind: 'platform',
    shape: def.shape,
    position: def.position,
    yaw: def.yaw ?? 0,
    style,
    revealedBy: def.revealedBy ?? null,
    onlyWhenRestored: def.onlyWhenRestored ?? false,
    hiddenWhenRestored: def.hiddenWhenRestored ?? false,
    motion: def.motion,
    phase: def.phase ?? 0,
    rhythm: null,
    clearedBy: null,
  };
}

function doorSource(def: DoorDef): RenderableSource | null {
  const style = def.style ?? 'gold-trim';
  if (style === 'invisible') return null;
  return {
    id: def.id,
    kind: 'door',
    shape: def.shape,
    position: def.position,
    yaw: def.yaw ?? 0,
    style,
    revealedBy: null,
    onlyWhenRestored: false,
    hiddenWhenRestored: false,
    motion: null,
    phase: 0,
    rhythm: null,
    clearedBy: null,
  };
}

function hazardSource(def: HazardDef): RenderableSource | null {
  // A pit is an absence, not an object: it is a kill volume slung under the
  // level and drawing it would fill in the hole the player is meant to fall
  // through.
  if (def.isPit) return null;
  const style = def.style ?? 'infected';
  if (style === 'invisible') return null;
  return {
    id: def.id,
    kind: 'hazard',
    shape: def.shape,
    position: def.position,
    yaw: 0,
    style,
    revealedBy: null,
    onlyWhenRestored: false,
    hiddenWhenRestored: false,
    motion: null,
    phase: 0,
    rhythm: def.rhythm ?? null,
    clearedBy: def.clearedBy ?? null,
  };
}

function isConditional(source: RenderableSource): boolean {
  return source.revealedBy !== null || source.onlyWhenRestored || source.hiddenWhenRestored;
}

function entryVisible(
  source: RenderableSource,
  restored: boolean,
  sight: boolean,
  form: ResonanceFormId,
): boolean {
  if (source.onlyWhenRestored && !restored) return false;
  if (source.hiddenWhenRestored && restored) return false;
  if (source.revealedBy !== null && !sight && form !== source.revealedBy) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rails
// ---------------------------------------------------------------------------

interface RailVisual {
  readonly core: THREE.Mesh;
  readonly halo: THREE.Mesh;
  readonly def: RailDef;
}

function buildRailCurve(points: readonly Vec3[]): THREE.CurvePath<THREE.Vector3> | null {
  if (points.length < 2) return null;
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    path.add(
      new THREE.LineCurve3(new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)),
    );
  }
  return path.curves.length > 0 ? path : null;
}

function railLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Built stage
// ---------------------------------------------------------------------------

export interface BuiltStage {
  readonly root: THREE.Group;
  /** Groups built, exposed for the debug overlay and for tests. */
  readonly groups: readonly InstanceGroup[];
  update(camera: THREE.Camera, world: WorldState, dynamics?: StageDynamics): void;
  dispose(): void;
}

/**
 * Builds every instanced batch, rail and mechanism for a stage.
 *
 * Called once per stage load; the returned object is then driven each frame
 * without allocating.
 */
export function buildStageGeometry(
  stage: StageDef,
  tier: GraphicsTier,
  quality: RenderQuality,
  materials: MaterialRegistry,
): BuiltStage {
  const root = new THREE.Group();
  root.name = `tuner-stage-${stage.id}`;

  const geometryCache = new Map<string, THREE.BufferGeometry>();
  const ownedGeometry: THREE.BufferGeometry[] = [];
  const ownedMaterials: THREE.Material[] = [];

  const cachedGeometry = (shape: ColliderShape): THREE.BufferGeometry => {
    const signature = shapeSignature(shape, quality);
    const existing = geometryCache.get(signature);
    if (existing) return existing;
    const created = buildShapeGeometry(shape, quality);
    geometryCache.set(signature, created);
    ownedGeometry.push(created);
    return created;
  };

  // -- Bucket every renderable into an instanced batch --------------------

  const sources: RenderableSource[] = [];
  for (const def of stage.geometry) {
    const source = geometrySource(def);
    if (source) sources.push(source);
  }
  for (const def of stage.movingPlatforms) {
    const source = platformSource(def);
    if (source) sources.push(source);
  }
  for (const def of stage.doors) {
    const source = doorSource(def);
    if (source) sources.push(source);
  }
  for (const def of stage.hazards) {
    const source = hazardSource(def);
    if (source) sources.push(source);
  }

  const buckets = new Map<string, RenderableSource[]>();
  for (const source of sources) {
    const signature = shapeSignature(source.shape, quality);
    // Static geometry is chunked spatially so each batch has a tight bounding
    // sphere and can actually be culled; anything that moves is batched by kind
    // instead, because a moving piece would keep falling out of its chunk.
    const bucket =
      source.kind === 'static'
        ? `${Math.floor(source.position.x / quality.chunkSize)}:${Math.floor(
            source.position.z / quality.chunkSize,
          )}`
        : source.kind;
    const key = `${signature}|${source.style}|${bucket}`;
    const existing = buckets.get(key);
    if (existing) existing.push(source);
    else buckets.set(key, [source]);
  }

  const groups: InstanceGroup[] = [];
  const dynamicGroups: InstanceGroup[] = [];

  for (const bucket of buckets.values()) {
    const first = bucket[0];
    if (!first) continue;
    const geometry = cachedGeometry(first.shape);
    const material = materials.get(first.style, tier);
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = `tuner-${first.kind}-${first.style}`;

    const translucent = TRANSLUCENT_STYLES.has(first.style);
    mesh.castShadow = quality.shadows && !translucent;
    mesh.receiveShadow = !translucent;
    mesh.frustumCulled = true;
    if (first.kind !== 'static') {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    const entries: Entry[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let largest = 0;
    let conditional = false;

    for (let index = 0; index < bucket.length; index++) {
      const source = bucket[index];
      if (!source) continue;
      const scale = shapeScaleInto(new THREE.Vector3(), source.shape).clone();
      const base = new THREE.Vector3(source.position.x, source.position.y, source.position.z);
      const entryConditional = isConditional(source);
      conditional = conditional || entryConditional;
      entries.push({
        source,
        index,
        base,
        scale,
        halfHeight: shapeHalfHeight(source.shape),
        conditional: entryConditional,
      });

      const radius = shapeBoundingRadius(source.shape);
      largest = Math.max(largest, radius);
      minX = Math.min(minX, base.x - radius);
      minY = Math.min(minY, base.y - radius);
      minZ = Math.min(minZ, base.z - radius);
      maxX = Math.max(maxX, base.x + radius);
      maxY = Math.max(maxY, base.y + radius);
      maxZ = Math.max(maxZ, base.z + radius);

      scratchQuaternion.setFromAxisAngle(yAxis, source.yaw);
      scratchMatrix.compose(base, scratchQuaternion, scale);
      mesh.setMatrixAt(index, scratchMatrix);
    }

    if (first.kind === 'hazard') {
      // Hazards carry per-instance colour so a rhythmic one can dim off-beat and
      // a clearable one can read as clearable, all inside one draw call.
      for (let index = 0; index < bucket.length; index++) {
        mesh.setColorAt(index, scratchColour.setRGB(1, 1, 1));
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    const centre = new THREE.Vector3(
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      (minZ + maxZ) * 0.5,
    );
    const radius =
      0.5 *
      Math.sqrt(
        (maxX - minX) * (maxX - minX) +
          (maxY - minY) * (maxY - minY) +
          (maxZ - minZ) * (maxZ - minZ),
      );

    const group: InstanceGroup = {
      mesh,
      entries,
      kind: first.kind,
      centre,
      radius,
      detail: largest < 2.5,
      conditional,
    };
    groups.push(group);
    if (first.kind !== 'static') dynamicGroups.push(group);
    root.add(mesh);
  }

  // -- Rails ---------------------------------------------------------------

  const railCore = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.resonance),
    toneMapped: false,
    fog: false,
  });
  const railHalo = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.resonanceDeep),
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const railLockedCore = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.goldDim),
    toneMapped: false,
    fog: false,
  });
  ownedMaterials.push(railCore, railHalo, railLockedCore);

  const rails: RailVisual[] = [];
  for (const def of stage.rails) {
    const curve = buildRailCurve(def.points);
    if (!curve) continue;
    const length = railLength(def.points);
    const segments = Math.max(8, Math.round(length * quality.railSegmentsPerMetre));
    const coreGeometry = new THREE.TubeGeometry(
      curve,
      segments,
      0.07,
      quality.railRadialSegments,
      false,
    );
    const haloGeometry = new THREE.TubeGeometry(
      curve,
      segments,
      0.2,
      quality.railRadialSegments,
      false,
    );
    ownedGeometry.push(coreGeometry, haloGeometry);

    const core = new THREE.Mesh(coreGeometry, railCore);
    core.name = `tuner-rail-${def.id}`;
    const halo = new THREE.Mesh(haloGeometry, railHalo);
    halo.name = `tuner-rail-halo-${def.id}`;
    halo.renderOrder = 2;
    root.add(core);
    root.add(halo);
    rails.push({ core, halo, def });
  }

  // -- Frame update --------------------------------------------------------

  let lastConditionSignature = -1;

  const writeEntry = (
    group: InstanceGroup,
    entry: Entry,
    position: THREE.Vector3,
    visible: boolean,
  ): void => {
    scratchQuaternion.setFromAxisAngle(yAxis, entry.source.yaw);
    scratchMatrix.compose(position, scratchQuaternion, visible ? entry.scale : HIDDEN_SCALE);
    group.mesh.setMatrixAt(entry.index, scratchMatrix);
  };

  const update = (camera: THREE.Camera, world: WorldState, dynamics?: StageDynamics): void => {
    const infection = clamp01(world.stage.infection);
    const restored = dynamics?.restored?.() ?? isRegionRestored(infection);
    const sight = world.player.resonanceSightActive;
    const form = world.player.form;
    const elapsed = world.elapsedSeconds;

    // Static batches only need rewriting when a visibility condition flips, so
    // the common frame touches no static instance matrices at all.
    const signature =
      (restored ? 1 : 0) | (sight ? 2 : 0) | (formIndex(form) << 2);
    if (signature !== lastConditionSignature) {
      lastConditionSignature = signature;
      for (const group of groups) {
        if (!group.conditional) continue;
        for (const entry of group.entries) {
          if (!entry.conditional) continue;
          writeEntry(
            group,
            entry,
            entry.base,
            entryVisible(entry.source, restored, sight, form),
          );
        }
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    // Mechanisms: platforms, doors and pulsing hazards.
    for (const group of dynamicGroups) {
      let colourDirty = false;
      for (const entry of group.entries) {
        const source = entry.source;
        const visible = entryVisible(source, restored, sight, form);

        if (source.kind === 'platform') {
          const live = dynamics?.platformPosition?.(source.id);
          if (live) {
            scratchLive.set(live.x, live.y, live.z);
          } else if (source.motion) {
            evaluatePlatformPosition(
              entry.base,
              source.motion,
              source.phase,
              elapsed,
              stage.bpm,
              scratchLive,
            );
          } else {
            scratchLive.copy(entry.base);
          }
          writeEntry(group, entry, scratchLive, visible);
          continue;
        }

        if (source.kind === 'door') {
          const open = clamp01(dynamics?.doorOpenAmount?.(source.id) ?? 0);
          // Doors retract into their own frame; once fully open the collider is
          // gone from the solver, so the mesh has to go too.
          scratchLive.set(
            entry.base.x,
            entry.base.y - (entry.halfHeight * 2 + 0.08) * open,
            entry.base.z,
          );
          writeEntry(group, entry, scratchLive, visible && open < 0.995);
          continue;
        }

        // Hazard.
        const active =
          dynamics?.hazardActive?.(source.id) ??
          evaluateHazardActive(source.rhythm, elapsed, stage.bpm);
        const shrink = active ? 1 : 0.82;
        scratchScale.copy(entry.scale).multiplyScalar(shrink);
        scratchQuaternion.setFromAxisAngle(yAxis, source.yaw);
        scratchMatrix.compose(
          entry.base,
          scratchQuaternion,
          visible ? scratchScale : HIDDEN_SCALE,
        );
        group.mesh.setMatrixAt(entry.index, scratchMatrix);

        scratchColour.setRGB(1, 1, 1);
        if (!active) scratchColour.setRGB(0.34, 0.3, 0.42);
        if (source.clearedBy !== null && source.clearedBy === form) {
          // The equipped form can put this hazard out — say so, silently.
          scratchColour.lerp(RESTORE_TINT, 0.55);
        }
        group.mesh.setColorAt(entry.index, scratchColour);
        colourDirty = true;
      }
      group.mesh.instanceMatrix.needsUpdate = true;
      const instanceColour = group.mesh.instanceColor;
      if (colourDirty && instanceColour) instanceColour.needsUpdate = true;
    }

    // Distance cut. Frustum culling is left to the renderer, which already has
    // the group bounding spheres; this handles the "behind me but in frustum"
    // and "far down the valley" cases a frustum test cannot.
    const cameraPosition = camera.position;
    for (const group of groups) {
      const limit = group.detail ? quality.detailDrawDistance : quality.drawDistance;
      const distance = cameraPosition.distanceTo(group.centre) - group.radius;
      group.mesh.visible = distance <= limit;
    }

    // Rails read as available or locked, which is the only hint the player gets
    // that a line needs a form they have not found yet.
    for (const rail of rails) {
      const required = rail.def.requiresForm;
      const unlocked = required === undefined || world.player.unlockedForms.includes(required);
      rail.core.material = unlocked ? railCore : railLockedCore;
      const distance = cameraPosition.distanceTo(rail.core.position) - 1;
      const withinRange = distance <= quality.drawDistance;
      rail.core.visible = withinRange;
      rail.halo.visible = withinRange && unlocked;
    }
  };

  return {
    root,
    groups,
    update,
    dispose(): void {
      for (const group of groups) {
        group.mesh.dispose();
      }
      for (const geometry of ownedGeometry) {
        geometry.dispose();
      }
      for (const material of ownedMaterials) {
        material.dispose();
      }
      geometryCache.clear();
      groups.length = 0;
      dynamicGroups.length = 0;
      rails.length = 0;
      root.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface StageGeometryProps {
  readonly stage: StageDef;
  readonly world: WorldState;
  readonly tier?: GraphicsTier;
  readonly quality?: RenderQuality;
  readonly materials?: MaterialRegistry;
  readonly dynamics?: StageDynamics;
}

/**
 * Draws a stage.
 *
 * Pure presentation: it reads `StageDef` and `WorldState` and writes to neither.
 * The simulation owns the loop; this only paints whatever the latest state says.
 */
export function StageGeometry(props: StageGeometryProps): ReactElement {
  const tier: GraphicsTier = props.tier ?? 'high';
  const quality = props.quality ?? renderQualityForTier(tier);
  const materials = props.materials ?? surfaceMaterials;
  const stage = props.stage;

  const built = useMemo(
    () => buildStageGeometry(stage, tier, quality, materials),
    [stage, tier, quality, materials],
  );

  const latest = useRef(props);
  latest.current = props;

  useEffect(() => () => built.dispose(), [built]);

  useFrame((state) => {
    const current = latest.current;
    built.update(state.camera, current.world, current.dynamics);
  });

  return <primitive object={built.root} />;
}
