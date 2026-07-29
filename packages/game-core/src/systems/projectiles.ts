import { GRAVITY, clone, isFinite3, reflectInto, set, vec3 } from '@tuner/shared';
import type { EntityId, Vec3 } from '@tuner/shared';
import { ENEMY_SHOT_MASK, PLAYER_SHOT_MASK } from '@tuner/physics';
import type { LayerMask } from '@tuner/physics';
import type { SimContext, System } from '../internal/context.js';
import type { MutableEnemy, MutableProjectile, MutableResonator } from '../internal/world.js';
import {
  DEFAULT_ECHO_DELAY_SECONDS,
  bossRadiusOf,
  canStrikeResonator,
  damageBoss,
  enemyCentreInto,
  enemyRadiusOf,
  muzzleInto,
  retireOldestPlayerProjectiles,
  strikeResonator,
} from '../internal/services.js';

/**
 * Every shot in the world, integrated and resolved.
 *
 * Movement is a swept sphere rather than a teleport-and-test: a 46 m/s pulse
 * covers 0.77 m in one 60 Hz step, which is more than a Whisperer is wide, so
 * point sampling would let shots pass through enemies at exactly the moments
 * that matter most.
 *
 * Contact is resolved against two sources and the *earliest* wins:
 *
 * 1. `ctx.physics.sweepSphere` against `PLAYER_SHOT_MASK` / `ENEMY_SHOT_MASK`,
 *    which covers level geometry and any body the physics world holds a
 *    collider for (matched back to an entity through `ColliderDescriptor.owner`).
 * 2. An analytic sweep against the enemy list, the Commander, the player and
 *    the stage's resonators.
 *
 * The second exists because gameplay bodies are not guaranteed to own
 * colliders — and combat that silently stops working depending on whether the
 * enemy runtime registered a proxy is not combat. Taking the earliest of the
 * two means a body that *is* registered is still only hit once.
 *
 * Form behaviour handled here: Echo repeats (a follow-up shot every
 * `echoDelay` while `echoesRemaining` lasts) and Prism bounces (reflect off
 * the surface normal, spend one bounce, keep flying).
 */

// ---------------------------------------------------------------------------
// Shape constants
// ---------------------------------------------------------------------------

/** Bounces resolved within a single step before the shot gives up and stops. */
export const MAX_BOUNCE_ITERATIONS = 4;

/** Push-off applied after a bounce so the next sweep does not start inside. */
export const SURFACE_EPSILON = 1e-3;

/** How close a shot must pass to ring a resonator, in metres. */
export const RESONATOR_STRIKE_RADIUS = 0.9;

/** Absolute coordinate beyond which a shot has left the world. */
export const WORLD_BOUND_METRES = 4000;

// ---------------------------------------------------------------------------
// Module scratch
// ---------------------------------------------------------------------------

const scratchDirection = vec3();
const scratchCentre = vec3();
const scratchOrigin = vec3();
const scratchNormal = vec3();

type HitKind = 'surface' | 'enemy' | 'boss' | 'player' | 'resonator';

