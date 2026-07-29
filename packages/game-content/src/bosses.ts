import type { BossDef } from '@tuner/game-core';

/**
 * Commanders and mini-bosses.
 *
 * A TUNER boss is a rhythm you learn, not a health bar you outlast. Every
 * definition here obeys the same contract, which `bestiary.test.ts` enforces:
 *
 * 1. **Readability.** No attack telegraphs for less than 0.4 s, and every
 *    telegraph is drawn as well as sounded — the accessibility layer's timing
 *    rings key off `telegraphSeconds`, so the fights must remain fair with the
 *    volume at zero.
 * 2. **Punishment is earned.** Each boss has at least one attack with
 *    `opensVulnerability`, so the loop is telegraph → dodge → punish rather
 *    than telegraph → dodge → wait.
 * 3. **Phases descend.** The first phase begins at full health; each later
 *    phase threshold is strictly lower, and every phase names attacks that
 *    actually exist on that boss.
 * 4. **Forms are advantages, never gates.** `formAdvantages` only ever holds
 *    multipliers at or above 1, never covers the whole form roster, and never
 *    lists `base` — the untransformed Auralith can beat every fight in the
 *    game. A form makes a fight *different*, and sometimes shorter; it is never
 *    the price of admission.
 *
 * The seven commanders each surrender a distinct Resonance Form. The two
 * mini-bosses award nothing: they exist to teach the language the commander
 * will speak.
 */

