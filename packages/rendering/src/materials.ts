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
 * Three things make this file worth its length:
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
 * 3. **The edge treatment is in-shader.** A derivative-based facet rim gives the
 *    clean geometric outline the art direction asks for without a post-process
 *    outline pass, which would cost a full-screen depth/normal prepass that a
 *    mid-range phone cannot spare.
 *
 * At the `low` graphics tier the shader injection is dropped entirely and the
 * styles fall back to plain flat-shaded colours; infection still retunes them,
 * but on the CPU (there are at most a dozen materials) rather than per pixel.
 */

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
  /** Seconds since the stage began, for the few surfaces that flow. */
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
  /** Colour of the silhouette rim and of the sacred-geometry seams. */
  readonly rimColour: THREE.Color;
  readonly seamColour: THREE.Color;
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
  /** Lattice seams per metre across the ground plane. */
  readonly seamScale: number;
  readonly seamStrength: number;
  readonly rimStrength: number;
  /** Higher tightens the rim into a thinner outline. */
  readonly rimPower: number;
  /** Bands per second of scroll. Non-zero only for water and ember. */
  readonly flowSpeed: number;
  /** Skipped entirely by the geometry builders; still resolves to a material. */
  readonly invisible: boolean;
}

const colour = (hex: string): THREE.Color => new THREE.Color(hex);

/** Deep navy sanctuary stone — the ground note of the whole palette. */
const STONE = '#28315e';
const STONE_CARVED = '#313c72';
const SAND = '#b39a63';
const METAL = '#59628f';
const ROOT = '#2c6b52';
const EMBER = '#7d3128';

interface ProfileOverrides extends Partial<SurfaceProfile> {
  readonly baseColour: THREE.Color;
}

