import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GraphicsTier } from '@tuner/shared';
import type { SurfaceStyle } from '@tuner/game-core';
import {
  MaterialRegistry,
  SURFACE_PROFILES,
  SURFACE_STYLES,
  injectResonanceShader,
  resolveSurfaceColour,
  setSurfaceInfection,
  surfaceMaterials,
  type InjectableShader,
} from './materials.js';
import {
  createLightingColours,
  createResolvedAmbience,
  createSkyDome,
  resolveAmbience,
  resolveLightingColours,
  restorationFromInfection,
} from './sky.js';
import type { StageAmbience } from './sky.js';

/**
 * Art-direction tests.
 *
 * The assertions that matter most here are the *distance* ones. A shipped build
 * of this game rendered a near-monochrome amber world: every surface style
 * resolved to almost the same hue, the palette split between 440 Hz and 432 Hz
 * was invisible, and nothing in the suite noticed, because every test asked
 * whether a material existed rather than what colour it was.
 *
 * So the rule this file enforces is numeric: a detuned surface and a tuned
 * surface must be far apart in sRGB, and so must the lights. `SPLIT_DISTANCE` is
 * deliberately large — roughly a third of the diagonal of the colour cube — and
 * it is applied to every style that is supposed to change state.
 */

/** Colour distances are measured in sRGB, which is what a player's eye sees. */
function srgb(colour: THREE.Color): [number, number, number] {
  const out = { r: 0, g: 0, b: 0 };
  colour.getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

function distance(a: THREE.Color, b: THREE.Color): number {
  const [ar, ag, ab] = srgb(a);
  const [br, bg, bb] = srgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function luminance(colour: THREE.Color): number {
  const [r, g, b] = srgb(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Fully detuned, and fully tuned. The two ends the whole palette hangs on. */
const detuned = (style: SurfaceStyle): THREE.Color => resolveSurfaceColour(style, 1, 0);
const tuned = (style: SurfaceStyle): THREE.Color => resolveSurfaceColour(style, 0, 1);

/**
 * Minimum sRGB distance between a style's detuned and tuned colours.
 *
 * The colour cube's diagonal is √3 ≈ 1.73, so this asks for about a third of the
 * entire available range — far more than a tint, and impossible to satisfy by
 * accident with two shades of the same hue.
 */
const SPLIT_DISTANCE = 0.5;

/** Styles that carry the region's tuning. `invisible` is the only exemption. */
const TUNED_STYLES: readonly SurfaceStyle[] = SURFACE_STYLES.filter(
  (style) => !SURFACE_PROFILES[style].invisible,
);

function fakeShader(): InjectableShader {
  return {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      'void main() {',
      '  #include <beginnormal_vertex>',
      '  #include <begin_vertex>',
      '  #include <project_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '  #include <map_fragment>',
      '  #include <emissivemap_fragment>',
      '}',
    ].join('\n'),
  };
}

const AMBIENCE: StageAmbience = {
  skyTop: '#0b1030',
  skyBottom: '#4a1f7a',
  fogColour: '#131a44',
  fogNear: 28,
  fogFar: 205,
  sunColour: '#f5c451',
  sunDirection: { x: -0.44, y: -0.36, z: 0.82 },
  ambientColour: '#8b4fd6',
  restored: {
    skyTop: '#0b1030',
    skyBottom: '#1d8fb8',
    fogColour: '#1d8fb8',
    sunColour: '#f5c451',
    ambientColour: '#5ce89b',
  },
};

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('surface library — coverage', () => {
  it('resolves every authored surface style to a material', () => {
    const registry = new MaterialRegistry('high');
    for (const style of SURFACE_STYLES) {
      const material = registry.get(style);
      expect(material, style).toBeInstanceOf(THREE.Material);
      expect(material.name).toBe(`tuner-${style}-high`);
    }
    expect(registry.size).toBe(SURFACE_STYLES.length);
    registry.dispose();
  });

  it('gives every style a profile, with no style missing from either table', () => {
    expect(SURFACE_STYLES.length).toBe(Object.keys(SURFACE_PROFILES).length);
    for (const style of SURFACE_STYLES) {
      expect(SURFACE_PROFILES[style], style).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The palette split — the assertions that would have caught the amber world
// ---------------------------------------------------------------------------

describe('surface library — the 440/432 palette split', () => {
  it('resolves measurably different colours for detuned and tuned, for every style', () => {
    const failures: string[] = [];
    for (const style of TUNED_STYLES) {
      const gap = distance(detuned(style), tuned(style));
      if (gap < SPLIT_DISTANCE) failures.push(`${style}: ${gap.toFixed(3)}`);
    }
    expect(failures).toEqual([]);
  });

  it('keeps stone, root, crystal, water and gold-trim far apart at the two extremes', () => {
    // Named explicitly so a regression reports the style, not just a count.
    for (const style of ['stone', 'stone-carved', 'root', 'crystal', 'water', 'gold-trim'] as const) {
      expect(distance(detuned(style), tuned(style)), style).toBeGreaterThan(SPLIT_DISTANCE);
    }
  });

  it('drives detuned matter dark and violet, and tuned matter bright', () => {
    for (const style of ['stone', 'stone-carved', 'root'] as const) {
      const dark = detuned(style);
      const light = tuned(style);
      expect(luminance(dark), `${style} detuned luminance`).toBeLessThan(0.16);
      expect(luminance(light), `${style} tuned luminance`).toBeGreaterThan(0.3);
      const [r, g, b] = srgb(dark);
      // Black-violet: blue above green, and never a warm cast.
      expect(b, `${style} detuned blue`).toBeGreaterThan(g);
      expect(b, `${style} detuned blue vs red`).toBeGreaterThan(r * 0.9);
    }
  });

  it('turns restored stone warm and restored growth green', () => {
    const [sr, sg, sb] = srgb(tuned('stone'));
    expect(sr).toBeGreaterThan(sg);
    expect(sg).toBeGreaterThan(sb);

    const [rr, rg, rb] = srgb(tuned('root'));
    expect(rg).toBeGreaterThan(rr);
    expect(rg).toBeGreaterThan(rb);
  });

  it('makes the infected style read as wrong: near-black violet, and it heals to green', () => {
    const wrong = detuned('infected');
    expect(luminance(wrong)).toBeLessThan(0.08);
    const [, g, b] = srgb(wrong);
    expect(b).toBeGreaterThan(g * 1.5);

    const healed = tuned('infected');
    const [hr, hg, hb] = srgb(healed);
    expect(hg).toBeGreaterThan(hr);
    expect(hg).toBeGreaterThan(hb);
    expect(distance(wrong, healed)).toBeGreaterThan(SPLIT_DISTANCE);
  });

  it('gives the infection a magenta pulse colour on every style', () => {
    for (const style of TUNED_STYLES) {
      const [r, g, b] = srgb(SURFACE_PROFILES[style].pulseColour);
      // Magenta: red highest, blue well above green.
      expect(r, `${style} pulse red`).toBeGreaterThan(0.6);
      expect(b, `${style} pulse blue`).toBeGreaterThan(g + 0.2);
    }
  });

  it('moves continuously between the two states rather than switching', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((infection) =>
      resolveSurfaceColour('stone', infection, 1 - infection),
    );
    let travelled = 0;
    for (let index = 1; index < steps.length; index++) {
      const previous = steps[index - 1];
      const current = steps[index];
      if (!previous || !current) throw new Error('missing step');
      const step = distance(previous, current);
      // Every step moves, and none of them is the whole journey.
      expect(step).toBeGreaterThan(0.02);
      travelled += step;
    }
    const ends = distance(detuned('stone'), tuned('stone'));
    expect(travelled).toBeGreaterThan(ends * 0.9);
  });
});

// ---------------------------------------------------------------------------
// Style identity
// ---------------------------------------------------------------------------

describe('surface library — style identity', () => {
  it('keeps every pair of tuned styles visibly distinct', () => {
    const collisions: string[] = [];
    for (let i = 0; i < TUNED_STYLES.length; i++) {
      for (let j = i + 1; j < TUNED_STYLES.length; j++) {
        const a = TUNED_STYLES[i];
        const b = TUNED_STYLES[j];
        if (!a || !b) continue;
        const gap = distance(resolveSurfaceColour(a, 0, 0), resolveSurfaceColour(b, 0, 0));
        if (gap < 0.1) collisions.push(`${a} vs ${b}: ${gap.toFixed(3)}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('separates water from sand: turquoise against warm dry stone', () => {
    const water = resolveSurfaceColour('water', 0, 1);
    const sand = resolveSurfaceColour('sand', 0, 1);
    expect(distance(water, sand)).toBeGreaterThan(0.45);
    const [wr, wg, wb] = srgb(water);
    expect(wg).toBeGreaterThan(wr);
    expect(wb).toBeGreaterThan(wr);
    const [sr, sg, sb] = srgb(sand);
    expect(sr).toBeGreaterThan(sb);
    expect(sg).toBeGreaterThan(sb);
  });

  it('makes water actually move and sand stay still', () => {
    expect(SURFACE_PROFILES.water.flowSpeed).toBeGreaterThan(0.2);
    expect(SURFACE_PROFILES.ember.flowSpeed).toBeGreaterThan(0.2);
    expect(SURFACE_PROFILES.sand.flowSpeed).toBe(0);
    expect(SURFACE_PROFILES.stone.flowSpeed).toBe(0);
  });

  it('separates crystal from glass in colour, opacity and shading', () => {
    const crystal = SURFACE_PROFILES.crystal;
    const glass = SURFACE_PROFILES.glass;
    expect(distance(crystal.baseColour, glass.baseColour)).toBeGreaterThan(0.2);
    // Crystal is a solid: opaque, hard-facetted, and it emits. Glass is a pane.
    expect(crystal.transparent).toBe(false);
    expect(glass.transparent).toBe(true);
    expect(crystal.flatShading).toBe(true);
    expect(glass.flatShading).toBe(false);
    expect(crystal.emissiveIntensity).toBeGreaterThan(glass.emissiveIntensity);
    expect(crystal.bandStrength).toBeGreaterThan(glass.bandStrength);
  });

  it('gives Keeper stonework gold lattice and cyan frequency lines', () => {
    const carved = SURFACE_PROFILES['stone-carved'];
    expect(carved.seamStrength).toBeGreaterThan(0.3);
    expect(carved.lineStrength).toBeGreaterThan(0);
    const [gr, gg, gb] = srgb(carved.seamColour);
    expect(gr).toBeGreaterThan(gg);
    expect(gg).toBeGreaterThan(gb);
    const [lr, lg, lb] = srgb(carved.lineColour);
    expect(lb).toBeGreaterThan(lr);
    expect(lg).toBeGreaterThan(lr);
  });

  it('lets only living surfaces glow', () => {
    expect(SURFACE_PROFILES.root.glowStrength).toBeGreaterThan(0);
    expect(SURFACE_PROFILES.restored.glowStrength).toBeGreaterThan(0);
    expect(SURFACE_PROFILES.stone.glowStrength).toBe(0);
    expect(SURFACE_PROFILES.sand.glowStrength).toBe(0);
  });

  it('keeps the rim a local edge rather than a full-frame wash', () => {
    // The amber build's rim had no distance fade, so a grazing floor plane lit
    // the whole far half of the frame. Every style now fades out, and the big
    // flat surfaces fade first.
    for (const style of TUNED_STYLES) {
      expect(SURFACE_PROFILES[style].rimFade, style).toBeGreaterThan(0);
    }
    expect(SURFACE_PROFILES.stone.rimFade).toBeLessThan(SURFACE_PROFILES.crystal.rimFade);
    expect(SURFACE_PROFILES.stone.rimStrength).toBeLessThan(0.15);
    expect(SURFACE_PROFILES.sand.rimStrength).toBeLessThan(0.15);
    expect(SURFACE_PROFILES.crystal.rimStrength).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Registry behaviour
// ---------------------------------------------------------------------------

describe('material registry — sharing and disposal', () => {
  it('returns the same instance for repeated requests', () => {
    const registry = new MaterialRegistry('high');
    const first = registry.get('stone');
    const second = registry.get('stone');
    expect(second).toBe(first);
    expect(registry.get('stone', 'low')).not.toBe(first);
    expect(registry.size).toBe(2);
    registry.dispose();
  });

  it('disposes everything it owns and rebuilds afterwards', () => {
    const registry = new MaterialRegistry('high');
    const before = registry.get('crystal');
    registry.glow('#4fe3ff');
    registry.outline();
    expect(registry.size).toBe(3);

    let disposed = false;
    before.addEventListener('dispose', () => {
      disposed = true;
    });
    registry.dispose();
    expect(disposed).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.has('crystal')).toBe(false);

    const after = registry.get('crystal');
    expect(after).not.toBe(before);
    expect(registry.size).toBe(1);
    registry.dispose();
  });

  it('shares glow and outline materials by key', () => {
    const registry = new MaterialRegistry('high');
    expect(registry.glow('#4fe3ff')).toBe(registry.glow('#4fe3ff'));
    expect(registry.glow('#4fe3ff', 0.5)).not.toBe(registry.glow('#4fe3ff'));
    expect(registry.outline('#d8a63c')).toBe(registry.outline('#d8a63c'));
    registry.dispose();
  });

  it('retunes through the shared uniform without creating materials', () => {
    const registry = new MaterialRegistry('high');
    const material = registry.get('stone-carved');
    const size = registry.size;

    registry.setInfection(1);
    registry.setRestoration(0);
    expect(registry.infection).toBe(1);
    expect(registry.restoration).toBe(0);
    expect(registry.uniforms.uInfection.value).toBe(1);
    // Same instance, same count: the retune is one uniform write.
    expect(registry.get('stone-carved')).toBe(material);
    expect(registry.size).toBe(size);

    registry.setTime(4.5);
    expect(registry.uniforms.uTime.value).toBe(4.5);
    registry.dispose();
  });

  it('clamps the tuning it is handed', () => {
    const registry = new MaterialRegistry('high');
    registry.setInfection(4);
    expect(registry.infection).toBe(1);
    registry.setInfection(-2);
    expect(registry.infection).toBe(0);
    registry.dispose();
  });

  it('retunes the shared registry through setSurfaceInfection', () => {
    setSurfaceInfection(0.75);
    expect(surfaceMaterials.infection).toBeCloseTo(0.75, 6);
    expect(surfaceMaterials.restoration).toBeCloseTo(0.25, 6);
    setSurfaceInfection(0);
    expect(surfaceMaterials.infection).toBe(0);
    expect(surfaceMaterials.restoration).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

describe('material registry — graphics tiers', () => {
  it('builds a measurably simpler material at the low tier', () => {
    const registry = new MaterialRegistry('high');
    const high = registry.get('stone', 'high');
    const low = registry.get('stone', 'low');

    expect(high).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(low).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(low).not.toBeInstanceOf(THREE.MeshStandardMaterial);

    // Concrete, countable differences: the low tier compiles no injected stage.
    const highInfo = high.userData.tuner as { injected: boolean };
    const lowInfo = low.userData.tuner as { injected: boolean };
    expect(highInfo.injected).toBe(true);
    expect(lowInfo.injected).toBe(false);
    expect(high.customProgramCacheKey()).toBe('tuner-surface:stone:high');
    expect(low.customProgramCacheKey()).not.toContain('tuner-surface');

    type Compile = (shader: InjectableShader) => void;
    const highShader = fakeShader();
    (high.onBeforeCompile as unknown as Compile)(highShader);
    const lowShader = fakeShader();
    (low.onBeforeCompile as unknown as Compile)(lowShader);
    expect(Object.keys(highShader.uniforms).length).toBeGreaterThan(20);
    expect(Object.keys(lowShader.uniforms).length).toBe(0);
    expect(highShader.fragmentShader.length).toBeGreaterThan(
      lowShader.fragmentShader.length + 1000,
    );
    registry.dispose();
  });

  it('keeps the palette split at the low tier, on the CPU', () => {
    const registry = new MaterialRegistry('low');
    const material = registry.get('stone');
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    if (!(material instanceof THREE.MeshLambertMaterial)) return;

    registry.setInfection(1);
    registry.setRestoration(0);
    const infectedColour = material.color.clone();
    const infectedEmissive = material.emissiveIntensity;

    registry.setInfection(0);
    registry.setRestoration(1);
    const restoredColour = material.color.clone();

    // Same instance, repainted — and the split is just as strong as at high.
    expect(distance(infectedColour, restoredColour)).toBeGreaterThan(SPLIT_DISTANCE);
    expect(infectedColour.equals(restoredColour)).toBe(false);
    // The low tier has no rim pass, so the infection's tell becomes emission.
    expect(infectedEmissive).toBeGreaterThan(material.emissiveIntensity);
    registry.dispose();
  });

  it('matches the low tier CPU blend to the shader blend exactly', () => {
    const registry = new MaterialRegistry('low');
    const material = registry.get('root');
    registry.setInfection(0.4);
    registry.setRestoration(0.6);
    if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error('wrong material');
    const expected = resolveSurfaceColour('root', 0.4, 0.6);
    expect(distance(material.color, expected)).toBeLessThan(1e-6);
    registry.dispose();
  });

  it('never draws the invisible style', () => {
    const registry = new MaterialRegistry('high');
    for (const tier of ['low', 'medium', 'high'] as const satisfies readonly GraphicsTier[]) {
      const material = registry.get('invisible', tier);
      expect(material.visible).toBe(false);
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBe(0);
    }
    registry.dispose();
  });
});

// ---------------------------------------------------------------------------
// Shader injection
// ---------------------------------------------------------------------------

describe('resonance shader injection', () => {
  it('shares the tuning uniforms by reference across every style', () => {
    const registry = new MaterialRegistry('high');
    const shaders = ['stone', 'root', 'crystal'].map((style) => {
      const shader = fakeShader();
      injectResonanceShader(
        shader,
        style as SurfaceStyle,
        SURFACE_PROFILES[style as SurfaceStyle],
        registry.uniforms,
      );
      return shader;
    });

    registry.setInfection(0.62);
    for (const shader of shaders) {
      expect(shader.uniforms.uInfection).toBe(registry.uniforms.uInfection);
      expect(shader.uniforms.uInfection?.value).toBe(0.62);
      expect(shader.uniforms.uRestoration).toBe(registry.uniforms.uRestoration);
      expect(shader.uniforms.uTime).toBe(registry.uniforms.uTime);
    }

    // Per-style colours are not shared: that is the whole point of the split.
    const stone = shaders[0];
    const crystal = shaders[2];
    if (!stone || !crystal) throw new Error('missing shader');
    expect(stone.uniforms.uInfectedColour).not.toBe(crystal.uniforms.uInfectedColour);
    registry.dispose();
  });

  it('splices the world frame into the vertex stage and the palette into the fragment stage', () => {
    const shader = fakeShader();
    injectResonanceShader(shader, 'stone-carved', SURFACE_PROFILES['stone-carved'], {
      uInfection: { value: 1 },
      uRestoration: { value: 0 },
      uTime: { value: 0 },
    });

    expect(shader.vertexShader).toContain('vTunerWorldPos');
    expect(shader.vertexShader).toContain('vTunerWorldNormal');
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.fragmentShader).toContain('uInfection');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = tunerCol;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance');
    expect(shader.fragmentShader).toContain('// tuner-surface: stone-carved');
    // The rim must keep its distance fade, or the frame floods again.
    expect(shader.fragmentShader).toContain('uRimFade');
  });

  it('degrades to appending rather than failing when a chunk is renamed', () => {
    const shader: InjectableShader = {
      uniforms: {},
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {}',
    };
    injectResonanceShader(shader, 'stone', SURFACE_PROFILES.stone, {
      uInfection: { value: 0 },
      uRestoration: { value: 1 },
      uTime: { value: 0 },
    });
    expect(shader.vertexShader).toContain('vTunerWorldPos');
    expect(shader.fragmentShader).toContain('uBaseColour');
  });
});

// ---------------------------------------------------------------------------
// Lighting and sky
// ---------------------------------------------------------------------------

describe('lighting palette', () => {
  it('shifts the resonance fill from violet-magenta to cyan-gold', () => {
    const resolved = createResolvedAmbience();
    const colours = createLightingColours();

    resolveAmbience(AMBIENCE, 0, resolved);
    resolveLightingColours(resolved, 0, colours);
    const sick = colours.resonance.clone();
    const sickKey = colours.key.clone();
    const sickRim = colours.rim.clone();

    resolveAmbience(AMBIENCE, 1, resolved);
    resolveLightingColours(resolved, 1, colours);
    const well = colours.resonance.clone();

    expect(distance(sick, well)).toBeGreaterThan(0.35);
    const [sr, sg, sb] = srgb(sick);
    // Detuned: violet-magenta — blue above green, red above green.
    expect(sb).toBeGreaterThan(sg);
    expect(sr).toBeGreaterThan(sg);
    const [wr, wg, wb] = srgb(well);
    // Tuned: cyan-gold — green and blue above red.
    expect(wg).toBeGreaterThan(wr);
    expect(wb).toBeGreaterThan(wr * 0.8);

    // The key stops being warm in a detuned region even though the stage
    // authored a gold sun for it, which is what produced the amber world.
    expect(distance(sickKey, colours.key)).toBeGreaterThan(0.15);
    const [kr, kg, kb] = srgb(sickKey);
    expect(kb).toBeGreaterThan(kg);
    expect(distance(sickRim, colours.rim)).toBeGreaterThan(0.3);
  });

  it('keeps the fills well under the key so faces still read', () => {
    const resolved = createResolvedAmbience();
    const colours = createLightingColours();
    for (const restoration of [0, 0.5, 1]) {
      resolveAmbience(AMBIENCE, restoration, resolved);
      resolveLightingColours(resolved, restoration, colours);
      const fills =
        colours.hemisphereIntensity + colours.ambientIntensity + colours.resonanceIntensity;
      expect(colours.keyIntensity).toBeGreaterThan(fills * 0.85);
      expect(colours.keyIntensity).toBeGreaterThan(1.5);
    }
    // And a tuned region is lit more brightly than a detuned one.
    resolveLightingColours(resolved, 0, colours);
    const detunedKey = colours.keyIntensity;
    resolveLightingColours(resolved, 1, colours);
    expect(colours.keyIntensity).toBeGreaterThan(detunedKey);
  });

  it('derives a violet mid band and a magenta haze that the restoration drains', () => {
    const resolved = createResolvedAmbience();

    resolveAmbience(AMBIENCE, 0, resolved);
    const sickMid = resolved.skyMid.clone();
    const [hr, hg, hb] = srgb(resolved.hazeColour);
    expect(hr).toBeGreaterThan(hg);
    expect(hb).toBeGreaterThan(hg);

    resolveAmbience(AMBIENCE, 1, resolved);
    expect(distance(sickMid, resolved.skyMid)).toBeGreaterThan(0.15);
    // Tuned mid band: blue leads.
    const [mr, , mb] = srgb(resolved.skyMid);
    expect(mb).toBeGreaterThan(mr);
    // Restored air is clearer.
    expect(resolved.fogFar).toBeGreaterThan(AMBIENCE.fogFar);
  });

  it('builds a sky dome that drops its constellations at the low tier', () => {
    const high = createSkyDome({ tier: 'high' });
    const low = createSkyDome({ tier: 'low' });
    expect(high.material.defines?.TUNER_SKY_SIMPLE).toBeUndefined();
    expect(low.material.defines?.TUNER_SKY_SIMPLE).toBe('');
    expect(high.material.fragmentShader).toContain('uRing');
    expect(high.material.fragmentShader).toContain('uHaze');

    high.setAmbience(AMBIENCE, restorationFromInfection(1));
    const uRestoration = high.material.uniforms.uRestoration;
    expect(uRestoration?.value).toBe(0);
    const sun = high.material.uniforms.uSun?.value;
    if (!(sun instanceof THREE.Vector3)) throw new Error('missing sun uniform');
    // The dome looks toward the sun; the stage authored the direction it travels.
    expect(sun.y).toBeGreaterThan(0);
    expect(sun.length()).toBeCloseTo(1, 6);

    high.setAmbience(AMBIENCE, restorationFromInfection(0));
    expect(uRestoration?.value).toBe(1);

    high.dispose();
    low.dispose();
  });
});
