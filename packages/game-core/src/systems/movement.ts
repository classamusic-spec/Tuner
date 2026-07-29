import {
  GRAVITY,
  DEG2RAD,
  clamp,
  clamp01,
  copy,
  moveTowards,
  moveTowardsAngle,
  set,
  vec3,
} from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import { Layer, SOLID_MASK } from '@tuner/physics';
import type { MovementState } from '../state.js';
import type { SimContext, System } from '../internal/context.js';
import type { MutablePlayer } from '../internal/world.js';
import type { RailDef } from '../content-types.js';

/**
 * Player movement.
 *
 * This is the system that decides how the game feels, so every number it reads
 * comes from `MovementConfig` (`ctx.movement`) rather than from a literal here.
 * The handful of module constants below are shape/threshold decisions rather
 * than feel knobs, and each is documented where it is declared.
 *
 * Conventions used throughout:
 *
 * - `player.position` is the **feet** of the capsule. `CameraConfig.heightOffset`
 *   is documented as "height of the look-at point above the player's feet", and
 *   stage spawn points sit on the floor, so the head is at
 *   `position.y + movement.bodyHeight`.
 * - Yaw is a rotation about +Y, and a yaw of zero faces -Z. Consequently
 *   `forward(yaw) = (-sin yaw, 0, -cos yaw)` and `right(yaw) = (cos yaw, 0, -sin yaw)`.
 *   `ctx.cameraYaw` uses the same convention, which is what makes "forward"
 *   mean "away from the camera".
 * - Gravity is `GRAVITY` from `@tuner/shared` (negative, -32 m/s^2). Jump
 *   velocities are derived from it: `v = sqrt(2 * g * h)`.
 *
 * Allocation: the step path reuses module-level scratch vectors and a single
 * reusable `CharacterMoveParams` object. The only allocations are event
 * payloads (which are rare, and whose `Vec3`s outlive the step because
 * listeners may retain them) and the ledge-grab target.
 */

// ---------------------------------------------------------------------------
// Shape constants
// ---------------------------------------------------------------------------

/** A full refresh grants the ground jump plus one mid-air jump. */
export const MAX_JUMPS = 2;

/** Stick magnitude below which the stick counts as centred. */
export const MOVE_EPSILON = 0.02;

/** Stick magnitude at which the walk tier hands over to the run tier. */
export const RUN_STICK_THRESHOLD = 0.55;

/**
 * Sprint rule (the documented choice from the two offered):
 *
 * **Sprint engages while the dash button is held**, not above a high stick
 * magnitude. Keyboards produce a digital stick — magnitude is always 1 — so a
 * magnitude threshold would lock every keyboard player into a permanent
 * sprint and delete the walk/run tiers for them. Holding the same button that
 * dashes reads as "commit to speed" on every device.
 *
 * A *tap* dashes; a *hold* past this threshold sprints, so the two never fight
 * over one press.
 */
export const SPRINT_HOLD_SECONDS = 0.12;

/** |normal.y| below this counts as a near-vertical (clingable) wall. */
export const WALL_MAX_NORMAL_Y = 0.35;

/** How hard the stick must push into a wall before a cling or ledge grab engages. */
export const WALL_PUSH_DOT = 0.25;

/** Seconds the player hangs on a ledge before the mantle animation starts. */
export const LEDGE_HANG_SECONDS = 0.06;

/** Cooldown after leaving a rail, so the stage system cannot re-attach instantly. */
export const RAIL_DETACH_COOLDOWN_SECONDS = 0.35;

/** Gravity multiplier while submerged, before buoyancy is added. */
export const WATER_GRAVITY_SCALE = 0.15;

/** Fraction of ground acceleration available while swimming. */
export const SWIM_ACCELERATION_SCALE = 0.45;

/** How far ahead the landing assist predicts the touchdown point, in seconds. */
export const LANDING_ASSIST_LOOKAHEAD_SECONDS = 0.35;

/** Lateral/longitudinal spread of the landing-assist probes, in metres. */
export const LANDING_ASSIST_PROBE_OFFSET = 2;

/** How deep the landing-assist probes look for a floor, in metres. */
export const LANDING_ASSIST_PROBE_DEPTH = 14;

/** Peak sideways acceleration the landing assist may apply, in m/s^2. */
export const LANDING_ASSIST_ACCELERATION = 18;

/** Layers the player capsule collides with. */
export const PLAYER_MOVE_MASK = SOLID_MASK | Layer.Wall | Layer.Bounce;

// ---------------------------------------------------------------------------
// Module scratch — reused every step so the hot loop never allocates
// ---------------------------------------------------------------------------

const DOWN = vec3(0, -1, 0);
const scratchDir = vec3();
const scratchProbe = vec3();
const scratchRailPos = vec3();
const scratchRailTangent = vec3();

