import { clamp, clamp01, distanceXZ, vec3, type Rank, type ResonanceFormId } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import { Layer } from '@tuner/physics';
import type { SimContext, System } from '../internal/context.js';
import type { MutablePlatform, MutablePuzzle, MutableWorld } from '../internal/world.js';
import type { HazardDef, RailDef, StageDef, TriggerDef } from '../content-types.js';
import type { StageResult } from '../state.js';
import { canStrikeResonator, strikeResonator } from '../internal/services.js';
import { findColliderByTag, instantiateEnemy } from './stage-loader.js';

/**
 * The stage runtime.
 *
 * This system runs *before* movement in the step order, and that ordering is
 * load-bearing: moving platforms must have advanced and written
 * `player.platformVelocity` before the player is moved, or the player drifts off
 * a 3 m/s platform by 5 cm every frame. The cost is that overlap checks use the
 * previous frame's player position — a 16 ms latency nobody can perceive.
 */

/** Radius within which the player is considered to be touching a checkpoint. */
const CHECKPOINT_RADIUS = 1.8;
const PICKUP_RADIUS = 1.3;
const TRIGGER_PAD = 0.6;
const RAIL_ATTACH_RADIUS = 1.5;
const RAIL_DETACH_COOLDOWN = 0.35;

/** Seconds a partial note sequence survives before it resets. */
const PUZZLE_IDLE_RESET_SECONDS = 3.5;

/** How quickly a region's infection eases toward its target, per second. */
const INFECTION_EASE_PER_SECOND = 0.55;

/** Coherence restored by touching a checkpoint, before the difficulty scale. */
const CHECKPOINT_COHERENCE = 35;

export const stageSystem: System = (ctx): void => {
  const { world, stageDef } = ctx;
  if (!stageDef || world.paused) return;

  world.stage.elapsedSeconds += ctx.rawDt;
  advanceBeat(ctx, stageDef);
  advancePlatforms(ctx, stageDef);
  advanceConjured(ctx);
  updateRails(ctx, stageDef);
  applyHazards(ctx, stageDef);
  enforceKillPlane(ctx, stageDef);
  updateCheckpoints(ctx);
  updateTriggers(ctx, stageDef);
  updateResonators(ctx);
  evaluatePuzzles(ctx, stageDef);
  collectPickups(ctx);
  updateMetrics(ctx);
  easeInfection(ctx);
};

// ---------------------------------------------------------------------------
// Musical clock
// ---------------------------------------------------------------------------

function advanceBeat(ctx: SimContext, stageDef: StageDef): void {
  const stage = ctx.world.stage;
  const beatsPerSecond = Math.max(0.1, stageDef.bpm) / 60;
  stage.beatPhase += beatsPerSecond * ctx.rawDt;
  stage.beatThisStep = false;
  while (stage.beatPhase >= 1) {
    stage.beatPhase -= 1;
    stage.beat += 1;
    stage.beatThisStep = true;
  }
}

// ---------------------------------------------------------------------------
// Moving platforms
// ---------------------------------------------------------------------------

