import { PALETTE } from '@tuner/shared';
import type { CollectibleKind, StageId, Vec3 } from '@tuner/shared';
import type { GeometryDef, StageDef } from '@tuner/game-core';
import { Layer } from '@tuner/physics';

/**
 * The Harmonic Sanctuary — the hub.
 *
 * The Sanctuary is the room the player fails out of in the first ten minutes of
 * the game and then spends the rest of it putting back. That is the whole idea:
 * it does not start complete and get decorated, it starts broken and gets
 * *rebuilt out of the world* — every terrace, water course and roof beam paid
 * for with a Sanctuary Seed carried home from a region the player restored.
 *
 * Three rules the data below holds to:
 *
 * 1. **Nothing here is a shop.** Seeds are not currency and there is no vendor.
 *    A Seed is a cutting, a spore, a filament, a machine-slip; planting it
 *    brings back the thing it came from.
 * 2. **Every room is a place before it is a menu.** The bestiary is a gallery
 *    with specimens turning in it. The codex is a wall of shelves. The trophy
 *    hall holds eight empty stands from the first time the player walks in, and
 *    the emptiness is the point.
 * 3. **The hub answers the lattice.** After each Commander falls the whole
 *    Sanctuary changes at once — light, sound, geometry — because it reads the
 *    same restoration count the map does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A `StageDef`.
 *
 * `StageDef.id` is a `StageId`, and `StageId` deliberately enumerates the ten
 * *scored* regions. The Sanctuary is not one: it has no infection value, no par
 * time, no rank, no secret total and no kill plane, and giving it a fake stage
 * id would put a hub into every completion percentage and every save-file
 * stage table in the project.
 *
 * So it is exported as `SanctuaryScene` — the ambience-and-geometry subset of
 * `StageDef`, reusing `StageDef['ambience']` and `GeometryDef` verbatim so the
 * renderer builds it with exactly the same code path it uses for a region.
 * If a hub `StageId` is ever added, this becomes a `StageDef` by adding an id.
 */

// ---------------------------------------------------------------------------
// Unlock conditions
// ---------------------------------------------------------------------------

export type SanctuaryUnlock =
  /** Available from the moment the hub exists. */
  | { readonly kind: 'always' }
  | { readonly kind: 'stageCompleted'; readonly stageId: StageId }
  /** Counts the seven planetary Commanders plus the Loom. */
  | { readonly kind: 'commandersRestored'; readonly count: number }
  | { readonly kind: 'collected'; readonly collectible: CollectibleKind; readonly count: number }
  | { readonly kind: 'creaturesCleansed'; readonly count: number }
  | { readonly kind: 'upgradeBuilt'; readonly upgradeId: string };

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface SanctuaryRoom {
  readonly id: string;
  readonly name: string;
  /** What the player actually does in here, in one line. */
  readonly purpose: string;
  /** The room as a place — this is the modelling brief, not flavour text. */
  readonly architecture: string;
  /** Where the room's entrance sits, relative to the dome centre. */
  readonly position: Vec3;
  readonly unlock: SanctuaryUnlock;
  /** Shown on a sealed door. Never a bare "locked". */
  readonly unlockHint: string;
  /** Interaction verbs the room offers, for the HUD prompt layer. */
  readonly interactions: readonly string[];
  /** How the room itself changes as the world is restored. */
  readonly evolution: string;
}

