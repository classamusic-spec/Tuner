import type { ResonanceFormId } from '@tuner/shared';

/**
 * Tuning surface.
 *
 * Every number that decides how the game *feels* lives here rather than being
 * scattered through the systems that read it. That makes the movement and
 * combat critics able to point at a value, and makes the debug overlay able to
 * expose live sliders without touching gameplay code.
 */

export interface MovementConfig {
  /** Top speed while walking (analogue stick held lightly). */
  walkSpeed: number;
  runSpeed: number;
  sprintSpeed: number;
  /** Ground acceleration, metres per second squared. */
  groundAcceleration: number;
  groundDeceleration: number;
  /** Fraction of ground acceleration available in the air, in [0, 1]. */
  airControl: number;
  airDeceleration: number;
  /** How fast the character model turns to face the movement direction. */
  turnSpeedRadians: number;

  /** Peak height of a fully-held jump, in metres. Velocity is derived from it. */
  jumpHeight: number;
  /** Height of the second jump. */
  doubleJumpHeight: number;
  /**
   * Gravity multiplier applied once the jump button is released, which is what
   * turns one button into a variable-height jump.
   */
  jumpCutGravityScale: number;
  /** Extra gravity while falling, so the arc feels snappy rather than floaty. */
  fallGravityScale: number;
  maxFallSpeed: number;
  /** Grace window after leaving a ledge during which a jump still works. */
  coyoteSeconds: number;
  /** How early a jump press is remembered before landing. */
  jumpBufferSeconds: number;

  dashSpeed: number;
  dashSeconds: number;
  dashCooldownSeconds: number;
  /** Air dashes available before touching ground or a wall. */
  airDashCount: number;
  /** Gravity applied during a dash; zero makes the dash perfectly flat. */
  dashGravityScale: number;

  slideSpeed: number;
  slideSeconds: number;
  slideFriction: number;

  /** Downward slide speed while clinging to a wall. */
  wallSlideSpeed: number;
  wallJumpHorizontal: number;
  wallJumpVertical: number;
  /** Seconds after a wall jump during which input cannot cancel the push-off. */
  wallJumpLockSeconds: number;
  /** How long the player may cling before sliding off. */
  wallClingSeconds: number;

  ledgeGrabReach: number;
  mantleSeconds: number;

  grindSpeed: number;
  grindAcceleration: number;
  bounceStrength: number;

  swimSpeed: number;
  swimVerticalSpeed: number;
  buoyancy: number;

  /** Capsule dimensions. */
  bodyRadius: number;
  bodyHeight: number;
  /** Lip height the character walks over without jumping. */
  stepHeight: number;
  /** Steepest walkable surface, in degrees from horizontal. */
  maxSlopeDegrees: number;

  /** Speed above which the "flow" bonus and camera FOV boost engage. */
  flowSpeedThreshold: number;
}

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  walkSpeed: 4.2,
  runSpeed: 8.6,
  sprintSpeed: 12.4,
  groundAcceleration: 74,
  groundDeceleration: 62,
  airControl: 0.62,
  airDeceleration: 12,
  turnSpeedRadians: 16,

  jumpHeight: 3.05,
  doubleJumpHeight: 2.5,
  jumpCutGravityScale: 2.6,
  fallGravityScale: 1.45,
  maxFallSpeed: 38,
  coyoteSeconds: 0.11,
  jumpBufferSeconds: 0.13,

  dashSpeed: 24,
  dashSeconds: 0.17,
  dashCooldownSeconds: 0.32,
  airDashCount: 1,
  dashGravityScale: 0,

  slideSpeed: 13.5,
  slideSeconds: 0.55,
  slideFriction: 7,

  wallSlideSpeed: 3.4,
  wallJumpHorizontal: 10.5,
  wallJumpVertical: 12.2,
  wallJumpLockSeconds: 0.12,
  wallClingSeconds: 1.6,

  ledgeGrabReach: 0.55,
  mantleSeconds: 0.28,

  grindSpeed: 17,
  grindAcceleration: 26,
  bounceStrength: 17,

  swimSpeed: 5.4,
  swimVerticalSpeed: 4.2,
  buoyancy: 6,

  bodyRadius: 0.36,
  bodyHeight: 1.6,
  stepHeight: 0.42,
  maxSlopeDegrees: 52,

  flowSpeedThreshold: 9,
};

export interface CombatConfig {
  /** Seconds between uncharged pulses. */
  pulseInterval: number;
  pulseSpeed: number;
  pulseDamage: number;
  pulseRadius: number;
  pulseLifeSeconds: number;
  /** Cap on simultaneous player projectiles. */
  maxPlayerProjectiles: number;

  /** Seconds of hold required to reach each charge tier. */
  chargeTierSeconds: readonly number[];
  chargeTierDamage: readonly number[];
  chargeTierRadius: readonly number[];
  chargeTierSpeed: readonly number[];

  burstRadius: number;
  burstDamage: number;
  burstCooldown: number;
  burstKnockback: number;

  /** Seconds the counter window stays open. */
  counterWindowSeconds: number;
  counterCooldownSeconds: number;
  /** Coherence restored by a successful counter. */
  counterCoherenceReward: number;

