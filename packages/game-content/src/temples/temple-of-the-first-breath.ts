import { PALETTE } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import type { StageDef, TempleDef } from '@tuner/game-core';

/**
 * **The Temple of the First Breath** — the Fractured Garden's temple.
 *
 * The Keepers did not build this place to store anything. They built it because
 * the cliff under the garden already answered: shout into the lower galleries
 * and the rock hands the shout back a moment later, intact. They cut flues into
 * the answer, hung drums at the ends of them, and taught their students that a
 * note is never one thing — it is the note, and then the note returning.
 *
 * That is the whole temple. Ten rooms, one idea, escalating:
 *
 * | # | beat            | room                        | what it adds                  |
 * | - | --------------- | --------------------------- | ----------------------------- |
 * | 1 | introduce       | Threshold of the First Breath | the doubled arrival, safely |
 * | 2 | experiment      | The Sounding Hall           | no threat, three drums        |
 * | 3 | traversal       | The Severed Stair           | movement + two aimed notes    |
 * | 4 | combat          | The Choir Pit               | Detuners in a closed court    |
 * | 5 | pressure        | The Spore Gallery           | rhythm hazard on top of them  |
 * | 6 | central         | The Lock of Two Arrivals    | THE puzzle                    |
 * | 7 | secret          | The Unsung Cell             | optional, two rewards         |
 * | 8 | miniboss        | The Amplifier Vault         | Virus Bloom + twin amplifiers |
 * | 9 | recontextualise | The Unsung Stair            | the note as a lamp, not a key |
 * |10 | guardian        | The Breath of Oru           | the approach and the ring     |
 *
 * ---------------------------------------------------------------------------
 * Echo Pulse, and why the central lock cannot be brute-forced
 * ---------------------------------------------------------------------------
 *
 * One press of Echo Pulse is **two arrivals on the same line**. The note is
 * fired; 0.12 s later (`DEFAULT_ECHO_DELAY_SECONDS` in
 * `game-core/src/internal/services.ts`) its return separates from it and follows
 * the identical path. At the pulse speed the form flies (46 m/s × 0.95) the
 * return is born **5.24 m behind the note**, and a resonator counts an `echo`
 * puzzle answered only when a note reaches it **twice inside its own hold
 * window** — a note and its return.
 *
 * `TEMPLE_LOCK` below is authored around exactly those numbers:
 *
 * - The three drums sit **27 m** from the shaft's axis at the end of **1.0 m**
 *   wide, **14 m** deep flues. A drum can only be struck along its flue axis.
 * - The only place that axis exists is the **Spindle**, an orbiting stone that
 *   carries the player around the shaft at radius **9 m**, one revolution every
 *   **5 s** — 11.31 m/s.
 * - Geometry closes the line almost immediately: a shot may be off the axis by
 *   at most `(width / 2) · (drumRadius − spindleRadius) / (drumRadius −
 *   shaftRadius)` = 0.64 m, so the flue is open across 1.29 m of the Spindle's
 *   arc, which is **0.114 s**. The base Auralith's pulse interval is 0.14 s: at
 *   most **one arrival per pass**, and one arrival answers nothing.
 * - Echo Pulse does not need a second press. Its return is already on the line —
 *   and because 9 + 5.24 = 14.24 m from the axis is *past* the 13 m flue mouth,
 *   the return is born **inside the flue**. It does not care that the line
 *   closed behind it.
 * - Walking is not an alternative. The drums are 38.2 m apart from one another —
 *   4.44 s of running, which is longer than the 4 s a ring lasts *and* longer
 *   than the 3.5 s the lock keeps a partial chord for
 *   (`PUZZLE_IDLE_RESET_SECONDS`). The Spindle passes all three flues in 2.5 s.
 *
 * So the lock is not a lock with an Echo-shaped key taped to it: it is a room
 * that can only be answered by something that arrives twice from one press,
 * and it is solved the moment a player stops asking "how do I shoot faster"
 * and notices that they already are.
 *
 * ---------------------------------------------------------------------------
 * Muted play
 * ---------------------------------------------------------------------------
 *
 * Nothing mandatory here is heard. Every resonator carries a `degree`, which the
 * renderer draws as a numbered harmonic ring; a struck drum holds a bright ring
 * for its whole `holdSeconds` and a drum that has taken the doubled arrival
 * holds a **second concentric ring**. Every rhythmic element is a `rhythm`
 * hazard or a `rhythm` platform, both of which are drawn stepping on the beat.
 * Per-puzzle notes below state how each one reads with the sound off.
 *
 * ---------------------------------------------------------------------------
 * Coordinates and identity
 * ---------------------------------------------------------------------------
 *
 * `StageId` is a fixed union, so the playable temple ships as a `StageDef` with
 * id `'fractured-garden'`: **the temple is an interior of that region**, entered
 * through the Keeper gate the zone marks at (0, 2, −187), and it shares the
 * region's coordinate frame so the two authored Fractured Garden encounters land
 * on the arena centres their `BossDef`s already declare — Virus Bloom at
 * (22, 0, −108) r20, Oru at (0, 0, −160) r26.
 *
 * Movement budget every gap was authored against: capsule 0.36 m × 1.6 m, run
 * 8.6 m/s, gravity −32 m/s², jump 3.05 m, double jump +2.5 m, air dash +2.62 m
 * of reach. `TEMPLE_OF_THE_FIRST_BREATH_TRAVERSALS` lists every crossing the
 * route depends on and the test file re-derives the budget from those constants,
 * rise by rise, rather than trusting a single flat number.
 */

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/** Terse Vec3 literal — this file is mostly coordinates. */
function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * A crossing the route depends on, given as the two *standing* points a player
 * leaves from and lands on — top surfaces, not box centres.
 */
export interface TempleTraversal {
  readonly id: string;
  readonly from: Vec3;
  readonly to: Vec3;
  /** What the player is expected to spend to make it. */
  readonly technique: 'walk' | 'jump' | 'double-jump' | 'double-jump-dash' | 'drop';
  /** True for optional lines: secrets, shortcuts, and the drift platform. */
  readonly optional?: boolean;
  readonly note: string;
}

/**
 * The numbers the central puzzle is built out of.
 *
 * Exported because the design argument in the header is only an argument if
 * something checks it. The test file re-derives the aperture time, the return's
 * detach distance and the walking alternative from these values and the combat
 * config, and asserts the authored geometry matches them.
 */
export interface EchoLockGeometry {
  /** Axis of the breathing shaft, at Spindle height. */
  readonly shaftCentre: Vec3;
  /** Inner radius of the shaft wall — where each flue's mouth is cut. */
  readonly shaftRadius: number;
  /** Radius of the Spindle's orbit. */
  readonly spindleRadius: number;
  /** Seconds for one Spindle revolution. */
  readonly spindleSeconds: number;
  /** Radius at which the drums hang, at the far end of their flues. */
  readonly drumRadius: number;
  /** Width of a flue. The player never enters one; only a note fits. */
  readonly slitWidth: number;
  /** Seconds a struck drum holds its ring. */
  readonly drumHoldSeconds: number;
  /** Angle between adjacent flues. */
  readonly slitSpacingRadians: number;
}

export const TEMPLE_LOCK: EchoLockGeometry = {
  shaftCentre: v(-30, 8, -114),
  shaftRadius: 13,
  spindleRadius: 9,
  spindleSeconds: 5,
  drumRadius: 27,
  slitWidth: 1,
  drumHoldSeconds: 4,
  slitSpacingRadians: Math.PI / 2,
};

// ---------------------------------------------------------------------------
// The temple, as a teaching structure
// ---------------------------------------------------------------------------

/**
 * Ten rooms, one per beat, in curriculum order.
 *
 * `intent` is the design record: one sentence saying what the room is for. If a
 * room cannot be described in one sentence it is doing two jobs and should be
 * two rooms.
 */
export const TEMPLE_OF_THE_FIRST_BREATH: TempleDef = {
  id: 'temple-of-the-first-breath',
  displayName: 'The Temple of the First Breath',
  region: 'fractured-garden',
  teaches: 'echo',

  rooms: [
    {
      id: 'tr-threshold',
      beat: 'introduce',
      name: 'Threshold of the First Breath',
      intent:
        'The temple lends the player the doubled arrival and asks for it once, on a single drum, ' +
        'with nothing else in the room to think about.',
      entryTriggerId: 'trg-room-threshold',
      puzzleIds: ['puz-threshold-doubled-arrival'],
      checkpointId: 'cp-00-threshold',
    },
    {
      id: 'tr-sounding-hall',
      beat: 'experiment',
      name: 'The Sounding Hall',
      intent:
        'A wide empty hall with three drums and a sounding face to shoot at: nothing here can ' +
        'hurt the player, so the pulse can be tried on everything without a cost.',
      entryTriggerId: 'trg-room-sounding-hall',
      puzzleIds: ['puz-hall-sequence'],
      checkpointId: 'cp-01-sounding-hall',
    },
    {
      id: 'tr-severed-stair',
      beat: 'traversal',
      name: 'The Severed Stair',
      intent:
        'Movement and the pulse in the same breath: four treads over a void, and the missing ' +
        'top tread only grows while both wall drums are ringing together.',
      entryTriggerId: 'trg-room-severed-stair',
      puzzleIds: ['puz-stair-simultaneous'],
      checkpointId: 'cp-02-severed-stair',
    },
    {
      id: 'tr-choir-pit',
      beat: 'combat',
      name: 'The Choir Pit',
      intent:
        'The same pulse against Detuners, in a walled court with no ledges to fall from, ' +
        'including one armoured Root Fracture that the doubled arrival deliberately cannot open.',
      entryTriggerId: 'trg-room-choir-pit',
      enemySpawnIds: [
        'enm-pit-whisperer-a',
        'enm-pit-whisperer-b',
        'enm-pit-drifter',
        'enm-pit-fracture',
        'enm-pit-swarm-a',
        'enm-pit-swarm-b',
      ],
      checkpointId: 'cp-03-choir-pit',
    },
    {
      id: 'tr-spore-gallery',
      beat: 'pressure',
      name: 'The Spore Gallery',
      intent:
        'Everything the Choir Pit asked for, now on a six-metre walk with three spore vents ' +
        'venting on the region beat and a pylon holding the far side.',
      entryTriggerId: 'trg-room-spore-gallery',
      enemySpawnIds: [
        'enm-gallery-pylon',
        'enm-gallery-pursuer-a',
        'enm-gallery-pursuer-b',
        'enm-gallery-drifter',
      ],
      checkpointId: 'cp-04-spore-gallery',
    },
    {
      id: 'tr-lock-of-two-arrivals',
      beat: 'central',
      name: 'The Lock of Two Arrivals',
      intent:
        'The room the temple is remembered for: three drums down flues too narrow to shoot ' +
        'twice, reachable only from a spinning stone, answerable only by a note that arrives ' +
        'twice from one press.',
      entryTriggerId: 'trg-room-lock',
      puzzleIds: ['puz-lock-two-arrivals'],
      checkpointId: 'cp-05-lock-balcony',
    },
    {
      id: 'tr-unsung-cell',
      beat: 'secret',
      name: 'The Unsung Cell',
      intent:
        'An unlit Keeper cell behind the shaft wall, invisible until it is looked at properly, ' +
        'holding one reward for curiosity now and one for a region the player has not reached.',
      entryTriggerId: 'trg-room-unsung-cell',
      enemySpawnIds: ['enm-cell-mimic'],
    },
    {
      id: 'tr-amplifier-vault',
      beat: 'miniboss',
      name: 'The Amplifier Vault',
      intent:
        'The Virus Bloom in the temple seedbed with two Twin Amplifiers feeding it, so the ' +
        'fight is about cutting the supply before the flower.',
      entryTriggerId: 'trg-room-amplifier-vault',
      enemySpawnIds: [
        'enm-vault-amplifier-west',
        'enm-vault-amplifier-east',
        'enm-vault-mine',
        'enm-vault-bloom',
        'enm-vault-spawner',
      ],
      checkpointId: 'cp-06-vault-gate',
    },
    {
      id: 'tr-unsung-stair',
      beat: 'recontextualise',
      name: 'The Unsung Stair',
      intent:
        'The note stops being a key: here it is a lamp and a solvent — it lights treads that ' +
        'were always there, cancels a standing dissonance, and holds a sconce lit behind the ' +
        'player while they climb away from it.',
      entryTriggerId: 'trg-room-unsung-stair',
      puzzleIds: ['puz-return-sustain'],
      enemySpawnIds: ['enm-return-drifter', 'enm-return-mine'],
      checkpointId: 'cp-07-vault-cleared',
    },
    {
      id: 'tr-breath-of-oru',
      beat: 'guardian',
      name: 'The Breath of Oru',
      intent:
        'A descending approach with the last of the Amplifier’s garrison in it, a Keeper seal, ' +
        'and then the ring where the colossus is being made to sing.',
      entryTriggerId: 'trg-room-guardian',
      enemySpawnIds: [
        'enm-guardian-conductor',
        'enm-guardian-whisperer-a',
        'enm-guardian-whisperer-b',
      ],
      checkpointId: 'cp-09-guardian-gate',
    },
  ],

  miniBossId: 'virus-bloom',
  guardianId: 'oru-fractured-colossus',

  /**
   * The Garden Chord: Root, Third, Fifth, Octave. The same four degrees the
   * zone declares, the chord played into the Amplifier's wound when the
   * Frequency Core comes out, and the set Oru's own `restorationSequence`
   * walks. Every drum in this temple is tuned to one of them.
   */
  restorationChord: [0, 2, 4, 7],
};

