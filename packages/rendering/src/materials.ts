import * as THREE from 'three';
import type { GraphicsTier } from '@tuner/shared';
import { PALETTE, clamp01 } from '@tuner/shared';
import type { SurfaceStyle } from '@tuner/game-core';

/**
 * The surface material library.
 *
 * TUNER's world is drawn in a simplified vector-cartoon idiom translated into
 * low-poly 3D: flat or lightly layered colour, crisp geometric seams, a clean
 * silhouette edge, and no photographic texturing anywhere. There are no texture
 * assets in this project — every surface here is built procedurally out of a
 * handful of arithmetic operations, which is also what keeps it inside a mobile
 * fragment budget.
 *
 * The palette is the whole point of the file. A region at 440 Hz and the same
 * region at 432 Hz must be unmistakable side by side:
 *
 * ```
 *   detuned (440 Hz)                       tuned (432 Hz)
 *   black-violet matter                    warm stone
 *   magenta edge pulses, harsh whites       gold sacred-geometry lattice
 *   sheared, broken, asymmetric banding     clean strata, cyan frequency lines
 *   no growth, no lattice                   green luminous growth
 * ```
 *
 * Every style therefore carries three colours — `baseColour` (untuned),
 * `infectedColour` and `restoredColour` — and the shader blends between them.
 * `resolveSurfaceColour()` is the CPU mirror of that blend, and
 * `materials.test.ts` asserts the two ends stay far apart in RGB. That
 * assertion exists because an earlier version of this file resolved almost
 * every surface to the same warm hue on screen, which flattened the entire
 * art direction into one colour.
 *
 * Four things make this file worth its length:
 *
 * 1. **One uniform retunes the whole world.** `uInfection` and `uRestoration`
 *    are *shared* uniform objects handed to every injected shader, so setting
 *    the region's infection once repaints every stone, root and crystal in the
 *    same frame. Restoring a region is supposed to feel like the world exhaling;
 *    that only reads if it happens everywhere at once.
 * 2. **Materials are cached and shared.** A material is created once per
 *    `style + tier` and handed to every mesh that asks. Creating them per mesh
 *    would multiply shader programs and leak GPU memory on mobile, which is the
 *    single most common way a scene like this dies on a phone.
 * 3. **Patterns are laid out in a world-space triplanar frame.** The lattice and
 *    the frequency lines pick their axes from the face normal, so a carved wall
 *    is carved rather than smeared, and every instanced box shares one program.
 * 4. **The edge treatment is in-shader, and it is an *edge*.** A derivative
 *    face-normal fresnel gives the clean geometric outline the art direction
 *    asks for without a post-process outline pass — but faded out with distance,
 *    because a grazing floor plane has the same fresnel term as the silhouette
 *    of a pillar and an unfaded rim floods the frame with its own colour.
 *
 * At the `low` graphics tier the shader injection is dropped entirely and the
 * styles fall back to plain flat-shaded colours; the infected/restored split
 * still happens, but on the CPU (there are at most a dozen materials) rather
 * than per pixel.
 */

// ---------------------------------------------------------------------------
// Art-direction colours
// ---------------------------------------------------------------------------

/**
 * Hues the shared `PALETTE` does not carry.
 *
 * `PALETTE` is the interface's palette: it has one violet and one cyan. The
 * world needs a wider set at both extremes — a near-black violet for infected
 * matter, a harsh magenta for the virus's pulses, and warm stone and sand for
 * a tuned region. They live here rather than in `@tuner/shared` because they
 * are world-art decisions, not shared tokens.
 */
const ART = {
  /** Infected matter: almost black, unmistakably violet. */
  voidViolet: '#180c30',
  voidVioletDeep: '#120821',
  /** The virus's signature pulse. Nothing natural in the world is this colour. */
  magenta: '#ff35b8',
  /** Harsh, clipped white the Amplifier's pulses flash to. */
  harshWhite: '#f6e2ff',
  /** Warm stone, dry and slightly pink — a tuned sanctuary floor. */
  warmStone: '#b09a76',
  warmStoneLit: '#d9be86',
  /** Cool quarried stone, the untuned neutral everything else is read against. */
  coolStone: '#61688a',
  /** Dressed Keeper stone: lighter and a touch warmer than the rough quarry
   *  block it sits next to, so a carved wall never reads as raw terrain. */
  coolStoneCarved: '#7c86ab',
  /** Clear turquoise water. Deliberately not the UI's cyan. */
  turquoise: '#1fb9b4',
  turquoiseBright: '#57e8d8',
  /** Faceted resonance crystal. */
  crystal: '#2fbfe0',
  crystalBright: '#7ff0ff',
  /** Crystalline virus growth: crystal's silhouette, the virus's colour. */
  crystalVirus: '#c02ad8',
  /** Pale sky glass — flat, cold and nearly colourless next to crystal. */
  glass: '#b9d9f2',
  glassBright: '#dff2ff',
  glassSick: '#7a2a86',
  /** Cold steel. */
  steel: '#4f5f73',
  steelBright: '#b9c7d8',
  steelTarnished: '#2b2540',
  /** Luminous vegetation. */
  growth: '#357b57',
  growthDead: '#251036',
  /** Dry sand and its ashen, detuned counterpart. */
  sand: '#c9ac72',
  sandBright: '#e8d29a',
  sandAsh: '#3f3550',
  /** Ember rock and its heat. */
  emberRock: '#8d3520',
  emberHot: '#ff8f3f',
  emberSick: '#5c1149',
  /** Gold, held below full brightness so ACES tone mapping cannot bleach it. */
  gold: '#d8a63c',
  goldBright: '#f7d477',
  goldDead: '#4b3358',
  /** Stone that has gone out: the colour a detuned wall settles to. */
  stoneDead: '#1b1230',
  stoneDeadCarved: '#24143f',
} as const;