/** Result of a contact query. Module-level so the hot loop never allocates. */
const hit = {
  distance: 0,
  kind: 'surface' as HitKind,
  normal: vec3(0, 1, 0),
  enemy: null as MutableEnemy | null,
  resonator: null as MutableResonator | null,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Distance along a ray at which a sphere of `radius` first touches a sphere of
 * `targetRadius` centred at `centre`, or -1 when it never does. Returns zero
 * when the two already overlap.
 */
export function sweepSphereAgainstSphere(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  radius: number,
  centre: Vec3,
  targetRadius: number,
): number {
  const combined = radius + targetRadius;
  const mx = origin.x - centre.x;
  const my = origin.y - centre.y;
  const mz = origin.z - centre.z;
  const c = mx * mx + my * my + mz * mz - combined * combined;
  if (c <= 0) return 0;
  const b = mx * direction.x + my * direction.y + mz * direction.z;
  // Pointing away from a sphere we are not already inside.
  if (b > 0) return -1;
  const discriminant = b * b - c;
  if (discriminant < 0) return -1;
  const t = -b - Math.sqrt(discriminant);
  if (t < 0 || t > maxDistance) return -1;
  return t;
}

function layerMaskFor(projectile: MutableProjectile): LayerMask {
  return projectile.owner === 'player' ? PLAYER_SHOT_MASK : ENEMY_SHOT_MASK;
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

function recordHit(
  distance: number,
  kind: HitKind,
  normalX: number,
  normalY: number,
  normalZ: number,
  enemy: MutableEnemy | null,
  resonator: MutableResonator | null,
): void {
  hit.distance = distance;
  hit.kind = kind;
  set(hit.normal, normalX, normalY, normalZ);
  hit.enemy = enemy;
  hit.resonator = resonator;
}

/** Writes the surface normal pointing from `centre` back toward the contact. */
function contactNormal(
  origin: Vec3,
  direction: Vec3,
  distance: number,
  centre: Vec3,
): Vec3 {
  const px = origin.x + direction.x * distance - centre.x;
  const py = origin.y + direction.y * distance - centre.y;
  const pz = origin.z + direction.z * distance - centre.z;
  const length = Math.sqrt(px * px + py * py + pz * pz);
  if (length < 1e-9) {
    return set(scratchNormal, -direction.x, -direction.y, -direction.z);
  }
  return set(scratchNormal, px / length, py / length, pz / length);
}

/**
 * Finds the first thing this shot touches over `maxDistance`, filling the
 * module-level `hit`. Returns false when the path is clear.
 */
function resolveContact(
  ctx: SimContext,
  projectile: MutableProjectile,
  direction: Vec3,
  maxDistance: number,
): boolean {
  const world = ctx.world;
  let best = Number.POSITIVE_INFINITY;
  let found = false;

  const swept = ctx.physics.sweepSphere(
    projectile.position,
    direction,
    projectile.radius,
    maxDistance,
    layerMaskFor(projectile),
    null,
  );
  if (swept !== null) {
    const distance = Math.max(0, Math.min(maxDistance, swept.time * maxDistance));
    const owner = swept.collider.descriptor.owner;
    let kind: HitKind = 'surface';
    let enemy: MutableEnemy | null = null;
    if (owner !== undefined) {
      if (world.boss !== null && world.boss.id === owner) {
        kind = 'boss';
      } else if (world.player.id === owner) {
        kind = 'player';
      } else {
        for (const candidate of world.enemies) {
          if (candidate.id === owner && !candidate.dead) {
            kind = 'enemy';
            enemy = candidate;
            break;
          }
        }
      }
    }
    best = distance;
    found = true;
    recordHit(distance, kind, swept.normal.x, swept.normal.y, swept.normal.z, enemy, null);
  }

  if (projectile.owner === 'player') {
    for (const enemy of world.enemies) {
      if (enemy.dead) continue;
      enemyCentreInto(scratchCentre, enemy, ctx.content);
      const distance = sweepSphereAgainstSphere(
        projectile.position,
        direction,
        Math.min(maxDistance, best),
        projectile.radius,
        scratchCentre,
        enemyRadiusOf(ctx.content, enemy),
      );
      if (distance < 0 || distance >= best) continue;
      const normal = contactNormal(projectile.position, direction, distance, scratchCentre);
      best = distance;
      found = true;
      recordHit(distance, 'enemy', normal.x, normal.y, normal.z, enemy, null);
    }

    const boss = world.boss;
    if (boss !== null && !boss.defeated) {
      const definition = ctx.content.bosses[boss.definitionId];
      const height = definition?.bodyHeight ?? 2;
      set(scratchCentre, boss.position.x, boss.position.y + height * 0.5, boss.position.z);
      const distance = sweepSphereAgainstSphere(
        projectile.position,
        direction,
        Math.min(maxDistance, best),
        projectile.radius,
        scratchCentre,
        bossRadiusOf(ctx.content, boss),
      );
      if (distance >= 0 && distance < best) {
        const normal = contactNormal(projectile.position, direction, distance, scratchCentre);
        best = distance;
        found = true;
        recordHit(distance, 'boss', normal.x, normal.y, normal.z, null, null);
      }
    }

    // Resonators ring when they are shot, which is what makes the harmonic
    // puzzles solvable from a distance rather than only at arm's length.
    for (const resonator of world.stage.resonators.values()) {
      if (!canStrikeResonator(resonator, world.player.form)) continue;
      const distance = sweepSphereAgainstSphere(
        projectile.position,
        direction,
        Math.min(maxDistance, best),
        projectile.radius,
        resonator.position,
        RESONATOR_STRIKE_RADIUS,
      );
      if (distance < 0 || distance >= best) continue;
      const normal = contactNormal(projectile.position, direction, distance, resonator.position);
      best = distance;
      found = true;
      recordHit(distance, 'resonator', normal.x, normal.y, normal.z, null, resonator);
    }
  } else {
    const player = world.player;
    set(
      scratchCentre,
      player.position.x,
      player.position.y + ctx.movement.bodyHeight * 0.5,
      player.position.z,
    );
    const distance = sweepSphereAgainstSphere(
      projectile.position,
      direction,
      Math.min(maxDistance, best),
      projectile.radius,
      scratchCentre,
      ctx.movement.bodyRadius,
    );
    if (distance >= 0 && distance < best) {
      const normal = contactNormal(projectile.position, direction, distance, scratchCentre);
      best = distance;
      found = true;
      recordHit(distance, 'player', normal.x, normal.y, normal.z, null, null);
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Where an echo repeat leaves from: the shooter, not the shot. */
function echoOriginInto(target: Vec3, ctx: SimContext, projectile: MutableProjectile): Vec3 {
  if (projectile.owner === 'player') return muzzleInto(target, ctx);
  const sender = ctx.services.findEnemy(projectile.ownerId);
  if (sender !== null && !sender.dead) return enemyCentreInto(target, sender, ctx.content);
  return set(target, projectile.position.x, projectile.position.y, projectile.position.z);
}

/**
 * Detaches one Echo Form repeat.
 *
 * The repeat leaves from the shooter rather than from the leading shot's
 * current position, which is what makes Echo read as a stuttering volley
 * instead of a stretched beam. Repeats carry no echoes of their own, so the
 * chain is linear.
 */
function spawnEchoRepeat(ctx: SimContext, projectile: MutableProjectile): void {
  const speed = Math.sqrt(
    projectile.velocity.x * projectile.velocity.x +
      projectile.velocity.y * projectile.velocity.y +
      projectile.velocity.z * projectile.velocity.z,
  );
  if (speed < 1e-6) return;
  set(
    scratchDirection,
    projectile.velocity.x / speed,
    projectile.velocity.y / speed,
    projectile.velocity.z / speed,
  );
  echoOriginInto(scratchOrigin, ctx, projectile);
  ctx.services.spawnProjectile({
    owner: projectile.owner,
    ownerId: projectile.ownerId,
    position: scratchOrigin,
    direction: scratchDirection,
    speed,
    damage: projectile.damage,
    damageKind: projectile.damageKind,
    form: projectile.form,
    radius: projectile.radius,
    lifeSeconds: Math.max(projectile.lifeRemaining, ctx.combat.pulseLifeSeconds),
    tier: projectile.tier,
    hz: projectile.hz,
    counterable: projectile.counterable,
    gravityScale: projectile.gravityScale,
    homingTarget: projectile.homingTarget,
    homingStrength: projectile.homingStrength,
    bounces: projectile.bouncesRemaining,
  });
}

/**
 * Retires a shot and runs the equipped form's `onProjectileEnd` hook.
 *
 * The hook only runs for the player's own shots fired by the form that is
 * still equipped — switching forms mid-flight must not make an old shot bloom
 * into the new form's effect.
 *
 * Known limitation: `spawnEcho(delaySeconds)` detaches its repeat immediately.
 * `MutableProjectile` has no dormant state, and a module-level pending queue
 * would leak between worlds and break replay determinism, so the delay is
 * carried on the repeat rather than in front of it.
 */
function endProjectile(
  ctx: SimContext,
  projectile: MutableProjectile,
  hitSomething: boolean,
): void {
  if (projectile.dead) return;
  projectile.dead = true;

  const behaviour = ctx.formBehaviour;
  if (
    behaviour === null ||
    behaviour.onProjectileEnd === undefined ||
    projectile.owner !== 'player' ||
    behaviour.id !== projectile.form
  ) {
    return;
  }

  const speed = Math.sqrt(
    projectile.velocity.x * projectile.velocity.x +
      projectile.velocity.y * projectile.velocity.y +
      projectile.velocity.z * projectile.velocity.z,
  );
  const direction =
    speed > 1e-6
      ? vec3(
          projectile.velocity.x / speed,
          projectile.velocity.y / speed,
          projectile.velocity.z / speed,
        )
      : vec3(0, 0, -1);

  behaviour.onProjectileEnd({
    position: clone(projectile.position),
    direction,
    tier: projectile.tier,
    hitSomething,
    spawnEcho(delaySeconds) {
      const echo = ctx.services.spawnProjectile({
        owner: 'player',
        ownerId: projectile.ownerId,
        position: projectile.position,
        direction,
        speed: speed > 1e-6 ? speed : ctx.combat.pulseSpeed,
        damage: projectile.damage,
        damageKind: projectile.damageKind,
        form: projectile.form,
        radius: projectile.radius,
        lifeSeconds: ctx.combat.pulseLifeSeconds,
        tier: projectile.tier,
        hz: projectile.hz,
      });
      echo.echoDelay = Math.max(0, delaySeconds);
    },
    spawnPlatform(position, radius, lifeSeconds) {
      ctx.services.spawnConjuredPlatform(position, radius, lifeSeconds, projectile.form);
    },
  });
}

function leftTheWorld(ctx: SimContext, projectile: MutableProjectile): boolean {
  const position = projectile.position;
  if (!isFinite3(position)) return true;
  const killPlaneY = ctx.stageDef?.killPlaneY;
  if (killPlaneY !== undefined && position.y < killPlaneY) return true;
  return (
    Math.abs(position.x) > WORLD_BOUND_METRES ||
    Math.abs(position.y) > WORLD_BOUND_METRES ||
    Math.abs(position.z) > WORLD_BOUND_METRES
  );
}

/** Bends a shot's velocity toward its target, at `homingStrength` rad/s. */
function applyHoming(ctx: SimContext, projectile: MutableProjectile): void {
  const targetId: EntityId | null = projectile.homingTarget;
  if (targetId === null || projectile.homingStrength <= 0) return;

  const world = ctx.world;
  if (world.player.id === targetId) {
    set(
      scratchCentre,
      world.player.position.x,
      world.player.position.y + ctx.movement.bodyHeight * 0.5,
      world.player.position.z,
    );
  } else {
    const enemy = ctx.services.findEnemy(targetId);
    if (enemy === null || enemy.dead) {
      projectile.homingTarget = null;
      return;
    }
    enemyCentreInto(scratchCentre, enemy, ctx.content);
  }

  const speed = Math.sqrt(
    projectile.velocity.x * projectile.velocity.x +
      projectile.velocity.y * projectile.velocity.y +
      projectile.velocity.z * projectile.velocity.z,
  );
  if (speed < 1e-6) return;

  const dx = scratchCentre.x - projectile.position.x;
  const dy = scratchCentre.y - projectile.position.y;
  const dz = scratchCentre.z - projectile.position.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) return;

  // Steer by a bounded fraction of the way each step, which keeps the turn
  // rate framerate-independent without needing a full slerp.
  const blend = Math.min(1, projectile.homingStrength * ctx.dt);
  const vx = projectile.velocity.x / speed + (dx / distance - projectile.velocity.x / speed) * blend;
  const vy = projectile.velocity.y / speed + (dy / distance - projectile.velocity.y / speed) * blend;
  const vz = projectile.velocity.z / speed + (dz / distance - projectile.velocity.z / speed) * blend;
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (length < 1e-9) return;
  set(projectile.velocity, (vx / length) * speed, (vy / length) * speed, (vz / length) * speed);
}

function applyContactDamage(ctx: SimContext, projectile: MutableProjectile): void {
  const world = ctx.world;
  switch (hit.kind) {
    case 'enemy': {
      const enemy = hit.enemy;
      if (enemy === null) return;
      ctx.services.damageEnemy(
        enemy,
        projectile.damage,
        projectile.damageKind,
        projectile.form,
        projectile.position,
        hit.normal,
      );
      if (projectile.tier > 0 || projectile.damageKind === 'counter') {
        ctx.services.requestHitStop(ctx.combat.hitStopSeconds);
      }
      return;
    }
    case 'boss': {
      const boss = world.boss;
      if (boss === null) return;
      damageBoss(
        ctx,
        boss,
        projectile.damage,
        projectile.damageKind,
        projectile.form,
        projectile.position,
        hit.normal,
      );
      if (projectile.tier > 0 || projectile.damageKind === 'counter') {
        ctx.services.requestHitStop(ctx.combat.hitStopSeconds);
      }
      return;
    }
    case 'player': {
      ctx.services.damagePlayer(projectile.damage, 'projectile', projectile.position);
      return;
    }
    case 'resonator': {
      const resonator = hit.resonator;
      if (resonator === null) return;
      strikeResonator(ctx.events, resonator);
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

function stepProjectile(ctx: SimContext, projectile: MutableProjectile): void {
  const dt = ctx.dt;

  projectile.lifeRemaining -= dt;
  if (projectile.lifeRemaining <= 0) {
    endProjectile(ctx, projectile, false);
    return;
  }

  if (projectile.echoesRemaining > 0) {
    projectile.echoDelay -= dt;
    if (projectile.echoDelay <= 0) {
      spawnEchoRepeat(ctx, projectile);
      projectile.echoesRemaining -= 1;
      projectile.echoDelay = DEFAULT_ECHO_DELAY_SECONDS;
    }
  }

  applyHoming(ctx, projectile);

  if (projectile.gravityScale !== 0) {
    projectile.velocity.y += GRAVITY * projectile.gravityScale * dt;
  }

  let remaining = dt;
  for (let iteration = 0; iteration < MAX_BOUNCE_ITERATIONS && remaining > 1e-6; iteration++) {
    const speed = Math.sqrt(
      projectile.velocity.x * projectile.velocity.x +
        projectile.velocity.y * projectile.velocity.y +
        projectile.velocity.z * projectile.velocity.z,
    );
    if (speed < 1e-6) break;
    set(
      scratchDirection,
      projectile.velocity.x / speed,
      projectile.velocity.y / speed,
      projectile.velocity.z / speed,
    );
    const travel = speed * remaining;

    if (!resolveContact(ctx, projectile, scratchDirection, travel)) {
      projectile.position.x += scratchDirection.x * travel;
      projectile.position.y += scratchDirection.y * travel;
      projectile.position.z += scratchDirection.z * travel;
      remaining = 0;
      break;
    }

    projectile.position.x += scratchDirection.x * hit.distance;
    projectile.position.y += scratchDirection.y * hit.distance;
    projectile.position.z += scratchDirection.z * hit.distance;
    remaining -= hit.distance / speed;

    if (hit.kind !== 'surface') {
      applyContactDamage(ctx, projectile);
      endProjectile(ctx, projectile, true);
      return;
    }

    // Prism Form: spend a bounce and keep going.
    if (false) {
      projectile.bouncesRemaining -= 1;
      reflectInto(projectile.velocity, projectile.velocity, hit.normal);
      projectile.position.x += hit.normal.x * SURFACE_EPSILON;
      projectile.position.y += hit.normal.y * SURFACE_EPSILON;
      projectile.position.z += hit.normal.z * SURFACE_EPSILON;
      continue;
    }

    endProjectile(ctx, projectile, true);
    return;
  }

  if (leftTheWorld(ctx, projectile)) {
    endProjectile(ctx, projectile, false);
  }
}

/** Ages conjured platforms and hands their colliders back to the physics world. */
function expireConjured(ctx: SimContext): void {
  const conjured = ctx.world.conjured;
  for (let i = conjured.length - 1; i >= 0; i--) {
    const platform = conjured[i];
    if (platform === undefined) continue;
    platform.lifeRemaining -= ctx.dt;
    if (platform.lifeRemaining > 0) continue;
    // Clearing the handle first makes a second sweep over the same entry a
    // no-op rather than a double removal.
    const collider = platform.collider;
    platform.collider = null;
    if (collider !== null) ctx.physics.removeCollider(collider);
    conjured.splice(i, 1);
  }
}

function compact(ctx: SimContext): void {
  const projectiles = ctx.world.projectiles;
  let write = 0;
  for (let read = 0; read < projectiles.length; read++) {
    const projectile = projectiles[read];
    if (projectile === undefined || projectile.dead) continue;
    projectiles[write] = projectile;
    write++;
  }
  projectiles.length = write;
}

export const projectileSystem: System = (ctx: SimContext): void => {
  const world = ctx.world;
  if (world.paused || ctx.dt <= 0) return;

  retireOldestPlayerProjectiles(world, ctx.combat.maxPlayerProjectiles);
  expireConjured(ctx);

  // Snapshot the length: shots spawned during this pass (echoes, form hooks)
  // start moving on the next step, so a repeater can never run away with the
  // frame.
  const count = world.projectiles.length;
  for (let i = 0; i < count; i++) {
    const projectile = world.projectiles[i];
    if (projectile === undefined || projectile.dead) continue;
    stepProjectile(ctx, projectile);
  }

  compact(ctx);
};
