import * as THREE from 'three';
import type { GraphicsTier, Vec3 } from '@tuner/shared';
import { PALETTE, clamp01, lerp } from '@tuner/shared';
import type { StageDef } from '@tuner/game-core';

/**
 * The sky, and the colour maths the lighting rig shares with it.
 *
 * There is no skybox texture anywhere in TUNER. The sky is a poster, not a
 * photograph: three flat colour stops, one crisp horizon edge, two hard bands,
 * a single warm sun as the frame's focal point, and a set of sacred-geometry
 * constellation rings that are invisible while a region is detuned and fade up
 * as it is restored. That fade is the game's largest, cheapest reward — the
 * player looks up after a commander falls and the sky has remembered its
 * geometry.
 *
 * A detuned sky is the same construction with the virus in it: the violet band
 * spreads, a sickly magenta haze pools along the horizon, the sun goes to a
 * harsh clipped white, and the constellations are simply absent.
 *
 * The whole thing is one 24x16 sphere and roughly sixty fragment instructions.
 *
 * This file also owns `resolveLightingColours()`, which is the lighting rig's
 * palette. It lives here rather than in `lighting.tsx` for two reasons: the sky
 * and the lights have to agree about what a detuned region looks like, and the
 * maths stays testable in Node without pulling React in.
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
// Atmosphere palette
// ---------------------------------------------------------------------------

/**
 * Sky and light colours the shared `PALETTE` does not carry.
 *
 * Stages author their own ambience, but they author it from a UI palette with a
 * single violet and a single cyan in it, and two of them name a gold sun for an
 * *infected* region. Left alone that produces exactly one warm hue across the
 * whole frame. So the rig treats the authored ambience as a hint and enforces
 * the split itself: a detuned region is lit coldly and hazed magenta whatever it
 * asked for, and only a tuned region is allowed real warm sunlight.
 */
const AIR = {
  /** Deep blue that a tuned zenith settles toward. */
  blueZenith: '#101f57',
  /** The violet band that spreads across a detuned sky. */
  violetBand: '#3a1f6e',
  /** The blue band that replaces it once the region is tuned. */
  blueBand: '#17418f',
  /** Sickly magenta pooling on a detuned horizon, and the detuned sun's sore. */
  sickMagenta: '#c2338f',
  /** Warm sunlight. Only a tuned region gets this. */
  warmSun: '#ffd9a8',
  /** A detuned region's bleached, faintly violet key light. */
  sickKey: '#b9a8d8',
  /** Hemisphere sky term: cold both ways, bluer when tuned. */
  skyFillDetuned: '#3a3272',
  skyFillTuned: '#4f8ae0',
  /** Hemisphere ground bounce: dead violet, or warm stone. */
  groundDetuned: '#2a1a3e',
  groundTuned: '#8a6f47',
  /** The travelling resonance fill that follows the player. */
  fillDetuned: '#c23bd8',
  fillTuned: '#6ff0e0',
  /** The cool back light that separates a silhouette from the wall behind it. */
  rimDetuned: '#ff4fbf',
  rimTuned: '#7ff0ff',
} as const;

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
  /** The mid band. Violet while detuned, deep blue once tuned. */
  readonly skyMid: THREE.Color;
  readonly skyBottom: THREE.Color;
  /** The magenta horizon haze. Faded out entirely by restoration. */
  readonly hazeColour: THREE.Color;
  readonly fogColour: THREE.Color;
  readonly sunColour: THREE.Color;
  readonly ambientColour: THREE.Color;
  fogNear: number;
  fogFar: number;
}

export function createResolvedAmbience(): ResolvedAmbience {
  return {
    skyTop: new THREE.Color(PALETTE.abyss),
    skyMid: new THREE.Color(AIR.violetBand),
    skyBottom: new THREE.Color(PALETTE.panel),
    hazeColour: new THREE.Color(AIR.sickMagenta),
    fogColour: new THREE.Color(PALETTE.panel),
    sunColour: new THREE.Color(PALETTE.gold),
    ambientColour: new THREE.Color(PALETTE.infection),
    fogNear: 30,
    fogFar: 200,
  };
}

