import type { DifficultyId, EventBus, ResonanceFormId, StageId } from '@tuner/shared';
import {
  DIFFICULTY_PROFILES,
  SIM_STEP_SECONDS,
  createIdAllocator,
  createRng,
} from '@tuner/shared';
import type { InputFrame } from '@tuner/input';
import type { GameEvents } from './events.js';
import type { GameCore, GameCoreConfig } from './game.js';
import type { StageResult, WorldState } from './state.js';
import type { StageDef } from './content-types.js';
import {
  DEFAULT_ACCESSIBILITY_CONFIG,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_COMBAT_CONFIG,
  DEFAULT_MOVEMENT_CONFIG,
  type AccessibilityConfig,
  type CameraConfig,
  type CombatConfig,
  type MovementConfig,
} from './config.js';
import { createWorld } from './internal/create-world.js';
import { createProjector } from './internal/projection.js';
import { createSimServices } from './internal/services.js';
import type { SimContext } from './internal/context.js';
import { movementSystem } from './systems/movement.js';
import { combatSystem } from './systems/combat.js';
import { projectileSystem } from './systems/projectiles.js';
import { enemySystem } from './systems/enemies.js';
import { bossSystem } from './systems/boss.js';
import { stageSystem, computeStageResult } from './systems/stage.js';
import { loadStageIntoWorld } from './systems/stage-loader.js';
import { formSystem, getFormBehaviour } from './systems/forms.js';
import { cameraSystem } from './systems/camera.js';

/**
 * Assembles the simulation.
 *
 * This is the only place that knows the system order, and the only place that
 * owns the world. Everything else — hosts, renderers, tests — talks to the
 * returned `GameCore` facade.
 */

/**
 * How far time is slowed during hit-stop. Not zero: freezing the simulation
 * outright makes input feel dropped, whereas a heavy slow reads as weight.
 */
const HIT_STOP_TIME_SCALE = 0.12;

