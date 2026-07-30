/**
 * The Web Audio adapter.
 *
 * It renders {@link SFX_RECIPES} through oscillators, a synthesised noise
 * buffer and per-bus gain nodes, and schedules the adaptive score on a
 * lookahead scheduler driven by the `AudioContext` clock — never note-by-note
 * from a `setInterval` tick, which would jitter audibly.
 *
 * Robustness is a hard requirement, not a nicety: if `AudioContext` is missing
 * or throws, the factory returns a working object that silently does nothing.
 * The game stays fully playable, because the simulation only ever emits
 * `GameEvents` and the renderer already draws the visual half of every cue.
 *
 * Nothing here is touched at import time, so importing this module in Node is
 * safe.
 */

import {
  WORLD_CHORD_HZ,
  centsBetween,
  clamp,
  clamp01,
  createRng,
  type Vec3,
} from '@tuner/shared';
import {
  MAX_PEAK_AMPLITUDE,
  NOISE_PEAK_RATIO,
  SFX_RECIPES,
  applyFormToRecipe,
  harmonicRatio,
  shiftCents,
  type FilterKind,
  type OscWave,
  type SfxRecipe,
} from './synth.js';
import {
  MUSIC_LAYERS,
  MUSIC_LAYER_VOICES,
  motifNoteHz,
  phraseForRegion,
  playbackHzForInfection,
  regionMotif,
  type MusicRegion,
  type PhraseNote,
} from './music.js';
import {
  DEFAULT_AUDIO_LEVELS,
  createNullAudioEngine,
  type AudioEngine,
  type AudioLevels,
  type AudioLoopHandle,
  type MixBus,
  type MusicState,
  type PlaySfxOptions,
  type SfxId,
} from './types.js';

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

/** Distance at which a positional sound has fallen to half amplitude. */
const REFERENCE_DISTANCE = 9;
/** Beyond this a sound is not scheduled at all. */
const MAX_AUDIBLE_DISTANCE = 70;
/** Hard cap on simultaneous one-shot voices, so a crowd cannot melt a phone. */
const MAX_CONCURRENT_VOICES = 24;
/** Stereo width. Full hard-panning is unpleasant in headphones. */
const PAN_WIDTH = 0.85;
/** Below this a music layer is not scheduled. */
const LAYER_AUDIBLE_FLOOR = 0.02;
const NOISE_BUFFER_SECONDS = 2;
const LEVEL_RAMP_SECONDS = 0.05;

/**
 * Master limiter. `MAX_PEAK_AMPLITUDE` caps a *single* voice; nothing stops
 * twenty-four of them plus nine music layers from summing past full scale, and
 * Web Audio's destination hard-clips when they do — a crowd fight would crackle.
 * These settings sit above anything normal play reaches, so the limiter is a
 * safety net rather than a compressor in the signal path.
 */
const LIMITER_THRESHOLD_DB = -4;
const LIMITER_KNEE_DB = 2;
const LIMITER_RATIO = 12;
const LIMITER_ATTACK_SECONDS = 0.004;
const LIMITER_RELEASE_SECONDS = 0.2;

export interface WebAudioEngineOptions {
  readonly levels?: Partial<AudioLevels>;
  /** How far ahead of the audio clock notes are scheduled, in seconds. */
  readonly lookaheadSeconds?: number;
  /** How often the scheduler wakes, in milliseconds. */
  readonly scheduleIntervalMs?: number;
  /** Injection seam for tests and for native hosts with their own context. */
  readonly createContext?: () => BaseAudioContextLike | null;
}

/**
 * The slice of `AudioContext` this adapter needs. Declared structurally so a
 * host can supply its own implementation, and so nothing here depends on the
 * DOM lib being present at runtime.
 */
export interface BaseAudioContextLike extends BaseAudioContext {
  readonly state: AudioContextState;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

type AudioContextCtor = new () => BaseAudioContextLike;

function resolveAudioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return typeof ctor === 'function' ? (ctor as AudioContextCtor) : null;
}

