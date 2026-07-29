import {
  DEG2RAD,
  clamp,
  clamp01,
  clone,
  copy,
  harmonicHz,
  set,
  vec3,
} from '@tuner/shared';
import type { DamageKind, Vec3 } from '@tuner/shared';
import type { SimContext, System } from '../internal/context.js';
import type { MutableEnemy, MutableProjectile } from '../internal/world.js';
import {
  MUZZLE_HEIGHT_RATIO,
  canStrikeResonator,
  damageBoss,
  enemyCentreInto,
  enemyRadiusOf,
  muzzleInto,
  strikeResonator,
} from '../internal/services.js';

/**
 * Player offence and defence.
 *
 * The Auralith's five verbs, all of them usable while moving and while
 * airborne — nothing here is gated on being grounded or on an animation
 * finishing, because the moment a shooter makes you stop to shoot it stops
 * being a movement game:
 *
 * - **Resonance Pulse** — a tap. Fast, accurate, rate-limited by
 *   `combat.pulseInterval` and nothing else.
 * - **Charged Chord** — a hold. Three readable tiers, each announced by
 *   `combat:chargeTier` (sound *and* the ring closing on the Auralith), and
 *   released as a `charge` shot, which is a channel that breaks armour a pulse
 *   skates off.
 * - **Harmonic Burst** — a short-range radial shockwave that damages, knocks
 *   back, and rings nearby resonators.
 * - **Lock-On** — a toggle. It bends aim toward the target; it never seizes it.
 * - **Resonance Counter** — a timed window that converts an incoming
 *   counterable shot into a player shot heading back at its sender.
 *
 * **Which button fires the Burst.** `ACTIONS` has no dedicated burst binding,
 * and inventing a chord (fire+counter, dash+fire) would collide with movement
 * on every device. So the Burst is *contextual*: a fire press with a valid
 * target — an enemy, the Commander, or a strikeable resonator — inside
 * `combat.burstRadius` becomes a Burst instead of a pulse, provided
 * `combat.burstCooldown` has drained. At point-blank range the shockwave is
 * the better answer anyway, the cooldown stops it replacing the pulse
 * outright, and it needs no button the input layer does not already have.
 * {@link tryHarmonicBurst} is exported so a future explicit binding can call
 * it directly.
 *
 * **Accessibility.** Every cue here is paired with an event that carries a
 * world position: `combat:fired`, `combat:chargeTier`, `combat:burst`,
 * `combat:counterWindow` (both edges), `combat:countered`,
 * `combat:lockOnChanged` and `puzzle:noteStruck`. The counter is playable with
 * the sound off because its window is drawn from the same events that would
 * have sounded it.
 *
 * Note on `player.hurtThisStep`: it is set by `SimServices.damagePlayer` and
 * deliberately *not* cleared here. Stage hazards damage the player before
 * combat runs, so clearing it in this system would erase a flag that later
 * systems in the same step still need. Clearing it belongs to the step loop.
 */

// ---------------------------------------------------------------------------
// Shape constants — thresholds and geometry, not feel knobs (those are in
// CombatConfig, and every one of them is read from `ctx.combat`).
// ---------------------------------------------------------------------------

/** Widening of the lock-on cone at full `accessibility.lockOnAssist`. */
export const LOCK_ON_ASSIST_CONE_SCALE = 0.6;

/**
 * How far past `lockOnRange` a target may drift before it counts as lost. The
 * lock does not snap the instant a target steps over the line — it starts the
 * `lockOnBreakSeconds` timer, and comes back if the target does.
 */
export const LOCK_ON_BREAK_RANGE_SCALE = 1.25;

/**
 * Most the aim may be bent toward a locked target, in degrees.
 *
 * Lock-on biases aim, it never seizes it: inside this cone shots land on the
 * target, and a player who deliberately aims further away than this shoots
 * where they are actually pointing. The acquisition cone is narrower than this
 * by default, so in practice a locked target is hit.
 */
export const LOCK_ON_MAX_BEND_DEGREES = 45;

/** Cone searched by aim assist, in degrees. Deliberately narrow. */
export const AIM_ASSIST_CONE_DEGREES = 12;

/** Most aim assist may bend the shot at strength 1, in degrees. */
export const AIM_ASSIST_MAX_DEGREES = 6;

