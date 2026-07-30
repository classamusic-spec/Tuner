import { afterEach, describe, expect, it, vi } from 'vitest';
import { DETUNED_HZ, STAGE_IDS, WORLD_CHORD_HZ, vec3 } from '@tuner/shared';
import type { MusicLayer } from './types.js';
import { detuneCentsForInfection } from './synth.js';
import {
  DEFAULT_LOW_COHERENCE_THRESHOLD,
  MUSIC_LAYERS,
  MUSIC_LAYER_VOICES,
  REGION_MOTIFS,
  computeLayerTargets,
  createMusicDirector,
  generatePhrase,
  isFinale,
  motifNoteHz,
  phraseForRegion,
  playbackHzForInfection,
  regionMotif,
  type MusicRegion,
  type MusicSignals,
} from './music.js';
import { createWebAudioEngine, type BaseAudioContextLike } from './web-audio-engine.js';

const ALL_REGIONS: readonly MusicRegion[] = ['sanctuary', ...STAGE_IDS];

function directorFor(signals: Partial<MusicSignals>) {
  const director = createMusicDirector();
  director.setSignals(signals);
  director.snapToTargets();
  return director;
}

describe('the retuning — 440 becomes 432', () => {
  it('is exact at both ends', () => {
    expect(playbackHzForInfection(1)).toBe(DETUNED_HZ);
    expect(playbackHzForInfection(0)).toBe(WORLD_CHORD_HZ);
    // Out-of-range signals clamp rather than run away.
    expect(playbackHzForInfection(3)).toBe(DETUNED_HZ);
    expect(playbackHzForInfection(-2)).toBe(WORLD_CHORD_HZ);
  });

  it('is strictly monotonic in between', () => {
    let previous = playbackHzForInfection(0);
    for (let i = 1; i <= 400; i++) {
      const hz = playbackHzForInfection(i / 400);
      expect(hz, `infection ${i / 400}`).toBeGreaterThan(previous);
      expect(hz).toBeLessThanOrEqual(DETUNED_HZ);
      previous = hz;
    }
    expect(previous).toBe(DETUNED_HZ);
  });

  it('agrees with the detune the shader tints by, in cents', () => {
    for (const infection of [0, 0.17, 0.4, 0.63, 0.9, 1]) {
      const fromCents = WORLD_CHORD_HZ * Math.pow(2, detuneCentsForInfection(infection) / 1200);
      expect(playbackHzForInfection(infection)).toBeCloseTo(fromCents, 9);
    }
  });

  it('carries the tuning through to motif note frequencies', () => {
    expect(motifNoteHz(WORLD_CHORD_HZ, 0, 0)).toBe(WORLD_CHORD_HZ);
    expect(motifNoteHz(WORLD_CHORD_HZ, 4, 0)).toBeCloseTo(648, 9);
    expect(motifNoteHz(WORLD_CHORD_HZ, 0, 1)).toBe(864);
    expect(motifNoteHz(playbackHzForInfection(1), 0, 0)).toBe(DETUNED_HZ);
  });
});

