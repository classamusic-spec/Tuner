import { clamp, type GraphicsTier } from '@tuner/shared';

/**
 * `@tuner/platform` — what the host can do, and how hard to push it.
 *
 * Every browser API access here is guarded, because this module runs in Node
 * during tests and inside a native shell on mobile. It returns conservative
 * defaults rather than throwing when something is missing.
 */

export interface Capabilities {
  readonly hasPointer: boolean;
  readonly hasTouch: boolean;
  readonly hasGamepad: boolean;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  /** Rough device memory in GB, where the browser will say. */
  readonly deviceMemoryGb: number | null;
  readonly isMobileFormFactor: boolean;
  readonly isTablet: boolean;
  readonly supportsWebGL2: boolean;
  readonly prefersReducedMotion: boolean;
  readonly safeArea: { top: number; right: number; bottom: number; left: number };
}

const DEFAULT_CAPABILITIES: Capabilities = {
  hasPointer: true,
  hasTouch: false,
  hasGamepad: false,
  devicePixelRatio: 1,
  hardwareConcurrency: 4,
  deviceMemoryGb: null,
  isMobileFormFactor: false,
  isTablet: false,
  supportsWebGL2: false,
  prefersReducedMotion: false,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
};

export function detectCapabilities(): Capabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return DEFAULT_CAPABILITIES;
  }

  const ua = navigator.userAgent ?? '';
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const isTablet =
    /iPad|Tablet/i.test(ua) ||
    (hasTouch && Math.min(window.innerWidth, window.innerHeight) >= 700);
  const isMobile = hasTouch && !isTablet;

  let supportsWebGL2 = false;
  try {
    const canvas = document.createElement('canvas');
    supportsWebGL2 = canvas.getContext('webgl2') !== null;
  } catch {
    supportsWebGL2 = false;
  }

  let prefersReducedMotion = false;
  try {
    prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    prefersReducedMotion = false;
  }

  return {
    hasPointer: window.matchMedia?.('(pointer: fine)').matches !== false,
    hasTouch,
    hasGamepad: typeof navigator.getGamepads === 'function',
    devicePixelRatio: window.devicePixelRatio ?? 1,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 4,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    isMobileFormFactor: isMobile,
    isTablet,
    supportsWebGL2,
    prefersReducedMotion,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export interface QualitySettings {
  /** Shadow map resolution; 0 disables shadows entirely. */
  readonly shadowMapSize: number;
  /** Ceiling on device pixel ratio — the cheapest lever there is. */
  readonly maxPixelRatio: number;
  readonly drawDistance: number;
  readonly particleBudget: number;
  readonly postProcessing: boolean;
  readonly lodBias: number;
  readonly targetFrameRate: number;
  readonly dynamicResolution: boolean;
  readonly maxLights: number;
  readonly anisotropy: number;
}

export const QUALITY_PRESETS: Readonly<Record<GraphicsTier, QualitySettings>> = {
  low: {
    shadowMapSize: 0,
    maxPixelRatio: 1.5,
    drawDistance: 90,
    particleBudget: 300,
    postProcessing: false,
    lodBias: 1.6,
    targetFrameRate: 30,
    dynamicResolution: true,
    maxLights: 1,
    anisotropy: 1,
  },
  medium: {
    shadowMapSize: 1024,
    maxPixelRatio: 2,
    drawDistance: 160,
    particleBudget: 800,
    postProcessing: false,
    lodBias: 1.2,
    targetFrameRate: 60,
    dynamicResolution: true,
    maxLights: 2,
    anisotropy: 4,
  },
  high: {
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    drawDistance: 260,
    particleBudget: 2000,
    postProcessing: true,
    lodBias: 1,
    targetFrameRate: 60,
    dynamicResolution: false,
    maxLights: 3,
    anisotropy: 8,
  },
};

/** Picks a starting tier. The adaptive controller corrects it from measurements. */
export function recommendTier(capabilities: Capabilities): GraphicsTier {
  if (!capabilities.supportsWebGL2) return 'low';
  if (capabilities.isMobileFormFactor) {
    return capabilities.hardwareConcurrency >= 6 ? 'medium' : 'low';
  }
  if (capabilities.isTablet) {
    return capabilities.hardwareConcurrency >= 6 ? 'high' : 'medium';
  }
  return capabilities.hardwareConcurrency >= 4 ? 'high' : 'medium';
}

const TIER_ORDER: readonly GraphicsTier[] = ['low', 'medium', 'high'];

export interface AdaptiveQualityController {
  /** Feed one frame's duration, in milliseconds. */
  sample(frameMs: number): void;
  readonly tier: GraphicsTier;
  /** Resolution multiplier in (0, 1]. */
  readonly resolutionScale: number;
  readonly settings: QualitySettings;
  reset(tier?: GraphicsTier): void;
}

/**
 * Reacts to measured frame times.
 *
 * It only ever *responds* to observations — it never predicts, and nothing here
 * claims a frame rate. The hysteresis is deliberately asymmetric: drop quality
 * quickly when the budget is missed, raise it slowly and only after sustained
 * headroom, because quality that oscillates is more noticeable than quality
 * that is slightly too low.
 */
export function createAdaptiveQualityController(
  initialTier: GraphicsTier,
  options?: { readonly window?: number },
): AdaptiveQualityController {
  const windowSize = Math.max(4, options?.window ?? 45);
  let tier: GraphicsTier = initialTier;
  let resolutionScale = 1;
  const samples: number[] = [];
  let cooldown = 0;

  return {
    sample(frameMs: number): void {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return;
      samples.push(frameMs);
      if (samples.length < windowSize) return;

      const average = samples.reduce((a, b) => a + b, 0) / samples.length;
      samples.length = 0;

      if (cooldown > 0) {
        cooldown -= 1;
        return;
      }

      const budget = 1000 / QUALITY_PRESETS[tier].targetFrameRate;

      if (average > budget * 1.25) {
        // Resolution first: it is far less noticeable than losing shadows.
        if (QUALITY_PRESETS[tier].dynamicResolution && resolutionScale > 0.6) {
          resolutionScale = clamp(resolutionScale - 0.1, 0.6, 1);
        } else {
          const index = TIER_ORDER.indexOf(tier);
          if (index > 0) {
            tier = TIER_ORDER[index - 1] ?? tier;
            resolutionScale = 1;
          }
        }
        cooldown = 2;
      } else if (average < budget * 0.7) {
        if (resolutionScale < 1) {
          resolutionScale = clamp(resolutionScale + 0.05, 0.6, 1);
        } else {
          const index = TIER_ORDER.indexOf(tier);
          if (index < TIER_ORDER.length - 1) {
            tier = TIER_ORDER[index + 1] ?? tier;
          }
        }
        // Longer cooldown on the way up, so a brief lull cannot start a cycle.
        cooldown = 6;
      }
    },

    get tier() {
      return tier;
    },
    get resolutionScale() {
      return resolutionScale;
    },
    get settings() {
      return QUALITY_PRESETS[tier];
    },
    reset(next?: GraphicsTier) {
      tier = next ?? initialTier;
      resolutionScale = 1;
      samples.length = 0;
      cooldown = 0;
    },
  };
}