const BUSES: readonly MixBus[] = ['music', 'sfx', 'ui', 'voice', 'ambience'];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Voice {
  readonly env: GainNode;
  readonly pan: StereoPannerNode | null;
  readonly sources: AudioScheduledSourceNode[];
  readonly nodes: AudioNode[];
  /** Envelope peak before positional attenuation. */
  readonly peak: number;
  stopped: boolean;
}

export function createWebAudioEngine(options: WebAudioEngineOptions = {}): AudioEngine {
  const ctor = resolveAudioContextCtor();
  if (!ctor && !options.createContext) {
    // No Web Audio here (Node, a locked-down webview, an ancient browser). The
    // game must not care.
    return createNullAudioEngine();
  }

  const lookahead = options.lookaheadSeconds ?? 0.25;
  const intervalMs = options.scheduleIntervalMs ?? 50;

  let levels: AudioLevels = { ...DEFAULT_AUDIO_LEVELS, ...options.levels };
  let ctx: BaseAudioContextLike | null = null;
  let failed = false;
  let unlocked = false;

  let master: GainNode | null = null;
  let limiter: DynamicsCompressorNode | null = null;
  let analyser: AnalyserNode | null = null;
  /** Terminal once `dispose()` has run, so a late call cannot build a new context. */
  let disposed = false;
  const busGains = new Map<MixBus, GainNode>();
  let noiseBuffer: AudioBuffer | null = null;
  let pinkBuffer: AudioBuffer | null = null;

  const listener = { x: 0, y: 0, z: 0 };
  let listenerYaw = 0;

  const activeVoices = new Set<Voice>();
  // Explicitly backed by an ArrayBuffer: the analyser rejects a shared buffer.
  let timeDomain: Uint8Array<ArrayBuffer> | null = null;
  let frequencyDomain: Uint8Array<ArrayBuffer> | null = null;

  // Music scheduling state.
  let musicState: MusicState | null = null;
  let musicRegion: MusicRegion = 'sanctuary';
  let phrase: readonly PhraseNote[] = [];
  let phraseSteps = 1;
  let stepSeconds = 0.25;
  let nextStepTime = 0;
  let stepIndex = 0;
  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let musicMuted = false;
  let musicFadeUntil = 0;

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  const buildNoiseBuffers = (context: BaseAudioContextLike): void => {
    const frames = Math.max(1, Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS));
    // Seeded rather than Math.random: identical noise every run keeps captures
    // and regression listening comparable.
    const rng = createRng('tuner:noise');
    const white = context.createBuffer(1, frames, context.sampleRate);
    const pink = context.createBuffer(1, frames, context.sampleRate);
    const w = white.getChannelData(0);
    const p = pink.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < frames; i++) {
      const sample = rng.range(-1, 1);
      w[i] = sample;
      // Cheap three-pole pink approximation.
      b0 = 0.99765 * b0 + sample * 0.099046;
      b1 = 0.963 * b1 + sample * 0.2965164;
      b2 = 0.57 * b2 + sample * 1.0526913;
      p[i] = clamp((b0 + b1 + b2 + sample * 0.1848) * 0.32, -1, 1);
    }
    noiseBuffer = white;
    pinkBuffer = pink;
  };

  const ensureContext = (): BaseAudioContextLike | null => {
    if (disposed) return null;
    if (ctx || failed) return ctx;
    try {
      const created = options.createContext ? options.createContext() : ctor ? new ctor() : null;
      if (!created) {
        failed = true;
        return null;
      }
      ctx = created;
      master = created.createGain();
      master.gain.value = clamp01(levels.master);
      analyser = created.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      timeDomain = new Uint8Array(analyser.fftSize);
      frequencyDomain = new Uint8Array(analyser.frequencyBinCount);
      // master -> limiter -> analyser -> destination. The analyser sits after
      // the limiter so the accessibility visualiser reports what the player
      // actually hears rather than the pre-limit sum.
      if (typeof created.createDynamicsCompressor === 'function') {
        limiter = created.createDynamicsCompressor();
        limiter.threshold.value = LIMITER_THRESHOLD_DB;
        limiter.knee.value = LIMITER_KNEE_DB;
        limiter.ratio.value = LIMITER_RATIO;
        limiter.attack.value = LIMITER_ATTACK_SECONDS;
        limiter.release.value = LIMITER_RELEASE_SECONDS;
        master.connect(limiter);
        limiter.connect(analyser);
      } else {
        // A host without a compressor still plays; it just has no safety net.
        master.connect(analyser);
      }
      analyser.connect(created.destination);
      for (const bus of BUSES) {
        const gain = created.createGain();
        gain.gain.value = clamp01(levels[bus]);
        gain.connect(master);
        busGains.set(bus, gain);
      }
      buildNoiseBuffers(created);
      unlocked = created.state === 'running';
      return ctx;
    } catch {
      failed = true;
      ctx = null;
      master = null;
      limiter = null;
      analyser = null;
      busGains.clear();
      return null;
    }
  };

  const busNode = (bus: MixBus): GainNode | null => {
    if (bus === 'master') return master;
    return busGains.get(bus) ?? null;
  };

  // -------------------------------------------------------------------------
  // Positional maths
  // -------------------------------------------------------------------------

  interface Spatial {
    readonly gain: number;
    readonly pan: number;
  }

  const spatialise = (position: Vec3 | undefined): Spatial | null => {
    if (!position) return { gain: 1, pan: 0 };
    const dx = position.x - listener.x;
    const dy = position.y - listener.y;
    const dz = position.z - listener.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > MAX_AUDIBLE_DISTANCE) return null;
    const ratio = distance / REFERENCE_DISTANCE;
    const gain = 1 / (1 + ratio * ratio);
    if (distance < 1e-4) return { gain, pan: 0 };
    // The camera/movement convention is forward = (-sin yaw, 0, -cos yaw), so
    // the listener's right is (cos yaw, 0, -sin yaw).
    const rightX = Math.cos(listenerYaw);
    const rightZ = -Math.sin(listenerYaw);
    const pan = clamp(((dx * rightX + dz * rightZ) / distance) * PAN_WIDTH, -1, 1);
    return { gain, pan };
  };

  // -------------------------------------------------------------------------
  // Voice rendering
  // -------------------------------------------------------------------------

  const disposeVoice = (voice: Voice): void => {
    if (voice.stopped) return;
    voice.stopped = true;
    activeVoices.delete(voice);
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // A node already torn down by the context; nothing to do.
      }
    }
  };

  const applyFilter = (
    context: BaseAudioContextLike,
    kind: FilterKind,
    startHz: number,
    endHz: number,
    q: number,
    t0: number,
    duration: number,
  ): BiquadFilterNode | null => {
    if (kind === 'none') return null;
    const filter = context.createBiquadFilter();
    filter.type = kind;
    const nyquist = context.sampleRate * 0.5;
    const from = clamp(startHz, 20, nyquist - 1);
    const to = clamp(endHz, 20, nyquist - 1);
    filter.Q.value = Math.max(0.0001, q);
    filter.frequency.setValueAtTime(from, t0);
    if (Math.abs(to - from) > 1) {
      filter.frequency.exponentialRampToValueAtTime(to, t0 + Math.max(0.01, duration));
    }
    return filter;
  };

  const scheduleOscillator = (
    context: BaseAudioContextLike,
    wave: OscWave,
    startHz: number,
    endHz: number,
    curve: 'linear' | 'exponential' | 'hold',
    glideSeconds: number,
    detuneCents: number,
    t0: number,
  ): OscillatorNode => {
    const osc = context.createOscillator();
    osc.type = wave;
    const nyquist = context.sampleRate * 0.5;
    const from = clamp(startHz, 8, nyquist - 1);
    const to = clamp(endHz, 8, nyquist - 1);
    osc.detune.value = detuneCents;
    osc.frequency.setValueAtTime(from, t0);
    if (curve !== 'hold' && Math.abs(to - from) > 0.01 && glideSeconds > 0.005) {
      if (curve === 'exponential') {
        osc.frequency.exponentialRampToValueAtTime(to, t0 + glideSeconds);
      } else {
        osc.frequency.linearRampToValueAtTime(to, t0 + glideSeconds);
      }
    }
    return osc;
  };

  /**
   * Writes an ADSR onto a gain node. Linear ramps throughout: an exponential
   * ramp cannot legally reach zero, and a voice that never reaches zero clicks.
   */
  const writeEnvelope = (
    param: AudioParam,
    peak: number,
    recipe: SfxRecipe,
    t0: number,
    duration: number,
    loop: boolean,
  ): void => {
    const { attack, decay, sustain } = recipe.amplitude;
    const sustainLevel = peak * clamp01(sustain);
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(peak, t0 + Math.max(0.002, attack));
    param.linearRampToValueAtTime(sustainLevel, t0 + Math.max(0.003, attack + decay));
    if (!loop) {
      const release = Math.max(0.01, recipe.amplitude.release);
      const releaseStart = Math.max(t0 + attack + decay + 0.001, t0 + duration - release);
      param.setValueAtTime(sustainLevel, releaseStart);
      param.linearRampToValueAtTime(0.0001, t0 + duration);
    }
  };

  const renderRecipe = (
    recipe: SfxRecipe,
    opts: PlaySfxOptions | undefined,
    loop: boolean,
  ): Voice | null => {
    const context = ensureContext();
    if (!context) return null;
    const bus = busNode(recipe.bus);
    if (!bus) return null;

    const spatial = spatialise(opts?.position);
    if (!spatial) return null;
    if (!loop && activeVoices.size >= MAX_CONCURRENT_VOICES) return null;

    const rate = Math.max(0.25, Math.min(4, opts?.rate ?? 1));
    // A form re-voices the timbre; an explicit `hz` then overrides the pitch,
    // which is how a resonator pillar sounds its own degree in the acting
    // form's colour. `degree` transposes whichever root won, so a charge tier
    // rides on top of the form's pitch instead of erasing it.
    const voiced = opts?.form && opts.form !== 'base' ? applyFormToRecipe(recipe, opts.form) : recipe;
    const transpose = opts?.degree === undefined ? 1 : harmonicRatio(opts.degree);
    const rootHz = (opts?.hz ?? voiced.frequency.startHz) * transpose * rate;
    const glideRatio =
      voiced.frequency.startHz > 0 ? voiced.frequency.endHz / voiced.frequency.startHz : 1;
    const endHz = rootHz * glideRatio;
    const duration = Math.max(0.02, voiced.duration / rate);
    const t0 = context.currentTime + 0.002;

    const volume = clamp01(opts?.volume ?? 1);
    const peak = Math.min(MAX_PEAK_AMPLITUDE, voiced.amplitude.peak * volume * spatial.gain);
    if (peak <= 0.0002) return null;

    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];

    const env = context.createGain();
    nodes.push(env);
    writeEnvelope(env.gain, peak, voiced, t0, duration, loop);

    let tail: AudioNode = env;

    // Tremolo, when a recipe wants a pulsing rather than a held tone.
    if (voiced.tremoloHz > 0) {
      const trem = context.createGain();
      trem.gain.value = 1;
      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = voiced.tremoloHz;
      const depth = context.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth);
      depth.connect(trem.gain);
      env.connect(trem);
      nodes.push(trem, depth, lfo);
      sources.push(lfo);
      tail = trem;
    }

    let pan: StereoPannerNode | null = null;
    if (typeof context.createStereoPanner === 'function') {
      pan = context.createStereoPanner();
      pan.pan.value = spatial.pan;
      tail.connect(pan);
      nodes.push(pan);
      tail = pan;
    }
    tail.connect(bus);

    const filter = applyFilter(
      context,
      voiced.filter.kind,
      voiced.filter.startHz * rate,
      voiced.filter.endHz * rate,
      voiced.filter.q,
      t0,
      duration,
    );
    const sink: AudioNode = filter ?? env;
    if (filter) {
      filter.connect(env);
      nodes.push(filter);
    }

    // Tone: one oscillator per just-intonation partial, gains normalised so a
    // stack never adds loudness.
    const degrees = voiced.harmonics?.degrees ?? [0];
    const weights = voiced.harmonics?.gains ?? [1];
    let weightSum = 0;
    for (let i = 0; i < degrees.length; i++) {
      weightSum += Math.max(0, weights[i] ?? 1);
    }
    if (weightSum <= 0) weightSum = 1;
    const spread = voiced.harmonics?.detuneCents ?? 0;
    const toneShare = 1 - clamp01(voiced.noise) * 0.5;
    const glideSeconds = duration * clamp01(voiced.frequency.glide || 1);

    for (let i = 0; i < degrees.length; i++) {
      const degree = degrees[i] ?? 0;
      const ratio = harmonicRatio(degree);
      const weight = (Math.max(0, weights[i] ?? 1) / weightSum) * toneShare;
      if (weight <= 0.0005) continue;
      const osc = scheduleOscillator(
        context,
        voiced.wave,
        rootHz * ratio,
        endHz * ratio,
        voiced.frequency.curve,
        glideSeconds,
        voiced.detuneCents + spread * (i % 2 === 0 ? 1 : -1),
        t0,
      );
      const partialGain = context.createGain();
      partialGain.gain.value = weight;
      osc.connect(partialGain);
      partialGain.connect(sink);
      nodes.push(osc, partialGain);
      sources.push(osc);
    }

    // Noise bed, mixed in parallel — the ratio the comfort ceiling assumes.
    const noiseAmount = clamp01(voiced.noise);
    if (noiseAmount > 0.005) {
      const buffer = voiced.noiseColour === 'pink' ? pinkBuffer : noiseBuffer;
      if (buffer) {
        const noise = context.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        const noiseGain = context.createGain();
        noiseGain.gain.value = noiseAmount * NOISE_PEAK_RATIO;
        noise.connect(noiseGain);
        noiseGain.connect(sink);
        nodes.push(noise, noiseGain);
        sources.push(noise);
      }
    }

    if (sources.length === 0) {
      disposeVoice({ env, pan, sources, nodes, peak, stopped: false });
      return null;
    }

    const voice: Voice = { env, pan, sources, nodes, peak, stopped: false };
    activeVoices.add(voice);

    for (const source of sources) {
      try {
        source.start(t0);
        if (!loop) source.stop(t0 + duration + 0.03);
      } catch {
        // A source that refuses to start is simply silent.
      }
    }
    const last = sources[sources.length - 1];
    if (last && !loop) {
      last.onended = () => disposeVoice(voice);
    }
    return voice;
  };

  const stopVoice = (voice: Voice, fadeSeconds: number): void => {
    const context = ctx;
    if (!context || voice.stopped) {
      disposeVoice(voice);
      return;
    }
    const now = context.currentTime;
    const fade = Math.max(0.01, fadeSeconds);
    try {
      voice.env.gain.cancelScheduledValues(now);
      voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value), now);
      voice.env.gain.linearRampToValueAtTime(0.0001, now + fade);
      for (const source of voice.sources) {
        source.stop(now + fade + 0.02);
      }
    } catch {
      // Fall through to a hard teardown.
    }
    setTimeout(() => disposeVoice(voice), (fade + 0.1) * 1000);
  };

  // -------------------------------------------------------------------------
  // Music scheduling
  // -------------------------------------------------------------------------

  const loadRegion = (region: MusicRegion): void => {
    musicRegion = region;
    const m = regionMotif(region);
    phrase = phraseForRegion(region);
    phraseSteps = Math.max(1, m.bars * m.stepsPerBar);
    // Four beats to a bar, so a bar of `stepsPerBar` steps lasts four beats.
    stepSeconds = (60 / m.tempoBpm) * (4 / m.stepsPerBar);
    stepIndex = 0;
  };

  const layerRootHz = (detunePull: number): number => {
    const playbackHz = playbackHzForInfection(musicState?.detune ?? 0);
    const cents = centsBetween(WORLD_CHORD_HZ, playbackHz) * clamp01(detunePull);
    return shiftCents(WORLD_CHORD_HZ, cents);
  };

  const scheduleMusicNote = (
    context: BaseAudioContextLike,
    layerGain: number,
    layerIndex: number,
    note: PhraseNote,
    when: number,
  ): void => {
    const layer = MUSIC_LAYERS[layerIndex];
    if (!layer) return;
    const voice = MUSIC_LAYER_VOICES[layer];
    const bus = busNode('music');
    if (!bus) return;
    const root = layerRootHz(voice.detunePull);
    const held =
      voice.rhythm === 'drone'
        ? // A drone spans the whole phrase, so the bed never gaps.
          stepSeconds * phraseSteps
        : voice.rhythm === 'pulse'
          ? Math.min(stepSeconds * 0.8, 0.22)
          : stepSeconds * note.duration;
    const degrees = voice.rhythm === 'arp' ? [voice.degrees[stepIndex % voice.degrees.length] ?? 0] : voice.degrees;
    const perNote = (voice.gain * layerGain * note.velocity) / Math.max(1, degrees.length);
    if (perNote <= 0.0008) return;

    const env = context.createGain();
    const level = Math.min(MAX_PEAK_AMPLITUDE, perNote);
    const attack = Math.min(voice.rhythm === 'pulse' ? 0.01 : 0.09, held * 0.25);
    const release = Math.min(0.35, held * 0.4);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(level, when + attack);
    // Hold, then release — otherwise a long pad is one continuous fade.
    env.gain.setValueAtTime(level, when + Math.max(attack, held - release));
    env.gain.linearRampToValueAtTime(0.0001, when + held);

    const filter = applyFilter(
      context,
      voice.filter,
      voice.filterHz,
      voice.filterHz,
      0.9,
      when,
      held,
    );
    const nodes: AudioNode[] = [env];
    if (filter) {
      filter.connect(env);
      nodes.push(filter);
    }
    env.connect(bus);
    const sink: AudioNode = filter ?? env;

    const oscillators: OscillatorNode[] = [];
    for (const degree of degrees) {
      const hz = motifNoteHz(root, note.degree + degree, voice.octave);
      const osc = scheduleOscillator(context, voice.wave, hz, hz, 'hold', 0, 0, when);
      osc.connect(sink);
      oscillators.push(osc);
      nodes.push(osc);
    }
    for (const osc of oscillators) {
      try {
        osc.start(when);
        osc.stop(when + held + 0.05);
      } catch {
        // Silent voice; nothing else to do.
      }
    }
    const last = oscillators[oscillators.length - 1];
    if (last) {
      last.onended = () => {
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch {
            // Already gone.
          }
        }
      };
    }
  };

  /**
   * The lookahead scheduler. It walks the phrase forward until it has filled
   * `lookahead` seconds of the `AudioContext` clock, so timing accuracy comes
   * from the audio thread rather than from the interval that woke us.
   */
  const scheduleAhead = (): void => {
    const context = ctx;
    if (!context || !musicState || musicMuted) return;
    if (context.state !== 'running') return;
    const horizon = context.currentTime + lookahead;
    if (nextStepTime < context.currentTime) {
      nextStepTime = context.currentTime + 0.05;
    }
    let guard = 0;
    while (nextStepTime < horizon && guard < 512) {
      guard += 1;
      const localStep = ((stepIndex % phraseSteps) + phraseSteps) % phraseSteps;
      for (let i = 0; i < MUSIC_LAYERS.length; i++) {
        const layer = MUSIC_LAYERS[i];
        if (!layer) continue;
        const gain = musicState.layers[layer] ?? 0;
        if (gain < LAYER_AUDIBLE_FLOOR) continue;
        const voice = MUSIC_LAYER_VOICES[layer];
        if (voice.rhythm === 'drone' && localStep % phraseSteps !== 0) continue;
        if (voice.rhythm === 'pulse') {
          const beat = phrase[0] ?? { degree: 0, step: 0, duration: 1, velocity: 0.8 };
          scheduleMusicNote(context, gain, i, { ...beat, step: localStep }, nextStepTime);
          continue;
        }
        for (const note of phrase) {
          if (note.step === localStep) {
            scheduleMusicNote(context, gain, i, note, nextStepTime);
          }
        }
      }
      nextStepTime += stepSeconds;
      stepIndex += 1;
    }
  };

  const startScheduler = (): void => {
    if (schedulerTimer !== null) return;
    const context = ensureContext();
    if (!context) return;
    nextStepTime = context.currentTime + 0.08;
    schedulerTimer = setInterval(scheduleAhead, intervalMs);
  };

  const stopScheduler = (): void => {
    if (schedulerTimer === null) return;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  };

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  const engine: AudioEngine = {
    async unlock() {
      const context = ensureContext();
      if (!context) return;
      try {
        if (context.state !== 'running') {
          await context.resume();
        }
        unlocked = context.state === 'running';
        if (musicState && !musicMuted) startScheduler();
      } catch {
        unlocked = false;
      }
    },
    get isUnlocked() {
      return unlocked;
    },

    playSfx(id, opts) {
      const recipe = SFX_RECIPES[id];
      if (!recipe) return;
      try {
        renderRecipe(recipe, opts, false);
      } catch {
        // A cue that fails to sound is never fatal: the renderer already drew it.
      }
    },

    playLoop(id: SfxId, opts?: PlaySfxOptions): AudioLoopHandle {
      let voice: Voice | null = null;
      try {
        voice = renderRecipe(SFX_RECIPES[id], opts, true);
      } catch {
        voice = null;
      }
      let running = voice !== null;
      const handle: AudioLoopHandle = {
        stop(fadeSeconds = 0.12) {
          if (voice) stopVoice(voice, fadeSeconds);
          running = false;
        },
        setVolume(volume: number) {
          if (!voice || !ctx) return;
          try {
            const target = Math.min(MAX_PEAK_AMPLITUDE, voice.peak * clamp01(volume));
            voice.env.gain.cancelScheduledValues(ctx.currentTime);
            voice.env.gain.linearRampToValueAtTime(
              Math.max(0.0001, target),
              ctx.currentTime + LEVEL_RAMP_SECONDS,
            );
          } catch {
            // Leave the loop at its current level.
          }
        },
        setPosition(position: Vec3) {
          if (!voice || !ctx) return;
          const spatial = spatialise(position);
          if (!spatial) return;
          try {
            if (voice.pan) {
              voice.pan.pan.linearRampToValueAtTime(spatial.pan, ctx.currentTime + 0.05);
            }
            voice.env.gain.linearRampToValueAtTime(
              Math.max(0.0001, voice.peak * spatial.gain),
              ctx.currentTime + 0.08,
            );
          } catch {
            // Positioning is cosmetic; ignore a rejected ramp.
          }
        },
        get isRunning() {
          return running && voice !== null && !voice.stopped;
        },
      };
      return handle;
    },

    setMusicState(state: MusicState) {
      musicState = state;
      const wasMuted = musicMuted;
      musicMuted = false;
      musicFadeUntil = 0;
      if (state.stage !== musicRegion || phrase.length === 0) {
        loadRegion(state.stage);
      }
      const context = ensureContext();
      if (!context) return;
      // A previous stopMusic() left the music bus faded out. Bring it back, or
      // the score would restart into a bus that is still silent.
      if (wasMuted) {
        const bus = busGains.get('music');
        if (bus) {
          try {
            const now = context.currentTime;
            bus.gain.cancelScheduledValues(now);
            bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
            bus.gain.linearRampToValueAtTime(clamp01(levels.music), now + 0.25);
          } catch {
            bus.gain.value = clamp01(levels.music);
          }
        }
      }
      if (context.state === 'running') startScheduler();
    },

    stopMusic(seconds = 1) {
      musicMuted = true;
      stopScheduler();
      const bus = busGains.get('music');
      if (!bus || !ctx) return;
      try {
        const now = ctx.currentTime;
        musicFadeUntil = now + Math.max(0.02, seconds);
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
        bus.gain.linearRampToValueAtTime(0.0001, musicFadeUntil);
      } catch {
        // Nothing more to do; the scheduler is already stopped.
      }
    },

    setLevels(next: Partial<AudioLevels>) {
      levels = { ...levels, ...next };
      if (!ctx) return;
      const now = ctx.currentTime;
      const ramp = (node: GainNode | null, value: number): void => {
        if (!node) return;
        try {
          node.gain.cancelScheduledValues(now);
          node.gain.setValueAtTime(node.gain.value, now);
          node.gain.linearRampToValueAtTime(clamp01(value), now + LEVEL_RAMP_SECONDS);
        } catch {
          node.gain.value = clamp01(value);
        }
      };
      ramp(master, levels.master);
      for (const bus of BUSES) {
        // A music fade in progress owns that bus until it finishes.
        if (bus === 'music' && musicMuted && now < musicFadeUntil) continue;
        ramp(busGains.get(bus) ?? null, levels[bus]);
      }
    },
    get levels() {
      return levels;
    },

    setListener(position: Vec3, forwardYaw: number) {
      listener.x = position.x;
      listener.y = position.y;
      listener.z = position.z;
      listenerYaw = forwardYaw;
    },

    suspend() {
      stopScheduler();
      if (!ctx) return;
      try {
        void ctx.suspend();
      } catch {
        // Some hosts refuse; the scheduler is stopped either way.
      }
    },

    resume() {
      const context = ensureContext();
      if (!context) return;
      try {
        void context.resume();
      } catch {
        return;
      }
      if (musicState && !musicMuted) startScheduler();
    },

    dispose() {
      // Terminal. Without the flag a stray `playSfx` or `resume` after teardown
      // would build a whole new AudioContext that nothing ever closes.
      disposed = true;
      stopScheduler();
      for (const voice of [...activeVoices]) {
        disposeVoice(voice);
      }
      activeVoices.clear();
      musicState = null;
      phrase = [];
      const context = ctx;
      ctx = null;
      master = null;
      limiter = null;
      analyser = null;
      busGains.clear();
      noiseBuffer = null;
      pinkBuffer = null;
      unlocked = false;
      if (!context) return;
      try {
        void context.close();
      } catch {
        // Already closed.
      }
    },

    getVisualiserLevels() {
      const node = analyser;
      if (!node || !timeDomain || !frequencyDomain) return { beat: 0, bass: 0, lead: 0 };
      try {
        node.getByteTimeDomainData(timeDomain);
        node.getByteFrequencyData(frequencyDomain);
      } catch {
        return { beat: 0, bass: 0, lead: 0 };
      }
      let peak = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const sample = Math.abs((timeDomain[i] ?? 128) - 128) / 128;
        if (sample > peak) peak = sample;
      }
      const bins = frequencyDomain.length;
      const bassEnd = Math.max(1, Math.floor(bins * 0.12));
      const leadStart = Math.floor(bins * 0.25);
      let bassSum = 0;
      for (let i = 0; i < bassEnd; i++) bassSum += frequencyDomain[i] ?? 0;
      let leadSum = 0;
      let leadCount = 0;
      for (let i = leadStart; i < bins; i++) {
        leadSum += frequencyDomain[i] ?? 0;
        leadCount += 1;
      }
      return {
        beat: clamp01(peak),
        bass: clamp01(bassSum / (bassEnd * 255)),
        lead: clamp01(leadSum / (Math.max(1, leadCount) * 255)),
      };
    },
  };

  return engine;
}
