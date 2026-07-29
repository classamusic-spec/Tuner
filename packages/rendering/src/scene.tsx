import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE, type GraphicsTier } from '@tuner/shared';
import type { AccessibilityConfig, StageDef, WorldState } from '@tuner/game-core';
import { formTuningFor } from '@tuner/game-core';
import { StageGeometry } from './stage-geometry.js';
import { StageAtmosphere } from './lighting.js';
import { TunerCharacter } from './character/tuner.js';
import { BossModel, DetunerCreature } from './creatures/detuners.js';

/**
 * The scene.
 *
 * Pure presentation. It receives the read-only `WorldState` and paints it; it
 * never advances the simulation and never writes back.
 *
 * The performance rule that matters more than any effect in here: **simulation
 * state never becomes React state.** The world arrives through a ref that the
 * host updates, and everything that changes per frame is driven inside
 * `useFrame` by mutating Three.js objects directly. A game that re-renders React
 * sixty times a second spends its frame budget on reconciliation.
 */

export interface TunerSceneProps {
  /** Live world. Read through a ref internally; changing it does not re-render. */
  readonly world: WorldState;
  readonly stage: StageDef;
  readonly tier?: GraphicsTier;
  readonly accessibility?: Partial<AccessibilityConfig>;
  /** Maximum simultaneous instanced projectiles. */
  readonly maxProjectiles?: number;
}

const DEFAULT_MAX_PROJECTILES = 64;
const MAX_PICKUPS = 48;
const MAX_TELEGRAPHS = 24;

export function TunerScene(props: TunerSceneProps): ReactElement {
  const worldRef = useRef(props.world);
  worldRef.current = props.world;

  const tier: GraphicsTier = props.tier ?? 'high';
  const reducedMotion = props.accessibility?.reducedMotion === true;
  const showTelegraphs = props.accessibility?.visualAttackTiming !== false;
  const world = props.world;

  const accent = formTuningFor(world.player.form).colour;

  return (
    <>
      <StageAtmosphere
        stage={props.stage}
        world={world}
        tier={tier}
        reducedMotion={reducedMotion}
      />
      <StageGeometry stage={props.stage} world={world} tier={tier} />

      <TunerCharacter
        position={world.player.position}
        yaw={world.player.yaw}
        velocity={world.player.velocity}
        movementState={world.player.movementState}
        grounded={world.player.grounded}
        form={world.player.form}
        chargeTier={world.player.charge.tier}
        charging={world.player.charge.isCharging}
        firing={world.player.charge.isCharging}
        countering={world.player.counter.active}
        hurt={world.player.invulnerableRemaining > 0}
        accent={accent}
        castShadow={tier !== 'low'}
      />

      {world.enemies.map((enemy) => (
        <DetunerCreature
          key={enemy.id}
          position={enemy.position}
          yaw={enemy.yaw}
          role={enemy.role}
          bodyRadius={0.45}
          bodyHeight={1.3}
          telegraphing={enemy.telegraphing}
          telegraphProgress={enemy.telegraphProgress}
          healthFraction={enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 0}
          cleansing={enemy.phase === 'cleansing'}
          rooted={enemy.rootedRemaining > 0}
          silenced={enemy.silencedRemaining > 0}
          castShadow={tier !== 'low'}
        />
      ))}

      {world.boss && !world.boss.defeated && (
        <BossModel
          definitionId={world.boss.definitionId}
          position={world.boss.position}
          yaw={world.boss.yaw}
          bodyRadius={2.2}
          bodyHeight={4.4}
          phaseIndex={world.boss.phase.index}
          healthFraction={world.boss.maxHealth > 0 ? world.boss.health / world.boss.maxHealth : 0}
          telegraphing={world.boss.telegraphing}
          telegraphProgress={world.boss.telegraphProgress}
          vulnerable={world.boss.vulnerable}
          restoring={world.boss.restoring}
          restorationProgress={world.boss.restorationProgress}
        />
      )}

      <Projectiles worldRef={worldRef} max={props.maxProjectiles ?? DEFAULT_MAX_PROJECTILES} />
      <Pickups worldRef={worldRef} reducedMotion={reducedMotion} />
      <ConjuredPlatforms worldRef={worldRef} />
      {showTelegraphs && <TelegraphRings worldRef={worldRef} />}
    </>
  );
}

type WorldRef = { current: WorldState };

/**
 * Every live shot in one instanced draw call.
 *
 * Projectiles are the highest-churn object in the game; drawing them
 * individually would spend the frame budget on draw calls during exactly the
 * moments the game most needs to stay smooth.
 */