const moveParams = {
  position: vec3(),
  velocity: vec3(),
  radius: 0,
  height: 0,
  deltaSeconds: 0,
  mask: PLAYER_MOVE_MASK,
  maxSlopeRadians: 0,
  stepHeight: 0,
  snapToGround: true,
};

/** What kind of jump fired this step, for state resolution. */
const enum JumpKind {
  None = 0,
  Ground = 1,
  Double = 2,
  Wall = 3,
}

/** Per-step flags, kept module-level so the step never allocates a struct. */
const step = {
  clinging: false,
  bounced: false,
  jump: JumpKind.None,
  controllable: true,
  dashStartedAirborne: false,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Launch velocity that reaches `height` under `GRAVITY`: v = sqrt(2gh). */
export function jumpVelocityForHeight(height: number): number {
  return Math.sqrt(2 * Math.abs(GRAVITY) * Math.max(0, height));
}

/**
 * Rotates a stick reading into world space around `cameraYaw`, so +moveY is
 * always "away from the camera".
 */
export function cameraRelativeMoveInto(
  target: Vec3,
  moveX: number,
  moveY: number,
  cameraYaw: number,
): Vec3 {
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  // right   = ( cos yaw, 0, -sin yaw)
  // forward = (-sin yaw, 0, -cos yaw)
  target.x = moveX * c - moveY * s;
  target.y = 0;
  target.z = -moveX * s - moveY * c;
  return target;
}

/** Yaw that faces the given horizontal direction, matching the -Z convention. */
export function yawForDirection(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Writes the unit facing direction for a yaw. */
export function facingDirectionInto(target: Vec3, yaw: number): Vec3 {
  target.x = -Math.sin(yaw);
  target.y = 0;
  target.z = -Math.cos(yaw);
  return target;
}

/**
 * Speed tier from analogue magnitude.
 *
 * A light tilt walks, a firm tilt runs, and sprint is a separate opt-in (see
 * {@link SPRINT_HOLD_SECONDS}).
 */
export function targetSpeedFor(
  config: { walkSpeed: number; runSpeed: number; sprintSpeed: number },
  magnitude: number,
  sprinting: boolean,
): number {
  const mag = clamp01(magnitude);
  if (mag <= MOVE_EPSILON) return 0;
  if (sprinting) return config.sprintSpeed * mag;
  if (mag <= RUN_STICK_THRESHOLD) {
    return config.walkSpeed * (mag / RUN_STICK_THRESHOLD);
  }
  const t = (mag - RUN_STICK_THRESHOLD) / (1 - RUN_STICK_THRESHOLD);
  return config.walkSpeed + (config.runSpeed - config.walkSpeed) * clamp01(t);
}

/** Total coyote window: config plus accessibility plus difficulty generosity. */
export function coyoteWindowSeconds(ctx: SimContext): number {
  return Math.max(
    0,
    ctx.movement.coyoteSeconds +
      ctx.accessibility.extraCoyoteSeconds +
      ctx.difficultyProfile.coyoteBonus,
  );
}

/** Combined landing-assist strength in [0, 1]. Zero means "do nothing at all". */
export function landingAssistStrength(ctx: SimContext): number {
  return clamp01(ctx.accessibility.landingAssist + ctx.difficultyProfile.landingAssist);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setState(ctx: SimContext, next: MovementState): void {
  const player = ctx.world.player;
  if (player.movementState === next) return;
  const from = player.movementState;
  player.previousMovementState = from;
  player.movementState = next;
  player.stateTime = 0;
  ctx.events.emit('player:stateChanged', {
    from,
    to: next,
    position: { x: player.position.x, y: player.position.y, z: player.position.z },
  });
}

/** Applies the state change, advances timers that every branch shares. */
function finalise(ctx: SimContext, next: MovementState): void {
  const player = ctx.world.player;
  setState(ctx, next);
  player.stateTime += ctx.dt;
  player.yaw = moveTowardsAngle(
    player.yaw,
    player.targetYaw,
    ctx.movement.turnSpeedRadians * ctx.dt,
  );
  const horizontalSpeed = Math.sqrt(
    player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z,
  );
  if (horizontalSpeed >= ctx.movement.flowSpeedThreshold) {
    player.flowSeconds += ctx.dt;
  }
}

/** Refreshes the air options granted by touching ground, a wall or water. */
function refreshAirOptions(ctx: SimContext): void {
  const player = ctx.world.player;
  player.jumpsRemaining = MAX_JUMPS;
  player.dashesRemaining = ctx.movement.airDashCount;
}

function setWallNormal(player: MutablePlayer, normal: Vec3): void {
  if (player.wallNormal === null) {
    player.wallNormal = vec3(normal.x, normal.y, normal.z);
  } else {
    copy(player.wallNormal, normal);
  }
}

/**
 * True when the player currently owns their own body: not paused-out, not
 * downed, and not inside a cutscene that took control away.
 */
function isPlayerControlled(ctx: SimContext): boolean {
  const player = ctx.world.player;
  if (player.movementState === 'downed') return false;
  const cutsceneId = ctx.world.cutsceneId;
  if (cutsceneId === null) return true;
  const stageDef = ctx.stageDef;
  if (stageDef === null) return false;
  for (const cutscene of stageDef.cutscenes) {
    if (cutscene.id === cutsceneId) return cutscene.playerControlled === true;
  }
  return false;
}

function findRail(ctx: SimContext, railId: string): RailDef | null {
  const stageDef = ctx.stageDef;
  if (stageDef === null) return null;
  for (const rail of stageDef.rails) {
    if (rail.id === railId) return rail;
  }
  return null;
}

/**
 * Samples a rail polyline. Writes position and unit tangent, returns the rail's
 * total length, or -1 when the rail is unusable.
 */
export function sampleRail(
  points: readonly Vec3[],
  progress: number,
  outPosition: Vec3,
  outTangent: Vec3,
): number {
  if (points.length < 2) return -1;

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) return -1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  if (total < 1e-6) return -1;

  let remaining = clamp01(progress) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) return -1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const segment = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (segment < 1e-9) continue;
    if (remaining <= segment || i === points.length - 1) {
      const t = clamp01(remaining / segment);
      outPosition.x = a.x + dx * t;
      outPosition.y = a.y + dy * t;
      outPosition.z = a.z + dz * t;
      outTangent.x = dx / segment;
      outTangent.y = dy / segment;
      outTangent.z = dz / segment;
      return total;
    }
    remaining -= segment;
  }
  return total;
}

