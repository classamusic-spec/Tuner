import { describe, expect, it } from 'vitest';
import {
  DETUNED_HZ,
  RESONANCE_FORM_IDS,
  WORLD_CHORD_HZ,
  harmonicHz,
  type ResonanceFormId,
} from '@tuner/shared';
import type { SfxId } from './types.js';
import {
  FORM_HARMONIC_DEGREES,
  FORM_SOUND_FAMILIES,
  FULL_INFECTION_CENTS,
  MAX_PEAK_AMPLITUDE,
  MAX_PURE_TONE_SECONDS,
  SFX_IDS,
  SFX_RECIPES,
  applyFormToRecipe,
  detuneCentsForInfection,
  detunedHarmonicHz,
  formSoundFamily,
  formSoundSignature,
  getSfxRecipe,
  harmonicRatio,
  isPureTone,
  recipePeakAmplitude,
  recipeSustainSeconds,
  shiftCents,
  sustainHoldSeconds,
  trueHz,
  type SfxRecipe,
} from './synth.js';

/**
 * Every id in `types.ts`, written out longhand. The annotation makes a typo a
 * compile error, and the length check below makes an omission a test failure —
 * between them, a new `SfxId` cannot arrive without a recipe.
 */
const ALL_SFX_IDS: readonly SfxId[] = [
  'pulse-fire',
  'charge-start',
  'charge-tier',
  'charge-release',
  'burst',
  'counter-success',
  'counter-fail',
  'hit-enemy',
  'hit-armour',
  'hit-player',
  'enemy-cleansed',
  'jump',
  'double-jump',
  'dash',
  'land',
  'wall-cling',
  'rail-attach',
  'bounce',
  'pickup-shard',
  'pickup-major',
  'checkpoint',
  'form-switch',
  'form-acquire',
  'puzzle-note',
  'puzzle-solve',
  'puzzle-fail',
  'boss-phase',
  'boss-telegraph',
  'restoration',
  'ui-move',
  'ui-confirm',
  'ui-cancel',
  'low-coherence',
];

const ABILITY_IDS: readonly ResonanceFormId[] = [
  'echo',
  'prism',
  'tidal',
  'ember',
  'choir',
  'bloom',
  'silence',
  'celestial',
];

const recipes = (): readonly SfxRecipe[] => ALL_SFX_IDS.map((id) => getSfxRecipe(id));

describe('the recipe book', () => {
  it('covers every SfxId, once, with a matching id field', () => {
    expect(ALL_SFX_IDS).toHaveLength(33);
    expect(new Set(ALL_SFX_IDS).size).toBe(ALL_SFX_IDS.length);
    for (const id of ALL_SFX_IDS) {
      const recipe = SFX_RECIPES[id];
      expect(recipe, `missing recipe for ${id}`).toBeDefined();
      expect(recipe.id).toBe(id);
    }
    expect(SFX_IDS.length).toBe(ALL_SFX_IDS.length);
    expect([...SFX_IDS].sort()).toEqual([...ALL_SFX_IDS].sort());
  });

  it('routes interface sounds to the ui bus and the warning drone to ambience', () => {
    expect(getSfxRecipe('ui-move').bus).toBe('ui');
    expect(getSfxRecipe('ui-confirm').bus).toBe('ui');
    expect(getSfxRecipe('ui-cancel').bus).toBe('ui');
    expect(getSfxRecipe('low-coherence').bus).toBe('ambience');
    expect(getSfxRecipe('low-coherence').loop).toBe(true);
  });

  it('gives every cue a palette key, so the visual half of the pairing has a colour', () => {
    for (const recipe of recipes()) {
      expect(recipe.cue.length, `${recipe.id} has no cue colour`).toBeGreaterThan(0);
    }
  });
});

describe('comfort ceilings', () => {
  it('holds every recipe under the peak amplitude ceiling, noise bed included', () => {
    for (const recipe of recipes()) {
      const peak = recipePeakAmplitude(recipe);
      expect(peak, `${recipe.id} peaks at ${peak}`).toBeLessThanOrEqual(MAX_PEAK_AMPLITUDE);
      expect(peak).toBeGreaterThan(0);
    }
  });

  it('never sustains a pure tone past the fatigue limit', () => {
    const pure = recipes().filter(isPureTone);
    // If this list ever empties the assertion below becomes vacuous.
    expect(pure.length).toBeGreaterThan(0);
    for (const recipe of pure) {
      expect(
        recipeSustainSeconds(recipe),
        `${recipe.id} holds a bare sine too long`,
      ).toBeLessThanOrEqual(MAX_PURE_TONE_SECONDS);
    }
  });

  it('never loops a pure tone — a held sine with no way out is the worst case', () => {
    for (const recipe of recipes()) {
      if (recipe.loop) {
        expect(isPureTone(recipe), `${recipe.id} loops a pure tone`).toBe(false);
        expect(recipeSustainSeconds(recipe)).toBe(Number.POSITIVE_INFINITY);
      }
    }
  });

  it('fits each envelope inside its own duration', () => {
    for (const recipe of recipes()) {
      const { attack, decay, release } = recipe.amplitude;
      expect(
        attack + decay + release,
        `${recipe.id} envelope overruns its duration`,
      ).toBeLessThanOrEqual(recipe.duration + 1e-9);
      expect(sustainHoldSeconds(recipe)).toBeGreaterThanOrEqual(0);
      expect(recipe.amplitude.sustain).toBeLessThanOrEqual(1);
      expect(recipe.noise).toBeLessThanOrEqual(1);
    }
  });
});

