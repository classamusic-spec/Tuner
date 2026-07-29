import { PALETTE } from '@tuner/shared';
import type { Vec3 } from '@tuner/shared';
import type { StageDef } from '@tuner/game-core';

/**
 * **Stage 1 — The Fractured Garden.**
 *
 * A terraced water-garden built into a cliff by the Keepers: fallen resonator
 * rings the size of gatehouses, cascades stepping down through carved basins,
 * luminous roots strung between floating stones. The Detuners have grown an
 * Amplifier into the colossus that used to tend it, and the 440 Hz signal is
 * bleeding outward through the vegetation — violet crystal creeping over what
 * should read cyan and green. Restoring it is the stage.
 *
 * ---------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------
 *
 * The garden runs along −Z and loops laterally so the player crosses the same
 * air three times at three different heights. Roughly, in route order:
 *
 * | z            | y        | beat                                        |
 * | ------------ | -------- | ------------------------------------------- |
 * | `+10 … −14`  | `0`      | 1. Overlook — vista across to Oru's spire   |
 * | `−14 … −44`  | `0 … −2` | 2. Descending terraces, safe movement       |
 * | `−44 … −62`  | `−2.9`   | 3. Whisperer hollow — first contact         |
 * | `−62 … −92`  | `−2.9`   | 4a. Root-bridge chasm (sequence puzzle)     |
 * | `−96 … −84`  | `−2.9`   | 4b. Cascade basin + water lifts (x −44…−8)  |
 * | `−84 … −70`  | `13`     | 4c. Vine swings east across the canopy      |
 * | `−70 … −32`  | `14`     | 7. Optional side route → the Seed Vault     |
 * | `−84 … −103` | `12 … 7` | 5. Floating fragments + collapsing path     |
 * | `−100 … −116`| `0`      | 6. Combat plateau, then the Bloom gate      |
 * | `−88 … −128` | `0`      | 9. Virus Bloom arena (x 2…42)               |
 * | `−132 … −124`| `2 … 10` | 10. Rhythm-step canopy (post-mini-boss)     |
 * | `−128 … −184`| `10 … 19`| 11. High-intensity west flank               |
 * | `−186 … −200`| `14 … 0` | 12. Commander approach gallery              |
 * | `−134 … −186`| `0`      | 13–15. Oru, the Frequency Core, the walk home |
 *
 * ---------------------------------------------------------------------------
 * Movement budget every gap in this file was authored against
 * ---------------------------------------------------------------------------
 *
 * Player capsule 0.36 m radius, 1.6 m tall. Run 8.6 m/s. Gravity −32 m/s².
 *
 * - Jump apex **3.05 m** → launch speed `sqrt(2 · 32 · 3.05)` ≈ 13.97 m/s,
 *   0.437 s up, ~0.873 s of airtime, so a flat single-jump gap tops out near
 *   **7.5 m**.
 * - Double jump adds **2.5 m** from the apex → maximum rise **5.55 m** and
 *   ~1.42 s of airtime, so a flat double-jump gap tops out near **12.2 m**.
 * - Air dash: 24 m/s for 0.17 s covers 4.08 m where running would have covered
 *   1.46 m, a net **+2.62 m**. Ceiling for a committed double-jump-plus-dash
 *   crossing is therefore about **14.8 m**.
 *
 * Nothing on the critical path is authored above **9 m** horizontally or
 * **5.0 m** vertically. That leaves roughly a 35 % margin on the hardest jump
 * in the stage, which is what makes the platforming feel generous while still
 * requiring the whole kit. `FRACTURED_GARDEN_TRAVERSALS` lists the crossings
 * that carry the route, and the test file asserts every one of them.
 *
 * ---------------------------------------------------------------------------
 * Return value
 * ---------------------------------------------------------------------------
 *
 * Oru awards **Echo Form**. Three things in this stage are deliberately
 * impossible on the first visit and trivially possible on the second: the echo
 * puzzle in the cascade basin (three resonators too far apart to hold lit
 * without Echo), the luminous root line above the upper terrace, and the
 * canopy alcove they lead to. Two later forms — Ember and Tidal — each open one
 * more secret. Seven secrets total; four of them need something the player does
 * not have when they first walk in.
 */

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

