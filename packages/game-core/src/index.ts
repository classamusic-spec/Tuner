/**
 * `@tuner/game-core` — the portable simulation.
 *
 * Hard rule, enforced by lint: this package must not import React, React
 * Native, Three.js, the DOM, or any concrete audio or physics engine. It talks
 * to the outside world through `PhysicsWorld`, `InputFrame`, `AudioEngine` and
 * the `GameEvents` bus, which is what allows one set of gameplay rules to run
 * unchanged on web, mobile and desktop.
 */

export * from './state.js';
export * from './events.js';
export * from './config.js';
export * from './content-types.js';
export * from './forms.js';
export * from './adventure-types.js';
export * from './game.js';
export * from './create-game.js';
export { RESONANCE_FORMS, FORM_WHEEL_ORDER } from './systems/forms-registry.js';
export {
  formAtIndex,
  formCount,
  formTuningFor,
  getFormBehaviour,
  indexOfForm,
  nextUnlockedForm,
} from './systems/forms.js';
export { computeStageResult } from './systems/stage.js';
export {
  createCameraState,
  resolveCameraTransform,
  type CameraResolveInput,
  type CameraState,
} from './systems/camera.js';