  lockOnRange: number;
  /** Half-angle of the lock-on cone, in degrees. */
  lockOnConeDegrees: number;
  /** Seconds of lost line-of-sight before lock-on releases. */
  lockOnBreakSeconds: number;

  maxCoherence: number;
  /** Mercy invulnerability after taking a hit. */
  invulnerableSeconds: number;
  /** Coherence fraction below which the low-coherence presentation engages. */
  lowCoherenceThreshold: number;

  /** Frames of hit-stop, expressed in seconds, scaled by hit strength. */
  hitStopSeconds: number;
}

export const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  pulseInterval: 0.14,
  pulseSpeed: 46,
  pulseDamage: 10,
  pulseRadius: 0.28,
  pulseLifeSeconds: 1.5,
  maxPlayerProjectiles: 48,

  chargeTierSeconds: [0.34, 0.78, 1.35],
  chargeTierDamage: [26, 52, 92],
  chargeTierRadius: [0.55, 0.85, 1.25],
  chargeTierSpeed: [40, 36, 32],

  burstRadius: 3.6,
  burstDamage: 14,
  burstCooldown: 1.1,
  burstKnockback: 13,

  counterWindowSeconds: 0.22,
  counterCooldownSeconds: 0.65,
  counterCoherenceReward: 8,

  lockOnRange: 26,
  lockOnConeDegrees: 55,
  lockOnBreakSeconds: 1.2,

  maxCoherence: 100,
  invulnerableSeconds: 0.9,
  lowCoherenceThreshold: 0.3,

  hitStopSeconds: 0.045,
};

export interface CameraConfig {
  /** Resting distance behind the player. */
  distance: number;
  minDistance: number;
  maxDistance: number;
  /** Height of the look-at point above the player's feet. */
  heightOffset: number;
  /** Lateral offset, which keeps the character off dead-centre. */
  shoulderOffset: number;

  /** Exponential smoothing factors: fraction of error left after one second. */
  positionSmoothing: number;
  rotationSmoothing: number;

  minPitch: number;
  maxPitch: number;

  baseFov: number;
  /** Extra degrees of FOV at full sprint. */
  speedFovBoost: number;
  fovSmoothing: number;

  /** Radius of the sphere cast that keeps the camera out of geometry. */
  collisionRadius: number;
  /** Seconds of no camera input before auto-recentre begins. */
  autoRecentreDelay: number;
  autoRecentreSpeed: number;

  /** Extra downward tilt applied while falling, to show the landing zone. */
  landingLookAhead: number;
  /** Screen-shake multiplier, reduced by the accessibility setting. */
  shakeScale: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  distance: 7.2,
  minDistance: 2.4,
  maxDistance: 11,
  heightOffset: 1.35,
  shoulderOffset: 0.55,

  positionSmoothing: 0.0016,
  rotationSmoothing: 0.0009,

  minPitch: -1.15,
  maxPitch: 0.72,

  baseFov: 62,
  speedFovBoost: 11,
  fovSmoothing: 0.04,

  collisionRadius: 0.34,
  autoRecentreDelay: 1.4,
  autoRecentreSpeed: 2.1,

  landingLookAhead: 0.35,
  shakeScale: 1,
};

/** Assist and comfort options that gameplay must honour. */
export interface AccessibilityConfig {
  reducedMotion: boolean;
  reducedFlashing: boolean;
  reducedParticles: boolean;
  screenShakeScale: number;
  /** Extra coyote time, in seconds. */
  extraCoyoteSeconds: number;
  /** Mid-air correction toward the intended landing platform, in [0, 1]. */
  landingAssist: number;
  /** Restores the player to safety instead of costing Coherence on a fall. */
  fallRecovery: boolean;
  /** Adds checkpoints at every safe area. */
  generousCheckpoints: boolean;
  aimAssist: number;
  lockOnAssist: number;
  subtitles: boolean;
  /** Draws a beat/pitch readout for every rhythmic mechanic. */
  visualRhythmCues: boolean;
  /** Draws attack timing rings around every telegraph. */
  visualAttackTiming: boolean;
  highContrast: boolean;
  colourblindSafeIcons: boolean;
  textScale: number;
  haptics: boolean;
}

export const DEFAULT_ACCESSIBILITY_CONFIG: AccessibilityConfig = {
  reducedMotion: false,
  reducedFlashing: false,
  reducedParticles: false,
  screenShakeScale: 1,
  extraCoyoteSeconds: 0,
  landingAssist: 0,
  fallRecovery: false,
  generousCheckpoints: false,
  aimAssist: 0.35,
  lockOnAssist: 0.5,
  subtitles: true,
  visualRhythmCues: true,
  visualAttackTiming: true,
  highContrast: false,
  colourblindSafeIcons: false,
  textScale: 1,
  haptics: true,
};

/** Per-form tuning applied on top of the base combat numbers. */
export interface FormTuning {
  readonly id: ResonanceFormId;
  readonly damageScale: number;
  readonly fireIntervalScale: number;
  readonly projectileSpeedScale: number;
  /** Harmonic degree the form's shots ring at. */
  readonly harmonicDegree: number;
  /** Accent colour, used by VFX, HUD and the Auralith model. */
  readonly colour: string;
}
