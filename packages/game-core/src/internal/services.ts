import { DEG2RAD, WORLD_CHORD_HZ, clamp, clone, harmonicHz, set, vec3 } from '@tuner/shared';
import type {
  DamageKind,
  DifficultyProfile,
  EntityId,
  EventBus,
  IdAllocator,
  ResonanceFormId,
  Rng,
  Vec3,
} from '@tuner/shared';
import { Layer } from '@tuner/physics';
import type { ColliderDescriptor, PhysicsWorld } from '@tuner/physics';
import type { AccessibilityConfig, CombatConfig } from '../config.js';
import type { ContentBundle, EnemyArchetypeDef, StageDef } from '../content-types.js';
import type { GameEvents } from '../events.js';
import type { FormBehaviour } from '../forms.js';
import type { SimContext, SimServices } from './context.js';
import type {
  MutableBoss,
  MutableEnemy,
  MutableProjectile,
  MutableResonator,
  MutableWorld,
} from './world.js';

/**
 * The cross-system rule book.
 *
 * Damage, spawning, shake, hit-stop and stage flags are needed by several
 * systems at once, and every one of them carries rules — armour and armour
 * breakers, form advantages, invulnerability, difficulty scaling, and the
 * event emission that the renderer and the accessibility layer depend on.
 * Implementing them once here is what stops those rules from drifting apart
 * across callers.
 *
 * **Accessibility contract.** Every gameplay-critical outcome that produces a
 * sound also emits a `GameEvents` entry carrying a world position and enough
 * detail to draw the equivalent visual: `combat:hit` (with `blocked` and
 * `weakness` so a deflect reads differently from a weak point),
 * `combat:enemyCleansed`, `combat:playerHurt`, `combat:playerDowned`,
 * `combat:fired`, `stage:objectiveChanged` and `ui:subtitle`. Nothing here is
 * announced by audio alone.
 *
 * **Liveness.** `createSimServices` reads every dependency off the `deps`
 * object on each call rather than destructuring it once, so the game loop can
 * build one services object at start-up and keep mutating the same holder as
 * configs, the stage definition and the equipped form change. A `SimContext`
 * backing object satisfies `SimServicesDeps` structurally, which is the
 * intended way to wire this up.
 */

// ---------------------------------------------------------------------------
// Shape constants
// ---------------------------------------------------------------------------

/** Gap between the repeats of an Echo Form shot, in seconds. */
export const DEFAULT_ECHO_DELAY_SECONDS = 0.12;

/** Body size used when an enemy's archetype is missing from the bundle. */
export const DEFAULT_ENEMY_BODY_RADIUS = 0.5;
export const DEFAULT_ENEMY_BODY_HEIGHT = 1.6;

/** Tag written onto conjured platform colliders so the stage runtime can spot them. */
export const CONJURED_PLATFORM_TAG = 'conjured';

/** Damage multiplier applied while a boss is inside its punish window. */
export const BOSS_VULNERABLE_DAMAGE_SCALE = 1.5;

/** Screen shake requested when the player is hurt. */
export const HURT_SHAKE_MAGNITUDE = 0.45;
export const HURT_SHAKE_SECONDS = 0.22;

/**
 * Height of the Auralith ring above the player's feet, as a fraction of the
 * body height. Shots leave from here, aim cones start here, and the counter
 * reach is measured from here — using the feet instead would make every shot
 * pass under a short enemy and make the counter's forward test wrong the
 * moment the player looked up.
 */
export const MUZZLE_HEIGHT_RATIO = 0.7;

const NO_BREAKERS: readonly DamageKind[] = [];

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * What the services need. Fields are read live on every call — pass a holder
 * the game loop keeps mutating rather than a snapshot.
 */
