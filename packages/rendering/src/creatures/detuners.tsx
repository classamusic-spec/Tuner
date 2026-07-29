import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE, type EnemyRole } from '@tuner/shared';

/**
 * The Detuners, and the bosses.
 *
 * Angular obsidian-and-violet crystal with glowing violet cores and single
 * luminous eyes. They should look *grown into* a place rather than built for it
 * — wrong against the world's warm stone and gold.
 *
 * Two behaviours here are gameplay rather than decoration:
 *
 * - **Telegraphing** visibly winds the model up, and the ground ring drawn by
 *   the telegraph layer completes the pair. An attack that only announces itself
 *   in audio is not readable, and this game has to be playable muted.
 * - **Cleansing** dissolves violet into green. Corrupted wildlife and guardians
 *   are restored, not destroyed — that is the story's central claim, so the
 *   effect has to read as relief rather than as a death.
 */

const SHELL = '#2c2a3d';
const SHELL_DEEP = '#1c1a2b';
const CRYSTAL = PALETTE.infection;
const CORE = '#c99bff';

export interface DetunerCreatureProps {
  readonly position: THREE.Vector3Like;
  readonly yaw: number;
  readonly role: EnemyRole;
  /** Distinguishes variants that share a role. */
  readonly variant?: string;
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  /** True while winding up an attack. */
  readonly telegraphing: boolean;
  /** Wind-up progress in [0, 1]. */
  readonly telegraphProgress: number;
  /** Health fraction, for damage read-through. */
  readonly healthFraction: number;
  /** Set while the creature is being restored rather than destroyed. */
  readonly cleansing: boolean;
  readonly rooted: boolean;
  readonly silenced: boolean;
  readonly castShadow?: boolean;
}

function useDetunerMaterials(): {
  shell: THREE.MeshLambertMaterial;
  shellDeep: THREE.MeshLambertMaterial;
  crystal: THREE.MeshLambertMaterial;
  core: THREE.MeshBasicMaterial;
  eye: THREE.MeshBasicMaterial;
} {
  return useMemo(
    () => ({
      shell: new THREE.MeshLambertMaterial({ color: new THREE.Color(SHELL) }),
      shellDeep: new THREE.MeshLambertMaterial({ color: new THREE.Color(SHELL_DEEP) }),
      crystal: new THREE.MeshLambertMaterial({ color: new THREE.Color(CRYSTAL) }),
      core: new THREE.MeshBasicMaterial({ color: new THREE.Color(CORE) }),
      eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(CORE) }),
    }),
    [],
  );
}

export function DetunerCreature(props: DetunerCreatureProps): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const mats = useDetunerMaterials();

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);
    timeRef.current += step;

    const group = groupRef.current;
    if (group) {
      group.position.set(props.position.x, props.position.y, props.position.z);
      group.rotation.y = props.yaw;
    }

    const body = bodyRef.current;
    if (!body) return;

    // Idle life: a slow bob for flyers, a subtle breathe for everything else.
    const idle =
      props.role === 'flyer'
        ? Math.sin(timeRef.current * 2.4) * 0.12
        : Math.sin(timeRef.current * 1.6) * 0.02;

    // The wind-up. Compressing then releasing reads as intent, and it is the
    // visual the timing ring is paired with.
    const wind = props.telegraphing ? 1 - Math.pow(1 - props.telegraphProgress, 2) : 0;
    body.position.y = idle - wind * 0.1;
    body.scale.setScalar(1 + wind * 0.16);
    body.rotation.z = props.rooted ? 0 : Math.sin(timeRef.current * 3) * 0.02;

    // Cleansing: violet drains to green.
    const green = props.cleansing ? 1 : 0;
    mats.crystal.color.lerpColors(
      new THREE.Color(CRYSTAL),
      new THREE.Color(PALETTE.restore),
      green,
    );
    mats.core.color.lerpColors(new THREE.Color(CORE), new THREE.Color(PALETTE.restore), green);

    // Silenced creatures visibly dim — the field has taken their voice.
    mats.core.opacity = props.silenced ? 0.35 : 1;
    mats.core.transparent = props.silenced;
  });

  const cast = props.castShadow !== false;
  const r = props.bodyRadius;
  const h = props.bodyHeight;

  return (
    <group ref={groupRef} name={`detuner-${props.role}`}>
      <group ref={bodyRef} position={[0, h * 0.5, 0]}>
        {props.role === 'scout' && <Whisperer r={r} h={h} mats={mats} cast={cast} />}
        {props.role === 'flyer' && <Drifter r={r} h={h} mats={mats} cast={cast} />}
        {(props.role === 'shield' || props.role === 'pursuer') && (
          <Fracture r={r} h={h} mats={mats} cast={cast} />
        )}
        {props.role === 'turret' && <AmplifierPylon r={r} h={h} mats={mats} cast={cast} />}
        {(props.role === 'elite' || props.role === 'spawner') && (
          <Conductor r={r} h={h} mats={mats} cast={cast} />
        )}
        {(props.role === 'hazard' || props.role === 'mimic') && (
          <DriftingShard r={r} h={h} mats={mats} cast={cast} />
        )}
      </group>

      {/* Rooted creatures show the growth holding them. */}
      {props.rooted && (
        <mesh material={mats.crystal} position={[0, 0.06, 0]}>
          <torusGeometry args={[r * 1.2, r * 0.14, 5, 10]} />
        </mesh>
      )}
    </group>
  );
}

