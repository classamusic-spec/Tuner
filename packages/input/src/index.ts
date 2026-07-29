/**
 * `@tuner/input` — device-agnostic player intent.
 *
 * Keyboard, mouse, gamepad and touch are flattened into one `InputFrame` per
 * simulation step. The simulation reads only that struct, which is what lets a
 * replay, a cutscene or a test drive the player by synthesising frames — and
 * what keeps gameplay code free of any platform's event model.
 */
export * from './types.js';
export * from './manager.js';
export * from './keyboard-mouse.js';
export * from './gamepad.js';
export * from './touch.js';
