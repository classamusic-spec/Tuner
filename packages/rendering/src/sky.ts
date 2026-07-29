import * as THREE from 'three';
import type { GraphicsTier, Vec3 } from '@tuner/shared';
import { PALETTE, clamp01 } from '@tuner/shared';
import type { StageDef } from '@tuner/game-core';

/**
 * The sky, and the ambience maths the lighting rig shares with it.
 *
 * There is no skybox texture anywhere in TUNER. The sky is two flat colour
 * stops with one crisp horizon edge — a poster, not a photograph — plus a set
 * of sacred-geometry constellation rings that are invisible while a region is
 * detuned and fade up as it is restored. That fade is the game's largest,
 * cheapest reward: the player looks up after a commander falls and the sky has
 * remembered its geometry.
 *
 * The whole thing is one 24x16 sphere and roughly forty fragment instructions.
 */

/** The ambience block stages author. Re-exported so callers need not dig. */
export type StageAmbience = StageDef['ambience'];

/**
 * Infection at or below which a region counts as restored.
 *
 * Not zero: the last few percent drain out over the closing retuning sequence,
 * and the world should look healed before the number finishes falling.
 */
export const RESTORED_INFECTION = 0.06;

/** The restoration level the sky, lighting and surfaces all read. */
export function restorationFromInfection(infection: number): number {
  return clamp01(1 - clamp01(infection));
}

export function isRegionRestored(infection: number): boolean {
  return infection <= RESTORED_INFECTION;
}

// ---------------------------------------------------------------------------
// Colour resolution
// ---------------------------------------------------------------------------

/**
 * Parsed ambience colours, kept alive so a per-frame ambience update does not
 * allocate. Stage ambience uses a handful of palette hexes, so this stays tiny.
 */
const colourCache = new Map<string, THREE.Color>();

/** Parses a hex string once and shares the result. Never mutate the return. */
export function cachedColour(hex: string): THREE.Color {
  const existing = colourCache.get(hex);
  if (existing) return existing;
  const created = new THREE.Color(hex);
  colourCache.set(hex, created);
  return created;
}

/** The ambience actually in force this frame, after the restoration blend. */
export interface ResolvedAmbience {
  readonly skyTop: THREE.Color;
  readonly skyBottom: THREE.Color;
  readonly fogColour: THREE.Color;
  readonly sunColour: THREE.Color;
  readonly ambientColour: THREE.Color;
  fogNear: number;
  fogFar: number;
}

export function createResolvedAmbience(): ResolvedAmbience {
  return {
    skyTop: new THREE.Color(PALETTE.abyss),
    skyBottom: new THREE.Color(PALETTE.panel),
    fogColour: new THREE.Color(PALETTE.panel),
    sunColour: new THREE.Color(PALETTE.gold),
    ambientColour: new THREE.Color(PALETTE.infection),
    fogNear: 30,
    fogFar: 200,
  };
}

/**
 * Blends the authored infected palette toward the authored restored palette.
 *
 * Stages may omit `ambience.restored`, in which case the region simply keeps
 * its colours and only the surfaces and the constellations change; the blend
 * still runs so callers never need a branch.
 */
export function resolveAmbience(
  ambience: StageAmbience,
  restoration: number,
  target: ResolvedAmbience,
): ResolvedAmbience {
  const t = clamp01(restoration);
  const restored = ambience.restored;

  target.skyTop.copy(cachedColour(ambience.skyTop));
  target.skyBottom.copy(cachedColour(ambience.skyBottom));
  target.fogColour.copy(cachedColour(ambience.fogColour));
  target.sunColour.copy(cachedColour(ambience.sunColour));
  target.ambientColour.copy(cachedColour(ambience.ambientColour));

  if (restored && t > 0) {
    target.skyTop.lerp(cachedColour(restored.skyTop), t);
    target.skyBottom.lerp(cachedColour(restored.skyBottom), t);
    target.fogColour.lerp(cachedColour(restored.fogColour), t);
    target.sunColour.lerp(cachedColour(restored.sunColour), t);
    target.ambientColour.lerp(cachedColour(restored.ambientColour), t);
  }

  // Restored air is clearer: the fog pulls back as the region comes home.
  target.fogNear = ambience.fogNear * (1 + 0.35 * t);
  target.fogFar = ambience.fogFar * (1 + 0.45 * t);
  return target;
}

/**
 * Converts an authored sun *direction* (the way the light travels) into the
 * position a directional light must sit at to cast it, `distance` metres from
 * the point it is lighting.
 */
export function sunPositionInto(
  target: THREE.Vector3,
  sunDirection: Readonly<Vec3>,
  distance: number,
): THREE.Vector3 {
  target.set(sunDirection.x, sunDirection.y, sunDirection.z);
  if (target.lengthSq() < 1e-8) {
    target.set(0, -1, 0);
  }
  return target.normalize().multiplyScalar(-distance);
}

// ---------------------------------------------------------------------------
// Sky shader
// ---------------------------------------------------------------------------

