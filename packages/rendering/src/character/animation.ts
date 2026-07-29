/**
 * Procedural character animation.
 *
 * TUNER ships no animation clips. Every pose in the game is computed from the
 * simulation's `MovementState`, the time spent in it, the velocity and the
 * combat state. That is a deliberate choice: it keeps the download tiny, it
 * makes the character legible at mobile scale without a rigged mesh, and — most
 * importantly — it makes the animation a pure function of gameplay state.
 *
 * ---------------------------------------------------------------------------
 * THE RESPONSIVENESS INVARIANT
 * ---------------------------------------------------------------------------
 * **Animation follows gameplay. It never leads it, and it never gates it.**
 *
 * `stepAnimator` recomputes the *target* pose from the supplied state on every
 * single call, before anything else happens. There is no lock-out window, no
 * "must finish the current animation first", no minimum dwell time and no
 * transition table that can refuse a change. If the simulation says the player
 * is dashing this frame, the target pose is the dash pose on this frame.
 *
 * Blending exists only so the *displayed* pose catches up to the target
 * smoothly over ~0.05–0.11 s. It is a purely cosmetic follower: the target is
 * always current, so the hitbox, the input handling and the simulation are
 * never waiting on a visual. `animation.test.ts` asserts this directly — see
 * "a state change is reflected in the target pose on the same call".
 *
 * Everything here is dependency-free (no Three.js, no React), which is what
 * lets it be unit-tested in Node.
 */

import { TAU, clamp, clamp01, damp } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import type { MovementState } from '@tuner/game-core';

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * The Tuner's joints.
 *
 * `hair`, `sash` and `skirt` are not anatomical — they are the drivers for the
 * secondary-motion springs that make the curls and the draped cloth lag behind
 * the body. `auralith` is the floating resonator ring's follow target, which
 * trails the right forearm rather than being rigidly parented to it.
 */
export const JOINT_NAMES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'armUpperL',
  'armLowerL',
  'handL',
  'shoulderR',
  'armUpperR',
  'armLowerR',
  'handR',
  'legUpperL',
  'legLowerL',
  'footL',
  'legUpperR',
  'legLowerR',
  'footR',
  'hair',
  'sash',
  'skirt',
  'auralith',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/**
 * A single joint's deviation from its rest transform.
 *
 * Rotations are Euler radians in the joint's local space (XYZ order, matching
 * Three.js's default). Offsets are metres added to the joint's rest position,
 * used sparingly — mostly to crouch the root for a slide or drop it for a ledge
 * hang.
 */
export interface JointPose {
  rx: number;
  ry: number;
  rz: number;
  ox: number;
  oy: number;
  oz: number;
}

/** A whole-body pose: one `JointPose` per named joint. */
export type Pose = Record<JointName, JointPose>;

/** Joints the upper-body combat layer is allowed to touch. */
const COMBAT_LAYER_JOINTS: readonly JointName[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'armUpperL',
  'armLowerL',
  'handL',
  'shoulderR',
  'armUpperR',
  'armLowerR',
  'handR',
  'auralith',
];

/**
 * How much locomotion survives underneath a full-weight combat layer.
 *
 * The firing pose *composes* with the run cycle rather than replacing it, so
 * the player can shoot while sprinting and the arms still carry the gait. At
 * full weight the locomotion contribution is scaled by
 * `1 - COMBAT_LOCOMOTION_RETAIN`, never to zero.
 */
const COMBAT_LOCOMOTION_RETAIN = 0.55;

export function createJointPose(): JointPose {
  return { rx: 0, ry: 0, rz: 0, ox: 0, oy: 0, oz: 0 };
}

export function createPose(): Pose {
  const pose = {} as Pose;
  for (const name of JOINT_NAMES) {
    pose[name] = createJointPose();
  }
  return pose;
}

export function resetPose(pose: Pose): Pose {
  for (const name of JOINT_NAMES) {
    const joint = pose[name];
    joint.rx = 0;
    joint.ry = 0;
    joint.rz = 0;
    joint.ox = 0;
    joint.oy = 0;
    joint.oz = 0;
  }
  return pose;
}

export function copyPose(target: Pose, source: Readonly<Pose>): Pose {
  for (const name of JOINT_NAMES) {
    const dst = target[name];
    const src = source[name];
    dst.rx = src.rx;
    dst.ry = src.ry;
    dst.rz = src.rz;
    dst.ox = src.ox;
    dst.oy = src.oy;
    dst.oz = src.oz;
  }
  return target;
}

/** Linear blend between two poses, written into `target`. */
export function blendPoses(target: Pose, a: Readonly<Pose>, b: Readonly<Pose>, t: number): Pose {
  const k = clamp01(t);
  for (const name of JOINT_NAMES) {
    const dst = target[name];
    const from = a[name];
    const to = b[name];
    dst.rx = from.rx + (to.rx - from.rx) * k;
    dst.ry = from.ry + (to.ry - from.ry) * k;
    dst.rz = from.rz + (to.rz - from.rz) * k;
    dst.ox = from.ox + (to.ox - from.ox) * k;
    dst.oy = from.oy + (to.oy - from.oy) * k;
    dst.oz = from.oz + (to.oz - from.oz) * k;
  }
  return target;
}

export function isPoseFinite(pose: Readonly<Pose>): boolean {
  for (const name of JOINT_NAMES) {
    const joint = pose[name];
    if (
      !Number.isFinite(joint.rx) ||
      !Number.isFinite(joint.ry) ||
      !Number.isFinite(joint.rz) ||
      !Number.isFinite(joint.ox) ||
      !Number.isFinite(joint.oy) ||
      !Number.isFinite(joint.oz)
    ) {
      return false;
    }
  }
  return true;
}

/** Largest per-channel difference between two poses. Used by tests and by the
 *  debug overlay's "is this pose actually changing?" readout. */
export function poseDifference(a: Readonly<Pose>, b: Readonly<Pose>): number {
  let worst = 0;
  for (const name of JOINT_NAMES) {
    const x = a[name];
    const y = b[name];
    worst = Math.max(
      worst,
      Math.abs(x.rx - y.rx),
      Math.abs(x.ry - y.ry),
      Math.abs(x.rz - y.rz),
      Math.abs(x.ox - y.ox),
      Math.abs(x.oy - y.oy),
      Math.abs(x.oz - y.oz),
    );
  }
  return worst;
}

