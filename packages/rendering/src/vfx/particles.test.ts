import { describe, expect, it } from 'vitest';
import { createEventBus, createIdAllocator } from '@tuner/shared';
import type { EventBus } from '@tuner/shared';
import type { GameEvents } from '@tuner/game-core';
import { QUALITY_PRESETS } from '@tuner/platform';
import { createResonanceEffects } from './effects.js';
import {
  ECHO_GROUND_LIFT,
  MAX_ECHO_OPACITY,
  MAX_ECHO_RADIUS,
  REDUCED_PARTICLE_SCALE,
  createGeometryEchoes,
  createParticleSystem,
  rgbFromHex,
  type ParticleSystem,
} from './particles.js';

/**
 * Particle-system tests.
 *
 * These are budget and safety tests rather than beauty tests. The failure modes
 * they exist to catch are the ones that do not show up in a screenshot:
 *
 * - a pool that quietly grows, so the game gets slower the longer it is played;
 * - a budget that drops the *newest* emission, so the spark for the hit the
 *   player just landed is the one thrown away;
 * - an accessibility setting that is honoured in the settings screen and nowhere
 *   else;
 * - a step that is correct at 60 fps and wrong at 120.
 */

/** Total bytes held by every buffer, so growth of any kind is visible. */
function bufferBytes(system: ParticleSystem): number {
  const b = system.buffers;
  return (
    b.position.byteLength +
    b.velocity.byteLength +
    b.colour.byteLength +
    b.size.byteLength +
    b.alpha.byteLength +
    b.brightness.byteLength +
    b.rotation.byteLength +
    b.progress.byteLength +
    b.shape.byteLength +
    b.alive.byteLength +
    b.live.byteLength
  );
}

function liveIndices(system: ParticleSystem): number[] {
  const count = system.compact();
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(system.buffers.live[i] ?? -1);
  return out;
}

describe('particle pool', () => {
  it('allocates its buffers exactly once, however many particles pass through', () => {
    const system = createParticleSystem({ capacity: 256, seed: 'alloc' });
    const bytesBefore = bufferBytes(system);
    const capacityBefore = system.capacity;

    // 500 frames of steady combat-weight emission: 10,000 particles through a
    // 256-slot pool.
    for (let frame = 0; frame < 500; frame++) {
      system.emit({ position: { x: 0, y: 1, z: 0 }, count: 20, lifetime: 0.3, speed: 4 });
      system.step(1 / 60);
    }

    expect(system.stats.emitted).toBeGreaterThanOrEqual(10_000);
    expect(system.stats.bufferAllocations).toBe(1);
    expect(bufferBytes(system)).toBe(bytesBefore);
    expect(system.capacity).toBe(capacityBefore);
    // The pool is a closed system: live plus free always accounts for capacity.
    expect(system.activeCount + system.freeCount).toBe(system.capacity);
  });

  it('recycles the oldest particle at the budget instead of dropping the newest', () => {
    const system = createParticleSystem({ capacity: 64, seed: 'budget' });

    // A full pool of "old" particles, marked by their size.
    system.emit({ position: { x: 0, y: 0, z: 0 }, count: 64, size: 0.1, lifetime: 5 });
    expect(system.activeCount).toBe(64);
    const recycledBefore = system.stats.recycled;

    // Eight newer ones arrive with nowhere to go.
    system.emit({ position: { x: 5, y: 0, z: 0 }, count: 8, size: 0.9, lifetime: 5 });

    expect(system.activeCount).toBe(64);
    expect(system.stats.recycled).toBe(recycledBefore + 8);
    expect(system.stats.bufferAllocations).toBe(1);

    let newest = 0;
    for (const index of liveIndices(system)) {
      if ((system.buffers.size[index] ?? 0) > 0.5) newest++;
    }
    // Every one of the newest eight survived; eight of the oldest were reused.
    expect(newest).toBe(8);
  });

  it('keeps the tail of a burst larger than the whole budget', () => {
    const system = createParticleSystem({ capacity: 32, seed: 'oversized' });
    const emitted = system.emit({ position: { x: 0, y: 0, z: 0 }, count: 200, lifetime: 4 });

    expect(emitted).toBe(32);
    expect(system.activeCount).toBe(32);
    expect(system.stats.bufferAllocations).toBe(1);
  });

  it('takes its default budget from the quality preset', () => {
    const low = createParticleSystem({ tier: 'low' });
    const high = createParticleSystem({ tier: 'high' });

    expect(low.capacity).toBe(QUALITY_PRESETS.low.particleBudget);
    expect(high.capacity).toBe(QUALITY_PRESETS.high.particleBudget);
    expect(low.capacity).toBeLessThan(high.capacity);
  });

  it('lowers the live ceiling on a quality drop without reallocating', () => {
    const system = createParticleSystem({ capacity: QUALITY_PRESETS.high.particleBudget, tier: 'high' });
    const bytesBefore = bufferBytes(system);

    system.emit({ position: { x: 0, y: 0, z: 0 }, count: 900, lifetime: 6 });
    expect(system.activeCount).toBe(900);

    system.setTier('low');
    expect(system.budget).toBe(QUALITY_PRESETS.low.particleBudget);
    expect(system.activeCount).toBe(QUALITY_PRESETS.low.particleBudget);
    expect(bufferBytes(system)).toBe(bytesBefore);
    expect(system.stats.bufferAllocations).toBe(1);
  });

  it('returns expired slots to the pool', () => {
    const system = createParticleSystem({ capacity: 48, seed: 'expire' });
    system.emit({ position: { x: 0, y: 0, z: 0 }, count: 10, lifetime: 0.2 });

    expect(system.activeCount).toBe(10);
    expect(system.freeCount).toBe(38);

    for (let i = 0; i < 6; i++) system.step(0.05);

    expect(system.activeCount).toBe(0);
    expect(system.stats.expired).toBe(10);
    expect(system.freeCount).toBe(48);
    expect(system.compact()).toBe(0);
  });
});