/** Shortest counter window any difficulty may produce, in seconds. */
export const MIN_COUNTER_WINDOW_SECONDS = 0.05;

/** How far in front of the player the counter can catch a shot, in metres. */
export const COUNTER_REACH_METRES = 2.6;

/** How far off the aim axis an incoming shot may be and still be countered. */
export const COUNTER_FRONT_DOT = 0.15;

/** Speed multiplier applied to a converted shot on its way back. */
export const COUNTER_RETURN_SPEED_SCALE = 1.25;

/** Damage multiplier applied to a converted shot — the counter is a payoff. */
export const COUNTER_RETURN_DAMAGE_SCALE = 2;

/** Gentle tracking on a converted shot, in radians per second. */
export const COUNTER_RETURN_HOMING = 3;

/** Minimum life granted to a converted shot so it can reach its sender. */
export const COUNTER_RETURN_LIFE_SECONDS = 2;

export const COUNTER_SHAKE_MAGNITUDE = 0.5;
export const COUNTER_SHAKE_SECONDS = 0.18;

export const BURST_SHAKE_MAGNITUDE = 0.35;
export const BURST_SHAKE_SECONDS = 0.16;

/** Upward component of the Burst's knockback, as a fraction of the total. */
export const BURST_LIFT_RATIO = 0.35;

/** Charged shots travel slower, so they get proportionally longer to live. */
export const CHARGED_LIFE_SCALE = 1.5;

// ---------------------------------------------------------------------------
// Module scratch — reused every step so the hot path never allocates
// ---------------------------------------------------------------------------

const scratchOrigin = vec3();
const scratchAim = vec3();
const scratchTarget = vec3();
const scratchDesired = vec3();
const scratchDir = vec3();
// Used only by the form burst hooks, which run while the main scratch is live.
const scratchHookCentre = vec3();
const scratchHookPoint = vec3();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Unit direction the camera is looking along.
 *
 * Matches the movement system's yaw convention — a yaw of zero faces -Z — and
 * treats a positive pitch as looking up, so `CameraConfig.maxPitch` is the
 * ceiling and `minPitch` the floor.
 */
export function cameraDirectionInto(target: Vec3, yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  target.x = -Math.sin(yaw) * cosPitch;
  target.y = Math.sin(pitch);
  target.z = -Math.cos(yaw) * cosPitch;
  return target;
}

/** Highest charge tier reached after holding for `heldSeconds`. */
export function chargeTierFor(thresholds: readonly number[], heldSeconds: number): number {
  let tier = 0;
  for (let i = 0; i < thresholds.length; i++) {
    const threshold = thresholds[i];
    if (threshold === undefined) continue;
    if (heldSeconds >= threshold) tier = i + 1;
  }
  return tier;
}

/**
 * Rotates the unit vector `from` toward the unit vector `to` by at most
 * `maxRadians`, along the great circle between them. Safe when `target` and
 * `from` are the same object.
 */
export function rotateTowardsInto(
  target: Vec3,
  from: Vec3,
  to: Vec3,
  maxRadians: number,
): Vec3 {
  const fx = from.x;
  const fy = from.y;
  const fz = from.z;
  const d = clamp(fx * to.x + fy * to.y + fz * to.z, -1, 1);
  const angle = Math.acos(d);
  if (!Number.isFinite(angle) || angle <= 1e-6) return set(target, fx, fy, fz);
  if (maxRadians >= angle) return copy(target, to);

  // Component of `to` perpendicular to `from`, normalised.
  let px = to.x - fx * d;
  let py = to.y - fy * d;
  let pz = to.z - fz * d;
  const length = Math.sqrt(px * px + py * py + pz * pz);
  if (length < 1e-9) return set(target, fx, fy, fz);
  px /= length;
  py /= length;
  pz /= length;

  const c = Math.cos(maxRadians);
  const s = Math.sin(maxRadians);
  return set(target, fx * c + px * s, fy * c + py * s, fz * c + pz * s);
}

/** Counter window for the current difficulty, never shorter than the floor. */
export function counterWindowSeconds(ctx: SimContext): number {
  return Math.max(
    MIN_COUNTER_WINDOW_SECONDS,
    ctx.combat.counterWindowSeconds + ctx.difficultyProfile.counterWindowBonus,
  );
}