export interface SimServicesDeps {
  readonly world: MutableWorld;
  readonly physics: PhysicsWorld;
  readonly events: EventBus<GameEvents>;
  readonly ids: IdAllocator;
  readonly rng: Rng;
  readonly combat: CombatConfig;
  readonly accessibility: AccessibilityConfig;
  readonly difficultyProfile: DifficultyProfile;
  readonly content: ContentBundle;
  readonly stageDef: StageDef | null;
  readonly formBehaviour: FormBehaviour | null;
}

// ---------------------------------------------------------------------------
// Pure helpers, shared with the combat and projectile systems
// ---------------------------------------------------------------------------

export function enemyArchetypeOf(
  content: ContentBundle,
  enemy: MutableEnemy,
): EnemyArchetypeDef | null {
  return content.enemies[enemy.archetype] ?? null;
}

/** Radius used for hit tests against an enemy body. */
export function enemyRadiusOf(content: ContentBundle, enemy: MutableEnemy): number {
  return content.enemies[enemy.archetype]?.bodyRadius ?? DEFAULT_ENEMY_BODY_RADIUS;
}

/**
 * Mid-body point of an enemy. Positions are feet, as everywhere else in the
 * simulation, so aiming and cone tests have to lift to the centre or every
 * shot passes under a tall enemy's chin.
 */
export function enemyCentreInto(
  target: Vec3,
  enemy: MutableEnemy,
  content: ContentBundle,
): Vec3 {
  const height = content.enemies[enemy.archetype]?.bodyHeight ?? DEFAULT_ENEMY_BODY_HEIGHT;
  return set(target, enemy.position.x, enemy.position.y + height * 0.5, enemy.position.z);
}

export function bossCentreInto(
  target: Vec3,
  boss: MutableBoss,
  content: ContentBundle,
): Vec3 {
  const height = content.bosses[boss.definitionId]?.bodyHeight ?? DEFAULT_ENEMY_BODY_HEIGHT;
  return set(target, boss.position.x, boss.position.y + height * 0.5, boss.position.z);
}

export function bossRadiusOf(content: ContentBundle, boss: MutableBoss): number {
  return content.bosses[boss.definitionId]?.bodyRadius ?? DEFAULT_ENEMY_BODY_RADIUS;
}

/** The point shots leave from, and that aim and counter reach are measured from. */
export function muzzleInto(target: Vec3, ctx: SimContext): Vec3 {
  const position = ctx.world.player.position;
  return set(
    target,
    position.x,
    position.y + ctx.movement.bodyHeight * MUZZLE_HEIGHT_RATIO,
    position.z,
  );
}

/** True when the player's current form may ring this resonator. */
export function canStrikeResonator(
  resonator: MutableResonator,
  form: ResonanceFormId,
): boolean {
  if (resonator.locked) return false;
  if (resonator.requiresForm !== null && resonator.requiresForm !== form) return false;
  return true;
}

/**
 * Rings a resonator.
 *
 * Puzzle progress belongs to the stage system, so this only *announces* the
 * strike — with the degree, the frequency and a world position, so the audio
 * engine can sound the note and the renderer can draw it. A player with the
 * sound off still sees which note was struck.
 */
export function strikeResonator(
  events: EventBus<GameEvents>,
  resonator: MutableResonator,
): void {
  events.emit('puzzle:noteStruck', {
    puzzleId: resonator.puzzleId,
    degree: resonator.degree,
    hz: harmonicHz(resonator.degree),
    position: clone(resonator.position),
  });
}

/**
 * Damage multiplier a form enjoys against a definition.
 *
 * Advantages live on `BossDef.formAdvantages` and are always at or above one —
 * a form makes a fight *different*, and sometimes shorter, but never opens a
 * door that was otherwise shut. Enemy archetypes that share an id with a boss
 * definition (mini-bosses instantiated into the enemy list) inherit the same
 * table, which is why this takes a plain key rather than a boss.
 */
