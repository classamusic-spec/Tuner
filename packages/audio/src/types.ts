import type { ResonanceFormId, StageId, Vec3 } from '@tuner/shared';

/**
 * The audio contract.
 *
 * `@tuner/game-core` requests sound through this interface and never touches
 * Web Audio directly, so the same simulation runs under a native mobile adapter
 * or a silent null adapter in tests.
 *
 * Design rule enforced across the codebase: every gameplay-critical audio cue
 * also emits a presentation event that the renderer turns into a visual. The
 * critical path must be completable with sound off.
 */

export type MixBus = 'master' | 'music' | 'sfx' | 'ui' | 'voice' | 'ambience';

export interface AudioLevels {
  master: number;
  music: number;
  sfx: number;
  ui: number;
  voice: number;
  ambience: number;
}

export const DEFAULT_AUDIO_LEVELS: AudioLevels = Object.freeze({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  ui: 0.7,
  voice: 0.9,
  ambience: 0.5,
});

/** One-shot sound effects. */
export type SfxId =
  | 'pulse-fire'
  | 'charge-start'
  | 'charge-tier'
  | 'charge-release'
  | 'burst'
  | 'counter-success'
  | 'counter-fail'
  | 'hit-enemy'
  | 'hit-armour'
  | 'hit-player'
  | 'enemy-cleansed'
  | 'jump'
  | 'double-jump'
  | 'dash'
  | 'land'
  | 'wall-cling'
  | 'rail-attach'
  | 'bounce'
  | 'pickup-shard'
  | 'pickup-major'
  | 'checkpoint'
  | 'form-switch'
  | 'form-acquire'
  | 'puzzle-note'
  | 'puzzle-solve'
  | 'puzzle-fail'
  | 'boss-phase'
  | 'boss-telegraph'
  | 'restoration'
  | 'ui-move'
  | 'ui-confirm'
  | 'ui-cancel'
  | 'low-coherence';

/** Adaptive music layers, crossfaded by gameplay state. */
export type MusicLayer =
  | 'world'
  | 'movement'
  | 'combat'
  | 'miniboss'
  | 'commander'
  | 'lowCoherence'
  | 'restoration'
  | 'sanctuary'
  | 'worldChord';

export interface MusicState {
  readonly stage: StageId | 'sanctuary';
  /** Per-layer target gains in [0, 1]. */
  readonly layers: Readonly<Partial<Record<MusicLayer, number>>>;
  /**
   * How detuned the region currently is, in [0, 1]. 0 is a pure 432 Hz world
   * chord; 1 is fully shifted to the Detuners' 440 Hz.
   */
  readonly detune: number;
  /** Musical intensity in [0, 1], driven by combat pressure. */
  readonly intensity: number;
}

export interface PlaySfxOptions {
  /** World position for panning and distance attenuation. */
  readonly position?: Vec3;
  readonly volume?: number;
  /** Playback-rate multiplier. */
  readonly rate?: number;
  /** Overrides the pitch with an explicit frequency in Hz. */
  readonly hz?: number;
  /** Selects the acting form's sound family. */
  readonly form?: ResonanceFormId;
  /**
   * Transposes the pitch up by a just-intonation harmonic degree, on top of
   * whatever root `form` or `hz` selected.
   *
   * This exists so a charge tier and an ability can both be audible at once.
   * Sending the tier as `hz` instead would silence the form's own pitch, since
   * `hz` replaces the root rather than moving it — the form would survive only
   * as timbre.
   */
  readonly degree?: number;
}

export interface AudioEngine {
  /** Browsers gate audio behind a gesture; call this from a real interaction. */
  unlock(): Promise<void>;
  readonly isUnlocked: boolean;

  playSfx(id: SfxId, options?: PlaySfxOptions): void;
  /** Starts a looping sound and returns a handle for stopping it. */
  playLoop(id: SfxId, options?: PlaySfxOptions): AudioLoopHandle;

  setMusicState(state: MusicState): void;
  /** Fades all music out over `seconds`. */
  stopMusic(seconds?: number): void;

  setLevels(levels: Partial<AudioLevels>): void;
  readonly levels: Readonly<AudioLevels>;

  /** Moves the virtual listener for positional audio. */
  setListener(position: Vec3, forwardYaw: number): void;

  /** Called when the app is backgrounded so mobile lifecycles behave. */
  suspend(): void;
  resume(): void;
  dispose(): void;

  /**
   * Current per-layer analysis, in [0, 1], for the accessibility rhythm
   * visualiser. Implementations without analysis return zeroes.
   */
  getVisualiserLevels(): { readonly beat: number; readonly bass: number; readonly lead: number };
}

/** Handle to a running loop. */
export interface AudioLoopHandle {
  stop(fadeSeconds?: number): void;
  setVolume(volume: number): void;
  setPosition(position: Vec3): void;
  readonly isRunning: boolean;
}

/** A no-op engine. Used in tests, in headless builds, and when audio fails to
 *  initialise — the game must remain fully playable in that case. */
export function createNullAudioEngine(): AudioEngine {
  let levels: AudioLevels = { ...DEFAULT_AUDIO_LEVELS };
  return {
    unlock: async () => {},
    isUnlocked: true,
    playSfx: () => {},
    playLoop: () => ({
      stop: () => {},
      setVolume: () => {},
      setPosition: () => {},
      isRunning: false,
    }),
    setMusicState: () => {},
    stopMusic: () => {},
    setLevels: (next) => {
      levels = { ...levels, ...next };
    },
    get levels() {
      return levels;
    },
    setListener: () => {},
    suspend: () => {},
    resume: () => {},
    dispose: () => {},
    getVisualiserLevels: () => ({ beat: 0, bass: 0, lead: 0 }),
  };
}
