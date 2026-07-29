/**
 * The game's shared vocabulary.
 *
 * These identifiers are referenced by simulation, rendering, audio, UI and save
 * data alike, so they live in the dependency-free package. Everything is a
 * string-literal union rather than a TypeScript `enum` — the values appear
 * verbatim in save files and content data, so they must stay readable and
 * stable.
 */

/** The eight Resonance Forms, plus the Auralith's untransformed state. */
export const RESONANCE_FORM_IDS = [
  'base',
  'echo',
  'prism',
  'tidal',
  'ember',
  'choir',
  'bloom',
  'silence',
  'celestial',
] as const;
export type ResonanceFormId = (typeof RESONANCE_FORM_IDS)[number];

export const STAGE_IDS = [
  'fallen-sanctuary',
  'fractured-garden',
  'glass-meridian',
  'tidal-archive',
  'ember-observatory',
  'hollow-choir',
  'verdant-machine',
  'desert-of-lost-notes',
  'orbital-dissonance',
  'celestial-loom',
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const DIFFICULTY_IDS = ['story', 'explorer', 'standard', 'resonance-master'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/** Behavioural archetypes the enemy framework instantiates. */
export const ENEMY_ROLES = [
  'scout',
  'turret',
  'flyer',
  'shield',
  'pursuer',
  'spawner',
  'hazard',
  'mimic',
  'elite',
] as const;
export type EnemyRole = (typeof ENEMY_ROLES)[number];

export const COLLECTIBLE_KINDS = [
  'resonance-shard',
  'coherence-fragment',
  'frequency-capacitor',
  'lost-motif',
  'keeper-memory',
  'geometry-tablet',
  'signal-sample',
  'sanctuary-seed',
] as const;
export type CollectibleKind = (typeof COLLECTIBLE_KINDS)[number];

/** Damage channels. Some armour only yields to a specific channel. */
export const DAMAGE_KINDS = ['pulse', 'charge', 'burst', 'counter', 'hazard', 'form'] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

/** Ranks awarded on stage completion. */
export const RANKS = ['D', 'C', 'B', 'A', 'S'] as const;
export type Rank = (typeof RANKS)[number];

export const GRAPHICS_TIERS = ['low', 'medium', 'high'] as const;
export type GraphicsTier = (typeof GRAPHICS_TIERS)[number];

export function isResonanceFormId(value: string): value is ResonanceFormId {
  return (RESONANCE_FORM_IDS as readonly string[]).includes(value);
}

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value);
}

/**
 * Per-difficulty tuning. Difficulty changes pattern density, damage and the
 * generosity of assists — deliberately never enemy health, which would only
 * make fights longer rather than different.
 */
export interface DifficultyProfile {
  readonly id: DifficultyId;
  readonly label: string;
  readonly description: string;
  /** Multiplier applied to damage the player receives. */
  readonly incomingDamageScale: number;
  /** Scales enemy attack cadence; below 1 means longer gaps between attacks. */
  readonly enemyAggressionScale: number;
  /** Widens or narrows the Resonance Counter window, in seconds. */
  readonly counterWindowBonus: number;
  /** Extra Coherence restored by pickups and checkpoints. */
  readonly recoveryScale: number;
  /** Extra coyote time granted, in seconds. */
  readonly coyoteBonus: number;
  /** Additional mid-air correction toward the intended landing platform. */
  readonly landingAssist: number;
  /** Whether optional boss attack layers are enabled. */
  readonly advancedPatterns: boolean;
}

export const DIFFICULTY_PROFILES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  story: {
    id: 'story',
    label: 'Story',
    description: 'Follow the World Chord without pressure. Generous recovery and assists.',
    incomingDamageScale: 0.4,
    enemyAggressionScale: 0.7,
    counterWindowBonus: 0.12,
    recoveryScale: 1.6,
    coyoteBonus: 0.06,
    landingAssist: 0.55,
    advancedPatterns: false,
  },
  explorer: {
    id: 'explorer',
    label: 'Explorer',
    description: 'For players here to search every ruin. Softer combat, full platforming.',
    incomingDamageScale: 0.65,
    enemyAggressionScale: 0.85,
    counterWindowBonus: 0.07,
    recoveryScale: 1.3,
    coyoteBonus: 0.03,
    landingAssist: 0.3,
    advancedPatterns: false,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'The intended tuning. Fair, readable, and demanding at the edges.',
    incomingDamageScale: 1,
    enemyAggressionScale: 1,
    counterWindowBonus: 0,
    recoveryScale: 1,
    coyoteBonus: 0,
    landingAssist: 0.12,
    advancedPatterns: true,
  },
  'resonance-master': {
    id: 'resonance-master',
    label: 'Resonance Master',
    description: 'Full commander patterns, tight counters, no safety net.',
    incomingDamageScale: 1.5,
    enemyAggressionScale: 1.25,
    counterWindowBonus: -0.03,
    recoveryScale: 0.75,
    coyoteBonus: 0,
    landingAssist: 0,
    advancedPatterns: true,
  },
};