describe('emitters', () => {
  it('emits a continuous stream at the requested rate, whatever the step size', () => {
    const coarse = createParticleSystem({ capacity: 512, seed: 'rate' });
    const fine = createParticleSystem({ capacity: 512, seed: 'rate' });

    coarse.addEmitter({ position: { x: 0, y: 0, z: 0 }, ratePerSecond: 30, lifetime: 4 });
    fine.addEmitter({ position: { x: 0, y: 0, z: 0 }, ratePerSecond: 30, lifetime: 4 });

    for (let i = 0; i < 30; i++) coarse.step(1 / 30);
    for (let i = 0; i < 120; i++) fine.step(1 / 120);

    // One second at 30/s, reached by fractional accumulation rather than by
    // rounding down once per frame.
    expect(coarse.stats.emitted).toBeGreaterThanOrEqual(29);
    expect(coarse.stats.emitted).toBeLessThanOrEqual(31);
    expect(Math.abs(coarse.stats.emitted - fine.stats.emitted)).toBeLessThanOrEqual(1);
  });

  it('lays a trail along the segment travelled, not in a clump', () => {
    const system = createParticleSystem({ capacity: 128, seed: 'trail' });
    const handle = system.addEmitter({
      position: { x: 0, y: 0, z: 0 },
      ratePerSecond: 120,
      trail: true,
      speed: 0,
      lifetime: 4,
    });

    system.moveEmitter(handle, 6, 0, 0);
    system.step(1 / 30);

    const xs = liveIndices(system).map((i) => system.buffers.position[i * 3] ?? 0);
    expect(xs.length).toBeGreaterThan(2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);

    system.stopEmitter(handle);
    expect(system.emitterCount).toBe(0);
  });
});

