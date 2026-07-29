import { describe, expect, it } from 'vitest';
import { vec3, type Vec3 } from '@tuner/shared';
import { createKinematicWorld } from './kinematic-world.js';
import { Layer, SOLID_MASK, type ColliderHandle, type PhysicsWorld } from './types.js';

const RADIUS = 0.36;
const HEIGHT = 1.6;
/** Distance from the capsule centre to the tip of a cap. */
const HALF_BODY = HEIGHT / 2;
const STEP_HEIGHT = 0.42;
const MAX_SLOPE = (52 * Math.PI) / 180;
const DT = 1 / 60;
const GRAVITY = -32;

type Move = ReturnType<PhysicsWorld['moveCharacter']>;

interface SimOptions {
  readonly steps: number;
  /** Horizontal intent, re-applied every step the way a controller would. */
  readonly move?: (step: number) => { x: number; z: number };
  /** Returns a vertical velocity to force this step (a jump), or undefined. */
  readonly jump?: (step: number) => number | undefined;
  readonly gravity?: boolean;
  readonly snapToGround?: boolean;
  readonly stepHeight?: number;
  readonly maxSlopeRadians?: number;
  readonly onStep?: (step: number, position: Vec3, result: Move) => void;
}

function simulate(
  world: PhysicsWorld,
  start: Vec3,
  options: SimOptions,
): { position: Vec3; velocity: Vec3; grounded: boolean; result: Move } {
  let position = vec3(start.x, start.y, start.z);
  let vy = 0;
  let grounded = false;
  let result: Move | null = null;
  for (let step = 0; step < options.steps; step++) {
    const wanted = options.move?.(step) ?? { x: 0, z: 0 };
    const forced = options.jump?.(step);
    if (forced !== undefined) {
      vy = forced;
    } else if (options.gravity !== false) {
      vy = grounded && vy <= 0 ? 0 : vy + GRAVITY * DT;
    }
    result = world.moveCharacter({
      position,
      velocity: vec3(wanted.x, vy, wanted.z),
      radius: RADIUS,
      height: HEIGHT,
      deltaSeconds: DT,
      mask: SOLID_MASK,
      maxSlopeRadians: options.maxSlopeRadians ?? MAX_SLOPE,
      stepHeight: options.stepHeight ?? STEP_HEIGHT,
      snapToGround: options.snapToGround ?? true,
    });
    position = vec3(result.position.x, result.position.y, result.position.z);
    vy = result.velocity.y;
    grounded = result.grounded;
    options.onStep?.(step, position, result);
  }
  if (result === null) throw new Error('simulate needs at least one step');
  return {
    position,
    velocity: vec3(result.velocity.x, result.velocity.y, result.velocity.z),
    grounded,
    result,
  };
}

function addFloor(world: PhysicsWorld, top = 0, half = 30): ColliderHandle {
  return world.addCollider({
    shape: { kind: 'box', halfExtents: vec3(half, 1, half) },
    position: vec3(0, top - 1, 0),
    layer: Layer.Terrain,
  });
}

