import { useEffect, useMemo, useRef } from 'react';
import { createMusicDirector, createWebAudioEngine, } from '@tuner/audio';
import { useUIStore } from '@tuner/ui';
/**
 * The audio bridge.
 *
 * The simulation never calls the audio engine. It emits `GameEvents`, and this
 * hook is one of the listeners — the renderer is the other. That is not
 * architectural neatness for its own sake: because both subscribe to the *same*
 * event, a cue cannot exist without the data a visual needs, which is what makes
 * the muted-play guarantee structural rather than a promise.
 *
 * Everything is synthesised. There are no audio files, which is why the whole
 * score can retune itself from 440 Hz to 432 Hz as a region is restored — a
 * library of baked audio could never do that.
 */
/** Enemies within this radius count toward combat pressure. */
const COMBAT_PRESSURE_RADIUS = 26;
/** Enemy count at which pressure saturates. */
const COMBAT_PRESSURE_SATURATION = 5;
/** How often the music director is re-signalled, in milliseconds.
 *  The score does not need 60 Hz — it needs to know what is happening. */
const MUSIC_TICK_MS = 120;
export function useAudioBridge(core, events) {
    const engineRef = useRef(null);
    const director = useMemo(() => createMusicDirector(), []);
    const levels = useUIStore((s) => s.audioLevels);
    // Build the engine once. If Web Audio is unavailable it returns a silent
    // object rather than throwing, so this can never break a boot.
    useEffect(() => {
        const engine = createWebAudioEngine();
        engineRef.current = engine;
        return () => {
            engine.dispose();
            engineRef.current = null;
        };
    }, []);
    useEffect(() => {
        engineRef.current?.setLevels(levels);
    }, [levels]);
    // Presentation events -> sound effects. Every one of these also has a visual
    // counterpart drawn by the renderer from the same event.
    useEffect(() => {
        const engine = () => engineRef.current;
        const offs = [
            events.on('combat:fired', ({ position, form, tier, hz }) => {
                engine()?.playSfx(tier > 0 ? 'charge-release' : 'pulse-fire', { position, form, hz });
            }),
            events.on('combat:chargeTier', ({ position, hz }) => {
                engine()?.playSfx('charge-tier', { position, hz });
            }),
            events.on('combat:burst', ({ position }) => {
                engine()?.playSfx('burst', { position });
            }),
            events.on('combat:hit', ({ position, blocked }) => {
                engine()?.playSfx(blocked ? 'hit-armour' : 'hit-enemy', { position });
            }),
            events.on('combat:enemyCleansed', ({ position }) => {
                engine()?.playSfx('enemy-cleansed', { position });
            }),
            events.on('combat:playerHurt', ({ position }) => {
                engine()?.playSfx('hit-player', { position });
            }),
            events.on('combat:countered', ({ position, success }) => {
                engine()?.playSfx(success ? 'counter-success' : 'counter-fail', { position });
            }),
            events.on('player:jumped', ({ position, doubleJump }) => {
                engine()?.playSfx(doubleJump ? 'double-jump' : 'jump', { position });
            }),
            events.on('player:dashed', ({ position }) => {
                engine()?.playSfx('dash', { position });
            }),
            events.on('player:landed', ({ position, impactSpeed }) => {
                // A gentle touchdown should not sound like a drop.
                if (impactSpeed > 6)
                    engine()?.playSfx('land', { position });
            }),
            events.on('player:wallCling', ({ position }) => {
                engine()?.playSfx('wall-cling', { position });
            }),
            events.on('player:railAttached', ({ position }) => {
                engine()?.playSfx('rail-attach', { position });
            }),
            events.on('player:bounced', ({ position }) => {
                engine()?.playSfx('bounce', { position });
            }),
            events.on('puzzle:noteStruck', ({ position, hz }) => {
                // The resonator's own pitch, so a puzzle is heard as the chord it is.
                engine()?.playSfx('puzzle-note', { position, hz });
            }),
            events.on('puzzle:solved', ({ position }) => {
                engine()?.playSfx('puzzle-solve', { position });
            }),
            events.on('puzzle:failed', ({ position }) => {
                engine()?.playSfx('puzzle-fail', { position });
            }),
            events.on('world:pickupCollected', ({ position, kind }) => {
                engine()?.playSfx(kind === 'coherence' ? 'pickup-shard' : 'pickup-major', { position });
            }),
            events.on('world:checkpointActivated', ({ position }) => {
                engine()?.playSfx('checkpoint', { position });
            }),
            events.on('form:switched', () => {
                engine()?.playSfx('form-switch');
            }),
            events.on('form:acquired', () => {
                engine()?.playSfx('form-acquire');
            }),
            events.on('boss:phaseChanged', () => {
                engine()?.playSfx('boss-phase');
            }),
            events.on('boss:telegraph', ({ position }) => {
                engine()?.playSfx('boss-telegraph', { position });
            }),
            events.on('world:restorationStep', () => {
                engine()?.playSfx('restoration');
            }),
        ];
        return () => {
            for (const off of offs)
                off();
        };
    }, [events]);
    // Drive the music director from the world, on a slow timer rather than per
    // frame — the score needs to know the situation, not the frame number.
    useEffect(() => {
        if (!core)
            return;
        let last = performance.now();
        const id = setInterval(() => {
            const engine = engineRef.current;
            if (!engine)
                return;
            const now = performance.now();
            const dt = Math.min(0.5, (now - last) / 1000);
            last = now;
            const state = core.state;
            const player = state.player;
            // Combat pressure is nearby *live* enemies, not every enemy in the region.
            let nearby = 0;
            for (const enemy of state.enemies) {
                const dx = enemy.position.x - player.position.x;
                const dz = enemy.position.z - player.position.z;
                if (dx * dx + dz * dz <= COMBAT_PRESSURE_RADIUS * COMBAT_PRESSURE_RADIUS)
                    nearby++;
            }
            const boss = state.boss;
            const phase = state.stage.phase;
            director.setSignals({
                region: state.stage.stageId,
                phase: phase,
                combatPressure: Math.min(1, nearby / COMBAT_PRESSURE_SATURATION),
                bossPresent: boss !== null && !boss.defeated,
                bossPhase: boss?.phase.index ?? 0,
                coherenceFraction: player.maxCoherence > 0 ? player.coherence / player.maxCoherence : 1,
                restorationProgress: boss?.restorationProgress ?? 0,
                playerSpeed: Math.hypot(player.velocity.x, player.velocity.z),
                infection: state.stage.infection,
                finale: false,
            });
            director.update(dt);
            engine.setMusicState(director.state());
            engine.setListener(player.position, player.yaw);
        }, MUSIC_TICK_MS);
        return () => clearInterval(id);
    }, [core, director]);
    // Mobile lifecycle: a phone in a pocket must not keep making noise.
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden)
                engineRef.current?.suspend();
            else
                engineRef.current?.resume();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);
    return {
        get engine() {
            return engineRef.current;
        },
        unlock() {
            void engineRef.current?.unlock();
        },
    };
}
//# sourceMappingURL=use-audio-bridge.js.map