export const SANCTUARY_ROOMS: readonly SanctuaryRoom[] = [
  {
    id: 'lattice-vault',
    name: 'The Lattice Vault',
    purpose: 'Read the World Lattice and choose the next region to restore.',
    architecture:
      'The dome floor itself. A gold ring-and-square inlay twelve metres across, with the ' +
      'celestial diagram projected in the air above it — frequency lines, constellations, and a ' +
      'slowly turning fragment of every region hung at its node. Violet where a Commander holds ' +
      'it, cyan where the player has been.',
    position: { x: 0, y: 0, z: 0 },
    unlock: { kind: 'always' },
    unlockHint: '',
    interactions: ['inspect-node', 'depart', 'replay-region'],
    evolution:
      'Each restored node re-knits its lines in gold and prints its recovered frequency beneath ' +
      'the fragment. The severed line at the top does not resolve until the seventh falls.',
  },
  {
    id: 'keepers-alcove',
    name: "The Keeper's Alcove",
    purpose: 'Save, settings, accessibility, difficulty, controls.',
    architecture:
      "Ovel's own corner: a worn desk, a stool, a shelf of tally books, and a hook where a coat " +
      'still hangs. Deliberately small and deliberately domestic — the one place in the game ' +
      'with no sacred geometry in it at all.',
    position: { x: -9, y: 0, z: -6 },
    unlock: { kind: 'always' },
    unlockHint: '',
    interactions: ['save', 'settings', 'accessibility', 'difficulty'],
    evolution:
      'The tally books fill in as the player collects. The coat stays on the hook for the whole ' +
      'game and is never mentioned.',
  },
  {
    id: 'practice-ring',
    name: 'The Practice Ring',
    purpose: 'Training: movement, combat drills, boss attack rehearsal, form experimentation.',
    architecture:
      'A sunken circular floor with gold degree-marks around the rim and a low rail. Targets ' +
      'rise out of the stone on request. No hazards, no fail state, no timer unless asked for.',
    position: { x: 10, y: -1.2, z: -8 },
    unlock: { kind: 'stageCompleted', stageId: 'fallen-sanctuary' },
    unlockHint: 'The floor is still cracked through. Restore the Sanctuary first.',
    interactions: ['movement-drill', 'combat-drill', 'rehearse-commander', 'reset'],
    evolution:
      'Every Commander the player has fought becomes rehearsable here at any phase, at any ' +
      'difficulty, with the telegraph layer forced on.',
  },
  {
    id: 'resonance-forge',
    name: 'The Resonance Forge',
    purpose: 'Spend Resonance Shards on Auralith and Resonance Form upgrades.',
    architecture:
      'A ring of eight empty stone cradles around a suspended tuning frame, one cradle per form. ' +
      'A recovered Core sits in its cradle turning slowly; the frame reconfigures to show what ' +
      'the Auralith becomes when it is worn.',
    position: { x: -11, y: 0, z: 6 },
    unlock: { kind: 'commandersRestored', count: 1 },
    unlockHint: 'The cradles are empty. Bring back a Frequency Core and one will light.',
    interactions: ['upgrade-form', 'upgrade-auralith', 'preview-silhouette'],
    evolution: 'One cradle lights per Core. The eighth stays dark until the Loom.',
  },
  {
    id: 'composition-chamber',
    name: 'The Composition Chamber',
    purpose: 'Composition Mode: arrange recovered motifs into playable pieces.',
    architecture:
      'A domed side-chapel whose walls are the instrument. Eight harmonic strings run floor to ' +
      'ceiling, one per degree; a recovered motif is written on the floor as a line of gold ' +
      'marks and plays by walking it. The room is the score.',
    position: { x: 11, y: 0, z: 6 },
    unlock: { kind: 'collected', collectible: 'lost-motif', count: 1 },
    unlockHint: 'Nothing to play yet. Find a Lost Motif out in the world.',
    interactions: ['play-motif', 'arrange', 'record', 'set-sanctuary-theme'],
    evolution:
      'Recovered motifs appear as new gold lines. A piece arranged here can be set as the ' +
      "Sanctuary's own music and is heard in the hub from then on.",
  },
  {
    id: 'keepers-archive',
    name: 'The Archive of Keepers',
    purpose: 'Codex entries and Keeper Memory fragments.',
    architecture:
      'Two storeys of shelving around a reading floor, most of it empty and honest about it. ' +
      'Recovered memories are read aloud in the voice that wrote them, because the room keeps ' +
      'whatever it hears — including Ovel.',
    position: { x: -13, y: 0, z: 0 },
    unlock: { kind: 'collected', collectible: 'keeper-memory', count: 1 },
    unlockHint: 'The shelves are bare. Bring back something worth filing.',
    interactions: ['read-memory', 'read-codex', 'sort-by-era'],
    evolution:
      "Shelves fill era by era. At full collection the Archive plays Ovel's last unsent entry, " +
      'once, and never again unless asked.',
  },
  {
    id: 'observation-gallery',
    name: 'The Observation Gallery',
    purpose: 'Bestiary: every Detuner and corrupted native the player has met.',
    architecture:
      'A colonnade of lit alcoves, each holding a slowly turning study model — not a corpse, a ' +
      'diagram: silhouette, telegraph pose, and the arc of the attack drawn in gold around it.',
    position: { x: 13, y: 0, z: 0 },
    unlock: { kind: 'creaturesCleansed', count: 5 },
    unlockHint: 'Too few field observations to open the gallery. Keep looking.',
    interactions: ['inspect-specimen', 'replay-telegraph', 'read-field-note'],
    evolution:
      'Alcoves fill as archetypes are met. Commanders get a full-height alcove at the far end, ' +
      "and Oru's is the only one where the model is not fighting.",
  },
  {
    id: 'living-terrace',
    name: 'The Living Terrace',
    purpose: 'Recovered wildlife: everything cleansed rather than destroyed.',
    architecture:
      'An open terrace off the east arch, planted in tiers. Creatures arrive on their own and ' +
      'settle where they like. There is no enclosure, no plinth and no label — this is the one ' +
      'collection in the game that is alive and does not perform.',
    position: { x: 8, y: 0.6, z: 13 },
    unlock: { kind: 'creaturesCleansed', count: 1 },
    unlockHint: 'Nothing has come home yet. Cleanse rather than break, and something will.',
    interactions: ['observe', 'feed', 'sit'],
    evolution:
      'Fills at exactly the rate the player chooses mercy. Sanctum Moths come first because they ' +
      'never actually left.',
  },
  {
    id: 'hall-of-returns',
    name: 'The Hall of Returns',
    purpose: 'Trophies: ranks, records, restored regions, completion.',
    architecture:
      'A long gallery with eight stands and a floor inlay of the lattice. A stand does not hold a ' +
      'Core — it holds the region: a hand-span model of the restored place, turning, with the ' +
      "player's best rank cut into the base.",
    position: { x: 0, y: 0, z: -14 },
    unlock: { kind: 'commandersRestored', count: 1 },
    unlockHint: 'Eight empty stands. That is the exhibit, for now.',
    interactions: ['inspect-region', 'compare-records', 'view-ranks'],
    evolution:
      'Each restored region raises its model. Improving a rank re-cuts the base while the player ' +
      'watches, which is a small thing and the most replayed animation in the hub.',
  },
  {
    id: 'seed-beds',
    name: 'The Seed Beds',
    purpose: 'Plant Sanctuary Seeds to rebuild the hub itself.',
    architecture:
      'Terraced beds cut into the hillside below the dome, most of them dry stone at the start. ' +
      'Each planted Seed becomes visible masonry, water, growth or light somewhere the player ' +
      'can walk to and stand in.',
    position: { x: -6, y: -2.4, z: 12 },
    unlock: { kind: 'collected', collectible: 'sanctuary-seed', count: 1 },
    unlockHint: 'Dry beds. Bring something back from a region that is ready to grow.',
    interactions: ['plant-seed', 'preview-restoration', 'walk-the-terraces'],
    evolution:
      'The single largest visual change in the game. By full restoration the beds are the reason ' +
      'the hub is green rather than gold.',
  },
  {
    id: 'atelier',
    name: 'The Atelier',
    purpose: 'Appearance and music customisation for the Tuner, the Auralith and the hub.',
    architecture:
      'A bright side-room with a full-length polished plate, dye vats, cord, tassel-stock and a ' +
      'rack of Auralith plate-sets. Everything on the rack was made here; nothing was bought.',
    position: { x: 6, y: 0, z: -12 },
    unlock: { kind: 'collected', collectible: 'sanctuary-seed', count: 3 },
    unlockHint: 'No dye, no cord, no stock. Three Seeds will restock the room.',
    interactions: ['change-outfit', 'change-auralith-plates', 'change-palette', 'set-hub-music'],
    evolution:
      'Restored regions contribute their colours and materials. Nothing offered here changes a ' +
      'single gameplay number, and the game says so on the door.',
  },
  {
    id: 'trial-gate',
    name: 'The Trial Gate',
    purpose: 'Challenge portal: time trials, no-damage runs, endurance rounds, boss rushes.',
    architecture:
      'An arch of stacked geometric plates in the north wall that was sealed long before the ' +
      "retuning. Through it the Sanctuary's own resonance is used to rebuild a region as a " +
      'test — a room made of memory, which is why it can be reset instantly.',
    position: { x: 0, y: 0, z: 15 },
    unlock: { kind: 'commandersRestored', count: 3 },
    unlockHint: 'The arch will not hold a region yet. Restore three and it will.',
    interactions: ['time-trial', 'no-damage-run', 'endurance', 'commander-rush', 'leaderboard'],
    evolution:
      'Every restored region and every fought Commander becomes selectable. The final tier only ' +
      'appears once the Loom is answered.',
  },
];

