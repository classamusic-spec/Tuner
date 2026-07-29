import type { StageDef } from '@tuner/game-core';
import { DETUNED_HZ, WORLD_CHORD_HZ, PALETTE } from '@tuner/shared';
import { Layer } from '@tuner/physics';

/**
 * Stage 01 — The Fallen Sanctuary.
 *
 * The introductory region. Everything here is authored as data: the collision
 * the player feels, the shapes the renderer draws, the prompts the HUD shows
 * and the lines the subtitle track speaks all come out of this one object.
 *
 * ---------------------------------------------------------------------------
 * MOVEMENT BUDGET (from DEFAULT_MOVEMENT_CONFIG — every gap below is measured
 * against these numbers, and `fallen-sanctuary.test.ts` asserts the result):
 *
 *   capsule            radius 0.36 m, height 1.60 m
 *   run speed          8.6 m/s
 *   jump height        3.05 m   -> take-off 13.97 m/s, rise 0.437 s
 *   fall gravity       -32 * 1.45 = -46.4 m/s^2 -> fall 3.05 m in 0.363 s
 *   single jump, flat  0.437 + 0.363 = 0.800 s airborne = 6.87 m of ground
 *   double jump        +2.50 m from wherever it is spent; a well-timed chain
 *                      buys ~1.25 s of airtime = ~10.7 m of ground
 *   dash               24 m/s for 0.17 s with dashGravityScale 0 = 4.08 m of
 *                      perfectly flat travel, and it refunds the arc it eats
 *   jump + air dash + double jump ≈ 14.7 m of ground
 *
 * The stage therefore uses these ceilings, in order of what the player owns at
 * that point in the level:
 *
 *   SINGLE JUMP ONLY   gaps <= 4.4 m   (65% of the 6.87 m budget)
 *   DOUBLE JUMP        one 8.4 m gap   (79% of the 10.7 m budget)
 *   DASH CHAIN         one 12.0 m gap  (82% of the 14.7 m budget, and 12% past
 *                                       the double-jump budget so the dash is
 *                                       genuinely the answer, not a shortcut)
 *
 * ---------------------------------------------------------------------------
 * LAYOUT. The stage runs along +X. Z is lateral, Y is up. Floor tops are quoted
 * as absolute Y so the gap arithmetic above can be checked by eye.
 *
 *   x  -16 …  10   Awakening terrace .... floor top  0.0   walk, camera, vista
 *   x   14 …  40   Broken steps ......... tops 0.0/0.9/1.8 three single jumps
 *   x   48 …  74   Reliquary plaza ...... floor top  1.8   Auralith, pulse
 *   x   74 … 102   Chord chasm .......... tops      1.8    collapsing platforms
 *   x  102 … 126   Antiphon court ....... floor top  1.8    first Whisperers
 *   x  126 … 150   Hall of the Armoured . floor top  1.8    sight, charge
 *   x  150 … 174   The broken span ...... floor top  0.6    dash
 *   x  174 … 206   Escape colonnade ..... floor top  0.6    detune wave
 *   x  206 … 242   Guardian ring ........ floor top  0.6    mini-boss
 *   x  242 … 262   Lattice terrace ...... floor top  0.6    the reveal
 *
 * killPlaneY sits at -42, which is 35.8 m below the lowest authored collider
 * (the chasm pillar bottoms out at -6.2).
 */