export const BOSSES: Readonly<Record<string, BossDef>> = {
  // -------------------------------------------------------------------------
  // Fallen Sanctuary — mini-boss
  // -------------------------------------------------------------------------

  /**
   * The Sanctuary's own door-warden: a seated figure of quarried stone and gold
   * inlay, a halo of three concentric rings turning slowly above its shoulders.
   * The infection has soured the halo to violet and woken it out of order.
   *
   * This is the game's first fight, and it is a grammar lesson. Two phases,
   * five attacks, everything slow, everything ringed, everything punishable.
   * Phase 1 teaches "the ring on the floor means jump"; phase 2 teaches "the
   * slam means it is open afterwards".
   */
  'sanctuary-guardian': {
    id: 'sanctuary-guardian',
    displayName: 'Vault Warden',
    title: 'Guardian of the Fallen Sanctuary',
    stageId: 'fallen-sanctuary',
    isMiniBoss: true,
    health: 900,
    bodyRadius: 1.6,
    bodyHeight: 4.2,
    arenaCentre: { x: 0, y: 0, z: -64 },
    arenaRadius: 18,
    phases: [
      {
        index: 1,
        name: 'Dormant Rite',
        healthThreshold: 1,
        arenaFlags: ['sanctuary-braziers-dim'],
        attackIds: ['sg-ring-sweep', 'sg-sanctum-stomp', 'sg-triple-chime'],
        attackInterval: 2.6,
      },
      {
        index: 2,
        name: 'Detuned Awakening',
        healthThreshold: 0.5,
        arenaFlags: ['sanctuary-braziers-lit', 'halo-violet', 'floor-glyphs-active'],
        attackIds: [
          'sg-ring-sweep',
          'sg-sanctum-stomp',
          'sg-triple-chime',
          'sg-halo-lattice',
          'sg-plated-rush',
        ],
        attackInterval: 2,
      },
    ],
    attacks: [
      {
        id: 'sg-ring-sweep',
        displayName: 'Ring Sweep',
        telegraphSeconds: 0.75,
        durationSeconds: 0.9,
        recoverySeconds: 0.8,
        phases: [1, 2],
        weight: 3,
      },
      {
        id: 'sg-sanctum-stomp',
        displayName: 'Sanctum Stomp',
        telegraphSeconds: 0.9,
        durationSeconds: 0.5,
        recoverySeconds: 1.4,
        phases: [1, 2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'sg-triple-chime',
        displayName: 'Triple Chime',
        telegraphSeconds: 0.6,
        durationSeconds: 1.2,
        recoverySeconds: 0.7,
        phases: [1, 2],
        weight: 2,
      },
      {
        id: 'sg-halo-lattice',
        displayName: 'Halo Lattice',
        telegraphSeconds: 1,
        durationSeconds: 2,
        recoverySeconds: 1.1,
        phases: [2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'sg-plated-rush',
        displayName: 'Plated Rush',
        telegraphSeconds: 0.85,
        durationSeconds: 1,
        recoverySeconds: 1.2,
        phases: [2],
        weight: 1,
        advancedOnly: true,
      },
    ],
    // Meaningful only on a revisit; the player owns no form the first time here.
    formAdvantages: { echo: 1.15, tidal: 1.2 },
    restorationSequence: [0, 4, 7],
  },

  // -------------------------------------------------------------------------
  // Fractured Garden — mini-boss
  // -------------------------------------------------------------------------

  /**
   * A flower the size of a gatehouse, grown out of the Garden's cracked
   * seedbed: eight obsidian petals edged in gold, a violet corona, and a throat
   * that fires its own seeds. It is the infection wearing the Garden's shape,
   * which is why it is not cleansable — nothing of the Garden is left in it.
   *
   * Four ideas, in order: seeds you must move away from, walls that take space
   * away from you, a sweep that punishes standing, and a slam that hands you a
   * free window. Phase 2 runs all six and adds a fast low lash so the player
   * cannot settle into one rhythm.
   */
  'virus-bloom': {
    id: 'virus-bloom',
    displayName: 'Virus Bloom',
    title: 'The Seeded Wound',
    stageId: 'fractured-garden',
    isMiniBoss: true,
    health: 1400,
    bodyRadius: 2.2,
    bodyHeight: 3.6,
    arenaCentre: { x: 22, y: 0, z: -108 },
    arenaRadius: 20,
    phases: [
      {
        index: 1,
        name: 'Opening Corolla',
        healthThreshold: 1,
        arenaFlags: ['garden-seedbed-cracked'],
        attackIds: ['vb-seed-volley', 'vb-infected-wall', 'vb-pollen-sweep'],
        attackInterval: 2.8,
      },
      {
        index: 2,
        name: 'Second Corolla',
        healthThreshold: 0.5,
        arenaFlags: ['garden-walls-raised', 'pollen-haze', 'seedbed-violet'],
        attackIds: [
          'vb-seed-volley',
          'vb-infected-wall',
          'vb-pollen-sweep',
          'vb-corolla-slam',
          'vb-root-lash',
          'vb-mine-lattice',
        ],
        attackInterval: 2.2,
      },
    ],
    attacks: [
      {
        id: 'vb-seed-volley',
        displayName: 'Seed Volley',
        telegraphSeconds: 0.7,
        durationSeconds: 1.1,
        recoverySeconds: 0.9,
        phases: [1, 2],
        weight: 3,
      },
      {
        id: 'vb-infected-wall',
        displayName: 'Infected Wall',
        telegraphSeconds: 0.9,
        durationSeconds: 3.2,
        recoverySeconds: 0.6,
        phases: [1, 2],
        weight: 2,
      },
      {
        id: 'vb-pollen-sweep',
        displayName: 'Pollen Sweep',
        telegraphSeconds: 0.8,
        durationSeconds: 1.6,
        recoverySeconds: 1.2,
        phases: [1, 2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'vb-corolla-slam',
        displayName: 'Corolla Slam',
        telegraphSeconds: 1,
        durationSeconds: 0.6,
        recoverySeconds: 1.5,
        phases: [2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'vb-root-lash',
        displayName: 'Root Lash',
        telegraphSeconds: 0.5,
        durationSeconds: 0.5,
        recoverySeconds: 0.7,
        phases: [2],
        weight: 2,
      },
      {
        id: 'vb-mine-lattice',
        displayName: 'Mine Lattice',
        telegraphSeconds: 1.1,
        durationSeconds: 2.4,
        recoverySeconds: 1,
        phases: [2],
        weight: 1,
        advancedOnly: true,
      },
    ],
    formAdvantages: { ember: 1.25, tidal: 1.15, silence: 1.2 },
    restorationSequence: [0, 3, 7],
  },

  // -------------------------------------------------------------------------
  // Fractured Garden — commander
  // -------------------------------------------------------------------------

  /**
   * **Oru.** Before the Detuners came he was the Garden's colossus: a walking
   * terrace of mossed stone with a gold seam down his chest, who carried
   * seedlings between the tiers and slept standing in the rain. An Amplifier is
   * now grown into that seam, and every attack he makes is the Amplifier's, not
   * his — the animation set deliberately shows him flinching from his own
   * blows, and his eyes stay cyan under the violet.
   *
   * The fight must read as freeing a friend. Nothing he does is cruel; it is
   * loud. The arena never becomes a spike pit, only harder to move in. He never
   * finishes a downed player. And the ending is not a death: at zero health the
   * Amplifier ruptures, he kneels, and the player plays the restoration
   * sequence into the open wound.
   *
   * Structure, per the design brief:
   * - **Phase 1** teaches the attack language — sweep, ring, counterable seed.
   *   Nothing new, nothing fast; the whole phase is a vocabulary test.
   * - **Phase 2** adds movement pressure and changes the arena: terraces rise
   *   and fall, vines herd, and he starts crossing the ring at speed.
   * - **Phase 3** is the full 440 Hz corruption state — the Amplifier takes
   *   over completely, splits into three mouths, and Oru is barely visible
   *   inside it.
   */
  'oru-fractured-colossus': {
    id: 'oru-fractured-colossus',
    displayName: 'Oru',
    title: 'The Fractured Colossus',
    stageId: 'fractured-garden',
    health: 3200,
    bodyRadius: 2.4,
    bodyHeight: 6.4,
    arenaCentre: { x: 0, y: 0, z: -160 },
    arenaRadius: 26,
    phases: [
      {
        index: 1,
        name: 'The Protector Remembers',
        healthThreshold: 1,
        arenaFlags: ['garden-terraces-intact', 'oru-eyes-cyan'],
        attackIds: ['oru-guardian-sweep', 'oru-amplifier-pulse', 'oru-stone-seed'],
        attackInterval: 3,
      },
      {
        index: 2,
        name: 'Pressure of the Amplifier',
        healthThreshold: 0.66,
        arenaFlags: ['garden-terraces-raised', 'vines-active', 'pollen-haze'],
        attackIds: [
          'oru-guardian-sweep',
          'oru-amplifier-pulse',
          'oru-stone-seed',
          'oru-terrace-collapse',
          'oru-vine-lattice',
          'oru-grief-charge',
        ],
        attackInterval: 2.4,
      },
      {
        index: 3,
        name: 'Four-Forty',
        healthThreshold: 0.3,
        arenaFlags: [
          'arena-detuned',
          'sky-violet',
          'stone-shards-orbiting',
          'garden-terraces-shattered',
        ],
        attackIds: [
          'oru-guardian-sweep',
          'oru-amplifier-pulse',
          'oru-terrace-collapse',
          'oru-vine-lattice',
          'oru-grief-charge',
          'oru-dissonant-choir',
          'oru-fracture-rain',
          'oru-lament',
        ],
        attackInterval: 2,
      },
    ],
    attacks: [
      {
        /** A slow forearm sweep along the ground. Dash through it or jump it;
         *  either way he is off balance for over a second afterwards. */
        id: 'oru-guardian-sweep',
        displayName: 'Guardian Sweep',
        telegraphSeconds: 0.85,
        durationSeconds: 0.8,
        recoverySeconds: 1.3,
        phases: [1, 2, 3],
        weight: 3,
        opensVulnerability: true,
      },
      {
        /** The chest Amplifier charges violet and pushes an expanding ring out
         *  along the floor. Jump the ring — the game's most-repeated verb. */
        id: 'oru-amplifier-pulse',
        displayName: 'Amplifier Pulse',
        telegraphSeconds: 0.95,
        durationSeconds: 0.7,
        recoverySeconds: 1.1,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        /** Lobs three counterable stone seeds. A countered seed flies back into
         *  the Amplifier and staggers him, which is the fight's core trade.
         *  Absent from phase 3: by then the Amplifier has stopped letting him
         *  reach for the seedbed at all. */
        id: 'oru-stone-seed',
        displayName: 'Stone Seed Toss',
        telegraphSeconds: 0.7,
        durationSeconds: 1.2,
        recoverySeconds: 0.9,
        phases: [1, 2],
        weight: 2,
      },
      {
        /** Strikes the arena rim; a ring of garden terraces rises and falls in
         *  a wave. Pure movement pressure — it deals no damage on its own. */
        id: 'oru-terrace-collapse',
        displayName: 'Terrace Collapse',
        telegraphSeconds: 1.2,
        durationSeconds: 2.6,
        recoverySeconds: 1,
        phases: [2, 3],
        weight: 2,
      },
      {
        /** Infected vines rise as slow moving walls, herding the player toward
         *  the arena edge without ever fully enclosing them. */
        id: 'oru-vine-lattice',
        displayName: 'Vine Lattice',
        telegraphSeconds: 0.9,
        durationSeconds: 3,
        recoverySeconds: 0.8,
        phases: [2, 3],
        weight: 2,
      },
      {
        /** He lowers a shoulder and runs a straight line across the ring,
         *  ending against the wall — the longest punish window in the fight. */
        id: 'oru-grief-charge',
        displayName: 'Grief Charge',
        telegraphSeconds: 0.8,
        durationSeconds: 1.4,
        recoverySeconds: 1.8,
        phases: [2, 3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        /** The Amplifier splits into three mouths and sweeps overlapping
         *  detuned beams. Gaps rotate; the safe wedge is always visible. */
        id: 'oru-dissonant-choir',
        displayName: 'Dissonant Choir',
        telegraphSeconds: 1.3,
        durationSeconds: 3.4,
        recoverySeconds: 1.4,
        phases: [3],
        weight: 3,
        opensVulnerability: true,
      },
      {
        /** He tears plating off his own back and throws it upward; violet
         *  shards fall on marked ground. The marks lead somewhere safe. */
        id: 'oru-fracture-rain',
        displayName: 'Fracture Rain',
        telegraphSeconds: 1,
        durationSeconds: 2.2,
        recoverySeconds: 1.1,
        phases: [3],
        weight: 2,
      },
      {
        /** A held 440 Hz chord that bleeds Coherence until the player breaks
         *  line of sight behind a risen terrace. It ends with Oru doubled over
         *  — the only moment in the fight where he sounds like himself. */
        id: 'oru-lament',
        displayName: 'The Lament',
        telegraphSeconds: 1.5,
        durationSeconds: 3,
        recoverySeconds: 2,
        phases: [3],
        weight: 1,
        opensVulnerability: true,
        advancedOnly: true,
      },
    ],
    /**
     * Four tactical edges, none required. Bloom calms the vine lattice, Tidal
     * washes the pollen haze out of the air, Silence mutes the Amplifier's
     * ring for a beat, Prism splits the Dissonant Choir's beams. Base, Echo,
     * Ember, Choir and Celestial get no bonus at all and still win.
     */
    formAdvantages: { bloom: 1.25, tidal: 1.2, silence: 1.3, prism: 1.15 },
    awardsForm: 'echo',
    /** Root, Fifth, Third, Sixth, Octave — the Garden's own chord, replayed
     *  into the ruptured Amplifier to pull Oru back to 432 Hz. */
    restorationSequence: [0, 4, 2, 5, 7],
  },

  // -------------------------------------------------------------------------
  // Glass Meridian — commander
  // -------------------------------------------------------------------------

  /**
   * **Sella**, tall and slow, a Conductor built from stacked panes of smoked
   * glass with a violet seam running through every one. Her staff ends in a
   * rotating prism that takes a single beam and returns a lattice. She fights
   * by geometry: angles, reflections, and the one pane that is really her.
   */
  'the-prism-conductor': {
    id: 'the-prism-conductor',
    displayName: 'Sella',
    title: 'The Prism Conductor',
    stageId: 'glass-meridian',
    health: 3000,
    bodyRadius: 1.8,
    bodyHeight: 4.6,
    arenaCentre: { x: 0, y: 0, z: -120 },
    arenaRadius: 24,
    phases: [
      {
        index: 1,
        name: 'Angle of Incidence',
        healthThreshold: 1,
        arenaFlags: ['meridian-panes-clear'],
        attackIds: ['pc-refraction-fan', 'pc-mirror-step', 'pc-lattice-cage'],
        attackInterval: 2.8,
      },
      {
        index: 2,
        name: 'Total Internal',
        healthThreshold: 0.65,
        arenaFlags: ['meridian-mirrors-raised', 'floor-reflective'],
        attackIds: ['pc-refraction-fan', 'pc-mirror-step', 'pc-lattice-cage', 'pc-shard-cascade'],
        attackInterval: 2.4,
      },
      {
        index: 3,
        name: 'Shatterpoint',
        healthThreshold: 0.3,
        arenaFlags: ['meridian-floor-cracked', 'violet-refraction', 'panes-falling'],
        attackIds: [
          'pc-refraction-fan',
          'pc-mirror-step',
          'pc-shard-cascade',
          'pc-prism-lance',
          'pc-silvered-choir',
        ],
        attackInterval: 2,
      },
    ],
    attacks: [
      {
        id: 'pc-refraction-fan',
        displayName: 'Refraction Fan',
        telegraphSeconds: 0.8,
        durationSeconds: 1.4,
        recoverySeconds: 1,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'pc-mirror-step',
        displayName: 'Mirror Step',
        telegraphSeconds: 0.6,
        durationSeconds: 0.8,
        recoverySeconds: 1.2,
        phases: [1, 2, 3],
        weight: 2,
      },
      {
        id: 'pc-lattice-cage',
        displayName: 'Lattice Cage',
        telegraphSeconds: 1,
        durationSeconds: 2.6,
        recoverySeconds: 1.1,
        phases: [1, 2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'pc-shard-cascade',
        displayName: 'Shard Cascade',
        telegraphSeconds: 0.9,
        durationSeconds: 2,
        recoverySeconds: 0.9,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'pc-prism-lance',
        displayName: 'Prism Lance',
        telegraphSeconds: 1.2,
        durationSeconds: 1,
        recoverySeconds: 1.6,
        phases: [3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'pc-silvered-choir',
        displayName: 'Silvered Choir',
        telegraphSeconds: 1.1,
        durationSeconds: 2.4,
        recoverySeconds: 1.3,
        phases: [3],
        weight: 1,
        advancedOnly: true,
      },
    ],
    formAdvantages: { ember: 1.25, echo: 1.2, silence: 1.15 },
    awardsForm: 'prism',
    restorationSequence: [0, 2, 4, 7],
  },

  // -------------------------------------------------------------------------
  // Tidal Archive — commander
  // -------------------------------------------------------------------------

  /**
   * **Vess**, a flat, vast ray gliding between the flooded shelves of the
   * Archive. Her wings are printed edge to edge with the recordings she has
   * swallowed, and the infection replays them out of order — the fight is
   * haunted by the player's own last few seconds.
   */
  'the-mnemonic-ray': {
    id: 'the-mnemonic-ray',
    displayName: 'Vess',
    title: 'The Mnemonic Ray',
    stageId: 'tidal-archive',
    health: 3100,
    bodyRadius: 3.2,
    bodyHeight: 1.6,
    arenaCentre: { x: 0, y: 2, z: -140 },
    arenaRadius: 28,
    phases: [
      {
        index: 1,
        name: 'Shallow Stacks',
        healthThreshold: 1,
        arenaFlags: ['archive-water-low'],
        attackIds: ['mr-tide-sweep', 'mr-memory-echo', 'mr-ink-veil'],
        attackInterval: 2.9,
      },
      {
        index: 2,
        name: 'Rising Water',
        healthThreshold: 0.62,
        arenaFlags: ['archive-water-mid', 'shelves-drifting'],
        attackIds: ['mr-tide-sweep', 'mr-memory-echo', 'mr-ink-veil', 'mr-current-spiral'],
        attackInterval: 2.4,
      },
      {
        index: 3,
        name: 'Full Flood',
        healthThreshold: 0.28,
        arenaFlags: ['archive-water-high', 'current-strong', 'violet-ink'],
        attackIds: [
          'mr-tide-sweep',
          'mr-memory-echo',
          'mr-current-spiral',
          'mr-archive-flood',
          'mr-stolen-song',
        ],
        attackInterval: 2,
      },
    ],
    attacks: [
      {
        id: 'mr-tide-sweep',
        displayName: 'Tide Sweep',
        telegraphSeconds: 0.85,
        durationSeconds: 1.6,
        recoverySeconds: 1,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'mr-memory-echo',
        displayName: 'Memory Echo',
        telegraphSeconds: 0.7,
        durationSeconds: 1.2,
        recoverySeconds: 0.9,
        phases: [1, 2, 3],
        weight: 2,
      },
      {
        id: 'mr-ink-veil',
        displayName: 'Ink Veil',
        telegraphSeconds: 0.9,
        durationSeconds: 2.4,
        recoverySeconds: 1.1,
        phases: [1, 2],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'mr-current-spiral',
        displayName: 'Current Spiral',
        telegraphSeconds: 1,
        durationSeconds: 2.8,
        recoverySeconds: 1.2,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'mr-archive-flood',
        displayName: 'Archive Flood',
        telegraphSeconds: 1.3,
        durationSeconds: 3,
        recoverySeconds: 1.6,
        phases: [3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'mr-stolen-song',
        displayName: 'Stolen Song',
        telegraphSeconds: 1.1,
        durationSeconds: 2,
        recoverySeconds: 1.3,
        phases: [3],
        weight: 1,
        advancedOnly: true,
      },
    ],
    formAdvantages: { ember: 1.2, choir: 1.2, echo: 1.15 },
    awardsForm: 'tidal',
    restorationSequence: [0, 3, 4, 7],
  },

  // -------------------------------------------------------------------------
  // Ember Observatory — commander
  // -------------------------------------------------------------------------

  /**
   * **Kaleth**, a siege-scale Amplifier that has taken the Observatory's great
   * lens for a head. It does not move; the room moves around it, mirrors
   * folding out of the walls to carry its beam somewhere new. Heat is the whole
   * design: telegraphs glow before they burn.
   */
  'the-red-amplifier': {
    id: 'the-red-amplifier',
    displayName: 'Kaleth',
    title: 'The Red Amplifier',
    stageId: 'ember-observatory',
    health: 3300,
    bodyRadius: 2.6,
    bodyHeight: 5.4,
    arenaCentre: { x: 0, y: 0, z: -132 },
    arenaRadius: 25,
    phases: [
      {
        index: 1,
        name: 'First Light',
        healthThreshold: 1,
        arenaFlags: ['observatory-dome-closed'],
        attackIds: ['ra-lens-beam', 'ra-cinder-volley', 'ra-heat-bloom'],
        attackInterval: 2.8,
      },
      {
        index: 2,
        name: 'Focus Array',
        healthThreshold: 0.64,
        arenaFlags: ['observatory-mirrors-deployed', 'dome-open'],
        attackIds: ['ra-lens-beam', 'ra-cinder-volley', 'ra-heat-bloom', 'ra-mirror-array'],
        attackInterval: 2.3,
      },
      {
        index: 3,
        name: 'Overburn',
        healthThreshold: 0.3,
        arenaFlags: ['dome-collapsed', 'ember-floor', 'violet-flare'],
        attackIds: [
          'ra-cinder-volley',
          'ra-heat-bloom',
          'ra-mirror-array',
          'ra-solar-collapse',
          'ra-ash-fall',
        ],
        attackInterval: 1.9,
      },
    ],
    attacks: [
      {
        id: 'ra-lens-beam',
        displayName: 'Lens Beam',
        telegraphSeconds: 1,
        durationSeconds: 2.2,
        recoverySeconds: 1.3,
        phases: [1, 2],
        weight: 3,
        opensVulnerability: true,
      },
      {
        id: 'ra-cinder-volley',
        displayName: 'Cinder Volley',
        telegraphSeconds: 0.7,
        durationSeconds: 1.2,
        recoverySeconds: 0.9,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'ra-heat-bloom',
        displayName: 'Heat Bloom',
        telegraphSeconds: 0.85,
        durationSeconds: 1,
        recoverySeconds: 1.1,
        phases: [1, 2, 3],
        weight: 2,
      },
      {
        id: 'ra-mirror-array',
        displayName: 'Mirror Array',
        telegraphSeconds: 1.1,
        durationSeconds: 2.8,
        recoverySeconds: 1,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'ra-solar-collapse',
        displayName: 'Solar Collapse',
        telegraphSeconds: 1.4,
        durationSeconds: 1.2,
        recoverySeconds: 1.8,
        phases: [3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'ra-ash-fall',
        displayName: 'Ash Fall',
        telegraphSeconds: 0.9,
        durationSeconds: 2.6,
        recoverySeconds: 1,
        phases: [3],
        weight: 1,
        advancedOnly: true,
      },
    ],
    formAdvantages: { tidal: 1.3, prism: 1.2, bloom: 1.15 },
    awardsForm: 'ember',
    restorationSequence: [0, 4, 2, 7],
  },

  // -------------------------------------------------------------------------
  // Hollow Choir — commander
  // -------------------------------------------------------------------------

  /**
   * **Ombra**, the largest Conductor the Detuners have grown: a hooded column
   * of black plate whose robe opens along its length into a row of singing
   * mouths, each one a beat behind the last. Its arena is a ruined choir, and
   * every attack is a musical form gone wrong — a round, a canon, a cadence.
   */
  'the-many-mouthed-conductor': {
    id: 'the-many-mouthed-conductor',
    displayName: 'Ombra',
    title: 'The Many-Mouthed Conductor',
    stageId: 'hollow-choir',
    health: 3200,
    bodyRadius: 2,
    bodyHeight: 5.8,
    arenaCentre: { x: 0, y: 0, z: -128 },
    arenaRadius: 23,
    phases: [
      {
        index: 1,
        name: 'Entrance Hymn',
        healthThreshold: 1,
        arenaFlags: ['choir-stalls-dark'],
        attackIds: ['mm-unison-shout', 'mm-round-of-three', 'mm-hollow-summon'],
        attackInterval: 2.8,
      },
      {
        index: 2,
        name: 'Canon',
        healthThreshold: 0.66,
        arenaFlags: ['choir-stalls-lit', 'echo-walls'],
        attackIds: [
          'mm-unison-shout',
          'mm-round-of-three',
          'mm-hollow-summon',
          'mm-discord-cluster',
          'mm-antiphon-chase',
        ],
        attackInterval: 2.3,
      },
      {
        index: 3,
        name: 'Cadence',
        healthThreshold: 0.3,
        arenaFlags: ['choir-collapsed', 'violet-organ', 'mouths-open'],
        attackIds: [
          'mm-unison-shout',
          'mm-antiphon-chase',
          'mm-discord-cluster',
          'mm-hollow-summon',
          'mm-final-cadence',
        ],
        attackInterval: 1.9,
      },
    ],
    attacks: [
      {
        id: 'mm-unison-shout',
        displayName: 'Unison Shout',
        telegraphSeconds: 0.9,
        durationSeconds: 1,
        recoverySeconds: 1.2,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'mm-round-of-three',
        displayName: 'Round of Three',
        telegraphSeconds: 0.8,
        durationSeconds: 2.2,
        recoverySeconds: 1,
        phases: [1, 2],
        weight: 3,
      },
      {
        id: 'mm-hollow-summon',
        displayName: 'Hollow Summon',
        telegraphSeconds: 1,
        durationSeconds: 1.6,
        recoverySeconds: 1.4,
        phases: [1, 2, 3],
        weight: 2,
      },
      {
        id: 'mm-discord-cluster',
        displayName: 'Discord Cluster',
        telegraphSeconds: 1.1,
        durationSeconds: 1.8,
        recoverySeconds: 1.5,
        phases: [2, 3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'mm-antiphon-chase',
        displayName: 'Antiphon Chase',
        telegraphSeconds: 0.85,
        durationSeconds: 2.6,
        recoverySeconds: 1,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'mm-final-cadence',
        displayName: 'Final Cadence',
        telegraphSeconds: 1.5,
        durationSeconds: 2.4,
        recoverySeconds: 2,
        phases: [3],
        weight: 1,
        opensVulnerability: true,
        advancedOnly: true,
      },
    ],
    formAdvantages: { silence: 1.3, echo: 1.2, prism: 1.15 },
    awardsForm: 'choir',
    restorationSequence: [0, 4, 5, 7],
  },

  // -------------------------------------------------------------------------
  // Verdant Machine — commander
  // -------------------------------------------------------------------------

  /**
   * **Thess**, less a body than a braid: a parasite threaded through the
   * Verdant Machine's root-cabling, wearing the machine as armour and pumping
   * violet sap through pipes that were built for water. Its heart is visible
   * only when it over-pressurises itself.
   */
  'the-root-parasite': {
    id: 'the-root-parasite',
    displayName: 'Thess',
    title: 'The Root Parasite',
    stageId: 'verdant-machine',
    health: 3400,
    bodyRadius: 2.8,
    bodyHeight: 4.8,
    arenaCentre: { x: 0, y: 0, z: -146 },
    arenaRadius: 24,
    phases: [
      {
        index: 1,
        name: 'Grafting',
        healthThreshold: 1,
        arenaFlags: ['machine-idle'],
        attackIds: ['rp-cable-lash', 'rp-graft-mines', 'rp-pump-surge'],
        attackInterval: 2.9,
      },
      {
        index: 2,
        name: 'Sap Pressure',
        healthThreshold: 0.65,
        arenaFlags: ['machine-pistons-active', 'sap-channels-open'],
        attackIds: ['rp-cable-lash', 'rp-graft-mines', 'rp-pump-surge', 'rp-root-cage', 'rp-machine-quake'],
        attackInterval: 2.3,
      },
      {
        index: 3,
        name: 'Overgrowth',
        healthThreshold: 0.3,
        arenaFlags: ['machine-overgrown', 'violet-sap', 'floor-roots'],
        attackIds: [
          'rp-cable-lash',
          'rp-root-cage',
          'rp-machine-quake',
          'rp-pump-surge',
          'rp-hollow-harvest',
        ],
        attackInterval: 1.9,
      },
    ],
    attacks: [
      {
        id: 'rp-cable-lash',
        displayName: 'Cable Lash',
        telegraphSeconds: 0.7,
        durationSeconds: 1,
        recoverySeconds: 0.9,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'rp-graft-mines',
        displayName: 'Graft Mines',
        telegraphSeconds: 0.9,
        durationSeconds: 1.4,
        recoverySeconds: 1,
        phases: [1, 2],
        weight: 2,
      },
      {
        id: 'rp-pump-surge',
        displayName: 'Pump Surge',
        telegraphSeconds: 1,
        durationSeconds: 2,
        recoverySeconds: 1.4,
        phases: [1, 2, 3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'rp-root-cage',
        displayName: 'Root Cage',
        telegraphSeconds: 1.1,
        durationSeconds: 2.8,
        recoverySeconds: 1,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'rp-machine-quake',
        displayName: 'Machine Quake',
        telegraphSeconds: 1.2,
        durationSeconds: 1.6,
        recoverySeconds: 1.6,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'rp-hollow-harvest',
        displayName: 'Hollow Harvest',
        telegraphSeconds: 1.3,
        durationSeconds: 2.6,
        recoverySeconds: 1.5,
        phases: [3],
        weight: 1,
        opensVulnerability: true,
        advancedOnly: true,
      },
    ],
    formAdvantages: { ember: 1.3, silence: 1.2, tidal: 1.15 },
    awardsForm: 'bloom',
    restorationSequence: [0, 2, 5, 7],
  },

  // -------------------------------------------------------------------------
  // Desert of Lost Notes — commander
  // -------------------------------------------------------------------------

  /**
   * **Nul**, a mouth in the dune line and very little else: a sunken ring of
   * black teeth around a violet throat, surfacing where the sand is thinnest.
   * It eats frequency. Inside its null field the Auralith goes quiet and the
   * accessibility layer takes over entirely — every cue in that window is
   * drawn, because by design none of them can be heard.
   */
  'the-sound-eater': {
    id: 'the-sound-eater',
    displayName: 'Nul',
    title: 'The Sound Eater',
    stageId: 'desert-of-lost-notes',
    health: 3500,
    bodyRadius: 3.4,
    bodyHeight: 3.8,
    arenaCentre: { x: 0, y: 0, z: -150 },
    arenaRadius: 30,
    phases: [
      {
        index: 1,
        name: 'First Hunger',
        healthThreshold: 1,
        arenaFlags: ['desert-flat'],
        attackIds: ['se-swallow-tone', 'se-dune-crash', 'se-null-field'],
        attackInterval: 2.9,
      },
      {
        index: 2,
        name: 'Sinking Sand',
        healthThreshold: 0.62,
        arenaFlags: ['sand-sinking', 'pillars-rising'],
        attackIds: ['se-swallow-tone', 'se-dune-crash', 'se-null-field', 'se-lost-note-storm', 'se-buried-lunge'],
        attackInterval: 2.3,
      },
      {
        index: 3,
        name: 'The Quiet',
        healthThreshold: 0.28,
        arenaFlags: ['sound-muted', 'violet-dust', 'arena-narrowed'],
        attackIds: [
          'se-swallow-tone',
          'se-buried-lunge',
          'se-lost-note-storm',
          'se-null-field',
          'se-endless-quiet',
        ],
        attackInterval: 1.9,
      },
    ],
    attacks: [
      {
        id: 'se-swallow-tone',
        displayName: 'Swallow Tone',
        telegraphSeconds: 1,
        durationSeconds: 2,
        recoverySeconds: 1.2,
        phases: [1, 2, 3],
        weight: 3,
      },
      {
        id: 'se-dune-crash',
        displayName: 'Dune Crash',
        telegraphSeconds: 0.8,
        durationSeconds: 1.2,
        recoverySeconds: 1,
        phases: [1, 2],
        weight: 3,
      },
      {
        id: 'se-null-field',
        displayName: 'Null Field',
        telegraphSeconds: 1.1,
        durationSeconds: 2.6,
        recoverySeconds: 1.1,
        phases: [1, 2, 3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'se-lost-note-storm',
        displayName: 'Lost Note Storm',
        telegraphSeconds: 0.9,
        durationSeconds: 2.4,
        recoverySeconds: 1,
        phases: [2, 3],
        weight: 2,
      },
      {
        id: 'se-buried-lunge',
        displayName: 'Buried Lunge',
        telegraphSeconds: 0.85,
        durationSeconds: 1,
        recoverySeconds: 1.6,
        phases: [2, 3],
        weight: 2,
        opensVulnerability: true,
      },
      {
        id: 'se-endless-quiet',
        displayName: 'Endless Quiet',
        telegraphSeconds: 1.5,
        durationSeconds: 3.2,
        recoverySeconds: 1.8,
        phases: [3],
        weight: 1,
        advancedOnly: true,
      },
    ],
    formAdvantages: { choir: 1.3, echo: 1.25, bloom: 1.15 },
    awardsForm: 'silence',
    restorationSequence: [0, 4, 3, 7],
  },
};
