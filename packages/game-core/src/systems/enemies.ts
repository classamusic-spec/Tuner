import {
  DEG2RAD,
  DETUNED_HZ,
  GRAVITY,
  TAU,
  clamp,
  copy,
  distance,
  distanceXZ,
  dot,
  moveTowardsAngle,
  set,
  vec3,
} from '@tuner/shared';
import type { EntityId, ResonanceFormId, Vec3 } from '@tuner/shared';
import { SOLID_MASK } from '@tuner/physics';
import type { EnemyArchetypeDef } from '../content-types.js';
import type { SimContext, System } from '../internal/context.js';
import type { MutableEnemy } from '../internal/world.js';
import { enemyArchetypeOf, enemyCentreInto } from '../internal/services.js';
import type { EnemyPhase } from '../state.js';

/**
 * The enemy framework.
 *
 * There is no per-enemy code anywhere in this file. Every unit in the bestiary
 * is driven from its {@link EnemyArchetypeDef}: the nine `EnemyRole` values
 * select a *behaviour*, and the numbers on the archetype supply the tuning.
 * Adding a new Detuner is a content edit, not a code edit — which is what keeps
 * the bestiary honest, because a designer cannot quietly give one unit a rule
 * that the rest of the game does not play by.
 *
 * **The nine roles.**
 * - `scout` — patrols, closes when it sees you, and *raises the alarm*: every
 *   other enemy inside {@link SCOUT_ALERT_RADIUS} is handed the target. Kill
 *   the scout first, or fight the room.
 * - `turret` — bolted down. Rotates to face, telegraphs, fires a volley shaped
 *   by `projectile.count` / `projectile.spreadRadians`. Denies ground.
 * - `flyer` — hovers {@link FLYER_HOVER_HEIGHT} above the player, strafes to
 *   keep its angle, and dives. It pressures the jumping route rather than the
 *   ground route, so a stage's aerial path is never a free ride.
 * - `shield` — advances behind frontal armour, smashes, and then *opens*: for
 *   {@link SHIELD_OPENING_SECONDS} its plate is down (`armour` drops to zero)
 *   and it stops tracking, so getting behind it — or answering with a charged
 *   shot or a counter — is the fight.
 * - `pursuer` — chases relentlessly, but its heading turns at no more than
 *   `turnSpeed` radians a second, so it can be out-manoeuvred. Relentless is
 *   not the same as unavoidable.
 * - `spawner` — telegraphs, then emits `spawns.archetype` every
 *   `spawns.interval` up to `spawns.max` live children. Children carry
 *   `spawnerId`; cleansing the parent stops production immediately.
 * - `hazard` — a moving obstacle. Walks its patrol, damages on contact, and
 *   never chases. A corridor of them is a routing puzzle, not a fight.
 * - `mimic` — copies the player's equipped form into `mimickedForm` and returns
 *   it as shots, re-copying the moment the player switches.
 * - `elite` — alternates a ranged pattern and a closing melee pattern, and its
 *   heavy attack leaves it staggered and unarmoured for
 *   {@link ELITE_STAGGER_SECONDS}. Multi-phase without being a boss.
 *
 * **Readability is a rule, not a preference.** Every attack runs through one
 * path: `beginTelegraph` → wind-up → `releaseAttack`. During the wind-up the
 * enemy writes `telegraphRemaining` / `telegraphTotal` and sets `phase` to
 * `'attack'`, and the projector turns those into `telegraphing` and
 * `telegraphProgress`. That is the accessibility contract for attacks: the
 * timing ring is drawn from simulation state that updates every step, so a
 * player with the sound off reads exactly the same wind-up as one with
 * headphones on. Nothing here announces an attack by audio alone — shots emit
 * `combat:fired` through `spawnProjectile`, landed hits emit
 * `combat:playerHurt` through `damagePlayer`, heavy blows request `fx:shake`,
 * and a raised alarm is visible as other enemies flipping to `phase: 'alert'`.
 *
 * **Difficulty touches cadence, never health.** `enemyAggressionScale` divides
 * the archetype's `attackCooldown` and `telegraphSeconds`, both floored so no
 * difficulty can produce an unreadable wind-up. `health`, `maxHealth` and
 * `armour` are never scaled — a harder fight is a busier fight, not a longer
 * one.
 *
 * **Cleansing, not killing.** An archetype marked `cleansable` is infected
 * wildlife or a corrupted guardian, not an invader. At zero health it enters
 * `phase: 'cleansing'` for {@link CLEANSE_SECONDS} before `dead` is set, so the
 * renderer plays a restoration rather than a death. The distinction matters to
 * the story, so the simulation makes it structural.
 */

// ---------------------------------------------------------------------------
// Shape constants
// ---------------------------------------------------------------------------

/** Seconds an alerted enemy keeps its target after line of sight breaks. */
export const SIGHT_MEMORY_SECONDS = 2.5;

/** Radius within which a scout's alarm hands the target to other enemies. */
export const SCOUT_ALERT_RADIUS = 12;

/** Length of the restoration beat played before a cleansable unit is removed. */
export const CLEANSE_SECONDS = 0.65;

/** Floor on a wind-up. No difficulty may produce an attack that cannot be read. */
export const MIN_TELEGRAPH_SECONDS = 0.2;

/** Floor on the gap between attacks, so aggression cannot become a machine gun. */
export const MIN_COOLDOWN_SECONDS = 0.25;

/** Bounds applied to `enemyAggressionScale` before it is used as a divisor. */
export const MIN_AGGRESSION_SCALE = 0.25;
export const MAX_AGGRESSION_SCALE = 4;

/** How close a patrolling unit must get to a waypoint before taking the next. */
export const PATROL_ARRIVE_RADIUS = 0.7;

/** Fraction of `moveSpeed` used while patrolling — patrols read as unhurried. */
export const PATROL_SPEED_SCALE = 0.55;

/** How close to home counts as home again. */
export const HOME_ARRIVE_RADIUS = 0.8;

/** Seconds spent in `recover` after an attack before returning to `alert`. */
export const RECOVER_SECONDS = 0.35;

/** Height a flyer holds above the player's feet. */
export const FLYER_HOVER_HEIGHT = 3.4;

/** Horizontal distance a melee flyer orbits at while waiting for its dive. */
export const FLYER_ORBIT_RADIUS = 4.5;

/** Seconds before a flyer reverses its strafe. Slow enough to be learnable. */
export const FLYER_STRAFE_SECONDS = 1.8;

/** Length of a dive, in seconds. */
export const FLYER_DIVE_SECONDS = 0.45;