describe('createKinematicWorld: authoring', () => {
  it('tracks colliders and clears them', () => {
    const world = createKinematicWorld();
    const a = addFloor(world);
    const b = world.addCollider({
      shape: { kind: 'sphere', radius: 1 },
      position: vec3(4, 1, 0),
      layer: Layer.Terrain,
    });
    expect(world.stats.colliderCount).toBe(2);
    expect(world.colliders).toHaveLength(2);
    world.removeCollider(a);
    expect(world.stats.colliderCount).toBe(1);
    expect(world.colliders[0]).toBe(b);
    world.clear();
    expect(world.stats.colliderCount).toBe(0);
    expect(world.raycast(vec3(4, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK)).toBeNull();
  });
});

describe('moveCharacter: ground', () => {
  it('falls onto a floor and rests exactly on the surface', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    const out = simulate(world, vec3(0, 5, 0), {
      steps: 90,
      move: () => ({ x: 0, z: 0 }),
    });
    expect(out.grounded).toBe(true);
    // Resting on the surface, not sunk into it and not floating above it.
    expect(out.position.y).toBeGreaterThanOrEqual(HALF_BODY - 1e-9);
    expect(out.position.y).toBeCloseTo(HALF_BODY, 6);
    expect(out.velocity.y).toBeCloseTo(0, 6);
    expect(out.result.groundNormal.y).toBeCloseTo(1, 6);
    expect(out.result.groundCollider).not.toBeNull();
  });

  it('stays put and grounded when standing still', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    const settled = simulate(world, vec3(0, 5, 0), { steps: 90 });
    const held = simulate(world, settled.position, { steps: 30 });
    expect(held.grounded).toBe(true);
    expect(held.position.y).toBeCloseTo(settled.position.y, 9);
    expect(held.position.x).toBeCloseTo(settled.position.x, 9);
  });

  it('is safe with zero delta time and zero velocity', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    const result = world.moveCharacter({
      position: vec3(0, HALF_BODY, 0),
      velocity: vec3(0, 0, 0),
      radius: RADIUS,
      height: HEIGHT,
      deltaSeconds: 0,
      mask: SOLID_MASK,
      maxSlopeRadians: MAX_SLOPE,
      stepHeight: STEP_HEIGHT,
      snapToGround: true,
    });
    expect(Number.isFinite(result.position.x)).toBe(true);
    expect(Number.isFinite(result.position.y)).toBe(true);
    expect(result.position.y).toBeCloseTo(HALF_BODY, 6);
    expect(result.grounded).toBe(true);
    expect(result.triggers).toHaveLength(0);
  });

  it('depenetrates a body that starts inside geometry', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    const result = world.moveCharacter({
      // Half a metre below the floor surface.
      position: vec3(0, 0.3, 0),
      velocity: vec3(0, 0, 0),
      radius: RADIUS,
      height: HEIGHT,
      deltaSeconds: DT,
      mask: SOLID_MASK,
      maxSlopeRadians: MAX_SLOPE,
      stepHeight: STEP_HEIGHT,
      snapToGround: true,
    });
    expect(result.position.y).toBeGreaterThanOrEqual(HALF_BODY - 1e-6);
    expect(result.position.y).toBeCloseTo(HALF_BODY, 4);
    expect(result.grounded).toBe(true);
  });
});

describe('moveCharacter: walls', () => {
  it('slides along a vertical wall and keeps its tangential speed', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 3, 12) },
      position: vec3(2.5, 3, 0),
      layer: Layer.Terrain,
    });
    let lastZ = 0;
    let stepDz = 0;
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 40,
      move: () => ({ x: 6, z: 6 }),
      onStep: (step, position) => {
        if (step === 35) lastZ = position.z;
        if (step === 36) stepDz = position.z - lastZ;
      },
    });
    // Blocked in x at the wall face, unimpeded in z.
    expect(out.position.x).toBeCloseTo(2 - RADIUS, 3);
    expect(out.position.z).toBeCloseTo(6 * 40 * DT, 3);
    expect(stepDz).toBeCloseTo(6 * DT, 4);
    expect(out.result.touchingWall).toBe(true);
    expect(out.result.wallNormal.x).toBeCloseTo(-1, 5);
    expect(out.result.wallCollider).not.toBeNull();
    expect(out.velocity.x).toBeCloseTo(0, 6);
    expect(out.velocity.z).toBeCloseTo(6, 6);
  });

  it('never penetrates a wall hit head on', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 3, 12) },
      position: vec3(2.5, 3, 0),
      layer: Layer.Terrain,
    });
    let maxX = 0;
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 60,
      move: () => ({ x: 14, z: 0 }),
      onStep: (_step, position) => {
        maxX = Math.max(maxX, position.x);
      },
    });
    expect(maxX).toBeLessThanOrEqual(2 - RADIUS + 1e-3);
    expect(out.result.touchingWall).toBe(true);
  });

  it('slides along a yaw-rotated wall', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 3, 12) },
      position: vec3(3, 3, 0),
      yaw: Math.PI / 4,
      layer: Layer.Terrain,
    });
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 40,
      move: () => ({ x: 5, z: 0 }),
    });
    // The wall faces (-cos45, 0, sin45), so pushing +x deflects the body +z.
    expect(out.position.z).toBeGreaterThan(0.7);
    expect(out.position.x).toBeLessThan(3);
    expect(out.result.touchingWall).toBe(true);
    expect(out.result.wallNormal.x).toBeCloseTo(-Math.SQRT1_2, 4);
    expect(out.result.wallNormal.z).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('reports a ceiling when the head strikes one', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(6, 0.5, 6) },
      position: vec3(0, 3.5, 0),
      layer: Layer.Terrain,
    });
    let sawCeiling = false;
    let maxY = 0;
    simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 30,
      jump: (step) => (step === 0 ? 14 : undefined),
      onStep: (_step, position, result) => {
        sawCeiling = sawCeiling || result.touchingCeiling;
        maxY = Math.max(maxY, position.y);
      },
    });
    expect(sawCeiling).toBe(true);
    expect(maxY).toBeLessThanOrEqual(3 - HALF_BODY + 1e-3);
  });

  it('is blocked by sphere and capsule colliders', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'sphere', radius: 1.2 },
      position: vec3(3, 0.8, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'capsule', radius: 0.6, halfHeight: 2 },
      position: vec3(0, 2, 3),
      layer: Layer.Terrain,
    });
    const intoSphere = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 40,
      move: () => ({ x: 6, z: 0 }),
    });
    expect(intoSphere.position.x).toBeLessThan(3);
    const intoCapsule = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 40,
      move: () => ({ x: 0, z: 6 }),
    });
    expect(intoCapsule.position.z).toBeLessThan(3 - 0.6);
  });
});