type Mats = ReturnType<typeof useDetunerMaterials>;
interface PartProps {
  r: number;
  h: number;
  mats: Mats;
  cast: boolean;
}

/** Whisperer — a fist-sized shard body on folded legs, one violet eye. */
function Whisperer({ r, h, mats, cast }: PartProps): ReactElement {
  return (
    <group>
      <mesh castShadow={cast} material={mats.shell} rotation={[0.3, 0.4, 0]}>
        <octahedronGeometry args={[r * 1.05, 0]} />
      </mesh>
      <mesh material={mats.eye} position={[0, 0, r * 0.9]}>
        <sphereGeometry args={[r * 0.3, 7, 6]} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            material={mats.shellDeep}
            position={[sx * r * 0.7, -h * 0.34, sz * r * 0.55]}
            rotation={[0, 0, sx * 0.5]}
          >
            <boxGeometry args={[r * 0.16, h * 0.5, r * 0.16]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Drifter — dart-shaped, bladed fins, hovers. */
function Drifter({ r, mats, cast }: PartProps): ReactElement {
  return (
    <group>
      <mesh castShadow={cast} material={mats.shell} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[r * 0.7, r * 2.4, 5]} />
      </mesh>
      <mesh material={mats.eye} position={[0, 0, r * 0.4]}>
        <sphereGeometry args={[r * 0.26, 7, 6]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          material={mats.crystal}
          position={[s * r * 0.9, 0, -r * 0.5]}
          rotation={[0, 0, s * 0.5]}
        >
          <boxGeometry args={[r * 1.3, r * 0.07, r * 0.5]} />
        </mesh>
      ))}
    </group>
  );
}

/** Fracture — a heavy plated brute with an exposed core. */
function Fracture({ r, h, mats, cast }: PartProps): ReactElement {
  return (
    <group>
      <mesh castShadow={cast} material={mats.shell}>
        <boxGeometry args={[r * 1.9, h * 0.62, r * 1.6]} />
      </mesh>
      {/* The core is the weak point, and it is visible for that reason. */}
      <mesh material={mats.core} position={[0, 0, r * 0.85]}>
        <sphereGeometry args={[r * 0.4, 8, 7]} />
      </mesh>
      {/* Frontal plating — the reason a pulse will not do. */}
      <mesh castShadow={cast} material={mats.shellDeep} position={[0, 0, r * 0.95]}>
        <boxGeometry args={[r * 1.7, h * 0.44, r * 0.22]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          castShadow={cast}
          material={mats.crystal}
          position={[s * r * 1.0, h * 0.3, 0]}
          rotation={[0, 0, s * 0.4]}
        >
          <octahedronGeometry args={[r * 0.42, 0]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={`leg${s}`}
          material={mats.shellDeep}
          position={[s * r * 0.7, -h * 0.42, 0]}
        >
          <boxGeometry args={[r * 0.42, h * 0.28, r * 0.5]} />
        </mesh>
      ))}
    </group>
  );
}

/** Amplifier pylon — squat, with a rotating emitter. */
function AmplifierPylon({ r, h, mats, cast }: PartProps): ReactElement {
  const emitter = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (emitter.current) emitter.current.rotation.y += delta * 1.4;
  });
  return (
    <group>
      <mesh castShadow={cast} material={mats.shellDeep} position={[0, -h * 0.28, 0]}>
        <cylinderGeometry args={[r * 1.2, r * 1.5, h * 0.4, 6]} />
      </mesh>
      <mesh castShadow={cast} material={mats.shell} position={[0, h * 0.05, 0]}>
        <cylinderGeometry args={[r * 0.8, r * 1.0, h * 0.5, 6]} />
      </mesh>
      <group ref={emitter} position={[0, h * 0.36, 0]}>
        <mesh material={mats.crystal}>
          <octahedronGeometry args={[r * 0.62, 0]} />
        </mesh>
        <mesh material={mats.core}>
          <sphereGeometry args={[r * 0.3, 8, 7]} />
        </mesh>
      </group>
    </group>
  );
}

