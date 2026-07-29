import { PALETTE, type ResonanceFormId } from '@tuner/shared';
import type { ResonanceFormDef } from '../forms.js';

/**
 * The Resonance Forms.
 *
 * A form is a capability, not a weapon skin. Every Commander bent a Frequency
 * Core to 440 Hz; freeing them recovers the Core and the Auralith learns to hold
 * that frequency, which changes how the Tuner moves, fights, solves and
 * explores.
 *
 * The design rules below are asserted in `forms.test.ts` rather than merely
 * described here, because a rule in a document is a hope and a rule in a test is
 * a guarantee:
 *
 * 1. Every non-base form serves at least two distinct `FormCategory` values.
 * 2. Every non-base form has at least one platforming-or-movement ability, one
 *    combat ability, and one secret-or-puzzle ability.
 * 3. No two forms share a colour, icon, silhouette or sound family — they must be
 *    distinguishable by sight and by ear.
 *
 * Those three rules are what stop the roster from collapsing into eight
 * recoloured guns.
 */

/** Sibling hues used where the core palette has no distinct slot left. */
const HUE = {
  tidal: '#3fb9d8',
  ember: '#ff8a4c',
  choir: '#c99bff',
  silence: '#8f9bbf',
  celestial: '#ffe9a3',
} as const;