// ---------------------------------------------------------------------------
// Shared uniforms
// ---------------------------------------------------------------------------

/** Minimal structural stand-in for a Three.js uniform slot. */
export interface UniformRef<T> {
  value: T;
}

/**
 * The uniforms every injected surface shader shares by reference.
 *
 * These objects are handed straight to `shader.uniforms` during
 * `onBeforeCompile`, so writing `uInfection.value` updates every material that
 * has ever been compiled from this registry.
 */
export interface ResonanceUniforms {
  /** How detuned the region is, in [0, 1]. Mirrors `StageRuntimeState.infection`. */
  readonly uInfection: UniformRef<number>;
  /** How restored the region is, in [0, 1]. Usually `1 - infection`, but the
   *  restoration sequence drives it independently for a beat. */
  readonly uRestoration: UniformRef<number>;
  /** Seconds since the stage began, for the surfaces that flow or pulse. */
  readonly uTime: UniformRef<number>;
}

/** The subset of a Three.js shader object the injection touches. */
export interface InjectableShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

// ---------------------------------------------------------------------------
// Style profiles
// ---------------------------------------------------------------------------

/**
 * Everything that distinguishes one surface style from another.
 *
 * Deliberately a flat data record rather than a subclass per style: the shader
 * is identical for all of them, only these numbers change, and that is what lets
 * the whole library share one program cache key per style/tier pair.
 */
export interface SurfaceProfile {
  /** Colour of a healthy, un-retuned surface. */
  readonly baseColour: THREE.Color;
  /** Colour the surface drifts to at full 440 Hz infection. */
  readonly infectedColour: THREE.Color;
  /** Colour the surface reaches once the region is fully restored. */
  readonly restoredColour: THREE.Color;
  /** Colour of the silhouette rim while the region is tuned. */
  readonly rimColour: THREE.Color;
  /** Colour of the sacred-geometry lattice. Gold on Keeper stonework. */
  readonly seamColour: THREE.Color;
  /** Colour of the thin travelling frequency rules. Cyan almost everywhere. */
  readonly lineColour: THREE.Color;
  /** Colour of the infection's edge pulse. Magenta or harsh white. */
  readonly pulseColour: THREE.Color;
  /** Luminous growth colour, added as emission only while the region is tuned. */
  readonly glowColour: THREE.Color;
  readonly glowStrength: number;
  readonly emissiveColour: THREE.Color | null;
  readonly emissiveIntensity: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly flatShading: boolean;
  readonly side: THREE.Side;
  /** How strongly this surface takes the violet. Already-violet surfaces sit low. */
  readonly infectionResponse: number;
  /** Bands per metre of world height. Larger means finer layering. */
  readonly bandScale: number;
  /** 0 leaves the surface perfectly flat; 1 is full two-step layering. */
  readonly bandStrength: number;
  /** Lattice cells per metre, in the surface's own triplanar frame. */
  readonly seamScale: number;
  readonly seamStrength: number;
  /** Frequency rules per metre. */
  readonly lineScale: number;
  readonly lineStrength: number;
  readonly rimStrength: number;
  /** Higher tightens the rim into a thinner outline. */
  readonly rimPower: number;
  /** Metres at which the rim has faded out completely. Keeps the edge an edge. */
  readonly rimFade: number;
  /** Bands per second of scroll. Non-zero only for water and ember. */
  readonly flowSpeed: number;
  /** How hard the stylised face-direction shading bites. 0 is perfectly flat. */
  readonly faceShade: number;
  /** Skipped entirely by the geometry builders; still resolves to a material. */
  readonly invisible: boolean;
}

const colour = (hex: string): THREE.Color => new THREE.Color(hex);

interface ProfileOverrides extends Partial<SurfaceProfile> {
  readonly baseColour: THREE.Color;
}

function profile(overrides: ProfileOverrides): SurfaceProfile {
  return {
    infectedColour: colour(ART.voidViolet),
    restoredColour: colour(ART.warmStone),
    rimColour: colour(PALETTE.resonance),
    seamColour: colour(ART.gold),
    lineColour: colour(PALETTE.resonance),
    pulseColour: colour(ART.magenta),
    glowColour: colour(PALETTE.restore),
    glowStrength: 0,
    emissiveColour: null,
    emissiveIntensity: 0,
    roughness: 0.92,
    metalness: 0,
    opacity: 1,
    transparent: false,
    depthWrite: true,
    flatShading: true,
    side: THREE.FrontSide,
    infectionResponse: 1,
    bandScale: 0.55,
    bandStrength: 0.16,
    seamScale: 0.25,
    seamStrength: 0,
    lineScale: 0,
    lineStrength: 0,
    rimStrength: 0.1,
    rimPower: 4,
    rimFade: 16,
    flowSpeed: 0,
    faceShade: 1,
    invisible: false,
    ...overrides,
  };
}

/**
 * One profile per `SurfaceStyle`.
 *
 * Typed as a total record so that adding a style to the authoring format is a
 * compile error here until it is given a look — a missing style would otherwise
 * surface as untextured geometry halfway through a stage.
 *
 * Read the three colours on each entry as a sentence: *this is the rock, this is
 * what the virus does to it, this is what it becomes when it is tuned.*
 */