describe('tuning: 432 for the player, 440 for the Detuners', () => {
  it('derives player pitches from the just-intonation grid', () => {
    expect(trueHz(0, 0)).toBe(WORLD_CHORD_HZ);
    expect(trueHz(4, 0)).toBeCloseTo(harmonicHz(4, 0), 10);
    expect(getSfxRecipe('pulse-fire').frequency.startHz).toBeCloseTo(harmonicHz(4, 1), 10);
    expect(getSfxRecipe('jump').frequency.startHz).toBe(WORLD_CHORD_HZ);
    expect(getSfxRecipe('puzzle-note').frequency.startHz).toBe(WORLD_CHORD_HZ);
  });

  it('rebuilds the same ratios on 440 Hz for anything infected', () => {
    expect(detunedHarmonicHz(0, 0)).toBeCloseTo(DETUNED_HZ, 10);
    expect(detunedHarmonicHz(4, 0) / trueHz(4, 0)).toBeCloseTo(DETUNED_HZ / WORLD_CHORD_HZ, 12);
  });

  it('detunes Detuner sounds by the same number the shader tints with', () => {
    expect(FULL_INFECTION_CENTS).toBeCloseTo(31.766654, 4);
    expect(detuneCentsForInfection(0)).toBe(0);
    expect(detuneCentsForInfection(1)).toBeCloseTo(FULL_INFECTION_CENTS, 12);
    expect(detuneCentsForInfection(0.5)).toBeCloseTo(FULL_INFECTION_CENTS / 2, 12);
    expect(detuneCentsForInfection(9)).toBeCloseTo(FULL_INFECTION_CENTS, 12);
    expect(shiftCents(WORLD_CHORD_HZ, FULL_INFECTION_CENTS)).toBeCloseTo(DETUNED_HZ, 8);
  });

  it('makes infected cues harsh, detuned and off the true grid', () => {
    const infected = recipes().filter((r) => r.cue === 'infection');
    expect(infected.map((r) => r.id).sort()).toEqual(
      ['boss-phase', 'hit-armour', 'hit-enemy', 'puzzle-fail'].sort(),
    );
    for (const recipe of infected) {
      expect(recipe.detuneCents, `${recipe.id} is not detuned`).toBeGreaterThan(0);
      const harsh = recipe.wave === 'square' || recipe.wave === 'sawtooth';
      expect(harsh || recipe.noise > 0.1, `${recipe.id} is too clean for a Detuner`).toBe(true);
    }
  });

  it('glides a cleansed creature from the Detuners grid back onto the true one', () => {
    const cleansed = getSfxRecipe('enemy-cleansed');
    expect(cleansed.frequency.startHz).toBeCloseTo(detunedHarmonicHz(2, 1), 8);
    expect(cleansed.frequency.endHz).toBeCloseTo(trueHz(2, 1), 8);
    expect(cleansed.frequency.startHz).toBeGreaterThan(cleansed.frequency.endHz);
    expect(cleansed.cue).toBe('restore');
  });

  it('states the whole game in the restoration cue: 440 becomes 432', () => {
    const restoration = getSfxRecipe('restoration');
    expect(restoration.frequency.startHz).toBe(DETUNED_HZ);
    expect(restoration.frequency.endHz).toBe(WORLD_CHORD_HZ);
    expect(restoration.frequency.curve).toBe('exponential');
  });

  it('computes just-intonation ratios across octaves', () => {
    expect(harmonicRatio(0)).toBe(1);
    expect(harmonicRatio(4)).toBeCloseTo(1.5, 12);
    expect(harmonicRatio(7)).toBe(2);
    expect(harmonicRatio(8)).toBe(2);
    expect(harmonicRatio(-8)).toBe(0.5);
  });
});

