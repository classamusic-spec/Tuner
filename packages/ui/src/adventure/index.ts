/**
 * `@tuner/ui/adventure` — the adventure surface.
 *
 * The base package covers the *game*: title, pause, settings, accessibility,
 * results and the HUD. These are the screens the *adventure* needs — the parts
 * that only exist because there is a world to walk around in rather than a stage
 * to clear.
 *
 * Six surfaces, one rule each:
 *
 * - `DialogueView` — conversation. Text first, never over the subtitle lane,
 *   always skippable, and the advance prompt matches the device in hand.
 * - `RegionMap` — a record of where the player has been, drawn from
 *   `MapMarkerDef` data. No waypoints, no route, no arrow.
 * - `CodexScreen` — codex, bestiary and memories. Locked entries are shown as
 *   unrecorded rather than hidden, so the player can see there is more.
 * - `CompositionScreen` — a real four-layer step sequencer over found motifs. Its
 *   grid, tempo and transform logic are pure exported functions, tested in Node.
 * - `PhotoMode` — HUD off, camera freed through callbacks, framing aids, shutter.
 *   Pixel capture belongs to the host.
 * - `AbilityRadial` — nine slots on a ring, labelled from `ABILITY_NAMES`, with
 *   locked abilities drawn as locked.
 *
 * Everything here is inline SVG and plain style objects, reachable by keyboard,
 * gamepad and touch, and honours `AccessibilityConfig` from the UI store. No
 * component in this folder imports Three.js, an audio engine or the renderer.
 */

export {
  DialogueView,
  DevicePrompt,
  SpeakerPortrait,
  emoteShape,
  EMOTE_KEYS,
  SUBTITLE_LANE_REM,
  type DialogueViewProps,
} from './dialogue.js';

export {
  RegionMap,
  MarkerIcon,
  MARKER_KIND_LABELS,
  constellationLinks,
  fitProjection,
  projectPoint,
  type MapControls,
  type MapProjection,
  type RegionMapProps,
} from './map.js';

export {
  CodexScreen,
  CategoryIcon,
  CODEX_CATEGORIES,
  CATEGORY_BLURBS,
  CATEGORY_LABELS,
  codexProgress,
  type CodexCategory,
  type CodexProgress,
  type CodexScreenProps,
} from './codex.js';

export {
  CompositionScreen,
  BEATS_PER_BAR,
  DEFAULT_GRID_SIZE,
  DEFAULT_TEMPO,
  GRID_SIZES,
  LAYER_IDS,
  LAYER_META,
  MAX_TEMPO,
  MIN_TEMPO,
  SCALE_CENTRE,
  SCALE_DEGREES,
  TIMBRE_IDS,
  TIMBRE_LABELS,
  advancePlayback,
  applyTransforms,
  barDurationSeconds,
  clampTempo,
  clearAll,
  clearLayer,
  collectedCards,
  compositionSignature,
  createComposition,
  createMotifLibrary,
  cycleTimbre,
  describeComposition,
  findCard,
  isCollected,
  layerFilledSteps,
  mirrorSteps,
  motifGridSpan,
  motifStepIndices,
  noteEventsAtStep,
  normaliseGridSize,
  placeMotif,
  placementIdFor,
  removePlacement,
  renderLayerSteps,
  reverseSteps,
  setGridSize,
  setTempo,
  setTimbre,
  stepDurationSeconds,
  stepsPerBeat,
  stepsPerSecond,
  suggestArrangement,
  toggleLayerMuted,
  transformPlacement,
  wrapDegree,
  type CompositionLayerId,
  type CompositionScreenProps,
  type CompositionState,
  type GridCell,
  type LayerMeta,
  type LayerState,
  type MotifLibrary,
  type MotifPlacement,
  type NoteEvent,
  type PlaceOutcome,
  type PlacementRejection,
  type PlaybackTick,
  type TimbreId,
} from './composition.js';

export {
  PhotoMode,
  DEFAULT_PHOTO_CAMERA,
  PHOTO_LIMITS,
  clampPhotoCamera,
  isLevel,
  type PhotoCameraState,
  type PhotoFraming,
  type PhotoModeProps,
} from './photo-mode.js';

export {
  AbilityRadial,
  AbilityGlyph,
  abilityRegion,
  radialSlots,
  type AbilityRadialControls,
  type AbilityRadialProps,
  type RadialSlot,
} from './ability-radial.js';
