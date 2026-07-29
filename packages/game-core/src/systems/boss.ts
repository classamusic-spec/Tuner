import { DETUNED_HZ, clamp01, clone, moveTowardsAngle, set, vec3 } from '@tuner/shared';
import type { Rng } from '@tuner/shared';
import type { BossAttackDef, BossDef, BossPhaseDef } from '../content-types.js';
import type { SimContext, System } from '../internal/context.js';
import type { MutableBoss, MutableWorld } from '../internal/world.js';

/**
 * The Commander runtime.
 *
 * There is no per-boss code in this file and there is not meant to be. A
 * `BossDef` names its phases, its attacks and the retuning sequence that ends
 * it; this system plays that data. Adding a Commander is authoring, not
 * programming — which is the only way nine of them stay consistent with each
 * other.
 *
 * **The loop.** Every attack runs the same three beats:
 *
 * ```
 *   idle ── nextAttackIn ──▶ telegraph ──▶ active ──▶ recovery ──▶ idle
 *                            (wind-up)     (live)     (punish?)
 * ```
 *
 * `telegraphSeconds`, `durationSeconds` and `recoverySeconds` come straight
 * off the attack, and the stages are advanced against a *time budget* rather
 * than one stage per step: a 0.75 s telegraph followed by a 0.9 s strike takes
 * exactly 1.65 s whatever the step size, with no per-transition step of drift
 * accumulating over a three-phase fight.
 *
 * **Phase escalation** is the encounter design, expressed as data. Phase 1
 * teaches the attack language with a small, slow vocabulary; phase 2 adds
 * movement pressure and rewrites the arena through `arenaFlags`; phase 3 is
 * the full 440 Hz corruption state, with the widest attack list and the
 * shortest interval. Entering a phase applies its flags, resets attack
 * selection, and announces itself.
 *
 * **Fairness rules this runtime enforces, not the content:**
 *
 * - A telegraph is *always* announced (`boss:telegraph`, carrying its duration
 *   and a world position) and `telegraphRemaining` / `telegraphTotal` are
 *   written every step, so the renderer can draw a closing timing ring. Every
 *   attack in the game is readable with the sound off.
 * - The boss tracks the player freely between attacks, slowly during a
 *   wind-up, and **not at all** once the attack is live. A telegraph you can
 *   dodge is a telegraph that commits.
 * - `opensVulnerability` is a promise: that attack's recovery is a guaranteed
 *   punish window, opened and closed on `boss:vulnerable`.
 * - The same attack is never selected three times running.
 * - Difficulty scales the *interval between* attacks and nothing else. It
 *   never touches boss health, which would only make a fight longer instead of
 *   different.
 * - `formAdvantages` are handled by `damageBoss` in `internal/services.ts` and
 *   are multipliers at or above one. The base Auralith can finish every fight.
 *
 * **Death is not the ending.** At zero health a Commander does not die: it
 * enters `restoring`, and the player plays `restorationSequence` back into it
 * with {@link submitRestorationNote}. Only when that sequence completes does
 * `defeated` go true and the form get awarded.
 *
 * **Accessibility.** Every cue this system produces has a `GameEvents`
 * emission with enough data to draw the equivalent: `boss:phaseChanged`
 * (index + name), `boss:telegraph` (seconds + position),
 * `boss:attackStarted` (position), `boss:vulnerable` (both edges),
 * `boss:restorationStarted`, `world:restorationStep` (progress) and
 * `boss:defeated` (awarded form). Nothing in the fight is announced by audio
 * alone.
 */

// ---------------------------------------------------------------------------
// Shape constants — runtime defaults. Anything a designer should be able to
// tune per boss belongs in `BossDef`, not here.
// ---------------------------------------------------------------------------

/** How fast the boss turns to face the player between attacks, rad/s. */
export const BOSS_TURN_RADIANS_PER_SECOND = 2.4;

/**
 * Turn rate multiplier during a wind-up. Small on purpose: the boss may adjust
 * its aim while telegraphing, but a strike that tracks the player through the
 * whole wind-up is a strike that cannot be dodged.
 */
export const BOSS_TELEGRAPH_TURN_SCALE = 0.35;

/** Approach speed between attacks in phase one, m/s. */
export const BOSS_APPROACH_SPEED = 3.4;