// ---------------------------------------------------------------------------
// Upgrades bought with Sanctuary Seeds
// ---------------------------------------------------------------------------

export type SanctuaryUpgradeEffect =
  /** Changes how the hub looks, sounds or feels, and nothing else. */
  | { readonly kind: 'cosmetic' }
  | { readonly kind: 'opensRoom'; readonly roomId: string }
  | { readonly kind: 'grantsService'; readonly service: string }
  | { readonly kind: 'raisesCap'; readonly stat: string; readonly amount: number };

export interface SanctuaryUpgrade {
  readonly id: string;
  readonly name: string;
  /** Which region the cutting came from. */
  readonly sourceStageId: StageId;
  readonly seedCost: number;
  readonly roomId: string;
  /** What is put back, stated plainly. */
  readonly restores: string;
  /** What the player can see from where they are standing when it lands. */
  readonly visibleChange: string;
  readonly effect: SanctuaryUpgradeEffect;
  readonly prerequisiteIds: readonly string[];
}

export const SANCTUARY_UPGRADES: readonly SanctuaryUpgrade[] = [
  {
    id: 'upg-dome-shell',
    name: 'The Dome, Closed',
    sourceStageId: 'fallen-sanctuary',
    seedCost: 1,
    roomId: 'lattice-vault',
    restores: 'The east quarter of the dome, open to the sky since the first hour.',
    visibleChange:
      'Weather stops coming in. The lattice projection stabilises and stops guttering when it rains.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: [],
  },
  {
    id: 'upg-water-course',
    name: 'The Water Course',
    sourceStageId: 'fractured-garden',
    seedCost: 2,
    roomId: 'seed-beds',
    restores: 'The channel that runs from the spring, down the terraces, out to the east arch.',
    visibleChange:
      'Running water in the hub for the first time. It is audible from every room and is the ' +
      'single biggest change to the soundscape in the game.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: [],
  },
  {
    id: 'upg-nine-beds',
    name: 'Nine Beds',
    sourceStageId: 'fractured-garden',
    seedCost: 2,
    roomId: 'seed-beds',
    restores: "Nine planting beds, laid out in the Garden's own pattern.",
    visibleChange:
      "Green on the hillside. Oru's handprint is pressed into the ninth bed and nobody remarks on it.",
    effect: { kind: 'opensRoom', roomId: 'living-terrace' },
    prerequisiteIds: ['upg-water-course'],
  },
  {
    id: 'upg-spire-lantern',
    name: 'The Spire Lanterns',
    sourceStageId: 'glass-meridian',
    seedCost: 2,
    roomId: 'lattice-vault',
    restores: 'Meridian glass in the dome ribs, each pane cut to a different key.',
    visibleChange:
      'The hub picks up colour. Struck in passing, the ribs answer — and no two answer alike.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: ['upg-dome-shell'],
  },
  {
    id: 'upg-reading-floor',
    name: 'The Reading Floor',
    sourceStageId: 'tidal-archive',
    seedCost: 3,
    roomId: 'keepers-archive',
    restores: 'Archive shelving, coral-mounted, and the playback bed under the reading floor.',
    visibleChange:
      "Memories can be heard as well as read, in the voice that made them. Ovel's entries sort last.",
    effect: { kind: 'grantsService', service: 'memory-playback' },
    prerequisiteIds: [],
  },
  {
    id: 'upg-tide-cistern',
    name: 'The Cistern',
    sourceStageId: 'tidal-archive',
    seedCost: 2,
    roomId: 'seed-beds',
    restores: 'The under-dome cistern, so the water course runs in dry season as well.',
    visibleChange:
      'The terraces stay green year-round, and a reflecting pool opens under the arch.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: ['upg-water-course'],
  },
  {
    id: 'upg-orrery-clock',
    name: 'The Orrery Clock',
    sourceStageId: 'ember-observatory',
    seedCost: 3,
    roomId: 'lattice-vault',
    restores: 'A small brass orrery over the vault, turning at the speed the sky actually turns.',
    visibleChange:
      'The hub gets a real day and night. Lighting, the soundscape and who is on the terrace all follow it.',
    effect: { kind: 'grantsService', service: 'day-night-cycle' },
    prerequisiteIds: ['upg-dome-shell'],
  },
  {
    id: 'upg-forge-hearth',
    name: 'The Forge Hearth',
    sourceStageId: 'ember-observatory',
    seedCost: 3,
    roomId: 'resonance-forge',
    restores: "The tuning frame's heat source, cold since the retuning.",
    visibleChange:
      'The Forge is warm and lit. Upgrade previews render as full silhouette rather than wireframe.',
    effect: { kind: 'raisesCap', stat: 'form-upgrade-tier', amount: 1 },
    prerequisiteIds: [],
  },
  {
    id: 'upg-twelve-mouths',
    name: 'Twelve Mouths',
    sourceStageId: 'hollow-choir',
    seedCost: 3,
    roomId: 'composition-chamber',
    restores: 'Canyon-cut resonators set into the chapel wall, spaced to answer one another.',
    visibleChange:
      'Composition Mode gains real polyphony: a piece can be written in up to twelve voices and the ' +
      'room performs it without the player standing there.',
    effect: { kind: 'raisesCap', stat: 'composition-voices', amount: 12 },
    prerequisiteIds: [],
  },
  {
    id: 'upg-root-cabling',
    name: 'Root Cabling',
    sourceStageId: 'verdant-machine',
    seedCost: 3,
    roomId: 'practice-ring',
    restores: 'Living cable under the Practice Ring floor, the way the Verdant Machine does it.',
    visibleChange:
      'Targets rise faster and the Ring can hold a full Commander pattern. Every phase becomes rehearsable.',
    effect: { kind: 'grantsService', service: 'commander-rehearsal' },
    prerequisiteIds: [],
  },
  {
    id: 'upg-canopy-roof',
    name: 'The Canopy Roof',
    sourceStageId: 'verdant-machine',
    seedCost: 2,
    roomId: 'living-terrace',
    restores: 'A grown roof over the east terrace, half branch and half beam.',
    visibleChange:
      'Dappled light across the terrace, and the recovered creatures start using the upper tiers.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: ['upg-nine-beds'],
  },
  {
    id: 'upg-buried-pillars',
    name: 'Three Pillars from the Field',
    sourceStageId: 'desert-of-lost-notes',
    seedCost: 3,
    roomId: 'seed-beds',
    restores: 'Three tuned pillars from the buried instrument-field, set upright on the terraces.',
    visibleChange:
      'The hillside answers the wind. Standing between the three of them, the World Chord is audible ' +
      'with no instrument at all.',
    effect: { kind: 'cosmetic' },
    prerequisiteIds: ['upg-nine-beds'],
  },
  {
    id: 'upg-dye-vats',
    name: 'The Dye Vats',
    sourceStageId: 'glass-meridian',
    seedCost: 2,
    roomId: 'atelier',
    restores: 'Cord, tassel-stock, dye and the plate-rack — the whole working end of the Atelier.',
    visibleChange:
      'Every restored region adds its colours to the vats. Nothing offered here touches a gameplay number.',
    effect: { kind: 'opensRoom', roomId: 'atelier' },
    prerequisiteIds: [],
  },
  {
    id: 'upg-trial-arch',
    name: 'The Sealed Arch',
    sourceStageId: 'hollow-choir',
    seedCost: 4,
    roomId: 'trial-gate',
    restores: 'The north arch, sealed by Keepers who left no note explaining why.',
    visibleChange:
      "The arch holds a region made of the Sanctuary's own memory of it, resettable instantly.",
    effect: { kind: 'opensRoom', roomId: 'trial-gate' },
    prerequisiteIds: ['upg-dome-shell'],
  },
  {
    id: 'upg-relay-mirror',
    name: 'The Relay Mirror',
    sourceStageId: 'orbital-dissonance',
    seedCost: 4,
    roomId: 'lattice-vault',
    restores: 'A plate cut from a fallen array, hung so the lattice can be read from above.',
    visibleChange:
      'The diagram can be turned in three dimensions, and the line leaving the top finally has ' +
      'somewhere to go.',
    effect: { kind: 'grantsService', service: 'lattice-3d-view' },
    prerequisiteIds: ['upg-dome-shell'],
  },
  {
    id: 'upg-eighth-string',
    name: 'The Eighth String',
    sourceStageId: 'celestial-loom',
    seedCost: 5,
    roomId: 'composition-chamber',
    restores: 'A thread off the Loom itself, strung floor to ceiling with the other eight.',
    visibleChange:
      'The chamber gains a string that has never had a name, and Composition Mode gains the degree ' +
      "that goes with it. The hub's music changes for good.",
    effect: { kind: 'raisesCap', stat: 'composition-degrees', amount: 1 },
    prerequisiteIds: ['upg-twelve-mouths'],
  },
];

