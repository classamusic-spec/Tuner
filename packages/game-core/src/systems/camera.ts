import { clamp, clamp01, damp, dampAngle, moveTowardsAngle, vec3, wrapAngle } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import { Layer, type PhysicsWorld } from '@tuner/physics';
import type { CameraConfig } from '../config.js';
import type { CameraIntent } from '../state.js';
import type { System } from '../internal/context.js';

/**
 * Camera intent and resolution.
 *
 * The simulation decides *what* should be in frame; `resolveCameraTransform`
 * turns that into a concrete position, look-at point and field of view. Keeping
 * the resolver a pure function in `game-core` rather than in the renderer means
 * the camera is unit-testable and behaves identically on every platform — and
 * camera behaviour is one of the two things (with movement) that decides whether
 * a 3D platformer is playable at all.
 */

/** Hard ceiling on how far the camera may swing in one step, in radians.
 *  Sudden rotation is the main cause of motion sickness, so it is capped even
 *  when the player yanks the stick. */
const MAX_YAW_STEP = 0.16;
const MAX_YAW_STEP_REDUCED = 0.08;

/** Extra distance pulled out per metre of separation in lock-on framing. */
const LOCK_ON_SPREAD = 0.35;

/** Minimum distance the boss framing will pull back to. */
const BOSS_FRAME_PADDING = 4.5;

