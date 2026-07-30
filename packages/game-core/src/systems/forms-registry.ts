import { PALETTE, type ResonanceFormId } from '@tuner/shared';
import { ABILITY_NAMES } from '../adventure-types.js';
import type { ResonanceFormDef } from '../forms.js';

/**
 * The eight abilities, plus the untransformed Auralith.
 *
 * An ability is a *capability*, not a weapon skin. Each one is learned by
 * freeing a guardian: an alien Amplifier is cut out of a creature that was
 * protecting its region before the resonance virus arrived, and what the
 * Auralith keeps afterwards is the guardian's own frequency, not a trophy taken
 * from it. Nothing here is a kill reward, and the language avoids pretending
 * otherwise.
 *
 * **Names.** The ids (`echo`, `prism`, `tidal`, `ember`, `choir`, `bloom`,
 * `silence`, `celestial`) are save keys. They appear verbatim in save files and
 * in both authored regions as `requiresForm`, `clearedBy` and `revealedBy`, so
 * they never change. Every player-facing name comes from {@link ABILITY_NAMES},
 * referenced rather than copied, so the two can never drift apart.
 *
 * The design rules below are asserted in `forms.test.ts` rather than merely
 * described here, because a rule in a document is a hope and a rule in a test is
 * a guarantee:
 *
 * 1. Every non-base ability serves at least two distinct `FormCategory` values.
 * 2. Every non-base ability has at least one exploration-or-movement capability,
 *    one combat capability, and one secret-or-puzzle capability.
 * 3. No two abilities share an accent colour, icon key, silhouette key, sound
 *    family or harmonic degree — they must be told apart by sight and by ear.
 *
 * The seven design pillars an ability may serve map onto `FormCategory` like
 * this, which is how "serves at least two pillars" becomes checkable:
 *
 * | Pillar                    | Category                   |
 * | ------------------------- | -------------------------- |
 * | exploration               | `movement`, `platforming`  |
 * | backtracking             | `movement`, `platforming`  |
 * | puzzles                   | `puzzle`                   |
 * | combat                    | `combat`                   |
 * | boss encounters           | `combat`                   |
 * | secrets                   | `secret`                   |
 * | environmental restoration | `environment`              |
 */

/**
 * Accent hues, one per ability.
 *
 * Chosen for separation rather than prettiness: nine values that stay legible
 * next to each other, and none of them inside the violet band the 440 Hz
 * infection owns (`PALETTE.infection`) or the red the damage alarm owns
 * (`PALETTE.alarm`), because a player must never read their own ability as a
 * threat.
 */
const ACCENT = {
  /** Cyan — the world's own note, and the Auralith untuned. */
  base: PALETTE.resonance,
  /** Spring green — the garden's returning breath. */
  echo: PALETTE.restore,
  /** Mirror white: an ability that gives back exactly what it was handed. */
  prism: '#eef2ff',
  /** Azure — a drawn thread of water and light. */
  tidal: '#3fa9ff',
  /** Orange — the flash left behind by a step. */
  ember: '#ff8a4c',
  /** Rose — two voices at once, warm against the cold regions. */
  choir: '#ff7fb2',
  /** Leaf — growth, and the only ability that is literally alive. */
  bloom: '#8fdc4a',
  /** Slate, deliberately desaturated: the absence of a note has no colour. */
  silence: '#6f7a99',
  /** Radiant gold — every recovered frequency held as one chord. */
  celestial: '#ffe07a',
} as const;

