import { HARMONIC_DEGREE_NAMES, PALETTE, harmonicHz } from '@tuner/shared';
import type { ResonanceFormId, StageId } from '@tuner/shared';

/**
 * The World Lattice — the stage-select map.
 *
 * The Keepers never drew a map of the world. They drew a map of its *tuning*:
 * a single celestial diagram in which every region is a node on one strung
 * instrument, joined by frequency lines, grouped into constellations, and
 * anchored by the sacred geometry that holds the whole figure in proportion.
 *
 * The selection screen is that diagram, alive. Each node is a slowly turning
 * fragment of the world it stands for, hung in the dark above the Sanctuary
 * dome; between them run the gold chord-lines the Keepers tuned along. Where a
 * Commander has taken a node, the fragment is shot through with violet, the
 * lines leaving it read as broken, and its recovered frequency reads as unknown
 * until it is taken back. Restoring a region turns its fragment cyan, re-knits
 * its lines in gold, and prints its true pitch beneath it.
 *
 * It is deliberately **not** a grid of commander portraits. Nothing on this
 * screen is a menu tile: the player is looking at an instrument with strings
 * missing, and picking which string to restring next.
 *
 * ---------------------------------------------------------------------------
 * PROGRESSION. The lattice is authored to be answered in the player's own
 * order, not the designer's:
 *
 *   1. The Fallen Sanctuary is the only node lit at the start.
 *   2. Restoring it lights the **whole inner constellation at once** — four
 *      planetary nodes, no recommended order, no correct first pick.
 *   3. The outer constellation lights once *any two* planetary nodes are
 *      restored. It is a count, never a named prerequisite, so no main stage is
 *      ever gated behind one specific other main stage.
 *   4. Only when all seven planetary nodes are restored does the severed line
 *      to Orbital Dissonance reappear — and the Celestial Loom sits beyond it.
 *
 * `getAvailableStages` is the single source of truth for that rule, and
 * `lattice.test.ts` asserts every clause of it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A point on the lattice diagram. Lattice units, y up, origin at the centre. */
export interface LatticePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What a node *is* on the diagram, which decides how it is drawn and how it
 * counts toward progression.
 */
export type LatticeNodeKind =
  /** The Sanctuary's own node: the anchor the whole figure hangs from. */
  | 'origin'
  /** One of the seven planetary resonance nodes a Commander has seized. */
  | 'planetary'
  /** The severed line off the world — reachable only once the seven are back. */
  | 'ascent'
  /** Where the World Chord was first woven. */
  | 'loom';

/** How a constellation line between two nodes is drawn. */
export type LatticeEdgeKind =
  /** A primary chord-line: thick, gold, the Keepers' original tuning path. */
  | 'chord'
  /** A secondary harmonic: thin, gold, drawn as a dotted arc. */
  | 'harmonic'
  /** A line the Detuners cut: violet, broken, drifting apart at the break. */
  | 'severed'
  /** A line that leaves the plane of the diagram entirely. */
  | 'ascent';

export interface LatticeEdge {
  readonly to: StageId;
  readonly kind: LatticeEdgeKind;
  /** Short label the map draws along the line when the node is focused. */
  readonly label: string;
}

/**
 * Unlock requirements for a node.
 *
 * Two clauses, both of which must hold. `requiresStages` names specific
 * regions and is used only where the story genuinely demands sequence — the
 * introduction, and the ascent. `requiresRestoredNodes` is a *count* of
 * restored planetary nodes and is how the main seven are paced without ever
 * naming one as another's prerequisite.
 */
export interface LatticeUnlock {
  readonly requiresStages: readonly StageId[];
  readonly requiresRestoredNodes: number;
  /** Player-facing sentence shown on a locked node. Never a bare "LOCKED". */
  readonly hint: string;
}

export interface LatticeNode {
  readonly stageId: StageId;
  readonly kind: LatticeNodeKind;
  readonly displayName: string;
  readonly subtitle: string;
  /** Commander holding the node. The origin node has none. */
  readonly commanderName: string | null;
  readonly commanderTitle: string | null;
  /** Form recovered from this node's Frequency Core, if any. */
  readonly awardsForm: ResonanceFormId | null;
  /** One line. This is all the map shows before the player commits. */
  readonly description: string;
  /** Starting detune of the region, in [0, 1]. Drives the fragment's violet. */
  readonly infection: number;