export const SURFACE_PROFILES: Readonly<Record<SurfaceStyle, SurfaceProfile>> = {
  stone: profile({
    // Cool quarried stone that warms into limestone as the region comes home,
    // and goes out into near-black violet when it does not.
    baseColour: colour(ART.coolStone),
    infectedColour: colour(ART.stoneDead),
    restoredColour: colour(ART.warmStone),
    bandScale: 0.42,
    bandStrength: 0.16,
    rimStrength: 0.08,
    rimFade: 12,
  }),
  'stone-carved': profile({
    // The Keepers cut their geometry into everything they built, so this style
    // carries the gold lattice that reads as sacred stonework from a distance,
    // plus the cyan frequency rules that only appear once the stone is in tune.
    baseColour: colour(ART.coolStoneCarved),
    infectedColour: colour(ART.stoneDeadCarved),
    restoredColour: colour(ART.warmStoneLit),
    seamColour: colour(ART.goldBright),
    seamScale: 0.5,
    seamStrength: 0.5,
    lineScale: 0.16,
    lineStrength: 0.3,
    bandScale: 0.7,
    bandStrength: 0.2,
    rimStrength: 0.16,
    rimPower: 3.2,
    rimFade: 18,
  }),
  root: profile({
    // Living wood. Tuned, it is lit from inside; detuned, it is charcoal.
    baseColour: colour(ART.growth),
    infectedColour: colour(ART.growthDead),
    restoredColour: colour(PALETTE.restore),
    rimColour: colour(PALETTE.restore),
    seamColour: colour(PALETTE.restoreDeep),
    glowColour: colour(PALETTE.restore),
    glowStrength: 0.3,
    emissiveColour: colour(PALETTE.restoreDeep),
    emissiveIntensity: 0.14,
    roughness: 1,
    bandScale: 0.9,
    bandStrength: 0.3,
    rimStrength: 0.18,
    rimFade: 14,
    faceShade: 1.15,
  }),
  crystal: profile({
    // Opaque, hard-facetted, saturated: crystal is a *solid*. The virus grows
    // its own crystal, which keeps the silhouette and swaps the colour.
    baseColour: colour(ART.crystal),
    infectedColour: colour(ART.crystalVirus),
    restoredColour: colour(ART.crystalBright),
    rimColour: colour(PALETTE.resonance),
    lineColour: colour(ART.glassBright),
    glowColour: colour(PALETTE.resonance),
    glowStrength: 0.34,
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.42,
    roughness: 0.24,
    metalness: 0.05,
    bandScale: 1.15,
    bandStrength: 0.3,
    rimStrength: 0.7,
    rimPower: 2.2,
    rimFade: 46,
    faceShade: 1.4,
  }),
  glass: profile({
    // Transparent, smooth-shaded and nearly colourless — the deliberate
    // opposite of crystal, so a pane never reads as a shard.
    baseColour: colour(ART.glass),
    infectedColour: colour(ART.glassSick),
    restoredColour: colour(ART.glassBright),
    rimColour: colour(ART.glassBright),
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.12,
    roughness: 0.04,
    metalness: 0,
    opacity: 0.3,
    transparent: true,
    depthWrite: false,
    flatShading: false,
    side: THREE.DoubleSide,
    bandStrength: 0,
    seamStrength: 0,
    rimStrength: 0.95,
    rimPower: 1.7,
    rimFade: 60,
    infectionResponse: 0.8,
    faceShade: 0.25,
  }),
  metal: profile({
    baseColour: colour(ART.steel),
    infectedColour: colour(ART.steelTarnished),
    restoredColour: colour(ART.steelBright),
    rimColour: colour(ART.glassBright),
    roughness: 0.3,
    metalness: 0.8,
    bandScale: 0.3,
    bandStrength: 0.1,
    seamScale: 0.75,
    seamStrength: 0.18,
    lineScale: 0.5,
    lineStrength: 0.14,
    rimStrength: 0.24,
    rimPower: 3,
    rimFade: 22,
    infectionResponse: 0.9,
  }),
  water: profile({
    // Clear turquoise, and it moves: two crossing sine crests scroll across the
    // surface in its own triplanar frame, which costs four trig calls and reads
    // as running water from any angle.
    baseColour: colour(ART.turquoise),
    infectedColour: colour('#3a2564'),
    restoredColour: colour(ART.turquoiseBright),
    rimColour: colour('#d9fff8'),
    lineColour: colour(ART.turquoiseBright),
    glowColour: colour(ART.turquoiseBright),
    glowStrength: 0.18,
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.16,
    roughness: 0.08,
    opacity: 0.62,
    transparent: true,
    depthWrite: false,
    flatShading: false,
    bandScale: 1.6,
    bandStrength: 0.2,
    rimStrength: 0.3,
    rimPower: 2.6,
    rimFade: 34,
    flowSpeed: 0.42,
    faceShade: 0.2,
  }),
  sand: profile({
    // Warm, dry and matte. Nothing about it should suggest water.
    baseColour: colour(ART.sand),
    infectedColour: colour(ART.sandAsh),
    restoredColour: colour(ART.sandBright),
    rimColour: colour(ART.goldBright),
    roughness: 1,
    bandScale: 0.24,
    bandStrength: 0.1,
    rimStrength: 0.05,
    rimFade: 10,
    infectionResponse: 0.9,
    faceShade: 0.8,
  }),
  ember: profile({
    baseColour: colour(ART.emberRock),
    infectedColour: colour(ART.emberSick),
    restoredColour: colour(ART.emberHot),
    rimColour: colour(PALETTE.alarm),
    lineColour: colour(PALETTE.alarm),
    glowColour: colour(PALETTE.alarm),
    glowStrength: 0.3,
    emissiveColour: colour(PALETTE.alarm),
    emissiveIntensity: 0.5,
    roughness: 0.7,
    bandScale: 0.85,
    bandStrength: 0.42,
    rimStrength: 0.36,
    rimPower: 2.6,
    rimFade: 26,
    flowSpeed: 0.5,
    infectionResponse: 0.7,
  }),
  infected: profile({
    // Alien matter. Black-violet body, magenta edges that pulse out of time with
    // everything else, banding that shears and drops out in chunks. It barely
    // moves under infection — it *is* the infection — and swings hard to green
    // as the region comes back.
    baseColour: colour(ART.voidViolet),
    infectedColour: colour(ART.voidVioletDeep),
    restoredColour: colour(PALETTE.restore),
    rimColour: colour(ART.magenta),
    seamColour: colour(ART.magenta),
    lineColour: colour(ART.harshWhite),
    pulseColour: colour(ART.magenta),
    glowColour: colour(PALETTE.restore),
    glowStrength: 0.34,
    emissiveColour: colour(ART.voidVioletDeep),
    emissiveIntensity: 0.2,
    roughness: 0.42,
    infectionResponse: 0.35,
    bandScale: 1.45,
    bandStrength: 0.5,
    seamScale: 0.9,
    seamStrength: 0.12,
    rimStrength: 0.8,
    rimPower: 2,
    rimFade: 40,
    faceShade: 1.5,
  }),
  restored: profile({
    baseColour: colour(PALETTE.restore),
    infectedColour: colour('#2a1244'),
    restoredColour: colour('#8ff7bd'),
    rimColour: colour(PALETTE.restore),
    seamColour: colour(ART.goldBright),
    glowColour: colour(PALETTE.restore),
    glowStrength: 0.32,
    emissiveColour: colour(PALETTE.restoreDeep),
    emissiveIntensity: 0.3,
    roughness: 0.5,
    infectionResponse: 0.6,
    bandScale: 0.8,
    bandStrength: 0.22,
    seamScale: 0.6,
    seamStrength: 0.24,
    lineScale: 0.4,
    lineStrength: 0.26,
    rimStrength: 0.44,
    rimPower: 2.6,
    rimFade: 30,
  }),
  'gold-trim': profile({
    baseColour: colour(ART.gold),
    infectedColour: colour(ART.goldDead),
    restoredColour: colour(ART.goldBright),
    rimColour: colour(ART.goldBright),
    seamColour: colour(ART.warmStoneLit),
    lineColour: colour(PALETTE.resonance),
    emissiveColour: colour(PALETTE.goldDim),
    emissiveIntensity: 0.2,
    roughness: 0.26,
    metalness: 0.7,
    seamScale: 1.2,
    seamStrength: 0.2,
    lineScale: 0.9,
    lineStrength: 0.18,
    bandStrength: 0.08,
    rimStrength: 0.6,
    rimPower: 1.8,
    rimFade: 40,
    infectionResponse: 0.85,
  }),
  invisible: profile({
    baseColour: colour(PALETTE.abyss),
    infectedColour: colour(PALETTE.abyss),
    restoredColour: colour(PALETTE.abyss),
    opacity: 0,
    transparent: true,
    depthWrite: false,
    rimStrength: 0,
    bandStrength: 0,
    faceShade: 0,
    invisible: true,
  }),
};

