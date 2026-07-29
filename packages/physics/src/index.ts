/**
 * `@tuner/physics` — the collision contract plus the shipped kinematic solver.
 *
 * The solver is deliberately not a general rigid-body engine. Precise
 * platforming wants predictable, reproducible character motion, so the
 * character is moved by collide-and-slide against authored static and
 * kinematic geometry rather than by an impulse solver.
 */
export * from './types.js';