describe('per-form sound families', () => {
  it('has a family for every form, including the untransformed Auralith', () => {
    for (const form of RESONANCE_FORM_IDS) {
      expect(FORM_SOUND_FAMILIES[form].form).toBe(form);
      expect(formSoundFamily(form)).toBe(FORM_SOUND_FAMILIES[form]);
    }
  });

  it('makes all eight abilities pairwise distinct by ear', () => {
    const signatures = ABILITY_IDS.map(formSoundSignature);
    expect(new Set(signatures).size).toBe(ABILITY_IDS.length);

    const pitches = ABILITY_IDS.map((id) => formSoundFamily(id).rootHz);
    expect(new Set(pitches).size).toBe(ABILITY_IDS.length);

    const brightness = ABILITY_IDS.map((id) => formSoundFamily(id).brightness);
    expect(new Set(brightness).size).toBe(ABILITY_IDS.length);

    // Every pair differs in pitch *and* in timbre, not merely in one of them.
    for (let i = 0; i < ABILITY_IDS.length; i++) {
      for (let j = i + 1; j < ABILITY_IDS.length; j++) {
        const a = formSoundFamily(ABILITY_IDS[i] as ResonanceFormId);
        const b = formSoundFamily(ABILITY_IDS[j] as ResonanceFormId);
        const label = `${a.form} vs ${b.form}`;
        expect(Math.abs(a.rootHz - b.rootHz), label).toBeGreaterThan(1);
        expect(
          Math.abs(a.brightness - b.brightness) > 0.02 ||
            a.wave !== b.wave ||
            a.filter !== b.filter,
          label,
        ).toBe(true);
      }
    }
  });

  it('keeps every family inside sane synthesis ranges', () => {
    for (const form of RESONANCE_FORM_IDS) {
      const family = formSoundFamily(form);
      expect(family.brightness).toBeGreaterThanOrEqual(0);
      expect(family.brightness).toBeLessThanOrEqual(1);
      expect(family.rootHz).toBeGreaterThan(20);
      expect(family.rootHz).toBeLessThan(20000);
      expect(family.filterHz).toBeGreaterThan(20);
      expect(family.noise).toBeLessThanOrEqual(1);
      expect(family.rootHz).toBeCloseTo(
        WORLD_CHORD_HZ * harmonicRatio(family.degree) * Math.pow(2, family.octave),
        8,
      );
    }
  });

  /**
   * The load-bearing one. `@tuner/game-core` owns the canonical pitch of every
   * form as `RESONANCE_FORMS[id].tuning.harmonicDegree`; this package cannot
   * import it (game-core depends on audio, so it would be a cycle) and so keeps
   * a mirror. If the two ever drift, a form sounds like a note the simulation
   * says it is not — audible nonsense in a game about pitch, and invisible to
   * every other test here, because they only check internal distinctness.
   */
  it('mirrors the harmonic degree game-core assigns to each form', () => {
    const canonical: Readonly<Record<ResonanceFormId, number>> = {
      base: 0,
      echo: 4,
      prism: 2,
      tidal: 3,
      ember: 6,
      choir: 5,
      bloom: 1,
      silence: 7,
      celestial: 8,
    };
    for (const form of RESONANCE_FORM_IDS) {
      expect(FORM_HARMONIC_DEGREES[form], `${form} degree`).toBe(canonical[form]);
      expect(formSoundFamily(form).degree, `${form} family degree`).toBe(canonical[form]);
    }
    // game-core asserts its nine degrees are distinct; so must the mirror.
    expect(new Set(Object.values(canonical)).size).toBe(RESONANCE_FORM_IDS.length);
  });

  it('keeps every form on its own pitch despite the octave wrap at degree 8', () => {
    // Degrees 7 and 8 share a ratio (the table carries both unison and octave),
    // and degree 8 folds onto the root, so silence/celestial/base could all
    // collide. The chosen octaves are what keep them apart.
    const pitches = RESONANCE_FORM_IDS.map((id) => formSoundFamily(id).rootHz);
    expect(new Set(pitches).size).toBe(RESONANCE_FORM_IDS.length);
    expect(formSoundFamily('silence').rootHz).toBeCloseTo(216, 9);
    expect(formSoundFamily('celestial').rootHz).toBeCloseTo(1728, 9);
    expect(formSoundFamily('base').rootHz).toBe(WORLD_CHORD_HZ);
  });

  it('places Silence Field at the dark end and World Chord at the bright end', () => {
    const brightness = ABILITY_IDS.map((id) => formSoundFamily(id).brightness);
    expect(formSoundFamily('silence').brightness).toBe(Math.min(...brightness));
    expect(formSoundFamily('celestial').brightness).toBe(Math.max(...brightness));
    expect(formSoundFamily('silence').pitchOffsetSemitones).toBeCloseTo(-12, 6);
    expect(formSoundFamily('celestial').pitchOffsetSemitones).toBeCloseTo(24, 6);
  });

  it('re-voices a recipe into a family without breaking the ceilings', () => {
    const base = getSfxRecipe('pulse-fire');
    for (const form of ABILITY_IDS) {
      const family = formSoundFamily(form);
      const voiced = applyFormToRecipe(base, form);
      expect(voiced.wave).toBe(family.wave);
      expect(voiced.frequency.startHz).toBeCloseTo(
        base.frequency.startHz * (family.rootHz / WORLD_CHORD_HZ),
        6,
      );
      expect(recipePeakAmplitude(voiced)).toBeLessThanOrEqual(MAX_PEAK_AMPLITUDE + 1e-9);
      expect(voiced.duration).toBe(base.duration);
      expect(voiced.id).toBe(base.id);
    }
  });
});