/** Every authored surface style, derived from the profile table so the two
 *  can never drift apart. */
export const SURFACE_STYLES: readonly SurfaceStyle[] = Object.keys(
  SURFACE_PROFILES,
) as SurfaceStyle[];

// ---------------------------------------------------------------------------
// The palette blend, on the CPU
// ---------------------------------------------------------------------------

/**
 * The diffuse colour a style resolves to at a given tuning.
 *
 * This is the exact arithmetic the injected shader performs on its three colour
 * uniforms, kept in one place so the `low` tier, the shader and the tests can
 * never disagree about what "infected stone" looks like. Restoration is gated by
 * infection so a half-retuned surface reads as *transitional* rather than as
 * both states at once.
 */
export function resolveSurfaceColour(
  style: SurfaceStyle,
  infection: number,
  restoration: number,
  target: THREE.Color = new THREE.Color(),
): THREE.Color {
  const surface = SURFACE_PROFILES[style];
  const infect = clamp01(clamp01(infection) * surface.infectionResponse);
  const heal = clamp01(clamp01(restoration) * (1 - infect));
  return target
    .copy(surface.baseColour)
    .lerp(surface.restoredColour, heal)
    .lerp(surface.infectedColour, infect);
}

// ---------------------------------------------------------------------------
// Shader injection
// ---------------------------------------------------------------------------

const VARYING_DECLARATIONS = /* glsl */ `
varying vec3 vTunerWorldPos;
varying vec3 vTunerViewPos;
varying vec3 vTunerWorldNormal;
`;

const VERTEX_WORLD_NORMAL = /* glsl */ `
  vec3 tunerObjectNormal = objectNormal;
  #ifdef USE_INSTANCING
    tunerObjectNormal = mat3( instanceMatrix ) * tunerObjectNormal;
  #endif
  vTunerWorldNormal = normalize( mat3( modelMatrix ) * tunerObjectNormal );
`;

const VERTEX_WORLD_POSITION = /* glsl */ `
  vec4 tunerObjectPos = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    tunerObjectPos = instanceMatrix * tunerObjectPos;
  #endif
  vTunerWorldPos = ( modelMatrix * tunerObjectPos ).xyz;
`;

