import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { GraphicsTier } from '@tuner/shared';
import { PALETTE, clamp01, lerp } from '@tuner/shared';
import type { StageDef, WorldState } from '@tuner/game-core';
import {
  createResolvedAmbience,
  createSkyDome,
  resolveAmbience,
  restorationFromInfection,
  sunPositionInto,
} from './sky.js';
import type { ResolvedAmbience, SkyDome } from './sky.js';
import { surfaceMaterials } from './materials.js';
import type { MaterialRegistry } from './materials.js';

/**
 * The lighting rig and the atmosphere it shares with the sky.
 *
 * Controlled lighting is a load-bearing part of the art direction: a single
 * key, a hemisphere bounce, and one soft resonance fill. No area lights, no
 * light probes, no per-object rim lights — the silhouette work is done by the
 * geometry and by the in-shader edge in `materials.ts`, and the lighting's job
 * is only to keep the palette legible and the shadows readable.
 *
 * Every colour here is lerped between the stage's infected and restored
 * ambience, so restoring a region relights it as well as repainting it.
 */

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export interface LightingQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Half-width of the orthographic shadow volume, in metres. */
  readonly shadowRadius: number;
  /** Distance over which the fill light reaches. */
  readonly fillDistance: number;
}

export function lightingQualityForTier(tier: GraphicsTier): LightingQuality {
  switch (tier) {
    case 'low':
      // Shadow maps are the single most expensive thing a phone GPU does here,
      // and the flat-colour look survives without them.
      return { shadows: false, shadowMapSize: 512, shadowRadius: 24, fillDistance: 12 };
    case 'medium':
      return { shadows: true, shadowMapSize: 1024, shadowRadius: 34, fillDistance: 16 };
    case 'high':
      return { shadows: true, shadowMapSize: 2048, shadowRadius: 46, fillDistance: 22 };
  }
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

interface LightingRig {
  readonly group: THREE.Group;
  readonly key: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fill: THREE.PointLight;
  dispose(): void;
}

function createLightingRig(tier: GraphicsTier, quality: LightingQuality): LightingRig {
  const group = new THREE.Group();
  group.name = 'tuner-lighting';

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.gold), 2.1);
  key.name = 'tuner-key-light';
  key.castShadow = quality.shadows;
  key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -quality.shadowRadius;
  shadowCamera.right = quality.shadowRadius;
  shadowCamera.top = quality.shadowRadius;
  shadowCamera.bottom = -quality.shadowRadius;
  shadowCamera.near = 1;
  shadowCamera.far = quality.shadowRadius * 5;
  shadowCamera.updateProjectionMatrix();
  // Flat-shaded low-poly geometry is unusually prone to shadow acne on its
  // near-tangent faces; a normal bias fixes it without the peter-panning a
  // large depth bias would cause under the player's feet.
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.05;
  group.add(key);
  group.add(key.target);

  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.abyss),
    new THREE.Color(PALETTE.infectionDeep),
    tier === 'low' ? 1.5 : 1.1,
  );
  hemisphere.name = 'tuner-hemisphere';
  group.add(hemisphere);

  const ambient = new THREE.AmbientLight(new THREE.Color(PALETTE.panel), 0.35);
  ambient.name = 'tuner-ambient';
  group.add(ambient);

  // The resonance fill: a soft close light that travels with the player so the
  // character and the ground beneath them stay readable inside deep interiors.
  // It carries the region's tuning — violet while detuned, cyan once restored.
  const fill = new THREE.PointLight(new THREE.Color(PALETTE.infection), 1.2, quality.fillDistance, 2);
  fill.name = 'tuner-resonance-fill';
  fill.castShadow = false;
  group.add(fill);

  return {
    group,
    key,
    hemisphere,
    ambient,
    fill,
    dispose(): void {
      key.dispose();
      hemisphere.dispose();
      ambient.dispose();
      fill.dispose();
      group.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export interface StageAtmosphereProps {
  readonly stage: StageDef;
  readonly world: WorldState;
  readonly tier?: GraphicsTier;
  /** Overrides the tier defaults, for a user-facing quality menu. */
  readonly quality?: LightingQuality;
  /** Registry to retune. Defaults to the shared one the geometry uses. */
  readonly materials?: MaterialRegistry;
  /** Suppresses the constellation drift and the fill's pulse. */
  readonly reducedMotion?: boolean;
}

const scratchSunPosition = new THREE.Vector3();
const scratchFill = new THREE.Color();
/** Read-only reference colour; the render loop must never allocate. */
const RESONANCE_COLOUR = new THREE.Color(PALETTE.resonance);

/**
 * The key/hemisphere/fill rig, relit every frame from the region's infection.
 *
 * Pure presentation: it reads `WorldState` and never writes to it.
 */
export function StageLighting(props: StageAtmosphereProps): ReactElement {
  const tier: GraphicsTier = props.tier ?? 'high';
  const quality = props.quality ?? lightingQualityForTier(tier);

  const rig = useMemo(() => createLightingRig(tier, quality), [tier, quality]);
  const resolved = useMemo<ResolvedAmbience>(() => createResolvedAmbience(), []);

  const latest = useRef(props);
  latest.current = props;

  useEffect(() => () => rig.dispose(), [rig]);

  useFrame(() => {
    const { stage, world } = latest.current;
    const restoration = restorationFromInfection(world.stage.infection);
    resolveAmbience(stage.ambience, restoration, resolved);

    const player = world.player.position;

    // Key light. Tracking the player keeps the orthographic shadow volume tight
    // enough that a 1k map still resolves a hand-rail at the far end of a hall.
    sunPositionInto(scratchSunPosition, stage.ambience.sunDirection, quality.shadowRadius * 2);
    rig.key.position.set(
      player.x + scratchSunPosition.x,
      player.y + scratchSunPosition.y,
      player.z + scratchSunPosition.z,
    );
    rig.key.target.position.set(player.x, player.y, player.z);
    rig.key.target.updateMatrixWorld();
    rig.key.color.copy(resolved.sunColour);
    rig.key.intensity = lerp(1.6, 2.4, restoration);

    // Hemisphere: sky above, the region's own bounce below.
    rig.hemisphere.color.copy(resolved.skyTop);
    rig.hemisphere.groundColor.copy(resolved.ambientColour);
    rig.hemisphere.intensity = lerp(1.35, 0.95, restoration);

    rig.ambient.color.copy(resolved.fogColour);
    rig.ambient.intensity = lerp(0.42, 0.28, restoration);

    // Resonance fill, riding just above the player's head.
    scratchFill.copy(resolved.ambientColour).lerp(RESONANCE_COLOUR, restoration * 0.85);
    rig.fill.color.copy(scratchFill);
    rig.fill.position.set(player.x, player.y + 2.2, player.z);
    const pulse = latest.current.reducedMotion
      ? 1
      : 1 + 0.08 * Math.sin(world.elapsedSeconds * 2.2);
    rig.fill.intensity = lerp(1.4, 1.05, restoration) * pulse;
  });

  return <primitive object={rig.group} />;
}

/**
 * The procedural gradient sky, its constellations fading up with restoration.
 */
export function StageSky(props: StageAtmosphereProps): ReactElement {
  const tier: GraphicsTier = props.tier ?? 'high';
  const reducedMotion = props.reducedMotion ?? false;

  const sky = useMemo<SkyDome>(
    () => createSkyDome({ tier, spin: reducedMotion ? 0 : 0.006 }),
    [tier, reducedMotion],
  );

  const latest = useRef(props);
  latest.current = props;

  useEffect(() => () => sky.dispose(), [sky]);

  useFrame((state) => {
    const { stage, world } = latest.current;
    sky.followCamera(state.camera);
    sky.setAmbience(stage.ambience, restorationFromInfection(world.stage.infection));
    sky.setTime(world.elapsedSeconds);
  });

  return <primitive object={sky.mesh} />;
}

/**
 * Sky, lights, fog and the surface retune in one component.
 *
 * This is the single place the region's infection reaches the shared material
 * registry, which is what makes a restoration land on every surface, the sky,
 * the fog and the lights inside the same frame.
 */
export function StageAtmosphere(props: StageAtmosphereProps): ReactElement {
  const scene = useThree((state) => state.scene);
  const materials = props.materials ?? surfaceMaterials;

  const resolved = useMemo<ResolvedAmbience>(() => createResolvedAmbience(), []);
  const latest = useRef(props);
  latest.current = props;

  // Fog is scene state, not an object in the tree, so it is installed and
  // restored explicitly rather than mounted.
  useEffect(() => {
    const previous = scene.fog;
    const fog = new THREE.Fog(new THREE.Color(PALETTE.panel), 30, 200);
    scene.fog = fog;
    return () => {
      scene.fog = previous;
    };
  }, [scene]);

  useFrame(() => {
    const { stage, world } = latest.current;
    const infection = clamp01(world.stage.infection);
    const restoration = restorationFromInfection(infection);

    materials.setInfection(infection);
    materials.setRestoration(restoration);
    materials.setTime(world.elapsedSeconds);

    const fog = scene.fog;
    if (fog instanceof THREE.Fog) {
      resolveAmbience(stage.ambience, restoration, resolved);
      fog.color.copy(resolved.fogColour);
      fog.near = resolved.fogNear;
      fog.far = resolved.fogFar;
    }
  });

  return (
    <>
      <StageSky {...props} />
      <StageLighting {...props} />
    </>
  );
}