describe('layer rules', () => {
  const situations: ReadonlyArray<{
    readonly name: string;
    readonly signals: Partial<MusicSignals>;
    readonly expected: MusicLayer;
  }> = [
    {
      name: 'the hub, which is the one place already in tune',
      signals: { region: 'sanctuary', phase: 'exploration' },
      expected: 'sanctuary',
    },
    {
      name: 'standing still in a region',
      signals: { region: 'fractured-garden', phase: 'exploration', playerSpeed: 0 },
      expected: 'world',
    },
    {
      name: 'sprinting with nothing hostile nearby',
      signals: { region: 'fractured-garden', phase: 'exploration', playerSpeed: 12.4 },
      expected: 'movement',
    },
    {
      name: 'enemies active nearby',
      signals: {
        region: 'fractured-garden',
        phase: 'exploration',
        combatPressure: 0.9,
        playerSpeed: 4,
      },
      expected: 'combat',
    },
    {
      name: 'a miniboss encounter',
      signals: {
        region: 'glass-meridian',
        phase: 'miniboss',
        combatPressure: 1,
        playerSpeed: 8,
        bossPresent: true,
      },
      expected: 'miniboss',
    },
    {
      name: 'a commander encounter',
      signals: {
        region: 'glass-meridian',
        phase: 'commander',
        combatPressure: 1,
        playerSpeed: 8,
        bossPresent: true,
        bossPhase: 2,
      },
      expected: 'commander',
    },
    {
      name: 'Coherence below the threshold',
      signals: {
        region: 'tidal-archive',
        phase: 'exploration',
        coherenceFraction: 0.05,
        playerSpeed: 2,
      },
      expected: 'lowCoherence',
    },
    {
      name: 'restoring a region',
      signals: {
        region: 'tidal-archive',
        phase: 'restoration',
        restorationProgress: 0.5,
        infection: 0.4,
      },
      expected: 'restoration',
    },
    {
      name: 'the finale at the Loom',
      signals: { region: 'celestial-loom', phase: 'restoration', restorationProgress: 1 },
      expected: 'worldChord',
    },
  ];

  for (const situation of situations) {
    it(`makes ${situation.name} sound like ${situation.expected}`, () => {
      const director = directorFor(situation.signals);
      expect(director.dominantTargetLayer()).toBe(situation.expected);
      expect(director.dominantLayer()).toBe(situation.expected);
      expect(director.gains[situation.expected]).toBeGreaterThan(0.3);
    });
  }

  it('keeps the world layer present in every situation that is not the hub', () => {
    for (const situation of situations) {
      const director = directorFor(situation.signals);
      expect(director.gains.world, situation.name).toBeGreaterThan(0.2);
    }
  });

  it('replaces combat with the boss layers rather than stacking them', () => {
    const base: Partial<MusicSignals> = {
      region: 'ember-observatory',
      combatPressure: 1,
      bossPresent: true,
    };
    const miniboss = computeLayerTargets({
      ...createMusicDirector().signals,
      ...base,
      phase: 'miniboss',
    });
    expect(miniboss.combat).toBe(0);
    expect(miniboss.commander).toBe(0);
    expect(miniboss.miniboss).toBeGreaterThan(0.8);

    const commander = computeLayerTargets({
      ...createMusicDirector().signals,
      ...base,
      phase: 'commander',
      bossPhase: 3,
    });
    expect(commander.combat).toBe(0);
    expect(commander.miniboss).toBe(0);
    expect(commander.commander).toBe(1);
  });

  it('engages the low-Coherence layer only below the threshold, and harder as it falls', () => {
    const at = (coherenceFraction: number): number =>
      directorFor({ region: 'hollow-choir', phase: 'exploration', coherenceFraction }).gains
        .lowCoherence;
    expect(at(1)).toBe(0);
    expect(at(DEFAULT_LOW_COHERENCE_THRESHOLD)).toBe(0);
    expect(at(DEFAULT_LOW_COHERENCE_THRESHOLD - 0.01)).toBeGreaterThan(0);
    expect(at(0.1)).toBeGreaterThan(at(0.2));
    expect(at(0)).toBeGreaterThan(at(0.1));
  });

  it('treats the Loom finale as the finale, and nowhere else', () => {
    const signals = createMusicDirector().signals;
    expect(isFinale({ ...signals, region: 'celestial-loom', phase: 'restoration' })).toBe(true);
    expect(isFinale({ ...signals, region: 'celestial-loom', phase: 'exploration' })).toBe(false);
    expect(isFinale({ ...signals, region: 'fractured-garden', phase: 'restoration' })).toBe(false);
    expect(isFinale({ ...signals, finale: true })).toBe(true);
  });

  it('exposes a voice for every layer, and never detunes the hub or the World Chord', () => {
    expect(MUSIC_LAYERS).toHaveLength(9);
    for (const layer of MUSIC_LAYERS) {
      const voice = MUSIC_LAYER_VOICES[layer];
      expect(voice.layer).toBe(layer);
      expect(voice.degrees.length).toBeGreaterThan(0);
      expect(voice.gain).toBeGreaterThan(0);
      expect(voice.detunePull).toBeGreaterThanOrEqual(0);
      expect(voice.detunePull).toBeLessThanOrEqual(1);
    }
    expect(MUSIC_LAYER_VOICES.sanctuary.detunePull).toBe(0);
    expect(MUSIC_LAYER_VOICES.worldChord.detunePull).toBe(0);
    expect(MUSIC_LAYER_VOICES.combat.detunePull).toBe(1);
  });
});

