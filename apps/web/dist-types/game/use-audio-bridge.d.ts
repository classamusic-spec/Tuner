import { type EventBus } from '@tuner/shared';
import { type AudioEngine } from '@tuner/audio';
import type { GameCore, GameEvents } from '@tuner/game-core';
export interface AudioBridge {
    readonly engine: AudioEngine | null;
    /** Call from a real user gesture; browsers gate audio behind one. */
    unlock(): void;
}
export declare function useAudioBridge(core: GameCore | null, events: EventBus<GameEvents>): AudioBridge;
//# sourceMappingURL=use-audio-bridge.d.ts.map