/**
 * Gentle mid-air correction toward ground the player is about to miss.
 *
 * At strength zero this returns before issuing a single query, so it is exactly
 * a no-op — assist off must cost nothing and change nothing.
 */
function applyLandingAssist(ctx: SimContext, strength: number): void {
  if (strength <= 0) return;

  const player = ctx.world.player;
  const vx = player.velocity.x;
  const vz = player.velocity.z;
  const speed = Math.sqrt(vx * vx + vz * vz);
  if (speed < 0.5) return;

  const fx = vx / speed;
  const fz = vz / speed;
  // Right-hand perpendicular in the XZ plane.
  const rx = -fz;
  const rz = fx;

  const baseX = player.position.x + vx * LANDING_ASSIST_LOOKAHEAD_SECONDS;
  const baseZ = player.position.z + vz * LANDING_ASSIST_LOOKAHEAD_SECONDS;
  const probeY = player.position.y + ctx.movement.bodyHeight;

  set(scratchProbe, baseX, probeY, baseZ);
  if (
    ctx.physics.raycast(scratchProbe, DOWN, LANDING_ASSIST_PROBE_DEPTH, PLAYER_MOVE_MASK, null) !==
    null
  ) {
    // Already headed for solid ground; nothing to correct.
    return;
  }

  let steerX = 0;
  let steerZ = 0;

  const offset = LANDING_ASSIST_PROBE_OFFSET;
  set(scratchProbe, baseX - fx * offset, probeY, baseZ - fz * offset);
  if (
    ctx.physics.raycast(scratchProbe, DOWN, LANDING_ASSIST_PROBE_DEPTH, PLAYER_MOVE_MASK, null) !==
    null
  ) {
    steerX = -fx;
    steerZ = -fz;
  } else {
    set(scratchProbe, baseX + rx * offset, probeY, baseZ + rz * offset);
    if (
      ctx.physics.raycast(scratchProbe, DOWN, LANDING_ASSIST_PROBE_DEPTH, PLAYER_MOVE_MASK, null) !==
      null
    ) {
      steerX = rx;
      steerZ = rz;
    } else {
      set(scratchProbe, baseX - rx * offset, probeY, baseZ - rz * offset);
      if (
        ctx.physics.raycast(
          scratchProbe,
          DOWN,
          LANDING_ASSIST_PROBE_DEPTH,
          PLAYER_MOVE_MASK,
          null,
        ) !== null
      ) {
        steerX = -rx;
        steerZ = -rz;
      }
    }
  }

  if (steerX === 0 && steerZ === 0) return;
  const magnitude = Math.sqrt(steerX * steerX + steerZ * steerZ);
  const delta = strength * LANDING_ASSIST_ACCELERATION * ctx.dt;
  player.velocity.x += (steerX / magnitude) * delta;
  player.velocity.z += (steerZ / magnitude) * delta;
}

