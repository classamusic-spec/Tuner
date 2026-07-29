import { applyDeadzone, clamp } from '@tuner/shared';
import {
  ACTIONS,
  DEFAULT_INPUT_SETTINGS,
  createEmptyInputFrame,
  type Action,
  type ButtonState,
  type InputAccumulator,
  type InputDeviceKind,
  type InputFrame,
  type InputManager,
  type InputSettings,
  type InputSource,
} from './types.js';

/**
 * The input manager.
 *
 * Every device is flattened into one `InputFrame` per simulation step. The
 * simulation reads only that struct, which is what lets a replay, a cutscene or
 * a test drive the player by synthesising frames — and what keeps the gameplay
 * code from acquiring a dependency on any particular platform's event model.
 *
 * Edge detection lives here rather than in the sources. Sources report *held*
 * state; `pressed` and `released` are derived once, against the previous frame,
 * so every device gets identical semantics for free.
 */

/** Stick motion below this is treated as drift and does not claim the device. */
const DEVICE_SWITCH_THRESHOLD = 0.2;

export function createInputManager(settings?: Partial<InputSettings>): InputManager {
  let activeSettings: InputSettings = { ...DEFAULT_INPUT_SETTINGS, ...settings };
  const sources: InputSource[] = [];
  const detachers = new Map<InputSource, () => void>();

  const accumulator: InputAccumulator = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    held: new Set<Action>(),
    requestedFormIndex: null,
    lastDevice: 'keyboard',
  };

  // Two mutable button tables, so a frame can be produced without allocating.
  const buttons = {} as Record<Action, ButtonState>;
  const heldSeconds = {} as Record<Action, number>;
  const wasDown = {} as Record<Action, boolean>;
  for (const action of ACTIONS) {
    buttons[action] = { down: false, pressed: false, released: false, heldSeconds: 0 };
    heldSeconds[action] = 0;
    wasDown[action] = false;
  }

  let frame: InputFrame = createEmptyInputFrame();
  let frameCounter = 0;
  let overrideFrame: InputFrame | null = null;
  let lastDevice: InputDeviceKind = 'keyboard';

  const update = (deltaSeconds: number): InputFrame => {
    if (overrideFrame) {
      frame = overrideFrame;
      return frame;
    }

    // Reset the accumulator, then let every source contribute.
    accumulator.moveX = 0;
    accumulator.moveY = 0;
    accumulator.lookX = 0;
    accumulator.lookY = 0;
    accumulator.held.clear();
    accumulator.requestedFormIndex = null;

    for (const source of sources) {
      source.sample(accumulator, activeSettings, deltaSeconds);
    }

    // Dead zone, then clamp the magnitude so a diagonal is not faster than a
    // cardinal — a classic bug that makes diagonal movement strictly better.
    let moveX = applyDeadzone(accumulator.moveX, activeSettings.stickDeadzone);
    let moveY = applyDeadzone(accumulator.moveY, activeSettings.stickDeadzone);
    const magnitude = Math.hypot(moveX, moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    // Edge detection, once, for every device.
    for (const action of ACTIONS) {
      const down = accumulator.held.has(action);
      const previous = wasDown[action] ?? false;
      heldSeconds[action] = down ? (heldSeconds[action] ?? 0) + Math.max(0, deltaSeconds) : 0;
      buttons[action] = {
        down,
        pressed: down && !previous,
        released: !down && previous,
        heldSeconds: heldSeconds[action] ?? 0,
      };
      wasDown[action] = down;
    }

    // Only claim the device on meaningful input — stick drift must never flip a
    // keyboard player's on-screen prompts to a controller glyph.
    const meaningful =
      magnitude > DEVICE_SWITCH_THRESHOLD ||
      accumulator.held.size > 0 ||
      Math.abs(accumulator.lookX) > 1e-3 ||
      Math.abs(accumulator.lookY) > 1e-3 ||
      accumulator.requestedFormIndex !== null;
    if (meaningful) lastDevice = accumulator.lastDevice;

    frameCounter += 1;
    frame = {
      moveX,
      moveY,
      lookX: clamp(accumulator.lookX, -1.5, 1.5),
      lookY: clamp(accumulator.lookY, -1.5, 1.5),
      buttons,
      requestedFormIndex: accumulator.requestedFormIndex,
      lastDevice,
      frame: frameCounter,
    };
    return frame;
  };

  return {
    update,
    get current() {
      return frame;
    },
    get settings() {
      return activeSettings;
    },
    set settings(next: InputSettings) {
      activeSettings = next;
    },
    addSource(source) {
      if (!sources.includes(source)) sources.push(source);
    },
    removeSource(source) {
      const index = sources.indexOf(source);
      if (index >= 0) sources.splice(index, 1);
      const detach = detachers.get(source);
      if (detach) {
        detach();
        detachers.delete(source);
      }
    },
    dispose() {
      // Must be safe to call twice: React strict mode will.
      for (const [, detach] of detachers) detach();
      detachers.clear();
      sources.length = 0;
      overrideFrame = null;
    },
    override(next) {
      overrideFrame = next;
    },
  };
}
