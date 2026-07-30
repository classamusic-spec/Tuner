import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { QUALITY_PRESETS } from '@tuner/platform';
import { PALETTE, clamp, clamp01 } from '@tuner/shared';
import type {
  EventBus,
  GraphicsTier,
  ResonanceFormId,
  Unsubscribe,
  Vec3,
} from '@tuner/shared';
import { formTuningFor } from '@tuner/game-core';
import type { AccessibilityConfig, GameEvents, WorldState } from '@tuner/game-core';
import {
  ECHO_FORMS,
  ECHO_RING_RATIO,
  PARTICLE_SHAPES,
  createGeometryEchoes,
  createParticleSystem,
  type EchoForm,
  type EchoSpec,
  type GeometryEchoField,
  type ParticleAccessibility,
  type ParticleEmitSpec,
  type ParticleSystem,
} from './particles.js';

/**
 * The effects layer: the simulation's events, drawn.
 *
 * ---------------------------------------------------------------------------
 * THE VISUAL LANGUAGE IS SACRED GEOMETRY
 * ---------------------------------------------------------------------------
 * Nothing in here is a puff of smoke or a generic spark sheet. Every cue is
 * built from rings, regular polygons, interlocking arcs and concentric
 * expansions, because the fiction is *tuning* — a struck resonance propagating
 * outward — and because geometry carries information a smear of light cannot.
 * A charge tier is a triangle, then a square, then a hexagon. A struck note is a
 * ring whose radius grows with the harmonic degree, ringed by exactly as many
 * motes as the degree it sounded. Those are countable, and they are countable
 * without hearing anything and without distinguishing any two colours.
 *
 * Colour is the second channel, never the only one:
 *   cyan     natural 432 Hz resonance
 *   violet   the 440 Hz infection
 *   magenta  infection in the act of breaking
 *   green    restoration and returning life
 *   gold     the Tuner's own signal
 *
 * ---------------------------------------------------------------------------
 * EFFECTS MUST NEVER OBSCURE GAMEPLAY
 * ---------------------------------------------------------------------------
 * This is a stated failure condition for the project, so it is designed for
 * rather than remembered:
 *
 * - **Nothing screen-filling.** There is no full-screen flash, no camera-facing
 *   quad, no vignette. `fx:flash` is deliberately rendered as a small in-world
 *   figure rather than a white frame — see the handler.
 * - **Nothing solid.** Every ring is a thin annulus (`ECHO_RING_RATIO`) drawn
 *   with additive blending, which can only *lighten* what is behind it. A ledge
 *   cannot be blotted out by a ring, however many overlap it.
 * - **Nothing under the player's feet.** Landing, jump and dash figures expand
 *   *outward* from the contact point and fade within a third of a second, so
 *   the surface the player is about to touch is never covered.
 * - **Radius and opacity are clamped in the pool**, not at the call site, so a
 *   future effect cannot opt out of the rule by accident.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY
 * ---------------------------------------------------------------------------
 * Several handlers here are not decoration — they are the visual half of an
 * audio cue, and the game must be completable muted. `puzzle:noteStruck` is the
 * clearest case and is treated as gameplay: it draws a sized ring at the struck
 * resonator whether or not any sound is playing. `combat:counterWindow`,
 * `boss:vulnerable` and `puzzle:solved`/`failed` are the same kind of promise.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Effect colours.
 *
 * All but one come straight from the shared `PALETTE`. `magenta` is derived
 * here — it exists only as the middle stop of the cleanse ramp, where violet
 * infection breaks before it becomes green life, and it is not a world colour.
 */
export const EFFECT_COLOURS = {
  resonance: PALETTE.resonance,
  resonanceDeep: PALETTE.resonanceDeep,
  infection: PALETTE.infection,
  infectionDeep: PALETTE.infectionDeep,
  magenta: '#d858c8',
  restore: PALETTE.restore,
  restoreDeep: PALETTE.restoreDeep,
  gold: PALETTE.gold,
  goldDim: PALETTE.goldDim,
  alarm: PALETTE.alarm,
  ink: PALETTE.ink,
} as const;

/** Charge tiers read as a rising polygon count — countable, and colour-free. */
const TIER_FORMS: readonly EchoForm[] = ['triangle', 'square', 'hexagon'];

function tierForm(tier: number): EchoForm {
  const index = clamp(Math.floor(tier) - 1, 0, TIER_FORMS.length - 1);
  return TIER_FORMS[index] ?? 'triangle';
}

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

export interface EffectDirectorOptions {
  readonly particles: ParticleSystem;
  readonly echoes: GeometryEchoField;
  readonly accessibility?: Partial<ParticleAccessibility>;
}

export interface EffectDirector {
  /** Subscribes to every event this layer draws. Call the result to detach. */
  subscribe(bus: EventBus<GameEvents>): Unsubscribe;
  /** Advances both pools. Framerate independent. */
  step(dt: number): void;
  /**
   * Where to centre effects whose event carries no position — a boss phase
   * change, for instance. The scene feeds these from the world each frame.
   */
  setPlayerPosition(position: Readonly<Vec3>): void;
  setBossPosition(position: Readonly<Vec3> | null): void;
  setAccessibility(next: Partial<ParticleAccessibility>): void;
  readonly particles: ParticleSystem;
  readonly echoes: GeometryEchoField;
  /** Event types this director draws. Useful when auditing cue coverage. */
  readonly handledEvents: readonly (keyof GameEvents)[];
}

