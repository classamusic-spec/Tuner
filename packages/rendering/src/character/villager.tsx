import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from '@tuner/shared';
import {
  VILLAGER_PALETTE,
  headYawFor,
  villagerAppearance,
  yawTowards,
} from './villager-appearance.js';

/**
 * A survivor.
 *
 * Same primitives, same proportions and same flat-shaded materials as the Tuner,
 * because a cast built from two different toolkits reads as two different games.
 * What differs is what differs between real people seen across a terrace:
 * height, stance, bulk, and what they are carrying.
 *
 * The rig is deliberately much simpler than the Tuner's. She has a full joint
 * hierarchy because she fights; a gardener needs to breathe, walk, and look up
 * when spoken to. Three moving parts do all of that, and a village of them costs
 * almost nothing.
 */

export interface VillagerProps {
  /**
   * Feet, matching `player.position` and `TunerCharacter`. Both go into
   * `moveCharacter` unadjusted and come back out the same way, so a survivor and
   * the Tuner standing on one terrace are drawn at one height. Offsetting this
   * by half a body height buries her to the waist in her own garden — which is
   * what the first capture of this component showed, before it turned out the
   * anchor was never the problem.
   */
  readonly position: THREE.Vector3Like;
  readonly yaw: number;
  /** Appearance key from `NpcDef.appearance`. */
  readonly appearance: string;
  /** True while this survivor is the one talking. */
  readonly speaking?: boolean;
  /** Where the player is, so a speaker can look at them. */
  readonly lookAt?: THREE.Vector3Like;
  readonly castShadow?: boolean;
}

function flat(colour: string, extra?: Partial<THREE.MeshLambertMaterialParameters>) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(colour), ...extra });
}

/** Metres per second at which the walk cycle reaches full stride. */
const FULL_STRIDE_SPEED = 1.4;
/** Radians of leg swing at full stride. */
const STRIDE_SWING = 0.62;
/** Breaths per second while standing. */
const BREATH_HZ = 0.28;