// ---------------------------------------------------------------------------
// Crossings the route depends on
// ---------------------------------------------------------------------------

export const TEMPLE_OF_THE_FIRST_BREATH_TRAVERSALS: readonly TempleTraversal[] = [
  // --- 3. The Severed Stair ------------------------------------------------
  {
    id: 'trv-hall-to-stair-tread-1',
    from: v(0, 0, -43),
    to: v(0, 1, -48),
    technique: 'jump',
    note: 'Off the lip onto the first tread. 5.0 m and 1.0 m up — the easiest crossing in the temple, deliberately first, over the only void so far.',
  },
  {
    id: 'trv-stair-tread-1-to-2',
    from: v(0, 1, -48),
    to: v(-6, 3.2, -54),
    technique: 'double-jump',
    note: 'OVER 6 M: 8.49 m out and 2.2 m up. A running double jump has ~1.29 s of airtime at that rise, which is 11.1 m of ground — the crossing sits at 77 % of it, and the tread is 5 m square.',
  },
  {
    id: 'trv-stair-tread-2-to-3',
    from: v(-6, 3.2, -54),
    to: v(-1, 5.2, -59),
    technique: 'double-jump',
    note: 'OVER 6 M: 7.07 m out, 2.0 m up, 63 % of the double-jump budget. This is the tread that does not exist until both wall drums ring together, so the jump is offered only once the puzzle is answered.',
  },
  {
    id: 'trv-stair-tread-3-to-landing',
    from: v(-1, 5.2, -59),
    to: v(-6, 6, -60.5),
    technique: 'jump',
    note: 'Onto the landing that opens the Choir Pit. 5.2 m and 0.8 m up, 75 % of a single jump.',
  },
  {
    id: 'trv-stair-lift-to-alcove',
    from: v(4, 5.35, -52),
    to: v(8, 5.6, -52),
    technique: 'jump',
    optional: true,
    note: 'OPTIONAL. Off the breath lift at the top of its cycle into the unlit alcove that holds the first secret. 4.0 m flat — trivial, because finding it was the difficulty.',
  },

  // --- 5. The Spore Gallery ------------------------------------------------
  {
    id: 'trv-gallery-to-collapse-1',
    from: v(-18, 6, -95),
    to: v(-23, 6.75, -95),
    technique: 'jump',
    note: 'First collapsing slab. 5.0 m out; the pressure is the 0.55 s fuse and the pylon, not the distance.',
  },
  {
    id: 'trv-collapse-1-to-2',
    from: v(-23, 6.75, -95),
    to: v(-28, 7.35, -95),
    technique: 'jump',
    note: 'Slab to slab, 5.0 m, both of them already falling. 70 % of a single jump so the section is a rhythm rather than a measurement.',
  },
  {
    id: 'trv-collapse-2-to-shelf',
    from: v(-28, 7.35, -95),
    to: v(-32, 8.2, -96),
    technique: 'jump',
    note: 'Onto solid stone again, 4.12 m and 0.85 m up. The shelf is where the pylon finally loses its line.',
  },
  {
    id: 'trv-shelf-to-balcony',
    from: v(-32, 8.2, -96),
    to: v(-28, 8, -99),
    technique: 'jump',
    note: 'Onto the Lock balcony, 5.0 m and slightly downhill, with the whole breathing shaft opening underneath — the temple’s one held breath before its central room.',
  },

  // --- 6. The Lock of Two Arrivals -----------------------------------------
  {
    id: 'trv-balcony-to-spindle',
    from: v(-28, 8, -102.5),
    to: v(-30, 8.35, -105),
    technique: 'jump',
    note: 'Boarding the Spindle. 3.2 m and 0.35 m up — short on purpose: the stone is doing 11.3 m/s and the crossing must be about the timing, not the reach.',
  },
  {
    id: 'trv-spindle-to-step-ring',
    from: v(-21, 8.35, -114),
    to: v(-20, 4, -120),
    technique: 'jump',
    note: 'OVER 6 M: leaving the Spindle at its eastern extreme for the step ring, 6.08 m out and 4.35 m down. A jump into a 4.35 m fall carries ~1.12 s of airtime, 9.6 m of ground — 63 % used, and the shaft floor 4 m below catches anything short.',
  },

  // --- 8. The Amplifier Vault (optional line) ------------------------------
  {
    id: 'trv-vault-drift-to-ledge',
    from: v(14, 4.35, -112),
    to: v(6, 6, -114),
    technique: 'double-jump',
    optional: true,
    note: 'OPTIONAL, OVER 6 M: the drifting seed pallet to the vault ledge, 8.25 m out and 1.65 m up, 72 % of the double-jump budget. Taken under Twin Amplifier fire for a shard cache.',
  },

  // --- 9. The Unsung Stair -------------------------------------------------
  {
    id: 'trv-vault-to-return-1',
    from: v(38, 0, -119),
    to: v(34, 1.75, -121),
    technique: 'jump',
    note: 'Onto the first rhythm tread at the bottom of its cycle. 4.47 m out, 1.75 m up.',
  },
  {
    id: 'trv-return-1-to-2',
    from: v(34, 1.75, -121),
    to: v(41, 5.95, -120),
    technique: 'double-jump',
    note: 'OVER 6 M: 7.07 m out and 4.2 m up — the worst case, tread one at its floor and tread two at its floor. Taken on the beat the rise is 0.7 m; the budget still holds at 73 % if the player ignores the rhythm entirely.',
  },
  {
    id: 'trv-return-2-to-3',
    from: v(41, 9.45, -120),
    to: v(33, 9.95, -126),
    technique: 'double-jump-dash',
    note: 'OVER 6 M: 10.0 m across the chimney, level, at the top of tread two’s rise. The air dash converts the corner into a straight line; without it the crossing is 83 % of the plain double jump and reads as a gamble, which is why the dash is the authored answer.',
  },
  {
    id: 'trv-return-3-to-gallery',
    from: v(33, 13.45, -126),
    to: v(33, 14, -130.5),
    technique: 'jump',
    note: 'Off the top tread onto the gallery, 4.5 m out, taken at the top of the cycle — and straight through the dissonance veil, which is why the veil has to be cancelled first.',
  },

  // --- 10. The Breath of Oru ----------------------------------------------
  {
    id: 'trv-gallery-to-approach-a',
    from: v(0, 14, -131.5),
    to: v(-3.5, 11, -131),
    technique: 'jump',
    note: 'Off the west end of the gallery onto the first approach step. 3.54 m out, 3.0 m down.',
  },
  {
    id: 'trv-approach-a-to-b',
    from: v(-3.5, 11, -131),
    to: v(3.5, 7.5, -131),
    technique: 'jump',
    note: 'OVER 6 M: the switchback, 7.0 m across and 3.5 m down. Jumping into a 3.5 m drop buys 9.26 m of ground; the step uses 76 % of it and the next step is directly below if it is missed.',
  },
  {
    id: 'trv-approach-b-to-c',
    from: v(3.5, 7.5, -131),
    to: v(-3.5, 3.8, -131),
    technique: 'jump',
    note: 'OVER 6 M: the switchback again, mirrored, 7.0 m and 3.7 m down, 75 % of budget. Three descending steps with the seal filling the frame is the temple slowing the player down on purpose.',
  },
  {
    id: 'trv-approach-c-to-gate',
    from: v(-3.5, 3.8, -131),
    to: v(0, 0, -131.5),
    technique: 'jump',
    note: 'Down to the seal landing, 3.54 m out and 3.8 m down. The last checkpoint of the temple is on this floor.',
  },
];

// ---------------------------------------------------------------------------
// The playable temple
// ---------------------------------------------------------------------------

/**
 * The Temple of the First Breath as walkable geometry.
 *
 * Authored as a `StageDef` with id `'fractured-garden'` — the temple is an
 * *interior of that region*, not a region of its own, and reusing the id keeps
 * both Fractured Garden `BossDef`s (Virus Bloom, Oru) valid inside it.
 */
