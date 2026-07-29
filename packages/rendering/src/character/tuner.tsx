import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE, type ResonanceFormId } from '@tuner/shared';
import type { MovementState } from '@tuner/game-core';
import {
  JOINT_NAMES,
  createAnimator,
  stepAnimator,
  type CombatPoseInput,
  type JointName,
  type LocomotionPoseInput,
} from './animation.js';
import { Auralith } from './auralith.js';

/**
 * The Tuner.
 *
 * Built entirely from primitives — there are no model assets in this project.
 * That is deliberate: it keeps the download small, guarantees the whole cast
 * shares one style, and lets the costume's accent colours shift with the
 * equipped Resonance Form, which baked textures could not do.
 *
 * The rig is a real hierarchy of named groups matching `JOINT_NAMES`, so
 * `animation.ts` — which is pure, testable and knows nothing about Three.js —
 * can pose it without this file containing any animation logic of its own.
 */

export interface TunerCharacterProps {
  readonly position: THREE.Vector3Like;
  readonly yaw: number;
  readonly velocity: THREE.Vector3Like;
  readonly movementState: MovementState;
  readonly grounded: boolean;
  readonly form: ResonanceFormId;
  readonly chargeTier: number;
  readonly charging: boolean;
  readonly firing: boolean;
  readonly countering: boolean;
  readonly hurt: boolean;
  /** Accent colour for the equipped form. */
  readonly accent: string;
  readonly castShadow?: boolean;
}

/** Skin, hair and cloth. Costume accents come from the form's colour. */
const SKIN = '#c98d63';
const SKIN_SHADE = '#a97350';
const HAIR = '#c99a5f';
const HAIR_SHADE = '#a87c46';
const TUNIC = '#2b2f70';
const TUNIC_DEEP = '#1e2154';
const SASH = '#7b57b8';
const LEGGING = '#6b52a8';
const BOOT = '#4a3b86';
const GLOVE = '#2b2f70';
const EYE = '#141a33';

function flat(colour: string, extra?: Partial<THREE.MeshLambertMaterialParameters>) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(colour), ...extra });
}

/**
 * Rest pose, in metres, for a 1.6 m character standing with feet at y = 0.
 * Every joint's rest transform lives here so the animation layer only ever
 * supplies *deviations*.
 */
const REST: Readonly<Record<JointName, [number, number, number]>> = {
  root: [0, 0, 0],
  hips: [0, 0.78, 0],
  spine: [0, 0.14, 0],
  chest: [0, 0.16, 0],
  neck: [0, 0.15, 0],
  head: [0, 0.13, 0],
  shoulderL: [0.17, 0.1, 0],
  armUpperL: [0, -0.05, 0],
  armLowerL: [0, -0.22, 0],
  handL: [0, -0.2, 0],
  shoulderR: [-0.17, 0.1, 0],
  armUpperR: [0, -0.05, 0],
  armLowerR: [0, -0.22, 0],
  handR: [0, -0.2, 0],
  legUpperL: [0.09, -0.04, 0],
  legLowerL: [0, -0.32, 0],
  footL: [0, -0.3, 0],
  legUpperR: [-0.09, -0.04, 0],
  legLowerR: [0, -0.32, 0],
  footR: [0, -0.3, 0],
  hair: [0, 0.1, 0],
  sash: [0, 0.02, 0.06],
  skirt: [0, -0.04, 0],
  auralith: [-0.28, -0.16, 0.06],
};