/** Speed multiplier applied to `moveSpeed` during a dive. */
export const FLYER_DIVE_SPEED_SCALE = 2.2;

/** Horizontal distance inside which a flyer commits to a dive. */
export const FLYER_DIVE_RANGE = 6;

/** Gain applied to a flyer's vertical error when settling onto its hover line. */
export const FLYER_VERTICAL_GAIN = 2.4;

/** Seconds a shield's plate stays down after its own smash. */
export const SHIELD_OPENING_SECONDS = 1.1;

/** Attacks an elite makes in one pattern before switching to the other. */
export const ELITE_ATTACKS_PER_PATTERN = 2;

/** Seconds an elite is staggered — and unarmoured — after a heavy attack. */
export const ELITE_STAGGER_SECONDS = 1.2;

/** Fraction of `attackRadius` an elite holds while in its ranged pattern. */
export const ELITE_RANGED_STANDOFF = 0.8;

/**
 * Fraction of `attackRadius` an elite's *closing* pattern reaches.
 *
 * An elite's `attackRadius` describes its ranged threat, which for a Conductor
 * is sixteen metres. Reusing that number for the melee stance would let a
 * staff-swing land from across the arena, so the closing pattern derives its
 * own reach — never shorter than the two bodies plus a lunge.
 */
export const ELITE_MELEE_RANGE_SCALE = 0.25;

/** Shortest melee reach an elite may have, added to the two body radii. */
export const ELITE_MELEE_LUNGE = 1;

/** Fraction of `attackRadius` a mimic duels at. */
export const MIMIC_STANDOFF = 0.65;

/** Damage multiplier on a heavy attack, relative to `contactDamage`. */
export const HEAVY_DAMAGE_SCALE = 1.6;

/** Cooldown multiplier applied after a heavy attack. */
export const HEAVY_COOLDOWN_SCALE = 1.4;

export const HEAVY_SHAKE_MAGNITUDE = 0.4;
export const HEAVY_SHAKE_SECONDS = 0.22;

/** Gap left between a spawner's body and the child it emits. */
export const SPAWN_RING_GAP = 0.55;

/** Extra vertical slack allowed when testing whether an attack can reach. */
export const ATTACK_VERTICAL_SLACK = 1;

/** Steepest surface an enemy walks up, in radians from vertical. */
export const ENEMY_MAX_SLOPE_RADIANS = 50 * DEG2RAD;

/** Lip an enemy steps over without jumping. */
export const ENEMY_STEP_HEIGHT = 0.45;

/** Terminal velocity for a falling ground unit. */
export const ENEMY_MAX_FALL_SPEED = 38;

/** Push-back applied after a flyer's sweep so it never rests inside geometry. */
export const FLYER_SURFACE_SKIN = 1e-3;

/** Multiplier turning `attackRadius` into a shot's lifetime. */
export const SHOT_LIFE_SCALE = 2.5;

/** Shortest life granted to an enemy shot, in seconds. */
export const MIN_SHOT_LIFE_SECONDS = 1;

// ---------------------------------------------------------------------------
// Module scratch — the step loop must not allocate
// ---------------------------------------------------------------------------

const scratchSelf = vec3();
const scratchTarget = vec3();
const scratchDesired = vec3();
const scratchSteer = vec3();
const scratchSight = vec3();
const scratchShot = vec3();
const scratchOrigin = vec3();
const scratchMuzzle = vec3();

// ---------------------------------------------------------------------------
// Per-enemy memory
// ---------------------------------------------------------------------------

/**
 * Behaviour state that has no home on `MutableEnemy`.
 *
 * `MutableEnemy` is a fixed contract shared with the renderer, and none of this
 * is worth projecting: a flyer's strafe direction and an elite's pattern index
 * are how the behaviour is produced, not what the player needs drawn. Keying it
 * off the enemy object in a `WeakMap` keeps the contract untouched and lets a
 * removed enemy's memory be collected with it. Nothing iterates the map, so
 * determinism is unaffected.
 */
interface EnemyMemory {
  /** Seconds of target retention left after line of sight broke. */
  sightGrace: number;
  /** Last position the target was actually seen at. */
  lastSeen: Vec3;
  /** True once the unit has been walking home rather than patrolling. */
  returningHome: boolean;
  /** Committed movement heading, used by the rate-limited pursuer. */
  heading: number;
  headingInit: boolean;
  /** Strafe direction and the countdown to reversing it. */
  strafeSign: number;
  strafeRemaining: number;
  /** Remaining dive time for a flyer. */
  diveRemaining: number;
  /** Remaining window during which armour is down. */
  openingRemaining: number;
  /** Elite pattern: 0 = ranged, 1 = closing melee. */
  pattern: number;
  patternCount: number;
  /** What the current wind-up will produce. */
  pendingAttack: PendingAttack;
  /** Horizontal reach the pending attack was started at. */
  attackReach: number;
}

export type PendingAttack = 'none' | 'melee' | 'heavy' | 'volley' | 'dive' | 'spawn';

const memories = new WeakMap<MutableEnemy, EnemyMemory>();