describe('crossfades', () => {
  it('eases rather than snapping', () => {
    const director = createMusicDirector();
    director.setSignals({ region: 'fractured-garden', phase: 'exploration', playerSpeed: 12.4 });
    const target = director.targets.movement;
    expect(target).toBeGreaterThan(0.5);
    expect(director.gains.movement).toBe(0);

    director.update(1 / 60);
    const afterOneFrame = director.gains.movement;
    expect(afterOneFrame).toBeGreaterThan(0);
    expect(afterOneFrame).toBeLessThan(target * 0.5);

    for (let i = 0; i < 60 * 3; i++) director.update(1 / 60);
    expect(director.gains.movement).toBeCloseTo(target, 3);
    expect(director.gains.movement).toBeLessThanOrEqual(target);
  });

  it('is framerate independent: one 30 Hz step equals two 60 Hz steps', () => {
    const signals: Partial<MusicSignals> = {
      region: 'verdant-machine',
      phase: 'exploration',
      combatPressure: 0.8,
      playerSpeed: 9,
      coherenceFraction: 0.2,
      infection: 0.7,
    };
    const coarse = createMusicDirector();
    const fine = createMusicDirector();
    coarse.setSignals(signals);
    fine.setSignals(signals);

    for (let i = 0; i < 12; i++) {
      coarse.update(1 / 30);
      fine.update(1 / 60);
      fine.update(1 / 60);
    }

    for (const layer of MUSIC_LAYERS) {
      expect(Math.abs(coarse.gains[layer] - fine.gains[layer]), layer).toBeLessThan(1e-9);
    }
    expect(Math.abs(coarse.state().detune - fine.state().detune)).toBeLessThan(1e-9);
  });

  it('eases the tuning itself, so a region audibly comes back into agreement', () => {
    const director = createMusicDirector();
    director.setSignals({ region: 'fractured-garden', phase: 'exploration', infection: 1 });
    director.snapToTargets();
    expect(director.playbackHz()).toBe(DETUNED_HZ);

    director.setSignals({ infection: 0 });
    const hzAfterOneFrame = (() => {
      director.update(1 / 60);
      return director.playbackHz();
    })();
    expect(hzAfterOneFrame).toBeLessThan(DETUNED_HZ);
    expect(hzAfterOneFrame).toBeGreaterThan(WORLD_CHORD_HZ);

    for (let i = 0; i < 60 * 6; i++) director.update(1 / 60);
    expect(director.playbackHz()).toBeCloseTo(WORLD_CHORD_HZ, 2);
  });

  it('reports a usable MusicState snapshot', () => {
    const director = directorFor({
      region: 'desert-of-lost-notes',
      phase: 'exploration',
      combatPressure: 0.6,
      infection: 0.5,
    });
    const state = director.state();
    expect(state.stage).toBe('desert-of-lost-notes');
    expect(state.detune).toBeCloseTo(0.5, 9);
    expect(state.intensity).toBeGreaterThan(0);
    expect(state.intensity).toBeLessThanOrEqual(1);
    expect(Object.keys(state.layers)).toHaveLength(9);
    expect(state.layers.combat).toBeGreaterThan(0);
  });

  it('ignores a non-positive timestep', () => {
    const director = createMusicDirector();
    director.setSignals({ region: 'fractured-garden', phase: 'exploration', playerSpeed: 12 });
    director.update(0);
    director.update(-1);
    expect(director.gains.movement).toBe(0);
  });
});

