import type { DifficultyId, EventBus, ResonanceFormId, StageId } from '@tuner/shared';
import {
  DIFFICULTY_PROFILES,
  SIM_STEP_SECONDS,
  createIdAllocator,
  createRng,
} from '@tuner/shared';
import { createEmptyInputFrame, type InputFrame } from '@tuner/input';
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
import {
  attachAdventureEvents,
  attachAdventureRuntime,
  createAdventureRuntime,
  detachAdventureRuntime,
  projectAdventureState,
  projectNpcViews,
  runAdventureStep,
  skipAdventureDialogue,
  type NpcView,
} from './systems/adventure.js';
import type { AdventureState } from './adventure-types.js';

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

/**
 * A neutral frame, for the handful of operations a host performs outside the
 * step loop. Frozen at module scope because nothing may write to it: a stray
 * mutation here would inject a phantom button press into the next real step.
 */
const EMPTY_INPUT: InputFrame = Object.freeze(createEmptyInputFrame());

export function createGameCore(config: GameCoreConfig): GameCore {
  const events: EventBus<GameEvents> = config.events;
  const physics = config.physics;
  const content = config.content;

  const ids = createIdAllocator(1);
  const rng = createRng(config.seed ?? 'world-chord');

  let difficulty: DifficultyId = config.difficulty ?? 'standard';
  let movement: MovementConfig = { ...DEFAULT_MOVEMENT_CONFIG, ...config.movement };
  let combat: CombatConfig = { ...DEFAULT_COMBAT_CONFIG, ...config.combat };
  const camera: CameraConfig = { ...DEFAULT_CAMERA_CONFIG, ...config.camera };
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

  /**
   * The adventure layer: people, conversations, quests, markers, codex, motifs.
   *
   * Rebuilt per region rather than refilled. `addAdventureContent` appends to
   * the NPC list, so re-entering a zone with a reused runtime would stand a
   * second copy of every villager inside the first — and `resetAdventureRuntime`
   * clears live progress without clearing that list, so it is not the escape
   * hatch its name suggests. A fresh runtime per load has neither problem.
   *
   * The consequence is honest and worth stating: **quest progress does not yet
   * survive leaving a region.** Carrying it across is a save-system concern, and
   * the save system is not wired up. Nothing here pretends otherwise.
   *
   * The runtime exists even when no zone is authored. An empty one does nothing,
   * which is how the two action-platformer stages keep behaving exactly as they
   * did before this layer existed.
   */
  let adventure = createAdventureRuntime();
  attachAdventureRuntime(world, adventure);
  let detachAdventureEvents = attachAdventureEvents(adventure, events);
  /** The region the runtime belongs to, so a temple interior does not rebuild it. */
  let currentRegionId: StageId | null = null;

  /**
   * Projections are computed on demand and cached by tick.
   *
   * The renderer wants NPCs every frame and the HUD wants objectives ten times
   * a second, but neither changes more than once per simulation step. Caching on
   * `world.tick` means repeated reads inside one frame are free, and a step
   * allocates these arrays at most once — not once per caller.
   */
  let adventureTick = -1;
  let adventureState: AdventureState | null = null;
  let npcViews: readonly NpcView[] = [];

  // The camera basis is supplied by the host each step so that aiming matches
  // exactly what the player is looking at. Until the host reports one, aim runs
  // off the player's own facing.
  const cameraYaw = 0;
  const cameraPitch = 0;

  let lastStepMs = 0;
  let disposed = false;

  /**
   * Step timing is diagnostics, not gameplay. The simulation must never read
   * wall-clock time — the portability guard enforces that — so the host supplies
   * a clock if it wants the measurement. Without one, `lastStepMs` stays zero,
   * which is honest: no clock, no number.
   */
  const nowMs = config.clock ?? ((): number => 0);

  /**
   * Services are built once, but several of their inputs change during play:
   * the settings screen can retune combat and accessibility, difficulty can be
   * switched, a stage can be loaded, and the equipped form changes every time
   * the player spins the wheel. Passing plain values would freeze all of that
   * at construction, so the dependency object exposes live getters instead.
   */
  const services = createSimServices({
    world,
    physics,
    events,
    ids,
    rng,
    get combat() {
      return combat;
    },
    get accessibility() {
      return accessibility;
    },
    get difficultyProfile() {
      return DIFFICULTY_PROFILES[difficulty];
    },
    get content() {
      return content;
    },
    get stageDef() {
      return stageDef;
    },
    get formBehaviour() {
      return getFormBehaviour(world.player.form);
    },
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
   *
   * The adventure system runs second-to-last, after everything that can satisfy
   * a quest step has happened: triggers fired by `stageSystem`, puzzles solved,
   * enemies cleansed by `enemySystem`, a guardian freed by `bossSystem`. Reading
   * those a step late would show the player an objective ticking over one frame
   * after the thing they just did. The camera still resolves last, so it can
   * frame whoever started talking this step.
   */
  const systems = [
    formSystem,
    stageSystem,
    movementSystem,
    combatSystem,
    projectileSystem,
    enemySystem,
    bossSystem,
    adventureStep,
    cameraSystem,
  ] as const;

  /** Binds the adventure step to this core's runtime, which is rebuilt per region. */
  function adventureStep(ctx: SimContext): void {
    runAdventureStep(ctx, adventure);
  }

  /** Recomputes the adventure projections if the simulation has moved on. */
  function refreshAdventureProjection(): void {
    if (adventureTick === world.tick && adventureState !== null) return;
    adventureTick = world.tick;
    adventureState = projectAdventureState(adventure);
    npcViews = projectNpcViews(adventure);
  }

  /**
   * The shared body of `loadStage` and `loadTemple`.
   *
   * `regionId` is the *region* the space belongs to, which is not always the
   * space itself: a temple interior lives inside a region and carries its id, so
   * walking into one keeps that region's quests, codex and motifs. Rebuilding
   * the adventure runtime only when the region actually changes is what makes
   * that true.
   */
  function enterStage(
    def: StageDef,
    regionId: StageId,
    interior: boolean,
    checkpointId: string | null,
  ): void {
    stageDef = def;
    loadStageIntoWorld({
      world,
      stageDef: def,
      physics,
      ids,
      content,
      difficulty,
      checkpointId,
      accessibility,
    });

    if (regionId !== currentRegionId) {
      // A new region: its people, quests and record arrive with its geometry.
      detachAdventureEvents();
      adventure = createAdventureRuntime(content.zones?.[regionId] ?? {});
      attachAdventureRuntime(world, adventure);
      detachAdventureEvents = attachAdventureEvents(adventure, events);
      currentRegionId = regionId;
    }
    adventure.interior = interior;
    adventureTick = -1;

    world.tick = 0;
    world.elapsedSeconds = 0;
    world.hitStopRemaining = 0;
    projector.project(world);
    // Match previous to current so the first rendered frame does not
    // interpolate from a stale position and smear the player across the level.
    projector.syncPrevious();
  }

  const core: GameCore = {
    loadStage(stageId: StageId, options): void {
      const def = content.stages[stageId];
      if (!def) {
        throw new Error(`No stage content registered for "${stageId}".`);
      }
      enterStage(def, stageId, false, options?.checkpointId ?? null);
    },

    /**
     * Enters a temple interior.
     *
     * Keyed by temple id rather than `StageId` because `StageId` enumerates the
     * ten regions and a temple is a room inside one. The region's adventure
     * state survives the transition; its villagers do not follow the player in.
     */
    loadTemple(templeId: string, options): void {
      const def = content.templeStages?.[templeId];
      if (!def) {
        throw new Error(`No temple content registered for "${templeId}".`);
      }
      enterStage(def, def.id, true, options?.checkpointId ?? null);
    },

    unloadStage(): void {
      physics.clear();
      stageDef = null;
      currentRegionId = null;
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
      // Re-project so consumers see the emptied world immediately rather than
      // the last populated frame.
      projector.project(world);
      projector.syncPrevious();
    },

    get adventure(): AdventureState {
      refreshAdventureProjection();
      // Non-null after a refresh; the assertion-free path is the cache check.
      return adventureState ?? projectAdventureState(adventure);
    },

    get npcs(): readonly NpcView[] {
      refreshAdventureProjection();
      return npcViews;
    },

    /**
     * Ends the running conversation, if one is running.
     *
     * Separate from `skipCutscene` because they are different promises: a
     * cutscene may refuse to be skipped, a conversation never does.
     */
    skipDialogue(): boolean {
      if (!stageDef) return false;
      const ctx = buildContext(EMPTY_INPUT, SIM_STEP_SECONDS, SIM_STEP_SECONDS);
      const skipped = skipAdventureDialogue(ctx, adventure);
      if (skipped) adventureTick = -1;
      return skipped;
    },

    /** Ends the running cutscene, if it permits skipping. */
    skipCutscene(): boolean {
      if (world.cutsceneId === null) return false;
      const scene = stageDef?.cutscenes.find((c) => c.id === world.cutsceneId);
      if (scene && scene.skippable === false) return false;
      world.cutsceneId = null;
      world.cutsceneRemaining = 0;
      if (world.camera.mode === 'cinematic') {
        world.camera.mode = 'follow';
        world.camera.scriptedRemaining = 0;
      }
      return true;
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

      // Every cutscene is skippable. A player on their second run should never
      // be held in a scene they have already watched, so any of the confirm
      // inputs ends it immediately.
      if (
        world.cutsceneId !== null &&
        (input.buttons.jump.pressed ||
          input.buttons.interact.pressed ||
          input.buttons.fire.pressed)
      ) {
        const scene = stageDef?.cutscenes.find((c) => c.id === world.cutsceneId);
        if (!scene || scene.skippable !== false) {
          world.cutsceneId = null;
          world.cutsceneRemaining = 0;
          if (world.camera.mode === 'cinematic') {
            world.camera.mode = 'follow';
            world.camera.scriptedRemaining = 0;
          }
        }
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
      detachAdventureEvents();
      detachAdventureRuntime(world);
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