function profile(overrides: ProfileOverrides): SurfaceProfile {
  return {
    infectedColour: colour(PALETTE.infectionDeep),
    restoredColour: colour(PALETTE.resonanceDeep),
    rimColour: colour(PALETTE.gold),
    seamColour: colour(PALETTE.goldDim),
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
    rimStrength: 0.22,
    rimPower: 3,
    flowSpeed: 0,
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
 */
export const SURFACE_PROFILES: Readonly<Record<SurfaceStyle, SurfaceProfile>> = {
  stone: profile({
    baseColour: colour(STONE),
    bandScale: 0.42,
    bandStrength: 0.18,
    rimStrength: 0.2,
  }),
  'stone-carved': profile({
    // The Keepers cut their geometry into everything they built, so this style
    // carries the gold lattice that reads as sacred stonework from a distance.
    baseColour: colour(STONE_CARVED),
    seamScale: 0.5,
    seamStrength: 0.42,
    bandScale: 0.7,
    bandStrength: 0.24,
    rimStrength: 0.42,
    rimPower: 2.4,
  }),
  root: profile({
    baseColour: colour(ROOT),
    restoredColour: colour(PALETTE.restore),
    rimColour: colour(PALETTE.restore),
    seamColour: colour(PALETTE.restoreDeep),
    emissiveColour: colour(PALETTE.restoreDeep),
    emissiveIntensity: 0.16,
    roughness: 1,
    bandScale: 0.9,
    bandStrength: 0.3,
    rimStrength: 0.3,
  }),
  crystal: profile({
    baseColour: colour(PALETTE.resonanceDeep),
    restoredColour: colour(PALETTE.resonance),
    infectedColour: colour(PALETTE.infection),
    rimColour: colour(PALETTE.resonance),
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0.08,
    bandScale: 1.1,
    bandStrength: 0.22,
    rimStrength: 0.8,
    rimPower: 2,
  }),
  glass: profile({
    baseColour: colour(PALETTE.resonance),
    restoredColour: colour(PALETTE.resonance),
    rimColour: colour(PALETTE.resonance),
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.22,
    roughness: 0.05,
    opacity: 0.34,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    bandStrength: 0.1,
    rimStrength: 0.95,
    rimPower: 1.8,
    infectionResponse: 0.75,
  }),
  metal: profile({
    baseColour: colour(METAL),
    roughness: 0.34,
    metalness: 0.82,
    bandScale: 0.3,
    bandStrength: 0.12,
    seamScale: 0.75,
    seamStrength: 0.16,
    rimStrength: 0.34,
    infectionResponse: 0.8,
  }),
  water: profile({
    baseColour: colour(PALETTE.resonanceDeep),
    restoredColour: colour(PALETTE.resonance),
    rimColour: colour(PALETTE.resonance),
    emissiveColour: colour(PALETTE.resonanceDeep),
    emissiveIntensity: 0.2,
    roughness: 0.1,
    opacity: 0.62,
    transparent: true,
    depthWrite: false,
    flatShading: false,
    bandScale: 1.6,
    bandStrength: 0.34,
    rimStrength: 0.42,
    flowSpeed: 0.14,
  }),
  sand: profile({
    baseColour: colour(SAND),
    roughness: 1,
    bandScale: 0.24,
    bandStrength: 0.12,
    rimStrength: 0.14,
    infectionResponse: 0.85,
  }),
  ember: profile({
    baseColour: colour(EMBER),
    infectedColour: colour(PALETTE.infection),
    restoredColour: colour(PALETTE.alarm),
    rimColour: colour(PALETTE.alarm),
    emissiveColour: colour(PALETTE.alarm),
    emissiveIntensity: 0.62,
    roughness: 0.7,
    bandScale: 0.85,
    bandStrength: 0.42,
    rimStrength: 0.5,
    flowSpeed: 0.22,
    infectionResponse: 0.6,
  }),
  infected: profile({
    // Already the colour of the disease: it barely moves under infection, and
    // instead swings hard toward green as the region comes back.
    baseColour: colour(PALETTE.infection),
    infectedColour: colour(PALETTE.infection),
    restoredColour: colour(PALETTE.restore),
    rimColour: colour(PALETTE.infection),
    seamColour: colour(PALETTE.infectionDeep),
    emissiveColour: colour(PALETTE.infectionDeep),
    emissiveIntensity: 0.5,
    roughness: 0.42,
    infectionResponse: 0.25,
    bandScale: 1.35,
    bandStrength: 0.34,
    rimStrength: 0.72,
    rimPower: 2.2,
  }),
  restored: profile({
    baseColour: colour(PALETTE.restore),
    restoredColour: colour(PALETTE.restore),
    rimColour: colour(PALETTE.restore),
    seamColour: colour(PALETTE.gold),
    emissiveColour: colour(PALETTE.restoreDeep),
    emissiveIntensity: 0.38,
    roughness: 0.5,
    infectionResponse: 0.2,
    bandScale: 0.8,
    bandStrength: 0.26,
    rimStrength: 0.6,
  }),
  'gold-trim': profile({
    baseColour: colour(PALETTE.gold),
    restoredColour: colour(PALETTE.gold),
    infectedColour: colour(PALETTE.infectionDeep),
    rimColour: colour(PALETTE.gold),
    seamColour: colour(PALETTE.goldDim),
    emissiveColour: colour(PALETTE.goldDim),
    emissiveIntensity: 0.24,
    roughness: 0.28,
    metalness: 0.68,
    seamScale: 1.2,
    seamStrength: 0.2,
    bandStrength: 0.1,
    rimStrength: 1,
    rimPower: 1.6,
    infectionResponse: 0.55,
  }),
  invisible: profile({
    baseColour: colour(PALETTE.abyss),
    opacity: 0,
    transparent: true,
    depthWrite: false,
    rimStrength: 0,
    bandStrength: 0,
    invisible: true,
  }),
};

/** Every authored surface style, derived from the profile table so the two
 *  can never drift apart. */
export const SURFACE_STYLES: readonly SurfaceStyle[] = Object.keys(
  SURFACE_PROFILES,
) as SurfaceStyle[];

// ---------------------------------------------------------------------------
// Shader injection
// ---------------------------------------------------------------------------

const VARYING_DECLARATIONS = /* glsl */ `
varying vec3 vTunerWorldPos;
varying vec3 vTunerViewPos;
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
uniform float uInfectionResponse;
uniform float uBandScale;
uniform float uBandStrength;
uniform float uSeamScale;
uniform float uSeamStrength;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uFlowSpeed;
`;

/**
 * Retunes the diffuse colour.
 *
 * Three layers, in order: the healthy/restored/infected blend, a two-step flat
 * band that gives the surface a little vertical stratification without a
 * gradient, and an axis-aligned lattice that reads as Keeper stonework. Nine
 * arithmetic instructions and two `smoothstep`s — no loops, no noise, no
 * texture fetches.
 */
const FRAGMENT_DIFFUSE = /* glsl */ `
  {
    float tunerInfect = clamp( uInfection * uInfectionResponse, 0.0, 1.0 );
    vec3 tunerHealthy = mix( uBaseColour, uRestoredColour, uRestoration );
    vec3 tunerTuned = mix( tunerHealthy, uInfectedColour, tunerInfect );

    float tunerBand = fract( vTunerWorldPos.y * uBandScale + uTime * uFlowSpeed );
    float tunerLayer = step( 0.5, tunerBand ) * 0.6 + step( 0.84, tunerBand ) * 0.4;
    tunerTuned = mix( tunerTuned, tunerTuned * 1.18, tunerLayer * uBandStrength );

    vec2 tunerSeam = abs( fract( vTunerWorldPos.xz * uSeamScale ) - 0.5 );
    float tunerLattice = 1.0 - smoothstep( 0.0, 0.045, min( tunerSeam.x, tunerSeam.y ) );
    tunerTuned = mix( tunerTuned, uSeamColour, tunerLattice * uSeamStrength );

    diffuseColor.rgb = tunerTuned;
  }
`;

/**
 * The silhouette edge.
 *
 * The face normal is recovered from screen-space derivatives of the view
 * position rather than from the interpolated normal, so the rim traces the
 * *facets* of the low-poly form — which is exactly the clean geometric outline
 * the art direction calls for — and stays correct under flat shading,
 * instancing and skinning alike. Two derivatives and a `pow`; no prepass, no
 * render target, no second draw of the scene.
 */
const FRAGMENT_RIM = /* glsl */ `
  {
    vec3 tunerDx = dFdx( vTunerViewPos );
    vec3 tunerDy = dFdy( vTunerViewPos );
    vec3 tunerFaceNormal = normalize( cross( tunerDx, tunerDy ) );
    vec3 tunerViewDir = normalize( -vTunerViewPos );
    float tunerFacing = abs( dot( tunerFaceNormal, tunerViewDir ) );
    float tunerRim = pow( clamp( 1.0 - tunerFacing, 0.0, 1.0 ), uRimPower );
    totalEmissiveRadiance += uRimColour * tunerRim * uRimStrength;
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
  shader.uniforms.uInfectionResponse = { value: surface.infectionResponse };
  shader.uniforms.uBandScale = { value: surface.bandScale };
  shader.uniforms.uBandStrength = { value: surface.bandStrength };
  shader.uniforms.uSeamScale = { value: surface.seamScale };
  shader.uniforms.uSeamStrength = { value: surface.seamStrength };
  shader.uniforms.uRimStrength = { value: surface.rimStrength };
  shader.uniforms.uRimPower = { value: surface.rimPower };
  shader.uniforms.uFlowSpeed = { value: surface.flowSpeed };

  let vertex = spliceAfter(shader.vertexShader, '#include <common>', VARYING_DECLARATIONS);
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

  /** Drives the two flowing styles (water, ember). Everything else ignores it. */
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
  outline(hex: string = PALETTE.gold): THREE.MeshBasicMaterial {
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
      // fragment stage is the first thing to go.
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

  /** CPU-side equivalent of the shader blend, for the `low` tier. */
  private applyFlatColour(record: MaterialRecord): void {
    const material = record.material;
    if (!(material instanceof THREE.MeshLambertMaterial)) return;
    const surface = record.profile;
    scratchColour
      .copy(surface.baseColour)
      .lerp(surface.restoredColour, this.uniforms.uRestoration.value)
      .lerp(
        surface.infectedColour,
        clamp01(this.uniforms.uInfection.value * surface.infectionResponse),
      );
    material.color.copy(scratchColour);
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
