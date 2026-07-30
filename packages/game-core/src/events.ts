import type {
  CollectibleKind,
  DamageKind,
  EntityId,
  Rank,
  ResonanceFormId,
  StageId,
  Vec3,
} from '@tuner/shared';
import type { MovementState, ProjectileOwner, StagePhase, StageResult } from './state.js';

/**
 * Presentation events.
 *
 * The simulation emits these; rendering, audio, haptics and UI consume them.
 * This is the seam that keeps `game-core` portable — and it is also the
 * accessibility contract: **every event that carries an audio cue also carries
 * enough information for the renderer to draw an equivalent visual.**
 */
export interface GameEvents {
  // Movement -----------------------------------------------------------------
  'player:stateChanged': { from: MovementState; to: MovementState; position: Vec3 };
  'player:jumped': { position: Vec3; doubleJump: boolean; wallJump: boolean };
  'player:dashed': { position: Vec3; direction: Vec3; airborne: boolean };
  'player:landed': { position: Vec3; impactSpeed: number };
  'player:wallCling': { position: Vec3; normal: Vec3 };
  'player:railAttached': { railId: string; position: Vec3 };
  'player:railDetached': { railId: string; position: Vec3 };
  'player:bounced': { position: Vec3; strength: number };
  'player:ledgeGrabbed': { position: Vec3 };

  // Combat -------------------------------------------------------------------
  'combat:fired': {
    projectileId: EntityId;
    position: Vec3;
    direction: Vec3;
    /** Whose shot this is. Without it a listener voices a Detuner volley as the
     *  player's own attack, which is what audio did before this field existed. */
    owner: ProjectileOwner;
    form: ResonanceFormId;
    tier: number;
    hz: number;
  };
  'combat:chargeTier': { tier: number; position: Vec3; hz: number };
  'combat:burst': { position: Vec3; radius: number };
  'combat:counterWindow': { position: Vec3; opening: boolean };
  'combat:countered': {
    position: Vec3;
    success: boolean;
    /** Set when the counter converted an incoming shot into a player shot. */
    converted: boolean;
  };
  'combat:hit': {
    targetId: EntityId;
    position: Vec3;
    normal: Vec3;
    damage: number;
    kind: DamageKind;
    /** The ability that landed the hit, so the impact is voiced in its family. */
    form: ResonanceFormId;
    /** True when armour absorbed the hit — the renderer shows a deflect spark. */
    blocked: boolean;
    /** True when this damage channel was especially effective. */
    weakness: boolean;
  };
  'combat:enemyCleansed': { enemyId: EntityId; position: Vec3; archetype: string };
  'combat:playerHurt': { position: Vec3; damage: number; coherence: number; source: string };
  'combat:playerDowned': { position: Vec3 };
  'combat:lockOnChanged': { targetId: EntityId | null };

  // Forms --------------------------------------------------------------------
  'form:switched': { from: ResonanceFormId; to: ResonanceFormId };
  'form:acquired': { form: ResonanceFormId; commanderName: string };
  'form:abilityUsed': { form: ResonanceFormId; ability: string; position: Vec3 };

  // Puzzles and world --------------------------------------------------------
  'puzzle:noteStruck': { puzzleId: string; degree: number; hz: number; position: Vec3 };
  'puzzle:solved': { puzzleId: string; position: Vec3 };
  'puzzle:failed': { puzzleId: string; position: Vec3 };
  'world:checkpointActivated': { checkpointId: string; position: Vec3 };
  'world:secretFound': { contentId: string; position: Vec3 };
  'world:pickupCollected': {
    contentId: string;
    kind: CollectibleKind | 'coherence';
    amount: number;
    position: Vec3;
  };
  'world:infectionChanged': { infection: number };
  'world:restorationStep': { progress: number; region: string };

  // Boss ---------------------------------------------------------------------
  'boss:encounterStarted': { definitionId: string; displayName: string };
  'boss:phaseChanged': { definitionId: string; phaseIndex: number; phaseName: string };
  'boss:telegraph': { definitionId: string; attack: string; seconds: number; position: Vec3 };
  'boss:attackStarted': { definitionId: string; attack: string; position: Vec3 };
  'boss:vulnerable': { definitionId: string; open: boolean };
  'boss:restorationStarted': { definitionId: string };
  'boss:defeated': { definitionId: string; displayName: string; formAwarded: ResonanceFormId | null };

  // Stage flow ---------------------------------------------------------------
  'stage:phaseChanged': { stageId: StageId; from: StagePhase; to: StagePhase };
  'stage:objectiveChanged': { stageId: StageId; objective: string };
  'stage:completed': { result: StageResult };
  'stage:failed': { stageId: StageId; reason: string };
  'stage:respawned': { checkpointId: string | null; position: Vec3 };

  // Presentation-only --------------------------------------------------------
  'fx:shake': { magnitude: number; seconds: number };
  'fx:hitStop': { seconds: number };
  'fx:flash': { colour: string; seconds: number };
  'ui:notification': { text: string; icon?: string; seconds?: number };
  'ui:subtitle': { speaker: string; text: string; seconds: number };
  'ui:rankAwarded': { rank: Rank; stageId: StageId };
}

export type GameEventType = keyof GameEvents;