export function Villager(props: VillagerProps): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const legLRef = useRef<THREE.Group>(null);
  const legRRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  const phase = useRef(0);
  // Speed is measured rather than passed. The projection mutates in place and
  // the scene does not re-render from gameplay, so a `speed` prop would be as
  // stale as the position it described; the distance actually covered since the
  // last frame is always current.
  const lastPos = useRef<{ x: number; z: number } | null>(null);
  const smoothedSpeed = useRef(0);

  const look = villagerAppearance(props.appearance);

  const mats = useMemo(
    () => ({
      skin: flat(look.skin),
      skinShade: flat(VILLAGER_PALETTE.skinShade),
      hair: flat(look.hair),
      cloth: flat(look.cloth),
      clothDeep: flat(look.clothDeep),
      leather: flat(VILLAGER_PALETTE.leather),
      eye: flat(VILLAGER_PALETTE.eye),
      metal: flat(PALETTE.goldDim),
      // Emissive rather than a flat tint: the infection on a person should look
      // like it is coming from inside them, the same way it does on the walls.
      infected: flat(VILLAGER_PALETTE.detuned, {
        emissive: new THREE.Color(VILLAGER_PALETTE.detuned),
        emissiveIntensity: 0.5,
      }),
      restored: flat(VILLAGER_PALETTE.restored, {
        emissive: new THREE.Color(VILLAGER_PALETTE.restored),
        emissiveIntensity: 0.35,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [look.skin, look.hair, look.cloth, look.clothDeep],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    group.position.set(props.position.x, props.position.y, props.position.z);
    group.rotation.y = props.yaw;

    const previous = lastPos.current;
    const instant =
      previous === null || delta <= 0
        ? 0
        : Math.hypot(props.position.x - previous.x, props.position.z - previous.z) / delta;
    lastPos.current = { x: props.position.x, z: props.position.z };
    // Smoothed, so a single stalled frame does not drop somebody mid-stride.
    smoothedSpeed.current += (instant - smoothedSpeed.current) * Math.min(1, delta * 8);
    const stride = Math.min(1, smoothedSpeed.current / FULL_STRIDE_SPEED);
    // The cycle advances with distance covered, not with time, so a slow walker
    // takes slow steps rather than the same steps more faintly.
    phase.current += delta * (stride > 0.02 ? 2.6 * stride + 1.4 : BREATH_HZ * Math.PI * 2);

    const swing = Math.sin(phase.current) * STRIDE_SWING * stride;
    if (legLRef.current) legLRef.current.rotation.x = swing;
    if (legRRef.current) legRRef.current.rotation.x = -swing;
    // Arms counter-swing, and hang almost still when carrying something.
    const armScale = look.prop === 'none' ? 0.7 : 0.25;
    if (armLRef.current) armLRef.current.rotation.x = -swing * armScale;
    if (armRRef.current) armRRef.current.rotation.x = swing * armScale;

    const body = bodyRef.current;
    if (body) {
      // Breathing when still; a slight bob in step when walking.
      const breath = stride < 0.02 ? Math.sin(phase.current) * 0.012 : Math.abs(swing) * 0.035;
      body.position.y = breath;
      body.rotation.x = look.stoop;
    }

    const head = headRef.current;
    if (head) {
      let toPlayer = 0;
      const target = props.lookAt;
      if (target !== undefined) {
        toPlayer = yawTowards(target.x - props.position.x, target.z - props.position.z);
      }
      const want = headYawFor(props.yaw, toPlayer, props.speaking === true);
      // Eased, so a head turn reads as attention rather than as a snap.
      head.rotation.y += (want - head.rotation.y) * Math.min(1, delta * 6);
      // A speaker straightens up out of their stoop to meet the player's eye.
      head.rotation.x = props.speaking === true ? -look.stoop * 0.8 : 0;
    }
  });

  const cast = props.castShadow !== false;
  const s = look.scale;
  const glow = look.infection > 0 ? mats.infected : look.restoration > 0 ? mats.restored : null;

  return (
    <group ref={groupRef} name={`villager:${props.appearance}`} scale={[s, s, s]}>
      {/* Legs hang from the hips, so a swing rotates the whole limb. */}
      <group ref={legLRef} position={[0.09, 0.74, 0]}>
        <mesh castShadow={cast} material={mats.clothDeep} position={[0, -0.37, 0]}>
          <boxGeometry args={[0.13, 0.74, 0.15]} />
        </mesh>
        <mesh castShadow={cast} material={mats.leather} position={[0, -0.74, 0.02]}>
          <boxGeometry args={[0.14, 0.09, 0.22]} />
        </mesh>
      </group>
      <group ref={legRRef} position={[-0.09, 0.74, 0]}>
        <mesh castShadow={cast} material={mats.clothDeep} position={[0, -0.37, 0]}>
          <boxGeometry args={[0.13, 0.74, 0.15]} />
        </mesh>
        <mesh castShadow={cast} material={mats.leather} position={[0, -0.74, 0.02]}>
          <boxGeometry args={[0.14, 0.09, 0.22]} />
        </mesh>
      </group>

      <group ref={bodyRef} position={[0, 0.74, 0]}>
        {/* Torso */}
        <mesh castShadow={cast} material={mats.cloth} position={[0, 0.22, 0]}>
          <boxGeometry args={[0.34, 0.44, 0.21]} />
        </mesh>
        {/* A worn apron or coat front, so the front reads from the back. */}
        <mesh material={mats.clothDeep} position={[0, 0.16, 0.108]}>
          <boxGeometry args={[0.22, 0.34, 0.02]} />
        </mesh>

        {glow && (
          // The tell. A violet seam up the spine for the detuned, a soft green
          // one for the restored — visible from behind, which is how a player
          // usually meets somebody standing in a garden.
          <mesh material={glow} position={[0, 0.22, -0.107]}>
            <boxGeometry args={[0.05, 0.4, 0.02]} />
          </mesh>
        )}

        <group ref={armLRef} position={[0.21, 0.38, 0]}>
          <mesh castShadow={cast} material={mats.cloth} position={[0, -0.19, 0]}>
            <boxGeometry args={[0.1, 0.38, 0.11]} />
          </mesh>
          <mesh material={mats.skin} position={[0, -0.42, 0]}>
            <boxGeometry args={[0.09, 0.1, 0.1]} />
          </mesh>

          {look.prop === 'watering-can' && (
            <group position={[0, -0.52, 0.04]}>
              <mesh castShadow={cast} material={mats.metal}>
                <boxGeometry args={[0.17, 0.19, 0.15]} />
              </mesh>
              {/* The spout. Two litres a trip, eleven trips a day. */}
              <mesh material={mats.metal} position={[0.13, 0.02, 0.02]} rotation={[0, 0, -0.5]}>
                <boxGeometry args={[0.16, 0.04, 0.04]} />
              </mesh>
            </group>
          )}
          {look.prop === 'seedling' && (
            <group position={[0, -0.5, 0.06]}>
              <mesh material={mats.leather}>
                <boxGeometry args={[0.12, 0.09, 0.12]} />
              </mesh>
              <mesh material={mats.restored} position={[0, 0.1, 0]}>
                <boxGeometry args={[0.02, 0.13, 0.02]} />
              </mesh>
            </group>
          )}
        </group>

        <group ref={armRRef} position={[-0.21, 0.38, 0]}>
          <mesh castShadow={cast} material={mats.cloth} position={[0, -0.19, 0]}>
            <boxGeometry args={[0.1, 0.38, 0.11]} />
          </mesh>
          <mesh material={mats.skin} position={[0, -0.42, 0]}>
            <boxGeometry args={[0.09, 0.1, 0.1]} />
          </mesh>
          {look.prop === 'spyglass' && (
            <mesh castShadow={cast} material={mats.metal} position={[0, -0.5, 0.08]} rotation={[1.1, 0, 0]}>
              <cylinderGeometry args={[0.028, 0.035, 0.26, 8]} />
            </mesh>
          )}
        </group>

        {/* Head */}
        <group ref={headRef} position={[0, 0.58, 0]}>
          <mesh castShadow={cast} material={mats.skin}>
            <boxGeometry args={[0.19, 0.2, 0.18]} />
          </mesh>
          <mesh material={mats.eye} position={[0.05, 0.015, 0.093]}>
            <boxGeometry args={[0.038, 0.05, 0.01]} />
          </mesh>
          <mesh material={mats.eye} position={[-0.05, 0.015, 0.093]}>
            <boxGeometry args={[0.038, 0.05, 0.01]} />
          </mesh>
          <mesh castShadow={cast} material={mats.hair} position={[0, 0.1, -0.01]}>
            <boxGeometry args={[0.21, 0.09, 0.2]} />
          </mesh>
          {look.build === 'watcher' && (
            // A brimmed hat. The silhouette that says "this one is looking at
            // something a long way off" before a word of dialogue does.
            <mesh castShadow={cast} material={mats.leather} position={[0, 0.14, 0]}>
              <cylinderGeometry args={[0.24, 0.24, 0.02, 10]} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}
