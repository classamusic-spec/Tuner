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
export * from './game.js';