describe('moveCharacter: slopes', () => {
  const buildRamp = (slope: number): PhysicsWorld => {
    const world = createKinematicWorld();
    // Floor top at y = -2 so the ramp's base sits flush with it.
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(30, 1, 30) },
      position: vec3(0, -3, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'ramp', halfExtents: vec3(4, 2, 4), slope },
      position: vec3(0, 0, 6),
      layer: Layer.Terrain,
    });
    return world;
  };

  it('walks up a ramp inside the slope limit and stays grounded', () => {
    const world = buildRamp(0.5);
    let ungroundedSteps = 0;
    const out = simulate(world, vec3(0, -2 + HALF_BODY, 0), {
      steps: 120,
      move: () => ({ x: 0, z: 4 }),
      onStep: (step, _position, result) => {
        if (step > 4 && !result.grounded) ungroundedSteps++;
      },
    });
    expect(ungroundedSteps).toBe(0);
    expect(out.position.z).toBeGreaterThan(3);
    // Standing on the slope, not stuck at the bottom.
    expect(out.position.y).toBeGreaterThan(-2 + HALF_BODY + 0.5);
    expect(out.result.groundNormal.y).toBeCloseTo(1 / Math.sqrt(1.25), 3);
    expect(out.result.groundNormal.z).toBeCloseTo(-0.5 / Math.sqrt(1.25), 3);
  });

  it('treats a ramp steeper than the slope limit as a wall', () => {
    const world = createKinematicWorld();
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(30, 1, 30) },
      position: vec3(0, -1, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'ramp', halfExtents: vec3(4, 2, 1), slope: 2 },
      position: vec3(0, 2, 6),
      layer: Layer.Terrain,
    });
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 90,
      move: () => ({ x: 0, z: 5 }),
    });
    // Stopped at the foot of the ramp instead of climbing it.
    expect(out.position.z).toBeLessThan(5.2);
    expect(out.position.y).toBeCloseTo(HALF_BODY, 2);
    expect(out.result.touchingWall).toBe(true);
  });

  it('never reports ground on a too-steep face and slides back down', () => {
    const world = createKinematicWorld();
    world.addCollider({
      shape: { kind: 'ramp', halfExtents: vec3(4, 2, 4), slope: 2 },
      position: vec3(0, 0, 0),
      layer: Layer.Terrain,
    });
    let grounded = false;
    const out = simulate(world, vec3(0, 4, 0), {
      steps: 40,
      onStep: (_step, _position, result) => {
        grounded = grounded || result.grounded;
      },
    });
    expect(grounded).toBe(false);
    // Pushed away from the face, i.e. it slid rather than stuck.
    expect(out.position.z).toBeLessThan(-0.2);
  });

  it('snapToGround keeps the body glued while running downhill', () => {
    const runDown = (snapToGround: boolean): number => {
      const world = buildRamp(0.5);
      let airborne = 0;
      simulate(world, vec3(0, 1 + HALF_BODY, 8), {
        steps: 40,
        move: () => ({ x: 0, z: -8 }),
        snapToGround,
        onStep: (step, _position, result) => {
          if (step > 2 && !result.grounded) airborne++;
        },
      });
      return airborne;
    };
    expect(runDown(true)).toBe(0);
    expect(runDown(false)).toBeGreaterThan(0);
  });
});