const VERTEX_VIEW_POSITION = /* glsl */ `
  vTunerViewPos = mvPosition.xyz;
`;

const FRAGMENT_UNIFORMS = /* glsl */ `
uniform float uInfection;
uniform float uRestoration;
uniform float uTime;
uniform vec3 uBaseColour;
uniform vec3 uInfectedColour;
uniform vec3 uRestoredColour;
uniform vec3 uRimColour;
uniform vec3 uSeamColour;
uniform vec3 uLineColour;
uniform vec3 uPulseColour;
uniform vec3 uGlowColour;
uniform float uGlowStrength;
uniform float uInfectionResponse;
uniform float uBandScale;
uniform float uBandStrength;
uniform float uSeamScale;
uniform float uSeamStrength;
uniform float uLineScale;
uniform float uLineStrength;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uRimFade;
uniform float uFlowSpeed;
uniform float uFaceShade;
`;

/**
 * Retunes the diffuse colour.
 *
 * Layers, in order:
 *
 * 1. the tuned/untuned/detuned colour blend — the palette split itself;
 * 2. a stylised face-direction shade, which is what keeps two faces of the same
 *    box from reading as one silhouette under flat ambient light;
 * 3. strata: clean two-step layering when tuned, sheared and broken when not;
 * 4. the gold sacred-geometry lattice, laid out in a triplanar frame so it is
 *    carved *into* whichever face it lands on;
 * 5. thin travelling cyan frequency rules, which exist only in tuned matter;
 * 6. crossing wave crests for the two flowing styles.
 *
 * No loops, no noise, no texture fetches, and the only branch is on a uniform.
 */
const FRAGMENT_DIFFUSE = /* glsl */ `
  {
    float tunerInfect = clamp( uInfection * uInfectionResponse, 0.0, 1.0 );
    float tunerHeal = clamp( uRestoration * ( 1.0 - tunerInfect ), 0.0, 1.0 );

    vec3 tunerCol = mix( uBaseColour, uRestoredColour, tunerHeal );
    tunerCol = mix( tunerCol, uInfectedColour, tunerInfect );

    // A world-space triplanar frame chosen by the dominant axis of the face.
    // Every renderable in the stage is axis-aligned, so this is exact rather
    // than a blend, and it costs two steps and two mixes.
    vec3 tunerNormal = normalize( vTunerWorldNormal );
    float tunerIsUp = step( 0.5, abs( tunerNormal.y ) );
    float tunerIsX = step( 0.5, abs( tunerNormal.x ) );
    vec2 tunerUv = mix(
      mix( vTunerWorldPos.xy, vTunerWorldPos.zy, tunerIsX ),
      vTunerWorldPos.xz,
      tunerIsUp
    );

    // Stylised face shading. Up-facing planes lift toward the sky, undersides
    // drop away, and the two horizontal axes differ slightly so a corner never
    // disappears. This is the silhouette work the lighting rig cannot do.
    float tunerFace = 1.0 + uFaceShade * (
      0.30 * tunerNormal.y - 0.20 * abs( tunerNormal.x ) - 0.07 * abs( tunerNormal.z )
    );
    tunerCol *= max( tunerFace, 0.15 );

    // Strata. Tuned rock layers cleanly; detuned rock shears out of alignment
    // and drops whole bands, which is the tell that the virus is copying
    // geometry it does not understand.
    float tunerBandCoord = vTunerWorldPos.y * uBandScale + uTime * uFlowSpeed;
    tunerBandCoord += tunerInfect * (
      sin( vTunerWorldPos.x * 2.7 ) * 0.34 + sin( vTunerWorldPos.z * 1.13 + 1.7 ) * 0.21
    );
    float tunerBand = fract( tunerBandCoord );
    float tunerLayer = step( 0.5, tunerBand ) * 0.62 + step( 0.86, tunerBand ) * 0.38;
    float tunerBreak = mix(
      1.0,
      step( 0.34, fract( tunerBandCoord * 0.37 + vTunerWorldPos.x * 0.11 ) ),
      tunerInfect
    );
    vec3 tunerStrata = mix(
      tunerCol * 1.16,
      mix( tunerCol * 0.42, uPulseColour, 0.22 ),
      tunerInfect
    );
    tunerCol = mix( tunerCol, tunerStrata, tunerLayer * tunerBreak * uBandStrength );

    // Sacred geometry. Always faintly present in Keeper stonework; it comes up
    // to full gold as the region returns to 432 Hz, and the virus smothers it.
    vec2 tunerSeam = abs( fract( tunerUv * uSeamScale ) - 0.5 );
    float tunerLattice = 1.0 - smoothstep( 0.0, 0.045, min( tunerSeam.x, tunerSeam.y ) );
    float tunerLatticeGain = uSeamStrength * mix( 0.3, 1.0, tunerHeal ) * ( 1.0 - tunerInfect * 0.85 );
    tunerCol = mix( tunerCol, uSeamColour, tunerLattice * tunerLatticeGain );

    // Frequency lines: thin cyan rules travelling along the surface. Absent
    // while detuned — a detuned region has no signal to draw.
    float tunerLine = 1.0 - smoothstep( 0.0, 0.03, abs( fract( tunerUv.x * uLineScale ) - 0.5 ) );
    float tunerTravel = 0.55 + 0.45 * sin( tunerUv.y * 0.7 - uTime * 1.6 );
    tunerCol = mix( tunerCol, uLineColour, tunerLine * tunerTravel * uLineStrength * tunerHeal );

    // Water and ember: two crossing crests, so the surface actually moves.
    if ( uFlowSpeed > 0.001 ) {
      float tunerW1 = sin( tunerUv.x * 1.9 + uTime * uFlowSpeed * 5.0 );
      float tunerW2 = sin( tunerUv.y * 1.35 - uTime * uFlowSpeed * 3.4 );
      float tunerCrest = smoothstep( 0.30, 0.92, tunerW1 * tunerW2 );
      tunerCol = mix( tunerCol, mix( tunerCol, uRimColour, 0.65 ), tunerCrest * 0.85 );
    }

    diffuseColor.rgb = tunerCol;
  }
`;