export const TEMPLE_OF_THE_FIRST_BREATH_STAGE: StageDef = {
  id: 'fractured-garden',
  displayName: 'The Temple of the First Breath',
  subtitle: 'The room that answers',
  description:
    'A Keeper teaching temple cut into the cliff under the Fractured Garden, built where the ' +
    'rock already gave a shout back. Flues, drums, a shaft that breathes, and at the bottom of ' +
    'it the colossus who used to tend the terraces, held at 440 Hz by something growing out of ' +
    'his chest.',

  /** Deeper in than the garden above it, and correspondingly further gone. */
  infection: 0.86,

  /** The region tempo, unchanged: 108 BPM, 1.8 beats a second, countable. */
  bpm: 108,

  spawnPoint: v(0, 0.4, 8),
  /** 0 faces −Z, down the temple's axis, at the inner door. */
  spawnYaw: 0,

  /**
   * Lowest authored surface is the Severed Stair's west wall footing at y = −4;
   * the void under the stair bottoms out at −16 and puts the player back on the
   * bank rather than killing them.
   */
  killPlaneY: -24,

  ambience: {
    skyTop: PALETTE.abyss,
    skyBottom: PALETTE.infectionDeep,
    fogColour: PALETTE.infectionDeep,
    fogNear: 14,
    fogFar: 120,
    sunColour: PALETTE.infection,
    sunDirection: v(-0.2, -0.9, -0.38),
    ambientColour: PALETTE.panel,
    /** Freed: the flues run cyan, the drums hold, the shaft breathes in tune. */
    restored: {
      skyTop: PALETTE.abyss,
      skyBottom: PALETTE.resonanceDeep,
      fogColour: PALETTE.resonanceDeep,
      sunColour: PALETTE.gold,
      ambientColour: PALETTE.restoreDeep,
    },
  },

  // -------------------------------------------------------------------------
  // Static geometry
  // -------------------------------------------------------------------------

  geometry: [
    // --- 1. Threshold of the First Breath ----------------------------------
    // A closed room with one drum in it. Nothing to fall off, nothing to fight,
    // one thing to do.
    {
      id: 'geo-threshold-floor',
      shape: { kind: 'box', halfExtents: v(12, 1, 10) },
      position: v(0, -1, 2),
      style: 'stone-carved',
    },
    {
      id: 'geo-threshold-wall-west',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 10) },
      position: v(-12.8, 4, 2),
      style: 'stone-carved',
    },
    {
      id: 'geo-threshold-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 10) },
      position: v(12.8, 4, 2),
      style: 'stone-carved',
    },
    {
      id: 'geo-threshold-wall-back',
      shape: { kind: 'box', halfExtents: v(12, 5, 0.8) },
      position: v(0, 4, 12.8),
      style: 'stone-carved',
    },
    /** The Keepers' cradle. Standing on it is what lends the doubled arrival. */
    {
      id: 'geo-threshold-cradle',
      shape: { kind: 'box', halfExtents: v(2, 0.4, 2) },
      position: v(0, 0.4, -1),
      style: 'gold-trim',
    },
    /** The demonstration drum, eight metres out: far enough that the return has
     *  detached before the note lands, which is the whole lesson. */
    {
      id: 'geo-threshold-drum-plinth',
      shape: { kind: 'box', halfExtents: v(1, 1.2, 1) },
      position: v(0, 1.2, -6),
      style: 'stone-carved',
    },
    /** South wall, split around the inner door. */
    {
      id: 'geo-threshold-south-west',
      shape: { kind: 'box', halfExtents: v(4.5, 5, 0.8) },
      position: v(-7.5, 4, -8.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-threshold-south-east',
      shape: { kind: 'box', halfExtents: v(4.5, 5, 0.8) },
      position: v(7.5, 4, -8.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-threshold-passage',
      shape: { kind: 'box', halfExtents: v(3, 1, 2) },
      position: v(0, -1, -10),
      style: 'stone',
    },

    // --- 2. The Sounding Hall ----------------------------------------------
    // Thirty metres by twenty-eight, and empty. The only room in the temple
    // with no way to lose anything in it.
    {
      id: 'geo-hall-floor',
      shape: { kind: 'box', halfExtents: v(15, 1, 14) },
      position: v(0, -1, -26),
      style: 'stone',
    },
    {
      id: 'geo-hall-wall-west',
      shape: { kind: 'box', halfExtents: v(0.8, 6, 14) },
      position: v(-15.8, 5, -26),
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 6, 14) },
      position: v(15.8, 5, -26),
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-wall-south-west',
      shape: { kind: 'box', halfExtents: v(6, 6, 0.8) },
      position: v(-9, 5, -40.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-wall-south-east',
      shape: { kind: 'box', halfExtents: v(6, 6, 0.8) },
      position: v(9, 5, -40.8),
      style: 'stone-carved',
    },
    /** Three plinths at the corners of the hall's teaching triangle. Root and
     *  Fifth are eleven metres apart across the near wall; the Third is
     *  eighteen metres away at the back, so the sequence is a walk. */
    {
      id: 'geo-hall-plinth-a',
      shape: { kind: 'box', halfExtents: v(1, 0.9, 1) },
      position: v(-11, 0.9, -18),
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-plinth-b',
      shape: { kind: 'box', halfExtents: v(1, 0.9, 1) },
      position: v(0, 0.9, -36),
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-plinth-c',
      shape: { kind: 'box', halfExtents: v(1, 0.9, 1) },
      position: v(11, 0.9, -18),
      style: 'stone-carved',
    },
    /** A sounding face: five metres of tuned stone that rings visibly wherever
     *  it is struck. It does nothing. It exists so the player can find out that
     *  one press makes two marks on it. */
    {
      id: 'geo-hall-sounding-face',
      shape: { kind: 'box', halfExtents: v(5, 2.5, 0.6) },
      position: v(8, 1.5, -32),
      style: 'gold-trim',
    },

    // --- 3. The Severed Stair ---------------------------------------------
    {
      id: 'geo-stair-lip',
      shape: { kind: 'box', halfExtents: v(6, 1, 2) },
      position: v(0, -1, -42),
      style: 'stone',
    },
    {
      id: 'geo-stair-wall-west',
      shape: { kind: 'box', halfExtents: v(0.8, 7, 13) },
      position: v(-22.8, 3, -53),
      style: 'stone-carved',
    },
    {
      id: 'geo-stair-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 7, 13) },
      position: v(14.8, 3, -53),
      style: 'stone-carved',
    },
    {
      id: 'geo-stair-tread-1',
      shape: { kind: 'box', halfExtents: v(2.5, 0.6, 2.5) },
      position: v(0, 0.4, -48),
      style: 'stone',
    },
    {
      id: 'geo-stair-tread-2',
      shape: { kind: 'box', halfExtents: v(2.5, 0.6, 2.5) },
      position: v(-6, 2.6, -54),
      style: 'stone',
    },
    /** The missing tread. Grown by `puz-stair-simultaneous`, which is why the
     *  room's two drums are hung on opposite walls above a drop. */
    {
      id: 'geo-stair-tread-3',
      shape: { kind: 'box', halfExtents: v(2.5, 0.6, 2.5) },
      position: v(-1, 4.6, -59),
      style: 'root',
    },
    {
      id: 'geo-stair-landing',
      shape: { kind: 'box', halfExtents: v(8, 1, 4) },
      position: v(-13, 5, -62),
      style: 'stone',
    },
    /** Brackets for the two wall drums, out over the void on opposite sides:
     *  34 m apart, so no Harmonic Burst reaches both and the answer has to be
     *  two aimed notes inside the hold. */
    {
      id: 'geo-stair-bracket-west',
      shape: { kind: 'box', halfExtents: v(1.4, 0.5, 1.4) },
      position: v(-21, 1.9, -49),
      style: 'stone-carved',
    },
    {
      id: 'geo-stair-bracket-east',
      shape: { kind: 'box', halfExtents: v(1.4, 0.5, 1.4) },
      position: v(13, 1.9, -49),
      style: 'stone-carved',
    },
    /** SECRET 1. An unlit alcove above the stair. Present, solid, and invisible
     *  until Resonance Sight is pointed at it. */
    {
      id: 'geo-stair-alcove',
      shape: { kind: 'box', halfExtents: v(2.5, 0.6, 2.5) },
      position: v(8, 5, -52),
      style: 'gold-trim',
      revealedBy: 'base',
    },

    // --- 4. The Choir Pit -------------------------------------------------
    {
      id: 'geo-pit-floor',
      shape: { kind: 'box', halfExtents: v(13, 1, 10) },
      position: v(-16, 5, -76),
      style: 'stone',
    },
    {
      id: 'geo-pit-wall-west',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 10) },
      position: v(-29.8, 10, -76),
      style: 'stone-carved',
    },
    {
      id: 'geo-pit-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 10) },
      position: v(-2.2, 10, -76),
      style: 'stone-carved',
    },
    {
      id: 'geo-pit-wall-north-west',
      shape: { kind: 'box', halfExtents: v(4, 5, 0.8) },
      position: v(-25, 10, -65.6),
      style: 'stone-carved',
    },
    {
      id: 'geo-pit-wall-north-east',
      shape: { kind: 'box', halfExtents: v(1, 5, 0.8) },
      position: v(-4, 10, -65.6),
      style: 'stone-carved',
    },
    {
      id: 'geo-pit-wall-south-west',
      shape: { kind: 'box', halfExtents: v(5, 5, 0.8) },
      position: v(-24, 10, -86.4),
      style: 'stone-carved',
    },
    {
      id: 'geo-pit-wall-south-east',
      shape: { kind: 'box', halfExtents: v(5, 5, 0.8) },
      position: v(-8, 10, -86.4),
      style: 'stone-carved',
    },
    /** Two pillars on a diagonal: cover from the Drifter, and something for the
     *  Root Fracture to be lured around rather than met head-on. */
    {
      id: 'geo-pit-pillar-west',
      shape: { kind: 'box', halfExtents: v(1.4, 2.5, 1.4) },
      position: v(-24, 8.5, -72),
      style: 'stone',
    },
    {
      id: 'geo-pit-pillar-east',
      shape: { kind: 'box', halfExtents: v(1.4, 2.5, 1.4) },
      position: v(-9, 8.5, -80),
      style: 'stone',
    },

    // --- 5. The Spore Gallery ---------------------------------------------
    // Six metres wide, eleven long, and three vents breathing across it in a
    // rolling wave. The walk is wide enough that there is always a lane.
    {
      id: 'geo-gallery-walk',
      shape: { kind: 'box', halfExtents: v(3, 1, 5.5) },
      position: v(-16, 5, -91.5),
      style: 'stone',
    },
    /** The pylon's bracket, out over the void where it cannot be reached from
     *  the walk — it has to be countered or outlasted. */
    {
      id: 'geo-gallery-pylon-bracket',
      shape: { kind: 'box', halfExtents: v(1.5, 0.6, 1.5) },
      position: v(-25, 5.4, -89),
      style: 'stone-carved',
    },
    {
      id: 'geo-gallery-shelf',
      shape: { kind: 'box', halfExtents: v(2.5, 1, 2.5) },
      position: v(-33.5, 7.2, -96),
      style: 'stone',
    },

    // --- 6. The Lock of Two Arrivals --------------------------------------
    // A breathing shaft 26 m across and 18 m tall, three flues cut into its
    // wall at 90°, and a spinning stone through the middle of it.
    {
      id: 'geo-lock-balcony',
      shape: { kind: 'box', halfExtents: v(3, 1, 3) },
      position: v(-28, 7, -100),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-floor',
      shape: { kind: 'box', halfExtents: v(13, 1, 13) },
      position: v(-30, -1, -114),
      style: 'stone-carved',
    },
    /** North wall, split around the balcony's doorway (x −31 … −25). */
    {
      id: 'geo-lock-wall-north-west',
      shape: { kind: 'box', halfExtents: v(6, 9, 0.8) },
      position: v(-37, 9, -101.4),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-north-east',
      shape: { kind: 'box', halfExtents: v(4, 9, 0.8) },
      position: v(-21, 9, -101.4),
      style: 'stone-carved',
    },
    /** West wall, split around the west flue's mouth (z −114.5 … −113.5). */
    {
      id: 'geo-lock-wall-west-north',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 6.75) },
      position: v(-43.4, 9, -107.75),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-west-south',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 6.75) },
      position: v(-43.4, 9, -120.25),
      style: 'stone-carved',
    },
    /** South wall, split around the south flue's mouth (x −30.5 … −29.5). */
    {
      id: 'geo-lock-wall-south-west',
      shape: { kind: 'box', halfExtents: v(6.25, 9, 0.8) },
      position: v(-36.75, 9, -127.4),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-south-east',
      shape: { kind: 'box', halfExtents: v(6.25, 9, 0.8) },
      position: v(-23.25, 9, -127.4),
      style: 'stone-carved',
    },
    /**
     * East wall, in four pieces. Three gaps: the Unsung Cell's mouth
     * (z −107 … −105), the east flue (z −114.5 … −113.5) and the Lock's gate
     * (z −123.5 … −120.5).
     */
    {
      id: 'geo-lock-wall-east-a',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 2) },
      position: v(-16.6, 9, -103),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-east-b',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 3.25) },
      position: v(-16.6, 9, -110.25),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-east-c',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 3) },
      position: v(-16.6, 9, -117.5),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-wall-east-d',
      shape: { kind: 'box', halfExtents: v(0.8, 9, 1.75) },
      position: v(-16.6, 9, -125.25),
      style: 'stone-carved',
    },
    {
      id: 'geo-lock-gate-lintel',
      shape: { kind: 'box', halfExtents: v(0.8, 5.5, 1.5) },
      position: v(-16.6, 12.5, -122),
      style: 'stone-carved',
    },
    /** The step ring: a shelf half way down the shaft's east side, so leaving
     *  the Spindle is a jump rather than a fall. */
    {
      id: 'geo-lock-step-ring',
      shape: { kind: 'box', halfExtents: v(3, 0.6, 3) },
      position: v(-20, 3.4, -120),
      style: 'stone',
    },
    /**
     * The three flues. Each is 1.0 m wide and 14 m deep, side walls only —
     * nothing rides in them but a note. The drum hangs on the back plate at
     * 27 m from the shaft axis, 20 m from the Spindle, which is why the return
     * has separated (5.24 m) long before the note lands.
     */
    {
      id: 'geo-flue-west-north',
      shape: { kind: 'box', halfExtents: v(7, 3, 0.8) },
      position: v(-50, 8.4, -112.7),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-west-south',
      shape: { kind: 'box', halfExtents: v(7, 3, 0.8) },
      position: v(-50, 8.4, -115.3),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-west-back',
      shape: { kind: 'box', halfExtents: v(0.8, 3, 1) },
      position: v(-57.8, 8.4, -114),
      style: 'gold-trim',
    },
    {
      id: 'geo-flue-south-west',
      shape: { kind: 'box', halfExtents: v(0.8, 3, 7) },
      position: v(-31.3, 8.4, -134),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-south-east',
      shape: { kind: 'box', halfExtents: v(0.8, 3, 7) },
      position: v(-28.7, 8.4, -134),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-south-back',
      shape: { kind: 'box', halfExtents: v(1, 3, 0.8) },
      position: v(-30, 8.4, -141.8),
      style: 'gold-trim',
    },
    {
      id: 'geo-flue-east-north',
      shape: { kind: 'box', halfExtents: v(7, 3, 0.8) },
      position: v(-10, 8.4, -112.7),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-east-south',
      shape: { kind: 'box', halfExtents: v(7, 3, 0.8) },
      position: v(-10, 8.4, -115.3),
      style: 'stone-carved',
    },
    {
      id: 'geo-flue-east-back',
      shape: { kind: 'box', halfExtents: v(0.8, 3, 1) },
      position: v(-2.2, 8.4, -114),
      style: 'gold-trim',
    },

    // --- 7. The Unsung Cell (secret) --------------------------------------
    // A Keeper's own room, behind the shaft's east wall. The floor is there;
    // the light is not, so from the shaft it reads as a doorway onto nothing.
    {
      id: 'geo-cell-floor',
      shape: { kind: 'box', halfExtents: v(4, 1, 3) },
      position: v(-11, -1, -106),
      style: 'gold-trim',
      revealedBy: 'base',
    },
    {
      id: 'geo-cell-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 3, 3) },
      position: v(-6.2, 2, -106),
      style: 'stone-carved',
    },
    {
      id: 'geo-cell-wall-north',
      shape: { kind: 'box', halfExtents: v(4, 3, 0.8) },
      position: v(-11, 2, -102.2),
      style: 'stone-carved',
    },
    {
      id: 'geo-cell-wall-south',
      shape: { kind: 'box', halfExtents: v(4, 3, 0.8) },
      position: v(-11, 2, -109.8),
      style: 'stone-carved',
    },

    // --- 8. The Amplifier Vault (mini-boss) -------------------------------
    {
      id: 'geo-vault-corridor',
      shape: { kind: 'box', halfExtents: v(9, 1, 2.5) },
      position: v(-8, -1, -122),
      style: 'stone',
    },
    /** 42 m of cracked seedbed: covers the Virus Bloom's authored arena at
     *  (22, 0, −108) with a 20 m radius and a metre to spare. */
    {
      id: 'geo-vault-floor',
      shape: { kind: 'box', halfExtents: v(21, 1, 21) },
      position: v(22, -1, -108),
      style: 'infected',
    },
    {
      id: 'geo-vault-rim-north',
      shape: { kind: 'box', halfExtents: v(21, 3, 1) },
      position: v(22, 3, -86),
      style: 'stone-carved',
    },
    {
      id: 'geo-vault-rim-south',
      shape: { kind: 'box', halfExtents: v(21, 3, 1) },
      position: v(22, 3, -130),
      style: 'stone-carved',
    },
    {
      id: 'geo-vault-rim-east',
      shape: { kind: 'box', halfExtents: v(1, 3, 21) },
      position: v(44, 3, -108),
      style: 'stone-carved',
    },
    /** West rim, split around the corridor mouth (z −123.5 … −120.5). */
    {
      id: 'geo-vault-rim-west-a',
      shape: { kind: 'box', halfExtents: v(1, 3, 16.75) },
      position: v(0, 3, -103.75),
      style: 'stone-carved',
    },
    {
      id: 'geo-vault-rim-west-b',
      shape: { kind: 'box', halfExtents: v(1, 3, 2.75) },
      position: v(0, 3, -126.25),
      style: 'stone-carved',
    },
    {
      id: 'geo-vault-ledge',
      shape: { kind: 'box', halfExtents: v(2.5, 0.6, 2.5) },
      position: v(6, 5.4, -114),
      style: 'stone',
    },
    /** SECRET 4's alcove, behind the infected feed channel. */
    {
      id: 'geo-vault-secret-alcove',
      shape: { kind: 'box', halfExtents: v(1.5, 0.6, 2) },
      position: v(42, -0.4, -91),
      style: 'stone-carved',
    },

    // --- 9. The Unsung Stair ----------------------------------------------
    // A chimney in the vault's south-east corner with a spine up the middle of
    // it, so no single corner has a line to both sconces.
    {
      id: 'geo-return-wall-north',
      shape: { kind: 'box', halfExtents: v(6, 7, 0.8) },
      position: v(37, 7, -117.2),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-wall-west-a',
      shape: { kind: 'box', halfExtents: v(0.8, 7, 2) },
      position: v(30.2, 7, -120),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-wall-west-b',
      shape: { kind: 'box', halfExtents: v(0.8, 7, 2) },
      position: v(30.2, 7, -128),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-spine',
      shape: { kind: 'box', halfExtents: v(1.2, 7, 1.2) },
      position: v(37, 7, -124),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-pilaster-east',
      shape: { kind: 'box', halfExtents: v(0.6, 7, 1.5) },
      position: v(43.4, 7, -128.5),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-sconce-bracket-low',
      shape: { kind: 'box', halfExtents: v(0.8, 0.4, 0.8) },
      position: v(31.4, 4.6, -119.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-return-sconce-bracket-high',
      shape: { kind: 'box', halfExtents: v(0.8, 0.4, 0.8) },
      position: v(42.6, 9, -128.5),
      style: 'stone-carved',
    },
    /**
     * The unsung treads. Solid the whole time, unlit until a pulse has passed
     * them — Echo's returning note is what makes hidden Keeper stonework ring
     * back. Accessibility: they are never *removed*, so a player who cannot see
     * them can still walk them; the note only tells you they are there.
     */
    {
      id: 'geo-return-unsung-tread-a',
      shape: { kind: 'box', halfExtents: v(1.6, 0.4, 1.6) },
      position: v(36, 11.6, -121),
      style: 'gold-trim',
      revealedBy: 'echo',
    },
    {
      id: 'geo-return-unsung-tread-b',
      shape: { kind: 'box', halfExtents: v(1.6, 0.4, 1.6) },
      position: v(40, 13.2, -124),
      style: 'gold-trim',
      revealedBy: 'echo',
    },
    /** The gallery over the gap between the two rings, at 14 m, with Oru's ring
     *  open on the left the whole way along it. */
    {
      id: 'geo-return-gallery',
      shape: { kind: 'box', halfExtents: v(19, 1, 2) },
      position: v(19, 13, -131.5),
      style: 'stone-carved',
    },

    // --- 10. The Breath of Oru --------------------------------------------
    {
      id: 'geo-approach-step-a',
      shape: { kind: 'box', halfExtents: v(2, 0.8, 1.5) },
      position: v(-3.5, 10.2, -131),
      style: 'stone',
    },
    {
      id: 'geo-approach-step-b',
      shape: { kind: 'box', halfExtents: v(2, 0.8, 1.5) },
      position: v(3.5, 6.7, -131),
      style: 'stone',
    },
    {
      id: 'geo-approach-step-c',
      shape: { kind: 'box', halfExtents: v(2, 0.8, 1.5) },
      position: v(-3.5, 3, -131),
      style: 'stone',
    },
    {
      id: 'geo-approach-floor',
      shape: { kind: 'box', halfExtents: v(4, 1, 2) },
      position: v(0, -1, -131.5),
      style: 'stone-carved',
    },
    /** 52 m of terraced seedbed: Oru's authored arena, (0, 0, −160) r26. */
    {
      id: 'geo-guardian-floor',
      shape: { kind: 'box', halfExtents: v(26, 1, 26) },
      position: v(0, -1, -160),
      style: 'infected',
    },
    {
      id: 'geo-guardian-rim-north-west',
      shape: { kind: 'box', halfExtents: v(11, 4, 0.5) },
      position: v(-15, 4, -133.25),
      style: 'stone-carved',
    },
    {
      id: 'geo-guardian-rim-north-east',
      shape: { kind: 'box', halfExtents: v(11, 4, 0.5) },
      position: v(15, 4, -133.25),
      style: 'stone-carved',
    },
    {
      id: 'geo-guardian-rim-south',
      shape: { kind: 'box', halfExtents: v(26, 4, 1) },
      position: v(0, 4, -187),
      style: 'stone-carved',
    },
    {
      id: 'geo-guardian-rim-west',
      shape: { kind: 'box', halfExtents: v(1, 4, 26) },
      position: v(-27, 4, -160),
      style: 'stone-carved',
    },
    {
      id: 'geo-guardian-rim-east',
      shape: { kind: 'box', halfExtents: v(1, 4, 26) },
      position: v(27, 4, -160),
      style: 'stone-carved',
    },
    /** Two low terraces the fight raises and drops. Never spikes — only ever
     *  walls to move around. */
    {
      id: 'geo-guardian-terrace-west',
      shape: { kind: 'box', halfExtents: v(5, 0.75, 5) },
      position: v(-14, -0.25, -166),
      style: 'stone',
    },
    {
      id: 'geo-guardian-terrace-east',
      shape: { kind: 'box', halfExtents: v(5, 0.75, 5) },
      position: v(14, -0.25, -152),
      style: 'stone',
    },
    /** Amplifier growth across the ring's west rim: solid while the temple is
     *  detuned, gone the moment it is not. */
    {
      id: 'geo-guardian-vine-gate',
      shape: { kind: 'box', halfExtents: v(0.9, 4, 5) },
      position: v(-27.5, 3, -145),
      style: 'infected',
      hiddenWhenRestored: true,
    },
    /** The way out, which only exists afterwards: the Keepers' stair regrown
     *  through the ring's south rim, back up into the garden. */
    {
      id: 'geo-restored-south-stair',
      shape: { kind: 'ramp', halfExtents: v(4, 1, 5), slope: 0.24 },
      position: v(0, 0.6, -191),
      style: 'restored',
      onlyWhenRestored: true,
    },
    {
      id: 'geo-restored-south-landing',
      shape: { kind: 'box', halfExtents: v(5, 1, 4) },
      position: v(0, 2.4, -200),
      style: 'restored',
      onlyWhenRestored: true,
    },
  ],

  // -------------------------------------------------------------------------
  // Moving platforms — one mechanic each, all five motion kinds
  // -------------------------------------------------------------------------

  movingPlatforms: [
    /** The breath lift: a column of tuned air in the Severed Stair, rising and
     *  falling on a six-second cycle. Optional — it only goes to the secret. */
    {
      id: 'plt-stair-breath',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(4, 2.5, -52),
      style: 'crystal',
      motion: { kind: 'vertical', amplitude: 2.5, seconds: 6 },
    },

    /** Two failing slabs across the Spore Gallery's void, taken under pylon
     *  fire. Half a second of weight each, four seconds to grow back. */
    {
      id: 'plt-gallery-collapse-1',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(-23, 6.4, -95),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.55, respawnSeconds: 4 },
    },
    {
      id: 'plt-gallery-collapse-2',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(-28, 7, -95),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.5, respawnSeconds: 4 },
    },

    /**
     * THE SPINDLE. Two counterweighted stones on one 9 m arm, half a cycle
     * apart so there is always one arriving at the balcony. One revolution
     * every five seconds — 11.31 m/s at the rim, which is what closes each flue
     * to a single arrival, and what carries the player past all three inside
     * the 3.5 s the lock remembers a partial answer for.
     */
    {
      id: 'plt-lock-spindle-a',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-21, 8, -114),
      style: 'stone-carved',
      motion: { kind: 'orbit', centre: v(-30, 8, -114), radius: 9, seconds: 5 },
    },
    {
      id: 'plt-lock-spindle-b',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-39, 8, -114),
      style: 'stone-carved',
      motion: { kind: 'orbit', centre: v(-30, 8, -114), radius: 9, seconds: 5 },
      phase: 0.5,
    },

    /** A drifting seed pallet in the vault. Optional; it reaches the ledge. */
    {
      id: 'plt-vault-drift',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(14, 4, -100),
      style: 'root',
      motion: { kind: 'linear', to: v(14, 4, -112), seconds: 7, pause: 1.2 },
    },

    /** The Unsung Stair's three treads, stepping 3.5 m up and back every two
     *  beats at 108 BPM — 1.11 s a step, quarter-cycle offsets, so the climb
     *  can be taken as one unbroken line by a player who reads the beat. */
    {
      id: 'plt-return-rhythm-1',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(34, 1.4, -121),
      style: 'root',
      motion: { kind: 'rhythm', to: v(34, 4.9, -121), beats: 2 },
    },
    {
      id: 'plt-return-rhythm-2',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(41, 5.6, -120),
      style: 'root',
      motion: { kind: 'rhythm', to: v(41, 9.1, -120), beats: 2 },
      phase: 0.5,
    },
    {
      id: 'plt-return-rhythm-3',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(33, 9.6, -126),
      style: 'root',
      motion: { kind: 'rhythm', to: v(33, 13.1, -126), beats: 2 },
      phase: 0.25,
    },
  ],

  // -------------------------------------------------------------------------
  // Rails
  // -------------------------------------------------------------------------

  rails: [
    /**
     * The Keepers' handrail: a single root strung from the gallery's west end
     * down through the seal into the ring. Optional, in plain sight, and about
     * four seconds faster than the switchback — the reward for a player who has
     * already walked the approach once and does not want to walk it again.
     */
    {
      id: 'rail-approach-descent',
      points: [v(1, 14, -131.5), v(-4, 10, -132), v(-2, 5, -133), v(0, 0.6, -136)],
      speed: 16,
      style: 'root',
    },
  ],

  // -------------------------------------------------------------------------
  // Hazards
  // -------------------------------------------------------------------------

  hazards: [
    /** Under the Severed Stair: standing infection, ankle deep. Failing a tread
     *  costs the tread, not a life. */
    {
      id: 'haz-stair-void',
      shape: { kind: 'box', halfExtents: v(18, 2, 13) },
      position: v(-4, -14, -53),
      damage: 0,
      damageKind: 'hazard',
      style: 'infected',
      isPit: true,
    },
    /** Under the Spore Gallery's collapsing crossing, six metres down. */
    {
      id: 'haz-gallery-void',
      shape: { kind: 'box', halfExtents: v(12, 2, 8) },
      position: v(-26, -2, -93),
      damage: 0,
      damageKind: 'hazard',
      style: 'infected',
      isPit: true,
    },
    /**
     * Three spore vents cut into the gallery walk at 108 BPM: four beats of
     * cycle, two of them venting, offsets 0 / 2 / 1. Left to right that is a
     * rolling wave the player walks *with*. Muted: each vent's cone is drawn
     * building through its wind-up beat and the floor plate under it lights on
     * the beat it will fire, so the pattern is entirely visual; the quiet window
     * is 1.11 s, wider than the 0.9 s it takes to cross at a run.
     */
    {
      id: 'haz-gallery-vent-1',
      shape: { kind: 'box', halfExtents: v(1.4, 2, 1.4) },
      position: v(-14.5, 8, -88),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 0 },
      style: 'infected',
    },
    {
      id: 'haz-gallery-vent-2',
      shape: { kind: 'box', halfExtents: v(1.4, 2, 1.4) },
      position: v(-17.5, 8, -91),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 2 },
      style: 'infected',
    },
    {
      id: 'haz-gallery-vent-3',
      shape: { kind: 'box', halfExtents: v(1.4, 2, 1.4) },
      position: v(-14.5, 8, -94),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 1 },
      style: 'infected',
    },
    /**
     * SHORTCUT GATE — Tidal. The vault's feed channel: not water any more, and
     * it hits like the stone it is falling on. Resonance Thread retunes it and
     * it parts, opening the alcove behind it on a later visit.
     */
    {
      id: 'haz-vault-channel',
      shape: { kind: 'box', halfExtents: v(1.5, 2, 1) },
      position: v(42, 1, -94),
      damage: 16,
      damageKind: 'hazard',
      clearedBy: 'tidal',
      style: 'infected',
    },
    /**
     * The dissonance veil across the Unsung Stair's exit — a standing 440 Hz
     * wave the Amplifier grew into the chimney mouth. Cancelled permanently by
     * the doubled arrival: two notes 0.12 s apart in the same place is exactly
     * the interference that flattens it. The temple's last new use of the
     * ability, and the last thing between the player and the gallery.
     */
    {
      id: 'haz-return-dissonance-veil',
      shape: { kind: 'box', halfExtents: v(2.5, 1.5, 0.6) },
      position: v(33, 15.5, -129.6),
      damage: 14,
      damageKind: 'hazard',
      clearedBy: 'echo',
      style: 'infected',
    },
  ],

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------

  enemies: [
    /**
     * THE CHOIR PIT. Two Whisperers patrolling across each other, a Drifter
     * whose bolts are counterable, a Whisperer swarm on Standard and above —
     * and one Root Fracture, whose 40 points of armour only yield to a charge or
     * a counter. That is deliberate: the room exists partly to prove the
     * doubled arrival is not a solution to everything.
     */
    {
      id: 'enm-pit-whisperer-a',
      archetype: 'whisperer',
      position: v(-22, 6, -72),
      patrol: [v(-22, 6, -72), v(-22, 6, -80)],
      triggerId: 'trg-room-choir-pit',
    },
    {
      id: 'enm-pit-whisperer-b',
      archetype: 'whisperer',
      position: v(-10, 6, -79),
      patrol: [v(-10, 6, -79), v(-10, 6, -71)],
      triggerId: 'trg-room-choir-pit',
    },
    {
      id: 'enm-pit-drifter',
      archetype: 'spore-drifter',
      position: v(-16, 9, -76),
      patrol: [v(-16, 9, -76), v(-24, 9, -80)],
      triggerId: 'trg-room-choir-pit',
    },
    {
      id: 'enm-pit-fracture',
      archetype: 'root-fracture',
      position: v(-16, 6, -82),
      yaw: 0,
      triggerId: 'trg-room-choir-pit',
    },
    {
      id: 'enm-pit-swarm-a',
      archetype: 'whisperer-swarm',
      position: v(-27, 6, -70),
      triggerId: 'trg-room-choir-pit',
      minDifficulty: 'standard',
    },
    {
      id: 'enm-pit-swarm-b',
      archetype: 'whisperer-swarm',
      position: v(-5, 6, -82),
      triggerId: 'trg-room-choir-pit',
      minDifficulty: 'standard',
    },

    /**
     * THE SPORE GALLERY. A pylon on a bracket over the void — unreachable from
     * the walk, so its shots must be countered or waited out — and two Thorn
     * Pursuers, which run faster than the player and therefore force the dash
     * and the vent rhythm into the same decision.
     */
    {
      id: 'enm-gallery-pylon',
      archetype: 'amplifier-pylon',
      position: v(-25, 6, -89),
      yaw: 1.5708,
      triggerId: 'trg-room-spore-gallery',
    },
    {
      id: 'enm-gallery-pursuer-a',
      archetype: 'thorn-pursuer',
      position: v(-16, 6, -96),
      triggerId: 'trg-room-spore-gallery',
    },
    {
      id: 'enm-gallery-pursuer-b',
      archetype: 'thorn-pursuer',
      position: v(-16, 6, -87),
      triggerId: 'trg-room-spore-gallery',
      minDifficulty: 'standard',
    },
    {
      id: 'enm-gallery-drifter',
      archetype: 'spore-drifter',
      position: v(-22, 9, -93),
      patrol: [v(-22, 9, -93), v(-30, 9, -93)],
      triggerId: 'trg-room-spore-gallery',
      minDifficulty: 'explorer',
    },

    /**
     * THE UNSUNG CELL. One Frequency Mimic wearing the shape of the tablet it
     * is sitting on. The temple's only lie, and it is told in an optional room.
     */
    {
      id: 'enm-cell-mimic',
      archetype: 'frequency-mimic',
      position: v(-11, 0, -106),
      guardsSecret: 'pick-secret-cell-tablet',
    },

    /**
     * THE AMPLIFIER VAULT. Two Twin Amplifiers on opposite corners of the
     * seedbed, feeding the Bloom: their four-shot volleys cross the middle of
     * the arena, and cutting them first is what turns the mini-boss from a
     * war of attrition into a fight.
     */
    {
      id: 'enm-vault-amplifier-west',
      archetype: 'twin-amplifier',
      position: v(6, 0, -95),
      yaw: -0.9,
      triggerId: 'trg-vault-wave',
    },
    {
      id: 'enm-vault-amplifier-east',
      archetype: 'twin-amplifier',
      position: v(38, 0, -121),
      yaw: 2.2,
      triggerId: 'trg-vault-wave',
    },
    {
      id: 'enm-vault-mine',
      archetype: 'drifting-mine',
      position: v(22, 2.5, -100),
      patrol: [v(22, 2.5, -100), v(22, 2.5, -112)],
      triggerId: 'trg-vault-wave',
      minDifficulty: 'standard',
    },
    {
      id: 'enm-vault-bloom',
      archetype: 'dissonance-bloom',
      position: v(14, 0, -114),
      triggerId: 'trg-vault-wave',
      minDifficulty: 'explorer',
    },
    {
      id: 'enm-vault-spawner',
      archetype: 'bloom-spawner',
      position: v(30, 0, -100),
      triggerId: 'trg-vault-wave',
      minDifficulty: 'resonance-master',
    },

    /**
     * THE UNSUNG STAIR. Light on purpose: the room is an idea, not a fight. One
     * Drifter over the chimney so the player cannot stand still and study it,
     * and one mine at the top for Resonance Master only.
     */
    {
      id: 'enm-return-drifter',
      archetype: 'spore-drifter',
      position: v(37, 6, -124),
      patrol: [v(37, 6, -124), v(37, 10, -120)],
      triggerId: 'trg-room-unsung-stair',
    },
    {
      id: 'enm-return-mine',
      archetype: 'drifting-mine',
      position: v(36, 12, -127),
      triggerId: 'trg-room-unsung-stair',
      minDifficulty: 'resonance-master',
    },

    /**
     * THE APPROACH. A single Conductor with two Whisperers in a four-metre
     * landing under the seal. It summons rather than fights, which stretches
     * the corridor out just long enough for the player to hear what is on the
     * other side of the door before it opens.
     */
    {
      id: 'enm-guardian-conductor',
      archetype: 'conductor-elite',
      position: v(0, 0, -131),
      yaw: 3.1416,
      triggerId: 'trg-room-guardian',
    },
    {
      id: 'enm-guardian-whisperer-a',
      archetype: 'whisperer',
      position: v(-2.5, 0, -130),
      triggerId: 'trg-room-guardian',
    },
    {
      id: 'enm-guardian-whisperer-b',
      archetype: 'whisperer',
      position: v(2.5, 0, -130),
      triggerId: 'trg-room-guardian',
    },
  ],

  // -------------------------------------------------------------------------
  // Pickups — four secrets, two of them for abilities the player does not have
  // -------------------------------------------------------------------------

  pickups: [
    { id: 'pick-shard-threshold', kind: 'resonance-shard', amount: 5, position: v(-6, 0.4, -4) },
    { id: 'pick-shard-hall-a', kind: 'resonance-shard', amount: 5, position: v(-11, 2.2, -18) },
    { id: 'pick-shard-hall-b', kind: 'resonance-shard', amount: 5, position: v(11, 2.2, -18) },
    { id: 'pick-motif-hall', kind: 'lost-motif', position: v(0, 2.2, -36) },
    /** SECRET 1 of 4 — no ability needed, only the curiosity to point Resonance
     *  Sight at the dark above the stair. The temple's promise that looking pays. */
    {
      id: 'pick-secret-stair-motif',
      kind: 'lost-motif',
      position: v(8, 5.8, -52),
      isSecret: true,
    },
    { id: 'pick-shard-stair', kind: 'resonance-shard', amount: 8, position: v(-13, 6.2, -62) },
    { id: 'pick-coherence-pit', kind: 'coherence-fragment', position: v(-16, 6.2, -76) },
    { id: 'pick-shard-gallery', kind: 'resonance-shard', amount: 8, position: v(-33.5, 8.4, -96) },
    { id: 'pick-shard-lock-ring', kind: 'resonance-shard', amount: 8, position: v(-20, 4.2, -120) },
    { id: 'pick-memory-lock-floor', kind: 'keeper-memory', position: v(-30, 0.4, -114) },
    /** SECRET 2 of 4 — the Unsung Cell's own reward, guarded by the thing
     *  wearing its silhouette. */
    {
      id: 'pick-secret-cell-tablet',
      kind: 'geometry-tablet',
      position: v(-11, 0.6, -106),
      isSecret: true,
    },
    /** SECRET 3 of 4 — MIRROR TONE. The niche is cut so nothing can be fired
     *  into it from anywhere a person can stand: the note has to arrive off the
     *  back wall, which is the Glass Meridian's ability, not this region's. */
    {
      id: 'pick-secret-cell-memory',
      kind: 'keeper-memory',
      position: v(-8.5, 0.6, -106),
      requiresForm: 'prism',
      isSecret: true,
    },
    { id: 'pick-shard-vault-ledge', kind: 'resonance-shard', amount: 10, position: v(6, 6.2, -114) },
    /** SECRET 4 of 4 — RESONANCE THREAD. Behind the vault's feed channel. */
    {
      id: 'pick-secret-vault-seed',
      kind: 'sanctuary-seed',
      position: v(42, 0.4, -91),
      requiresForm: 'tidal',
      isSecret: true,
    },
    /** The Bloom's seedbed, once the Bloom is off it. */
    { id: 'pick-capacitor-vault', kind: 'frequency-capacitor', position: v(22, 0.4, -108) },
    { id: 'pick-shard-return', kind: 'resonance-shard', amount: 8, position: v(40, 13.8, -124) },
    { id: 'pick-signal-approach', kind: 'signal-sample', position: v(0, 0.4, -131.5) },
    /** What the temple was for. Not a secret and not optional: the First Breath
     *  itself, lying in the ring once the Amplifier lets go of it. */
    { id: 'pick-first-breath', kind: 'lost-motif', position: v(0, 1.2, -160) },
  ],

  // -------------------------------------------------------------------------
  // Resonators
  // -------------------------------------------------------------------------

  resonators: [
    /**
     * P1 — the demonstration drum, eight metres from the cradle. Root, four
     * second hold, one drum, no pressure. `kind: 'echo'`, so it wants the note
     * *and its return*: one press. Muted: a single bright ring on the first
     * arrival, a second concentric ring on the return, then the door.
     */
    {
      id: 'res-threshold-drum',
      position: v(0, 2.6, -6),
      degree: 0,
      puzzleId: 'puz-threshold-doubled-arrival',
      holdSeconds: 4,
    },

    /**
     * P2 — the Sounding Hall. Root, Third, Fifth of the Garden Chord, in that
     * order, nine second holds. The Third is eighteen metres away at the back of
     * the room, so the sequence is a walk rather than a chord and nobody can
     * fail it on timing. Muted: each plinth shows its degree as a numbered ring
     * and lights in order; a wrong note visibly resets all three.
     */
    {
      id: 'res-hall-first',
      position: v(-11, 2, -18),
      degree: 0,
      puzzleId: 'puz-hall-sequence',
      order: 0,
      holdSeconds: 9,
    },
    {
      id: 'res-hall-second',
      position: v(0, 2, -36),
      degree: 2,
      puzzleId: 'puz-hall-sequence',
      order: 1,
      holdSeconds: 9,
    },
    {
      id: 'res-hall-third',
      position: v(11, 2, -18),
      degree: 4,
      puzzleId: 'puz-hall-sequence',
      order: 2,
      holdSeconds: 9,
    },

    /**
     * P3 — the Severed Stair. Two drums on opposite walls, 34 m apart, both lit
     * at once for the missing tread to grow. The Harmonic Burst reaches 3.6 m,
     * so the burst is not the answer here; two aimed notes inside 2.4 s is.
     * Muted: both rings must be visibly alight at the same moment, and the
     * growing tread is drawn segment by segment as they are.
     */
    {
      id: 'res-stair-west',
      position: v(-21, 2.6, -49),
      degree: 2,
      puzzleId: 'puz-stair-simultaneous',
      holdSeconds: 2.4,
    },
    {
      id: 'res-stair-east',
      position: v(13, 2.6, -49),
      degree: 5,
      puzzleId: 'puz-stair-simultaneous',
      holdSeconds: 2.4,
    },

    /**
     * P4 — THE LOCK OF TWO ARRIVALS. Root, Fifth, Octave: the Garden Chord's
     * spine, one degree per flue, 27 m down a 1.0 m slot, 4 s hold each.
     *
     * Why it is unanswerable by hand, in numbers: the flue is open across
     * 0.114 s of the Spindle's arc and the base pulse interval is 0.14 s, so one
     * pass is one arrival — and one arrival is not an answer. The drums are
     * 38.2 m apart from one another, 4.44 s of running, so answering them on
     * foot outlives both the 4 s ring and the 3.5 s the lock keeps a partial
     * chord for; the Spindle passes all three in 2.5 s. Echo Pulse needs no
     * second press: its return is born 5.24 m behind
     * the note, which is 1.24 m *inside* the flue mouth, on the same line, and
     * arrives 0.12 s later while the first ring is still bright.
     *
     * Muted: three rings around the shaft wall, one per flue, each showing its
     * degree; a flue whose drum has taken one arrival shows a single ring, and a
     * flue that has taken the doubled arrival shows two. The chord is complete
     * when all three show two. No part of it is a sound.
     */
    {
      id: 'res-lock-west',
      position: v(-57, 8.4, -114),
      degree: 0,
      puzzleId: 'puz-lock-two-arrivals',
      holdSeconds: 4,
    },
    {
      id: 'res-lock-south',
      position: v(-30, 8.4, -141),
      degree: 4,
      puzzleId: 'puz-lock-two-arrivals',
      holdSeconds: 4,
    },
    {
      id: 'res-lock-east',
      position: v(-3, 8.4, -114),
      degree: 7,
      puzzleId: 'puz-lock-two-arrivals',
      holdSeconds: 4,
    },

    /**
     * P5 — the Unsung Stair. Two sconces in diagonally opposite corners of the
     * chimney with the spine between them: no corner has a line to both, and
     * the only place that does is the empty north-east air the second rhythm
     * tread swings through at the top of its rise. Held open for a second and a
     * quarter while the tread carries the player *away* from the low sconce.
     * Muted: both rings visible from the tread, and the held bar fills on
     * screen while the pair stays lit.
     */
    {
      id: 'res-return-sconce-low',
      position: v(32, 5.2, -119.8),
      degree: 2,
      puzzleId: 'puz-return-sustain',
      holdSeconds: 3.5,
    },
    {
      id: 'res-return-sconce-high',
      position: v(42, 9.6, -128.5),
      degree: 5,
      puzzleId: 'puz-return-sustain',
      holdSeconds: 3.5,
    },
  ],

  // -------------------------------------------------------------------------
  // Puzzles — four of the four kinds, and the central one is the echo
  // -------------------------------------------------------------------------

  puzzles: [
    {
      id: 'puz-threshold-doubled-arrival',
      kind: 'echo',
      resonatorIds: ['res-threshold-drum'],
      reward: { kind: 'openDoor', doorId: 'door-threshold-inner' },
      hint: 'One drum, and it wants the note twice. You only have to press once — watch what your own note does on the way back.',
    },
    {
      id: 'puz-hall-sequence',
      kind: 'sequence',
      resonatorIds: ['res-hall-first', 'res-hall-second', 'res-hall-third'],
      reward: { kind: 'openDoor', doorId: 'door-hall-inner' },
      hint: 'Root, Third, Fifth — the Garden Chord, in the order the Keepers built the plinths. Each drum holds its ring for nine seconds; there is no hurry.',
    },
    {
      id: 'puz-stair-simultaneous',
      kind: 'simultaneous',
      resonatorIds: ['res-stair-west', 'res-stair-east'],
      reward: { kind: 'spawnPlatforms', platformIds: ['geo-stair-tread-3'] },
      hint: 'Both walls ringing at the same time. They are too far apart for one burst — two aimed notes, and the second one before the first ring fades.',
    },
    {
      id: 'puz-lock-two-arrivals',
      kind: 'echo',
      resonatorIds: ['res-lock-west', 'res-lock-south', 'res-lock-east'],
      reward: { kind: 'openDoor', doorId: 'door-lock-gate' },
      hint: 'Three drums, each at the end of a slot the line only opens on for a heartbeat. One note per pass is all the slot allows — so send a note that is already two.',
    },
    {
      id: 'puz-return-sustain',
      kind: 'sustain',
      resonatorIds: ['res-return-sconce-low', 'res-return-sconce-high'],
      reward: { kind: 'openDoor', doorId: 'door-return-gallery' },
      hint: 'Hold both sconces open together. The spine blocks every corner from the other; the only line to both is the empty air the second tread rises through.',
    },
  ],

  // -------------------------------------------------------------------------
  // Doors
  // -------------------------------------------------------------------------

  doors: [
    {
      id: 'door-threshold-inner',
      position: v(0, 2, -8.8),
      shape: { kind: 'box', halfExtents: v(3, 3, 0.8) },
      style: 'gold-trim',
    },
    {
      id: 'door-hall-inner',
      position: v(0, 2, -40.8),
      shape: { kind: 'box', halfExtents: v(3, 3, 0.8) },
      style: 'gold-trim',
    },
    /** Out of the Choir Pit. Held shut until the far end of the court has been
     *  walked, so the Spore Gallery can never be entered mid-fight. */
    {
      id: 'door-pit-south',
      position: v(-16, 9, -86.4),
      shape: { kind: 'box', halfExtents: v(3, 3, 0.8) },
      openedByFlag: 'temple-choir-answered',
      style: 'root',
    },
    {
      id: 'door-lock-gate',
      position: v(-16.6, 3, -122),
      shape: { kind: 'box', halfExtents: v(0.8, 4, 1.5) },
      style: 'gold-trim',
    },
    {
      id: 'door-return-gallery',
      position: v(29.5, 16, -131.5),
      shape: { kind: 'box', halfExtents: v(0.8, 3, 2) },
      style: 'gold-trim',
    },
    /** The Keepers' seal on the ring. Opens once the approach is clear. */
    {
      id: 'door-guardian-seal',
      position: v(0, 3, -133.25),
      shape: { kind: 'box', halfExtents: v(4, 4, 0.5) },
      openedByFlag: 'temple-approach-cleared',
      style: 'gold-trim',
    },
  ],

  // -------------------------------------------------------------------------
  // Triggers — one entry trigger per room, plus the beats between them
  // -------------------------------------------------------------------------

  triggers: [
    // --- 1. Threshold ------------------------------------------------------
    {
      id: 'trg-room-threshold',
      position: v(0, 1.5, 6),
      shape: { kind: 'box', halfExtents: v(11, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-temple-threshold' },
    },
    {
      id: 'trg-grant-echo',
      position: v(0, 1.5, -1),
      shape: { kind: 'box', halfExtents: v(2.5, 3, 2.5) },
      once: true,
      action: { kind: 'setFlag', flag: 'temple-echo-loaned' },
    },
    {
      id: 'trg-tut-doubled-arrival',
      position: v(0, 1.5, -3),
      shape: { kind: 'box', halfExtents: v(6, 3, 1.5) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-temple-doubled-arrival' },
    },

    // --- 2. The Sounding Hall ---------------------------------------------
    {
      id: 'trg-room-sounding-hall',
      position: v(0, 1.5, -13),
      shape: { kind: 'box', halfExtents: v(3, 3, 1.5) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-temple-resonator' },
    },
    {
      id: 'trg-hall-free-play',
      position: v(0, 1.5, -22),
      shape: { kind: 'box', halfExtents: v(14, 3, 3) },
      once: true,
      action: {
        kind: 'objective',
        text: 'Nothing in this hall can hurt you. Try the pulse on everything in it.',
      },
    },

    // --- 3. The Severed Stair ---------------------------------------------
    {
      id: 'trg-room-severed-stair',
      position: v(0, 1.5, -42),
      shape: { kind: 'box', halfExtents: v(5, 3, 1.5) },
      once: true,
      action: { kind: 'objective', text: 'The stair is short a tread. Wake both walls at once.' },
    },
    {
      id: 'trg-stair-vista',
      position: v(0, 1.5, -44),
      shape: { kind: 'box', halfExtents: v(5, 3, 1) },
      once: true,
      action: { kind: 'vista', look: v(-13, 6, -62), seconds: 3.5 },
    },

    // --- 4. The Choir Pit -------------------------------------------------
    {
      id: 'trg-room-choir-pit',
      position: v(-16, 7, -67),
      shape: { kind: 'box', halfExtents: v(7, 4, 1.5) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-pit-whisperer-a',
          'enm-pit-whisperer-b',
          'enm-pit-drifter',
          'enm-pit-fracture',
          'enm-pit-swarm-a',
          'enm-pit-swarm-b',
        ],
      },
    },
    {
      id: 'trg-choir-answered',
      position: v(-16, 7, -84),
      shape: { kind: 'box', halfExtents: v(2.5, 4, 1.5) },
      once: true,
      action: { kind: 'setFlag', flag: 'temple-choir-answered' },
    },

    // --- 5. The Spore Gallery ---------------------------------------------
    {
      id: 'trg-room-spore-gallery',
      position: v(-16, 7, -87),
      shape: { kind: 'box', halfExtents: v(2.5, 4, 1.5) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-gallery-pylon',
          'enm-gallery-pursuer-a',
          'enm-gallery-pursuer-b',
          'enm-gallery-drifter',
        ],
      },
    },
    {
      id: 'trg-tut-rhythm-vent',
      position: v(-16, 7, -89.5),
      shape: { kind: 'box', halfExtents: v(2.5, 4, 1.5) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-temple-rhythm-vent' },
    },

    // --- 6. The Lock of Two Arrivals --------------------------------------
    {
      id: 'trg-room-lock',
      position: v(-28, 9, -99),
      shape: { kind: 'box', halfExtents: v(2.5, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-temple-lock' },
    },
    {
      id: 'trg-tut-spindle',
      position: v(-28, 9, -102),
      shape: { kind: 'box', halfExtents: v(2.5, 3, 1) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-temple-spindle' },
    },

    // --- 7. The Unsung Cell (optional) ------------------------------------
    {
      id: 'trg-room-unsung-cell',
      position: v(-16, 0.6, -106),
      shape: { kind: 'box', halfExtents: v(1.5, 2.5, 1.5) },
      once: true,
      action: {
        kind: 'objective',
        text: 'Optional: something is written on the dark in here. Look at it properly.',
      },
    },

    // --- 8. The Amplifier Vault -------------------------------------------
    {
      id: 'trg-room-amplifier-vault',
      position: v(2, 1, -122),
      shape: { kind: 'box', halfExtents: v(2, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-temple-amplifier' },
    },
    {
      id: 'trg-vault-wave',
      position: v(8, 1, -118),
      shape: { kind: 'box', halfExtents: v(3, 3, 3) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-vault-amplifier-west',
          'enm-vault-amplifier-east',
          'enm-vault-mine',
          'enm-vault-bloom',
          'enm-vault-spawner',
        ],
      },
    },
    {
      id: 'trg-vault-phase',
      position: v(12, 1, -114),
      shape: { kind: 'box', halfExtents: v(3, 3, 4) },
      once: true,
      action: { kind: 'phase', phase: 'miniboss' },
    },
    {
      id: 'trg-vault-cleared',
      position: v(34, 1, -120),
      shape: { kind: 'box', halfExtents: v(3, 3, 3) },
      once: true,
      action: { kind: 'setFlag', flag: 'temple-vault-cleared' },
    },

    // --- 9. The Unsung Stair ----------------------------------------------
    {
      id: 'trg-room-unsung-stair',
      position: v(36, 1, -124),
      shape: { kind: 'box', halfExtents: v(3, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-temple-unsung' },
    },
    {
      id: 'trg-vista-oru',
      position: v(16, 14.5, -131.5),
      shape: { kind: 'box', halfExtents: v(4, 3, 1.5) },
      once: true,
      action: { kind: 'vista', look: v(0, 4, -160), seconds: 5 },
    },

    // --- 10. The Breath of Oru --------------------------------------------
    {
      id: 'trg-room-guardian',
      position: v(1, 14.6, -131.5),
      shape: { kind: 'box', halfExtents: v(2, 3, 1.5) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-temple-guardian' },
    },
    {
      id: 'trg-approach-cleared',
      position: v(0, 1, -130.5),
      shape: { kind: 'box', halfExtents: v(3.5, 3, 1.5) },
      once: true,
      action: { kind: 'setFlag', flag: 'temple-approach-cleared' },
    },
    {
      id: 'trg-guardian-phase',
      position: v(0, 2, -138),
      shape: { kind: 'box', halfExtents: v(8, 3, 2) },
      once: true,
      action: { kind: 'phase', phase: 'commander' },
    },
    {
      id: 'trg-first-breath',
      position: v(0, 2, -160),
      shape: { kind: 'box', halfExtents: v(4, 3, 4) },
      once: true,
      action: { kind: 'setFlag', flag: 'temple-first-breath-heard' },
    },
    {
      id: 'trg-restoration-phase',
      position: v(0, 2, -156),
      shape: { kind: 'box', halfExtents: v(6, 3, 3) },
      once: true,
      action: { kind: 'phase', phase: 'restoration' },
    },
    {
      id: 'trg-return-home',
      position: v(0, 2, -186),
      shape: { kind: 'box', halfExtents: v(5, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-temple-first-breath' },
    },
  ],

  // -------------------------------------------------------------------------
  // Checkpoints — one per room that can kill, and a pair around the mini-boss
  // -------------------------------------------------------------------------

  checkpoints: [
    { id: 'cp-00-threshold', position: v(0, 0.2, 6), order: 0, yaw: 0 },
    { id: 'cp-01-sounding-hall', position: v(0, 0.2, -16), order: 1, yaw: 0 },
    { id: 'cp-02-severed-stair', position: v(0, 0.2, -42.5), order: 2, yaw: 0 },
    { id: 'cp-03-choir-pit', position: v(-16, 6.2, -68), order: 3, yaw: 0 },
    { id: 'cp-04-spore-gallery', position: v(-16, 6.2, -88), order: 4, yaw: 0 },
    { id: 'cp-05-lock-balcony', position: v(-28, 8.2, -99), order: 5, yaw: 0 },
    /** Before the mini-boss: in the corridor, the seedbed already in frame. */
    { id: 'cp-06-vault-gate', position: v(-6, 0.2, -122), order: 6, yaw: -1.5708 },
    /** After the mini-boss: at the foot of the Unsung Stair. */
    { id: 'cp-07-vault-cleared', position: v(37, 0.2, -120), order: 7, yaw: 1.5708 },
    { id: 'cp-08-return-gallery', position: v(30, 14.2, -131.5), order: 8, yaw: 1.5708 },
    /** Before the guardian: on the seal landing, under the arches. */
    { id: 'cp-09-guardian-gate', position: v(0, 0.2, -130.5), order: 9, yaw: 3.1416 },
  ],

  // -------------------------------------------------------------------------
  // Cutscenes
  // -------------------------------------------------------------------------

  cutscenes: [
    {
      id: 'cut-temple-threshold',
      lines: [
        {
          speaker: 'Kesh',
          text: 'Say something. Go on — anything.',
          seconds: 2.4,
          emote: 'wry',
        },
        {
          speaker: 'Auralith',
          text: 'The gallery returns it. One beat late, unchanged. They did not build that; they found it and built around it.',
          seconds: 4.4,
          emote: 'scan',
        },
        {
          speaker: 'Kesh',
          text: 'A school, then. All right. Teach me.',
          seconds: 2.6,
          emote: 'quiet',
        },
      ],
      cameraFocus: v(0, 4, -6),
      cameraDistance: 14,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-temple-lock',
      lines: [
        {
          speaker: 'Kesh',
          text: 'Three slots, and I can see straight down all of them for about half a heartbeat each.',
          seconds: 4,
          emote: 'wary',
        },
        {
          speaker: 'Auralith',
          text: 'Then do not send one note three times. Send one note that is already two.',
          seconds: 3.8,
          emote: 'bright',
        },
      ],
      cameraFocus: v(-30, 8, -114),
      cameraDistance: 24,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-temple-amplifier',
      lines: [
        {
          speaker: 'Auralith',
          text: 'Two Amplifiers on the rim, and something in the bed between them drinking from both.',
          seconds: 4,
          emote: 'scan',
        },
        {
          speaker: 'Kesh',
          text: 'Cut the feed first. The flower is only loud because it is being fed.',
          seconds: 3.6,
          emote: 'resolved',
        },
      ],
      cameraFocus: v(22, 3, -108),
      cameraDistance: 22,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-temple-guardian',
      lines: [
        {
          speaker: 'Auralith',
          text: 'The seal is Keeper work. Whatever is behind it, they meant it to be opened by a student.',
          seconds: 4,
          emote: 'grave',
        },
        {
          speaker: 'Oru',
          text: '…do not. Do not come in. I cannot hold the note and hold still.',
          seconds: 4,
          emote: 'strained',
        },
        {
          speaker: 'Kesh',
          text: 'Then stop holding it. That is what I am for.',
          seconds: 2.8,
          emote: 'gentle',
        },
      ],
      cameraFocus: v(0, 4, -140),
      cameraDistance: 22,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-temple-first-breath',
      lines: [
        {
          speaker: 'Oru',
          text: 'That phrase. I have been repeating it for four hundred years and I never once heard it come back.',
          seconds: 4.6,
          emote: 'exhausted',
        },
        {
          speaker: 'Auralith',
          text: 'It has been coming back the whole time. The temple was answering an empty room.',
          seconds: 4.2,
          emote: 'warm',
        },
        {
          speaker: 'Kesh',
          text: 'Not empty now. Come up and see the water argue.',
          seconds: 3.2,
          emote: 'tired',
        },
      ],
      cameraFocus: v(0, 3, -180),
      cameraDistance: 18,
      playerControlled: true,
      skippable: true,
    },
  ],

  // -------------------------------------------------------------------------
  // Tutorials — text, diagram and per-device prompts. Never audio alone.
  // -------------------------------------------------------------------------

  tutorials: [
    {
      id: 'tut-temple-doubled-arrival',
      title: 'Echo Pulse',
      body: 'One press, two arrivals: the note, and the note returning a beat behind it on the same line. The diagram shows both marks landing on the drum.',
      actions: ['fire'],
      completesOn: 'resonatorStruck',
    },
    {
      id: 'tut-temple-resonator',
      title: 'Drums',
      body: 'A struck drum holds its ring for as long as its number says, then fades. A drum that has taken the note twice holds a second ring inside the first.',
      actions: ['fire'],
      completesOn: 'resonatorStruck',
    },
    {
      id: 'tut-temple-rhythm-vent',
      title: 'Spore Vents',
      body: 'The vents breathe on the temple beat: two beats venting, two quiet, and the floor plate under each one lights before it fires. Walk with the wave rather than through it.',
      actions: ['move'],
      completesOn: 'move',
    },
    {
      id: 'tut-temple-spindle',
      title: 'The Spindle',
      body: 'Step on as it arrives, not as it leaves. Each flue opens for a heartbeat as you pass it — one press per pass is all you get, so make the press count twice.',
      actions: ['move', 'fire'],
      completesOn: 'ridePlatform',
    },
    {
      id: 'tut-temple-unsung',
      title: 'Unsung Stone',
      body: 'Keeper stonework rings back when your note passes it. The treads above you are already there; the pulse only tells you where.',
      actions: ['fire'],
      completesOn: 'fire',
    },
  ],

  miniBossId: 'virus-bloom',
  commanderId: 'oru-fractured-colossus',

  /**
   * Thirteen minutes. A first-time Standard player who reads the Lock rather
   * than fighting it lands around 15–18; a player who already knows the answer
   * runs it in about eight.
   */
  parSeconds: 780,
  secretTotal: 4,

  // -------------------------------------------------------------------------
  // Props — landmarks, not clutter
  // -------------------------------------------------------------------------

  props: [
    {
      id: 'prp-threshold-cradle-ring',
      kind: 'fallen-resonator-ring',
      position: v(0, 0, -1),
      yaw: 0,
      scale: 1.4,
    },
    {
      id: 'prp-hall-constellation-disc',
      kind: 'constellation-disc',
      position: v(0, 6, -40),
      yaw: 0,
      scale: 2,
    },
    {
      id: 'prp-lock-breath-column',
      kind: 'amplifier-spire',
      position: v(-30, 0, -114),
      yaw: 0,
      scale: 2.2,
    },
    {
      id: 'prp-vault-seedbed-husk',
      kind: 'seedbed-husk',
      position: v(22, 0, -100),
      yaw: 0.4,
      scale: 2.8,
    },
    {
      id: 'prp-approach-arch-a',
      kind: 'gold-arch',
      position: v(0, 0, -131),
      yaw: 0,
      scale: 1.4,
    },
    {
      id: 'prp-guardian-spire',
      kind: 'amplifier-spire',
      position: v(0, 0, -188),
      yaw: 0,
      scale: 5,
    },
    {
      id: 'prp-guardian-statue',
      kind: 'keeper-statue',
      position: v(-20, 0, -140),
      yaw: 0.6,
      scale: 1.8,
    },
  ],
};
