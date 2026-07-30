import { PALETTE } from '@tuner/shared';

/**
 * The people of the regions, as data.
 *
 * Split from the component on purpose. Everything that decides how a survivor
 * *reads* — silhouette, palette, whether the infection still shows on them —
 * lives here as plain values, so it can be asserted in Node rather than
 * eyeballed in a build. `villager.tsx` only turns these numbers into meshes.
 *
 * Survivors are built from the same primitives as the Tuner and share her
 * proportions, because a cast assembled from different toolkits reads as
 * different games stitched together. What separates them is what separates real
 * people at a distance: height, stance, bulk, and what they are carrying.
 */

/** Nominal standing height in metres. The Tuner is 1.6; adults vary around it. */
export const VILLAGER_HEIGHT = 1.6;

/** How far a survivor's head turns toward whoever they are speaking to. */
export const SPEAKING_TURN_RADIANS = 0.42;

/**
 * Cloth palette for the survivor cast.
 *
 * Deliberately duller and browner than the Tuner's indigo and violet. She
 * arrived from somewhere with dye; they have been living in a poisoned garden
 * for a long time, and the clothes should say so before the dialogue does.
 */
export const VILLAGER_PALETTE = {
  skin: '#b57f57',
  skinShade: '#94674a',
  skinPale: '#c8a184',
  hair: '#6b5540',
  hairGrey: '#a9a096',
  cloth: '#7a6a4e',
  clothDeep: '#5d5039',
  clothWorn: '#8d7f63',
  leather: '#4f3d2c',
  eye: '#141a33',
  /** The infection, on a person. Only ever on `detuned` appearances. */
  detuned: PALETTE.infection,
  /** What the restoration puts back. */
  restored: PALETTE.resonance,
} as const;

/** Which silhouette an appearance key builds. */
export type VillagerBuild = 'gardener' | 'watcher' | 'listener' | 'colossus';

export interface VillagerAppearance {
  readonly build: VillagerBuild;
  /** Multiplier on the 1.6 m base height. */
  readonly scale: number;
  /** Forward lean at the spine, in radians. Work and age both bend people. */
  readonly stoop: number;
  readonly cloth: string;
  readonly clothDeep: string;
  readonly hair: string;
  readonly skin: string;
  /**
   * Infection showing on the body, in [0, 1].
   *
   * Non-zero only for `survivor-detuned` — Tarn, who has been humming at 440 Hz
   * so long the Whisperers walk past him. It drives a violet rim on the skin, so
   * a player who has not read a word of dialogue can see that something is wrong
   * with him and right with everyone else.
   */
  readonly infection: number;
  /** Restoration glow in [0, 1]. Set on the `-restored` variants. */
  readonly restoration: number;
  /** What they are carrying or working at. The strongest read at distance. */
  readonly prop: 'watering-can' | 'spyglass' | 'none' | 'seedling';
}

const GARDENER: VillagerAppearance = {
  build: 'gardener',
  scale: 0.97,
  // Sixty-one, and carrying two litres of water eleven times a day.
  stoop: 0.16,
  cloth: VILLAGER_PALETTE.cloth,
  clothDeep: VILLAGER_PALETTE.clothDeep,
  hair: VILLAGER_PALETTE.hairGrey,
  skin: VILLAGER_PALETTE.skin,
  infection: 0,
  restoration: 0,
  prop: 'watering-can',
};

const WATCHER: VillagerAppearance = {
  build: 'watcher',
  scale: 1.04,
  stoop: 0.05,
  cloth: VILLAGER_PALETTE.clothWorn,
  clothDeep: VILLAGER_PALETTE.leather,
  hair: VILLAGER_PALETTE.hair,
  skin: VILLAGER_PALETTE.skinPale,
  infection: 0,
  restoration: 0,
  prop: 'spyglass',
};

const LISTENER: VillagerAppearance = {
  build: 'listener',
  scale: 1,
  stoop: 0.1,
  cloth: VILLAGER_PALETTE.clothDeep,
  clothDeep: VILLAGER_PALETTE.leather,
  hair: VILLAGER_PALETTE.hair,
  skin: VILLAGER_PALETTE.skin,
  infection: 0,
  restoration: 0,
  prop: 'none',
};

/**
 * Appearance keys, exactly as `NpcDef.appearance` spells them.
 *
 * A missing key is a content bug rather than a rendering one, so
 * `villagerAppearance` falls back to a plain survivor and does not throw — an
 * unnamed extra standing in a village is recoverable; a crash is not.
 */
export const VILLAGER_APPEARANCES: Readonly<Record<string, VillagerAppearance>> = Object.freeze({
  'survivor-gardener': GARDENER,
  'survivor-gardener-restored': {
    ...GARDENER,
    // She stands up straighter. That is the whole point of restoring a region.
    stoop: 0.07,
    restoration: 1,
    prop: 'seedling',
  },

  'survivor-watcher': WATCHER,
  'survivor-watcher-restored': { ...WATCHER, stoop: 0, restoration: 1 },

  /** Tarn, before. The infection is on him, and it is meant to be unpleasant. */
  'survivor-detuned': {
    ...LISTENER,
    stoop: 0.26,
    skin: VILLAGER_PALETTE.skinShade,
    infection: 0.85,
    restoration: 0,
  },
  /** Tarn, after his quest — cleansed, but not yet in a restored region. */
  'survivor-listener': LISTENER,
  'survivor-listener-restored': { ...LISTENER, stoop: 0.04, restoration: 1 },

  /**
   * Oru, freed and kneeling in his own ring. A colossus at survivor scale would
   * read as a large man rather than as what held the terraces together for
   * centuries, so he is nearly three times the height of the people around him.
   */
  'oru-freed': {
    build: 'colossus',
    scale: 2.8,
    stoop: 0.34,
    cloth: '#6f5f43',
    clothDeep: '#4a3f2c',
    hair: VILLAGER_PALETTE.hairGrey,
    skin: '#8d7a5c',
    infection: 0,
    restoration: 1,
    prop: 'seedling',
  },
});

const FALLBACK: VillagerAppearance = LISTENER;

export function villagerAppearance(key: string): VillagerAppearance {
  return VILLAGER_APPEARANCES[key] ?? FALLBACK;
}

/**
 * Whether an appearance key names somebody the infection is still on.
 *
 * Exported because two things read it — the model and the tests — and a
 * disagreement between them would be invisible until somebody looked at Tarn.
 */
export function isDetuned(key: string): boolean {
  return villagerAppearance(key).infection > 0;
}

/**
 * Yaw that points a body along `(dx, dz)`.
 *
 * A yaw of zero faces **−Z** here — `forward(yaw) = (−sin y, −cos y)` — which is
 * why the arguments are negated. `atan2(dx, dz)` is the same angle turned
 * exactly 180°, and using it is how every survivor ended up greeting the player
 * with the back of their head.
 */
export function yawTowards(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Head yaw for a survivor, in radians.
 *
 * A person being spoken to looks at whoever is talking to them. This is the
 * cheapest thing in the whole renderer that makes a village feel inhabited, and
 * it is capped so nobody's neck rotates further than a neck does.
 */
export function headYawFor(bodyYaw: number, toPlayer: number, speaking: boolean): number {
  if (!speaking) return 0;
  let delta = toPlayer - bodyYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.max(-SPEAKING_TURN_RADIANS, Math.min(SPEAKING_TURN_RADIANS, delta));
}