  /** Where the node sits on the diagram. */
  readonly position: LatticePoint;
  /** Constellation the node belongs to, named in the Keepers' catalogue. */
  readonly constellation: string;
  /** Sacred-geometry motif drawn as the node marker. */
  readonly glyph: string;
  /** Silhouette of the floating world fragment that turns beneath the marker. */
  readonly fragment: string;
  /** Accent the fragment reads as once restored. */
  readonly accentColour: string;

  readonly edges: readonly LatticeEdge[];
  readonly unlock: LatticeUnlock;

  /**
   * Forms that make this region *interesting*, never forms it requires. The map
   * prints these as "others have carried" — advice from the Keepers' notes,
   * with no lock behind it. Every region is completable on the base Auralith.
   */
  readonly recommendedForms: readonly ResonanceFormId[];
  /** Rendered verbatim beneath the recommendation list. */
  readonly recommendationNote: string;

  /** Harmonic degree this node holds in the World Chord. */
  readonly harmonicDegree: number;
  /** Octave displacement applied to that degree. */
  readonly harmonicOctave: number;
  /** Printed under the node once restored, e.g. `648.00 Hz · Fifth`. */
  readonly recoveredFrequency: string;
}

// ---------------------------------------------------------------------------
// Frequency labels
// ---------------------------------------------------------------------------

/**
 * The pitch a restored node holds, formatted for the map.
 *
 * Derived rather than typed out so the diagram can never drift away from the
 * synthesis: both read `harmonicHz`.
 */
export function latticeFrequencyLabel(degree: number, octave = 0): string {
  const name = HARMONIC_DEGREE_NAMES[degree] ?? HARMONIC_DEGREE_NAMES[0];
  return `${harmonicHz(degree, octave).toFixed(2)} Hz · ${name ?? 'Root'}`;
}

// ---------------------------------------------------------------------------
// Stage groupings
// ---------------------------------------------------------------------------

/** The one region that is lit when a new save is opened. */
export const INTRODUCTORY_STAGE_ID: StageId = 'fallen-sanctuary';

/**
 * The seven planetary nodes. Order here is presentation order on the map only —
 * it carries no gating whatsoever, which `lattice.test.ts` proves.
 */
export const PLANETARY_STAGE_IDS: readonly StageId[] = [
  'fractured-garden',
  'glass-meridian',
  'tidal-archive',
  'verdant-machine',
  'ember-observatory',
  'hollow-choir',
  'desert-of-lost-notes',
];

/** The two-part finale, in the order it must be played. */
export const FINALE_STAGE_IDS: readonly StageId[] = ['orbital-dissonance', 'celestial-loom'];

/**
 * Planetary nodes that light the moment the Sanctuary is restored — the whole
 * inner constellation, all at once, with no recommended first pick.
 */
export const INNER_CONSTELLATION_SIZE = 4;

/** Restored planetary nodes required before the outer constellation lights. */
const OUTER_CONSTELLATION_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// The lattice
// ---------------------------------------------------------------------------

