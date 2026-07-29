import { PALETTE } from '@tuner/shared';

/**
 * Design tokens.
 *
 * Dark navy panels, gold outlines, cyan for natural resonance, violet for
 * infection, green for restoration. Circular tuning rings are the signature
 * shape — Coherence is a ring rather than a rectangular bar, because the game is
 * about frequency and a ring reads as one.
 *
 * The important guarantee here is not the palette, it is that **every
 * semantically-coloured token also carries a shape key**. Colour-blind-safe mode
 * turns those shapes on, and `theme.test.ts` asserts the mapping is total rather
 * than trusting that nobody forgot one.
 */

export interface AccessibilityTheming {
  readonly highContrast?: boolean;
  readonly colourblindSafeIcons?: boolean;
  readonly textScale?: number;
  readonly reducedMotion?: boolean;
}

/** Every colour that carries meaning, and the shape that carries it too. */
export const SEMANTIC_TOKENS = {
  resonance: { colour: PALETTE.resonance, shape: 'circle', label: 'Resonance' },
  infection: { colour: PALETTE.infection, shape: 'diamond', label: 'Infection' },
  restoration: { colour: PALETTE.restore, shape: 'leaf', label: 'Restored' },
  sacred: { colour: PALETTE.gold, shape: 'hexagon', label: 'Sacred' },
  alarm: { colour: PALETTE.alarm, shape: 'triangle', label: 'Danger' },
  neutral: { colour: PALETTE.inkDim, shape: 'square', label: 'Neutral' },
} as const;

export type SemanticToken = keyof typeof SEMANTIC_TOKENS;

export interface Theme {
  readonly colour: {
    readonly background: string;
    readonly panel: string;
    readonly panelRaised: string;
    readonly outline: string;
    readonly text: string;
    readonly textDim: string;
    readonly resonance: string;
    readonly infection: string;
    readonly restore: string;
    readonly alarm: string;
    readonly gold: string;
  };
  readonly space: (steps: number) => string;
  readonly radius: { readonly sm: string; readonly md: string; readonly lg: string };
  readonly font: {
    readonly tiny: string;
    readonly small: string;
    readonly body: string;
    readonly title: string;
    readonly display: string;
  };
  readonly showShapes: boolean;
  readonly reducedMotion: boolean;
  readonly tokenFor: (token: SemanticToken) => { colour: string; shape: string; label: string };
}

/** Base type sizes in rem, before the accessibility scale. */
const TYPE_SCALE = { tiny: 0.72, small: 0.85, body: 1, title: 1.55, display: 2.6 } as const;

const HIGH_CONTRAST = {
  background: '#000208',
  panel: '#05081c',
  panelRaised: '#0d1330',
  outline: '#ffe9a8',
  text: '#ffffff',
  textDim: '#d6ddff',
} as const;

export function createTheme(accessibility: AccessibilityTheming = {}): Theme {
  const scale = Math.max(0.75, Math.min(2, accessibility.textScale ?? 1));
  const high = accessibility.highContrast === true;

  return {
    colour: {
      background: high ? HIGH_CONTRAST.background : PALETTE.abyss,
      panel: high ? HIGH_CONTRAST.panel : PALETTE.panel,
      panelRaised: high ? HIGH_CONTRAST.panelRaised : PALETTE.panelRaised,
      outline: high ? HIGH_CONTRAST.outline : PALETTE.gold,
      text: high ? HIGH_CONTRAST.text : PALETTE.ink,
      textDim: high ? HIGH_CONTRAST.textDim : PALETTE.inkDim,
      resonance: PALETTE.resonance,
      infection: PALETTE.infection,
      restore: PALETTE.restore,
      alarm: PALETTE.alarm,
      gold: high ? HIGH_CONTRAST.outline : PALETTE.gold,
    },
    space: (steps: number) => `${(steps * 0.5).toFixed(3)}rem`,
    radius: { sm: '4px', md: '8px', lg: '14px' },
    font: {
      tiny: `${(TYPE_SCALE.tiny * scale).toFixed(3)}rem`,
      small: `${(TYPE_SCALE.small * scale).toFixed(3)}rem`,
      body: `${(TYPE_SCALE.body * scale).toFixed(3)}rem`,
      title: `${(TYPE_SCALE.title * scale).toFixed(3)}rem`,
      display: `${(TYPE_SCALE.display * scale).toFixed(3)}rem`,
    },
    showShapes: accessibility.colourblindSafeIcons === true,
    reducedMotion: accessibility.reducedMotion === true,
    tokenFor: (token) => ({ ...SEMANTIC_TOKENS[token] }),
  };
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

function channelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  ];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
  );
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