// ---------------------------------------------------------------------------
// How the hub evolves
// ---------------------------------------------------------------------------

export interface SanctuaryEvolutionStep {
  /** Commanders restored, counting the seven planetary nodes and the Loom. */
  readonly commandersRestored: number;
  readonly name: string;
  readonly description: string;
  /** Palette the hub reads at this step. */
  readonly ambient: { readonly key: string; readonly sky: string; readonly light: string };
  /** What is audibly different. The hub's score is diegetic and additive. */
  readonly soundscape: string;
  /** New things a returning player will notice without being told. */
  readonly newFeatures: readonly string[];
}

export const SANCTUARY_EVOLUTION: readonly SanctuaryEvolutionStep[] = [
  {
    commandersRestored: 0,
    name: 'Standing, Barely',
    description:
      'A dome with a quarter missing, a cracked practice floor, dry beds, and eight empty ' +
      'stands. The lattice projects through a hole in the roof.',
    ambient: { key: 'wounded', sky: PALETTE.abyss, light: PALETTE.goldDim },
    soundscape: 'Wind through the break. One sustained ring off the dome, slightly sharp.',
    newFeatures: ['The Lattice Vault', "The Keeper's Alcove", 'The Practice Ring'],
  },
  {
    commandersRestored: 1,
    name: 'A Roof and a Reason',
    description:
      'The east quarter is closed and the first Core turns in its cradle. The sharpness in the ' +
      'dome ring is gone; the room is in tune with itself again even if nothing else is.',
    ambient: { key: 'settling', sky: PALETTE.panel, light: PALETTE.gold },
    soundscape: 'The dome ring resolves to true. A low sustained root under everything.',
    newFeatures: ['The Resonance Forge', 'The Hall of Returns', 'First Seeds planted'],
  },
  {
    commandersRestored: 2,
    name: 'Water Again',
    description:
      'The channel runs. Green shows on the lower terraces and the first cleansed creatures ' +
      'work out that the terrace is safe.',
    ambient: { key: 'greening', sky: PALETTE.panel, light: PALETTE.gold },
    soundscape: 'Running water, everywhere, under everything. A fifth added above the root.',
    newFeatures: ['The Living Terrace', 'The Seed Beds', 'The Archive of Keepers'],
  },
  {
    commandersRestored: 3,
    name: 'Colour',
    description:
      'Meridian glass in the ribs and dye back in the Atelier vats. The hub stops being navy and ' +
      'gold and starts being several things at once.',
    ambient: { key: 'coloured', sky: PALETTE.panelRaised, light: PALETTE.gold },
    soundscape: 'The ribs answer footsteps, each in a different key. A third joins the chord.',
    newFeatures: ['The Trial Gate', 'The Atelier', 'The Observation Gallery'],
  },
  {
    commandersRestored: 4,
    name: 'Day and Night',
    description:
      'The orrery clock turns over the vault and the Sanctuary gets a real sky again, moving at ' +
      'the speed the sky moves at.',
    ambient: { key: 'turning', sky: PALETTE.abyss, light: PALETTE.gold },
    soundscape: 'The hub theme changes with the hour. Nothing loops the same way twice in a day.',
    newFeatures: ['Day and night cycle', 'Full Commander rehearsal in the Practice Ring'],
  },
  {
    commandersRestored: 5,
    name: 'Twelve Voices',
    description:
      'Canyon resonators set into the chapel wall. The Sanctuary can perform a piece the player ' +
      'wrote, on its own, while they are somewhere else in the building.',
    ambient: { key: 'singing', sky: PALETTE.panelRaised, light: PALETTE.resonance },
    soundscape:
      'The hub sings whatever is on the Composition Chamber floor, in up to twelve parts.',
    newFeatures: ['Polyphonic Composition Mode', 'Player-set Sanctuary theme'],
  },
  {
    commandersRestored: 6,
    name: 'Full Terraces',
    description:
      'Canopy roof, cistern, upper tiers occupied. The hillside is louder with living things ' +
      'than with anything the player built.',
    ambient: { key: 'living', sky: PALETTE.panelRaised, light: PALETTE.restore },
    soundscape:
      "Wildlife over water over the chord. The player's own music is now the quietest layer.",
    newFeatures: ['Upper terrace wildlife', 'Reflecting pool', 'Year-round growth'],
  },
  {
    commandersRestored: 7,
    name: 'Seven Lit',
    description:
      'Seven stands raised, seven Cores turning, seven nodes gold on the diagram — and one hole ' +
      'in the ceiling of the projection where the eighth line is still climbing.',
    ambient: { key: 'assembled', sky: PALETTE.abyss, light: PALETTE.resonance },
    soundscape:
      'A complete chord, held, with one degree conspicuously missing. Players notice within seconds.',
    newFeatures: ['Orbital Dissonance opens', 'Three pillars ring on the hillside'],
  },
  {
    commandersRestored: 8,
    name: 'Restrung',
    description:
      'The Loom answered. The Sanctuary is whole, green, occupied, loud, and the eighth string ' +
      'runs floor to ceiling in the chapel with no name on it.',
    ambient: { key: 'restrung', sky: PALETTE.abyss, light: PALETTE.restore },
    soundscape:
      'The full World Chord, and underneath it a low, wide tone written for someone who cannot ' +
      'hear the rest of it.',
    newFeatures: [
      'The Eighth String',
      'Final Trial Gate tier',
      "Ovel's last archived entry, played once",
    ],
  },
];