function advancePlatforms(ctx: SimContext, stageDef: StageDef): void {
  const { world, physics } = ctx;
  const player = world.player;

  for (const def of stageDef.movingPlatforms) {
    const platform = world.stage.platforms.get(def.id);
    if (!platform) continue;

    platform.previousPosition.x = platform.position.x;
    platform.previousPosition.y = platform.position.y;
    platform.previousPosition.z = platform.position.z;

    const motion = def.motion;
    switch (motion.kind) {
      case 'linear': {
        const period = Math.max(0.1, motion.seconds) * 2 + (motion.pause ?? 0) * 2;
        platform.phase = (platform.phase + ctx.rawDt / period) % 1;
        const t = triangleWithPause(platform.phase, motion.seconds, motion.pause ?? 0);
        lerpVec(platform.position, platform.origin, motion.to, t);
        break;
      }
      case 'orbit': {
        platform.phase = (platform.phase + ctx.rawDt / Math.max(0.1, motion.seconds)) % 1;
        const angle = platform.phase * Math.PI * 2;
        platform.position.x = motion.centre.x + Math.cos(angle) * motion.radius;
        platform.position.y = motion.centre.y;
        platform.position.z = motion.centre.z + Math.sin(angle) * motion.radius;
        break;
      }
      case 'vertical': {
        platform.phase = (platform.phase + ctx.rawDt / Math.max(0.1, motion.seconds)) % 1;
        const offset = Math.sin(platform.phase * Math.PI * 2) * motion.amplitude;
        platform.position.x = platform.origin.x;
        platform.position.y = platform.origin.y + offset;
        platform.position.z = platform.origin.z;
        break;
      }
      case 'rhythm': {
        // Steps on the beat rather than sliding, so the player can read it as
        // part of the region's rhythm instead of as continuous motion.
        if (world.stage.beatThisStep) {
          const steps = Math.max(1, motion.beats);
          platform.phase = (platform.phase * steps + 1) % steps / steps;
        }
        lerpVec(platform.position, platform.origin, motion.to, platform.phase);
        break;
      }
      case 'collapse': {
        if (platform.respawnTimer > 0) {
          platform.respawnTimer -= ctx.rawDt;
          if (platform.respawnTimer <= 0) {
            platform.active = true;
            platform.collapseTimer = -1;
            platform.position.x = platform.origin.x;
            platform.position.y = platform.origin.y;
            platform.position.z = platform.origin.z;
          }
        } else if (platform.collapseTimer > 0) {
          platform.collapseTimer -= ctx.rawDt;
          if (platform.collapseTimer <= 0) {
            platform.active = false;
            platform.respawnTimer = motion.respawnSeconds;
            // Dropped far below rather than removed, so the collider handle and
            // the renderer's instance stay valid.
            platform.position.y = platform.origin.y - 500;
          }
        } else if (platform.active && standingOn(player.position, platform, def)) {
          platform.collapseTimer = motion.delaySeconds;
        }
        break;
      }
      default:
        break;
    }

    physics.setColliderTransform(platform.collider, platform.position, def.yaw ?? 0);

    const invDt = ctx.rawDt > 0 ? 1 / ctx.rawDt : 0;
    platform.velocity.x = (platform.position.x - platform.previousPosition.x) * invDt;
    platform.velocity.y = (platform.position.y - platform.previousPosition.y) * invDt;
    platform.velocity.z = (platform.position.z - platform.previousPosition.z) * invDt;
  }

  // Hand the player whatever they are standing on, so movement can inherit it.
  player.platformVelocity.x = 0;
  player.platformVelocity.y = 0;
  player.platformVelocity.z = 0;
  const ground = player.groundCollider;
  if (player.grounded && ground) {
    const tag = ground.descriptor.tag;
    if (tag !== undefined && tag.startsWith('platform:')) {
      const platform = world.stage.platforms.get(tag.slice('platform:'.length));
      if (platform) {
        player.platformVelocity.x = platform.velocity.x;
        player.platformVelocity.y = platform.velocity.y;
        player.platformVelocity.z = platform.velocity.z;
      }
    }
  }
}

/** Ping-pong with a hold at each end. */
function triangleWithPause(phase: number, travel: number, pause: number): number {
  const total = travel * 2 + pause * 2;
  if (total <= 0) return 0;
  const t = phase * total;
  if (t < travel) return t / travel;
  if (t < travel + pause) return 1;
  if (t < travel * 2 + pause) return 1 - (t - travel - pause) / travel;
  return 0;
}

function lerpVec(target: Vec3, from: Vec3, to: Vec3, t: number): void {
  target.x = from.x + (to.x - from.x) * t;
  target.y = from.y + (to.y - from.y) * t;
  target.z = from.z + (to.z - from.z) * t;
}

function standingOn(
  position: Vec3,
  platform: MutablePlatform,
  def: { readonly shape: { kind: string } },
): boolean {
  const dy = position.y - platform.position.y;
  if (dy < -0.2 || dy > 2.2) return false;
  return distanceXZ(position, platform.position) < 2.5 && def.shape.kind !== 'sphere';
}