/**
 * Looks for a grabbable ledge on the wall the player is pressed against.
 * Returns the world position to mantle onto, or null.
 */
function findLedgeTarget(ctx: SimContext, wallNormal: Vec3): Vec3 | null {
  const player = ctx.world.player;
  const movement = ctx.movement;

  // "Into the wall" is the opposite of its normal, flattened to the XZ plane.
  const intoX = -wallNormal.x;
  const intoZ = -wallNormal.z;
  const intoLength = Math.sqrt(intoX * intoX + intoZ * intoZ);
  if (intoLength < 1e-4) return null;
  const ux = intoX / intoLength;
  const uz = intoZ / intoLength;

  const headY = player.position.y + movement.bodyHeight;
  const originY = headY + movement.ledgeGrabReach + 0.05;
  const originX = player.position.x + ux * (movement.bodyRadius + 0.3);
  const originZ = player.position.z + uz * (movement.bodyRadius + 0.3);

  set(scratchProbe, originX, originY, originZ);
  const hit = ctx.physics.raycast(
    scratchProbe,
    DOWN,
    movement.ledgeGrabReach + movement.bodyHeight * 0.7,
    PLAYER_MOVE_MASK,
    null,
  );
  if (hit === null) return null;
  // Only a walkable top edge counts as a ledge.
  if (hit.normal.y < 0.6) return null;

  const topY = hit.point.y;
  if (topY > headY + movement.ledgeGrabReach + 1e-3) return null;
  if (topY < player.position.y + movement.bodyHeight * 0.4) return null;

  return {
    x: hit.point.x + ux * (movement.bodyRadius * 0.5),
    y: topY,
    z: hit.point.z + uz * (movement.bodyRadius * 0.5),
  };
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export const movementSystem: System = (ctx: SimContext): void => {
  const world = ctx.world;
  const player = world.player;
  const movement = ctx.movement;
  const dt = ctx.dt;

  if (world.paused || dt <= 0) return;

  step.clinging = false;
  step.bounced = false;
  step.jump = JumpKind.None;
  step.dashStartedAirborne = false;

  player.wasGrounded = player.grounded;

  // -- timers ---------------------------------------------------------------
  const coyoteTotal = coyoteWindowSeconds(ctx);
  if (player.grounded) {
    player.coyoteRemaining = coyoteTotal;
  } else if (player.coyoteRemaining > 0) {
    player.coyoteRemaining = Math.max(0, player.coyoteRemaining - dt);
    if (player.coyoteRemaining <= 0) {
      // Walking off a ledge spends the ground jump; only the air jump is left.
      player.jumpsRemaining = Math.max(0, player.jumpsRemaining - 1);
    }
  }
  player.jumpBufferRemaining = Math.max(0, player.jumpBufferRemaining - dt);
  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  player.dashTimeRemaining = Math.max(0, player.dashTimeRemaining - dt);
  player.slideTimeRemaining = Math.max(0, player.slideTimeRemaining - dt);
  player.inputLockRemaining = Math.max(0, player.inputLockRemaining - dt);
  player.railCooldown = Math.max(0, player.railCooldown - dt);

  // -- input ----------------------------------------------------------------
  const controllable = isPlayerControlled(ctx);
  step.controllable = controllable;

  const jumpButton = ctx.input.buttons.jump;
  const dashButton = ctx.input.buttons.dash;
  const slideButton = ctx.input.buttons.slide;

  const jumpPressed = controllable && jumpButton.pressed;
  const jumpDown = controllable && jumpButton.down;
  const dashPressed = controllable && dashButton.pressed;
  const slideDown = controllable && slideButton.down;
  const slidePressed = controllable && slideButton.pressed;
  const sprintHeld =
    controllable && dashButton.down && dashButton.heldSeconds >= SPRINT_HOLD_SECONDS;

  if (jumpPressed) player.jumpBufferRemaining = movement.jumpBufferSeconds;
  if (!jumpDown) player.jumpHeld = false;

  let moveX = controllable ? ctx.input.moveX : 0;
  let moveY = controllable ? ctx.input.moveY : 0;
  // The input lock exists so a wall jump's push-off cannot be steered away.
  if (player.inputLockRemaining > 0) {
    moveX = 0;
    moveY = 0;
  }
  let magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
    magnitude = 1;
  }
  cameraRelativeMoveInto(scratchDir, moveX, moveY, ctx.cameraYaw);
  let dirX = 0;
  let dirZ = 0;
  if (magnitude > MOVE_EPSILON) {
    dirX = scratchDir.x / magnitude;
    dirZ = scratchDir.z / magnitude;
    player.targetYaw = yawForDirection(dirX, dirZ);
  }

  // -- mantle: fully kinematic, owns the whole step -------------------------
  const ledgeTarget = player.ledgeTarget;
  if (player.mantleRemaining > 0 && ledgeTarget !== null) {
    if (player.mantleRemaining > movement.mantleSeconds) {
      // Hanging on the edge before the pull-up begins.
      player.mantleRemaining -= dt;
      set(player.velocity, 0, 0, 0);
      finalise(ctx, 'ledgeGrab');
      return;
    }
    if (player.mantleRemaining <= dt) {
      copy(player.position, ledgeTarget);
      player.mantleRemaining = 0;
      player.ledgeTarget = null;
      player.grounded = true;
      player.wallNormal = null;
      player.touchingWall = false;
      set(player.velocity, 0, 0, 0);
      refreshAirOptions(ctx);
      player.coyoteRemaining = coyoteTotal;
      player.wallClingRemaining = movement.wallClingSeconds;
      finalise(ctx, 'idle');
      return;
    }
    const t = clamp01(dt / player.mantleRemaining);
    player.position.x += (ledgeTarget.x - player.position.x) * t;
    player.position.y += (ledgeTarget.y - player.position.y) * t;
    player.position.z += (ledgeTarget.z - player.position.z) * t;
    player.mantleRemaining -= dt;
    set(player.velocity, 0, 0, 0);
    finalise(ctx, 'mantle');
    return;
  }

  // -- rail grinding: also kinematic ---------------------------------------
  const railId = player.railId;
  if (railId !== null) {
    const rail = findRail(ctx, railId);
    if (rail === null) {
      player.railId = null;
    } else {
      const jumpingOff = player.jumpBufferRemaining > 0 && controllable;
      const total = sampleRail(rail.points, player.railProgress, scratchRailPos, scratchRailTangent);
      if (total < 0) {
        player.railId = null;
      } else if (jumpingOff) {
        player.railId = null;
        player.railCooldown = RAIL_DETACH_COOLDOWN_SECONDS;
        player.jumpBufferRemaining = 0;
        player.grounded = false;
        player.jumpHeld = true;
        player.jumpsRemaining = Math.max(0, MAX_JUMPS - 1);
        player.dashesRemaining = movement.airDashCount;
        player.velocity.y = jumpVelocityForHeight(movement.jumpHeight);
        const detachPosition = {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        };
        ctx.events.emit('player:railDetached', { railId, position: detachPosition });
        ctx.events.emit('player:jumped', {
          position: { x: detachPosition.x, y: detachPosition.y, z: detachPosition.z },
          doubleJump: false,
          wallJump: false,
        });
        finalise(ctx, 'jump');
        return;
      } else {
        const targetSpeed = rail.speed ?? movement.grindSpeed;
        const currentSpeed = Math.sqrt(
          player.velocity.x * player.velocity.x +
            player.velocity.y * player.velocity.y +
            player.velocity.z * player.velocity.z,
        );
        const speed = moveTowards(
          currentSpeed > 0.01 ? currentSpeed : targetSpeed,
          targetSpeed,
          movement.grindAcceleration * dt,
        );
        player.railProgress += (player.railDirection * speed * dt) / total;
        const finished = player.railProgress <= 0 || player.railProgress >= 1;
        player.railProgress = clamp01(player.railProgress);
        sampleRail(rail.points, player.railProgress, scratchRailPos, scratchRailTangent);
        copy(player.position, scratchRailPos);
        player.velocity.x = scratchRailTangent.x * speed * player.railDirection;
        player.velocity.y = scratchRailTangent.y * speed * player.railDirection;
        player.velocity.z = scratchRailTangent.z * speed * player.railDirection;
        player.grounded = false;
        player.targetYaw = yawForDirection(player.velocity.x, player.velocity.z);
        refreshAirOptions(ctx);
        if (finished) {
          player.railId = null;
          player.railCooldown = RAIL_DETACH_COOLDOWN_SECONDS;
          ctx.events.emit('player:railDetached', {
            railId,
            position: { x: player.position.x, y: player.position.y, z: player.position.z },
          });
        }
        finalise(ctx, 'grind');
        return;
      }
    }
  }

  // -- refreshes granted by standing on the ground --------------------------
  if (player.grounded) {
    refreshAirOptions(ctx);
    player.wallClingRemaining = movement.wallClingSeconds;
    player.wallNormal = null;
  }
  if (player.inWater) {
    refreshAirOptions(ctx);
    player.wallClingRemaining = movement.wallClingSeconds;
  }

  // -- ledge grab -----------------------------------------------------------
  const wallNormal = player.wallNormal;
  const nearVerticalWall =
    player.touchingWall && wallNormal !== null && Math.abs(wallNormal.y) < WALL_MAX_NORMAL_Y;
  const pushingIntoWall =
    nearVerticalWall &&
    wallNormal !== null &&
    magnitude > MOVE_EPSILON &&
    dirX * wallNormal.x + dirZ * wallNormal.z < -WALL_PUSH_DOT;

  if (
    !player.grounded &&
    !player.inWater &&
    pushingIntoWall &&
    wallNormal !== null &&
    player.velocity.y >= -0.05 &&
    player.mantleRemaining <= 0
  ) {
    const target = findLedgeTarget(ctx, wallNormal);
    if (target !== null) {
      player.ledgeTarget = target;
      player.mantleRemaining = movement.mantleSeconds + LEDGE_HANG_SECONDS;
      player.dashTimeRemaining = 0;
      player.slideTimeRemaining = 0;
      player.jumpBufferRemaining = 0;
      set(player.velocity, 0, 0, 0);
      refreshAirOptions(ctx);
      ctx.events.emit('player:ledgeGrabbed', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
      });
      finalise(ctx, 'ledgeGrab');
      return;
    }
  }

  // -- wall cling -----------------------------------------------------------
  if (
    !player.grounded &&
    !player.inWater &&
    pushingIntoWall &&
    wallNormal !== null &&
    player.dashTimeRemaining <= 0 &&
    player.wallClingRemaining > 0 &&
    player.velocity.y <= 0.5
  ) {
    step.clinging = true;
    const wasClinging = player.movementState === 'wallCling';
    player.wallClingRemaining = Math.max(0, player.wallClingRemaining - dt);
    // Wall contact refreshes the double jump and the air dash.
    refreshAirOptions(ctx);
    if (!wasClinging) {
      ctx.events.emit('player:wallCling', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        normal: { x: wallNormal.x, y: wallNormal.y, z: wallNormal.z },
      });
    }
    if (player.wallClingRemaining <= 0) {
      step.clinging = false;
    }
  }

  // -- dash trigger ---------------------------------------------------------
  if (
    dashPressed &&
    !player.inWater &&
    player.dashCooldown <= 0 &&
    player.dashTimeRemaining <= 0 &&
    (player.grounded || player.dashesRemaining > 0)
  ) {
    const airborne = !player.grounded;
    if (airborne) player.dashesRemaining = Math.max(0, player.dashesRemaining - 1);
    // One cooldown covers the burst plus the gap, so "between dashes" is exact.
    player.dashCooldown = movement.dashSeconds + movement.dashCooldownSeconds;
    player.dashTimeRemaining = movement.dashSeconds;
    player.slideTimeRemaining = 0;
    step.clinging = false;
    if (magnitude > MOVE_EPSILON) {
      set(player.dashDirection, dirX, 0, dirZ);
    } else {
      facingDirectionInto(player.dashDirection, player.yaw);
    }
    player.targetYaw = yawForDirection(player.dashDirection.x, player.dashDirection.z);
    ctx.events.emit('player:dashed', {
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      direction: {
        x: player.dashDirection.x,
        y: player.dashDirection.y,
        z: player.dashDirection.z,
      },
      airborne,
    });
  }
  step.dashStartedAirborne = !player.grounded;

  // -- slide trigger --------------------------------------------------------
  const groundSpeed = Math.sqrt(
    player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z,
  );
  if (
    slidePressed &&
    player.grounded &&
    !player.inWater &&
    player.dashTimeRemaining <= 0 &&
    player.slideTimeRemaining <= 0 &&
    groundSpeed >= movement.runSpeed
  ) {
    player.slideTimeRemaining = movement.slideSeconds;
    const boosted = Math.max(groundSpeed, movement.slideSpeed);
    if (groundSpeed > 1e-4) {
      player.velocity.x = (player.velocity.x / groundSpeed) * boosted;
      player.velocity.z = (player.velocity.z / groundSpeed) * boosted;
    }
  }

  // -- vertical -------------------------------------------------------------
  if (player.inWater) {
    let vy = player.velocity.y;
    const swimRate = movement.swimVerticalSpeed * 6 * dt;
    if (jumpDown) {
      vy = moveTowards(vy, movement.swimVerticalSpeed, swimRate);
    } else if (slideDown) {
      vy = moveTowards(vy, -movement.swimVerticalSpeed, swimRate);
    } else {
      vy += (GRAVITY * WATER_GRAVITY_SCALE + movement.buoyancy) * dt;
    }
    player.velocity.y = clamp(vy, -movement.swimVerticalSpeed, movement.swimVerticalSpeed);
  } else if (step.clinging) {
    player.velocity.y = -movement.wallSlideSpeed;
  } else if (player.dashTimeRemaining > 0) {
    player.velocity.y += GRAVITY * movement.dashGravityScale * dt;
  } else if (!player.grounded) {
    let gravity = GRAVITY;
    if (player.velocity.y > 0 && !player.jumpHeld) {
      // Releasing the button early is what makes the jump variable-height.
      gravity *= movement.jumpCutGravityScale;
    } else if (player.velocity.y < 0) {
      gravity *= movement.fallGravityScale;
    }
    player.velocity.y += gravity * dt;
    if (player.velocity.y < -movement.maxFallSpeed) {
      player.velocity.y = -movement.maxFallSpeed;
    }
  } else if (player.velocity.y < 0) {
    player.velocity.y = 0;
  }

  // -- jump -----------------------------------------------------------------
  if (player.jumpBufferRemaining > 0 && controllable) {
    if (step.clinging && wallNormal !== null) {
      const horizontal = Math.sqrt(
        wallNormal.x * wallNormal.x + wallNormal.z * wallNormal.z,
      );
      const nx = horizontal > 1e-4 ? wallNormal.x / horizontal : 0;
      const nz = horizontal > 1e-4 ? wallNormal.z / horizontal : 0;
      player.velocity.x = nx * movement.wallJumpHorizontal;
      player.velocity.z = nz * movement.wallJumpHorizontal;
      player.velocity.y = movement.wallJumpVertical;
      player.inputLockRemaining = movement.wallJumpLockSeconds;
      player.jumpsRemaining = Math.max(0, MAX_JUMPS - 1);
      player.dashesRemaining = movement.airDashCount;
      player.targetYaw = yawForDirection(nx, nz);
      step.jump = JumpKind.Wall;
    } else if (
      (player.grounded || player.coyoteRemaining > 0) &&
      player.jumpsRemaining > 0 &&
      !player.inWater
    ) {
      player.velocity.y = jumpVelocityForHeight(movement.jumpHeight);
      player.jumpsRemaining = Math.max(0, player.jumpsRemaining - 1);
      step.jump = JumpKind.Ground;
    } else if (player.jumpsRemaining > 0 && !player.inWater) {
      player.velocity.y = jumpVelocityForHeight(movement.doubleJumpHeight);
      player.jumpsRemaining = Math.max(0, player.jumpsRemaining - 1);
      step.jump = JumpKind.Double;
    }

    if (step.jump !== JumpKind.None) {
      player.jumpBufferRemaining = 0;
      player.coyoteRemaining = 0;
      player.grounded = false;
      player.jumpHeld = true;
      player.dashTimeRemaining = 0;
      player.slideTimeRemaining = 0;
      step.clinging = false;
      ctx.events.emit('player:jumped', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        doubleJump: step.jump === JumpKind.Double,
        wallJump: step.jump === JumpKind.Wall,
      });
    }
  }

  // -- horizontal -----------------------------------------------------------
  if (player.dashTimeRemaining > 0) {
    player.velocity.x = player.dashDirection.x * movement.dashSpeed;
    player.velocity.z = player.dashDirection.z * movement.dashSpeed;
  } else if (player.slideTimeRemaining > 0) {
    const speed = Math.sqrt(
      player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z,
    );
    const decayed = Math.max(0, speed - movement.slideFriction * dt);
    if (speed > 1e-4) {
      player.velocity.x = (player.velocity.x / speed) * decayed;
      player.velocity.z = (player.velocity.z / speed) * decayed;
    }
    if (decayed < movement.walkSpeed || !player.grounded) {
      player.slideTimeRemaining = 0;
    }
  } else if (step.clinging) {
    player.velocity.x = player.platformVelocity.x;
    player.velocity.z = player.platformVelocity.z;
  } else if (player.inputLockRemaining > 0) {
    // Wall-jump push-off: keep the momentum exactly as launched.
  } else {
    // Everything is computed relative to the platform underfoot so riders do
    // not slide off, and so a platform's motion folds into the player's own
    // momentum the moment they leave it.
    const relX = player.velocity.x - player.platformVelocity.x;
    const relZ = player.velocity.z - player.platformVelocity.z;

    const sprinting =
      sprintHeld &&
      magnitude > MOVE_EPSILON &&
      (player.grounded || Math.sqrt(relX * relX + relZ * relZ) >= movement.runSpeed);

    let targetSpeed: number;
    let rate: number;
    if (player.inWater) {
      targetSpeed = movement.swimSpeed * clamp01(magnitude);
      rate = movement.groundAcceleration * SWIM_ACCELERATION_SCALE;
    } else {
      targetSpeed = targetSpeedFor(movement, magnitude, sprinting);
      const accelerating = magnitude > MOVE_EPSILON;
      if (player.grounded) {
        rate = accelerating ? movement.groundAcceleration : movement.groundDeceleration;
      } else {
        rate = accelerating
          ? movement.groundAcceleration * movement.airControl
          : movement.airDeceleration;
      }
    }

    const targetX = dirX * targetSpeed;
    const targetZ = dirZ * targetSpeed;
    const deltaX = targetX - relX;
    const deltaZ = targetZ - relZ;
    const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    const maxDelta = rate * dt;
    let newRelX: number;
    let newRelZ: number;
    if (distance <= maxDelta || distance < 1e-9) {
      newRelX = targetX;
      newRelZ = targetZ;
    } else {
      newRelX = relX + (deltaX / distance) * maxDelta;
      newRelZ = relZ + (deltaZ / distance) * maxDelta;
    }
    player.velocity.x = newRelX + player.platformVelocity.x;
    player.velocity.z = newRelZ + player.platformVelocity.z;
  }

  // -- landing assist -------------------------------------------------------
  if (
    !player.grounded &&
    !player.inWater &&
    !step.clinging &&
    player.dashTimeRemaining <= 0 &&
    player.velocity.y < 0
  ) {
    applyLandingAssist(ctx, landingAssistStrength(ctx));
  }

  // -- physics --------------------------------------------------------------
  const impactSpeed = Math.abs(player.velocity.y);
  copy(moveParams.position, player.position);
  copy(moveParams.velocity, player.velocity);
  moveParams.radius = movement.bodyRadius;
  moveParams.height = movement.bodyHeight;
  moveParams.deltaSeconds = dt;
  moveParams.mask = PLAYER_MOVE_MASK;
  moveParams.maxSlopeRadians = movement.maxSlopeDegrees * DEG2RAD;
  moveParams.stepHeight = movement.stepHeight;
  moveParams.snapToGround = step.jump === JumpKind.None && player.velocity.y <= 0;

  const result = ctx.physics.moveCharacter(moveParams);
  copy(player.position, result.position);
  copy(player.velocity, result.velocity);
  player.grounded = result.grounded;
  copy(player.groundNormal, result.groundNormal);
  player.groundCollider = result.groundCollider;
  player.touchingWall = result.touchingWall;
  if (result.touchingWall) {
    setWallNormal(player, result.wallNormal);
  } else if (!step.clinging) {
    player.wallNormal = null;
  }

  // -- landing, bounce ------------------------------------------------------
  if (player.grounded && !player.wasGrounded) {
    const bounce = result.groundCollider?.descriptor.bounce ?? 0;
    if (bounce > 0 && impactSpeed > 0.5) {
      // Harmonic bounce: the surface returns the player at a tuned speed rather
      // than at whatever they arrived with, so the arc is always readable.
      player.velocity.y = movement.bounceStrength * bounce;
      player.grounded = false;
      player.jumpHeld = false;
      step.bounced = true;
      refreshAirOptions(ctx);
      player.coyoteRemaining = 0;
      ctx.events.emit('player:bounced', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        strength: player.velocity.y,
      });
    } else {
      refreshAirOptions(ctx);
      player.coyoteRemaining = coyoteTotal;
      player.wallClingRemaining = movement.wallClingSeconds;
      ctx.events.emit('player:landed', {
        position: { x: player.position.x, y: player.position.y, z: player.position.z },
        impactSpeed,
      });
    }
  }

  // -- state ----------------------------------------------------------------
  finalise(ctx, resolveState(ctx));
};

