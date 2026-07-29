/**
 * The input contract.
 *
 * Every device — keyboard, mouse, gamepad, touch — is flattened into one
 * `InputFrame`. The simulation reads only that struct, so it neither knows nor
 * cares which platform produced it, and a replay can be driven by synthesising
 * frames directly.
 */

/** Every discrete action the game can receive. */
export const ACTIONS = [
  'jump',
  'dash',
  'fire',
  'counter',
  'lockOn',
  'formNext',
  'formPrev',
  'formWheel',
  'resonanceSight',
  'interact',
  'pause',
  'cameraRecenter',
  'slide',
] as const;
export type Action = (typeof ACTIONS)[number];

/** A button's state across one simulation step. */
export interface ButtonState {
  /** Held at the end of the step. */
  readonly down: boolean;
  /** Transitioned to down during this step. */
  readonly pressed: boolean;
  /** Transitioned to up during this step. */
  readonly released: boolean;
  /** Seconds the button has been continuously held. */
  readonly heldSeconds: number;
}

export const IDLE_BUTTON: ButtonState = Object.freeze({
  down: false,
  pressed: false,
  released: false,
  heldSeconds: 0,
});

export type InputDeviceKind = 'keyboard' | 'gamepad' | 'touch';

/** One fully-resolved frame of player intent. */
export interface InputFrame {
  /** Movement stick in [-1, 1]; y is forward. Already dead-zoned and clamped. */
  readonly moveX: number;
  readonly moveY: number;
  /** Camera stick / drag delta for this frame, in radians. */
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: Readonly<Record<Action, ButtonState>>;
  /** Direct form selection, when the player used a wheel or number key. */
  readonly requestedFormIndex: number | null;
  /** Which device most recently produced input — drives on-screen prompts. */
  readonly lastDevice: InputDeviceKind;
  /** Monotonic frame counter, useful for replay verification. */
  readonly frame: number;
}

export function createEmptyInputFrame(): InputFrame {
  const buttons = {} as Record<Action, ButtonState>;
  for (const action of ACTIONS) buttons[action] = IDLE_BUTTON;
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    buttons,
    requestedFormIndex: null,
    lastDevice: 'keyboard',
    frame: 0,
  };
}

/** Tuning that the accessibility and settings screens write into. */
export interface InputSettings {
  stickDeadzone: number;
  lookSensitivityX: number;
  lookSensitivityY: number;
  invertLookX: boolean;
  invertLookY: boolean;
  /** Treat fire/charge as a toggle rather than a hold. */
  holdToCharge: boolean;
  /** Treat sprint as a toggle rather than a hold. */
  toggleSprint: boolean;
  /** Aim assistance strength in [0, 1]. */
  aimAssist: number;
  /** Lock-on stickiness in [0, 1]. */
  lockOnAssist: number;
  /** Keyboard code -> action bindings. */
  keyboardBindings: Readonly<Record<string, Action>>;
  /** Gamepad button index -> action bindings. */
  gamepadBindings: Readonly<Record<number, Action>>;
  /** Mirrors the touch layout for left-handed players. */
  leftHandedTouch: boolean;
  touchOpacity: number;
  touchScale: number;
  /** Enables device vibration where the platform supports it. */
  haptics: boolean;
}

export const DEFAULT_KEYBOARD_BINDINGS: Readonly<Record<string, Action>> = Object.freeze({
  Space: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyE: 'interact',
  KeyQ: 'resonanceSight',
  KeyC: 'slide',
  KeyR: 'cameraRecenter',
  Tab: 'lockOn',
  Escape: 'pause',
  KeyF: 'counter',
});

export const DEFAULT_INPUT_SETTINGS: InputSettings = Object.freeze({
  stickDeadzone: 0.18,
  lookSensitivityX: 1,
  lookSensitivityY: 0.85,
  invertLookX: false,
  invertLookY: false,
  holdToCharge: true,
  toggleSprint: false,
  aimAssist: 0.35,
  lockOnAssist: 0.5,
  keyboardBindings: DEFAULT_KEYBOARD_BINDINGS,
  gamepadBindings: Object.freeze({
    0: 'jump',
    1: 'dash',
    2: 'counter',
    3: 'resonanceSight',
    4: 'formPrev',
    5: 'formNext',
    7: 'fire',
    9: 'pause',
    10: 'lockOn',
  } as Record<number, Action>),
  leftHandedTouch: false,
  touchOpacity: 0.7,
  touchScale: 1,
  haptics: true,
});

/**
 * A source of raw device input. Sources accumulate events between simulation
 * steps and are drained once per step by the `InputManager`.
 */
export interface InputSource {
  readonly kind: InputDeviceKind;
  /** Attaches listeners. Returns a teardown function. */
  attach(): () => void;
  /** Writes this source's contribution into the accumulator. */
  sample(accumulator: InputAccumulator, settings: InputSettings, deltaSeconds: number): void;
  readonly isActive: boolean;
}

/** Mutable scratch space that sources write into during a step. */
export interface InputAccumulator {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  /** Actions currently held. */
  readonly held: Set<Action>;
  requestedFormIndex: number | null;
  lastDevice: InputDeviceKind;
}

export interface InputManager {
  /** Advances button edge detection and returns this step's resolved frame. */
  update(deltaSeconds: number): InputFrame;
  readonly current: InputFrame;
  settings: InputSettings;
  addSource(source: InputSource): void;
  removeSource(source: InputSource): void;
  /** Detaches every source. */
  dispose(): void;
  /** Injects a frame directly — used by tests, replays and cutscenes. */
  override(frame: InputFrame | null): void;
}