export function formAdvantageFor(
  content: ContentBundle,
  definitionId: string,
  form: ResonanceFormId,
): number {
  const boss = content.bosses[definitionId];
  if (boss === undefined) return 1;
  const advantage = boss.formAdvantages[form];
  if (advantage === undefined || !Number.isFinite(advantage) || advantage <= 0) return 1;
  return advantage;
}

/** True when this damage channel gets through the enemy's plating. */
export function breaksArmour(
  content: ContentBundle,
  enemy: MutableEnemy,
  kind: DamageKind,
): boolean {
  if (enemy.armour <= 0) return true;
  const breakers = content.enemies[enemy.archetype]?.armourBreakers ?? NO_BREAKERS;
  return breakers.includes(kind);
}

/**
 * Retires the oldest live player shots until at most `max` remain.
 *
 * Projectiles are appended in spawn order, so the oldest is simply the first
 * live one. Retiring rather than refusing to spawn is deliberate: the newest
 * shot is the one the player just asked for, and dropping it feels like the
 * button did not work.
 *
 * Entries are only marked dead here — never spliced — because this can run
 * while the projectile system is iterating the array.
 */
export function retireOldestPlayerProjectiles(world: MutableWorld, max: number): void {
  const limit = Math.max(0, Math.floor(max));
  let live = 0;
  for (const projectile of world.projectiles) {
    if (!projectile.dead && projectile.owner === 'player') live++;
  }
  let excess = live - limit;
  if (excess <= 0) return;
  for (let i = 0; i < world.projectiles.length && excess > 0; i++) {
    const projectile = world.projectiles[i];
    if (projectile === undefined || projectile.dead || projectile.owner !== 'player') continue;
    projectile.dead = true;
    excess--;
  }
}

/**
 * Applies damage to the Commander.
 *
 * `SimServices` has no `damageBoss` — the boss runtime owns phase transitions
 * and the restoration sequence — so this stays a free function that the
 * projectile system calls. It reduces health, honours form advantage and the
 * punish window, and emits the same `combat:hit` the renderer already draws
 * for enemies. It deliberately does **not** set `defeated`: at zero health a
 * Commander enters retuning, and that is the boss system's decision to make.
 */
export function damageBoss(
  ctx: SimContext,
  boss: MutableBoss,
  amount: number,
  kind: DamageKind,
  form: ResonanceFormId,
  hitPoint: Vec3,
  hitNormal: Vec3,
): void {
  if (amount <= 0 || boss.defeated || boss.restoring) return;

  const advantage = formAdvantageFor(ctx.content, boss.definitionId, form);
  const vulnerable = boss.vulnerable;
  const dealt = amount * advantage * (vulnerable ? BOSS_VULNERABLE_DAMAGE_SCALE : 1);
  boss.health = Math.max(0, boss.health - dealt);

  ctx.events.emit('combat:hit', {
    targetId: boss.id,
    position: clone(hitPoint),
    normal: clone(hitNormal),
    damage: dealt,
    kind,
    blocked: false,
    weakness: advantage > 1 || vulnerable,
  });
}

// ---------------------------------------------------------------------------
// The services
// ---------------------------------------------------------------------------

