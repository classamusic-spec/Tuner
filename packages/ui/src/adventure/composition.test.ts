import { describe, expect, it } from 'vitest';
import { HARMONIC_RATIOS, WORLD_CHORD_HZ } from '@tuner/shared';
import type { MotifCardDef } from '@tuner/game-core';
import {
  BEATS_PER_BAR,
  LAYER_IDS,
  SCALE_CENTRE,
  SCALE_DEGREES,
  advancePlayback,
  clearLayer,
  compositionSignature,
  createComposition,
  createMotifLibrary,
  describeComposition,
  layerFilledSteps,
  mirrorSteps,
  motifGridSpan,
  noteEventsAtStep,
  placeMotif,
  removePlacement,
  reverseSteps,
  setGridSize,
  setTempo,
  stepDurationSeconds,
  stepsPerBeat,
  stepsPerSecond,
  suggestArrangement,
  toggleLayerMuted,
  transformPlacement,
  wrapDegree,
  type CompositionState,
  type MotifLibrary,
  type NoteEvent,
} from './composition.js';

/**
 * Composition Mode's rules, tested where they live: in pure functions over an
 * immutable state, in Node, with no DOM and no audio engine.
 *
 * The cards below are shaped exactly like the authored ones in
 * `@tuner/game-content` — eight-step phrases at `stepsPerBar: 8`, plus a
 * six-step phrase, because the awkward ratio is the case that breaks naive
 * grid maths.
 */

const MELODY: MotifCardDef = {
  id: 'mot-test-melody',
  name: 'Test Melody',
  region: 'fractured-garden',
  layer: 'melody',
  steps: [4, 2, 0, 2, 4, 5, 4, null],
  stepsPerBar: 8,
};

const BASS: MotifCardDef = {
  id: 'mot-test-bass',
  name: 'Test Bass',
  region: 'fractured-garden',
  layer: 'bass',
  steps: [0, null, 4, null, 0, null, 2, null],
  stepsPerBar: 8,
};

const RHYTHM: MotifCardDef = {
  id: 'mot-test-rhythm',
  name: 'Test Rhythm',
  region: 'fractured-garden',
  layer: 'rhythm',
  steps: [0, null, 0, 0, null, 0, null, null],
  stepsPerBar: 8,
};

const HARMONY: MotifCardDef = {
  id: 'mot-test-harmony',
  name: 'Test Harmony',
  region: 'fractured-garden',
  layer: 'harmony',
  steps: [0, 4, 7, 4],
  stepsPerBar: 4,
};

/** Six against a power-of-two grid: the non-integer ratio case. */
const SIX: MotifCardDef = {
  id: 'mot-test-six',
  name: 'Six Steps',
  region: 'fractured-garden',
  layer: 'melody',
  steps: [7, 5, 4, 2, 0, null],
  stepsPerBar: 6,
};

/** Found, but never collected. Must stay unplayable. */
const UNCOLLECTED: MotifCardDef = {
  id: 'mot-test-locked',
  name: 'Not Yours Yet',
  region: 'glass-meridian',
  layer: 'melody',
  steps: [0, 2, 4, 6],
  stepsPerBar: 4,
};

const ALL_CARDS = [MELODY, BASS, RHYTHM, HARMONY, SIX, UNCOLLECTED];

function library(collected: readonly string[] = [
  MELODY.id,
  BASS.id,
  RHYTHM.id,
  HARMONY.id,
  SIX.id,
]): MotifLibrary {
  return createMotifLibrary(ALL_CARDS, collected);
}

/** Degrees of a rendered lane, `null` for a rest. */
function degrees(state: CompositionState, layer: 'rhythm' | 'bass' | 'harmony' | 'melody'): (number | null)[] {
  return state.layers[layer].steps.map((cell) => (cell ? cell.degree : null));
}