const SKY_VERTEX = /* glsl */ `
varying vec3 vTunerDir;

void main() {
  vTunerDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHorizon;
uniform vec3 uRing;
uniform float uRestoration;
uniform float uTime;
uniform float uSpin;
varying vec3 vTunerDir;

void main() {
  vec3 dir = normalize( vTunerDir );
  float h = clamp( dir.y * 0.5 + 0.5, 0.0, 1.0 );

  // Two stops and one crisp edge. No banding gradients, no noise, no clouds.
  float band = smoothstep( 0.36, 0.70, h );
  vec3 col = mix( uBottom, uTop, band );
  float horizonLine = 1.0 - smoothstep( 0.0, 0.030, abs( h - 0.50 ) );
  col = mix( col, uHorizon, horizonLine * 0.40 );

  #ifndef TUNER_SKY_SIMPLE
    // Sacred geometry, drawn on a gnomonic projection around the zenith: three
    // concentric rings and six spokes. Absent while the region is detuned.
    float up = smoothstep( 0.05, 0.32, dir.y );
    if ( up > 0.001 && uRestoration > 0.001 ) {
      vec2 p = dir.xz / max( dir.y, 0.12 );
      float r = length( p );
      float a = atan( p.y, p.x ) + uTime * uSpin;

      float rings =
          ( 1.0 - smoothstep( 0.0, 0.017, abs( r - 0.42 ) ) )
        + ( 1.0 - smoothstep( 0.0, 0.015, abs( r - 0.78 ) ) )
        + ( 1.0 - smoothstep( 0.0, 0.013, abs( r - 1.26 ) ) );

      float spokes = 1.0 - smoothstep( 0.0, 0.055, abs( sin( a * 3.0 ) ) );
      spokes *= 1.0 - smoothstep( 1.20, 1.34, r );

      float geometry = clamp( rings + spokes * 0.65, 0.0, 1.0 );
      col += uRing * geometry * up * uRestoration * 0.8;
    }
  #endif

  gl_FragColor = vec4( col, 1.0 );

  #include <colorspace_fragment>
}
`;

export interface SkyDomeOptions {
  readonly tier?: GraphicsTier;
  /** Radius of the dome. It follows the camera, so this only has to clear the
   *  near plane comfortably. */
  readonly radius?: number;
  /** Constellation rotation, in radians per second. Zero when reduced motion
   *  is on — a slowly turning full-screen pattern is exactly the kind of thing
   *  that setting exists to stop. */
  readonly spin?: number;
  readonly ringColour?: string;
}

/** A live sky dome plus the handful of setters the render loop drives. */
export interface SkyDome {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** Repaints the gradient from the stage ambience at a restoration level. */
  setAmbience(ambience: StageAmbience, restoration: number): void;
  setRestoration(restoration: number): void;
  setTime(seconds: number): void;
  /** Keeps the dome centred on the viewer so it can never be walked out of. */
  followCamera(camera: THREE.Object3D): void;
  dispose(): void;
}

/**
 * Builds the procedural sky.
 *
 * At the `low` tier the constellation branch is compiled out entirely rather
 * than merely faded to zero, which is the difference between paying for eight
 * `smoothstep`s per background pixel and paying for none.
 */
export function createSkyDome(options: SkyDomeOptions = {}): SkyDome {
  const tier: GraphicsTier = options.tier ?? 'high';
  const radius = options.radius ?? 600;
  const segments = tier === 'low' ? 12 : tier === 'medium' ? 18 : 24;

  const geometry = new THREE.SphereGeometry(radius, segments, Math.max(8, segments - 8));

  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uTop: { value: new THREE.Color(PALETTE.abyss) },
      uBottom: { value: new THREE.Color(PALETTE.infectionDeep) },
      uHorizon: { value: new THREE.Color(PALETTE.gold) },
      uRing: { value: new THREE.Color(options.ringColour ?? PALETTE.gold) },
      uRestoration: { value: 0 },
      uTime: { value: 0 },
      uSpin: { value: options.spin ?? 0.006 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  if (tier === 'low') {
    material.defines = { TUNER_SKY_SIMPLE: '' };
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'tuner-sky';
  // Drawn first, never culled, never occluding: it is the backdrop the rest of
  // the frame is painted over.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = true;

  const uTop = material.uniforms.uTop;
  const uBottom = material.uniforms.uBottom;
  const uHorizon = material.uniforms.uHorizon;
  const uRestoration = material.uniforms.uRestoration;
  const uTime = material.uniforms.uTime;

  const resolved = createResolvedAmbience();

  return {
    mesh,
    material,

    setAmbience(ambience: StageAmbience, restoration: number): void {
      resolveAmbience(ambience, restoration, resolved);
      if (uTop && uTop.value instanceof THREE.Color) uTop.value.copy(resolved.skyTop);
      if (uBottom && uBottom.value instanceof THREE.Color) uBottom.value.copy(resolved.skyBottom);
      if (uHorizon && uHorizon.value instanceof THREE.Color) {
        // The horizon line takes the sun's colour: gold while infected, and
        // whatever the restored palette names once the region turns.
        uHorizon.value.copy(resolved.sunColour);
      }
      if (uRestoration) uRestoration.value = clamp01(restoration);
    },

    setRestoration(restoration: number): void {
      if (uRestoration) uRestoration.value = clamp01(restoration);
    },

    setTime(seconds: number): void {
      if (uTime) uTime.value = seconds;
    },

    followCamera(camera: THREE.Object3D): void {
      mesh.position.copy(camera.position);
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