export function createSimServices(deps: SimServicesDeps): SimServices {
  // Closure-level scratch: reused every call, and not shared between worlds.
  const scratchCentre = vec3();

  const emitShake = (magnitude: number, seconds: number): void => {
    const scaled = magnitude * deps.accessibility.screenShakeScale;
    if (scaled <= 0 || seconds <= 0) return;
    const camera = deps.world.camera;
    camera.shake = Math.max(camera.shake, scaled);
    deps.events.emit('fx:shake', { magnitude: scaled, seconds });
  };

  const services: SimServices = {
    spawnProjectile(spec) {
      const world = deps.world;
      const direction = spec.direction;
      const length = Math.sqrt(
        direction.x * direction.x + direction.y * direction.y + direction.z * direction.z,
      );
      // A zero direction would produce a stationary shot that lingers for its
      // whole lifetime; default it forward along -Z instead.
      const dx = length > 1e-9 ? direction.x / length : 0;
      const dy = length > 1e-9 ? direction.y / length : 0;
      const dz = length > 1e-9 ? direction.z / length : -1;
      const speed = spec.speed;
      const echoes = spec.echoes ?? 0;

      const projectile: MutableProjectile = {
        id: deps.ids.next(),
        owner: spec.owner,
        ownerId: spec.ownerId,
        position: vec3(spec.position.x, spec.position.y, spec.position.z),
        velocity: vec3(dx * speed, dy * speed, dz * speed),
        radius: spec.radius,
        damage: spec.damage,
        damageKind: spec.damageKind,
        form: spec.form,
        tier: spec.tier ?? 0,
        lifeRemaining: spec.lifeSeconds,
        echoesRemaining: echoes,
        echoDelay: echoes > 0 ? DEFAULT_ECHO_DELAY_SECONDS : 0,
        bouncesRemaining: spec.bounces ?? 0,
        reflected: false,
        counterable: spec.counterable ?? false,
        hz: spec.hz ?? WORLD_CHORD_HZ,
        gravityScale: spec.gravityScale ?? 0,
        homingTarget: spec.homingTarget ?? null,
        homingStrength: spec.homingStrength ?? 0,
        dead: false,
      };

      world.projectiles.push(projectile);
      if (projectile.owner === 'player') {
        retireOldestPlayerProjectiles(world, deps.combat.maxPlayerProjectiles);
      }

      deps.events.emit('combat:fired', {
        projectileId: projectile.id,
        position: clone(projectile.position),
        direction: vec3(dx, dy, dz),
        form: projectile.form,
        tier: projectile.tier,
        hz: projectile.hz,
      });

      return projectile;
    },

    damageEnemy(enemy, amount, kind, form, hitPoint, hitNormal) {
      if (enemy.dead || amount <= 0) return;

      const world = deps.world;
      const content = deps.content;
      const blocked = false;

      let dealt = 0;
      let weakness = false;
      if (!blocked) {
        const advantage = formAdvantageFor(content, enemy.archetype, form);
        weakness = advantage > 1;
        dealt = amount * advantage;
        enemy.health = Math.max(0, enemy.health - dealt);
      }

      // Always emitted, blocked or not: the renderer needs somewhere to put the
      // spark, and a deflect must read differently from a weak point with the
      // sound off. `damage` is what actually landed, so a block reports zero.
      deps.events.emit('combat:hit', {
        targetId: enemy.id,
        position: clone(hitPoint),
        normal: clone(hitNormal),
        damage: dealt,
        kind,
        blocked,
        weakness,
      });

      if (!blocked && enemy.health <= 0) {
        enemy.health = 0;
        enemy.dead = true;
        enemy.phase = 'dead';
        world.stage.enemiesCleansed += 1;
        deps.events.emit('combat:enemyCleansed', {
          enemyId: enemy.id,
          position: clone(enemy.position),
          archetype: enemy.archetype,
        });
      }
    },

    damagePlayer(amount, source, sourcePosition) {
      const world = deps.world;
      const player = world.player;
      if (amount <= 0) return;
      // Mercy invulnerability and being downed both swallow the hit outright,
      // so a crowd cannot chain-stun a player out of a recovery.
      if (player.invulnerableRemaining > 0) return;
      if (player.movementState === 'downed') return;

      const scaled = amount * deps.difficultyProfile.incomingDamageScale;
      if (scaled <= 0) return;

      player.coherence = Math.max(0, player.coherence - scaled);
      player.invulnerableRemaining = deps.combat.invulnerableSeconds;
      player.hurtThisStep = true;
      world.stage.damageTaken += scaled;
      if (player.coherence < world.stage.lowestCoherence) {
        world.stage.lowestCoherence = player.coherence;
      }

      deps.events.emit('combat:playerHurt', {
        position: clone(player.position),
        damage: scaled,
        coherence: player.coherence,
        source,
      });
      // The source point is what lets the renderer put the damage indicator on
      // the right side of the screen; there is no field for it on the event, so
      // it drives the impulse instead.
      emitShake(
        HURT_SHAKE_MAGNITUDE * (sourcePosition === null ? 1 : 1.15),
        HURT_SHAKE_SECONDS,
      );

      if (player.coherence <= 0) {
        player.previousMovementState = player.movementState;
        player.movementState = 'downed';
        player.stateTime = 0;
        deps.events.emit('combat:playerDowned', { position: clone(player.position) });
      }
    },

    restoreCoherence(amount) {
      if (amount <= 0) return;
      const player = deps.world.player;
      player.coherence = Math.min(player.maxCoherence, player.coherence + amount);
    },

    spawnConjuredPlatform(position, radius, lifeSeconds, form) {
      if (radius <= 0 || lifeSeconds <= 0) return;
      const id = deps.ids.next();
      // A real collider on the moving-platform layer, so the player's capsule
      // stands on it through the same collide-and-slide path as authored
      // geometry. The handle is kept so expiry can take it back out again.
      const descriptor: ColliderDescriptor = {
        id: `conjured-${String(id)}`,
        shape: { kind: 'sphere', radius },
        position: vec3(position.x, position.y, position.z),
        layer: Layer.MovingPlatform,
        owner: id,
        tag: CONJURED_PLATFORM_TAG,
      };
      const collider = deps.physics.addCollider(descriptor);
      deps.world.conjured.push({
        id,
        form,
        position: vec3(position.x, position.y, position.z),
        radius,
        lifeRemaining: lifeSeconds,
        maxLife: lifeSeconds,
        collider,
      });
    },

    requestShake(magnitude, seconds) {
      emitShake(magnitude, seconds);
    },

    requestHitStop(seconds) {
      if (seconds <= 0) return;
      const world = deps.world;
      world.hitStopRemaining = Math.max(world.hitStopRemaining, seconds);
      deps.events.emit('fx:hitStop', { seconds });
    },

    findEnemy(id: EntityId) {
      for (const enemy of deps.world.enemies) {
        if (enemy.id === id) return enemy;
      }
      return null;
    },

    findNearestEnemy(origin, direction, maxDistance, coneDegrees) {
      if (maxDistance <= 0) return null;
      const length = Math.sqrt(
        direction.x * direction.x + direction.y * direction.y + direction.z * direction.z,
      );
      if (length < 1e-9) return null;
      const dx = direction.x / length;
      const dy = direction.y / length;
      const dz = direction.z / length;
      const cosLimit = Math.cos(clamp(coneDegrees, 0, 180) * DEG2RAD);

      let best: MutableEnemy | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const enemy of deps.world.enemies) {
        if (enemy.dead) continue;
        enemyCentreInto(scratchCentre, enemy, deps.content);
        const tx = scratchCentre.x - origin.x;
        const ty = scratchCentre.y - origin.y;
        const tz = scratchCentre.z - origin.z;
        const distance = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (distance > maxDistance) continue;
        if (distance > 1e-6) {
          const cosAngle = (tx * dx + ty * dy + tz * dz) / distance;
          if (cosAngle < cosLimit) continue;
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          best = enemy;
        }
      }
      return best;
    },

    setStageFlag(flag) {
      deps.world.stage.flags.add(flag);
    },

    hasStageFlag(flag) {
      return deps.world.stage.flags.has(flag);
    },

    setObjective(text) {
      const stage = deps.world.stage;
      if (stage.objective === text) return;
      stage.objective = text;
      deps.events.emit('stage:objectiveChanged', {
        stageId: stage.stageId,
        objective: text,
      });
    },

    showSubtitle(speaker, text, seconds) {
      deps.events.emit('ui:subtitle', { speaker, text, seconds });
    },
  };

  return services;
}