export const cameraSystem: System = (ctx): void => {
  const { world, camera, movement, accessibility } = ctx;
  const player = world.player;
  const intent = world.camera;

  // Scripted shots own the camera until they expire.
  if (intent.scriptedRemaining > 0) {
    intent.scriptedRemaining = Math.max(0, intent.scriptedRemaining - ctx.rawDt);
    if (intent.scriptedRemaining === 0 && (intent.mode === 'vista' || intent.mode === 'cinematic')) {
      intent.mode = 'follow';
      intent.secondaryFocus = null;
    }
  }

  const scripted = intent.scriptedRemaining > 0 && (intent.mode === 'vista' || intent.mode === 'cinematic');

  if (!scripted) {
    const boss = world.boss;
    if (boss && !boss.defeated) {
      // Boss framing has to guarantee both combatants and the arena stay
      // visible, so it overrides lock-on rather than competing with it.
      intent.mode = 'boss';
      intent.focus.x = (player.position.x + boss.position.x) * 0.5;
      intent.focus.y = (player.position.y + boss.position.y) * 0.5 + camera.heightOffset;
      intent.focus.z = (player.position.z + boss.position.z) * 0.5;
      intent.secondaryFocus = { ...boss.position };
      const separation = Math.hypot(
        player.position.x - boss.position.x,
        player.position.z - boss.position.z,
      );
      const arena = ctx.content.bosses[boss.definitionId]?.arenaRadius ?? 12;
      intent.desiredDistance = clamp(
        Math.max(separation + BOSS_FRAME_PADDING, arena * 0.85),
        camera.distance,
        camera.maxDistance * 1.6,
      );
    } else if (player.lockedTarget !== null) {
      const target = ctx.services.findEnemy(player.lockedTarget);
      if (target) {
        intent.mode = 'lockOn';
        intent.focus.x = player.position.x;
        intent.focus.y = player.position.y + camera.heightOffset;
        intent.focus.z = player.position.z;
        intent.secondaryFocus = { ...target.position };
        const separation = Math.hypot(
          player.position.x - target.position.x,
          player.position.z - target.position.z,
        );
        intent.desiredDistance = clamp(
          camera.distance + separation * LOCK_ON_SPREAD,
          camera.minDistance,
          camera.maxDistance,
        );
      } else {
        intent.mode = 'follow';
        intent.secondaryFocus = null;
      }
    } else {
      intent.mode = 'follow';
      intent.secondaryFocus = null;
      intent.focus.x = player.position.x;
      intent.focus.y = player.position.y + camera.heightOffset;
      intent.focus.z = player.position.z;
      intent.desiredDistance = camera.distance;
    }
  }

  // Speed-based field of view. Reduced motion zeroes it entirely — a widening
  // lens is exactly the effect that provokes discomfort.
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  const speedRatio = clamp01(speed / Math.max(1, movement.flowSpeedThreshold));
  intent.fovBoost = accessibility.reducedMotion ? 0 : camera.speedFovBoost * speedRatio;

  // Shake decays toward zero; services set it.
  if (accessibility.reducedMotion || accessibility.screenShakeScale <= 0) {
    intent.shake = 0;
  } else if (intent.shake > 0) {
    intent.shake = Math.max(0, intent.shake - ctx.rawDt * 4);
  }
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface CameraState {
  /** Orbit yaw, radians. */
  yaw: number;
  /** Orbit pitch, radians. Negative looks down. */
  pitch: number;
  /** Smoothed look-at point. */
  readonly lookAt: Vec3;
  /** Resolved camera position. */
  readonly position: Vec3;
  distance: number;
  fov: number;
  /** Seconds since the player last moved the camera. */
  idleSeconds: number;
}

export function createCameraState(config: CameraConfig): CameraState {
  return {
    yaw: 0,
    pitch: -0.34,
    lookAt: vec3(),
    position: vec3(0, 2, config.distance),
    distance: config.distance,
    fov: config.baseFov,
    idleSeconds: 0,
  };
}

export interface CameraResolveInput {
  readonly intent: CameraIntent;
  readonly config: CameraConfig;
  readonly physics: PhysicsWorld;
  readonly state: CameraState;
  readonly dt: number;
  /** Look delta this frame, in radians. */
  readonly lookX: number;
  readonly lookY: number;
  /** Written by the movement system; used for landing look-ahead. */
  readonly playerAirborne: boolean;
  readonly playerFallSpeed: number;
  readonly reducedMotion: boolean;
  readonly screenShakeScale: number;
  /** Deterministic shake source. */
  readonly tick: number;
}

/**
 * Turns intent into a concrete transform.
 *
 * Mutates and returns `state`, so the caller keeps one camera across frames
 * rather than allocating per frame.
 */
export function resolveCameraTransform(input: CameraResolveInput): CameraState {
  const { intent, config, physics, state, dt, reducedMotion } = input;

  const hasLookInput = Math.abs(input.lookX) > 1e-4 || Math.abs(input.lookY) > 1e-4;

  // Manual look, clamped per step so the camera cannot whip around.
  const maxStep = reducedMotion ? MAX_YAW_STEP_REDUCED : MAX_YAW_STEP;
  if (hasLookInput) {
    state.idleSeconds = 0;
    state.yaw = wrapAngle(state.yaw + clamp(input.lookX, -maxStep, maxStep));
    state.pitch = clamp(state.pitch + clamp(input.lookY, -maxStep, maxStep), config.minPitch, config.maxPitch);
  } else {
    state.idleSeconds += dt;
  }

  // Auto-recentre, but only after the delay — and any look input above has
  // already reset the timer, so it can never fight the player.
  if (
    !hasLookInput &&
    state.idleSeconds > config.autoRecentreDelay &&
    intent.desiredYaw !== null
  ) {
    const speed = (reducedMotion ? config.autoRecentreSpeed * 0.5 : config.autoRecentreSpeed) * dt;
    state.yaw = moveTowardsAngle(state.yaw, intent.desiredYaw, Math.min(speed, maxStep));
  }

  // Scripted shots may demand an angle outright.
  if (intent.mode === 'vista' || intent.mode === 'cinematic') {
    if (intent.desiredYaw !== null) {
      state.yaw = dampAngle(state.yaw, intent.desiredYaw, config.rotationSmoothing, dt);
    }
    if (intent.desiredPitch !== null) {
      state.pitch = damp(state.pitch, intent.desiredPitch, config.rotationSmoothing, dt);
    }
  }

  // Look-at point, smoothed. While airborne and descending, bias it downward so
  // the landing zone stays on screen — the single most important camera
  // behaviour in a 3D platformer.
  let targetY = intent.focus.y;
  if (input.playerAirborne && input.playerFallSpeed < -1) {
    const bias = config.landingLookAhead * clamp01(-input.playerFallSpeed / 20);
    targetY -= bias * 2.5;
  }

  state.lookAt.x = damp(state.lookAt.x, intent.focus.x, config.positionSmoothing, dt);
  state.lookAt.y = damp(state.lookAt.y, targetY, config.positionSmoothing, dt);
  state.lookAt.z = damp(state.lookAt.z, intent.focus.z, config.positionSmoothing, dt);

  // Desired orbit position.
  const wanted = clamp(intent.desiredDistance, config.minDistance, config.maxDistance * 1.6);
  const cosPitch = Math.cos(state.pitch);
  const dirX = Math.sin(state.yaw) * cosPitch;
  const dirY = Math.sin(state.pitch);
  const dirZ = Math.cos(state.yaw) * cosPitch;

  // Collision: sphere-cast from the focus outward and pull in to the first
  // blocking hit, so the camera never ends up inside geometry.
  let allowed = wanted;
  const hit = physics.sweepSphere(
    state.lookAt,
    { x: -dirX, y: -dirY, z: -dirZ },
    config.collisionRadius,
    wanted,
    Layer.Terrain | Layer.CameraBlocker | Layer.MovingPlatform,
  );
  if (hit) {
    allowed = Math.max(config.minDistance, wanted * hit.time - config.collisionRadius * 0.5);
  }

  // Pull in immediately, ease back out — snapping outward reveals geometry pops.
  state.distance =
    allowed < state.distance
      ? allowed
      : damp(state.distance, allowed, config.positionSmoothing, dt);

  state.position.x = state.lookAt.x - dirX * state.distance;
  state.position.y = state.lookAt.y - dirY * state.distance;
  state.position.z = state.lookAt.z - dirZ * state.distance;

  // Deterministic shake, derived from the tick rather than from randomness so a
  // replay reproduces the same frames.
  const shakeScale = reducedMotion ? 0 : input.screenShakeScale * config.shakeScale;
  if (intent.shake > 0 && shakeScale > 0) {
    const magnitude = intent.shake * shakeScale * 0.25;
    state.position.x += hashNoise(input.tick, 1) * magnitude;
    state.position.y += hashNoise(input.tick, 2) * magnitude;
    state.position.z += hashNoise(input.tick, 3) * magnitude;
  }

  const targetFov = config.baseFov + (reducedMotion ? 0 : intent.fovBoost);
  state.fov = damp(state.fov, targetFov, config.fovSmoothing, dt);

  return state;
}

/** Deterministic noise in [-1, 1] from an integer tick and channel. */
function hashNoise(tick: number, channel: number): number {
  let h = (Math.imul(tick, 0x27d4eb2d) ^ Math.imul(channel, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}