export function posesEqual(a: Readonly<Pose>, b: Readonly<Pose>, epsilon = 1e-9): boolean {
  return poseDifference(a, b) <= epsilon;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Everything locomotion needs. Mirrors the fields the renderer reads off
 *  `PlayerState`, so wiring it up is a field-for-field copy. */
export interface LocomotionPoseInput {
  readonly state: MovementState;
  /** Seconds spent in `state`. Reset by the simulation, never by animation. */
  readonly stateTime: number;
  readonly velocity: Readonly<Vec3>;
  readonly grounded: boolean;
  /** Facing yaw in radians; used to express velocity in the body's own space. */
  readonly facingYaw?: number;
  /** Which side the wall is on while clinging or wall-jumping: -1, 0 or +1. */
  readonly wallSide?: number;
}

/** The upper-body combat layer's inputs. */
export interface CombatPoseInput {
  /** True on the frames a shot is being released. */
  readonly firing: boolean;
  /** Seconds since the last shot left the Auralith. */
  readonly fireTime: number;
  readonly charging: boolean;
  /** 0 = uncharged, 1..3 = charge tiers. */
  readonly chargeTier: number;
  /** Progress toward the next tier, in [0, 1]. */
  readonly chargeProgress: number;
  readonly countering: boolean;
  /** Seconds since the counter window opened. */
  readonly counterTime: number;
  /** Aim elevation in radians; positive looks up. */
  readonly aimPitch: number;
  /** Aim deflection from straight ahead, in radians. */
  readonly aimYaw: number;
}

export const NEUTRAL_COMBAT_POSE_INPUT: CombatPoseInput = {
  firing: false,
  fireTime: 99,
  charging: false,
  chargeTier: 0,
  chargeProgress: 0,
  countering: false,
  counterTime: 99,
  aimPitch: 0,
  aimYaw: 0,
};

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------

/**
 * Every state the simulation can be in, as a runtime table.
 *
 * `state.ts` exposes `MovementState` as a type only, so the renderer keeps its
 * own list — and the type-level check below fails compilation if the two ever
 * drift apart.
 */
export const ANIMATED_MOVEMENT_STATES = [
  'idle',
  'walk',
  'run',
  'sprint',
  'jump',
  'doubleJump',
  'fall',
  'dash',
  'airDash',
  'slide',
  'wallCling',
  'wallJump',
  'ledgeGrab',
  'mantle',
  'grind',
  'bounce',
  'swim',
  'hurt',
  'downed',
  'cutscene',
] as const satisfies readonly MovementState[];

/** Compile-time proof that the table above covers every `MovementState`. */
type UncoveredMovementState = Exclude<MovementState, (typeof ANIMATED_MOVEMENT_STATES)[number]>;
const uncoveredMovementStates: UncoveredMovementState[] = [];
void uncoveredMovementStates;

/** Per-state display smoothing: the fraction of the pose error left after one
 *  second. Smaller is snappier. These affect the *follower* only. */
const BLEND_SMOOTHING: Readonly<Record<MovementState, number>> = {
  idle: 1e-4,
  walk: 1e-4,
  run: 1e-4,
  sprint: 1e-4,
  jump: 1e-8,
  doubleJump: 1e-9,
  fall: 1e-5,
  dash: 1e-10,
  airDash: 1e-10,
  slide: 1e-9,
  wallCling: 1e-7,
  wallJump: 1e-10,
  ledgeGrab: 1e-8,
  mantle: 1e-8,
  grind: 1e-6,
  bounce: 1e-10,
  swim: 1e-4,
  hurt: 1e-11,
  downed: 1e-6,
  cutscene: 1e-3,
};

function setJoint(
  joint: JointPose,
  rx: number,
  ry: number,
  rz: number,
  ox = 0,
  oy = 0,
  oz = 0,
): void {
  joint.rx = rx;
  joint.ry = ry;
  joint.rz = rz;
  joint.ox = ox;
  joint.oy = oy;
  joint.oz = oz;
}

function addJoint(joint: JointPose, rx: number, ry: number, rz: number): void {
  joint.rx += rx;
  joint.ry += ry;
  joint.rz += rz;
}

interface GaitProfile {
  readonly frequency: number;
  readonly legSwing: number;
  readonly armSwing: number;
  readonly armBend: number;
  readonly lean: number;
  readonly bounce: number;
  readonly hipTwist: number;
}

const WALK_GAIT: GaitProfile = {
  frequency: 2.35,
  legSwing: 0.55,
  armSwing: 0.45,
  armBend: -0.34,
  lean: 0.06,
  bounce: 0.018,
  hipTwist: 0.1,
};

const RUN_GAIT: GaitProfile = {
  frequency: 3.4,
  legSwing: 0.95,
  armSwing: 0.85,
  armBend: -0.76,
  lean: 0.17,
  bounce: 0.036,
  hipTwist: 0.16,
};

const SPRINT_GAIT: GaitProfile = {
  frequency: 4.35,
  legSwing: 1.16,
  armSwing: 1.08,
  armBend: -1.06,
  lean: 0.31,
  bounce: 0.052,
  hipTwist: 0.22,
};

/** Knees only fold one way. Positive `amount` means "bend backwards". */
function knee(amount: number): number {
  return -clamp(amount, 0, 1.9);
}

function applyGait(pose: Pose, time: number, gait: GaitProfile, speedBoost: number): void {
  const p = time * gait.frequency * TAU;
  const s = Math.sin(p);
  const c = Math.cos(p);
  const amp = 1 + 0.15 * speedBoost;

  const legSwing = gait.legSwing * amp;
  const armSwing = gait.armSwing * amp;

  setJoint(pose.root, 0, 0, 0.02 * c * amp, 0, gait.bounce * (Math.abs(s) - 0.5), 0);
  setJoint(pose.hips, 0, gait.hipTwist * s, 0.05 * c * amp, 0, 0, 0);
  setJoint(pose.spine, gait.lean * 0.4, -gait.hipTwist * 0.7 * s, 0, 0, 0, 0);
  setJoint(pose.chest, gait.lean * 0.6, -gait.hipTwist * 0.95 * s, 0.03 * c, 0, 0, 0);
  setJoint(pose.neck, -gait.lean * 0.25, 0, 0, 0, 0, 0);
  setJoint(pose.head, -gait.lean * 0.5, 0.06 * s, -0.03 * c, 0, 0, 0);

  setJoint(pose.shoulderR, 0, 0, -0.05 - 0.05 * s, 0, 0, 0);
  setJoint(pose.shoulderL, 0, 0, 0.05 + 0.05 * s, 0, 0, 0);
  setJoint(pose.armUpperR, armSwing * s, 0, -0.15 - 0.06 * amp, 0, 0, 0);
  setJoint(pose.armUpperL, -armSwing * s, 0, 0.15 + 0.06 * amp, 0, 0, 0);
  setJoint(pose.armLowerR, gait.armBend - 0.3 * Math.max(0, s), 0, 0, 0, 0, 0);
  setJoint(pose.armLowerL, gait.armBend - 0.3 * Math.max(0, -s), 0, 0, 0, 0, 0);
  setJoint(pose.handR, 0.12 * s, 0, 0, 0, 0, 0);
  setJoint(pose.handL, -0.12 * s, 0, 0, 0, 0, 0);

  setJoint(pose.legUpperR, -legSwing * s, 0, 0.03, 0, 0, 0);
  setJoint(pose.legUpperL, legSwing * s, 0, -0.03, 0, 0, 0);
  setJoint(pose.legLowerR, knee(legSwing * (0.35 + 0.75 * Math.max(0, s))), 0, 0, 0, 0, 0);
  setJoint(pose.legLowerL, knee(legSwing * (0.35 + 0.75 * Math.max(0, -s))), 0, 0, 0, 0, 0);
  setJoint(pose.footR, 0.26 * Math.sin(p + 1.2) * amp, 0, 0, 0, 0, 0);
  setJoint(pose.footL, -0.26 * Math.sin(p + 1.2) * amp, 0, 0, 0, 0, 0);

  setJoint(pose.hair, gait.lean * 0.9 + 0.06 * s, 0, 0.05 * c, 0, 0, 0);
  setJoint(pose.sash, gait.lean * 1.2 + 0.08 * c, 0.05 * s, 0, 0, 0, 0);
  setJoint(pose.skirt, gait.lean * 1.1 + 0.1 * s, 0, 0.04 * c, 0, 0, 0);
  setJoint(pose.auralith, 0.1 * s, 0, 0, 0, 0, 0);
}

/** Both arms overhead, mirrored, with a shared elbow bend. */
function armsOverhead(pose: Pose, raise: number, spread: number, bend: number): void {
  setJoint(pose.armUpperR, raise, 0, -spread, 0, 0, 0);
  setJoint(pose.armUpperL, raise, 0, spread, 0, 0, 0);
  setJoint(pose.armLowerR, bend, 0, 0, 0, 0, 0);
  setJoint(pose.armLowerL, bend, 0, 0, 0, 0, 0);
}

/**
 * The locomotion pose for a state. Pure: same inputs, same output, always.
 *
 * Note that every branch writes a *complete* pose. There is no accumulation
 * across frames and no memory of the previous state, which is precisely why a
 * state change cannot be delayed.
 */
function applyLocomotion(pose: Pose, input: LocomotionPoseInput): void {
  const t = Math.max(0, input.stateTime);
  const v = input.velocity;
  const planarSpeed = Math.hypot(v.x, v.z);
  const speedBoost = clamp01(planarSpeed / 14);
  const side = clamp(input.wallSide ?? 1, -1, 1) || 1;

  switch (input.state) {
    case 'idle': {
      // A musician's rest: weight shifting, shoulders breathing, the Auralith
      // turning slowly on the forearm.
      const b = t * 0.55 * TAU;
      const s = Math.sin(b);
      const s2 = Math.sin(b * 0.5);
      setJoint(pose.root, 0, 0.03 * s2, 0, 0, 0.012 * s, 0);
      setJoint(pose.hips, 0, 0.05 * s, 0.04 * s2, 0, -0.008 * (1 + s), 0);
      setJoint(pose.spine, -0.02 + 0.022 * s, -0.02 * s, 0, 0, 0, 0);
      setJoint(pose.chest, 0.03 * Math.sin(b + 0.6), -0.04 * s, 0, 0, 0, 0);
      setJoint(pose.neck, 0.02 * Math.sin(b + 1), 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.05 + 0.03 * Math.sin(b + 1.2), 0.05 * s2, 0.04 * s2, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.03 - 0.02 * s, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.03 + 0.02 * s, 0, 0, 0);
      setJoint(pose.armUpperR, 0.05 * s, 0, -0.16 - 0.03 * s, 0, 0, 0);
      setJoint(pose.armUpperL, 0.05 * Math.sin(b + 0.4), 0, 0.16 + 0.03 * s, 0, 0, 0);
      setJoint(pose.armLowerR, -0.2 + 0.04 * s, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.16 + 0.04 * Math.sin(b + 0.5), 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.05 * s, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.05 * s, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.02, 0, 0.04, 0, 0, 0);
      setJoint(pose.legUpperL, -0.02, 0, -0.06, 0, 0, 0);
      setJoint(pose.legLowerR, -0.05, 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, -0.09, 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.02, 0.05, 0, 0, 0, 0);
      setJoint(pose.footL, 0.02, -0.08, 0, 0, 0, 0);
      setJoint(pose.hair, 0.03 * Math.sin(b + 0.8), 0, 0.05 * s2, 0, 0, 0);
      setJoint(pose.sash, 0.04 * s, 0, 0.05 * s, 0, 0, 0);
      setJoint(pose.skirt, 0.02 * Math.sin(b + 0.4), 0, 0.03 * s2, 0, 0, 0);
      setJoint(pose.auralith, 0, 0.35 * s2, 0, 0, 0.006 * s, 0);
      return;
    }

    case 'walk':
      applyGait(pose, t, WALK_GAIT, speedBoost);
      return;

    case 'run':
      applyGait(pose, t, RUN_GAIT, speedBoost);
      return;

    case 'sprint':
      applyGait(pose, t, SPRINT_GAIT, speedBoost);
      return;

    case 'jump': {
      // Take-off: chest opens, arms sweep up and then settle, lead knee tucks.
      const p = clamp01(t / 0.45);
      setJoint(pose.root, 0, 0, 0, 0, 0.02, 0);
      setJoint(pose.hips, -0.08, 0.04, 0, 0, 0, 0);
      setJoint(pose.spine, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.chest, -0.15, -0.05, 0, 0, 0, 0);
      setJoint(pose.neck, -0.05, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.14, 0.03, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.16, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.16, 0, 0, 0);
      armsOverhead(pose, -1.22 + 0.52 * p, 0.35, -0.5);
      setJoint(pose.handR, -0.12, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.12, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.58 - 0.26 * p, 0, 0.05, 0, 0, 0);
      setJoint(pose.legUpperL, 0.16 - 0.3 * p, 0, -0.05, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.95 - 0.35 * p), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.32), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.3, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.22, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.36 - 0.12 * p, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.3, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.32, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.2, 0, 0, 0, 0.02, 0);
      return;
    }

    case 'doubleJump': {
      // The second jump is a forward tuck-spin around the hips, the Auralith
      // ring tracing the arc.
      const p = clamp01(t / 0.55);
      setJoint(pose.root, p * TAU, 0, 0, 0, 0.05, 0);
      setJoint(pose.hips, 0.26, 0, 0, 0, 0, 0);
      setJoint(pose.spine, 0.3, 0, 0, 0, 0, 0);
      setJoint(pose.chest, 0.26, 0, 0, 0, 0, 0);
      setJoint(pose.neck, 0.12, 0, 0, 0, 0, 0);
      setJoint(pose.head, 0.2, 0, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.3, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.3, 0, 0, 0);
      setJoint(pose.armUpperR, -0.62, 0, -0.9, 0, 0, 0);
      setJoint(pose.armUpperL, -0.62, 0, 0.9, 0, 0, 0);
      setJoint(pose.armLowerR, -1.5, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -1.5, 0, 0, 0, 0, 0);
      setJoint(pose.handR, -0.25, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.25, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 1.28, 0, 0.08, 0, 0, 0);
      setJoint(pose.legUpperL, 1.16, 0, -0.08, 0, 0, 0);
      setJoint(pose.legLowerR, knee(1.72), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(1.6), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.42, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.42, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.5, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.6, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.55, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, 0, p * TAU, 0, 0, 0, 0);
      return;
    }

    case 'fall': {
      const flutter = Math.sin(t * 3.4 * TAU);
      setJoint(pose.root, 0, 0, 0, 0, 0, 0);
      setJoint(pose.hips, 0.06, 0, 0, 0, 0, 0);
      setJoint(pose.spine, 0.1, 0.03 * flutter, 0, 0, 0, 0);
      setJoint(pose.chest, 0.14, 0, 0, 0, 0, 0);
      setJoint(pose.neck, 0.04, 0, 0, 0, 0, 0);
      setJoint(pose.head, 0.11, 0.04 * flutter, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.22, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.22, 0, 0, 0);
      setJoint(pose.armUpperR, -0.55 + 0.08 * flutter, 0, -0.76, 0, 0, 0);
      setJoint(pose.armUpperL, -0.55 - 0.08 * flutter, 0, 0.76, 0, 0, 0);
      setJoint(pose.armLowerR, -0.56, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.56, 0, 0, 0, 0, 0);
      setJoint(pose.handR, -0.15, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.15, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, -0.28, 0, 0.07, 0, 0, 0);
      setJoint(pose.legUpperL, 0.21, 0, -0.07, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.56), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.26), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.16, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.16, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.46, 0, 0.05 * flutter, 0, 0, 0);
      setJoint(pose.sash, 0.52, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.47, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.3, 0, 0, 0, 0.03, 0);
      return;
    }

    case 'dash': {
      // A ground streak: the whole body becomes a horizontal arrow.
      setJoint(pose.root, 0.28, 0, 0, 0, -0.04, 0);
      setJoint(pose.hips, -0.06, 0.12, 0, 0, 0, 0);
      setJoint(pose.spine, 0.32, -0.08, 0, 0, 0, 0);
      setJoint(pose.chest, 0.26, -0.14, 0, 0, 0, 0);
      setJoint(pose.neck, -0.16, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.32, 0.06, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.2, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.2, 0, 0, 0);
      setJoint(pose.armUpperR, -1.46, 0, -0.28, 0, 0, 0);
      setJoint(pose.armUpperL, 0.96, 0, 0.2, 0, 0, 0);
      setJoint(pose.armLowerR, -0.36, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.82, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.2, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.86, 0, 0.06, 0, 0, 0);
      setJoint(pose.legUpperL, -0.72, 0, -0.06, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.52), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.92), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.18, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.34, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.72, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.8, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.74, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.45, 0, 0, 0, 0, -0.05);
      return;
    }

    case 'airDash': {
      // Same arrow, rolled onto its side, legs trailing rather than split.
      setJoint(pose.root, 0.2, 0, 0.24, 0, 0, 0);
      setJoint(pose.hips, -0.04, 0.2, 0, 0, 0, 0);
      setJoint(pose.spine, 0.24, -0.14, 0.05, 0, 0, 0);
      setJoint(pose.chest, 0.2, -0.2, 0.06, 0, 0, 0);
      setJoint(pose.neck, -0.14, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.26, 0.12, -0.06, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.26, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.26, 0, 0, 0);
      setJoint(pose.armUpperR, -1.72, 0, -0.14, 0, 0, 0);
      setJoint(pose.armUpperL, 0.36, 0, 0.66, 0, 0, 0);
      setJoint(pose.armLowerR, -0.2, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -1.05, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.26, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.2, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, -0.46, 0, 0.1, 0, 0, 0);
      setJoint(pose.legUpperL, -0.26, 0, -0.1, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.78), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.52), 0, 0, 0, 0, 0);
      setJoint(pose.footR, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.footL, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.82, 0, 0.12, 0, 0, 0);
      setJoint(pose.sash, 0.9, 0, 0.1, 0, 0, 0);
      setJoint(pose.skirt, 0.86, 0, 0.1, 0, 0, 0);
      setJoint(pose.auralith, -0.55, 0, 0, 0, 0, -0.07);
      return;
    }

    case 'slide': {
      // Low, leaning back, trailing hand skimming the ground.
      setJoint(pose.root, -0.26, 0, 0, 0, -0.42, 0);
      setJoint(pose.hips, -0.15, 0.1, 0, 0, 0, 0);
      setJoint(pose.spine, -0.05, -0.06, 0, 0, 0, 0);
      setJoint(pose.chest, 0.11, -0.16, 0, 0, 0, 0);
      setJoint(pose.neck, -0.06, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.13, 0.1, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.12, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.3, 0, 0, 0);
      setJoint(pose.armUpperR, -0.92, 0, -0.5, 0, 0, 0);
      setJoint(pose.armUpperL, 0.42, 0, 0.92, 0, 0, 0);
      setJoint(pose.armLowerR, -0.44, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.24, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.15, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.32, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 1.16, 0, 0.12, 0, 0, 0);
      setJoint(pose.legUpperL, 0.46, 0, -0.22, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.16), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(1.56), 0, 0, 0, 0, 0);
      setJoint(pose.footR, -0.16, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.4, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.55, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.62, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.58, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, 0.15, 0, 0, 0, 0, 0);
      return;
    }

    case 'wallCling': {
      // Pressed side-on to the surface, inner hand gripping, breathing.
      const b = Math.sin(t * 1.2 * TAU) * 0.02;
      setJoint(pose.root, 0, 0.34 * side, -0.12 * side, 0, -0.05, 0);
      setJoint(pose.hips, 0, 0.06 * side, 0.05 * side, 0, 0, 0);
      setJoint(pose.spine, 0.04 + b, 0.08 * side, 0.1 * side, 0, 0, 0);
      setJoint(pose.chest, 0.06 + b, 0.14 * side, 0.12 * side, 0, 0, 0);
      setJoint(pose.neck, -0.04, -0.1 * side, 0, 0, 0, 0);
      setJoint(pose.head, -0.06, -0.3 * side, 0.04 * side, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.24, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.18, 0, 0, 0);
      setJoint(pose.armUpperR, -1.18 + b, 0, -0.55, 0, 0, 0);
      setJoint(pose.armUpperL, -0.26 - b, 0, 0.3, 0, 0, 0);
      setJoint(pose.armLowerR, -0.58, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.9, 0, 0, 0, 0, 0);
      setJoint(pose.handR, -0.35, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.2, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.56, 0, 0.16, 0, 0, 0);
      setJoint(pose.legUpperL, 0.12, 0, -0.1, 0, 0, 0);
      setJoint(pose.legLowerR, knee(1.05), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.36), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.24, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.12, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.05, 0, 0.26 * side, 0, 0, 0);
      setJoint(pose.sash, 0.08, 0, 0.22 * side, 0, 0, 0);
      setJoint(pose.skirt, 0.06, 0, 0.24 * side, 0, 0, 0);
      setJoint(pose.auralith, -0.15, 0, 0, 0, 0, 0);
      return;
    }

    case 'wallJump': {
      const p = clamp01(t / 0.3);
      setJoint(pose.root, -0.06, -0.5 * side * (1 - p), 0.22 * side, 0, 0.03, 0);
      setJoint(pose.hips, -0.05, 0.14 * side, 0, 0, 0, 0);
      setJoint(pose.spine, -0.12, -0.1 * side, -0.08 * side, 0, 0, 0);
      setJoint(pose.chest, -0.16, -0.16 * side, -0.12 * side, 0, 0, 0);
      setJoint(pose.neck, -0.06, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.18, -0.22 * side, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.3, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.3, 0, 0, 0);
      setJoint(pose.armUpperR, -0.92, 0, 0.7, 0, 0, 0);
      setJoint(pose.armUpperL, -1.14, 0, -0.5, 0, 0, 0);
      setJoint(pose.armLowerR, -0.76, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.42, 0, 0, 0, 0, 0);
      setJoint(pose.handR, -0.18, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.05, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.96 - 0.4 * p, 0, 0.14, 0, 0, 0);
      setJoint(pose.legUpperL, -0.56 + 0.3 * p, 0, -0.14, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.36), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(1.18), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.28, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.06, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.42, 0, -0.2 * side, 0, 0, 0);
      setJoint(pose.sash, 0.46, 0, -0.18 * side, 0, 0, 0);
      setJoint(pose.skirt, 0.4, 0, -0.2 * side, 0, 0, 0);
      setJoint(pose.auralith, -0.28, 0, 0, 0, 0, 0);
      return;
    }

    case 'ledgeGrab': {
      const dangle = Math.sin(t * 0.9 * TAU) * 0.03;
      setJoint(pose.root, 0, 0, dangle, 0, -0.3, 0);
      setJoint(pose.hips, 0.06, 0, dangle, 0, 0, 0);
      setJoint(pose.spine, 0.05, 0, 0, 0, 0, 0);
      setJoint(pose.chest, 0.02, 0, 0, 0, 0, 0);
      setJoint(pose.neck, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.24, 0.04, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, 0.12, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, -0.12, 0, 0, 0);
      armsOverhead(pose, -2.52, 0.18, -0.24);
      setJoint(pose.handR, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.12 + dangle, 0, 0.06, 0, 0, 0);
      setJoint(pose.legUpperL, -0.06 - dangle, 0, -0.06, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.3), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.56), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.2, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.2, 0, 0, 0, 0, 0);
      setJoint(pose.hair, -0.16, 0, 0, 0, 0, 0);
      setJoint(pose.sash, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, -0.06, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.6, 0, 0, 0, 0, 0);
      return;
    }

    case 'mantle': {
      const p = clamp01(t / 0.28);
      setJoint(pose.root, 0.12 - 0.12 * p, 0, 0, 0, -0.3 + 0.56 * p, 0);
      setJoint(pose.hips, 0.14 - 0.14 * p, 0.08, 0, 0, 0, 0);
      setJoint(pose.spine, 0.36 - 0.32 * p, 0, 0, 0, 0, 0);
      setJoint(pose.chest, 0.26 - 0.22 * p, -0.06, 0, 0, 0, 0);
      setJoint(pose.neck, -0.08, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.16 + 0.1 * p, 0.05, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.1, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.1, 0, 0, 0);
      armsOverhead(pose, -2.2 + 1.6 * p, 0.3, -0.92 + 0.5 * p);
      setJoint(pose.handR, -0.2 + 0.3 * p, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.2 + 0.3 * p, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 1.52 - 0.72 * p, 0, 0.18, 0, 0, 0);
      setJoint(pose.legUpperL, -0.16 + 0.1 * p, 0, -0.12, 0, 0, 0);
      setJoint(pose.legLowerR, knee(1.62 - 0.7 * p), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.36), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.34, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.12, 0, 0, 0, 0, 0);
      setJoint(pose.hair, -0.1 + 0.22 * p, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.05 + 0.15 * p, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.12, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.4, 0, 0, 0, 0, 0);
      return;
    }

    case 'grind': {
      // Riding a resonance line: knees loaded, arms wide, hips square to the rail.
      const sway = Math.sin(t * 1.3 * TAU);
      setJoint(pose.root, 0, 0, 0.06 * sway, 0, -0.1, 0);
      setJoint(pose.hips, 0, 0.3, 0.04 * sway, 0, 0, 0);
      setJoint(pose.spine, 0.2, -0.15, 0, 0, 0, 0);
      setJoint(pose.chest, 0.15, -0.2, 0.04 * sway, 0, 0, 0);
      setJoint(pose.neck, -0.05, 0.06, 0, 0, 0, 0);
      setJoint(pose.head, -0.08, 0.2, -0.05 * sway, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.32, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.34, 0, 0, 0);
      setJoint(pose.armUpperR, -0.46 + 0.06 * sway, 0, -1.06, 0, 0, 0);
      setJoint(pose.armUpperL, -0.3 - 0.06 * sway, 0, 1.16, 0, 0, 0);
      setJoint(pose.armLowerR, -0.32, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.28, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.1, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.1, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.56, 0, 0.2, 0, 0, 0);
      setJoint(pose.legUpperL, 0.16, 0, -0.24, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.86), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.56), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.14, 0.3, 0, 0, 0, 0);
      setJoint(pose.footL, 0.1, -0.3, 0, 0, 0, 0);
      setJoint(pose.hair, 0.44, 0, 0.06 * sway, 0, 0, 0);
      setJoint(pose.sash, 0.5, 0, 0.05 * sway, 0, 0, 0);
      setJoint(pose.skirt, 0.46, 0, 0.05 * sway, 0, 0, 0);
      setJoint(pose.auralith, -0.2, 0, 0, 0, 0, 0);
      return;
    }

    case 'bounce': {
      // Launched off a harmonic surface: an open, celebratory star.
      const p = clamp01(t / 0.35);
      setJoint(pose.root, 0, 0, 0, 0, 0.07 * Math.sin(p * Math.PI), 0);
      setJoint(pose.hips, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.spine, -0.2, 0, 0, 0, 0, 0);
      setJoint(pose.chest, -0.26, 0, 0, 0, 0, 0);
      setJoint(pose.neck, -0.1, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.38, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.38, 0, 0, 0);
      armsOverhead(pose, -2.05, 0.56, -0.1);
      setJoint(pose.handR, -0.36, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.36, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, -0.26, 0, 0.16, 0, 0, 0);
      setJoint(pose.legUpperL, -0.26, 0, -0.16, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.14), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.14), 0, 0, 0, 0, 0);
      setJoint(pose.footR, -0.22, 0, 0, 0, 0, 0);
      setJoint(pose.footL, -0.22, 0, 0, 0, 0, 0);
      setJoint(pose.hair, -0.38, 0, 0, 0, 0, 0);
      setJoint(pose.sash, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, -0.34, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, -0.7, 0, 0, 0, 0.04, 0);
      return;
    }

    case 'swim': {
      const p = t * 1.15 * TAU;
      const s = Math.sin(p);
      const c = Math.cos(p);
      setJoint(pose.root, 1.16, 0, 0, 0, -0.24, 0);
      setJoint(pose.hips, 0.05 * s, 0.06 * s, 0, 0, 0, 0);
      setJoint(pose.spine, -0.08 + 0.06 * s, -0.05 * s, 0, 0, 0, 0);
      setJoint(pose.chest, -0.12, 0.1 * s, 0, 0, 0, 0);
      setJoint(pose.neck, -0.2, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.56, 0.08 * s, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.2, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.2, 0, 0, 0);
      setJoint(pose.armUpperR, -1.0 + 0.75 * s, 0, -0.55 - 0.35 * c, 0, 0, 0);
      setJoint(pose.armUpperL, -1.0 + 0.75 * s, 0, 0.55 + 0.35 * c, 0, 0, 0);
      setJoint(pose.armLowerR, -0.55 + 0.35 * Math.sin(p + 1), 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.55 + 0.35 * Math.sin(p + 1), 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.18 * c, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.18 * c, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.3 * Math.sin(p + 0.6), 0, 0.08, 0, 0, 0);
      setJoint(pose.legUpperL, -0.3 * Math.sin(p + 0.6), 0, -0.08, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.28 + 0.2 * Math.max(0, s)), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.28 + 0.2 * Math.max(0, -s)), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.3, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.3, 0, 0, 0, 0, 0);
      setJoint(pose.hair, -0.12 + 0.1 * s, 0, 0.06 * c, 0, 0, 0);
      setJoint(pose.sash, -0.18 + 0.12 * c, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, -0.2 + 0.1 * s, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, 0.25, 0, 0, 0, 0, 0);
      return;
    }

    case 'hurt': {
      // Dissonance strikes: the body recoils and the chord breaks for a moment.
      const p = clamp01(t / 0.35);
      const shock = 1 - p;
      setJoint(pose.root, -0.36 * shock, 0.08 * shock, 0, 0, 0.03 * shock, 0);
      setJoint(pose.hips, -0.13, 0.1, 0, 0, 0, 0);
      setJoint(pose.spine, -0.23, 0.1, 0, 0, 0, 0);
      setJoint(pose.chest, -0.29, 0.16, 0, 0, 0, 0);
      setJoint(pose.neck, -0.12, 0, 0, 0, 0, 0);
      setJoint(pose.head, -0.42, 0.18, 0.08, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.4, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.36, 0, 0, 0);
      setJoint(pose.armUpperR, -0.86, 0, -0.96, 0, 0, 0);
      setJoint(pose.armUpperL, -0.66, 0, 0.86, 0, 0, 0);
      setJoint(pose.armLowerR, -0.38, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.32, 0, 0, 0, 0, 0);
      setJoint(pose.handR, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.handL, -0.3, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, -0.32, 0, 0.14, 0, 0, 0);
      setJoint(pose.legUpperL, 0.26, 0, -0.14, 0, 0, 0);
      setJoint(pose.legLowerR, knee(0.46), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(0.62), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.05, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.05, 0, 0, 0, 0, 0);
      setJoint(pose.hair, -0.46, 0, 0.1, 0, 0, 0);
      setJoint(pose.sash, -0.4, 0, 0.1, 0, 0, 0);
      setJoint(pose.skirt, -0.42, 0, 0.1, 0, 0, 0);
      setJoint(pose.auralith, 0.4, 0, 0, 0, 0, 0);
      return;
    }

    case 'downed': {
      // Not death — the chord has simply gone quiet. Kneeling, head bowed,
      // still holding the Auralith.
      const p = clamp01(t / 0.6);
      setJoint(pose.root, 0.36 * p, 0, 0, 0, -0.56 * p, 0);
      setJoint(pose.hips, 0.2 * p, 0.05, 0, 0, 0, 0);
      setJoint(pose.spine, 0.46 * p, 0, 0, 0, 0, 0);
      setJoint(pose.chest, 0.5 * p, 0.04, 0, 0, 0, 0);
      setJoint(pose.neck, 0.24 * p, 0, 0, 0, 0, 0);
      setJoint(pose.head, 0.66 * p, 0.06, 0, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.06, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.06, 0, 0, 0);
      setJoint(pose.armUpperR, 0.36 * p, 0, -0.12, 0, 0, 0);
      setJoint(pose.armUpperL, 0.3 * p, 0, 0.12, 0, 0, 0);
      setJoint(pose.armLowerR, -0.22, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.18, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.16, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.16, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 1.36 * p, 0, 0.2, 0, 0, 0);
      setJoint(pose.legUpperL, 1.14 * p, 0, -0.2, 0, 0, 0);
      setJoint(pose.legLowerR, knee(1.76 * p), 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, knee(1.54 * p), 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.56 * p, 0, 0, 0, 0, 0);
      setJoint(pose.footL, 0.56 * p, 0, 0, 0, 0, 0);
      setJoint(pose.hair, 0.56 * p, 0, 0, 0, 0, 0);
      setJoint(pose.sash, 0.3 * p, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.26 * p, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, 0.6 * p, 0, 0, 0, -0.05 * p, 0);
      return;
    }

    case 'cutscene': {
      // Composed and still, so dialogue reads. Distinct from idle: no weight
      // shift, hands closer in, head turned toward the speaker.
      const b = Math.sin(t * 0.42 * TAU);
      setJoint(pose.root, 0, 0, 0, 0, 0, 0);
      setJoint(pose.hips, 0, 0.02, 0, 0, 0, 0);
      setJoint(pose.spine, -0.03 + 0.008 * b, 0, 0, 0, 0, 0);
      setJoint(pose.chest, 0.02 + 0.012 * b, -0.04, 0, 0, 0, 0);
      setJoint(pose.neck, 0.01, 0.04, 0, 0, 0, 0);
      setJoint(pose.head, 0.04, 0.11, -0.03, 0, 0, 0);
      setJoint(pose.shoulderR, 0, 0, -0.02, 0, 0, 0);
      setJoint(pose.shoulderL, 0, 0, 0.02, 0, 0, 0);
      setJoint(pose.armUpperR, 0.03, 0, -0.1, 0, 0, 0);
      setJoint(pose.armUpperL, 0.03, 0, 0.1, 0, 0, 0);
      setJoint(pose.armLowerR, -0.13, 0, 0, 0, 0, 0);
      setJoint(pose.armLowerL, -0.13, 0, 0, 0, 0, 0);
      setJoint(pose.handR, 0.06, 0, 0, 0, 0, 0);
      setJoint(pose.handL, 0.06, 0, 0, 0, 0, 0);
      setJoint(pose.legUpperR, 0.03, 0, 0.02, 0, 0, 0);
      setJoint(pose.legUpperL, -0.03, 0, -0.02, 0, 0, 0);
      setJoint(pose.legLowerR, -0.06, 0, 0, 0, 0, 0);
      setJoint(pose.legLowerL, -0.06, 0, 0, 0, 0, 0);
      setJoint(pose.footR, 0.01, 0.04, 0, 0, 0, 0);
      setJoint(pose.footL, 0.01, -0.04, 0, 0, 0, 0);
      setJoint(pose.hair, 0.01 * b, 0, 0.02 * b, 0, 0, 0);
      setJoint(pose.sash, 0.015 * b, 0, 0, 0, 0, 0);
      setJoint(pose.skirt, 0.01 * b, 0, 0, 0, 0, 0);
      setJoint(pose.auralith, 0.05, 0.2, 0, 0, 0, 0);
      return;
    }

    default: {
      // `MovementState` is a closed union and the table above is exhaustive, so
      // this is unreachable — but a neutral stand is a safer fallback than an
      // exception in the render loop.
      setJoint(pose.armUpperR, 0, 0, -0.16, 0, 0, 0);
      setJoint(pose.armUpperL, 0, 0, 0.16, 0, 0, 0);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Upper-body combat layer
// ---------------------------------------------------------------------------

/** A sparse target for the combat layer: only the joints it may touch. */
type UpperBodyTarget = Partial<Record<JointName, readonly [number, number, number]>>;

const scratchLayer: Pose = createPose();

/**
 * Blends a sparse upper-body target into `pose` at `weight`.
 *
 * This is a *composition*, not an override: the locomotion contribution is
 * attenuated by `COMBAT_LOCOMOTION_RETAIN` but never removed, which is why the
 * arms still carry the run cycle while the player is firing.
 */
function composeUpperBody(pose: Pose, target: UpperBodyTarget, weight: number): void {
  const w = clamp01(weight);
  if (w <= 0) return;
  const keep = 1 - COMBAT_LOCOMOTION_RETAIN * w;

  for (const name of COMBAT_LAYER_JOINTS) {
    const entry = target[name];
    if (entry === undefined) continue;
    const joint = pose[name];
    joint.rx = joint.rx * keep + entry[0] * w;
    joint.ry = joint.ry * keep + entry[1] * w;
    joint.rz = joint.rz * keep + entry[2] * w;
  }
}

function applyCombatLayer(pose: Pose, combat: CombatPoseInput, stateTime: number): void {
  const pitch = clamp(combat.aimPitch, -1.1, 1.1);
  const yaw = clamp(combat.aimYaw, -1.2, 1.2);

  // --- Aim / fire ---------------------------------------------------------
  // The Auralith arm rises and the chest turns into the shot. Recoil is a
  // short kick layered on top so rapid fire reads as a rhythm, not a hold.
  const fireDecay = clamp01(1 - Math.max(0, combat.fireTime) / 0.3);
  const fireWeight = combat.firing ? 1 : fireDecay;
  if (fireWeight > 0) {
    const kick = clamp01(1 - Math.max(0, combat.fireTime) / 0.18) * (combat.firing ? 1 : 0.7);
    const aim: UpperBodyTarget = {
      spine: [-0.03, -0.1 + yaw * 0.2, 0],
      chest: [-0.05 - pitch * 0.12, -0.22 + yaw * 0.3, 0],
      neck: [-pitch * 0.2, yaw * 0.15, 0],
      head: [-pitch * 0.42, -0.12 + yaw * 0.45, 0],
      shoulderR: [0, 0, -0.2 - pitch * 0.1],
      armUpperR: [-1.55 - pitch * 0.85 + kick * 0.34, yaw * 0.35, -0.22],
      armLowerR: [-0.28 + kick * 0.22, 0, 0],
      handR: [0.1 - kick * 0.3, 0, 0],
      shoulderL: [0, 0, 0.22],
      armUpperL: [-0.56, 0.2, 0.44],
      armLowerL: [-0.96, 0, 0],
      handL: [-0.1, 0, 0],
      auralith: [-kick * 0.5, 0, 0],
    };
    composeUpperBody(pose, aim, fireWeight);
  }

  // --- Charge -------------------------------------------------------------
  // Coiling in around the ring. The higher the tier, the tighter the coil and
  // the faster the tremor — this is the visual half of the charge readout.
  const chargeWeight = combat.charging
    ? clamp01(0.35 + 0.65 * clamp01(combat.chargeProgress + combat.chargeTier * 0.34))
    : 0;
  if (chargeWeight > 0) {
    const tier = clamp(combat.chargeTier, 0, 3);
    const tremor = Math.sin(stateTime * (26 + tier * 9)) * 0.014 * (0.4 + tier);
    const charge: UpperBodyTarget = {
      spine: [0.06, -0.12, 0],
      chest: [0.11 + tremor, -0.3, 0],
      neck: [0.04, 0, 0],
      head: [0.07 - pitch * 0.2, -0.2, 0],
      shoulderR: [0, 0, -0.34],
      armUpperR: [-1.0 - 0.22 * tier + tremor, 0.18, -0.46],
      armLowerR: [-1.16 - 0.08 * tier, 0, 0],
      handR: [0.24, 0, 0],
      shoulderL: [0, 0, 0.4],
      armUpperL: [-0.78, 0.3, 0.66],
      armLowerL: [-1.2, 0, 0],
      handL: [0.2, 0, 0],
      auralith: [tremor * 3, 0, 0],
    };
    composeUpperBody(pose, charge, chargeWeight);
  }

  // --- Resonance Counter --------------------------------------------------
  // The ring is swept across the body, face on. Distinct from firing at a
  // glance, which is the whole point of a reflect window.
  const counterWeight = combat.countering
    ? 1
    : clamp01(1 - Math.max(0, combat.counterTime) / 0.32);
  if (counterWeight > 0) {
    const counter: UpperBodyTarget = {
      spine: [-0.08, 0.16, 0],
      chest: [-0.12, 0.36, 0.06],
      neck: [0.02, 0.08, 0],
      head: [-0.05, 0.2, 0],
      shoulderR: [0, 0, 0.2],
      armUpperR: [-1.26, 0.52, 0.56],
      armLowerR: [-1.38, 0, 0],
      handR: [-0.35, 0, 0],
      shoulderL: [0, 0, 0.3],
      armUpperL: [-0.36, -0.2, 0.86],
      armLowerL: [-0.5, 0, 0],
      handL: [0.1, 0, 0],
      auralith: [0.2, 0.9, 0],
    };
    composeUpperBody(pose, counter, counterWeight);
  }
}

/**
 * The complete target pose for a frame.
 *
 * Pure, allocation-free when `out` is supplied, and — critically — dependent
 * only on its arguments. There is no hidden state that could hold a previous
 * animation open past its welcome.
 */
export function computeTargetPose(
  input: LocomotionPoseInput,
  combat: CombatPoseInput = NEUTRAL_COMBAT_POSE_INPUT,
  out: Pose = createPose(),
): Pose {
  resetPose(out);
  applyLocomotion(out, input);

  // Downed and cutscene states own the whole body — the player is not aiming.
  if (input.state !== 'downed' && input.state !== 'cutscene') {
    applyCombatLayer(out, combat, input.stateTime);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Secondary motion
// ---------------------------------------------------------------------------

/** A critically-damped spring in three axes. */
export interface Spring3 {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function createSpring3(): Spring3 {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}

/**
 * Advances a critically-damped spring analytically.
 *
 * The closed form of `x'' + 2ωx' + ω²x = 0` is used rather than an Euler step,
 * so the result is *exactly* framerate independent for a constant target and
 * unconditionally stable — no explosion at large `dt`, which matters because a
 * browser tab that loses focus can hand us a very large frame.
 */
function stepSpringAxis(
  position: number,
  velocity: number,
  target: number,
  omega: number,
  dt: number,
  out: { p: number; v: number },
): void {
  const e = Math.exp(-omega * dt);
  const d = position - target;
  const b = velocity + omega * d;
  const decayed = d + b * dt;
  out.p = target + decayed * e;
  out.v = (b - omega * decayed) * e;
}

const springScratch = { p: 0, v: 0 };

/** Hard bounds so a pathological velocity can never send cloth to infinity. */
const SPRING_MAX_OFFSET = 2;
const SPRING_MAX_SPEED = 40;

export function stepSpring3(
  spring: Spring3,
  targetX: number,
  targetY: number,
  targetZ: number,
  omega: number,
  dt: number,
): void {
  if (!(dt > 0)) return;
  const w = clamp(omega, 0.01, 120);
  const tx = clamp(targetX, -SPRING_MAX_OFFSET, SPRING_MAX_OFFSET);
  const ty = clamp(targetY, -SPRING_MAX_OFFSET, SPRING_MAX_OFFSET);
  const tz = clamp(targetZ, -SPRING_MAX_OFFSET, SPRING_MAX_OFFSET);

  stepSpringAxis(spring.x, spring.vx, tx, w, dt, springScratch);
  spring.x = clamp(springScratch.p, -SPRING_MAX_OFFSET * 2, SPRING_MAX_OFFSET * 2);
  spring.vx = clamp(springScratch.v, -SPRING_MAX_SPEED, SPRING_MAX_SPEED);

  stepSpringAxis(spring.y, spring.vy, ty, w, dt, springScratch);
  spring.y = clamp(springScratch.p, -SPRING_MAX_OFFSET * 2, SPRING_MAX_OFFSET * 2);
  spring.vy = clamp(springScratch.v, -SPRING_MAX_SPEED, SPRING_MAX_SPEED);

  stepSpringAxis(spring.z, spring.vz, tz, w, dt, springScratch);
  spring.z = clamp(springScratch.p, -SPRING_MAX_OFFSET * 2, SPRING_MAX_OFFSET * 2);
  spring.vz = clamp(springScratch.v, -SPRING_MAX_SPEED, SPRING_MAX_SPEED);
}

/**
 * The follow-through: curls, sash, skirt-wrap and the Auralith's orbit.
 *
 * Each spring chases a target derived from the body's own velocity, expressed
 * in the character's local space, so hair sweeps back when running forward and
 * sideways when strafing.
 */
export interface SecondaryMotion {
  readonly hair: Spring3;
  readonly sash: Spring3;
  readonly skirt: Spring3;
  readonly auralith: Spring3;
}

export function createSecondaryMotion(): SecondaryMotion {
  return {
    hair: createSpring3(),
    sash: createSpring3(),
    skirt: createSpring3(),
    auralith: createSpring3(),
  };
}

interface SecondaryTuning {
  /** Spring rate. Higher is stiffer and settles sooner. */
  readonly omega: number;
  /** Metres of lag per metre-per-second of body velocity. */
  readonly drag: number;
  readonly maxOffset: number;
  /** Extra downward sag, in metres — cloth has weight, curls less so. */
  readonly sag: number;
  /** Extra lift while airborne. */
  readonly airLift: number;
}

const HAIR_TUNING: SecondaryTuning = {
  omega: 15,
  drag: 0.02,
  maxOffset: 0.14,
  sag: 0.004,
  airLift: 0.035,
};
const SASH_TUNING: SecondaryTuning = {
  omega: 11,
  drag: 0.026,
  maxOffset: 0.19,
  sag: 0.016,
  airLift: 0.05,
};
const SKIRT_TUNING: SecondaryTuning = {
  omega: 9.5,
  drag: 0.024,
  maxOffset: 0.21,
  sag: 0.02,
  airLift: 0.055,
};
const AURALITH_TUNING: SecondaryTuning = {
  omega: 21,
  drag: 0.009,
  maxOffset: 0.09,
  sag: 0.002,
  airLift: 0.01,
};

function stepPart(
  spring: Spring3,
  tuning: SecondaryTuning,
  localVx: number,
  localVy: number,
  localVz: number,
  grounded: boolean,
  dt: number,
): void {
  const lift = grounded ? 0 : tuning.airLift;
  const tx = clamp(-localVx * tuning.drag, -tuning.maxOffset, tuning.maxOffset);
  const ty = clamp(
    -localVy * tuning.drag * 0.5 - tuning.sag + lift,
    -tuning.maxOffset,
    tuning.maxOffset,
  );
  const tz = clamp(-localVz * tuning.drag, -tuning.maxOffset, tuning.maxOffset);
  stepSpring3(spring, tx, ty, tz, tuning.omega, dt);
}

/**
 * Advances every follow-through spring.
 *
 * `velocity` is world-space; `facingYaw` rotates it into the body's frame so
 * the lag direction is correct no matter which way the Tuner is looking.
 */
export function stepSecondaryMotion(
  motion: SecondaryMotion,
  velocity: Readonly<Vec3>,
  facingYaw: number,
  grounded: boolean,
  dt: number,
): SecondaryMotion {
  const vx = Number.isFinite(velocity.x) ? velocity.x : 0;
  const vy = Number.isFinite(velocity.y) ? velocity.y : 0;
  const vz = Number.isFinite(velocity.z) ? velocity.z : 0;
  const yaw = Number.isFinite(facingYaw) ? facingYaw : 0;

  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  const localX = vx * cos - vz * sin;
  const localZ = vx * sin + vz * cos;

  stepPart(motion.hair, HAIR_TUNING, localX, vy, localZ, grounded, dt);
  stepPart(motion.sash, SASH_TUNING, localX, vy, localZ, grounded, dt);
  stepPart(motion.skirt, SKIRT_TUNING, localX, vy, localZ, grounded, dt);
  stepPart(motion.auralith, AURALITH_TUNING, localX, vy, localZ, grounded, dt);
  return motion;
}

/** Writes the springs' displacement into the pose as offsets plus a small
 *  sympathetic rotation, so curls and cloth swing rather than merely slide. */
export function applySecondaryMotion(pose: Pose, motion: Readonly<SecondaryMotion>): Pose {
  const write = (joint: JointPose, spring: Spring3, rotationGain: number): void => {
    joint.ox += spring.x;
    joint.oy += spring.y;
    joint.oz += spring.z;
    addJoint(
      joint,
      clamp(-spring.z * rotationGain, -0.9, 0.9),
      0,
      clamp(spring.x * rotationGain, -0.9, 0.9),
    );
  };

  write(pose.hair, motion.hair, 2.6);
  write(pose.sash, motion.sash, 2.2);
  write(pose.skirt, motion.skirt, 2.0);
  write(pose.auralith, motion.auralith, 1.4);
  return pose;
}

// ---------------------------------------------------------------------------
// The animator
// ---------------------------------------------------------------------------

export interface Animator {
  /**
   * The pose the character is heading for. Recomputed from gameplay state on
   * every `stepAnimator` call, with no lock-out. Read this if you need the
   * authoritative pose for the current frame's state.
   */
  readonly target: Pose;
  /** The smoothed follower. Cosmetic only. */
  readonly current: Pose;
  /** `current` with follow-through applied. This is what the renderer draws. */
  readonly output: Pose;
  readonly secondary: SecondaryMotion;
  /** Previous movement state, for debugging and for transition-flavoured VFX. */
  lastState: MovementState;
  /** Seconds since the last state change. Never gates anything. */
  timeSinceStateChange: number;
}

export function createAnimator(initialState: MovementState = 'idle'): Animator {
  return {
    target: createPose(),
    current: createPose(),
    output: createPose(),
    secondary: createSecondaryMotion(),
    lastState: initialState,
    timeSinceStateChange: 0,
  };
}

/**
 * Advances the animator by `dt` seconds and returns the pose to draw.
 *
 * Order matters and is part of the contract:
 *   1. the target is recomputed from the supplied state — unconditionally,
 *      first, with no transition table consulted;
 *   2. the follower is damped toward it (framerate-independent exponential
 *      smoothing, so 1 step of 1/30 s equals 2 steps of 1/60 s exactly);
 *   3. follow-through springs advance and are written onto a separate output
 *      pose, leaving the follower unpolluted.
 *
 * Nothing in this function can refuse, delay or shorten a gameplay state
 * change. That is the invariant `animation.test.ts` guards.
 */
export function stepAnimator(
  animator: Animator,
  input: LocomotionPoseInput,
  combat: CombatPoseInput,
  dt: number,
): Pose {
  // 1. Target first, always. No lock-out, no minimum dwell, no exceptions.
  computeTargetPose(input, combat, animator.target);

  const changed = animator.lastState !== input.state;
  animator.lastState = input.state;
  animator.timeSinceStateChange = changed ? 0 : animator.timeSinceStateChange + Math.max(0, dt);

  // 2. Cosmetic follower.
  const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
  const smoothing = BLEND_SMOOTHING[input.state];
  for (const name of JOINT_NAMES) {
    const current = animator.current[name];
    const target = animator.target[name];
    current.rx = damp(current.rx, target.rx, smoothing, step);
    current.ry = damp(current.ry, target.ry, smoothing, step);
    current.rz = damp(current.rz, target.rz, smoothing, step);
    current.ox = damp(current.ox, target.ox, smoothing, step);
    current.oy = damp(current.oy, target.oy, smoothing, step);
    current.oz = damp(current.oz, target.oz, smoothing, step);
  }

  // 3. Follow-through, onto a copy so the follower stays clean.
  stepSecondaryMotion(
    animator.secondary,
    input.velocity,
    input.facingYaw ?? 0,
    input.grounded,
    step,
  );
  copyPose(animator.output, animator.current);
  applySecondaryMotion(animator.output, animator.secondary);
  return animator.output;
}

/**
 * Snaps the follower onto the target.
 *
 * Used on respawn, on teleport and when a cutscene hands control back, so the
 * character never visibly interpolates across a cut.
 */
export function snapAnimator(animator: Animator): void {
  copyPose(animator.current, animator.target);
  copyPose(animator.output, animator.target);
  for (const spring of [
    animator.secondary.hair,
    animator.secondary.sash,
    animator.secondary.skirt,
    animator.secondary.auralith,
  ]) {
    spring.x = 0;
    spring.y = 0;
    spring.z = 0;
    spring.vx = 0;
    spring.vy = 0;
    spring.vz = 0;
  }
}

/** Exposed so the debug overlay can show what smoothing a state uses. */
export function blendSmoothingFor(state: MovementState): number {
  return BLEND_SMOOTHING[state];
}

/** Scratch pose available to callers that want a throwaway target. */
export function scratchPose(): Pose {
  return scratchLayer;
}