describe('placement', () => {
  it('writes a motif onto the right steps at the requested offset', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 8, tempoBpm: 100 });
    const outcome = placeMotif(grid, { motifId: MELODY.id, layer: 'melody', offset: 0 }, lib);

    expect(outcome.rejected).toBeNull();
    // The motif is written against 8 steps and the grid is 8, so it lands 1:1 —
    // including the trailing rest, which stays empty.
    expect(degrees(outcome.state, 'melody')).toEqual([4, 2, 0, 2, 4, 5, 4, null]);
    expect(layerFilledSteps(outcome.state, 'melody')).toBe(7);
  });

  it('shifts every note by the offset and leaves the steps before it empty', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 16 });
    const placed = placeMotif(grid, { motifId: HARMONY.id, layer: 'harmony', offset: 4 }, lib).state;

    // A 4-step phrase on a 16-step grid plays every fourth step, starting at 4.
    expect(degrees(placed, 'harmony')).toEqual([
      null, null, null, null, 0, null, null, null,
      4, null, null, null, 7, null, null, null,
    ]);
  });

  it('maps a six-step phrase proportionally rather than cramming it', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 16 });
    const placed = placeMotif(grid, { motifId: SIX.id, layer: 'melody', offset: 0 }, lib).state;

    // ratio 16/6: indices 0, 3, 5, 8, 11 — the final step of the card is a rest.
    const written = degrees(placed, 'melody')
      .map((degree, index) => (degree === null ? null : index))
      .filter((index): index is number => index !== null);
    expect(written).toEqual([0, 3, 5, 8, 11]);
    expect(motifGridSpan(SIX, 16)).toBe(16);
  });

  it('clips a motif that runs past the end of the bar instead of overflowing', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 8 });
    const placed = placeMotif(grid, { motifId: MELODY.id, layer: 'melody', offset: 5 }, lib).state;

    expect(placed.layers.melody.steps).toHaveLength(8);
    // Only the first three of the phrase's notes fit; nothing wraps to step 0.
    expect(degrees(placed, 'melody')).toEqual([null, null, null, null, null, 4, 2, 0]);
  });

  it('refuses an offset outside the bar', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 8 });
    expect(placeMotif(grid, { motifId: MELODY.id, layer: 'melody', offset: 8 }, lib).rejected).toBe(
      'out-of-range',
    );
    expect(placeMotif(grid, { motifId: MELODY.id, layer: 'melody', offset: -1 }, lib).rejected).toBe(
      'out-of-range',
    );
  });

  it('only lets the player place motifs they have collected', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 8 });

    const locked = placeMotif(grid, { motifId: UNCOLLECTED.id, layer: 'melody', offset: 0 }, lib);
    expect(locked.rejected).toBe('not-collected');
    expect(locked.state).toBe(grid); // Untouched, not merely equal.
    expect(degrees(locked.state, 'melody')).toEqual([null, null, null, null, null, null, null, null]);

    const unknown = placeMotif(grid, { motifId: 'mot-does-not-exist', layer: 'melody', offset: 0 }, lib);
    expect(unknown.rejected).toBe('unknown-motif');

    // And once it is collected, the same call succeeds.
    const later = createMotifLibrary(ALL_CARDS, [UNCOLLECTED.id]);
    expect(
      placeMotif(grid, { motifId: UNCOLLECTED.id, layer: 'melody', offset: 0 }, later).rejected,
    ).toBeNull();
  });

  it('keeps a phrase on its own lane', () => {
    const lib = library();
    const grid = createComposition({ stepsPerBar: 8 });
    expect(placeMotif(grid, { motifId: BASS.id, layer: 'melody', offset: 0 }, lib).rejected).toBe(
      'wrong-layer',
    );
  });

  it('removes a placement without disturbing the rest of the lane', () => {
    const lib = library();
    let state = createComposition({ stepsPerBar: 16 }) as CompositionState;
    const first = placeMotif(state, { motifId: HARMONY.id, layer: 'harmony', offset: 0 }, lib);
    state = first.state;
    const second = placeMotif(state, { motifId: HARMONY.id, layer: 'harmony', offset: 1 }, lib);
    state = second.state;
    expect(state.layers.harmony.placements).toHaveLength(2);

    const pruned = removePlacement(state, 'harmony', second.placementId ?? '', lib);
    expect(pruned.layers.harmony.placements).toHaveLength(1);
    expect(degrees(pruned, 'harmony')).toEqual(degrees(first.state, 'harmony'));
  });
});

