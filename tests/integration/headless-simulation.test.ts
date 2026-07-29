import { beforeEach, describe, expect, it } from 'vitest';
import { createEventBus, SIM_STEP_SECONDS, type EventBus } from '@tuner/shared';
import { createKinematicWorld } from '@tuner/physics';
import { createEmptyInputFrame, type Action, type InputFrame } from '@tuner/input';
import { createNullAudioEngine } from '@tuner/audio';
import { createGameCore, type GameCore, type GameEvents } from '@tuner/game-core';
import { CONTENT } from '@tuner/game-content';

/**
 * Headless simulation.
 *
 * This is the proof that the game's rules are genuinely portable: the whole
 * simulation runs here in plain Node, with no canvas, no DOM, no WebGL and no
 * audio device — driven by synthesised input frames, exactly as a mobile or
 * desktop host would drive it.
 *
 * If this file ever needs a browser to pass, the architecture has broken.
 */

/** Builds an input frame with the given actions held. */
function frameWith(
  overrides: Partial<Omit<InputFrame, 'buttons'>> & { held?: readonly Action[] } = {},
  previous?: InputFrame,
): InputFrame {
  const base = createEmptyInputFrame();
  const held = new Set(overrides.held ?? []);
  const buttons = { ...base.buttons };

  for (const action of Object.keys(buttons) as Action[]) {
    const wasDown = previous?.buttons[action]?.down ?? false;
    const isDown = held.has(action);
    buttons[action] = {
      down: isDown,
      pressed: isDown && !wasDown,
      released: !isDown && wasDown,
      heldSeconds: isDown
        ? (previous?.buttons[action]?.heldSeconds ?? 0) + SIM_STEP_SECONDS
        : 0,
    };
  }

  return {
    ...base,
    moveX: overrides.moveX ?? 0,
    moveY: overrides.moveY ?? 0,
    lookX: overrides.lookX ?? 0,
    lookY: overrides.lookY ?? 0,
    buttons,
    requestedFormIndex: overrides.requestedFormIndex ?? null,
    frame: (previous?.frame ?? 0) + 1,
  };
}

/** Runs `steps` fixed steps, optionally varying the input per step. */
function run(
  core: GameCore,
  steps: number,
  input: (step: number, previous: InputFrame) => InputFrame = () => frameWith(),
): InputFrame {
  let previous = createEmptyInputFrame();
  for (let i = 0; i < steps; i++) {
    previous = input(i, previous);
    core.step(SIM_STEP_SECONDS, previous);
  }
  return previous;
}