describe('region motifs', () => {
  it('gives every region a motif with a distinct seed', () => {
    expect(ALL_REGIONS).toHaveLength(11);
    const seeds = ALL_REGIONS.map((region) => regionMotif(region).seed);
    expect(new Set(seeds).size).toBe(ALL_REGIONS.length);
    expect(Object.keys(REGION_MOTIFS)).toHaveLength(ALL_REGIONS.length);
  });

  it('describes each motif well enough to play it', () => {
    for (const region of ALL_REGIONS) {
      const motif = regionMotif(region);
      expect(motif.region).toBe(region);
      expect(motif.scale.length).toBeGreaterThan(2);
      expect(new Set(motif.scale).size).toBe(motif.scale.length);
      expect(motif.tempoBpm).toBeGreaterThan(30);
      expect(motif.tempoBpm).toBeLessThan(200);
      expect(motif.stepsPerBar).toBeGreaterThan(1);
      expect(motif.bars).toBeGreaterThan(0);
      expect(motif.scale[0]).toBe(0);
    }
  });

  it('gives the regions different scales, not just different seeds', () => {
    const scales = ALL_REGIONS.map((region) => regionMotif(region).scale.join(','));
    // The hub and its fallen counterpart may share a mode; the eight regions
    // being restored must not.
    expect(new Set(scales).size).toBeGreaterThanOrEqual(ALL_REGIONS.length - 1);
  });
});

describe('phrase generation', () => {
  const scale = [0, 2, 4, 7] as const;

  it('is deterministic for a fixed seed', () => {
    const a = generatePhrase(1234, scale, 2, 8);
    const b = generatePhrase(1234, scale, 2, 8);
    expect(a).toEqual(b);
    expect(generatePhrase('fractured-garden', scale)).toEqual(
      generatePhrase('fractured-garden', scale),
    );
  });

  it('produces different phrases for different seeds', () => {
    const a = generatePhrase(1, scale, 4, 8);
    const b = generatePhrase(2, scale, 4, 8);
    expect(a).not.toEqual(b);
  });

  it('emits only in-scale degrees, in order, without overlap', () => {
    for (const region of ALL_REGIONS) {
      const motif = regionMotif(region);
      const notes = phraseForRegion(region);
      const total = motif.bars * motif.stepsPerBar;
      expect(notes.length).toBeGreaterThan(0);
      expect(notes[0]?.step).toBe(0);
      let cursor = -1;
      for (const note of notes) {
        expect(motif.scale, `${region} left its scale`).toContain(note.degree);
        expect(note.step).toBeGreaterThan(cursor);
        expect(note.duration).toBeGreaterThanOrEqual(1);
        expect(note.step + note.duration).toBeLessThanOrEqual(total);
        expect(note.velocity).toBeGreaterThan(0);
        expect(note.velocity).toBeLessThanOrEqual(1);
        cursor = note.step + note.duration - 1;
      }
    }
  });

  it('opens on the root and respects the requested shape', () => {
    const notes = generatePhrase(99, [0, 3, 5], 3, 4);
    expect(notes[0]?.degree).toBe(0);
    for (const note of notes) {
      expect(note.step).toBeLessThan(12);
    }
  });

  it('refuses an empty scale and clamps a nonsensical shape', () => {
    expect(() => generatePhrase(1, [])).toThrow(/scale degree/);
    const notes = generatePhrase(1, [0], 0, 0);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.step).toBe(0);
  });
});