/**
 * Blends the authored infected palette toward the authored restored palette,
 * then derives the two stops stages do not author.
 *
 * Stages may omit `ambience.restored`, in which case the region keeps its
 * authored colours and only the derived stops, the surfaces and the
 * constellations change; the blend still runs so callers never need a branch.
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

  // A tuned zenith is a deep, clean blue rather than whatever near-black the
  // stage named; the mid band swings from bruised violet to that same blue.
  target.skyTop.lerp(cachedColour(AIR.blueZenith), 0.45 * t);
  target.skyMid
    .copy(cachedColour(AIR.violetBand))
    .lerp(cachedColour(AIR.blueBand), t)
    .lerp(target.skyBottom, 0.3);

  // The haze is the virus's own colour. The sky shader multiplies it out by
  // restoration, so it is simply gone from a tuned region.
  target.hazeColour.copy(cachedColour(AIR.sickMagenta)).lerp(target.skyBottom, 0.25);

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
// Lighting palette
// ---------------------------------------------------------------------------

/**
 * Every colour and intensity the lighting rig needs for one frame.
 *
 * Held as a mutable record that the caller reuses, because this is resolved
 * inside `useFrame` and the render loop must not allocate.
 */
export interface LightingColours {
  /** The sun. Bleached and faintly violet while detuned; warm once tuned. */
  readonly key: THREE.Color;
  keyIntensity: number;
  /** Hemisphere sky term — the cool fill that stops the key flattening things. */
  readonly skyFill: THREE.Color;
  /** Hemisphere ground term: the bounce coming back up off the region. */
  readonly groundFill: THREE.Color;
  hemisphereIntensity: number;
  /** A very small omnidirectional lift, so shadows are dark but not dead. */
  readonly ambient: THREE.Color;
  ambientIntensity: number;
  /** The travelling resonance fill: violet-magenta detuned, cyan-gold tuned. */
  readonly resonance: THREE.Color;
  resonanceIntensity: number;
  /** Cool back light, for silhouette separation. */
  readonly rim: THREE.Color;
  rimIntensity: number;
}

export function createLightingColours(): LightingColours {
  return {
    key: new THREE.Color(AIR.sickKey),
    keyIntensity: 1.25,
    skyFill: new THREE.Color(AIR.skyFillDetuned),
    groundFill: new THREE.Color(AIR.groundDetuned),
    hemisphereIntensity: 0.5,
    ambient: new THREE.Color(PALETTE.panel),
    ambientIntensity: 0.14,
    resonance: new THREE.Color(AIR.fillDetuned),
    resonanceIntensity: 0.7,
    rim: new THREE.Color(AIR.rimDetuned),
    rimIntensity: 0.85,
  };
}

/**
 * Resolves the rig's palette for a tuning level.
 *
 * The shape of the rig is the art direction, so it is worth stating plainly:
 *
 * - **One key**, and it is the only strong light in the frame. Its colour is
 *   pulled toward a bleached violet-white while the region is detuned — a
 *   detuned region must never look like a warm afternoon, whatever sun colour
 *   the stage authored — and toward real warm sunlight as it is restored.
 * - **A cool hemisphere fill**, deliberately blue in both states. Warm key
 *   against cool fill is what gives a low-poly face its shape; a warm key
 *   against a warm fill is how a scene turns into one flat sheet of amber.
 * - **A tiny ambient term.** The sum of all the fills stays well under the key,
 *   because contrast between a lit face and a shadowed one is what carries a
 *   silhouette, and that contrast is a ratio.
 * - **A resonance fill** travelling with the player, whose colour is the
 *   region's tuning: violet-magenta at 440 Hz, cyan-gold at 432 Hz.
 * - **A cool back light**, weak, unshadowed, opposite the key, purely to peel
 *   the player and the enemies off the wall behind them.
 */