describe('moveCharacter: step height', () => {
  const buildLip = (lipTop: number): PhysicsWorld => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(2, lipTop / 2, 6) },
      position: vec3(3, lipTop / 2, 0),
      layer: Layer.Terrain,
    });
    return world;
  };

  it('climbs a 0.3 m lip', () => {
    const world = buildLip(0.3);
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 60,
      move: () => ({ x: 5, z: 0 }),
    });
    expect(out.position.x).toBeGreaterThan(1.5);
    expect(out.position.y).toBeCloseTo(0.3 + HALF_BODY, 2);
    expect(out.grounded).toBe(true);
  });

  it('does not climb a 1.0 m lip', () => {
    const world = buildLip(1);
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 60,
      move: () => ({ x: 5, z: 0 }),
    });
    expect(out.position.x).toBeLessThan(1 - RADIUS + 1e-2);
    expect(out.position.y).toBeCloseTo(HALF_BODY, 2);
    expect(out.result.touchingWall).toBe(true);
  });

  it('does not climb anything when stepHeight is zero', () => {
    const world = buildLip(0.3);
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 60,
      move: () => ({ x: 5, z: 0 }),
      stepHeight: 0,
    });
    expect(out.position.y).toBeCloseTo(HALF_BODY, 2);
    expect(out.position.x).toBeLessThan(1.1);
  });
});

describe('moveCharacter: triggers', () => {
  it('reports overlapped triggers without blocking motion', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    const trigger = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 2, 2) },
      position: vec3(2, 1, 0),
      layer: Layer.Trigger,
      isTrigger: true,
      tag: 'checkpoint',
    });
    let reported = 0;
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 60,
      move: () => ({ x: 5, z: 0 }),
      onStep: (_step, _position, result) => {
        if (result.triggers.includes(trigger)) reported++;
      },
    });
    expect(reported).toBeGreaterThan(0);
    // Motion was never blocked: 60 steps at 5 m/s.
    expect(out.position.x).toBeCloseTo(5 * 60 * DT, 3);
    expect(out.result.triggers).toHaveLength(0);
    expect(trigger.descriptor.tag).toBe('checkpoint');
  });

  it('does not report distant triggers', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 2, 2) },
      position: vec3(20, 1, 0),
      layer: Layer.Trigger,
      isTrigger: true,
    });
    const out = simulate(world, vec3(0, HALF_BODY, 0), {
      steps: 10,
      move: () => ({ x: 5, z: 0 }),
    });
    expect(out.result.triggers).toHaveLength(0);
  });
});

