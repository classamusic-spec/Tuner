import type { ResonanceFormId, StageId, Vec3 } from '@tuner/shared';
import type { ColliderShape } from '@tuner/physics';

/**
 * The adventure layer.
 *
 * The original content schema described a *stage*: an authored route from an
 * entrance to a guardian. An adventure needs more than a route — it needs people
 * to meet, reasons to go somewhere, places that reward curiosity rather than
 * completion, and a world that remembers what you did to it.
 *
 * This module is deliberately **additive**. Every existing `StageDef` remains
 * valid; a zone is a stage plus inhabitants, quests, temples and shrines. That
 * keeps the two authored regions working while the format grows, rather than
 * invalidating them and rebuilding from nothing.
 *
 * Naming note, because it matters for saves: the eight ability *ids* are
 * unchanged (`echo`, `prism`, `tidal`, `ember`, `choir`, `bloom`, `silence`,
 * `celestial`). They appear verbatim in save files and in authored content, so
 * they are treated as stable keys. Their player-facing names are what the design
 * calls them — Echo Pulse, Mirror Tone, Resonance Thread, Pulse Step, Split
 * Chord, Bloom Wave, Silence Field, World Chord. `ABILITY_NAMES` below is the
 * single place that mapping lives.
 */

/** Player-facing name for each ability id. The ids are save keys; these are not. */
export const ABILITY_NAMES: Readonly<Record<ResonanceFormId, string>> = {
  base: 'Open Chord',
  echo: 'Echo Pulse',
  prism: 'Mirror Tone',
  tidal: 'Resonance Thread',
  ember: 'Pulse Step',
  choir: 'Split Chord',
  bloom: 'Bloom Wave',
  silence: 'Silence Field',
  celestial: 'World Chord',
};

/** Which region teaches each ability, and in which temple. */
export interface AbilitySource {
  readonly ability: ResonanceFormId;
  readonly region: StageId;
  readonly temple: string;
  readonly guardian: string;
}

export const ABILITY_SOURCES: readonly AbilitySource[] = [
  {
    ability: 'echo',
    region: 'fractured-garden',
    temple: 'temple-of-the-first-breath',
    guardian: 'oru-fractured-colossus',
  },
  {
    ability: 'prism',
    region: 'glass-meridian',
    temple: 'meridian-engine',
    guardian: 'the-prism-conductor',
  },
  {
    ability: 'tidal',
    region: 'tidal-archive',
    temple: 'archive-beneath',
    guardian: 'the-mnemonic-ray',
  },
  {
    ability: 'ember',
    region: 'ember-observatory',
    temple: 'clock-of-fire',
    guardian: 'the-red-amplifier',
  },
  {
    ability: 'choir',
    region: 'hollow-choir',
    temple: 'cathedral-of-returning-voices',
    guardian: 'the-many-mouthed-conductor',
  },
  {
    ability: 'bloom',
    region: 'verdant-machine',
    temple: 'seed-engine',
    guardian: 'the-root-parasite',
  },
  {
    ability: 'silence',
    region: 'desert-of-lost-notes',
    temple: 'buried-resonator',
    guardian: 'the-sound-eater',
  },
];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** How an NPC behaves when the player is not talking to them. */
export type NpcRoutine =
  | { readonly kind: 'idle' }
  | { readonly kind: 'patrol'; readonly points: readonly Vec3[]; readonly speed: number }
  | { readonly kind: 'work'; readonly facing: number }
  /** Follows the player at a distance — companions and rescued survivors. */
  | { readonly kind: 'follow'; readonly distance: number };