/** Picks a per-tier value, falling back to the last entry then to a default. */
function tierValue(values: readonly number[], index: number, fallback: number): number {
  const exact = values[index];
  if (exact !== undefined) return exact;
  const last = values[values.length - 1];
  return last ?? fallback;
}

/** Writes the unit direction from `origin` to `point`; false when degenerate. */
function directionToInto(target: Vec3, origin: Vec3, point: Vec3): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6) return false;
  set(target, dx / length, dy / length, dz / length);
  return true;
}

/**
 * True when the player owns their own body — not downed, and not inside a
 * cutscene that took control away. Mirrors the movement system's rule so the
 * two never disagree about who is driving.
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

// ---------------------------------------------------------------------------
// Lock-on
// ---------------------------------------------------------------------------

function releaseLock(ctx: SimContext): void {
  const player = ctx.world.player;
  if (player.lockedTarget === null) return;
  player.lockedTarget = null;
  player.lockOnLostSeconds = 0;
  ctx.events.emit('combat:lockOnChanged', { targetId: null });
}

function updateLockOn(ctx: SimContext, controllable: boolean): void {
  const player = ctx.world.player;
  const combat = ctx.combat;

  // -- maintain an existing lock -------------------------------------------
  const lockedId = player.lockedTarget;
  if (lockedId !== null) {
    const target = ctx.services.findEnemy(lockedId);
    let lost = target === null || target.dead;
    if (!lost && target !== null) {
      const dx = target.position.x - player.position.x;
      const dy = target.position.y - player.position.y;
      const dz = target.position.z - player.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      lost = distance > combat.lockOnRange * LOCK_ON_BREAK_RANGE_SCALE;
    }
    if (lost) {
      player.lockOnLostSeconds += ctx.dt;
      if (player.lockOnLostSeconds >= combat.lockOnBreakSeconds) {
        releaseLock(ctx);
      }
    } else {
      player.lockOnLostSeconds = 0;
    }
  } else {
    player.lockOnLostSeconds = 0;
  }

  if (!controllable) {
    releaseLock(ctx);
    return;
  }

  // -- toggle ---------------------------------------------------------------
  if (!ctx.input.buttons.lockOn.pressed) return;
  if (player.lockedTarget !== null) {
    releaseLock(ctx);
    return;
  }

  cameraDirectionInto(scratchAim, ctx.cameraYaw, ctx.cameraPitch);
  muzzleInto(scratchOrigin, ctx);
  const cone = clamp(
    combat.lockOnConeDegrees * (1 + clamp01(ctx.accessibility.lockOnAssist) * LOCK_ON_ASSIST_CONE_SCALE),
    0,
    180,
  );
  const target = ctx.services.findNearestEnemy(
    scratchOrigin,
    scratchAim,
    combat.lockOnRange,
    cone,
  );
  if (target === null) return;
  player.lockedTarget = target.id;
  player.lockOnLostSeconds = 0;
  ctx.events.emit('combat:lockOnChanged', { targetId: target.id });
}

// ---------------------------------------------------------------------------
// Aim
// ---------------------------------------------------------------------------

/**
 * Resolves `player.aimDirection`.
 *
 * The camera direction is written first and verbatim: with no lock and
 * `accessibility.aimAssist` at zero, the aim vector *is* the camera vector,
 * with no smoothing, snapping or rounding applied on top. Assists only ever
 * bend it, and only by a bounded angle.
 */