export function TunerCharacter(props: TunerCharacterProps): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const joints = useRef<Partial<Record<JointName, THREE.Group>>>({});
  const animator = useMemo(() => createAnimator('idle'), []);

  // One material per colour, created once. A character rebuilding materials on
  // every render is a leak that only shows up on mobile.
  const mats = useMemo(
    () => ({
      skin: flat(SKIN),
      skinShade: flat(SKIN_SHADE),
      hair: flat(HAIR),
      hairShade: flat(HAIR_SHADE),
      tunic: flat(TUNIC),
      tunicDeep: flat(TUNIC_DEEP),
      sash: flat(SASH),
      legging: flat(LEGGING),
      boot: flat(BOOT),
      glove: flat(GLOVE),
      eye: flat(EYE),
      gold: flat(PALETTE.gold),
      accent: flat(props.accent),
    }),
    // Only the accent changes at runtime, and only when the form changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Recolour the accent in place rather than rebuilding the material set.
  mats.accent.color.set(props.accent);

  // Mutable backing objects for the pose inputs. They are rebuilt in place each
  // frame rather than reallocated, because this runs inside useFrame.
  const locoBacking = useRef({
    state: 'idle' as MovementState,
    stateTime: 0,
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    facingYaw: 0,
    wallSide: 0,
  });

  const combatBacking = useRef({
    firing: false,
    fireTime: 99,
    charging: false,
    chargeTier: 0,
    chargeProgress: 0,
    countering: false,
    counterTime: 99,
    aimPitch: 0,
    aimYaw: 0,
  });

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    group.position.set(props.position.x, props.position.y, props.position.z);
    group.rotation.y = props.yaw;

    const loco = locoBacking.current;
    // stateTime resets on a state change: the animator reads it to phase cycles,
    // and a stale value would make a fresh run start mid-stride.
    loco.stateTime = loco.state === props.movementState ? loco.stateTime + delta : 0;
    loco.state = props.movementState;
    loco.velocity.x = props.velocity.x;
    loco.velocity.y = props.velocity.y;
    loco.velocity.z = props.velocity.z;
    loco.grounded = props.grounded;
    loco.facingYaw = props.yaw;

    const cmb = combatBacking.current;
    cmb.firing = props.firing;
    cmb.fireTime = props.firing ? 0 : Math.min(99, cmb.fireTime + delta);
    cmb.charging = props.charging;
    cmb.chargeTier = props.chargeTier;
    cmb.chargeProgress = props.charging ? Math.min(1, props.chargeTier / 3) : 0;
    cmb.countering = props.countering;
    cmb.counterTime = props.countering ? 0 : Math.min(99, cmb.counterTime + delta);

    const pose = stepAnimator(
      animator,
      loco as LocomotionPoseInput,
      cmb as CombatPoseInput,
      delta,
    );

    // Apply the pose. Rotations are local Euler deviations; offsets are metres
    // added to the rest position.
    for (const name of JOINT_NAMES) {
      const node = joints.current[name];
      if (!node) continue;
      const jp = pose[name];
      const rest = REST[name];
      node.rotation.set(jp.rx, jp.ry, jp.rz);
      node.position.set(rest[0] + jp.ox, rest[1] + jp.oy, rest[2] + jp.oz);
    }
  });

  const bind = (name: JointName) => (node: THREE.Group | null) => {
    if (node) joints.current[name] = node;
  };

  const cast = props.castShadow !== false;

  return (
    <group ref={groupRef} name="tuner">
      <group ref={bind('root')} position={REST.root}>
        <group ref={bind('hips')} position={REST.hips}>
          {/* Hips */}
          <mesh castShadow={cast} material={mats.tunicDeep}>
            <boxGeometry args={[0.3, 0.16, 0.2]} />
          </mesh>

          {/* Layered asymmetric skirt-wrap, falling to one side. */}
          <group ref={bind('skirt')} position={REST.skirt}>
            <mesh castShadow={cast} material={mats.sash} position={[0.03, -0.16, 0]} rotation={[0, 0, -0.08]}>
              <boxGeometry args={[0.34, 0.34, 0.26]} />
            </mesh>
            <mesh castShadow={cast} material={mats.tunic} position={[-0.06, -0.28, 0.01]} rotation={[0, 0, 0.14]}>
              <boxGeometry args={[0.22, 0.3, 0.22]} />
            </mesh>
          </group>

          {/* Gold tassel cluster at the hip. */}
          <group position={[0.19, -0.06, 0.06]} rotation={[0, 0, -0.2]}>
            {[-0.02, 0, 0.02].map((dx, i) => (
              <mesh key={i} material={mats.gold} position={[dx, -0.09, 0]}>
                <boxGeometry args={[0.018, 0.18, 0.018]} />
              </mesh>
            ))}
          </group>

          <group ref={bind('spine')} position={REST.spine}>
            <mesh castShadow={cast} material={mats.tunic}>
              <boxGeometry args={[0.3, 0.18, 0.19]} />
            </mesh>

            <group ref={bind('chest')} position={REST.chest}>
              <mesh castShadow={cast} material={mats.tunic}>
                <boxGeometry args={[0.34, 0.2, 0.2]} />
              </mesh>

              {/* Violet sash, draped diagonally across the chest. */}
              <group ref={bind('sash')} position={REST.sash}>
                <mesh material={mats.sash} rotation={[0, 0, 0.62]} position={[0, 0, 0.02]}>
                  <boxGeometry args={[0.44, 0.11, 0.19]} />
                </mesh>
              </group>

              {/* The emblem: two interlocking gold rings at the shoulder. */}
              <group position={[0.12, 0.05, 0.11]}>
                <mesh material={mats.gold}>
                  <torusGeometry args={[0.045, 0.013, 6, 16]} />
                </mesh>
                <mesh material={mats.gold} position={[0.05, 0, 0]}>
                  <torusGeometry args={[0.045, 0.013, 6, 16]} />
                </mesh>
              </group>

              {/* Head and hair */}
              <group ref={bind('neck')} position={REST.neck}>
                <mesh material={mats.skinShade}>
                  <boxGeometry args={[0.09, 0.07, 0.09]} />
                </mesh>
                <group ref={bind('head')} position={REST.head}>
                  <mesh castShadow={cast} material={mats.skin}>
                    <boxGeometry args={[0.2, 0.21, 0.19]} />
                  </mesh>
                  {/* Large readable eyes — the whole face at mobile scale. */}
                  <mesh material={mats.eye} position={[0.055, 0.015, 0.098]}>
                    <boxGeometry args={[0.042, 0.055, 0.01]} />
                  </mesh>
                  <mesh material={mats.eye} position={[-0.055, 0.015, 0.098]}>
                    <boxGeometry args={[0.042, 0.055, 0.01]} />
                  </mesh>

                  {/*
                   * Voluminous curly hair. This is the silhouette's signature,
                   * so it is built from overlapping spheres rather than one
                   * shape — it reads as curls at any distance and costs little.
                   */}
                  <group ref={bind('hair')} position={REST.hair}>
                    {CURLS.map(([x, y, z, r, shade], i) => (
                      <mesh
                        key={i}
                        castShadow={cast}
                        material={shade ? mats.hairShade : mats.hair}
                        position={[x, y, z]}
                      >
                        <sphereGeometry args={[r, 7, 6]} />
                      </mesh>
                    ))}
                  </group>
                </group>
              </group>

              {/* Left arm — carries the Auralith. */}
              <group ref={bind('shoulderL')} position={REST.shoulderL}>
                <group ref={bind('armUpperL')} position={REST.armUpperL}>
                  <mesh castShadow={cast} material={mats.sash} position={[0, -0.09, 0]}>
                    <boxGeometry args={[0.085, 0.2, 0.085]} />
                  </mesh>
                  <group ref={bind('armLowerL')} position={REST.armLowerL}>
                    <mesh castShadow={cast} material={mats.skin} position={[0, -0.09, 0]}>
                      <boxGeometry args={[0.072, 0.2, 0.072]} />
                    </mesh>
                    <group ref={bind('handL')} position={REST.handL}>
                      <mesh material={mats.glove}>
                        <boxGeometry args={[0.08, 0.09, 0.06]} />
                      </mesh>
                      {/* The Auralith orbits this forearm. */}
                      <group ref={bind('auralith')} position={REST.auralith}>
                        <Auralith
                          form={props.form}
                          chargeTier={props.chargeTier}
                          charging={props.charging}
                          accent={props.accent}
                        />
                      </group>
                    </group>
                  </group>
                </group>
              </group>

              {/* Right arm */}
              <group ref={bind('shoulderR')} position={REST.shoulderR}>
                <group ref={bind('armUpperR')} position={REST.armUpperR}>
                  <mesh castShadow={cast} material={mats.sash} position={[0, -0.09, 0]}>
                    <boxGeometry args={[0.085, 0.2, 0.085]} />
                  </mesh>
                  <group ref={bind('armLowerR')} position={REST.armLowerR}>
                    <mesh castShadow={cast} material={mats.skin} position={[0, -0.09, 0]}>
                      <boxGeometry args={[0.072, 0.2, 0.072]} />
                    </mesh>
                    <group ref={bind('handR')} position={REST.handR}>
                      <mesh material={mats.glove}>
                        <boxGeometry args={[0.08, 0.09, 0.06]} />
                      </mesh>
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>

          {/* Legs */}
          <group ref={bind('legUpperL')} position={REST.legUpperL}>
            <mesh castShadow={cast} material={mats.legging} position={[0, -0.15, 0]}>
              <boxGeometry args={[0.1, 0.3, 0.1]} />
            </mesh>
            <group ref={bind('legLowerL')} position={REST.legLowerL}>
              <mesh castShadow={cast} material={mats.legging} position={[0, -0.14, 0]}>
                <boxGeometry args={[0.088, 0.28, 0.088]} />
              </mesh>
              <group ref={bind('footL')} position={REST.footL}>
                {/* Soft pointed boot. */}
                <mesh castShadow={cast} material={mats.boot} position={[0, 0.02, 0.03]}>
                  <boxGeometry args={[0.095, 0.075, 0.19]} />
                </mesh>
                <mesh material={mats.boot} position={[0, 0.0, 0.13]} rotation={[0.3, 0, 0]}>
                  <boxGeometry args={[0.07, 0.05, 0.07]} />
                </mesh>
              </group>
            </group>
          </group>
          <group ref={bind('legUpperR')} position={REST.legUpperR}>
            <mesh castShadow={cast} material={mats.legging} position={[0, -0.15, 0]}>
              <boxGeometry args={[0.1, 0.3, 0.1]} />
            </mesh>
            <group ref={bind('legLowerR')} position={REST.legLowerR}>
              <mesh castShadow={cast} material={mats.legging} position={[0, -0.14, 0]}>
                <boxGeometry args={[0.088, 0.28, 0.088]} />
              </mesh>
              <group ref={bind('footR')} position={REST.footR}>
                <mesh castShadow={cast} material={mats.boot} position={[0, 0.02, 0.03]}>
                  <boxGeometry args={[0.095, 0.075, 0.19]} />
                </mesh>
                <mesh material={mats.boot} position={[0, 0.0, 0.13]} rotation={[0.3, 0, 0]}>
                  <boxGeometry args={[0.07, 0.05, 0.07]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Curl cluster: [x, y, z, radius, useShade]. */
const CURLS: readonly [number, number, number, number, boolean][] = [
  [0, 0.05, 0, 0.135, false],
  [0.105, 0.02, 0.02, 0.085, false],
  [-0.105, 0.02, 0.02, 0.085, false],
  [0.06, 0.1, -0.06, 0.08, true],
  [-0.06, 0.1, -0.06, 0.08, true],
  [0, 0.02, -0.11, 0.095, true],
  [0.085, -0.03, -0.07, 0.07, true],
  [-0.085, -0.03, -0.07, 0.07, true],
  [0.055, 0.11, 0.06, 0.072, false],
  [-0.055, 0.11, 0.06, 0.072, false],
  [0, 0.13, 0.01, 0.088, false],
  [0.125, -0.05, -0.02, 0.058, true],
  [-0.125, -0.05, -0.02, 0.058, true],
];