function memoryOf(enemy: MutableEnemy): EnemyMemory {
  const existing = memories.get(enemy);
  if (existing !== undefined) return existing;
  const created: EnemyMemory = {
    sightGrace: 0,
    lastSeen: vec3(enemy.position.x, enemy.position.y, enemy.position.z),
    returningHome: false,
    heading: enemy.yaw,
    headingInit: false,
    strafeSign: 1,
    strafeRemaining: FLYER_STRAFE_SECONDS,
    diveRemaining: 0,
    openingRemaining: 0,
    pattern: 0,
    patternCount: 0,
    pendingAttack: 'none',
    attackReach: 0,
  };
  memories.set(enemy, created);
  return created;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Yaw for a horizontal direction, matching the movement system's convention. */
export function yawForDirection(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Unit forward vector for a yaw, matching {@link yawForDirection}. */
export function forwardInto(target: Vec3, yaw: number): Vec3 {
  return set(target, -Math.sin(yaw), 0, -Math.cos(yaw));
}

/** `enemyAggressionScale`, bounded so it is always a safe divisor. */
export function aggressionScaleOf(ctx: SimContext): number {
  const raw = ctx.difficultyProfile.enemyAggressionScale;
  if (!Number.isFinite(raw)) return 1;
  return clamp(raw, MIN_AGGRESSION_SCALE, MAX_AGGRESSION_SCALE);
}

/**
 * Seconds between attacks at the current difficulty. Higher aggression means
 * shorter gaps; the floor stops any difficulty from removing the gap entirely.
 */
export function attackCooldownSecondsFor(def: EnemyArchetypeDef, ctx: SimContext): number {
  return Math.max(MIN_COOLDOWN_SECONDS, def.attackCooldown / aggressionScaleOf(ctx));
}

/**
 * Wind-up length at the current difficulty. Floored at
 * {@link MIN_TELEGRAPH_SECONDS} — an attack the player cannot read is not a
 * difficulty setting.
 */
export function telegraphSecondsFor(def: EnemyArchetypeDef, ctx: SimContext): number {
  return Math.max(MIN_TELEGRAPH_SECONDS, def.telegraphSeconds / aggressionScaleOf(ctx));
}

/** Writes the player's mid-body point, which is what enemies aim at. */
export function playerCentreInto(target: Vec3, ctx: SimContext): Vec3 {
  const position = ctx.world.player.position;
  return set(target, position.x, position.y + ctx.movement.bodyHeight * 0.5, position.z);
}

/**
 * True when nothing solid stands between the two points.
 *
 * Enemies do not see through walls: this is what makes cover a real tactic and
 * what lets a stage teach a fight by controlling when it starts.
 */
export function hasLineOfSight(ctx: SimContext, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (span < 1e-4) return true;
  set(scratchSight, dx / span, dy / span, dz / span);
  const blocked = ctx.physics.raycast(from, scratchSight, span, SOLID_MASK, null);
  if (blocked === null) return true;
  return blocked.distance >= span - 1e-3;
}

/** Horizontal steering toward a point, stopping inside `arriveRadius`. */
function steerInto(
  out: Vec3,
  from: Vec3,
  to: Vec3,
  speed: number,
  arriveRadius: number,
): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const span = Math.sqrt(dx * dx + dz * dz);
  if (span <= arriveRadius || span < 1e-6 || speed <= 0) return set(out, 0, 0, 0);
  const scale = speed / span;
  return set(out, dx * scale, 0, dz * scale);
}

function setPhase(enemy: MutableEnemy, phase: EnemyPhase): void {
  if (enemy.phase === phase) return;
  enemy.phase = phase;
  enemy.phaseTime = 0;
}

/**
 * True when the player is close enough — and level enough — to be struck.
 *
 * `reach` defaults to the archetype's `attackRadius`, but a role may pass a
 * narrower one: an elite's staff-swing must not reach as far as its volley.
 */
export function inAttackRange(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  reach = def.attackRadius,
): boolean {
  const player = ctx.world.player;
  if (distanceXZ(enemy.position, player.position) > reach) return false;
  const selfCentre = enemy.position.y + def.bodyHeight * 0.5;
  const playerCentre = player.position.y + ctx.movement.bodyHeight * 0.5;
  const vertical = (def.bodyHeight + ctx.movement.bodyHeight) * 0.5 + ATTACK_VERTICAL_SLACK;
  return Math.abs(selfCentre - playerCentre) <= vertical;
}

/** The reach an elite's closing pattern strikes at. */
function eliteMeleeReach(ctx: SimContext, def: EnemyArchetypeDef): number {
  return Math.max(
    def.bodyRadius + ctx.movement.bodyRadius + ELITE_MELEE_LUNGE,
    def.attackRadius * ELITE_MELEE_RANGE_SCALE,
  );
}

/** True when the enemy may start a new wind-up this step. */
function canBeginAttack(enemy: MutableEnemy): boolean {
  return (
    enemy.attackCooldown <= 0 &&
    enemy.telegraphRemaining <= 0 &&
    enemy.silencedRemaining <= 0 &&
    enemy.staggerRemaining <= 0
  );
}

/**
 * Starts a wind-up.
 *
 * Deliberately emits no event: the wind-up is published as simulation state
 * (`telegraphRemaining`, `telegraphTotal`, `phase`) that the projector turns
 * into a timing ring every frame, which reads identically with the sound off.
 */
function beginTelegraph(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  attack: PendingAttack,
  scale = 1,
  reach = def.attackRadius,
): void {
  const seconds = Math.max(MIN_TELEGRAPH_SECONDS, telegraphSecondsFor(def, ctx) * scale);
  enemy.telegraphTotal = seconds;
  enemy.telegraphRemaining = seconds;
  memory.pendingAttack = attack;
  memory.attackReach = reach;
  setPhase(enemy, 'attack');
}

/** Interrupts a wind-up. This is what Silence Form buys the player. */
function cancelTelegraph(enemy: MutableEnemy, memory: EnemyMemory): void {
  if (enemy.telegraphRemaining <= 0 && memory.pendingAttack === 'none') return;
  enemy.telegraphRemaining = 0;
  enemy.telegraphTotal = 0;
  memory.pendingAttack = 'none';
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

/**
 * Fires the archetype's volley.
 *
 * Shots are laid out symmetrically about the aim line rather than jittered, so
 * a four-shot fan looks the same every time it is fired: patterns have to be
 * learnable, and randomised spread is the fastest way to make them not be.
 * `spawnProjectile` emits `combat:fired` for every shot, which is the audio and
 * visual cue in one.
 */
function fireVolley(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  form: ResonanceFormId,
): void {
  const spec = def.projectile;
  if (spec === undefined) return;

  enemyCentreInto(scratchOrigin, enemy, ctx.content);
  playerCentreInto(scratchTarget, ctx);
  let dx = scratchTarget.x - scratchOrigin.x;
  let dy = scratchTarget.y - scratchOrigin.y;
  let dz = scratchTarget.z - scratchOrigin.z;
  const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (span < 1e-6) {
    forwardInto(scratchShot, enemy.yaw);
    dx = scratchShot.x;
    dy = 0;
    dz = scratchShot.z;
  } else {
    dx /= span;
    dy /= span;
    dz /= span;
  }

  const horizontal = Math.sqrt(dx * dx + dz * dz);
  const baseAngle = horizontal < 1e-6 ? enemy.yaw : Math.atan2(dx, dz);
  const count = Math.max(1, Math.floor(spec.count ?? 1));
  const spread = spec.spreadRadians ?? 0;
  const speed = Math.max(1, spec.speed);
  const life = Math.max(MIN_SHOT_LIFE_SECONDS, (def.attackRadius / speed) * SHOT_LIFE_SCALE);
  const offset = def.bodyRadius + spec.radius + 0.05;
  const centreX = scratchOrigin.x;
  const centreY = scratchOrigin.y;
  const centreZ = scratchOrigin.z;

  for (let i = 0; i < count; i++) {
    const lane = count === 1 ? 0 : i / (count - 1) - 0.5;
    const angle = baseAngle + lane * spread;
    set(scratchShot, Math.sin(angle) * horizontal, dy, Math.cos(angle) * horizontal);
    // Leave from the muzzle rather than the body centre, so a wide fan does not
    // begin inside the enemy's own silhouette.
    set(
      scratchMuzzle,
      centreX + scratchShot.x * offset,
      centreY + scratchShot.y * offset,
      centreZ + scratchShot.z * offset,
    );
    ctx.services.spawnProjectile({
      owner: 'enemy',
      ownerId: enemy.id,
      position: scratchMuzzle,
      direction: scratchShot,
      speed,
      damage: spec.damage,
      damageKind: 'pulse',
      form,
      radius: spec.radius,
      lifeSeconds: life,
      hz: DETUNED_HZ,
      counterable: spec.counterable ?? false,
    });
  }
}

/** Emits one child from a spawner, ringed around its body. */
function spawnChild(ctx: SimContext, spawner: MutableEnemy, def: EnemyArchetypeDef): void {
  const spawns = def.spawns;
  if (spawns === undefined) return;
  const childDef = ctx.content.enemies[spawns.archetype];
  if (childDef === undefined) return;

  const angle = ctx.rng.next() * TAU;
  const ring = def.bodyRadius + childDef.bodyRadius + SPAWN_RING_GAP;
  const x = spawner.position.x + Math.sin(angle) * ring;
  const z = spawner.position.z + Math.cos(angle) * ring;
  const y = spawner.position.y;

  const child: MutableEnemy = {
    id: ctx.ids.next(),
    // Blank: runtime-spawned units have no entry in the stage's spawn list.
    spawnId: '',
    archetype: spawns.archetype,
    position: vec3(x, y, z),
    velocity: vec3(),
    yaw: angle,
    health: childDef.health,
    maxHealth: childDef.health,
    armour: childDef.armour ?? 0,
    phase: spawner.targetId === null ? 'idle' : 'alert',
    phaseTime: 0,
    attackCooldown: attackCooldownSecondsFor(childDef, ctx),
    telegraphRemaining: 0,
    telegraphTotal: 0,
    targetId: spawner.targetId,
    patrol: [],
    patrolIndex: 0,
    homePosition: vec3(x, y, z),
    grounded: false,
    mimickedForm: null,
    rootedRemaining: 0,
    silencedRemaining: 0,
    staggerRemaining: 0,
    cleanseRemaining: 0,
    spawnerId: spawner.id,
    spawnedCount: 0,
    spawnTimer: 0,
    guardsSecret: null,
    dead: false,
  };
  ctx.world.enemies.push(child);
}

/** Live children still tied to this spawner. */
export function countLiveChildren(ctx: SimContext, spawnerId: EntityId): number {
  let total = 0;
  for (const candidate of ctx.world.enemies) {
    if (candidate.dead) continue;
    if (candidate.spawnerId === spawnerId) total++;
  }
  return total;
}

/**
 * Resolves whatever the wind-up was building toward.
 *
 * Every landed blow goes through `services.damagePlayer`, which emits
 * `combat:playerHurt`; every shot goes through `services.spawnProjectile`,
 * which emits `combat:fired`. Heavy blows additionally request `fx:shake`. No
 * outcome here is announced by sound alone.
 */
function releaseAttack(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
): void {
  const kind = memory.pendingAttack;
  memory.pendingAttack = 'none';
  enemy.telegraphRemaining = 0;
  enemy.telegraphTotal = 0;
  setPhase(enemy, 'recover');

  const cooldown = attackCooldownSecondsFor(def, ctx);
  const source = `enemy:${def.id}`;
  const reach = memory.attackReach > 0 ? memory.attackReach : def.attackRadius;

  switch (kind) {
    case 'melee': {
      if (inAttackRange(ctx, enemy, def, reach)) {
        ctx.services.damagePlayer(def.contactDamage, source, enemy.position);
      }
      enemy.attackCooldown = cooldown;
      break;
    }
    case 'heavy': {
      if (inAttackRange(ctx, enemy, def, reach)) {
        ctx.services.damagePlayer(def.contactDamage * HEAVY_DAMAGE_SCALE, source, enemy.position);
      }
      ctx.services.requestShake(HEAVY_SHAKE_MAGNITUDE, HEAVY_SHAKE_SECONDS);
      enemy.attackCooldown = cooldown * HEAVY_COOLDOWN_SCALE;
      // The payoff for reading the wind-up: the plate comes down. A shield
      // stops tracking so its back is reachable; an elite is staggered outright.
      enemy.armour = 0;
      if (def.role === 'shield') {
        memory.openingRemaining = SHIELD_OPENING_SECONDS;
      } else {
        memory.openingRemaining = ELITE_STAGGER_SECONDS;
        enemy.staggerRemaining = ELITE_STAGGER_SECONDS;
        setPhase(enemy, 'stagger');
      }
      break;
    }
    case 'volley': {
      fireVolley(ctx, enemy, def, enemy.mimickedForm ?? 'base');
      enemy.attackCooldown = cooldown;
      break;
    }
    case 'dive': {
      memory.diveRemaining = FLYER_DIVE_SECONDS;
      enemy.attackCooldown = cooldown;
      break;
    }
    case 'spawn': {
      spawnChild(ctx, enemy, def);
      const spawns = def.spawns;
      enemy.spawnTimer = spawns === undefined ? 0 : Math.max(0, spawns.interval);
      enemy.attackCooldown = cooldown;
      break;
    }
    case 'none':
    default:
      break;
  }

  if (def.role === 'elite' && kind !== 'none' && kind !== 'spawn') {
    memory.patternCount += 1;
    if (memory.patternCount >= ELITE_ATTACKS_PER_PATTERN) {
      memory.patternCount = 0;
      memory.pattern = memory.pattern === 0 ? 1 : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

/** Hands this enemy's target to everyone nearby who has not noticed yet. */
function raiseAlarm(ctx: SimContext, scout: MutableEnemy, radius: number): void {
  const target = scout.targetId;
  if (target === null) return;
  for (const other of ctx.world.enemies) {
    if (other === scout || other.dead) continue;
    if (other.targetId !== null) continue;
    if (other.phase === 'cleansing' || other.phase === 'dead') continue;
    if (distance(other.position, scout.position) > radius) continue;
    other.targetId = target;
    setPhase(other, 'alert');
    const otherMemory = memoryOf(other);
    otherMemory.sightGrace = SIGHT_MEMORY_SECONDS;
    otherMemory.returningHome = false;
    copy(otherMemory.lastSeen, ctx.world.player.position);
  }
}

function perceive(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
): void {
  const player = ctx.world.player;
  enemyCentreInto(scratchSelf, enemy, ctx.content);
  playerCentreInto(scratchTarget, ctx);

  const reachable =
    player.movementState !== 'downed' &&
    distance(scratchSelf, scratchTarget) <= def.aggroRadius;
  const visible = reachable && hasLineOfSight(ctx, scratchSelf, scratchTarget);

  if (visible) {
    const firstSight = enemy.targetId === null;
    enemy.targetId = player.id;
    memory.sightGrace = SIGHT_MEMORY_SECONDS;
    memory.returningHome = false;
    copy(memory.lastSeen, player.position);
    if (firstSight && def.role === 'scout') {
      raiseAlarm(ctx, enemy, SCOUT_ALERT_RADIUS);
    }
    return;
  }

  if (enemy.targetId === null) return;
  memory.sightGrace = Math.max(0, memory.sightGrace - dt);
  if (memory.sightGrace > 0) return;
  enemy.targetId = null;
  memory.returningHome = true;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function patrolInto(
  out: Vec3,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  speed: number,
): Vec3 {
  const route = enemy.patrol;
  if (route.length === 0) {
    steerInto(out, enemy.position, enemy.homePosition, speed, HOME_ARRIVE_RADIUS);
    if (def.flying === true) {
      out.y = clamp(
        (enemy.homePosition.y - enemy.position.y) * FLYER_VERTICAL_GAIN,
        -speed,
        speed,
      );
    }
    return out;
  }

  const size = route.length;
  const index = ((enemy.patrolIndex % size) + size) % size;
  const point = route[index];
  if (point === undefined) return set(out, 0, 0, 0);

  const span =
    def.flying === true
      ? distance(enemy.position, point)
      : distanceXZ(enemy.position, point);
  if (span <= PATROL_ARRIVE_RADIUS) {
    enemy.patrolIndex = (index + 1) % size;
  }

  steerInto(out, enemy.position, point, speed, 0);
  if (def.flying === true) {
    out.y = clamp((point.y - enemy.position.y) * FLYER_VERTICAL_GAIN, -speed, speed);
  }
  return out;
}

function integrateGround(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  desired: Vec3,
  dt: number,
): void {
  enemy.velocity.x = desired.x;
  enemy.velocity.z = desired.z;
  enemy.velocity.y = Math.max(ENEMY_MAX_FALL_SPEED * -1, enemy.velocity.y + GRAVITY * dt);

  const result = ctx.physics.moveCharacter({
    position: enemy.position,
    velocity: enemy.velocity,
    radius: def.bodyRadius,
    height: def.bodyHeight,
    deltaSeconds: dt,
    mask: SOLID_MASK,
    maxSlopeRadians: ENEMY_MAX_SLOPE_RADIANS,
    stepHeight: ENEMY_STEP_HEIGHT,
    snapToGround: true,
  });

  copy(enemy.position, result.position);
  copy(enemy.velocity, result.velocity);
  enemy.grounded = result.grounded;
  if (result.grounded && enemy.velocity.y < 0) enemy.velocity.y = 0;
}

/**
 * Free flight with a swept-sphere guard.
 *
 * Flyers are not run through `moveCharacter` — they have no ground contract —
 * but they still must not enter geometry, or a dive would end inside a wall and
 * the player would be hit by something they cannot see.
 */
function integrateFlying(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  desired: Vec3,
  dt: number,
): void {
  copy(enemy.velocity, desired);
  enemy.grounded = false;

  const dx = desired.x * dt;
  const dy = desired.y * dt;
  const dz = desired.z * dt;
  const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (span < 1e-9) return;

  set(scratchSteer, dx / span, dy / span, dz / span);
  const blocked = ctx.physics.sweepSphere(
    enemy.position,
    scratchSteer,
    def.bodyRadius,
    span,
    SOLID_MASK,
    null,
  );
  const travel =
    blocked === null
      ? span
      : Math.max(0, Math.min(span, blocked.time * span) - FLYER_SURFACE_SKIN);

  enemy.position.x += scratchSteer.x * travel;
  enemy.position.y += scratchSteer.y * travel;
  enemy.position.z += scratchSteer.z * travel;

  if (blocked !== null) {
    // Strip the component heading into the surface so the flyer slides along it
    // instead of grinding at a corner.
    const into = dot(enemy.velocity, blocked.normal);
    if (into < 0) {
      enemy.velocity.x -= blocked.normal.x * into;
      enemy.velocity.y -= blocked.normal.y * into;
      enemy.velocity.z -= blocked.normal.z * into;
    }
  }
}

function integrate(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  desired: Vec3,
  dt: number,
): void {
  if (def.moveSpeed <= 0) {
    // Bolted in place: pylons, pods and rooted blooms keep their authored
    // position exactly, so a stage's sightlines stay as they were authored.
    set(enemy.velocity, 0, 0, 0);
    return;
  }
  if (def.flying === true) {
    integrateFlying(ctx, enemy, def, desired, dt);
    return;
  }
  integrateGround(ctx, enemy, def, desired, dt);
}

function faceTarget(ctx: SimContext, enemy: MutableEnemy, def: EnemyArchetypeDef, dt: number): void {
  const player = ctx.world.player;
  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  if (dx * dx + dz * dz < 1e-8) return;
  enemy.yaw = moveTowardsAngle(enemy.yaw, yawForDirection(dx, dz), def.turnSpeed * dt);
}

function faceVelocity(enemy: MutableEnemy, def: EnemyArchetypeDef, desired: Vec3, dt: number): void {
  if (desired.x * desired.x + desired.z * desired.z < 1e-8) return;
  enemy.yaw = moveTowardsAngle(
    enemy.yaw,
    yawForDirection(desired.x, desired.z),
    def.turnSpeed * dt,
  );
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * Contact damage.
 *
 * Applied at full strength on overlap rather than per-second: the player's
 * mercy invulnerability already rate-limits it, and a fractional trickle would
 * read as an unexplained drain instead of as a hit.
 */
function applyContactDamage(ctx: SimContext, enemy: MutableEnemy, def: EnemyArchetypeDef): void {
  if (def.contactDamage <= 0) return;
  if (enemy.staggerRemaining > 0) return;
  const player = ctx.world.player;
  if (player.movementState === 'downed') return;

  if (distanceXZ(enemy.position, player.position) > def.bodyRadius + ctx.movement.bodyRadius) {
    return;
  }
  const selfTop = enemy.position.y + def.bodyHeight;
  const playerTop = player.position.y + ctx.movement.bodyHeight;
  if (selfTop < player.position.y || playerTop < enemy.position.y) return;

  ctx.services.damagePlayer(def.contactDamage, `enemy:${def.id}`, enemy.position);
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** Shared "nothing to fight" behaviour: walk home, then patrol. */
function updateUnaware(
  out: Vec3,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
): void {
  const speed = def.moveSpeed * PATROL_SPEED_SCALE;
  if (memory.returningHome) {
    const home =
      def.flying === true
        ? distance(enemy.position, enemy.homePosition)
        : distanceXZ(enemy.position, enemy.homePosition);
    if (home <= HOME_ARRIVE_RADIUS) {
      memory.returningHome = false;
    } else {
      steerInto(out, enemy.position, enemy.homePosition, speed, HOME_ARRIVE_RADIUS);
      if (def.flying === true) {
        out.y = clamp(
          (enemy.homePosition.y - enemy.position.y) * FLYER_VERTICAL_GAIN,
          -speed,
          speed,
        );
      }
      setPhase(enemy, 'alert');
      faceVelocity(enemy, def, out, dt);
      return;
    }
  }
  patrolInto(out, enemy, def, speed);
  setPhase(enemy, 'idle');
  faceVelocity(enemy, def, out, dt);
}

function updateScout(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (enemy.targetId === null) {
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }
  const player = ctx.world.player;
  steerInto(out, enemy.position, player.position, def.moveSpeed, def.attackRadius * 0.5);
  faceTarget(ctx, enemy, def, dt);
  if (canBeginAttack(enemy) && inAttackRange(ctx, enemy, def)) {
    set(out, 0, 0, 0);
    beginTelegraph(ctx, enemy, def, memory, 'melee');
  }
}

function updateTurret(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  set(out, 0, 0, 0);
  if (enemy.targetId === null) return;
  faceTarget(ctx, enemy, def, dt);
  if (!canBeginAttack(enemy)) return;

  enemyCentreInto(scratchSelf, enemy, ctx.content);
  playerCentreInto(scratchTarget, ctx);
  if (distance(scratchSelf, scratchTarget) > def.attackRadius) return;
  if (!hasLineOfSight(ctx, scratchSelf, scratchTarget)) return;
  beginTelegraph(ctx, enemy, def, memory, def.projectile === undefined ? 'melee' : 'volley');
}

/** Writes the hover point a flyer holds while it waits for its dive. */
function hoverInto(
  out: Vec3,
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  standoff: number,
  dt: number,
): void {
  const player = ctx.world.player;
  const speed = def.moveSpeed;

  memory.strafeRemaining -= dt;
  if (memory.strafeRemaining <= 0) {
    memory.strafeRemaining = FLYER_STRAFE_SECONDS;
    memory.strafeSign = memory.strafeSign >= 0 ? -1 : 1;
  }

  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  const span = Math.sqrt(dx * dx + dz * dz);
  if (span < 1e-6) {
    set(out, 0, 0, 0);
  } else {
    const nx = dx / span;
    const nz = dz / span;
    // Radial: close or back off toward the standoff ring. Tangential: strafe.
    const radial = clamp(span - standoff, -speed, speed);
    const tangential = speed * 0.6 * (memory.strafeSign >= 0 ? 1 : -1);
    set(out, nx * radial - nz * tangential, 0, nz * radial + nx * tangential);
  }

  const desiredY = player.position.y + FLYER_HOVER_HEIGHT;
  out.y = clamp((desiredY - enemy.position.y) * FLYER_VERTICAL_GAIN, -speed, speed);
}

function updateFlyer(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (enemy.targetId === null) {
    memory.diveRemaining = 0;
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }

  if (memory.diveRemaining > 0) {
    memory.diveRemaining = Math.max(0, memory.diveRemaining - dt);
    enemyCentreInto(scratchSelf, enemy, ctx.content);
    playerCentreInto(scratchTarget, ctx);
    const dx = scratchTarget.x - scratchSelf.x;
    const dy = scratchTarget.y - scratchSelf.y;
    const dz = scratchTarget.z - scratchSelf.z;
    const span = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const speed = def.moveSpeed * FLYER_DIVE_SPEED_SCALE;
    if (span < 1e-6) set(out, 0, 0, 0);
    else set(out, (dx / span) * speed, (dy / span) * speed, (dz / span) * speed);
    setPhase(enemy, 'attack');
    faceTarget(ctx, enemy, def, dt);
    return;
  }

  const standoff = def.projectile === undefined ? FLYER_ORBIT_RADIUS : def.attackRadius * 0.7;
  hoverInto(out, ctx, enemy, def, memory, standoff, dt);
  faceTarget(ctx, enemy, def, dt);
  if (!canBeginAttack(enemy)) return;

  const horizontal = distanceXZ(enemy.position, ctx.world.player.position);
  if (horizontal <= Math.max(FLYER_DIVE_RANGE, def.attackRadius * 0.4)) {
    beginTelegraph(ctx, enemy, def, memory, 'dive');
    return;
  }
  if (def.projectile !== undefined) {
    enemyCentreInto(scratchSelf, enemy, ctx.content);
    playerCentreInto(scratchTarget, ctx);
    if (
      distance(scratchSelf, scratchTarget) <= def.attackRadius &&
      hasLineOfSight(ctx, scratchSelf, scratchTarget)
    ) {
      beginTelegraph(ctx, enemy, def, memory, 'volley');
    }
  }
}

function updateShield(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (memory.openingRemaining > 0) {
    // Plate down, planted, and deliberately not tracking: this is the window
    // the whole encounter is built around.
    set(out, 0, 0, 0);
    setPhase(enemy, 'recover');
    return;
  }
  if (enemy.targetId === null) {
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }
  steerInto(out, enemy.position, ctx.world.player.position, def.moveSpeed, def.attackRadius * 0.6);
  faceTarget(ctx, enemy, def, dt);
  if (canBeginAttack(enemy) && inAttackRange(ctx, enemy, def)) {
    set(out, 0, 0, 0);
    beginTelegraph(ctx, enemy, def, memory, 'heavy');
  }
}

function updatePursuer(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (enemy.targetId === null) {
    memory.headingInit = false;
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }

  const player = ctx.world.player;
  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  const wanted = dx * dx + dz * dz < 1e-8 ? enemy.yaw : yawForDirection(dx, dz);
  if (!memory.headingInit) {
    memory.heading = enemy.yaw;
    memory.headingInit = true;
  }
  // The cap is the whole design: a pursuer that snapped to face the player
  // would be unavoidable, and unavoidable is not the same as threatening.
  memory.heading = moveTowardsAngle(memory.heading, wanted, def.turnSpeed * dt);
  enemy.yaw = memory.heading;

  forwardInto(scratchSteer, memory.heading);
  set(out, scratchSteer.x * def.moveSpeed, 0, scratchSteer.z * def.moveSpeed);

  if (canBeginAttack(enemy) && inAttackRange(ctx, enemy, def)) {
    set(out, 0, 0, 0);
    beginTelegraph(ctx, enemy, def, memory, 'melee');
  }
}

function updateSpawner(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  set(out, 0, 0, 0);
  enemy.spawnedCount = countLiveChildren(ctx, enemy.id);

  if (enemy.targetId === null) {
    if (def.moveSpeed > 0) updateUnaware(out, enemy, def, memory, dt);
    return;
  }
  faceTarget(ctx, enemy, def, dt);

  const spawns = def.spawns;
  if (spawns === undefined) return;
  if (enemy.spawnTimer > 0) {
    enemy.spawnTimer = Math.max(0, enemy.spawnTimer - dt);
    return;
  }
  if (enemy.spawnedCount >= Math.max(0, Math.floor(spawns.max))) return;
  if (!canBeginAttack(enemy)) return;
  beginTelegraph(ctx, enemy, def, memory, 'spawn');
}

function updateHazard(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  // A hazard never chases: its route is level design, and the player learns it.
  patrolInto(out, enemy, def, def.moveSpeed);
  faceVelocity(enemy, def, out, dt);
  setPhase(enemy, enemy.targetId === null ? 'idle' : 'alert');

  if (def.projectile === undefined || enemy.targetId === null) return;
  if (!canBeginAttack(enemy)) return;
  enemyCentreInto(scratchSelf, enemy, ctx.content);
  playerCentreInto(scratchTarget, ctx);
  if (distance(scratchSelf, scratchTarget) > def.attackRadius) return;
  beginTelegraph(ctx, enemy, def, memory, 'volley');
}

function updateMimic(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (enemy.targetId === null) {
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }

  // Sampling is continuous, so switching form mid-fight changes what comes
  // back at you on the very next shot.
  const form = ctx.world.player.form;
  if (enemy.mimickedForm !== form) enemy.mimickedForm = form;

  const player = ctx.world.player;
  const standoff = def.projectile === undefined ? def.attackRadius * 0.5 : def.attackRadius * MIMIC_STANDOFF;
  const dx = player.position.x - enemy.position.x;
  const dz = player.position.z - enemy.position.z;
  const span = Math.sqrt(dx * dx + dz * dz);
  if (span < 1e-6) {
    set(out, 0, 0, 0);
  } else {
    memory.strafeRemaining -= dt;
    if (memory.strafeRemaining <= 0) {
      memory.strafeRemaining = FLYER_STRAFE_SECONDS;
      memory.strafeSign = memory.strafeSign >= 0 ? -1 : 1;
    }
    const nx = dx / span;
    const nz = dz / span;
    const radial = clamp(span - standoff, -def.moveSpeed, def.moveSpeed);
    const tangential = def.moveSpeed * 0.5 * (memory.strafeSign >= 0 ? 1 : -1);
    set(out, nx * radial - nz * tangential, 0, nz * radial + nx * tangential);
  }
  faceTarget(ctx, enemy, def, dt);

  if (!canBeginAttack(enemy)) return;
  if (def.projectile === undefined) {
    if (inAttackRange(ctx, enemy, def)) {
      set(out, 0, 0, 0);
      beginTelegraph(ctx, enemy, def, memory, 'melee');
    }
    return;
  }
  enemyCentreInto(scratchSelf, enemy, ctx.content);
  playerCentreInto(scratchTarget, ctx);
  if (distance(scratchSelf, scratchTarget) > def.attackRadius) return;
  if (!hasLineOfSight(ctx, scratchSelf, scratchTarget)) return;
  beginTelegraph(ctx, enemy, def, memory, 'volley');
}

function updateElite(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  if (enemy.targetId === null) {
    updateUnaware(out, enemy, def, memory, dt);
    return;
  }

  const player = ctx.world.player;
  faceTarget(ctx, enemy, def, dt);

  const ranged = memory.pattern === 0;
  if (ranged && def.projectile !== undefined) {
    // Ranged stance: hold the line and shoot down it.
    const standoff = def.attackRadius * ELITE_RANGED_STANDOFF;
    const dx = player.position.x - enemy.position.x;
    const dz = player.position.z - enemy.position.z;
    const span = Math.sqrt(dx * dx + dz * dz);
    if (span < 1e-6) {
      set(out, 0, 0, 0);
    } else {
      const radial = clamp(span - standoff, -def.moveSpeed, def.moveSpeed);
      set(out, (dx / span) * radial, 0, (dz / span) * radial);
    }
    if (canBeginAttack(enemy)) {
      enemyCentreInto(scratchSelf, enemy, ctx.content);
      playerCentreInto(scratchTarget, ctx);
      if (
        distance(scratchSelf, scratchTarget) <= def.attackRadius &&
        hasLineOfSight(ctx, scratchSelf, scratchTarget)
      ) {
        beginTelegraph(ctx, enemy, def, memory, 'volley');
      }
    }
    return;
  }

  // Closing stance — and the fallback for an elite with no ranged option at
  // all, which then alternates quick strikes with a heavy slam instead.
  const reach = eliteMeleeReach(ctx, def);
  steerInto(out, enemy.position, player.position, def.moveSpeed, reach * 0.7);
  if (!canBeginAttack(enemy) || !inAttackRange(ctx, enemy, def, reach)) return;
  set(out, 0, 0, 0);
  const last = memory.patternCount >= ELITE_ATTACKS_PER_PATTERN - 1;
  const heavy = ranged || last;
  beginTelegraph(ctx, enemy, def, memory, heavy ? 'heavy' : 'melee', heavy ? 1.2 : 1, reach);
}

function runRole(
  ctx: SimContext,
  enemy: MutableEnemy,
  def: EnemyArchetypeDef,
  memory: EnemyMemory,
  dt: number,
  out: Vec3,
): void {
  // Settle the phase before the role runs, so a role only ever has to say
  // "attack now" rather than manage the whole state machine.
  if (enemy.phase === 'recover') {
    if (memory.openingRemaining <= 0 && enemy.phaseTime >= RECOVER_SECONDS) {
      setPhase(enemy, enemy.targetId === null ? 'idle' : 'alert');
    }
  } else if (enemy.phase !== 'cleansing' && enemy.phase !== 'dead') {
    setPhase(enemy, enemy.targetId === null ? 'idle' : 'alert');
  }

  switch (def.role) {
    case 'scout':
      updateScout(ctx, enemy, def, memory, dt, out);
      return;
    case 'turret':
      updateTurret(ctx, enemy, def, memory, dt, out);
      return;
    case 'flyer':
      updateFlyer(ctx, enemy, def, memory, dt, out);
      return;
    case 'shield':
      updateShield(ctx, enemy, def, memory, dt, out);
      return;
    case 'pursuer':
      updatePursuer(ctx, enemy, def, memory, dt, out);
      return;
    case 'spawner':
      updateSpawner(ctx, enemy, def, memory, dt, out);
      return;
    case 'hazard':
      updateHazard(ctx, enemy, def, memory, dt, out);
      return;
    case 'mimic':
      updateMimic(ctx, enemy, def, memory, dt, out);
      return;
    case 'elite':
      updateElite(ctx, enemy, def, memory, dt, out);
      return;
    default:
      updateUnaware(out, enemy, def, memory, dt);
  }
}

// ---------------------------------------------------------------------------
// Cleansing
// ---------------------------------------------------------------------------

function beginCleanse(enemy: MutableEnemy): void {
  enemy.health = 0;
  enemy.phase = 'cleansing';
  enemy.phaseTime = 0;
  enemy.cleanseRemaining = CLEANSE_SECONDS;
  enemy.telegraphRemaining = 0;
  enemy.telegraphTotal = 0;
  enemy.targetId = null;
  set(enemy.velocity, 0, 0, 0);
  // `damageEnemy` already flagged it dead; the step loop prunes dead entries,
  // which would delete the unit before the restoration could be drawn. Holding
  // it alive for the beat is what makes cleansing visibly different from a kill.
  enemy.dead = false;
}

function tickCleanse(ctx: SimContext, enemy: MutableEnemy, dt: number): void {
  if (enemy.dead) {
    // A stray shot landed on a unit that was already being restored, so
    // `damageEnemy` counted it a second time. Undo the duplicate rather than
    // let the results screen inflate.
    enemy.dead = false;
    ctx.world.stage.enemiesCleansed = Math.max(0, ctx.world.stage.enemiesCleansed - 1);
  }
  enemy.phase = 'cleansing';
  enemy.phaseTime += dt;
  enemy.cleanseRemaining = Math.max(0, enemy.cleanseRemaining - dt);
  set(enemy.velocity, 0, 0, 0);
  if (enemy.cleanseRemaining <= 0) {
    enemy.dead = true;
    enemy.phase = 'dead';
  }
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

function updateEnemy(ctx: SimContext, enemy: MutableEnemy, dt: number): void {
  const def = enemyArchetypeOf(ctx.content, enemy);
  if (def === null) {
    // Unknown archetype: inert rather than crashing, so a content typo costs a
    // dud enemy instead of the whole stage.
    set(enemy.velocity, 0, 0, 0);
    return;
  }

  if (enemy.phase === 'cleansing' || enemy.cleanseRemaining > 0) {
    tickCleanse(ctx, enemy, dt);
    return;
  }
  if (enemy.health <= 0) {
    enemy.health = 0;
    set(enemy.velocity, 0, 0, 0);
    if (def.cleansable === true) {
      beginCleanse(enemy);
    } else {
      enemy.dead = true;
      enemy.phase = 'dead';
    }
    return;
  }
  if (enemy.dead) return;

  const memory = memoryOf(enemy);

  enemy.phaseTime += dt;
  enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
  enemy.rootedRemaining = Math.max(0, enemy.rootedRemaining - dt);
  enemy.silencedRemaining = Math.max(0, enemy.silencedRemaining - dt);
  enemy.staggerRemaining = Math.max(0, enemy.staggerRemaining - dt);
  if (memory.openingRemaining > 0) {
    memory.openingRemaining = Math.max(0, memory.openingRemaining - dt);
    if (memory.openingRemaining <= 0) enemy.armour = def.armour ?? 0;
  }

  perceive(ctx, enemy, def, memory, dt);

  // Silence is the point of Silence Form: it interrupts the wind-up rather than
  // merely delaying the next one. Stagger does the same from the other side.
  if (enemy.silencedRemaining > 0 || enemy.staggerRemaining > 0) {
    cancelTelegraph(enemy, memory);
  }

  if (enemy.telegraphRemaining > 0) {
    enemy.telegraphRemaining = Math.max(0, enemy.telegraphRemaining - dt);
    if (enemy.telegraphRemaining <= 0) {
      releaseAttack(ctx, enemy, def, memory);
    }
  }

  set(scratchDesired, 0, 0, 0);

  if (enemy.staggerRemaining > 0) {
    setPhase(enemy, 'stagger');
  } else if (enemy.telegraphRemaining > 0) {
    // Committed. Ground units plant; flyers hold their hover so the wind-up
    // reads as a wind-up rather than as drift.
    setPhase(enemy, 'attack');
    if (def.flying === true && memory.diveRemaining <= 0) {
      hoverInto(
        scratchDesired,
        ctx,
        enemy,
        def,
        memory,
        def.projectile === undefined ? FLYER_ORBIT_RADIUS : def.attackRadius * 0.7,
        dt,
      );
    }
    faceTarget(ctx, enemy, def, dt);
  } else {
    runRole(ctx, enemy, def, memory, dt, scratchDesired);
  }

  if (enemy.rootedRemaining > 0) set(scratchDesired, 0, 0, 0);

  integrate(ctx, enemy, def, scratchDesired, dt);
  applyContactDamage(ctx, enemy, def);
}

/**
 * Drives every enemy in the world.
 *
 * Children spawned this step are appended past the snapshot length and picked
 * up on the next step, so a spawner can never produce a cascade inside one
 * frame and the step's cost stays bounded.
 */
export const enemySystem: System = (ctx: SimContext): void => {
  const world = ctx.world;
  if (world.paused) return;
  const dt = ctx.dt;
  if (!(dt > 0)) return;

  const count = world.enemies.length;
  for (let i = 0; i < count; i++) {
    const enemy = world.enemies[i];
    if (enemy === undefined) continue;
    updateEnemy(ctx, enemy, dt);
  }
};