/** Terse Vec3 literal — this file is mostly coordinates. */
function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * A crossing the route depends on, expressed as the two standing points a
 * player actually leaves from and lands on (top surfaces, not box centres).
 * `fractured-garden.test.ts` re-derives the movement budget from first
 * principles and asserts each of these fits inside it.
 */
export interface TraversalPair {
  readonly id: string;
  readonly from: Vec3;
  readonly to: Vec3;
  /** What the player is expected to spend to make it. */
  readonly technique: 'walk' | 'jump' | 'double-jump' | 'double-jump-dash' | 'drop';
  readonly note: string;
}

export const FRACTURED_GARDEN_TRAVERSALS: readonly TraversalPair[] = [
  {
    id: 'trv-terrace-to-canopy-pad',
    from: v(9, -1.2, -33),
    to: v(12, 3.8, -36),
    technique: 'double-jump',
    note: '5.0 m rise, 4.2 m out. The stage teaching the double jump with three resonance shards as the reward and a terrace to land back on if it is missed.',
  },
  {
    id: 'trv-bridgehead-to-west-ledge',
    from: v(-8, -2.9, -70),
    to: v(-14, -2.5, -72),
    technique: 'jump',
    note: 'Reaching the second sequence resonator. Flat 6.3 m — inside the 7.5 m single-jump range so the puzzle never costs a life.',
  },
  {
    id: 'trv-bridgehead-to-east-ledge',
    from: v(8, -2.9, -70),
    to: v(14, -1.7, -73),
    technique: 'jump',
    note: 'Third sequence resonator, mirrored across the chasm mouth. 6.7 m out, 1.2 m up.',
  },
  {
    id: 'trv-skip-stone-a',
    from: v(-8, -2.9, -90),
    to: v(-12, 2.1, -90),
    technique: 'double-jump',
    note: 'ALTERNATE ROUTE. First rung of the cascade face. 5.0 m rise is the ceiling of the double jump, and the landing pad is 3.2 m square — deliberately the hardest entry in the stage.',
  },
  {
    id: 'trv-skip-stone-b',
    from: v(-12, 2.1, -90),
    to: v(-14, 6.9, -86),
    technique: 'double-jump-dash',
    note: 'ALTERNATE ROUTE. 4.8 m rise, 4.5 m out — needs the air dash to convert forward momentum into reach at the top of the arc.',
  },
  {
    id: 'trv-skip-stone-c',
    from: v(-14, 6.9, -86),
    to: v(-10, 11.7, -82),
    technique: 'double-jump-dash',
    note: 'ALTERNATE ROUTE. Same shape again, 5.7 m out. Three in a row with no ground under them is the whole point.',
  },
  {
    id: 'trv-skip-to-canopy',
    from: v(-10, 11.7, -82),
    to: v(-4, 12.9, -80),
    technique: 'jump',
    note: 'ALTERNATE ROUTE exit onto the canopy terrace, skipping the water lifts and vine swings entirely — about 90 s saved, at the cost of the Seed Vault branch.',
  },
  {
    id: 'trv-terrace-to-vine-a',
    from: v(-30, 12.9, -77),
    to: v(-24, 13.35, -77),
    technique: 'jump',
    note: 'Boarding the first vine swing. 6.0 m flat; the vine orbits toward the player, so the real gap is shorter than the worst case asserted here.',
  },
  {
    id: 'trv-vine-a-to-vine-b',
    from: v(-24, 13.35, -77),
    to: v(-18, 13.35, -77),
    technique: 'jump',
    note: 'Vine to vine under Amplifier Pylon fire. Flat 6 m so the difficulty is entirely the timing and the incoming shots.',
  },
  {
    id: 'trv-vine-c-to-canopy',
    from: v(-12, 13.35, -77),
    to: v(-4, 12.9, -80),
    technique: 'double-jump',
    note: 'Last vine to the canopy terrace, 8.5 m out and slightly downhill — the one crossing in section 4 that wants the double jump.',
  },
  {
    id: 'trv-canopy-to-fragment-1',
    from: v(4, 12.9, -84),
    to: v(4, 11.4, -86),
    technique: 'jump',
    note: 'Stepping off the canopy onto the first drifting garden fragment. Short and downhill: the escalation is in what comes after it.',
  },
  {
    id: 'trv-plateau-to-ledge',
    from: v(-12, 0, -108),
    to: v(-12, 5, -108),
    technique: 'double-jump',
    note: 'Taking the high ground in the combat plateau. A flat 5.0 m rise — the pylons cannot depress their lenses that far, so the ledge is the answer to the crossfire.',
  },
  {
    id: 'trv-bloom-exit-to-rhythm-1',
    from: v(22, 2.5, -130),
    to: v(15, 3.35, -128),
    technique: 'jump',
    note: 'First rhythm step after the mini-boss. 7.3 m flat, at the bottom of the step cycle — early enough in the new mechanic that distance is never the question.',
  },
  {
    id: 'trv-highline-start-to-orbit-a',
    from: v(-26, 10, -128),
    to: v(-30, 12.35, -136),
    technique: 'double-jump',
    note: 'Entering the west flank. 8.9 m out and 2.35 m up, onto a platform that is orbiting toward the launch point at the moment the jump is offered.',
  },
  {
    id: 'trv-pier-a-to-collapse-1',
    from: v(-38, 14, -145),
    to: v(-40, 14.85, -150),
    technique: 'jump',
    note: 'First collapsing slab of the high-intensity run. 5.4 m out; the pressure is the 0.5 s fuse, not the distance.',
  },
  {
    id: 'trv-orbit-b-to-fragment',
    from: v(-32, 19.35, -180.5),
    to: v(-26, 12.4, -184),
    technique: 'drop',
    note: 'A committed 7 m fall onto a drifting fragment with the amplifier spire filling the frame. Nothing below it but the checkpoint on the shelf.',
  },
  {
    id: 'trv-fragment-to-approach-shelf',
    from: v(-20, 12.4, -184),
    to: v(-12, 6, -190),
    technique: 'drop',
    note: 'Last jump before the Commander approach: 10 m out, 6.4 m down, landing on the shelf that holds the final platforming checkpoint.',
  },
];

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export const FRACTURED_GARDEN: StageDef = {
  id: 'fractured-garden',
  displayName: 'The Fractured Garden',
  subtitle: 'Where the water forgot its note',
  description:
    'A Keeper water-garden terraced into a cliff, now half-swallowed by violet crystal. ' +
    'Cascades still run but they run flat; the roots that carried the chord between terraces ' +
    'have gone dark. Somewhere at the bottom of it, the colossus who tended this place is ' +
    'being made to sing at 440 Hz.',

  /** High but not total — the garden is losing, not lost. Drives the tint, the
   *  detuned drone under the music, and the HUD's coherence meter. */
  infection: 0.72,

  /** 108 BPM — 1.8 beats a second. Slow enough that a first-time player can
   *  count the rhythm hazards out loud, fast enough that the rhythm platforms
   *  keep the canopy section moving. */
  bpm: 108,

  spawnPoint: v(0, 0.4, 6),
  /** 0 faces down-stage, along −Z, straight at the amplifier spire. */
  spawnYaw: 0,

  /** Lowest authored surface is the cascade basin floor at y = −4.9; the
   *  mire at the bottom of the root-bridge chasm bottoms out at −18. */
  killPlaneY: -34,

  ambience: {
    /** Infected state: navy ground, a bruised violet sky, and fog close enough
     *  to hide the far terraces until the vista trigger pulls the camera up. */
    skyTop: PALETTE.abyss,
    skyBottom: PALETTE.infectionDeep,
    fogColour: PALETTE.infectionDeep,
    fogNear: 30,
    fogFar: 230,
    sunColour: PALETTE.infection,
    sunDirection: v(-0.34, -0.82, -0.46),
    ambientColour: PALETTE.panel,
    /**
     * Restored: the alien vines dissolve, the cascades run clear and audible,
     * the luminous roots reconnect terrace to terrace, wildlife comes back to
     * the canopy, and the sky clears far enough to show the constellations the
     * Keepers cut into the stonework. Same geometry, opposite mood — the
     * `onlyWhenRestored` / `hiddenWhenRestored` geometry below carries the rest.
     */
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
    // --- 1. Overlook -------------------------------------------------------
    // A flat plaza with a broken balustrade. Nothing to do here but look, which
    // is the point: the vista trigger frames the spire before the player has
    // any idea what it is.
    {
      id: 'geo-overlook-plaza',
      shape: { kind: 'box', halfExtents: v(16, 1, 12) },
      position: v(0, -1, -2),
      style: 'stone-carved',
    },
    {
      id: 'geo-overlook-balustrade-west',
      shape: { kind: 'box', halfExtents: v(0.5, 0.9, 12) },
      position: v(-15.5, 0.9, -2),
      style: 'gold-trim',
    },
    {
      id: 'geo-overlook-balustrade-east',
      shape: { kind: 'box', halfExtents: v(0.5, 0.9, 12) },
      position: v(15.5, 0.9, -2),
      style: 'gold-trim',
    },
    {
      id: 'geo-overlook-back-wall',
      shape: { kind: 'box', halfExtents: v(16, 3, 0.6) },
      position: v(0, 3, 9.4),
      style: 'stone-carved',
    },

    // --- 2. Descending terraces (safe movement) ----------------------------
    // Three contiguous slabs stepping down 0.7 m at a time. No gaps, no
    // hazards, no enemies: the only section in the stage where a player can
    // hold a direction and nothing happens to them.
    {
      id: 'geo-terrace-a',
      shape: { kind: 'box', halfExtents: v(10, 1, 5) },
      position: v(0, -1.5, -19),
      style: 'stone',
    },
    {
      id: 'geo-terrace-b',
      shape: { kind: 'box', halfExtents: v(9, 1, 5) },
      position: v(0, -2.2, -29),
      style: 'stone',
    },
    {
      id: 'geo-terrace-c',
      shape: { kind: 'box', halfExtents: v(9, 1, 5) },
      position: v(0, -2.9, -39),
      style: 'stone',
    },
    /** 1.2 m step up. Reachable by walking into it — teaches that the ledges
     *  hold shards before it teaches anything about jumping. */
    {
      id: 'geo-teach-pad-low',
      shape: { kind: 'box', halfExtents: v(2, 0.4, 2) },
      position: v(-6, -0.4, -27),
      style: 'stone',
    },
    /** 2.6 m: a single jump. */
    {
      id: 'geo-teach-pad-mid',
      shape: { kind: 'box', halfExtents: v(2, 0.4, 2) },
      position: v(6, 1, -31),
      style: 'stone',
    },
    /** 5.0 m above terrace-b: the double jump, unmissable and unpunished.
     *  See `trv-terrace-to-canopy-pad`. */
    {
      id: 'geo-teach-pad-canopy',
      shape: { kind: 'box', halfExtents: v(2.5, 0.4, 2.5) },
      position: v(12, 3.4, -36),
      style: 'root',
    },

    // --- 3. Whisperer hollow (first contact) -------------------------------
    // A sunken court with walls on both sides. Closed enough that the three
    // Whisperers cannot be outrun, small enough that they cannot surround.
    {
      id: 'geo-hollow-floor',
      shape: { kind: 'box', halfExtents: v(12, 1, 9) },
      position: v(0, -3.9, -53),
      style: 'stone',
    },
    {
      id: 'geo-hollow-wall-west',
      shape: { kind: 'box', halfExtents: v(1, 4, 9) },
      position: v(-13, 0.1, -53),
      style: 'stone-carved',
    },
    {
      id: 'geo-hollow-wall-east',
      shape: { kind: 'box', halfExtents: v(1, 4, 9) },
      position: v(13, 0.1, -53),
      style: 'stone-carved',
    },
    /** Secret #1. Resonance Sight picks the seam out of the wall; the ledge
     *  above it is a plain 2.4 m hop once you know it is there. */
    {
      id: 'geo-hollow-hidden-ledge',
      shape: { kind: 'box', halfExtents: v(3, 0.5, 2) },
      position: v(-9, -1, -59),
      style: 'stone-carved',
      revealedBy: 'base',
    },

    // --- 4a. Root-bridge chasm --------------------------------------------
    {
      id: 'geo-bridgehead-north',
      shape: { kind: 'box', halfExtents: v(8, 1, 4) },
      position: v(0, -3.9, -66),
      style: 'stone',
    },
    /** Ledges holding the second and third sequence resonators, out over the
     *  drop on either side, so solving the puzzle means committing to jumps
     *  above a chasm you have not bridged yet. */
    {
      id: 'geo-bridge-ledge-west',
      shape: { kind: 'box', halfExtents: v(2.5, 0.5, 2.5) },
      position: v(-14, -3, -72),
      style: 'stone-carved',
    },
    {
      id: 'geo-bridge-ledge-east',
      shape: { kind: 'box', halfExtents: v(2.5, 0.5, 2.5) },
      position: v(14, -2.2, -73),
      style: 'stone-carved',
    },
    /**
     * The root bridge itself: three deck segments, dormant until
     * `puz-root-bridge-sequence` resolves and its `spawnPlatforms` reward
     * brings them in. Each is 6 m of woven root, and together they span the
     * 18 m chasm from z −70 to −88 at the height of both banks, so the crossing
     * is flat once it exists and impossible before.
     */
    {
      id: 'geo-root-deck-1',
      shape: { kind: 'box', halfExtents: v(2.6, 0.35, 3) },
      position: v(0, -3.25, -73),
      style: 'root',
    },
    {
      id: 'geo-root-deck-2',
      shape: { kind: 'box', halfExtents: v(2.6, 0.35, 3) },
      position: v(0, -3.25, -79),
      style: 'root',
    },
    {
      id: 'geo-root-deck-3',
      shape: { kind: 'box', halfExtents: v(2.6, 0.35, 3) },
      position: v(0, -3.25, -85),
      style: 'root',
    },
    {
      id: 'geo-bridgehead-south',
      shape: { kind: 'box', halfExtents: v(8, 1, 2) },
      position: v(0, -3.9, -90),
      style: 'stone',
    },

    // --- ALTERNATE ROUTE: the cascade face ---------------------------------
    // Three unlit stones stacked up the waterfall, each exactly at the edge of
    // a double jump. A player who reads them can go bank → canopy terrace in
    // four jumps and skip the water lifts, the vine swings and the Seed Vault
    // branch. Roughly ninety seconds off the run, and the reason the route
    // splits here rather than anywhere with a reward on it.
    {
      id: 'geo-skip-stone-a',
      shape: { kind: 'box', halfExtents: v(1.6, 0.5, 1.6) },
      position: v(-12, 1.6, -90),
      style: 'stone',
    },
    {
      id: 'geo-skip-stone-b',
      shape: { kind: 'box', halfExtents: v(1.6, 0.5, 1.6) },
      position: v(-14, 6.4, -86),
      style: 'stone',
    },
    {
      id: 'geo-skip-stone-c',
      shape: { kind: 'box', halfExtents: v(1.8, 0.5, 1.8) },
      position: v(-10, 11.2, -82),
      style: 'stone',
    },

    // --- 4b. Cascade basin -------------------------------------------------
    // Wide, flat, waist-deep water at the foot of the great cascade. The three
    // echo resonators are spread across it (see `puz-cascade-echo`), which is
    // why it is the biggest open floor in the stage.
    {
      id: 'geo-basin-floor',
      shape: { kind: 'box', halfExtents: v(18, 1, 6) },
      position: v(-26, -3.9, -90),
      style: 'water',
      friction: 0.82,
    },
    {
      id: 'geo-basin-wall-north',
      shape: { kind: 'box', halfExtents: v(18, 5, 0.8) },
      position: v(-26, 1.1, -84.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-basin-wall-south',
      shape: { kind: 'box', halfExtents: v(18, 5, 0.8) },
      position: v(-26, 1.1, -95.2),
      style: 'stone-carved',
    },
    /** Behind the bramble wall the Ember Form burns away. Secret #7 sits on it. */
    {
      id: 'geo-ember-alcove',
      shape: { kind: 'box', halfExtents: v(3, 0.6, 2.4) },
      position: v(-38, -2.3, -80.5),
      style: 'stone-carved',
    },
    /** Ledge the water lifts hand off to on the way up. */
    {
      id: 'geo-cascade-ledge-mid',
      shape: { kind: 'box', halfExtents: v(3.5, 0.8, 3.5) },
      position: v(-45.5, 4.2, -96),
      style: 'stone',
    },
    /** Top of the cascade. Checkpoint, a wide safe shelf, and the mouth of both
     *  the vine swings and the optional Seed Vault route. */
    {
      id: 'geo-upper-terrace',
      shape: { kind: 'box', halfExtents: v(8, 1, 7) },
      position: v(-38, 11.9, -77),
      style: 'stone-carved',
    },

    // --- 4c. Vine-swing crossing ------------------------------------------
    // Two pylon pillars flank the crossing so the swings are taken under fire.
    {
      id: 'geo-pylon-pillar-west',
      shape: { kind: 'box', halfExtents: v(2, 8, 2) },
      position: v(-22, 6, -66),
      style: 'stone',
    },
    {
      id: 'geo-pylon-pillar-east',
      shape: { kind: 'box', halfExtents: v(2, 8, 2) },
      position: v(-14, 6, -88),
      style: 'stone',
    },
    {
      id: 'geo-canopy-terrace',
      shape: { kind: 'box', halfExtents: v(8, 1, 6) },
      position: v(4, 11.9, -78),
      style: 'root',
    },
    /** Landing pad for `rail-echo-canopy-line`. Unreachable without Echo Form:
     *  22 m up with nothing under it. Holds secret #4. */
    {
      id: 'geo-echo-alcove',
      shape: { kind: 'box', halfExtents: v(3, 0.6, 3) },
      position: v(-8, 21.4, -62),
      style: 'gold-trim',
    },

    // --- 7. Optional side route: the Seed Vault ----------------------------
    // Branches north-west off the upper terrace. Costs a rhythm-hazard walk and
    // a two-note sequence; pays a coherence fragment, two shards and the Ember
    // secret. Entirely skippable, and visibly so — the vault door is in frame
    // from the terrace.
    {
      id: 'geo-side-ledge',
      shape: { kind: 'box', halfExtents: v(2.5, 0.5, 2.5) },
      position: v(-53, 13.5, -73),
      style: 'stone',
    },
    {
      id: 'geo-side-walk',
      shape: { kind: 'box', halfExtents: v(2, 0.5, 9) },
      position: v(-53, 13.5, -62),
      style: 'stone',
    },
    {
      id: 'geo-side-vault-porch',
      shape: { kind: 'box', halfExtents: v(4, 1, 4) },
      position: v(-53, 13, -49),
      style: 'stone-carved',
    },
    {
      id: 'geo-side-vault-floor',
      shape: { kind: 'box', halfExtents: v(6, 1, 6) },
      position: v(-53, 13, -38),
      style: 'gold-trim',
    },

    // --- 5/6. Combat plateau and the Bloom gate ----------------------------
    {
      id: 'geo-collapse-anchor',
      shape: { kind: 'box', halfExtents: v(3, 0.8, 3) },
      position: v(-25, 7.2, -100),
      style: 'stone',
    },
    {
      id: 'geo-combat-plateau',
      shape: { kind: 'box', halfExtents: v(8, 1, 8) },
      position: v(-12, -1, -108),
      style: 'stone',
    },
    {
      id: 'geo-plateau-pillar-west',
      shape: { kind: 'box', halfExtents: v(1.5, 3, 1.5) },
      position: v(-17, 2, -103),
      style: 'stone',
    },
    {
      id: 'geo-plateau-pillar-east',
      shape: { kind: 'box', halfExtents: v(1.5, 3, 1.5) },
      position: v(-7, 2, -113),
      style: 'stone',
    },
    /** The answer to the plateau crossfire: a flat 5.0 m double jump onto high
     *  ground neither pylon can depress its lens far enough to cover. */
    {
      id: 'geo-plateau-ledge',
      shape: { kind: 'box', halfExtents: v(3, 0.6, 3) },
      position: v(-12, 4.4, -108),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-approach-causeway',
      shape: { kind: 'box', halfExtents: v(3, 1, 2.5) },
      position: v(-1, -1, -104),
      style: 'root',
    },

    // --- 9. Virus Bloom arena (mini-boss) ----------------------------------
    // A cracked seedbed 40 m across, sunk inside a 6 m rim so the fight reads
    // from the plateau above before the player drops in.
    {
      id: 'geo-bloom-arena-floor',
      shape: { kind: 'box', halfExtents: v(20, 1, 20) },
      position: v(22, -1, -108),
      style: 'infected',
    },
    {
      id: 'geo-bloom-rim-south',
      shape: { kind: 'box', halfExtents: v(21, 3, 1) },
      position: v(22, 3, -87),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-rim-north',
      shape: { kind: 'box', halfExtents: v(21, 3, 1) },
      position: v(22, 3, -129),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-rim-west',
      shape: { kind: 'box', halfExtents: v(1, 3, 21) },
      position: v(1, 3, -108),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-rim-east',
      shape: { kind: 'box', halfExtents: v(1, 3, 21) },
      position: v(43, 3, -108),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-exit-ramp',
      shape: { kind: 'ramp', halfExtents: v(3, 1, 5), slope: 0.3 },
      position: v(22, 0.4, -124),
      style: 'stone',
    },
    {
      id: 'geo-bloom-exit-landing',
      shape: { kind: 'box', halfExtents: v(4, 1, 3) },
      position: v(22, 1.5, -130),
      style: 'stone',
    },

    // --- 10. Rhythm-step canopy (post-mini-boss variation) -----------------
    {
      id: 'geo-canopy-arch-landing',
      shape: { kind: 'box', halfExtents: v(4, 1, 4) },
      position: v(-11, 9, -128),
      style: 'root',
    },

    // --- 11. High-intensity west flank -------------------------------------
    {
      id: 'geo-highline-start',
      shape: { kind: 'box', halfExtents: v(4, 1, 3) },
      position: v(-22, 9, -128),
      style: 'stone',
    },
    {
      id: 'geo-highline-pier-a',
      shape: { kind: 'box', halfExtents: v(3, 1, 3) },
      position: v(-38, 13, -142),
      style: 'stone',
    },
    {
      id: 'geo-highline-pier-b',
      shape: { kind: 'box', halfExtents: v(3.5, 1, 3.5) },
      position: v(-32, 18, -168),
      style: 'stone',
    },

    // --- 12. Commander approach gallery ------------------------------------
    // The corridor narrows and drops 14 m in four steps. Gold arches, no
    // enemies until the Conductor, and the spire finally overhead rather than
    // on the horizon.
    {
      id: 'geo-approach-shelf',
      shape: { kind: 'box', halfExtents: v(4, 1, 4) },
      position: v(-12, 5, -190),
      style: 'stone',
    },
    {
      id: 'geo-approach-step-a',
      shape: { kind: 'box', halfExtents: v(2, 0.8, 2) },
      position: v(-8, 3.2, -192),
      style: 'stone',
    },
    {
      id: 'geo-approach-step-b',
      shape: { kind: 'box', halfExtents: v(2, 0.8, 2) },
      position: v(-5, 1.4, -194),
      style: 'stone',
    },
    {
      id: 'geo-approach-gallery',
      shape: { kind: 'box', halfExtents: v(6, 1, 7) },
      position: v(-1, -1, -193),
      style: 'stone-carved',
    },
    {
      id: 'geo-gallery-wall-west',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 7) },
      position: v(-7.8, 5, -193),
      style: 'stone-carved',
    },
    {
      id: 'geo-gallery-wall-east',
      shape: { kind: 'box', halfExtents: v(0.8, 5, 7) },
      position: v(5.8, 5, -193),
      style: 'stone-carved',
    },

    // --- 13. Oru's arena ---------------------------------------------------
    // 52 m of terraced seedbed. Four low terraces the boss raises and drops in
    // phase 2; nothing in here is ever a spike, only ever a wall to move around.
    {
      id: 'geo-commander-floor',
      shape: { kind: 'box', halfExtents: v(26, 1, 26) },
      position: v(0, -1, -160),
      style: 'infected',
    },
    {
      id: 'geo-commander-rim-north',
      shape: { kind: 'box', halfExtents: v(27, 5, 1) },
      position: v(0, 5, -187),
      style: 'stone-carved',
    },
    {
      id: 'geo-commander-rim-south',
      shape: { kind: 'box', halfExtents: v(27, 5, 1) },
      position: v(0, 5, -133),
      style: 'stone-carved',
    },
    {
      id: 'geo-commander-rim-west',
      shape: { kind: 'box', halfExtents: v(1, 5, 27) },
      position: v(-27, 5, -160),
      style: 'stone-carved',
    },
    {
      id: 'geo-commander-rim-east',
      shape: { kind: 'box', halfExtents: v(1, 5, 27) },
      position: v(27, 5, -160),
      style: 'stone-carved',
    },
    {
      id: 'geo-arena-terrace-nw',
      shape: { kind: 'box', halfExtents: v(5, 0.5, 5) },
      position: v(-14, -0.5, -172),
      style: 'stone',
    },
    {
      id: 'geo-arena-terrace-ne',
      shape: { kind: 'box', halfExtents: v(5, 0.5, 5) },
      position: v(14, -0.5, -172),
      style: 'stone',
    },
    {
      id: 'geo-arena-terrace-sw',
      shape: { kind: 'box', halfExtents: v(5, 0.5, 5) },
      position: v(-14, -0.5, -148),
      style: 'stone',
    },
    {
      id: 'geo-arena-terrace-se',
      shape: { kind: 'box', halfExtents: v(5, 0.5, 5) },
      position: v(14, -0.5, -148),
      style: 'stone',
    },

    // --- Infection dressing that dies with the region ----------------------
    // Alien vine walls: solid while the garden is detuned, gone the moment the
    // Frequency Core is back. They also fence the arena approach so a player
    // cannot wander into Oru's ring from the west flank early.
    {
      id: 'geo-alien-vine-wall-west',
      shape: { kind: 'box', halfExtents: v(0.9, 4, 10) },
      position: v(-27.5, 3, -145),
      style: 'infected',
      hiddenWhenRestored: true,
    },
    {
      id: 'geo-alien-vine-wall-canopy',
      shape: { kind: 'box', halfExtents: v(6, 4, 0.9) },
      position: v(10, 4, -124),
      style: 'infected',
      hiddenWhenRestored: true,
    },

    // --- 14/15. Restoration geometry ---------------------------------------
    // Present only after the Frequency Core is recovered. The roots reconnect
    // terrace to terrace and the Keepers' stair back to the Harmonic Sanctuary
    // regrows out of the arena's south rim — the walk home is a different route
    // through the same garden, in daylight.
    {
      id: 'geo-restored-root-span',
      shape: { kind: 'box', halfExtents: v(3, 0.4, 14) },
      position: v(0, -0.6, -120),
      style: 'restored',
      onlyWhenRestored: true,
    },
    {
      id: 'geo-restored-sanctum-stair',
      shape: { kind: 'ramp', halfExtents: v(4, 1, 8), slope: 0.22 },
      position: v(0, 0.4, -112),
      style: 'restored',
      onlyWhenRestored: true,
    },
    {
      id: 'geo-restored-sanctum-landing',
      shape: { kind: 'box', halfExtents: v(6, 1, 5) },
      position: v(0, 2.4, -100),
      style: 'restored',
      onlyWhenRestored: true,
    },
  ],

  // SENTINEL_MOVING_PLATFORMS
};