function resolveAim(ctx: SimContext): void {
  const player = ctx.world.player;
  cameraDirectionInto(player.aimDirection, ctx.cameraYaw, ctx.cameraPitch);

  muzzleInto(scratchOrigin, ctx);

  const lockedId = player.lockedTarget;
  if (lockedId !== null) {
    const target = ctx.services.findEnemy(lockedId);
    if (target !== null && !target.dead) {
      enemyCentreInto(scratchTarget, target, ctx.content);
      if (directionToInto(scratchDesired, scratchOrigin, scratchTarget)) {
        rotateTowardsInto(
          player.aimDirection,
          player.aimDirection,
          scratchDesired,
          LOCK_ON_MAX_BEND_DEGREES * DEG2RAD,
        );
      }
      return;
    }
  }

  const assist = clamp01(ctx.accessibility.aimAssist);
  if (assist <= 0) return;

  const target = ctx.services.findNearestEnemy(
    scratchOrigin,
    player.aimDirection,
    ctx.combat.lockOnRange,
    AIM_ASSIST_CONE_DEGREES,
  );
  if (target === null) return;
  enemyCentreInto(scratchTarget, target, ctx.content);
  if (!directionToInto(scratchDesired, scratchOrigin, scratchTarget)) return;
  rotateTowardsInto(
    player.aimDirection,
    player.aimDirection,
    scratchDesired,
    assist * AIM_ASSIST_MAX_DEGREES * DEG2RAD,
  );
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

function applyFormFire(ctx: SimContext, projectile: MutableProjectile, tier: number): void {
  const behaviour = ctx.formBehaviour;
  if (behaviour === null || behaviour.onFire === undefined) return;
  if (behaviour.id !== ctx.world.player.form) return;

  const origin = clone(projectile.position);
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

  behaviour.onFire({
    projectileId: projectile.id,
    tier,
    origin,
    direction,
    setEchoes(count) {
      projectile.echoesRemaining = Math.max(0, Math.floor(count));
    },
    setBounces(count) {
      projectile.bouncesRemaining = Math.max(0, Math.floor(count));
    },
    setDamageScale(scale) {
      projectile.damage *= Math.max(0, scale);
    },
    spawnAdditional(extraDirection, damageScale) {
      ctx.services.spawnProjectile({
        owner: projectile.owner,
        ownerId: projectile.ownerId,
        position: origin,
        direction: extraDirection,
        speed: speed > 1e-6 ? speed : ctx.combat.pulseSpeed,
        damage: projectile.damage * Math.max(0, damageScale),
        damageKind: projectile.damageKind,
        form: projectile.form,
        radius: projectile.radius,
        lifeSeconds: projectile.lifeRemaining,
        tier: projectile.tier,
        hz: projectile.hz,
        counterable: false,
        gravityScale: projectile.gravityScale,
      });
    },
  });
}

function spawnShot(
  ctx: SimContext,
  damage: number,
  kind: DamageKind,
  tier: number,
  speed: number,
  radius: number,
  lifeSeconds: number,
): MutableProjectile {
  const player = ctx.world.player;
  muzzleInto(scratchOrigin, ctx);
  const projectile = ctx.services.spawnProjectile({
    owner: 'player',
    ownerId: player.id,
    position: scratchOrigin,
    direction: player.aimDirection,
    speed,
    damage,
    damageKind: kind,
    form: player.form,
    radius,
    lifeSeconds,
    tier,
    hz: harmonicHz(tier),
    counterable: false,
    gravityScale: 0,
  });
  applyFormFire(ctx, projectile, tier);
  return projectile;
}

function firePulse(ctx: SimContext): void {
  const combat = ctx.combat;
  ctx.world.player.fireCooldown = combat.pulseInterval;
  spawnShot(
    ctx,
    combat.pulseDamage,
    'pulse',
    0,
    combat.pulseSpeed,
    combat.pulseRadius,
    combat.pulseLifeSeconds,
  );
}

function fireCharged(ctx: SimContext, tier: number): void {
  const combat = ctx.combat;
  const player = ctx.world.player;
  const index = tier - 1;
  const damage = tierValue(combat.chargeTierDamage, index, combat.pulseDamage);
  const radius = tierValue(combat.chargeTierRadius, index, combat.pulseRadius);
  const speed = tierValue(combat.chargeTierSpeed, index, combat.pulseSpeed);
  player.fireCooldown = Math.max(player.fireCooldown, combat.pulseInterval);
  // `charge` is an armour-breaking channel: the Charged Chord is the answer to
  // plating that a pulse skates off, and the bestiary is authored against that.
  spawnShot(
    ctx,
    damage,
    'charge',
    tier,
    speed,
    radius,
    combat.pulseLifeSeconds * CHARGED_LIFE_SCALE,
  );
}

// ---------------------------------------------------------------------------
// Harmonic Burst
// ---------------------------------------------------------------------------

function burstReaches(ctx: SimContext, centre: Vec3, point: Vec3, bodyRadius: number): boolean {
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const dz = point.z - centre.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - bodyRadius <= ctx.combat.burstRadius;
}

/** True when something inside `burstRadius` is worth shocking. */
function hasBurstTarget(ctx: SimContext): boolean {
  const world = ctx.world;
  muzzleInto(scratchOrigin, ctx);

  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    enemyCentreInto(scratchTarget, enemy, ctx.content);
    if (burstReaches(ctx, scratchOrigin, scratchTarget, enemyRadiusOf(ctx.content, enemy))) {
      return true;
    }
  }

  const boss = world.boss;
  if (boss !== null && !boss.defeated) {
    const definition = ctx.content.bosses[boss.definitionId];
    if (burstReaches(ctx, scratchOrigin, boss.position, definition?.bodyRadius ?? 1)) return true;
  }

  for (const resonator of world.stage.resonators.values()) {
    if (!canStrikeResonator(resonator, world.player.form)) continue;
    if (burstReaches(ctx, scratchOrigin, resonator.position, 0)) return true;
  }

  return false;
}