export const WORLD_LATTICE: readonly LatticeNode[] = [
  // -------------------------------------------------------------------------
  // Origin
  // -------------------------------------------------------------------------
  {
    stageId: 'fallen-sanctuary',
    kind: 'origin',
    displayName: 'The Fallen Sanctuary',
    subtitle: 'Where the first chord was kept',
    commanderName: null,
    commanderTitle: null,
    awardsForm: null,
    description:
      'A hill of gold and stone that held the true pitch for eight hundred years, ' +
      'coming apart in the first hours of the retuning.',
    infection: 0.62,
    position: { x: 0, y: -88 },
    constellation: 'The Anchor',
    glyph: 'ring-in-square',
    fragment: 'terraced-hilltop',
    accentColour: PALETTE.gold,
    edges: [
      { to: 'fractured-garden', kind: 'chord', label: 'the near line' },
      { to: 'glass-meridian', kind: 'harmonic', label: 'the bright line' },
      { to: 'verdant-machine', kind: 'harmonic', label: 'the green line' },
    ],
    unlock: {
      requiresStages: [],
      requiresRestoredNodes: 0,
      hint: 'The only note you can still hear clearly.',
    },
    recommendedForms: ['base'],
    recommendationNote: 'You will arrive here with nothing but the Auralith. That is enough.',
    harmonicDegree: 0,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(0, 0),
  },

  // -------------------------------------------------------------------------
  // Inner constellation — lights the moment the Sanctuary is restored
  // -------------------------------------------------------------------------
  {
    stageId: 'fractured-garden',
    kind: 'planetary',
    displayName: 'The Fractured Garden',
    subtitle: 'Terraces that grew toward the sound',
    commanderName: 'Oru',
    commanderTitle: 'The Fractured Colossus',
    awardsForm: 'echo',
    description:
      'Nine hanging terraces of luminous root, strangled with violet vine, and the ' +
      'stone giant who used to carry the seedlings between them.',
    infection: 0.68,
    position: { x: 0, y: -34 },
    constellation: 'The Cradle',
    glyph: 'seven-petal-rosette',
    fragment: 'stepped-terraces',
    accentColour: PALETTE.restore,
    edges: [
      { to: 'fallen-sanctuary', kind: 'chord', label: 'the near line' },
      { to: 'glass-meridian', kind: 'chord', label: 'root to facet' },
      { to: 'verdant-machine', kind: 'chord', label: 'root to root' },
      { to: 'tidal-archive', kind: 'harmonic', label: 'the water line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: 0,
      hint: 'Restore the Sanctuary to hear the inner constellation.',
    },
    recommendedForms: ['base'],
    recommendationNote:
      'Nothing here needs a form. Oru only needs someone patient enough to listen through him.',
    harmonicDegree: 4,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(4, 0),
  },
  {
    stageId: 'glass-meridian',
    kind: 'planetary',
    displayName: 'The Glass Meridian',
    subtitle: 'A city forced into unison',
    commanderName: 'Sella',
    commanderTitle: 'The Prism Conductor',
    awardsForm: 'prism',
    description:
      'Ten thousand crystal spires that once rang each in their own key, now ' +
      'shaking together on one violet note, and shattering for it.',
    infection: 0.74,
    position: { x: -46, y: 6 },
    constellation: 'The Facet',
    glyph: 'hexagram-lattice',
    fragment: 'shard-city',
    accentColour: PALETTE.resonance,
    edges: [
      { to: 'fallen-sanctuary', kind: 'harmonic', label: 'the bright line' },
      { to: 'fractured-garden', kind: 'chord', label: 'root to facet' },
      { to: 'tidal-archive', kind: 'chord', label: 'the falling line' },
      { to: 'hollow-choir', kind: 'chord', label: 'the long line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: 0,
      hint: 'Restore the Sanctuary to hear the inner constellation.',
    },
    recommendedForms: ['echo'],
    recommendationNote:
      'Keepers who came here with Echo found the sealed galleries. Everyone else still finished.',
    harmonicDegree: 2,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(2, 0),
  },
  {
    stageId: 'tidal-archive',
    kind: 'planetary',
    displayName: 'The Tidal Archive',
    subtitle: 'Every song the world remembered',
    commanderName: 'Vess',
    commanderTitle: 'The Mnemonic Ray',
    awardsForm: 'tidal',
    description:
      'A drowned library of coral machinery where the recordings still play, out ' +
      'of order, in a voice that is not quite the one that made them.',
    infection: 0.7,
    position: { x: -82, y: -30 },
    constellation: 'The Undertow',
    glyph: 'spiral-of-nine',
    fragment: 'flooded-colonnade',
    accentColour: PALETTE.resonanceDeep,
    edges: [
      { to: 'glass-meridian', kind: 'chord', label: 'the falling line' },
      { to: 'fractured-garden', kind: 'harmonic', label: 'the water line' },
      { to: 'hollow-choir', kind: 'harmonic', label: 'the drowned line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: 0,
      hint: 'Restore the Sanctuary to hear the inner constellation.',
    },
    recommendedForms: ['prism', 'echo'],
    recommendationNote:
      'Light bends strangely underwater. Prism opens the flooded stacks; it does not open the way.',
    harmonicDegree: 3,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(3, 0),
  },
  {
    stageId: 'verdant-machine',
    kind: 'planetary',
    displayName: 'The Verdant Machine',
    subtitle: 'A forest wired into an antenna',
    commanderName: 'Thess',
    commanderTitle: 'The Root Parasite',
    awardsForm: 'bloom',
    description:
      'A canopy grown around a Keeper engine, every branch retrained into a ' +
      'broadcast element, pumping violet sap through pipes that carried water.',
    infection: 0.78,
    position: { x: 46, y: 6 },
    constellation: 'The Cradle',
    glyph: 'branching-tetrad',
    fragment: 'canopy-engine',
    accentColour: PALETTE.restore,
    edges: [
      { to: 'fallen-sanctuary', kind: 'harmonic', label: 'the green line' },
      { to: 'fractured-garden', kind: 'chord', label: 'root to root' },
      { to: 'desert-of-lost-notes', kind: 'chord', label: 'the dry line' },
      { to: 'ember-observatory', kind: 'chord', label: 'the long line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: 0,
      hint: 'Restore the Sanctuary to hear the inner constellation.',
    },
    recommendedForms: ['ember', 'tidal'],
    recommendationNote:
      'Ember clears the choking growth quickly. A patient Auralith clears it slowly, and still clears it.',
    harmonicDegree: 1,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(1, 0),
  },

  // -------------------------------------------------------------------------
  // Outer constellation — lights once any two planetary nodes are restored
  // -------------------------------------------------------------------------
  {
    stageId: 'ember-observatory',
    kind: 'planetary',
    displayName: 'The Ember Observatory',
    subtitle: 'Built to watch stars, made to burn',
    commanderName: 'Kaleth',
    commanderTitle: 'The Red Amplifier',
    awardsForm: 'ember',
    description:
      'Brass orreries turning far too fast above a mountain that has started to ' +
      'run, and a lens the size of a courtyard aimed at nothing helpful.',
    infection: 0.82,
    position: { x: 62, y: 54 },
    constellation: 'The Kindled Wheel',
    glyph: 'sun-octagon',
    fragment: 'orrery-peak',
    accentColour: PALETTE.gold,
    edges: [
      { to: 'verdant-machine', kind: 'chord', label: 'the long line' },
      { to: 'desert-of-lost-notes', kind: 'harmonic', label: 'the ash line' },
      { to: 'hollow-choir', kind: 'harmonic', label: 'the high arc' },
      { to: 'orbital-dissonance', kind: 'severed', label: 'cut' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: OUTER_CONSTELLATION_THRESHOLD,
      hint: 'Restore any two planetary nodes and the outer constellation resolves.',
    },
    recommendedForms: ['tidal', 'prism'],
    recommendationNote:
      'Tidal makes the heat survivable. It does not make the fight; the fight is in reading the mirrors.',
    harmonicDegree: 5,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(5, 0),
  },
  {
    stageId: 'hollow-choir',
    kind: 'planetary',
    displayName: 'The Hollow Choir',
    subtitle: 'Many mouths, one order',
    commanderName: 'Ombra',
    commanderTitle: 'The Many-Mouthed Conductor',
    awardsForm: 'choir',
    description:
      'A canyon of carved singing mouths that answered one another for centuries, ' +
      'now all shouting the same syllable at the same instant.',
    infection: 0.86,
    position: { x: -62, y: 54 },
    constellation: 'The Antiphon',
    glyph: 'twelve-mouth-ring',
    fragment: 'canyon-organ',
    accentColour: PALETTE.resonance,
    edges: [
      { to: 'glass-meridian', kind: 'chord', label: 'the long line' },
      { to: 'tidal-archive', kind: 'harmonic', label: 'the drowned line' },
      { to: 'ember-observatory', kind: 'harmonic', label: 'the high arc' },
      { to: 'orbital-dissonance', kind: 'severed', label: 'cut' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: OUTER_CONSTELLATION_THRESHOLD,
      hint: 'Restore any two planetary nodes and the outer constellation resolves.',
    },
    recommendedForms: ['silence', 'echo'],
    recommendationNote:
      'Silence carves a hole in the shout. So does standing in the right place at the right beat.',
    harmonicDegree: 6,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(6, 0),
  },
  {
    stageId: 'desert-of-lost-notes',
    kind: 'planetary',
    displayName: 'The Desert of Lost Notes',
    subtitle: 'Where sound goes to be eaten',
    commanderName: 'Nul',
    commanderTitle: 'The Sound Eater',
    awardsForm: 'silence',
    description:
      'Dunes over a buried instrument-field, and a mouth beneath them that has ' +
      'swallowed enough frequency to leave whole valleys with no echo at all.',
    infection: 0.9,
    position: { x: 82, y: -30 },
    constellation: 'The Swallowed Bar',
    glyph: 'broken-octave',
    fragment: 'dune-field',
    accentColour: PALETTE.goldDim,
    edges: [
      { to: 'verdant-machine', kind: 'chord', label: 'the dry line' },
      { to: 'ember-observatory', kind: 'harmonic', label: 'the ash line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: OUTER_CONSTELLATION_THRESHOLD,
      hint: 'Restore any two planetary nodes and the outer constellation resolves.',
    },
    recommendedForms: ['bloom', 'choir'],
    recommendationNote:
      'Inside the null field every cue you get is drawn, not heard. Bring eyes, not a form.',
    harmonicDegree: 7,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(7, 0),
  },

  // -------------------------------------------------------------------------
  // The finale
  // -------------------------------------------------------------------------
  {
    stageId: 'orbital-dissonance',
    kind: 'ascent',
    displayName: 'Orbital Dissonance',
    subtitle: 'The relay above the sky',
    commanderName: null,
    commanderTitle: null,
    awardsForm: null,
    description:
      'The severed line, followed upward: a ring of amplifier arrays in freefall ' +
      'around the world, holding the false pitch steady from outside it.',
    infection: 0.95,
    position: { x: 0, y: 92 },
    constellation: 'The Cut String',
    glyph: 'orbit-of-eight',
    fragment: 'array-ring',
    accentColour: PALETTE.infection,
    edges: [
      { to: 'hollow-choir', kind: 'severed', label: 'cut' },
      { to: 'ember-observatory', kind: 'severed', label: 'cut' },
      { to: 'celestial-loom', kind: 'ascent', label: 'the last line' },
    ],
    unlock: {
      requiresStages: ['fallen-sanctuary'],
      requiresRestoredNodes: 7,
      hint: 'Seven nodes must ring true before the cut line grows back far enough to climb.',
    },
    recommendedForms: ['echo', 'prism', 'tidal', 'ember', 'choir', 'bloom', 'silence'],
    recommendationNote:
      'Everything you took back is a way through here. There is no arrangement that fails.',
    harmonicDegree: 0,
    harmonicOctave: -1,
    recoveredFrequency: latticeFrequencyLabel(0, -1),
  },
  {
    stageId: 'celestial-loom',
    kind: 'loom',
    displayName: 'The Celestial Loom',
    subtitle: 'Where the chord was woven',
    commanderName: 'The First Conductor',
    commanderTitle: 'Serren, who tuned before anyone',
    awardsForm: 'celestial',
    description:
      'The frame the World Chord was strung on, still turning, with one Keeper ' +
      'standing at it holding a note the world has been missing since the start.',
    infection: 1,
    position: { x: 0, y: 128 },
    constellation: 'The Loom',
    glyph: 'nested-rings-of-eight',
    fragment: 'woven-frame',
    accentColour: PALETTE.gold,
    edges: [{ to: 'orbital-dissonance', kind: 'ascent', label: 'the last line' }],
    unlock: {
      requiresStages: ['orbital-dissonance'],
      requiresRestoredNodes: 7,
      hint: 'Climb the cut line first. The Loom is only reachable from above.',
    },
    recommendedForms: ['echo', 'prism', 'tidal', 'ember', 'choir', 'bloom', 'silence'],
    recommendationNote:
      'The Loom answers whatever it is played. Bring the arrangement that sounds like you.',
    harmonicDegree: 0,
    harmonicOctave: 0,
    recoveredFrequency: latticeFrequencyLabel(0, 0),
  },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const LATTICE_BY_STAGE: ReadonlyMap<StageId, LatticeNode> = new Map(
  WORLD_LATTICE.map((node) => [node.stageId, node] as const),
);

export function getLatticeNode(stageId: StageId): LatticeNode | undefined {
  return LATTICE_BY_STAGE.get(stageId);
}

/**
 * Every node held by a Commander — the seven planetary ones and the Loom.
 * Eight in total, which is exactly what Keeper Ovel counts off the diagram the
 * first time the player sees it.
 */
export function getCommanderNodes(): readonly LatticeNode[] {
  return WORLD_LATTICE.filter((node) => node.commanderName !== null);
}

/** The seven Commanders whose Frequency Cores become Resonance Forms. */
export function getPlanetaryCommanderNodes(): readonly LatticeNode[] {
  return WORLD_LATTICE.filter((node) => node.kind === 'planetary');
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/** How many of the seven planetary nodes the player has restored. */
export function countRestoredNodes(completed: readonly StageId[]): number {
  const done = new Set<StageId>(completed);
  return PLANETARY_STAGE_IDS.filter((id) => done.has(id)).length;
}

function isUnlocked(node: LatticeNode, done: ReadonlySet<StageId>, restored: number): boolean {
  if (restored < node.unlock.requiresRestoredNodes) return false;
  return node.unlock.requiresStages.every((id) => done.has(id));
}

/**
 * Every region the player may currently enter, in map order.
 *
 * Completed regions stay in the list: restored nodes are replayable, and the
 * revisit — with forms the region was never designed around — is a first-class
 * part of the game rather than a leftover.
 */
export function getAvailableStages(completed: readonly StageId[]): readonly StageId[] {
  const done = new Set<StageId>(completed);
  const restored = countRestoredNodes(completed);
  return WORLD_LATTICE.filter((node) => isUnlocked(node, done, restored)).map(
    (node) => node.stageId,
  );
}

export function isStageUnlocked(stageId: StageId, completed: readonly StageId[]): boolean {
  const node = LATTICE_BY_STAGE.get(stageId);
  if (node === undefined) return false;
  return isUnlocked(node, new Set<StageId>(completed), countRestoredNodes(completed));
}

/**
 * Regions that light up as a direct result of finishing `justCompleted`.
 *
 * The results screen uses this to say what opened, which is the moment the
 * lattice earns its place: the diagram redraws and new lines resolve out of the
 * dark while the player is still catching their breath.
 */
export function getNewlyUnlockedStages(
  completedBefore: readonly StageId[],
  justCompleted: StageId,
): readonly StageId[] {
  const before = new Set<StageId>(getAvailableStages(completedBefore));
  const after = getAvailableStages([...completedBefore, justCompleted]);
  return after.filter((id) => !before.has(id));
}

/** Forms the player will hold if they have restored exactly these regions. */
export function getAwardedForms(completed: readonly StageId[]): readonly ResonanceFormId[] {
  const done = new Set<StageId>(completed);
  const forms: ResonanceFormId[] = ['base'];
  for (const node of WORLD_LATTICE) {
    if (node.awardsForm !== null && node.awardsForm !== 'base' && done.has(node.stageId)) {
      forms.push(node.awardsForm);
    }
  }
  return forms;
}

/** Fraction of the world restored, in [0, 1]. Drives the Sanctuary's evolution. */
export function getRestorationProgress(completed: readonly StageId[]): number {
  const done = new Set<StageId>(completed);
  const total = WORLD_LATTICE.length;
  if (total === 0) return 0;
  return WORLD_LATTICE.filter((node) => done.has(node.stageId)).length / total;
}