/** Conductor — robed, with a crystal-topped stave. The only Detuner that leads. */
function Conductor({ r, h, mats, cast }: PartProps): ReactElement {
  return (
    <group>
      <mesh castShadow={cast} material={mats.shellDeep} position={[0, -h * 0.1, 0]}>
        <coneGeometry args={[r * 1.3, h * 0.8, 7]} />
      </mesh>
      <mesh castShadow={cast} material={mats.shell} position={[0, h * 0.38, 0]}>
        <octahedronGeometry args={[r * 0.55, 0]} />
      </mesh>
      <mesh material={mats.eye} position={[0, h * 0.38, r * 0.5]}>
        <sphereGeometry args={[r * 0.2, 7, 6]} />
      </mesh>
      {/* Stave */}
      <group position={[r * 1.05, h * 0.1, 0]} rotation={[0, 0, -0.12]}>
        <mesh material={mats.shellDeep}>
          <cylinderGeometry args={[r * 0.07, r * 0.07, h * 1.15, 5]} />
        </mesh>
        <mesh material={mats.crystal} position={[0, h * 0.62, 0]}>
          <octahedronGeometry args={[r * 0.36, 0]} />
        </mesh>
        <mesh material={mats.core} position={[0, h * 0.62, 0]}>
          <sphereGeometry args={[r * 0.16, 7, 6]} />
        </mesh>
      </group>
    </group>
  );
}

/** Drifting shard — hazard and mimic bodies; a slowly turning fragment. */
function DriftingShard({ r, mats, cast }: PartProps): ReactElement {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (spin.current) {
      spin.current.rotation.x += delta * 0.8;
      spin.current.rotation.y += delta * 1.1;
    }
  });
  return (
    <group ref={spin}>
      <mesh castShadow={cast} material={mats.shell}>
        <octahedronGeometry args={[r * 1.15, 0]} />
      </mesh>
      <mesh material={mats.core}>
        <sphereGeometry args={[r * 0.45, 8, 7]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

export interface BossModelProps {
  readonly definitionId: string;
  readonly position: THREE.Vector3Like;
  readonly yaw: number;
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  readonly phaseIndex: number;
  readonly healthFraction: number;
  readonly telegraphing: boolean;
  readonly telegraphProgress: number;
  readonly vulnerable: boolean;
  readonly restoring: boolean;
  readonly restorationProgress: number;
}

export function BossModel(props: BossModelProps): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const mats = useDetunerMaterials();

  const stone = useMemo(
    () => new THREE.MeshLambertMaterial({ color: new THREE.Color('#8d7a5f') }),
    [],
  );
  const root = useMemo(
    () => new THREE.MeshLambertMaterial({ color: new THREE.Color('#5c7a4a') }),
    [],
  );

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);
    timeRef.current += step;

    const group = groupRef.current;
    if (group) {
      group.position.set(props.position.x, props.position.y, props.position.z);
      group.rotation.y = props.yaw;
    }

    const body = bodyRef.current;
    if (body) {
      const wind = props.telegraphing ? 1 - Math.pow(1 - props.telegraphProgress, 2) : 0;
      body.scale.setScalar(1 + wind * 0.09 + props.phaseIndex * 0.03);
      body.position.y = Math.sin(timeRef.current * 1.1) * 0.06 - wind * 0.16;
    }

    // Restoration walks the violet back out of the stone. Oru was a protector
    // before the Amplifier was fused into it, and the fight ends by giving that
    // back rather than by breaking it.
    const restored = props.restoring ? props.restorationProgress : 0;
    mats.crystal.color.lerpColors(
      new THREE.Color(CRYSTAL),
      new THREE.Color(PALETTE.restore),
      restored,
    );
    mats.core.color.lerpColors(new THREE.Color(CORE), new THREE.Color(PALETTE.gold), restored);

    // A vulnerable boss glows: the punish window must be unmistakable.
    mats.core.opacity = props.vulnerable ? 1 : 0.75;
    mats.core.transparent = true;
  });

  const r = props.bodyRadius;
  const h = props.bodyHeight;
  const isFlower = props.definitionId.includes('bloom');
  const isColossus = props.definitionId.includes('colossus') || props.definitionId.includes('oru');

  return (
    <group ref={groupRef} name={`boss-${props.definitionId}`}>
      <group ref={bodyRef} position={[0, h * 0.5, 0]}>
        {isFlower ? (
          <VirusBloom r={r} h={h} mats={mats} root={root} />
        ) : isColossus ? (
          <FracturedColossus r={r} h={h} mats={mats} stone={stone} root={root} />
        ) : (
          <GenericCommander r={r} h={h} mats={mats} stone={stone} />
        )}
      </group>
    </group>
  );
}