describe('accessibility', () => {
  it('reducedParticles measurably lowers the emitted count without silencing it', () => {
    const normal = createParticleSystem({ capacity: 256, seed: 'a11y' });
    const reduced = createParticleSystem({
      capacity: 256,
      seed: 'a11y',
      accessibility: { reducedParticles: true },
    });

    const full = normal.emit({ position: { x: 0, y: 0, z: 0 }, count: 40 });
    const cut = reduced.emit({ position: { x: 0, y: 0, z: 0 }, count: 40 });

    expect(full).toBe(40);
    expect(cut).toBe(Math.round(40 * REDUCED_PARTICLE_SCALE));
    expect(cut).toBeLessThan(full);
    // A single-particle cue survives the reduction — the information does not.
    expect(reduced.emit({ position: { x: 0, y: 0, z: 0 }, count: 1 })).toBe(1);
  });

  it('reducedFlashing removes the brightness oscillation entirely', () => {
    const flashSpec = {
      position: { x: 0, y: 0, z: 0 },
      count: 1,
      lifetime: 1,
      speed: 0,
      brightness: [2.5, 0.4] as const,
      flickerHz: 18,
      flickerAmount: 0.7,
    };

    const flashing = createParticleSystem({ capacity: 8, seed: 'flash' });
    const calm = createParticleSystem({
      capacity: 8,
      seed: 'flash',
      accessibility: { reducedFlashing: true },
    });

    flashing.emit(flashSpec);
    calm.emit(flashSpec);

    const flashingSamples: number[] = [];
    const calmSamples: number[] = [];
    for (let i = 0; i < 50; i++) {
      flashing.step(1 / 60);
      calm.step(1 / 60);
      flashingSamples.push(flashing.buffers.brightness[0] ?? 0);
      calmSamples.push(calm.buffers.brightness[0] ?? 0);
    }

    const risesIn = (samples: readonly number[]): number => {
      let rises = 0;
      for (let i = 1; i < samples.length; i++) {
        if ((samples[i] ?? 0) > (samples[i - 1] ?? 0) + 1e-6) rises++;
      }
      return rises;
    };

    // The unreduced curve oscillates; the reduced one only ever decays.
    expect(risesIn(flashingSamples)).toBeGreaterThan(5);
    expect(risesIn(calmSamples)).toBe(0);
    for (const value of calmSamples) expect(value).toBeLessThanOrEqual(1.26);
  });

  it('stops an already-live particle oscillating the moment the setting changes', () => {
    const system = createParticleSystem({ capacity: 8, seed: 'toggle' });
    system.emit({
      position: { x: 0, y: 0, z: 0 },
      count: 1,
      lifetime: 2,
      speed: 0,
      brightness: [2.5, 0.4],
      flickerHz: 20,
      flickerAmount: 0.8,
    });
    for (let i = 0; i < 10; i++) system.step(1 / 60);

    system.setAccessibility({ reducedFlashing: true });

    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      system.step(1 / 60);
      samples.push(system.buffers.brightness[0] ?? 0);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] ?? 0).toBeLessThanOrEqual((samples[i - 1] ?? 0) + 1e-6);
    }
  });
});