/** Extra approach speed per phase beyond the first — phase two adds pressure. */
export const BOSS_PHASE_SPEED_STEP = 0.45;

/** Distance the boss keeps from the player, on top of its own body radius. */
export const BOSS_STANDOFF_METRES = 4;

/** Seconds between the shots a live attack throws. */
export const BOSS_SHOT_INTERVAL_SECONDS = 0.32;

export const BOSS_SHOT_SPEED = 18;
export const BOSS_SHOT_DAMAGE = 9;
export const BOSS_SHOT_RADIUS = 0.45;
export const BOSS_SHOT_LIFE_SECONDS = 4;

/** Horizontal fan applied to successive shots in a volley, in radians. */
export const BOSS_SHOT_SPREAD_RADIANS = 0.14;

/** Height shots leave from, as a fraction of the boss's body height. */
export const BOSS_MUZZLE_HEIGHT_RATIO = 0.6;

/** Height on the player the boss aims at, in metres above their feet. */
export const BOSS_AIM_HEIGHT_METRES = 0.9;

export const BOSS_ATTACK_SHAKE_MAGNITUDE = 0.4;
export const BOSS_ATTACK_SHAKE_SECONDS = 0.2;
export const BOSS_PHASE_SHAKE_MAGNITUDE = 0.9;
export const BOSS_PHASE_SHAKE_SECONDS = 0.55;
export const BOSS_RESTORATION_SHAKE_MAGNITUDE = 1.1;
export const BOSS_RESTORATION_SHAKE_SECONDS = 0.7;

/** Consecutive uses of one attack allowed before it is barred from selection. */
export const MAX_CONSECUTIVE_REPEATS = 2;

/** Floor on the aggression divisor, so a zeroed profile cannot stall the fight. */
export const MIN_AGGRESSION_SCALE = 0.05;

/** Lifecycle transitions resolved inside one step before the budget is dropped. */
export const MAX_LIFECYCLE_SUBSTEPS = 16;

const TIME_EPSILON = 1e-6;
const HEALTH_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// `boss.scratch` keys
//
// `MutableBoss.scratch` is a `Map<string, number>` of attack-local state. The
// runtime's own bookkeeping lives under an `@` prefix so it can never collide
// with a key an attack primitive derives from an attack id.
// ---------------------------------------------------------------------------

const KEY_INITIALISED = '@initialised';
/** Index into `BossDef.attacks` of the attack selected last. */
const KEY_LAST_ATTACK = '@lastAttack';
/** How many times in a row that attack has been selected. */
const KEY_REPEATS = '@repeats';
const KEY_SEQUENCE_LENGTH = '@restoreLength';
const KEY_SEQUENCE_PREFIX = '@restore:';
/** Highest restoration step already announced, so notes announce exactly once. */
const KEY_ANNOUNCED_STEP = '@restoreAnnounced';

const SHOT_TIMER_SUFFIX = ':shotTimer';
const SHOT_COUNT_SUFFIX = ':shotCount';

// ---------------------------------------------------------------------------
// Module scratch — reused every step so the hot path never allocates
// ---------------------------------------------------------------------------