/**
 * Fires the Harmonic Burst: radial damage, knockback, and a strike on every
 * resonator in range. Puzzle state belongs to the stage system, so resonators
 * are only *announced* here.
 *
 * Returns false when the burst is on cooldown or has nothing to hit, leaving
 * the fire press to the pulse.
 */
export function tryHarmonicBurst(ctx: SimContext): boolean {
  const world = ctx.world;
  const player = world.player;
  const combat = ctx.combat;
  if (player.burstCooldown > 0) return false;
  if (!hasBurstTarget(ctx)) return false;

  player.burstCooldown = combat.burstCooldown;
  muzzleInto(scratchOrigin, ctx);
  ctx.events.emit('combat:burst', {
    position: clone(scratchOrigin),
    radius: combat.burstRadius,
  });

  const behaviour = ctx.formBehaviour;
  if (behaviour !== null && behaviour.onBurst !== undefined && behaviour.id === player.form) {
    behaviour.onBurst({
      position: clone(scratchOrigin),
      radius: combat.burstRadius,
      rootEnemiesInRadius(seconds) {
        forEachEnemyInBurst(ctx, (enemy) => {
          enemy.rootedRemaining = Math.max(enemy.rootedRemaining, seconds);
        });
      },
      silenceEnemiesInRadius(seconds) {
        forEachEnemyInBurst(ctx, (enemy) => {
          enemy.silencedRemaining = Math.max(enemy.silencedRemaining, seconds);
        });
      },
      restoreCoherence(amount) {
        ctx.services.restoreCoherence(amount);
      },
    });
    // The hooks above reuse the burst scratch, so re-establish the centre.
    muzzleInto(scratchOrigin, ctx);
  }

  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    enemyCentreInto(scratchTarget, enemy, ctx.content);
    if (!burstReaches(ctx, scratchOrigin, scratchTarget, enemyRadiusOf(ctx.content, enemy))) {
      continue;
    }
    // Knockback pushes out and slightly up, so a shoved enemy visibly leaves
    // the player's personal space instead of grinding along the floor.
    if (!directionToInto(scratchDir, scratchOrigin, scratchTarget)) {
      set(scratchDir, 0, 1, 0);
    }
    enemy.velocity.x += scratchDir.x * combat.burstKnockback;
    enemy.velocity.y += Math.abs(combat.burstKnockback) * BURST_LIFT_RATIO;
    enemy.velocity.z += scratchDir.z * combat.burstKnockback;
    set(scratchDesired, -scratchDir.x, -scratchDir.y, -scratchDir.z);
    ctx.services.damageEnemy(
      enemy,
      combat.burstDamage,
      'burst',
      player.form,
      scratchTarget,
      scratchDesired,
    );
  }

  const boss = world.boss;
  if (boss !== null && !boss.defeated) {
    const definition = ctx.content.bosses[boss.definitionId];
    if (burstReaches(ctx, scratchOrigin, boss.position, definition?.bodyRadius ?? 1)) {
      if (!directionToInto(scratchDir, scratchOrigin, boss.position)) {
        set(scratchDir, 0, 1, 0);
      }
      set(scratchDesired, -scratchDir.x, -scratchDir.y, -scratchDir.z);
      damageBoss(
        ctx,
        boss,
        combat.burstDamage,
        'burst',
        player.form,
        boss.position,
        scratchDesired,
      );
    }
  }

  for (const resonator of world.stage.resonators.values()) {
    if (!canStrikeResonator(resonator, player.form)) continue;
    if (!burstReaches(ctx, scratchOrigin, resonator.position, 0)) continue;
    strikeResonator(ctx.events, resonator);
  }

  ctx.services.requestShake(BURST_SHAKE_MAGNITUDE, BURST_SHAKE_SECONDS);
  return true;
}