describe('integration', () => {
  it('produces no NaN and no unbounded values over thousands of steps', () => {
    const system = createParticleSystem({ capacity: 256, seed: 'stability' });
    const bad = Number.NaN;

    for (let frame = 0; frame < 2000; frame++) {
      if (frame % 4 === 0) {
        system.emit({
          position: { x: bad, y: 2, z: 0 },
          count: 6,
          pattern: 'sphere',
          speed: Number.POSITIVE_INFINITY,
          gravity: -24,
          drag: 2,
          lifetime: { min: 0.2, max: 0.9 },
          spin: { min: -6, max: 6 },
        });
      }
      if (frame % 7 === 0) {
        system.emit({
          position: { x: 0, y: 0, z: 0 },
          count: 8,
          pattern: 'ring',
          spawnRadius: 1.5,
          speed: -3,
          axialSpeed: 2,
          lifetime: 0.5,
          size: [0.2, 0],
          colour: '#8b4fd6',
          colourTo: '#5ce89b',
        });
      }
      system.step(1 / 90);
    }

    let checked = 0;
    for (const index of liveIndices(system)) {
      const i3 = index * 3;
      for (let axis = 0; axis < 3; axis++) {
        const p = system.buffers.position[i3 + axis] ?? Number.NaN;
        const v = system.buffers.velocity[i3 + axis] ?? Number.NaN;
        const c = system.buffers.colour[i3 + axis] ?? Number.NaN;
        expect(Number.isFinite(p)).toBe(true);
        expect(Math.abs(p)).toBeLessThan(5001);
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThanOrEqual(240);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      const alpha = system.buffers.alpha[index] ?? Number.NaN;
      const size = system.buffers.size[index] ?? Number.NaN;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      expect(size).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(system.buffers.rotation[index] ?? Number.NaN)).toBe(true);
      checked++;
    }

    expect(checked).toBeGreaterThan(0);
    expect(system.activeCount).toBeLessThanOrEqual(system.capacity);
  });

  it('lands in the same place at two step sizes', () => {
    const spec = {
      position: { x: 0, y: 4, z: 0 },
      count: 1,
      pattern: 'point' as const,
      direction: { x: 1, y: 0.5, z: -0.25 },
      speed: 7,
      gravity: -24,
      lifetime: 4,
    };

    const coarse = createParticleSystem({ capacity: 4, seed: 'dt' });
    const fine = createParticleSystem({ capacity: 4, seed: 'dt' });
    coarse.emit(spec);
    fine.emit(spec);

    for (let i = 0; i < 30; i++) coarse.step(1 / 60);
    for (let i = 0; i < 120; i++) fine.step(1 / 240);

    for (let axis = 0; axis < 3; axis++) {
      const a = coarse.buffers.position[axis] ?? 0;
      const b = fine.buffers.position[axis] ?? 0;
      expect(Math.abs(a - b)).toBeLessThan(1e-3);
    }
    // And the motion actually happened, so this is not two zeroes agreeing.
    expect(coarse.buffers.position[1] ?? 0).toBeLessThan(4);
  });

  it('lands in the same place at two step sizes with drag applied', () => {
    const spec = {
      position: { x: 0, y: 2, z: 0 },
      count: 1,
      direction: { x: 1, y: 1, z: 0 },
      speed: 9,
      gravity: -18,
      drag: 3,
      lifetime: 4,
    };

    const coarse = createParticleSystem({ capacity: 4, seed: 'dt-drag' });
    const fine = createParticleSystem({ capacity: 4, seed: 'dt-drag' });
    coarse.emit(spec);
    fine.emit(spec);

    for (let i = 0; i < 15; i++) coarse.step(1 / 30);
    for (let i = 0; i < 120; i++) fine.step(1 / 240);

    // Linear drag has a closed form too, so this is exact rather than merely
    // close: an eight-fold difference in step size changes nothing.
    for (let axis = 0; axis < 3; axis++) {
      const a = coarse.buffers.position[axis] ?? 0;
      const b = fine.buffers.position[axis] ?? 0;
      expect(Math.abs(a - b)).toBeLessThan(1e-3);
    }
    expect(coarse.buffers.position[0] ?? 0).toBeGreaterThan(0.5);
  });

  it('spaces a ring burst evenly, because the language is geometry not scatter', () => {
    const system = createParticleSystem({ capacity: 32, seed: 'ring' });
    system.emit({
      position: { x: 0, y: 1, z: 0 },
      count: 8,
      pattern: 'ring',
      direction: { x: 0, y: 1, z: 0 },
      spawnRadius: 2,
      speed: 0,
      lifetime: 2,
    });

    const angles: number[] = [];
    for (const index of liveIndices(system)) {
      const x = system.buffers.position[index * 3] ?? 0;
      const y = system.buffers.position[index * 3 + 1] ?? 0;
      const z = system.buffers.position[index * 3 + 2] ?? 0;
      expect(Math.hypot(x, z)).toBeCloseTo(2, 5);
      // A ring around world up stays in its plane.
      expect(y).toBeCloseTo(1, 5);
      angles.push(Math.atan2(z, x));
    }

    angles.sort((a, b) => a - b);
    expect(angles).toHaveLength(8);
    for (let i = 1; i < angles.length; i++) {
      expect((angles[i] ?? 0) - (angles[i - 1] ?? 0)).toBeCloseTo(Math.PI / 4, 4);
    }
  });

  it('parses palette hex strings into sRGB and memoises them', () => {
    const violet = rgbFromHex('#8b4fd6');
    expect(violet[0]).toBeCloseTo(0.545, 2);
    expect(violet[2]).toBeCloseTo(0.839, 2);
    expect(rgbFromHex('#8b4fd6')).toBe(violet);
    expect(rgbFromHex('not-a-colour')).toEqual([1, 1, 1]);
  });
});

