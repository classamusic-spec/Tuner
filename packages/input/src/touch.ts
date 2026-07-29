import { clamp } from '@tuner/shared';
import type { Action, InputAccumulator, InputSettings, InputSource } from './types.js';

/**
 * Touch controls.
 *
 * Designed for touch rather than ported to it. Two decisions carry most of that:
 *
 * 1. **The movement stick has a floating origin.** It appears wherever the thumb
 *    lands in the left half of the screen, rather than sitting at a fixed spot
 *    the player has to find without looking. Nobody hunts for a pad mid-jump.
 * 2. **Multi-touch is tracked by identifier.** Moving, aiming and pressing a
 *    button at the same time all work, because each touch is followed
 *    independently instead of the newest one winning.
 *
 * The layout maths is exported so `@tuner/ui` can *draw* the controls from the
 * same source of truth that reads them. A separate copy of the geometry in the
 * renderer is how the visible button and the live hit zone drift apart.
 */

export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface TouchRect {
  readonly id: TouchControlId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

export type TouchControlId =
  | 'jump'
  | 'dash'
  | 'fire'
  | 'counter'
  | 'lockOn'
  | 'formSwitch';

/** Which action each button drives. */
export const TOUCH_ACTIONS: Readonly<Record<TouchControlId, Action>> = {
  jump: 'jump',
  dash: 'dash',
  fire: 'fire',
  counter: 'counter',
  lockOn: 'lockOn',
  formSwitch: 'formNext',
};

/** Minimum comfortable touch target, in CSS pixels, before scaling. */
export const MIN_TOUCH_SIZE = 46;

export interface TouchLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly insets?: SafeAreaInsets;
  readonly scale?: number;
  readonly leftHanded?: boolean;
  /** Per-control position overrides, as fractions of the viewport. */
  readonly overrides?: Readonly<Partial<Record<TouchControlId, { x: number; y: number }>>>;
}

export interface TouchLayout {
  readonly width: number;
  readonly height: number;
  /** Half of the screen reserved for the movement stick. */
  readonly stickRegion: { x: number; y: number; width: number; height: number };
  /** Half reserved for camera drag. */
  readonly lookRegion: { x: number; y: number; width: number; height: number };
  readonly stickRadius: number;
  readonly buttons: readonly TouchRect[];
}

/**
 * Computes the control layout.
 *
 * Pure, so it can be asserted against every viewport the game supports without
 * a browser.
 */
export function computeTouchLayout(input: TouchLayoutInput): TouchLayout {
  const { width, height } = input;
  const insets = input.insets ?? NO_INSETS;
  const scale = clamp(input.scale ?? 1, 0.6, 1.8);
  const leftHanded = input.leftHanded === true;

  const size = Math.max(MIN_TOUCH_SIZE, MIN_TOUCH_SIZE * scale * 1.35);
  const gap = size * 0.28;
  const stickRadius = Math.max(56, Math.min(width, height) * 0.13 * scale);

  const safeLeft = insets.left;
  const safeRight = width - insets.right;
  const safeBottom = height - insets.bottom;

  // The action cluster sits bottom-right by default: a diamond of jump/dash with
  // fire and counter inboard, close enough for one thumb to reach all four.
  const clusterRight = safeRight - gap;
  const clusterBottom = safeBottom - gap;

  const raw: TouchRect[] = [
    {
      id: 'jump',
      x: clusterRight - size,
      y: clusterBottom - size,
      width: size,
      height: size,
      label: 'Jump',
    },
    {
      id: 'dash',
      x: clusterRight - size * 2 - gap,
      y: clusterBottom - size * 1.35 - gap,
      width: size,
      height: size,
      label: 'Dash',
    },
    {
      id: 'fire',
      x: clusterRight - size * 1.15,
      y: clusterBottom - size * 2.35 - gap,
      width: size * 1.15,
      height: size * 1.15,
      label: 'Fire',
    },
    {
      id: 'counter',
      x: clusterRight - size * 2.3 - gap * 2,
      y: clusterBottom - size * 2.5 - gap,
      width: size,
      height: size,
      label: 'Counter',
    },
    {
      id: 'lockOn',
      x: clusterRight - size * 3.3 - gap * 3,
      y: clusterBottom - size * 1.1,
      width: size * 0.9,
      height: size * 0.9,
      label: 'Lock',
    },
    {
      id: 'formSwitch',
      x: safeRight - size * 1.1 - gap,
      y: insets.top + gap,
      width: size * 1.1,
      height: size * 0.8,
      label: 'Form',
    },
  ];

  const buttons = raw.map((rect) => {
    // The minimum touch target is a floor, not a suggestion. Scaling down is a
    // comfort setting; it must never produce a button too small to hit
    // reliably, so the smaller controls stop shrinking here even though the
    // cluster's spacing keeps following `size`.
    const w = Math.max(MIN_TOUCH_SIZE, rect.width);
    const h = Math.max(MIN_TOUCH_SIZE, rect.height);

    const override = input.overrides?.[rect.id];
    let x = override ? override.x * width : rect.x;
    let y = override ? override.y * height : rect.y;

    if (leftHanded) {
      // Mirror the whole layout about the viewport centre, not per-control, so
      // the cluster's internal geometry is preserved.
      x = width - x - w;
    }

    // Clamp so nothing — dragged, mirrored or scaled — leaves the safe area.
    x = clamp(x, safeLeft, safeRight - w);
    y = clamp(y, insets.top, safeBottom - h);

    return { ...rect, x, y, width: w, height: h };
  });

  const stickHalfX = leftHanded ? width * 0.5 : safeLeft;
  const lookHalfX = leftHanded ? safeLeft : width * 0.5;

  return {
    width,
    height,
    stickRegion: {
      x: stickHalfX,
      y: insets.top,
      width: width * 0.5 - (leftHanded ? insets.right : insets.left),
      height: safeBottom - insets.top,
    },
    lookRegion: {
      x: lookHalfX,
      y: insets.top,
      width: width * 0.5 - (leftHanded ? insets.left : insets.right),
      height: safeBottom - insets.top,
    },
    stickRadius,
    buttons,
  };
}

