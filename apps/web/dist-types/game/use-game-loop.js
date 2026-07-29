import { useCallback, useEffect, useRef, useState } from 'react';
import { createEventBus, createFixedStepDriver, SIM_STEP_SECONDS, } from '@tuner/shared';
import { createKinematicWorld } from '@tuner/physics';
import { createInputManager, createKeyboardMouseSource, createGamepadSource, createTouchSource } from '@tuner/input';
import { createWebAudioEngine } from '@tuner/audio';
import { createGameCore } from '@tuner/game-core';
import { CONTENT } from '@tuner/game-content';
export function useGameLoop(options) {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);
    const eventsRef = useRef(createEventBus());
    const coreRef = useRef(null);
    const audioRef = useRef(null);
    const inputRef = useRef(null);
    const alphaRef = useRef(0);
    const cameraRef = useRef({ yaw: 0, pitch: -0.15 });
    const framesRef = useRef(0);
    const rafRef = useRef(null);
    const lastTimeRef = useRef(0);
    const pausedRef = useRef(false);
    const runningRef = useRef(false);
    const { target, difficulty, accessibility, inputSettings, audioUnlocked } = options;
    // Build the simulation and its adapters once. -----------------------------
    useEffect(() => {
        let cancelled = false;
        try {
            const physics = createKinematicWorld();
            const core = createGameCore({
                content: CONTENT,
                physics,
                events: eventsRef.current,
                difficulty,
                accessibility,
                seed: 'world-chord',
                clock: () => performance.now(),
            });
            const input = createInputManager(inputSettings);
            const audio = createWebAudioEngine();
            if (cancelled) {
                core.dispose();
                return;
            }
            coreRef.current = core;
            inputRef.current = input;
            audioRef.current = audio;
            setReady(true);
        }
        catch (cause) {
            // A failure here is fatal but must be visible, not a white screen.
            setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
        return () => {
            cancelled = true;
            coreRef.current?.dispose();
            coreRef.current = null;
            inputRef.current?.dispose();
            inputRef.current = null;
            audioRef.current?.dispose();
            audioRef.current = null;
        };
        // Difficulty and accessibility are pushed in through setters below rather
        // than rebuilding the world, so they are deliberately not dependencies.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Attach input sources to the canvas once it exists. ----------------------
    useEffect(() => {
        const input = inputRef.current;
        if (!input || !target)
            return;
        const detachers = [];
        const keyboard = createKeyboardMouseSource({ target });
        const gamepad = createGamepadSource();
        const touch = createTouchSource({ target });
        for (const source of [keyboard, gamepad, touch]) {
            input.addSource(source);
            detachers.push(source.attach());
        }
        return () => {
            for (const detach of detachers)
                detach();
            input.removeSource(keyboard);
            input.removeSource(gamepad);
            input.removeSource(touch);
        };
    }, [target, ready]);
    // Push settings changes into the live simulation. -------------------------
    useEffect(() => {
        coreRef.current?.setDifficulty(difficulty);
    }, [difficulty]);
    useEffect(() => {
        coreRef.current?.setAccessibility(accessibility);
    }, [accessibility]);
    useEffect(() => {
        if (audioUnlocked)
            void audioRef.current?.unlock();
    }, [audioUnlocked]);
    // Suspend on background so a phone does not burn battery in a pocket. -----
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) {
                pausedRef.current = true;
                coreRef.current?.setPaused(true);
                audioRef.current?.suspend();
            }
            else {
                audioRef.current?.resume();
                // Time is not replayed on resume: the accumulator restarts clean.
                lastTimeRef.current = performance.now();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);
    const stop = useCallback(() => {
        runningRef.current = false;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);
    const start = useCallback((stageId) => {
        const core = coreRef.current;
        const input = inputRef.current;
        if (!core || !input || runningRef.current)
            return;
        core.loadStage(stageId);
        pausedRef.current = false;
        core.setPaused(false);
        runningRef.current = true;
        const driver = createFixedStepDriver({ stepSeconds: SIM_STEP_SECONDS });
        lastTimeRef.current = performance.now();
        const frame = (time) => {
            if (!runningRef.current)
                return;
            rafRef.current = requestAnimationFrame(frame);
            const deltaSeconds = Math.max(0, (time - lastTimeRef.current) / 1000);
            lastTimeRef.current = time;
            framesRef.current += 1;
            if (pausedRef.current) {
                // Still drain input while paused so menu navigation works, but do
                // not advance the simulation.
                input.update(deltaSeconds);
                return;
            }
            alphaRef.current = driver.advance(deltaSeconds, (fixedDelta) => {
                const inputFrame = input.update(fixedDelta);
                core.step(fixedDelta, inputFrame);
            });
        };
        rafRef.current = requestAnimationFrame(frame);
    }, []);
    const setPaused = useCallback((paused) => {
        pausedRef.current = paused;
        coreRef.current?.setPaused(paused);
        if (paused)
            audioRef.current?.suspend();
        else
            audioRef.current?.resume();
    }, []);
    useEffect(() => stop, [stop]);
    return {
        get core() {
            return coreRef.current;
        },
        events: eventsRef.current,
        get audio() {
            return audioRef.current;
        },
        get input() {
            return inputRef.current;
        },
        alphaRef,
        cameraRef,
        ready,
        error,
        start,
        stop,
        setPaused,
        frames: framesRef,
    };
}
//# sourceMappingURL=use-game-loop.js.map