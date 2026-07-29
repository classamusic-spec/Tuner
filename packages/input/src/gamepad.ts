import { applyDeadzone } from '@tuner/shared';
import type { InputAccumulator, InputSettings, InputSource } from './types.js';

/**
 * Gamepad support.
 *
 * Polled rather than event-driven, because that is the only thing the Gamepad
 * API offers. Every access to `navigator` is guarded so the module is safe to
 * import in Node, and connect/disconnect are handled by simply re-reading the
 * list each sample — a controller unplugged mid-fight leaves the player standing
 * still rather than running forever.
 */

/** Analogue triggers register as held past this point. */
const TRIGGER_THRESHOLD = 0.35;

export function createGamepadSource(): InputSource {
  let active = false;

  const readPads = (): (Gamepad | null)[] => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    try {
      return Array.from(navigator.getGamepads());
    } catch {
      return [];
    }
  };

  return {
    kind: 'gamepad',

    attach(): () => void {
      // Nothing to attach: the API is poll-only. Returning a no-op teardown
      // keeps the source interface uniform across devices.
      return () => {};
    },

    sample(accumulator: InputAccumulator, settings: InputSettings, deltaSeconds: number): void {
      const pads = readPads();
      let sawInput = false;

      for (const pad of pads) {
        if (!pad || !pad.connected) continue;

        const lx = applyDeadzone(pad.axes[0] ?? 0, settings.stickDeadzone);
        const ly = applyDeadzone(-(pad.axes[1] ?? 0), settings.stickDeadzone);
        const rx = applyDeadzone(pad.axes[2] ?? 0, settings.stickDeadzone);
        const ry = applyDeadzone(-(pad.axes[3] ?? 0), settings.stickDeadzone);

        if (lx !== 0 || ly !== 0) {
          accumulator.moveX += lx;
          accumulator.moveY += ly;
          sawInput = true;
        }

        if (rx !== 0 || ry !== 0) {
          const invertX = settings.invertLookX ? -1 : 1;
          const invertY = settings.invertLookY ? -1 : 1;
          // Stick look is a rate, so it must scale by dt to stay framerate
          // independent — unlike mouse deltas, which are already per-frame.
          accumulator.lookX += rx * 2.4 * settings.lookSensitivityX * invertX * deltaSeconds;
          accumulator.lookY += ry * 2.4 * settings.lookSensitivityY * invertY * deltaSeconds;
          sawInput = true;
        }

        for (let index = 0; index < pad.buttons.length; index++) {
          const button = pad.buttons[index];
          if (!button) continue;
          const pressed = button.pressed || button.value > TRIGGER_THRESHOLD;
          if (!pressed) continue;
          sawInput = true;
          const bound = settings.gamepadBindings[index];
          if (bound) accumulator.held.add(bound);
        }

        // Triggers are the primary fire on a controller, whether the platform
        // reports them as buttons 6/7 or as axes 4/5.
        const leftTrigger = pad.axes[4] ?? 0;
        const rightTrigger = pad.axes[5] ?? 0;
        if (rightTrigger > TRIGGER_THRESHOLD || (pad.buttons[7]?.value ?? 0) > TRIGGER_THRESHOLD) {
          accumulator.held.add('fire');
          sawInput = true;
        }
        if (leftTrigger > TRIGGER_THRESHOLD || (pad.buttons[6]?.value ?? 0) > TRIGGER_THRESHOLD) {
          accumulator.held.add('lockOn');
          sawInput = true;
        }
      }

      if (sawInput) {
        accumulator.lastDevice = 'gamepad';
        active = true;
      } else {
        active = false;
      }
    },

    get isActive() {
      return active;
    },
  };
}