export const FALLEN_SANCTUARY: StageDef = {
  id: 'fallen-sanctuary',
  displayName: 'The Fallen Sanctuary',
  subtitle: 'Where the first chord was kept',
  description:
    `A hillside sanctuary that held ${WORLD_CHORD_HZ} Hz for eight hundred years, ` +
    `caught in the first hours of the retuning. The stone is still ringing — a ` +
    `semitone sharp, at ${DETUNED_HZ} Hz — and the terraces are coming apart ` +
    `because nothing here was built to stand at that pitch.`,

  /** Two thirds detuned: violet is winning, but the true chord is still audible. */
  infection: 0.62,

  /** Slow, ceremonial pulse. Collapse timings and vent hazards ride this. */
  bpm: 104,

  spawnPoint: { x: -10, y: 1, z: 0 },
  /** Yaw 0 faces +X, which is the direction the whole stage runs. */
  spawnYaw: 0,
  killPlaneY: -42,

  ambience: {
    // Infected sanctuary at dawn: a navy sky bruising to violet at the horizon,
    // a low gold sun raking in through the broken east dome, and a violet
    // ambient bounce coming up off the infected stone.
    skyTop: PALETTE.abyss,
    skyBottom: PALETTE.infectionDeep,
    fogColour: PALETTE.panel,
    fogNear: 28,
    fogFar: 205,
    sunColour: PALETTE.gold,
    // Low and from behind-left, so every column throws a long readable shadow.
    sunDirection: { x: -0.44, y: -0.36, z: 0.82 },
    ambientColour: PALETTE.infection,
    restored: {
      // Same dawn, retuned: the violet drains out and the cyan of a healthy
      // 432 Hz signal comes up underneath it.
      skyTop: PALETTE.abyss,
      skyBottom: PALETTE.resonanceDeep,
      fogColour: PALETTE.resonanceDeep,
      sunColour: PALETTE.gold,
      ambientColour: PALETTE.restore,
    },
  },

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------
  geometry: [
    // --- Awakening terrace, floor top y = 0, x -14 … 10, z -10 … 10 ---------
    {
      id: 'geo-awakening-floor',
      shape: { kind: 'box', halfExtents: { x: 12, y: 1.5, z: 10 } },
      position: { x: -2, y: -1.5, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-awakening-backwall',
      shape: { kind: 'box', halfExtents: { x: 1, y: 5, z: 10 } },
      position: { x: -15, y: 5, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-awakening-rail-north',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: -2, y: 0.9, z: 10.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-awakening-rail-south',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: -2, y: 0.9, z: -10.5 },
      style: 'gold-trim',
    },
    {
      // A 1.2 m block by the north edge. Optional, and the first thing the
      // player will try to jump onto without being asked to.
      id: 'geo-awakening-overlook',
      shape: { kind: 'box', halfExtents: { x: 2.5, y: 0.6, z: 2.5 } },
      position: { x: 5, y: 0.6, z: 6.5 },
      style: 'stone',
    },

    // --- Broken steps. Single jump only. -----------------------------------
    {
      // top y 0.0, x 14.0 … 18.8. GAP from the terrace edge (x 10) = 4.0 m,
      // flat. Budget 6.87 m. 58% used.
      id: 'geo-step-01',
      shape: { kind: 'box', halfExtents: { x: 2.4, y: 0.5, z: 3.2 } },
      position: { x: 16.4, y: -0.5, z: 0 },
      style: 'stone',
    },
    {
      // top y 0.9, x 23.2 … 28.0, offset to z -2.2. GAP = 4.4 m with a 0.9 m
      // rise; a jump that clears 4.4 m flat is still rising at 0.9 m. 64% used.
      id: 'geo-step-02',
      shape: { kind: 'box', halfExtents: { x: 2.4, y: 0.5, z: 3.2 } },
      position: { x: 25.6, y: 0.4, z: -2.2 },
      style: 'stone',
    },
    {
      // top y 1.8, x 32 … 40. GAP = 4.0 m with a 0.9 m rise. 58% used.
      // Wide, railed and safe: this is the double-jump classroom.
      id: 'geo-terrace-hymnal',
      shape: { kind: 'box', halfExtents: { x: 4, y: 1, z: 6 } },
      position: { x: 36, y: 0.8, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-terrace-hymnal-rail-north',
      shape: { kind: 'box', halfExtents: { x: 4, y: 0.7, z: 0.4 } },
      position: { x: 36, y: 2.5, z: 6.4 },
      style: 'gold-trim',
    },
    {
      id: 'geo-terrace-hymnal-rail-south',
      shape: { kind: 'box', halfExtents: { x: 4, y: 0.7, z: 0.4 } },
      position: { x: 36, y: 2.5, z: -6.4 },
      style: 'gold-trim',
    },

    // --- Reliquary plaza. Entered by the one double-jump gap. --------------
    {
      // top y 1.8, x 48.4 … 74.4, z -11 … 11.
      // GAP from the hymnal terrace edge (x 40) = 8.4 m, flat.
      // Single-jump budget 6.87 m — 1.53 m short, so it cannot be brute-forced.
      // Double-jump budget 10.7 m — 79% used. Taught immediately before.
      id: 'geo-plaza-auralith',
      shape: { kind: 'box', halfExtents: { x: 13, y: 1, z: 11 } },
      position: { x: 61.4, y: 0.8, z: 0 },
      style: 'stone-carved',
    },
    {
      // The altar. 1.1 m above the plaza, so it reads as a step, not a wall.
      id: 'geo-plaza-altar',
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 0.55, z: 1.5 } },
      position: { x: 55.5, y: 2.35, z: 0 },
      style: 'gold-trim',
    },
    {
      id: 'geo-plaza-rail-north',
      shape: { kind: 'box', halfExtents: { x: 13, y: 0.8, z: 0.5 } },
      position: { x: 61.4, y: 2.6, z: 11.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-plaza-rail-south',
      shape: { kind: 'box', halfExtents: { x: 13, y: 0.8, z: 0.5 } },
      position: { x: 61.4, y: 2.6, z: -11.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-plaza-pillar-north',
      shape: { kind: 'box', halfExtents: { x: 0.8, y: 4.5, z: 0.8 } },
      position: { x: 50.5, y: 6.3, z: 8 },
      style: 'stone-carved',
    },
    {
      id: 'geo-plaza-pillar-south',
      shape: { kind: 'box', halfExtents: { x: 0.8, y: 4.5, z: 0.8 } },
      position: { x: 50.5, y: 6.3, z: -8 },
      style: 'stone-carved',
    },
    {
      // Infected growth crusting the plaza's east arch. Flavour mass either
      // side of the sealed opening; the seal itself is `door-infected-growth`.
      id: 'geo-growth-cluster-north',
      shape: { kind: 'box', halfExtents: { x: 1.8, y: 2.2, z: 2 } },
      position: { x: 70, y: 4, z: 6.5 },
      style: 'infected',
      hiddenWhenRestored: true,
    },
    {
      id: 'geo-growth-cluster-south',
      shape: { kind: 'box', halfExtents: { x: 1.8, y: 2.2, z: 2 } },
      position: { x: 70, y: 4, z: -6.5 },
      style: 'infected',
      hiddenWhenRestored: true,
    },
    {
      // The arch cheeks. They funnel the whole plaza into the sealed opening at
      // z -3.5 … 3.5, so the growth cannot simply be walked around.
      id: 'geo-plaza-exit-wall-north',
      shape: { kind: 'box', halfExtents: { x: 1, y: 4, z: 3.75 } },
      position: { x: 73.4, y: 5.8, z: 7.25 },
      style: 'stone-carved',
    },
    {
      id: 'geo-plaza-exit-wall-south',
      shape: { kind: 'box', halfExtents: { x: 1, y: 4, z: 3.75 } },
      position: { x: 73.4, y: 5.8, z: -7.25 },
      style: 'stone-carved',
    },

    // --- Chord chasm. A single static rest pillar; everything else falls. ---
    {
      // top y 1.8, x 87.0 … 90.2, z 4.9 … 8.1. Reached sideways off
      // `mp-chord-03` (z 0.1 … 3.5): a 1.4 m lateral hop. Optional, and it
      // costs the player their collapse timing, which is the point.
      id: 'geo-chasm-pillar',
      shape: { kind: 'box', halfExtents: { x: 1.6, y: 4, z: 1.6 } },
      position: { x: 88.6, y: -2.2, z: 6.5 },
      style: 'stone',
    },
    {
      // Only after the region is retuned: the chasm knits itself back into a
      // walkway. Present on revisits, absent on the first run.
      id: 'geo-restored-bridge',
      shape: { kind: 'box', halfExtents: { x: 13.8, y: 0.4, z: 2.5 } },
      position: { x: 88.2, y: 1.4, z: 0 },
      style: 'restored',
      onlyWhenRestored: true,
    },

    // --- Antiphon court. First Detuner contact. ----------------------------
    {
      // top y 1.8, x 102 … 126, z -10 … 10.
      // GAP from `mp-chord-04` (ends x 99.3) = 2.7 m. Landing after a collapse
      // chain must be generous.
      id: 'geo-court-antiphon',
      shape: { kind: 'box', halfExtents: { x: 12, y: 1, z: 10 } },
      position: { x: 114, y: 0.8, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-court-rail-north',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: 114, y: 2.7, z: 10.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-court-rail-south',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: 114, y: 2.7, z: -10.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-court-arch-north',
      shape: { kind: 'box', halfExtents: { x: 0.7, y: 3.5, z: 0.7 } },
      position: { x: 103.5, y: 5.3, z: 8 },
      style: 'stone-carved',
    },
    {
      id: 'geo-court-arch-south',
      shape: { kind: 'box', halfExtents: { x: 0.7, y: 3.5, z: 0.7 } },
      position: { x: 103.5, y: 5.3, z: -8 },
      style: 'stone-carved',
    },
    {
      // The Keeper's vigil alcove, top y 9.0. Unreachable until the vigil
      // puzzle raises `mp-vigil-step-01` and `mp-vigil-step-02`.
      id: 'geo-vigil-alcove',
      shape: { kind: 'box', halfExtents: { x: 2.2, y: 0.4, z: 2 } },
      position: { x: 124.5, y: 8.6, z: -8 },
      style: 'gold-trim',
    },
    {
      // SECRET, Echo Form only. Top y 9.4, which is 7.6 m above the court
      // floor. The best a double jump can do from flat ground is 5.55 m of
      // rise, so this is 2.05 m out of reach on the first visit — and the ledge
      // does not even exist until Echo Form makes it audible.
      id: 'geo-echo-ledge',
      shape: { kind: 'box', halfExtents: { x: 2.4, y: 0.4, z: 2.4 } },
      position: { x: 121, y: 9, z: 7.5 },
      style: 'glass',
      revealedBy: 'echo',
    },

    // --- Hall of the Armoured. Resonance Sight and Charged Chord. ----------
    {
      // top y 1.8, x 126 … 150, z -9 … 9. Flush with the court: no gap, because
      // the lesson here is combat, not traversal.
      id: 'geo-hall-armour',
      shape: { kind: 'box', halfExtents: { x: 12, y: 1, z: 9 } },
      position: { x: 138, y: 0.8, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-rail-north',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: 138, y: 2.7, z: 9.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-hall-rail-south',
      shape: { kind: 'box', halfExtents: { x: 12, y: 0.9, z: 0.5 } },
      position: { x: 138, y: 2.7, z: -9.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-hall-buttress-north',
      shape: { kind: 'box', halfExtents: { x: 1, y: 3.2, z: 1 } },
      position: { x: 131, y: 5, z: 7.5 },
      style: 'stone-carved',
    },
    {
      id: 'geo-hall-buttress-south',
      shape: { kind: 'box', halfExtents: { x: 1, y: 3.2, z: 1 } },
      position: { x: 131, y: 5, z: -7.5 },
      style: 'stone-carved',
    },
    {
      // SECRET ledge, revealed by Resonance Sight with the untransformed
      // Auralith. Top y 5.6 — a 3.8 m rise off the hall floor, comfortably
      // inside the 5.55 m double-jump ceiling.
      id: 'geo-hall-alcove-ledge',
      shape: { kind: 'box', halfExtents: { x: 2, y: 0.4, z: 2 } },
      position: { x: 146, y: 5.2, z: -7 },
      style: 'gold-trim',
      revealedBy: 'base',
    },

    // --- The broken span and the escape colonnade. ------------------------
    {
      // top y 0.6, x 162 … 174, z -8 … 8.
      // GAP from the hall edge (x 150) = 12.0 m, dropping 1.2 m.
      // Double-jump budget 10.7 m — 1.3 m short.
      // Jump + air dash + double jump budget 14.7 m — 82% used.
      id: 'geo-ledge-dash-landing',
      shape: { kind: 'box', halfExtents: { x: 6, y: 1, z: 8 } },
      position: { x: 168, y: -0.4, z: 0 },
      style: 'stone',
    },
    {
      // top y 0.6, x 174 … 206, z -5 … 5. 32 m of straight run: 3.72 s at full
      // speed, against a wave that needs 6.06 s to cross the same ground.
      id: 'geo-corridor-escape',
      shape: { kind: 'box', halfExtents: { x: 16, y: 1, z: 5 } },
      position: { x: 190, y: -0.4, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-corridor-wall-north',
      shape: { kind: 'box', halfExtents: { x: 16, y: 3, z: 0.6 } },
      position: { x: 190, y: 3.2, z: 5.6 },
      style: 'stone-carved',
    },
    {
      id: 'geo-corridor-wall-south',
      shape: { kind: 'box', halfExtents: { x: 16, y: 3, z: 0.6 } },
      position: { x: 190, y: 3.2, z: -5.6 },
      style: 'stone-carved',
    },

    // --- Guardian ring. ----------------------------------------------------
    {
      // top y 0.6, x 206 … 240, z -17 … 17. A 34 m square: room to circle a
      // heavy mini-boss without ever being cornered.
      // Boss arena centre: { x: 223, y: 0.6, z: 0 }, radius 15.
      id: 'geo-arena-guardian',
      shape: { kind: 'box', halfExtents: { x: 17, y: 1.2, z: 17 } },
      position: { x: 223, y: -0.6, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-wall-north',
      shape: { kind: 'box', halfExtents: { x: 17, y: 5, z: 1 } },
      position: { x: 223, y: 5, z: 18 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-wall-south',
      shape: { kind: 'box', halfExtents: { x: 17, y: 5, z: 1 } },
      position: { x: 223, y: 5, z: -18 },
      style: 'stone-carved',
    },
    {
      // The west face, split either side of the corridor mouth at z -5 … 5.
      id: 'geo-arena-wall-west-north',
      shape: { kind: 'box', halfExtents: { x: 1, y: 5, z: 6 } },
      position: { x: 207, y: 5, z: 11 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-wall-west-south',
      shape: { kind: 'box', halfExtents: { x: 1, y: 5, z: 6 } },
      position: { x: 207, y: 5, z: -11 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-wall-east-north',
      shape: { kind: 'box', halfExtents: { x: 1, y: 5, z: 6.5 } },
      position: { x: 241, y: 5, z: 10.5 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-wall-east-south',
      shape: { kind: 'box', halfExtents: { x: 1, y: 5, z: 6.5 } },
      position: { x: 241, y: 5, z: -10.5 },
      style: 'stone-carved',
    },
    {
      // Four pillars for cover during the mini-boss. Tops at 7.6.
      id: 'geo-arena-pillar-nw',
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 3.5, z: 1.2 } },
      position: { x: 212, y: 4.1, z: 11 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-pillar-sw',
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 3.5, z: 1.2 } },
      position: { x: 212, y: 4.1, z: -11 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-pillar-ne',
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 3.5, z: 1.2 } },
      position: { x: 234, y: 4.1, z: 11 },
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-pillar-se',
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 3.5, z: 1.2 } },
      position: { x: 234, y: 4.1, z: -11 },
      style: 'stone-carved',
    },
    {
      // Floor beneath the lattice gate, so the doorway is a threshold rather
      // than a 2 m hole once the seal lifts.
      id: 'geo-lattice-threshold',
      shape: { kind: 'box', halfExtents: { x: 1, y: 1.2, z: 4 } },
      position: { x: 241, y: -0.6, z: 0 },
      style: 'gold-trim',
    },

    // --- Lattice terrace. --------------------------------------------------
    {
      // top y 0.6, x 242 … 262, z -10 … 10. Open to the sky on three sides:
      // this is the shot the World Lattice unfolds into.
      id: 'geo-terrace-lattice',
      shape: { kind: 'box', halfExtents: { x: 10, y: 1.2, z: 10 } },
      position: { x: 252, y: -0.6, z: 0 },
      style: 'stone-carved',
    },
    {
      id: 'geo-lattice-plinth',
      shape: { kind: 'box', halfExtents: { x: 2.5, y: 0.5, z: 2.5 } },
      position: { x: 252, y: 1.1, z: 0 },
      style: 'gold-trim',
    },
    {
      id: 'geo-terrace-rail-north',
      shape: { kind: 'box', halfExtents: { x: 10, y: 0.9, z: 0.5 } },
      position: { x: 252, y: 1.5, z: 10.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-terrace-rail-south',
      shape: { kind: 'box', halfExtents: { x: 10, y: 0.9, z: 0.5 } },
      position: { x: 252, y: 1.5, z: -10.5 },
      style: 'gold-trim',
    },
    {
      id: 'geo-terrace-rail-east',
      shape: { kind: 'box', halfExtents: { x: 0.5, y: 0.9, z: 10 } },
      position: { x: 262.5, y: 1.5, z: 0 },
      style: 'gold-trim',
    },
  ],

  // -------------------------------------------------------------------------
  // Moving platforms
  // -------------------------------------------------------------------------
  movingPlatforms: [
    // --- Chord chasm. Four collapsing musical platforms, tops at y 1.8. -----
    // Every hop here is inside the *single*-jump budget (6.87 m) on purpose:
    // the difficulty is the 0.8 s fuse, not the distance. The weave in Z keeps
    // the camera moving and stops the run reading as a straight line.
    {
      // x 77.3 … 80.7. GAP from the plaza edge (x 74.4) = 2.9 m. Easy entry.
      id: 'mp-chord-01',
      shape: { kind: 'box', halfExtents: { x: 1.7, y: 0.35, z: 1.7 } },
      position: { x: 79, y: 1.45, z: 0 },
      style: 'crystal',
      motion: { kind: 'collapse', delaySeconds: 0.8, respawnSeconds: 3 },
    },
    {
      // x 83.7 … 87.1, z -4.3 … -0.9. GAP 3.0 m along X, 2.6 m across Z:
      // 3.97 m diagonal. 58% of the single-jump budget.
      id: 'mp-chord-02',
      shape: { kind: 'box', halfExtents: { x: 1.7, y: 0.35, z: 1.7 } },
      position: { x: 85.4, y: 1.45, z: -2.6 },
      style: 'crystal',
      motion: { kind: 'collapse', delaySeconds: 0.8, respawnSeconds: 3 },
    },
    {
      // x 90.1 … 93.5, z 0.1 … 3.5. GAP 3.0 m along X, 4.4 m across Z:
      // 5.32 m diagonal. 77% of the single-jump budget — the widest of the set.
      id: 'mp-chord-03',
      shape: { kind: 'box', halfExtents: { x: 1.7, y: 0.35, z: 1.7 } },
      position: { x: 91.8, y: 1.45, z: 1.8 },
      style: 'crystal',
      motion: { kind: 'collapse', delaySeconds: 0.8, respawnSeconds: 3 },
    },
    {
      // x 95.9 … 99.3, z -2.9 … 0.5. GAP 2.4 m along X, 3.0 m across Z:
      // 3.84 m diagonal.
      id: 'mp-chord-04',
      shape: { kind: 'box', halfExtents: { x: 1.7, y: 0.35, z: 1.7 } },
      position: { x: 97.6, y: 1.45, z: -1.2 },
      style: 'crystal',
      motion: { kind: 'collapse', delaySeconds: 0.8, respawnSeconds: 3 },
    },

    // --- The Keeper's vigil steps. Dormant until `pz-keeper-vigil` solves. --
    {
      // top y 4.3 — a 2.5 m rise off the court floor.
      id: 'mp-vigil-step-01',
      shape: { kind: 'box', halfExtents: { x: 1.6, y: 0.3, z: 1.6 } },
      position: { x: 121, y: 4, z: -3 },
      style: 'gold-trim',
      motion: { kind: 'vertical', amplitude: 0.35, seconds: 3.2 },
    },
    {
      // top y 6.9 — a 2.6 m rise and a 3.0 m lateral step off step-01.
      id: 'mp-vigil-step-02',
      shape: { kind: 'box', halfExtents: { x: 1.6, y: 0.3, z: 1.6 } },
      position: { x: 124.5, y: 6.6, z: -6 },
      style: 'gold-trim',
      motion: { kind: 'vertical', amplitude: 0.35, seconds: 3.2 },
      phase: 0.5,
    },

    // --- The detune wave. --------------------------------------------------
    // A hazard, not a platform: it is authored here because the format's only
    // way to express *motion* is `PlatformMotion`, and `layer: Layer.Hazard`
    // is what tells the runtime this volume damages instead of carries.
    // It surges x 170 -> 208 in 6.4 s = 5.94 m/s, against an 8.6 m/s run, and
    // dwells 2.5 s at each end — so the corridor is a timed run, not a scripted
    // one, and the entry is a readable "wait for it to pull back, then go".
    //   rest volume       x 168.6 … 171.4
    //   safe pocket       x 162 … 168.6 on the landing ledge, which is where
    //                     cp-04 and the escape triggers all sit
    //   corridor run      x 174 -> 206 = 32 m = 3.72 s at full speed
    //   wave over same    x 170 -> 206 = 36 m = 6.06 s
    //   margin            ~2.3 s, which is the budget for weaving the vents
    {
      id: 'mp-detune-wave',
      shape: { kind: 'box', halfExtents: { x: 1.4, y: 6, z: 6 } },
      position: { x: 170, y: 5, z: 0 },
      layer: Layer.Hazard,
      style: 'infected',
      motion: { kind: 'linear', to: { x: 208, y: 5, z: 0 }, seconds: 6.4, pause: 2.5 },
    },
  ],

  // -------------------------------------------------------------------------
  // Rails
  // -------------------------------------------------------------------------
  rails: [
    {
      // An optional high line strung across the chasm for players who spot it:
      // mount off the plaza lip (top 1.8) with a 1.6 m hop onto the head of the
      // line, ride to the court. Rewards nerve, skips the collapse timing.
      id: 'rail-chord-line',
      points: [
        { x: 74.4, y: 3.4, z: -6 },
        { x: 84, y: 4.6, z: -6 },
        { x: 94, y: 4.6, z: -6 },
        { x: 102, y: 3.4, z: -6 },
      ],
      speed: 17,
      style: 'crystal',
    },
  ],

  // -------------------------------------------------------------------------
  // Hazards
  // -------------------------------------------------------------------------
  hazards: [
    {
      // The chasm floor. A pit, not a damage volume: falling here costs the
      // player the platform run, never their Coherence.
      id: 'hzd-chasm-pit',
      shape: { kind: 'box', halfExtents: { x: 14, y: 3, z: 14 } },
      position: { x: 88.2, y: -14, z: 0 },
      damage: 0,
      damageKind: 'hazard',
      isPit: true,
      style: 'infected',
    },
    {
      // Under the broken span.
      id: 'hzd-span-pit',
      shape: { kind: 'box', halfExtents: { x: 6.5, y: 3, z: 10 } },
      position: { x: 156, y: -14, z: 0 },
      damage: 0,
      damageKind: 'hazard',
      isPit: true,
      style: 'infected',
    },
    // Three detune vents in the escape colonnade. Each covers half the 10 m
    // corridor width and pulses two beats in every four, so the run reads as a
    // weave: north, south, north. At 104 bpm a beat is 0.577 s, so a vent is
    // dangerous for 1.15 s and safe for 1.15 s.
    {
      id: 'hzd-vent-north-01',
      shape: { kind: 'box', halfExtents: { x: 1.4, y: 1.3, z: 2.5 } },
      position: { x: 180, y: 1.9, z: -2.5 },
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 0 },
      clearedBy: 'bloom',
      style: 'infected',
    },
    {
      id: 'hzd-vent-south-01',
      shape: { kind: 'box', halfExtents: { x: 1.4, y: 1.3, z: 2.5 } },
      position: { x: 188, y: 1.9, z: 2.5 },
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 2 },
      clearedBy: 'bloom',
      style: 'infected',
    },
    {
      id: 'hzd-vent-north-02',
      shape: { kind: 'box', halfExtents: { x: 1.4, y: 1.3, z: 2.5 } },
      position: { x: 196, y: 1.9, z: -2.5 },
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 0 },
      clearedBy: 'bloom',
      style: 'infected',
    },
  ],

  // -------------------------------------------------------------------------
  // Enemies
  // -------------------------------------------------------------------------
  enemies: [
    // First contact: three Whisperers skittering out of the court's cracks.
    {
      id: 'spawn-whisperer-01',
      archetype: 'whisperer',
      position: { x: 112, y: 2.6, z: 3 },
      yaw: Math.PI,
      patrol: [
        { x: 112, y: 2.6, z: 3 },
        { x: 118, y: 2.6, z: -4 },
        { x: 112, y: 2.6, z: 3 },
      ],
      triggerId: 'trg-whisperer-wave',
    },
    {
      id: 'spawn-whisperer-02',
      archetype: 'whisperer',
      position: { x: 117, y: 2.6, z: -5 },
      yaw: Math.PI,
      triggerId: 'trg-whisperer-wave',
    },
    {
      id: 'spawn-whisperer-03',
      archetype: 'whisperer',
      position: { x: 121, y: 2.6, z: 4 },
      yaw: Math.PI,
      triggerId: 'trg-whisperer-wave',
      minDifficulty: 'standard',
    },
    {
      id: 'spawn-drifter-court',
      archetype: 'drifter',
      position: { x: 123, y: 5.5, z: -6 },
      patrol: [
        { x: 123, y: 5.5, z: -6 },
        { x: 108, y: 6.5, z: 6 },
        { x: 123, y: 5.5, z: -6 },
      ],
      triggerId: 'trg-whisperer-wave',
      minDifficulty: 'explorer',
    },

    // The armoured lesson. A Fracture brute shrugs off pulses; only a charged
    // chord opens it.
    {
      id: 'spawn-fracture-warden',
      archetype: 'fracture',
      position: { x: 143, y: 2.6, z: 0 },
      yaw: Math.PI,
      triggerId: 'trg-charge-encounter',
    },
    {
      id: 'spawn-whisperer-04',
      archetype: 'whisperer',
      position: { x: 146, y: 2.6, z: 5 },
      yaw: Math.PI,
      triggerId: 'trg-charge-encounter',
      minDifficulty: 'standard',
    },
    {
      // Squatting under the hidden alcove. Cleansing it is the nudge that makes
      // players sweep Resonance Sight across the wall above.
      id: 'spawn-whisperer-alcove-guard',
      archetype: 'whisperer',
      position: { x: 144.5, y: 2.6, z: -7 },
      yaw: Math.PI,
      guardsSecret: 'pickup-secret-lost-motif',
    },

    // Pressure during the escape run. Both are difficulty-gated so Story and
    // Explorer players get a clean sprint.
    {
      id: 'spawn-drifter-escape',
      archetype: 'drifter',
      position: { x: 186, y: 3.5, z: 0 },
      triggerId: 'trg-escape-run',
      minDifficulty: 'explorer',
    },
    {
      id: 'spawn-amplifier-corridor',
      archetype: 'amplifier',
      position: { x: 200, y: 1.4, z: 4 },
      yaw: Math.PI,
      triggerId: 'trg-escape-run',
      minDifficulty: 'standard',
    },
  ],

  // -------------------------------------------------------------------------
  // Pickups
  // -------------------------------------------------------------------------
  pickups: [
    {
      id: 'pickup-coherence-overlook',
      kind: 'coherence',
      position: { x: 5, y: 2.2, z: 6.5 },
      amount: 20,
    },
    {
      id: 'pickup-shard-steps',
      kind: 'resonance-shard',
      position: { x: 25.6, y: 1.9, z: -2.2 },
      amount: 3,
    },
    {
      id: 'pickup-coherence-plaza',
      kind: 'coherence',
      position: { x: 61.4, y: 3, z: 6 },
      amount: 25,
    },
    {
      id: 'pickup-shard-chasm-pillar',
      kind: 'resonance-shard',
      position: { x: 88.6, y: 3, z: 6.5 },
      amount: 4,
    },
    {
      id: 'pickup-shard-chord-run',
      kind: 'resonance-shard',
      position: { x: 91.8, y: 3.2, z: 1.8 },
      amount: 3,
    },
    {
      id: 'pickup-coherence-court',
      kind: 'coherence',
      position: { x: 114, y: 3, z: 8 },
      amount: 25,
    },
    {
      // SECRET 1 of 3 — the Keeper's vigil alcove, opened by the three-disc
      // sequence puzzle in the court.
      id: 'pickup-secret-keeper-memory',
      kind: 'keeper-memory',
      position: { x: 124.5, y: 10, z: -8 },
      isSecret: true,
    },
    {
      // SECRET 2 of 3 — on the ledge that only Resonance Sight makes solid.
      id: 'pickup-secret-lost-motif',
      kind: 'lost-motif',
      position: { x: 146, y: 6.6, z: -7 },
      isSecret: true,
    },
    {
      // SECRET 3 of 3 — Echo Form only, and Echo Form is not available on the
      // first visit. This is the stage's revisit hook.
      id: 'pickup-secret-echo-tablet',
      kind: 'geometry-tablet',
      position: { x: 121, y: 10.4, z: 7.5 },
      requiresForm: 'echo',
      isSecret: true,
    },
    {
      id: 'pickup-shard-hall',
      kind: 'resonance-shard',
      position: { x: 138, y: 3, z: -6 },
      amount: 5,
    },
    {
      id: 'pickup-capacitor-span',
      kind: 'frequency-capacitor',
      position: { x: 165, y: 1.8, z: 4 },
    },
    {
      id: 'pickup-coherence-arena-gate',
      kind: 'coherence',
      position: { x: 209, y: 1.8, z: 0 },
      amount: 30,
    },
    {
      id: 'pickup-signal-sample-guardian',
      kind: 'signal-sample',
      position: { x: 236, y: 1.8, z: 6 },
    },
    {
      id: 'pickup-sanctuary-seed-lattice',
      kind: 'sanctuary-seed',
      position: { x: 252, y: 2.8, z: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  // Resonators and puzzles
  // -------------------------------------------------------------------------
  resonators: [
    {
      // The core of the infected growth sealing the plaza's east arch. One
      // node, struck at the Root: this is the pulse tutorial's target.
      id: 'res-growth-core',
      position: { x: 73.4, y: 4, z: 0 },
      degree: 0,
      puzzleId: 'pz-infected-growth',
      order: 0,
    },
    {
      id: 'res-vigil-root',
      position: { x: 105, y: 4.8, z: 8.5 },
      degree: 0,
      puzzleId: 'pz-keeper-vigil',
      order: 0,
      holdSeconds: 3.5,
    },
    {
      id: 'res-vigil-fifth',
      position: { x: 114, y: 6.4, z: 0 },
      degree: 4,
      puzzleId: 'pz-keeper-vigil',
      order: 1,
      holdSeconds: 3.5,
    },
    {
      id: 'res-vigil-octave',
      position: { x: 123, y: 4.8, z: -8.5 },
      degree: 7,
      puzzleId: 'pz-keeper-vigil',
      order: 2,
      holdSeconds: 3.5,
    },
  ],

  puzzles: [
    {
      id: 'pz-infected-growth',
      kind: 'simultaneous',
      resonatorIds: ['res-growth-core'],
      reward: { kind: 'openDoor', doorId: 'door-infected-growth' },
      hint: 'The growth has one bright node at its heart. Put a pulse through it.',
    },
    {
      id: 'pz-keeper-vigil',
      kind: 'sequence',
      resonatorIds: ['res-vigil-root', 'res-vigil-fifth', 'res-vigil-octave'],
      reward: {
        kind: 'spawnPlatforms',
        platformIds: ['mp-vigil-step-01', 'mp-vigil-step-02'],
      },
      hint: 'Root, then Fifth, then Octave — the vigil the Keepers rang at dawn.',
    },
  ],

  // -------------------------------------------------------------------------
  // Doors
  // -------------------------------------------------------------------------
  doors: [
    {
      // The infected seal across the plaza's east arch. x 72.4 … 74.4,
      // y 1.8 … 5.0, z -3.5 … 3.5. Opened by `pz-infected-growth`.
      id: 'door-infected-growth',
      position: { x: 73.4, y: 3.4, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1, y: 1.6, z: 3.5 } },
      style: 'infected',
    },
    {
      // The gate to the lattice terrace. Releases when the Guardian's tone
      // comes back down to 432 — see `trg-guardian-cleansed`.
      id: 'door-lattice-gate',
      position: { x: 241, y: 3.2, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1, y: 2.6, z: 4 } },
      openedByFlag: 'sanctuary-guardian-cleansed',
      style: 'gold-trim',
    },
  ],

  // -------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------
  triggers: [
    // --- Awakening ---------------------------------------------------------
    {
      id: 'trg-cs-awakening',
      position: { x: -10, y: 1.4, z: 0 },
      shape: { kind: 'sphere', radius: 3.5 },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-awakening' },
    },
    {
      id: 'trg-tut-move',
      position: { x: -5.5, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.6, y: 2.4, z: 9.4 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-move' },
    },
    {
      id: 'trg-tut-camera',
      position: { x: -1, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.6, y: 2.4, z: 9.4 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-camera' },
    },
    {
      id: 'trg-objective-altar',
      position: { x: 2, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 2.4, z: 9.4 } },
      once: true,
      action: {
        kind: 'objective',
        text: 'Reach the inner altar before the Sanctuary loses the chord.',
      },
    },
    {
      // The opening vista: the camera lifts off the terrace and looks north-east
      // over the collapsing lower Sanctuary and its fallen dome.
      id: 'trg-vista-sanctuary',
      position: { x: 5, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 2.4, z: 9.4 } },
      once: true,
      action: { kind: 'vista', look: { x: 96, y: 14, z: -52 }, seconds: 5 },
    },
    {
      id: 'trg-cs-vista',
      position: { x: 5, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 2.4, z: 9.4 } },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-vista' },
    },
    {
      id: 'trg-tut-jump',
      position: { x: 8.6, y: 1.6, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.2, y: 2.4, z: 9.4 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-jump' },
    },

    // --- Double jump -------------------------------------------------------
    {
      id: 'trg-tut-double-jump',
      position: { x: 36, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 2, y: 3, z: 6 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-double-jump' },
    },
    {
      id: 'trg-objective-span',
      position: { x: 39, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1, y: 3, z: 6 } },
      once: true,
      action: { kind: 'objective', text: 'Cross to the reliquary plaza.' },
    },

    // --- The Auralith ------------------------------------------------------
    {
      id: 'trg-cs-auralith',
      position: { x: 55.5, y: 3.6, z: 0 },
      shape: { kind: 'sphere', radius: 3.5 },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-auralith' },
    },
    {
      id: 'trg-auralith-flag',
      position: { x: 55.5, y: 3.6, z: 0 },
      shape: { kind: 'sphere', radius: 3.5 },
      once: true,
      action: { kind: 'setFlag', flag: 'auralith-recovered' },
    },
    {
      id: 'trg-tut-fire',
      position: { x: 63, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 2, y: 3, z: 11 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-fire' },
    },
    {
      id: 'trg-objective-growth',
      position: { x: 66.5, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 3, z: 11 } },
      once: true,
      action: { kind: 'objective', text: 'Break the growth sealing the east arch.' },
    },

    // --- Chasm -------------------------------------------------------------
    {
      id: 'trg-objective-chasm',
      position: { x: 75.5, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1, y: 3, z: 6 } },
      once: true,
      action: {
        kind: 'objective',
        text: 'The chord platforms will not hold. Keep moving.',
      },
    },

    // --- First Detuners ----------------------------------------------------
    {
      id: 'trg-cs-detuners',
      position: { x: 105, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 3, z: 10 } },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-detuners' },
    },
    {
      id: 'trg-whisperer-wave',
      position: { x: 108, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 3, z: 10 } },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'spawn-whisperer-01',
          'spawn-whisperer-02',
          'spawn-whisperer-03',
          'spawn-drifter-court',
        ],
      },
    },

    // --- Resonance Sight and the Charged Chord -----------------------------
    {
      id: 'trg-tut-resonance-sight',
      position: { x: 130, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 2, y: 3, z: 9 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-resonance-sight' },
    },
    {
      id: 'trg-tut-charge',
      position: { x: 134, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 2, y: 3, z: 9 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-charge' },
    },
    {
      id: 'trg-charge-encounter',
      position: { x: 137.5, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 3, z: 9 } },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['spawn-fracture-warden', 'spawn-whisperer-04'],
      },
    },

    // --- The broken span ---------------------------------------------------
    {
      id: 'trg-tut-dash',
      position: { x: 147, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 3, z: 9 } },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-dash' },
    },
    {
      id: 'trg-objective-span-gap',
      position: { x: 149.2, y: 3, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 0.8, y: 3, z: 9 } },
      once: true,
      action: {
        kind: 'objective',
        text: 'The span is twelve metres gone. Jump, dash, then jump again.',
      },
    },

    // --- Escape ------------------------------------------------------------
    {
      // All three escape triggers sit in the safe pocket west of the wave's
      // rest volume (which begins at x 168.6), so entering the run is a choice.
      id: 'trg-cs-escape',
      position: { x: 165, y: 1.8, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1, y: 3, z: 8 } },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-escape' },
    },
    {
      id: 'trg-objective-escape',
      position: { x: 166.8, y: 1.8, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 0.8, y: 3, z: 8 } },
      once: true,
      action: { kind: 'objective', text: 'Outrun the wave. Do not let it reach you.' },
    },
    {
      id: 'trg-escape-run',
      position: { x: 167.6, y: 1.8, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 0.8, y: 3, z: 8 } },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['spawn-drifter-escape', 'spawn-amplifier-corridor'],
      },
    },

    // --- Guardian ----------------------------------------------------------
    {
      id: 'trg-cs-guardian',
      position: { x: 210, y: 2, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 4, z: 16 } },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-guardian' },
    },
    {
      id: 'trg-guardian-phase',
      position: { x: 213, y: 2, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 4, z: 16 } },
      once: true,
      action: { kind: 'phase', phase: 'miniboss' },
    },
    {
      id: 'trg-guardian-cleansed',
      position: { x: 236, y: 2, z: 0 },
      shape: { kind: 'sphere', radius: 4 },
      once: true,
      action: { kind: 'setFlag', flag: 'sanctuary-guardian-cleansed' },
    },

    // --- The World Lattice -------------------------------------------------
    {
      id: 'trg-cs-lattice',
      position: { x: 252, y: 2, z: 0 },
      shape: { kind: 'sphere', radius: 5 },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cs-lattice' },
    },
    {
      id: 'trg-lattice-flag',
      position: { x: 252, y: 2, z: 0 },
      shape: { kind: 'sphere', radius: 5 },
      once: true,
      action: { kind: 'setFlag', flag: 'world-lattice-online' },
    },
    {
      id: 'trg-lattice-phase',
      position: { x: 256, y: 2, z: 0 },
      shape: { kind: 'box', halfExtents: { x: 1.5, y: 4, z: 10 } },
      once: true,
      action: { kind: 'phase', phase: 'restoration' },
    },
  ],

  // -------------------------------------------------------------------------
  // Checkpoints — never more than one section of progress between two of them.
  // -------------------------------------------------------------------------
  checkpoints: [
    { id: 'cp-00-awakening', position: { x: -10, y: 1, z: 0 }, order: 0, yaw: 0 },
    // After the three single-jump steps.
    { id: 'cp-01-hymnal-terrace', position: { x: 36, y: 2.8, z: 0 }, order: 1, yaw: 0 },
    // After the double-jump crossing and the Auralith.
    { id: 'cp-02-reliquary-plaza', position: { x: 66, y: 2.8, z: 0 }, order: 2, yaw: 0 },
    // After the collapsing platforms — the stage's hardest platforming.
    { id: 'cp-03-antiphon-court', position: { x: 104.5, y: 2.8, z: 0 }, order: 3, yaw: 0 },
    // After the 12 m dash gap and inside the safe pocket, so a failed escape
    // run never respawns the player inside the wave.
    { id: 'cp-04-span-landing', position: { x: 163.5, y: 1.6, z: 0 }, order: 4, yaw: 0 },
    // Immediately before the Guardian.
    { id: 'cp-05-guardian-gate', position: { x: 208.5, y: 1.6, z: 0 }, order: 5, yaw: 0 },
    // Immediately after the Guardian.
    { id: 'cp-06-guardian-cleared', position: { x: 236, y: 1.6, z: 0 }, order: 6, yaw: 0 },
  ],

  // -------------------------------------------------------------------------
  // Cutscenes
  // -------------------------------------------------------------------------
  cutscenes: [
    {
      id: 'cs-awakening',
      cameraFocus: { x: -10, y: 1.6, z: 0 },
      cameraDistance: 4.5,
      skippable: true,
      lines: [
        {
          speaker: 'Keeper Ovel',
          text: 'Wake. Wake — the stone is singing the wrong note.',
          seconds: 3,
          emote: 'urgent',
        },
        {
          speaker: 'Tuner',
          text: "Everything's sharp. Like the whole room got nudged half a step sideways.",
          seconds: 3.4,
          emote: 'startled',
        },
        {
          speaker: 'Keeper Ovel',
          text: `Four hundred and thirty-two. That is the beat everything grew into — every root, every orbit, every heart in it.`,
          seconds: 4.2,
          emote: 'grave',
        },
        {
          speaker: 'Keeper Ovel',
          text: `Something reached in this morning and pushed us to four hundred and forty. Close enough to pass for music. Wrong enough to unmake a world.`,
          seconds: 5,
          emote: 'grave',
        },
      ],
    },
    {
      id: 'cs-vista',
      cameraFocus: { x: 96, y: 14, z: -52 },
      cameraDistance: 26,
      skippable: true,
      lines: [
        {
          speaker: 'Tuner',
          text: 'The lower terraces are lifting. Stone does not lift.',
          seconds: 3.2,
          emote: 'awed',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'It does, once it forgets what was holding it down.',
          seconds: 3,
          emote: 'grave',
        },
      ],
    },
    {
      id: 'cs-auralith',
      cameraFocus: { x: 55.5, y: 3.4, z: 0 },
      cameraDistance: 5,
      skippable: true,
      lines: [
        {
          speaker: 'Keeper Ovel',
          text: 'In the altar. My hands cannot hold it any more.',
          seconds: 3,
          emote: 'fading',
        },
        {
          speaker: 'Tuner',
          text: "A ring — strung across the middle. It's warm.",
          seconds: 3.2,
          emote: 'wonder',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'The Auralith. It listens first and answers second. Never the other way.',
          seconds: 4,
          emote: 'fading',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'Under all that noise there is still a true chord. Find it. Give it back.',
          seconds: 4.2,
          emote: 'fading',
        },
        {
          speaker: 'Tuner',
          text: 'I can hear it. Faint. Right underneath everything.',
          seconds: 3.4,
          emote: 'resolved',
        },
        {
          speaker: 'Keeper Ovel',
          text: "Then you're already a Tuner. Go.",
          seconds: 2.6,
          emote: 'fading',
        },
      ],
    },
    {
      id: 'cs-detuners',
      cameraFocus: { x: 116, y: 3.2, z: 0 },
      cameraDistance: 9,
      skippable: true,
      lines: [
        {
          speaker: 'Tuner',
          text: "Those aren't falling rocks. They're walking.",
          seconds: 3,
          emote: 'alert',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'Detuners. They do not conquer a world — they retune it, and wait for it to fall into their hands on its own.',
          seconds: 5,
          emote: 'grave',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'Nothing about this is weather, child. Every wrong note out there was placed.',
          seconds: 4,
          emote: 'grave',
        },
      ],
    },
    {
      id: 'cs-escape',
      cameraFocus: { x: 190, y: 4, z: 0 },
      cameraDistance: 14,
      skippable: true,
      lines: [
        {
          speaker: 'Keeper Ovel',
          text: 'Behind you — the pitch is climbing. That whole wall is four-forty now.',
          seconds: 3.8,
          emote: 'urgent',
        },
        {
          speaker: 'Tuner',
          text: 'Then I run faster than it spreads.',
          seconds: 2.4,
          emote: 'resolved',
        },
      ],
    },
    {
      id: 'cs-guardian',
      cameraFocus: { x: 223, y: 3, z: 0 },
      cameraDistance: 16,
      skippable: true,
      lines: [
        {
          speaker: 'Keeper Ovel',
          text: 'No. Not the Guardian. It has held this hill in tune since before the walls.',
          seconds: 4.2,
          emote: 'stricken',
        },
        {
          speaker: 'Tuner',
          text: 'Its core has gone violet.',
          seconds: 2.4,
          emote: 'alert',
        },
        {
          speaker: 'Keeper Ovel',
          text: "Then it isn't guarding any more — it's broadcasting. Do not break it, Tuner. Bring it down to pitch.",
          seconds: 5,
          emote: 'grave',
        },
      ],
    },
    {
      id: 'cs-lattice',
      cameraFocus: { x: 252, y: 16, z: 0 },
      cameraDistance: 22,
      skippable: true,
      lines: [
        {
          speaker: 'Keeper Ovel',
          text: 'There. The World Lattice — every region the Keepers ever tuned, still strung together like one instrument.',
          seconds: 5,
          emote: 'awed',
        },
        {
          speaker: 'Tuner',
          text: 'Eight of the lines are violet.',
          seconds: 2.6,
          emote: 'grim',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'Eight Commanders. Each of them carries a Frequency Core, and every Core holds a note they took from us.',
          seconds: 5,
          emote: 'grave',
        },
        {
          speaker: 'Keeper Ovel',
          text: 'Take a Core, and the Auralith learns to wear that note. That is how you get it all back.',
          seconds: 4.6,
          emote: 'grave',
        },
        { speaker: 'Tuner', text: 'Where do I start?', seconds: 2, emote: 'resolved' },
        {
          speaker: 'Keeper Ovel',
          text: "The Fractured Garden. It's nearest, and it's the loudest — you'll hear the wrong note long before you see the gate.",
          seconds: 5.2,
          emote: 'grave',
        },
      ],
    },
  ],

  // -------------------------------------------------------------------------
  // Tutorials
  // -------------------------------------------------------------------------
  tutorials: [
    {
      id: 'tut-move',
      title: 'Find your feet',
      body: 'Walk east along the terrace. The ground still holds here — it will not everywhere.',
      actions: ['move'],
      completesOn: 'move',
    },
    {
      id: 'tut-camera',
      title: 'Look around',
      body: 'Turn the view. A Tuner reads a place before crossing it, and this one has stopped being level.',
      actions: ['look', 'cameraRecenter'],
      completesOn: 'look',
    },
    {
      id: 'tut-jump',
      title: 'Jump',
      body: 'The processional steps have come apart. Hold the jump longer to rise higher; let go early to clip the arc short.',
      actions: ['jump'],
      completesOn: 'jump',
    },
    {
      id: 'tut-double-jump',
      title: 'Second beat',
      body: 'Press jump again at the top of the first. The Auralith gives you one more note of lift — nothing here is wider than two.',
      actions: ['jump'],
      completesOn: 'jump',
    },
    {
      id: 'tut-fire',
      title: 'Resonance Pulse',
      body: 'Tap to strike a pulse from the Auralith ring. It carries the true tone — infected matter cannot hold its shape around it.',
      actions: ['fire', 'lockOn'],
      completesOn: 'fire',
    },
    {
      id: 'tut-resonance-sight',
      title: 'Resonance Sight',
      body: 'Hold to listen instead of look. Anything the infection buried still rings underneath — sight draws what your ears already found.',
      actions: ['resonanceSight'],
      completesOn: 'resonanceSight',
    },
    {
      id: 'tut-charge',
      title: 'Charged Chord',
      body: 'Hold fire and let the ring gather. A single pulse skates off crystal armour; a full chord goes through it. Watch the ring for the tier.',
      actions: ['fire'],
      completesOn: 'fire',
    },
    {
      id: 'tut-dash',
      title: 'Dash',
      body: 'A flat, weightless burst — in the air it buys you distance a jump cannot, and on the ground it takes you out from under an attack.',
      actions: ['dash', 'jump'],
      completesOn: 'dash',
    },
  ],

  miniBossId: 'sanctuary-guardian',

  /**
   * A first clear at a steady pace: roughly 90 s of tutorial-paced traversal,
   * 60 s of platforming, 60 s across the two encounters, 40 s of escape run,
   * 60 s on the Guardian, plus the scenes. Anything under this ranks up.
   */
  parSeconds: 330,

  /** Matches the three pickups flagged `isSecret`. */
  secretTotal: 3,

  // -------------------------------------------------------------------------
  // Decorative props. Non-colliding — landmarks and silhouette work only.
  // -------------------------------------------------------------------------
  props: [
    { id: 'prop-keeper-statue-north', kind: 'keeper-statue', position: { x: -8, y: 0, z: 7 }, yaw: -1.2 },
    { id: 'prop-keeper-statue-south', kind: 'keeper-statue', position: { x: -8, y: 0, z: -7 }, yaw: 1.2 },
    { id: 'prop-sanctuary-bell-arch', kind: 'sanctuary-arch', position: { x: -13, y: 0, z: 0 }, scale: 1.6 },
    { id: 'prop-brazier-awakening-north', kind: 'harmonic-brazier', position: { x: -3, y: 0, z: 5 } },
    { id: 'prop-brazier-awakening-south', kind: 'harmonic-brazier', position: { x: -3, y: 0, z: -5 } },
    // The landmark the opening vista frames: the lower Sanctuary's dome, split
    // open and adrift, hanging over the valley.
    { id: 'prop-fallen-dome', kind: 'fallen-dome', position: { x: 96, y: 14, z: -52 }, scale: 7, yaw: 0.6 },
    { id: 'prop-drifting-terrace-01', kind: 'drifting-slab', position: { x: 60, y: 20, z: -40 }, scale: 3, yaw: 0.4 },
    { id: 'prop-drifting-terrace-02', kind: 'drifting-slab', position: { x: 130, y: 26, z: -58 }, scale: 4, yaw: -0.8 },
    { id: 'prop-broken-column-steps-01', kind: 'broken-column', position: { x: 20, y: 0, z: 6 }, scale: 1.2 },
    { id: 'prop-broken-column-steps-02', kind: 'broken-column', position: { x: 29, y: 0.9, z: -7 }, scale: 0.9 },
    { id: 'prop-plaza-ring-halo', kind: 'orbit-ring', position: { x: 55.5, y: 6.5, z: 0 }, scale: 2.4 },
    { id: 'prop-plaza-mandala', kind: 'floor-mandala', position: { x: 61.4, y: 1.81, z: 0 }, scale: 6 },
    { id: 'prop-infected-bloom-plaza', kind: 'infected-bloom', position: { x: 70, y: 1.8, z: 6.5 }, scale: 1.5 },
    { id: 'prop-infected-bloom-arch', kind: 'infected-bloom', position: { x: 73.4, y: 1.8, z: 0 }, scale: 2.2 },
    { id: 'prop-chasm-hanging-strings', kind: 'harmonic-string-curtain', position: { x: 88, y: 9, z: 0 }, scale: 5 },
    { id: 'prop-court-vigil-disc-frame', kind: 'vigil-frame', position: { x: 114, y: 6.4, z: 0 }, scale: 1.4 },
    { id: 'prop-court-rubble', kind: 'rubble-heap', position: { x: 109, y: 1.8, z: -8 }, scale: 1.3 },
    { id: 'prop-hall-banner-north', kind: 'keeper-banner', position: { x: 134, y: 4, z: 8.8 }, scale: 1.5 },
    { id: 'prop-hall-banner-south', kind: 'keeper-banner', position: { x: 134, y: 4, z: -8.8 }, scale: 1.5 },
    { id: 'prop-span-broken-edge', kind: 'shorn-span', position: { x: 150, y: 0.6, z: 0 }, scale: 2 },
    { id: 'prop-corridor-vent-frame-01', kind: 'vent-frame', position: { x: 180, y: 0.6, z: -2.5 } },
    { id: 'prop-corridor-vent-frame-02', kind: 'vent-frame', position: { x: 188, y: 0.6, z: 2.5 } },
    { id: 'prop-corridor-vent-frame-03', kind: 'vent-frame', position: { x: 196, y: 0.6, z: -2.5 } },
    { id: 'prop-guardian-sigil', kind: 'floor-mandala', position: { x: 223, y: 0.61, z: 0 }, scale: 9 },
    { id: 'prop-guardian-throne', kind: 'guardian-cradle', position: { x: 223, y: 0.6, z: 14 }, scale: 3 },
    { id: 'prop-lattice-pillar', kind: 'lattice-pillar', position: { x: 252, y: 1.6, z: 0 }, scale: 3.2 },
    { id: 'prop-lattice-halo-inner', kind: 'orbit-ring', position: { x: 252, y: 11, z: 0 }, scale: 5 },
    { id: 'prop-lattice-halo-outer', kind: 'orbit-ring', position: { x: 252, y: 15, z: 0 }, scale: 8, yaw: 0.7 },
  ],
};