describe('geometry echoes', () => {
  it('clamps radius and opacity so nothing can fill the screen', () => {
    const field = createGeometryEchoes({ capacity: 8 });
    const slot = field.spawn({
      position: { x: 0, y: 0, z: 0 },
      radiusFrom: 0.5,
      radiusTo: 500,
      opacity: 1,
      lifetime: 1,
    });

    expect(slot).toBeGreaterThanOrEqual(0);
    // Steps are clamped to 100 ms, so walk the whole lifetime a frame at a time.
    for (let i = 0; i < 9; i++) field.step(0.1);
    expect(field.buffers.radius[slot] ?? 0).toBeGreaterThan(1);
    expect(field.buffers.radius[slot] ?? 0).toBeLessThanOrEqual(MAX_ECHO_RADIUS);
    expect(field.buffers.alpha[slot] ?? 0).toBeLessThanOrEqual(MAX_ECHO_OPACITY);
    // Ground rings sit just above the floor rather than inside it.
    expect(field.buffers.position[slot * 3 + 1] ?? 0).toBeCloseTo(ECHO_GROUND_LIFT, 6);
  });

  it('recycles the oldest echo and never grows its buffers', () => {
    const field = createGeometryEchoes({ capacity: 4 });
    const bytes = field.buffers.position.byteLength;

    for (let i = 0; i < 20; i++) {
      field.spawn({ position: { x: i, y: 0, z: 0 }, lifetime: 2 });
    }

    expect(field.activeCount).toBe(4);
    expect(field.stats.spawned).toBe(20);
    expect(field.stats.recycled).toBe(16);
    expect(field.stats.bufferAllocations).toBe(1);
    expect(field.buffers.position.byteLength).toBe(bytes);
  });

  it('holds a delayed echo invisible, then expires it back to the pool', () => {

    const field = createGeometryEchoes({ capacity: 4 });
    const slot = field.spawn({
      position: { x: 0, y: 0, z: 0 },
      delay: 0.15,
      lifetime: 0.4,
      opacity: 0.5,
    });

    field.step(0.1);
    expect(field.buffers.alpha[slot] ?? -1).toBe(0);

    // The second step spends 50 ms finishing the delay and the other 50 ms
    // advancing the ring, rather than losing the whole frame to the wait.
    field.step(0.1);
    expect(field.buffers.alpha[slot] ?? 0).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) field.step(0.05);
    expect(field.activeCount).toBe(0);
    expect(field.stats.expired).toBe(1);
  });
});

/**
 * The event layer.
 *
 * `createEffectDirector` is deliberately free of Three.js and React, so the
 * mapping from simulation event to visual cue is testable here rather than only
 * visible in a running build. These are the assertions that protect the two
 * promises the effect layer makes to players: that gameplay-critical audio has a
 * visual equal, and that no effect can cover the ground.
 */