describe('transforms', () => {
  it('reverses a motif in time, and is its own inverse', () => {
    expect(reverseSteps(MELODY.steps)).toEqual([null, 4, 5, 4, 2, 0, 2, 4]);
    expect(reverseSteps(reverseSteps(MELODY.steps))).toEqual(MELODY.steps);
  });

  it('mirrors degrees about the centre of the scale, and is its own inverse', () => {
    // Eight degrees, centre 3.5: Root becomes Octave, the Fourth becomes the Fifth.
    expect(SCALE_DEGREES).toBe(HARMONIC_RATIOS.length);
    expect(SCALE_CENTRE).toBe(3.5);
    expect(mirrorSteps([0, 3, 4, 7, null])).toEqual([7, 4, 3, 0, null]);
    expect(mirrorSteps(mirrorSteps(MELODY.steps))).toEqual(MELODY.steps);
    // Rests survive mirroring as rests.
    expect(mirrorSteps([null, null])).toEqual([null, null]);
  });

  it('reversing a placement twice restores the grid exactly', () => {
    const lib = library();
    const placed = placeMotif(
      createComposition({ stepsPerBar: 8 }),
      { motifId: MELODY.id, layer: 'melody', offset: 0 },
      lib,
    );
    const id = placed.placementId ?? '';
    const once = transformPlacement(placed.state, 'melody', id, 'reverse', lib);
    const twice = transformPlacement(once, 'melody', id, 'reverse', lib);

    expect(degrees(once, 'melody')).toEqual([null, 4, 5, 4, 2, 0, 2, 4]);
    expect(degrees(once, 'melody')).not.toEqual(degrees(placed.state, 'melody'));
    expect(degrees(twice, 'melody')).toEqual(degrees(placed.state, 'melody'));
  });

  it('mirroring a placement twice restores the grid exactly', () => {
    const lib = library();
    const placed = placeMotif(
      createComposition({ stepsPerBar: 8 }),
      { motifId: MELODY.id, layer: 'melody', offset: 0 },
      lib,
    );
    const id = placed.placementId ?? '';
    const once = transformPlacement(placed.state, 'melody', id, 'mirror', lib);
    const twice = transformPlacement(once, 'melody', id, 'mirror', lib);

    expect(degrees(once, 'melody')).toEqual([3, 5, 7, 5, 3, 2, 3, null]);
    expect(degrees(twice, 'melody')).toEqual(degrees(placed.state, 'melody'));
  });

  it('keeps every mirrored degree inside the World Chord', () => {
    for (let degree = 0; degree < SCALE_DEGREES; degree += 1) {
      const [mirrored] = mirrorSteps([degree]);
      expect(mirrored).not.toBeNull();
      expect(wrapDegree(mirrored ?? 0)).toBeGreaterThanOrEqual(0);
      expect(wrapDegree(mirrored ?? 0)).toBeLessThan(SCALE_DEGREES);
    }
  });
});

describe('tempo', () => {
  it('changes step duration without touching the note sequence', () => {
    const lib = library();
    const slow = placeMotif(
      createComposition({ stepsPerBar: 16, tempoBpm: 80 }),
      { motifId: MELODY.id, layer: 'melody', offset: 0 },
      lib,
    ).state;
    const fast = setTempo(slow, 160);

    expect(fast.tempoBpm).toBe(160);
    expect(degrees(fast, 'melody')).toEqual(degrees(slow, 'melody'));
    expect(fast.layers).toEqual(slow.layers);
    expect(compositionSignature(fast)).not.toBe(compositionSignature(slow)); // tempo is in it
    expect(stepDurationSeconds(160, 16)).toBeCloseTo(stepDurationSeconds(80, 16) / 2, 10);
    expect(stepsPerSecond(120, 16)).toBeCloseTo(8, 10);
  });

  it('keeps a bar four beats long at every grid resolution', () => {
    expect(stepsPerBeat(16)).toBe(4);
    expect(stepsPerBeat(8)).toBe(2);
    expect(stepsPerBeat(24)).toBe(6);
    for (const size of [8, 12, 16, 24]) {
      expect(stepDurationSeconds(120, size) * size).toBeCloseTo((60 / 120) * BEATS_PER_BAR, 10);
    }
  });

  it('clamps absurd tempi rather than dividing by zero', () => {
    expect(setTempo(createComposition(), 0).tempoBpm).toBe(50);
    expect(setTempo(createComposition(), 10_000).tempoBpm).toBe(190);
    expect(stepDurationSeconds(0, 16)).toBeGreaterThan(0);
  });
});