// ---------------------------------------------------------------------------
// Conjured platforms
// ---------------------------------------------------------------------------

function advanceConjured(ctx: SimContext): void {
  const { world, physics } = ctx;
  for (let i = world.conjured.length - 1; i >= 0; i--) {
    const platform = world.conjured[i];
    if (!platform) continue;
    platform.lifeRemaining -= ctx.rawDt;
    if (platform.lifeRemaining <= 0) {
      if (platform.collider) physics.removeCollider(platform.collider);
      world.conjured.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Rails
// ---------------------------------------------------------------------------

function updateRails(ctx: SimContext, stageDef: StageDef): void {
  const player = ctx.world.player;

  if (player.railCooldown > 0) player.railCooldown -= ctx.rawDt;

  if (player.railId !== null) {
    const rail = stageDef.rails.find((r) => r.id === player.railId);
    if (!rail || ctx.input.buttons.jump.pressed) {
      detachRail(ctx);
      return;
    }
    if (player.railProgress <= 0 || player.railProgress >= 1) detachRail(ctx);
    return;
  }

  if (player.grounded || player.railCooldown > 0) return;

  for (const rail of stageDef.rails) {
    if (rail.requiresForm !== undefined && rail.requiresForm !== player.form) continue;
    const hit = nearestRailPoint(rail, player.position);
    if (hit === null || hit.distance > RAIL_ATTACH_RADIUS) continue;

    player.railId = rail.id;
    player.railProgress = hit.progress;
    player.railDirection = hit.forwardDot >= 0 ? 1 : -1;
    ctx.events.emit('player:railAttached', {
      railId: rail.id,
      position: { ...player.position },
    });
    return;
  }
}

function detachRail(ctx: SimContext): void {
  const player = ctx.world.player;
  const railId = player.railId;
  if (railId === null) return;
  player.railId = null;
  player.railCooldown = RAIL_DETACH_COOLDOWN;
  ctx.events.emit('player:railDetached', { railId, position: { ...player.position } });
}

function nearestRailPoint(
  rail: RailDef,
  position: Vec3,
): { distance: number; progress: number; forwardDot: number } | null {
  if (rail.points.length < 2) return null;

  let best: { distance: number; progress: number; forwardDot: number } | null = null;
  let travelled = 0;
  const total = railLength(rail);
  if (total <= 0) return null;

  for (let i = 0; i < rail.points.length - 1; i++) {
    const a = rail.points[i];
    const b = rail.points[i + 1];
    if (!a || !b) continue;

    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const lenSq = ex * ex + ey * ey + ez * ez;
    if (lenSq < 1e-9) continue;

    const t = clamp01(
      ((position.x - a.x) * ex + (position.y - a.y) * ey + (position.z - a.z) * ez) / lenSq,
    );
    const px = a.x + ex * t;
    const py = a.y + ey * t;
    const pz = a.z + ez * t;
    const distance = Math.hypot(position.x - px, position.y - py, position.z - pz);

    if (best === null || distance < best.distance) {
      const segLen = Math.sqrt(lenSq);
      best = {
        distance,
        progress: clamp01((travelled + segLen * t) / total),
        forwardDot: 0,
      };
    }
    travelled += Math.sqrt(lenSq);
  }

  return best;
}

function railLength(rail: RailDef): number {
  let total = 0;
  for (let i = 0; i < rail.points.length - 1; i++) {
    const a = rail.points[i];
    const b = rail.points[i + 1];
    if (!a || !b) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Hazards and the kill plane
// ---------------------------------------------------------------------------

function hazardActive(ctx: SimContext, def: HazardDef): boolean {
  if (def.clearedBy !== undefined && ctx.services.hasStageFlag(`hazard-cleared:${def.id}`)) {
    return false;
  }
  const rhythm = def.rhythm;
  if (!rhythm) return true;
  const cycle = Math.max(1, rhythm.beats);
  const offset = rhythm.offset ?? 0;
  const position = (((ctx.world.stage.beat - offset) % cycle) + cycle) % cycle;
  return position < Math.max(1, rhythm.activeBeats);
}

function applyHazards(ctx: SimContext, stageDef: StageDef): void {
  const player = ctx.world.player;
  if (player.movementState === 'downed') return;

  for (const def of stageDef.hazards) {
    if (!hazardActive(ctx, def)) continue;
    if (!overlapsShape(player.position, def.position, def.shape, 0.5)) continue;

    if (def.isPit === true) {
      respawnAtCheckpoint(ctx, 'pit');
      return;
    }
    ctx.services.damagePlayer(def.damage * ctx.rawDt * 4, `hazard:${def.id}`, def.position);
  }
}

function enforceKillPlane(ctx: SimContext, stageDef: StageDef): void {
  if (ctx.world.player.position.y >= stageDef.killPlaneY) return;
  respawnAtCheckpoint(ctx, 'fell');
}

function respawnAtCheckpoint(ctx: SimContext, reason: string): void {
  const { world, accessibility, difficultyProfile } = ctx;
  const stage = world.stage;
  const player = world.player;

  const checkpoint =
    stage.checkpoints.find((c) => c.id === stage.activeCheckpointId) ??
    stage.checkpoints.find((c) => c.activated) ??
    null;

  const target: Vec3 = checkpoint
    ? checkpoint.position
    : (ctx.stageDef?.spawnPoint ?? vec3(0, 2, 0));

  player.position.x = target.x;
  player.position.y = target.y;
  player.position.z = target.z;
  player.velocity.x = 0;
  player.velocity.y = 0;
  player.velocity.z = 0;
  player.railId = null;
  player.movementState = 'idle';
  player.invulnerableRemaining = Math.max(player.invulnerableRemaining, 0.6);

  // Fall-recovery assistance returns the player to safety at no cost. Without
  // it a fall costs Coherence — but never a death, which is why this is a
  // respawn rather than a downed state.
  if (!accessibility.fallRecovery) {
    const cost = 12 * difficultyProfile.incomingDamageScale;
    player.coherence = Math.max(1, player.coherence - cost);
    stage.damageTaken += cost;
  }

  ctx.events.emit('stage:respawned', {
    checkpointId: checkpoint?.id ?? null,
    position: { ...target },
  });
  ctx.events.emit('ui:notification', { text: reason === 'pit' ? 'Recovered' : 'Recovered', seconds: 1.2 });
}

function overlapsShape(
  point: Vec3,
  centre: Vec3,
  shape: { kind: string; halfExtents?: Vec3; radius?: number; halfHeight?: number },
  pad: number,
): boolean {
  switch (shape.kind) {
    case 'sphere':
      return (
        Math.hypot(point.x - centre.x, point.y - centre.y, point.z - centre.z) <=
        (shape.radius ?? 0) + pad
      );
    case 'capsule': {
      const halfHeight = shape.halfHeight ?? 0;
      const dy = clamp(point.y - centre.y, -halfHeight, halfHeight);
      return (
        Math.hypot(point.x - centre.x, point.y - centre.y - dy, point.z - centre.z) <=
        (shape.radius ?? 0) + pad
      );
    }
    default: {
      const he = shape.halfExtents ?? vec3();
      return (
        Math.abs(point.x - centre.x) <= he.x + pad &&
        Math.abs(point.y - centre.y) <= he.y + pad &&
        Math.abs(point.z - centre.z) <= he.z + pad
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

function updateCheckpoints(ctx: SimContext): void {
  const { world, difficultyProfile } = ctx;
  const player = world.player;

  for (const checkpoint of world.stage.checkpoints) {
    if (checkpoint.activated) continue;
    if (distanceXZ(player.position, checkpoint.position) > CHECKPOINT_RADIUS) continue;
    if (Math.abs(player.position.y - checkpoint.position.y) > 3) continue;

    checkpoint.activated = true;
    world.stage.activeCheckpointId = checkpoint.id;
    ctx.services.restoreCoherence(CHECKPOINT_COHERENCE * difficultyProfile.recoveryScale);
    ctx.events.emit('world:checkpointActivated', {
      checkpointId: checkpoint.id,
      position: { ...checkpoint.position },
    });
  }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function updateTriggers(ctx: SimContext, stageDef: StageDef): void {
  const { world } = ctx;
  const player = world.player;

  for (const def of stageDef.triggers) {
    const state = world.stage.triggers.get(def.id);
    if (!state) continue;
    if (state.fired && state.once) continue;
    if (!overlapsShape(player.position, def.position, def.shape, TRIGGER_PAD)) continue;

    state.fired = true;
    fireTrigger(ctx, stageDef, def);
  }
}

function fireTrigger(ctx: SimContext, stageDef: StageDef, def: TriggerDef): void {
  const { world } = ctx;
  const action = def.action;

  switch (action.kind) {
    case 'spawnWave': {
      const ids = new Set(action.spawnIds);
      const pending = world.stage.pendingSpawns.get(def.id) ?? [];
      for (const spawnId of [...action.spawnIds, ...pending]) {
        if (!ids.has(spawnId) && !pending.includes(spawnId)) continue;
        const spawn = stageDef.enemies.find((e) => e.id === spawnId);
        if (!spawn) continue;
        if (world.enemies.some((e) => e.spawnId === spawnId && !e.dead)) continue;
        const enemy = instantiateEnemy(spawn, ctx.content, ctx.ids);
        if (enemy) world.enemies.push(enemy);
      }
      world.stage.pendingSpawns.delete(def.id);
      break;
    }

    case 'objective':
      ctx.services.setObjective(action.text);
      break;

    case 'cutscene': {
      const scene = stageDef.cutscenes.find((c) => c.id === action.cutsceneId);
      world.cutsceneId = action.cutsceneId;
      // Ambient scenes leave the player in control; framed ones do not.
      world.cutsceneRemaining = scene
        ? scene.lines.reduce((total, line) => total + (line.seconds ?? 3), 0)
        : 3;
      if (scene) {
        for (const line of scene.lines) {
          ctx.services.showSubtitle(line.speaker, line.text, line.seconds ?? 3);
        }
        if (scene.cameraFocus) {
          world.camera.mode = 'cinematic';
          world.camera.focus.x = scene.cameraFocus.x;
          world.camera.focus.y = scene.cameraFocus.y;
          world.camera.focus.z = scene.cameraFocus.z;
          world.camera.scriptedRemaining = world.cutsceneRemaining;
        }
      }
      break;
    }

    case 'phase':
      setStagePhase(ctx, action.phase);
      break;

    case 'vista':
      world.camera.mode = 'vista';
      world.camera.secondaryFocus = { ...action.look };
      world.camera.scriptedRemaining = action.seconds;
      break;

    case 'tutorial': {
      if (world.stage.shownTutorials.has(action.tutorialId)) break;
      world.stage.shownTutorials.add(action.tutorialId);
      const tutorial = stageDef.tutorials.find((t) => t.id === action.tutorialId);
      if (tutorial) {
        ctx.events.emit('ui:notification', {
          text: `${tutorial.title} — ${tutorial.body}`,
          seconds: 5,
        });
        ctx.services.showSubtitle('Auralith', tutorial.body, 5);
      }
      break;
    }

    case 'setFlag':
      ctx.services.setStageFlag(action.flag);
      break;

    default:
      break;
  }
}

function setStagePhase(ctx: SimContext, phase: 'miniboss' | 'commander' | 'restoration'): void {
  const stage = ctx.world.stage;
  if (stage.phase === phase) return;
  const from = stage.phase;
  stage.previousPhase = from;
  stage.phase = phase;
  if (phase === 'restoration') stage.targetInfection = 0;
  ctx.events.emit('stage:phaseChanged', { stageId: stage.stageId, from, to: phase });
}

// ---------------------------------------------------------------------------
// Resonators and puzzles
// ---------------------------------------------------------------------------

function updateResonators(ctx: SimContext): void {
  const { world } = ctx;

  for (const resonator of world.stage.resonators.values()) {
    if (resonator.litRemaining > 0) resonator.litRemaining -= ctx.rawDt;
  }

  // Player shots light resonators. Detecting the overlap here as well as in the
  // combat system means a resonator responds whether it was struck by a burst
  // or by a projectile, without the two systems having to know about each other.
  for (const projectile of world.projectiles) {
    if (projectile.dead || projectile.owner !== 'player') continue;
    for (const resonator of world.stage.resonators.values()) {
      if (resonator.locked) continue;
      if (!canStrikeResonator(resonator, projectile.form)) continue;
      const reach = projectile.radius + 1.1;
      if (
        Math.hypot(
          projectile.position.x - resonator.position.x,
          projectile.position.y - resonator.position.y,
          projectile.position.z - resonator.position.z,
        ) > reach
      ) {
        continue;
      }
      const wasLit = resonator.litRemaining > 0;
      strikeResonator(ctx.events, resonator);
      projectile.dead = true;
      const puzzle = world.stage.puzzles.get(resonator.puzzleId);
      if (puzzle && !puzzle.solved) {
        puzzle.idleSeconds = 0;
        if (puzzle.kind === 'sequence') {
          puzzle.progress.push(resonator.order);
        } else if (puzzle.kind === 'echo' && wasLit) {
          // Struck twice inside its own hold window — what Echo Form is for.
          puzzle.progress.push(resonator.order);
        }
      }
      break;
    }
  }
}

function evaluatePuzzles(ctx: SimContext, stageDef: StageDef): void {
  const { world } = ctx;

  for (const puzzle of world.stage.puzzles.values()) {
    if (puzzle.solved) continue;

    const def = stageDef.puzzles.find((p) => p.id === puzzle.id);
    if (!def) continue;

    const resonators = puzzle.resonatorIds
      .map((id) => world.stage.resonators.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    if (resonators.length === 0) continue;

    puzzle.idleSeconds += ctx.rawDt;

    let solved = false;

    switch (puzzle.kind) {
      case 'simultaneous':
        solved = resonators.every((r) => r.litRemaining > 0);
        break;

      case 'sustain': {
        // Every resonator lit at once, and held. Tracked on `progress[0]` as an
        // accumulating duration rather than a note list.
        if (resonators.every((r) => r.litRemaining > 0)) {
          const held = (puzzle.progress[0] ?? 0) + ctx.rawDt;
          puzzle.progress[0] = held;
          solved = held >= 1.25;
        } else {
          puzzle.progress[0] = 0;
        }
        break;
      }

      case 'sequence': {
        const expected = resonators.slice().sort((a, b) => a.order - b.order).map((r) => r.order);
        const struck = puzzle.progress;
        let matches = true;
        for (let i = 0; i < struck.length; i++) {
          if (struck[i] !== expected[i]) {
            matches = false;
            break;
          }
        }
        if (!matches) {
          puzzle.progress = [];
          ctx.events.emit('puzzle:failed', {
            puzzleId: puzzle.id,
            position: { ...(resonators[0]?.position ?? vec3()) },
          });
        } else {
          solved = struck.length >= expected.length;
        }
        break;
      }

      case 'echo':
        solved = puzzle.progress.length >= resonators.length;
        break;

      default:
        break;
    }

    // A partial sequence times out rather than lingering, so a player who walks
    // away and returns starts clean instead of failing on a stale first note.
    if (
      !solved &&
      puzzle.kind !== 'sustain' &&
      puzzle.progress.length > 0 &&
      puzzle.idleSeconds > PUZZLE_IDLE_RESET_SECONDS
    ) {
      puzzle.progress = [];
    }

    if (solved) solvePuzzle(ctx, stageDef, puzzle, resonators[0]?.position ?? vec3());
  }
}

function solvePuzzle(
  ctx: SimContext,
  stageDef: StageDef,
  puzzle: MutablePuzzle,
  at: Vec3,
): void {
  const { world, physics } = ctx;
  puzzle.solved = true;
  for (const id of puzzle.resonatorIds) {
    const resonator = world.stage.resonators.get(id);
    if (resonator) resonator.locked = true;
  }

  const def = stageDef.puzzles.find((p) => p.id === puzzle.id);
  const reward = def?.reward;

  if (reward) {
    switch (reward.kind) {
      case 'openDoor': {
        const handle = findColliderByTag(physics, `door:${reward.doorId}`);
        if (handle) physics.removeCollider(handle);
        ctx.services.setStageFlag(`door-open:${reward.doorId}`);
        break;
      }
      case 'spawnPlatforms': {
        for (const platformId of reward.platformIds) {
          const platform = world.stage.platforms.get(platformId);
          if (!platform) continue;
          platform.active = true;
          platform.respawnTimer = -1;
          platform.collapseTimer = -1;
          platform.position.x = platform.origin.x;
          platform.position.y = platform.origin.y;
          platform.position.z = platform.origin.z;
        }
        ctx.services.setStageFlag(`platforms:${puzzle.id}`);
        break;
      }
      case 'revealSecret': {
        for (const pickup of world.pickups) {
          if (pickup.contentId === reward.contentId) pickup.hidden = false;
        }
        ctx.services.setStageFlag(`revealed:${reward.contentId}`);
        break;
      }
      case 'setFlag':
        ctx.services.setStageFlag(reward.flag);
        break;
      default:
        break;
    }
  }

  ctx.events.emit('puzzle:solved', { puzzleId: puzzle.id, position: { ...at } });
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

function collectPickups(ctx: SimContext): void {
  const { world } = ctx;
  const player = world.player;

  for (const pickup of world.pickups) {
    if (pickup.collected || pickup.hidden) continue;
    if (pickup.requiresForm !== null && pickup.requiresForm !== player.form) continue;

    pickup.bobPhase += ctx.rawDt;
    if (
      Math.hypot(
        player.position.x - pickup.position.x,
        player.position.y + 0.8 - pickup.position.y,
        player.position.z - pickup.position.z,
      ) > PICKUP_RADIUS
    ) {
      continue;
    }

    pickup.collected = true;
    world.stage.collectedPickups.add(pickup.contentId);

    if (pickup.kind === 'coherence') {
      ctx.services.restoreCoherence(pickup.amount * ctx.difficultyProfile.recoveryScale);
    }

    ctx.events.emit('world:pickupCollected', {
      contentId: pickup.contentId,
      kind: pickup.kind,
      amount: pickup.amount,
      position: { ...pickup.position },
    });

    if (pickup.isSecret) {
      world.stage.foundSecrets.add(pickup.contentId);
      ctx.events.emit('world:secretFound', {
        contentId: pickup.contentId,
        position: { ...pickup.position },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Metrics and infection
// ---------------------------------------------------------------------------

function updateMetrics(ctx: SimContext): void {
  const { world, movement } = ctx;
  const player = world.player;

  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  if (speed >= movement.flowSpeedThreshold) world.stage.flowSeconds += ctx.rawDt;

  if (player.coherence < world.stage.lowestCoherence) {
    world.stage.lowestCoherence = player.coherence;
  }
}

function easeInfection(ctx: SimContext): void {
  const stage = ctx.world.stage;
  const before = stage.infection;
  const delta = stage.targetInfection - stage.infection;
  if (Math.abs(delta) < 1e-4) {
    stage.infection = stage.targetInfection;
  } else {
    stage.infection += Math.sign(delta) * Math.min(Math.abs(delta), INFECTION_EASE_PER_SECOND * ctx.rawDt);
  }

  // Emitted on meaningful movement only — materials, lighting, sky and the
  // score all read this one value, so it is worth not spamming.
  if (Math.abs(stage.infection - before) > 0.005) {
    ctx.events.emit('world:infectionChanged', { infection: stage.infection });
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface Criterion {
  label: string;
  value: string;
  points: number;
  maxPoints: number;
}

/**
 * Scores a run.
 *
 * Ranks exist to make a second visit interesting. They never gate progress, and
 * nothing in the story is behind one — which is why the weights reward variety
 * and flow rather than only speed.
 */
export function computeStageResult(
  world: MutableWorld,
  stageDef: StageDef,
  formAwarded: ResonanceFormId | null,
): StageResult {
  const stage = world.stage;
  const player = world.player;
  const breakdown: Criterion[] = [];

  const push = (label: string, value: string, points: number, maxPoints: number): void => {
    breakdown.push({ label, value, points: clamp(points, 0, maxPoints), maxPoints });
  };

  // Time against par ---------------------------------------------------------
  const par = Math.max(1, stageDef.parSeconds);
  const timeRatio = stage.elapsedSeconds / par;
  const timePoints = Math.round(250 * clamp01(1.6 - timeRatio));
  push('Time', formatSeconds(stage.elapsedSeconds), timePoints, 250);

  // Coherence retained ------------------------------------------------------
  const retained = player.maxCoherence > 0 ? player.coherence / player.maxCoherence : 0;
  push('Coherence held', `${Math.round(retained * 100)}%`, Math.round(200 * retained), 200);

  // Damage taken ------------------------------------------------------------
  const damageRatio = clamp01(stage.damageTaken / Math.max(1, player.maxCoherence * 2));
  push('Interference absorbed', Math.round(stage.damageTaken).toString(), Math.round(150 * (1 - damageRatio)), 150);

  // Secrets -----------------------------------------------------------------
  const secretRatio = stage.secretsTotal > 0 ? stage.foundSecrets.size / stage.secretsTotal : 1;
  push('Secrets', `${stage.foundSecrets.size}/${stage.secretsTotal}`, Math.round(200 * secretRatio), 200);

  // Enemies cleansed --------------------------------------------------------
  const cleansed = Math.min(1, stage.enemiesCleansed / 20);
  push('Cleansed', stage.enemiesCleansed.toString(), Math.round(100 * cleansed), 100);

  // Counter accuracy --------------------------------------------------------
  const accuracy =
    player.counterAttempts > 0 ? player.counterSuccesses / player.counterAttempts : 0;
  push(
    'Counter accuracy',
    player.counterAttempts > 0 ? `${Math.round(accuracy * 100)}%` : '—',
    Math.round(100 * accuracy),
    100,
  );

  // Flow --------------------------------------------------------------------
  const flowRatio = stage.elapsedSeconds > 0 ? clamp01(stage.flowSeconds / stage.elapsedSeconds) : 0;
  push('Flow', `${Math.round(flowRatio * 100)}%`, Math.round(100 * flowRatio), 100);

  // Ability variety ---------------------------------------------------------
  const variety = Math.min(1, (stage.formsUsed.size - 1) / 3);
  push('Forms used', stage.formsUsed.size.toString(), Math.round(100 * Math.max(0, variety)), 100);

  const score = breakdown.reduce((total, row) => total + row.points, 0);
  const maxScore = breakdown.reduce((total, row) => total + row.maxPoints, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;

  const rank: Rank =
    ratio >= 0.9 ? 'S' : ratio >= 0.75 ? 'A' : ratio >= 0.6 ? 'B' : ratio >= 0.4 ? 'C' : 'D';

  return {
    stageId: stage.stageId,
    completed: world.boss?.defeated === true || stage.phase === 'results',
    rank,
    score,
    metrics: {
      elapsedSeconds: stage.elapsedSeconds,
      damageTaken: stage.damageTaken,
      deaths: stage.deaths,
      enemiesCleansed: stage.enemiesCleansed,
      secretsFound: stage.foundSecrets.size,
      secretsTotal: stage.secretsTotal,
      countersLanded: player.counterSuccesses,
      countersAttempted: player.counterAttempts,
      formsUsed: Array.from(stage.formsUsed),
      flowRatio,
      lowestCoherence: Number.isFinite(stage.lowestCoherence) ? stage.lowestCoherence : player.maxCoherence,
    },
    breakdown,
    formAwarded,
    newBest: false,
  };
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export { Layer };