const scratchOrigin = vec3();
const scratchDirection = vec3();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Yaw that faces a horizontal direction, matching the movement system's -Z convention. */
export function bossYawForDirection(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Position of `phaseIndex` within `def.phases`, or -1 when it is not there. */
export function phaseSlotOf(def: BossDef, phaseIndex: number): number {
  for (let i = 0; i < def.phases.length; i++) {
    if (def.phases[i]?.index === phaseIndex) return i;
  }
  return -1;
}

/** The phase the boss is currently in, or null when the definition has none. */
export function currentPhaseOf(def: BossDef, boss: MutableBoss): BossPhaseDef | null {
  const slot = phaseSlotOf(def, boss.phaseIndex);
  return def.phases[slot < 0 ? 0 : slot] ?? null;
}

export function findAttack(def: BossDef, id: string | null): BossAttackDef | null {
  if (id === null) return null;
  for (const attack of def.attacks) {
    if (attack.id === id) return attack;
  }
  return null;
}

/** Selection weight of an attack. Unweighted attacks count as one. */
export function attackWeight(attack: BossAttackDef): number {
  const weight = attack.weight;
  if (weight === undefined || !Number.isFinite(weight)) return 1;
  return Math.max(0, weight);
}

/**
 * Attacks the boss may select right now.
 *
 * An attack has to be named by the phase *and* list that phase — the two
 * directions are authored separately, so requiring both catches content that
 * has drifted rather than silently playing it. `advancedOnly` attacks are the
 * optional layer difficulty toggles, and `excludeId` is how the repeat guard
 * bars an attack that has already run twice in a row.
 */
export function eligibleAttacks(
  def: BossDef,
  phase: BossPhaseDef,
  advancedPatterns: boolean,
  excludeId: string | null = null,
): BossAttackDef[] {
  const out: BossAttackDef[] = [];
  for (const id of phase.attackIds) {
    const attack = findAttack(def, id);
    if (attack === null) continue;
    if (!attack.phases.includes(phase.index)) continue;
    if (attack.advancedOnly === true && !advancedPatterns) continue;
    if (excludeId !== null && attack.id === excludeId) continue;
    if (attackWeight(attack) <= 0) continue;
    out.push(attack);
  }
  return out;
}

/**
 * Weighted choice over `attacks`, drawn from `rng` so a seeded run replays
 * exactly. Returns null only for an empty list.
 */
export function pickWeighted(attacks: readonly BossAttackDef[], rng: Rng): BossAttackDef | null {
  if (attacks.length === 0) return null;
  let total = 0;
  for (const attack of attacks) total += attackWeight(attack);
  const first = attacks[0] ?? null;
  if (total <= 0) return first;

  let roll = rng.next() * total;
  for (const attack of attacks) {
    roll -= attackWeight(attack);
    if (roll < 0) return attack;
  }
  return attacks[attacks.length - 1] ?? first;
}

/** Seconds between attacks in this phase, after the difficulty scale. */
export function attackGapSeconds(ctx: SimContext, phase: BossPhaseDef): number {
  const scale = Math.max(MIN_AGGRESSION_SCALE, ctx.difficultyProfile.enemyAggressionScale);
  return Math.max(0, phase.attackInterval) / scale;
}

// ---------------------------------------------------------------------------
// Restoration
// ---------------------------------------------------------------------------

/**
 * Plays one harmonic degree into a Commander that is being retuned.
 *
 * The stage and combat systems own the *striking* of notes; this is how they
 * hand one to the boss. Returns true when `degree` was the next one the
 * sequence wanted — a wrong note simply does not advance, and never sends the
 * player back to the start. Retuning a friend is a coda, not a gauntlet.
 *
 * The expected sequence is copied into `boss.scratch` when restoration begins,
 * which is what lets this be callable with nothing but the world. Completion
 * is *finalised* by {@link bossSystem} rather than here, because awarding the
 * form needs the content bundle and the event bus: with the shipped system
 * order (stage and combat both run before the boss) that still lands
 * `boss:defeated` in the same step the last note was struck.
 */
export function submitRestorationNote(world: MutableWorld, degree: number): boolean {
  const boss = world.boss;
  if (boss === null || boss.defeated || !boss.restoring) return false;

  const total = boss.scratch.get(KEY_SEQUENCE_LENGTH) ?? 0;
  if (total <= 0) return false;

  const step = boss.restorationStep;
  if (step < 0 || step >= total) return false;

  const expected = boss.scratch.get(KEY_SEQUENCE_PREFIX + String(step));
  if (expected === undefined || expected !== degree) return false;

  boss.restorationStep = step + 1;
  boss.restorationProgress = clamp01((step + 1) / total);
  return true;
}

/**
 * Copies `restorationSequence` into the boss's scratch.
 *
 * Kept separate from {@link beginRestoration} because a stage trigger may flip
 * `restoring` itself — `TriggerDef` has a `phase: 'restoration'` action — and
 * the sequence has to be there whichever route the fight took, or
 * {@link submitRestorationNote} would have nothing to check against.
 */
function seedRestorationSequence(boss: MutableBoss, def: BossDef): void {
  const sequence = def.restorationSequence ?? [];
  boss.scratch.set(KEY_SEQUENCE_LENGTH, sequence.length);
  for (let i = 0; i < sequence.length; i++) {
    boss.scratch.set(KEY_SEQUENCE_PREFIX + String(i), sequence[i] ?? 0);
  }
  boss.scratch.set(KEY_ANNOUNCED_STEP, boss.restorationStep);
}

function beginRestoration(ctx: SimContext, boss: MutableBoss, def: BossDef): void {
  boss.health = 0;
  cancelAttack(ctx, boss);
  boss.nextAttackIn = 0;
  boss.restoring = true;
  boss.restorationStep = 0;
  boss.restorationProgress = 0;
  set(boss.velocity, 0, 0, 0);
  seedRestorationSequence(boss, def);

  ctx.events.emit('boss:restorationStarted', { definitionId: boss.definitionId });
  ctx.services.requestShake(BOSS_RESTORATION_SHAKE_MAGNITUDE, BOSS_RESTORATION_SHAKE_SECONDS);

  // A boss with no authored sequence — every mini-boss, and any Commander
  // still being blocked out — has nothing to play back, so it resolves at
  // once rather than standing there waiting for a note that cannot come.
  if ((boss.scratch.get(KEY_SEQUENCE_LENGTH) ?? 0) === 0) completeRestoration(ctx, boss, def);
}

function completeRestoration(ctx: SimContext, boss: MutableBoss, def: BossDef): void {
  if (boss.defeated) return;
  const total = boss.scratch.get(KEY_SEQUENCE_LENGTH) ?? 0;
  boss.restorationStep = total;
  boss.restorationProgress = 1;
  boss.restoring = false;
  boss.defeated = true;
  boss.health = 0;
  set(boss.velocity, 0, 0, 0);

  ctx.events.emit('boss:defeated', {
    definitionId: boss.definitionId,
    displayName: boss.displayName === '' ? def.displayName : boss.displayName,
    formAwarded: def.awardsForm ?? null,
  });
}

function updateRestoration(ctx: SimContext, boss: MutableBoss, def: BossDef): void {
  // Adopt a retuning another system started, so a scripted route into the
  // restoration phase behaves exactly like reaching zero health.
  if (!boss.scratch.has(KEY_SEQUENCE_LENGTH)) seedRestorationSequence(boss, def);
  const total = boss.scratch.get(KEY_SEQUENCE_LENGTH) ?? 0;

  // Announce accepted notes exactly once each, so audio and the on-screen
  // sequence readout stay in step with `restorationProgress`.
  const announced = boss.scratch.get(KEY_ANNOUNCED_STEP) ?? 0;
  if (boss.restorationStep > announced) {
    boss.scratch.set(KEY_ANNOUNCED_STEP, boss.restorationStep);
    ctx.events.emit('world:restorationStep', {
      progress: boss.restorationProgress,
      region: def.stageId,
    });
  }

  // `>=` rather than `>` so an adopted retuning with nothing to play back
  // resolves instead of leaving the boss kneeling forever.
  if (boss.restorationStep >= total) completeRestoration(ctx, boss, def);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * Enters `phase`: applies its arena flags, clears whatever the boss was doing,
 * resets attack selection and announces the change.
 *
 * `shake` is false for the opening phase, which is entered rather than
 * transitioned into.
 */
function enterPhase(
  ctx: SimContext,
  boss: MutableBoss,
  phase: BossPhaseDef,
  shake: boolean,
): void {
  boss.phaseIndex = phase.index;
  boss.phaseTime = 0;

  // Into the world so triggers, doors and geometry react, and onto the boss so
  // the stage runtime can tell which flags this encounter is responsible for.
  const flags = phase.arenaFlags;
  if (flags !== undefined) {
    for (const flag of flags) {
      ctx.world.stage.flags.add(flag);
      boss.arenaFlags.add(flag);
    }
  }

  // Resetting selection is part of the transition: the new phase gets a clean
  // repeat guard and a full interval of breathing room while the arena changes.
  cancelAttack(ctx, boss);
  boss.scratch.delete(KEY_LAST_ATTACK);
  boss.scratch.delete(KEY_REPEATS);
  boss.nextAttackIn = attackGapSeconds(ctx, phase);

  ctx.events.emit('boss:phaseChanged', {
    definitionId: boss.definitionId,
    phaseIndex: phase.index,
    phaseName: phase.name,
  });
  if (shake) ctx.services.requestShake(BOSS_PHASE_SHAKE_MAGNITUDE, BOSS_PHASE_SHAKE_SECONDS);
}

/**
 * First-step setup.
 *
 * Whoever spawned the boss is not required to have applied the opening phase's
 * arena flags or announced it, so the runtime does both once. Doing it here
 * rather than in the loader is what guarantees the arena the player sees
 * always matches the phase the boss thinks it is in.
 */
function ensureInitialised(ctx: SimContext, boss: MutableBoss, def: BossDef): void {
  if (boss.scratch.get(KEY_INITIALISED) === 1) return;
  boss.scratch.set(KEY_INITIALISED, 1);

  if (boss.maxHealth <= 0) boss.maxHealth = def.health;
  const slot = phaseSlotOf(def, boss.phaseIndex);
  const phase = def.phases[slot < 0 ? 0 : slot];
  if (phase === undefined) return;
  enterPhase(ctx, boss, phase, false);
}

/**
 * Walks the boss forward through every threshold its health has crossed.
 *
 * One transition per crossed phase, each announced: a burst big enough to skip
 * a phase still applies that phase's arena flags, because the geometry those
 * flags gate may be what the next phase is fought on.
 */
function advancePhases(ctx: SimContext, boss: MutableBoss, def: BossDef): void {
  if (boss.maxHealth <= 0) return;
  const fraction = boss.health / boss.maxHealth;

  for (let guard = 0; guard < def.phases.length; guard++) {
    const slot = phaseSlotOf(def, boss.phaseIndex);
    if (slot < 0) return;
    const next = def.phases[slot + 1];
    if (next === undefined) return;
    if (fraction > next.healthThreshold + HEALTH_EPSILON) return;
    enterPhase(ctx, boss, next, true);
  }
}

// ---------------------------------------------------------------------------
// Attack lifecycle
// ---------------------------------------------------------------------------

function openVulnerability(ctx: SimContext, boss: MutableBoss): void {
  if (boss.vulnerable) return;
  boss.vulnerable = true;
  ctx.events.emit('boss:vulnerable', { definitionId: boss.definitionId, open: true });
}

function closeVulnerability(ctx: SimContext, boss: MutableBoss): void {
  if (!boss.vulnerable) return;
  boss.vulnerable = false;
  ctx.events.emit('boss:vulnerable', { definitionId: boss.definitionId, open: false });
}

/** Drops every trace of the current attack, including its scratch state. */
function cancelAttack(ctx: SimContext, boss: MutableBoss): void {
  closeVulnerability(ctx, boss);
  const current = boss.currentAttack;
  if (current !== null) {
    boss.scratch.delete(current + SHOT_TIMER_SUFFIX);
    boss.scratch.delete(current + SHOT_COUNT_SUFFIX);
  }
  boss.currentAttack = null;
  boss.attackTime = 0;
  boss.attackDuration = 0;
  boss.telegraphRemaining = 0;
  boss.telegraphTotal = 0;
  boss.recoveryRemaining = 0;
}

/**
 * Chooses the next attack.
 *
 * Weighted by `BossAttackDef.weight` and drawn from `ctx.rng`, so the sequence
 * is reproducible from a seed. The attack used twice in a row is barred
 * outright — variety is guaranteed, not left to the dice. A phase with only
 * one legal attack falls back to it rather than going quiet.
 */
function selectAttack(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  phase: BossPhaseDef,
): BossAttackDef | null {
  const advanced = ctx.difficultyProfile.advancedPatterns;
  const lastIndex = boss.scratch.get(KEY_LAST_ATTACK) ?? -1;
  const repeats = boss.scratch.get(KEY_REPEATS) ?? 0;
  const last = lastIndex >= 0 ? (def.attacks[lastIndex] ?? null) : null;
  const barred = last !== null && repeats >= MAX_CONSECUTIVE_REPEATS ? last.id : null;

  let pool = eligibleAttacks(def, phase, advanced, barred);
  if (pool.length === 0 && barred !== null) {
    pool = eligibleAttacks(def, phase, advanced, null);
  }
  return pickWeighted(pool, ctx.rng);
}

function recordSelection(boss: MutableBoss, def: BossDef, attack: BossAttackDef): void {
  const index = def.attacks.indexOf(attack);
  const last = boss.scratch.get(KEY_LAST_ATTACK) ?? -1;
  if (index === last) {
    boss.scratch.set(KEY_REPEATS, (boss.scratch.get(KEY_REPEATS) ?? 0) + 1);
  } else {
    boss.scratch.set(KEY_LAST_ATTACK, index);
    boss.scratch.set(KEY_REPEATS, 1);
  }
}

/** Starts the wind-up. Returns false when the phase has nothing legal to play. */
function beginAttack(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  phase: BossPhaseDef,
): boolean {
  const attack = selectAttack(ctx, boss, def, phase);
  if (attack === null) return false;
  recordSelection(boss, def, attack);

  boss.currentAttack = attack.id;
  boss.attackTime = 0;
  boss.attackDuration = Math.max(0, attack.durationSeconds);
  boss.recoveryRemaining = 0;
  boss.telegraphTotal = Math.max(0, attack.telegraphSeconds);
  boss.telegraphRemaining = boss.telegraphTotal;
  boss.scratch.set(attack.id + SHOT_TIMER_SUFFIX, BOSS_SHOT_INTERVAL_SECONDS);
  boss.scratch.set(attack.id + SHOT_COUNT_SUFFIX, 0);

  // The wind-up is announced with its duration and a position, which is what
  // the accessibility layer's timing ring is drawn from.
  ctx.events.emit('boss:telegraph', {
    definitionId: boss.definitionId,
    attack: attack.id,
    seconds: boss.telegraphTotal,
    position: clone(boss.position),
  });

  if (boss.telegraphRemaining <= 0) beginActive(ctx, boss, def, phase);
  return true;
}

function beginActive(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  phase: BossPhaseDef,
): void {
  const attack = findAttack(def, boss.currentAttack);
  if (attack === null) return;
  boss.telegraphRemaining = 0;
  boss.attackTime = 0;

  ctx.events.emit('boss:attackStarted', {
    definitionId: boss.definitionId,
    attack: attack.id,
    position: clone(boss.position),
  });
  ctx.services.requestShake(BOSS_ATTACK_SHAKE_MAGNITUDE, BOSS_ATTACK_SHAKE_SECONDS);

  if (boss.attackDuration <= 0) beginRecovery(ctx, boss, def, phase);
}

function beginRecovery(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  phase: BossPhaseDef,
): void {
  const attack = findAttack(def, boss.currentAttack);
  boss.attackTime = boss.attackDuration;
  boss.recoveryRemaining = Math.max(0, attack?.recoverySeconds ?? 0);

  // The punish window. `opensVulnerability` is the fight's contract with the
  // player: dodge this and the answer is a free hit, not another dodge.
  if (attack?.opensVulnerability === true && boss.recoveryRemaining > 0) {
    openVulnerability(ctx, boss);
  }

  if (boss.recoveryRemaining <= 0) endAttack(ctx, boss, phase);
}

function endAttack(ctx: SimContext, boss: MutableBoss, phase: BossPhaseDef): void {
  cancelAttack(ctx, boss);
  boss.nextAttackIn = attackGapSeconds(ctx, phase);
}

/**
 * Generic offence for a live attack.
 *
 * `BossAttackDef` describes an attack's *timing*, not its geometry, so the
 * runtime supplies one readable primitive: a fanned volley of counterable
 * 440 Hz shots at a fixed cadence for as long as the attack is live. Every
 * shot goes through `services.spawnProjectile`, so it is reflectable by the
 * Resonance Counter and drawn by the same code as any other projectile. When
 * the authoring format grows per-attack projectile data, it lands here.
 */
function tickActive(ctx: SimContext, boss: MutableBoss, def: BossDef, seconds: number): void {
  const attack = boss.currentAttack;
  if (attack === null || seconds <= 0) return;

  const timerKey = attack + SHOT_TIMER_SUFFIX;
  const countKey = attack + SHOT_COUNT_SUFFIX;
  let timer = (boss.scratch.get(timerKey) ?? 0) + seconds;
  let count = boss.scratch.get(countKey) ?? 0;

  while (timer >= BOSS_SHOT_INTERVAL_SECONDS) {
    timer -= BOSS_SHOT_INTERVAL_SECONDS;
    fireShot(ctx, boss, def, count);
    count += 1;
  }

  boss.scratch.set(timerKey, timer);
  boss.scratch.set(countKey, count);
}

function fireShot(ctx: SimContext, boss: MutableBoss, def: BossDef, index: number): void {
  const player = ctx.world.player;
  set(
    scratchOrigin,
    boss.position.x,
    boss.position.y + def.bodyHeight * BOSS_MUZZLE_HEIGHT_RATIO,
    boss.position.z,
  );

  const dx = player.position.x - scratchOrigin.x;
  const dy = player.position.y + BOSS_AIM_HEIGHT_METRES - scratchOrigin.y;
  const dz = player.position.z - scratchOrigin.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-6) {
    set(scratchDirection, -Math.sin(boss.yaw), 0, -Math.cos(boss.yaw));
  } else {
    // A deterministic fan rather than a random spread: the pattern is the same
    // every run, so it can be learned instead of merely survived.
    const offset = ((index % 3) - 1) * BOSS_SHOT_SPREAD_RADIANS;
    const cos = Math.cos(offset);
    const sin = Math.sin(offset);
    set(
      scratchDirection,
      (dx * cos - dz * sin) / length,
      dy / length,
      (dx * sin + dz * cos) / length,
    );
  }

  ctx.services.spawnProjectile({
    owner: 'enemy',
    ownerId: boss.id,
    position: scratchOrigin,
    direction: scratchDirection,
    speed: BOSS_SHOT_SPEED,
    damage: BOSS_SHOT_DAMAGE,
    damageKind: 'pulse',
    form: 'base',
    radius: BOSS_SHOT_RADIUS,
    lifeSeconds: BOSS_SHOT_LIFE_SECONDS,
    hz: DETUNED_HZ,
    counterable: true,
    gravityScale: 0,
  });
}

/**
 * Advances the lifecycle against a time budget.
 *
 * Each stage consumes only as much of the step as it needs and hands the rest
 * to the next, so `telegraph + duration + recovery + interval` is exact at any
 * step size instead of losing a step at every transition.
 */
function advanceAttack(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  phase: BossPhaseDef,
  deltaSeconds: number,
): void {
  let budget = deltaSeconds;

  for (let guard = 0; guard < MAX_LIFECYCLE_SUBSTEPS && budget > TIME_EPSILON; guard++) {
    // -- wind-up ------------------------------------------------------------
    if (boss.telegraphRemaining > 0) {
      const step = Math.min(budget, boss.telegraphRemaining);
      budget -= step;
      boss.telegraphRemaining -= step;
      if (boss.telegraphRemaining <= TIME_EPSILON) {
        boss.telegraphRemaining = 0;
        beginActive(ctx, boss, def, phase);
      }
      continue;
    }

    // -- live ---------------------------------------------------------------
    if (
      boss.currentAttack !== null &&
      boss.recoveryRemaining <= 0 &&
      boss.attackTime < boss.attackDuration
    ) {
      const step = Math.min(budget, boss.attackDuration - boss.attackTime);
      budget -= step;
      boss.attackTime += step;
      tickActive(ctx, boss, def, step);
      if (boss.attackTime >= boss.attackDuration - TIME_EPSILON) {
        beginRecovery(ctx, boss, def, phase);
      }
      continue;
    }

    // -- recovery -----------------------------------------------------------
    if (boss.recoveryRemaining > 0) {
      const step = Math.min(budget, boss.recoveryRemaining);
      budget -= step;
      boss.recoveryRemaining -= step;
      if (boss.recoveryRemaining <= TIME_EPSILON) {
        boss.recoveryRemaining = 0;
        endAttack(ctx, boss, phase);
      }
      continue;
    }

    // -- waiting ------------------------------------------------------------
    const wait = Math.max(0, boss.nextAttackIn);
    const step = Math.min(budget, wait);
    budget -= step;
    boss.nextAttackIn = wait - step;
    if (boss.nextAttackIn <= TIME_EPSILON) {
      boss.nextAttackIn = 0;
      if (!beginAttack(ctx, boss, def, phase)) {
        // Nothing legal to play — usually a phase whose whole attack list is
        // `advancedOnly` on an assisted difficulty. Wait another interval
        // rather than spinning on the selection.
        boss.nextAttackIn = attackGapSeconds(ctx, phase);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Keeps the boss inside `arenaRadius`, measured from `arenaCentre` on XZ. */
function clampToArena(boss: MutableBoss, def: BossDef): void {
  const limit = Math.max(0, def.arenaRadius - def.bodyRadius);
  const ox = boss.position.x - def.arenaCentre.x;
  const oz = boss.position.z - def.arenaCentre.z;
  const distance = Math.sqrt(ox * ox + oz * oz);
  if (distance <= limit || distance < 1e-6) return;
  const scale = limit / distance;
  boss.position.x = def.arenaCentre.x + ox * scale;
  boss.position.z = def.arenaCentre.z + oz * scale;
}

/**
 * Facing and approach.
 *
 * Turning is free between attacks, slow during a wind-up and stopped once the
 * attack is live. Walking happens only between attacks, and gets faster with
 * each phase — which is how "phase two adds movement pressure" is expressed
 * without a line of per-boss code.
 */
function updateMovement(
  ctx: SimContext,
  boss: MutableBoss,
  def: BossDef,
  deltaSeconds: number,
): void {
  const player = ctx.world.player;
  const previousX = boss.position.x;
  const previousZ = boss.position.z;

  const idle = boss.currentAttack === null;
  const winding = boss.telegraphRemaining > 0;
  const turnScale = idle ? 1 : winding ? BOSS_TELEGRAPH_TURN_SCALE : 0;

  const dx = player.position.x - boss.position.x;
  const dz = player.position.z - boss.position.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance > 1e-6 && turnScale > 0) {
    boss.yaw = moveTowardsAngle(
      boss.yaw,
      bossYawForDirection(dx, dz),
      BOSS_TURN_RADIANS_PER_SECOND * turnScale * deltaSeconds,
    );
  }

  if (idle && distance > 1e-6) {
    const slot = Math.max(0, phaseSlotOf(def, boss.phaseIndex));
    const speed = BOSS_APPROACH_SPEED * (1 + slot * BOSS_PHASE_SPEED_STEP);
    const standoff = def.bodyRadius + BOSS_STANDOFF_METRES;
    const travel = Math.min(speed * deltaSeconds, distance - standoff);
    if (travel > 0) {
      boss.position.x += (dx / distance) * travel;
      boss.position.z += (dz / distance) * travel;
    }
  }

  clampToArena(boss, def);

  boss.velocity.x = (boss.position.x - previousX) / deltaSeconds;
  boss.velocity.y = 0;
  boss.velocity.z = (boss.position.z - previousZ) / deltaSeconds;
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export const bossSystem: System = (ctx: SimContext): void => {
  const world = ctx.world;
  const boss = world.boss;
  if (boss === null) return;

  const def = ctx.content.bosses[boss.definitionId];
  if (def === undefined) return;

  const dt = ctx.dt;
  if (world.paused || dt <= 0) return;

  if (boss.defeated) {
    set(boss.velocity, 0, 0, 0);
    return;
  }

  ensureInitialised(ctx, boss, def);
  boss.phaseTime += dt;

  // -- retuning -------------------------------------------------------------
  if (boss.restoring) {
    updateRestoration(ctx, boss, def);
    clampToArena(boss, def);
    set(boss.velocity, 0, 0, 0);
    return;
  }

  // Thresholds are settled before the killing blow is resolved: a burst big
  // enough to end the fight still crossed every phase, and the arena the
  // retuning is played in has to be the one those flags describe.
  advancePhases(ctx, boss, def);

  // Zero health is not death: the Amplifier ruptures and the boss kneels.
  if (boss.health <= 0) {
    beginRestoration(ctx, boss, def);
    clampToArena(boss, def);
    return;
  }

  const phase = currentPhaseOf(def, boss);
  if (phase === null) return;

  // A scripted sequence owns the arena; the boss holds whatever it was doing
  // rather than winding up into a cutscene the player cannot dodge.
  if (world.cutsceneId === null) {
    advanceAttack(ctx, boss, def, phase, dt);
    updateMovement(ctx, boss, def, dt);
  } else {
    clampToArena(boss, def);
    set(boss.velocity, 0, 0, 0);
  }
};