function resolveState(ctx: SimContext): MovementState {
  const player = ctx.world.player;
  const movement = ctx.movement;

  if (player.movementState === 'downed') return 'downed';
  if (!step.controllable && ctx.world.cutsceneId !== null) return 'cutscene';
  if (player.inWater) return 'swim';
  if (step.bounced) return 'bounce';
  if (player.dashTimeRemaining > 0) return step.dashStartedAirborne ? 'airDash' : 'dash';
  if (player.slideTimeRemaining > 0) return 'slide';
  if (step.clinging) return 'wallCling';

  if (!player.grounded) {
    switch (step.jump) {
      case JumpKind.Wall:
        return 'wallJump';
      case JumpKind.Double:
        return 'doubleJump';
      case JumpKind.Ground:
        return 'jump';
      default:
        break;
    }
    if (player.velocity.y > 0) {
      const current = player.movementState;
      if (
        current === 'jump' ||
        current === 'doubleJump' ||
        current === 'wallJump' ||
        current === 'bounce'
      ) {
        return current;
      }
      return 'jump';
    }
    return 'fall';
  }

  const relX = player.velocity.x - player.platformVelocity.x;
  const relZ = player.velocity.z - player.platformVelocity.z;
  const speed = Math.sqrt(relX * relX + relZ * relZ);
  if (speed < 0.2) return 'idle';
  if (speed <= movement.walkSpeed * 1.05) return 'walk';
  if (speed <= movement.runSpeed * 1.05) return 'run';
  return 'sprint';
}
