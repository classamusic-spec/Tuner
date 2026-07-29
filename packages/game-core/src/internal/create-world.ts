import type { DifficultyId, EntityId, ResonanceFormId } from '@tuner/shared';
import { vec3 } from '@tuner/shared';
import type { MutablePlayer, MutableStage, MutableWorld } from './world.js';

/**
 * Constructs a blank simulation world.
 *
 * Everything starts in a defined state — no undefined fields, no partially
 * initialised vectors — so a system can never observe a half-built world. The
 * stage loader fills in geometry and population on top of this.
 */

export function createPlayer(id: EntityId, maxCoherence: number): MutablePlayer {
  return {
    id,
    position: vec3(),
    velocity: vec3(),
    yaw: 0,
    targetYaw: 0,
    movementState: 'idle',
    previousMovementState: 'idle',
    stateTime: 0,

    grounded: false,
    wasGrounded: false,
    groundNormal: vec3(0, 1, 0),
    groundCollider: null,
    platformVelocity: vec3(),

    coyoteRemaining: 0,
    jumpBufferRemaining: 0,
    jumpsRemaining: 2,
    jumpHeld: false,
    dashesRemaining: 1,
    dashCooldown: 0,
    dashTimeRemaining: 0,
    dashDirection: vec3(0, 0, 1),
    slideTimeRemaining: 0,
    inputLockRemaining: 0,

    touchingWall: false,
    wallNormal: null,
    wallClingRemaining: 0,
    ledgeTarget: null,
    mantleRemaining: 0,

    railId: null,
    railProgress: 0,
    railDirection: 1,
    railCooldown: 0,

    inWater: false,
    waterSurfaceY: 0,

    coherence: maxCoherence,
    maxCoherence,
    invulnerableRemaining: 0,
    hurtThisStep: false,

    form: 'base',
    unlockedForms: ['base'],

    fireCooldown: 0,
    chargeHeldSeconds: 0,
    chargeTier: 0,
    isCharging: false,
    burstCooldown: 0,

    counterActive: false,
    counterWindowRemaining: 0,
    counterCooldownRemaining: 0,
    counterSuccesses: 0,
    counterAttempts: 0,

    lockedTarget: null,
    lockOnLostSeconds: 0,
    resonanceSightActive: false,

    aimDirection: vec3(0, 0, 1),
    flowSeconds: 0,
  };
}

export function createStageRuntime(): MutableStage {
  return {
    stageId: 'fallen-sanctuary',
    phase: 'loading',
    previousPhase: 'loading',
    infection: 0,
    targetInfection: 0,
    objective: '',
    flags: new Set<string>(),
    checkpoints: [],
    activeCheckpointId: null,
    platforms: new Map(),
    resonators: new Map(),
    puzzles: new Map(),
    triggers: new Map(),
    beat: 0,
    beatPhase: 0,
    beatThisStep: false,

    elapsedSeconds: 0,
    damageTaken: 0,
    deaths: 0,
    enemiesCleansed: 0,
    foundSecrets: new Set<string>(),
    secretsTotal: 0,
    formsUsed: new Set<ResonanceFormId>(),
    lowestCoherence: Number.POSITIVE_INFINITY,
    flowSeconds: 0,
    pendingSpawns: new Map(),
    collectedPickups: new Set<string>(),
    shownTutorials: new Set<string>(),
  };
}

export function createWorld(options: {
  playerId: EntityId;
  maxCoherence: number;
  difficulty: DifficultyId;
}): MutableWorld {
  return {
    tick: 0,
    elapsedSeconds: 0,
    difficulty: options.difficulty,
    player: createPlayer(options.playerId, options.maxCoherence),
    enemies: [],
    boss: null,
    projectiles: [],
    pickups: [],
    conjured: [],
    stage: createStageRuntime(),
    camera: {
      mode: 'follow',
      focus: vec3(),
      secondaryFocus: null,
      desiredDistance: 7.2,
      desiredYaw: null,
      desiredPitch: null,
      fovBoost: 0,
      scriptedRemaining: 0,
      shake: 0,
    },
    cutsceneId: null,
    cutsceneRemaining: 0,
    paused: false,
    hitStopRemaining: 0,
  };
}