export function createEffectDirector(options: EffectDirectorOptions): EffectDirector {
  const { particles, echoes } = options;
  if (options.accessibility !== undefined) {
    particles.setAccessibility(options.accessibility);
    echoes.setAccessibility(options.accessibility);
  }

  const playerAnchor = { x: 0, y: 0, z: 0 };
  const bossAnchor = { x: 0, y: 0, z: 0 };
  let bossKnown = false;
  const handled: (keyof GameEvents)[] = [];

  const echo = (spec: EchoSpec): void => {
    echoes.spawn(spec);
  };
  const burst = (spec: ParticleEmitSpec): void => {
    particles.emit(spec);
  };

  /**
   * Concentric rings, staggered in time.
   *
   * This is the signature figure of the whole game: one strike, several rings,
   * arriving as a chord rather than together.
   */
  const concentric = (
    count: number,
    build: (ring: number) => EchoSpec,
    delayStep = 0.07,
  ): void => {
    for (let ring = 0; ring < count; ring++) {
      const spec = build(ring);
      echo({ ...spec, delay: (spec.delay ?? 0) + ring * delayStep });
    }
  };

  const formColour = (form: ResonanceFormId): string => formTuningFor(form).colour;

  const anchorOf = (position?: Readonly<Vec3>): Readonly<Vec3> => position ?? playerAnchor;

  return {
    particles,
    echoes,
    get handledEvents() {
      return handled;
    },

    setPlayerPosition(position) {
      playerAnchor.x = position.x;
      playerAnchor.y = position.y;
      playerAnchor.z = position.z;
    },

    setBossPosition(position) {
      if (position === null) {
        bossKnown = false;
        return;
      }
      bossKnown = true;
      bossAnchor.x = position.x;
      bossAnchor.y = position.y;
      bossAnchor.z = position.z;
    },

    setAccessibility(next) {
      particles.setAccessibility(next);
      echoes.setAccessibility(next);
    },

    step(dt) {
      particles.step(dt);
      echoes.step(dt);
    },

    subscribe(bus) {
      const subs: Unsubscribe[] = [];
      const on = <K extends keyof GameEvents & string>(
        type: K,
        listener: (payload: GameEvents[K]) => void,
      ): void => {
        if (!handled.includes(type)) handled.push(type);
        subs.push(bus.on(type, listener));
      };

      // -- Combat: firing -------------------------------------------------
      on('combat:fired', ({ position, direction, form, tier }) => {
        const colour = formColour(form);
        // Muzzle flash: a small ring facing down the shot, not a bloom.
        echo({
          position,
          orientation: 'normal',
          normal: direction,
          form: tier > 0 ? tierForm(tier) : 'circle',
          radiusFrom: 0.12,
          radiusTo: 0.5 + tier * 0.16,
          colour,
          colourTo: EFFECT_COLOURS.resonance,
          opacity: 0.4,
          brightness: 1.6,
          lifetime: 0.16,
          spin: 6,
        });
        burst({
          position,
          direction,
          pattern: 'cone',
          spread: 0.3,
          count: 4 + tier * 3,
          speed: { min: 4, max: 9 },
          lifetime: { min: 0.12, max: 0.24 },
          size: [0.07 + tier * 0.02, 0],
          colour,
          colourTo: EFFECT_COLOURS.resonance,
          shape: 'shard',
          opacity: 0.85,
          brightness: [1.8, 0.6],
          drag: 4,
          spin: { min: -8, max: 8 },
        });
      });

      // Charge tiers. Rings *close inward* as the shot gathers — the inverse of
      // every release effect, so tier-up and discharge can never be confused.
      on('combat:chargeTier', ({ tier, position }) => {
        const form = tierForm(tier);
        echo({
          position,
          form,
          radiusFrom: 1.5 + tier * 0.25,
          radiusTo: 0.7,
          colour: EFFECT_COLOURS.gold,
          colourTo: EFFECT_COLOURS.resonance,
          opacity: 0.34,
          brightness: 1.2 + tier * 0.2,
          lifetime: 0.45,
          spin: 1.1,
        });
        burst({
          position,
          pattern: 'polygon',
          polygonSides: 2 + Math.max(1, Math.min(4, tier + 2)),
          count: 6 + tier * 2,
          spawnRadius: 1.7,
          // Negative speed draws the motes in toward the Auralith.
          speed: -3.4,
          axialSpeed: 0.8,
          lifetime: 0.42,
          size: [0.05, 0.11],
          colour: EFFECT_COLOURS.resonance,
          colourTo: EFFECT_COLOURS.gold,
          shape: 'mote',
          opacity: 0.8,
          brightness: [0.9, 2],
          fadeIn: 0.2,
        });
      });

      // The harmonic burst: the one genuinely wide effect, and the one most
      // carefully kept thin and translucent.
      on('combat:burst', ({ position, radius }) => {
        const reach = clamp(radius, 0.6, 10);
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 0.25,
            radiusTo: reach * (1 - ring * 0.18),
            colour: EFFECT_COLOURS.resonance,
            colourTo: EFFECT_COLOURS.restore,
            opacity: 0.3 - ring * 0.06,
            brightness: 1.4,
            lifetime: 0.5,
          }),
          0.06,
        );
        burst({
          position,
          pattern: 'ring',
          count: 16,
          spawnRadius: 0.4,
          speed: reach * 1.9,
          axialSpeed: 1.4,
          lifetime: 0.4,
          size: [0.12, 0],
          colour: EFFECT_COLOURS.resonance,
          colourTo: EFFECT_COLOURS.ink,
          shape: 'fleck',
          drag: 3.2,
          brightness: [2, 0.5],
        });
      });

      // -- Combat: impacts -------------------------------------------------
      on('combat:hit', ({ position, normal, kind, blocked, weakness }) => {
        const colour = blocked
          ? EFFECT_COLOURS.gold
          : weakness
            ? EFFECT_COLOURS.restore
            : EFFECT_COLOURS.resonance;
        echo({
          position,
          orientation: 'normal',
          normal,
          form: blocked ? 'hexagon' : 'circle',
          radiusFrom: 0.08,
          radiusTo: blocked ? 0.5 : weakness ? 0.95 : 0.7,
          colour,
          opacity: blocked ? 0.3 : 0.42,
          brightness: weakness ? 2.2 : 1.5,
          lifetime: 0.2,
          spin: 4,
        });
        burst({
          position,
          direction: normal,
          pattern: 'cone',
          spread: blocked ? 1.1 : 0.7,
          count: (blocked ? 4 : 6) + (weakness ? 4 : 0),
          speed: { min: 3, max: blocked ? 5 : 8 },
          lifetime: { min: 0.14, max: 0.3 },
          size: [0.08, 0],
          colour,
          colourTo: weakness ? EFFECT_COLOURS.restore : EFFECT_COLOURS.ink,
          shape: 'shard',
          gravity: -9,
          drag: 2.6,
          spin: { min: -10, max: 10 },
          brightness: [2, 0.4],
        });

        // A charged shot detonating: a second, larger figure on the ground so
        // the player reads the blast radius they just created.
        if (kind === 'charge') {
          concentric(
            2,
            (ring) => ({
              position,
              form: ring === 0 ? 'circle' : 'hexagon',
              radiusFrom: 0.3,
              radiusTo: 2.4 - ring * 0.7,
              colour: EFFECT_COLOURS.resonance,
              colourTo: EFFECT_COLOURS.gold,
              opacity: 0.32,
              brightness: 1.8,
              lifetime: 0.42,
              spin: ring === 0 ? 2 : -2,
            }),
            0.05,
          );
          burst({
            position,
            pattern: 'ring',
            count: 14,
            spawnRadius: 0.3,
            speed: 6,
            axialSpeed: 2.2,
            lifetime: 0.5,
            size: [0.13, 0],
            colour: EFFECT_COLOURS.gold,
            colourTo: EFFECT_COLOURS.resonance,
            shape: 'shard',
            gravity: -12,
            drag: 2,
            brightness: [2.4, 0.5],
          });
        }
      });

      // -- Combat: the counter --------------------------------------------
      // The opening of the window is an audio tick in the mix; this is its
      // visual equal, and the game must be counterable with the sound off.
      on('combat:counterWindow', ({ position, opening }) => {
        if (!opening) return;
        for (let i = 0; i < 2; i++) {
          echo({
            position,
            orientation: 'billboard',
            form: 'arc',
            radiusFrom: 1.15,
            radiusTo: 0.85,
            colour: EFFECT_COLOURS.gold,
            opacity: 0.4,
            brightness: 1.5,
            lifetime: 0.24,
            // Counter-rotating arcs: interlocking, and unmistakably a window.
            spin: i === 0 ? 7 : -7,
          });
        }
      });

      on('combat:countered', ({ position, success, converted }) => {
        if (!success) {
          echo({
            position,
            orientation: 'billboard',
            form: 'arc',
            radiusFrom: 0.9,
            radiusTo: 1.2,
            colour: EFFECT_COLOURS.infection,
            opacity: 0.26,
            brightness: 0.9,
            lifetime: 0.3,
            spin: -3,
          });
          return;
        }

        // Reflection flare: gold, interlocking, and briefly brighter than
        // anything else the player can cause.
        for (let i = 0; i < 3; i++) {
          echo({
            position,
            orientation: 'billboard',
            form: i === 2 ? 'circle' : 'arc',
            radiusFrom: i === 2 ? 0.3 : 0.7,
            radiusTo: i === 2 ? 1.6 : 1.25,
            colour: EFFECT_COLOURS.gold,
            colourTo: converted ? EFFECT_COLOURS.resonance : EFFECT_COLOURS.ink,
            opacity: 0.45,
            brightness: 2.4,
            lifetime: 0.34,
            spin: i === 0 ? 9 : i === 1 ? -9 : 2,
          });
        }
        burst({
          position,
          pattern: 'ring',
          count: 12,
          spawnRadius: 0.35,
          speed: 5.5,
          lifetime: 0.36,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.gold,
          colourTo: converted ? EFFECT_COLOURS.resonance : EFFECT_COLOURS.goldDim,
          shape: 'glyph',
          drag: 3,
          brightness: [2.6, 0.6],
          spin: { min: -6, max: 6 },
        });
        if (converted) {
          echo({
            position,
            form: 'hexagon',
            radiusFrom: 0.4,
            radiusTo: 2.1,
            colour: EFFECT_COLOURS.resonance,
            opacity: 0.3,
            brightness: 1.6,
            lifetime: 0.4,
            spin: 3,
          });
        }
      });

      // -- Cleanse: the most important colour story in the game -------------
      // A guardian is FREED, not killed. Violet infection breaks into magenta
      // and dissolves into green motes that drift upward and thin out. There is
      // no gore, no black smoke, and nothing that reads as a death.
      on('combat:enemyCleansed', ({ position }) => {
        burst({
          position,
          pattern: 'sphere',
          count: 20,
          spawnRadius: 0.5,
          speed: { min: 0.8, max: 2.2 },
          axialSpeed: 0,
          lifetime: { min: 0.8, max: 1.3 },
          size: [0.16, 0.01],
          colour: EFFECT_COLOURS.infection,
          colourMid: EFFECT_COLOURS.magenta,
          colourTo: EFFECT_COLOURS.restore,
          shape: 'mote',
          gravity: 1.6,
          drag: 1.5,
          opacity: 0.9,
          brightness: [1.4, 1.9],
          fadePower: 1.1,
          spin: { min: -3, max: 3 },
        });
        // One ring opening outward, one closing in: the region taking itself
        // back rather than something being destroyed.
        echo({
          position,
          form: 'circle',
          radiusFrom: 0.4,
          radiusTo: 2.1,
          colour: EFFECT_COLOURS.magenta,
          colourTo: EFFECT_COLOURS.restore,
          opacity: 0.36,
          brightness: 1.6,
          lifetime: 0.6,
        });
        echo({
          position,
          form: 'hexagon',
          radiusFrom: 2.3,
          radiusTo: 0.35,
          colour: EFFECT_COLOURS.restore,
          opacity: 0.3,
          brightness: 1.4,
          lifetime: 0.55,
          delay: 0.12,
          spin: 1.6,
        });
      });

      // -- Player damage ---------------------------------------------------
      // Note what this is NOT: there is no full-screen red flash. The cue is an
      // in-world figure collapsing onto the player, which reads as "you were
      // struck" without hiding the platform they are standing on.
      on('combat:playerHurt', ({ position, damage }) => {
        const weight = clamp01(damage / 24);
        concentric(
          2,
          (ring) => ({
            position,
            form: ring === 0 ? 'circle' : 'triangle',
            radiusFrom: 1.7 + weight * 0.8 - ring * 0.4,
            radiusTo: 0.65,
            colour: EFFECT_COLOURS.alarm,
            colourTo: EFFECT_COLOURS.infection,
            opacity: 0.28 + weight * 0.14,
            brightness: 1.3,
            lifetime: 0.3,
            spin: ring === 0 ? -2.5 : 2.5,
          }),
          0.05,
        );
        burst({
          position,
          pattern: 'sphere',
          count: 6,
          spawnRadius: 0.4,
          speed: { min: 1.5, max: 3.5 },
          lifetime: 0.3,
          size: [0.09, 0],
          colour: EFFECT_COLOURS.alarm,
          colourTo: EFFECT_COLOURS.infectionDeep,
          shape: 'shard',
          gravity: -8,
          drag: 3,
          brightness: [1.6, 0.3],
        });
      });

      on('combat:playerDowned', ({ position }) => {
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 3.2 - ring * 0.6,
            radiusTo: 0.3,
            colour: EFFECT_COLOURS.infection,
            colourTo: EFFECT_COLOURS.gold,
            opacity: 0.3,
            brightness: 1.2,
            lifetime: 0.8,
            spin: ring % 2 === 0 ? 1.4 : -1.4,
          }),
          0.1,
        );
      });

      // -- Forms -----------------------------------------------------------
      on('form:switched', ({ to }) => {
        const colour = formColour(to);
        concentric(
          2,
          (ring) => ({
            position: playerAnchor,
            form: ring === 0 ? 'circle' : 'hexagon',
            radiusFrom: 0.3,
            radiusTo: 1.4 + ring * 0.5,
            colour,
            colourTo: EFFECT_COLOURS.gold,
            opacity: 0.3,
            brightness: 1.5,
            lifetime: 0.4,
            spin: ring === 0 ? 2 : -2,
          }),
          0.06,
        );
      });

      on('form:abilityUsed', ({ form, position }) => {
        const colour = formColour(form);
        echo({
          position,
          form: 'hexagon',
          radiusFrom: 0.35,
          radiusTo: 2,
          colour,
          colourTo: EFFECT_COLOURS.resonance,
          opacity: 0.32,
          brightness: 1.6,
          lifetime: 0.45,
          spin: 2.4,
        });
        burst({
          position,
          pattern: 'ring',
          count: 10,
          spawnRadius: 0.4,
          speed: 3.4,
          axialSpeed: 1.6,
          lifetime: 0.5,
          size: [0.1, 0],
          colour,
          colourTo: EFFECT_COLOURS.ink,
          shape: 'glyph',
          drag: 2.4,
          brightness: [1.8, 0.5],
          spin: { min: -5, max: 5 },
        });
      });

      // -- Puzzles ---------------------------------------------------------
      /**
       * The struck note. **This is a required visual equivalent, not garnish.**
       *
       * Two colour-free channels encode the pitch: the ring's radius grows with
       * the harmonic degree, and the mote burst has exactly `3 + degree`
       * vertices, so a player can count what they cannot hear. A second ring
       * marks the upper half of the scale.
       */
      on('puzzle:noteStruck', ({ degree, hz, position }) => {
        const step = clamp(Math.floor(degree), 0, 7);
        const radius = 0.55 + step * 0.26;
        const rings = step >= 4 ? 2 : 1;
        concentric(
          rings,
          (ring) => ({
            position,
            form: 'circle',
            radiusFrom: 0.18,
            radiusTo: radius * (1 - ring * 0.35),
            colour: EFFECT_COLOURS.resonance,
            colourTo: EFFECT_COLOURS.gold,
            opacity: 0.42,
            brightness: 1.5 + step * 0.08,
            lifetime: 0.5,
            // A gentle tie to the sounded frequency, well below any strobe rate.
            spin: (hz / 432) * 1.2,
          }),
          0.08,
        );
        burst({
          position,
          pattern: 'polygon',
          polygonSides: 3 + step,
          count: 3 + step,
          spawnRadius: radius,
          speed: 0.9,
          axialSpeed: 1.5,
          lifetime: 0.55,
          size: [0.11, 0.01],
          colour: EFFECT_COLOURS.resonance,
          colourTo: EFFECT_COLOURS.gold,
          shape: 'mote',
          drag: 1.8,
          brightness: [2, 0.6],
        });
      });

      on('puzzle:solved', ({ position }) => {
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 0.4,
            radiusTo: 1.4 + ring * 0.9,
            colour: EFFECT_COLOURS.gold,
            colourTo: EFFECT_COLOURS.restore,
            opacity: 0.36,
            brightness: 1.9,
            lifetime: 0.7,
            spin: ring % 2 === 0 ? 1.8 : -1.8,
          }),
          0.09,
        );
        burst({
          position,
          pattern: 'ring',
          count: 18,
          spawnRadius: 0.5,
          speed: 2.6,
          axialSpeed: 3,
          lifetime: 0.9,
          size: [0.12, 0],
          colour: EFFECT_COLOURS.gold,
          colourTo: EFFECT_COLOURS.restore,
          shape: 'mote',
          gravity: -2,
          drag: 1.4,
          brightness: [2.2, 0.6],
        });
      });

      on('puzzle:failed', ({ position }) => {
        // Dim, inward, and slow: legible as a failure without any flashing.
        echo({
          position,
          form: 'square',
          radiusFrom: 2.1,
          radiusTo: 0.9,
          colour: EFFECT_COLOURS.infection,
          colourTo: EFFECT_COLOURS.infectionDeep,
          opacity: 0.3,
          brightness: 1,
          lifetime: 0.45,
          spin: -1.2,
        });
        burst({
          position,
          pattern: 'ring',
          count: 6,
          spawnRadius: 0.8,
          speed: 0.6,
          lifetime: 0.5,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.infection,
          shape: 'shard',
          gravity: -11,
          drag: 1.2,
          opacity: 0.7,
          brightness: [1, 0.2],
        });
      });

      // -- World -----------------------------------------------------------
      on('world:pickupCollected', ({ kind, position }) => {
        const colour = kind === 'coherence' ? EFFECT_COLOURS.restore : EFFECT_COLOURS.gold;
        echo({
          position,
          form: 'circle',
          radiusFrom: 0.15,
          radiusTo: 0.95,
          colour,
          opacity: 0.34,
          brightness: 1.7,
          lifetime: 0.3,
          spin: 3,
        });
        burst({
          position,
          pattern: 'sphere',
          count: 8,
          spawnRadius: 0.2,
          speed: { min: 0.6, max: 1.6 },
          axialSpeed: 2.4,
          lifetime: 0.55,
          size: [0.09, 0],
          colour,
          colourTo: EFFECT_COLOURS.ink,
          shape: 'mote',
          gravity: 2.2,
          drag: 2.2,
          brightness: [2, 0.5],
        });
      });

      on('world:secretFound', ({ position }) => {
        concentric(
          2,
          (ring) => ({
            position,
            form: ring === 0 ? 'hexagon' : 'circle',
            radiusFrom: 0.3,
            radiusTo: 1.3 + ring * 0.7,
            colour: EFFECT_COLOURS.gold,
            opacity: 0.34,
            brightness: 1.8,
            lifetime: 0.6,
            spin: ring === 0 ? 2.2 : -1.6,
          }),
          0.08,
        );
        burst({
          position,
          pattern: 'ring',
          count: 10,
          spawnRadius: 0.4,
          speed: 1.6,
          axialSpeed: 2.6,
          lifetime: 0.8,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.gold,
          shape: 'glyph',
          drag: 1.6,
          brightness: [2, 0.4],
          spin: { min: -4, max: 4 },
        });
      });

      // A checkpoint is a small sanctuary: a three-ring lattice and a rising
      // column, gold, calm, and gone in under a second.
      on('world:checkpointActivated', ({ position }) => {
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 0.3,
            radiusTo: 1.1 + ring * 0.75,
            colour: EFFECT_COLOURS.gold,
            colourTo: EFFECT_COLOURS.resonance,
            opacity: 0.32,
            brightness: 1.8,
            lifetime: 0.8,
            spin: ring % 2 === 0 ? 1.5 : -1.5,
          }),
          0.1,
        );
        burst({
          position,
          pattern: 'ring',
          count: 12,
          spawnRadius: 1.05,
          speed: 0,
          axialSpeed: 3.2,
          lifetime: 1.1,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.gold,
          colourTo: EFFECT_COLOURS.ink,
          shape: 'mote',
          drag: 1,
          brightness: [1.8, 0.5],
          fadeIn: 0.1,
        });
      });

      // The restoration wave. Wide, but the widest thing in the game is also the
      // faintest, and it is a single-line annulus.
      on('world:restorationStep', ({ progress }) => {
        const reach = 3.5 + clamp01(progress) * 6;
        concentric(
          2,
          (ring) => ({
            position: playerAnchor,
            form: ring === 0 ? 'circle' : 'hexagon',
            radiusFrom: 0.5,
            radiusTo: reach - ring * 1.2,
            colour: EFFECT_COLOURS.restore,
            colourTo: EFFECT_COLOURS.resonance,
            // Deliberately low: this sweeps across the whole play space.
            opacity: 0.22,
            brightness: 1.4,
            lifetime: 1.2,
            spin: ring === 0 ? 0.6 : -0.6,
          }),
          0.12,
        );
        burst({
          position: playerAnchor,
          pattern: 'ring',
          count: 14,
          spawnRadius: 1.4,
          speed: 1.2,
          axialSpeed: 2.2,
          lifetime: 1.2,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.restore,
          colourTo: EFFECT_COLOURS.resonance,
          shape: 'mote',
          drag: 1.2,
          brightness: [1.6, 0.4],
          fadeIn: 0.15,
        });
      });

      // -- Boss ------------------------------------------------------------
      on('boss:telegraph', ({ position }) => {
        // Telegraph rings themselves belong to the scene's timing layer; this
        // handler only keeps the anchor current for position-less boss events.
        bossKnown = true;
        bossAnchor.x = position.x;
        bossAnchor.y = position.y;
        bossAnchor.z = position.z;
      });

      on('boss:attackStarted', ({ position }) => {
        bossKnown = true;
        bossAnchor.x = position.x;
        bossAnchor.y = position.y;
        bossAnchor.z = position.z;
      });

      on('boss:phaseChanged', ({ phaseIndex }) => {
        const position = bossKnown ? bossAnchor : playerAnchor;
        concentric(
          4,
          (ring) => ({
            position,
            form: ECHO_FORMS[(ring + 1) % ECHO_FORMS.length] ?? 'circle',
            radiusFrom: 0.6,
            radiusTo: 3 + ring * 1.1,
            colour: EFFECT_COLOURS.infection,
            colourTo: EFFECT_COLOURS.resonance,
            opacity: 0.28,
            brightness: 1.6 + Math.min(phaseIndex, 3) * 0.15,
            lifetime: 0.9,
            spin: ring % 2 === 0 ? 1.2 : -1.2,
          }),
          0.11,
        );
        burst({
          position,
          pattern: 'ring',
          count: 24,
          spawnRadius: 1.2,
          speed: 5,
          axialSpeed: 3,
          lifetime: 0.8,
          size: [0.14, 0],
          colour: EFFECT_COLOURS.infection,
          colourMid: EFFECT_COLOURS.magenta,
          colourTo: EFFECT_COLOURS.resonance,
          shape: 'shard',
          gravity: -6,
          drag: 1.8,
          brightness: [2.2, 0.5],
          spin: { min: -8, max: 8 },
        });
      });

      on('boss:vulnerable', ({ open }) => {
        if (!open) return;
        echo({
          position: bossKnown ? bossAnchor : playerAnchor,
          form: 'hexagon',
          radiusFrom: 3.4,
          radiusTo: 2.6,
          colour: EFFECT_COLOURS.gold,
          opacity: 0.34,
          brightness: 1.8,
          lifetime: 0.4,
          spin: 3,
        });
      });

      on('boss:restorationStarted', () => {
        const position = bossKnown ? bossAnchor : playerAnchor;
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 0.8,
            radiusTo: 4 + ring * 1.4,
            colour: EFFECT_COLOURS.magenta,
            colourTo: EFFECT_COLOURS.restore,
            opacity: 0.3,
            brightness: 1.7,
            lifetime: 1.4,
            spin: ring % 2 === 0 ? 0.9 : -0.9,
          }),
          0.16,
        );
        burst({
          position,
          pattern: 'ring',
          count: 22,
          spawnRadius: 2,
          speed: 0.8,
          axialSpeed: 2.6,
          lifetime: 1.5,
          size: [0.13, 0.01],
          colour: EFFECT_COLOURS.infection,
          colourMid: EFFECT_COLOURS.magenta,
          colourTo: EFFECT_COLOURS.restore,
          shape: 'mote',
          drag: 1,
          brightness: [1.5, 1.9],
          fadeIn: 0.12,
        });
      });

      // -- Movement --------------------------------------------------------
      // Every one of these expands *outward* from the contact point and is gone
      // in a third of a second, so the ground being landed on stays visible.
      on('player:jumped', ({ position, doubleJump, wallJump }) => {
        echo({
          position,
          orientation: wallJump ? 'billboard' : 'ground',
          form: doubleJump ? 'hexagon' : 'circle',
          radiusFrom: 0.22,
          radiusTo: doubleJump ? 1 : 0.75,
          colour: EFFECT_COLOURS.resonance,
          opacity: 0.26,
          brightness: 1.3,
          lifetime: 0.24,
          spin: doubleJump ? 4 : 0,
        });
        if (doubleJump) {
          burst({
            position,
            pattern: 'ring',
            count: 6,
            spawnRadius: 0.35,
            speed: 1.6,
            lifetime: 0.28,
            size: [0.07, 0],
            colour: EFFECT_COLOURS.resonance,
            shape: 'fleck',
            drag: 3,
            opacity: 0.7,
            brightness: [1.5, 0.3],
          });
        }
      });

      on('player:landed', ({ position, impactSpeed }) => {
        const weight = clamp01(impactSpeed / 22);
        echo({
          position,
          form: 'circle',
          radiusFrom: 0.28,
          radiusTo: 0.6 + weight * 1.1,
          colour: EFFECT_COLOURS.resonance,
          colourTo: EFFECT_COLOURS.ink,
          opacity: 0.16 + weight * 0.2,
          brightness: 1.2,
          lifetime: 0.26,
        });
        if (weight > 0.15) {
          burst({
            position,
            pattern: 'ring',
            count: 3 + Math.round(weight * 7),
            spawnRadius: 0.3,
            speed: 1.4 + weight * 3,
            axialSpeed: 0.8,
            lifetime: 0.3,
            size: [0.07, 0],
            colour: EFFECT_COLOURS.resonance,
            colourTo: EFFECT_COLOURS.ink,
            shape: 'fleck',
            gravity: -7,
            drag: 4,
            opacity: 0.6,
            brightness: [1.3, 0.2],
          });
        }
      });

      on('player:dashed', ({ position, direction, airborne }) => {
        echo({
          position,
          orientation: 'normal',
          normal: direction,
          form: 'arc',
          radiusFrom: 0.95,
          radiusTo: 0.35,
          colour: EFFECT_COLOURS.gold,
          colourTo: EFFECT_COLOURS.resonance,
          opacity: 0.32,
          brightness: 1.6,
          lifetime: 0.22,
          spin: 8,
        });
        // A laid-down line rather than a live emitter: the ribbon is complete on
        // the frame the dash starts, so it cannot lag behind the character.
        burst({
          position,
          direction,
          pattern: 'line',
          length: airborne ? 2.2 : 1.7,
          count: 10,
          speed: 0,
          lifetime: 0.26,
          size: [0.1, 0],
          colour: EFFECT_COLOURS.gold,
          colourTo: EFFECT_COLOURS.resonance,
          shape: 'fleck',
          drag: 5,
          opacity: 0.55,
          brightness: [1.6, 0.2],
        });
      });

      on('player:wallCling', ({ position, normal }) => {
        for (let i = 0; i < 2; i++) {
          echo({
            position,
            orientation: 'normal',
            normal,
            form: 'arc',
            radiusFrom: 0.35,
            radiusTo: 0.62,
            colour: EFFECT_COLOURS.resonance,
            opacity: 0.24,
            brightness: 1.2,
            lifetime: 0.3,
            spin: i === 0 ? 3 : -3,
          });
        }
      });

      on('player:railAttached', ({ position }) => {
        concentric(
          2,
          (ring) => ({
            position,
            orientation: 'billboard',
            form: ring === 0 ? 'circle' : 'hexagon',
            radiusFrom: 0.9,
            radiusTo: 0.4 + ring * 0.2,
            colour: EFFECT_COLOURS.gold,
            colourTo: EFFECT_COLOURS.resonance,
            opacity: 0.3,
            brightness: 1.5,
            lifetime: 0.3,
            spin: ring === 0 ? 5 : -5,
          }),
          0.05,
        );
        burst({
          position,
          pattern: 'sphere',
          count: 8,
          spawnRadius: 0.3,
          speed: { min: 0.8, max: 2 },
          lifetime: 0.4,
          size: [0.08, 0],
          colour: EFFECT_COLOURS.gold,
          shape: 'glyph',
          drag: 3,
          opacity: 0.7,
          brightness: [1.8, 0.3],
          spin: { min: -6, max: 6 },
        });
      });

      on('player:railDetached', ({ position }) => {
        echo({
          position,
          orientation: 'billboard',
          form: 'circle',
          radiusFrom: 0.35,
          radiusTo: 0.9,
          colour: EFFECT_COLOURS.goldDim,
          opacity: 0.22,
          brightness: 1.1,
          lifetime: 0.22,
        });
      });

      on('player:bounced', ({ position, strength }) => {
        const weight = clamp01(strength / 20);
        concentric(
          2,
          (ring) => ({
            position,
            form: ring === 0 ? 'circle' : 'triangle',
            radiusFrom: 0.25,
            radiusTo: 0.8 + weight * 1.4 - ring * 0.3,
            colour: EFFECT_COLOURS.restore,
            colourTo: EFFECT_COLOURS.resonance,
            opacity: 0.26,
            brightness: 1.4,
            lifetime: 0.3,
            spin: ring === 0 ? 2 : -2,
          }),
          0.05,
        );
        burst({
          position,
          pattern: 'ring',
          count: 8,
          spawnRadius: 0.3,
          speed: 1.8,
          axialSpeed: 2.4 + weight * 2,
          lifetime: 0.4,
          size: [0.09, 0],
          colour: EFFECT_COLOURS.restore,
          shape: 'mote',
          gravity: -8,
          drag: 2.4,
          opacity: 0.7,
          brightness: [1.6, 0.3],
        });
      });

      on('player:ledgeGrabbed', ({ position }) => {
        echo({
          position,
          orientation: 'billboard',
          form: 'arc',
          radiusFrom: 0.5,
          radiusTo: 0.75,
          colour: EFFECT_COLOURS.resonance,
          opacity: 0.22,
          brightness: 1.1,
          lifetime: 0.24,
          spin: 4,
        });
      });

      on('stage:respawned', ({ position }) => {
        concentric(
          3,
          (ring) => ({
            position,
            form: ring === 1 ? 'hexagon' : 'circle',
            radiusFrom: 2.4 - ring * 0.5,
            radiusTo: 0.4,
            colour: EFFECT_COLOURS.gold,
            colourTo: EFFECT_COLOURS.resonance,
            opacity: 0.3,
            brightness: 1.6,
            lifetime: 0.6,
            spin: ring % 2 === 0 ? 2 : -2,
          }),
          0.08,
        );
      });

      /**
       * `fx:flash` is *not* rendered as a screen flash.
       *
       * The event exists so audio, haptics and rendering can share one cue, but
       * a full-screen white frame would hide the ground mid-jump and is exactly
       * the failure this layer is built to avoid. It is drawn instead as a pair
       * of small camera-facing rings at the player, in the requested colour.
       */
      on('fx:flash', ({ colour }) => {
        for (let i = 0; i < 2; i++) {
          echo({
            position: anchorOf(),
            orientation: 'billboard',
            form: i === 0 ? 'circle' : 'arc',
            radiusFrom: 0.6 + i * 0.4,
            radiusTo: 1.5 + i * 0.5,
            colour,
            opacity: 0.24,
            brightness: 1.3,
            lifetime: 0.28,
            spin: i === 0 ? 3 : -3,
          });
        }
      });

      return () => {
        for (const unsubscribe of subs) unsubscribe();
        subs.length = 0;
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Composition helper
// ---------------------------------------------------------------------------

export interface ResonanceEffectsHandle {
  readonly particles: ParticleSystem;
  readonly echoes: GeometryEchoField;
  readonly director: EffectDirector;
}

export interface CreateResonanceEffectsOptions {
  readonly tier?: GraphicsTier;
  readonly accessibility?: Partial<AccessibilityConfig>;
  readonly particleCapacity?: number;
  readonly echoCapacity?: number;
  readonly seed?: number | string;
}

/** Maps the game's accessibility config onto the two reductions VFX honour. */
export function effectAccessibilityFrom(
  config?: Partial<AccessibilityConfig>,
): ParticleAccessibility {
  return {
    reducedParticles: config?.reducedParticles === true,
    reducedFlashing: config?.reducedFlashing === true,
    reducedMotion: config?.reducedMotion === true,
  };
}

/** Builds both pools and a director over them. Pure — no React, no Three.js. */
export function createResonanceEffects(
  options: CreateResonanceEffectsOptions = {},
): ResonanceEffectsHandle {
  const accessibility = effectAccessibilityFrom(options.accessibility);
  const particles = createParticleSystem({
    tier: options.tier ?? 'high',
    capacity: options.particleCapacity,
    accessibility,
    seed: options.seed ?? 'tuner-vfx',
  });
  const echoes = createGeometryEchoes({
    capacity: options.echoCapacity,
    accessibility,
  });
  const director = createEffectDirector({ particles, echoes, accessibility });
  return { particles, echoes, director };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const SHAPE_COUNT = PARTICLE_SHAPES.length;
const ECHO_FORM_COUNT = ECHO_FORMS.length;

/** Order must match `PARTICLE_SHAPES`. */
function createParticleGeometries(): THREE.BufferGeometry[] {
  return [
    new THREE.OctahedronGeometry(1, 0),
    new THREE.TetrahedronGeometry(1, 0),
    new THREE.PlaneGeometry(1, 1),
    new THREE.RingGeometry(0.5, 1, 6),
  ];
}

/** Order must match `ECHO_FORMS`. Thin annuli, never discs. */
function createEchoGeometries(): THREE.BufferGeometry[] {
  return [
    new THREE.RingGeometry(ECHO_RING_RATIO, 1, 48),
    new THREE.RingGeometry(0.8, 1, 3),
    new THREE.RingGeometry(0.82, 1, 4),
    new THREE.RingGeometry(ECHO_RING_RATIO, 1, 6),
    new THREE.RingGeometry(0.88, 1, 24, 0, Math.PI * 0.55),
  ];
}

/**
 * Additive, depth-tested, never depth-writing.
 *
 * Additive blending is the load-bearing choice: an additive ring can only add
 * light to what is behind it, so no effect can hide a platform. Depth *testing*
 * stays on so effects behind geometry are occluded rather than shining through
 * walls, which would be its own kind of unreadable.
 */
function createEffectMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Tumble axis for solid particles — an arbitrary but stable diagonal. */
const TUMBLE_AXIS = new THREE.Vector3(0.577, 0.577, 0.577);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export interface ParticleFieldProps {
  readonly particles: ParticleSystem;
  /**
   * Called once at the top of this component's frame callback, before anything
   * is read. React Three Fiber registers `useFrame` subscribers bottom-up, so
   * the advance has to happen inside the first drawing component rather than in
   * a parent — otherwise every effect would be drawn a frame stale.
   */
  readonly advance?: (dt: number) => void;
}

/**
 * One instanced draw call per particle shape, driven straight from the pool.
 *
 * Each shape's mesh is sized for the whole pool rather than a share of it. That
 * costs some instance memory, but the alternative is that a burst which happens
 * to be all one shape gets clipped — and silently dropping the newest particles
 * is the exact failure the pool's recycling policy exists to prevent.
 */
export function ParticleField({ particles, advance }: ParticleFieldProps): ReactElement {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>(
    new Array<THREE.InstancedMesh | null>(SHAPE_COUNT).fill(null),
  );

  const geometries = useMemo(createParticleGeometries, []);
  const materials = useMemo(
    () => geometries.map(() => createEffectMaterial()),
    [geometries],
  );
  // One set of scratch objects for the whole field. Nothing in the frame
  // callback below allocates — a particle renderer that produces garbage every
  // frame defeats the point of pooling the particles.
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      spinQuaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      colour: new THREE.Color(),
      counts: new Array<number>(SHAPE_COUNT).fill(0),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    [geometries, materials],
  );

  useFrame((state, delta) => {
    advance?.(delta);

    const buffers = particles.buffers;
    const active = particles.compact();
    const counts = scratch.counts;
    for (let i = 0; i < SHAPE_COUNT; i++) counts[i] = 0;

    for (let n = 0; n < active; n++) {
      const index = buffers.live[n] ?? 0;
      const alpha = buffers.alpha[index] ?? 0;
      const size = buffers.size[index] ?? 0;
      if (alpha <= 0.002 || size <= 0.0005) continue;

      const shapeIndex = Math.min(SHAPE_COUNT - 1, buffers.shape[index] ?? 0);
      const mesh = meshes.current[shapeIndex];
      const slot = counts[shapeIndex] ?? 0;
      if (!mesh || slot >= mesh.instanceMatrix.count) continue;

      const i3 = index * 3;
      scratch.position.set(
        buffers.position[i3] ?? 0,
        buffers.position[i3 + 1] ?? 0,
        buffers.position[i3 + 2] ?? 0,
      );
      const spin = buffers.rotation[index] ?? 0;

      if (shapeIndex === 2) {
        // Flecks lie along their own travel, which is what makes a dash ribbon
        // read as motion rather than as confetti.
        scratch.direction.set(
          buffers.velocity[i3] ?? 0,
          buffers.velocity[i3 + 1] ?? 0,
          buffers.velocity[i3 + 2] ?? 0,
        );
        if (scratch.direction.lengthSq() < 1e-8) scratch.direction.copy(X_AXIS);
        else scratch.direction.normalize();
        scratch.quaternion.setFromUnitVectors(X_AXIS, scratch.direction);
        scratch.scale.set(size * 2.6, size * 0.5, size);
      } else if (shapeIndex === 3) {
        // Glyphs face the camera and spin in view space, so the little annulus
        // always reads as a ring rather than as an ellipse edge-on.
        scratch.spinQuaternion.setFromAxisAngle(Z_AXIS, spin);
        scratch.quaternion.copy(state.camera.quaternion).multiply(scratch.spinQuaternion);
        scratch.scale.set(size, size, size);
      } else {
        scratch.quaternion.setFromAxisAngle(TUMBLE_AXIS, spin);
        scratch.scale.set(size, size, size);
      }

      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(slot, scratch.matrix);

      // Alpha and brightness are folded into the instance colour: with additive
      // blending a darker instance *is* a fainter one, which gives per-instance
      // fade without a custom shader or a per-instance material.
      const brightness = buffers.brightness[index] ?? 1;
      scratch.colour.setRGB(
        buffers.colour[i3] ?? 1,
        buffers.colour[i3 + 1] ?? 1,
        buffers.colour[i3 + 2] ?? 1,
        THREE.SRGBColorSpace,
      );
      scratch.colour.multiplyScalar(alpha * brightness);
      mesh.setColorAt(slot, scratch.colour);
      counts[shapeIndex] = slot + 1;
    }

    for (let i = 0; i < SHAPE_COUNT; i++) {
      const mesh = meshes.current[i];
      if (!mesh) continue;
      mesh.count = counts[i] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  });

  const capacity = particles.capacity;

  return (
    <>
      {PARTICLE_SHAPES.map((shape, index) => {
        const geometry = geometries[index];
        const material = materials[index];
        if (geometry === undefined || material === undefined) return null;
        return (
          <instancedMesh
            key={shape}
            ref={(mesh) => {
              meshes.current[index] = mesh;
            }}
            args={[geometry, material, capacity]}
            // An InstancedMesh is constructed with its full count, so without
            // this the very first frame would draw the whole pool stacked at the
            // origin before the frame callback has written anything.
            count={0}
            frustumCulled={false}
            renderOrder={3}
          />
        );
      })}
    </>
  );
}

export interface EchoFieldProps {
  readonly echoes: GeometryEchoField;
}

/** Rings, polygons and arcs — one instanced draw call per form. */
export function EchoField({ echoes }: EchoFieldProps): ReactElement {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>(
    new Array<THREE.InstancedMesh | null>(ECHO_FORM_COUNT).fill(null),
  );

  const geometries = useMemo(createEchoGeometries, []);
  const materials = useMemo(() => geometries.map(() => createEffectMaterial()), [geometries]);
  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      spinQuaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      colour: new THREE.Color(),
      counts: new Array<number>(ECHO_FORM_COUNT).fill(0),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    [geometries, materials],
  );

  useFrame((state) => {
    const buffers = echoes.buffers;
    const active = echoes.compact();
    const counts = scratch.counts;
    for (let i = 0; i < ECHO_FORM_COUNT; i++) counts[i] = 0;

    for (let n = 0; n < active; n++) {
      const index = buffers.live[n] ?? 0;
      const alpha = buffers.alpha[index] ?? 0;
      const radius = buffers.radius[index] ?? 0;
      if (alpha <= 0.002 || radius <= 0.001) continue;

      const formIndex = Math.min(ECHO_FORM_COUNT - 1, buffers.form[index] ?? 0);
      const mesh = meshes.current[formIndex];
      const slot = counts[formIndex] ?? 0;
      if (!mesh || slot >= mesh.instanceMatrix.count) continue;

      const i3 = index * 3;
      scratch.position.set(
        buffers.position[i3] ?? 0,
        buffers.position[i3 + 1] ?? 0,
        buffers.position[i3 + 2] ?? 0,
      );

      const spin = buffers.rotation[index] ?? 0;
      scratch.spinQuaternion.setFromAxisAngle(Z_AXIS, spin);
      if ((buffers.orientation[index] ?? 0) === 1) {
        scratch.quaternion.copy(state.camera.quaternion).multiply(scratch.spinQuaternion);
      } else {
        // Ring geometry lies in XY facing +Z, so aligning +Z to the surface
        // normal lays it flat on the ground (normal +Y) or flush to a wall.
        scratch.normal.set(
          buffers.normal[i3] ?? 0,
          buffers.normal[i3 + 1] ?? 1,
          buffers.normal[i3 + 2] ?? 0,
        );
        if (scratch.normal.lengthSq() < 1e-8) scratch.normal.set(0, 1, 0);
        else scratch.normal.normalize();
        scratch.quaternion.setFromUnitVectors(Z_AXIS, scratch.normal);
        scratch.quaternion.multiply(scratch.spinQuaternion);
      }

      scratch.scale.set(radius, radius, 1);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(slot, scratch.matrix);

      const brightness = buffers.brightness[index] ?? 1;
      scratch.colour.setRGB(
        buffers.colour[i3] ?? 1,
        buffers.colour[i3 + 1] ?? 1,
        buffers.colour[i3 + 2] ?? 1,
        THREE.SRGBColorSpace,
      );
      scratch.colour.multiplyScalar(alpha * brightness);
      mesh.setColorAt(slot, scratch.colour);
      counts[formIndex] = slot + 1;
    }

    for (let i = 0; i < ECHO_FORM_COUNT; i++) {
      const mesh = meshes.current[i];
      if (!mesh) continue;
      mesh.count = counts[i] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  });

  const capacity = echoes.capacity;

  return (
    <>
      {ECHO_FORMS.map((form, index) => {
        const geometry = geometries[index];
        const material = materials[index];
        if (geometry === undefined || material === undefined) return null;
        return (
          <instancedMesh
            key={form}
            ref={(mesh) => {
              meshes.current[index] = mesh;
            }}
            args={[geometry, material, capacity]}
            count={0}
            frustumCulled={false}
            renderOrder={4}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The composed layer
// ---------------------------------------------------------------------------

export interface ResonanceEffectsProps {
  readonly bus: EventBus<GameEvents>;
  /**
   * Live world, for the anchors used by events that carry no position (a boss
   * phase change, the restoration wave). The object reference is stable and read
   * inside the frame callback, so this never turns simulation state into React
   * state.
   */
  readonly world?: WorldState;
  readonly tier?: GraphicsTier;
  readonly accessibility?: Partial<AccessibilityConfig>;
  readonly particleCapacity?: number;
  readonly echoCapacity?: number;
  /** Freezes the effect clock. Live effects hold rather than vanish. */
  readonly paused?: boolean;
}

/**
 * Drop this into the scene alongside `TunerScene` and the whole effect layer is
 * wired: it owns the pools, subscribes to the bus and draws in nine instanced
 * draw calls regardless of how much is happening.
 */
export function ResonanceEffects(props: ResonanceEffectsProps): ReactElement {
  const { bus, tier, particleCapacity, echoCapacity } = props;

  // The pool is allocated once at the *largest* budget this session could ask
  // for, and a quality change then moves the live ceiling rather than
  // reallocating. That is what makes the adaptive quality controller free: it
  // can drop the tier mid-fight without a single allocation.
  const handle = useMemo(
    () =>
      createResonanceEffects({
        particleCapacity: particleCapacity ?? QUALITY_PRESETS.high.particleBudget,
        echoCapacity,
      }),
    [particleCapacity, echoCapacity],
  );

  useEffect(() => {
    handle.particles.setTier(tier ?? 'high');
  }, [handle, tier]);

  // Refs, not state: neither the world nor the paused flag may cause a re-render
  // from inside the frame loop.
  const worldRef = useRef<WorldState | undefined>(props.world);
  worldRef.current = props.world;
  const pausedRef = useRef<boolean>(props.paused === true);
  pausedRef.current = props.paused === true;

  const reducedParticles = props.accessibility?.reducedParticles === true;
  const reducedFlashing = props.accessibility?.reducedFlashing === true;
  const reducedMotion = props.accessibility?.reducedMotion === true;

  useEffect(() => {
    handle.director.setAccessibility({ reducedParticles, reducedFlashing, reducedMotion });
  }, [handle, reducedParticles, reducedFlashing, reducedMotion]);

  useEffect(() => {
    const unsubscribe = handle.director.subscribe(bus);
    return () => {
      unsubscribe();
      handle.particles.clear();
      handle.echoes.clear();
    };
  }, [handle, bus]);

  const advance = useMemo(
    () => (dt: number) => {
      const world = worldRef.current;
      if (world !== undefined) {
        handle.director.setPlayerPosition(world.player.position);
        const boss = world.boss;
        handle.director.setBossPosition(boss && !boss.defeated ? boss.position : null);
      }
      if (pausedRef.current) return;
      handle.director.step(dt);
    },
    [handle],
  );

  return (
    <>
      <ParticleField particles={handle.particles} advance={advance} />
      <EchoField echoes={handle.echoes} />
    </>
  );
}