function forEachEnemyInBurst(ctx: SimContext, apply: (enemy: MutableEnemy) => void): void {
  muzzleInto(scratchHookCentre, ctx);
  for (const enemy of ctx.world.enemies) {
    if (enemy.dead) continue;
    enemyCentreInto(scratchHookPoint, enemy, ctx.content);
    if (
      !burstReaches(ctx, scratchHookCentre, scratchHookPoint, enemyRadiusOf(ctx.content, enemy))
    ) {
      continue;
    }
    apply(enemy);
  }
}

// ---------------------------------------------------------------------------
// Resonance Counter
// ---------------------------------------------------------------------------

function closeCounterWindow(ctx: SimContext): void {
  const player = ctx.world.player;
  if (!player.counterActive) return;
  player.counterActive = false;
  player.counterWindowRemaining = 0;
  player.counterCooldownRemaining = ctx.combat.counterCooldownSeconds;
  ctx.events.emit('combat:counterWindow', {
    position: clone(player.position),
    opening: false,
  });
}

/** Turns an incoming shot around and sends it home. */
function convertProjectile(ctx: SimContext, projectile: MutableProjectile): void {
  const player = ctx.world.player;
  const speed = Math.sqrt(
    projectile.velocity.x * projectile.velocity.x +
      projectile.velocity.y * projectile.velocity.y +
      projectile.velocity.z * projectile.velocity.z,
  );

  const sender = ctx.services.findEnemy(projectile.ownerId);
  let aimed = false;
  if (sender !== null && !sender.dead) {
    enemyCentreInto(scratchTarget, sender, ctx.content);
    aimed = directionToInto(scratchDesired, projectile.position, scratchTarget);
  }
  if (!aimed) {
    // No sender left to return it to: send it straight back the way it came.
    if (speed > 1e-6) {
      set(
        scratchDesired,
        -projectile.velocity.x / speed,
        -projectile.velocity.y / speed,
        -projectile.velocity.z / speed,
      );
    } else {
      copy(scratchDesired, player.aimDirection);
    }
  }

  const returnSpeed = (speed > 1e-6 ? speed : ctx.combat.pulseSpeed) * COUNTER_RETURN_SPEED_SCALE;
  projectile.owner = 'player';
  projectile.ownerId = player.id;
  projectile.reflected = true;
  projectile.counterable = false;
  // `counter` is an armour-breaking channel, which is what makes turning a
  // shielded enemy's own shot around the intended answer to its plating.
  projectile.damageKind = 'counter';
  projectile.form = player.form;
  projectile.damage *= COUNTER_RETURN_DAMAGE_SCALE;
  projectile.lifeRemaining = Math.max(projectile.lifeRemaining, COUNTER_RETURN_LIFE_SECONDS);
  projectile.homingTarget = sender !== null && !sender.dead ? sender.id : null;
  projectile.homingStrength = projectile.homingTarget !== null ? COUNTER_RETURN_HOMING : 0;
  set(
    projectile.velocity,
    scratchDesired.x * returnSpeed,
    scratchDesired.y * returnSpeed,
    scratchDesired.z * returnSpeed,
  );
}

/** Converts every counterable shot inside the open window. */
function tryConvertIncoming(ctx: SimContext): boolean {
  const world = ctx.world;
  const player = world.player;
  muzzleInto(scratchOrigin, ctx);
  const aim = player.aimDirection;

  let converted = 0;
  for (const projectile of world.projectiles) {
    if (projectile.dead) continue;
    if (projectile.owner !== 'enemy' || !projectile.counterable) continue;

    const dx = projectile.position.x - scratchOrigin.x;
    const dy = projectile.position.y - scratchOrigin.y;
    const dz = projectile.position.z - scratchOrigin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > COUNTER_REACH_METRES + projectile.radius) continue;
    if (distance > 1e-6) {
      const alignment = (dx * aim.x + dy * aim.y + dz * aim.z) / distance;
      if (alignment < COUNTER_FRONT_DOT) continue;
      // Only shots actually coming at the player can be turned around.
      const closing = -(
        projectile.velocity.x * dx +
        projectile.velocity.y * dy +
        projectile.velocity.z * dz
      );
      if (closing <= 0) continue;
    }
    convertProjectile(ctx, projectile);
    converted++;
  }

  if (converted === 0) return false;

  player.counterSuccesses += 1;
  ctx.services.restoreCoherence(ctx.combat.counterCoherenceReward);
  ctx.events.emit('combat:countered', {
    position: clone(player.position),
    success: true,
    converted: true,
  });
  ctx.services.requestHitStop(ctx.combat.hitStopSeconds);
  ctx.services.requestShake(COUNTER_SHAKE_MAGNITUDE, COUNTER_SHAKE_SECONDS);
  closeCounterWindow(ctx);
  return true;
}