/**
 * The silhouette edge and the luminous growth.
 *
 * The face normal is recovered from screen-space derivatives of the view
 * position rather than from the interpolated normal, so the rim traces the
 * *facets* of the low-poly form and stays correct under flat shading,
 * instancing and skinning alike.
 *
 * The distance fade is not an optimisation, it is the art direction. A floor
 * plane seen at a grazing angle has exactly the same fresnel term as the
 * silhouette of a nearby pillar, so an unfaded rim paints the whole far half of
 * the frame in the rim colour — which is how this scene previously came out as
 * one flat sheet of amber. Fading it with view distance keeps it reading as a
 * drawn outline on nearby forms and nothing at all in the distance.
 */
const FRAGMENT_RIM = /* glsl */ `
  {
    vec3 tunerDx = dFdx( vTunerViewPos );
    vec3 tunerDy = dFdy( vTunerViewPos );
    vec3 tunerFaceNormal = normalize( cross( tunerDx, tunerDy ) );
    vec3 tunerViewDir = normalize( -vTunerViewPos );
    float tunerFacing = abs( dot( tunerFaceNormal, tunerViewDir ) );
    float tunerRim = pow( clamp( 1.0 - tunerFacing, 0.0, 1.0 ), uRimPower );
    float tunerNear = 1.0 - smoothstep( uRimFade * 0.35, uRimFade, length( vTunerViewPos ) );

    float tunerEdgeInfect = clamp( uInfection * uInfectionResponse, 0.0, 1.0 );
    float tunerPulse = 0.5 + 0.5 * sin( uTime * 5.5 - vTunerWorldPos.y * 1.4 );
    // Detuned edges pulse magenta, out of phase with anything the player does.
    vec3 tunerEdge = mix( uRimColour, uPulseColour * ( 0.45 + 0.55 * tunerPulse ), tunerEdgeInfect );
    totalEmissiveRadiance += tunerEdge * tunerRim * uRimStrength * tunerNear;

    // Luminous growth. Only tuned matter glows, and it breathes slowly enough
    // to read as alive rather than as a flashing light.
    float tunerAlive = clamp( uRestoration * ( 1.0 - tunerEdgeInfect ), 0.0, 1.0 );
    float tunerBreath = 0.72 + 0.28 * sin( uTime * 1.3 + vTunerWorldPos.y * 0.8 );
    totalEmissiveRadiance += uGlowColour * uGlowStrength * tunerAlive * tunerBreath;
  }
`;

/**
 * Splices `addition` in after `token`, or appends it if the chunk is missing.
 *
 * Three.js renames shader chunks between releases. Failing loudly on a rename
 * would black-screen the game; degrading to an appended block keeps it drawing
 * while the shader stops responding, which is a far better failure mode.
 */
function spliceAfter(source: string, token: string, addition: string): string {
  if (source.includes(token)) {
    return source.replace(token, `${token}\n${addition}`);
  }
  return `${source}\n${addition}`;
}

function spliceBeforeMain(source: string, addition: string): string {
  const index = source.indexOf('void main');
  if (index < 0) return `${addition}\n${source}`;
  return `${source.slice(0, index)}${addition}\n${source.slice(index)}`;
}

/**
 * Injects the resonance treatment into a compiled-but-not-yet-linked shader.
 *
 * Exported so it can be exercised headlessly: the injection is the part most
 * likely to break silently on a Three.js upgrade, and a test that feeds it a
 * plain object catches that without a GPU.
 */
