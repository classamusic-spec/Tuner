/**
 * `@tuner/audio` — the audio contract and its adapters.
 *
 * `types.ts` is the contract the simulation talks to. `synth.ts` and `music.ts`
 * are pure data and arithmetic — no Web Audio, no DOM, no clock — so the sound
 * design and the adaptive score are both testable in Node.
 * `web-audio-engine.ts` is the browser adapter that renders them, and it
 * degrades to silence rather than throwing when Web Audio is unavailable.
 */
export * from './types.js';
export * from './synth.js';
export * from './music.js';
export * from './web-audio-engine.js';