// ---------------------------------------------------------------------------
// The Sanctuary as a place the renderer can build
// ---------------------------------------------------------------------------

/**
 * The ambience-and-geometry subset of `StageDef`, for spaces that are not
 * scored regions. See the note at the top of this file for why the hub is not
 * a `StageDef`.
 */
export interface SanctuaryScene {
  readonly displayName: string;
  readonly subtitle: string;
  readonly description: string;
  /** Beats per minute of the hub's rhythm. Slow — this is a room, not a level. */
  readonly bpm: number;
  readonly spawnPoint: Vec3;
  readonly spawnYaw: number;
  /** Reused verbatim from the stage format so the renderer takes one path. */
  readonly ambience: StageDef['ambience'];
  readonly geometry: readonly GeometryDef[];
  readonly props: NonNullable<StageDef['props']>;
}

/**
 * The Harmonic Sanctuary.
 *
 * Layout: a twelve-metre dome on a hilltop, entered from the south. The lattice
 * inlay is the floor of the dome; side chapels open east and west; the north
 * wall holds the sealed Trial arch and the Hall of Returns behind it; the seed
 * terraces step down the hillside to the south-east.
 *
 * `hiddenWhenRestored` and `onlyWhenRestored` do the hub's evolution: the
 * broken masonry and the temporary props are authored as pieces that leave, and
 * the closed dome, the water course and the grown roof are authored as pieces
 * that arrive.
 */