function Projectiles({ worldRef, max }: { worldRef: WorldRef; max: number }): ReactElement {
  const playerRef = useRef<THREE.InstancedMesh>(null);
  const enemyRef = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);

  const playerMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.resonance) }),
    [],
  );
  const enemyMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.infection) }),
    [],
  );

  useFrame(() => {
    const world = worldRef.current;
    let playerCount = 0;
    let enemyCount = 0;

    for (const shot of world.projectiles) {
      const target = shot.owner === 'player' ? playerRef.current : enemyRef.current;
      if (!target) continue;
      const index = shot.owner === 'player' ? playerCount : enemyCount;
      if (index >= max) continue;

      position.set(shot.position.x, shot.position.y, shot.position.z);
      const radius = Math.max(0.08, shot.radius);
      scale.set(radius, radius, radius);
      matrix.compose(position, quaternion, scale);
      target.setMatrixAt(index, matrix);

      if (shot.owner === 'player') playerCount++;
      else enemyCount++;
    }

    if (playerRef.current) {
      playerRef.current.count = playerCount;
      playerRef.current.instanceMatrix.needsUpdate = true;
    }
    if (enemyRef.current) {
      enemyRef.current.count = enemyCount;
      enemyRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={playerRef} args={[undefined, undefined, max]} material={playerMat} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
      <instancedMesh ref={enemyRef} args={[undefined, undefined, max]} material={enemyMat} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
      </instancedMesh>
    </>
  );
}

/** Collectibles, instanced, bobbing on a shared clock. */
function Pickups({
  worldRef,
  reducedMotion,
}: {
  worldRef: WorldRef;
  reducedMotion: boolean;
}): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(0.24, 0.24, 0.24), []);
  const euler = useMemo(() => new THREE.Euler(), []);
  const time = useRef(0);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.gold) }),
    [],
  );

  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.1);
    const mesh = meshRef.current;
    if (!mesh) return;
    const world = worldRef.current;

    let count = 0;
    for (const pickup of world.pickups) {
      if (pickup.collected || count >= MAX_PICKUPS) continue;
      const bob = reducedMotion ? 0 : Math.sin(time.current * 2.2 + count) * 0.12;
      position.set(pickup.position.x, pickup.position.y + bob, pickup.position.z);
      euler.set(0, reducedMotion ? 0 : time.current * 1.4, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(count, matrix);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PICKUPS]} material={material} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
    </instancedMesh>
  );
}

/** Echo, Bloom and Tidal platforms, fading as their life runs out. */
function ConjuredPlatforms({ worldRef }: { worldRef: WorldRef }): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const pool = useRef<THREE.Mesh[]>([]);

  const geometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 0.16, 12), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.restore),
        transparent: true,
        opacity: 0.6,
      }),
    [],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const world = worldRef.current;

    // Grow the pool on demand and hide the rest, rather than adding and removing
    // children every time a platform appears.
    while (pool.current.length < world.conjured.length) {
      const mesh = new THREE.Mesh(geometry, material.clone());
      group.add(mesh);
      pool.current.push(mesh);
    }

    for (let i = 0; i < pool.current.length; i++) {
      const mesh = pool.current[i];
      const platform = world.conjured[i];
      if (!mesh) continue;
      if (!platform) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(platform.position.x, platform.position.y, platform.position.z);
      mesh.scale.set(platform.radius, 1, platform.radius);
      const life = platform.maxLife > 0 ? platform.lifeRemaining / platform.maxLife : 1;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      // Fade out near the end so the player is warned before it goes.
      mat.opacity = 0.25 + Math.min(1, life * 2) * 0.45;
    }
  });

  return <group ref={groupRef} />;
}

/**
 * Ground-projected attack timing rings.
 *
 * This is the layer that makes the game playable with the sound off, so it is
 * treated as gameplay rather than decoration. The ring's *fill* carries the
 * timing — not its hue — so it survives any colour-vision difference.
 */
function TelegraphRings({ worldRef }: { worldRef: WorldRef }): ReactElement {
  const groupRef = useRef<THREE.Group>(null);
  const pool = useRef<THREE.Mesh[]>([]);
  const geometry = useMemo(() => new THREE.RingGeometry(0.86, 1, 24), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const world = worldRef.current;

    const sources: { x: number; y: number; z: number; progress: number; radius: number }[] = [];
    for (const enemy of world.enemies) {
      if (!enemy.telegraphing || sources.length >= MAX_TELEGRAPHS) continue;
      sources.push({
        x: enemy.position.x,
        y: enemy.position.y + 0.05,
        z: enemy.position.z,
        progress: enemy.telegraphProgress,
        radius: 1.6,
      });
    }
    const boss = world.boss;
    if (boss && boss.telegraphing && sources.length < MAX_TELEGRAPHS) {
      sources.push({
        x: boss.position.x,
        y: boss.position.y + 0.05,
        z: boss.position.z,
        progress: boss.telegraphProgress,
        radius: 4.2,
      });
    }

    while (pool.current.length < sources.length) {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(PALETTE.alarm),
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      pool.current.push(mesh);
    }

    for (let i = 0; i < pool.current.length; i++) {
      const mesh = pool.current[i];
      const source = sources[i];
      if (!mesh) continue;
      if (!source) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(source.x, source.y, source.z);
      // The ring closes as the wind-up completes: full circle means "now".
      const t = Math.max(0, Math.min(1, source.progress));
      mesh.scale.setScalar(source.radius * (1.5 - t * 0.5));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + t * 0.55;
    }
  });

  return <group ref={groupRef} />;
}