function updateCounter(ctx: SimContext): void {
  const player = ctx.world.player;

  if (player.counterActive) {
    if (!tryConvertIncoming(ctx)) {
      player.counterWindowRemaining -= ctx.dt;
      if (player.counterWindowRemaining <= 0) {
        // Attempted and missed: `counterAttempts` was already counted on the
        // press, and no success is recorded.
        closeCounterWindow(ctx);
      }
    }
  }

  if (!ctx.input.buttons.counter.pressed) return;
  if (player.counterActive || player.counterCooldownRemaining > 0) return;

  player.counterActive = true;
  player.counterWindowRemaining = counterWindowSeconds(ctx);
  player.counterAttempts += 1;
  ctx.events.emit('combat:counterWindow', {
    position: clone(player.position),
    opening: true,
  });
  // A shot already on top of the player should land on the frame the window
  // opens, not a step later.
  tryConvertIncoming(ctx);
}

// ---------------------------------------------------------------------------
// Fire input
// ---------------------------------------------------------------------------

function updateFire(ctx: SimContext): void {
  const player = ctx.world.player;
  const combat = ctx.combat;
  const fire = ctx.input.buttons.fire;

  if (fire.down) {
    player.isCharging = true;
    // `heldSeconds` is where `InputSettings.holdToCharge` has already been
    // resolved: in toggle mode the input layer keeps reporting the button as
    // held after a tap and keeps the counter running, so the same code charges
    // under either setting. The dt fallback covers sources that do not track
    // hold time.
    player.chargeHeldSeconds =
      fire.heldSeconds > 0 ? fire.heldSeconds : player.chargeHeldSeconds + ctx.dt;

    const tier = chargeTierFor(combat.chargeTierSeconds, player.chargeHeldSeconds);
    if (tier > player.chargeTier) {
      muzzleInto(scratchOrigin, ctx);
      for (let next = player.chargeTier + 1; next <= tier; next++) {
        ctx.events.emit('combat:chargeTier', {
          tier: next,
          position: clone(scratchOrigin),
          hz: harmonicHz(next),
        });
      }
      player.chargeTier = tier;
    }
  } else {
    player.isCharging = false;
  }

  if (fire.pressed && !tryHarmonicBurst(ctx) && player.fireCooldown <= 0) {
    firePulse(ctx);
  }

  if (fire.released) {
    if (player.chargeTier > 0) fireCharged(ctx, player.chargeTier);
    player.chargeHeldSeconds = 0;
    player.chargeTier = 0;
    player.isCharging = false;
  }
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export const combatSystem: System = (ctx: SimContext): void => {
  const world = ctx.world;
  const player = world.player;
  const dt = ctx.dt;
  if (world.paused || dt <= 0) return;

  // -- timers ---------------------------------------------------------------
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.burstCooldown = Math.max(0, player.burstCooldown - dt);
  player.counterCooldownRemaining = Math.max(0, player.counterCooldownRemaining - dt);
  // Mercy invulnerability is real-world recovery time, so hit-stop must not
  // stretch it.
  player.invulnerableRemaining = Math.max(0, player.invulnerableRemaining - ctx.rawDt);

  const controllable = isPlayerControlled(ctx);

  player.resonanceSightActive = controllable && ctx.input.buttons.resonanceSight.down;

  updateLockOn(ctx, controllable);
  resolveAim(ctx);

  if (!controllable) {
    player.isCharging = false;
    player.chargeHeldSeconds = 0;
    player.chargeTier = 0;
    if (player.counterActive) closeCounterWindow(ctx);
    return;
  }

  updateCounter(ctx);
  updateFire(ctx);
};
