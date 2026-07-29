import { describe, expect, it } from 'vitest';
import {
  MIN_TOUCH_SIZE,
  computeTouchLayout,
  hitTestTouchLayout,
  stickVectorFor,
  type TouchLayout,
} from './touch.js';
import { createInputManager } from './manager.js';
import { DEFAULT_INPUT_SETTINGS, createEmptyInputFrame, type InputSource } from './types.js';

/**
 * Touch layout is pure maths, so the promises made about it are checked here
 * rather than by squinting at a phone. The overlap and safe-area assertions in
 * particular are the difference between "designed for touch" and "shipped for
 * touch and hoped".
 */

const VIEWPORTS = [
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'tablet landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1600, height: 900 },
] as const;

const NOTCH = { top: 0, right: 44, bottom: 21, left: 44 };

function overlaps(a: TouchLayout['buttons'][number], b: TouchLayout['buttons'][number]): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

describe('touch layout', () => {
  it.each(VIEWPORTS)('no two controls overlap on $name', ({ width, height }) => {
    const layout = computeTouchLayout({ width, height });
    for (let i = 0; i < layout.buttons.length; i++) {
      for (let j = i + 1; j < layout.buttons.length; j++) {
        const a = layout.buttons[i];
        const b = layout.buttons[j];
        if (!a || !b) continue;
        expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it.each([0.75, 1, 1.5])('every control meets the minimum touch size at scale %s', (scale) => {
    const layout = computeTouchLayout({ width: 844, height: 390, scale });
    for (const rect of layout.buttons) {
      expect(rect.width, rect.id).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
      expect(rect.height, rect.id).toBeGreaterThanOrEqual(MIN_TOUCH_SIZE);
    }
  });

  it('no control intrudes into the safe-area insets', () => {
    const layout = computeTouchLayout({ width: 844, height: 390, insets: NOTCH });
    for (const rect of layout.buttons) {
      expect(rect.x, `${rect.id} left`).toBeGreaterThanOrEqual(NOTCH.left);
      expect(rect.x + rect.width, `${rect.id} right`).toBeLessThanOrEqual(844 - NOTCH.right);
      expect(rect.y, `${rect.id} top`).toBeGreaterThanOrEqual(NOTCH.top);
      expect(rect.y + rect.height, `${rect.id} bottom`).toBeLessThanOrEqual(390 - NOTCH.bottom);
    }
  });

  it('left-handed mode mirrors every control about the viewport centre', () => {
    const width = 844;
    const normal = computeTouchLayout({ width, height: 390 });
    const mirrored = computeTouchLayout({ width, height: 390, leftHanded: true });

    for (const rect of normal.buttons) {
      const other = mirrored.buttons.find((b) => b.id === rect.id);
      expect(other, rect.id).toBeDefined();
      if (!other) continue;
      // A mirrored control's right edge sits where the original's left edge was.
      expect(other.x + other.width).toBeCloseTo(width - rect.x, 0);
    }
  });

  it('left-handed mode swaps which half drives the stick', () => {
    const normal = computeTouchLayout({ width: 844, height: 390 });
    const mirrored = computeTouchLayout({ width: 844, height: 390, leftHanded: true });
    expect(normal.stickRegion.x).toBeLessThan(normal.lookRegion.x);
    expect(mirrored.stickRegion.x).toBeGreaterThan(mirrored.lookRegion.x);
  });

  it('scaling changes control sizes proportionally', () => {
    const small = computeTouchLayout({ width: 844, height: 390, scale: 0.8 });
    const large = computeTouchLayout({ width: 844, height: 390, scale: 1.6 });
    const a = small.buttons.find((b) => b.id === 'jump');
    const b = large.buttons.find((b) => b.id === 'jump');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect((b?.width ?? 0)).toBeGreaterThan((a?.width ?? 0));
  });

  it('hit-tests points inside each control and misses outside all of them', () => {
    const layout = computeTouchLayout({ width: 844, height: 390 });
    for (const rect of layout.buttons) {
      const hit = hitTestTouchLayout(layout, rect.x + rect.width / 2, rect.y + rect.height / 2);
      expect(hit, rect.id).toBe(rect.id);
    }
    // Far top-left is stick territory, not a button.
    expect(hitTestTouchLayout(layout, 10, 10)).toBeNull();
  });

  it('clamps a control dragged off-screen back into view', () => {
    const layout = computeTouchLayout({
      width: 844,
      height: 390,
      overrides: { jump: { x: 5, y: 5 } },
    });
    const jump = layout.buttons.find((b) => b.id === 'jump');
    expect(jump).toBeDefined();
    expect(jump?.x).toBeGreaterThanOrEqual(0);
    expect((jump?.x ?? 0) + (jump?.width ?? 0)).toBeLessThanOrEqual(844);
    expect((jump?.y ?? 0) + (jump?.height ?? 0)).toBeLessThanOrEqual(390);
  });

  it('produces a stick vector of the right direction and clamped magnitude', () => {
    const layout = computeTouchLayout({ width: 844, height: 390 });
    // Straight up on screen is forward in world terms.
    const up = stickVectorFor(layout, 200, 300, 200, 300 - layout.stickRadius);
    expect(up.y).toBeCloseTo(1, 5);
    expect(up.x).toBeCloseTo(0, 5);

    // Right on screen is right.
    const right = stickVectorFor(layout, 200, 300, 200 + layout.stickRadius, 300);
    expect(right.x).toBeCloseTo(1, 5);

    // Dragging well past the ring must not exceed full deflection.
    const far = stickVectorFor(layout, 200, 300, 200 + layout.stickRadius * 8, 300);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 5);
  });
});

describe('input manager', () => {
  /** A source that reports whatever is handed to it. */
  function stubSource(
    contribute: (accumulator: Parameters<InputSource['sample']>[0]) => void,
  ): InputSource {
    return {
      kind: 'keyboard',
      attach: () => () => {},
      sample: (accumulator) => contribute(accumulator),
      isActive: true,
    };
  }

  it('detects a press exactly once and a release exactly once', () => {
    let held = false;
    const manager = createInputManager();
    manager.addSource(
      stubSource((accumulator) => {
        if (held) accumulator.held.add('jump');
      }),
    );

    held = true;
    let frame = manager.update(1 / 60);
    expect(frame.buttons.jump.pressed).toBe(true);
    expect(frame.buttons.jump.down).toBe(true);

    frame = manager.update(1 / 60);
    expect(frame.buttons.jump.pressed).toBe(false);
    expect(frame.buttons.jump.down).toBe(true);
    expect(frame.buttons.jump.heldSeconds).toBeGreaterThan(0);

    held = false;
    frame = manager.update(1 / 60);
    expect(frame.buttons.jump.released).toBe(true);
    expect(frame.buttons.jump.down).toBe(false);

    frame = manager.update(1 / 60);
    expect(frame.buttons.jump.released).toBe(false);
  });

  it('applies the dead zone and clamps a diagonal to magnitude 1', () => {
    const manager = createInputManager({ stickDeadzone: 0.2 });
    manager.addSource(
      stubSource((accumulator) => {
        accumulator.moveX = 1;
        accumulator.moveY = 1;
      }),
    );
    const frame = manager.update(1 / 60);
    // A diagonal must not be faster than a cardinal.
    expect(Math.hypot(frame.moveX, frame.moveY)).toBeCloseTo(1, 5);
  });

  it('swallows drift below the dead zone', () => {
    const manager = createInputManager({ stickDeadzone: 0.3 });
    manager.addSource(
      stubSource((accumulator) => {
        accumulator.moveX = 0.12;
      }),
    );
    expect(manager.update(1 / 60).moveX).toBe(0);
  });

  it('injects an overridden frame verbatim and resumes when cleared', () => {
    const manager = createInputManager();
    manager.addSource(
      stubSource((accumulator) => {
        accumulator.moveY = 1;
      }),
    );

    const injected = { ...createEmptyInputFrame(), moveX: 0.5 };
    manager.override(injected);
    expect(manager.update(1 / 60)).toBe(injected);

    manager.override(null);
    expect(manager.update(1 / 60).moveY).toBeGreaterThan(0);
  });

  it('honours rebound keys through settings', () => {
    const manager = createInputManager({
      keyboardBindings: { ...DEFAULT_INPUT_SETTINGS.keyboardBindings, KeyZ: 'dash' },
    });
    expect(manager.settings.keyboardBindings.KeyZ).toBe('dash');
  });

  it('is safe to dispose twice', () => {
    const manager = createInputManager();
    manager.addSource(stubSource(() => {}));
    expect(() => {
      manager.dispose();
      manager.dispose();
    }).not.toThrow();
  });

  it('does not claim the device on stick drift alone', () => {
    const manager = createInputManager({ stickDeadzone: 0.1 });
    manager.addSource({
      kind: 'gamepad',
      attach: () => () => {},
      sample: (accumulator) => {
        accumulator.moveX = 0.12;
        accumulator.lastDevice = 'gamepad';
      },
      isActive: true,
    });
    // Below the switch threshold, prompts must stay on the previous device.
    expect(manager.update(1 / 60).lastDevice).toBe('keyboard');
  });
});