describe('the Web Audio engine without Web Audio', () => {
  it('does not throw when the platform has no AudioContext', () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe('undefined');
    expect(() => createWebAudioEngine()).not.toThrow();
  });

  it('returns a fully callable engine that silently does nothing', async () => {
    const engine = createWebAudioEngine();
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(() => {
      engine.playSfx('pulse-fire');
      engine.playSfx('hit-enemy', { position: vec3(3, 0, 4), volume: 0.5, form: 'ember' });
      engine.setMusicState({
        stage: 'fractured-garden',
        layers: { world: 0.5, combat: 0.3 },
        detune: 0.6,
        intensity: 0.4,
      });
      engine.setListener(vec3(1, 2, 3), 0.5);
      engine.stopMusic(0.5);
      engine.suspend();
      engine.resume();
      engine.dispose();
    }).not.toThrow();
  });

  it('still tracks mix levels so the settings screen keeps working', () => {
    const engine = createWebAudioEngine();
    engine.setLevels({ music: 0.25, sfx: 0.5 });
    expect(engine.levels.music).toBe(0.25);
    expect(engine.levels.sfx).toBe(0.5);
    expect(engine.levels.master).toBeGreaterThan(0);
    engine.dispose();
  });

  it('hands back a loop handle that reports itself stopped, and zeroed visualiser levels', () => {
    const engine = createWebAudioEngine();
    const loop = engine.playLoop('low-coherence');
    expect(loop.isRunning).toBe(false);
    expect(() => {
      loop.setVolume(0.5);
      loop.setPosition(vec3(0, 0, 0));
      loop.stop(0.2);
    }).not.toThrow();
    expect(engine.getVisualiserLevels()).toEqual({ beat: 0, bass: 0, lead: 0 });
    engine.dispose();
  });

  it('degrades the same way when a context factory fails outright', () => {
    const engine = createWebAudioEngine({
      createContext: () => {
        throw new Error('audio hardware unavailable');
      },
    });
    expect(() => {
      engine.playSfx('restoration');
      engine.setMusicState({
        stage: 'celestial-loom',
        layers: { worldChord: 1 },
        detune: 0,
        intensity: 1,
      });
      engine.setLevels({ master: 0.3 });
      engine.stopMusic();
      engine.dispose();
    }).not.toThrow();
    expect(engine.isUnlocked).toBe(false);
    expect(engine.levels.master).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// A stub Web Audio graph.
//
// Node has no AudioContext, so without this the adapter would ship entirely
// unexercised. The stub records the graph the engine builds and enforces the
// parts of the real API that throw — an exponential ramp to zero, a ramp
// scheduled before its parameter exists — so a mistake surfaces here rather
// than as silence on a device.
// ---------------------------------------------------------------------------

interface ParamEvent {
  readonly kind: string;
  readonly value: number;
  readonly time: number;
}

class StubParam {
  value = 0;
  readonly events: ParamEvent[] = [];
  setValueAtTime(value: number, time: number): this {
    this.record('set', value, time);
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.record('linear', value, time);
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('exponential ramp to zero');
    this.record('exponential', value, time);
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.record('cancel', 0, time);
    return this;
  }
  private record(kind: string, value: number, time: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new RangeError(`${kind} ramp with a non-finite argument`);
    }
    if (time < 0) throw new RangeError('ramp scheduled before time zero');
    this.value = value;
    this.events.push({ kind, value, time });
  }
}

class StubNode {
  readonly outputs: StubNode[] = [];
  connect(target: StubNode): StubNode {
    this.outputs.push(target);
    return target;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

class StubGain extends StubNode {
  readonly gain = new StubParam();
}

class StubOscillator extends StubNode {
  type = 'sine';
  readonly frequency = new StubParam();
  readonly detune = new StubParam();
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(time: number): void {
    if (this.startedAt !== null) throw new Error('oscillator started twice');
    this.startedAt = time;
  }
  stop(time: number): void {
    this.stoppedAt = time;
  }
}

class StubBufferSource extends StubNode {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  start(time: number): void {
    this.startedAt = time;
  }
  stop(): void {}
}

class StubFilter extends StubNode {
  type = 'lowpass';
  readonly frequency = new StubParam();
  readonly Q = new StubParam();
}

class StubPanner extends StubNode {
  readonly pan = new StubParam();
}

class StubAnalyser extends StubNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  getByteTimeDomainData(target: Uint8Array): void {
    for (let i = 0; i < target.length; i++) target[i] = 128 + (i % 2 === 0 ? 40 : -40);
  }
  getByteFrequencyData(target: Uint8Array): void {
    for (let i = 0; i < target.length; i++) target[i] = 200 - i;
  }
}

class StubContext {
  currentTime = 0;
  readonly sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly destination = new StubNode();
  readonly oscillators: StubOscillator[] = [];
  readonly gains: StubGain[] = [];
  readonly panners: StubPanner[] = [];
  readonly bufferSources: StubBufferSource[] = [];
  analyser: StubAnalyser | null = null;
  closed = false;

  createGain(): StubGain {
    const node = new StubGain();
    this.gains.push(node);
    return node;
  }
  createOscillator(): StubOscillator {
    const node = new StubOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter(): StubFilter {
    return new StubFilter();
  }
  createStereoPanner(): StubPanner {
    const node = new StubPanner();
    this.panners.push(node);
    return node;
  }
  createBufferSource(): StubBufferSource {
    const node = new StubBufferSource();
    this.bufferSources.push(node);
    return node;
  }
  createBuffer(channels: number, frames: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(frames * channels);
    return { getChannelData: () => data };
  }
  createAnalyser(): StubAnalyser {
    const node = new StubAnalyser();
    this.analyser = node;
    return node;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }
}

function stubEngine(): { engine: ReturnType<typeof createWebAudioEngine>; ctx: StubContext } {
  const ctx = new StubContext();
  const engine = createWebAudioEngine({
    createContext: () => ctx as unknown as BaseAudioContextLike,
    scheduleIntervalMs: 25,
    lookaheadSeconds: 0.2,
  });
  return { engine, ctx };
}

describe('the Web Audio engine against a stub graph', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a bussed graph and unlocks the context', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    expect(engine.isUnlocked).toBe(true);
    // Master plus the five sub-buses.
    expect(ctx.gains.length).toBeGreaterThanOrEqual(6);
    expect(ctx.analyser).not.toBeNull();
    engine.dispose();
    expect(ctx.closed).toBe(true);
  });

  it('renders a recipe as oscillators with a real envelope', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    const before = ctx.oscillators.length;
    engine.playSfx('counter-success');
    const created = ctx.oscillators.slice(before);
    // The just chord is four partials.
    expect(created).toHaveLength(4);
    for (const osc of created) {
      expect(osc.startedAt).not.toBeNull();
      expect(osc.stoppedAt).not.toBeNull();
      expect(osc.frequency.events.length).toBeGreaterThan(0);
    }
    const envelopes = ctx.gains.filter((g) => g.gain.events.some((e) => e.kind === 'linear'));
    expect(envelopes.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('pans by listener-relative direction and attenuates with distance', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    engine.setListener(vec3(0, 0, 0), 0);

    engine.playSfx('pulse-fire', { position: vec3(10, 0, 0) });
    const right = ctx.panners[ctx.panners.length - 1];
    expect(right?.pan.value ?? 0).toBeGreaterThan(0.5);

    engine.playSfx('pulse-fire', { position: vec3(-10, 0, 0) });
    const left = ctx.panners[ctx.panners.length - 1];
    expect(left?.pan.value ?? 0).toBeLessThan(-0.5);

    engine.playSfx('pulse-fire', { position: vec3(0, 0, -10) });
    const ahead = ctx.panners[ctx.panners.length - 1];
    expect(Math.abs(ahead?.pan.value ?? 1)).toBeLessThan(0.001);
    engine.dispose();
  });

  it('drops sounds beyond the audible radius instead of scheduling them', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    engine.setListener(vec3(0, 0, 0), 0);
    const before = ctx.oscillators.length;
    engine.playSfx('pulse-fire', { position: vec3(0, 0, 500) });
    expect(ctx.oscillators.length).toBe(before);
    engine.dispose();
  });

  it('schedules music ahead of the audio clock rather than note by note', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    engine.setMusicState({
      stage: 'fractured-garden',
      layers: { world: 0.6, movement: 0.4, combat: 0.5 },
      detune: 1,
      intensity: 0.5,
    });
    const before = ctx.oscillators.length;
    vi.advanceTimersByTime(30);
    const scheduled = ctx.oscillators.slice(before);
    expect(scheduled.length).toBeGreaterThan(0);
    // Everything is scheduled in the future, in one pass, ahead of the clock.
    for (const osc of scheduled) {
      expect(osc.startedAt ?? -1).toBeGreaterThan(ctx.currentTime);
      expect(osc.startedAt ?? -1).toBeLessThanOrEqual(ctx.currentTime + 0.25);
    }
    // At full infection the score plays on the Detuners' grid.
    const highest = Math.max(...scheduled.map((o) => o.frequency.value));
    expect(highest).toBeGreaterThan(0);

    engine.stopMusic(0.4);
    const afterStop = ctx.oscillators.length;
    vi.advanceTimersByTime(200);
    expect(ctx.oscillators.length).toBe(afterStop);
    engine.dispose();
  });

  it('retunes the score with the infection level', async () => {
    vi.useFakeTimers();
    const detuned = stubEngine();
    await detuned.engine.unlock();
    detuned.engine.setMusicState({
      stage: 'fractured-garden',
      layers: { world: 1 },
      detune: 1,
      intensity: 0,
    });
    vi.advanceTimersByTime(30);
    const infectedRoot = Math.min(...detuned.ctx.oscillators.map((o) => o.frequency.value));
    detuned.engine.dispose();

    const clean = stubEngine();
    await clean.engine.unlock();
    clean.engine.setMusicState({
      stage: 'fractured-garden',
      layers: { world: 1 },
      detune: 0,
      intensity: 0,
    });
    vi.advanceTimersByTime(30);
    const trueRoot = Math.min(...clean.ctx.oscillators.map((o) => o.frequency.value));
    clean.engine.dispose();

    expect(infectedRoot).toBeGreaterThan(trueRoot);
    expect(infectedRoot / trueRoot).toBeCloseTo(DETUNED_HZ / WORLD_CHORD_HZ, 6);
  });

  it('runs a loop handle and reports analyser levels', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    const loop = engine.playLoop('low-coherence', { position: vec3(2, 0, 0) });
    expect(loop.isRunning).toBe(true);
    const looping = ctx.oscillators.filter((o) => o.stoppedAt === null);
    expect(looping.length).toBeGreaterThan(0);
    loop.setVolume(0.4);
    loop.setPosition(vec3(-4, 0, 0));
    loop.stop(0.1);
    expect(loop.isRunning).toBe(false);

    const levels = engine.getVisualiserLevels();
    expect(levels.beat).toBeGreaterThan(0);
    expect(levels.bass).toBeGreaterThan(0);
    expect(levels.lead).toBeGreaterThan(0);
    expect(levels.beat).toBeLessThanOrEqual(1);
    expect(levels.bass).toBeLessThanOrEqual(1);
    engine.dispose();
  });

  it('brings the music bus back after a stopMusic fade, rather than resuming into silence', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    // Master first, then the sub-buses in order, so index 1 is music.
    const musicBus = ctx.gains[1];
    expect(musicBus?.gain.value).toBeCloseTo(engine.levels.music, 6);

    const state = {
      stage: 'fractured-garden',
      layers: { world: 0.6 },
      detune: 0.5,
      intensity: 0.2,
    } as const;
    engine.setMusicState(state);
    engine.stopMusic(0.3);
    expect(musicBus?.gain.value ?? 1).toBeLessThan(0.01);

    engine.setMusicState(state);
    expect(musicBus?.gain.value).toBeCloseTo(engine.levels.music, 6);
    vi.advanceTimersByTime(60);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('applies mix levels to the bus graph and suspends on background', async () => {
    const { engine, ctx } = stubEngine();
    await engine.unlock();
    engine.setLevels({ master: 0.25, sfx: 0.4 });
    const touched = ctx.gains.filter((g) => g.gain.events.some((e) => e.kind === 'linear'));
    expect(touched.length).toBeGreaterThanOrEqual(2);
    engine.suspend();
    expect(ctx.state).toBe('suspended');
    engine.resume();
    expect(ctx.state).toBe('running');
    engine.dispose();
  });
});