/** Which control a point falls in, or null. Buttons win over the stick region. */
export function hitTestTouchLayout(
  layout: TouchLayout,
  x: number,
  y: number,
): TouchControlId | null {
  for (const rect of layout.buttons) {
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return rect.id;
    }
  }
  return null;
}

/** Stick vector for a touch, relative to its floating origin. Clamped to 1. */
export function stickVectorFor(
  layout: TouchLayout,
  originX: number,
  originY: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const dx = (x - originX) / layout.stickRadius;
  // Screen y grows downward; movement y grows forward.
  const dy = -(y - originY) / layout.stickRadius;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude <= 1) return { x: dx, y: dy };
  return { x: dx / magnitude, y: dy / magnitude };
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export interface TouchSourceOptions {
  readonly target?: EventTarget | null;
  readonly insets?: SafeAreaInsets;
}

/** Live state the UI reads to draw the controls. */
export interface TouchVisualState {
  readonly layout: TouchLayout | null;
  /** Where the thumb first landed, if the stick is engaged. */
  readonly stickOrigin: { x: number; y: number } | null;
  readonly stickKnob: { x: number; y: number } | null;
  readonly pressed: ReadonlySet<TouchControlId>;
}

export interface TouchInputSource extends InputSource {
  /** Called by the host whenever the canvas resizes. */
  setViewport(width: number, height: number): void;
  readonly visual: TouchVisualState;
}