describe('effect director', () => {
  const at = (x: number, y: number, z: number) => ({ x, y, z });
  // `EntityId` is a branded number, so ids come from an allocator rather than
  // from literals — the same discipline the simulation itself uses.
  const ids = createIdAllocator();

  function fire(bus: EventBus<GameEvents>): void {
    // Every payload is deliberately absurd. Nothing downstream may believe it.
    bus.emit('combat:fired', {
      projectileId: ids.next(),
      position: at(0, 1, 0),
      direction: at(0, 0, 1),
      owner: 'player',
      form: 'echo',
      tier: 9,
      hz: 432,
    });
    bus.emit('combat:chargeTier', { tier: 12, position: at(0, 1, 0), hz: 540 });
    bus.emit('combat:burst', { position: at(0, 1, 0), radius: 1e6 });
    bus.emit('combat:hit', {
      targetId: ids.next(),
      position: at(1, 1, 1),
      normal: at(0, 0, 0),
      damage: 1e6,
      kind: 'charge',
      form: 'echo',
      blocked: false,
      weakness: true,
    });
    bus.emit('combat:counterWindow', { position: at(0, 1, 0), opening: true });
    bus.emit('combat:countered', { position: at(0, 1, 0), success: true, converted: true });
    bus.emit('combat:enemyCleansed', {
      enemyId: ids.next(),
      position: at(2, 1, 0),
      archetype: 'drift-mote',
    });
    bus.emit('combat:playerHurt', {
      position: at(0, 1, 0),
      damage: 1e6,
      coherence: -5,
      source: 'hazard',
    });
    bus.emit('combat:playerDowned', { position: at(0, 1, 0) });
    bus.emit('form:switched', { from: 'base', to: 'prism' });
    bus.emit('form:abilityUsed', { form: 'tidal', ability: 'Resonance Thread', position: at(0, 1, 0) });
    bus.emit('puzzle:noteStruck', { puzzleId: 'p', degree: 99, hz: 8000, position: at(0, 1, 0) });
    bus.emit('puzzle:solved', { puzzleId: 'p', position: at(0, 1, 0) });
    bus.emit('puzzle:failed', { puzzleId: 'p', position: at(0, 1, 0) });
    bus.emit('world:pickupCollected', {
      contentId: 'c',
      kind: 'coherence',
      amount: 1,
      position: at(0, 1, 0),
    });
    bus.emit('world:secretFound', { contentId: 's', position: at(0, 1, 0) });
    bus.emit('world:checkpointActivated', { checkpointId: 'cp', position: at(0, 1, 0) });
    bus.emit('world:restorationStep', { progress: 5, region: 'fractured-garden' });
    bus.emit('boss:telegraph', {
      definitionId: 'oru-fractured-colossus',
      attack: 'sweep',
      seconds: 1,
      position: at(9, 1, 9),
    });
    bus.emit('boss:phaseChanged', {
      definitionId: 'oru-fractured-colossus',
      phaseIndex: 99,
      phaseName: 'Fractured',
    });
    bus.emit('boss:vulnerable', { definitionId: 'oru-fractured-colossus', open: true });
    bus.emit('boss:restorationStarted', { definitionId: 'oru-fractured-colossus' });
    bus.emit('player:jumped', { position: at(0, 1, 0), doubleJump: true, wallJump: false });
    bus.emit('player:landed', { position: at(0, 1, 0), impactSpeed: 1e6 });
    bus.emit('player:dashed', { position: at(0, 1, 0), direction: at(1, 0, 0), airborne: true });
    bus.emit('player:wallCling', { position: at(0, 1, 0), normal: at(1, 0, 0) });
    bus.emit('player:railAttached', { railId: 'r', position: at(0, 1, 0) });
    bus.emit('player:railDetached', { railId: 'r', position: at(0, 1, 0) });
    bus.emit('player:bounced', { position: at(0, 1, 0), strength: 1e6 });
    bus.emit('player:ledgeGrabbed', { position: at(0, 1, 0) });
    bus.emit('stage:respawned', { checkpointId: 'cp', position: at(0, 1, 0) });
    bus.emit('fx:flash', { colour: '#f5c451', seconds: 0.2 });
  }

  it('covers every cue the effect layer promises, and detaches cleanly', () => {
    const bus = createEventBus<GameEvents>();
    const { director } = createResonanceEffects({ tier: 'high' });
    const detach = director.subscribe(bus);

    for (const required of [
      'combat:fired',
      'combat:chargeTier',
      'combat:burst',
      'combat:hit',
      'combat:countered',
      'combat:enemyCleansed',
      'combat:playerHurt',
      'world:pickupCollected',
      'world:checkpointActivated',
      'world:restorationStep',
      'puzzle:noteStruck',
      'puzzle:solved',
      'puzzle:failed',
      'boss:phaseChanged',
      'player:jumped',
      'player:landed',
      'player:dashed',
      'player:wallCling',
      'player:railAttached',
      'player:bounced',
    ] as const) {
      expect(director.handledEvents).toContain(required);
    }

    expect(bus.listenerCount()).toBeGreaterThanOrEqual(director.handledEvents.length);
    detach();
    expect(bus.listenerCount()).toBe(0);
  });

  it('never lets an effect grow large or opaque enough to hide the ground', () => {
    const bus = createEventBus<GameEvents>();
    const { director, particles, echoes } = createResonanceEffects({ tier: 'high' });
    director.subscribe(bus);

    // Ten seconds of every cue at once, on hostile payloads.
    let widestRadius = 0;
    let strongestAlpha = 0;
    let strongestParticleAlpha = 0;
    for (let frame = 0; frame < 600; frame++) {
      if (frame % 12 === 0) fire(bus);
      director.step(1 / 60);

      for (let i = 0; i < echoes.capacity; i++) {
        widestRadius = Math.max(widestRadius, echoes.buffers.radius[i] ?? 0);
        strongestAlpha = Math.max(strongestAlpha, echoes.buffers.alpha[i] ?? 0);
      }
      for (let i = 0; i < particles.capacity; i++) {
        strongestParticleAlpha = Math.max(strongestParticleAlpha, particles.buffers.alpha[i] ?? 0);
      }
    }

    expect(widestRadius).toBeLessThanOrEqual(MAX_ECHO_RADIUS);
    expect(strongestAlpha).toBeLessThanOrEqual(MAX_ECHO_OPACITY);
    expect(strongestParticleAlpha).toBeLessThanOrEqual(1);
    // ...and the caps are actually being exercised, not trivially satisfied.
    expect(widestRadius).toBeGreaterThan(2);

    expect(particles.stats.bufferAllocations).toBe(1);
    expect(echoes.stats.bufferAllocations).toBe(1);
    expect(particles.activeCount).toBeLessThanOrEqual(particles.capacity);
    expect(echoes.activeCount).toBeLessThanOrEqual(echoes.capacity);
    // The cues actually happened — this is not a test of an idle system.
    expect(particles.stats.emitted).toBeGreaterThan(500);
    expect(echoes.stats.spawned).toBeGreaterThan(200);
  });

  it('sizes the struck-note ring by harmonic degree, so pitch is visible', () => {
    // This is the required visual equivalent of the note's audio cue: the game
    // must be solvable muted, so degree has to be readable from the picture.
    const radii: number[] = [];
    const motes: number[] = [];

    for (const degree of [0, 3, 7]) {
      const bus = createEventBus<GameEvents>();
      const { director, particles, echoes } = createResonanceEffects({ tier: 'high' });
      director.subscribe(bus);
      bus.emit('puzzle:noteStruck', {
        puzzleId: 'lattice',
        degree,
        hz: 432,
        position: { x: 0, y: 0, z: 0 },
      });
      for (let i = 0; i < 10; i++) director.step(1 / 60);

      let widest = 0;
      for (let i = 0; i < echoes.capacity; i++) {
        widest = Math.max(widest, echoes.buffers.radius[i] ?? 0);
      }
      radii.push(widest);
      motes.push(particles.stats.emitted);
    }

    // Radius rises monotonically with the degree...
    expect(radii[1] ?? 0).toBeGreaterThan(radii[0] ?? 0);
    expect(radii[2] ?? 0).toBeGreaterThan(radii[1] ?? 0);
    // ...and so does the countable vertex burst, a second colour-free channel.
    expect(motes[0] ?? 0).toBe(3);
    expect(motes[1] ?? 0).toBe(6);
    expect(motes[2] ?? 0).toBe(10);
  });

  it('dissolves a cleansed enemy from violet into green, never into death', () => {
    const bus = createEventBus<GameEvents>();
    const { director, particles } = createResonanceEffects({ tier: 'high' });
    director.subscribe(bus);

    bus.emit('combat:enemyCleansed', {
      enemyId: ids.next(),
      position: { x: 0, y: 1, z: 0 },
      archetype: 'drift-mote',
    });
    expect(particles.activeCount).toBeGreaterThan(10);

    director.step(1 / 60);
    const startGreen = particles.buffers.colour[1] ?? 0;
    const startBlue = particles.buffers.colour[2] ?? 0;

    let endGreen = 0;
    let endBlue = 1;
    for (let i = 0; i < 200 && (particles.buffers.alive[0] ?? 0) === 1; i++) {
      director.step(1 / 60);
      endGreen = particles.buffers.colour[1] ?? 0;
      endBlue = particles.buffers.colour[2] ?? 0;
    }

    // Starts violet (blue dominant), ends restoration green.
    expect(startBlue).toBeGreaterThan(startGreen);
    expect(endGreen).toBeGreaterThan(endBlue);
    expect(endGreen).toBeGreaterThan(startGreen);
  });

  it('passes accessibility reductions through to both pools', () => {
    const bus = createEventBus<GameEvents>();
    const loud = createResonanceEffects({ tier: 'high' });
    const calm = createResonanceEffects({
      tier: 'high',
      accessibility: { reducedParticles: true, reducedFlashing: true },
    });
    loud.director.subscribe(bus);
    calm.director.subscribe(bus);

    bus.emit('puzzle:solved', { puzzleId: 'p', position: { x: 0, y: 0, z: 0 } });

    expect(calm.particles.accessibility.reducedParticles).toBe(true);
    expect(calm.particles.stats.emitted).toBeLessThan(loud.particles.stats.emitted);

    for (let i = 0; i < 60; i++) {
      loud.director.step(1 / 60);
      calm.director.step(1 / 60);
    }
    for (let i = 0; i < calm.particles.capacity; i++) {
      expect(calm.particles.buffers.brightness[i] ?? 0).toBeLessThanOrEqual(1.26);
    }
  });
});