export const RESONANCE_FORMS: Readonly<Record<ResonanceFormId, ResonanceFormDef>> = {
  base: {
    id: 'base',
    name: 'Open Chord',
    tagline: 'The Auralith as it was made.',
    description:
      'The untransformed instrument. Nothing about it is provisional — every Commander in the ' +
      'world can be freed with this alone.',
    source: 'The Harmonic Sanctuary',
    silhouette: 'ring-open',
    icon: 'form-base',
    soundFamily: 'open',
    tuning: {
      id: 'base',
      damageScale: 1,
      fireIntervalScale: 1,
      projectileSpeedScale: 1,
      harmonicDegree: 0,
      colour: PALETTE.resonance,
    },
    abilities: [
      {
        id: 'pulse',
        name: 'Resonance Pulse',
        description: 'A fast, accurate note. Low recovery, fired while moving or airborne.',
        categories: ['combat'],
      },
      {
        id: 'charge',
        name: 'Charged Chord',
        description: 'Three readable tiers. Breaks reinforced virus plating.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'burst',
        name: 'Harmonic Burst',
        description: 'A radial push that interrupts attacks and strikes nearby resonators.',
        categories: ['combat', 'puzzle'],
      },
      {
        id: 'counter',
        name: 'Resonance Counter',
        description: 'Converts an incoming frequency back at whoever sent it.',
        categories: ['combat'],
      },
    ],
    upgrades: [
      {
        id: 'base-cadence',
        name: 'Steadier Hand',
        description: 'Shortens the gap between pulses, so sustained fire keeps pace with a dash.',
        shardCost: 6,
      },
      {
        id: 'base-reach',
        name: 'Longer Sustain',
        description: 'Pulses travel further before dissipating.',
        shardCost: 8,
      },
    ],
  },

  echo: {
    id: 'echo',
    name: 'Echo Form',
    tagline: 'A note that will not stop arriving.',
    description:
      'Oru held the garden together by repeating one phrase for centuries. The Core remembers ' +
      'how, and now every note the Auralith plays arrives twice.',
    source: 'Oru, the Fractured Colossus',
    silhouette: 'ring-doubled',
    icon: 'form-echo',
    soundFamily: 'echo',
    tuning: {
      id: 'echo',
      damageScale: 0.85,
      fireIntervalScale: 1.1,
      projectileSpeedScale: 0.95,
      harmonicDegree: 4,
      colour: PALETTE.restore,
    },
    abilities: [
      {
        id: 'echo-repeat',
        name: 'Second Arrival',
        description: 'Each shot repeats after a delay, striking a target twice from one press.',
        categories: ['combat'],
      },
      {
        id: 'echo-sequence',
        name: 'Held Sequence',
        description:
          'The repeat strikes a second switch while the first is still lit — the answer to ' +
          'mechanisms one player cannot reach alone.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'echo-platform',
        name: 'Standing Wave',
        description: 'Where a shot expires, a temporary platform forms from the returning note.',
        categories: ['platforming', 'movement'],
      },
      {
        id: 'echo-reveal',
        name: 'Sympathetic Ring',
        description: 'Objects that were never solid ring back, showing what interference hid.',
        categories: ['secret'],
      },
      {
        id: 'echo-record',
        name: 'Recall',
        description: 'Records a short pattern and plays it back exactly.',
        categories: ['puzzle', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'echo-third',
        name: 'Third Arrival',
        description: 'A second repeat, so one shot lights three mechanisms in sequence.',
        shardCost: 12,
      },
      {
        id: 'echo-longer-wave',
        name: 'Longer Standing Wave',
        description: 'Echo platforms persist noticeably longer, opening slower routes.',
        shardCost: 10,
      },
      {
        id: 'echo-tighter',
        name: 'Tighter Interval',
        description: 'Shortens the delay before the repeat, for faster double-hits in a fight.',
        shardCost: 14,
      },
    ],
  },

  prism: {
    id: 'prism',
    name: 'Prism Form',
    tagline: 'One note, several directions.',
    description:
      'The Glass Meridian was built so that a single voice could reach every tower. The ' +
      'Conductor turned that into a trap. The Core turns it back.',
    source: 'The Prism Conductor',
    silhouette: 'ring-faceted',
    icon: 'form-prism',
    soundFamily: 'prism',
    tuning: {
      id: 'prism',
      damageScale: 0.7,
      fireIntervalScale: 1,
      projectileSpeedScale: 1.15,
      harmonicDegree: 2,
      colour: '#7fe8ff',
    },
    abilities: [
      {
        id: 'prism-split',
        name: 'Refraction',
        description: 'A charged note splits into angled shots, covering an arc at once.',
        categories: ['combat'],
      },
      {
        id: 'prism-bounce',
        name: 'Angle of Return',
        description: 'Shots reflect off surfaces, reaching what is behind cover.',
        categories: ['combat', 'secret'],
      },
      {
        id: 'prism-redirect',
        name: 'Redirected Beam',
        description: 'Bends the region’s light beams, steering the platforms they carry.',
        categories: ['platforming', 'environment'],
      },
      {
        id: 'prism-surface',
        name: 'Facet',
        description: 'Places a reflective plane that holds a beam where you need it.',
        categories: ['puzzle', 'platforming'],
      },
      {
        id: 'prism-expose',
        name: 'Clear Sight',
        description: 'Crystalline enemies hiding in refraction are forced back into view.',
        categories: ['secret', 'combat'],
      },
    ],
    upgrades: [
      {
        id: 'prism-wider',
        name: 'Wider Arc',
        description: 'Refraction produces more shots across a broader spread.',
        shardCost: 12,
      },
      {
        id: 'prism-more-bounce',
        name: 'Truer Angle',
        description: 'Shots keep more energy through each reflection, and bounce more often.',
        shardCost: 14,
      },
    ],
  },

  tidal: {
    id: 'tidal',
    name: 'Tidal Form',
    tagline: 'Sound carries further through water.',
    description:
      'The Archive kept its memories in moving water. The Ray drowned them. The Core teaches ' +
      'the Auralith to move the water instead.',
    source: 'The Mnemonic Ray',
    silhouette: 'ring-flowing',
    icon: 'form-tidal',
    soundFamily: 'tidal',
    tuning: {
      id: 'tidal',
      damageScale: 0.8,
      fireIntervalScale: 0.9,
      projectileSpeedScale: 0.85,
      harmonicDegree: 3,
      colour: HUE.tidal,
    },
    abilities: [
      {
        id: 'tidal-stream',
        name: 'Resonance Stream',
        description: 'A sustained current that pushes enemies and objects out of position.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'tidal-swim',
        name: 'Held Breath',
        description: 'Move freely and fully under water, where the Auralith carries furthest.',
        categories: ['movement'],
      },
      {
        id: 'tidal-rail',
        name: 'Water Rail',
        description: 'Forms a temporary current you can grind along.',
        categories: ['platforming', 'movement'],
      },
      {
        id: 'tidal-quench',
        name: 'Quench',
        description: 'Extinguishes volcanic hazards permanently, opening the route behind them.',
        categories: ['environment', 'secret'],
      },
      {
        id: 'tidal-conduct',
        name: 'Conduction',
        description: 'Carries a note through water to a resonator no shot could reach.',
        categories: ['puzzle'],
      },
    ],
    upgrades: [
      {
        id: 'tidal-stronger-current',
        name: 'Stronger Current',
        description: 'Streams push harder and hold objects in place longer.',
        shardCost: 12,
      },
      {
        id: 'tidal-longer-rail',
        name: 'Longer Rail',
        description: 'Water rails reach considerably further before dispersing.',
        shardCost: 15,
      },
    ],
  },

  ember: {
    id: 'ember',
    name: 'Ember Form',
    tagline: 'A note with heat in it.',
    description:
      'The Observatory was built to watch stars, not to burn like one. The Core keeps the heat ' +
      'and gives back the aim.',
    source: 'The Red Amplifier',
    silhouette: 'ring-forge',
    icon: 'form-ember',
    soundFamily: 'ember',
    tuning: {
      id: 'ember',
      damageScale: 1.35,
      fireIntervalScale: 1.35,
      projectileSpeedScale: 0.8,
      harmonicDegree: 6,
      colour: HUE.ember,
    },
    abilities: [
      {
        id: 'ember-detonate',
        name: 'Detonating Note',
        description: 'The charged chord explodes on impact, striking everything nearby.',
        categories: ['combat'],
      },
      {
        id: 'ember-vent',
        name: 'Updraft',
        description: 'Wakes a heat vent and rides the column upward.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'ember-burn',
        name: 'Burn Back',
        description: 'Burns away alien growth that has sealed a passage.',
        categories: ['environment', 'secret'],
      },
      {
        id: 'ember-machinery',
        name: 'Thermal Drive',
        description: 'Powers dormant thermal machinery, including the mechanisms that move it.',
        categories: ['puzzle', 'environment'],
      },
    ],
    upgrades: [
      {
        id: 'ember-wider-blast',
        name: 'Wider Blast',
        description: 'A larger detonation radius, at the cost of a slower charge.',
        shardCost: 13,
      },
      {
        id: 'ember-higher-column',
        name: 'Higher Column',
        description: 'Updrafts carry further, turning a vent into a route rather than a hop.',
        shardCost: 11,
      },
    ],
  },

  choir: {
    id: 'choir',
    name: 'Choir Form',
    tagline: 'Many voices, and all of them yours.',
    description:
      'The Hollow Choir was made to sing in parts. Something forced it into unison. The Core ' +
      'remembers how to be several things at once.',
    source: 'The Many-Mouthed Conductor',
    silhouette: 'ring-chorus',
    icon: 'form-choir',
    soundFamily: 'choir',
    tuning: {
      id: 'choir',
      damageScale: 0.55,
      fireIntervalScale: 1.15,
      projectileSpeedScale: 1,
      harmonicDegree: 5,
      colour: HUE.choir,
    },
    abilities: [
      {
        id: 'choir-harmonise',
        name: 'Harmonised Copies',
        description: 'One press becomes several notes on diverging lines, striking from angles.',
        categories: ['combat'],
      },
      {
        id: 'choir-simultaneous',
        name: 'All At Once',
        description:
          'Lights every mechanism in a group in the same instant — the direct answer to locks ' +
          'that demand simultaneous frequencies.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'choir-decoy',
        name: 'Decoy Performer',
        description: 'Leaves a singing copy of yourself for enemies to attend to.',
        categories: ['combat', 'movement'],
      },
      {
        id: 'choir-sustain',
        name: 'Sustained Parts',
        description: 'Holds several notes at once so nothing lapses while you move.',
        categories: ['puzzle', 'platforming'],
      },
      {
        id: 'choir-voices',
        name: 'Hidden Voices',
        description: 'Reveals voices and memories folded under the region’s single signal.',
        categories: ['secret'],
      },
    ],
    upgrades: [
      {
        id: 'choir-more-voices',
        name: 'Fuller Chorus',
        description: 'More harmonised copies per press.',
        shardCost: 14,
      },
      {
        id: 'choir-longer-decoy',
        name: 'Patient Decoy',
        description: 'Decoys hold attention for longer before dispersing.',
        shardCost: 12,
      },
    ],
  },

  bloom: {
    id: 'bloom',
    name: 'Bloom Form',
    tagline: 'Growth is a kind of resonance.',
    description:
      'The Seed Engine was never a weapon. The Parasite made it one. The Core gives back what ' +
      'it was for.',
    source: 'The Root Parasite',
    silhouette: 'ring-verdant',
    icon: 'form-bloom',
    soundFamily: 'bloom',
    tuning: {
      id: 'bloom',
      damageScale: 0.75,
      fireIntervalScale: 1.05,
      projectileSpeedScale: 0.9,
      harmonicDegree: 1,
      colour: '#7ef0a6',
    },
    abilities: [
      {
        id: 'bloom-root',
        name: 'Rooting',
        description: 'A burst traps everything nearby in growth that holds it still.',
        categories: ['combat'],
      },
      {
        id: 'bloom-platform',
        name: 'Grown Ground',
        description: 'Coaxes a temporary plant platform out of bare stone.',
        categories: ['platforming', 'movement'],
      },
      {
        id: 'bloom-vine',
        name: 'Swinging Vine',
        description: 'Grows a vine long enough to swing from.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'bloom-cleanse',
        name: 'Cleansing',
        description: 'Restores infected wildlife outright rather than fighting it.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'bloom-mend',
        name: 'Mending',
        description: 'Repairs broken organic mechanisms, including the ones hiding a route.',
        categories: ['puzzle', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'bloom-regrowth',
        name: 'Regrowth',
        description: 'Standing on grown ground slowly returns Coherence.',
        shardCost: 16,
      },
      {
        id: 'bloom-deeper-roots',
        name: 'Deeper Roots',
        description: 'Rooting holds enemies substantially longer.',
        shardCost: 12,
      },
    ],
  },

  silence: {
    id: 'silence',
    name: 'Silence Form',
    tagline: 'The loudest thing you can do is stop.',
    description:
      'The Sound Eater consumed every note in the desert. The Core keeps its appetite and ' +
      'points it at the interference instead.',
    source: 'The Sound Eater',
    silhouette: 'ring-hollow',
    icon: 'form-silence',
    soundFamily: 'silence',
    tuning: {
      id: 'silence',
      damageScale: 0.65,
      fireIntervalScale: 0.85,
      projectileSpeedScale: 1.05,
      harmonicDegree: 7,
      colour: HUE.silence,
    },
    abilities: [
      {
        id: 'silence-field',
        name: 'Silence Field',
        description: 'A field that swallows frequency projectiles before they arrive.',
        categories: ['combat'],
      },
      {
        id: 'silence-mute',
        name: 'Muting',
        description: 'Sound-sensitive enemies cannot attack while silenced.',
        categories: ['combat', 'movement'],
      },
      {
        id: 'silence-freeze',
        name: 'Held Breath',
        description: 'Freezes rhythm-based hazards mid-cycle, so a route can be walked.',
        categories: ['platforming', 'environment'],
      },
      {
        id: 'silence-listen',
        name: 'Listening',
        description: 'With the interference gone, signals buried beneath it become legible.',
        categories: ['secret', 'puzzle'],
      },
      {
        id: 'silence-unseen',
        name: 'Unheard',
        description: 'Move without being noticed, past what cannot be fought.',
        categories: ['movement', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'silence-wider-field',
        name: 'Wider Field',
        description: 'The silence reaches further from you.',
        shardCost: 14,
      },
      {
        id: 'silence-longer-hold',
        name: 'Longer Hold',
        description: 'Frozen hazards stay frozen long enough for a slower route.',
        shardCost: 13,
      },
    ],
  },

  celestial: {
    id: 'celestial',
    name: 'Celestial Form',
    tagline: 'Every recovered Core, held as one chord.',
    description:
      'Not taken from anyone. Assembled from all of it — the whole World Chord, played at once ' +
      'by someone who finally knows the whole of it.',
    source: 'The restored World Chord',
    silhouette: 'ring-celestial',
    icon: 'form-celestial',
    soundFamily: 'celestial',
    tuning: {
      id: 'celestial',
      damageScale: 1.2,
      fireIntervalScale: 0.95,
      projectileSpeedScale: 1.2,
      harmonicDegree: 0,
      colour: HUE.celestial,
    },
    abilities: [
      {
        id: 'celestial-chord',
        name: 'World Chord',
        description: 'The charge draws on every recovered frequency at once.',
        categories: ['combat'],
      },
      {
        id: 'celestial-step',
        name: 'Resonance Step',
        description: 'A short teleport between resonance points, through the space between them.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'celestial-drift',
        name: 'Low Gravity',
        description: 'Full control in the air where the world’s pull has thinned.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'celestial-mechanisms',
        name: 'Celestial Mechanism',
        description: 'Opens the Loom’s final locks, which answer to nothing less.',
        categories: ['puzzle', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'celestial-further-step',
        name: 'Further Step',
        description: 'Resonance Step reaches noticeably further.',
        shardCost: 20,
      },
      {
        id: 'celestial-fuller-chord',
        name: 'Fuller Chord',
        description: 'A fourth charge tier, available only here.',
        shardCost: 24,
      },
    ],
  },
};

/** Wheel order. `base` is first so it is always one step away. */
export const FORM_WHEEL_ORDER: readonly ResonanceFormId[] = [
  'base',
  'echo',
  'prism',
  'tidal',
  'ember',
  'choir',
  'bloom',
  'silence',
  'celestial',
];