describe('layers', () => {
  it('clearing one layer leaves the others untouched', () => {
    const lib = library();
    let state: CompositionState = createComposition({ stepsPerBar: 8 });
    state = placeMotif(state, { motifId: MELODY.id, layer: 'melody', offset: 0 }, lib).state;
    state = placeMotif(state, { motifId: BASS.id, layer: 'bass', offset: 0 }, lib).state;
    state = placeMotif(state, { motifId: RHYTHM.id, layer: 'rhythm', offset: 0 }, lib).state;

    const cleared = clearLayer(state, 'melody');

    expect(layerFilledSteps(cleared, 'melody')).toBe(0);
    expect(cleared.layers.melody.placements).toHaveLength(0);
    expect(degrees(cleared, 'bass')).toEqual(degrees(state, 'bass'));
    expect(degrees(cleared, 'rhythm')).toEqual(degrees(state, 'rhythm'));
    // Identity, not just equality: untouched lanes are the same objects.
    expect(cleared.layers.bass).toBe(state.layers.bass);
    expect(cleared.layers.rhythm).toBe(state.layers.rhythm);
    expect(cleared.layers.harmony).toBe(state.layers.harmony);
  });

  it('muting a layer silences only its own notes', () => {
    const lib = library();
    let state: CompositionState = createComposition({ stepsPerBar: 8 });
    state = placeMotif(state, { motifId: MELODY.id, layer: 'melody', offset: 0 }, lib).state;
    state = placeMotif(state, { motifId: BASS.id, layer: 'bass', offset: 0 }, lib).state;

    expect(noteEventsAtStep(state, 0).map((n) => n.layer).sort()).toEqual(['bass', 'melody']);
    const muted = toggleLayerMuted(state, 'bass');
    expect(noteEventsAtStep(muted, 0).map((n) => n.layer)).toEqual(['melody']);
    // The grid still holds the bass phrase — muting is not deleting.
    expect(layerFilledSteps(muted, 'bass')).toBe(layerFilledSteps(state, 'bass'));
  });

  it('re-lays placements when the grid resolution changes', () => {
    const lib = library();
    const eight = placeMotif(
      createComposition({ stepsPerBar: 8 }),
      { motifId: MELODY.id, layer: 'melody', offset: 0 },
      lib,
    ).state;
    const sixteen = setGridSize(eight, 16, lib);

    expect(sixteen.stepsPerBar).toBe(16);
    expect(sixteen.layers.melody.steps).toHaveLength(16);
    // Same phrase, now on every other step.
    expect(degrees(sixteen, 'melody').filter((d) => d !== null)).toEqual(
      degrees(eight, 'melody').filter((d) => d !== null),
    );
  });

  it('suggests a starting arrangement using only collected cards', () => {
    const lib = library([MELODY.id, BASS.id]);
    const suggested = suggestArrangement(createComposition({ stepsPerBar: 8 }), lib);

    expect(layerFilledSteps(suggested, 'melody')).toBeGreaterThan(0);
    expect(layerFilledSteps(suggested, 'bass')).toBeGreaterThan(0);
    expect(layerFilledSteps(suggested, 'harmony')).toBe(0);
    expect(layerFilledSteps(suggested, 'rhythm')).toBe(0);
    expect(describeComposition(suggested)).toContain('Melody');
  });
});