describe('queries', () => {
  it('raycast returns the nearest of two stacked colliders', () => {
    const world = createKinematicWorld();
    const low = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(2, 0.5, 2) },
      position: vec3(0, 0, 0),
      layer: Layer.Terrain,
    });
    const high = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(2, 0.5, 2) },
      position: vec3(0, 3, 0),
      layer: Layer.Terrain,
    });
    const hit = world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(hit).not.toBeNull();
    expect(hit?.collider).toBe(high);
    expect(hit?.distance).toBeCloseTo(6.5, 6);
    expect(hit?.point.y).toBeCloseTo(3.5, 6);
    expect(hit?.normal.y).toBeCloseTo(1, 6);
    const ignored = world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 20, SOLID_MASK, high);
    expect(ignored?.collider).toBe(low);
    expect(ignored?.distance).toBeCloseTo(9.5, 6);
  });

  it('raycast honours the layer mask', () => {
    const world = createKinematicWorld();
    const terrain = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(2, 0.5, 2) },
      position: vec3(0, 0, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(2, 0.5, 2) },
      position: vec3(0, 3, 0),
      layer: Layer.Enemy,
    });
    const solid = world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(solid?.collider).toBe(terrain);
    const enemies = world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 20, Layer.Enemy);
    expect(enemies?.collider.descriptor.layer).toBe(Layer.Enemy);
    expect(world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 20, Layer.Rail)).toBeNull();
  });

  it('raycast misses when nothing is in range', () => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    expect(world.raycast(vec3(0, 10, 0), vec3(0, 1, 0), 20, SOLID_MASK)).toBeNull();
    expect(world.raycast(vec3(0, 10, 0), vec3(0, -1, 0), 5, SOLID_MASK)).toBeNull();
    expect(world.raycast(vec3(0, 10, 0), vec3(0, 0, 0), 5, SOLID_MASK)).toBeNull();
  });

  it('raycast hits spheres, capsules and ramps', () => {
    const world = createKinematicWorld();
    world.addCollider({
      shape: { kind: 'sphere', radius: 1 },
      position: vec3(0, 0, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'capsule', radius: 0.5, halfHeight: 1 },
      position: vec3(5, 0, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'ramp', halfExtents: vec3(2, 1, 2), slope: 0.5 },
      position: vec3(10, 0, 0),
      layer: Layer.Terrain,
    });
    const sphere = world.raycast(vec3(0, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(sphere?.distance).toBeCloseTo(5, 6);
    const capsule = world.raycast(vec3(5, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(capsule?.distance).toBeCloseTo(4.5, 6);
    // The ramp's surface at local z = 0 sits at y = 0.
    const ramp = world.raycast(vec3(10, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(ramp?.distance).toBeCloseTo(6, 6);
    expect(ramp?.normal.y).toBeCloseTo(1 / Math.sqrt(1.25), 6);
  });

  it('sweepSphere returns the closest hit and misses cleanly', () => {
    const world = createKinematicWorld();
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(1, 1, 1) },
      position: vec3(6, 0, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(1, 1, 1) },
      position: vec3(12, 0, 0),
      layer: Layer.Terrain,
    });
    const hit = world.sweepSphere(vec3(0, 0, 0), vec3(1, 0, 0), 0.5, 20, SOLID_MASK);
    expect(hit).not.toBeNull();
    expect(hit?.normal.x).toBeCloseTo(-1, 4);
    expect((hit?.time ?? 0) * 20).toBeCloseTo(4.5, 3);
    expect(hit?.point.x).toBeCloseTo(5, 3);
    expect(world.sweepSphere(vec3(0, 8, 0), vec3(1, 0, 0), 0.5, 20, SOLID_MASK)).toBeNull();
    expect(world.sweepSphere(vec3(0, 0, 0), vec3(1, 0, 0), 0.5, 2, SOLID_MASK)).toBeNull();
  });

  it('overlapSphere finds colliders in range and honours the mask', () => {
    const world = createKinematicWorld();
    const near = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(1, 1, 1) },
      position: vec3(0, 0, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'sphere', radius: 1 },
      position: vec3(20, 0, 0),
      layer: Layer.Terrain,
    });
    const enemy = world.addCollider({
      shape: { kind: 'sphere', radius: 1 },
      position: vec3(2.5, 0, 0),
      layer: Layer.Enemy,
    });
    const solids = world.overlapSphere(vec3(0, 0, 0), 1.5, SOLID_MASK);
    expect(solids).toHaveLength(1);
    expect(solids[0]).toBe(near);
    const all = world.overlapSphere(vec3(0, 0, 0), 1.6, SOLID_MASK | Layer.Enemy);
    expect(all).toContain(enemy);
    expect(world.overlapSphere(vec3(0, 40, 0), 1, SOLID_MASK)).toHaveLength(0);
  });

  it('setColliderTransform moves a body and updates the broadphase', () => {
    const world = createKinematicWorld();
    const box = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(1, 1, 1) },
      position: vec3(40, 0, 0),
      layer: Layer.Terrain,
    });
    expect(world.raycast(vec3(0, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK)).toBeNull();
    world.setColliderTransform(box, vec3(0, 0, 0), Math.PI / 4);
    const hit = world.raycast(vec3(0, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK);
    expect(hit?.collider).toBe(box);
    expect(hit?.distance).toBeCloseTo(5, 6);
    expect(box.descriptor.position.x).toBe(0);
    expect(box.descriptor.yaw).toBeCloseTo(Math.PI / 4, 9);
    world.setColliderTransform(box, vec3(40, 0, 0));
    expect(world.raycast(vec3(0, 6, 0), vec3(0, -1, 0), 20, SOLID_MASK)).toBeNull();
  });

  it('carries a rider along on a moving platform', () => {
    const world = createKinematicWorld();
    const platform = world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(3, 0.5, 3) },
      position: vec3(0, -0.5, 0),
      layer: Layer.MovingPlatform,
    });
    let position = vec3(0, HALF_BODY, 0);
    for (let step = 0; step < 30; step++) {
      world.setColliderTransform(platform, vec3(0, -0.5 + step * 0.02, 0));
      const result = world.moveCharacter({
        position,
        velocity: vec3(0, -2, 0),
        radius: RADIUS,
        height: HEIGHT,
        deltaSeconds: DT,
        mask: SOLID_MASK,
        maxSlopeRadians: MAX_SLOPE,
        stepHeight: STEP_HEIGHT,
        snapToGround: true,
      });
      position = vec3(result.position.x, result.position.y, result.position.z);
      expect(result.grounded).toBe(true);
    }
    // The platform top rose to 0.58, and the rider was pushed up with it.
    expect(position.y).toBeCloseTo(0.58 + HALF_BODY, 2);
  });
});