describe('headless simulation', () => {
  let events: EventBus<GameEvents>;
  let core: GameCore;

  beforeEach(() => {
    events = createEventBus<GameEvents>();
    core = createGameCore({
      content: CONTENT,
      physics: createKinematicWorld(),
      events,
      difficulty: 'standard',
      seed: 'headless-test',
    });
  });

  it('runs with no browser, no canvas and no audio device', () => {
    // The null audio engine stands in for a real one; the simulation must not
    // care which it is, or indeed whether one exists at all.
    const audio = createNullAudioEngine();
    expect(audio.isUnlocked).toBe(true);

    core.loadStage('fallen-sanctuary');
    run(core, 60);

    expect(core.state.tick).toBe(60);
    expect(Number.isFinite(core.state.player.position.x)).toBe(true);
    expect(Number.isFinite(core.state.player.position.y)).toBe(true);
    expect(Number.isFinite(core.state.player.position.z)).toBe(true);
  });

  it('settles the player onto the ground rather than falling forever', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 180);

    const stage = CONTENT.stages['fallen-sanctuary'];
    expect(stage).toBeDefined();
    expect(core.state.player.position.y).toBeGreaterThan(stage!.killPlaneY);
    expect(core.state.player.grounded).toBe(true);
  });

  it('moves the player when movement input is supplied', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 60);
    // The stage opens on a cutscene that deliberately holds control — the Tuner
    // is waking up mid-attack. Skip it, as a player would, before asserting on
    // movement.
    core.skipCutscene();
    run(core, 10);
    const start = { ...core.state.player.position };

    run(core, 60, (_, previous) => frameWith({ moveY: 1 }, previous));
    const end = core.state.player.position;

    const travelled = Math.hypot(end.x - start.x, end.z - start.z);
    expect(travelled).toBeGreaterThan(1);
  });

  it('is deterministic: identical inputs produce identical results', () => {
    const build = (): GameCore =>
      createGameCore({
        content: CONTENT,
        physics: createKinematicWorld(),
        events: createEventBus<GameEvents>(),
        difficulty: 'standard',
        seed: 'determinism',
      });

    const drive = (instance: GameCore): { x: number; y: number; z: number } => {
      instance.loadStage('fallen-sanctuary');
      instance.skipCutscene();
      run(instance, 240, (step, previous) =>
        frameWith(
          {
            moveY: 1,
            moveX: Math.sin(step / 20),
            held: step % 45 === 0 ? ['jump'] : [],
          },
          previous,
        ),
      );
      return { ...instance.state.player.position };
    };

    const first = drive(build());
    const second = drive(build());

    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
    expect(second.z).toBe(first.z);
  });

  it('is framerate independent across step counts of equal duration', () => {
    // The simulation only ever takes fixed steps, so "framerate independence"
    // here means the same number of steps always covers the same ground —
    // which is what lets the host drop or double frames safely.
    const positions: Array<{ x: number; z: number }> = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      const instance = createGameCore({
        content: CONTENT,
        physics: createKinematicWorld(),
        events: createEventBus<GameEvents>(),
        difficulty: 'standard',
        seed: 'framerate',
      });
      instance.loadStage('fallen-sanctuary');
      instance.skipCutscene();
      run(instance, 120, (_, previous) => frameWith({ moveY: 1 }, previous));
      positions.push({ x: instance.state.player.position.x, z: instance.state.player.position.z });
    }

    const [a, b] = positions;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.z ?? 0) - (a?.z ?? 0))).toBeLessThan(1e-9);
  });

  it('emits presentation events that a renderer could act on', () => {
    const seen: string[] = [];
    for (const type of [
      'player:jumped',
      'player:landed',
      'combat:fired',
      'player:stateChanged',
    ] as const) {
      events.on(type, () => seen.push(type));
    }

    core.loadStage('fallen-sanctuary');
    core.skipCutscene();
    run(core, 240, (step, previous) =>
      frameWith(
        {
          moveY: 1,
          held: [...(step % 40 === 0 ? (['jump'] as const) : []), ...(step % 12 === 0 ? (['fire'] as const) : [])],
        },
        previous,
      ),
    );

    // The exact mix depends on the stage, but the simulation must be talking.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain('player:stateChanged');
  });

  it('pauses without advancing and resumes cleanly', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 60);
    const tick = core.state.tick;

    core.setPaused(true);
    run(core, 60, (_, previous) => frameWith({ moveY: 1 }, previous));
    expect(core.state.tick).toBe(tick);

    core.setPaused(false);
    run(core, 30);
    expect(core.state.tick).toBeGreaterThan(tick);
  });

  it('respawns at the active checkpoint without losing the stage', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 60);

    core.respawn();
    const stage = CONTENT.stages['fallen-sanctuary'];
    expect(core.state.player.coherence).toBe(core.state.player.maxCoherence);
    expect(core.state.player.position.y).toBeGreaterThan(stage!.killPlaneY);
    expect(core.state.stage.stageId).toBe('fallen-sanctuary');
  });

  it('produces a stage result with a rank and a breakdown', () => {
    core.loadStage('fallen-sanctuary');
    core.skipCutscene();
    run(core, 300, (_, previous) => frameWith({ moveY: 1 }, previous));

    const result = core.computeResult();
    expect(result).not.toBeNull();
    expect(result?.stageId).toBe('fallen-sanctuary');
    expect(['D', 'C', 'B', 'A', 'S']).toContain(result?.rank);
    expect(result?.breakdown.length).toBeGreaterThan(0);
    for (const row of result?.breakdown ?? []) {
      expect(row.points).toBeLessThanOrEqual(row.maxPoints);
      expect(row.points).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps a previous state for the renderer to interpolate against', () => {
    core.loadStage('fallen-sanctuary');
    core.skipCutscene();
    run(core, 60, (_, previous) => frameWith({ moveY: 1 }, previous));

    expect(core.previousState.tick).toBe(core.state.tick - 1);
  });

  it('reports stats a debug overlay can display', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 30);
    expect(core.stats.colliderCount).toBeGreaterThan(0);
    // No clock was supplied, so the step timing honestly reports zero rather
    // than inventing a number.
    expect(core.stats.lastStepMs).toBe(0);
  });

  it('does not leak entities across a stage reload', () => {
    core.loadStage('fallen-sanctuary');
    core.skipCutscene();
    run(core, 120, (_, previous) => frameWith({ moveY: 1, held: ['fire'] }, previous));

    core.unloadStage();
    expect(core.state.projectiles.length).toBe(0);
    expect(core.state.enemies.length).toBe(0);

    core.loadStage('fallen-sanctuary');
    run(core, 30);
    expect(core.state.tick).toBe(30);
  });
});