export const RESONANCE_FORMS: Readonly<Record<ResonanceFormId, ResonanceFormDef>> = {
  base: {
    id: 'base',
    name: ABILITY_NAMES.base,
    tagline: 'The Auralith as it was made.',
    description:
      'The untransformed instrument, tuned to the World Chord and nothing else. Nothing about ' +
      'it is provisional: every guardian in the world can be freed with this alone, and the ' +
      'seven abilities change how that is done rather than whether it is possible.',
    source: 'The Harmonic Sanctuary',
    silhouette: 'ring-open',
    icon: 'ability-open-chord',
    soundFamily: 'open-chord',
    tuning: {
      id: 'base',
      damageScale: 1,
      fireIntervalScale: 1,
      projectileSpeedScale: 1,
      harmonicDegree: 0,
      colour: ACCENT.base,
    },
    abilities: [
      {
        id: 'base-pulse',
        name: 'Resonance Pulse',
        description: 'A fast, accurate note. Low recovery, fired while moving or airborne.',
        categories: ['combat'],
      },
      {
        id: 'base-charge',
        name: 'Charged Chord',
        description: 'Three readable tiers. Breaks the reinforced plating the virus grows.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'base-burst',
        name: 'Harmonic Burst',
        description: 'A radial push that interrupts attacks and strikes every resonator in reach.',
        categories: ['combat', 'puzzle'],
      },
      {
        id: 'base-counter',
        name: 'Resonance Counter',
        description: 'Returns an incoming frequency to whoever sent it.',
        categories: ['combat'],
      },
    ],
    upgrades: [
      {
        id: 'base-cadence',
        name: 'Steadier Hand',
        description: 'Shortens the gap between pulses, so sustained fire keeps pace with a step.',
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
    name: ABILITY_NAMES.echo,
    tagline: 'A note that will not stop arriving.',
    description:
      'Oru held the Fractured Garden together by repeating one phrase for centuries. Freed of ' +
      'the Amplifier fused into its chest, it lends the phrase back: a short pulse that arrives ' +
      'twice, repeats what it hears, and rings the world until the world answers.',
    source: 'Oru, the Fractured Colossus — freed in the Fractured Garden',
    silhouette: 'ring-doubled',
    icon: 'ability-echo-pulse',
    soundFamily: 'echo-pulse',
    tuning: {
      id: 'echo',
      damageScale: 0.85,
      fireIntervalScale: 1.1,
      projectileSpeedScale: 0.95,
      harmonicDegree: 4,
      colour: ACCENT.echo,
    },
    abilities: [
      {
        id: 'echo-pulse',
        name: 'Short Pulse',
        description: 'A brief resonance pulse that lands, and then lands again a beat later.',
        categories: ['combat'],
      },
      {
        id: 'echo-motif',
        name: 'Repeated Motif',
        description:
          'Holds a motif it has detected and plays it back exactly — including motifs the ' +
          'player never learned to hum.',
        categories: ['puzzle', 'secret'],
      },
      {
        id: 'echo-mechanism',
        name: 'Struck Mechanism',
        description:
          'Activates mechanisms at range, and the repeat strikes a second one while the first ' +
          'is still lit — the answer to locks one pair of hands cannot reach.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'echo-interrupt',
        name: 'Interrupted Signal',
        description: 'Cuts a creature’s signal mid-transmission, ending an attack before it opens.',
        categories: ['combat'],
      },
      {
        id: 'echo-path',
        name: 'Returning Path',
        description:
          'Hidden geometry rings back when the pulse passes it, and a pulse that expires in ' +
          'open air leaves a standing wave solid enough to cross.',
        categories: ['secret', 'platforming', 'movement'],
      },
    ],
    upgrades: [
      {
        id: 'echo-third-arrival',
        name: 'Third Arrival',
        description: 'A second repeat, so one press lights three mechanisms in sequence.',
        shardCost: 12,
      },
      {
        id: 'echo-longer-wave',
        name: 'Longer Standing Wave',
        description: 'Standing waves persist noticeably longer, opening slower routes.',
        shardCost: 10,
      },
      {
        id: 'echo-tighter-interval',
        name: 'Tighter Interval',
        description: 'Shortens the delay before the repeat, for faster double-hits in a fight.',
        shardCost: 14,
      },
    ],
  },

  prism: {
    id: 'prism',
    name: ABILITY_NAMES.prism,
    tagline: 'Give it back exactly as it came.',
    description:
      'The Glass Meridian was built so one voice could reach every tower. Sella turned that ' +
      'into a trap while the Amplifier rode her. Freed, she leaves the Auralith able to return ' +
      'a frequency to its sender, and to read a pattern backwards.',
    source: 'Sella, the Prism Conductor — freed in the Glass Meridian',
    silhouette: 'ring-mirrored',
    icon: 'ability-mirror-tone',
    soundFamily: 'mirror-tone',
    tuning: {
      id: 'prism',
      damageScale: 0.7,
      fireIntervalScale: 1,
      projectileSpeedScale: 1.15,
      harmonicDegree: 2,
      colour: ACCENT.prism,
    },
    abilities: [
      {
        id: 'prism-reflect',
        name: 'Returned Attack',
        description:
          'Reflects a frequency attack back along the line it arrived on, at the strength it ' +
          'was sent with.',
        categories: ['combat'],
      },
      {
        id: 'prism-invert',
        name: 'Inverted Pattern',
        description:
          'Turns a puzzle’s pattern inside out — lit becomes unlit — which is the only way ' +
          'through a lock the virus wrote backwards.',
        categories: ['puzzle'],
      },
      {
        id: 'prism-redirect',
        name: 'Redirected Beam',
        description: 'Bends a region’s beams, steering the platforms and doors they carry.',
        categories: ['platforming', 'environment'],
      },
      {
        id: 'prism-copy',
        name: 'Signal Copy',
        description:
          'Leaves a temporary copy of a signal: it holds a lock open, or holds a creature’s ' +
          'attention, while the real one is elsewhere.',
        categories: ['puzzle', 'combat'],
      },
      {
        id: 'prism-behind',
        name: 'Angle of Return',
        description:
          'A note angled off a surface reaches what is behind cover — including the alcoves ' +
          'nobody was meant to see into.',
        categories: ['combat', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'prism-truer-angle',
        name: 'Truer Angle',
        description: 'Notes keep more energy through each reflection, and reflect more often.',
        shardCost: 14,
      },
      {
        id: 'prism-longer-copy',
        name: 'Patient Copy',
        description: 'Signal copies persist long enough to cross the room they are holding open.',
        shardCost: 12,
      },
    ],
  },

  tidal: {
    id: 'tidal',
    name: ABILITY_NAMES.tidal,
    tagline: 'Two distant things, made one circuit.',
    description:
      'Vess kept the Tidal Archive’s memories moving through water until the Amplifier made ' +
      'her drown them. Freed, she leaves a thread: draw it between two things and whatever one ' +
      'of them has — charge, tone, motion — the other has too.',
    source: 'Vess, the Mnemonic Ray — freed in the Tidal Archive',
    silhouette: 'ring-threaded',
    icon: 'ability-resonance-thread',
    soundFamily: 'resonance-thread',
    tuning: {
      id: 'tidal',
      damageScale: 0.8,
      fireIntervalScale: 0.9,
      projectileSpeedScale: 0.85,
      harmonicDegree: 3,
      colour: ACCENT.tidal,
    },
    abilities: [
      {
        id: 'tidal-connect',
        name: 'Drawn Thread',
        description:
          'Connects two distant objects so one answers for both — a switch on this side of a ' +
          'chasm and a door on the other.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'tidal-transfer',
        name: 'Transferred Energy',
        description:
          'Carries charge along the thread into something dormant, waking machinery that has ' +
          'no power of its own.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'tidal-rail',
        name: 'Thread Rail',
        description: 'Pulls the thread taut into a temporary rail and rides it.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'tidal-restrain',
        name: 'Bound Thread',
        description:
          'Wraps a creature and holds it still for a few seconds. It restrains; it does not ' +
          'harm.',
        categories: ['combat'],
      },
      {
        id: 'tidal-conduct',
        name: 'Conduction',
        description:
          'Conducts a tone through water, stone and cable to a resonator no shot could reach, ' +
          'and holds it sounding twice as long.',
        categories: ['puzzle', 'secret'],
      },
    ],
    upgrades: [
      {
        id: 'tidal-longer-thread',
        name: 'Longer Thread',
        description: 'The thread reaches considerably further before it thins and parts.',
        shardCost: 15,
      },
      {
        id: 'tidal-second-thread',
        name: 'Second Thread',
        description: 'A second thread, held at the same time as the first.',
        shardCost: 18,
      },
    ],
  },

  ember: {
    id: 'ember',
    name: ABILITY_NAMES.ember,
    tagline: 'Arrive before the note does.',
    description:
      'Kaleth watched stars from the Ember Observatory until the Amplifier made him burn like ' +
      'one. Freed, what he leaves is not heat but *timing*: a step that crosses the gap between ' +
      'two beats, which is where nothing can touch you and where every rhythmic barrier is open.',
    source: 'Kaleth, the Red Amplifier — freed in the Ember Observatory',
    silhouette: 'ring-stride',
    icon: 'ability-pulse-step',
    soundFamily: 'pulse-step',
    tuning: {
      id: 'ember',
      damageScale: 0.9,
      fireIntervalScale: 0.9,
      projectileSpeedScale: 1.3,
      harmonicDegree: 6,
      colour: ACCENT.ember,
    },
    abilities: [
      {
        id: 'ember-step',
        name: 'Pulse Step',
        description:
          'A fast directional step, ground or air, that recovers far quicker than an ordinary ' +
          'dash.',
        categories: ['movement'],
      },
      {
        id: 'ember-dodge',
        name: 'Stepped Aside',
        description:
          'The step itself is the dodge: for as long as it lasts, an incoming attack passes ' +
          'through where the Tuner no longer is.',
        categories: ['combat', 'movement'],
      },
      {
        id: 'ember-between-beats',
        name: 'Between Beats',
        description:
          'Crosses rhythmic barriers in the silence between their pulses, rather than waiting ' +
          'for a gap that never widens.',
        categories: ['platforming', 'environment'],
      },
      {
        id: 'ember-chain',
        name: 'Chained Step',
        description:
          'A resonant surface nearby — a creature, a resonator, a conjured platform — returns ' +
          'the step, so one becomes a chain across open space.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'ember-reach',
        name: 'Stepped Reach',
        description:
          'Puts ledges, alcoves and shortcuts within reach that no jump answers, including ' +
          'ones behind a region already finished.',
        categories: ['secret', 'platforming'],
      },
    ],
    upgrades: [
      {
        id: 'ember-quicker-step',
        name: 'Quicker Recovery',
        description: 'The step is ready again sooner, tightening a chain into a single motion.',
        shardCost: 11,
      },
      {
        id: 'ember-longer-window',
        name: 'Wider Silence',
        description: 'The untouchable part of the step lasts slightly longer.',
        shardCost: 13,
      },
    ],
  },

  choir: {
    id: 'choir',
    name: ABILITY_NAMES.choir,
    tagline: 'Be in two places, musically.',
    description:
      'The Hollow Choir was built to sing in parts, and the Amplifier forced Ombra to sing it ' +
      'in unison. Freed, she leaves the Auralith able to hold two signals at once — which is ' +
      'also how a fused frequency gets pulled back apart.',
    source: 'Ombra, the Many-Mouthed Conductor — freed in the Hollow Choir',
    silhouette: 'ring-split',
    icon: 'ability-split-chord',
    soundFamily: 'split-chord',
    tuning: {
      id: 'choir',
      damageScale: 0.55,
      fireIntervalScale: 1.15,
      projectileSpeedScale: 1,
      harmonicDegree: 5,
      colour: ACCENT.choir,
    },
    abilities: [
      {
        id: 'choir-two-signals',
        name: 'Two Signals',
        description:
          'Maintains two simultaneous notes, so neither lapses while the Tuner crosses to the ' +
          'next thing that needs one.',
        categories: ['puzzle', 'platforming'],
      },
      {
        id: 'choir-paired',
        name: 'Paired Mechanism',
        description: 'Lights a linked pair in the same instant, however far apart they were set.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'choir-separate',
        name: 'Separated Frequency',
        description:
          'Splits a fused frequency, peeling the alien signal off a creature instead of ' +
          'destroying the creature carrying it.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'choir-decoy',
        name: 'Harmonic Decoy',
        description: 'Leaves a singing copy of the Tuner for a creature to attend to instead.',
        categories: ['combat', 'movement'],
      },
      {
        id: 'choir-buried-voices',
        name: 'Buried Voices',
        description:
          'One voice asks and the other listens, which is how a region’s hidden parts get ' +
          'heard under its single enforced note.',
        categories: ['secret'],
      },
    ],
    upgrades: [
      {
        id: 'choir-fuller-chorus',
        name: 'Fuller Chorus',
        description: 'More voices per press, spread across a wider arc.',
        shardCost: 14,
      },
      {
        id: 'choir-patient-decoy',
        name: 'Patient Decoy',
        description: 'Decoys hold attention noticeably longer before dispersing.',
        shardCost: 12,
      },
    ],
  },

  bloom: {
    id: 'bloom',
    name: ABILITY_NAMES.bloom,
    tagline: 'Growth is a kind of resonance.',
    description:
      'The Verdant Machine’s Seed Engine was never a weapon; the Amplifier in Thess made it ' +
      'one. Freed, she gives back what it was for — a wave that restores living matter, grows ' +
      'what should be there, and closes the nests the virus grew instead.',
    source: 'Thess, the Root Parasite — freed in the Verdant Machine',
    silhouette: 'ring-verdant',
    icon: 'ability-bloom-wave',
    soundFamily: 'bloom-wave',
    tuning: {
      id: 'bloom',
      damageScale: 0.75,
      fireIntervalScale: 1.05,
      projectileSpeedScale: 0.9,
      harmonicDegree: 1,
      colour: ACCENT.bloom,
    },
    abilities: [
      {
        id: 'bloom-restore',
        name: 'Restored Matter',
        description:
          'Restores infected wildlife outright rather than fighting it — the creature walks ' +
          'away, and so do you.',
        categories: ['combat', 'environment'],
      },
      {
        id: 'bloom-roots',
        name: 'Rooting Wave',
        description: 'Growth erupts underfoot and holds everything nearby still.',
        categories: ['combat'],
      },
      {
        id: 'bloom-platform',
        name: 'Grown Ground',
        description: 'Coaxes roots and platforms out of bare stone, and a vine long enough to swing.',
        categories: ['platforming', 'movement'],
      },
      {
        id: 'bloom-nest',
        name: 'Cleansed Nest',
        description:
          'Cleanses a virus nest at its root, closing the spawn and opening whatever it was ' +
          'sitting on top of.',
        categories: ['environment', 'secret'],
      },
      {
        id: 'bloom-dormant',
        name: 'Woken System',
        description:
          'Revives dormant natural systems — seed locks, old irrigation, a grove that used to ' +
          'be a door.',
        categories: ['puzzle', 'environment'],
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
        description: 'Rooting holds substantially longer, and reaches further out.',
        shardCost: 12,
      },
    ],
  },

  silence: {
    id: 'silence',
    name: ABILITY_NAMES.silence,
    tagline: 'The loudest thing you can do is stop.',
    description:
      'Nul ate every note in the Desert of Lost Notes because the Amplifier told it hunger was ' +
      'a purpose. Freed, it keeps the appetite and points it at the interference: inside the ' +
      'field, frequency projectiles simply do not arrive, and what the noise was covering can ' +
      'finally be heard. The Celestial Loom cannot be finished without it.',
    source: 'Nul, the Sound Eater — freed in the Desert of Lost Notes',
    silhouette: 'ring-hollow',
    icon: 'ability-silence-field',
    soundFamily: 'silence-field',
    tuning: {
      id: 'silence',
      damageScale: 0.65,
      fireIntervalScale: 0.85,
      projectileSpeedScale: 1.05,
      harmonicDegree: 7,
      colour: ACCENT.silence,
    },
    abilities: [
      {
        id: 'silence-stop',
        name: 'Stopped Projectile',
        description: 'Frequency projectiles that enter the field stop existing at its edge.',
        categories: ['combat'],
      },
      {
        id: 'silence-stealth',
        name: 'Stealth Zone',
        description:
          'Inside the field nothing hears the Tuner, which is how a route past something ' +
          'unfightable gets walked.',
        categories: ['movement', 'secret'],
      },
      {
        id: 'silence-reveal',
        name: 'Revealed Signal',
        description:
          'With the interference gone, signals buried underneath it become legible — including ' +
          'the ones the virus was hiding on purpose.',
        categories: ['secret', 'puzzle'],
      },
      {
        id: 'silence-cancel',
        name: 'Cancelled Interference',
        description:
          'Cancels the 440 Hz interference holding a mechanism shut, and freezes rhythmic ' +
          'hazards mid-cycle.',
        categories: ['puzzle', 'environment'],
      },
      {
        id: 'silence-finale',
        name: 'Held Silence',
        description:
          'The Loom’s final movement is a wall of sound with one quiet place in it. This is how ' +
          'that place is made.',
        categories: ['combat', 'environment'],
      },
    ],
    upgrades: [
      {
        id: 'silence-wider-field',
        name: 'Wider Field',
        description: 'The silence reaches further from the Tuner.',
        shardCost: 14,
      },
      {
        id: 'silence-longer-hold',
        name: 'Longer Hold',
        description: 'Silenced creatures and frozen hazards stay held long enough for a slow route.',
        shardCost: 13,
      },
    ],
  },

  celestial: {
    id: 'celestial',
    name: ABILITY_NAMES.celestial,
    tagline: 'Every restored frequency, sounded at once.',
    description:
      'Taken from nobody. Assembled from all of it — every fragment restored on the way here, ' +
      'played together by someone who finally knows the whole of it. While it is held, the ' +
      'abilities the Tuner has already earned keep working underneath it.',
    source: 'The restored World Chord, assembled at the Celestial Loom',
    silhouette: 'ring-celestial',
    icon: 'ability-world-chord',
    soundFamily: 'world-chord',
    tuning: {
      id: 'celestial',
      damageScale: 1.2,
      fireIntervalScale: 0.95,
      projectileSpeedScale: 1.2,
      /**
       * One step past the Octave, which folds back onto the Root: the World
       * Chord *is* 432 Hz, arrived at from the far end of the scale rather than
       * started from. Distinct from `base`'s degree 0 so no two abilities share
       * a degree, and the same pitch, because the world only has one.
       */
      harmonicDegree: 8,
      colour: ACCENT.celestial,
    },
    abilities: [
      {
        id: 'celestial-chord',
        name: 'World Chord',
        description: 'Every recovered frequency drawn into one charge, and released as one note.',
        categories: ['combat'],
      },
      {
        id: 'celestial-step',
        name: 'Chorded Step',
        description: 'Steps between resonance points, through the space between them.',
        categories: ['movement', 'platforming'],
      },
      {
        id: 'celestial-open',
        name: 'Final Lock',
        description:
          'Opens the Loom’s last locks, which answer to nothing smaller, and the doors kept ' +
          'shut since the first region.',
        categories: ['puzzle', 'secret'],
      },
      {
        id: 'celestial-restore',
        name: 'Restored Region',
        description: 'Returns a whole region to 432 Hz in one sustained chord.',
        categories: ['environment'],
      },
    ],
    upgrades: [
      {
        id: 'celestial-further-step',
        name: 'Further Step',
        description: 'The Chorded Step reaches noticeably further.',
        shardCost: 20,
      },
      {
        id: 'celestial-fuller-chord',
        name: 'Fuller Chord',
        description: 'A fourth charge tier, available nowhere else.',
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

// ---------------------------------------------------------------------------
// Resonance Sight
// ---------------------------------------------------------------------------

/**
 * What Resonance Sight surfaces.
 *
 * Resonance Sight is *not* one of the eight abilities. It is always available,
 * from the first minute of the game, and it is held rather than toggled
 * (`player.resonanceSightActive`). It exists because a world about listening
 * cannot ask the player to listen with their ears alone: everything the mode
 * reveals is a visual statement of something the region is doing acoustically,
 * which is what lets the critical path be completed with the sound muted.
 *
 * The list is data rather than a renderer detail so the shader overlay, the HUD
 * legend, the accessibility screen and the codex all describe the same nine
 * things in the same order, instead of each inventing its own subset.
 */
export type ResonanceSightCategory =
  | 'frequency'
  | 'geometry'
  | 'threat'
  | 'memory'
  | 'secret'
  | 'anchor'
  | 'infection';

export interface ResonanceSightReveal {
  /** Stable key. Renderer overlays and UI legends both index on this. */
  readonly id: string;
  /** Player-facing label, short enough for a legend row. */
  readonly label: string;
  readonly description: string;
  readonly category: ResonanceSightCategory;
  /** Overlay key the renderer draws for this reveal. */
  readonly overlay: string;
  /** Accent the overlay tints with. */
  readonly colour: string;
  /**
   * True where the reveal carries information that is otherwise only audible.
   * These are the ones the muted critical path depends on, so they may never be
   * reduced to decoration or hidden behind a quality preset.
   */
  readonly criticalPath: boolean;
}

export const RESONANCE_SIGHT_REVEALS: readonly ResonanceSightReveal[] = [
  {
    id: 'hidden-frequencies',
    label: 'Hidden frequencies',
    description:
      'Tones sounding in the region that nothing visible accounts for, drawn as rings at the ' +
      'point they radiate from.',
    category: 'frequency',
    overlay: 'sight-frequency-rings',
    colour: PALETTE.resonance,
    criticalPath: true,
  },
  {
    id: 'broken-paths',
    label: 'Broken geometric paths',
    description:
      'Routes the region used to have: collapsed bridges, missing terraces and shattered ' +
      'stairs, drawn as the line they once completed.',
    category: 'geometry',
    overlay: 'sight-path-ghost',
    colour: PALETTE.gold,
    criticalPath: true,
  },
  {
    id: 'invisible-platforms',
    label: 'Invisible platforms',
    description:
      'Surfaces held in phase by a frequency rather than by matter. Solid to stand on, ' +
      'unreadable without the mode.',
    category: 'geometry',
    overlay: 'sight-phase-surface',
    colour: ACCENT.prism,
    criticalPath: true,
  },
  {
    id: 'alien-weak-points',
    label: 'Alien weak points',
    description:
      'Where an Amplifier is fused into a creature or a structure — the join that can be cut ' +
      'without harming what it was fused to.',
    category: 'threat',
    overlay: 'sight-weak-point',
    colour: PALETTE.alarm,
    criticalPath: true,
  },
  {
    id: 'buried-melodies',
    label: 'Buried melodies',
    description:
      'Motif fragments held in stone, water or machinery, shown as the sequence of degrees they ' +
      'contain so they can be read rather than only heard.',
    category: 'memory',
    overlay: 'sight-motif-staff',
    colour: ACCENT.choir,
    criticalPath: true,
  },
  {
    id: 'emotional-echoes',
    label: 'Emotional echoes',
    description:
      'Traces of what happened in a place, drawn as figures of standing sound. They explain a ' +
      'region; they never gate it.',
    category: 'memory',
    overlay: 'sight-echo-figures',
    colour: ACCENT.celestial,
    criticalPath: false,
  },
  {
    id: 'secret-objects',
    label: 'Secret objects',
    description:
      'Caches, shrines and fragments deliberately placed out of sight, outlined through the ' +
      'geometry hiding them.',
    category: 'secret',
    overlay: 'sight-secret-outline',
    colour: ACCENT.bloom,
    criticalPath: false,
  },
  {
    id: 'natural-anchors',
    label: 'Natural 432 Hz anchors',
    description:
      'Places the world is still itself: untouched anchors that a restoration can be measured ' +
      'and tuned against.',
    category: 'anchor',
    overlay: 'sight-anchor-bloom',
    colour: PALETTE.restore,
    criticalPath: true,
  },
  {
    id: 'infection-sources',
    label: '440 Hz infection sources',
    description:
      'Where the detuning is coming from, and how strongly, so a region can be worked back ' +
      'toward 432 Hz from the source rather than the symptom.',
    category: 'infection',
    overlay: 'sight-infection-source',
    colour: PALETTE.infection,
    criticalPath: true,
  },
];
