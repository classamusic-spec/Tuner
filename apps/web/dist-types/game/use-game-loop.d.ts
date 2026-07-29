import { type EventBus } from '@tuner/shared';
import type { DifficultyId, StageId } from '@tuner/shared';
import type { InputManager, InputSettings } from '@tuner/input';
import { type AudioEngine } from '@tuner/audio';
import { type AccessibilityConfig, type GameCore, type GameEvents } from '@tuner/game-core';
/**
 * The frame loop.
 *
 * The host owns wall-clock time; the simulation owns fixed steps. Every frame
 * feeds the real elapsed delta into `FixedStepDriver`, which runs zero or more
 * 1/60 s simulation steps and returns an interpolation factor for rendering.
 * That separation is why a dash covers the same distance at 30, 60 and 144 fps.
 *
 * Nothing here puts simulation state into React state. The world is read
 * through a ref inside the render loop, because a game that re-renders React
 * sixty times a second spends its frame budget on reconciliation rather than on
 * the game.
 */
export interface GameLoopHandle {
    readonly core: GameCore | null;
    readonly events: EventBus<GameEvents>;
    readonly audio: AudioEngine | null;
    readonly input: InputManager | null;
    /** Interpolation factor for the current render frame, in [0, 1). */
    readonly alphaRef: {
        current: number;
    };
    /** Camera yaw/pitch owned by the renderer and fed back into aiming. */
    readonly cameraRef: {
        current: {
            yaw: number;
            pitch: number;
        };
    };
    readonly ready: boolean;
    readonly error: Error | null;
    start(stageId: StageId): void;
    stop(): void;
    setPaused(paused: boolean): void;
    readonly frames: {
        current: number;
    };
}
export interface GameLoopOptions {
    difficulty: DifficultyId;
    accessibility: Partial<AccessibilityConfig>;
    inputSettings?: Partial<InputSettings>;
    /** Element the input sources attach to. Usually the canvas' container. */
    target: HTMLElement | null;
    /** Enables audio only after a real user gesture, as browsers require. */
    audioUnlocked: boolean;
}
export declare function useGameLoop(options: GameLoopOptions): GameLoopHandle;
//# sourceMappingURL=use-game-loop.d.ts.map