export function resolveLightingColours(
  resolved: ResolvedAmbience,
  restoration: number,
  target: LightingColours,
): LightingColours {
  const t = clamp01(restoration);

  target.key.copy(resolved.sunColour).lerp(cachedColour(AIR.warmSun), 0.32 * t);
  target.key.lerp(cachedColour(AIR.sickKey), (1 - t) * 0.85);
  target.keyIntensity = lerp(1.25, 1.55, t);

  target.skyFill.copy(cachedColour(AIR.skyFillDetuned)).lerp(cachedColour(AIR.skyFillTuned), t);
  target.groundFill
    .copy(cachedColour(AIR.groundDetuned))
    .lerp(cachedColour(AIR.groundTuned), t)
    .lerp(resolved.ambientColour, 0.25);
  target.hemisphereIntensity = lerp(0.5, 0.4, t);

  target.ambient.copy(resolved.fogColour);
  target.ambientIntensity = lerp(0.14, 0.1, t);

  target.resonance.copy(cachedColour(AIR.fillDetuned)).lerp(cachedColour(AIR.fillTuned), t);
  // A gold kiss at the very end, so a fully restored region reads as cyan-gold
  // rather than as an aquarium.
  target.resonance.lerp(cachedColour(PALETTE.gold), 0.22 * t);
  target.resonanceIntensity = lerp(0.7, 0.55, t);

  target.rim.copy(cachedColour(AIR.rimDetuned)).lerp(cachedColour(AIR.rimTuned), t);
  target.rimIntensity = lerp(0.8, 1.05, t);

  return target;
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
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uRing;
uniform vec3 uSun;
uniform float uRestoration;
uniform float uTime;
uniform float uSpin;
varying vec3 vTunerDir;

void main() {
  vec3 dir = normalize( vTunerDir );
  float h = clamp( dir.y * 0.5 + 0.5, 0.0, 1.0 );

  // Three stops and one crisp edge: horizon, mid band, zenith. Poster-flat —
  // no dithered gradients, no clouds, no noise.
  vec3 col = mix( uBottom, uMid, smoothstep( 0.42, 0.58, h ) );
  col = mix( col, uTop, smoothstep( 0.60, 0.88, h ) );

  // Two hard bands, drawn only in tuned air, where they read as the world's own
  // stratification answering the sacred geometry cut into the stonework.
  float bandA = 1.0 - smoothstep( 0.0, 0.013, abs( h - 0.615 ) );
  float bandB = 1.0 - smoothstep( 0.0, 0.009, abs( h - 0.700 ) );
  col += uHorizon * ( bandA * 0.10 + bandB * 0.06 ) * uRestoration;

  float horizonLine = 1.0 - smoothstep( 0.0, 0.028, abs( h - 0.50 ) );
  col = mix( col, uHorizon, horizonLine * 0.45 );

  // The virus's haze, pooled in the first few degrees above the horizon. It is
  // multiplied straight out by restoration, so a tuned region has none of it.
  float haze = clamp( 1.0 - abs( h - 0.50 ) * 5.2, 0.0, 1.0 );
  col = mix( col, uHaze, haze * haze * ( 1.0 - uRestoration ) * 0.60 );

  // The sun: the frame's focal point, and the only small bright thing in it.
  // Warm and clean when the region is tuned, a harsh magenta-white sore when
  // it is not.
  float sunDot = clamp( dot( dir, uSun ), 0.0, 1.0 );
  float sunGlow = pow( sunDot, 9.0 );
  float sunDisc = smoothstep( 0.9965, 0.9990, sunDot );
  vec3 sunTint = mix( uHaze, uHorizon, uRestoration );
  col += sunTint * ( sunGlow * 0.26 + sunDisc * 1.10 );

  #ifndef TUNER_SKY_SIMPLE
    // Sacred geometry, drawn on a gnomonic projection around the zenith: three
    // concentric rings, six spokes and a twelve-fold rosette. Absent while the
    // region is detuned — the geometry is what the world remembers of itself.
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

      // Twelve petals between the inner rings: the Keepers' interval wheel.
      float rosette = 1.0 - smoothstep( 0.0, 0.030, abs( r - 0.60 - 0.055 * cos( a * 12.0 ) ) );

      float geometry = clamp( rings + spokes * 0.65 + rosette * 0.8, 0.0, 1.0 );
      col += uRing * geometry * up * uRestoration * 0.85;
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
  /** Points the sun glow. Also driven by `setAmbience`, which has the direction. */
  setSunDirection(sunDirection: Readonly<Vec3>): void;
  /** Keeps the dome centred on the viewer so it can never be walked out of. */
  followCamera(camera: THREE.Object3D): void;
  dispose(): void;
}

/**
 * Builds the procedural sky.
 *
 * At the `low` tier the constellation branch is compiled out entirely rather
 * than merely faded to zero, which is the difference between paying for eleven
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
      uMid: { value: new THREE.Color(AIR.violetBand) },
      uBottom: { value: new THREE.Color(PALETTE.infectionDeep) },
      uHorizon: { value: new THREE.Color(PALETTE.gold) },
      uHaze: { value: new THREE.Color(AIR.sickMagenta) },
      uRing: { value: new THREE.Color(options.ringColour ?? PALETTE.gold) },
      uSun: { value: new THREE.Vector3(0.34, 0.82, 0.46).normalize() },
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
  const uMid = material.uniforms.uMid;
  const uBottom = material.uniforms.uBottom;
  const uHorizon = material.uniforms.uHorizon;
  const uHaze = material.uniforms.uHaze;
  const uSun = material.uniforms.uSun;
  const uRestoration = material.uniforms.uRestoration;
  const uTime = material.uniforms.uTime;

  const resolved = createResolvedAmbience();

  const setSunDirection = (sunDirection: Readonly<Vec3>): void => {
    if (!uSun || !(uSun.value instanceof THREE.Vector3)) return;
    // The authored value is the direction light *travels*; the shader wants the
    // direction to look in to find the sun.
    uSun.value.set(-sunDirection.x, -sunDirection.y, -sunDirection.z);
    if (uSun.value.lengthSq() < 1e-8) uSun.value.set(0, 1, 0);
    uSun.value.normalize();
  };

  return {
    mesh,
    material,

    setAmbience(ambience: StageAmbience, restoration: number): void {
      resolveAmbience(ambience, restoration, resolved);
      if (uTop && uTop.value instanceof THREE.Color) uTop.value.copy(resolved.skyTop);
      if (uMid && uMid.value instanceof THREE.Color) uMid.value.copy(resolved.skyMid);
      if (uBottom && uBottom.value instanceof THREE.Color) uBottom.value.copy(resolved.skyBottom);
      if (uHorizon && uHorizon.value instanceof THREE.Color) {
        // The horizon line and the sun's glow take the sun's colour: gold in a
        // tuned region, whatever the stage authored while it is not.
        uHorizon.value.copy(resolved.sunColour);
      }
      if (uHaze && uHaze.value instanceof THREE.Color) uHaze.value.copy(resolved.hazeColour);
      if (uRestoration) uRestoration.value = clamp01(restoration);
      setSunDirection(ambience.sunDirection);
    },

    setRestoration(restoration: number): void {
      if (uRestoration) uRestoration.value = clamp01(restoration);
    },

    setTime(seconds: number): void {
      if (uTime) uTime.value = seconds;
    },

    setSunDirection,

    followCamera(camera: THREE.Object3D): void {
      mesh.position.copy(camera.position);
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