export interface NpcDef {
  readonly id: string;
  readonly displayName: string;
  /** Procedural model key: how the renderer builds them. */
  readonly appearance: string;
  readonly position: Vec3;
  readonly yaw?: number;
  readonly routine?: NpcRoutine;
  /** Dialogue offered when the player interacts. Resolved against quest state. */
  readonly dialogue: readonly string[];
  /** Present only once this flag is set — arrivals, rescues, story beats. */
  readonly requiresFlag?: string;
  /** Removed once this flag is set — departures. */
  readonly hiddenByFlag?: string;
  /** NPCs visibly change after their region is restored. */
  readonly restoredAppearance?: string;
  readonly restoredDialogue?: readonly string[];
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

/**
 * One beat of conversation.
 *
 * Every line is subtitled text first and voice second — there is no recorded
 * voice, and the game must be fully understandable muted, so text is the
 * primary channel rather than a caption on top of one.
 */
export interface DialogueBeat {
  readonly speaker: string;
  readonly text: string;
  /** Portrait/emote key for the renderer. */
  readonly emote?: string;
  /** Seconds to hold if the player does not advance. */
  readonly seconds?: number;
}

export interface DialogueChoice {
  readonly text: string;
  /** Beat index to jump to, or null to end the conversation. */
  readonly goTo: number | null;
  readonly setsFlag?: string;
  readonly requiresFlag?: string;
}

export interface DialogueTree {
  readonly id: string;
  readonly beats: readonly DialogueBeat[];
  /** Optional branch offered after the final beat. */
  readonly choices?: readonly DialogueChoice[];
  /** Only offered while this flag is set. */
  readonly requiresFlag?: string;
  /** Skipped once this flag is set — so a hint does not repeat forever. */
  readonly consumedByFlag?: string;
  readonly setsFlagOnComplete?: string;
  /** Grants an ability on completion — how a temple hands one over. */
  readonly grantsAbility?: ResonanceFormId;
  /** Starts or advances a quest. */
  readonly startsQuest?: string;
  readonly completesQuest?: string;
  /** Takes the camera; ambient chatter does not. */
  readonly cinematic?: boolean;
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export type QuestStepCondition =
  | { readonly kind: 'flag'; readonly flag: string }
  | { readonly kind: 'reachArea'; readonly triggerId: string }
  | { readonly kind: 'collect'; readonly contentId: string; readonly count: number }
  | { readonly kind: 'cleanse'; readonly archetype: string; readonly count: number }
  | { readonly kind: 'solvePuzzle'; readonly puzzleId: string }
  | { readonly kind: 'defeatBoss'; readonly bossId: string }
  | { readonly kind: 'talkTo'; readonly npcId: string };

export interface QuestStep {
  readonly id: string;
  /** Shown in the HUD and the quest log. One line, plainly worded. */
  readonly objective: string;
  readonly condition: QuestStepCondition;
  /** Optional steps do not block the quest. */
  readonly optional?: boolean;
  /** Where to point the optional navigation assist. */
  readonly hintPosition?: Vec3;
}

export interface QuestDef {
  readonly id: string;
  readonly title: string
  readonly summary: string;
  readonly region: StageId;
  readonly steps: readonly QuestStep[];
  readonly main?: boolean;
  readonly rewardsAbility?: ResonanceFormId;
  readonly setsFlagOnComplete?: string;
}

// ---------------------------------------------------------------------------
// Temples and shrines
// ---------------------------------------------------------------------------

/**
 * A temple room.
 *
 * Temples follow a fixed teaching curve — introduce, experiment, combine with
 * traversal, combine with enemies, add pressure, then the central puzzle. Naming
 * the beat each room serves keeps that structure honest rather than aspirational,
 * and the temple test asserts every beat is present.
 */
export type TempleBeat =
  | 'introduce'
  | 'experiment'
  | 'traversal'
  | 'combat'
  | 'pressure'
  | 'central'
  | 'secret'
  | 'miniboss'
  | 'recontextualise'
  | 'guardian';

export interface TempleRoomDef {
  readonly id: string;
  readonly beat: TempleBeat;
  readonly name: string;
  /** What the room is teaching, in one sentence, for the design record. */
  readonly intent: string;
  readonly entryTriggerId: string;
  readonly puzzleIds?: readonly string[];
  readonly enemySpawnIds?: readonly string[];
  readonly checkpointId?: string;
}

export interface TempleDef {
  readonly id: string;
  readonly displayName: string;
  readonly region: StageId;
  /** The ability this temple teaches and then tests. */
  readonly teaches: ResonanceFormId;
  readonly rooms: readonly TempleRoomDef[];
  readonly miniBossId?: string;
  readonly guardianId: string;
  /** Harmonic degrees of the region's restoration chord. */
  readonly restorationChord: readonly number[];
}

export interface ShrineDef {
  readonly id: string;
  readonly displayName: string;
  readonly region: StageId;
  readonly position: Vec3;
  readonly shape: ColliderShape;
  /** Optional shrines reward curiosity; none is required to finish. */
  readonly puzzleId?: string;
  readonly rewardContentId?: string;
  /** Shrines that accept a player composition rather than a fixed answer. */
  readonly acceptsComposition?: boolean;
}

// ---------------------------------------------------------------------------
// Map, codex, and composition
// ---------------------------------------------------------------------------

export type MapMarkerKind =
  | 'temple'
  | 'shrine'
  | 'village'
  | 'camp'
  | 'cave'
  | 'tower'
  | 'crash-site'
  | 'guardian'
  | 'sanctuary';

export interface MapMarkerDef {
  readonly id: string;
  readonly kind: MapMarkerKind;
  readonly region: StageId;
  readonly position: Vec3;
  readonly label: string;
  /** Hidden until the player has been near it — the map is a record, not a guide. */
  readonly discoveredByTriggerId?: string;
}

export interface CodexEntryDef {
  readonly id: string;
  readonly category: 'world' | 'people' | 'creatures' | 'resonance' | 'memory';
  readonly title: string;
  readonly body: string;
  readonly unlockedByFlag?: string;
}

/**
 * A motif card — the unit of Composition Mode.
 *
 * Motifs are *found*, not authored by the player from nothing. That is the point:
 * the world teaches you its phrases and Composition Mode is where you answer
 * back with them.
 */
export interface MotifCardDef {
  readonly id: string;
  readonly name: string;
  readonly region: StageId;
  readonly layer: 'rhythm' | 'bass' | 'harmony' | 'melody';
  /** Harmonic degrees, one per step. Null is a rest. */
  readonly steps: readonly (number | null)[];
  /** Steps per bar this motif is written against. */
  readonly stepsPerBar: number;
  readonly foundAt?: string;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * A region of the world.
 *
 * `stage` is the existing authored geometry, hazards, puzzles and enemies — the
 * format is unchanged, so both existing regions remain valid. Everything else
 * here is what turns a route into a place.
 */
export interface ZoneDef {
  readonly id: StageId;
  readonly displayName: string;
  /** The playable space, in the established StageDef format. */
  readonly stageId: StageId;
  readonly npcs: readonly NpcDef[];
  readonly dialogue: readonly DialogueTree[];
  readonly quests: readonly QuestDef[];
  readonly temples: readonly TempleDef[];
  readonly shrines: readonly ShrineDef[];
  readonly markers: readonly MapMarkerDef[];
  readonly codex: readonly CodexEntryDef[];
  readonly motifs: readonly MotifCardDef[];
  /** Regions reachable from here, for the world lattice. */
  readonly connections: readonly StageId[];
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface QuestProgress {
  readonly questId: string;
  /** Completed step ids. */
  readonly completedSteps: readonly string[];
  readonly complete: boolean;
}

export interface DialogueState {
  readonly treeId: string;
  readonly beatIndex: number;
  /** True while awaiting a branch choice. */
  readonly awaitingChoice: boolean;
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly DialogueChoice[];
}

/** The adventure-layer slice of world state, exposed read-only like the rest. */
export interface AdventureState {
  readonly activeDialogue: DialogueState | null;
  readonly quests: readonly QuestProgress[];
  /** Objectives currently shown in the HUD, most recent first. */
  readonly activeObjectives: readonly string[];
  readonly discoveredMarkers: readonly string[];
  readonly unlockedCodex: readonly string[];
  readonly collectedMotifs: readonly string[];
  /** NPC the player is standing close enough to talk to. */
  readonly interactionTarget: { readonly npcId: string; readonly prompt: string } | null;
}