export function injectResonanceShader(
  shader: InjectableShader,
  style: SurfaceStyle,
  surface: SurfaceProfile,
  shared: ResonanceUniforms,
): void {
  shader.uniforms.uInfection = shared.uInfection;
  shader.uniforms.uRestoration = shared.uRestoration;
  shader.uniforms.uTime = shared.uTime;
  shader.uniforms.uBaseColour = { value: surface.baseColour };
  shader.uniforms.uInfectedColour = { value: surface.infectedColour };
  shader.uniforms.uRestoredColour = { value: surface.restoredColour };
  shader.uniforms.uRimColour = { value: surface.rimColour };
  shader.uniforms.uSeamColour = { value: surface.seamColour };
  shader.uniforms.uLineColour = { value: surface.lineColour };
  shader.uniforms.uPulseColour = { value: surface.pulseColour };
  shader.uniforms.uGlowColour = { value: surface.glowColour };
  shader.uniforms.uGlowStrength = { value: surface.glowStrength };
  shader.uniforms.uInfectionResponse = { value: surface.infectionResponse };
  shader.uniforms.uBandScale = { value: surface.bandScale };
  shader.uniforms.uBandStrength = { value: surface.bandStrength };
  shader.uniforms.uSeamScale = { value: surface.seamScale };
  shader.uniforms.uSeamStrength = { value: surface.seamStrength };
  shader.uniforms.uLineScale = { value: surface.lineScale };
  shader.uniforms.uLineStrength = { value: surface.lineStrength };
  shader.uniforms.uRimStrength = { value: surface.rimStrength };
  shader.uniforms.uRimPower = { value: surface.rimPower };
  shader.uniforms.uRimFade = { value: surface.rimFade };
  shader.uniforms.uFlowSpeed = { value: surface.flowSpeed };
  shader.uniforms.uFaceShade = { value: surface.faceShade };

  let vertex = spliceAfter(shader.vertexShader, '#include <common>', VARYING_DECLARATIONS);
  vertex = spliceAfter(vertex, '#include <beginnormal_vertex>', VERTEX_WORLD_NORMAL);
  vertex = spliceAfter(vertex, '#include <begin_vertex>', VERTEX_WORLD_POSITION);
  vertex = spliceAfter(vertex, '#include <project_vertex>', VERTEX_VIEW_POSITION);
  shader.vertexShader = vertex;

  let fragment = spliceAfter(
    shader.fragmentShader,
    '#include <common>',
    `${VARYING_DECLARATIONS}${FRAGMENT_UNIFORMS}`,
  );
  fragment = spliceAfter(fragment, '#include <map_fragment>', FRAGMENT_DIFFUSE);
  if (fragment.includes('#include <emissivemap_fragment>')) {
    fragment = spliceAfter(fragment, '#include <emissivemap_fragment>', FRAGMENT_RIM);
  }
  shader.fragmentShader = fragment;

  // Tag the style into the source so a shader-graph dump names its origin.
  shader.fragmentShader = spliceBeforeMain(shader.fragmentShader, `// tuner-surface: ${style}`);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** What the registry records about each material it owns. */
interface MaterialRecord {
  readonly material: THREE.Material;
  readonly style: SurfaceStyle;
  readonly tier: GraphicsTier;
  readonly profile: SurfaceProfile;
  /** True when the resonance shader was spliced in; false at the `low` tier. */
  readonly injected: boolean;
}

/** Metadata stamped onto every material's `userData`, for tooling and tests. */
export interface SurfaceMaterialInfo {
  readonly style: SurfaceStyle;
  readonly tier: GraphicsTier;
  readonly injected: boolean;
}

const scratchColour = new THREE.Color();
/** Shared read-only black, so the flat-colour path never allocates. */
const BLACK = new THREE.Color(0x000000);

function surfaceKey(style: SurfaceStyle, tier: GraphicsTier): string {
  return `${style}:${tier}`;
}

/**
 * A cache of shared surface materials plus the uniforms that retune them.
 *
 * Instances are cheap; the shared `surfaceMaterials` registry below is the one
 * the renderer uses, and a fresh one is handy in tests and in the stage editor.
 */
export class MaterialRegistry {
  /** Shared by reference with every injected shader compiled from this registry. */
  readonly uniforms: ResonanceUniforms = {
    uInfection: { value: 0 },
    uRestoration: { value: 1 },
    uTime: { value: 0 },
  };

  private readonly records = new Map<string, MaterialRecord>();
  /** Materials whose colour has to be recomputed on the CPU (the `low` tier). */
  private readonly flatRecords: MaterialRecord[] = [];
  private readonly glowMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly outlineMaterials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(readonly defaultTier: GraphicsTier = 'high') {}

  /** How many materials are currently alive. Zero after `dispose()`. */
  get size(): number {
    return this.records.size + this.glowMaterials.size + this.outlineMaterials.size;
  }

  get infection(): number {
    return this.uniforms.uInfection.value;
  }

  get restoration(): number {
    return this.uniforms.uRestoration.value;
  }

  /**
   * Retunes every surface at once.
   *
   * This writes a single shared uniform — it never rebuilds or replaces a
   * material, so calling it every frame from the render loop is free.
   */
  setInfection(value: number): void {
    const next = clamp01(value);
    if (next === this.uniforms.uInfection.value) return;
    this.uniforms.uInfection.value = next;
    this.refreshFlatColours();
  }

  setRestoration(value: number): void {
    const next = clamp01(value);
    if (next === this.uniforms.uRestoration.value) return;
    this.uniforms.uRestoration.value = next;
    this.refreshFlatColours();
  }

  /** Drives the flowing styles and the edge pulses. */
  setTime(seconds: number): void {
    this.uniforms.uTime.value = seconds;
  }

  /**
   * The shared material for a style at a tier.
   *
   * Always returns the same instance for the same pair until `dispose()`.
   */
  get(style: SurfaceStyle, tier: GraphicsTier = this.defaultTier): THREE.Material {
    const key = surfaceKey(style, tier);
    const existing = this.records.get(key);
    if (existing) return existing.material;

    const record = this.build(style, tier);
    this.records.set(key, record);
    if (!record.injected) {
      this.flatRecords.push(record);
      this.applyFlatColour(record);
    }
    return record.material;
  }

  /** Whether a material for this pair has already been built. */
  has(style: SurfaceStyle, tier: GraphicsTier = this.defaultTier): boolean {
    return this.records.has(surfaceKey(style, tier));
  }

  /**
   * An unlit luminous material, for resonance rails, string curtains and other
   * elements that read as light rather than as surface.
   */
  glow(hex: string, opacity = 0.85): THREE.MeshBasicMaterial {
    const key = `${hex}:${opacity.toFixed(3)}`;
    const existing = this.glowMaterials.get(key);
    if (existing) return existing;
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    material.userData.tunerGlow = hex;
    this.glowMaterials.set(key, material);
    return material;
  }

  /**
   * The inverted-hull companion to the in-shader rim.
   *
   * Drawn on a back-face copy of a hero prop it produces a hard, even outline
   * of a chosen thickness — used sparingly on landmarks, where the fresnel rim
   * alone is too soft to carry a silhouette at distance.
   */
  outline(hex: string = ART.gold): THREE.MeshBasicMaterial {
    const existing = this.outlineMaterials.get(hex);
    if (existing) return existing;
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      side: THREE.BackSide,
      toneMapped: false,
      fog: false,
    });
    material.userData.tunerOutline = hex;
    this.outlineMaterials.set(hex, material);
    return material;
  }

  /**
   * Frees every material this registry owns.
   *
   * Leaked materials keep their compiled programs and uniform buffers alive,
   * which on mobile shows up as a steady climb across stage transitions until
   * the tab is killed. A later `get()` rebuilds transparently.
   */
  dispose(): void {
    for (const record of this.records.values()) {
      record.material.dispose();
    }
    this.records.clear();
    this.flatRecords.length = 0;
    for (const material of this.glowMaterials.values()) {
      material.dispose();
    }
    this.glowMaterials.clear();
    for (const material of this.outlineMaterials.values()) {
      material.dispose();
    }
    this.outlineMaterials.clear();
  }

  // -------------------------------------------------------------------------

  private build(style: SurfaceStyle, tier: GraphicsTier): MaterialRecord {
    const surface = SURFACE_PROFILES[style];

    if (surface.invisible) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      material.visible = false;
      return this.finish(material, style, tier, surface, false);
    }

    if (tier === 'low') {
      // No injection: a flat lambert surface, retuned on the CPU. This is the
      // tier that has to hold 60 fps on a four-year-old phone, and a hand-written
      // fragment stage is the first thing to go. The palette split survives —
      // it is the one thing that must never be a quality setting.
      const material = new THREE.MeshLambertMaterial({
        color: surface.baseColour.clone(),
        transparent: surface.transparent,
        opacity: surface.opacity,
        depthWrite: surface.depthWrite,
        side: surface.side,
        flatShading: surface.flatShading,
        emissive: surface.emissiveColour
          ? surface.emissiveColour.clone()
          : new THREE.Color(0x000000),
        emissiveIntensity: surface.emissiveIntensity * 0.6,
        fog: true,
      });
      return this.finish(material, style, tier, surface, false);
    }

    const material =
      tier === 'high'
        ? new THREE.MeshStandardMaterial({
            color: surface.baseColour.clone(),
            roughness: surface.roughness,
            metalness: surface.metalness,
            flatShading: surface.flatShading,
          })
        : new THREE.MeshLambertMaterial({
            color: surface.baseColour.clone(),
            flatShading: surface.flatShading,
          });

    material.transparent = surface.transparent;
    material.opacity = surface.opacity;
    material.depthWrite = surface.depthWrite;
    material.side = surface.side;
    material.emissive = surface.emissiveColour
      ? surface.emissiveColour.clone()
      : new THREE.Color(0x000000);
    material.emissiveIntensity = surface.emissiveIntensity;

    material.onBeforeCompile = (shader) => {
      injectResonanceShader(shader, style, surface, this.uniforms);
    };
    // Without a stable cache key Three.js hashes `onBeforeCompile.toString()`,
    // which is identical for every style here and would let two styles share one
    // linked program.
    material.customProgramCacheKey = () => `tuner-surface:${style}:${tier}`;

    return this.finish(material, style, tier, surface, true);
  }

  private finish(
    material: THREE.Material,
    style: SurfaceStyle,
    tier: GraphicsTier,
    surface: SurfaceProfile,
    injected: boolean,
  ): MaterialRecord {
    const info: SurfaceMaterialInfo = { style, tier, injected };
    material.name = `tuner-${style}-${tier}`;
    material.userData.tuner = info;
    return { material, style, tier, profile: surface, injected };
  }

  /**
   * CPU-side equivalent of the shader blend, for the `low` tier.
   *
   * The colour comes from the same `resolveSurfaceColour()` the shader mirrors.
   * A detuned surface also picks up a faint magenta emission here, because the
   * `low` tier has no rim pass to carry the infection's edge pulse and the tell
   * has to survive anyway.
   */
  private applyFlatColour(record: MaterialRecord): void {
    const material = record.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) return;
    const surface = record.profile;
    if (surface.invisible) return;
    const infection = this.uniforms.uInfection.value;
    const restoration = this.uniforms.uRestoration.value;
    resolveSurfaceColour(record.style, infection, restoration, scratchColour);
    material.color.copy(scratchColour);

    const infect = clamp01(infection * surface.infectionResponse);
    material.emissive
      .copy(surface.emissiveColour ?? BLACK)
      .lerp(surface.pulseColour, infect * 0.75);
    material.emissiveIntensity = Math.max(surface.emissiveIntensity * 0.6, infect * 0.22);
  }

  private refreshFlatColours(): void {
    for (const record of this.flatRecords) {
      this.applyFlatColour(record);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared default registry
// ---------------------------------------------------------------------------

/**
 * The registry the renderer uses.
 *
 * A module-level singleton is the right call here precisely because sharing is
 * the point: two scenes drawing the same stage must reuse one set of materials,
 * and the infection uniform must be one object no matter who writes it.
 */
export const surfaceMaterials = new MaterialRegistry('high');

export function getSurfaceMaterial(style: SurfaceStyle, tier: GraphicsTier): THREE.Material {
  return surfaceMaterials.get(style, tier);
}

/** Retunes every surface drawn from the shared registry. */
export function setSurfaceInfection(infection: number): void {
  surfaceMaterials.setInfection(infection);
  surfaceMaterials.setRestoration(1 - clamp01(infection));
}

export function disposeSurfaceMaterials(): void {
  surfaceMaterials.dispose();
}
