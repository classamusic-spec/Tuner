import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEventBus,
  createFixedStepDriver,
  SIM_STEP_SECONDS,
  type EventBus,
  type StageId,
} from '@tuner/shared';
import { createKinematicWorld } from '@tuner/physics';
import {
  createGamepadSource,
  createInputManager,
  createKeyboardMouseSource,
  createTouchSource,
  type InputManager,
  type TouchInputSource,
} from '@tuner/input';
import {
  createCameraState,
  createGameCore,
  resolveCameraTransform,
  type CameraState,
  type GameCore,
  type GameEvents,
} from '@tuner/game-core';
import { CONTENT } from '@tuner/game-content';
import { createAdaptiveQualityController, detectCapabilities, recommendTier } from '@tuner/platform';

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
  readonly frames: { current: number };
  start(stageId: StageId): void;
  stop(): void;
  setPaused(paused: boolean): void;
  readonly isPaused: () => boolean;
}

export function useGameLoop(target: HTMLElement | null): GameLoopHandle {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const events = useMemo(() => createEventBus<GameEvents>(), []);
  const capabilities = useMemo(() => detectCapabilities(), []);
  const quality = useMemo(
    () => createAdaptiveQualityController(recommendTier(capabilities)),
    [capabilities],
  );

  // The host owns the physics world, because the camera resolver needs to
  // sphere-cast against it too. Reaching into the core for it would be worse.
  const physicsRef = useRef<ReturnType<typeof createKinematicWorld> | null>(null);
  const coreRef = useRef<GameCore | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const touchRef = useRef<TouchInputSource | null>(null);
  const cameraRef = useRef<CameraState | null>(null);
  const framesRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const pausedRef = useRef(false);
  const runningRef = useRef(false);

  // Build the simulation and its adapters once.
  useEffect(() => {
    try {
      const physics = createKinematicWorld();
      physicsRef.current = physics;
      const core = createGameCore({
        content: CONTENT,
        physics,
        events,
        difficulty: 'standard',
        seed: 'world-chord',
        accessibility: capabilities.prefersReducedMotion ? { reducedMotion: true } : {},
        clock: () => performance.now(),
      });
      coreRef.current = core;
      inputRef.current = createInputManager();
      cameraRef.current = createCameraState(core.cameraConfig);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    }

    return () => {
      coreRef.current?.dispose();
      coreRef.current = null;
      physicsRef.current = null;
      inputRef.current?.dispose();
      inputRef.current = null;
    };
  }, [events, capabilities.prefersReducedMotion]);

  // Attach input sources once the canvas exists.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !target) return;

    const keyboard = createKeyboardMouseSource({ target, usePointerLock: false });
    const gamepad = createGamepadSource();
    const touch = createTouchSource({ target });
    touchRef.current = touch;

    const detachers = [keyboard, gamepad, touch].map((source) => {
      input.addSource(source);
      return source.attach();
    });

    const applyViewport = (): void => {
      touch.setViewport(window.innerWidth, window.innerHeight);
    };
    applyViewport();
    window.addEventListener('resize', applyViewport);

    return () => {
      window.removeEventListener('resize', applyViewport);
      for (const detach of detachers) detach();
      input.removeSource(keyboard);
      input.removeSource(gamepad);
      input.removeSource(touch);
      touchRef.current = null;
    };
  }, [target, ready]);

  // Pause on background so a phone does not burn battery in a pocket.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) {
        pausedRef.current = true;
        coreRef.current?.setPaused(true);
      } else {
        lastTimeRef.current = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const stop = useCallback((): void => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const start = useCallback((stageId: StageId): void => {
    const core = coreRef.current;
    const input = inputRef.current;
    if (!core || !input) return;

    core.loadStage(stageId);
    pausedRef.current = false;
    core.setPaused(false);

    if (runningRef.current) return;
    runningRef.current = true;

    const driver = createFixedStepDriver({ stepSeconds: SIM_STEP_SECONDS });
    lastTimeRef.current = performance.now();

    const frame = (time: number): void => {
      if (!runningRef.current) return;
      rafRef.current = requestAnimationFrame(frame);

      const deltaMs = Math.max(0, time - lastTimeRef.current);
      lastTimeRef.current = time;
      framesRef.current += 1;
      quality.sample(deltaMs);

      const deltaSeconds = deltaMs / 1000;

      if (pausedRef.current) {
        // Keep draining input so menu navigation still works while paused, but
        // do not advance the simulation.
        input.update(deltaSeconds);
        return;
      }

      driver.advance(deltaSeconds, (fixedDelta) => {
        const inputFrame = input.update(fixedDelta);
        core.step(fixedDelta, inputFrame);
      });

      // Resolve the camera once per rendered frame, from the settled world.
      const camera = cameraRef.current;
      const physics = physicsRef.current;
      if (camera && physics) {
        const state = core.state;
        resolveCameraTransform({
          intent: state.camera,
          config: core.cameraConfig,
          physics,
          state: camera,
          dt: Math.min(deltaSeconds, 0.1),
          lookX: input.current.lookX,
          lookY: input.current.lookY,
          playerAirborne: !state.player.grounded,
          playerFallSpeed: state.player.velocity.y,
          reducedMotion: core.accessibilityConfig.reducedMotion,
          screenShakeScale: core.accessibilityConfig.screenShakeScale,
          tick: state.tick,
        });
      }
    };

    rafRef.current = requestAnimationFrame(frame);
  }, [quality]);

  const setPaused = useCallback((paused: boolean): void => {
    pausedRef.current = paused;
    coreRef.current?.setPaused(paused);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    get core() {
      return coreRef.current;
    },
    events,
    get input() {
      return inputRef.current;
    },
    get touch() {
      return touchRef.current;
    },
    get camera() {
      return cameraRef.current ?? createCameraState({ ...DEFAULT_CAMERA_FALLBACK });
    },
    quality,
    ready,
    error,
    frames: framesRef,
    start,
    stop,
    setPaused,
    isPaused: () => pausedRef.current,
  };
}

/** Only reached if the camera is queried before the core has been built. */
const DEFAULT_CAMERA_FALLBACK = {
  distance: 7.2,
  minDistance: 2.4,
  maxDistance: 11,
  heightOffset: 1.35,
  shoulderOffset: 0.55,
  positionSmoothing: 0.0016,
  rotationSmoothing: 0.0009,
  minPitch: -1.15,
  maxPitch: 0.72,
  baseFov: 62,
  speedFovBoost: 11,
  fovSmoothing: 0.04,
  collisionRadius: 0.34,
  autoRecentreDelay: 1.4,
  autoRecentreSpeed: 2.1,
  landingLookAhead: 0.35,
  shakeScale: 1,
};