describe('playback', () => {
  function filled(): CompositionState {
    const lib = library();
    let state: CompositionState = createComposition({ stepsPerBar: 16, tempoBpm: 120 });
    state = placeMotif(state, { motifId: MELODY.id, layer: 'melody', offset: 0 }, lib).state;
    state = placeMotif(state, { motifId: BASS.id, layer: 'bass', offset: 0 }, lib).state;
    return state;
  }

  it('advances the playhead and wraps at the end of the bar', () => {
    const state = filled();
    // 120 bpm on a 16-step bar is 8 steps a second, so a bar is exactly 2 s.
    const half = advancePlayback(state, 0, 1);
    expect(half.playhead).toBeCloseTo(8, 10);
    expect(half.wrapped).toBe(false);

    const past = advancePlayback(state, 15.5, 0.125);
    expect(past.wrapped).toBe(true);
    expect(past.playhead).toBeCloseTo(0.5, 10);
    expect(past.playhead).toBeLessThan(state.stepsPerBar);
    // The step it crossed was step 0 of the next bar, not step 16.
    expect(past.notes.every((note) => note.step < state.stepsPerBar)).toBe(true);
  });

  it('produces identical notes whatever the frame rate', () => {
    const state = filled();

    let playhead = 0;
    const perFrame: NoteEvent[] = [];
    for (let i = 0; i < 64; i += 1) {
      const tick = advancePlayback(state, playhead, 1 / 64);
      playhead = tick.playhead;
      perFrame.push(...tick.notes);
    }

    const oneShot = advancePlayback(state, 0, 1);

    expect(playhead).toBe(oneShot.playhead);
    expect(perFrame).toHaveLength(oneShot.notes.length);
    expect(perFrame.map((n) => `${n.step}:${n.layer}:${n.degree}`)).toEqual(
      oneShot.notes.map((n) => `${n.step}:${n.layer}:${n.degree}`),
    );
    expect(perFrame.length).toBeGreaterThan(0);
  });

  it('fires each step exactly once across a whole bar', () => {
    const state = filled();
    let playhead = 0;
    const steps: number[] = [];
    // Two seconds is one bar at 120 bpm; 120 frames of 1/60 s.
    for (let i = 0; i < 120; i += 1) {
      const tick = advancePlayback(state, playhead, 1 / 60);
      playhead = tick.playhead;
      for (const note of tick.notes) if (note.layer === 'melody') steps.push(note.step);
    }
    const unique = [...new Set(steps)];
    expect(steps).toHaveLength(unique.length);
    expect(unique).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it('never emits a note for a step with no card on it', () => {
    const empty = createComposition({ stepsPerBar: 16, tempoBpm: 120 });
    const tick = advancePlayback(empty, 0, 2);
    expect(tick.notes).toEqual([]);
    expect(tick.wrapped).toBe(true);
  });

  it('caps one tick at a single bar so a stalled tab cannot flood the host', () => {
    const state = filled();
    const tick = advancePlayback(state, 0, 60);
    expect(tick.stepsAdvanced).toBe(state.stepsPerBar);
    expect(tick.notes.length).toBeLessThanOrEqual(state.stepsPerBar * LAYER_IDS.length);
  });

  it('emits notes carrying a valid harmonic degree and an in-range velocity', () => {
    const state = filled();
    const notes = advancePlayback(state, 0, 2).notes;
    expect(notes.length).toBeGreaterThan(0);

    for (const note of notes) {
      expect(Number.isInteger(note.degree)).toBe(true);
      expect(note.degree).toBeGreaterThanOrEqual(0);
      expect(note.degree).toBeLessThan(SCALE_DEGREES);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      expect(note.hz).toBeGreaterThan(0);
      expect(note.durationSeconds).toBeCloseTo(stepDurationSeconds(120, 16), 10);
      expect(note.degreeName.length).toBeGreaterThan(0);
      expect(LAYER_IDS).toContain(note.layer);
    }

    // The bass lane sounds an octave below the World Chord; the melody above it.
    const bassRoot = notes.find((n) => n.layer === 'bass' && n.degree === 0);
    expect(bassRoot?.hz).toBeCloseTo(WORLD_CHORD_HZ / 2, 6);
    const melodyRoot = notes.find((n) => n.layer === 'melody' && n.degree === 0);
    expect(melodyRoot?.hz).toBeCloseTo(WORLD_CHORD_HZ * 2, 6);
  });

  it('accents beat boundaries a little harder than the steps between them', () => {
    const state = filled();
    const onBeat = noteEventsAtStep(state, 0)[0];
    const offBeat = noteEventsAtStep(state, 2)[0];
    expect(onBeat?.accent).toBe(true);
    expect(offBeat?.accent).toBe(false);
    expect(onBeat?.velocity ?? 0).toBeGreaterThan(offBeat?.velocity ?? 1);
  });
});
