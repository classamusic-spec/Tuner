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
    to: v(4, 11.35, -86),
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
    /** The basin's north wall is authored in two pieces so a 6 m doorway is
     *  left at x −41 … −35. `haz-thornwall-shortcut` fills that doorway with
     *  infected bramble until Ember Form burns it out. */
    {
      id: 'geo-basin-wall-north-west',
      shape: { kind: 'box', halfExtents: v(1.5, 5, 0.8) },
      position: v(-42.5, 1.1, -84.8),
      style: 'stone-carved',
    },
    {
      id: 'geo-basin-wall-north-east',
      shape: { kind: 'box', halfExtents: v(13.5, 5, 0.8) },
      position: v(-21.5, 1.1, -84.8),
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
      position: v(-48, 7.2, -90),
      style: 'stone',
    },
    /** Dry chamber behind the great cascade. The torrent in front of it is not
     *  water any more — it falls at 440 Hz and it hits like it. Tidal Form
     *  stills it; secret #5 is inside. */
    {
      id: 'geo-cascade-grotto',
      shape: { kind: 'box', halfExtents: v(3, 0.6, 3) },
      position: v(-48, 7.4, -81),
      style: 'stone-carved',
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
    /** North rim, split to leave the 8 m exit the ramp climbs through. */
    {
      id: 'geo-bloom-rim-north-west',
      shape: { kind: 'box', halfExtents: v(8.5, 3, 1) },
      position: v(9.5, 3, -129),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-rim-north-east',
      shape: { kind: 'box', halfExtents: v(8.5, 3, 1) },
      position: v(34.5, 3, -129),
      style: 'stone-carved',
    },
    /** West rim, split to leave the gateway `door-bloom-gate` fills. */
    {
      id: 'geo-bloom-rim-west-north',
      shape: { kind: 'box', halfExtents: v(1, 3, 11) },
      position: v(1, 3, -118),
      style: 'stone-carved',
    },
    {
      id: 'geo-bloom-rim-west-south',
      shape: { kind: 'box', halfExtents: v(1, 3, 7) },
      position: v(1, 3, -94),
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
    /** North rim, split around the 8 m gateway the approach gallery enters
     *  through. `door-commander-seal` fills the gap until the corridor clears. */
    {
      id: 'geo-commander-rim-north-west',
      shape: { kind: 'box', halfExtents: v(11.5, 5, 1) },
      position: v(-15.5, 5, -187),
      style: 'stone-carved',
    },
    {
      id: 'geo-commander-rim-north-east',
      shape: { kind: 'box', halfExtents: v(11.5, 5, 1) },
      position: v(15.5, 5, -187),
      style: 'stone-carved',
    },
    /** South rim, split around the Keepers' gate. It is sealed shut by growth
     *  the entire fight; the restored root span grows out through it afterwards
     *  and becomes the walk home. */
    {
      id: 'geo-commander-rim-south-west',
      shape: { kind: 'box', halfExtents: v(11.5, 5, 1) },
      position: v(-15.5, 5, -133),
      style: 'stone-carved',
    },
    {
      id: 'geo-commander-rim-south-east',
      shape: { kind: 'box', halfExtents: v(11.5, 5, 1) },
      position: v(15.5, 5, -133),
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
      shape: { kind: 'box', halfExtents: v(3, 0.4, 10) },
      position: v(0, -0.6, -124),
      style: 'restored',
      onlyWhenRestored: true,
    },
    {
      id: 'geo-restored-sanctum-stair',
      shape: { kind: 'ramp', halfExtents: v(4, 1, 6), slope: 0.24 },
      position: v(0, 0.6, -108),
      style: 'restored',
      onlyWhenRestored: true,
    },
    {
      id: 'geo-restored-sanctum-landing',
      shape: { kind: 'box', halfExtents: v(6, 1, 5) },
      position: v(0, 2.4, -97),
      style: 'restored',
      onlyWhenRestored: true,
    },
  ],

  // -------------------------------------------------------------------------
  // Moving platforms — all five motion kinds, one mechanic each
  // -------------------------------------------------------------------------

  movingPlatforms: [
    // --- Water lifts: 'vertical' -------------------------------------------
    // Columns of cascade water the Keepers tuned to carry weight. They rise and
    // fall on a slow cycle; the player rides one, steps to a ledge, and takes
    // the second one up out of the basin. Staggered by half a cycle so there is
    // always one arriving.
    {
      id: 'plt-water-lift-a',
      shape: { kind: 'box', halfExtents: v(2.2, 0.35, 2.2) },
      position: v(-41, 2.6, -90),
      style: 'water',
      motion: { kind: 'vertical', amplitude: 5.5, seconds: 7 },
      /** Bottoms out level with the basin (top −2.55) and tops out at 8.45,
       *  0.45 m above `geo-cascade-ledge-mid`. */
    },
    {
      id: 'plt-water-lift-b',
      shape: { kind: 'box', halfExtents: v(2.2, 0.35, 2.2) },
      position: v(-50, 10.5, -82),
      style: 'water',
      motion: { kind: 'vertical', amplitude: 3, seconds: 5 },
      phase: 0.5,
      /** 7.85 → 13.85. Meets the mid ledge at the bottom and hands off to
       *  `geo-upper-terrace` (top 12.9) at the top, 1.8 m across. */
    },

    // --- Vine swings: 'orbit' ----------------------------------------------
    // Luminous roots hung from the canopy. Each platform swings a 4.5 m circle
    // about the point authored as `centre`, which is at platform height — seen
    // from the player's camera they sweep toward and away across the gap. Taken
    // under fire from two Amplifier Pylons, which is what makes the timing
    // matter rather than the distance.
    {
      id: 'plt-vine-swing-a',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(-28.5, 13, -77),
      style: 'root',
      motion: { kind: 'orbit', centre: v(-24, 13, -77), radius: 4.5, seconds: 4.2 },
    },
    {
      id: 'plt-vine-swing-b',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(-22.5, 13, -77),
      style: 'root',
      motion: { kind: 'orbit', centre: v(-18, 13, -77), radius: 4.5, seconds: 4.2 },
      phase: 0.33,
    },
    {
      id: 'plt-vine-swing-c',
      shape: { kind: 'box', halfExtents: v(1.6, 0.35, 1.6) },
      position: v(-16.5, 13, -77),
      style: 'root',
      motion: { kind: 'orbit', centre: v(-12, 13, -77), radius: 4.5, seconds: 4.2 },
      phase: 0.66,
    },

    // --- Floating garden fragments: 'linear' -------------------------------
    // Chunks of terrace that never fell. They drift on long slow lines, so the
    // player is always choosing between the short wait and the long jump. The
    // chain steps down 12.9 → 8.35 while turning west, which sets up the
    // collapsing path without a single loading seam.
    {
      id: 'plt-fragment-1',
      shape: { kind: 'box', halfExtents: v(2.2, 0.35, 2.2) },
      position: v(4, 11, -88),
      style: 'stone',
      motion: { kind: 'linear', to: v(-2, 11, -88), seconds: 6, pause: 1.2 },
    },
    {
      id: 'plt-fragment-2',
      shape: { kind: 'box', halfExtents: v(2.2, 0.35, 2.2) },
      position: v(-6, 9.5, -94),
      style: 'stone',
      motion: { kind: 'linear', to: v(-6, 9.5, -100), seconds: 7, pause: 1.2 },
      phase: 0.35,
    },
    {
      id: 'plt-fragment-3',
      shape: { kind: 'box', halfExtents: v(2.4, 0.35, 2.4) },
      position: v(-14, 8, -100),
      style: 'stone',
      motion: { kind: 'linear', to: v(-19, 8, -100), seconds: 8, pause: 1.4 },
      phase: 0.7,
    },

    // --- Collapsing stone path: 'collapse' ---------------------------------
    // The old terrace stair, holding on by habit. Half a second after weight
    // lands, it goes. Four slabs stepping 8.0 → 1.15 down to the combat
    // plateau; the fuse shortens as the drop shortens, so the section gets
    // faster exactly as the consequence of a mistake gets smaller.
    {
      id: 'plt-collapse-1',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-25, 6, -106),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.55, respawnSeconds: 4 },
    },
    {
      id: 'plt-collapse-2',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-22, 4.2, -110),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.5, respawnSeconds: 4 },
    },
    {
      id: 'plt-collapse-3',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-18, 2.4, -113),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.45, respawnSeconds: 4 },
    },
    {
      id: 'plt-collapse-4',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-14, 0.8, -115),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.45, respawnSeconds: 4 },
    },

    // --- Rhythm steps: 'rhythm' (the post-mini-boss variation) -------------
    // Same root bridges as section 4, except these ones no longer wait to be
    // asked: cleansing the Virus Bloom woke the canopy roots and now they move
    // on the region's beat, 3.5 m up and back every two beats at 108 BPM
    // (1.11 s a step). The mechanic the player learned as "solve, then cross"
    // becomes "read, then cross", and the quarter-cycle phase offsets mean the
    // whole run can be taken in one unbroken line if the player finds the beat.
    {
      id: 'plt-rhythm-1',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(15, 3, -128),
      style: 'root',
      motion: { kind: 'rhythm', to: v(15, 6.5, -128), beats: 2 },
    },
    {
      id: 'plt-rhythm-2',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(9, 4.5, -128),
      style: 'root',
      motion: { kind: 'rhythm', to: v(9, 8, -128), beats: 2 },
      phase: 0.25,
    },
    {
      id: 'plt-rhythm-3',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(3, 6, -128),
      style: 'root',
      motion: { kind: 'rhythm', to: v(3, 9.5, -128), beats: 2 },
      phase: 0.5,
    },
    {
      id: 'plt-rhythm-4',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(-3, 7.5, -128),
      style: 'root',
      motion: { kind: 'rhythm', to: v(-3, 11, -128), beats: 2 },
      phase: 0.75,
    },

    // --- West flank, high intensity ----------------------------------------
    // Everything the stage has taught, stacked, at 19 m with the Commander's
    // spire filling the sky. Orbit → pier → three collapses → pier → orbit →
    // a committed fall onto a drifting fragment.
    {
      id: 'plt-orbit-highline-a',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(-26, 12, -136),
      style: 'root',
      motion: { kind: 'orbit', centre: v(-30, 12, -136), radius: 4, seconds: 5 },
    },
    {
      id: 'plt-collapse-highline-1',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-40, 14.5, -150),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.5, respawnSeconds: 4 },
    },
    {
      id: 'plt-collapse-highline-2',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-38, 16, -156),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.45, respawnSeconds: 4 },
    },
    {
      id: 'plt-collapse-highline-3',
      shape: { kind: 'box', halfExtents: v(2, 0.35, 2) },
      position: v(-34, 17.5, -161),
      style: 'stone',
      motion: { kind: 'collapse', delaySeconds: 0.45, respawnSeconds: 4 },
    },
    {
      id: 'plt-orbit-highline-b',
      shape: { kind: 'box', halfExtents: v(1.8, 0.35, 1.8) },
      position: v(-32, 19, -171.5),
      style: 'root',
      motion: { kind: 'orbit', centre: v(-32, 19, -176), radius: 4.5, seconds: 5.5 },
      phase: 0.4,
    },
    {
      id: 'plt-fragment-highline-1',
      shape: { kind: 'box', halfExtents: v(2.2, 0.4, 2.2) },
      position: v(-26, 12, -184),
      style: 'stone',
      motion: { kind: 'linear', to: v(-20, 12, -184), seconds: 7, pause: 1.5 },
    },
  ],

  // -------------------------------------------------------------------------
  // Rails — luminous roots run as grindable resonance lines
  // -------------------------------------------------------------------------

  rails: [
    /**
     * The Garden's main artery: a single root, thick as a person, that used to
     * carry the chord from the canopy down to the seedbeds. It still runs, and
     * it still runs downhill — grinding it takes the player from the canopy
     * terrace to the combat plateau in about four seconds, bypassing the
     * fragment chain and the collapsing path entirely. It is the second half of
     * the alternate fast route, and it is in plain sight the whole time.
     */
    {
      id: 'rail-luminous-root-descent',
      points: [
        v(12, 12.9, -80),
        v(8, 10, -90),
        v(0, 6.5, -100),
        v(-6, 2.5, -106),
        v(-11, 0.4, -110),
      ],
      speed: 17,
      style: 'root',
    },
    /**
     * A dead root above the upper terrace, hanging in three broken lengths. It
     * cannot be grinded at all until Echo Form holds a note in it long enough
     * for the breaks to bridge — which is to say, not until after Oru. It ends
     * at `geo-echo-alcove`, 22 m up, where a Keeper left a memory behind.
     */
    {
      id: 'rail-echo-canopy-line',
      points: [v(-30, 13.2, -77), v(-22, 17, -70), v(-14, 20, -65), v(-8, 22, -62)],
      speed: 15,
      requiresForm: 'echo',
      style: 'crystal',
    },
  ],

  // -------------------------------------------------------------------------
  // Hazards
  // -------------------------------------------------------------------------

  hazards: [
    /** The bottom of the root-bridge chasm: standing infection, ankle deep and
     *  rising. Not a damage trap — it puts the player back on the bank, which
     *  is the right cost for failing a bridge you have not built yet. */
    {
      id: 'haz-chasm-mire',
      shape: { kind: 'box', halfExtents: v(20, 2, 9) },
      position: v(0, -16, -79),
      damage: 0,
      damageKind: 'hazard',
      style: 'infected',
      isPit: true,
    },

    /**
     * Side route, rhythm gauntlet. Three spore vents in the wall of the walk,
     * cut at 108 BPM: four beats of cycle, two of them venting, offsets 0 / 2 /
     * 1. Read left to right that is a rolling wave the player walks *with*
     * rather than sprints through — the first thing in the stage that asks for
     * tempo instead of reflex, and it is on the optional route on purpose.
     */
    {
      id: 'haz-spore-vent-1',
      shape: { kind: 'box', halfExtents: v(1.8, 2.5, 1.2) },
      position: v(-53, 16.5, -67),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 0 },
      style: 'infected',
    },
    {
      id: 'haz-spore-vent-2',
      shape: { kind: 'box', halfExtents: v(1.8, 2.5, 1.2) },
      position: v(-53, 16.5, -62),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 2 },
      style: 'infected',
    },
    {
      id: 'haz-spore-vent-3',
      shape: { kind: 'box', halfExtents: v(1.8, 2.5, 1.2) },
      position: v(-53, 16.5, -57),
      damage: 12,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 1 },
      style: 'infected',
    },

    /**
     * A thorn lash between the second and third rhythm steps, on the off-beat
     * of the platforms themselves: the steps rise on beats 0 and 2, this fires
     * on beat 2 of 4. Cross on the platform's beat and it is never there.
     */
    {
      id: 'haz-canopy-thorn-rhythm',
      shape: { kind: 'box', halfExtents: v(1.2, 3, 1.2) },
      position: v(6, 7, -128),
      damage: 14,
      damageKind: 'hazard',
      rhythm: { beats: 4, activeBeats: 2, offset: 2 },
      style: 'infected',
    },

    /** Combat plateau: a slow pollen bloom on an eight-beat cycle across the
     *  centre of the arena, so the pylons and the Fracture have somewhere to
     *  push the player toward, and the player has a reason to take the ledge. */
    {
      id: 'haz-plateau-pollen-vent',
      shape: { kind: 'box', halfExtents: v(3, 2, 3) },
      position: v(-12, 1, -100),
      damage: 10,
      damageKind: 'hazard',
      rhythm: { beats: 8, activeBeats: 3, offset: 0 },
      style: 'infected',
    },

    /**
     * SHORTCUT GATE #1 — Ember. A wall of infected bramble grown across the 6 m
     * doorway in the basin's north wall. It burns out permanently under Ember
     * Form, opening the alcove behind it and a straight run along the north
     * bank that skips the lower half of the basin on a replay.
     */
    {
      id: 'haz-thornwall-shortcut',
      shape: { kind: 'box', halfExtents: v(3, 3, 0.5) },
      position: v(-38, -0.9, -84.8),
      damage: 16,
      damageKind: 'hazard',
      clearedBy: 'ember',
      style: 'infected',
    },

    /**
     * SHORTCUT GATE #2 — Tidal. The great cascade stopped being water when the
     * region detuned; it falls at 440 Hz and it hits like falling stone. Tidal
     * Form retunes the column and it parts, opening `geo-cascade-grotto` and a
     * direct line from the mid ledge to the upper terrace.
     */
    {
      id: 'haz-cascade-torrent',
      shape: { kind: 'box', halfExtents: v(3, 2.5, 0.6) },
      position: v(-48, 9.5, -85),
      damage: 18,
      damageKind: 'hazard',
      clearedBy: 'tidal',
      style: 'infected',
    },
  ],

  // -------------------------------------------------------------------------
  // Enemies
  //
  // Nothing here is scattered. Every cluster is placed to do one job: pressure
  // a specific movement, teach a specific verb, close a specific route, or sit
  // on something worth taking.
  // -------------------------------------------------------------------------

  enemies: [
    /**
     * CLUSTER A — the hollow. First Detuners the player ever sees, in a walled
     * court with no gaps to fall down and no ranged enemies. Two patrol across
     * each other so the player learns Whisperers stop and *listen* before they
     * lunge; the third holds the back of the room on Standard and above and is
     * sitting on the hidden ledge's sight-line, which is how the secret gets
     * noticed at all.
     */
    {
      id: 'enm-whisperer-hollow-a',
      archetype: 'whisperer',
      position: v(-6, -2.9, -50),
      patrol: [v(-6, -2.9, -50), v(-6, -2.9, -58)],
      triggerId: 'trg-first-contact',
    },
    {
      id: 'enm-whisperer-hollow-b',
      archetype: 'whisperer',
      position: v(6, -2.9, -56),
      patrol: [v(6, -2.9, -56), v(6, -2.9, -48)],
      triggerId: 'trg-first-contact',
    },
    {
      id: 'enm-whisperer-hollow-c',
      archetype: 'whisperer',
      position: v(-9, -2.9, -60),
      triggerId: 'trg-first-contact',
      minDifficulty: 'standard',
      guardsSecret: 'pick-secret-shard-cache',
    },

    /**
     * CLUSTER B — the chasm mouth. Two Spore Drifters hover *over the gap*, not
     * over the bank: their bolts are counterable and slow, so the lesson is
     * that the safe place to fight them is standing still on solid ground
     * before the bridge exists. The Root Fracture is visible across the chasm
     * from the moment the player arrives — armour facing them, immobile — so
     * the fight is announced a full puzzle in advance.
     */
    {
      id: 'enm-drifter-chasm-a',
      archetype: 'spore-drifter',
      position: v(-5, 1, -74),
      patrol: [v(-5, 1, -74), v(5, 1, -80)],
      triggerId: 'trg-chasm-ambush',
    },
    {
      id: 'enm-drifter-chasm-b',
      archetype: 'spore-drifter',
      position: v(6, 1.5, -82),
      patrol: [v(6, 1.5, -82), v(-6, 1.5, -84)],
      triggerId: 'trg-chasm-ambush',
    },
    {
      id: 'enm-fracture-bridgehead',
      archetype: 'root-fracture',
      position: v(2, -2.9, -90),
      yaw: 0,
    },

    /**
     * CLUSTER C — the cascade basin. The Guardian is not hunting: it stands
     * between the player and the seedbed plinth and refuses to move, which is
     * exactly what a Garden protector would do. It is `cleansable`, it is the
     * first thing in the game the player is asked *not* to kill, and it is
     * sitting on the signal sample. The two Dissonance Blooms flank the open
     * water so the fight cannot be taken from a single safe angle.
     */
    {
      id: 'enm-guardian-seedbed',
      archetype: 'infected-garden-guardian',
      position: v(-30, -2.9, -90),
      yaw: 1.5708,
      triggerId: 'trg-basin-guard',
      guardsSecret: 'pick-secret-signal-sample',
    },
    {
      id: 'enm-bloom-basin-north',
      archetype: 'dissonance-bloom',
      position: v(-18, -2.9, -87),
      triggerId: 'trg-basin-guard',
    },
    {
      id: 'enm-bloom-basin-south',
      archetype: 'dissonance-bloom',
      position: v(-34, -2.9, -93),
      triggerId: 'trg-basin-guard',
      minDifficulty: 'explorer',
    },

    /**
     * CLUSTER D — the vine crossing. Two Amplifier Pylons bolted to pillars on
     * opposite sides of the gap, 22 m apart, both in range of every swing. They
     * cannot be reached from the vines and they cannot be outrun; their shots
     * *can* be countered. This is the stage's thesis statement — the platform
     * timing and the combat timing are the same timing.
     */
    {
      id: 'enm-pylon-vineway-west',
      archetype: 'amplifier-pylon',
      position: v(-22, 15, -66),
      yaw: 2.6,
      triggerId: 'trg-vineway-fire',
    },
    {
      id: 'enm-pylon-vineway-east',
      archetype: 'amplifier-pylon',
      position: v(-14, 15, -88),
      yaw: -0.5,
      triggerId: 'trg-vineway-fire',
    },
    {
      id: 'enm-drifter-vineway',
      archetype: 'spore-drifter',
      position: v(-18, 16, -77),
      patrol: [v(-18, 16, -77), v(-26, 16, -77)],
      triggerId: 'trg-vineway-fire',
      minDifficulty: 'standard',
    },

    /**
     * CLUSTER E — the Seed Vault branch. Bramble Hounds are infected wildlife,
     * not invaders: they charge down the narrow walk between spore vents, so
     * the player is solving the rhythm hazard and the pursuer at once, and
     * cleansing them turns the walk quiet. The False Shard sits on the vault
     * plinth wearing the coherence fragment's silhouette — the one time this
     * stage lies to the player, and it lies on the optional route.
     */
    {
      id: 'enm-hound-side-a',
      archetype: 'bramble-hound',
      position: v(-53, 14.2, -58),
      triggerId: 'trg-vault-guard',
    },
    {
      id: 'enm-hound-side-b',
      archetype: 'bramble-hound',
      position: v(-53, 14.2, -53),
      triggerId: 'trg-vault-guard',
      minDifficulty: 'standard',
    },
    {
      id: 'enm-false-shard-vault',
      archetype: 'false-shard',
      position: v(-50, 14.2, -38),
      guardsSecret: 'pick-secret-coherence-grotto',
    },

    /**
     * CLUSTER F — the floating fragments. Drifting Mines strung along the line
     * the fragments travel, so the correct play is to shoot them from the
     * previous platform and detonate the corridor before entering it. Ordering,
     * not reflexes.
     */
    {
      id: 'enm-mine-fragment-a',
      archetype: 'drifting-mine',
      position: v(1, 11.5, -88),
      patrol: [v(1, 11.5, -88), v(-3, 11.5, -92)],
      triggerId: 'trg-fragment-mines',
    },
    {
      id: 'enm-mine-fragment-b',
      archetype: 'drifting-mine',
      position: v(-6, 10, -97),
      patrol: [v(-6, 10, -97), v(-10, 10, -101)],
      triggerId: 'trg-fragment-mines',
    },
    {
      id: 'enm-mine-fragment-c',
      archetype: 'drifting-mine',
      position: v(-17, 8.5, -102),
      triggerId: 'trg-fragment-mines',
      minDifficulty: 'standard',
    },

    /**
     * CLUSTER G — the collapsing path. One Whisperer on the anchor stone at the
     * top, one Drifter hovering beside the descent. Deliberately light: the
     * platforms are already a timer, and stacking a real fight on a 0.45 s fuse
     * would be punishing rather than exciting. The Drifter exists so the player
     * cannot stop and wait for a slab to respawn in peace.
     */
    {
      id: 'enm-whisperer-collapse-a',
      archetype: 'whisperer',
      position: v(-25, 8, -100),
      patrol: [v(-25, 8, -100), v(-27, 8, -98)],
    },
    {
      id: 'enm-drifter-collapse-b',
      archetype: 'spore-drifter',
      position: v(-20, 7, -107),
      patrol: [v(-20, 7, -107), v(-17, 5, -112)],
    },

    /**
     * CLUSTER H — the combat plateau, the stage's full combat-platforming
     * combination. Two Pylons on pillars set on a diagonal so their fire
     * crosses the middle of the arena, a Root Fracture holding the centre with
     * its plate toward the entrance, and a pollen vent breathing on an
     * eight-beat cycle through the same ground. The answer is
     * `geo-plateau-ledge` — a flat 5 m double jump onto high ground the pylons
     * cannot depress their lenses to reach — and every element here exists to
     * point at it. The Chorus Seed above is Resonance Master only: it takes the
     * ledge away again.
     */
    {
      id: 'enm-pylon-plateau-west',
      archetype: 'amplifier-pylon',
      position: v(-17, 5.7, -103),
      yaw: -0.8,
      triggerId: 'trg-plateau-battle',
    },
    {
      id: 'enm-pylon-plateau-east',
      archetype: 'amplifier-pylon',
      position: v(-7, 5.7, -113),
      yaw: 2.3,
      triggerId: 'trg-plateau-battle',
    },
    {
      id: 'enm-fracture-plateau',
      archetype: 'root-fracture',
      position: v(-12, 0.2, -105),
      yaw: 3.1416,
      triggerId: 'trg-plateau-battle',
    },
    {
      id: 'enm-drifter-plateau-a',
      archetype: 'spore-drifter',
      position: v(-16, 3, -112),
      patrol: [v(-16, 3, -112), v(-8, 3, -112)],
      triggerId: 'trg-plateau-battle',
    },
    {
      id: 'enm-drifter-plateau-b',
      archetype: 'spore-drifter',
      position: v(-8, 3, -102),
      patrol: [v(-8, 3, -102), v(-16, 3, -102)],
      triggerId: 'trg-plateau-battle',
      minDifficulty: 'standard',
    },
    {
      id: 'enm-chorus-seed-plateau',
      archetype: 'chorus-seed',
      position: v(-12, 8, -112),
      triggerId: 'trg-plateau-battle',
      minDifficulty: 'resonance-master',
    },

    /**
     * CLUSTER I — the rhythm canopy. Thorn Pursuers, and only Thorn Pursuers,
     * because they run faster than the player and the platforms only rise every
     * two beats: the section forces the dash and the beat into the same
     * decision. One on each end so there is no safe direction to retreat in.
     */
    {
      id: 'enm-pursuer-canopy-a',
      archetype: 'thorn-pursuer',
      position: v(22, 2.7, -130),
      triggerId: 'trg-canopy-pressure',
    },
    {
      id: 'enm-pursuer-canopy-b',
      archetype: 'thorn-pursuer',
      position: v(-11, 10.2, -128),
      triggerId: 'trg-canopy-pressure',
      minDifficulty: 'standard',
    },

    /**
     * CLUSTER J — the west flank at 19 m. Mines on the collapsing slabs (shoot
     * them from the pier before committing) and Drifters over the orbit
     * platforms, where a counter is the only shot with time to spare. Nothing
     * with contact damage that chases: at this height a shove is already the
     * worst thing that can happen.
     */
    {
      id: 'enm-mine-highline-a',
      archetype: 'drifting-mine',
      position: v(-38, 15, -147),
      patrol: [v(-38, 15, -147), v(-40, 15, -152)],
      triggerId: 'trg-highline-pressure',
    },
    {
      id: 'enm-mine-highline-b',
      archetype: 'drifting-mine',
      position: v(-36, 17, -158),
      patrol: [v(-36, 17, -158), v(-34, 18, -162)],
      triggerId: 'trg-highline-pressure',
    },
    {
      id: 'enm-drifter-highline-a',
      archetype: 'spore-drifter',
      position: v(-28, 20, -170),
      patrol: [v(-28, 20, -170), v(-36, 20, -176)],
      triggerId: 'trg-highline-pressure',
    },
    {
      id: 'enm-drifter-highline-b',
      archetype: 'spore-drifter',
      position: v(-26, 15, -181),
      patrol: [v(-26, 15, -181), v(-20, 15, -185)],
      triggerId: 'trg-highline-pressure',
      minDifficulty: 'standard',
    },

    /**
     * CLUSTER K — the approach gallery. A single Conductor, alone, in a corridor
     * with walls on both sides and the spire overhead. It summons Whisperers
     * rather than fighting, which drags the fight out just long enough for the
     * player to hear what Oru sounds like through the wall before they meet
     * him. The two Whisperers are pre-placed so the corridor is never empty.
     */
    {
      id: 'enm-conductor-approach',
      archetype: 'conductor-elite',
      position: v(-1, 0.4, -197),
      yaw: 0,
      triggerId: 'trg-approach-conductor',
    },
    {
      id: 'enm-whisperer-approach-a',
      archetype: 'whisperer',
      position: v(-4, 0.4, -199),
      triggerId: 'trg-approach-conductor',
    },
    {
      id: 'enm-whisperer-approach-b',
      archetype: 'whisperer',
      position: v(2, 0.4, -199),
      triggerId: 'trg-approach-conductor',
    },
  ],

  // -------------------------------------------------------------------------
  // Pickups
  //
  // Seven secrets. Four of them cannot be taken on a first run: two need Echo
  // Form (Oru's award), one needs Tidal, one needs Ember.
  // -------------------------------------------------------------------------

  pickups: [
    // Section 2 — shards laid along the teaching pads, so the reward for the
    // first double jump arrives in the same second as the double jump.
    { id: 'pick-shard-terrace-low', kind: 'resonance-shard', amount: 5, position: v(-6, 0.4, -27) },
    { id: 'pick-shard-terrace-mid', kind: 'resonance-shard', amount: 5, position: v(6, 1.8, -31) },
    {
      id: 'pick-shard-terrace-high',
      kind: 'resonance-shard',
      amount: 12,
      position: v(12, 4.2, -36),
    },

    // Section 3 — the hollow.
    { id: 'pick-shard-hollow-a', kind: 'resonance-shard', amount: 5, position: v(-4, -2.4, -50) },
    { id: 'pick-shard-hollow-b', kind: 'resonance-shard', amount: 5, position: v(4, -2.4, -57) },
    /** SECRET 1 of 7 — no form needed, only Resonance Sight and the curiosity
     *  to point it at a wall. The stage's promise that looking pays. */
    {
      id: 'pick-secret-shard-cache',
      kind: 'resonance-shard',
      amount: 25,
      position: v(-9, -0.2, -59),
      isSecret: true,
    },

    // Section 4 — chasm and basin.
    {
      id: 'pick-shard-bridge-west',
      kind: 'resonance-shard',
      amount: 5,
      position: v(-14, -2.1, -72),
    },
    {
      id: 'pick-shard-bridge-east',
      kind: 'resonance-shard',
      amount: 5,
      position: v(14, -1.3, -73),
    },
    {
      id: 'pick-coherence-basin',
      kind: 'coherence-fragment',
      position: v(-14, -2.4, -92),
    },
    /** SECRET 2 of 7 — Ember. Burn the thornwall out of the north doorway and
     *  the alcove behind it still has a seed in it, dormant and alive. */
    {
      id: 'pick-secret-sanctuary-seed',
      kind: 'sanctuary-seed',
      position: v(-38, -1.4, -80.5),
      requiresForm: 'ember',
      isSecret: true,
    },
    /** SECRET 3 of 7 — Tidal. Behind the 440 Hz cascade. */
    {
      id: 'pick-secret-geometry-tablet',
      kind: 'geometry-tablet',
      position: v(-48, 8.3, -81),
      requiresForm: 'tidal',
      isSecret: true,
    },
    /** SECRET 4 of 7 — Echo. Revealed by `puz-cascade-echo`, which cannot be
     *  solved without a form that holds a struck note lit. */
    {
      id: 'pick-secret-lost-motif',
      kind: 'lost-motif',
      position: v(-26, -2.3, -90),
      requiresForm: 'echo',
      isSecret: true,
    },
    /** SECRET 5 of 7 — the Guardian's plinth. Cleansing it, not killing it,
     *  is what lowers the plinth. */
    {
      id: 'pick-secret-signal-sample',
      kind: 'signal-sample',
      position: v(-30, -2.3, -87),
      isSecret: true,
    },

    // Upper terrace and canopy.
    { id: 'pick-motif-upper-terrace', kind: 'lost-motif', position: v(-38, 13.3, -73) },
    { id: 'pick-shard-canopy', kind: 'resonance-shard', amount: 8, position: v(4, 13.3, -75) },
    /** SECRET 6 of 7 — Echo. `rail-echo-canopy-line` is the only way up, and
     *  the rail is three broken lengths of dead root until Echo bridges them. */
    {
      id: 'pick-secret-keeper-memory',
      kind: 'keeper-memory',
      position: v(-8, 22.3, -62),
      requiresForm: 'echo',
      isSecret: true,
    },

    // Seed Vault (optional route).
    { id: 'pick-shard-vault-a', kind: 'resonance-shard', amount: 10, position: v(-56, 14.4, -38) },
    { id: 'pick-shard-vault-b', kind: 'resonance-shard', amount: 10, position: v(-50, 14.4, -34) },
    /** SECRET 7 of 7 — the side route's payoff, and the reason the branch is
     *  worth the spore vents. Guarded by the False Shard that is wearing it. */
    {
      id: 'pick-secret-coherence-grotto',
      kind: 'coherence-fragment',
      position: v(-53, 14.4, -38),
      isSecret: true,
    },

    // Combat plateau and mini-boss reward.
    { id: 'pick-shard-plateau-a', kind: 'resonance-shard', amount: 8, position: v(-12, 5.2, -108) },
    { id: 'pick-shard-plateau-b', kind: 'resonance-shard', amount: 8, position: v(-17, 0.4, -113) },
    /** The Virus Bloom's seedbed, once the Bloom is off it. */
    {
      id: 'pick-capacitor-bloom-reward',
      kind: 'frequency-capacitor',
      position: v(22, 0.4, -108),
    },

    // West flank and gallery.
    {
      id: 'pick-shard-highline-a',
      kind: 'resonance-shard',
      amount: 8,
      position: v(-38, 14.3, -142),
    },
    {
      id: 'pick-shard-highline-b',
      kind: 'resonance-shard',
      amount: 8,
      position: v(-32, 19.3, -168),
    },
    { id: 'pick-keeper-memory-gallery', kind: 'keeper-memory', position: v(-1, 0.4, -195) },

    /**
     * The Frequency Core itself. Not a secret and not optional: it is what the
     * stage was for, it sits in the centre of Oru's ring, and picking it up is
     * what starts the restoration.
     */
    {
      id: 'pick-frequency-core',
      kind: 'frequency-capacitor',
      amount: 1,
      position: v(0, 1.2, -160),
    },
  ],

  // -------------------------------------------------------------------------
  // Resonators
  // -------------------------------------------------------------------------

  resonators: [
    /** P1 — the root bridge. Root, Fifth, Octave, in that order, spread across
     *  the chasm mouth so the sequence is a route rather than a chord. Eight
     *  second hold: nobody fails this on timing. */
    {
      id: 'res-bridge-root',
      position: v(0, -1.9, -67),
      degree: 0,
      puzzleId: 'puz-root-bridge-sequence',
      order: 0,
      holdSeconds: 8,
    },
    {
      id: 'res-bridge-fifth',
      position: v(-14, -1.5, -72),
      degree: 4,
      puzzleId: 'puz-root-bridge-sequence',
      order: 1,
      holdSeconds: 8,
    },
    {
      id: 'res-bridge-octave',
      position: v(14, -0.7, -73),
      degree: 7,
      puzzleId: 'puz-root-bridge-sequence',
      order: 2,
      holdSeconds: 8,
    },

    /** P2 — the cascade gate. Two resonators 9 m apart with a 2.2 s hold: one
     *  Harmonic Burst covers both, or two quick pulses if the player would
     *  rather aim. The stage's argument for the burst. */
    {
      id: 'res-gate-north',
      position: v(-20, -1.4, -85.5),
      degree: 2,
      puzzleId: 'puz-cascade-gate-simultaneous',
      holdSeconds: 2.2,
    },
    {
      id: 'res-gate-south',
      position: v(-20, -1.4, -94.5),
      degree: 5,
      puzzleId: 'puz-cascade-gate-simultaneous',
      holdSeconds: 2.2,
    },

    /**
     * P3 — the canopy roots, after the mini-boss. A sustain: hold both notes
     * open for three and a half seconds while the rhythm steps run underneath.
     * Same mechanic as P1, asked for in a different tense.
     */
    {
      id: 'res-canopy-sustain-a',
      position: v(-14, 10.5, -130),
      degree: 3,
      puzzleId: 'puz-canopy-sustain',
      holdSeconds: 3.5,
    },
    {
      id: 'res-canopy-sustain-b',
      position: v(-8, 10.5, -130),
      degree: 6,
      puzzleId: 'puz-canopy-sustain',
      holdSeconds: 3.5,
    },

    /**
     * P4 — THE RETURN GATE. Three resonators around the cascade basin with a
     * 1.1 s hold each. The shortest hop between them is 15.2 m; even sprinting
     * at 8.6 m/s and spending the dash, that is about 1.6 s in transit. The
     * numbers do not close, and they are not meant to: Echo Form keeps a struck
     * note ringing after the player has left it, and Echo Form comes from Oru.
     * This is the stage's built-in reason to walk back in.
     */
    {
      id: 'res-echo-west',
      position: v(-42, -1.4, -92),
      degree: 0,
      puzzleId: 'puz-cascade-echo',
      holdSeconds: 1.1,
    },
    {
      id: 'res-echo-centre',
      position: v(-26, -1.4, -87),
      degree: 2,
      puzzleId: 'puz-cascade-echo',
      holdSeconds: 1.1,
    },
    {
      id: 'res-echo-east',
      position: v(-12, -1.4, -93),
      degree: 4,
      puzzleId: 'puz-cascade-echo',
      holdSeconds: 1.1,
    },

    /** P5 — the Seed Vault. A plain two-note sequence on the optional route,
     *  because the price of the branch is already the spore vents and the
     *  hounds. */
    {
      id: 'res-vault-first',
      position: v(-57, 15, -50),
      degree: 1,
      puzzleId: 'puz-vault-sequence',
      order: 0,
      holdSeconds: 6,
    },
    {
      id: 'res-vault-second',
      position: v(-49, 15, -50),
      degree: 5,
      puzzleId: 'puz-vault-sequence',
      order: 1,
      holdSeconds: 6,
    },
  ],

  // -------------------------------------------------------------------------
  // Puzzles
  // -------------------------------------------------------------------------

  puzzles: [
    {
      id: 'puz-root-bridge-sequence',
      kind: 'sequence',
      resonatorIds: ['res-bridge-root', 'res-bridge-fifth', 'res-bridge-octave'],
      reward: {
        kind: 'spawnPlatforms',
        platformIds: ['geo-root-deck-1', 'geo-root-deck-2', 'geo-root-deck-3'],
      },
      hint: 'Three root resonators, low to high: Root, Fifth, Octave. The bridge grows one segment for each.',
    },
    {
      id: 'puz-cascade-gate-simultaneous',
      kind: 'simultaneous',
      resonatorIds: ['res-gate-north', 'res-gate-south'],
      reward: { kind: 'openDoor', doorId: 'door-cascade-gate' },
      hint: 'Both banks at once. A Harmonic Burst reaches across the basin; two aimed pulses inside two seconds will also do it.',
    },
    {
      id: 'puz-canopy-sustain',
      kind: 'sustain',
      resonatorIds: ['res-canopy-sustain-a', 'res-canopy-sustain-b'],
      reward: { kind: 'setFlag', flag: 'garden-canopy-open' },
      hint: 'Hold the pair open. The canopy arch answers on the fourth bar, not before.',
    },
    {
      id: 'puz-cascade-echo',
      kind: 'echo',
      resonatorIds: ['res-echo-west', 'res-echo-centre', 'res-echo-east'],
      reward: { kind: 'revealSecret', contentId: 'pick-secret-lost-motif' },
      hint: 'Three notes, too far apart to hold at once. Something has to keep singing after you leave it.',
    },
    {
      id: 'puz-vault-sequence',
      kind: 'sequence',
      resonatorIds: ['res-vault-first', 'res-vault-second'],
      reward: { kind: 'openDoor', doorId: 'door-side-vault' },
      hint: 'Second, then Sixth. The vault was locked by a Keeper in a hurry.',
    },
  ],

  // -------------------------------------------------------------------------
  // Doors
  // -------------------------------------------------------------------------

  doors: [
    /** Woven root grown across the western third of the basin — the water
     *  lifts, the echo resonator on that side, and the thornwall are all
     *  behind it. Opened by `puz-cascade-gate-simultaneous`. */
    {
      id: 'door-cascade-gate',
      position: v(-38, 0.1, -90),
      shape: { kind: 'box', halfExtents: v(0.5, 3, 6) },
      style: 'root',
    },
    /** The Seed Vault, on the optional route. Opened by `puz-vault-sequence`. */
    {
      id: 'door-side-vault',
      position: v(-53, 16, -45.2),
      shape: { kind: 'box', halfExtents: v(2.5, 3, 0.6) },
      style: 'root',
    },
    /** West out of the rhythm canopy toward the flank. Opened by the flag
     *  `puz-canopy-sustain` sets. */
    {
      id: 'door-canopy-arch',
      position: v(-15.4, 12, -128),
      shape: { kind: 'box', halfExtents: v(0.6, 3, 3) },
      openedByFlag: 'garden-canopy-open',
      style: 'root',
    },
    /** Into the Virus Bloom's seedbed. Held shut until the plateau is clear so
     *  a player cannot fall into the mini-boss mid-fight. */
    {
      id: 'door-bloom-gate',
      position: v(1, 2, -104),
      shape: { kind: 'box', halfExtents: v(0.6, 3, 3) },
      openedByFlag: 'garden-bloom-gate-open',
      style: 'stone-carved',
    },
    /** The Keepers' seal on Oru's ring, at the north end of the approach
     *  gallery. Opens once the Conductor holding the corridor is gone. */
    {
      id: 'door-commander-seal',
      position: v(0, 3, -187),
      shape: { kind: 'box', halfExtents: v(4, 4, 0.6) },
      openedByFlag: 'garden-approach-cleared',
      style: 'gold-trim',
    },
  ],

  // -------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------

  triggers: [
    // --- 1. Opening vista --------------------------------------------------
    /** Fires four metres off the spawn pad. The camera leaves the player's
     *  shoulder and pans across the whole garden to the amplifier spire —
     *  every landmark the stage will use is in this one shot, in order. */
    {
      id: 'trg-opening-vista',
      position: v(0, 2, -4),
      shape: { kind: 'box', halfExtents: v(15, 3, 3) },
      once: true,
      action: { kind: 'vista', look: v(0, 42, -196), seconds: 6.5 },
    },
    {
      id: 'trg-cut-overlook',
      position: v(0, 2, -8),
      shape: { kind: 'box', halfExtents: v(15, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-garden-overlook' },
    },
    {
      id: 'trg-obj-descend',
      position: v(0, 2, -12),
      shape: { kind: 'box', halfExtents: v(15, 3, 2) },
      once: true,
      action: { kind: 'objective', text: 'Descend into the Fractured Garden.' },
    },

    // --- 2. Safe movement introduction -------------------------------------
    {
      id: 'trg-tut-jump',
      position: v(0, 1, -20),
      shape: { kind: 'box', halfExtents: v(10, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-jump' },
    },
    {
      id: 'trg-tut-double-jump',
      position: v(6, 1, -29),
      shape: { kind: 'box', halfExtents: v(6, 3, 3) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-double-jump' },
    },
    {
      id: 'trg-tut-dash',
      position: v(0, 0, -41),
      shape: { kind: 'box', halfExtents: v(9, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-dash' },
    },

    // --- 3. First contact --------------------------------------------------
    {
      id: 'trg-first-contact',
      position: v(0, -1.5, -47),
      shape: { kind: 'box', halfExtents: v(12, 3, 2) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['enm-whisperer-hollow-a', 'enm-whisperer-hollow-b', 'enm-whisperer-hollow-c'],
      },
    },
    {
      id: 'trg-tut-pulse',
      position: v(0, -1.5, -49),
      shape: { kind: 'box', halfExtents: v(12, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-pulse' },
    },
    {
      id: 'trg-tut-counter',
      position: v(0, -1.5, -55),
      shape: { kind: 'box', halfExtents: v(12, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-counter' },
    },

    // --- 4a. Root bridge ---------------------------------------------------
    {
      id: 'trg-tut-resonator',
      position: v(0, -1.5, -65),
      shape: { kind: 'box', halfExtents: v(8, 3, 2) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-resonator' },
    },
    {
      id: 'trg-obj-cross-chasm',
      position: v(0, -1.5, -68),
      shape: { kind: 'box', halfExtents: v(8, 3, 2) },
      once: true,
      action: { kind: 'objective', text: 'Wake the root bridge and cross the chasm.' },
    },
    {
      id: 'trg-chasm-ambush',
      position: v(0, -1.5, -70),
      shape: { kind: 'box', halfExtents: v(8, 4, 2) },
      once: true,
      action: { kind: 'spawnWave', spawnIds: ['enm-drifter-chasm-a', 'enm-drifter-chasm-b'] },
    },

    // --- 4b. Cascade basin -------------------------------------------------
    {
      id: 'trg-basin-guard',
      position: v(-14, -1.5, -90),
      shape: { kind: 'box', halfExtents: v(3, 4, 6) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['enm-guardian-seedbed', 'enm-bloom-basin-north', 'enm-bloom-basin-south'],
      },
    },
    {
      id: 'trg-tut-water-lift',
      position: v(-41, -1.5, -90),
      shape: { kind: 'box', halfExtents: v(3, 4, 3) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-water-lift' },
    },

    // --- 4c. Vine swings ---------------------------------------------------
    {
      id: 'trg-tut-vine-swing',
      position: v(-33, 14, -77),
      shape: { kind: 'box', halfExtents: v(3, 4, 6) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-vine-swing' },
    },
    {
      id: 'trg-vineway-fire',
      position: v(-30, 14, -77),
      shape: { kind: 'box', halfExtents: v(2, 4, 6) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['enm-pylon-vineway-west', 'enm-pylon-vineway-east', 'enm-drifter-vineway'],
      },
    },

    // --- 7. Optional side route --------------------------------------------
    {
      id: 'trg-side-route-hint',
      position: v(-46, 14, -75),
      shape: { kind: 'box', halfExtents: v(3, 4, 4) },
      once: true,
      action: {
        kind: 'objective',
        text: 'Optional: the Seed Vault, north-west along the terrace walk.',
      },
    },
    {
      id: 'trg-vault-guard',
      position: v(-53, 14.5, -70),
      shape: { kind: 'box', halfExtents: v(3, 4, 2) },
      once: true,
      action: { kind: 'spawnWave', spawnIds: ['enm-hound-side-a', 'enm-hound-side-b'] },
    },

    // --- 5. Fragments and the collapsing path ------------------------------
    {
      id: 'trg-fragment-mines',
      position: v(4, 13.5, -83),
      shape: { kind: 'box', halfExtents: v(8, 4, 2) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: ['enm-mine-fragment-a', 'enm-mine-fragment-b', 'enm-mine-fragment-c'],
      },
    },
    {
      id: 'trg-tut-rail',
      position: v(11, 13.5, -80),
      shape: { kind: 'box', halfExtents: v(2, 4, 4) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-rail' },
    },
    {
      id: 'trg-tut-collapse',
      position: v(-25, 8.5, -100),
      shape: { kind: 'box', halfExtents: v(3, 4, 3) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-collapse' },
    },

    // --- 6. Combat plateau -------------------------------------------------
    {
      id: 'trg-plateau-battle',
      position: v(-14, 1, -114),
      shape: { kind: 'box', halfExtents: v(6, 4, 2) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-pylon-plateau-west',
          'enm-pylon-plateau-east',
          'enm-fracture-plateau',
          'enm-drifter-plateau-a',
          'enm-drifter-plateau-b',
          'enm-chorus-seed-plateau',
        ],
      },
    },
    /** Set once the plateau is walked clear — this is what unlocks the Bloom
     *  gate, so the mini-boss can never be entered from behind. */
    {
      id: 'trg-bloom-gate-open',
      position: v(-4, 1, -104),
      shape: { kind: 'box', halfExtents: v(2, 4, 3) },
      once: true,
      action: { kind: 'setFlag', flag: 'garden-bloom-gate-open' },
    },
    {
      id: 'trg-obj-bloom-gate',
      position: v(-2, 1, -104),
      shape: { kind: 'box', halfExtents: v(2, 4, 3) },
      once: true,
      action: { kind: 'objective', text: 'Something is growing in the seedbed. Cleanse it.' },
    },

    // --- 9. Mini-boss ------------------------------------------------------
    {
      id: 'trg-cut-virus-bloom',
      position: v(6, 2, -106),
      shape: { kind: 'box', halfExtents: v(3, 4, 4) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-virus-bloom' },
    },
    {
      id: 'trg-miniboss-phase',
      position: v(10, 2, -107),
      shape: { kind: 'box', halfExtents: v(3, 4, 6) },
      once: true,
      action: { kind: 'phase', phase: 'miniboss' },
    },

    // --- 10. New mechanic variation ----------------------------------------
    {
      id: 'trg-cut-canopy-awake',
      position: v(22, 2.5, -127),
      shape: { kind: 'box', halfExtents: v(4, 4, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-canopy-awake' },
    },
    {
      id: 'trg-tut-rhythm-step',
      position: v(20, 2.5, -130),
      shape: { kind: 'box', halfExtents: v(3, 4, 3) },
      once: true,
      action: { kind: 'tutorial', tutorialId: 'tut-rhythm-step' },
    },
    {
      id: 'trg-canopy-pressure',
      position: v(18, 3, -130),
      shape: { kind: 'box', halfExtents: v(2, 4, 3) },
      once: true,
      action: { kind: 'spawnWave', spawnIds: ['enm-pursuer-canopy-a', 'enm-pursuer-canopy-b'] },
    },
    {
      id: 'trg-obj-canopy',
      position: v(-11, 10.5, -128),
      shape: { kind: 'box', halfExtents: v(4, 4, 4) },
      once: true,
      action: { kind: 'objective', text: 'Hold the canopy pair open and take the west flank.' },
    },

    // --- 11. High-intensity platforming ------------------------------------
    {
      id: 'trg-highline-pressure',
      position: v(-22, 10, -129),
      shape: { kind: 'box', halfExtents: v(4, 4, 2) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-mine-highline-a',
          'enm-mine-highline-b',
          'enm-drifter-highline-a',
          'enm-drifter-highline-b',
        ],
      },
    },
    /** Halfway along the flank the fog opens and Oru is directly below, all six
     *  metres of him, walking his own ruined terraces. Six seconds, no control
     *  taken away — the player can keep running through it. */
    {
      id: 'trg-highline-vista',
      position: v(-32, 19, -168),
      shape: { kind: 'box', halfExtents: v(4, 4, 4) },
      once: true,
      action: { kind: 'vista', look: v(0, 6, -160), seconds: 5 },
    },

    // --- 12. Commander approach --------------------------------------------
    {
      id: 'trg-approach-conductor',
      position: v(-1, 1, -198),
      shape: { kind: 'box', halfExtents: v(6, 4, 3) },
      once: true,
      action: {
        kind: 'spawnWave',
        spawnIds: [
          'enm-conductor-approach',
          'enm-whisperer-approach-a',
          'enm-whisperer-approach-b',
        ],
      },
    },
    {
      id: 'trg-approach-cleared',
      position: v(-1, 1, -192),
      shape: { kind: 'box', halfExtents: v(6, 4, 2) },
      once: true,
      action: { kind: 'setFlag', flag: 'garden-approach-cleared' },
    },
    {
      id: 'trg-cut-commander-approach',
      position: v(0, 1, -189),
      shape: { kind: 'box', halfExtents: v(4, 4, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-commander-approach' },
    },

    // --- 13. Boss ----------------------------------------------------------
    {
      id: 'trg-commander-phase',
      position: v(0, 2, -183),
      shape: { kind: 'box', halfExtents: v(8, 4, 3) },
      once: true,
      action: { kind: 'phase', phase: 'commander' },
    },

    // --- 14. Frequency Core and restoration --------------------------------
    /** Oru kneels, the Amplifier ruptures, and the Core is lying in the crater
     *  where his chest seam used to be. Picking it up is the last input of the
     *  fight and the first of the restoration. */
    {
      id: 'trg-core-recovered',
      position: v(0, 2, -160),
      shape: { kind: 'box', halfExtents: v(4, 3, 4) },
      once: true,
      action: { kind: 'setFlag', flag: 'garden-core-recovered' },
    },
    {
      id: 'trg-cut-frequency-core',
      position: v(0, 2, -158),
      shape: { kind: 'box', halfExtents: v(4, 3, 3) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-frequency-core' },
    },
    /**
     * The restoration phase. The violet drains out of the vines, the cascades
     * find 432 Hz and become audible again, the dark roots relight terrace to
     * terrace, birds the player has never seen come back into the canopy, and
     * the sky clears far enough to show the constellations the Keepers carved
     * the whole garden to point at. Same geometry, opposite world.
     */
    {
      id: 'trg-restoration-phase',
      position: v(0, 2, -156),
      shape: { kind: 'box', halfExtents: v(6, 3, 4) },
      once: true,
      action: { kind: 'phase', phase: 'restoration' },
    },
    {
      id: 'trg-obj-return',
      position: v(0, 2, -145),
      shape: { kind: 'box', halfExtents: v(8, 3, 4) },
      once: true,
      action: { kind: 'objective', text: 'The Garden is holding the chord. Go home.' },
    },

    // --- 15. Return to the Harmonic Sanctuary ------------------------------
    /** The south gate of the ring, where the regrown root span starts. Walking
     *  out ends the stage; the results screen plays over the walk rather than
     *  cutting it short. */
    {
      id: 'trg-return-sanctuary',
      position: v(0, 2, -134),
      shape: { kind: 'box', halfExtents: v(4, 3, 2) },
      once: true,
      action: { kind: 'cutscene', cutsceneId: 'cut-return-sanctuary' },
    },
  ],

  // -------------------------------------------------------------------------
  // Checkpoints
  //
  // One after every section that can kill. Ordered along the route, and never
  // more than about ninety seconds of replay apart — there is a checkpoint on
  // both sides of the mini-boss and one immediately before the Commander seal.
  // -------------------------------------------------------------------------

  checkpoints: [
    { id: 'cp-00-overlook', position: v(0, 0.2, 2), order: 0, yaw: 0 },
    { id: 'cp-01-terraces', position: v(0, -1.2, -30), order: 1, yaw: 0 },
    { id: 'cp-02-hollow', position: v(0, -2.9, -46), order: 2, yaw: 0 },
    { id: 'cp-03-bridgehead', position: v(0, -2.9, -67), order: 3, yaw: 0 },
    { id: 'cp-04-basin', position: v(-14, -2.9, -90), order: 4, yaw: 1.5708 },
    { id: 'cp-05-upper-terrace', position: v(-38, 12.9, -77), order: 5, yaw: -1.5708 },
    { id: 'cp-06-canopy', position: v(4, 12.9, -78), order: 6, yaw: 0 },
    /** Before the mini-boss: on the causeway, gate in view. */
    { id: 'cp-07-bloom-gate', position: v(-4, 0, -104), order: 7, yaw: -1.5708 },
    /** After the mini-boss: on the exit landing, north rim behind. */
    { id: 'cp-08-bloom-cleared', position: v(22, 2.5, -130), order: 8, yaw: 1.5708 },
    { id: 'cp-09-canopy-arch', position: v(-11, 10, -128), order: 9, yaw: 1.5708 },
    { id: 'cp-10-highline-pier', position: v(-38, 14, -142), order: 10, yaw: 0 },
    /** Last platforming checkpoint, on the approach shelf. */
    { id: 'cp-11-approach-shelf', position: v(-12, 6, -190), order: 11, yaw: -1.5708 },
    /** Before the Commander, inside the gallery at the seal. */
    { id: 'cp-12-commander-gate', position: v(0, 0, -190), order: 12, yaw: 0 },
    /** The walk home, after restoration. */
    { id: 'cp-13-sanctum-return', position: v(0, 0, -136), order: 13, yaw: 0 },
  ],

  // -------------------------------------------------------------------------
  // Cutscenes
  // -------------------------------------------------------------------------

  cutscenes: [
    {
      id: 'cut-garden-overlook',
      lines: [
        {
          speaker: 'Kesh',
          text: 'That was a garden. Nine terraces, water on every one of them.',
          seconds: 3.4,
          emote: 'quiet',
        },
        {
          speaker: 'Kesh',
          text: 'You can hear it from here. Everything in it is singing eight cycles sharp.',
          seconds: 3.8,
          emote: 'listening',
        },
        {
          speaker: 'Auralith',
          text: 'Source bearing: the spire. Something large is holding the note down there.',
          seconds: 3.4,
          emote: 'scan',
        },
      ],
      cameraFocus: v(0, 30, -160),
      cameraDistance: 34,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-virus-bloom',
      lines: [
        {
          speaker: 'Kesh',
          text: "That is not a flower. That's the infection wearing one.",
          seconds: 3.2,
          emote: 'wary',
        },
        {
          speaker: 'Auralith',
          text: 'No Garden signature inside it. Nothing to cleanse — only to break.',
          seconds: 3.4,
          emote: 'scan',
        },
      ],
      cameraFocus: v(22, 3, -108),
      cameraDistance: 22,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-canopy-awake',
      lines: [
        {
          speaker: 'Kesh',
          text: 'The roots moved. On the beat — they moved on the beat.',
          seconds: 3,
          emote: 'surprised',
        },
        {
          speaker: 'Auralith',
          text: 'The seedbed was smothering them. They are keeping time again. Use it.',
          seconds: 3.6,
          emote: 'warm',
        },
      ],
      cameraFocus: v(6, 8, -128),
      cameraDistance: 20,
      playerControlled: true,
      skippable: true,
    },
    {
      id: 'cut-commander-approach',
      lines: [
        {
          speaker: 'Auralith',
          text: 'Two signatures ahead. One is the Amplifier. The other is underneath it.',
          seconds: 3.6,
          emote: 'scan',
        },
        { speaker: 'Kesh', text: 'Underneath it?', seconds: 1.6, emote: 'quiet' },
        {
          speaker: 'Auralith',
          text: 'Four hundred and thirty-two, very faint, still trying. He is still in there.',
          seconds: 4,
          emote: 'grave',
        },
        {
          speaker: 'Kesh',
          text: 'Then we do not break him. We tune him.',
          seconds: 2.8,
          emote: 'resolved',
        },
      ],
      cameraFocus: v(0, 5, -175),
      cameraDistance: 26,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-frequency-core',
      lines: [
        {
          speaker: 'Oru',
          text: '…the ninth terrace. I never finished planting the ninth terrace.',
          seconds: 4,
          emote: 'exhausted',
        },
        {
          speaker: 'Kesh',
          text: 'You will. Hold still — this part is loud.',
          seconds: 2.8,
          emote: 'gentle',
        },
        {
          speaker: 'Auralith',
          text: 'Frequency Core recovered. Playing the Garden chord back into the region.',
          seconds: 3.8,
          emote: 'bright',
        },
      ],
      cameraFocus: v(0, 4, -160),
      cameraDistance: 20,
      playerControlled: false,
      skippable: true,
    },
    {
      id: 'cut-return-sanctuary',
      lines: [
        {
          speaker: 'Oru',
          text: 'The water is arguing with itself again. It used to do that.',
          seconds: 3.4,
          emote: 'warm',
        },
        {
          speaker: 'Kesh',
          text: 'Nine more regions sound like you did an hour ago.',
          seconds: 3,
          emote: 'tired',
        },
        {
          speaker: 'Auralith',
          text: 'Echo Form is stable. Three things in this garden will answer to it now that would not before.',
          seconds: 4.2,
          emote: 'bright',
        },
      ],
      cameraFocus: v(0, 3, -134),
      cameraDistance: 18,
      playerControlled: true,
      skippable: true,
    },
  ],

  // -------------------------------------------------------------------------
  // Tutorials
  //
  // Every one of these is text plus an on-screen diagram plus input prompts
  // resolved per device. None of them is audio-only, and none of them stops the
  // game — `completesOn` dismisses them the moment the player does the thing.
  // -------------------------------------------------------------------------

  tutorials: [
    {
      id: 'tut-jump',
      title: 'Jump',
      body: 'The terraces step down. Take them at a run — nothing here can hurt you.',
      actions: ['jump'],
      completesOn: 'jump',
    },
    {
      id: 'tut-double-jump',
      title: 'Double Jump',
      body: 'A second beat at the top of the arc lifts you another two and a half metres. The root pad above you is exactly that far.',
      actions: ['jump', 'jump'],
      completesOn: 'doubleJump',
    },
    {
      id: 'tut-dash',
      title: 'Dash',
      body: 'A short burst of speed, on the ground or in the air. It converts a jump you would have missed into one you make.',
      actions: ['dash'],
      completesOn: 'dash',
    },
    {
      id: 'tut-pulse',
      title: 'Resonance Pulse',
      body: 'The Auralith answers with a tuned pulse. Whisperers wind up visibly before they lunge — read the wind-up, then hit them.',
      actions: ['fire'],
      completesOn: 'fire',
    },
    {
      id: 'tut-counter',
      title: 'Resonance Counter',
      body: 'Meet an incoming shot on the beat and it goes back the way it came. Every counterable projectile flashes gold before it lands.',
      actions: ['counter'],
      completesOn: 'counter',
    },
    {
      id: 'tut-resonator',
      title: 'Resonators',
      body: 'Struck resonators hold their note for a while, then fade. The diagram on screen shows which degree each one wants and how long it stays lit.',
      actions: ['fire'],
      completesOn: 'resonatorStruck',
    },
    {
      id: 'tut-water-lift',
      title: 'Water Lifts',
      body: 'The Keepers tuned these columns to carry weight. Step on, wait, step off — they rise and fall on a seven-second cycle.',
      actions: ['move'],
      completesOn: 'ridePlatform',
    },
    {
      id: 'tut-vine-swing',
      title: 'Vine Swings',
      body: 'Each root swings a circle. Jump as one arrives rather than as it leaves, and keep the pylons in front of you.',
      actions: ['jump'],
      completesOn: 'ridePlatform',
    },
    {
      id: 'tut-rail',
      title: 'Resonance Lines',
      body: 'Living roots can be ridden. Land on one to grind it; jump off at any time.',
      actions: ['jump'],
      completesOn: 'railAttached',
    },
    {
      id: 'tut-collapse',
      title: 'Collapsing Stone',
      body: 'These slabs give way about half a second after you land. Keep moving — they grow back in four.',
      actions: ['move', 'jump'],
      completesOn: 'platformCollapsed',
    },
    {
      id: 'tut-rhythm-step',
      title: 'Rhythm Steps',
      body: 'The canopy roots move on the region’s beat — one step every two beats. Cross with the rhythm and the thorns are never where you are.',
      actions: ['move', 'jump'],
      completesOn: 'ridePlatform',
    },
  ],

  miniBossId: 'virus-bloom',
  commanderId: 'oru-fractured-colossus',

  /**
   * Nineteen minutes. A first-time Standard player exploring at a reasonable
   * pace lands around 22–26 minutes; a clean route with the cascade-face skip
   * and the rail descent runs about 11. Par sits deliberately just past the
   * point where the player has seen everything on the critical path once.
   */
  parSeconds: 1140,
  secretTotal: 7,

  // -------------------------------------------------------------------------
  // Decorative props — landmarks, not clutter
  // -------------------------------------------------------------------------

  props: [
    /** The stage's signature silhouette: a Keeper resonator ring thirty metres
     *  across, fallen on its side into the overlook plaza, gold sacred geometry
     *  still legible on the rim. Visible from the opening vista and again from
     *  the west flank, which is how the player measures how far they have come. */
    {
      id: 'prp-fallen-resonator-ring',
      kind: 'fallen-resonator-ring',
      position: v(-9, 0, -8),
      yaw: 0.6,
      scale: 3.2,
    },
    {
      id: 'prp-fallen-resonator-shard',
      kind: 'resonator-shard',
      position: v(9, 0, -6),
      yaw: -0.4,
      scale: 1.6,
    },

    /** The great cascade and its two smaller siblings. All three run violet and
     *  silent while infected, clear and audible restored. */
    { id: 'prp-cascade-great', kind: 'waterfall', position: v(-48, 0, -88), yaw: 0, scale: 4.5 },
    {
      id: 'prp-cascade-terrace',
      kind: 'waterfall',
      position: v(-30, 6, -84.5),
      yaw: 0,
      scale: 2.2,
    },
    {
      id: 'prp-cascade-canopy',
      kind: 'waterfall',
      position: v(10, 13, -72),
      yaw: 3.1416,
      scale: 1.8,
    },

    /** Oru's amplifier spire — the thing the opening vista points at and the
     *  thing the whole stage walks toward. Sixty metres of black crystal grown
     *  up out of the arena's north rim. */
    {
      id: 'prp-amplifier-spire',
      kind: 'amplifier-spire',
      position: v(0, 0, -200),
      yaw: 0,
      scale: 6,
    },
    {
      id: 'prp-amplifier-spire-root-a',
      kind: 'infected-root-mass',
      position: v(-14, 0, -194),
      yaw: 1.1,
      scale: 3,
    },
    {
      id: 'prp-amplifier-spire-root-b',
      kind: 'infected-root-mass',
      position: v(15, 0, -195),
      yaw: -0.9,
      scale: 2.6,
    },

    /** Keeper stonework: gold-inlaid arches along the approach gallery, and
     *  the constellation discs the restored sky lines up with. */
    { id: 'prp-gallery-arch-a', kind: 'gold-arch', position: v(-1, 0, -198), yaw: 0, scale: 1.4 },
    { id: 'prp-gallery-arch-b', kind: 'gold-arch', position: v(-1, 0, -194), yaw: 0, scale: 1.4 },
    { id: 'prp-gallery-arch-c', kind: 'gold-arch', position: v(-1, 0, -190), yaw: 0, scale: 1.4 },
    {
      id: 'prp-constellation-disc-north',
      kind: 'constellation-disc',
      position: v(0, 9, -187),
      yaw: 0,
      scale: 2.4,
    },
    {
      id: 'prp-constellation-disc-overlook',
      kind: 'constellation-disc',
      position: v(0, 4, 9),
      yaw: 0,
      scale: 2,
    },

    /** Vegetation, healthy and otherwise. */
    {
      id: 'prp-luminous-root-arch-a',
      kind: 'luminous-root-arch',
      position: v(0, -2.9, -60),
      yaw: 0,
      scale: 2,
    },
    {
      id: 'prp-luminous-root-arch-b',
      kind: 'luminous-root-arch',
      position: v(-38, 12.9, -71),
      yaw: 0.2,
      scale: 2.4,
    },
    {
      id: 'prp-infected-canopy-a',
      kind: 'infected-canopy',
      position: v(-20, 16, -80),
      yaw: 0.8,
      scale: 3,
    },
    {
      id: 'prp-infected-canopy-b',
      kind: 'infected-canopy',
      position: v(12, 15, -100),
      yaw: -1.2,
      scale: 2.6,
    },
    {
      id: 'prp-seedbed-husk',
      kind: 'seedbed-husk',
      position: v(22, 0, -100),
      yaw: 0.4,
      scale: 2.8,
    },
    {
      id: 'prp-keeper-statue-basin',
      kind: 'keeper-statue',
      position: v(-30, -2.9, -94),
      yaw: 1.9,
      scale: 1.8,
    },
    {
      id: 'prp-keeper-statue-vault',
      kind: 'keeper-statue',
      position: v(-53, 14, -33),
      yaw: 0,
      scale: 1.8,
    },
  ],
};
