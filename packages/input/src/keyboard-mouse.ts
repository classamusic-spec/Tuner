import type { Action, InputAccumulator, InputSettings, InputSource } from './types.js';

/**
 * Keyboard and mouse.
 *
 * Every DOM access is guarded so importing this module in Node — or attaching it
 * before a canvas exists — is harmless rather than fatal. That matters because
 * the same code path is exercised by tests and by the headless build.
 *
 * The source reports *held* state only; `pressed`/`released` edges are derived
 * once by the manager, so every device shares identical semantics.
 */

export interface KeyboardMouseOptions {
  /** Element that receives mouse events. Defaults to the document. */
  readonly target?: EventTarget | null;
  /** Requests pointer lock on click, so the camera can turn freely. */
  readonly usePointerLock?: boolean;
}

/** Movement keys are fixed; action keys are rebindable through settings. */
const MOVE_KEYS: Readonly<Record<string, [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function createKeyboardMouseSource(options?: KeyboardMouseOptions): InputSource {
  const heldKeys = new Set<string>();
  const heldButtons = new Set<number>();
  let pendingLookX = 0;
  let pendingLookY = 0;
  let pendingFormIndex: number | null = null;
  let pendingWheel = 0;
  let active = false;
  let attached = false;

  const source: InputSource = {
    kind: 'keyboard',

    attach(): () => void {
      if (attached) return () => {};
      if (typeof document === 'undefined' || typeof window === 'undefined') {
        // Node, or a worker. Nothing to attach to, and that is not an error.
        return () => {};
      }
      attached = true;

      const mouseTarget: EventTarget = options?.target ?? document;

      const onKeyDown = (event: Event): void => {
        const e = event as KeyboardEvent;
        if (e.repeat) return;
        heldKeys.add(e.code);
        active = true;
        // Number keys select a form directly.
        if (e.code.startsWith('Digit')) {
          const digit = Number.parseInt(e.code.slice(5), 10);
          if (Number.isFinite(digit) && digit >= 1 && digit <= 9) pendingFormIndex = digit - 1;
        }
        // Space and the arrows would otherwise scroll the page under the canvas.
        if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') {
          e.preventDefault();
        }
      };

      const onKeyUp = (event: Event): void => {
        heldKeys.delete((event as KeyboardEvent).code);
      };

      const onBlur = (): void => {
        // Losing focus with keys held would leave the player running forever.
        heldKeys.clear();
        heldButtons.clear();
      };

      const onMouseDown = (event: Event): void => {
        heldButtons.add((event as MouseEvent).button);
        active = true;
        if (options?.usePointerLock !== false) {
          const element = (options?.target ?? null) as HTMLElement | null;
          if (element && document.pointerLockElement !== element) {
            void element.requestPointerLock?.();
          }
        }
      };

      const onMouseUp = (event: Event): void => {
        heldButtons.delete((event as MouseEvent).button);
      };

      const onMouseMove = (event: Event): void => {
        const e = event as MouseEvent;
        const locked = document.pointerLockElement !== null;
        // With the pointer locked, movementX/Y are the only meaningful signal.
        // Unlocked, only drag with a button held should turn the camera, so a
        // player moving the cursor to a menu does not spin the view.
        if (locked || heldButtons.size > 0) {
          pendingLookX += e.movementX ?? 0;
          pendingLookY += e.movementY ?? 0;
          active = true;
        }
      };

      const onWheel = (event: Event): void => {
        pendingWheel += Math.sign((event as WheelEvent).deltaY);
        active = true;
      };

      const onContextMenu = (event: Event): void => {
        // Right mouse is the counter; a context menu mid-fight is not helpful.
        event.preventDefault();
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      mouseTarget.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      mouseTarget.addEventListener('mousemove', onMouseMove);
      mouseTarget.addEventListener('wheel', onWheel, { passive: true } as AddEventListenerOptions);
      mouseTarget.addEventListener('contextmenu', onContextMenu);

      return () => {
        attached = false;
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        mouseTarget.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        mouseTarget.removeEventListener('mousemove', onMouseMove);
        mouseTarget.removeEventListener('wheel', onWheel);
        mouseTarget.removeEventListener('contextmenu', onContextMenu);
        heldKeys.clear();
        heldButtons.clear();
      };
    },

    sample(accumulator: InputAccumulator, settings: InputSettings): void {
      let x = 0;
      let y = 0;
      for (const code of heldKeys) {
        const move = MOVE_KEYS[code];
        if (move) {
          x += move[0];
          y += move[1];
        }
        const bound = settings.keyboardBindings[code];
        if (bound) accumulator.held.add(bound);
      }

      // Sprint from a held Shift while moving is handled by the movement system
      // reading the dash button; nothing extra is needed here.
      if (heldButtons.has(0)) accumulator.held.add('fire');
      if (heldButtons.has(2)) accumulator.held.add('counter');

      if (x !== 0 || y !== 0) {
        accumulator.moveX += x;
        accumulator.moveY += y;
      }

      if (pendingLookX !== 0 || pendingLookY !== 0) {
        const invertX = settings.invertLookX ? -1 : 1;
        const invertY = settings.invertLookY ? -1 : 1;
        // Mouse deltas are pixels; scale to radians.
        accumulator.lookX += pendingLookX * 0.0024 * settings.lookSensitivityX * invertX;
        accumulator.lookY += -pendingLookY * 0.0024 * settings.lookSensitivityY * invertY;
        pendingLookX = 0;
        pendingLookY = 0;
      }

      if (pendingWheel !== 0) {
        accumulator.held.add(pendingWheel > 0 ? ('formNext' as Action) : ('formPrev' as Action));
        pendingWheel = 0;
      }

      if (pendingFormIndex !== null) {
        accumulator.requestedFormIndex = pendingFormIndex;
        pendingFormIndex = null;
      }

      if (active) {
        accumulator.lastDevice = 'keyboard';
        active = false;
      }
    },

    get isActive() {
      return heldKeys.size > 0 || heldButtons.size > 0;
    },
  };

  return source;
}