export function createGameCore(config: GameCoreConfig): GameCore {
  const events: EventBus<GameEvents> = config.events;
  const physics = config.physics;
  const content = config.content;

  const ids = createIdAllocator(1);
  const rng = createRng(config.seed ?? 'world-chord');

  let difficulty: DifficultyId = config.difficulty ?? 'standard';
  let movement: MovementConfig = { ...DEFAULT_MOVEMENT_CONFIG, ...config.movement };
  let combat: CombatConfig = { ...DEFAULT_COMBAT_CONFIG, ...config.combat };
  let camera: CameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...config.camera };
  let accessibility: AccessibilityConfig = {
    ...DEFAULT_ACCESSIBILITY_CONFIG,
    ...config.accessibility,
  };

  const maxCoherence = combat.maxCoherence + (config.maxCoherenceBonus ?? 0);
  const world = createWorld({ playerId: ids.next(), maxCoherence, difficulty });
  if (config.unlockedForms && config.unlockedForms.length > 0) {
    world.player.unlockedForms = Array.from(new Set(['base', ...config.unlockedForms]));
  }

  const projector = createProjector();
  let stageDef: StageDef | null = null;

  // The camera basis is supplied by the host each step so that aiming matches
  // exactly what the player is looking at. Until the host reports one, aim runs
  // off the player's own facing.
  let cameraYaw = 0;
  let cameraPitch = 0;

  let lastStepMs = 0;
  let disposed = false;

  /**
   * Step timing is diagnostics, not gameplay. The simulation must never read
   * wall-clock time — the portability guard enforces that — so the host supplies
   * a clock if it wants the measurement. Without one, `lastStepMs` stays zero,
   * which is honest: no clock, no number.
   */
  const nowMs = config.clock ?? ((): number => 0);

  const services = createSimServices({
    world,
    physics,
    events,
    ids,
    rng,
    getCombat: () => combat,
    getMovement: () => movement,
    getAccessibility: () => accessibility,
    getDifficultyProfile: () => DIFFICULTY_PROFILES[difficulty],
    getContent: () => content,
    getStageDef: () => stageDef,
  });

  /** Rebuilt per step; cheap, and it keeps every field honest rather than stale. */
  function buildContext(input: InputFrame, dt: number, rawDt: number): SimContext {
    return {
      world,
      physics,
      events,
      input,
      dt,
      rawDt,
      rng,
      ids,
      content,
      stageDef,
      movement,
      combat,
      camera,
      accessibility,
      difficultyProfile: DIFFICULTY_PROFILES[difficulty],
      formBehaviour: getFormBehaviour(world.player.form),
      cameraYaw,
      cameraPitch,
      services,
    };
  }

  /**
   * System order. The one decision worth remembering: the stage system runs
   * *before* movement so moving platforms have advanced and written
   * `player.platformVelocity` — otherwise the player drifts off a platform by
   * however far it travelled that frame.
   */
  const systems = [
    formSystem,
    stageSystem,
    movementSystem,
    combatSystem,
    projectileSystem,
    enemySystem,
    bossSystem,
    cameraSystem,
  ] as const;

  const core: GameCore = {
    loadStage(stageId: StageId, options): void {
      const def = content.stages[stageId];
      if (!def) {
        throw new Error(`No stage content registered for "${stageId}".`);
      }
      stageDef = def;
      loadStageIntoWorld({
        world,
        stageDef: def,
        physics,
        ids,
        difficulty,
        checkpointId: options?.checkpointId ?? null,
        accessibility,
      });
      world.tick = 0;
      world.elapsedSeconds = 0;
      world.hitStopRemaining = 0;
      projector.project(world);
      // Match previous to current so the first rendered frame does not
      // interpolate from a stale position and smear the player across the level.
      projector.syncPrevious();
    },

    unloadStage(): void {
      physics.clear();
      stageDef = null;
      world.enemies.length = 0;
      world.projectiles.length = 0;
      world.pickups.length = 0;
      world.conjured.length = 0;
      world.boss = null;
      world.stage.platforms.clear();
      world.stage.resonators.clear();
      world.stage.puzzles.clear();
      world.stage.triggers.clear();
      world.stage.checkpoints.length = 0;
    },

    step(fixedDelta: number, input: InputFrame): void {
      if (disposed || world.paused) return;
      const started = nowMs();

      // Hit-stop slows the simulation rather than stopping it, so a hit reads
      // as weight instead of as dropped input.
      let dt = fixedDelta;
      if (world.hitStopRemaining > 0) {
        world.hitStopRemaining = Math.max(0, world.hitStopRemaining - fixedDelta);
        dt = fixedDelta * HIT_STOP_TIME_SCALE;
      }

      if (world.cutsceneRemaining > 0) {
        world.cutsceneRemaining = Math.max(0, world.cutsceneRemaining - fixedDelta);
        if (world.cutsceneRemaining === 0) world.cutsceneId = null;
      }

      const ctx = buildContext(input, dt, fixedDelta);
      world.player.hurtThisStep = false;

      for (const system of systems) {
        system(ctx);
      }

      // Retire anything marked dead this step, in one pass, so systems never
      // have to reason about holes in the arrays mid-frame.
      pruneDead(world.enemies);
      pruneDead(world.projectiles);

      world.tick += 1;
      world.elapsedSeconds += fixedDelta;

      projector.project(world);
      lastStepMs = nowMs() - started;
    },

    get state(): WorldState {
      return projector.current;
    },

    get previousState(): WorldState {
      return projector.previous;
    },

    get stageDef(): StageDef | null {
      return stageDef;
    },

    setPaused(paused: boolean): void {
      world.paused = paused;
    },

    setDifficulty(next: DifficultyId): void {
      difficulty = next;
      world.difficulty = next;
    },

    setAccessibility(next: Partial<AccessibilityConfig>): void {
      accessibility = { ...accessibility, ...next };
    },

    setMovementConfig(next: Partial<MovementConfig>): void {
      movement = { ...movement, ...next };
    },

    setCombatConfig(next: Partial<CombatConfig>): void {
      combat = { ...combat, ...next };
    },

    get movementConfig(): Readonly<MovementConfig> {
      return movement;
    },
    get combatConfig(): Readonly<CombatConfig> {
      return combat;
    },
    get cameraConfig(): Readonly<CameraConfig> {
      return camera;
    },
    get accessibilityConfig(): Readonly<AccessibilityConfig> {
      return accessibility;
    },

    equipForm(form: ResonanceFormId): boolean {
      if (!world.player.unlockedForms.includes(form)) return false;
      if (world.player.form === form) return true;
      const from = world.player.form;
      world.player.form = form;
      world.stage.formsUsed.add(form);
      events.emit('form:switched', { from, to: form });
      return true;
    },

    unlockForm(form: ResonanceFormId): void {
      if (world.player.unlockedForms.includes(form)) return;
      world.player.unlockedForms.push(form);
    },

    respawn(): void {
      const checkpoint =
        world.stage.checkpoints.find((c) => c.id === world.stage.activeCheckpointId) ??
        world.stage.checkpoints.find((c) => c.activated) ??
        null;
      const target = checkpoint?.position ?? stageDef?.spawnPoint ?? { x: 0, y: 2, z: 0 };
      world.player.position.x = target.x;
      world.player.position.y = target.y;
      world.player.position.z = target.z;
      world.player.velocity.x = 0;
      world.player.velocity.y = 0;
      world.player.velocity.z = 0;
      world.player.coherence = world.player.maxCoherence;
      world.player.movementState = 'idle';
      world.player.invulnerableRemaining = combat.invulnerableSeconds;
      events.emit('stage:respawned', {
        checkpointId: checkpoint?.id ?? null,
        position: { ...target },
      });
      projector.project(world);
      projector.syncPrevious();
    },

    computeResult(): StageResult | null {
      if (!stageDef) return null;
      const awarded = world.boss?.defeated
        ? (content.bosses[world.boss.definitionId]?.awardsForm ?? null)
        : null;
      return computeStageResult(world, stageDef, awarded);
    },

    get stats() {
      return {
        lastStepMs,
        entityCount: world.enemies.length + (world.boss ? 1 : 0),
        projectileCount: world.projectiles.length,
        colliderCount: physics.stats.colliderCount,
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      core.unloadStage();
      events.clear();
    },
  };

  return core;
}

/** Removes entities flagged dead, in place, preserving order. */
function pruneDead<T extends { dead: boolean }>(list: T[]): void {
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const item = list[read];
    if (!item || item.dead) continue;
    list[write] = item;
    write++;
  }
  list.length = write;
}

export { SIM_STEP_SECONDS };
