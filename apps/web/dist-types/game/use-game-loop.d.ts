import { type EventBus, type StageId } from '@tuner/shared';
import { type InputManager, type TouchInputSource } from '@tuner/input';
import { type CameraState, type GameCore, type GameEvents } from '@tuner/game-core';
import { createAdaptiveQualityController } from '@tuner/platform';
/**
 * The frame loop.
 *
 * The host owns wall-clock time; the simulation owns fixed steps. Each frame
 * feeds the real elapsed delta into `FixedStepDriver`, which runs zero or more
 * 1/60 s simulation steps. That separation is why a dash covers the same
 * distance at 30, 60 and 144 fps.
 *
 * Nothing here puts world state into React state. The world is read through refs
 * and the renderer drives Three.js objects inside `useFrame` — a game that
 * re-renders React sixty times a second spends its budget on reconciliation.
 */
export interface GameLoopHandle {
    readonly core: GameCore | null;
    readonly events: EventBus<GameEvents>;
    readonly input: InputManager | null;
    readonly touch: TouchInputSource | null;
    readonly camera: CameraState;
    readonly quality: ReturnType<typeof createAdaptiveQualityController>;
    readonly ready: boolean;
    readonly error: Error | null;
    /** Frames rendered since boot, for the E2E diagnostics surface. */
    readonly frames: {
        current: number;
    };
    start(stageId: StageId): void;
    stop(): void;
    setPaused(paused: boolean): void;
    readonly isPaused: () => boolean;
}
export declare function useGameLoop(target: HTMLElement | null): GameLoopHandle;
//# sourceMappingURL=use-game-loop.d.ts.map