describe('determinism and broadphase', () => {
  const buildStage = (): PhysicsWorld => {
    const world = createKinematicWorld();
    addFloor(world, 0);
    world.addCollider({
      shape: { kind: 'box', halfExtents: vec3(0.5, 3, 6) },
      position: vec3(4, 3, 0),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'ramp', halfExtents: vec3(2, 1, 2), slope: 0.5 },
      position: vec3(0, 1, 6),
      layer: Layer.Terrain,
    });
    world.addCollider({
      shape: { kind: 'sphere', radius: 1 },
      position: vec3(-3, 0.5, 2),
      layer: Layer.Terrain,
    });
    return world;
  };

  const scripted = (step: number): { x: number; z: number } => {
    const t = step * DT;
    return { x: 6 * Math.cos(t * 2.3), z: 5 * Math.sin(t * 1.7) };
  };

  it('replays a move sequence bit-identically', () => {
    const run = (): Vec3[] => {
      const world = buildStage();
      const trace: Vec3[] = [];
      simulate(world, vec3(0, HALF_BODY, 0), {
        steps: 120,
        move: scripted,
        jump: (step) => (step === 20 || step === 70 ? 11 : undefined),
        onStep: (_step, position) => {
          trace.push(vec3(position.x, position.y, position.z));
        },
      });
      return trace;
    };
    const a = run();
    const b = run();
    expect(a).toHaveLength(120);
    for (let i = 0; i < a.length; i++) {
      const pa = a[i];
      const pb = b[i];
      expect(pa).toBeDefined();
      expect(pb).toBeDefined();
      if (pa === undefined || pb === undefined) continue;
      expect(pb.x).toBe(pa.x);
      expect(pb.y).toBe(pa.y);
      expect(pb.z).toBe(pa.z);
    }
    // The body actually went somewhere interesting.
    const last = a[a.length - 1];
    expect(last?.z).not.toBe(0);
  });

  it('keeps narrowphase work far below the collider count on a big stage', () => {
    const world = createKinematicWorld();
    addFloor(world, 0, 80);
    for (let i = 0; i < 400; i++) {
      const gx = (i % 20) - 10;
      const gz = Math.floor(i / 20) - 10;
      world.addCollider({
        shape: { kind: 'box', halfExtents: vec3(0.5, 1, 0.5) },
        position: vec3(gx * 6 + 3, 1, gz * 6 + 3),
        layer: Layer.Terrain,
      });
    }
    expect(world.stats.colliderCount).toBe(401);
    const result = world.moveCharacter({
      position: vec3(0, HALF_BODY, 0),
      velocity: vec3(4, -1, 4),
      radius: RADIUS,
      height: HEIGHT,
      deltaSeconds: DT,
      mask: SOLID_MASK,
      maxSlopeRadians: MAX_SLOPE,
      stepHeight: STEP_HEIGHT,
      snapToGround: true,
    });
    expect(result.grounded).toBe(true);
    expect(world.stats.lastQueryCount).toBeGreaterThan(0);
    expect(world.stats.lastQueryCount).toBeLessThan(401);
  });
});