/** The Virus Bloom — a giant alien flower structure. */
function VirusBloom({
  r,
  h,
  mats,
  root,
}: {
  r: number;
  h: number;
  mats: Mats;
  root: THREE.Material;
}): ReactElement {
  const petals = 7;
  return (
    <group>
      <mesh castShadow material={root} position={[0, -h * 0.3, 0]}>
        <cylinderGeometry args={[r * 0.35, r * 0.6, h * 0.6, 6]} />
      </mesh>
      <mesh castShadow material={mats.shell} position={[0, h * 0.14, 0]}>
        <sphereGeometry args={[r * 0.62, 9, 7]} />
      </mesh>
      <mesh material={mats.core} position={[0, h * 0.14, 0]}>
        <sphereGeometry args={[r * 0.4, 9, 7]} />
      </mesh>
      {Array.from({ length: petals }, (_, i) => {
        const angle = (i / petals) * Math.PI * 2;
        return (
          <mesh
            key={i}
            castShadow
            material={mats.crystal}
            position={[Math.cos(angle) * r * 0.85, h * 0.2, Math.sin(angle) * r * 0.85]}
            rotation={[0.7, -angle, 0]}
          >
            <coneGeometry args={[r * 0.34, r * 1.5, 4]} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Oru, the Fractured Colossus.
 *
 * The fusion has to be visible: warm stone and root forms strangled by violet
 * crystal. The player should want to free it, not kill it, and that has to read
 * before any dialogue says so.
 */
function FracturedColossus({
  r,
  h,
  mats,
  stone,
  root,
}: {
  r: number;
  h: number;
  mats: Mats;
  stone: THREE.Material;
  root: THREE.Material;
}): ReactElement {
  return (
    <group>
      {/* The protector underneath. */}
      <mesh castShadow material={stone}>
        <boxGeometry args={[r * 1.7, h * 0.55, r * 1.3]} />
      </mesh>
      <mesh castShadow material={stone} position={[0, h * 0.42, r * 0.1]}>
        <boxGeometry args={[r * 0.95, h * 0.3, r * 0.9]} />
      </mesh>
      <mesh material={root} position={[0, h * 0.05, r * 0.68]}>
        <boxGeometry args={[r * 1.2, h * 0.12, r * 0.14]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`arm${s}`} castShadow material={stone} position={[s * r * 1.15, -h * 0.05, 0]}>
          <boxGeometry args={[r * 0.55, h * 0.62, r * 0.6]} />
        </mesh>
      ))}

      {/* The Amplifier that was driven into it. */}
      <mesh castShadow material={mats.crystal} position={[0, h * 0.3, -r * 0.5]} rotation={[0.4, 0.3, 0]}>
        <octahedronGeometry args={[r * 0.85, 0]} />
      </mesh>
      <mesh material={mats.core} position={[0, h * 0.3, -r * 0.5]}>
        <sphereGeometry args={[r * 0.42, 9, 8]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={`spike${s}`}
          castShadow
          material={mats.crystal}
          position={[s * r * 0.75, h * 0.4, -r * 0.1]}
          rotation={[0, 0, s * 0.7]}
        >
          <coneGeometry args={[r * 0.2, r * 1.1, 4]} />
        </mesh>
      ))}
      {/* Violet running through the stone like a crack. */}
      <mesh material={mats.core} position={[0, 0, r * 0.66]}>
        <boxGeometry args={[r * 0.1, h * 0.5, r * 0.04]} />
      </mesh>
    </group>
  );
}

/** A readable stand-in for the Commanders whose bespoke models are not built. */
function GenericCommander({
  r,
  h,
  mats,
  stone,
}: {
  r: number;
  h: number;
  mats: Mats;
  stone: THREE.Material;
}): ReactElement {
  return (
    <group>
      <mesh castShadow material={stone}>
        <cylinderGeometry args={[r * 0.8, r * 1.25, h * 0.7, 7]} />
      </mesh>
      <mesh castShadow material={mats.crystal} position={[0, h * 0.48, 0]} rotation={[0.3, 0, 0.2]}>
        <octahedronGeometry args={[r * 0.72, 0]} />
      </mesh>
      <mesh material={mats.core} position={[0, h * 0.48, 0]}>
        <sphereGeometry args={[r * 0.36, 9, 8]} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh
            key={i}
            castShadow
            material={mats.crystal}
            position={[Math.cos(angle) * r * 0.95, h * 0.1, Math.sin(angle) * r * 0.95]}
            rotation={[0, -angle, 0.35]}
          >
            <coneGeometry args={[r * 0.2, h * 0.5, 4]} />
          </mesh>
        );
      })}
    </group>
  );
}
