import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { QUALITY_PRESETS } from '@tuner/platform';
import { TunerScene } from '@tuner/rendering';
import {
  AccessibilityScreen,
  BootScreen,
  CreditsScreen,
  HUD,
  PauseScreen,
  ResultsScreen,
  SettingsScreen,
  TitleScreen,
  TouchControls,
  useUIStore,
} from '@tuner/ui';
import type { WorldState } from '@tuner/game-core';
import { useGameLoop } from './game/use-game-loop.js';
import { useSettingsPersistence } from './game/use-settings-persistence.js';

/**
 * The web host.
 *
 * It owns three things and nothing else: the frame loop, the screen the player
 * is looking at, and the wiring between the simulation's event bus and the
 * interface. The game's rules live in `@tuner/game-core`, the picture in
 * `@tuner/rendering`, the interface in `@tuner/ui`.
 */

/** How often the HUD is allowed to re-render, in milliseconds.
 *  The HUD needs Coherence and charge tier — it does not need 60 Hz. Throttling
 *  it keeps React out of the frame budget while still feeling immediate. */
const HUD_REFRESH_MS = 100;

export function App(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const loop = useGameLoop(target);
  // Restored before the title screen appears, so a player who needs reduced
  // motion or larger text never sees a frame without it.
  const settings = useSettingsPersistence();

  const screen = useUIStore((s) => s.screen);
  const navigate = useUIStore((s) => s.navigate);
  const replace = useUIStore((s) => s.replace);
  const paused = useUIStore((s) => s.paused);
  const setPausedUI = useUIStore((s) => s.setPaused);
  const accessibility = useUIStore((s) => s.accessibility);
  const tierOverride = useUIStore((s) => s.graphicsTier);
  const difficulty = useUIStore((s) => s.difficulty);

  useEffect(() => {
    setTarget(containerRef.current);
  }, []);

  // The interface's own settings are the source of truth; push them into the
  // simulation whenever they change.
  useEffect(() => {
    loop.core?.setAccessibility(accessibility);
  }, [loop, accessibility]);

  useEffect(() => {
    loop.core?.setDifficulty(difficulty);
  }, [loop, difficulty]);

  useEffect(() => {
    if (loop.ready && settings.loaded && screen === 'boot') replace('title');
  }, [loop.ready, settings.loaded, screen, replace]);

  // Presentation events -> interface. The simulation announces; the UI listens.
  useEffect(() => {
    const store = useUIStore.getState();
    const unsubscribes = [
      loop.events.on('ui:notification', ({ text, seconds }) => {
        store.notify(text, seconds ?? 3);
      }),
      loop.events.on('ui:subtitle', ({ speaker, text, seconds }) => {
        store.showSubtitle(speaker, text, seconds);
      }),
      loop.events.on('stage:objectiveChanged', ({ objective }) => {
        store.setObjective(objective);
      }),
      loop.events.on('world:secretFound', () => {
        store.notify('Secret found', 2.5);
      }),
      loop.events.on('world:checkpointActivated', () => {
        store.notify('Checkpoint', 2);
      }),
      loop.events.on('form:acquired', ({ commanderName }) => {
        store.notify(`Frequency Core recovered from ${commanderName}`, 5);
      }),
      loop.events.on('boss:defeated', () => {
        const result = loop.core?.computeResult() ?? null;
        store.setResult(result);
        store.navigate('results');
      }),
    ];
    return () => {
      for (const off of unsubscribes) off();
    };
  }, [loop]);

  // Expire notifications and subtitles on a slow timer, not per frame.
  useEffect(() => {
    const id = setInterval(() => {
      const store = useUIStore.getState();
      // Entries carry a duration; convert to an absolute deadline by counting
      // down here, which keeps the store free of any clock of its own.
      store.tick(0);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const startGame = useCallback(() => {
    replace('playing');
    loop.start('fallen-sanctuary');
  }, [loop, replace]);

  const resume = useCallback(() => {
    setPausedUI(false);
    loop.setPaused(false);
  }, [loop, setPausedUI]);

  const pause = useCallback(() => {
    setPausedUI(true);
    loop.setPaused(true);
  }, [loop, setPausedUI]);

  // Pause must be reachable at any time, including mid-cutscene.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape') return;
      if (screen !== 'playing') return;
      event.preventDefault();
      if (paused) resume();
      else pause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, paused, pause, resume]);

  // Diagnostics surface for the end-to-end tests. Deliberately read-only: it
  // reports what the game is doing and can never change it.
  useEffect(() => {
    const diagnostics = {
      get ready() {
        return loop.ready;
      },
      get frames() {
        return loop.frames.current;
      },
      get tick() {
        return loop.core?.state.tick ?? 0;
      },
      get screen() {
        return useUIStore.getState().screen;
      },
      get playerPosition() {
        const p = loop.core?.state.player.position;
        return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
      },
      get stageId() {
        return loop.core?.stageDef?.id ?? null;
      },
      get errors() {
        return loop.error ? [loop.error.message] : [];
      },
    };
    (window as unknown as { __tuner?: typeof diagnostics }).__tuner = diagnostics;
    return () => {
      delete (window as unknown as { __tuner?: unknown }).__tuner;
    };
  }, [loop]);

  if (loop.error) {
    return (
      <div data-testid="tuner-root" className="tuner-boot">
        <div className="tuner-error">
          <h1 className="tuner-boot__title" style={{ letterSpacing: '0.1em', textIndent: 0 }}>
            The signal broke
          </h1>
          <pre>{loop.error.message}</pre>
        </div>
      </div>
    );
  }

  const quality = QUALITY_PRESETS[tierOverride];
  const stageDef = loop.core?.stageDef ?? null;
  const showWorld = screen === 'playing' || screen === 'results';

  return (
    <div
      ref={containerRef}
      data-testid="tuner-root"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none' }}
    >
      {showWorld && stageDef && loop.core && (
        <Canvas
          dpr={[1, quality.maxPixelRatio]}
          shadows={quality.shadowMapSize > 0}
          gl={{ antialias: tierOverride !== 'low', powerPreference: 'high-performance' }}
          camera={{ fov: 62, near: 0.1, far: quality.drawDistance }}
        >
          <WorldView loop={loop} />
        </Canvas>
      )}

      {screen === 'boot' && <BootScreen status="Listening for the World Chord…" />}
      {screen === 'title' && <TitleScreen onNewJourney={startGame} />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'accessibility' && <AccessibilityScreen />}
      {screen === 'credits' && <CreditsScreen />}
      {screen === 'saveSlots' && <SaveSlotsPlaceholder onBack={() => navigate('title')} />}
      {screen === 'results' && (
        <ResultsScreen
          onContinue={() => {
            loop.stop();
            replace('title');
          }}
        />
      )}

      {screen === 'playing' && loop.core && <ThrottledHUD loop={loop} />}
      {screen === 'playing' && paused && (
        <PauseScreen
          onResume={resume}
          onRestartCheckpoint={() => {
            loop.core?.respawn();
            resume();
          }}
          onQuit={() => {
            loop.stop();
            setPausedUI(false);
            replace('title');
          }}
        />
      )}

      {/*
        Only on touch-capable devices. Drawing thumb buttons over a desktop
        screen is not a harmless extra — it covers the HUD and tells the player
        the wrong thing about how to play.
      */}
      {screen === 'playing' && loop.touch && loop.hasTouch && (
        <TouchControls visual={loop.touch.visual} opacity={0.7} />
      )}
    </div>
  );
}

/**
 * Bridges the simulation into the R3F scene.
 *
 * The world is read fresh every frame and handed to `TunerScene` through a ref,
 * so nothing here causes a React render.
 */
function WorldView({ loop }: { loop: ReturnType<typeof useGameLoop> }): ReactElement | null {
  const core = loop.core;
  const tier = useUIStore((s) => s.graphicsTier);
  const accessibility = useUIStore((s) => s.accessibility);
  const [, force] = useState(0);
  const worldRef = useRef<WorldState | null>(core?.state ?? null);

  // One render when the stage arrives, then never again from gameplay.
  useEffect(() => {
    if (core?.stageDef) force((n) => n + 1);
  }, [core?.stageDef]);

  useFrame(() => {
    if (core) worldRef.current = core.state;
  });

  if (!core || !core.stageDef) return null;

  return (
    <>
      <CameraRig loop={loop} />
      <TunerScene
        world={worldRef.current ?? core.state}
        stage={core.stageDef}
        tier={tier}
        accessibility={accessibility}
      />
    </>
  );
}

/** Applies the resolved camera transform to the R3F camera. */
function CameraRig({ loop }: { loop: ReturnType<typeof useGameLoop> }): null {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;

  useFrame(() => {
    const resolved = loop.camera;
    camera.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
    camera.lookAt(resolved.lookAt.x, resolved.lookAt.y, resolved.lookAt.z);
    if (camera.fov !== resolved.fov) {
      camera.fov = resolved.fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

/** Re-renders the HUD on a slow timer instead of every frame. */
function ThrottledHUD({ loop }: { loop: ReturnType<typeof useGameLoop> }): ReactElement | null {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), HUD_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const core = loop.core;
  if (!core) return null;
  return <HUD world={core.state} />;
}

function SaveSlotsPlaceholder({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <div className="tuner-boot">
      <div className="tuner-error">
        <p>
          Save slots are not wired into this build yet. The save schema, storage adapters and
          slot system exist in <code>@tuner/persistence</code>, but the screen that drives them
          has not been built, and pretending otherwise would be worse than saying so.
        </p>
        <button
          type="button"
          data-testid="slots-back"
          onClick={onBack}
          style={{
            marginTop: '1rem',
            padding: '0.6rem 1.4rem',
            background: '#1c2559',
            color: '#f5c451',
            border: '1px solid #f5c451',
            borderRadius: 8,
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