interface TrackedTouch {
  readonly id: number;
  readonly role: 'stick' | 'look' | 'button';
  readonly control: TouchControlId | null;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

export function createTouchSource(options?: TouchSourceOptions): TouchInputSource {
  const touches = new Map<number, TrackedTouch>();
  const pressed = new Set<TouchControlId>();
  let layout: TouchLayout | null = null;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let settingsScale = 1;
  let settingsLeftHanded = false;
  let pendingLookX = 0;
  let pendingLookY = 0;
  let active = false;
  let attached = false;

  const rebuild = (): void => {
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    layout = computeTouchLayout({
      width: viewportWidth,
      height: viewportHeight,
      insets: options?.insets ?? NO_INSETS,
      scale: settingsScale,
      leftHanded: settingsLeftHanded,
    });
  };

  const source: TouchInputSource = {
    kind: 'touch',

    setViewport(width: number, height: number): void {
      viewportWidth = width;
      viewportHeight = height;
      rebuild();
    },

    get visual(): TouchVisualState {
      let stickOrigin: { x: number; y: number } | null = null;
      let stickKnob: { x: number; y: number } | null = null;
      for (const touch of touches.values()) {
        if (touch.role !== 'stick') continue;
        stickOrigin = { x: touch.originX, y: touch.originY };
        stickKnob = { x: touch.x, y: touch.y };
        break;
      }
      return { layout, stickOrigin, stickKnob, pressed };
    },

    attach(): () => void {
      if (attached) return () => {};
      if (typeof document === 'undefined') return () => {};
      attached = true;

      const target: EventTarget = options?.target ?? document;

      const classify = (x: number, y: number): TrackedTouch['role'] => {
        if (!layout) return 'look';
        const button = hitTestTouchLayout(layout, x, y);
        if (button) return 'button';
        const stick = layout.stickRegion;
        const inStick =
          x >= stick.x && x <= stick.x + stick.width && y >= stick.y && y <= stick.y + stick.height;
        return inStick ? 'stick' : 'look';
      };

      const onStart = (event: Event): void => {
        const e = event as TouchEvent;
        for (const touch of Array.from(e.changedTouches)) {
          const x = touch.clientX;
          const y = touch.clientY;
          const role = classify(x, y);
          const control = role === 'button' && layout ? hitTestTouchLayout(layout, x, y) : null;
          touches.set(touch.identifier, {
            id: touch.identifier,
            role,
            control,
            originX: x,
            originY: y,
            x,
            y,
          });
          if (control) pressed.add(control);
        }
        active = true;
        e.preventDefault();
      };

      const onMove = (event: Event): void => {
        const e = event as TouchEvent;
        for (const touch of Array.from(e.changedTouches)) {
          const tracked = touches.get(touch.identifier);
          if (!tracked) continue;
          if (tracked.role === 'look') {
            pendingLookX += touch.clientX - tracked.x;
            pendingLookY += touch.clientY - tracked.y;
          }
          tracked.x = touch.clientX;
          tracked.y = touch.clientY;
        }
        active = true;
        e.preventDefault();
      };

      const onEnd = (event: Event): void => {
        const e = event as TouchEvent;
        for (const touch of Array.from(e.changedTouches)) {
          const tracked = touches.get(touch.identifier);
          if (tracked?.control) pressed.delete(tracked.control);
          touches.delete(touch.identifier);
        }
        e.preventDefault();
      };

      const passive = { passive: false } as AddEventListenerOptions;
      target.addEventListener('touchstart', onStart, passive);
      target.addEventListener('touchmove', onMove, passive);
      target.addEventListener('touchend', onEnd, passive);
      target.addEventListener('touchcancel', onEnd, passive);

      return () => {
        attached = false;
        target.removeEventListener('touchstart', onStart);
        target.removeEventListener('touchmove', onMove);
        target.removeEventListener('touchend', onEnd);
        target.removeEventListener('touchcancel', onEnd);
        touches.clear();
        pressed.clear();
      };
    },

    sample(accumulator: InputAccumulator, settings: InputSettings): void {
      if (settingsScale !== settings.touchScale || settingsLeftHanded !== settings.leftHandedTouch) {
        settingsScale = settings.touchScale;
        settingsLeftHanded = settings.leftHandedTouch;
        rebuild();
      }

      if (!layout) return;

      for (const touch of touches.values()) {
        if (touch.role === 'stick') {
          const vector = stickVectorFor(layout, touch.originX, touch.originY, touch.x, touch.y);
          accumulator.moveX += vector.x;
          accumulator.moveY += vector.y;
        }
      }

      for (const control of pressed) {
        accumulator.held.add(TOUCH_ACTIONS[control]);
      }

      if (pendingLookX !== 0 || pendingLookY !== 0) {
        const invertX = settings.invertLookX ? -1 : 1;
        const invertY = settings.invertLookY ? -1 : 1;
        accumulator.lookX += pendingLookX * 0.005 * settings.lookSensitivityX * invertX;
        accumulator.lookY += -pendingLookY * 0.005 * settings.lookSensitivityY * invertY;
        pendingLookX = 0;
        pendingLookY = 0;
      }

      if (active) {
        accumulator.lastDevice = 'touch';
        active = touches.size > 0;
      }
    },

    get isActive() {
      return touches.size > 0;
    },
  };

  return source;
}
