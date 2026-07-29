/**
 * `@tuner/shared` — dependency-free foundations.
 *
 * This package must never import React, Three.js, the DOM, React Native or any
 * physics library. Everything downstream (simulation, rendering, audio, UI,
 * persistence) may depend on it, so keeping it pure is what allows the same
 * game logic to run on web, mobile and desktop.
 */

export * from './math/vec3.js';
export * from './math/scalar.js';
export * from './rng.js';
export * from './event-bus.js';
export * from './constants.js';
export * from './pool.js';
export * from './fixed-step.js';
export * from './id.js';
export * from './domain.js';