export const HARMONIC_SANCTUARY: SanctuaryScene = {
  displayName: 'The Harmonic Sanctuary',
  subtitle: 'A very good room',
  description:
    'Built true enough that a wrong note cannot hide in it. It is a workshop, an archive and a ' +
    'home, and at the start of the game it is missing a quarter of its roof.',
  bpm: 96,
  spawnPoint: { x: 0, y: 0.2, z: -11 },
  /** Facing +Z: the player enters from the south arch, looking into the vault. */
  spawnYaw: Math.PI / 2,

  ambience: {
    skyTop: PALETTE.abyss,
    skyBottom: PALETTE.panel,
    fogColour: PALETTE.panel,
    fogNear: 22,
    fogFar: 120,
    sunColour: PALETTE.gold,
    /** High and from the south-east, so the dome ribs stripe the vault floor. */
    sunDirection: { x: -0.34, y: -0.82, z: -0.46 },
    ambientColour: PALETTE.goldDim,
    restored: {
      skyTop: PALETTE.abyss,
      skyBottom: PALETTE.resonanceDeep,
      fogColour: PALETTE.resonanceDeep,
      sunColour: PALETTE.gold,
      ambientColour: PALETTE.restore,
    },
  },

  geometry: [
    // --- Vault floor and dome ------------------------------------------------
    {
      id: 'san-vault-floor',
      shape: { kind: 'box', halfExtents: { x: 16, y: 1.5, z: 16 } },
      position: { x: 0, y: -1.5, z: 0 },
      layer: Layer.Terrain,
      style: 'stone-carved',
    },
    {
      id: 'san-lattice-inlay',
      shape: { kind: 'box', halfExtents: { x: 6, y: 0.06, z: 6 } },
      position: { x: 0, y: 0.06, z: 0 },
      layer: Layer.Terrain,
      style: 'gold-trim',
    },
    {
      id: 'san-wall-north',
      shape: { kind: 'box', halfExtents: { x: 16, y: 6, z: 1 } },
      position: { x: 0, y: 6, z: 17 },
      layer: Layer.Terrain | Layer.Wall,
      style: 'stone-carved',
    },
    {
      id: 'san-wall-west',
      shape: { kind: 'box', halfExtents: { x: 1, y: 6, z: 16 } },
      position: { x: -17, y: 6, z: 0 },
      layer: Layer.Terrain | Layer.Wall,
      style: 'stone-carved',
    },
    {
      id: 'san-wall-east',
      shape: { kind: 'box', halfExtents: { x: 1, y: 6, z: 16 } },
      position: { x: 17, y: 6, z: 0 },
      layer: Layer.Terrain | Layer.Wall,
      style: 'stone-carved',
    },
    /** The break: a quarter of the dome is simply gone until the first Seed. */
    {
      id: 'san-dome-rubble-east',
      shape: { kind: 'box', halfExtents: { x: 3.2, y: 1.1, z: 3.2 } },
      position: { x: 9.5, y: 1.1, z: 5.5 },
      layer: Layer.Terrain,
      style: 'stone',
      hiddenWhenRestored: true,
    },
    {
      id: 'san-dome-shell',
      shape: { kind: 'box', halfExtents: { x: 7, y: 0.6, z: 7 } },
      position: { x: 6, y: 11.5, z: 4 },
      layer: Layer.Terrain | Layer.CameraBlocker,
      style: 'gold-trim',
      onlyWhenRestored: true,
    },

    // --- Side chapels --------------------------------------------------------
    {
      id: 'san-chapel-west-floor',
      shape: { kind: 'box', halfExtents: { x: 5, y: 1.5, z: 5 } },
      position: { x: -21, y: -1.5, z: 4 },
      layer: Layer.Terrain,
      style: 'stone-carved',
    },
    {
      id: 'san-chapel-east-floor',
      shape: { kind: 'box', halfExtents: { x: 5, y: 1.5, z: 5 } },
      position: { x: 21, y: -1.5, z: 4 },
      layer: Layer.Terrain,
      style: 'stone-carved',
    },
    {
      id: 'san-forge-cradle-ring',
      shape: { kind: 'box', halfExtents: { x: 3.4, y: 0.5, z: 3.4 } },
      position: { x: -21, y: 0.5, z: 4 },
      layer: Layer.Terrain,
      style: 'gold-trim',
    },

    // --- Practice ring (sunken) ---------------------------------------------
    {
      id: 'san-practice-floor',
      shape: { kind: 'box', halfExtents: { x: 6, y: 1.5, z: 6 } },
      position: { x: 10, y: -2.7, z: -8 },
      layer: Layer.Terrain,
      style: 'stone',
    },
    {
      id: 'san-practice-rim',
      shape: { kind: 'box', halfExtents: { x: 6.6, y: 0.4, z: 0.4 } },
      position: { x: 10, y: -0.8, z: -14.2 },
      layer: Layer.Terrain,
      style: 'gold-trim',
    },

    // --- Hall of Returns -----------------------------------------------------
    {
      id: 'san-hall-floor',
      shape: { kind: 'box', halfExtents: { x: 10, y: 1.5, z: 4 } },
      position: { x: 0, y: -1.5, z: -20 },
      layer: Layer.Terrain,
      style: 'stone-carved',
    },

    // --- Seed terraces, stepping down the hillside --------------------------
    {
      id: 'san-terrace-1',
      shape: { kind: 'box', halfExtents: { x: 8, y: 1.2, z: 4 } },
      position: { x: -4, y: -2.4, z: 20 },
      layer: Layer.Terrain,
      style: 'stone',
    },
    {
      id: 'san-terrace-2',
      shape: { kind: 'box', halfExtents: { x: 8, y: 1.2, z: 4 } },
      position: { x: -4, y: -4.8, z: 27 },
      layer: Layer.Terrain,
      style: 'stone',
    },
    {
      id: 'san-terrace-3',
      shape: { kind: 'box', halfExtents: { x: 8, y: 1.2, z: 4 } },
      position: { x: -4, y: -7.2, z: 34 },
      layer: Layer.Terrain,
      style: 'stone',
    },
    /** The water course only exists once the Garden Seed is planted. */
    {
      id: 'san-water-channel',
      shape: { kind: 'box', halfExtents: { x: 0.9, y: 0.2, z: 14 } },
      position: { x: 4, y: -3.6, z: 27 },
      layer: Layer.Terrain,
      style: 'water',
      onlyWhenRestored: true,
    },

    // --- Living terrace ------------------------------------------------------
    {
      id: 'san-living-terrace',
      shape: { kind: 'box', halfExtents: { x: 5, y: 1.2, z: 5 } },
      position: { x: 22, y: -0.6, z: 15 },
      layer: Layer.Terrain,
      style: 'root',
      onlyWhenRestored: true,
    },

    // --- The sealed arch -----------------------------------------------------
    {
      id: 'san-trial-arch-seal',
      shape: { kind: 'box', halfExtents: { x: 2.4, y: 3.2, z: 0.6 } },
      position: { x: 0, y: 3.2, z: 16.2 },
      layer: Layer.Terrain,
      style: 'stone-carved',
      hiddenWhenRestored: true,
    },
  ],

  props: [
    { id: 'prop-ovel-desk', kind: 'keeper-desk', position: { x: -9, y: 0, z: -6 }, yaw: 0.4 },
    { id: 'prop-ovel-coat', kind: 'coat-hook', position: { x: -10.4, y: 1.6, z: -6.8 } },
    { id: 'prop-tally-shelf', kind: 'tally-shelf', position: { x: -11.5, y: 0, z: -5 } },
    { id: 'prop-altar', kind: 'auralith-altar', position: { x: 0, y: 0, z: 6 }, scale: 1.2 },
    { id: 'prop-cradle-01', kind: 'core-cradle', position: { x: -21, y: 1, z: 1 } },
    { id: 'prop-cradle-02', kind: 'core-cradle', position: { x: -23.4, y: 1, z: 2.4 } },
    { id: 'prop-cradle-03', kind: 'core-cradle', position: { x: -24, y: 1, z: 5 } },
    { id: 'prop-cradle-04', kind: 'core-cradle', position: { x: -22.4, y: 1, z: 6.9 } },
    { id: 'prop-cradle-05', kind: 'core-cradle', position: { x: -19.6, y: 1, z: 6.9 } },
    { id: 'prop-cradle-06', kind: 'core-cradle', position: { x: -18, y: 1, z: 5 } },
    { id: 'prop-cradle-07', kind: 'core-cradle', position: { x: -18.6, y: 1, z: 2.4 } },
    { id: 'prop-cradle-08', kind: 'core-cradle-dark', position: { x: -21, y: 1, z: 4 } },
    { id: 'prop-chapel-strings', kind: 'harmonic-string-array', position: { x: 21, y: 0, z: 4 } },
    { id: 'prop-stand-01', kind: 'region-stand', position: { x: -7.5, y: 0, z: -20 } },
    { id: 'prop-stand-02', kind: 'region-stand', position: { x: -5.4, y: 0, z: -20 } },
    { id: 'prop-stand-03', kind: 'region-stand', position: { x: -3.2, y: 0, z: -20 } },
    { id: 'prop-stand-04', kind: 'region-stand', position: { x: -1.1, y: 0, z: -20 } },
    { id: 'prop-stand-05', kind: 'region-stand', position: { x: 1.1, y: 0, z: -20 } },
    { id: 'prop-stand-06', kind: 'region-stand', position: { x: 3.2, y: 0, z: -20 } },
    { id: 'prop-stand-07', kind: 'region-stand', position: { x: 5.4, y: 0, z: -20 } },
    { id: 'prop-stand-08', kind: 'region-stand', position: { x: 7.5, y: 0, z: -20 } },
    { id: 'prop-gallery-alcove', kind: 'specimen-alcove', position: { x: 13, y: 0, z: 0 } },
    { id: 'prop-seed-bed-01', kind: 'seed-bed', position: { x: -8, y: -1.2, z: 20 } },
    { id: 'prop-seed-bed-02', kind: 'seed-bed', position: { x: -4, y: -1.2, z: 20 } },
    { id: 'prop-seed-bed-03', kind: 'seed-bed', position: { x: 0, y: -1.2, z: 20 } },
    { id: 'prop-dye-vats', kind: 'dye-vat-row', position: { x: 6, y: 0, z: -12 } },
    { id: 'prop-mirror-plate', kind: 'polished-plate', position: { x: 7.6, y: 0, z: -13.4 } },
    {
      id: 'prop-pillar-01',
      kind: 'tuned-pillar',
      position: { x: -12, y: -1.2, z: 22 },
      scale: 1.4,
    },
    {
      id: 'prop-pillar-02',
      kind: 'tuned-pillar',
      position: { x: -12, y: -3.6, z: 29 },
      scale: 1.4,
    },
    { id: 'prop-pillar-03', kind: 'tuned-pillar', position: { x: -12, y: -6, z: 36 }, scale: 1.4 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOMS_BY_ID: ReadonlyMap<string, SanctuaryRoom> = new Map(
  SANCTUARY_ROOMS.map((room) => [room.id, room] as const),
);

export function getSanctuaryRoom(roomId: string): SanctuaryRoom | undefined {
  return ROOMS_BY_ID.get(roomId);
}

/** Snapshot of what the player has done, for evaluating hub unlocks. */
export interface SanctuaryProgress {
  readonly completedStages: readonly StageId[];
  readonly commandersRestored: number;
  readonly creaturesCleansed: number;
  readonly collected: Readonly<Partial<Record<CollectibleKind, number>>>;
  readonly builtUpgradeIds: readonly string[];
}

export function isRoomUnlocked(room: SanctuaryRoom, progress: SanctuaryProgress): boolean {
  const unlock = room.unlock;
  switch (unlock.kind) {
    case 'always':
      return true;
    case 'stageCompleted':
      return progress.completedStages.includes(unlock.stageId);
    case 'commandersRestored':
      return progress.commandersRestored >= unlock.count;
    case 'creaturesCleansed':
      return progress.creaturesCleansed >= unlock.count;
    case 'collected':
      return (progress.collected[unlock.collectible] ?? 0) >= unlock.count;
    case 'upgradeBuilt':
      return progress.builtUpgradeIds.includes(unlock.upgradeId);
  }
}

export function getUnlockedRooms(progress: SanctuaryProgress): readonly SanctuaryRoom[] {
  return SANCTUARY_ROOMS.filter((room) => isRoomUnlocked(room, progress));
}

/** Upgrades the player can plant right now, given seeds in hand and what is built. */
export function getAvailableUpgrades(
  progress: SanctuaryProgress,
  seedsInHand: number,
): readonly SanctuaryUpgrade[] {
  const built = new Set<string>(progress.builtUpgradeIds);
  const restored = new Set<StageId>(progress.completedStages);
  return SANCTUARY_UPGRADES.filter(
    (upgrade) =>
      !built.has(upgrade.id) &&
      upgrade.seedCost <= seedsInHand &&
      restored.has(upgrade.sourceStageId) &&
      upgrade.prerequisiteIds.every((id) => built.has(id)),
  );
}

/** The hub's current visible state. Clamped, so an unexpected count is safe. */
export function getSanctuaryEvolution(commandersRestored: number): SanctuaryEvolutionStep {
  const last = SANCTUARY_EVOLUTION[SANCTUARY_EVOLUTION.length - 1];
  const clamped = Math.max(0, Math.min(commandersRestored, SANCTUARY_EVOLUTION.length - 1));
  const step = SANCTUARY_EVOLUTION[clamped];
  // `last` is only undefined if the table is empty, which the tests forbid.
  if (step !== undefined) return step;
  if (last !== undefined) return last;
  throw new Error('SANCTUARY_EVOLUTION must not be empty');
}
